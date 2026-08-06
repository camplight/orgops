# Test Scenarios: Ticket Classification

**File**: `apps/agent-runner/src/ticket-classification/ticket-classification.test.ts`
**Total scenarios**: 20 (2 walking skeletons + 18 focused). Only the first (WS-1) is enabled
(`it`); the remaining 19 are `it.skip` per Mandate 5 — enabled one at a time as each reaches
GREEN in DELIVER.

## Story Traceability

| Story | Scenarios (by tag) | Count |
|---|---|---|
| US-01 (Submit a ticket) | WS-1, low-detail flag, no-title rejected, duplicate idempotency, dashboard list, Trello reuse | 6 |
| US-02 (Automatic classification) | WS-1, content-only, low-confidence, `@property` gate, LLM failure, unparseable response, redelivered `ticket.created`, 2x infrastructure-failure | 9 |
| US-03 (See/correct classification) | WS-2, unauthorized override, governance override (happy), audit trail visible, redelivered override, governance reversal | 6 |

(WS-1 double-counts US-01+US-02, matching its `@US-01 @US-02` tags — it is one journey spanning
both stories' observable value, per `walking-skeleton.md`.)

## Happy / Alternative Path (8)

1. **WS-1** `@walking_skeleton @real-io @in-memory @driving_port @US-01 @US-02` — Maria submits
   a ticket and sees it classified as development work with a rationale. *(enabled)*
2. **WS-2** `@walking_skeleton @real-io @driving_port @US-03` — Devon overrides a misclassified
   ticket and implementation becomes unblocked.
3. `@US-01` — A ticket with no description is still accepted and flagged as low-detail.
4. `@US-01` — Submitted tickets are visible in the submitter's ticket dashboard list.
5. `@real-io @adapter-integration @US-11` — A Trello-sourced ticket reuses the native intake
   endpoint and is indistinguishable downstream (ADR-0009).
6. `@US-02` — A content-only ticket is classified away from development work, with a routing
   suggestion.
7. `@US-03` — Priya (governance-team member, not the submitter) can override, and the override
   is audited with her identity.
8. `@US-03` — The override audit trail records who, when, from, and to, visible to governance
   review.

## Error / Edge Path (12) — 60% of total, exceeds the 40%+ mandate

9. `@US-01` — A ticket submission without a title is rejected.
10. `@US-01` — Duplicate submission with the same idempotency key does not create a second
    ticket record.
11. `@US-02` — An ambiguous ticket produces a low-confidence result and does not unblock
    implementation.
12. `@property @US-02` — LOW CONFIDENCE and NOT DEVELOPMENT WORK results never unblock
    implementation, regardless of rationale content (universal invariant across both
    non-triggering result values — signals "never"/"regardless of").
13. `@US-02` — Classification failure (LLM error) is surfaced, never silently left pending.
14. `@US-02` — Classifier returns an unparseable response — treated identically to an LLM
    failure, never coerced.
15. `@US-02` — A redelivered `ticket.created` for an already-classified ticket is a no-op.
16. `@US-03` — Override is rejected for a human who is neither the submitter nor a
    governance-team member.
17. `@US-03` — A redelivered identical override action is a no-op.
18. `@US-03` — A governance override back to NOT DEVELOPMENT WORK is audited without
    re-triggering implementation.
19. `@infrastructure-failure @in-memory @US-02` — `HttpTicketRepository` surfaces a network
    failure from the classification-recording call, never silently swallowed.
20. `@infrastructure-failure @in-memory @US-02` — A Classifier `generate()` timeout is treated
    as a classification failure, not left pending.

## Mandate Compliance Evidence

- **CM-A (driving ports only)**: every scenario imports and calls either the real HTTP driving
  port (`POST /api/tickets`, `POST /api/tickets/:id/override`, `GET /api/tickets/:id`, `GET
  /api/tickets/:id/classification-history`) via `authedRequest`, or the agent-runner
  Classification Orchestrator's `classifyTicketIfPending` (a message-consumer-shaped driving
  port, mirroring `nwave-invocation`'s own `triggerRunForConfirmedIntent`/
  `advanceToNextWave` precedent — directly tested, not wrapped). Zero scenario imports an
  internal validator/parser/formatter directly. `classifier.ts`'s `parseClassificationResponse`
  and `access.ts`'s `canOverrideClassification` are exercised only indirectly, through the ports
  that call them.
- **CM-B (business language)**: grepped the Gherkin-equivalent scenario titles/comments for
  `database|API|HTTP|REST|JSON|status code|500|404|controller` — zero matches outside code-level
  `// Given/When/Then` implementation lines (which is where Mandate 2's Layer 2 permits
  technical detail; Layer 1 titles stay pure business language throughout, e.g. "classified as
  development work", never "returns 201").
- **CM-C (walking skeletons + focused count)**: 2 walking skeletons (within the 2-3
  recommendation), 18 focused scenarios (within the 15-20 recommendation).
- **CM-D (pure function extraction)**: `classifier.ts`'s `parseClassificationResponse` (pure,
  no I/O) and `classification-orchestrator.ts`'s `classifyTicketIfPending` (orchestration over
  injected `TicketRepositoryPort`/`classify` dependencies, no direct I/O) are both extracted
  ahead of any fixture parametrization; the only fixture parametrization in this file
  (`createRealApiApp()`) applies solely to the thin HTTP/SQLite adapter layer, never to pure
  logic.
