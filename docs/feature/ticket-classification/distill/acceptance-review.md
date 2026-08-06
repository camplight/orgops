# Acceptance Test Review: Ticket Classification (DISTILL Wave)

Self-review by the acceptance-designer against `nw-ad-critique-dimensions` (fast-path does not
apply — 20 scenarios, well above the 3-scenario threshold — full review performed).

## Dimension 1: Happy Path Bias

12/20 scenarios (60%) are error/edge/property-tagged. Exceeds the 40% mandate. Per-story
breakdown: US-01 2/6 happy-leaning (duplicate-idempotency and no-title-rejected scenarios push
error count up), US-02 error-heavy by design (5 of 9 US-02-tagged scenarios are error/edge — the
LOW_CONFIDENCE structural gate is this story's single highest-priority AC per brief.md), US-03
3/6 error/edge (unauthorized override, redelivered override, governance reversal). **Pass.**

## Dimension 2: GWT Format Compliance

Every scenario body has a Given/When/Then structure via comment blocks (this repo has no Gherkin
tooling — confirmed by inspecting both sibling tracks' own DISTILL output; comments substitute
for step keywords, consistent precedent). Each scenario has exactly one When action. The
`@property` scenario (#12, LOW_CONFIDENCE/NOT_DEVELOPMENT_WORK gate) iterates two data points
inside one scenario body — checked against Rule 4 (3-5 steps) and accepted as a Scenario-Outline-
equivalent, not a Rule 1 violation ("one scenario, one behavior"): both iterations exercise the
exact same single behavior (the structural gate), differing only in the input value, which is
precisely what a property/outline test is for. **Pass.**

## Dimension 3: Business Language Purity

`it(...)`/`describe(...)` title strings scanned for technical jargon (database, API, HTTP, REST,
JSON, status code, controller, endpoint) — zero matches outside the deliberate `@tag` markers
(infrastructure-agnostic markers, not prose) and one intentional adapter-level title
("`HttpTicketRepository` surfaces a network failure...", tagged `@infrastructure-failure
@in-memory` — this is the one category Mandate 3's own Layer 2 permits naming the adapter, since
the scenario's entire point is proving the adapter propagates a failure rather than swallowing
it). Business language used throughout the other 19: "Maria submits a ticket and sees it
classified as development work," "Devon overrides a misclassified ticket," "the override audit
trail records who, when, from, and to." **Pass.**

## Dimension 4: Coverage Completeness

All ACs across US-01 (5), US-02 (5), US-03 (4) map to at least one scenario — see
`test-scenarios.md`'s Story Traceability table. No AC found with zero scenarios: US-01 AC1-2
(WS-1, dashboard scenario), AC3 (low-detail scenario), AC4 (duplicate-idempotency scenario), AC5
(dashboard scenario); US-02 AC1 (WS-1), AC2 (WS-1 + content-only + low-confidence scenarios), AC3
(WS-1's rationale assertion), AC4 (LLM-failure + unparseable-response scenarios), AC5 (the
`@property` gate scenario, directly); US-03 AC1 (WS-1/WS-2's `GET` assertions), AC2 (content-only
scenario's routing-suggestion assertion), AC3 (WS-2), AC4 (audit-trail-visible scenario). **Pass.**

## Dimension 5: Walking Skeleton User-Centricity

See `walking-skeleton.md`'s litmus-test table — both walking skeletons pass all four checks
(user-goal title, user-action Given/When, user-observation Then, stakeholder-confirmable). **Pass.**

## Dimension 6: Priority Validation

Scenario allocation follows brief.md's own stated priority order for this track: priority 1 is
"reliability/fault tolerance... classification failures are surfaced, never silent" (US-02 AC4)
— reflected in 2 dedicated failure scenarios plus 2 dedicated infrastructure-failure scenarios,
4 of 20 total. Priority 2 is "correctness/testability of the classification decision boundary...
low confidence results do not auto-trigger implementation, structurally not just usually" (US-02
AC5) — reflected in the dedicated `@property` scenario, the single highest-value test in this
suite per brief.md's own framing ("must hold structurally... this track's own wave-decisions.md
flags the >=90% accuracy KPI as an unvalidated analyst prior" — i.e. the gate matters more than
the classifier's actual judgment quality, which this suite correctly does not attempt to test).
Not "secondary concerns while larger gaps exist" — the two highest-stated priorities have the
most scenario weight. **Pass.**

## Dimension 7: Observable Behavior Assertions

Every Then-equivalent assertion checked against the mechanical checklist:
- HTTP-driven scenarios assert `res.status` / `overrideRes.status` (return values from the
  driving-port call) and parsed response bodies (`classificationResult`, `classificationStatus`,
  `classificationFailureReason`, `history[...]`) — return values, not internal state or
  mock-call counts.
- The one direct-function scenario pair (`classifyTicketIfPending` via `classifyWithFakeLlm`)
  asserts the resulting ticket state read back through `GET /api/tickets/:id` — the actual
  driving-port read, not the orchestrator's own return value inspected as a shortcut, so the
  assertion proves the write was durably persisted, not merely that the function returned
  something.
- The dedicated adapter-failure scenario asserts `.rejects.toThrow(...)` on the port method
  itself — a return-value/exception contract of the adapter, not an internal call-count check.
- No scenario asserts `mock.called`, raw DB row counts, or private fields. **Pass.**

## Dimension 8: Traceability Coverage

**Check A (story-to-scenario)**: US-01, US-02, US-03 each have multiple scenarios referencing
them (via `@US-0N` tags and the AC column in `test-scenarios.md`). No story with zero scenarios.
**Pass.**

**Check B (environment-to-scenario)**: No `docs/feature/ticket-classification/devops/
environments.yaml` exists (soft-gate default: clean | with-pre-commit | with-stale-config,
logged as a warning, not blocking). Every scenario runs against a freshly-migrated in-memory
SQLite instance (the "clean" environment). `with-pre-commit`/`with-stale-config` have no
applicable Given clause for this track's stories — this is a web-application ticket-intake/
classification domain with no installer, pre-commit hook, or local config-file concern, matching
exactly the same conclusion `multi-source-ingestion-governance`'s own DISTILL review reached for
its own stories (see that track's `acceptance-review.md` Dimension 8). Flagged as genuinely N/A,
not silently omitted. **Conditionally pass** (environment axis not applicable to this track's
domain).

## Dimension 9: Walking Skeleton Boundary Proof

- **9a (strategy declared)**: Yes — DWD-01 in `distill/wave-decisions.md`. **Not human-confirmed
  in this session** (auto-detected per this task's interactivity constraint) — explicitly flagged
  for the human to confirm or override, distinct from `multi-source-ingestion-governance`'s own
  DWD-01, which was confirmed interactively before that DISTILL pass ran. This is a genuine,
  disclosed gap against the ideal process, not a silent shortcut.
- **9b (strategy-implementation match)**: Strategy B declared; every scenario uses `@in-memory`
  only for the Classifier's `generate()` call (the one costly external dependency) and `@real-io`
  for the local SQLite/HTTP adapters, exactly matching Strategy B's definition. No
  `@requires_external` scenario exists, consistent with DWD-01's explicit reasoning (no new
  external contract introduced by this track).
- **9c (adapter integration coverage)**: See adapter coverage table in `distill/wave-decisions.md`
  — every driven adapter has a `@real-io` scenario except the Classifier's `generate()` call,
  Strategy B's designated fake.
- **9d (fixture tier)**: "If I deleted the real adapter, would this WS still pass?" — No, for
  both WS. WS-1 would fail immediately (no real HTTP app/DB to call `POST /api/tickets`/`GET
  /api/tickets/:id` against). WS-2 would fail identically (no real `POST /api/tickets/:id/override`
  to call).
- **9e (strategy drift)**: Grepped the test file for `@in-memory` on `@walking_skeleton`
  scenarios — found only on WS-1 (the Classifier's LLM call, the one designated costly fake); WS-2
  correctly carries no `@in-memory` tag (US-03's override path has no costly external dependency
  at all). No drift.

## Definition of Done

1. [x] All acceptance scenarios written — step logic lives directly in each `it` body (no
   separate step-definition layer; this repo's convention, matching both sibling tracks), each
   calling a real driving port
2. [x] Test pyramid complete — acceptance tests written now (this wave); DELIVER wave adds unit
   tests per scaffold, one at a time, as it implements each throwing function (`classifier.ts`'s
   `parseClassificationResponse` and `classification-orchestrator.ts`'s `classifyTicketIfPending`
   are already structured as directly-unit-testable pure/orchestration functions for that pass)
3. [x] Peer review — self-review completed above (all 9 dimensions); see "Review Note" below
4. [ ] Tests run in CI/CD pipeline — not yet wired specifically for these files; the existing
   `.github/workflows/ci.yml` already runs `npm test` at the repo root, which vitest's default
   discovery will pick this file up under; no CI change was required or made in this DISTILL pass
5. [x] Story demonstrable to stakeholders — both walking skeletons pass the litmus test
   (Dimension 5); a stakeholder can be shown "Maria's ticket gets classified as development
   work, with a reason" and "Devon corrects a wrong classification himself" as the two demo
   moments

**Review Note**: this self-review was performed by the acceptance-designer itself (autonomous
subagent task boundary — no `nw-acceptance-designer-reviewer` invocation was available in this
execution context). Findings are reported honestly, including the two genuine, disclosed gaps
(DWD-01's WS-strategy auto-detection not human-confirmed; DWD-03's override-driving-port
interpretation resolved by this pass rather than escalated, on the grounds that it is a
DESIGN-internal component-boundary nuance, not a DISCUSS/DESIGN contradiction) — both are called
out explicitly for the orchestrating agent to confirm with the human, per this task's own
instructions, rather than silently absorbed.

## Mandate Compliance Evidence

**CM-A (driving ports only)**: The test file imports only driving-port-shaped entry points:
`createRealApiApp`/`authedRequest` (the real Hono app, driving port for every HTTP scenario),
`classifyTicketIfPending` (the Classification Orchestrator's own exported processing function,
mirroring `nwave-invocation`'s `triggerRunForConfirmedIntent`/`advanceToNextWave` and
`intent-watchdog.ts`'s directly-called-function shape), and `createHttpTicketRepository` (the
real adapter, exercised through its own public interface in the dedicated failure-injection
scenario). Zero imports of `classifier.ts`'s internal `parseClassificationResponse` or
`access.ts`'s `canOverrideClassification` as a scenario's sole entry point — both are exercised
only indirectly, through the ports/routes that call them.

**CM-B (business language)**: See Dimension 3 above — zero technical jargon found in `it`/
`describe` title strings outside the one deliberately-adapter-named infrastructure-failure
scenario.

**CM-C (user journey completeness)**: 2 walking skeletons + 18 focused scenarios (20 total) —
within the recommended 2-3/15-20 ranges; every walking skeleton includes trigger, business
logic, observable outcome, and business value (see `walking-skeleton.md`).

**CM-D (pure function extraction)**: `classifier.ts`'s `parseClassificationResponse` (pure, no
I/O, throws on invalid input rather than returning a union — deliberately, so the orchestrator's
single catch block handles both a rejected `generate()` call and an unparseable response
identically) and `classification-orchestrator.ts`'s `classifyTicketIfPending` (orchestration over
injected `TicketRepositoryPort`/`classify` dependencies, no direct I/O — consistent with
brief.md's Architecture Enforcement rule that pure logic modules must not call `fetch`/`apiFetch`
directly) are both extracted ahead of any fixture parametrization. The only fixture
parametrization in this file (`createRealApiApp()`) applies solely to the thin HTTP/SQLite
adapter layer, never to pure logic — no environment-variant matrix applies to this track's
stories (see Dimension 8 Check B).

## Scaffold Files Created (Mandate 7)

**Owned by `ticket-classification`:**
- `apps/agent-runner/src/ticket-classification/types.ts` (`__SCAFFOLD__ = true`)
- `apps/agent-runner/src/ticket-classification/ticket-repository-port.ts` (`__SCAFFOLD__ = true`)
- `apps/agent-runner/src/ticket-classification/http-ticket-repository.ts` (real adapter wiring)
- `apps/agent-runner/src/ticket-classification/classifier.ts` (real pure logic)
- `apps/agent-runner/src/ticket-classification/classification-orchestrator.ts` (real orchestration)
- `apps/agent-runner/src/ticket-classification/acceptance-test-support.ts` (real test fixtures)
- `apps/agent-runner/src/ticket-classification/ticket-classification.test.ts` (20 scenarios)
- `apps/api/src/routes/tickets.ts` — rewritten from a one-route prerequisite scaffold
  (`multi-source-ingestion-governance`'s DISTILL pass) into the full seven-route RED scaffold
  (`__SCAFFOLD__ = true`, every handler throws)
- `packages/db/migrations/029_ticket_classification.sql`
- 2 new tables added to `packages/db/src/schema.ts` (`tickets`, `ticketClassificationAudit`)
- 1 new access-control check added to `apps/api/src/routes/access.ts`
  (`canOverrideClassification`, throwing stub)
- `apps/api/src/app.ts` — updated `registerTicketsRoutes` wiring to pass `access`/`insertEvent`
  (needed by the real GREEN implementation, not used by any handler yet since all still throw)

**No prerequisite scaffolds needed for other tracks.** This track has no upstream dependency
(`discuss/wave-decisions.md`: "Upstream: None... the entry point of the journey").

**Consumers of this track's scaffolds, already waiting**: `nwave-invocation-engine`'s
`apps/agent-runner/src/nwave-invocation/types.ts` already declares the exact
`TicketClassificationConfirmedPayload` shape (`{ ticketId, channelId, rationale }`) this track's
`ticket.classification.confirmed` event must satisfy — no adjustment was needed on either side.
`multi-source-ingestion-governance`'s 7 deferred scenarios blocked on `POST /api/tickets`'s real
insert/unique-constraint logic (`deliver/deferred-scenarios.md`) can be revisited once this
track's DELIVER wave implements that route for real — the route's contract (idempotency via
`(source, source_ref)`, ADR-0009) is now fully specified in this pass's RED scaffold, not just
named.
