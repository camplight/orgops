import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { OrgOpsDb } from "@orgops/db";
import type { RequestUser } from "./access";
import type { ComposioClient } from "../composio";

const slug = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/);
const tools = z.array(z.string().regex(/^[A-Z0-9_]{1,200}$/)).max(100);
type Connection = {
  id: string;
  human_id: string;
  external_user_id: string;
  toolkit: string;
};
type Agent = {
  id: string;
  name: string;
  owner_human_id: string | null;
  visibility: string;
};
export function registerComposioRoutes(
  app: Hono<any>,
  { db, client }: { db: OrgOpsDb; client?: ComposioClient },
) {
  const routes = new Hono<{ Variables: { user: RequestUser } }>();
  routes.onError((error, c) =>
    error instanceof HTTPException
      ? c.json({ error: error.message }, error.status)
      : c.json({ error: "Composio is unavailable; retry later" }, 502),
  );
  routes.use(
    "*",
    bodyLimit({
      maxSize: 64_000,
      onError: (c) => c.json({ error: "Request too large" }, 413),
    }),
  );
  routes.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  function human(c: any) {
    const user = c.get("user") as RequestUser;
    if (!user?.id || user.username === "runner" || user.mustChangePassword)
      throw new HTTPException(403, { message: "Signed-in human required" });
    return user as RequestUser & { id: string };
  }
  function service() {
    if (!client)
      throw new HTTPException(503, { message: "Composio is not configured" });
    return client;
  }
  async function body<T>(c: any, schema: z.ZodType<T>): Promise<T> {
    const result = schema.safeParse(await c.req.json().catch(() => null));
    if (!result.success)
      throw new HTTPException(400, { message: "Invalid request" });
    return result.data;
  }
  function ownedAgent(name: string, humanId: string) {
    const agent = db
      .prepare(
        "SELECT id,name,owner_human_id,visibility FROM agents WHERE name=?",
      )
      .get(name) as Agent | undefined;
    if (
      !agent ||
      agent.visibility !== "PRIVATE" ||
      agent.owner_human_id !== humanId
    )
      throw new HTTPException(403, { message: "Private owned agent required" });
    return agent;
  }
  function ownedConnection(id: string, humanId: string) {
    const row = db
      .prepare("SELECT * FROM composio_connections WHERE id=? AND human_id=?")
      .get(id, humanId) as Connection | undefined;
    if (!row || row.external_user_id !== service().userId(humanId))
      throw new HTTPException(404, { message: "Connection not found" });
    return row;
  }
  function safeAccount(value: any) {
    return { id: value.id, toolkit: value.toolkit?.slug, status: value.status };
  }
  async function verifiedAccount(connection: Connection) {
    const account = await service().request(
      `/connected_accounts/${encodeURIComponent(connection.id)}`,
    );
    if (
      account.id !== connection.id ||
      account.user_id !== connection.external_user_id ||
      account.toolkit?.slug !== connection.toolkit ||
      account.experimental?.account_type === "SHARED"
    )
      throw new HTTPException(403, {
        message: "Connection ownership mismatch",
      });
    return account;
  }
  async function usableAccount(connection: Connection) {
    const account = await verifiedAccount(connection);
    if (account.status !== "ACTIVE" || account.is_disabled)
      throw new HTTPException(409, {
        message: "Reconnect this account before using it",
      });
    return account;
  }
  routes.get("/config", (c) => {
    human(c);
    return c.json({
      configured: !!client,
      toolkits: Object.keys(client?.config.authConfigs ?? {}),
    });
  });
  routes.get("/toolkits", async (c) => {
    human(c);
    const api = service();
    const search = (c.req.query("search") ?? "").slice(0, 120);
    const result = await api.request("/toolkits", {
      query: {
        search,
        limit: "50",
        ...(c.req.query("cursor")
          ? { cursor: c.req.query("cursor")!.slice(0, 500) }
          : {}),
      },
    });
    return c.json({
      items: (result.items ?? []).map((item: any) => ({
        slug: item.slug,
        name: item.name,
        description: item.meta?.description ?? item.description ?? "",
        connectable: !!api.config.authConfigs[item.slug],
      })),
      nextCursor: result.next_cursor ?? null,
    });
  });
  routes.get("/connections", async (c) => {
    const user = human(c),
      api = service();
    const result = await api.request("/connected_accounts", {
      query: {
        user_ids: api.userId(user.id),
        account_type: "PRIVATE",
        limit: "50",
        ...(c.req.query("cursor")
          ? { cursor: c.req.query("cursor")!.slice(0, 500) }
          : {}),
      },
    });
    const accounts = (result.items ?? []).filter(
      (a: any) =>
        a.user_id === api.userId(user.id) &&
        a.experimental?.account_type !== "SHARED" &&
        typeof a.id === "string" &&
        typeof a.toolkit?.slug === "string",
    );
    for (const account of accounts)
      db.prepare(
        "INSERT INTO composio_connections(id,human_id,external_user_id,toolkit,created_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
      ).run(
        account.id,
        user.id,
        api.userId(user.id),
        account.toolkit.slug,
        Date.now(),
      );
    return c.json({
      items: accounts.map(safeAccount),
      nextCursor: result.next_cursor ?? null,
    });
  });
  routes.post("/connections/link", async (c) => {
    const user = human(c),
      api = service();
    const input = await body(c, z.object({ toolkit: slug }).strict());
    const authConfigId = api.config.authConfigs[input.toolkit];
    if (!authConfigId)
      throw new HTTPException(409, {
        message: "An administrator must configure this toolkit first",
      });
    const result = await api.request("/connected_accounts/link", {
      method: "POST",
      body: {
        auth_config_id: authConfigId,
        user_id: api.userId(user.id),
        callback_url: api.config.callbackUrl,
      },
    });
    const url = new URL(result.redirect_url);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !(
        url.hostname === "composio.dev" ||
        url.hostname.endsWith(".composio.dev")
      )
    )
      throw Error("Invalid auth URL");
    // Return only to this authenticated human. No bearer link tokens, account state,
    // credential payloads, or OAuth URLs are written to events or application logs.
    return c.json(
      { redirectUrl: url.toString(), expiresAt: result.expires_at ?? null },
      201,
    );
  });
  routes.post("/connections/:id/revoke", async (c) => {
    const user = human(c),
      id = c.req.param("id");
    const connection = ownedConnection(id, user.id);
    await verifiedAccount(connection);
    // Revoke local agent access before contacting the provider, including when it
    // times out. Retrying provider revocation remains available to the owner.
    db.prepare(
      "DELETE FROM composio_agent_grants WHERE connection_id=? AND human_id=?",
    ).run(id, user.id);
    await service().request(
      `/connected_accounts/${encodeURIComponent(id)}/revoke`,
      { method: "POST" },
    );
    return c.json({ ok: true });
  });
  routes.get("/connections/:id/tools", async (c) => {
    const user = human(c),
      connection = ownedConnection(c.req.param("id"), user.id);
    await usableAccount(connection);
    const result = await service().request("/tools", {
      query: {
        toolkit_slug: connection.toolkit,
        search: (c.req.query("search") ?? "").slice(0, 120),
        limit: "50",
        ...(c.req.query("cursor")
          ? { cursor: c.req.query("cursor")!.slice(0, 500) }
          : {}),
      },
    });
    return c.json({
      items: (result.items ?? [])
        .filter((tool: any) => tool.toolkit?.slug === connection.toolkit)
        .map((tool: any) => ({
          slug: tool.slug,
          name: tool.name,
          description: tool.description,
        })),
      nextCursor: result.next_cursor ?? null,
    });
  });
  routes.put("/agents/:name/grants/:id", async (c) => {
    const user = human(c),
      agent = ownedAgent(c.req.param("name"), user.id),
      connection = ownedConnection(c.req.param("id"), user.id);
    const input = await body(c, z.object({ tools }).strict());
    await usableAccount(connection);
    // Validate the toolkit for every explicit tool. An owner grants concrete tools,
    // not a wildcard that would silently include future write/delete capabilities.
    for (const slug of new Set(input.tools)) {
      const tool = await service().request(
        `/tools/${encodeURIComponent(slug)}`,
      );
      if (tool.toolkit?.slug !== connection.toolkit)
        throw new HTTPException(400, {
          message: "Tool does not belong to this connection",
        });
    }
    ownedAgent(agent.name, user.id); // Recheck ownership after remote awaits.
    db.prepare(
      "INSERT INTO composio_agent_grants VALUES(?,?,?,?) ON CONFLICT(agent_id,connection_id) DO UPDATE SET human_id=excluded.human_id,tools_json=excluded.tools_json",
    ).run(
      agent.id,
      user.id,
      connection.id,
      JSON.stringify([...new Set(input.tools)]),
    );
    return c.json({ ok: true });
  });
  routes.get("/agents/:name/grants", (c) => {
    const user = human(c),
      agent = ownedAgent(c.req.param("name"), user.id);
    return c.json(
      (
        db
          .prepare(
            "SELECT connection_id,tools_json FROM composio_agent_grants WHERE agent_id=? AND human_id=?",
          )
          .all(agent.id, user.id) as {
          connection_id: string;
          tools_json: string;
        }[]
      ).map((row) => ({
        connectionId: row.connection_id,
        tools: JSON.parse(row.tools_json),
      })),
    );
  });
  routes.delete("/agents/:name/grants/:id", (c) => {
    const user = human(c),
      agent = ownedAgent(c.req.param("name"), user.id);
    db.prepare(
      "DELETE FROM composio_agent_grants WHERE agent_id=? AND human_id=? AND connection_id=?",
    ).run(agent.id, user.id, c.req.param("id"));
    return c.json({ ok: true });
  });
  function runnerContext(c: any, agentName: string, triggerId: string) {
    const user = c.get("user") as RequestUser;
    if (user?.username !== "runner")
      throw new HTTPException(403, { message: "Runner required" });
    if (
      user.runnerScope?.mode === "SCOPED" &&
      user.runnerScope.allowedAgentName !== agentName
    )
      throw new HTTPException(403, { message: "Agent scope mismatch" });
    const agent = db
      .prepare(
        "SELECT id,name,owner_human_id,visibility FROM agents WHERE name=?",
      )
      .get(agentName) as Agent | undefined;
    if (!agent?.owner_human_id || agent.visibility !== "PRIVATE")
      throw new HTTPException(403, { message: "Private owned agent required" });
    const human = db
      .prepare("SELECT username FROM humans WHERE id=?")
      .get(agent.owner_human_id) as { username: string } | undefined;
    const event = db
      .prepare("SELECT type,source,channel_id FROM events WHERE id=?")
      .get(triggerId) as
      { type: string; source: string; channel_id: string } | undefined;
    if (
      !human ||
      event?.type !== "message.created" ||
      event?.source !== `human:${human.username}`
    )
      throw new HTTPException(403, {
        message: "Owner-initiated private conversation required",
      });
    const channel = db
      .prepare(
        "SELECT owner_human_id,visibility,archived_at FROM channels WHERE id=?",
      )
      .get(event.channel_id) as
      | {
          owner_human_id: string;
          visibility: string;
          archived_at: number | null;
        }
      | undefined;
    if (
      channel?.archived_at ||
      channel?.visibility !== "PRIVATE" ||
      channel.owner_human_id !== agent.owner_human_id
    )
      throw new HTTPException(403, {
        message: "Owner-initiated private conversation required",
      });
    if (
      user.runnerScope?.mode === "SCOPED" &&
      !user.runnerScope.allowedChannelIds?.includes(event.channel_id)
    )
      throw new HTTPException(403, { message: "Channel scope mismatch" });
    const subscribers = db
      .prepare(
        "SELECT subscriber_type,subscriber_id FROM channel_subscriptions WHERE channel_id=?",
      )
      .all(event.channel_id) as {
      subscriber_type: string;
      subscriber_id: string;
    }[];
    if (
      !subscribers.some(
        (s) => s.subscriber_type === "AGENT" && s.subscriber_id === agent.name,
      ) ||
      subscribers.some(
        (s) =>
          !(
            (s.subscriber_type === "HUMAN" &&
              s.subscriber_id === human.username) ||
            (s.subscriber_type === "AGENT" && s.subscriber_id === agent.name)
          ),
      ) ||
      db
        .prepare("SELECT 1 FROM channel_viewers WHERE channel_id=? LIMIT 1")
        .get(event.channel_id)
    )
      throw new HTTPException(403, {
        message: "Personal connections cannot run in shared conversations",
      });
    return agent as Agent & { owner_human_id: string };
  }
  const context = z.object({
    agentName: z.string().min(1).max(160),
    triggerEventId: slug,
  });
  routes.post("/runner/tools", async (c) => {
    const input = await body(c, context.strict()),
      agent = runnerContext(c, input.agentName, input.triggerEventId);
    const grants = db
      .prepare(
        "SELECT connection_id,tools_json FROM composio_agent_grants WHERE agent_id=? AND human_id=?",
      )
      .all(agent.id, agent.owner_human_id) as {
      connection_id: string;
      tools_json: string;
    }[];
    return c.json({
      connections: grants.map((row) => ({
        connectionId: row.connection_id,
        tools: JSON.parse(row.tools_json),
      })),
    });
  });
  routes.post("/runner/schema", async (c) => {
    const input = await body(
      c,
      context
        .extend({
          connectionId: slug,
          tool: z.string().regex(/^[A-Z0-9_]{1,200}$/),
        })
        .strict(),
    );
    const agent = runnerContext(c, input.agentName, input.triggerEventId);
    const grant = db
      .prepare(
        "SELECT tools_json FROM composio_agent_grants WHERE agent_id=? AND human_id=? AND connection_id=?",
      )
      .get(agent.id, agent.owner_human_id, input.connectionId) as
      { tools_json: string } | undefined;
    if (!grant || !JSON.parse(grant.tools_json).includes(input.tool))
      throw new HTTPException(403, {
        message: "Tool access has not been granted by the owner",
      });
    const connection = ownedConnection(
      input.connectionId,
      agent.owner_human_id,
    );
    await usableAccount(connection);
    const tool = await service().request(
      `/tools/${encodeURIComponent(input.tool)}`,
    );
    if (tool.toolkit?.slug !== connection.toolkit)
      throw new HTTPException(403, {
        message: "Tool does not match connection",
      });
    return c.json({
      slug: tool.slug,
      description: tool.description,
      inputParameters: tool.input_parameters,
    });
  });
  routes.post("/runner/execute", async (c) => {
    const input = await body(
      c,
      context
        .extend({
          connectionId: slug,
          tool: z.string().regex(/^[A-Z0-9_]{1,200}$/),
          arguments: z.record(z.unknown()),
        })
        .strict(),
    );
    function authorize() {
      const agent = runnerContext(c, input.agentName, input.triggerEventId);
      const grant = db
        .prepare(
          "SELECT tools_json FROM composio_agent_grants WHERE agent_id=? AND human_id=? AND connection_id=?",
        )
        .get(agent.id, agent.owner_human_id, input.connectionId) as
        { tools_json: string } | undefined;
      if (!grant || !JSON.parse(grant.tools_json).includes(input.tool))
        throw new HTTPException(403, {
          message: "Tool access has not been granted by the owner",
        });
      return ownedConnection(input.connectionId, agent.owner_human_id);
    }
    const connection = authorize();
    await usableAccount(connection);
    const tool = await service().request(
      `/tools/${encodeURIComponent(input.tool)}`,
    );
    if (tool.toolkit?.slug !== connection.toolkit)
      throw new HTTPException(403, {
        message: "Tool does not match connection",
      });
    authorize();
    const result = await service().request(
      `/tools/execute/${encodeURIComponent(input.tool)}`,
      {
        method: "POST",
        body: {
          user_id: connection.external_user_id,
          connected_account_id: connection.id,
          arguments: input.arguments,
        },
      },
    );
    return c.json(result);
  });
  app.route("/api/composio", routes);
}
