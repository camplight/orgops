# ADR-0008: Trello Ingestion via Snapshot-Diff Polling (Not Webhook), Reusing `trello-cli`

## Status

Accepted.

## Context

US-11 requires new Trello cards on a configured board to be ingested as tickets, with three hard
constraints: (1) card creation must be distinguished from card moves — only creation ingests;
(2) a temporary Trello API outage must be recovered from without silently missing a card; (3) two
near-simultaneous sync runs observing the same new card must never create two ticket records.

Two mechanisms were available in principle: a Trello webhook (Trello calls back into an
OrgOps-owned HTTP endpoint on board activity) or periodic polling (OrgOps asks Trello for board
state on a schedule). Reading `skills/trello-cli/SKILL.md` and
`skills/trello-cli/assets/run.ts` confirms the existing skill is a thin, synchronous CLI
passthrough (`spawnSync("npx", ["-y", "@trello-cli/cli", ...args])`) with no built-in scheduling,
webhook listener, or change-cursor concept — whichever mechanism is chosen, this module must build
the scheduling/detection logic itself; neither is a "free" capability the skill already provides.

A targeted read of every route file in `apps/api/src/routes/` (across this and all three prior
DESIGN passes) found no existing webhook-receiver endpoint anywhere in OrgOps — a webhook approach
would require building new public-facing HTTP infrastructure (endpoint, signature verification,
exposure/networking) from scratch, the same category of "confirmed absent, not merely
unconfirmed" finding `progress-trust-ux`'s ADR-0005 made for notification infrastructure.

## Decision

**Periodic polling with full-snapshot diffing**, not a webhook. On each poll cycle, for each
configured board, fetch the board's current card list in full (not an incremental "since last
poll" delta) and compare it against a durable record of every card id ever previously observed
for that board (`trello_ingestion_seen_cards`). A card id **never before recorded** is genuinely
new and is ingested; a card id **already recorded** — regardless of which list it currently sits
in — is treated as already-known and is never re-ingested. On a board's first-ever poll after
activation, every currently-observed card is recorded as "seen" **without** being ingested (the
baseline snapshot), so activating ingestion on a board with an existing backlog does not flood the
system with historical cards misread as "new."

## Alternatives Considered

### 1. Webhook — Trello pushes card-creation events to an OrgOps-owned endpoint

**Rejected.** Requires building genuinely new infrastructure (a public HTTP receiver, request
signature/authenticity verification, exposure and networking configuration) that does not exist
anywhere in OrgOps today — a materially larger and differently-shaped effort than every other
component this track and its three sibling tracks have built, all of which extend existing
capability rather than standing up new receiving infrastructure. This is the same category of
rejection `progress-trust-ux`'s ADR-0005 already applied to building notification infrastructure
from scratch in a release where it was not the disproportionately-justified priority.

### 2. Incremental polling via Trello's "actions" (activity log) endpoint, filtered to `createCard` actions

**Rejected, for this pass.** This would give a direct, semantically precise "card was created"
signal (rather than an inferred one), avoiding the need for a seen-cards tracking table entirely.
It was rejected because the `trello-cli` skill's actual command surface for actions/activity
filtering was not confirmed during this DESIGN pass — `assets/run.ts` is a raw passthrough to
`@trello-cli/cli`, and this design does not assume undocumented capability of a third-party CLI
it has not exercised. Snapshot-diffing only requires a card-listing command, the one capability
this pass can confirm the skill is built to support (`cards --help` is referenced directly in the
skill's own examples). If a future implementation confirms reliable `actions`-endpoint support,
this is a strict improvement path (replaces the diffing heuristic with a direct signal) that does
not change this ADR's outer decision (polling, not webhook) — only its internal detection
mechanism.

### 3. Full-snapshot diff polling against `trello_ingestion_seen_cards` (chosen)

**Accepted.** Requires only a card-listing capability (confirmed to exist), needs no new
public-facing infrastructure, and structurally satisfies all three US-11 constraints:
- **Creation vs. move**: a card's first-ever appearance in the seen-cards table is definitionally
  "creation, as observed by this system" — a later move never looks like a first appearance,
  regardless of list.
- **Outage recovery without silent loss**: because each poll re-diffs the *entire current* card
  list (not an incremental delta since the last successful poll), a missed cycle costs nothing —
  the next successful poll still sees every card that exists on the board at that time and
  correctly identifies any that were never previously recorded.
- **Concurrent-poll duplicate prevention**: handled at the database layer (a unique index on
  `tickets (source, source_ref)`, not by this polling mechanism alone) — see ADR-0009's sibling
  concern in brief.md's Failure/Timeout table; this ADR's mechanism reduces redundant work via an
  in-flight-per-board guard but does not by itself guarantee no duplicate ticket, which is why the
  database constraint is named as the actual correctness backstop.

## Consequences

**Positive**

- No new public-facing infrastructure required; reuses the existing `trello-cli` skill unchanged
  at the command level.
- Outage recovery is a property of the mechanism itself (full re-diff), not a retry queue or
  dead-letter mechanism that would need its own failure handling.
- Card creation/move distinction requires no Trello-side event classification, avoiding dependence
  on an unconfirmed CLI capability.

**Negative**

- Full-list polling does not scale to very large boards or high poll frequency — acceptable at
  this project's walking-skeleton-adjacent scale (single-team, modest board sizes), but a genuine
  limitation flagged, not hidden, for a future scale-up.
- Poll latency (new-card-to-ticket delay) is bounded by the poll interval, not near-instant as a
  webhook would provide. Not addressed by an NFR in this track's acceptance criteria, so not
  treated as a defect.
- Requires the `trello_ingestion_seen_cards` bootstrap/baseline-snapshot logic (a small but real
  piece of one-time-per-board complexity) that a true creation-event signal (Alternative 2) would
  not need.

**`TrelloCliBoardReader`'s async-invocation error contract, fixed explicitly (added at peer
review)**: because this adapter replaces the skill script's blocking `spawnSync` with an
async `spawn`/`execFile` call (see Decision above), the port's failure behavior must be
unambiguous for the Trello Ingestion Poller's catch-and-record logic to be correct:
- A non-zero CLI exit code, a spawn error (e.g. `npx`/`@trello-cli/cli` not resolvable), or a
  process-level error event **must** reject the `listCards` promise (or throw, if awaited) —
  never resolve with a partial or empty list that could be misread as "board legitimately has no
  cards."
- The adapter **must** apply a bounded timeout to the spawned process (a fixed constant,
  `software-crafter`'s implementation choice) and treat a timeout as a rejection, identical in
  shape to a non-zero exit — an indefinitely-hanging CLI call must not indefinitely block that
  board's poll cycle.
- On `agent-runner` process shutdown while a poll is in flight, the adapter must not leave an
  orphaned child process — the spawned CLI process should be sent a termination signal as part of
  the runner's existing shutdown sequence (the same category of concern `wrapper-harness/
  command.ts` already handles for its own spawned processes), not a new shutdown idiom.

This contract is what makes the Trello Ingestion Poller's stated failure handling ("catches the
error, calls `recordBoardPollResult({ status: FAILED })`") correct rather than merely assumed —
without a guaranteed rejection/throw on every failure mode, a silently-empty card list could be
misread as "board has no cards," reintroducing exactly the "card silently missed" failure mode
this ADR's mechanism otherwise prevents.

## Enforcement

`TrelloCliBoardReader` is the only module permitted to invoke the `trello-cli` skill or import
`node:child_process` within `apps/agent-runner/src/multi-source-ingestion-governance/**` — see
brief.md's Architecture Enforcement section for the corresponding dependency-cruiser rule.
