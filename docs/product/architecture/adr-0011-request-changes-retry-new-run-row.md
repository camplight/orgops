# ADR-0011: Request-Changes and Retry Both Create a New `nwave_runs` Row; Neither Ever Mutates a Terminal Run

## Status

Accepted.

## Context

US-12's "Request changes" and US-13's "Retry" both need to start a new implementation cycle for a
ticket whose prior run has already reached a terminal state (`COMPLETED`, `FAILED`, or `HALTED`,
per `nwave-invocation-engine`'s existing `nwave_runs.status` enum). Both stories explicitly
require prior context to be preserved, not discarded ("the original context/history is preserved,
not discarded" — US-12 AC3; "a new run starts using the same confirmed ticket intent, without
re-entering information" — US-13 AC4).

This forces a concrete choice this track's own instructions call out directly: does a new cycle
mean creating a second `nwave_runs` row referencing the same ticket, or mutating the existing
terminal row back into an active state? `nwave-invocation-engine`'s design was not built with a
"reopen" concept — its `status` transitions were designed as one-directional, ending at a terminal
value, with `current_wave` explicitly documented as "null... after the run terminates."

## Decision

**A new `nwave_runs` row is created for every Request-Changes or Retry cycle. The prior run's row
is never mutated.** Three new additive columns support this: `previous_run_id` (self-referencing,
nullable — links the new row to the run it supersedes), `cycle_reason` (`INITIAL | RETRY |
CHANGES_REQUESTED`), and `retry_count` (computed at creation time: `0` for `INITIAL`, the previous
run's `retry_count + 1` for `RETRY`, always `0` for `CHANGES_REQUESTED` since a human-initiated
cycle is not counted against the automatic-retry exhaustion threshold).

The new row is created through `nwave-invocation-engine`'s **existing, unmodified**
`RunRepositoryPort.createRun`, extended with two new optional parameters: `skipConfirmation: true`
(bypasses the Restatement Composer/Confirmation Gate, since the intent is already known — or, for
Request-Changes, explicitly re-scoped by the submitter's own note) and `seedContext` (carries the
prior run's confirmed `restatement_text`, optionally concatenated with new feedback, into the new
run's first wave). The new run's `channel_id` is the same ticket channel as always (constant per
ticket) — no new channel is created, and every prior message remains visible in place.

## Alternatives Considered

### 1. Mutate the existing terminal `nwave_runs` row back into an active state (reset `status`, clear `ended_at`, start a new wave sequence)

**Rejected.** This would violate the one-directional terminal-state invariant
`nwave-invocation-engine`'s own design already relies on elsewhere (e.g. the Completion Summary
Composer, the Failure/Recovery Advisor, and any future governance/audit query all assume a
`COMPLETED`/`FAILED`/`HALTED` row represents a finished, immutable attempt). Overwriting it in
place would destroy that attempt's own audit value — its specific wave history, its specific
completion summary, its specific failure reason — the moment a new cycle starts, which directly
undermines this track's own priority-1 correctness/auditability quality attribute and the
Escalate action's need for "accumulated failure context" across multiple distinct attempts.

### 2. A new, separate "cycle" or "revision" table wrapping multiple `nwave_runs` rows, rather than a direct `previous_run_id` link

**Rejected.** Adds an extra layer of indirection (a run belongs to a cycle, a cycle has many runs)
for no capability this track's ACs actually require — "preserve prior context" and "accumulated
failure context" both only need the ability to walk backward from the latest run to its
predecessors, which a simple self-referencing foreign key already provides in one hop per link.
Matches this project's repeated preference (see ADR-0003's rejection of event-sourcing for
`tickets`) against introducing a new structural layer when a direct, simpler relationship already
satisfies the requirement.

### 3. New `nwave_runs` row per cycle, linked via `previous_run_id`, reusing the existing `createRun`/Wave Runner mechanism unmodified (chosen)

**Accepted.** Preserves every prior attempt's full, untouched audit trail (wave history, failure
reason, completion summary) exactly as it was recorded — nothing is ever overwritten. Requires
zero change to `nwave-invocation-engine`'s core state machine or Wave Runner chaining logic — only
two new optional parameters on an already-existing port method and three new additive columns.
`GET /api/nwave-runs/:id/cycle-history` walks `previous_run_id` backward to serve both US-12's
context-preservation requirement and US-13's accumulated-context requirement with the same simple
mechanism, not two separate ones.

## Consequences

**Positive**

- Every implementation attempt for a ticket is independently auditable, in full, forever — a
  governance reviewer can inspect exactly what happened on attempt 1, attempt 2, and attempt 3
  without any of them having overwritten another.
- `nwave-invocation-engine`'s existing state machine, Wave Runner, and Run Watchdog require zero
  modification — this track only adds optional parameters and additive columns, consistent with
  every prior track's pattern of extending sibling contracts rather than redesigning them.
- Skipping re-confirmation (`skipConfirmation: true`) directly satisfies US-13's "without
  re-entering information" AC and avoids an unnecessary, contradictory re-confirmation step for
  intent that a human just explicitly re-scoped (Request-Changes) or that has not changed at all
  (Retry).

**Negative**

- Callers that want "the current state of ticket X's implementation work" must now resolve the
  *latest* run in a `previous_run_id` chain, rather than assuming one `nwave_runs` row per ticket
  — a small additional query shape (`ORDER BY created_at DESC LIMIT 1` scoped to
  `ticket_ref`, or an equivalent "latest run" read) that did not exist before this track. This is
  a real, if minor, complexity cost accepted in exchange for the audit-integrity guarantee above.
- `retry_count` must be correctly propagated at creation time (`previousRun.retryCount + 1` for
  `RETRY`, reset to `0` for `CHANGES_REQUESTED`) — a small invariant owned by
  `GovernanceRepositoryPort.createFollowOnRun`'s single write path, not left to callers to
  maintain independently, mirroring ADR-0003's precedent for keeping a derived invariant behind a
  single port method.

## Enforcement

No new structural rule beyond existing module-boundary rules. `createFollowOnRun` is the single
call site responsible for correctly setting `previous_run_id`/`cycle_reason`/`retry_count` — no
other code path in this module or any sibling module writes those columns directly.
