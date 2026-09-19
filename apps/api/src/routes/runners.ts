import type { Hono } from "hono";
import { asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { schema, type OrgOpsDrizzleDb } from "@orgops/db";
import type { EventBus } from "@orgops/event-bus";
import {
  findActiveRunnerTokenByToken,
  generateRunnerScopedToken,
} from "../agent-invite-auth";

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
  bus: EventBus<any>;
  jsonResponse: (c: any, data: unknown, status?: number) => Response;
  requireAuth: (c: any, next: any) => Response | Promise<Response>;
  requireRunnerAuth: (c: any, next: any) => Response | Promise<Response>;
  runnerToken: string;
  runnerApiUrl: string;
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
  const { orm, bus, jsonResponse, requireAuth, requireRunnerAuth, runnerToken, runnerApiUrl } = deps;
  const ONLINE_THRESHOLD_MS = Number(
    process.env.ORGOPS_RUNNER_ONLINE_THRESHOLD_MS ?? 15_000
  );
  const publishDashboardRefresh = (reason: string, meta?: Record<string, unknown>) => {
    bus.publish("org:dashboard", {
      type: "dashboard_refresh",
      topic: "org:dashboard",
      data: {
        reason,
        ...(meta ?? {})
      }
    });
  };

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

  app.get("/api/runners/setup-config", (c) => {
    const user = (c as any).get("user") as { username?: string } | undefined;
    if (!user?.username || user.username === "runner") {
      return jsonResponse(c, { error: "Authenticated human user required" }, 401);
    }
    return jsonResponse(c, { runnerToken, runnerApiUrl });
  });

  app.post("/api/runners/invites", requireAuth, async (c) => {
    const user = (c as any).get("user") as { id?: string; username?: string } | undefined;
    if (!user?.id || !user?.username || user.username === "runner") {
      return jsonResponse(c, { error: "Authenticated human user required" }, 401);
    }
    const body = await c.req.json().catch(() => ({}));
    const now = Date.now();
    const expiresInHoursRaw = Number((body as Record<string, unknown>).expiresInHours ?? 24);
    const expiresInHours = Number.isFinite(expiresInHoursRaw)
      ? Math.max(1, Math.min(24 * 30, Math.floor(expiresInHoursRaw)))
      : 24;
    const expiresAt = now + expiresInHours * 60 * 60 * 1000;
    const runnerId = randomUUID();
    const generated = generateRunnerScopedToken();
    const inviteNameRaw =
      typeof (body as Record<string, unknown>).name === "string"
        ? (body as Record<string, string>).name.trim()
        : "";
    const inviteName = inviteNameRaw || `runner-invite-${runnerId.slice(0, 8)}`;
    orm
      .insert(schema.runnerTokens)
      .values({
        id: randomUUID(),
        name: inviteName,
        token_hash: generated.hash,
        token_prefix: generated.prefix,
        allowed_agent_name: null,
        allowed_runner_id: runnerId,
        allowed_channel_ids_json: "[]",
        allow_channel_expansion: 0,
        runner_scope_mode: "SCOPED",
        invite_id: null,
        created_by_human_id: user.id,
        created_at: now,
        expires_at: expiresAt,
        last_used_at: null,
        revoked_at: null,
      })
      .run();
    const base = runnerApiUrl.replace(/\/+$/, "");
    const inviteUrl = `${base}/api/runners/invites/${encodeURIComponent(generated.token)}`;
    return jsonResponse(
      c,
      {
        ok: true,
        invite: {
          name: inviteName,
          runnerId,
          tokenPrefix: generated.prefix,
          expiresAt,
          inviteUrl,
        },
        bootstrap: {
          apiBaseUrl: base,
          runnerNameHint: `runner-${runnerId.slice(0, 8)}`,
        },
      },
      201
    );
  });

  app.get("/api/runners/invites/:token", (c) => {
    const token = c.req.param("token");
    const row = findActiveRunnerTokenByToken(orm, token);
    if (!row) return jsonResponse(c, { error: "Invite not found or expired" }, 404);
    if (row.runner_scope_mode !== "SCOPED" || !row.allowed_runner_id) {
      return jsonResponse(c, { error: "Invite token is not scoped for bootstrap" }, 400);
    }
    return jsonResponse(c, {
      ok: true,
      bootstrap: {
        apiBaseUrl: runnerApiUrl.replace(/\/+$/, ""),
        runnerToken: token,
        runnerId: row.allowed_runner_id ?? undefined,
      },
    });
  });

  app.post("/api/runners/register", requireRunnerAuth, async (c) => {
    const user = (c as any).get("user") as
      | { runnerScope?: { mode?: string; allowedRunnerId?: string } }
      | undefined;
    const scopedRunnerId =
      user?.runnerScope?.mode === "SCOPED"
        ? user.runnerScope.allowedRunnerId?.trim() ?? ""
        : "";
    const body = await c.req.json().catch(() => ({}));
    const now = Date.now();
    const requestedId =
      typeof body.existingRunnerId === "string" ? body.existingRunnerId.trim() : "";
    if (scopedRunnerId && requestedId && requestedId !== scopedRunnerId) {
      return jsonResponse(c, { error: "Forbidden runner id for token scope" }, 403);
    }
    const runnerId = scopedRunnerId || requestedId || randomUUID();
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
    publishDashboardRefresh("runner.registered", { runnerId });
    return jsonResponse(c, { runner: toApiRunner(row, ONLINE_THRESHOLD_MS) }, 201);
  });

  app.post("/api/runners/:id/heartbeat", requireRunnerAuth, (c) => {
    const user = (c as any).get("user") as
      | { runnerScope?: { mode?: string; allowedRunnerId?: string } }
      | undefined;
    const scopedRunnerId =
      user?.runnerScope?.mode === "SCOPED"
        ? user.runnerScope.allowedRunnerId?.trim() ?? ""
        : "";
    const runnerId = c.req.param("id");
    if (scopedRunnerId && runnerId !== scopedRunnerId) {
      return jsonResponse(c, { error: "Forbidden runner id for token scope" }, 403);
    }
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
    publishDashboardRefresh("runner.heartbeat", { runnerId });
    return jsonResponse(c, { ok: true });
  });

  app.delete("/api/runners/:id", (c) => {
    const runnerId = c.req.param("id");
    const row = orm
      .select()
      .from(schema.runnerNodes)
      .where(eq(schema.runnerNodes.id, runnerId))
      .get() as RunnerRecord | undefined;
    if (!row) {
      return jsonResponse(c, { error: "Runner not found" }, 404);
    }

    const assignedAgents = orm
      .select({ name: schema.agents.name })
      .from(schema.agents)
      .where(eq(schema.agents.assigned_runner_id, runnerId))
      .all() as Array<{ name: string }>;

    orm
      .update(schema.agents)
      .set({
        assigned_runner_id: null,
        updated_at: Date.now()
      })
      .where(eq(schema.agents.assigned_runner_id, runnerId))
      .run();

    orm.delete(schema.runnerNodes).where(eq(schema.runnerNodes.id, runnerId)).run();
    publishDashboardRefresh("runner.deregistered", { runnerId });

    return jsonResponse(c, {
      ok: true,
      unassignedAgents: assignedAgents.map((agent) => agent.name)
    });
  });
}
