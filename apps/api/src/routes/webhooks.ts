import type { Hono } from "hono";
import { createHmac, randomUUID } from "node:crypto";

import { schema, type OrgOpsDrizzleDb } from "@orgops/db";
import { eq } from "drizzle-orm";

type WebhooksDeps = {
  orm: OrgOpsDrizzleDb;
  jsonResponse: (c: any, data: unknown, status?: number) => Response;
  parseJsonSafe: (input: string) => Record<string, any> | null;
  insertEvent: (input: any) => any;
};

function verifyWebhook(secret: string, payload: string, signature: string) {
  const digest = createHmac("sha256", secret).update(payload).digest("hex");
  return signature === digest;
}

function webhookDefinitionRowToApi(row: any) {
  return {
    id: row.id,
    name: row.name,
    verificationKind: row.verification_kind,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function registerWebhookRoutes(app: Hono<any>, deps: WebhooksDeps) {
  const { orm, jsonResponse, parseJsonSafe, insertEvent } = deps;

  app.get("/api/webhook-definitions", (c) => {
    const rows = orm
      .select({
        id: schema.webhookDefinitions.id,
        name: schema.webhookDefinitions.name,
        verification_kind: schema.webhookDefinitions.verification_kind,
        created_at: schema.webhookDefinitions.created_at,
        updated_at: schema.webhookDefinitions.updated_at
      })
      .from(schema.webhookDefinitions)
      .all() as any[];
    return jsonResponse(c, rows.map(webhookDefinitionRowToApi));
  });

  app.post("/api/webhook-definitions", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const name = body.name ?? "";
    const verificationKind = body.verificationKind ?? body.verification_kind ?? "generic_hmac";
    const secret = body.secret ?? "";
    if (!name.trim()) return jsonResponse(c, { error: "Missing name" }, 400);
    if (!secret) return jsonResponse(c, { error: "Missing secret" }, 400);
    const allowed = ["generic_hmac", "github_hmac"];
    if (!allowed.includes(verificationKind)) {
      return jsonResponse(c, { error: "Invalid verificationKind" }, 400);
    }
    const id = randomUUID();
    const now = Date.now();
    try {
      orm
        .insert(schema.webhookDefinitions)
        .values({
          id,
          name: name.trim(),
          verification_kind: verificationKind,
          secret,
          created_at: now,
          updated_at: now
        })
        .run();
    } catch (e: any) {
      if (e?.code === "SQLITE_CONSTRAINT_UNIQUE") {
        return jsonResponse(c, { error: "Name already exists" }, 409);
      }
      throw e;
    }
    const row = orm.select().from(schema.webhookDefinitions).where(eq(schema.webhookDefinitions.id, id)).get() as any;
    return jsonResponse(c, webhookDefinitionRowToApi(row), 201);
  });

  app.patch("/api/webhook-definitions/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const secret = body.secret;
    const verificationKind = body.verificationKind ?? body.verification_kind;
    const updates: Record<string, any> = {};
    if (secret !== undefined) updates.secret = secret;
    if (verificationKind !== undefined) {
      const allowed = ["generic_hmac", "github_hmac"];
      if (!allowed.includes(verificationKind)) {
        return jsonResponse(c, { error: "Invalid verificationKind" }, 400);
      }
      updates.verification_kind = verificationKind;
    }
    if (Object.keys(updates).length === 0) {
      return jsonResponse(c, { error: "Nothing to update" }, 400);
    }
    updates.updated_at = Date.now();
    orm.update(schema.webhookDefinitions).set(updates).where(eq(schema.webhookDefinitions.id, id)).run();
    const row = orm.select().from(schema.webhookDefinitions).where(eq(schema.webhookDefinitions.id, id)).get() as any;
    if (!row) return jsonResponse(c, { error: "Not found" }, 404);
    return jsonResponse(c, webhookDefinitionRowToApi(row));
  });

  app.delete("/api/webhook-definitions/:id", (c) => {
    const id = c.req.param("id");
    const existing = orm
      .select({ id: schema.webhookDefinitions.id })
      .from(schema.webhookDefinitions)
      .where(eq(schema.webhookDefinitions.id, id))
      .get();
    if (!existing) return jsonResponse(c, { error: "Not found" }, 404);
    orm.delete(schema.webhookDefinitions).where(eq(schema.webhookDefinitions.id, id)).run();
    return jsonResponse(c, { ok: true });
  });

  app.post("/api/webhooks/:name", async (c) => {
    const name = c.req.param("name");
    const row = orm.select().from(schema.webhookDefinitions).where(eq(schema.webhookDefinitions.name, name)).get() as any;
    if (!row) return jsonResponse(c, { error: "Webhook not found" }, 404);
    const body = await c.req.text();
    const secret = row.secret;
    const verificationKind = row.verification_kind;

    if (verificationKind === "generic_hmac") {
      const signature = c.req.header("x-orgops-signature") ?? "";
      if (!secret || !verifyWebhook(secret, body, signature)) {
        insertEvent({ type: "audit.webhook.rejected", payload: { source: name }, source: "system" });
        return jsonResponse(c, { error: "Invalid signature" }, 401);
      }
    } else if (verificationKind === "github_hmac") {
      const signature = c.req.header("x-hub-signature-256") ?? "";
      if (!secret) {
        insertEvent({ type: "audit.webhook.rejected", payload: { source: name }, source: "system" });
        return jsonResponse(c, { error: "Missing secret" }, 401);
      }
      const computed = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
      if (computed !== signature) {
        insertEvent({ type: "audit.webhook.rejected", payload: { source: name }, source: "system" });
        return jsonResponse(c, { error: "Invalid signature" }, 401);
      }
    } else {
      return jsonResponse(c, { error: "Unknown verification kind" }, 500);
    }

    insertEvent({ type: "audit.webhook.verified", payload: { source: name }, source: "system" });
    const parsedPayload = parseJsonSafe(body);
    const sourceQuery = c.req.query("source");
    const payloadSource = sourceQuery ?? name;
    const idempotencyKey =
      (c.req.header("x-orgops-idempotency") ?? "") ||
      (parsedPayload?.id ? String(parsedPayload.id) : "") ||
      (parsedPayload?.event_id ? String(parsedPayload.event_id) : "") ||
      (parsedPayload?.delivery_id ? String(parsedPayload.delivery_id) : "");
    insertEvent({
      type: "webhook.received",
      payload: { source: payloadSource, body: parsedPayload ?? body },
      source: `webhook:${name}`,
      idempotencyKey: idempotencyKey || undefined
    });
    return jsonResponse(c, { ok: true });
  });

  app.post("/api/webhooks/generic/:source", async (c) => {
    const secret = process.env.ORGOPS_WEBHOOK_SECRET;
    const signature = c.req.header("x-orgops-signature") ?? "";
    const idempotencyHeader = c.req.header("x-orgops-idempotency") ?? "";
    const payload = await c.req.text();
    if (!secret || !verifyWebhook(secret, payload, signature)) {
      insertEvent({
        type: "audit.webhook.rejected",
        payload: { source: "generic" },
        source: "system"
      });
      return jsonResponse(c, { error: "Invalid signature" }, 401);
    }
    const parsedPayload = parseJsonSafe(payload);
    const idempotencyKey =
      idempotencyHeader ||
      (parsedPayload?.id ? String(parsedPayload.id) : "") ||
      (parsedPayload?.event_id ? String(parsedPayload.event_id) : "");
    insertEvent({
      type: "audit.webhook.verified",
      payload: { source: "generic" },
      source: "system"
    });
    insertEvent({
      type: "webhook.received",
      payload: { source: c.req.param("source"), body: parsedPayload ?? payload },
      source: "webhook",
      idempotencyKey: idempotencyKey || undefined
    });
    return jsonResponse(c, { ok: true });
  });

  app.post("/api/webhooks/github", async (c) => {
    const secret = process.env.ORGOPS_GITHUB_WEBHOOK_SECRET;
    const signature = c.req.header("x-hub-signature-256") ?? "";
    const deliveryId = c.req.header("x-github-delivery") ?? "";
    const body = await c.req.text();
    if (!secret) {
      insertEvent({
        type: "audit.webhook.rejected",
        payload: { source: "github" },
        source: "system"
      });
      return jsonResponse(c, { error: "Missing secret" }, 401);
    }
    const computed = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    if (computed !== signature) {
      insertEvent({
        type: "audit.webhook.rejected",
        payload: { source: "github" },
        source: "system"
      });
      return jsonResponse(c, { error: "Invalid signature" }, 401);
    }
    const payloadJson = parseJsonSafe(body);
    const idempotencyKey = deliveryId || (payloadJson?.delivery_id ? String(payloadJson.delivery_id) : "");
    insertEvent({
      type: "audit.webhook.verified",
      payload: { source: "github" },
      source: "system"
    });
    insertEvent({
      type: "webhook.received",
      payload: { source: "github", body: payloadJson ?? body },
      source: "webhook:github",
      idempotencyKey: idempotencyKey || undefined
    });
    return jsonResponse(c, { ok: true });
  });
}
