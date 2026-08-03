import type { Hono } from "hono";
import type { RequestUser } from "./access";

export const __SCAFFOLD__ = true;

type NwaveRunsDeps = {
  orm: unknown;
  jsonResponse: (c: unknown, data: unknown, status?: number) => Response;
  access: {
    canSignOffGuardrail: (user: RequestUser | undefined) => boolean;
  };
};

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
export function registerNwaveRunsRoutes(app: Hono<any>, _deps: NwaveRunsDeps) {
  app.post(
    "/api/nwave-runs",
    notImplemented(
      "POST /api/nwave-runs — creates a run row in PENDING_CONFIRMATION, assigning the " +
        "stable run_id immediately (before any wave process is spawned), returns run_id " +
        "(US-04 AC4)",
    ),
  );

  app.post(
    "/api/nwave-runs/:id/confirm",
    notImplemented(
      "POST /api/nwave-runs/:id/confirm — PENDING_CONFIRMATION -> STARTING, called by Wave " +
        "Runner immediately after createRun once the submitter's confirmation is observed " +
        "(US-04 AC2)",
    ),
  );

  app.post(
    "/api/nwave-runs/:id/waves",
    notImplemented(
      "POST /api/nwave-runs/:id/waves — records a new nwave_run_waves row, linking process_id " +
        "to the shell_start-tracked process for this wave (US-04 core observable contract)",
    ),
  );

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

  app.get(
    "/api/nwave-runs/:id",
    notImplemented(
      "GET /api/nwave-runs/:id — reads the run plus its wave history, consumed later by " +
        "progress-trust-ux (US-04 AC4: every progress message references the same stable " +
        "run_id)",
    ),
  );

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
