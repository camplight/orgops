import type { Hono } from "hono";
import { asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { schema, type OrgOpsDrizzleDb } from "@orgops/db";
import type { EventBus } from "@orgops/event-bus";
import { DeploymentReportSchema, type CatalogLibraryErrorCode, type RunnerArtifactDelivery, type RunnerStartGateDelivery } from "@orgops/schemas";
import { RunnerDeliveryError } from "../catalog-library/runner-delivery";
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
  runnerArtifactDelivery?: RunnerArtifactDelivery;
  runnerStartGateDelivery?: RunnerStartGateDelivery;
};

const runnerErrorStatus: Partial<Record<CatalogLibraryErrorCode, number>> = {
  INVALID_REQUEST: 400, PAYLOAD_TOO_LARGE: 413, FORBIDDEN: 403, NOT_FOUND: 404,
  REVISION_CONFLICT: 409, STATE_CONFLICT: 409, DEPLOYMENT_SUPERSEDED: 409,
  INSPECTION_FAILED: 422, STORAGE_FAILURE: 500,
};
const runnerErrorMessage: Partial<Record<CatalogLibraryErrorCode, string>> = {
  INVALID_REQUEST: "Invalid catalog library request", PAYLOAD_TOO_LARGE: "Catalog library request too large",
  FORBIDDEN: "Administrator access required", NOT_FOUND: "Catalog library resource not found",
  REVISION_CONFLICT: "Catalog library changed; reload metadata", STATE_CONFLICT: "Catalog library operation conflicts with current state",
  DEPLOYMENT_SUPERSEDED: "Runner deployment was superseded", INSPECTION_FAILED: "Package inspection failed; last-known-good content is unchanged",
  STORAGE_FAILURE: "Catalog library operation failed",
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
  const { orm, bus, jsonResponse, requireAuth, requireRunnerAuth, runnerToken, runnerApiUrl, runnerArtifactDelivery, runnerStartGateDelivery } = deps;
  const ONLINE_THRESHOLD_MS = Number(
    process.env.ORGOPS_RUNNER_ONLINE_THRESHOLD_MS ?? 15_000
  );
  const requireHumanUser = (c: any) => {
    const user = (c as any).get("user") as { id?: string; username?: string } | undefined;
    if (!user?.id || !user?.username || user.username === "runner") {
      return null;
    }
    return user;
  };
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

  app.use("/api/runners/:runnerId/package-deployments", async (c, next) => { c.header("Cache-Control", "no-store"); await next(); });
  app.use("/api/runners/:runnerId/agents/:agentName/start-requirements", async (c, next) => { c.header("Cache-Control", "no-store"); await next(); });
  app.use("/api/runner-package-deployments/*", async (c, next) => { c.header("Cache-Control", "no-store"); await next(); });

  const hasQuery = (c: any) => new URL(c.req.url).search.length > 0;
  const deliveryContext = (c: any, explicitRunnerId?: string) => {
    const user = c.get("user") as { runnerScope?: { mode?: string; allowedRunnerId?: string; allowedAgentName?: string } } | undefined;
    const scope = user?.runnerScope;
    const runnerId = explicitRunnerId ?? c.req.header("x-orgops-runner-id")?.trim() ?? "";
    if (!scope || !runnerId) return { ok: false as const, status: 400 };
    if (scope.mode === "SCOPED" && scope.allowedRunnerId !== runnerId) return { ok: false as const, status: 403 };
    return { ok: true as const, value: { runnerId, ...(scope.mode === "SCOPED" && scope.allowedAgentName
      ? { allowedAgentName: scope.allowedAgentName } : {}) } };
  };
  const deliveryFailure = (c: any, error: unknown) => {
    const code = error instanceof RunnerDeliveryError ? error.code : "STORAGE_FAILURE";
    return c.json({ error: runnerErrorMessage[code] ?? runnerErrorMessage.STORAGE_FAILURE, code }, (runnerErrorStatus[code] ?? 500) as never);
  };
  const startRequirementsForbidden = (c: any) => c.json({ error: "Forbidden", code: "FORBIDDEN" }, 403);
  const readReport = async (c: any) => {
    if (c.req.header("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json" || !c.req.raw.body) return { ok: false as const, code: "INVALID_REQUEST" as const };
    const reader = c.req.raw.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
        if (size > 16 * 1024) { try { await reader.cancel(); } catch { /* bounded rejection */ } return { ok: false as const, code: "PAYLOAD_TOO_LARGE" as const }; }
        chunks.push(value); }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const parsed = DeploymentReportSchema.safeParse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
      return parsed.success ? { ok: true as const, value: parsed.data } : { ok: false as const, code: "INVALID_REQUEST" as const };
    } catch { return { ok: false as const, code: "INVALID_REQUEST" as const }; }
  };

  app.get("/api/runners/:runnerId/agents/:agentName/start-requirements", requireRunnerAuth, async c => {
    if (hasQuery(c) || c.req.raw.body !== null || !runnerStartGateDelivery) {
      return deliveryFailure(c, new RunnerDeliveryError(!runnerStartGateDelivery ? "STORAGE_FAILURE" : "INVALID_REQUEST"));
    }
    const context = deliveryContext(c, c.req.param("runnerId"));
    if (!context.ok) return context.status === 403 ? startRequirementsForbidden(c) : deliveryFailure(c, new RunnerDeliveryError("INVALID_REQUEST"));
    try {
      return c.json(await runnerStartGateDelivery.getStartRequirements({ ...context.value, agentName: c.req.param("agentName") }));
    } catch (error) {
      return error instanceof RunnerDeliveryError && error.code === "FORBIDDEN"
        ? startRequirementsForbidden(c) : deliveryFailure(c, error);
    }
  });

  app.get("/api/runners/:runnerId/package-deployments", requireRunnerAuth, async c => {
    if (hasQuery(c) || !runnerArtifactDelivery) return deliveryFailure(c, new RunnerDeliveryError(hasQuery(c) ? "INVALID_REQUEST" : "STORAGE_FAILURE"));
    const context = deliveryContext(c, c.req.param("runnerId"));
    if (!context.ok) return context.status === 403 ? c.json({ error: "Forbidden runner id for token scope" }, 403) : deliveryFailure(c, new RunnerDeliveryError("INVALID_REQUEST"));
    try { return c.json(await runnerArtifactDelivery.poll(context.value)); } catch (error) { return deliveryFailure(c, error); }
  });

  app.post("/api/runner-package-deployments/:deploymentId/claim", requireRunnerAuth, async c => {
    if (hasQuery(c) || c.req.raw.body !== null || !runnerArtifactDelivery) return deliveryFailure(c, new RunnerDeliveryError(!runnerArtifactDelivery ? "STORAGE_FAILURE" : "INVALID_REQUEST"));
    const context = deliveryContext(c); if (!context.ok) return context.status === 403 ? c.json({ error: "Forbidden runner id for token scope" }, 403) : deliveryFailure(c, new RunnerDeliveryError("INVALID_REQUEST"));
    try { return c.json(await runnerArtifactDelivery.claim({ ...context.value, deploymentId: c.req.param("deploymentId") })); }
    catch (error) { return deliveryFailure(c, error); }
  });

  app.get("/api/runner-package-deployments/:deploymentId/artifact", requireRunnerAuth, async c => {
    if (hasQuery(c) || !runnerArtifactDelivery) return deliveryFailure(c, new RunnerDeliveryError(!runnerArtifactDelivery ? "STORAGE_FAILURE" : "INVALID_REQUEST"));
    const context = deliveryContext(c); const attemptToken = c.req.header("x-orgops-deployment-attempt-token")?.trim() ?? "";
    if (!context.ok || !attemptToken) return context.ok || context.status !== 403 ? deliveryFailure(c, new RunnerDeliveryError("INVALID_REQUEST")) : c.json({ error: "Forbidden runner id for token scope" }, 403);
    try { return c.json(await runnerArtifactDelivery.getArtifact({ ...context.value, deploymentId: c.req.param("deploymentId"), attemptToken })); }
    catch (error) { return deliveryFailure(c, error); }
  });

  app.post("/api/runner-package-deployments/:deploymentId/report", requireRunnerAuth, async c => {
    if (hasQuery(c) || !runnerArtifactDelivery) return deliveryFailure(c, new RunnerDeliveryError(!runnerArtifactDelivery ? "STORAGE_FAILURE" : "INVALID_REQUEST"));
    const context = deliveryContext(c); const attemptToken = c.req.header("x-orgops-deployment-attempt-token")?.trim() ?? "";
    if (!context.ok || !attemptToken) return context.ok || context.status !== 403 ? deliveryFailure(c, new RunnerDeliveryError("INVALID_REQUEST")) : c.json({ error: "Forbidden runner id for token scope" }, 403);
    const body = await readReport(c); if (!body.ok) return deliveryFailure(c, new RunnerDeliveryError(body.code));
    try { return c.json(await runnerArtifactDelivery.report({ ...context.value, deploymentId: c.req.param("deploymentId"), attemptToken }, body.value)); }
    catch (error) { return deliveryFailure(c, error); }
  });

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
    const user = requireHumanUser(c);
    if (!user) {
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

  app.patch("/api/runners/:id", async (c) => {
    const user = requireHumanUser(c);
    if (!user) {
      return jsonResponse(c, { error: "Authenticated human user required" }, 401);
    }
    const runnerId = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const displayName =
      typeof body.displayName === "string" ? body.displayName.trim() : "";
    if (!displayName) {
      return jsonResponse(c, { error: "displayName is required" }, 400);
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
        display_name: displayName,
        updated_at: now,
      })
      .where(eq(schema.runnerNodes.id, runnerId))
      .run();

    const updated = orm
      .select()
      .from(schema.runnerNodes)
      .where(eq(schema.runnerNodes.id, runnerId))
      .get() as RunnerRecord | undefined;
    if (!updated) {
      return jsonResponse(c, { error: "Failed to update runner" }, 500);
    }

    publishDashboardRefresh("runner.renamed", { runnerId });
    return jsonResponse(c, { runner: toApiRunner(updated, ONLINE_THRESHOLD_MS) });
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

    let assignedAgents: Array<{ name: string; revision: number }>;
    try {
      assignedAgents = orm.$client.transaction(() => {
        const agents = orm.$client.prepare(
          "SELECT name,revision FROM agents WHERE assigned_runner_id=? ORDER BY name",
        ).all(runnerId) as Array<{ name: string; revision: number }>;
        if (agents.some(agent => agent.revision >= 2147483647)) throw new Error("AGENT_REVISION_CONFLICT");
        const updated = orm.$client.prepare(`UPDATE agents SET assigned_runner_id=NULL,updated_at=?,revision=revision+1
          WHERE assigned_runner_id=? AND revision<2147483647`).run(Date.now(), runnerId);
        if (updated.changes !== agents.length) throw new Error("AGENT_REVISION_CONFLICT");
        orm.$client.prepare("DELETE FROM runner_nodes WHERE id=?").run(runnerId);
        return agents;
      })();
    } catch (error) {
      if (error instanceof Error && error.message === "AGENT_REVISION_CONFLICT") {
        return jsonResponse(c, { error: "Agent revision conflict" }, 409);
      }
      throw error;
    }
    publishDashboardRefresh("runner.deregistered", { runnerId });

    return jsonResponse(c, {
      ok: true,
      unassignedAgents: assignedAgents.map((agent) => agent.name)
    });
  });
}
