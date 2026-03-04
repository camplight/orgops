import type { Hono } from "hono";
import { randomUUID } from "node:crypto";

import { schema, type OrgOpsDrizzleDb } from "@orgops/db";
import { eq } from "drizzle-orm";

type ModelsDeps = {
  orm: OrgOpsDrizzleDb;
  jsonResponse: (c: any, data: unknown, status?: number) => Response;
  parseJson: <T>(input: string, fallback: T) => T;
};

export function registerModelsRoutes(app: Hono<any>, deps: ModelsDeps) {
  const { orm, jsonResponse, parseJson } = deps;

  app.get("/api/models", (c) => {
    const rows = orm.select().from(schema.models).all() as any[];
    const data = rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      modelName: row.model_name,
      enabled: Boolean(row.enabled),
      defaults: parseJson(row.defaults_json, {}),
      createdAt: row.created_at
    }));
    return jsonResponse(c, data);
  });

  app.post("/api/models", async (c) => {
    const body = await c.req.json();
    const id = body.id ?? randomUUID();
    const now = Date.now();
    orm
      .insert(schema.models)
      .values({
        id,
        provider: body.provider,
        model_name: body.modelName,
        enabled: body.enabled ? 1 : 0,
        defaults_json: JSON.stringify(body.defaults ?? {}),
        created_at: now
      })
      .run();
    return jsonResponse(c, { id }, 201);
  });

  app.patch("/api/models/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    orm
      .update(schema.models)
      .set({
        enabled: body.enabled ? 1 : 0,
        defaults_json: JSON.stringify(body.defaults ?? {})
      })
      .where(eq(schema.models.id, id))
      .run();
    return jsonResponse(c, { ok: true });
  });
}
