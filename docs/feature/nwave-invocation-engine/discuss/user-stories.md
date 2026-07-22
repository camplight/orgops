<!-- markdownlint-disable MD024 -->
# User Stories: nWave Invocation Engine Track

Split from the umbrella feature `nwave-ticket-execution-engine` per the human product owner's
confirmed decision (see `docs/feature/nwave-ticket-execution-engine/discuss/wave-decisions.md`
Decision 4). The story below is copied verbatim from the original DISCUSS-wave
`user-stories.md`; no content was re-derived, paraphrased, or altered, and no acceptance
criteria were dropped. Personas: Maria Santos (Senior Product Manager), Devon Park (Support
Engineer), Carlos Mendes (Customer Success Manager) — all at Fenwick Analytics — as
submitters; Priya Nair (Engineering Lead) as governance stakeholder. Full persona/job
grounding: umbrella `jtbd-job-stories.md`.

## System Constraints (Applicable to This Track)

Full cross-cutting constraint list: umbrella `user-stories.md` `## System Constraints`. The
subset directly relevant to this track's story:

- **Invocation mechanism is unresolved.** US-04 must be written against the *observable
  contract* (a run starts, produces wave-progress signal, and terminates with a result) and
  must not assume a specific mechanism (WRAPPED command harness, a new harness type, or
  otherwise). The planned validation SPIKE was explicitly skipped per user directive; headless
  feasibility is an accepted working assumption, not a validated fact — see this track's
  `wave-decisions.md` Decision 1.
- **No ticket domain model exists yet.** `run_id` and `wave_status` are new domain concepts
  (see umbrella `shared-artifacts-registry.md`) requiring DESIGN-wave data modeling before
  DELIVER.
- **Platform is web**, not CLI/TUI — the ticket submitter interacts through the OrgOps UI and
  ticket-scoped channel views, never a terminal.

## Non-Functional Requirements (Applicable to This Track)

Full NFR list: umbrella `user-stories.md` `## Non-Functional Requirements`. The subset
directly relevant to this track's story:

- **Scalability**: The walking skeleton (Release 0) must support at least 5 concurrent active
  implementation runs without classification or progress-signal degradation (Fenwick
  Analytics' realistic weekly ticket volume, per umbrella `jtbd-job-stories.md`: 8-12
  tickets/week from Maria alone). Release 1/2 targets should be re-set once real usage data
  exists.
- **Reliability**: At-least-once delivery for channel messages and wave-progress events
  (OrgOps' existing event-bus guarantee — see `docs/SPEC.md` "Delivery and Failure
  Semantics"); no story in this track should require a stronger guarantee than the platform
  already provides.

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
mechanism is not defined by this story** — see System Constraints and this track's
`wave-decisions.md`. This story's acceptance criteria are written against the observable
contract only: a run starts, is identified by a stable `run_id`, and begins emitting
wave-progress signal.

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
  validated — target to be refined; the mechanism will not be validated by a SPIKE, since that
  SPIKE was explicitly skipped — see this track's `wave-decisions.md`)
- **Measured by**: Timestamp delta between confirmation event and run-start event
- **Baseline**: N/A (capability does not exist; a defensible baseline or target cannot be set
  until a real implementation exists — see this track's `wave-decisions.md`)

### Technical Notes (Optional)

- **Invocation mechanism must be validated before DESIGN can commit to an implementation
  approach — this validation will now happen via first real implementation attempt, not a
  dedicated SPIKE (explicitly skipped per user directive).** Candidates to evaluate include
  (not a decision): extending the `WRAPPED` agent `command` harness, a new harness type with
  mid-run streaming support, or an entirely different orchestration path. See
  `apps/agent-runner/src/wrapper-harness/command.ts` for the harness contract that any
  candidate must satisfy or extend.
- The existing `command` harness's `runTurn` is blocking and single-shot (captures
  stdout/stderr only at process exit) — it does not natively support the mid-run
  wave-progress streaming that `progress-trust-ux`'s US-05/US-07 depend on. This gap must be
  resolved during DESIGN/first implementation, not assumed away here.
