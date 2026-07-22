export const MAX_AUTO_RETRY_COUNT = 2;

export type FailureCompletionEvent = {
  runId: string;
  outcome: "FAILED" | "HALTED";
  retryCount: number;
  whatCompleted: string;
  whatFailed: string;
  rawOutputUrl: string;
};

export type RecoveryGuidance = {
  message: string;
  suggestedNextStep: "RETRY" | "ESCALATE";
  retryAvailable: boolean;
};

type NextStepDecision = {
  suggestedNextStep: "RETRY" | "ESCALATE";
  retryAvailable: boolean;
};

function decideNextStep(retryCount: number): NextStepDecision {
  const retryExhausted = retryCount >= MAX_AUTO_RETRY_COUNT;

  if (retryExhausted) {
    return { suggestedNextStep: "ESCALATE", retryAvailable: false };
  }

  return { suggestedNextStep: "RETRY", retryAvailable: true };
}

function describeSuggestedAction(decision: NextStepDecision): string {
  return decision.suggestedNextStep === "RETRY"
    ? "Suggested next step: retry the run."
    : "Suggested next step: escalate to a human developer.";
}

function composeGuidanceMessage(
  event: FailureCompletionEvent,
  decision: NextStepDecision,
): string {
  return [
    `What completed: ${event.whatCompleted}.`,
    `What failed: ${event.whatFailed}.`,
    `Raw output: ${event.rawOutputUrl}.`,
    describeSuggestedAction(decision),
  ].join(" ");
}

/**
 * Pure logic (per brief.md "Architecture Enforcement": must not perform fetch/apiFetch calls
 * directly). Consumes progress-trust-ux.completion_summary.posted when outcome is FAILED or
 * HALTED.
 *
 * Always pairs plain-language "what completed / what failed / next step" guidance with the
 * raw-output link — never a bare link (US-13 AC3, satisfied structurally as a composition rule
 * on this function, not a UI-layer convention). Once retryCount >= MAX_AUTO_RETRY_COUNT,
 * suggestedNextStep is ESCALATE and retryAvailable is false — "Retry" is structurally withheld
 * past the threshold (US-13 AC5).
 */
export function composeFailureRecoveryGuidance(event: FailureCompletionEvent): RecoveryGuidance {
  const decision = decideNextStep(event.retryCount);
  const message = composeGuidanceMessage(event, decision);

  return {
    message,
    suggestedNextStep: decision.suggestedNextStep,
    retryAvailable: decision.retryAvailable,
  };
}
