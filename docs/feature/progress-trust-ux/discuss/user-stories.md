<!-- markdownlint-disable MD024 -->
# User Stories: Progress & Trust UX Track

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

- **Invocation mechanism is unresolved.** Every story in this track depends on the run
  contract produced by `nwave-invocation-engine`'s US-04 (a run starts, produces
  wave-progress signal, and terminates with a result). US-05 (partially), US-07, US-08, and
  US-09 additionally depend on capabilities of that mechanism beyond one-shot triggering
  (streaming, mid-run input, checkpoint granularity) that remain unproven — see this track's
  `wave-decisions.md`.
- **No ticket domain model exists yet.** `wave_status`, `last_activity_at`, and
  `produced_artifacts_links` are new or partially-new domain concepts (see umbrella
  `shared-artifacts-registry.md`) requiring DESIGN-wave data modeling before DELIVER.
- **Existing OrgOps primitives must be reused, not duplicated.** Channels, events, WebSocket
  topics, and `processes`/`process_output` already exist and should be extended, not
  replaced.
- **Platform is web**, not CLI/TUI — the ticket submitter interacts through the OrgOps UI and
  ticket-scoped channel views, never a terminal.

## Non-Functional Requirements (Applicable to This Track)

Full NFR list: umbrella `user-stories.md` `## Non-Functional Requirements`. The subset
directly relevant to this track's stories:

### Performance

- Mid-run acknowledgment posted within 60 seconds of a submitter message (already an AC on
  US-08).
- Progress UI ("Last activity", wave status) updates within 5 seconds of a new underlying
  event, via existing WebSocket infrastructure — no polling-only fallback should exceed 30
  seconds of staleness.

### Reliability

- Halt/pause requests (US-09) must never corrupt in-progress artifact state — zero tolerance,
  not a percentage target (see US-09 Outcome KPIs).
- A paused-for-input run (US-10) must survive at least 7 days without state loss or
  destructive timeout, since submitters may be unavailable (PTO, weekends) longer than a
  single business day.

### Accessibility

- The OrgOps UI ticket dashboard and channel view for this track follow the same WCAG 2.2 AA
  baseline as the rest of OrgOps' UI (per `nw-ux-principles`): 4.5:1 contrast, full keyboard
  operability for Approve/Request Changes/Pause/Halt controls, visible focus indicators, and
  screen-reader-compatible status announcements for wave-status changes (live-region
  semantics for progress updates, not purely visual).

### Concurrency and Race Conditions (added per peer review — see corresponding scenarios in
US-08 and US-09 below)

- Two concurrent mid-run messages from the same submitter must both be acknowledged, not
  silently merged or overwritten (US-08).
- A pause/halt request arriving at the same moment as a mid-run note must not cause either to
  be dropped (US-09).

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
  *provided* the invocation mechanism (`nwave-invocation-engine`'s US-04) actually produces a
  trackable process. If DESIGN selects a mechanism that does not naturally produce
  process-level output (e.g., a fully external service), this story's technical approach
  needs revisiting.

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
  request-changes action (from `multi-source-ingestion-governance`'s US-12, once that exists)
  or manual timing in earlier releases
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
      `@property` scenario in the umbrella journey `.feature` file)
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
  agent-runner can capture and translate into `wave_status` events — depends on
  `nwave-invocation-engine`'s chosen invocation mechanism actually exposing this level of
  granularity.

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

- Depends on the invocation mechanism (`nwave-invocation-engine`'s US-04) supporting mid-run
  message injection — this is a second capability that must be validated during
  DESIGN/first-implementation, not just one-shot triggering.

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

- "Safe checkpoint" granularity depends heavily on the invocation mechanism chosen by
  `nwave-invocation-engine` DESIGN — a mechanism with only coarse-grained (whole-wave)
  checkpoints will have a much larger worst-case halt latency than one with finer-grained
  control. This trade-off should be an explicit input to that DESIGN decision.

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
  human-developer clarifying questions (baseline to be measured in Release 2 alongside
  `multi-source-ingestion-governance`'s US-11)
- **Measured by**: Timestamp delta between pause event and submitter response event
- **Baseline**: N/A (capability does not exist)

### Technical Notes (Optional)

- Depends on OrgOps' notification/email infrastructure — **confirmed absent** by a targeted
  codebase search (see this track's `wave-decisions.md`, inheriting umbrella Decision 6).
  This is net-new infrastructure to build, not a wiring task; confirm scope during DESIGN.
