# Walking Skeletons: Ticket Classification

Two walking skeletons — within the 2-3 recommended range. WS-1 covers US-01+US-02 as one
cohesive user journey (submit -> get classified), since classification has no independent
observable value without a submitted ticket to classify; WS-2 covers US-03's distinct user goal
(catching and correcting a misclassification). Each answers "can a user accomplish their goal
and see the result?", not "do the layers connect?"

## WS-1 (US-01 + US-02): Maria submits a ticket and sees it classified as development work

**File**: `apps/agent-runner/src/ticket-classification/ticket-classification.test.ts`
**Tags**: `@walking_skeleton @real-io @in-memory @driving_port @US-01 @US-02`
**Status**: enabled (`it`, not `it.skip`) — the one scenario Mandate 5 requires to be runnable
now. Currently fails with `expected 500 to be 201` (a real business-logic RED: `POST
/api/tickets` throws "not implemented", caught by Hono's `onError`), not an import/wiring error.

- **Title test**: describes a user goal ("Maria submits a ticket and sees it classified..."),
  not a technical flow ("orchestrator calls port calls adapter").
- **Given/When**: "Maria Santos submits a ticket describing a clear, testable bug" / "the
  classification step runs" — user context and action, not system-state setup phrased
  technically.
- **Then**: "Maria sees the ticket classified as development work, with a stated rationale" —
  an observable outcome a non-technical stakeholder can confirm ("yes, that's what a submitter
  needs to see").
- **Boundary proof (Dimension 9d)**: if the real SQLite/API adapter were deleted, this test
  could not pass — `POST /api/tickets` and `GET /api/tickets/:id` are real HTTP calls through
  the real Hono app against a real in-memory database; `HttpTicketRepository.recordClassification`
  is a real HTTP call too. Only the Classifier's `generate()` call (an external, costly LLM
  dependency, not a local resource) is faked.

## WS-2 (US-03): Devon overrides a misclassified ticket and implementation becomes unblocked

**File**: `apps/agent-runner/src/ticket-classification/ticket-classification.test.ts`
**Tags**: `@walking_skeleton @real-io @driving_port @US-03`
**Status**: `it.skip` (Mandate 5 — enabled one at a time as WS-1 and prior scenarios reach GREEN).

- **Title test**: "Devon overrides a misclassified ticket and implementation becomes unblocked"
  — user goal and its consequence, not "PATCH updates classification_result column."
- **Given/When**: "TICKET-1042 was classified as NOT DEVELOPMENT WORK" (a real precondition,
  produced by actually running the classification step with a fake LLM response, not fixture
  theater) / "Devon Park... selects 'Override: this is development work'".
- **Then**: "the classification is updated to DEVELOPMENT WORK, unblocking the implementation
  trigger step (US-04)" — a business state and its downstream consequence, matching the
  Domain Example/UAT text in `discuss/user-stories.md` US-03 almost verbatim.
- **Boundary proof**: goes through the real Hono app (`POST /api/tickets/:id/override`) against
  a real in-memory SQLite database — no local resource is faked in this story (it has no costly
  external dependency, unlike US-02's LLM call).
- **Driving-port note**: per `distill/wave-decisions.md` DWD-03, the override action is driven
  through `POST /api/tickets/:id/override` directly (not a separate agent-runner channel-watcher
  invoked in-process) — this is the boundary where the authenticated human's session actually
  lives, so it is the only boundary that can genuinely enforce `canOverrideClassification`.

## Litmus Test Results (per nw-test-design-mandates)

| Check | WS-1 | WS-2 |
|---|---|---|
| 1. Title = user goal, not technical flow | Pass | Pass |
| 2. Given/When = user actions/context | Pass | Pass |
| 3. Then = user observations, not internal side effects | Pass | Pass |
| 4. Non-technical stakeholder could confirm "yes, that's what users need" | Pass | Pass |
