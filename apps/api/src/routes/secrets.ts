import type { Hono } from "hono";
import { randomUUID } from "node:crypto";

import { decryptSecret, encryptSecret, parseMasterKey } from "@orgops/crypto";
import { schema, type OrgOpsDrizzleDb } from "@orgops/db";
import { and, eq, isNull } from "drizzle-orm";

type SecretsDeps = {
  orm: OrgOpsDrizzleDb;
  jsonResponse: (c: any, data: unknown, status?: number) => Response;
  requireAuth: (c: any, next: any) => Response | Promise<Response | void> | void;
  requireRunnerAuth: (c: any, next: any) => Response | Promise<Response | void> | void;
  insertEvent: (input: any) => any;
};

export function registerSecretsRoutes(app: Hono<any>, deps: SecretsDeps) {
  const { orm, jsonResponse, requireAuth, requireRunnerAuth, insertEvent } = deps;
  const PACKAGE_SCOPE = "package";

  app.get("/api/secrets", requireAuth, (c) => {
    const rows = orm
      .select({
        id: schema.secrets.id,
        name: schema.secrets.name,
        scope_type: schema.secrets.scope_type,
        scope_id: schema.secrets.scope_id,
        created_at: schema.secrets.created_at
      })
      .from(schema.secrets)
      .all();
    return jsonResponse(c, rows);
  });

  app.get("/api/secrets/keys", requireAuth, (c) => {
    const packageFilter = c.req.query("package");
    let rows: { name: string; scope_id: string | null }[];
    if (packageFilter) {
      rows = orm
        .select({ name: schema.secrets.name, scope_id: schema.secrets.scope_id })
        .from(schema.secrets)
        .where(and(eq(schema.secrets.scope_type, PACKAGE_SCOPE), eq(schema.secrets.scope_id, packageFilter)))
        .all() as any[];
    } else {
      rows = orm
        .select({ name: schema.secrets.name, scope_id: schema.secrets.scope_id })
        .from(schema.secrets)
        .where(eq(schema.secrets.scope_type, PACKAGE_SCOPE))
        .all() as any[];
    }
    const keys = rows.map((r) => ({ package: r.scope_id ?? "", key: r.name }));
    return jsonResponse(c, { keys });
  });

  app.post("/api/secrets", requireAuth, async (c) => {
    const body = await c.req.json();
    const packageId = body.package ?? body.scopeId;
    const key = body.key ?? body.name;
    const value = body.value;
    if (value === undefined) return jsonResponse(c, { error: "Missing value" }, 400);
    const scopeType = body.scopeType ?? (packageId !== undefined ? PACKAGE_SCOPE : undefined);
    const scopeId = packageId ?? body.scopeId ?? null;
    const name = key ?? body.name;
    if (!name) return jsonResponse(c, { error: "Missing key or name" }, 400);
    const finalScopeType = scopeType ?? "app";
    const masterKey = parseMasterKey(process.env.ORGOPS_MASTER_KEY ?? "");
    const ciphertext = encryptSecret(masterKey, String(value));
    const existing = orm
      .select({ id: schema.secrets.id })
      .from(schema.secrets)
      .where(
        and(
          eq(schema.secrets.name, name),
          eq(schema.secrets.scope_type, finalScopeType),
          scopeId === null ? isNull(schema.secrets.scope_id) : eq(schema.secrets.scope_id, scopeId)
        )
      )
      .get() as { id: string } | undefined;
    const now = Date.now();
    if (existing) {
      orm
        .update(schema.secrets)
        .set({
          ciphertext_b64: ciphertext,
          created_at: now
        })
        .where(eq(schema.secrets.id, existing.id))
        .run();
      return jsonResponse(c, { id: existing.id, ok: true }, 200);
    }
    const id = randomUUID();
    orm
      .insert(schema.secrets)
      .values({
        id,
        name,
        scope_type: finalScopeType,
        scope_id: scopeId,
        ciphertext_b64: ciphertext,
        created_at: now
      })
      .run();
    insertEvent({
      type: "audit.secret.set",
      payload: { name, scopeType: finalScopeType, scopeId },
      source: "system"
    });
    return jsonResponse(c, { id }, 201);
  });

  app.delete("/api/secrets/:id", requireAuth, (c) => {
    const id = c.req.param("id");
    orm.delete(schema.secrets).where(eq(schema.secrets.id, id)).run();
    return jsonResponse(c, { ok: true });
  });

  app.delete("/api/secrets", requireAuth, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const packageId = body.package ?? body.scopeId;
    const key = body.key ?? body.name;
    if (key === undefined) return jsonResponse(c, { error: "Missing key or name" }, 400);
    const scopeType = packageId !== undefined ? PACKAGE_SCOPE : (body.scopeType ?? "app");
    const scopeId = packageId ?? body.scopeId ?? null;
    const existing = orm
      .select({ id: schema.secrets.id })
      .from(schema.secrets)
      .where(
        and(
          eq(schema.secrets.name, key),
          eq(schema.secrets.scope_type, scopeType),
          scopeId === null ? isNull(schema.secrets.scope_id) : eq(schema.secrets.scope_id, scopeId)
        )
      )
      .get();
    if (!existing) return jsonResponse(c, { error: "Not found" }, 404);
    orm
      .delete(schema.secrets)
      .where(
        and(
          eq(schema.secrets.name, key),
          eq(schema.secrets.scope_type, scopeType),
          scopeId === null ? isNull(schema.secrets.scope_id) : eq(schema.secrets.scope_id, scopeId)
        )
      )
      .run();
    return jsonResponse(c, { ok: true });
  });

  app.get("/api/secrets/env", requireRunnerAuth, async (c) => {
    const masterKey = parseMasterKey(process.env.ORGOPS_MASTER_KEY ?? "");
    const requestedByAgent = (c.req.header("x-orgops-agent-name") ?? "").trim();
    const source = requestedByAgent && /^[a-zA-Z0-9._-]+$/.test(requestedByAgent) ? `agent:${requestedByAgent}` : "system";
    const rows = orm
      .select({ name: schema.secrets.name, ciphertext_b64: schema.secrets.ciphertext_b64 })
      .from(schema.secrets)
      .where(eq(schema.secrets.scope_type, PACKAGE_SCOPE))
      .all() as { name: string; ciphertext_b64: string }[];
    const env: Record<string, string> = {};
    for (const row of rows) {
      try {
        env[row.name] = decryptSecret(masterKey, row.ciphertext_b64);
      } catch {
        // skip corrupted or wrong-key entries
      }
    }
    insertEvent({
      type: "audit.secret.accessed",
      payload: {
        scopeType: PACKAGE_SCOPE,
        count: Object.keys(env).length,
        names: Object.keys(env).sort(),
        ...(requestedByAgent ? { requestedByAgent } : {})
      },
      source
    });
    return jsonResponse(c, env);
  });
}
