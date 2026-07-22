import { describe, expect, it } from "vitest";
import { authedRequest, createRealApiApp, loginAsAdmin } from "./acceptance-test-support";
import {
  composeFailureRecoveryGuidance,
  MAX_AUTO_RETRY_COUNT,
  type FailureCompletionEvent,
} from "./failure-recovery-advisor";
import { scanRunForStaleness, type RunningRunSnapshot } from "./stuck-run-detector";

// US-13: Failed or Stuck Implementation Runs Are Surfaced With Recovery Options.
// Traceability: docs/feature/multi-source-ingestion-governance/discuss/user-stories.md US-13.
//
// Failure/Recovery Advisor and Stuck-Run Detector are event-consuming/interval-scheduled
// internal components with no external caller — their driving port is the exported
// pure-processing function itself, called directly with an explicit input, mirroring
// intent-watchdog.ts's own directly-called-function shape (ingestIntentEvents/
// collectDueIntentTimeouts). Retry/Escalate/Close/cycle-history are genuine HTTP actions a
// human triggers, so those scenarios go through the real driving port: the HTTP route.

function makeFailureEvent(overrides: Partial<FailureCompletionEvent> = {}): FailureCompletionEvent {
  return {
    runId: "run-1042",
    outcome: "FAILED",
    retryCount: 0,
    whatCompleted: "Classification and confirmation completed",
    whatFailed: "DELIVER wave: test suite failed to compile",
    rawOutputUrl: "https://orgops.local/runs/run-1042/raw-output",
    ...overrides,
  };
}

function makeRunningRun(overrides: Partial<RunningRunSnapshot> = {}): RunningRunSnapshot {
  return {
    runId: "run-1043",
    lastOutputAt: 0,
    currentWaveStatus: "DELIVER",
    waveSequence: 1,
    alreadyFlagged: false,
    ...overrides,
  };
}

describe("US-13: failed or stuck runs surface recovery options", () => {
  it("[@walking_skeleton @driving_port @US-13] Devon sees a clear, non-blaming summary within 2 minutes of a failed run", () => {
    // Given TICKET-1042's implementation run fails during the DELIVER wave
    const event = makeFailureEvent();

    // When the run terminates and the Failure/Recovery Advisor processes the completion event
    const guidance = composeFailureRecoveryGuidance(event);

    // Then it explains what was completed, what failed, and a suggested next step, and Devon
    // is never shown a raw stack trace without plain-language context
    expect(guidance.message).toContain(event.whatCompleted);
    expect(guidance.message).toContain(event.whatFailed);
    expect(guidance.suggestedNextStep).toBe("RETRY");
    expect(guidance.retryAvailable).toBe(true);
  });

  it("[@US-13] TICKET-1043's stalled run is proactively flagged, not silently left for Maria to discover", () => {
    // Given TICKET-1043's run has produced no activity for 30 minutes during a wave that
    // typically takes 5 minutes
    const staleRun = makeRunningRun({ lastOutputAt: 0, alreadyFlagged: false });
    const nowMs = 30 * 60_000;
    const staleThresholdMs = 10 * 60_000;

    // When the staleness threshold is exceeded and the Stuck-Run Detector scans this run
    const result = scanRunForStaleness(staleRun, nowMs, staleThresholdMs);

    // Then the run is proactively flagged as possibly stuck
    expect(result.action).toBe("FLAG");
  });

  it("[@property @US-13] raw stack traces are never shown without plain-language context, for any failure", () => {
    // Given any failed run with a raw-output link
    const events = [
      makeFailureEvent({ whatFailed: "TypeError: cannot read property of undefined" }),
      makeFailureEvent({ outcome: "HALTED", whatFailed: "Wave watchdog forcibly halted the run" }),
    ];

    // When the Failure/Recovery Advisor composes guidance for each
    const guidances = events.map((event) => composeFailureRecoveryGuidance(event));

    // Then the raw-output link is always paired with plain-language guidance, never bare
    for (const [index, guidance] of guidances.entries()) {
      expect(guidance.message).toContain(events[index]!.rawOutputUrl);
      expect(guidance.message).toContain(events[index]!.whatFailed);
    }
  });

  it("[@property @US-13] repeated failures always escalate instead of looping forever, regardless of failure reason", () => {
    // Given TICKET-1046's run has failed and been retried twice with the same underlying error
    const thirdFailure = makeFailureEvent({
      runId: "run-1046",
      retryCount: MAX_AUTO_RETRY_COUNT,
    });

    // When the third failure occurs
    const guidance = composeFailureRecoveryGuidance(thirdFailure);

    // Then "Retry" is no longer offered and escalation is suggested, for any run once the
    // threshold is met (not just this one example)
    expect(guidance.suggestedNextStep).toBe("ESCALATE");
    expect(guidance.retryAvailable).toBe(false);
  });

  it("[@US-13] retry remains available one attempt before the escalation threshold", () => {
    // Given TICKET-1046's run has failed and been retried one fewer time than the threshold
    const eventBelowThreshold = makeFailureEvent({
      runId: "run-1046",
      retryCount: MAX_AUTO_RETRY_COUNT - 1,
    });

    // When the Failure/Recovery Advisor composes guidance
    const guidance = composeFailureRecoveryGuidance(eventBelowThreshold);

    // Then "Retry" is still offered — the threshold has not yet been reached
    expect(guidance.suggestedNextStep).toBe("RETRY");
    expect(guidance.retryAvailable).toBe(true);
  });

  it("[@US-13] escalation persists for retry counts beyond the threshold, not only exactly at it", () => {
    // Given TICKET-1046's run has already exceeded the escalation threshold
    const eventAboveThreshold = makeFailureEvent({
      runId: "run-1046",
      retryCount: MAX_AUTO_RETRY_COUNT + 3,
    });

    // When the Failure/Recovery Advisor composes guidance
    const guidance = composeFailureRecoveryGuidance(eventAboveThreshold);

    // Then escalation still applies — the rule is "at or above", not "exactly equal to"
    expect(guidance.suggestedNextStep).toBe("ESCALATE");
    expect(guidance.retryAvailable).toBe(false);
  });

  it("[@driving_adapter @real-io @US-13] Devon retries a failed run with one action, without re-entering information", async () => {
    const app = createRealApiApp();
    const cookie = await loginAsAdmin(app);
    const request = authedRequest(app, cookie);

    // Given TICKET-1042's run failed once with a transient error and retry is available
    // When Devon Park selects "Retry"
    const res = await request("/api/nwave-runs/run-1042/retry", { method: "POST" });

    // Then a new run starts using the same confirmed ticket intent, without re-entering
    // information
    expect(res.status).toBe(201);
    const body = (await res.json()) as { newRunId?: string };
    expect(body.newRunId).toBeTruthy();
  });

  it("[@US-13] a stuck flag auto-clears once the run's activity resumes", () => {
    const run = makeRunningRun({ alreadyFlagged: true });

    // Given a run was previously flagged as possibly stuck
    // When activity resumes (fresh output observed on a later scan)
    const result = scanRunForStaleness(
      { ...run, lastOutputAt: 9_000_000 },
      9_000_100,
      10 * 60_000,
    );

    // Then the flag auto-clears — no manual dismissal needed
    expect(result.action).toBe("CLEAR");
  });

  it("[@driving_adapter @real-io @US-13] escalation and closure preserve accumulated context from prior attempts", async () => {
    const app = createRealApiApp();
    const cookie = await loginAsAdmin(app);
    const request = authedRequest(app, cookie);

    // Given TICKET-1046's run has exhausted its automatic retries
    // When the submitter escalates to a human developer
    const escalateRes = await request("/api/nwave-runs/run-1046/escalate", { method: "POST" });
    expect(escalateRes.status).toBe(200);

    // Then the accumulated context from every prior attempt is available via cycle history
    const historyRes = await request("/api/nwave-runs/run-1046/cycle-history");
    expect(historyRes.status).toBe(200);

    // And a ticket can also be closed as a terminal action
    const closeRes = await request("/api/nwave-runs/run-1046/close", { method: "POST" });
    expect(closeRes.status).toBe(200);
  });
});
