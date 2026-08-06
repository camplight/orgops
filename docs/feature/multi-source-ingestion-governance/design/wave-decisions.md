# Wave Decisions: Multi-Source Ingestion & Governance Track — DESIGN Wave

## Interaction Mode

**Propose mode.** No interactive access to the human product owner in this session, per the
scope decision passed into this DESIGN wave (consistent with all three prior tracks). This
document presents the decisions made, with trade-offs, rather than a question log.

## Resolution of the Blocking Trello/Tickets Dependency (Read This First)

`ticket-classification`'s DESIGN pass raised, as a **blocking dependency** (escalated from a
recommendation during that track's own peer review), the requirement that Trello ingestion must
create a real `tickets` row (`id` in the `TICKET-{n}` format, `source = TRELLO`, `source_ref =
<Trello card id>`) and emit `ticket.created` exactly like the native-form path, or explicitly
supersede that note with justification.

**Confirmed: the note is followed, not superseded.** US-11's Trello Ingestion Poller calls the
**same** `POST /api/tickets` endpoint the native form already uses, populating `source`/
`source_ref`, and the resulting ticket flows through classification, confirmation, execution, and
monitoring identically to a native-form ticket — no source-specific branching anywhere downstream.
No change was required to `nwave-invocation-engine`'s existing `nwave_runs.ticket_ref →
tickets.id` reconciliation, because the chosen resolution keeps that reconciliation holding
uniformly by construction. Full detail: `docs/product/architecture/brief.md` "Resolution of the
Blocking Trello/Tickets Dependency" and ADR-0009.

## Key Decisions

1. **Trello ingestion via full-snapshot-diff polling, not a webhook.** `skills/trello-cli/` is a
   thin, synchronous CLI passthrough with no built-in scheduling or webhook capability, and no
   webhook-receiver infrastructure exists anywhere in OrgOps today. Each poll cycle compares a
   board's full current card list against a durable `trello_ingestion_seen_cards` record; a card
   id never previously recorded is genuinely new and is ingested, regardless of poll-cycle
   failures in between (a missed cycle costs nothing — the next successful poll re-diffs
   everything). A board's first-ever poll after activation is a baseline snapshot (records
   existing cards as "seen" without ingesting them), preventing a flood of historical cards being
   misread as new. See ADR-0008.
2. **Card-creation-vs-move distinction is structural, not heuristic**: a card is "new" exactly
   when its id has never appeared in `trello_ingestion_seen_cards`; a move never looks like a
   creation because the moved card already has a row from when it was first observed, regardless
   of its current list.
3. **The actual duplicate-prevention guarantee for concurrent syncs is a database constraint**
   (unique index on `tickets (source, source_ref)`), not the polling mechanism's in-flight guard
   alone — the in-flight guard reduces redundant Trello calls; the constraint is what makes
   duplicate ticket creation structurally impossible.
4. **`guardrail_config` ships as the minimal honest mechanism the umbrella's Decision 5 allows**:
   a single flat `guardrail_allowlist_entries` table plus a single governance-role check
   (`canSignOffGuardrail`, reusing the existing governance team). Explicitly not built: a
   general-purpose policy engine, multi-tier approval chains, or any allowlist-content-defining
   workflow — the actual policy content remains an organizational decision outside this feature's
   control. See ADR-0010.
5. **Guardrail evaluation is fail-closed when `changedFilePaths` is unavailable** — true for every
   run today, since `progress-trust-ux`'s DELIVER-wave output contract gap (ADR-0007) remains
   open. Every run requires governance sign-off until that gap closes; this is a deliberate,
   priority-1-quality-attribute-driven choice, not an oversight. See ADR-0010.
6. **Request-Changes and Retry both create a new `nwave_runs` row, never mutate a terminal run.**
   New additive columns (`previous_run_id`, `cycle_reason`, `retry_count`) link cycles together;
   the existing `RunRepositoryPort.createRun` is reused unmodified with two new optional
   parameters (`skipConfirmation`, `seedContext`). See ADR-0011.
7. **The stuck-run staleness threshold is explicitly provisional**, reusing
   `progress-trust-ux`'s exact per-wave baseline table at a stricter (2x vs. 1.5x) multiplier,
   inheriting that track's already-stated replacement plan (measured rolling baseline from real
   operational data) rather than inventing a second one. See ADR-0012.
8. **Architecture style**: modular monolith with local ports-and-adapters, consistent with all
   three sibling tracks — the first module in this feature needing two ports (one for the
   external Trello integration, one for the internal API contract), since it is the first module
   integrating a genuine external system beyond the already-reused LLM abstraction.

## Architecture Summary

Six new components in `apps/agent-runner/src/multi-source-ingestion-governance/`: **Trello
Ingestion Poller** (interval-scheduled, snapshot-diffs board cards), **Guardrail Evaluator**
(consumes completion events, checks `changedFilePaths` against the allowlist), **Governance
Approval Handler** (Approve/Request-Changes/Governance-Signoff, gates `approval_status`
transitions, audits every decision), **Failure/Recovery Advisor** (composes non-blaming
failure guidance, enforces the retry-exhaustion threshold), **Stuck-Run Detector**
(interval-scheduled, reuses `progress-trust-ux`'s shared `Run Activity Deriver`), plus two ports
(`TrelloIngestionPort`/`TrelloCliBoardReader`, `GovernanceRepositoryPort`/
`HttpGovernanceRepository`). Five new tables, six new/extended route files, eight new domain
events. Full detail, C4 diagram, failure-handling table, and extension points (per-card submitter
mapping, general-purpose policy engine, human-developer-assignment escalation workflow — all
explicitly not foreclosed) are in `docs/product/architecture/brief.md` → "Multi-Source Ingestion &
Governance."

## Technology Stack

No new runtime dependencies. Reuses the existing `trello-cli` skill/`@trello-cli/cli` (already a
project dependency) via an **asynchronous** invocation (`spawn`/`execFile`, not the skill script's
own `spawnSync`) to avoid blocking the agent-runner's long-lived event loop — a deliberate,
justified deviation from the skill script's own interactive-turn invocation shape, not a change to
the skill itself. Same recommended dev-tooling dependency as all three sibling tracks:
`dependency-cruiser` (MIT license), covering all four modules' rules together.

## Development Paradigm

**Applied, not re-derived.** Confirmed project convention (root `CLAUDE.md`): functional-leaning
TypeScript. Every deterministic component in this pass (Guardrail Evaluator, Governance Approval
Handler, Failure/Recovery Advisor, Stuck-Run Detector) follows the same
batch-processing-an-explicit-event-set shape established by `intent-watchdog.ts` and reused by
every sibling module.

## Constraints Established

- `apps/agent-runner/src/multi-source-ingestion-governance/**` must not import from
  `apps/agent-runner/src/nwave-invocation/**`, `apps/agent-runner/src/ticket-classification/**`,
  `apps/agent-runner/src/progress-trust-ux/**`, or `apps/agent-runner/src/wrapper-harness/**` —
  coordination happens only via the event bus and the shared HTTP contract, extending the
  one-way decoupling rule to a fourth module.
- `TrelloCliBoardReader` is the only module permitted to import `node:child_process` or invoke the
  `trello-cli` skill script.
- Pure logic modules must not perform `fetch`/`apiFetch` or shell-out calls directly — only the
  two named adapters may.
- Approve is never available while `approval_status = GOVERNANCE_HOLD` — enforced server-side in
  the Governance Approval Handler, not merely by hiding a UI control.

## Observable Contract for Downstream Tracks

None — this is the final track in the umbrella feature; no further track depends on this one's
output.

## Upstream Changes

**Additive only, via the back-propagation pattern — no prior section edited in place:**

- `tickets` (`ticket-classification`): new `resolution_status` column; new unique index on
  `(source, source_ref)`.
- `nwave_runs` (`nwave-invocation-engine`): new `previous_run_id`/`cycle_reason`/`retry_count`/
  `escalated_at` columns. No change needed to that section's existing `ticket_ref` reconciliation
  — it already holds uniformly given this track's resolution of the blocking dependency.
- `nwave_run_completions` (`progress-trust-ux`): new `approval_status` and related columns
  (US-12's attachment point), new `suggested_next_step`/`retry_available` columns (US-13's
  attachment point).
- `CompletionArtifact` port (`progress-trust-ux`, ADR-0007): new optional `changedFilePaths`
  field.

Full column-level detail: `docs/product/architecture/brief.md` "Changed Assumptions."

## Release 2 Known Constraints (Added at Peer Review)

**Governance sign-off will be required for 100% of completed runs at Release 2 launch, not just
runs that genuinely touch out-of-allowlist files.** This is a direct, foreseeable consequence of
ADR-0010's fail-closed default: `changedFilePaths` is not populated by any adapter today (the
DELIVER-wave output contract gap `progress-trust-ux`'s ADR-0007 already named remains open), so
every run's Guardrail Evaluator outcome is `GOVERNANCE_HOLD`, regardless of what it actually
touched.

**Practical implication for release planning**: US-12's own Outcome KPI — "100% of completed runs
reach an explicit approve or request-changes decision within 3 business days" — now depends
entirely on governance sign-off throughput (a single role, Priya-Nair-equivalent, per ADR-0010),
not on submitter responsiveness alone, since every run requires that role's action before a
submitter's "Approve" is even available. This should be sized into Release 2's operational
readiness planning (`platform-architect`/DEVOPS wave), not discovered after launch.

**This is the correct fail-closed choice, not a design gap** — the alternative (fail-open,
silently allowing approval without knowing what changed) was explicitly rejected in ADR-0010 as
defeating the governance gate's entire purpose. The bottleneck resolves automatically, with no
further design change needed, the moment the DELIVER-wave output contract closes and
`changedFilePaths` becomes real data — tracked as the same cross-cutting gap
`progress-trust-ux`'s brief.md section already named, not a new one.

## Peer Review

Invoked `nw-solution-architect-reviewer` (haiku), single pass per `.nwave/des-config.json`
(`review_enabled: true`, `double_review: false`). Outcome: **conditionally approved**, 0 critical
issues, 3 high issues (all addressable without redesign — documentation/communication
clarifications), 2 medium issues (documentation improvements). All blocking-dependency and
critical-requirement verifications (Trello/tickets resolution, `guardrail_config` scope,
run-model mapping, staleness-threshold honesty) passed without findings.

All three high issues and both medium issues were remediated before this design was finalized:

1. **`TrelloCliBoardReader` async-spawn error contract** — added an explicit contract to
   ADR-0008's Consequences: `listCards` must reject/throw on any CLI failure mode (non-zero exit,
   spawn error, timeout), never resolve with a misleadingly-empty list; a bounded timeout and
   clean process termination on runner shutdown are required. This is what makes the Trello
   Ingestion Poller's stated failure handling correct rather than merely assumed.
2. **`cycle_reason` explicitness for Request-Changes** — added an explicit statement to brief.md's
   Governance Approval Handler description: the "Request changes" action always calls
   `createFollowOnRun` with `cycleReason = "CHANGES_REQUESTED"` (never `"RETRY"`), the one call
   site responsible for ADR-0011's `retry_count` reset-to-zero invariant.
3. **Release 2 governance-hold bottleneck communication** — added the "Release 2 Known
   Constraints" section above, making the 100%-sign-off consequence and its operational-readiness
   implication explicit for release planning rather than left implicit in ADR-0010 alone.
4. **Stuck-Run Detector enforcement rule** — added an explicit dependency-cruiser rule to
   brief.md's Architecture Enforcement section: `stuck-run-detector.ts` must import the shared
   `Run Activity Deriver` rather than reimplementing staleness logic locally.
5. **Per-card Trello member mapping extension-point sketch** — added a concrete (non-committing)
   sketch to brief.md's Extension Points: a future `trello_member_mapping` table and lookup-with-
   fallback shape, so a future implementer is not starting from zero.

No second review iteration was run (single-pass config); remediations were applied directly
against the reviewer's stated findings. This design is ready for handoff to DISTILL.
