# ADR-0010: `guardrail_config` Minimal Scope — a Single Global Allowlist Plus a Single Governance-Role Check, Fail-Closed Pending Real File-Change Data

## Status

Accepted.

## Context

Per the umbrella `wave-decisions.md` Decision 5 and this track's own `wave-decisions.md`,
`guardrail_config` — "allowed repos/paths, approval requirements, and any constraints on what the
engine may touch autonomously" — does not exist anywhere in OrgOps today, has no defined owner or
storage location, and requires organizational policy input (from an engineering-lead-equivalent
role, represented by Priya Nair) that is explicitly outside this feature's control to define
unilaterally. US-12 is the first story in the umbrella feature that requires `guardrail_config` to
exist as a real, checkable ruleset, not merely a named future concept.

Separately, evaluating any allowlist requires knowing which files a completed run actually
touched. That data — `changedFilePaths` — does not exist yet either: `progress-trust-ux`'s
ADR-0007 already established that no DELIVER-wave output contract exists for communicating
branch/PR/file-change data back to `agent-runner`, and this track's brief.md section adds
`changedFilePaths` as one more optional field on the same not-yet-populated `CompletionArtifact`
port.

This forces two independent scope decisions in the same ADR: what mechanism to build for
`guardrail_config` itself, and what to do when the mechanism has no real data to evaluate against
(true for every run today).

## Decision

**Build the minimal honest mechanism now; defer everything else explicitly.**

- **Storage**: one new table, `guardrail_allowlist_entries` — a flat list of path-glob patterns
  (`path_pattern`, `created_by`, `created_at`). No per-repo, per-team, or per-ticket scoping; no
  rule composition beyond glob matching.
- **Authorization**: one new check, `AccessControl.canSignOffGuardrail(user)` — true only for
  members of the **same** governance team `ticket-classification` already established
  (`teams`/`team_memberships`), reused rather than duplicated. No second team, no tiered role
  hierarchy.
- **Evaluation-time behavior when `changedFilePaths` is unavailable** (true for every run in this
  release, since the DELIVER-wave output contract gap remains open): the Guardrail Evaluator sets
  `approval_status = GOVERNANCE_HOLD` with an explicit, honest reason ("file-change data not yet
  available"), rather than either fabricating a "no files touched" assumption (fail open) or
  silently skipping the check.

**Explicitly not built**, named rather than silently omitted: a general-purpose policy engine
(conditional rules beyond path matching, per-repo/per-team allowlists), multi-tier approval chains
(a single sign-off role, not an escalating chain), any workflow for *defining* what belongs on the
allowlist beyond flat CRUD (the actual policy content is an organizational decision outside this
feature's authority per Decision 5), and any resolution to the `changedFilePaths` data-availability
gap itself.

## Alternatives Considered

### 1. Fail open — allow "Approve" whenever `changedFilePaths` cannot be evaluated, since no violation can be proven

**Rejected.** US-12 exists specifically because "any ticket could trigger autonomous code changes
with no human-defined boundary" is the primary anxiety force for the engineering-stakeholder
persona (per the umbrella `shared-artifacts-registry.md`'s risk assessment for `guardrail_config`).
Silently allowing approval whenever the system cannot prove a run stayed within bounds inverts the
entire purpose of the story — it would technically satisfy "Approve is available" while defeating
the reason a governance gate exists at all. This directly contradicts this track's own
correctness/auditability priority-1 ranking (brief.md Quality Attribute Priorities): a governance
gate that can be silently bypassed by a data gap is the same category of defect as the blocking
Trello/tickets issue ADR-0009 resolves — a correctness problem, not a style choice.

### 2. Build a full policy engine now (per-repo scoping, conditional rules, multi-tier approval) to anticipate future organizational needs

**Rejected.** No organizational policy content exists yet to encode into such a system (Decision
5's core constraint), and every sibling track in this feature has consistently avoided speculative
engineering ahead of a confirmed need (e.g. `progress-trust-ux`'s ADR-0005 deferring notification
infrastructure, ADR-0007 deferring the DELIVER-wave contract rather than guessing its shape).
Building elaborate policy machinery now, with no real ruleset to validate it against, risks
encoding wrong assumptions about how Priya Nair's organization actually wants governance to work —
worse than shipping a deliberately minimal mechanism and iterating once real policy input exists.

### 3. Single global allowlist, single governance-role check, fail-closed on missing data (chosen)

**Accepted.** Ships the smallest mechanism that satisfies US-12's literal ACs ("runs that touch
files outside the configured guardrail allowlist require governance sign-off before submitter
approval is available") without presuming policy content or engine sophistication nobody has
asked for yet. The fail-closed behavior for missing `changedFilePaths` data is the only choice
consistent with this track's own priority-1 quality attribute and does not require inventing new
data — it reuses the existing `GOVERNANCE_HOLD` state and `canSignOffGuardrail` role check that
already exist for the "outside allowlist" case, applying the identical mechanism to a second
trigger condition rather than building a second one.

## Consequences

**Positive**

- Ships a real, checkable governance gate now, satisfying US-12's literal ACs, without requiring
  organizational policy input this feature cannot obtain (Decision 5).
- The fail-closed default for missing file-change data means the gate cannot be silently
  defeated by an upstream data gap — every run requires explicit governance sign-off until that
  gap closes, which is the safer of the two honest options given the priority-1 ranking.
- No wasted engineering effort on policy machinery that would need to be redesigned once real
  organizational input (allowed repos/paths, actual approval requirements) is defined — the flat
  allowlist table can be populated with real content without a schema change when that input
  arrives.

**Negative**

- Every run in this release requires governance sign-off (since `changedFilePaths` is never
  populated yet), which materially slows down the "100% of completed runs reach an explicit
  decision within 3 business days" Outcome KPI compared to a world where most runs could
  self-clear against a real allowlist. This is a direct, acknowledged cost of the fail-closed
  choice, not a hidden one — it will resolve automatically once the DELIVER-wave output contract
  gap closes and `changedFilePaths` becomes real data, with no further design change needed here.
- The allowlist itself ships empty of real content — Priya Nair (or an equivalent role) must
  populate it via the new CRUD API before it does anything beyond triggering universal holds.
  This is the explicit, intended scope boundary (Decision 5), not an omission.

## Enforcement

No new structural rule beyond existing module-boundary rules. The behavioral invariant this ADR
depends on — "Approve is never available while `approval_status = GOVERNANCE_HOLD`" — is enforced
server-side in the Governance Approval Handler (checked before every write, per brief.md's
Failure/Timeout table), not merely by hiding a button in the UI.
