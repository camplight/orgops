# Acceptance Test Review: nWave Invocation Engine (DISTILL Wave)

Fast-path does not apply (15 scenarios, above the 3-scenario threshold) — full review performed:
self-review by the acceptance-designer, followed by an independent peer review
(`nw-acceptance-designer-reviewer`, haiku).

## Dimension 1: Happy Path Bias

9/15 scenarios (60%) are error/edge/property-tagged (see `test-scenarios.md`'s Type column: #2,
3, 4, 6, 7, 9, 10, 11, 13). Exceeds the 40% mandate. **Pass.**

## Dimension 2: GWT Format Compliance

Every scenario body has a Given/When/Then structure via blank-line-separated comment blocks
(this repo has no Gherkin tooling — see root `CLAUDE.md`; comments substitute for step
keywords). Each scenario has exactly one When action. No scenario found with multiple When
actions or a missing Given. **Pass.**

## Dimension 3: Business Language Purity

`it(...)`/`describe(...)` title strings scanned for technical jargon (database, API, HTTP,
REST, JSON, status codes, controller, endpoint) — zero matches outside the deliberate `@tag`
markers. Business language used throughout: "Maria confirms the system's understood intent,"
"Carlos corrects a misunderstood restatement," "Maria is told clearly a run could not start."
**Pass.**

## Dimension 4: Coverage Completeness

All 5 ACs of US-04 map to at least one scenario (see `test-scenarios.md`'s AC Coverage Check
table). No AC found with zero scenarios. **Pass.**

## Dimension 5: Walking Skeleton User-Centricity

See `walking-skeleton.md`'s litmus-test table — WS-1 passes all four checks (user-goal title,
user-action Given/When, user-observation Then, stakeholder-confirmable). **Pass.**

## Dimension 6: Priority Validation

Scenario selection follows brief.md's own stated priority order for this track
(reliability/fault-tolerance first — brief.md line 33 names this the highest priority, and US-04
AC5 "a failed trigger attempt is clearly communicated" as the single worst outcome to prevent;
this test suite's error/edge scenarios (#3, 6, 7, 9, 10, 11, 13) concentrate almost entirely on
proving that exact guarantee — start failure, non-zero exit, stale timeout, halt action,
idempotent redelivery, no-confirmation safety, and access control). Not "secondary concerns
while larger gaps exist." **Pass.**

## Dimension 7: Observable Behavior Assertions

Every assertion checked against the mechanical checklist:
- HTTP-driven scenarios assert `res.status` (a return value from the driving port call) and
  parsed response bodies (`run.id`, `run.status`, `currentWave`) — return values, not internal
  state or mock-call counts.
- Direct pure-function scenarios (`evaluateConfirmationResponse`, `deriveWaveProgressEvents`,
  `collectStaleWaves`, `advanceToNextWave`, `composeRestatement`, `triggerRunForConfirmedIntent`)
  assert the function's own return value — the actual entry point for these event-consuming/
  deterministic components, mirroring `intent-watchdog.test.ts`'s own assertion style.
- No scenario asserts `mock.called`, raw DB row counts, or private fields. **Pass.**

No weak-assertion anti-pattern found this time (unlike the sibling track's own documented
self-correction): every scenario's final assertion targets a specific, business-meaningful
outcome (`"START_FAILED"`, `"HALTED"`, `"COMPLETED"`, `"DESIGN"`, a specific event-object shape)
rather than a loose `not.toBe(200)`-style check that would pass for the wrong reason.

## Dimension 8: Traceability Coverage

**Check A (story-to-scenario)**: US-04 (this track's only story) has 15 matching scenarios (all
tagged `@US-04`). **Pass.**

**Check B (environment-to-scenario)**: No `devops/environments.yaml` exists for this track
(soft-gate default: `clean | with-pre-commit | with-stale-config`, logged as a warning, not
blocking). Every scenario runs against a freshly-migrated in-memory SQLite instance and, where
relevant, a freshly-spawned trivial OS process (the "clean" environment).
`with-pre-commit`/`with-stale-config` have no applicable Given clause for this track's story (no
installer/config-file concern exists here) — flagged as N/A explicitly in `test-scenarios.md`
rather than silently omitted. **Conditionally pass** (environment axis genuinely not applicable
to this track's domain).

## Dimension 9: Walking Skeleton Boundary Proof

- **9a (strategy declared)**: Yes — DWD-01 in `distill/wave-decisions.md`, auto-detected from
  this track's resource classification (not decided interactively with the human this session —
  explicitly flagged for confirmation, per the task's own instruction not to fabricate a human
  sign-off that did not occur).
- **9b (strategy-implementation match)**: Strategy B declared; WS-1 uses a real (trivial)
  `shell_start`-shaped subprocess spawn, real SQLite, and real HTTP for its local resources, and
  fakes only the Restatement Composer's LLM call — exactly matching Strategy B's definition.
- **9c (adapter integration coverage)**: See adapter coverage table in
  `distill/wave-decisions.md` — every driven adapter has a `@real-io` scenario except the LLM
  call (Strategy B's designated fake) and the nWave CLI's own invocation contract (covered
  instead by the gated `@requires_external` test).
- **9d (fixture tier)**: "If I deleted the real adapter, would this WS still pass?" — No.
  Deleting `createRealShellStart`'s real `spawn` call, or the real SQLite/HTTP app, would make
  WS-1 fail immediately once `triggerRunForConfirmedIntent` is implemented (today it fails
  earlier, at the scaffold's `composeRestatement` throw, for an unrelated RED reason — see Test
  Run Result below).
- **9e (strategy drift)**: Grepped the test file for `@in-memory` on `@walking_skeleton`
  scenarios — found only on WS-1, exactly where Strategy B says it belongs (the LLM call, the
  one designated costly fake). No drift.

## Definition of Done

1. [x] All acceptance scenarios written — 15 scenarios in `nwave-invocation.test.ts`, each
   calling a real driving-port-shaped entry function or the real Hono app
2. [x] Test pyramid complete — acceptance tests written now (this wave); DELIVER wave adds unit
   tests per scaffold, one at a time, as it implements each throwing function
3. [x] Peer review — self-review (above, all 9 dimensions) plus independent
   `nw-acceptance-designer-reviewer` pass (below); both approved
4. [ ] Tests run in CI/CD pipeline — not yet wired for these specific files; the existing
   `.github/workflows/ci.yml` already runs `npm test` at the repo root, which vitest's default
   discovery picks these files up under automatically; no CI change was required or made in this
   DISTILL pass
5. [x] Story demonstrable to stakeholders — WS-1 passes the litmus test (Dimension 5); a
   stakeholder can be shown "Maria confirms the restatement and a run starts, with a stable id
   she can reference later" as the one demo moment for this track

## Mandate Compliance Evidence

**CM-A (driving ports only)**: The test file imports only driving-port-shaped entry points:
`composeRestatement`, `evaluateConfirmationResponse`, `triggerRunForConfirmedIntent`,
`advanceToNextWave`, `deriveWaveProgressEvents`, `collectStaleWaves` (each component's own
exported processing function, mirroring `intent-watchdog.ts`'s directly-called-function shape),
`createHttpRunRepository` (the port's real adapter), and the real Hono `app` (`createRealApiApp`,
the driving port for every HTTP scenario). Zero imports of internal validators, formatters, or
repository implementations as a test's sole entry point.

**CM-B (business language)**: See Dimension 3 above — zero technical jargon found in
`it`/`describe` title strings.

**CM-C (user journey completeness)**: 1 walking skeleton + 14 focused scenarios (15 total) —
proportionate to this track's single story (5 ACs); the walking skeleton includes trigger
(confirmation), business logic (Wave Runner's createRun/confirm/spawn), observable outcome (a
returned run with a stable id and STARTING/RUNNING status), and business value (implementation
work has genuinely begun, without Maria manually invoking anything).

**CM-D (pure function extraction)**: Every deterministic component
(`evaluateConfirmationResponse`, `deriveWaveProgressEvents`, `collectStaleWaves`, and
`advanceToNextWave`'s transition logic) is designed as a pure function taking explicit inputs, no
side effects — consistent with the architecture brief's own "Architecture Enforcement" rule
(mechanically enforced by `.dependency-cruiser.cjs`'s "no-nwave-invocation-pure-logic-io" rule,
independently re-verified during this review: `wave-progress-translator.ts` and `run-watchdog.ts`
import only `./types`; `wave-runner.ts` never imports `node:child_process`, injecting `ShellStart`
as a dependency instead). Impure I/O is isolated behind exactly one production-code adapter
(`HttpRunRepository`), scaffolded with a throwing body (Mandate 7); the acceptance test's own
`createRealShellStart`/`createFailingRealShellStart` test-support helpers are the only place
`node:child_process` is imported anywhere in this module, and they live in
`acceptance-test-support.ts` (not a production module the dependency-cruiser rule covers). No
fixture parametrization was needed at the DISTILL stage since no environment-variant matrix
applies to this track's story (see Dimension 8 Check B).

## Scaffold Files Created (Mandate 7)

**Owned by nwave-invocation-engine:**
- `apps/agent-runner/src/nwave-invocation/types.ts`
- `apps/agent-runner/src/nwave-invocation/run-repository-port.ts`
- `apps/agent-runner/src/nwave-invocation/http-run-repository.ts`
- `apps/agent-runner/src/nwave-invocation/restatement-composer.ts`
- `apps/agent-runner/src/nwave-invocation/confirmation-gate.ts`
- `apps/agent-runner/src/nwave-invocation/wave-runner.ts`
- `apps/agent-runner/src/nwave-invocation/wave-progress-translator.ts`
- `apps/agent-runner/src/nwave-invocation/run-watchdog.ts`
- `packages/db/migrations/028_nwave_invocation_engine.sql`
- 2 new tables added to `packages/db/src/schema.ts` (`nwaveRuns`/`nwaveRunWaves`)
- 6 new routes added to the existing `apps/api/src/routes/nwave-runs.ts` (owned by this track;
  the file's pre-existing 7 handlers remain the `multi-source-ingestion-governance` sibling
  track's own prerequisite scaffold, untouched beyond the file-level doc comment correction)

**Modified (additive only):**
- `packages/db/src/schema.ts` (2 new table exports + schema object entries)
- `apps/api/src/routes/nwave-runs.ts` (6 new route handlers, updated doc comment)
- `apps/api/src/app.ts` (updated registration comment only — no behavior change;
  `registerNwaveRunsRoutes` was already wired by the sibling track)

**Test support (not a scaffold, not a test file):**
- `apps/agent-runner/src/nwave-invocation/acceptance-test-support.ts`

**Test file:**
- `apps/agent-runner/src/nwave-invocation/nwave-invocation.test.ts`

No prerequisite scaffolds for sibling tracks were needed: `ticket-classification`'s
`ticket.classification.confirmed` precondition is event-bus data, not a route/table (see DWD-03);
`multi-source-ingestion-governance` and `progress-trust-ux` are downstream, not upstream, of this
track.

## Test Run Result (RED, not BROKEN)

Command: `ORGOPS_PROJECT_ROOT=<repo root> npx vitest run apps/agent-runner/src/nwave-invocation --reporter=verbose`

```
Test Files  1 file
     Tests  15 total: 1 passed | 13 failed | 1 skipped
```

- **13 failed** — every failure is a legitimate RED: either an explicit scaffold `Error` thrown
  from a named not-implemented function (e.g. `composeRestatement not implemented for
  TICKET-1043...`, `triggerRunForConfirmedIntent not implemented for TICKET-1043...`,
  `advanceToNextWave not implemented for run RUN-8841...`, `collectStaleWaves not implemented...`,
  `deriveWaveProgressEvents not implemented...`, `evaluateConfirmationResponse not implemented
  for TICKET-1043...`), or a precise assertion mismatch against real (already-correct)
  infrastructure behavior (`expected 500 to be 200` — the route exists, is reachable, and throws
  its own descriptive not-implemented error, which the global error handler correctly turns into
  a 500; the test correctly expects the *future* 200/201). Zero import errors, zero "Cannot find
  module," zero collection failures.
- **1 passed** — tests already-implemented, cross-cutting production behavior (the global
  `/api/*` authentication gate in `apps/api/src/routes/auth.ts` correctly rejects unauthenticated
  requests with 401), not this track's not-yet-built feature logic. This is the same pattern the
  sibling track's own DISTILL review documented and self-verified, not accidental.
- **1 skipped** — the `@requires_external` nWave CLI contract smoke test, gated on a local
  fixture file that does not exist in this environment (by design; mirrors
  `multi-source-ingestion-governance`'s own Trello CLI contract test convention).

**Regression check**: `apps/api/src/app.test.ts`'s pre-existing 52 tests and
`apps/agent-runner/src/multi-source-ingestion-governance`'s 14 active tests both still pass
unmodified after this DISTILL pass's additive changes to `schema.ts`/`nwave-runs.ts`/`app.ts`
(`ORGOPS_PROJECT_ROOT=<repo root> npx vitest run apps/api/src/app.test.ts
apps/agent-runner/src/multi-source-ingestion-governance` → `52 + 14 passed, 0 failed`).
`packages/db/src/index.test.ts`'s migration test also passes when run outside this execution
sandbox's filesystem write restriction (the one observed failure inside the sandbox,
`EPERM: mkdir '/Users/tsvetan/Projects/data/tmp-tests'`, is a sandbox artifact unrelated to the
new `028_nwave_invocation_engine.sql` migration — confirmed by re-running the same test with the
sandbox restriction lifted, which passes cleanly).

**Type-check**: `npx tsc -p apps/agent-runner/tsconfig.json --noEmit` clean except one
pre-existing, unrelated error in `apps/agent-runner/src/runner.ts` (confirmed via `git status`
that this file was not touched by this DISTILL pass — the same pre-existing error the sibling
track's own DISTILL pass documented). `npx tsc -p apps/api/tsconfig.json --noEmit` and
`npx tsc -p packages/db/tsconfig.json --noEmit` both clean.

## Peer Review (nw-acceptance-designer-reviewer)

Invoked post-authoring (haiku, single pass). **Approved, zero critical/blocking/high-severity
issues.** All checked dimensions scored 9-10/10; mandates CM-A/CM-B/CM-C all pass. The review
independently re-verified the dependency-cruiser boundary (confirming
`wave-progress-translator.ts`/`run-watchdog.ts` import only `./types`, and `wave-runner.ts`
never imports `node:child_process`) and confirmed zero weak/internal-state assertions across all
`expect()` calls in the test file. No remediation was required (unlike the sibling track's own
review, which found and fixed three business-language wording issues) — this pass's scenario
titles were written business-language-first from the start.

## Flagged for Human Confirmation (not silently defaulted)

1. **DWD-01's walking-skeleton strategy** (Strategy B, auto-detected) — specifically, whether
   proving `shell_start` wiring via a trivial real subprocess (rather than fully faking
   `shell_start` and relying solely on the separate `@requires_external` CLI contract test) is
   the right line to draw, given ADR-0001/Decision 1's explicit framing of the nWave CLI
   invocation itself as the single highest-risk, still-unvalidated boundary in this design.
2. **Headless nWave invocation feasibility remains unvalidated** by this DISTILL pass, as it was
   by DESIGN before it — this pass's scenarios are written against the observable contract only
   and do not attempt to prove the underlying assumption. The first real DELIVER-wave
   implementation attempt is still what proves or disproves it (Decision 1, unchanged).
3. **`nwave-runs.ts` is now a shared file** between this track's 6 base routes and
   `multi-source-ingestion-governance`'s 7 extension routes. Both tracks' DELIVER-wave work
   should coordinate on this file (e.g., via small, independent PRs) to avoid merge conflicts,
   though the two route sets are functionally independent.

## Handoff

Ready for DELIVER wave (`nw-functional-software-crafter`, per root `CLAUDE.md`'s functional
paradigm). Recommended implementation order (one scenario at a time, per Mandate 5): start with
scenario 7 (`collectStaleWaves`, simplest pure function, no I/O) or scenario 8
(`deriveWaveProgressEvents`, also pure, no I/O), then scenario 2 (`evaluateConfirmationResponse`,
pure), then work outward to `composeRestatement`/`triggerRunForConfirmedIntent`/
`advanceToNextWave` (the WS scenario) once the pure pieces are solid, then the HTTP-driven
`@driving_adapter` scenarios (5, 9, 10) against a real `HttpRunRepository` implementation, ending
with the `@requires_external` CLI contract test (out of scope for local development — CI-only,
per brief.md's own recommendation).
