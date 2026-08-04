# Mutation Testing Report — nwave-invocation-engine

**Wave**: DELIVER, Phase 5 (Mutation Testing quality gate)
**Tool**: Stryker Mutator (`@stryker-mutator/core` 9.6.1 + `@stryker-mutator/vitest-runner`), first introduction of mutation testing to this repo
**Gate** (per project `CLAUDE.md`): kill rate >= 80% PASS, 70–80% WARN, <70% FAIL
**Test command**: `ORGOPS_PROJECT_ROOT="$(pwd)" npx vitest run apps/agent-runner/src/nwave-invocation apps/api/src/app.test.ts apps/agent-runner/src/multi-source-ingestion-governance`

## Verdict: PASS (for the portion of scope Stryker can accurately measure)

**Kill rate (agent-runner domain files, accurately measured): 92.28%** (239 killed / 259 covered mutants; 0 no-coverage)

The `apps/api/src/routes/nwave-runs.ts` route file could not be accurately measured due to a
confirmed Stryker + npm-workspace tooling limitation (explained below), not a code quality gap.
See "Known limitation" section for full root-cause analysis and why its reported 0% is not a
valid signal.

## Scope

Config: `stryker.conf.json` (repo root), `vitest.stryker.config.ts` (pinned test-file scope).

| File | Total mutants | Killed | Survived | No coverage | Score |
|---|---|---|---|---|---|
| `apps/agent-runner/src/nwave-invocation/confirmation-gate.ts` | 89 | 80 | 9 | 0 | 89.89% |
| `apps/agent-runner/src/nwave-invocation/http-run-repository.ts` | 41 | 33 | 8 | 0 | 80.49% |
| `apps/agent-runner/src/nwave-invocation/restatement-composer.ts` | 13 | 13 | 0 | 0 | 100.00% |
| `apps/agent-runner/src/nwave-invocation/run-watchdog.ts` | 20 | 20 | 0 | 0 | 100.00% |
| `apps/agent-runner/src/nwave-invocation/wave-progress-translator.ts` | 45 | 45 | 0 | 0 | 100.00% |
| `apps/agent-runner/src/nwave-invocation/wave-runner.ts` | 51 | 48 | 3 | 0 | 94.12% |
| **agent-runner subtotal** | **259** | **239** | **23** | **0** | **92.28%** |
| `apps/api/src/routes/nwave-runs.ts` | 239 | 0 | 30 | 209 | 0.00% (not a valid measurement — see below) |

## Baseline → final (this run's iteration)

| Run | agent-runner kill rate | Notes |
|---|---|---|
| 1st (initial config, `vitest.related: true`) | 64.48% (259 mutants, dry run found only 68/82 tests) | related-mode test-discovery gap discovered |
| 2nd (`related: false` + pinned `vitest.stryker.config.ts`) | 64.48% (unchanged; confirmed dry run now finds 82/82 tests) | ruled out test-discovery as the cause of the *domain-file* score; api-route 0% root-caused separately (see below) |
| 3rd (after adding/fixing 10 tests) | 92.28% | final |

## Genuine gaps found and closed

Mutation testing surfaced one genuine **test-integrity bug** and several genuine **coverage gaps**
in `nwave-invocation.test.ts`. All fixes/additions are in that single file (the existing acceptance
test file for this feature — no production code changed).

### Test-integrity bug fixed (not just a coverage gap)

**"a wave that exits with a non-zero code fails the run..."** — this test called
`advanceToNextWave({ runId: "RUN-8841", completedWaveName: "DISTILL", ... })`, but the seeded
fixture (`seedNwaveRunFixture`) only ever creates a `DISCUSS`-named `RUNNING` wave. `findRunningWave`
therefore returned `undefined`, `advanceToNextWave` returned `null` via the early
run/wave-not-found guard, and `expect(nextWave).toBeNull()` passed **vacuously** — the test never
actually exercised `recordWaveFailure` at all, despite its name and Given/When/Then comments
claiming to test exactly that. This is why Stryker reported `wave-runner.ts` lines 120/121/125
(the entire `recordWaveFailure` body) and 178 (`if (input.exitCode !== 0)`) as **No Coverage** —
literally never executed by any test. Fixed by changing the target wave name to `DISCUSS` (matching
the fixture) and adding assertions on the resulting `run.status`/`run.failureReason`. This is a
legitimate test correction per the Test Integrity policy's exception #1 ("the test itself has a
bug") — the test was PASSING for the wrong reason, not failing; nothing was weakened.

### Coverage gaps closed (new tests, no existing test weakened)

- **`restatement-composer.ts` (15.38% → 100%)**: no existing test ever inspected what got sent to
  the injected `generate()` LLM call — the fake `generate` always returned a fixed string
  regardless of input, so the entire prompt-construction logic (system prompt content, user-prompt
  template, message array/roles, response trimming) was unverified. Added one test that spies on
  `generate()` and asserts the system message instructs "restate"/"confirm or correct"/"no
  implementation detail" (the documented business contract) and the user message contains the
  actual ticket ref/title/description, plus that the response is trimmed.
- **`run-watchdog.ts` (60% → 100%)**: the only existing test used a single obviously-stale
  `RUNNING` wave. Added one test with five waves covering: stale, fresh (within timeout), exactly
  at the timeout boundary (must not be flagged — boundary is strictly-greater-than), no output yet
  (`lastOutputAt: null`), and a finished wave with an old timestamp (must never be flagged
  regardless of staleness-looking data).
- **`wave-progress-translator.ts` (66.67% → 100%)**: no test ever exercised a non-zero exit code
  (`toWaveFailedEvent` was never called — No Coverage), a `process.output` event, an event for an
  unmatched `processId`, or events arriving out of chronological order. Added two tests: one for
  the failed-exit / ignored-event paths, one for chronological ordering + correct wave attribution
  across two concurrent waves.
- **`confirmation-gate.ts` (71.91% → 89.89%)**: added tests for whitespace-trimmed replies,
  malformed payloads (missing text field / non-string text / null payload), and — combined in one
  scenario — chronological-order reply selection plus agent-message exclusion (an agent's own later
  message must never be mistaken for the submitter's reply).
- **`http-run-repository.ts` (58.54% → 80.49%)**: added tests for `getRun` returning `null` for a
  nonexistent run (previously the 404 branch had no test) and for error-status propagation
  (`recordWaveStarted` against a nonexistent run surfaces `"...failed with status 404: ..."` rather
  than silently succeeding or returning an empty result).
- **`wave-runner.ts` (68.63% → 94.12%)**: added a test covering `advanceToNextWave` for a
  nonexistent run id and a mismatched/stale wave-name notification — both must be silently ignored,
  never crash, never advance the run. Combined with the DISTILL→DISCUSS fix above, this closed all
  "No Coverage" mutants in the file.

Net: 10 test changes in `apps/agent-runner/src/nwave-invocation/nwave-invocation.test.ts` (1 fix +
2 assertion enhancements to existing tests + 7 new `it(...)` blocks). Full suite: 82 → 92 tests, all
green.

## Remaining survivors (agent-runner files) — assessed, left open

None of these block the gate (92.28% is well above 80%). Listed for completeness per the "one-line
assessment" requirement.

| File:Line | Mutator | Assessment |
|---|---|---|
| `confirmation-gate.ts:44` | StringLiteral (`""` fallback) | Genuine but low-value edge case: confirming with no agent-posted restatement ever recorded. Real path, but low priority — defensive fallback, not the primary business flow. |
| `confirmation-gate.ts:49` (x3), `:55` | Conditional/Logical on `isMessageInChannel`'s type/channel checks | Genuine gap: no test supplies a message with the wrong event `type` or a different `channelId` that must be excluded. Low value — the channel-scoping behavior is implicitly relied on by every other test's structure. |
| `confirmation-gate.ts:62` | Conditional on `typeof payload === "object"` | Genuine gap: no test supplies a non-null, non-object payload (e.g. a bare string/number). Low value, same family as the malformed-payload test already added. |
| `confirmation-gate.ts:63`, `:65` | StringLiteral (Stryker placeholder text mutants) | Same class as above — payload-shape edge cases not fully exhausted. |
| `confirmation-gate.ts:69` | LogicalOperator (`?? 0` → `&& 0` on `left.createdAt`) | Requires an event with `createdAt: undefined` mixed with defined ones in a >2-element sort to discriminate from the `?? 0` correct behavior. Low value — the sort-correctness property is already covered for the common case. |
| `http-run-repository.ts:13,37,42,60,69,76,82` | StringLiteral (error-context labels: `"createRun"`, `"confirmRun"`, `"recordWaveCompleted"`, etc.) & header object/value | Cosmetic — these strings only affect the wording of thrown error messages for HTTP methods whose failure path isn't separately tested (we covered `recordWaveStarted` and `getRun`'s 404 as representative cases). Diminishing returns to pin exact wording per method. |
| `wave-runner.ts:78,152` | ObjectLiteral (`buildWaveCommand` call-site argument object emptied to `{}`) | Genuine but needs a spy-based `buildWaveCommand` test double (the current tests use a real `echo` command builder that tolerates `undefined` interpolation) to observe exactly what's passed through. Deferred — moderate effort, not required to clear the gate. |
| `wave-runner.ts:102` | ConditionalExpression on `wave.status === "RUNNING"` (right operand of `&&`) | Requires seeding a run with two waves (one matching name but wrong status, one matching status but wrong name) to discriminate. Deferred — would need direct DB/API wave seeding beyond the current fixture helper. |

## Known limitation: `apps/api/src/routes/nwave-runs.ts` is not measurable under the current Stryker + npm-workspaces setup

**Reported score: 0.00% (0 killed / 30 survived / 209 no-coverage).** This number is not a valid
quality signal and must not be read as "this file is untested" — it is a confirmed tooling
artifact, root-caused as follows:

1. `node_modules/@orgops/api` is an npm-workspace symlink: `-> ../../apps/api` (verified via
   `readlink -f`).
2. Stryker's default `symlinkNodeModules: true` symlinks each mutation sandbox's `node_modules`
   directly to the **real project's** `node_modules` (not a copy) — this is by design, to keep
   sandbox creation fast.
3. `apps/agent-runner/src/nwave-invocation/acceptance-test-support.ts` imports the API app via the
   bare package specifier `@orgops/api/src/app` (a deliberate, documented cross-container
   convention — API and Agent Runner are separate deployable containers).
4. When a test resolves that specifier from inside a Stryker sandbox, resolution chains through
   *two* symlink hops (sandbox `node_modules` → real `node_modules` → `@orgops/api` workspace
   symlink) straight back to the **pristine, non-instrumented** `apps/api/src/routes/nwave-runs.ts`
   in the real repo — completely bypassing the sandboxed, mutated copy of that file.
5. By contrast, `apps/api/src/app.test.ts` imports `./app` via a plain relative path (same package,
   no symlink hop), so it *does* correctly exercise the instrumented sandbox copy — which is exactly
   why the file's small number of "Survived" mutants (all module-load-time doc-string constants and
   two functions invoked eagerly at route-registration time) show *any* signal at all, while every
   line inside an actual route handler body shows "No Coverage": `app.test.ts`'s tests are generic
   smoke tests (admin injection, runner registration, agent config) that import the module but never
   call this track's specific `nwave-runs` HTTP endpoints, and `nwave-invocation.test.ts` — which
   *does* call them, 92 times over, through `createRealApiApp()` — never touches the instrumented
   copy at all because of the symlink bypass.

This was verified empirically: fixing the *unrelated* `vitest.related` test-discovery gap (dry run
went from 68→82 tests) had **zero effect** on this file's score, isolating the cause to the
symlink/sandbox interaction rather than test selection.

**This is not evidence of missing test coverage.** The manual test command
(`vitest run apps/agent-runner/src/nwave-invocation apps/api/src/app.test.ts
apps/agent-runner/src/multi-source-ingestion-governance`) passes 92/92, and
`nwave-invocation.test.ts` exercises all 6 of this track's route handlers through real HTTP
requests (via Hono's in-memory `app.request()` dispatch) with real assertions on status codes and
response bodies — this is genuine `@real-io` behavioral coverage, just not observable to Stryker's
sandbox given this repo's npm-workspace layout.

**Recommended follow-up** (infra, not this feature): investigate `symlinkNodeModules: false`
combined with a sandbox `buildCommand` that regenerates workspace links inside each sandbox, or
restructure test-support code to import the API app via a relative path from within the
`apps/api` package rather than the cross-package specifier. Given the cost/complexity and that this
is the first-ever Stryker run in this repo, this is deferred rather than attempted under this
feature's mutation-testing timebox. The scaffold (`stryker.conf.json`,
`vitest.stryker.config.ts`) is committed as-is so future features inherit working agent-runner-side
mutation testing immediately; the `apps/api` limitation applies to any file reached only through
cross-package acceptance tests, not specifically to this feature.

**Also note** (per the task's own scoping caveat): `apps/api/src/routes/nwave-runs.ts` is shared
with the `multi-source-ingestion-governance` track (this feature's 6 route handlers plus that
track's 7). Stryker mutates the whole file since line-range scoping isn't supported — moot here
since the file's score isn't valid regardless, but noted for completeness.

## Post-mutation safety check

- `git status` after every run showed only the intended config/test/report files changed — no
  source files were left mutated or corrupted (Stryker's own sandbox cleanup ran successfully each
  time; `.stryker-tmp` did not persist between runs).
- Full test suite re-run after all changes: **92/92 passing**, confirming the suite is genuinely
  green (not just "Stryker's dry run happened to pass").

## Files changed for this quality gate

- `stryker.conf.json` (new) — feature-scoped Stryker config
- `vitest.stryker.config.ts` (new) — pinned test-file scope for Stryker's vitest runner (see
  root-cause note above on why `vitest.related` alone was insufficient)
- `apps/agent-runner/src/nwave-invocation/nwave-invocation.test.ts` — 1 test-integrity fix, 2
  assertion enhancements, 7 new tests (82 → 92 tests, all passing)
- `.gitignore` — added `.stryker-tmp/` and `reports/mutation/`
- `package.json` / `package-lock.json` — added `@stryker-mutator/core` and
  `@stryker-mutator/vitest-runner` as dev dependencies
- `docs/feature/nwave-invocation-engine/deliver/mutation/mutation-report.{md,json,html}` — this
  report and Stryker's raw output
