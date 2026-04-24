import type { Hono } from "hono";
import { asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { schema, type OrgOpsDrizzleDb } from "@orgops/db";

type RunnerRecord = {
  id: string;
  display_name: string;
  hostname: string | null;
  platform: string | null;
  arch: string | null;
  version: string | null;
  metadata_json: string;
  created_at: number;
  updated_at: number;
  last_seen_at: number;
};

type RunnersDeps = {
  orm: OrgOpsDrizzleDb;
  jsonResponse: (c: any, data: unknown, status?: number) => Response;
  requireRunnerAuth: (c: any, next: any) => Response | Promise<Response>;
};

function parseMetadataSafe(input: string | null | undefined): Record<string, unknown> {
  if (!input) return {};
  try {
    const parsed = JSON.parse(input);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function toApiRunner(row: RunnerRecord, onlineThresholdMs: number) {
  const now = Date.now();
  const lastSeenAt = row.last_seen_at ?? 0;
  return {
    id: row.id,
    displayName: row.display_name,
    hostname: row.hostname ?? undefined,
    platform: row.platform ?? undefined,
    arch: row.arch ?? undefined,
    version: row.version ?? undefined,
    metadata: parseMetadataSafe(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt,
    online: now - lastSeenAt <= onlineThresholdMs
  };
}

export function registerRunnersRoutes(app: Hono<any>, deps: RunnersDeps) {
  const { orm, jsonResponse, requireRunnerAuth } = deps;
  const ONLINE_THRESHOLD_MS = Number(
    process.env.ORGOPS_RUNNER_ONLINE_THRESHOLD_MS ?? 15_000
  );

  app.get("/api/runners", (c) => {
    const rows = orm
      .select()
      .from(schema.runnerNodes)
      .orderBy(asc(schema.runnerNodes.display_name))
      .all() as RunnerRecord[];
    return jsonResponse(
      c,
      rows.map((row) => toApiRunner(row, ONLINE_THRESHOLD_MS))
    );
  });

  app.post("/api/runners/register", requireRunnerAuth, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const now = Date.now();
    const requestedId =
      typeof body.existingRunnerId === "string" ? body.existingRunnerId.trim() : "";
    const runnerId = requestedId || randomUUID();
    const displayNameRaw =
      typeof body.displayName === "string" ? body.displayName.trim() : "";
    const displayName = displayNameRaw || `runner-${runnerId.slice(0, 8)}`;
    const hostname =
      typeof body.hostname === "string" && body.hostname.trim()
        ? body.hostname.trim()
        : null;
    const platform =
      typeof body.platform === "string" && body.platform.trim()
        ? body.platform.trim()
        : null;
    const arch =
      typeof body.arch === "string" && body.arch.trim() ? body.arch.trim() : null;
    const version =
      typeof body.version === "string" && body.version.trim()
        ? body.version.trim()
        : null;
    const metadata =
      body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? (body.metadata as Record<string, unknown>)
        : {};

    const existing = orm
      .select()
      .from(schema.runnerNodes)
      .where(eq(schema.runnerNodes.id, runnerId))
      .get() as RunnerRecord | undefined;

    if (existing) {
      orm
        .update(schema.runnerNodes)
        .set({
          display_name: displayName,
          hostname,
          platform,
          arch,
          version,
          metadata_json: JSON.stringify(metadata),
          updated_at: now,
          last_seen_at: now
        })
        .where(eq(schema.runnerNodes.id, runnerId))
        .run();
    } else {
      orm
        .insert(schema.runnerNodes)
        .values({
          id: runnerId,
          display_name: displayName,
          hostname,
          platform,
          arch,
          version,
          metadata_json: JSON.stringify(metadata),
          created_at: now,
          updated_at: now,
          last_seen_at: now
        })
        .run();
    }

    const row = orm
      .select()
      .from(schema.runnerNodes)
      .where(eq(schema.runnerNodes.id, runnerId))
      .get() as RunnerRecord | undefined;
    if (!row) {
      return jsonResponse(c, { error: "Failed to register runner" }, 500);
    }
    return jsonResponse(c, { runner: toApiRunner(row, ONLINE_THRESHOLD_MS) }, 201);
  });

  app.post("/api/runners/:id/heartbeat", requireRunnerAuth, (c) => {
    const runnerId = c.req.param("id");
    const now = Date.now();
    const row = orm
      .select()
      .from(schema.runnerNodes)
      .where(eq(schema.runnerNodes.id, runnerId))
      .get() as RunnerRecord | undefined;
    if (!row) {
      return jsonResponse(c, { error: "Runner not found" }, 404);
    }
    orm
      .update(schema.runnerNodes)
      .set({
        updated_at: now,
        last_seen_at: now
      })
      .where(eq(schema.runnerNodes.id, runnerId))
      .run();
    return jsonResponse(c, { ok: true });
  });
}
