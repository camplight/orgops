<!-- markdownlint-disable MD024 -->
# User Stories: nWave Ticket Execution Engine

Every story below traces to the Main Job Story and at least one of the 8 supporting job
stories in `jtbd-job-stories.md`. Personas: Maria Santos (Senior Product Manager), Devon Park
(Support Engineer), Carlos Mendes (Customer Success Manager) — all at Fenwick Analytics — as
submitters; Priya Nair (Engineering Lead) as governance stakeholder.

## System Constraints

Cross-cutting constraints that apply to every story in this feature:

- **Invocation mechanism is unresolved.** Every story that touches "trigger/execute an nWave
  run" (US-04 and everything downstream) must be written against the *observable contract*
  (a run starts, produces wave-progress signal, and terminates with a result) and must not
  assume a specific mechanism (WRAPPED command harness, a new harness type, or otherwise).
  Resolved by a SPIKE before DESIGN — see `wave-decisions.md`.
- **No ticket domain model exists yet.** `ticket_id`, `classification_result`, `run_id`,
  `wave_status`, and `guardrail_config` are all new domain concepts (see
  `shared-artifacts-registry.md`) requiring DESIGN-wave data modeling before DELIVER.
- **Existing OrgOps primitives must be reused, not duplicated.** Channels, events, WebSocket
  topics, `processes`/`process_output`, and the `trello-cli` skill already exist and should be
  extended rather than replaced (see grounding notes throughout this document).
- **Guardrail/governance policy is out of scope for Release 0 and Release 1.** Auto-trigger
  in the walking skeleton and Release 1 runs with an implicit, engineering-controlled trust
  boundary (e.g., a fixed allowlist of test repos), not a submitter-configurable one. US-12
  introduces the first governance-aware review step in Release 2.
- **Platform is web**, not CLI/TUI — the ticket submitter interacts through the OrgOps UI and
  ticket-scoped channel views, never a terminal.

## Non-Functional Requirements

Per `nw-bdd-requirements`' completeness check (functional + NFR + business rules), and added
in response to peer review (see `dor-validation.md` — DISCUSS-wave provisional targets;
DESIGN wave is the authoritative source and must confirm or revise these against real
infrastructure constraints, especially pending the SPIKE).

### Performance

- Classification result posted within 60 seconds of ticket submission (already an AC on
  US-02).
- Mid-run acknowledgment posted within 60 seconds of a submitter message (already an AC on
  US-08).
- Failure summary posted within 2 minutes of run termination (already an AC on US-13).
- Progress UI ("Last activity", wave status) updates within 5 seconds of a new underlying
  event, via existing WebSocket infrastructure — no polling-only fallback should exceed 30
  seconds of staleness.

### Scalability

- The walking skeleton (Release 0) must support at least 5 concurrent active implementation
  runs without classification or progress-signal degradation (Fenwick Analytics' realistic
  weekly ticket volume, per `jtbd-job-stories.md`: 8-12 tickets/week from Maria alone).
  Release 1/2 targets should be re-set once real usage data exists (see
  `outcome-kpis.md` validation caveat).
- Two ticket submissions referencing the same underlying source-system item (e.g., two rapid
  Trello syncs of one card, or a double-click per US-01) must never create two ticket
  records or two channels for the same piece of work.

### Reliability

- At-least-once delivery for channel messages and wave-progress events (OrgOps' existing
  event-bus guarantee — see `docs/SPEC.md` "Delivery and Failure Semantics"); no story in
  this feature should require a stronger guarantee than the platform already provides.
- Halt/pause requests (US-09) must never corrupt in-progress artifact state — zero tolerance,
  not a percentage target (see US-09 Outcome KPIs).
- A paused-for-input run (US-10) must survive at least 7 days without state loss or
  destructive timeout, since submitters may be unavailable (PTO, weekends) longer than a
  single business day.

### Accessibility

- The OrgOps UI ticket dashboard and channel view for this feature follow the same WCAG 2.2
  AA baseline as the rest of OrgOps' UI (per `nw-ux-principles`): 4.5:1 contrast, full
  keyboard operability for Approve/Request Changes/Pause/Halt controls, visible focus
  indicators, and screen-reader-compatible status announcements for wave-status changes
  (live-region semantics for progress updates, not purely visual).

### Concurrency and Race Conditions (added per peer review — see corresponding scenarios in
US-08, US-09, and US-11 below)

- Two concurrent mid-run messages from the same submitter must both be acknowledged, not
  silently merged or overwritten (US-08).
- A pause/halt request arriving at the same moment as a mid-run note must not cause either to
  be dropped (US-09).
- Two near-simultaneous Trello sync events for the same card must not create duplicate ticket
  records (US-11).

---

## US-01: Submit a Development Ticket via OrgOps-Native Form

**Traces to Job Story**: Main Job Story; Supporting Job Story 1 (Define)

### Problem

Maria Santos is a Senior Product Manager at Fenwick Analytics who currently has no single
place to hand off a piece of work and trust it will be picked up without her personally
tracking down a developer. She needs a way to describe what she wants built once, in a
structured way, and have the system take it from there.

### Who

- Product managers, support engineers, and customer success staff at a company using OrgOps
  internally | Filing work requests they cannot implement themselves | Motivated by wanting
  fast, reliable turnaround without interrupting a specific person's calendar

### Solution

An OrgOps-native ticket submission form (title + description + source selector) that creates
a ticket record and a dedicated, subscribed channel for that ticket.

### Domain Examples

1. **Happy path**: Maria Santos submits "Add filter by region to Reports dashboard" with a
   two-paragraph description. A ticket record `TICKET-1043` is created and she is
   auto-subscribed to its new channel.
2. **Edge case**: Devon Park submits a ticket with only a title and no description ("Export
   CSV bug"). The ticket is still created, but flagged as low-detail for the classification
   step to handle (see US-08 dependency in Release 1).
3. **Error/boundary**: Carlos Mendes double-clicks "Submit Ticket" and the form is submitted
   twice. Only one ticket record and one channel are created (idempotent submission).

### UAT Scenarios (BDD)

#### Scenario: Ticket submission creates a ticket record and a subscribed channel
Given Maria Santos is signed into OrgOps
When she submits a ticket titled "Add filter by region to Reports dashboard" with a description
Then a ticket record is created with a unique ticket id
And a ticket-scoped channel is created
And Maria is subscribed to that channel

#### Scenario: Ticket with no description is still accepted
Given Devon Park is signed into OrgOps
When he submits a ticket titled "Export CSV bug" with no description
Then the ticket record is created successfully
And the ticket is flagged as low-detail for downstream handling

#### Scenario: Duplicate submission does not create duplicate tickets
Given Carlos Mendes has filled out the ticket form
When he clicks "Submit Ticket" twice within one second
Then only one ticket record is created
And only one ticket-scoped channel is created

#### Scenario: Submitter can find their ticket after submission
Given Maria Santos has submitted TICKET-1043
When she navigates to the OrgOps ticket dashboard
Then TICKET-1043 appears in her list of submitted tickets

### Acceptance Criteria

- [ ] Submitting the form creates exactly one ticket record with a unique id
- [ ] Submitting the form creates exactly one ticket-scoped channel and subscribes the
      submitter
- [ ] A ticket with a blank description is still accepted and flagged as low-detail
- [ ] Double-submission within a short window does not create duplicate records
- [ ] Submitted tickets are visible in the submitter's ticket dashboard list

### Outcome KPIs

- **Who**: Ticket submitters at a company using OrgOps (product managers, support engineers)
- **Does what**: Successfully create a ticket and land on its channel without external help
- **By how much**: 95% of ticket submissions succeed on the first attempt (no support request
  needed)
- **Measured by**: Ticket creation success rate / failed submission attempts logged
- **Baseline**: 0% (capability does not exist)

### Technical Notes (Optional)

- Reuses existing OrgOps channel creation and subscription primitives — no new channel
  infrastructure needed.
- New: ticket record data model (DESIGN wave).

---

## US-02: Automatic Classification Distinguishes Development Work From Other Ticket Types

**Traces to Job Story**: Main Job Story; Supporting Job Story 2 (Locate)

### Problem

Maria Santos has no way to know, without waiting days for a human to look at her ticket,
whether it's the kind of work an autonomous implementation engine can handle at all. A
content-only request like updating pricing page copy should never sit in a dev-work queue
waiting for code to be written.

### Who

- All ticket submitters | Immediately after submitting a ticket | Motivated by wanting to
  know quickly whether they're in the right queue, without guessing

### Solution

An automatic classification step that runs after ticket intake and produces a binary
decision (development work / not development work) with a stated rationale, posted to the
ticket's channel.

### Domain Examples

1. **Happy path**: Devon Park's TICKET-1042 ("Export to CSV button throws 500 error on
   Safari") is classified as DEVELOPMENT WORK — testable bug, clear reproduction context.
2. **Edge case**: Maria Santos's TICKET-1044 ("Update Q3 pricing page copy") is classified as
   NOT DEVELOPMENT WORK — content-only language detected, no testable code-level outcome.
3. **Error/boundary**: Devon Park's TICKET-1045 ("Investigate why nightly sync job is 40 min
   slower this week") produces a low-confidence classification (ambiguous — could be an
   investigation task or a code fix) and is flagged for human confirmation rather than
   auto-routed either way.

### UAT Scenarios (BDD)

#### Scenario: Clear bug report is classified as development work
Given Devon Park has submitted TICKET-1042 "Export to CSV button throws 500 error on Safari"
When the classification step runs
Then TICKET-1042 is classified as "DEVELOPMENT WORK" with a stated rationale

#### Scenario: Content-only ticket is classified away from development work
Given Maria Santos has submitted TICKET-1044 "Update Q3 pricing page copy"
When the classification step runs
Then TICKET-1044 is classified as "NOT DEVELOPMENT WORK" with a stated rationale

#### Scenario: Ambiguous ticket produces a low-confidence result requiring confirmation
Given Devon Park has submitted TICKET-1045 "Investigate why nightly sync job is 40 min slower this week"
When the classification step runs
Then the classification result is marked "low confidence"
And the ticket is flagged for human confirmation instead of being auto-routed

#### Scenario: Classification runs automatically without submitter action
Given Carlos Mendes has just submitted TICKET-1046
When 60 seconds have passed
Then a classification result has been posted without Carlos needing to trigger it manually

#### Scenario: Classification failure is surfaced, not silently dropped
Given Maria Santos has submitted a ticket
When the classification step encounters an internal error and cannot produce a result
Then Maria is shown a message that classification failed and what will happen next
And the ticket is not silently left in limbo

### Acceptance Criteria

- [ ] Every submitted ticket receives a classification result within 60 seconds
- [ ] Classification result is one of: DEVELOPMENT WORK, NOT DEVELOPMENT WORK, or LOW
      CONFIDENCE (requires human confirmation)
- [ ] Every classification result includes a plain-language rationale
- [ ] Classification failures are surfaced to the submitter, never silent
- [ ] Low-confidence results do not auto-trigger implementation

### Outcome KPIs

- **Who**: Ticket submitters
- **Does what**: Receive an accurate classification without manual triage
- **By how much**: >= 90% classification accuracy against a human-reviewed sample of 50
  tickets (validate post-Release-0; see `wave-decisions.md` risk on unvalidated JTBD priors)
- **Measured by**: Human-reviewed classification accuracy sample; count of misclassification
  corrections (US-03)
- **Baseline**: 0% (capability does not exist)

### Technical Notes (Optional)

- New domain concept: classification decision event and its persistence.
- Depends on ticket content (US-01) being available before classification runs.

---

## US-03: Ticket Submitter Sees Classification Result and Can Correct It

**Traces to Job Story**: Main Job Story; Supporting Job Story 2 (Locate)

### Problem

Even a mostly-accurate classifier will sometimes get it wrong, and Maria Santos needs a way
to catch and correct a misclassification before it either wastes engine time or silently
drops real development work into the wrong queue.

### Who

- Ticket submitters, immediately after classification | Motivated by wanting the last word on
  whether their ticket is handled correctly

### Solution

The classification result and rationale are posted to the ticket's channel with a visible
option for the submitter (or Priya Nair, for governance oversight) to override it.

### Domain Examples

1. **Happy path**: Maria Santos sees TICKET-1043 classified correctly as DEVELOPMENT WORK and
   takes no action — classification stands.
2. **Edge case**: Maria Santos sees TICKET-1044 ("Update Q3 pricing page copy") correctly
   classified as NOT DEVELOPMENT WORK, and the message tells her it should go to the
   marketing team instead.
3. **Error/boundary**: Devon Park sees a bug report he filed misclassified as NOT
   DEVELOPMENT WORK (classifier missed the technical detail buried in paragraph three). He
   overrides it to DEVELOPMENT WORK and implementation proceeds.

### UAT Scenarios (BDD)

#### Scenario: Submitter sees the classification rationale in the ticket channel
Given TICKET-1043 has been classified as DEVELOPMENT WORK
When Maria Santos opens the ticket channel
Then she sees the classification result and its rationale

#### Scenario: Non-development classification tells the submitter where to route instead
Given TICKET-1044 has been classified as NOT DEVELOPMENT WORK
When Maria Santos reads the classification message
Then she is told this ticket type should be routed to a different team/process

#### Scenario: Submitter overrides a misclassification
Given TICKET-1042 was classified as NOT DEVELOPMENT WORK
When Devon Park selects "Override: this is development work"
Then the classification is updated to DEVELOPMENT WORK
And the implementation trigger step (US-04) becomes available for TICKET-1042

#### Scenario: Override is auditable
Given Devon Park has overridden a classification for TICKET-1042
When Priya Nair reviews the ticket's classification history
Then she can see the original classification, the override, and who made it

### Acceptance Criteria

- [ ] Classification result and rationale are visible in the ticket channel for every ticket
- [ ] Non-development classifications include a routing suggestion
- [ ] Submitters can override a classification result
- [ ] Overrides are recorded with who made them and when, visible to governance review

### Outcome KPIs

- **Who**: Ticket submitters
- **Does what**: Catch and correct misclassifications without contacting support
- **By how much**: 100% of overrides are self-service (zero requiring a manual database
  correction)
- **Measured by**: Count of self-service overrides vs. manual interventions logged
- **Baseline**: 0% (capability does not exist)

### Technical Notes (Optional)

- Override must not be silently possible for anyone other than the submitter or an
  authorized governance role (Priya Nair) — access control detail for DESIGN.

---

## US-04: nWave Implementation Run Is Triggered for a Classified Development Ticket

**Traces to Job Story**: Main Job Story; Supporting Job Story 3 (Prepare); Supporting Job
Story 4 (Confirm); Supporting Job Story 5 (Execute)

### Problem

Once Maria Santos's ticket is confirmed as development work, she needs implementation to
actually start — automatically, without her manually invoking anything — but she also needs
a moment to confirm the system understood her intent before hours of engine time are spent
on the wrong thing.

### Who

- Ticket submitters with a confirmed DEVELOPMENT WORK classification | At the moment
  implementation is about to begin | Motivated by wanting to hand off and walk away with
  confidence

### Solution

The system posts a plain-language restatement of the ticket's intent; once the submitter
confirms (or corrects), an nWave implementation run is triggered. **The specific invocation
mechanism is not defined by this story** — see System Constraints and `wave-decisions.md`.
This story's acceptance criteria are written against the observable contract only: a run
starts, is identified by a stable `run_id`, and begins emitting wave-progress signal.

### Domain Examples

1. **Happy path**: For TICKET-1043, the system posts "Adds a region filter dropdown to the
   Reports dashboard, defaulting to the viewer's home region." Maria Santos confirms "Looks
   right," and a run starts with `run_id = RUN-8841`.
2. **Edge case**: For TICKET-1046 ("Add Slack notification when invoice payment fails"), the
   restatement omits which Slack channel to notify. Carlos Mendes selects "Not quite," adds
   the missing detail, and the run does not start until re-confirmed.
3. **Error/boundary**: The invocation mechanism is temporarily unavailable (e.g., the
   underlying execution environment cannot be reached). The submitter is told the run could
   not start and is not left thinking implementation is in progress when it is not.

### UAT Scenarios (BDD)

#### Scenario: Confirmed intent triggers an implementation run
Given TICKET-1043 has been classified as development work
When the system posts its plain-language restatement and Maria Santos confirms "Looks right"
Then an nWave implementation run starts for TICKET-1043
And the run is identified by a stable run id

#### Scenario: Submitter corrects a misunderstood restatement before execution starts
Given TICKET-1046 has been classified as development work
When the system posts a restatement missing the target Slack channel
And Carlos Mendes selects "Not quite" and adds the missing detail
Then implementation does not start until the corrected understanding is confirmed

#### Scenario: Submitter is told clearly if the run cannot be started
Given TICKET-1043's intent has been confirmed
When the underlying execution environment is unavailable
Then Maria Santos is told the run could not start
And she is not shown any progress signal implying work is underway

#### Scenario: Run id remains stable for the life of the run
Given an implementation run has started for TICKET-1043 with run id RUN-8841
When the run progresses through multiple waves
Then every progress message for TICKET-1043 references run id RUN-8841

### Acceptance Criteria

- [ ] A plain-language restatement of ticket intent is posted before any run starts
- [ ] Submitter confirmation is required before a run starts
- [ ] Submitter correction prevents the run from starting until re-confirmed
- [ ] A started run has a stable, unique run id used consistently in all later messages
- [ ] A failed trigger attempt is clearly communicated, never silently treated as "in
      progress"

### Outcome KPIs

- **Who**: Ticket submitters with confirmed development-work tickets
- **Does what**: Move from confirmed ticket to a running implementation without manual setup
- **By how much**: Median time from confirmation to run start < 2 minutes (once mechanism is
  validated — target to be refined after SPIKE)
- **Measured by**: Timestamp delta between confirmation event and run-start event
- **Baseline**: N/A (capability does not exist; SPIKE required before a defensible baseline
  or target can be set — see `wave-decisions.md`)

### Technical Notes (Optional)

- **Blocked pending SPIKE**: invocation mechanism must be validated before DESIGN can commit
  to an implementation approach. Candidates to evaluate include (not a decision): extending
  the `WRAPPED` agent `command` harness, a new harness type with mid-run streaming support,
  or an entirely different orchestration path. See `apps/agent-runner/src/wrapper-harness/
  command.ts` for the harness contract that any candidate must satisfy or extend.
- The existing `command` harness's `runTurn` is blocking and single-shot (captures
  stdout/stderr only at process exit) — it does not natively support the mid-run
  wave-progress streaming this feature depends on (US-05/US-07). This gap must be resolved by
  the SPIKE, not assumed away here.

---

## US-05: Ticket Submitter Sees a Live "It's Working" Signal While Implementation Runs

**Traces to Job Story**: Main Job Story; Supporting Job Story 6 (Monitor)

### Problem

Once Maria Santos hands off her ticket, she has no way to tell whether the implementation is
actually progressing or has silently died, short of staring at a spinner with no information
— which is precisely the "is it stuck?" anxiety this feature exists to solve.

### Who

- Ticket submitters with an active implementation run | Checking in at any point during
  execution | Motivated by needing reassurance without needing to interrupt anyone

### Solution

The ticket channel shows a live activity indicator (raw process output stream plus a "last
activity" timestamp) sourced from the run's real, underlying process/event stream.

### Domain Examples

1. **Happy path**: Maria Santos opens TICKET-1043's channel at 11:30am and sees "Last
   activity: 90 seconds ago" with a link to view raw output.
2. **Edge case**: Devon Park checks TICKET-1042 five hours into a long run and sees activity
   as recent as expected for a run that size — reassuring even though it's still not done.
3. **Error/boundary**: Carlos Mendes checks TICKET-1046 and sees "Last activity: 47 minutes
   ago" with no new output — a genuinely stalled run is visibly distinguishable from an
   active one, rather than both looking identical.

### UAT Scenarios (BDD)

#### Scenario: Submitter sees a real, current activity signal
Given an nWave implementation run is active for TICKET-1043
When Maria Santos opens the ticket channel
Then she sees a "Last activity" timestamp reflecting the real underlying process/event stream

#### Scenario: Raw output is available on demand
Given Maria Santos is viewing the "Last activity" indicator for TICKET-1043
When she selects "View raw output"
Then she sees the underlying process output stream for the active run

#### Scenario: A stalled run is visibly distinguishable from an active one
Given TICKET-1046's run has produced no output for 45 minutes
When Carlos Mendes opens the ticket channel
Then the "Last activity" timestamp clearly shows the staleness (e.g., "47 minutes ago")
And it does not imply recent activity that did not happen

#### Scenario: Activity signal updates without requiring a page refresh
Given Maria Santos has the ticket channel open in her browser
When new process output is recorded for the active run
Then the "Last activity" timestamp updates without her needing to reload the page

### Acceptance Criteria

- [ ] "Last activity" timestamp is always sourced from a real, current event — never a
      hardcoded or estimated value
- [ ] Raw output is viewable on demand from the ticket channel
- [ ] A run with no recent output is visibly distinguishable from an actively progressing run
- [ ] The activity signal updates in real time (WebSocket-driven), no manual refresh required

### Outcome KPIs

- **Who**: Submitters with an active implementation run
- **Does what**: Check progress and receive real, current signal
- **By how much**: 0% of submitters report inability to tell if a run is stuck vs. progressing
  (post-Release-0 survey of at least 5 submitters)
- **Measured by**: Post-run survey question + count of "is my ticket stuck?" support requests
- **Baseline**: 100% uncertainty (no visibility exists today)

### Technical Notes (Optional)

- Reuses OrgOps' existing `processes`/`process_output` tables and `process:<processId>`
  WebSocket topic — this is a composition of existing primitives, not new infrastructure,
  *provided* the invocation mechanism (US-04) actually produces a trackable process. If the
  SPIKE selects a mechanism that does not naturally produce process-level output (e.g., a
  fully external service), this story's technical approach needs revisiting.

---

## US-06: Ticket Submitter Receives a Completion Summary With Links to Produced Work

**Traces to Job Story**: Main Job Story; Supporting Job Story 8 (Conclude)

### Problem

When implementation finishes, Maria Santos needs a clear, verifiable summary of what changed
and where — not a diff she has to reverse-engineer, and not silence.

### Who

- Ticket submitters whose implementation run has finished | At the moment of completion |
  Motivated by wanting to verify the result quickly and with confidence

### Solution

A completion message posted to the ticket channel with a plain-language summary, a link to
the produced branch/PR, and a count of acceptance scenarios passed.

### Domain Examples

1. **Happy path**: TICKET-1043 completes; Maria Santos sees "Added a region filter dropdown,
   defaulting to the viewer's home region. 6/6 scenarios passed." with a branch link.
2. **Edge case**: TICKET-1046 completes with 5/6 scenarios passed — the summary states which
   scenario did not pass rather than rounding up to "done."
3. **Error/boundary**: TICKET-1042's run finishes with zero producible artifacts because it
   was misclassified after all (edge case discovered mid-run) — the summary explains this
   plainly rather than showing a broken/empty link.

### UAT Scenarios (BDD)

#### Scenario: Submitter receives a verifiable completion summary
Given the implementation run for TICKET-1043 has finished successfully
When the system posts the completion summary to the ticket channel
Then the summary includes a plain-language description of what changed
And a link to the branch/PR produced
And the count of acceptance scenarios passed, traceable to the run's defined scenarios

#### Scenario: Partial scenario pass is reported honestly
Given the implementation run for TICKET-1046 finishes with 5 of 6 scenarios passing
When the completion summary is posted
Then it states 5/6 scenarios passed and names the scenario that did not pass

#### Scenario: A run with no producible artifact still gets a clear summary
Given the implementation run for TICKET-1042 finishes without producing a branch
When the completion summary is posted
Then it explains why no artifact was produced
And it does not show a broken or placeholder link

#### Scenario: Completion summary claims are traceable
Given TICKET-1043's completion summary states "6/6 scenarios passed"
When Maria Santos inspects the linked branch/PR
Then she can trace each of the 6 scenarios to ones defined earlier in the run

### Acceptance Criteria

- [ ] Every completed run posts a completion summary to the ticket channel
- [ ] Summary includes a plain-language description of what changed
- [ ] Summary includes a working link to the produced branch/PR (or a clear explanation if
      none was produced)
- [ ] Scenario pass count is accurate and traceable, never rounded up

### Outcome KPIs

- **Who**: Submitters whose runs have completed
- **Does what**: Verify completed work without reading a raw diff unassisted
- **By how much**: Median time-to-verify (open summary to decision) < 5 minutes
- **Measured by**: Timestamp delta between completion message and submitter's approve/
  request-changes action (from US-12, once that exists) or manual timing in earlier releases
- **Baseline**: N/A (capability does not exist)

### Technical Notes (Optional)

- Depends on DELIVER-wave output format being predictable enough to extract branch/PR
  references and scenario pass/fail counts programmatically — a DESIGN-wave concern.

---

## US-07: Ticket Submitter Sees Wave-by-Wave Progress Instead of Raw Output Only

**Traces to Job Story**: Main Job Story; Supporting Job Story 6 (Monitor)

### Problem

Raw process output (from US-05) proves something is happening, but Maria Santos cannot
easily tell *what stage* the work is at without reading noisy logs — she needs a curated
summary she can glance at.

### Who

- Ticket submitters with an active run | Checking progress without wanting to parse raw logs
  | Motivated by wanting a quick, meaningful status check

### Solution

A curated wave-status display (DISCUSS / DESIGN / DISTILL / DELIVER, each with completion
state and a short description) layered above the raw output stream from US-05.

### Domain Examples

1. **Happy path**: Maria Santos sees "DISCUSS wave complete (4 min) — 6 scenarios defined.
   DESIGN wave in progress — drafted 4 minutes ago."
2. **Edge case**: A run that skips DISTILL for a trivial one-line fix shows DISTILL as "not
   required for this ticket" rather than "pending" forever.
3. **Error/boundary**: A run stuck in DESIGN for 90 minutes (longer than Maria's other
   tickets typically take) is visually flagged as taking longer than usual rather than
   looking identical to a normally-progressing run.

### UAT Scenarios (BDD)

#### Scenario: Wave status reflects real, current run state
Given an nWave implementation run is active for TICKET-1043
When Maria Santos opens the ticket channel at any point during the run
Then the displayed wave status matches the run's actual current wave

#### Scenario: Skipped wave is shown as skipped, not perpetually pending
Given TICKET-1046's run determines DISTILL is not required for a one-line fix
When Maria Santos views the wave status
Then DISTILL is shown as "not required for this ticket," not "pending"

#### Scenario: Unusually long wave duration is flagged
Given TICKET-1043's run has been in the DESIGN wave for 90 minutes, longer than typical
When Maria Santos views the wave status
Then the DESIGN wave is visually flagged as taking longer than usual

#### Scenario: Curated view links back to raw output for detail
Given Maria Santos is viewing curated wave-by-wave progress
When she wants more detail than the curated summary provides
Then she can select "View raw output" and see the full stream from US-05

### Acceptance Criteria

- [ ] Wave status always reflects the run's actual current wave (property-shaped — see
      `@property` scenario in the journey `.feature` file)
- [ ] Skipped waves are labeled distinctly from pending waves
- [ ] Waves running longer than a typical baseline are visually flagged
- [ ] Curated view links to the raw output stream

### Outcome KPIs

- **Who**: Submitters with an active run
- **Does what**: Understand run stage without reading raw logs
- **By how much**: >= 80% of submitters report the curated view alone is sufficient to
  understand progress (post-Release-1 survey)
- **Measured by**: Post-run survey; ratio of "view raw output" clicks to total progress checks
  (lower ratio over time = curated view sufficient)
- **Baseline**: 0% (raw output only, per Release 0)

### Technical Notes (Optional)

- Requires nWave's wave pipeline to emit distinguishable per-wave start/complete signals that
  agent-runner can capture and translate into `wave_status` events — depends on the SPIKE's
  chosen invocation mechanism actually exposing this level of granularity.

---

## US-08: Ticket Submitter Can Ask a Clarifying Question Mid-Run and Get a Response

**Traces to Job Story**: Main Job Story; Supporting Job Story 7 (Modify)

### Problem

Maria Santos sometimes realizes new information partway through a run (e.g., a missed
constraint) and today has no way to inject it without the note being lost or ignored.

### Who

- Ticket submitters with an active run | At any point mid-execution | Motivated by wanting to
  redirect without restarting or losing progress

### Solution

Submitters can post a message into the ticket channel at any time; the system acknowledges
receipt and states when/how it will be incorporated.

### Domain Examples

1. **Happy path**: Maria Santos posts "the region filter should default to the viewer's home
   region" during the DESIGN wave of TICKET-1043; the system acknowledges and states it will
   be picked up before DELIVER starts.
2. **Edge case**: Devon Park asks a genuine question ("does this need to work on Safari too,
   or just Chrome?") rather than a directive; the system acknowledges and indicates the
   question will inform DISTILL's scenario set.
3. **Error/boundary**: Maria Santos posts a note that contradicts an assumption already
   locked in during a completed wave (e.g., DESIGN already assumed server-side filtering, her
   note now requires client-side) — the system tells her this requires revisiting completed
   work rather than silently absorbing a contradiction.

### UAT Scenarios (BDD)

#### Scenario: Mid-run note is acknowledged with a concrete pickup point
Given an nWave implementation run for TICKET-1043 is in the DESIGN wave
When Maria Santos posts "the region filter should default to the viewer's home region"
Then the system acknowledges the message in the same channel
And the acknowledgment states which wave will incorporate the note

#### Scenario: A genuine question is acknowledged distinctly from a directive
Given TICKET-1042's run is in the DISTILL wave
When Devon Park asks "does this need to work on Safari too, or just Chrome?"
Then the system acknowledges the question
And indicates how/when it will be addressed (e.g., informing scenario coverage)

#### Scenario: Submitter is warned when a note conflicts with completed work
Given TICKET-1043's run has already completed the DESIGN wave with a server-side filtering assumption
When Maria Santos posts a note requiring client-side filtering instead
Then the system tells her this note requires revisiting completed work
And states the impact (e.g., DESIGN wave will be redone) before proceeding

#### Scenario: Unacknowledged messages never occur
Given any message is posted into an active ticket channel by the submitter
When 60 seconds have passed
Then an acknowledgment has been posted

#### Scenario: Two concurrent mid-run messages are both acknowledged
Given TICKET-1043's run is in the DESIGN wave
When Maria Santos posts two distinct messages within the same second (e.g., from two open
browser tabs)
Then both messages receive their own acknowledgment
And neither message is silently merged into or overwritten by the other

### Acceptance Criteria

- [ ] Every submitter message during an active run receives an acknowledgment within 60
      seconds
- [ ] Acknowledgment states which wave/step will incorporate the note
- [ ] Notes conflicting with already-completed work trigger an explicit impact warning, not
      silent absorption
- [ ] Questions are distinguishable from directives in how they're acknowledged
- [ ] Concurrent messages from the same submitter are each acknowledged individually, never
      merged or dropped

### Outcome KPIs

- **Who**: Submitters with an active run who post a mid-run message
- **Does what**: Receive a timely, concrete acknowledgment
- **By how much**: 100% of mid-run messages acknowledged within 60 seconds (zero silent
  drops)
- **Measured by**: Timestamp delta between message post and acknowledgment event
- **Baseline**: N/A (capability does not exist)

### Technical Notes (Optional)

- Depends on the invocation mechanism (US-04/SPIKE) supporting mid-run message injection —
  this is a second capability the SPIKE must validate, not just one-shot triggering.

---

## US-09: Ticket Submitter Can Pause or Halt a Running Implementation

**Traces to Job Story**: Main Job Story; Supporting Job Story 7 (Modify)

### Problem

Sometimes a note isn't enough — Maria Santos needs to be able to stop a run entirely when
she sees it's clearly heading the wrong direction, rather than letting it burn hours before
she can act.

### Who

- Ticket submitters with an active run they believe is going wrong | At the moment they
  decide to act | Motivated by wanting a hard stop, not just a note that might be too late

### Solution

A visible "Pause" and "Halt" control in the ticket channel; pausing suspends work at the next
safe checkpoint, halting terminates the run and preserves whatever partial output exists.

### Domain Examples

1. **Happy path**: Maria Santos selects "Halt" on TICKET-1043 after realizing the ticket
   itself was wrong; the run stops at the next safe checkpoint and a partial-work summary is
   posted.
2. **Edge case**: Devon Park selects "Pause" mid-run to go check something with a colleague,
   then resumes 20 minutes later — the run picks up where it left off.
3. **Error/boundary**: Carlos Mendes selects "Halt" while the run is mid-write to a file; the
   system waits for the current safe checkpoint rather than corrupting partial output.

### UAT Scenarios (BDD)

#### Scenario: Halting a run stops it and preserves partial output
Given TICKET-1043's implementation run is in the DESIGN wave
When Maria Santos selects "Halt"
Then the run stops at the next safe checkpoint
And a summary of partial work completed so far is posted to the ticket channel

#### Scenario: Pausing a run allows resuming later
Given TICKET-1042's implementation run is active
When Devon Park selects "Pause"
Then the run suspends at the next safe checkpoint
And when he selects "Resume" 20 minutes later, the run continues from where it left off

#### Scenario: Halt request does not corrupt in-progress work
Given TICKET-1046's run is mid-write to a file when Halt is requested
When the halt is processed
Then the system waits for the current safe checkpoint before stopping
And no partial/corrupted file state is left behind

#### Scenario: Halt/Pause controls are only available to the ticket's submitter or governance role
Given TICKET-1043's channel is visible to other Fenwick Analytics employees
When someone other than Maria Santos or Priya Nair views the channel
Then they do not see functioning Halt/Pause controls for that ticket

#### Scenario: A pause request and a mid-run note arriving together are both honored
Given TICKET-1043's implementation run is active
When Maria Santos submits a "Pause" request and a mid-run note in the same action (or within
the same second)
Then the run pauses at the next safe checkpoint
And the note is preserved and acknowledged, not dropped by the concurrent pause request

### Acceptance Criteria

- [ ] Halt stops a run at the next safe checkpoint and posts a partial-work summary
- [ ] Pause suspends and Resume continues a run without data loss
- [ ] Halt/Pause never corrupts in-progress file/artifact state
- [ ] Halt/Pause controls are restricted to the submitter and authorized governance roles
- [ ] A pause request and a mid-run note arriving concurrently are both honored — neither is
      silently dropped

### Outcome KPIs

- **Who**: Submitters who decide to intervene during an active run
- **Does what**: Successfully stop or pause a run without losing prior progress
- **By how much**: 100% of halt/pause requests honored within one safe-checkpoint interval
  (target checkpoint interval defined in DESIGN)
- **Measured by**: Timestamp delta between halt/pause request and confirmed stop; count of
  corrupted-state incidents (target: zero)
- **Baseline**: N/A (capability does not exist)

### Technical Notes (Optional)

- "Safe checkpoint" granularity depends heavily on the invocation mechanism chosen in the
  SPIKE — a mechanism with only coarse-grained (whole-wave) checkpoints will have a much
  larger worst-case halt latency than one with finer-grained control. This trade-off should
  be an explicit input to the SPIKE's evaluation criteria.

---

## US-10: Ticket Submitter Is Notified When Implementation Needs Their Input to Continue

**Traces to Job Story**: Main Job Story; Supporting Job Story 6 (Monitor); Supporting Job
Story 7 (Modify)

### Problem

Maria Santos cannot watch a ticket channel continuously. If a run genuinely needs her input
to proceed (e.g., an ambiguous requirement it cannot safely guess at), she needs to be pulled
back in, not left wondering why nothing is happening.

### Who

- Ticket submitters who are not actively watching the channel | At the moment a run needs
  their input | Motivated by wanting to be interrupted only when truly necessary

### Solution

When a run cannot safely proceed without submitter input, it pauses itself and sends a
notification (in-app plus a configured channel such as email) explaining what's needed.

### Domain Examples

1. **Happy path**: TICKET-1046's run reaches a point where it cannot determine which Slack
   channel to notify; it pauses and notifies Carlos Mendes with a specific question.
2. **Edge case**: TICKET-1043's run never needs input and completes without ever notifying
   Maria beyond the initial confirmation — no unnecessary interruptions.
3. **Error/boundary**: TICKET-1042's run pauses waiting for input, and Devon Park does not
   respond for 24 hours — the run remains safely paused rather than guessing or timing out
   destructively.

### UAT Scenarios (BDD)

#### Scenario: Run pauses and notifies when it cannot safely proceed
Given TICKET-1046's run reaches a point requiring a decision it cannot safely make
When it determines it needs submitter input
Then the run pauses
And Carlos Mendes is notified with a specific question about what's needed

#### Scenario: Runs that never need input do not generate unnecessary notifications
Given TICKET-1043's run has all the information it needs throughout
When it progresses from DISCUSS through DELIVER
Then Maria Santos receives no notifications beyond the initial confirmation and completion

#### Scenario: A paused run waiting on input does not degrade or time out destructively
Given TICKET-1042's run is paused waiting for Devon Park's input
When 24 hours pass without a response
Then the run remains safely paused with no partial/corrupted state
And Devon still sees the original question when he returns

#### Scenario: Notification reaches the submitter outside the OrgOps UI
Given Carlos Mendes is not currently viewing OrgOps
When TICKET-1046's run pauses needing his input
Then he receives a notification through a configured out-of-band channel (e.g., email)

### Acceptance Criteria

- [ ] A run that cannot safely proceed pauses itself rather than guessing
- [ ] The submitter is notified with a specific, answerable question
- [ ] Runs that never need input generate no unnecessary interruptions
- [ ] A long-paused run preserves state safely with no destructive timeout
- [ ] Notification reaches the submitter through at least one channel outside the OrgOps UI

### Outcome KPIs

- **Who**: Submitters with runs that pause for input
- **Does what**: Receive and act on notifications without needing to be watching the UI
- **By how much**: Median time from pause to submitter response < baseline for equivalent
  human-developer clarifying questions (baseline to be measured in Release 2 alongside US-11)
- **Measured by**: Timestamp delta between pause event and submitter response event
- **Baseline**: N/A (capability does not exist)

### Technical Notes (Optional)

- Depends on OrgOps' notification/email infrastructure — confirm scope during DESIGN (not
  confirmed present in current codebase survey; may itself be new).

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
  must define where this configuration lives (see `shared-artifacts-registry.md`).

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
  informed by data gathered during Release 0/Release 1 operation.
