import type { ApprovalStatus } from "./types";

export const __SCAFFOLD__ = true;

export type ApprovalDecision =
  | { allowed: true; nextStatus: ApprovalStatus }
  | { allowed: false; reason: string };

/**
 * Pure gating logic (per brief.md "Architecture Enforcement": must not perform fetch/apiFetch
 * calls directly — only HttpGovernanceRepository may). Governance Approval Handler's decision
 * functions, called by the API route handlers in nwave-runs.ts once implemented.
 *
 * Approve is never available while approval_status === GOVERNANCE_HOLD — a structural,
 * never-bypassable gate enforced server-side, not merely by hiding a UI control (US-12 AC4, the
 * feature's own priority-1 correctness/auditability quality attribute).
 */
export function decideApprove(currentStatus: ApprovalStatus): ApprovalDecision {
  throw new Error(
    `decideApprove not implemented (currentStatus=${currentStatus}) — Approve must only be ` +
      "allowed when approval_status === PENDING, never GOVERNANCE_HOLD.",
  );
}

/**
 * A submitter can request changes even on a held run (governance holds gate *approval*, not the
 * ability to say "this needs work") — valid when approval_status is PENDING or
 * GOVERNANCE_HOLD (US-12 AC3).
 */
export function decideRequestChanges(
  currentStatus: ApprovalStatus,
  note: string,
): ApprovalDecision {
  throw new Error(
    `decideRequestChanges not implemented (currentStatus=${currentStatus}, note="${note}") — ` +
      "must always call createFollowOnRun with cycleReason=CHANGES_REQUESTED, never RETRY.",
  );
}

/**
 * Unauthorized attempts are rejected before any write, mirroring canOverrideClassification/
 * canControlRun's existing pattern exactly (US-12 AC4).
 */
export function decideGovernanceSignoff(
  currentStatus: ApprovalStatus,
  isAuthorized: boolean,
): ApprovalDecision {
  throw new Error(
    `decideGovernanceSignoff not implemented (currentStatus=${currentStatus}, ` +
      `isAuthorized=${isAuthorized}) — transitions GOVERNANCE_HOLD to PENDING only for an ` +
      "authorized governance-team actor.",
  );
}
