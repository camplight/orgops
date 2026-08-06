export const __SCAFFOLD__ = true;

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

/**
 * Pure logic (per brief.md "Architecture Enforcement": must not perform fetch/apiFetch calls
 * directly). Consumes progress-trust-ux.completion_summary.posted when outcome is FAILED or
 * HALTED.
 *
 * Real implementation must always pair plain-language "what completed / what failed / next
 * step" guidance with the raw-output link — never a bare link (US-13 AC3, satisfied
 * structurally as a composition rule on this function, not a UI-layer convention). Once
 * retryCount >= MAX_AUTO_RETRY_COUNT, suggestedNextStep must be ESCALATE and retryAvailable
 * must be false — "Retry" is structurally withheld past the threshold (US-13 AC5).
 */
export function composeFailureRecoveryGuidance(event: FailureCompletionEvent): RecoveryGuidance {
  throw new Error(
    `composeFailureRecoveryGuidance not implemented for run "${event.runId}" (retryCount=` +
      `${event.retryCount}, threshold=${MAX_AUTO_RETRY_COUNT}) — must compose non-blaming ` +
      "guidance paired with the raw-output link, and withhold retry once the threshold is met.",
  );
}
