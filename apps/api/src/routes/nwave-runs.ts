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
 * PREREQUISITE SCAFFOLD for the base routes (`nwave_runs`, owned by `nwave-invocation-engine`;
 * `nwave_run_completions`, owned by `progress-trust-ux`) — neither track has reached DELIVER in
 * this codebase yet, so no `/api/nwave-runs/*` route exists at all today. Created here only so
 * multi-source-ingestion-governance's US-12/US-13 acceptance tests have a real HTTP driving
 * port to call. The seven handlers below are the additive EXTENSION this track (US-12/US-13)
 * actually owns (per brief.md "Data Model" -> "New/extended API routes"); no production logic
 * for any of them is implemented here — that is DELIVER-wave, software-crafter's job, driven by
 * these now-RED acceptance tests one at a time.
 */
export function registerNwaveRunsRoutes(app: Hono<any>, _deps: NwaveRunsDeps) {
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
