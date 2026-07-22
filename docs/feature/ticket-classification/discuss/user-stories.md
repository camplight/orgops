<!-- markdownlint-disable MD024 -->
# User Stories: Ticket Classification Track

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

- **No ticket domain model exists yet.** `ticket_id` and `classification_result` are new
  domain concepts (see umbrella `shared-artifacts-registry.md`) requiring DESIGN-wave data
  modeling before DELIVER.
- **Existing OrgOps primitives must be reused, not duplicated.** Channel creation and
  subscription already exist and should be extended, not replaced (see US-01 Technical
  Notes).
- **Platform is web**, not CLI/TUI — the ticket submitter interacts through the OrgOps UI and
  ticket-scoped channel views, never a terminal.

## Non-Functional Requirements (Applicable to This Track)

Full NFR list: umbrella `user-stories.md` `## Non-Functional Requirements`. The subset
directly relevant to this track's stories:

- **Performance**: Classification result posted within 60 seconds of ticket submission
  (already an AC on US-02).
- **Scalability**: Two ticket submissions referencing the same underlying source-system item
  (e.g., a double-click per US-01) must never create two ticket records or two channels for
  the same piece of work.
- **Reliability**: At-least-once delivery for channel messages (OrgOps' existing event-bus
  guarantee — see `docs/SPEC.md` "Delivery and Failure Semantics"); no story in this track
  should require a stronger guarantee than the platform already provides.
- **Accessibility**: The OrgOps UI ticket dashboard and channel view for this track follow the
  same WCAG 2.2 AA baseline as the rest of OrgOps' UI (per `nw-ux-principles`): 4.5:1
  contrast, full keyboard operability, visible focus indicators.

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
  tickets (validate post-Release-0; see umbrella `wave-decisions.md` risk on unvalidated JTBD
  priors)
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

## Note on US-04 Reference

US-03's Scenario "Submitter overrides a misclassification" and its Acceptance Criteria
reference "the implementation trigger step (US-04)" becoming available after an override.
US-04 belongs to the `nwave-invocation-engine` track (`docs/feature/nwave-invocation-engine/discuss/`)
— this cross-track reference is preserved verbatim from the original story text and is the
concrete instance of the `ticket-classification` -> `nwave-invocation-engine` dependency
documented in this track's `wave-decisions.md`.
