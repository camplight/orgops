import type { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema, type OrgOpsDrizzleDb } from "@orgops/db";
import type { RequestUser, TrelloIngestionAccess } from "./access";

type GuardrailAllowlistDeps = {
  orm: OrgOpsDrizzleDb;
  jsonResponse: (c: unknown, data: unknown, status?: number) => Response;
  access: TrelloIngestionAccess;
};

type GuardrailAllowlistEntryRow = {
  id: string;
  path_pattern: string;
  created_by: string;
  created_at: number;
};

type GuardrailAllowlistEntryResponse = {
  id: string;
  pathPattern: string;
  createdBy: string;
  createdAt: number;
};

function toEntryResponse(row: GuardrailAllowlistEntryRow): GuardrailAllowlistEntryResponse {
  return {
    id: row.id,
    pathPattern: row.path_pattern,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

/**
 * New per-domain route file owned by multi-source-ingestion-governance (US-12). Per ADR-0010,
 * this is the ENTIRE guardrail_config mechanism: a flat CRUD API over a single global allowlist
 * table — no policy engine, no multi-tier approval chains. Every action is governance-team-only,
 * reusing the existing canManageTrelloIngestion team-membership check (access.ts, step 02-01).
 */
export function registerGuardrailAllowlistRoutes(app: Hono<any>, deps: GuardrailAllowlistDeps) {
  const { orm, jsonResponse, access } = deps;

  app.get("/api/guardrail-allowlist", async (c) => {
    const user = c.get("user") as RequestUser | undefined;
    if (!access.canManageTrelloIngestion(user)) {
      return jsonResponse(c, { error: "Forbidden" }, 403);
    }
    const rows = orm
      .select()
      .from(schema.guardrailAllowlistEntries)
      .all() as GuardrailAllowlistEntryRow[];
    return jsonResponse(c, rows.map(toEntryResponse));
  });

  app.post("/api/guardrail-allowlist", async (c) => {
    const user = c.get("user") as RequestUser | undefined;
    if (!access.canManageTrelloIngestion(user) || !user?.id) {
      return jsonResponse(c, { error: "Forbidden" }, 403);
    }
    const body = await c.req.json();
    const pathPattern = typeof body.pathPattern === "string" ? body.pathPattern.trim() : "";
    if (!pathPattern) {
      return jsonResponse(c, { error: "pathPattern is required" }, 400);
    }
    const id = randomUUID();
    orm
      .insert(schema.guardrailAllowlistEntries)
      .values({
        id,
        path_pattern: pathPattern,
        created_by: user.id,
        created_at: Date.now(),
      })
      .run();
    const row = orm
      .select()
      .from(schema.guardrailAllowlistEntries)
      .where(eq(schema.guardrailAllowlistEntries.id, id))
      .get() as GuardrailAllowlistEntryRow;
    return jsonResponse(c, toEntryResponse(row), 201);
  });

  app.delete("/api/guardrail-allowlist/:id", async (c) => {
    const user = c.get("user") as RequestUser | undefined;
    if (!access.canManageTrelloIngestion(user)) {
      return jsonResponse(c, { error: "Forbidden" }, 403);
    }
    const id = c.req.param("id");
    orm.delete(schema.guardrailAllowlistEntries).where(eq(schema.guardrailAllowlistEntries.id, id)).run();
    return c.body(null, 204);
  });
}
