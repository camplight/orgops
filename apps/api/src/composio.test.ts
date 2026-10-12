import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app";
import { generateRunnerScopedToken } from "./agent-invite-auth";
let app: ReturnType<typeof createApp>,
  dir: string,
  cookie: string,
  otherCookie: string,
  humanId: string,
  otherId: string,
  channelId: string,
  eventId: string;
let accounts: any[],
  calls: { path: string; body: any; url: URL }[],
  fail: boolean,
  onTool: (() => void) | undefined;
const req = (path: string, method = "GET", value?: unknown, auth = cookie) =>
  app.app.request("/api" + path, {
    method,
    headers: { cookie: auth, "content-type": "application/json" },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
const runner = (path: string, value: any) =>
  app.app.request("/api/composio/runner/" + path, {
    method: "POST",
    headers: {
      "x-orgops-runner-token": "runner",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      agentName: "PuffOwner",
      triggerEventId: eventId,
      ...value,
    }),
  });
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "composio-"));
  calls = [];
  accounts = [];
  fail = false;
  onTool = undefined;
  const transport: typeof fetch = async (url, init) => {
    const u = new URL(String(url)),
      path = u.pathname.replace("/api/v3.1", "");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, body, url: u });
    expect(new Headers(init?.headers).get("x-api-key")).toBe(
      "private-test-key",
    );
    expect(init?.redirect).toBe("error");
    if (fail)
      return Response.json({ secret: "must-not-leak" }, { status: 500 });
    if (path === "/toolkits")
      return Response.json({
        items: [
          { slug: "trello", name: "Trello", meta: { description: "Boards" } },
        ],
      });
    if (path === "/connected_accounts/link")
      return Response.json({
        redirect_url: "https://connect.composio.dev/link?token=private-link",
        link_token: "must-not-leak",
        connected_account_id: "ca_owner",
      });
    if (path === "/connected_accounts")
      return Response.json({ items: accounts });
    if (path.endsWith("/revoke")) return Response.json({ ok: true });
    if (path.startsWith("/connected_accounts/"))
      return Response.json(
        accounts.find((a) => a.id === path.split("/").at(-1)) ?? {},
      );
    if (path.startsWith("/tools/execute/"))
      return Response.json({
        successful: true,
        data: { boards: ["Test board"] },
      });
    if (path.startsWith("/tools/")) {
      onTool?.();
      return Response.json({
        slug: path.split("/").at(-1),
        toolkit: { slug: path.includes("GMAIL") ? "gmail" : "trello" },
        input_parameters: {
          type: "object",
          properties: { boardId: { type: "string" } },
        },
      });
    }
    if (path === "/tools")
      return Response.json({
        items: [
          {
            slug: "TRELLO_LIST_BOARDS",
            name: "List boards",
            toolkit: { slug: "trello" },
          },
        ],
      });
    throw Error("Unexpected remote endpoint");
  };
  app = createApp({
    projectRoot: dir,
    dataDir: dir,
    dbPath: join(dir, "db.sqlite"),
    adminUser: "owner",
    adminPass: "password123",
    runnerToken: "runner",
    composio: {
      apiKey: "private-test-key",
      instanceId: "test-instance",
      callbackUrl: "https://nest.example/onboarding",
      authConfigs: { trello: "ac_trello" },
      fetch: transport,
    },
  });
  const login = await req(
    "/auth/login",
    "POST",
    { username: "owner", password: "password123" },
    "",
  );
  cookie = login.headers.getSetCookie()[0].split(";")[0];
  humanId = (await (await req("/auth/me")).json()).id;
  await req("/humans/invite", "POST", {
    username: "other",
    tempPassword: "password123",
  });
  const other = await req(
    "/auth/login",
    "POST",
    { username: "other", password: "password123" },
    "",
  );
  otherCookie = other.headers.getSetCookie()[0].split(";")[0];
  // Complete the invited account fixture without exercising password UI here.
  app.db
    .prepare("UPDATE humans SET must_change_password=0 WHERE username=?")
    .run("other");
  const second = await req(
    "/auth/login",
    "POST",
    { username: "other", password: "password123" },
    "",
  );
  otherCookie = second.headers.getSetCookie()[0].split(";")[0];
  otherId = (
    await (await req("/auth/me", "GET", undefined, otherCookie)).json()
  ).id;
  expect(
    (
      await req("/agents", "POST", {
        name: "PuffOwner",
        modelId: "test:model",
        workspacePath: join(dir, "workspace"),
        visibility: "PRIVATE",
      })
    ).status,
  ).toBe(201);
  channelId = (
    await (
      await req("/channels", "POST", {
        name: "Private owner chat",
        visibility: "PRIVATE",
      })
    ).json()
  ).id;
  await req(`/channels/${channelId}/subscribe`, "POST", {
    subscriberType: "AGENT",
    subscriberId: "PuffOwner",
  });
  eventId = (
    await (
      await req("/events", "POST", {
        type: "message.created",
        source: "human:owner",
        channelId,
        payload: { text: "List my boards" },
      })
    ).json()
  ).id;
  accounts = [
    {
      id: "ca_owner",
      user_id: `orgops:test-instance:${humanId}`,
      toolkit: { slug: "trello" },
      status: "ACTIVE",
      state: { val: { access_token: "must-not-leak" } },
    },
    {
      id: "ca_other",
      user_id: `orgops:test-instance:${otherId}`,
      toolkit: { slug: "trello" },
      status: "ACTIVE",
    },
  ];
});
afterEach(() => {
  app.db.close();
  rmSync(dir, { recursive: true, force: true });
});
async function grant() {
  expect((await req("/composio/connections")).status).toBe(200);
  expect(
    (
      await req("/composio/agents/PuffOwner/grants/ca_owner", "PUT", {
        tools: ["TRELLO_LIST_BOARDS"],
      })
    ).status,
  ).toBe(200);
}
describe("Composio core ownership boundary", () => {
  it("requires a human for configuration, links and connection status", async () => {
    expect((await req("/composio/config", "GET", undefined, "")).status).toBe(
      401,
    );
    expect(
      (
        await app.app.request("/api/composio/config", {
          headers: { "x-orgops-runner-token": "runner" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await req("/composio/connections/link", "POST", {
          toolkit: "trello",
          userId: "other",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await req("/composio/connections/link", "POST", {
          toolkit: "unconfigured",
        })
      ).status,
    ).toBe(409);
    expect(calls).toHaveLength(0);
  });
  it("binds links to the stable human ID and returns only the auth URL", async () => {
    const r = await req("/composio/connections/link", "POST", {
      toolkit: "trello",
    });
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({
      redirectUrl: "https://connect.composio.dev/link?token=private-link",
      expiresAt: null,
    });
    expect(calls[0].body).toEqual({
      user_id: `orgops:test-instance:${humanId}`,
      auth_config_id: "ac_trello",
      callback_url: "https://nest.example/onboarding",
    });
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
  it("filters foreign accounts even if the remote response ignores user filtering, and never returns credentials", async () => {
    const r = await req("/composio/connections");
    expect(await r.json()).toEqual({
      items: [{ id: "ca_owner", toolkit: "trello", status: "ACTIVE" }],
      nextCursor: null,
    });
    expect(calls[0].url.searchParams.get("user_ids")).toBe(
      `orgops:test-instance:${humanId}`,
    );
    expect(
      (
        await req(
          "/composio/connections/ca_owner/revoke",
          "POST",
          {},
          otherCookie,
        )
      ).status,
    ).toBe(404);
  });
  it("requires an owned private agent and exact toolkit grants", async () => {
    await req("/composio/connections");
    expect(
      (
        await req(
          "/composio/agents/PuffOwner/grants/ca_owner",
          "PUT",
          { tools: ["TRELLO_LIST_BOARDS"] },
          otherCookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await req("/composio/agents/PuffOwner/grants/ca_owner", "PUT", {
          tools: ["GMAIL_SEND_EMAIL"],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await runner("execute", {
          connectionId: "ca_owner",
          tool: "TRELLO_LIST_BOARDS",
          arguments: {},
        })
      ).status,
    ).toBe(403);
  });
  it("executes only the owner-granted tool with server-selected identity and account", async () => {
    await grant();
    expect((await runner("tools", {})).status).toBe(200);
    const schema = await runner("schema", {
      connectionId: "ca_owner",
      tool: "TRELLO_LIST_BOARDS",
    });
    expect((await schema.json()).inputParameters.type).toBe("object");
    const result = await runner("execute", {
      connectionId: "ca_owner",
      tool: "TRELLO_LIST_BOARDS",
      arguments: { boardId: "board" },
    });
    expect(result.status).toBe(200);
    expect(calls.at(-1)?.body).toEqual({
      user_id: `orgops:test-instance:${humanId}`,
      connected_account_id: "ca_owner",
      arguments: { boardId: "board" },
    });
    expect(
      (
        await runner("execute", {
          connectionId: "ca_owner",
          tool: "TRELLO_LIST_BOARDS",
          arguments: {},
          user_id: "other",
        })
      ).status,
    ).toBe(400);
  });
  it("denies execution in shared conversations or triggered by another human", async () => {
    await grant();
    await req(`/channels/${channelId}/subscribe`, "POST", {
      subscriberType: "HUMAN",
      subscriberId: "other",
    });
    expect(
      (
        await runner("execute", {
          connectionId: "ca_owner",
          tool: "TRELLO_LIST_BOARDS",
          arguments: {},
        })
      ).status,
    ).toBe(403);
    const foreign = (
      await (
        await req(
          "/events",
          "POST",
          {
            type: "message.created",
            source: "human:other",
            channelId,
            payload: { text: "Read owner data" },
          },
          otherCookie,
        )
      ).json()
    ).id;
    expect((await runner("tools", { triggerEventId: foreign })).status).toBe(
      403,
    );
  });
  it("denies remote account reassignment, revocation and agent ownership changes", async () => {
    await grant();
    accounts[0].user_id = "other";
    expect(
      (
        await runner("execute", {
          connectionId: "ca_owner",
          tool: "TRELLO_LIST_BOARDS",
          arguments: {},
        })
      ).status,
    ).toBe(403);
    accounts[0].user_id = `orgops:test-instance:${humanId}`;
    accounts[0].status = "EXPIRED";
    expect(
      (
        await runner("execute", {
          connectionId: "ca_owner",
          tool: "TRELLO_LIST_BOARDS",
          arguments: {},
        })
      ).status,
    ).toBe(409);
    accounts[0].status = "ACTIVE";
    app.db
      .prepare("UPDATE agents SET owner_human_id=? WHERE name=?")
      .run(otherId, "PuffOwner");
    expect((await runner("tools", {})).status).toBe(403);
  });
  it("rechecks grants after remote awaits", async () => {
    await grant();
    onTool = () => {
      app.db.prepare("DELETE FROM composio_agent_grants").run();
    };
    expect(
      (
        await runner("execute", {
          connectionId: "ca_owner",
          tool: "TRELLO_LIST_BOARDS",
          arguments: {},
        })
      ).status,
    ).toBe(403);
    expect(calls.some((c) => c.path.startsWith("/tools/execute/"))).toBe(false);
  });
  it("enforces scoped runner agent and channel bindings", async () => {
    await grant();
    const token = generateRunnerScopedToken();
    app.db
      .prepare(
        "INSERT INTO runner_tokens(id,name,token_hash,token_prefix,allowed_agent_name,allowed_channel_ids_json,created_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        "scoped",
        "Test runner",
        token.hash,
        token.prefix,
        "PuffOwner",
        JSON.stringify([channelId]),
        Date.now(),
      );
    const call = () =>
      app.app.request("/api/composio/runner/tools", {
        method: "POST",
        headers: {
          "x-orgops-runner-token": token.token,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          agentName: "PuffOwner",
          triggerEventId: eventId,
        }),
      });
    expect((await call()).status).toBe(200);
    app.db
      .prepare("UPDATE runner_tokens SET allowed_channel_ids_json='[]'")
      .run();
    expect((await call()).status).toBe(403);
    app.db
      .prepare(
        "UPDATE runner_tokens SET allowed_channel_ids_json=?,allowed_agent_name=?",
      )
      .run(JSON.stringify([channelId]), "OtherAgent");
    expect((await call()).status).toBe(403);
  });
  it("rejects archived conversations and non-message triggers", async () => {
    await grant();
    app.db
      .prepare("UPDATE channels SET archived_at=? WHERE id=?")
      .run(Date.now(), channelId);
    expect((await runner("tools", {})).status).toBe(403);
    app.db
      .prepare("UPDATE channels SET archived_at=NULL WHERE id=?")
      .run(channelId);
    app.db
      .prepare("UPDATE events SET type='tool.executed' WHERE id=?")
      .run(eventId);
    expect((await runner("tools", {})).status).toBe(403);
  });
  it("revokes local grants and redacts remote failure details", async () => {
    await grant();
    const r = await req("/composio/connections/ca_owner/revoke", "POST", {});
    expect(r.status).toBe(200);
    expect((await runner("tools", {})).status).toBe(200);
    expect(
      app.db.prepare("SELECT COUNT(*) n FROM composio_agent_grants").get(),
    ).toEqual({ n: 0 });
    fail = true;
    const failed = await req("/composio/connections");
    expect(failed.status).toBe(502);
    expect(await failed.text()).not.toContain("must-not-leak");
  });
});
