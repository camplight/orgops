import type { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { schema, type OrgOpsDrizzleDb } from "@orgops/db";
import type { RequestUser } from "./access";

type NwaveRunsDeps = {
  orm: OrgOpsDrizzleDb;
  jsonResponse: (c: unknown, data: unknown, status?: number) => Response;
  access: {
    canSignOffGuardrail: (user: RequestUser | undefined) => boolean;
  };
};

type NwaveRunRow = {
  id: string;
  ticket_ref: string;
  channel_id: string;
  status: string;
  current_wave: string | null;
  restatement_text: string;
  confirmed_at: number | null;
  started_at: number | null;
  ended_at: number | null;
  failure_reason: string | null;
};

type NwaveRunWaveRow = {
  id: string;
  run_id: string;
  wave_name: string;
  sequence: number;
  process_id: string | null;
  status: string;
  started_at: number | null;
  ended_at: number | null;
  exit_code: number | null;
};

function toRunResponse(row: NwaveRunRow) {
  return {
    id: row.id,
    ticketRef: row.ticket_ref,
    channelId: row.channel_id,
    status: row.status,
    currentWave: row.current_wave,
    restatementText: row.restatement_text,
    confirmedAt: row.confirmed_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    failureReason: row.failure_reason,
  };
}

function toWaveResponse(row: NwaveRunWaveRow) {
  return {
    id: row.id,
    runId: row.run_id,
    waveName: row.wave_name,
    sequence: row.sequence,
    processId: row.process_id,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    exitCode: row.exit_code,
  };
}

function generateRunId(): string {
  return `RUN-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

function notImplemented(label: string) {
  return async () => {
    throw new Error(`${label} not implemented`);
  };
}

/**
 * Mirrors the DISCUSS/DESIGN/DISTILL/DELIVER chain order owned by
 * `apps/agent-runner/src/nwave-invocation/types.ts`'s `WAVE_SEQUENCE` — duplicated here (a
 * small DTO-level constant, not domain logic) because this HTTP layer must not import from the
 * separately-deployed agent-runner container (see brief.md C4 Container diagram: API and Agent
 * Runner are distinct containers, not one importable module graph).
 */
const WAVE_ORDER = ["DISCUSS", "DESIGN", "DISTILL", "DELIVER"] as const;

function nextWaveName(waveName: string): string | null {
  const currentIndex = WAVE_ORDER.indexOf(waveName as (typeof WAVE_ORDER)[number]);
  if (currentIndex === -1) return null;
  return WAVE_ORDER[currentIndex + 1] ?? null;
}

/**
 * Best-effort process stop for the wave's tracked `process_id`, mirroring the same
 * SIGTERM-first approach `DELETE /api/processes/:id` already uses (apps/api/src/routes/
 * runtime.ts). If no matching `processes` row is tracked (e.g. a lightweight local process
 * that never registered itself, as this track's walking-skeleton `shellStart` adapter does),
 * this is a no-op — halting the run must never fail because the underlying process bookkeeping
 * is incomplete.
 */
function stopTrackedProcess(orm: OrgOpsDrizzleDb, processId: string | null): void {
  if (!processId) return;

  const processRow = orm
    .select({
      id: schema.processes.id,
      pid: schema.processes.pid,
      state: schema.processes.state,
    })
    .from(schema.processes)
    .where(eq(schema.processes.id, processId))
    .get() as { id: string; pid: number | null; state: string } | undefined;
  if (!processRow) return;

  const isActive = processRow.state === "RUNNING" || processRow.state === "STARTING";
  if (!isActive) return;

  if (processRow.pid !== null && processRow.pid !== undefined) {
    try {
      process.kill(processRow.pid, "SIGTERM");
    } catch {
      // Best-effort: the OS process may already have exited.
    }
  }

  orm
    .update(schema.processes)
    .set({ state: "TERMINATED", ended_at: Date.now() })
    .where(eq(schema.processes.id, processId))
    .run();
}

/**
 * Base routes owned by THIS track (nwave-invocation-engine, US-04) — see brief.md "Data
 * Model" -> "New API routes". `createRun`/`confirmRun`/wave-lifecycle routes below are the
 * real RunRepositoryPort contract this track's Wave Runner/Wave Progress Translator/Run
 * Watchdog components call through HttpRunRepository (apps/agent-runner/src/nwave-invocation/
 * http-run-repository.ts). RED scaffold only — every handler throws; DELIVER wave implements
 * each one behind its own failing acceptance test, one scenario at a time (Mandate 5).
 *
 * The seven handlers further below (`completion-summary/*`, `retry`, `escalate`, `close`,
 * `cycle-history`) remain a PREREQUISITE SCAFFOLD owned by `multi-source-ingestion-governance`
 * (US-12/US-13) — not touched by this track's DISTILL pass beyond this file-level doc comment
 * update, per that track's own distill/wave-decisions.md DWD-02.
 */
export function registerNwaveRunsRoutes(app: Hono<any>, deps: NwaveRunsDeps) {
  const { orm, jsonResponse } = deps;

  app.post("/api/nwave-runs", async (c) => {
    const body = await c.req.json();
    const ticketRef = typeof body.ticketRef === "string" ? body.ticketRef.trim() : "";
    if (!ticketRef) return jsonResponse(c, { error: "ticketRef is required" }, 400);
    const channelId = typeof body.channelId === "string" ? body.channelId.trim() : "";
    if (!channelId) return jsonResponse(c, { error: "channelId is required" }, 400);
    if (typeof body.restatementText !== "string") {
      return jsonResponse(c, { error: "restatementText is required" }, 400);
    }
    const restatementText = body.restatementText;

    const id = generateRunId();
    orm
      .insert(schema.nwaveRuns)
      .values({
        id,
        ticket_ref: ticketRef,
        channel_id: channelId,
        status: "PENDING_CONFIRMATION",
        current_wave: null,
        restatement_text: restatementText,
        confirmed_at: null,
        started_at: null,
        ended_at: null,
        failure_reason: null,
      })
      .run();

    const row = orm
      .select()
      .from(schema.nwaveRuns)
      .where(eq(schema.nwaveRuns.id, id))
      .get() as NwaveRunRow;
    return jsonResponse(c, toRunResponse(row), 201);
  });

  app.post("/api/nwave-runs/:id/confirm", async (c) => {
    const runId = c.req.param("id");
    const existing = orm
      .select()
      .from(schema.nwaveRuns)
      .where(eq(schema.nwaveRuns.id, runId))
      .get() as NwaveRunRow | undefined;
    if (!existing) return jsonResponse(c, { error: "Run not found" }, 404);

    orm
      .update(schema.nwaveRuns)
      .set({ status: "STARTING", confirmed_at: Date.now() })
      .where(eq(schema.nwaveRuns.id, runId))
      .run();

    const row = orm
      .select()
      .from(schema.nwaveRuns)
      .where(eq(schema.nwaveRuns.id, runId))
      .get() as NwaveRunRow;
    return jsonResponse(c, toRunResponse(row), 200);
  });

  app.post("/api/nwave-runs/:id/waves", async (c) => {
    const runId = c.req.param("id");
    const existingRun = orm
      .select()
      .from(schema.nwaveRuns)
      .where(eq(schema.nwaveRuns.id, runId))
      .get() as NwaveRunRow | undefined;
    if (!existingRun) return jsonResponse(c, { error: "Run not found" }, 404);

    const body = await c.req.json();
    const waveName = typeof body.waveName === "string" ? body.waveName : "";
    if (!waveName) return jsonResponse(c, { error: "waveName is required" }, 400);
    const sequence = Number.isInteger(body.sequence) ? (body.sequence as number) : null;
    if (sequence === null) return jsonResponse(c, { error: "sequence is required" }, 400);
    const processId = typeof body.processId === "string" ? body.processId : "";
    if (!processId) return jsonResponse(c, { error: "processId is required" }, 400);

    const waveId = randomUUID();
    const now = Date.now();
    orm
      .insert(schema.nwaveRunWaves)
      .values({
        id: waveId,
        run_id: runId,
        wave_name: waveName,
        sequence,
        process_id: processId,
        status: "RUNNING",
        started_at: now,
        ended_at: null,
        exit_code: null,
      })
      .run();

    orm
      .update(schema.nwaveRuns)
      .set({
        status: "RUNNING",
        current_wave: waveName,
        started_at: existingRun.started_at ?? now,
      })
      .where(eq(schema.nwaveRuns.id, runId))
      .run();

    const row = orm
      .select()
      .from(schema.nwaveRunWaves)
      .where(eq(schema.nwaveRunWaves.id, waveId))
      .get() as NwaveRunWaveRow;
    return jsonResponse(c, toWaveResponse(row), 201);
  });

  app.post("/api/nwave-runs/:id/waves/:waveId/complete", async (c) => {
    const runId = c.req.param("id");
    const waveId = c.req.param("waveId");

    const existingRun = orm
      .select()
      .from(schema.nwaveRuns)
      .where(eq(schema.nwaveRuns.id, runId))
      .get() as NwaveRunRow | undefined;
    if (!existingRun) return jsonResponse(c, { error: "Run not found" }, 404);

    const existingWave = orm
      .select()
      .from(schema.nwaveRunWaves)
      .where(eq(schema.nwaveRunWaves.id, waveId))
      .get() as NwaveRunWaveRow | undefined;
    if (!existingWave || existingWave.run_id !== runId) {
      return jsonResponse(c, { error: "Wave not found" }, 404);
    }

    // Idempotency guard (US-04 AC5, at-least-once redelivery): a wave already recorded as
    // COMPLETED/FAILED/HALTED is a no-op — keyed off the wave's own recorded status, never a
    // separate dedup table. The run is never advanced a second time for the same wave.
    if (existingWave.status !== "RUNNING") {
      return jsonResponse(c, toWaveResponse(existingWave), 200);
    }

    const body = await c.req.json();
    const exitCode = Number.isInteger(body.exitCode) ? (body.exitCode as number) : null;
    if (exitCode === null) return jsonResponse(c, { error: "exitCode is required" }, 400);
    const failureReason = typeof body.failureReason === "string" ? body.failureReason : null;

    const now = Date.now();
    const outcome = exitCode === 0 ? "COMPLETED" : "FAILED";

    orm
      .update(schema.nwaveRunWaves)
      .set({ status: outcome, ended_at: now, exit_code: exitCode })
      .where(eq(schema.nwaveRunWaves.id, waveId))
      .run();

    if (outcome === "FAILED") {
      orm
        .update(schema.nwaveRuns)
        .set({
          status: "FAILED",
          ended_at: now,
          failure_reason:
            failureReason ?? `${existingWave.wave_name} exited with code ${exitCode}`,
        })
        .where(eq(schema.nwaveRuns.id, runId))
        .run();
    } else {
      const next = nextWaveName(existingWave.wave_name);
      if (next === null) {
        orm
          .update(schema.nwaveRuns)
          .set({ status: "COMPLETED", ended_at: now, current_wave: null })
          .where(eq(schema.nwaveRuns.id, runId))
          .run();
      } else {
        orm
          .update(schema.nwaveRuns)
          .set({ current_wave: next })
          .where(eq(schema.nwaveRuns.id, runId))
          .run();
      }
    }

    const updatedWave = orm
      .select()
      .from(schema.nwaveRunWaves)
      .where(eq(schema.nwaveRunWaves.id, waveId))
      .get() as NwaveRunWaveRow;
    return jsonResponse(c, toWaveResponse(updatedWave), 200);
  });

  app.post("/api/nwave-runs/:id/halt", async (c) => {
    const runId = c.req.param("id");
    const existingRun = orm
      .select()
      .from(schema.nwaveRuns)
      .where(eq(schema.nwaveRuns.id, runId))
      .get() as NwaveRunRow | undefined;
    if (!existingRun) return jsonResponse(c, { error: "Run not found" }, 404);

    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    const reason = typeof body.reason === "string" ? body.reason : null;

    const activeWaves = orm
      .select()
      .from(schema.nwaveRunWaves)
      .where(
        and(eq(schema.nwaveRunWaves.run_id, runId), eq(schema.nwaveRunWaves.status, "RUNNING")),
      )
      .all() as NwaveRunWaveRow[];

    const now = Date.now();
    for (const activeWave of activeWaves) {
      stopTrackedProcess(orm, activeWave.process_id);
      orm
        .update(schema.nwaveRunWaves)
        .set({ status: "HALTED", ended_at: now })
        .where(eq(schema.nwaveRunWaves.id, activeWave.id))
        .run();
    }

    orm
      .update(schema.nwaveRuns)
      .set({
        status: "HALTED",
        ended_at: now,
        current_wave: null,
        failure_reason: reason ?? existingRun.failure_reason,
      })
      .where(eq(schema.nwaveRuns.id, runId))
      .run();

    const updatedRun = orm
      .select()
      .from(schema.nwaveRuns)
      .where(eq(schema.nwaveRuns.id, runId))
      .get() as NwaveRunRow;
    return jsonResponse(c, toRunResponse(updatedRun), 200);
  });

  app.get("/api/nwave-runs/:id", async (c) => {
    const runId = c.req.param("id");
    const runRow = orm
      .select()
      .from(schema.nwaveRuns)
      .where(eq(schema.nwaveRuns.id, runId))
      .get() as NwaveRunRow | undefined;
    if (!runRow) return jsonResponse(c, { error: "Run not found" }, 404);

    const waveRows = orm
      .select()
      .from(schema.nwaveRunWaves)
      .where(eq(schema.nwaveRunWaves.run_id, runId))
      .orderBy(asc(schema.nwaveRunWaves.sequence))
      .all() as NwaveRunWaveRow[];

    return jsonResponse(c, {
      ...toRunResponse(runRow),
      waves: waveRows.map(toWaveResponse),
    });
  });

  app.post(
    "/api/nwave-runs/:id/completion-summary/approve",
    notImplemented(
      "POST /api/nwave-runs/:id/completion-summary/approve — only valid when " +
        "approval_status === PENDING, never GOVERNANCE_HOLD, enforced server-side (US-12 AC4)",
    ),
  );

  app.post(
    "/api/nwave-runs/:id/completion-summary/request-changes",
    notImplemented(
      "POST /api/nwave-runs/:id/completion-summary/request-changes — valid when " +
        "approval_status is PENDING or GOVERNANCE_HOLD; always calls createFollowOnRun with " +
        "cycleReason=CHANGES_REQUESTED, never RETRY (US-12 AC3, ADR-0011)",
    ),
  );

  app.post(
    "/api/nwave-runs/:id/completion-summary/governance-signoff",
    notImplemented(
      "POST /api/nwave-runs/:id/completion-summary/governance-signoff — governance-team-only " +
        "(canSignOffGuardrail); transitions GOVERNANCE_HOLD to PENDING (US-12 AC4)",
    ),
  );

  app.post(
    "/api/nwave-runs/:id/retry",
    notImplemented(
      "POST /api/nwave-runs/:id/retry — only valid when retry_available=true on the run's " +
        "completion row (US-13 AC5)",
    ),
  );

  app.post(
    "/api/nwave-runs/:id/escalate",
    notImplemented(
      "POST /api/nwave-runs/:id/escalate — sets tickets.resolution_status=ESCALATED and " +
        "nwave_runs.escalated_at, posts to the governance team with cycle-history context " +
        "(US-13 AC5)",
    ),
  );

  app.post(
    "/api/nwave-runs/:id/close",
    notImplemented(
      "POST /api/nwave-runs/:id/close — sets tickets.resolution_status=CLOSED",
    ),
  );

  app.get(
    "/api/nwave-runs/:id/cycle-history",
    notImplemented(
      "GET /api/nwave-runs/:id/cycle-history — walks the previous_run_id chain backward, " +
        "surfacing every prior attempt's outcome/failure-reason/completion-summary (US-13 AC5)",
    ),
  );
}
