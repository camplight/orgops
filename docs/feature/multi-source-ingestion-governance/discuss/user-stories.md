<!-- markdownlint-disable MD024 -->
# User Stories: Multi-Source Ingestion & Governance Track

Split from the umbrella feature `nwave-ticket-execution-engine` per the human product owner's
confirmed decision (see `docs/feature/nwave-ticket-execution-engine/discuss/wave-decisions.md`
Decision 4). Stories below are copied verbatim from the original DISCUSS-wave
`user-stories.md`; no content was re-derived, paraphrased, or altered, and no acceptance
criteria were dropped. Personas: Maria Santos (Senior Product Manager), Devon Park (Support
Engineer), Carlos Mendes (Customer Success Manager) — all at Fenwick Analytics — as
submitters; Priya Nair (Engineering Lead) as governance stakeholder. Full persona/job
grounding: umbrella `jtbd-job-stories.md`.

## System Constraints (Applicable to This Track)

Full cross-cutting constraint list: umbrella `user-stories.md` `## System Constraints`. The
subset directly relevant to this track's stories:

- **No ticket domain model exists yet.** `guardrail_config` is a new domain concept (see
  umbrella `shared-artifacts-registry.md`) requiring DESIGN-wave data modeling before DELIVER.
- **Existing OrgOps primitives must be reused, not duplicated.** The `trello-cli` skill
  already exists and should be extended, not replaced (see US-11 grounding notes).
- **Guardrail/governance policy is out of scope for Release 0 and Release 1.** US-12
  introduces the first governance-aware review step in Release 2, which is this track's
  release.
- **Platform is web**, not CLI/TUI — the ticket submitter interacts through the OrgOps UI and
  ticket-scoped channel views, never a terminal.

## Non-Functional Requirements (Applicable to This Track)

Full NFR list: umbrella `user-stories.md` `## Non-Functional Requirements`. The subset
directly relevant to this track's stories:

- **Performance**: Failure summary posted within 2 minutes of run termination (already an AC
  on US-13).
- **Scalability**: Two ticket submissions referencing the same underlying source-system item
  (e.g., two rapid Trello syncs of one card) must never create two ticket records or two
  channels for the same piece of work.
- **Concurrency and Race Conditions (added per peer review — see corresponding scenario in
  US-11 below)**: Two near-simultaneous Trello sync events for the same card must not create
  duplicate ticket records (US-11).

---

## US-11: Ticket Ingested From an External Board (Trello) Triggers the Same Flow as a Native Ticket

**Traces to Job Story**: Main Job Story; Supporting Job Story 1 (Define)

### Problem

Maria Santos already tracks all of Fenwick's work on the "Fenwick Product Backlog" Trello
board. Requiring her to use a separate OrgOps-native form for tickets she wants implemented
would mean maintaining two systems and re-entering information.

### Who

- Ticket submitters who already use Trello for backlog tracking | Filing a card as they
  normally would | Motivated by not wanting to learn or maintain a second tool

### Solution

Trello cards on a configured board are ingested (via the existing `trello-cli` skill) as
tickets, entering the same classification/confirmation/execution/monitoring flow as a
native-form ticket.

### Domain Examples

1. **Happy path**: Maria Santos adds a card "Add filter by region to Reports dashboard" to
   "Fenwick Product Backlog"; it is ingested as TICKET-1043 and follows the identical flow
   already validated by US-01 through US-10.
2. **Edge case**: A Trello card is moved between lists (not created) — ingestion correctly
   distinguishes "new card created" from "existing card moved," only triggering ingestion for
   new cards (or a configured trigger list).
3. **Error/boundary**: The Trello API is temporarily unreachable when a new card is added;
   ingestion retries and eventually succeeds, or surfaces a clear sync-failure state rather
   than silently missing the card.

### UAT Scenarios (BDD)

#### Scenario: New Trello card is ingested as a ticket
Given the "Fenwick Product Backlog" Trello board is configured for ingestion
When Maria Santos adds a card "Add filter by region to Reports dashboard"
Then a ticket record and ticket-scoped channel are created, identical in structure to a native-form submission

#### Scenario: Moving an existing card does not create a duplicate ticket
Given TICKET-1043 was already ingested from a Trello card
When that same card is moved to a different list on the board
Then no duplicate ticket record is created

#### Scenario: Ingestion recovers from a temporary Trello API outage
Given the Trello API is unreachable when a new card is added
When ingestion next runs after the API recovers
Then the card is ingested successfully
And no card is silently missed

#### Scenario: Ingested tickets follow the identical downstream flow
Given TICKET-1043 was ingested from Trello
When it proceeds through classification, confirmation, execution, and monitoring
Then it behaves identically to a ticket submitted via the native form (US-01 through US-07)

#### Scenario: Two near-simultaneous syncs of the same card do not create duplicate tickets
Given a scheduled poll and a manually-triggered re-sync both run within the same second for
the "Fenwick Product Backlog" board
When both syncs observe the same new card
Then only one ticket record and one ticket-scoped channel are created for that card

### Acceptance Criteria

- [ ] New cards on a configured Trello board are ingested as tickets automatically
- [ ] Card moves (not creations) do not create duplicate tickets
- [ ] Temporary Trello API outages are recovered from without silently missing cards
- [ ] Ingested tickets follow the same downstream flow as native-form tickets, with no
      special-casing visible to the submitter
- [ ] Concurrent/overlapping sync runs never create duplicate tickets for the same card

### Outcome KPIs

- **Who**: Submitters who already track work in Trello
- **Does what**: Get tickets implemented without leaving their existing tool
- **By how much**: >= 50% of implemented tickets in the first month post-release originate
  from Trello ingestion rather than the native form (adoption signal)
- **Measured by**: Ticket source field on ticket records
- **Baseline**: 0% (capability does not exist)

### Technical Notes (Optional)

- Reuses the existing `trello-cli` skill (`skills/trello-cli/`) as the read/polling path —
  this is largely a wiring/scheduling task (periodic poll or webhook, to be decided in
  DESIGN) rather than new integration capability.

---

## US-12: Ticket Submitter Reviews and Approves or Requests Changes to Completed Implementation

**Traces to Job Story**: Main Job Story; Supporting Job Story 8 (Conclude)

### Problem

Maria Santos's completion summary (US-06) tells her what happened, but she currently has no
formal way to say "this is good, ship it" or "this isn't right, here's what's missing" — and
Priya Nair has no governance checkpoint before autonomously-produced code goes further.

### Who

- Ticket submitters reviewing a completed run | At the moment of review | Motivated by
  wanting a clear decision point, not an open-ended "figure out what to do next"

### Solution

"Approve" and "Request changes" actions on the completion summary; approval marks the ticket
resolved, request-changes reopens the ticket with the submitter's specific feedback routed
back into a new (or resumed) implementation cycle, subject to `guardrail_config`.

### Domain Examples

1. **Happy path**: Maria Santos reviews TICKET-1043's completion summary, checks the branch,
   and selects "Approve" — the ticket is marked resolved.
2. **Edge case**: Devon Park selects "Request changes" on TICKET-1042 with the note "handles
   Safari but breaks on Firefox now" — a new cycle starts scoped to that specific feedback,
   not a full restart.
3. **Error/boundary**: Priya Nair reviews a completed run that touched a file outside the
   configured guardrail allowlist; the completion flow surfaces this as a governance
   exception requiring her explicit sign-off before "Approve" is available to Maria.

### UAT Scenarios (BDD)

#### Scenario: Submitter approves a completed implementation
Given TICKET-1043's completion summary shows 6/6 scenarios passed
When Maria Santos selects "Approve"
Then TICKET-1043 is marked resolved

#### Scenario: Submitter requests changes with specific feedback
Given TICKET-1042's completion summary is posted
When Devon Park selects "Request changes" and notes "handles Safari but breaks on Firefox now"
Then a new implementation cycle starts scoped to that feedback
And the original context/history is preserved, not discarded

#### Scenario: Guardrail exception requires governance sign-off before approval
Given a completed run touched a file outside the configured guardrail allowlist
When Priya Nair reviews the flagged exception
Then "Approve" is not available to Maria Santos until Priya provides explicit sign-off

#### Scenario: Approval and request-changes decisions are auditable
Given TICKET-1043 was approved by Maria Santos
When anyone with governance access reviews the ticket history
Then they can see who approved it and when

### Acceptance Criteria

- [ ] Completion summary offers "Approve" and "Request changes" actions
- [ ] Approval marks the ticket resolved and is auditable
- [ ] Request-changes starts a new cycle scoped to the specific feedback, preserving prior
      context
- [ ] Runs that touch files outside the configured guardrail allowlist require governance
      sign-off before submitter approval is available
- [ ] All approve/request-changes/sign-off actions are auditable with who and when

### Outcome KPIs

- **Who**: Submitters and governance reviewers (Priya Nair) at completion
- **Does what**: Reach a clear resolved/needs-changes decision without ambiguity
- **By how much**: 100% of completed runs reach an explicit approve or request-changes
  decision within 3 business days (no tickets left in permanent limbo)
- **Measured by**: Timestamp delta between completion and decision event; count of tickets
  exceeding the 3-day threshold
- **Baseline**: N/A (capability does not exist)

### Technical Notes (Optional)

- First story requiring `guardrail_config` to exist as a real, checkable ruleset — DESIGN
  must define where this configuration lives (see umbrella `shared-artifacts-registry.md`).

---

## US-13: Failed or Stuck Implementation Runs Are Surfaced With Recovery Options

**Traces to Job Story**: Main Job Story; Supporting Job Story 6 (Monitor); Supporting Job
Story 8 (Conclude)

### Problem

Runs will sometimes fail outright or genuinely get stuck (not just paused for input). Maria
Santos needs to know this happened and what she can do about it — the single worst outcome
in this entire journey is dead silence after a failure.

### Who

- Ticket submitters whose run has failed or stalled beyond a reasonable threshold | At the
  moment of failure/detection | Motivated by wanting to be supported, not blamed, and to know
  what happens next

### Solution

Failed runs post a non-blaming failure summary explaining what completed, what failed, and a
suggested next step (retry, escalate to a human developer, or close the ticket); runs with no
activity beyond a defined threshold are proactively flagged as possibly-stuck rather than
waiting indefinitely for the submitter to notice.

### Domain Examples

1. **Happy path (failure)**: TICKET-1042's run fails during the DELIVER wave; within 2
   minutes, Devon Park sees a summary of what was completed, what failed, and a "Retry" option.
2. **Edge case (stuck detection)**: TICKET-1043's run has produced no activity for 30 minutes
   during what is normally a 5-minute wave; the system proactively flags it as possibly stuck
   rather than waiting for Maria to notice via US-05.
3. **Error/boundary**: A run fails repeatedly on retry (e.g., an environment issue outside
   the ticket's own scope); after 2 failed retries, the system stops offering "Retry" and
   instead suggests escalating to a human developer with the accumulated failure context
   attached.

### UAT Scenarios (BDD)

#### Scenario: Failed run produces a clear, non-blaming summary
Given TICKET-1042's implementation run fails during the DELIVER wave
When the run terminates
Then a failure summary is posted to the ticket channel within 2 minutes
And it explains what was completed, what failed, and a suggested next step
And Devon Park is never shown a raw stack trace without plain-language context

#### Scenario: A stalled run is proactively flagged, not silently left
Given TICKET-1043's run has produced no activity for 30 minutes during a wave that typically takes 5 minutes
When the staleness threshold is exceeded
Then the run is proactively flagged as possibly stuck in the ticket channel
And Maria Santos does not have to notice this herself via the raw activity signal alone

#### Scenario: Repeated failures escalate instead of looping forever
Given TICKET-1046's run has failed and been retried twice with the same underlying error
When the third failure occurs
Then "Retry" is no longer offered
And the system suggests escalating to a human developer with the accumulated failure context attached

#### Scenario: Submitter can retry a failed run with one action
Given TICKET-1042's run failed once with a transient error
When Devon Park selects "Retry"
Then a new run starts using the same confirmed ticket intent, without re-entering information

### Acceptance Criteria

- [ ] Every failed run posts a non-blaming summary within 2 minutes of termination
- [ ] Summary includes what completed, what failed, and a suggested next step
- [ ] Raw stack traces are never shown without plain-language context
- [ ] Runs stalled beyond a defined threshold are proactively flagged, not left for the
      submitter to discover
- [ ] After a defined number of repeated failures, the system stops offering retry and
      suggests human escalation with context attached

### Outcome KPIs

- **Who**: Submitters whose runs fail or stall
- **Does what**: Receive proactive, actionable notice instead of discovering the problem
  themselves
- **By how much**: 0% of failed/stalled runs go undetected by the submitter for more than 10
  minutes past the point the system itself could detect the issue
- **Measured by**: Timestamp delta between failure/staleness detection and submitter
  notification
- **Baseline**: N/A (capability does not exist)

### Technical Notes (Optional)

- Staleness threshold should be relative to typical wave duration (which will vary
  significantly by ticket complexity), not a single fixed value — DESIGN-wave concern, likely
  informed by data gathered during `progress-trust-ux`'s Release 0/Release 1 operation.
