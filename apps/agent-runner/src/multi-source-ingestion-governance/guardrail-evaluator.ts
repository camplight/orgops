import type { GuardrailAllowlistEntry, GuardrailEvaluation } from "./types";

export type CompletionSummaryPostedEvent = {
  runId: string;
  changedFilePaths?: string[];
};

function escapeRegExpLiteral(literal: string): string {
  return literal.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

function globPatternToRegExp(pathPattern: string): RegExp {
  const regexBody = pathPattern
    .split("**")
    .map((segment) => segment.split("*").map(escapeRegExpLiteral).join("[^/]*"))
    .join(".*");
  return new RegExp(`^${regexBody}$`);
}

function changedPathMatchesAllowlist(
  changedFilePath: string,
  allowlist: GuardrailAllowlistEntry[],
): boolean {
  return allowlist.some((entry) => globPatternToRegExp(entry.pathPattern).test(changedFilePath));
}

function findPathsUncoveredByAllowlist(
  changedFilePaths: string[],
  allowlist: GuardrailAllowlistEntry[],
): string[] {
  return changedFilePaths.filter((path) => !changedPathMatchesAllowlist(path, allowlist));
}

function holdForMissingChangeData(): GuardrailEvaluation {
  return {
    approvalStatus: "GOVERNANCE_HOLD",
    governanceHoldReason:
      "file-change data not yet available for this run; governance review required before approval",
  };
}

function holdForUncoveredPaths(uncoveredPaths: string[]): GuardrailEvaluation {
  return {
    approvalStatus: "GOVERNANCE_HOLD",
    governanceHoldReason: `changed path(s) not covered by guardrail allowlist: ${uncoveredPaths.join(", ")}`,
  };
}

const CLEARED_EVALUATION: GuardrailEvaluation = { approvalStatus: "PENDING" };

/**
 * Pure logic (per brief.md "Architecture Enforcement": must not perform fetch/apiFetch or
 * child_process calls directly). Consumes the existing progress-trust-ux.completion_summary
 * .posted event.
 *
 * Fail-closed per ADR-0010: GOVERNANCE_HOLD whenever changedFilePaths is unavailable — never
 * fail-open. When available, every path must match a guardrail_allowlist_entries pattern for
 * approval_status to become PENDING; any uncovered path holds for governance sign-off.
 */
export function evaluateGuardrailForCompletion(
  event: CompletionSummaryPostedEvent,
  allowlist: GuardrailAllowlistEntry[],
): GuardrailEvaluation {
  if (!event.changedFilePaths) {
    return holdForMissingChangeData();
  }

  const uncoveredPaths = findPathsUncoveredByAllowlist(event.changedFilePaths, allowlist);
  if (uncoveredPaths.length > 0) {
    return holdForUncoveredPaths(uncoveredPaths);
  }

  return CLEARED_EVALUATION;
}
