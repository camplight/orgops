# Walking Skeletons: Multi-Source Ingestion & Governance

Three walking skeletons, one per story — matches the 2-3 recommended count exactly. Each answers
"can a user accomplish their goal and see the result?", not "do the layers connect?"

## WS-1 (US-11): Maria adds a Trello card and it becomes a ticket

**File**: `apps/agent-runner/src/multi-source-ingestion-governance/trello-ingestion.test.ts`
**Tags**: `@walking_skeleton @real-io @in-memory @driving_port`

- **Title test**: describes a user goal ("Maria adds a card... it becomes a ticket"), not a
  technical flow ("poller calls port calls adapter").
- **Given/When**: "the board is configured for ingestion" / "Maria adds a card" — user context
  and action, not system state setup phrased technically.
- **Then**: "a ticket record... is created, identical in structure to a native-form submission"
  — an observable outcome a non-technical stakeholder can confirm ("yes, tickets from Trello
  should look just like ones typed in directly").
- **Boundary proof (Dimension 9d)**: if the real SQLite/API adapter were deleted, this test
  could not pass — `governanceRepository.findTicketBySourceRef` makes a real HTTP call through
  the real Hono app against a real in-memory database. Only the Trello CLI (an external,
  rate-limited dependency, not a local resource) is faked.

## WS-2 (US-12): Maria approves a completed implementation

**File**: `apps/agent-runner/src/multi-source-ingestion-governance/governance-approval.test.ts`
**Tags**: `@walking_skeleton @real-io @driving_port`

- **Title test**: "Maria approves a completed implementation and the ticket is marked resolved"
  — user goal, not "POST returns 200."
- **Then**: "TICKET-1043 is marked resolved" — a business state stakeholders care about, not
  "approval_status column updated."
- **Boundary proof**: goes through the real Hono app (`app.request`) against a real in-memory
  SQLite database — no local resource is faked in this story (it has no costly external
  dependency, unlike US-11's Trello CLI).

## WS-3 (US-13): Devon sees a clear, non-blaming summary after a failure

**File**: `apps/agent-runner/src/multi-source-ingestion-governance/failure-recovery.test.ts`
**Tags**: `@walking_skeleton @driving_port`

- **Title test**: "Devon sees a clear, non-blaming summary within 2 minutes of a failed run" —
  a user-observable moment (what they see after a failure), not "advisor function returns
  object."
- **Then**: explains what completed, what failed, and a next step — exactly the user-facing
  promise from the story's Problem statement ("the single worst outcome... is dead silence").
- **No `@real-io` tag**: this component is a pure, event-consuming function with no I/O of its
  own (mirrors `intent-watchdog.ts`'s directly-called-function shape) — there is no local
  resource adapter to prove wiring against at this boundary; the adjacent
  `@driving_adapter @real-io` scenarios in the same file prove the HTTP side (retry/escalate/
  close) against the real app.

## Litmus Test Results (per nw-test-design-mandates)

| Check | WS-1 | WS-2 | WS-3 |
|---|---|---|---|
| 1. Title = user goal, not technical flow | Pass | Pass | Pass |
| 2. Given/When = user actions/context | Pass | Pass | Pass |
| 3. Then = user observations, not internal side effects | Pass | Pass | Pass |
| 4. Non-technical stakeholder could confirm "yes, that's what users need" | Pass | Pass | Pass |
