import type { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { schema } from "@orgops/db";
import type { AccessControl, RequestUser } from "./access";
import {
  findActiveIntegrationKey,
  generateIntegrationToken,
  parseBearerToken,
  touchIntegrationKeyLastUsed,
  type IntegrationKeyRow,
} from "../integration-auth";

type IntegrationKeysDeps = {
  orm: any;
  jsonResponse: (c: any, data: unknown, status?: number) => Response;
  access: AccessControl;
};

function isHumanOperator(
  user: RequestUser | undefined,
): user is RequestUser & { username: string } {
  return Boolean(user?.username && user.username !== "runner");
}

function toApiKey(row: IntegrationKeyRow, token?: string) {
  const body: Record<string, unknown> = {
    id: row.id,
    name: row.name,
    agentName: row.agent_name,
    tokenPrefix: row.token_prefix,
    createdByHumanId: row.created_by_human_id,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
  if (token) body.token = token;
  return body;
}

export function registerIntegrationKeysRoutes(app: Hono<any>, deps: IntegrationKeysDeps) {
  const { orm, jsonResponse, access } = deps;

  app.get("/v1/me", (c) => {
    const token = parseBearerToken(c.req.header("authorization"));
    if (!token) return jsonResponse(c, { error: "Unauthorized" }, 401);
    const key = findActiveIntegrationKey(orm, token);
    if (!key) return jsonResponse(c, { error: "Unauthorized" }, 401);
    touchIntegrationKeyLastUsed(orm, key.id);
    return jsonResponse(c, {
      id: key.id,
      name: key.name,
      agentName: key.agent_name,
    });
  });

  app.get("/api/integration-keys", (c) => {
    const user = c.get("user") as RequestUser | undefined;
    if (!isHumanOperator(user)) {
      return jsonResponse(c, { error: "Human authentication required" }, 403);
    }
    const rows = orm
      .select()
      .from(schema.integrationKeys)
      .orderBy(desc(schema.integrationKeys.created_at))
      .all() as IntegrationKeyRow[];
    return jsonResponse(c, rows.map((row) => toApiKey(row)));
  });

  app.post("/api/integration-keys", async (c) => {
    const user = c.get("user") as RequestUser | undefined;
    if (!isHumanOperator(user)) {
      return jsonResponse(c, { error: "Human authentication required" }, 403);
    }
    const body = await c.req.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const agentName = typeof body.agentName === "string" ? body.agentName.trim() : "";
    if (!name) return jsonResponse(c, { error: "name is required" }, 400);
    if (!agentName) return jsonResponse(c, { error: "agentName is required" }, 400);

    const agent = orm
      .select({ name: schema.agents.name })
      .from(schema.agents)
      .where(eq(schema.agents.name, agentName))
      .get() as { name: string } | undefined;
    if (!agent) return jsonResponse(c, { error: "Agent not found" }, 404);
    if (!access.canManageAgent(user, agentName)) {
      return jsonResponse(c, { error: "Forbidden" }, 403);
    }

    const generated = generateIntegrationToken();
    const now = Date.now();
    const id = randomUUID();
    const row: IntegrationKeyRow = {
      id,
      name,
      agent_name: agentName,
      token_hash: generated.hash,
      token_prefix: generated.prefix,
      created_by_human_id: user.id ?? null,
      created_at: now,
      last_used_at: null,
      revoked_at: null,
    };
    orm.insert(schema.integrationKeys).values(row).run();
    return jsonResponse(c, toApiKey(row, generated.token), 201);
  });

  app.post("/api/integration-keys/:id/revoke", (c) => {
    const user = c.get("user") as RequestUser | undefined;
    if (!isHumanOperator(user)) {
      return jsonResponse(c, { error: "Human authentication required" }, 403);
    }
    const id = c.req.param("id");
    const existing = orm
      .select()
      .from(schema.integrationKeys)
      .where(eq(schema.integrationKeys.id, id))
      .get() as IntegrationKeyRow | undefined;
    if (!existing) return jsonResponse(c, { error: "Integration key not found" }, 404);
    if (!access.canManageAgent(user, existing.agent_name)) {
      return jsonResponse(c, { error: "Forbidden" }, 403);
    }
    if (existing.revoked_at) {
      return jsonResponse(c, toApiKey(existing));
    }
    const revokedAt = Date.now();
    orm
      .update(schema.integrationKeys)
      .set({ revoked_at: revokedAt })
      .where(eq(schema.integrationKeys.id, id))
      .run();
    return jsonResponse(c, toApiKey({ ...existing, revoked_at: revokedAt }));
  });
}
