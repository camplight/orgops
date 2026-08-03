import type { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
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

  app.post(
    "/api/nwave-runs/:id/waves/:waveId/complete",
    notImplemented(
      "POST /api/nwave-runs/:id/waves/:waveId/complete — marks the wave COMPLETED or FAILED " +
        "depending on exit code, advances or terminates the run (US-04 AC5, ADR-0002); must be " +
        "idempotent under the platform's at-least-once event redelivery guarantee — a " +
        "redelivered completion for an already-COMPLETED/FAILED wave must not advance the run " +
        "a second time",
    ),
  );

  app.post(
    "/api/nwave-runs/:id/halt",
    notImplemented(
      "POST /api/nwave-runs/:id/halt — marks the run (and its active wave) HALTED, called by " +
        "Run Watchdog after shell_stop on a stale wave (US-04, brief.md Failure/Timeout " +
        "Handling)",
    ),
  );

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
