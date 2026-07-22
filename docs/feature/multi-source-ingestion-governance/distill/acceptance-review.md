# Acceptance Test Review: Multi-Source Ingestion & Governance (DISTILL Wave)

Self-review by the acceptance-designer against `nw-ad-critique-dimensions` (fast-path does not
apply — 26 scenarios, well above the 3-scenario threshold — full review performed).

## Dimension 1: Happy Path Bias

14/26 scenarios (54%) are error/edge/property-tagged. Exceeds the 40% mandate. Per-file
breakdown: US-11 4/8 (50%), US-12 6/11 (55%), US-13 4/7 (57%). **Pass.**

## Dimension 2: GWT Format Compliance

Every scenario body has a Given/When/Then structure via blank-line-separated comment blocks
(this repo has no Gherkin tooling — see root `CLAUDE.md`; comments substitute for step
keywords). Each scenario has exactly one When action. Checked during authoring; no scenario
found with multiple When actions or a missing Given. **Pass.**

## Dimension 3: Business Language Purity

`it(...)`/`describe(...)` title strings scanned for technical jargon (database, API, HTTP,
REST, JSON, status codes, controller, endpoint) — zero matches outside the deliberate `@tag`
markers (which are infrastructure-agnostic markers, not prose). Business language used
throughout: "a governance-team member registers a board," "Maria approves a completed
implementation," "raw stack traces are never shown without plain-language context." **Pass.**

## Dimension 4: Coverage Completeness

All 15 ACs across US-11 (5), US-12 (5), US-13 (5) map to at least one scenario (see
`test-scenarios.md`'s per-scenario AC column). No AC found with zero scenarios. **Pass.**

## Dimension 5: Walking Skeleton User-Centricity

See `walking-skeleton.md`'s litmus-test table — all three walking skeletons pass all four
checks (user-goal title, user-action Given/When, user-observation Then, stakeholder-confirmable).
**Pass.**

## Dimension 6: Priority Validation

Scenario selection follows the architecture brief's own stated priority order for this track
(correctness/auditability first — hence US-12's 11 scenarios, the most of the three stories,
including the priority-1 fail-closed-by-default scenario and the `@property` structural-gate
scenario; reliability/non-silent-failure second — hence US-11's outage-recovery and
race-condition scenarios, and US-13's entire premise; maintainability not scenario-visible by
design). Not "secondary concerns while larger gaps exist" — the largest gap (governance
correctness) has the most scenarios. **Pass.**

## Dimension 7: Observable Behavior Assertions

Every Then-equivalent assertion checked against the mechanical checklist:
- HTTP-driven scenarios assert `res.status` (a return value from the driving port call) and
  parsed response bodies (`ticketResolutionStatus`, `newRunId`, `entries`, `history`) — return
  values, not internal state or mock-call counts.
- Direct-pure-function scenarios (guardrail evaluator, failure/recovery advisor, stuck-run
  detector) assert the function's return value (`decision.approvalStatus`, `guidance.message`,
  `result.action`) — again a driving-port return value, since these are the actual entry point
  for event-consuming components with no HTTP surface (mirrors `intent-watchdog.test.ts`'s own
  assertion style).
- No scenario asserts `mock.called`, raw DB row counts, or private fields. **Pass.**

**Correction made during authoring** (documented for transparency, not hidden): two scenarios
were initially written with the weak assertion `expect(res.status).not.toBe(200)` — a form that
would pass merely because the route is unauthenticated-401 or not-implemented-500, without
proving anything about the actual governance-hold business rule once implemented. This is
exactly the "no fixture theater" failure mode Mandate 7 warns about — a test that passes without
production code changes is a test-design flaw, not a valid signal. Both were tightened to
`toBe(403)` (a specific, business-meaningful outcome that will only pass once the real gate is
implemented) before this review concluded. See "Test Run Result" below — both now fail for the
correct reason (403 expected, 500 received today).

## Dimension 8: Traceability Coverage

**Check A (story-to-scenario)**: US-11, US-12, US-13 each have multiple scenarios referencing
them (via file/describe grouping and the AC column in `test-scenarios.md`). No story with zero
scenarios. **Pass.**

**Check B (environment-to-scenario)**: No `devops/environments.yaml` exists for this track
(soft-gate default: clean | with-pre-commit | with-stale-config, logged as a warning, not
blocking). Every scenario runs against a freshly-migrated in-memory SQLite instance (the "clean"
environment). `with-pre-commit`/`with-stale-config` have no applicable Given clause for this
track's stories (no installer/config-file concern exists here) — flagged as N/A explicitly in
`test-scenarios.md` rather than silently omitted. **Conditionally pass** (environment axis is
genuinely not applicable to this track's domain, not unaddressed).

## Dimension 9: Walking Skeleton Boundary Proof

- **9a (strategy declared)**: Yes — DWD-01 in `distill/wave-decisions.md`, confirmed
  interactively with the human before this DISTILL pass, recorded as a formal numbered decision.
- **9b (strategy-implementation match)**: Strategy B declared; WS-1 uses `@in-memory` only for
  the one costly external dependency (`TrelloIngestionPort`) and `@real-io` for the local
  SQLite/HTTP adapters, exactly matching Strategy B's definition. The `@requires_external`
  contract test is present (US-11 scenario 8), satisfying Strategy B's explicit recommendation
  to add one.
- **9c (adapter integration coverage)**: See adapter coverage table in
  `distill/wave-decisions.md` — every driven adapter has a `@real-io` scenario except
  `TrelloIngestionPort`, which is Strategy B's designated fake (covered instead by the gated
  `@requires_external` test).
- **9d (fixture tier)**: "If I deleted the real adapter, would this WS still pass?" — No, for
  all three WS. WS-1/WS-2 would fail immediately (no real HTTP app / DB to call). WS-3 has no
  local resource adapter to delete (pure function), so this check is not applicable to it in the
  same way — its boundary proof is that it is the actual driving port for an event-consuming
  component, not a wrapper around one.
- **9e (strategy drift)**: Grepped all three test files for `@in-memory` on `@walking_skeleton`
  scenarios — found only on WS-1, exactly where Strategy B says it belongs (the Trello CLI, the
  one designated costly fake). No drift.

## Definition of Done

1. [x] All acceptance scenarios written — step logic lives directly in each `it` body (no
   separate step-definition layer; this repo's convention), each calling a real driving port
2. [x] Test pyramid complete — acceptance tests written now (this wave); DELIVER wave adds
   unit tests per scaffold, one at a time, as it implements each throwing function
3. [x] Peer review — self-review completed above (all 9 dimensions); see "Review Note" below
   regarding second-reviewer invocation
4. [ ] Tests run in CI/CD pipeline — not yet wired for these specific files (existing
   `.github/workflows/ci.yml` already runs `npm test` at the repo root, which vitest's default
   discovery will pick these files up under; no CI change was required or made in this DISTILL
   pass, consistent with "no unsolicited files")
5. [x] Story demonstrable to stakeholders — all three walking skeletons pass the litmus test
   (Dimension 5); a stakeholder can be shown "Maria's card becomes a ticket," "Maria approves a
   completed run," "Devon sees a clear failure summary" as the three demo moments

**Review Note**: this self-review was performed by the acceptance-designer itself (per the
autonomous subagent task boundary — no `nw-acceptance-designer-reviewer` invocation was
available in this execution context). Findings are reported honestly, including the
self-corrected weak-assertion issue under Dimension 7, rather than omitted.

## Mandate Compliance Evidence

**CM-A (driving ports only)**: Every test file imports only driving-port-shaped entry points:
`createApp` (the real Hono app, driving port for every HTTP scenario),
`runBoardPollCycle`/`createTrelloIngestionPoller` (the Trello Ingestion Poller's own exported
tick function, mirroring `maintenance-loop.ts`'s testable-unit shape),
`evaluateGuardrailForCompletion`/`composeFailureRecoveryGuidance`/`scanRunForStaleness` (each
event-consuming/interval-scheduled component's own exported processing function, mirroring
`intent-watchdog.ts`'s directly-called-function shape). Zero imports of internal validators,
formatters, or repository implementations as a test's sole entry point.

**CM-B (business language)**: See Dimension 3 above — zero technical jargon found in
`it`/`describe` title strings.

**CM-C (user journey completeness)**: 3 walking skeletons + 23 focused scenarios (26 total) —
within the recommended range once accounting for this track having three distinct stories each
needing full AC coverage (15 ACs total); every walking skeleton includes trigger, business
logic, observable outcome, and business value (see `walking-skeleton.md`).

**CM-D (pure function extraction)**: Every deterministic component
(`guardrail-evaluator.ts`/`governance-approval-handler.ts`/`failure-recovery-advisor.ts`/
`stuck-run-detector.ts`'s scan logic) is a pure function taking explicit inputs, no side effects
— consistent with the architecture brief's own "Architecture Enforcement" rule that these
modules must not call `fetch`/`apiFetch`/`child_process` directly. Impure I/O is isolated behind
exactly two adapters (`TrelloCliBoardReader`, `HttpGovernanceRepository`), both scaffolded with
throwing bodies (Mandate 7) and no fixture parametrization was needed at the DISTILL stage since
no environment-variant matrix applies to this track's stories (see Dimension 8 Check B).

## Scaffold Files Created (Mandate 7)

**Owned by multi-source-ingestion-governance:**
- `apps/agent-runner/src/multi-source-ingestion-governance/types.ts`
- `apps/agent-runner/src/multi-source-ingestion-governance/trello-ingestion-port.ts`
- `apps/agent-runner/src/multi-source-ingestion-governance/trello-cli-board-reader.ts`
- `apps/agent-runner/src/multi-source-ingestion-governance/governance-repository-port.ts`
- `apps/agent-runner/src/multi-source-ingestion-governance/http-governance-repository.ts`
- `apps/agent-runner/src/multi-source-ingestion-governance/trello-ingestion-poller.ts`
- `apps/agent-runner/src/multi-source-ingestion-governance/guardrail-evaluator.ts`
- `apps/agent-runner/src/multi-source-ingestion-governance/governance-approval-handler.ts`
- `apps/agent-runner/src/multi-source-ingestion-governance/failure-recovery-advisor.ts`
- `apps/agent-runner/src/multi-source-ingestion-governance/stuck-run-detector.ts`
- `apps/api/src/routes/trello-ingestion.ts`
- `apps/api/src/routes/guardrail-allowlist.ts`
- `packages/db/migrations/027_multi_source_ingestion_governance.sql`
- 5 new tables added to `packages/db/src/schema.ts`
  (`trelloIngestionBoards`/`trelloIngestionSeenCards`/`guardrailAllowlistEntries`/
  `guardrailDecisionAudit`/`nwaveRunStuckFlags`)
- 2 new access-control checks added to `apps/api/src/routes/access.ts`
  (`canSignOffGuardrail`/`canManageTrelloIngestion`)

**Prerequisite scaffolds for undelivered sibling tracks (minimal structure only, explicitly
labeled in each file's own doc comment as not owned by this track):**
- `apps/api/src/routes/tickets.ts` (`ticket-classification`'s `POST /api/tickets`)
- `apps/api/src/routes/nwave-runs.ts` (`nwave-invocation-engine`/`progress-trust-ux`'s base run
  actions; the seven handlers registered here are the actual US-12/US-13 extension this track
  owns)
- `packages/schemas/src/run-activity.ts` (`progress-trust-ux`'s shared `Run Activity Deriver`)

**Modified (additive only):**
- `apps/api/src/app.ts` (registers the four new/extended route files)
- `apps/api/package.json` unchanged; `apps/agent-runner/package.json` (added `@orgops/api`/
  `@orgops/db` devDependencies so acceptance tests can import the real app/db, matching Strategy
  B)
- `packages/schemas/src/index.ts` (re-exports `run-activity.ts`)

**Test support (not a scaffold, not a test file):**
- `apps/agent-runner/src/multi-source-ingestion-governance/acceptance-test-support.ts`

## Test Run Result (RED, not BROKEN)

Command: `npx vitest run apps/agent-runner/src/multi-source-ingestion-governance --reporter=verbose`
(scoped invocation; root `npm test`/`npm run --workspace @orgops/agent-runner test` both resolve
to the same underlying `vitest run` and would pick up these files identically).

```
Test Files  3 failed (3)
     Tests  23 failed | 2 passed | 1 skipped (26)
```

- **23 failed** — every failure is a legitimate RED: either an explicit scaffold `Error` thrown
  from a named not-implemented function (e.g. `runBoardPollCycle not implemented for board...`,
  `evaluateGuardrailForCompletion not implemented for run...`), or a precise assertion mismatch
  against real (already-correct) infrastructure behavior (e.g. `expected 500 to be 403` — the
  route exists, is reachable, and throws its own descriptive not-implemented error, which the
  global error handler correctly turns into a 500; the test correctly expects the *future* 403).
  Zero import errors, zero "Cannot find module," zero collection failures.
- **2 passed** — both test already-implemented, cross-cutting production behavior (the global
  `/api/*` authentication gate in `apps/api/src/routes/auth.ts` correctly rejects
  unauthenticated requests with 401), not this track's not-yet-built feature logic. Verified
  deliberately, not accidental: see Dimension 7's "Correction made during authoring" note and
  DWD-03 in `wave-decisions.md`.
- **1 skipped** — the `@requires_external` Trello CLI contract smoke test, gated on a local
  fixture file that does not exist in this environment (by design; matches
  `.github/workflows/ci.yml`'s own `--if-present` guard for the equivalent contract test).

**Regression check**: `apps/api/src/app.test.ts`'s pre-existing 52 tests still pass unmodified
after this DISTILL pass's additive changes to `app.ts`/`access.ts`/`schema.ts`
(`ORGOPS_PROJECT_ROOT=<repo root> npx vitest run apps/api/src/app.test.ts` → `52 passed`; the
explicit env var works around a sandbox-local quirk — an incidental `~/package.json` in this
execution environment's home directory that is unrelated to this feature — documented in
`acceptance-test-support.ts`'s own comment, not a repo defect).

**Type-check**: `npx tsc -p apps/agent-runner/tsconfig.json --noEmit` and
`npx tsc -p apps/api/tsconfig.json --noEmit` both clean except one pre-existing, unrelated error
in `apps/agent-runner/src/runner.ts` (confirmed via `git diff` that this file was not touched by
this DISTILL pass).

## Peer Review (nw-acceptance-designer-reviewer)

Invoked post-authoring. **Approved, overall quality 9.4/10, zero critical/blocking issues.** All
four mandates (hexagonal boundary, business language, user journey completeness, pure function
extraction) passed. Three medium-severity, non-blocking business-language findings — scenario
titles using "endpoint"/"API" instead of pure business language — were remediated immediately:

- `trello-ingestion.test.ts`: "through the identical endpoint a native-form submission uses" ->
  "the same way a native-form submission is created"
- `governance-approval.test.ts`: "manages the guardrail allowlist through the API" -> "manages the
  guardrail allowlist and sees new patterns reflected in governance decisions"
- `failure-recovery.test.ts`: "escalation and closure are reachable through the API with
  accumulated context" -> "escalation and closure preserve accumulated context from prior
  attempts"

Re-ran `apps/agent-runner/src/multi-source-ingestion-governance` after the rename: identical
result (23 failed / 2 passed / 1 skipped) — title-only change, no behavior change.

## Handoff

Ready for DELIVER wave (`nw-functional-software-crafter`, per root `CLAUDE.md`'s functional
paradigm). Recommended implementation order (one scenario at a time, per Mandate 5): start with
US-12 scenario 11 (guardrail evaluator clears covered paths — simplest pure function, no I/O),
then scenario 10 (fail-closed default), then work outward to the HTTP-driven scenarios once
`ticket-classification`/`nwave-invocation-engine`'s own prerequisite scaffolds are replaced by
real implementations (coordinate with those tracks' own DELIVER passes, since this track's
`tickets.ts`/`nwave-runs.ts` scaffolds are intentionally minimal placeholders, not this track's
to fully implement).
