import type { GuardrailAllowlistEntry, GuardrailEvaluation } from "./types";

export const __SCAFFOLD__ = true;

export type CompletionSummaryPostedEvent = {
  runId: string;
  changedFilePaths?: string[];
};

/**
 * Pure logic (per brief.md "Architecture Enforcement": must not perform fetch/apiFetch or
 * child_process calls directly). Consumes the existing progress-trust-ux.completion_summary
 * .posted event.
 *
 * Real implementation (ADR-0010): fail-closed to GOVERNANCE_HOLD whenever changedFilePaths is
 * unavailable (true for every run today per the open DELIVER-wave output contract gap) — never
 * fail-open. When available, every path must match a guardrail_allowlist_entries pattern for
 * approval_status to become PENDING; any uncovered path holds for governance sign-off.
 */
export function evaluateGuardrailForCompletion(
  event: CompletionSummaryPostedEvent,
  _allowlist: GuardrailAllowlistEntry[],
): GuardrailEvaluation {
  throw new Error(
    `evaluateGuardrailForCompletion not implemented for run "${event.runId}" — must fail-closed ` +
      "to GOVERNANCE_HOLD when changedFilePaths is unavailable (US-12 AC4, ADR-0010), and check " +
      "every path in changedFilePaths against the allowlist's glob patterns when available.",
  );
}
