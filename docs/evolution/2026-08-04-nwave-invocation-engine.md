# Evolution: nWave Invocation Engine

**Feature ID**: `nwave-invocation-engine`
**Finalized**: 2026-08-04
**DELIVER wave commit range**: `b2cb2bd..1e05509` (12 commits)

## Feature Summary

US-04, "nWave Implementation Run Is Triggered for a Classified Development Ticket," lets a
confirmed DEVELOPMENT WORK ticket automatically start an nWave implementation run without the
submitter manually invoking anything, while still giving them a moment to confirm the system
understood their intent before hours of engine time are spent on the wrong thing. Concretely:
the system composes a plain-language restatement of the ticket's intent and posts it to the
ticket's channel; on explicit confirmation it assigns a stable `run_id`, spawns the first wave
process, and chains DISCUSS → DESIGN → DISTILL → DELIVER strictly in order on each wave's clean
exit, marking the run COMPLETED once DELIVER exits cleanly; a corrective reply re-requests a new
restatement and withholds the start; a start failure, a non-zero wave exit, or a stalled/silent
wave are all surfaced clearly (`START_FAILED`, `FAILED`, watchdog-halted) rather than shown as
false progress; the run's status and wave history are inspectable and haltable through
`/api/nwave-runs*`, all gated by the platform's existing session auth.

## Business Context

This track was split out of the umbrella feature `nwave-ticket-execution-engine`. It is the
**critical-path track**: every other track in the umbrella feature (`progress-trust-ux`
US-05/US-07/US-08/US-09, and transitively `multi-source-ingestion-governance`'s US-13) depends on
this track's `run_id`/wave-progress-signal contract, but this track itself has **no blocking
upstream dependency** — it only needs the classification *contract* (a confirmed ticket + intent),
not `ticket-classification`'s actual delivery, and was built/demoed against synthetic
classification event data per the umbrella story-map's walking-skeleton design.

## Key Decisions

Pulled from `discuss/wave-decisions.md`, `design/wave-decisions.md`, `distill/wave-decisions.md`
(all three now folded into this document; the source files are discarded per the finalize
destination map).

1. **Invocation mechanism (DESIGN)**: use the existing `shell_start`/`shell_stop`/`shell_status`/
   `shell_tail` async process primitive as the execution substrate, driven by a new deterministic
   orchestration module in `apps/agent-runner/src/nwave-invocation/` — explicitly **not** the
   `WRAPPED` `command` harness (which is blocking/single-shot with no mid-run streaming support,
   conflicting with `progress-trust-ux`'s streaming requirement) and **not** a new harness type.
   See `docs/product/architecture/adr-0001-nwave-invocation-mechanism.md`.
2. **Wave-boundary process chaining (DESIGN)**: one OS process per nWave wave, chained
   sequentially by the orchestrator on clean exit — this is what produces the wave-progress signal
   and defines the safe-checkpoint granularity for future halt/pause (US-09). See
   `docs/product/architecture/adr-0002-wave-boundary-process-chaining.md`.
3. **Data model (DESIGN)**: new `nwave_runs` (aggregate root) and `nwave_run_waves` (entity)
   tables, distinct from the existing `processes` table (one run maps to many wave processes over
   its lifetime).
4. **Architecture style (DESIGN)**: modular monolith with local ports-and-adapters
   (`RunRepositoryPort`/`HttpRunRepository`) applied only to the new module — no change to OrgOps'
   overall single-process deployment shape, no extension of `wrapper-harness/`.
5. **Development paradigm (DESIGN, confirmed by human product owner)**: functional-leaning
   TypeScript, matching `intent-watchdog.ts`/`channel-loop.ts`/`event-routing.ts` conventions (no
   classes; pure functions with explicit state parameters; thin I/O adapter layer). This is why
   the project root `CLAUDE.md` now reads "This project follows the functional programming
   paradigm" and DELIVER-wave implementation was dispatched to `nw-functional-software-crafter`.
6. **Walking-skeleton strategy DWD-01 (DISTILL)**: Strategy B (real local resources, fake costly
   ones), with a refinement for the highest-risk boundary — the walking skeleton's "real"
   `shell_start` proof spawns a trivial, near-instantaneous, genuinely real local process (e.g.
   `echo "invoking DISCUSS for TICKET-1043"`), **not** the actual nWave CLI. `HttpRunRepository`/
   SQLite are real (in-memory SQLite + real Hono app); the Restatement Composer's LLM `generate()`
   call is faked via an injected `GenerateFn`. The actual nWave CLI invocation is deliberately
   never spawned in any acceptance scenario — it is covered only by a separate, gated
   `@requires_external` contract smoke test (step 03-02), mirroring
   `multi-source-ingestion-governance`'s Trello CLI contract-test pattern. This line-drawing was
   explicitly flagged in `distill/wave-decisions.md` for human confirmation and was never
   overridden before DELIVER — it stands as designed.
7. **START_FAILED / HALTED design (step 03-01, DELIVER)**: a `shell_start` spawn failure at run
   creation marks the run `START_FAILED`, referencing the already-assigned run id and never
   emitting a wave-progress event implying work is underway; a non-zero wave exit marks the run
   `FAILED` and halts the chain (no next wave starts). The watchdog's `HALTED` status (stale-wave
   detection) reuses this same terminal-status shape rather than introducing a parallel status
   enum, keeping the run-status state machine single-sourced.
8. **`packages/schemas` extraction (refactoring pass, commit `30ce67f`)**: shared request/response
   shapes for the new routes were extracted during the RPP (Refactor-Persist-Prove?) L1-L4 pass
   rather than left duplicated between `apps/api` and `apps/agent-runner`'s test-support code —
   see that commit for the extracted module boundary.

## Steps Completed

All 6 roadmap steps (`deliver/roadmap.json`), all DONE per `execution-log.json` (verified
independently by the orchestrator via `des.cli.verify_deliver_integrity`, exit 0, "All 6 steps
have complete DES traces"):

| Step | Delivered |
|---|---|
| 01-01 | Pure Run Watchdog stale-wave detection (`collectStaleWaves`) and Wave Progress Translator (`deriveWaveProgressEvents`) — derives `wave_started`/`wave_completed`/`wave_failed` purely from process lifecycle events, never by parsing agent stdout. |
| 01-02 | Pure Confirmation Gate (`evaluateConfirmationResponse`) — CONFIRMED only on explicit affirmative reply, CORRECTION re-requests a new restatement and withholds run start. |
| 02-01 | Walking skeleton: Restatement Composer (`composeRestatement`, LLM-backed), `triggerRunForConfirmedIntent`, and `HttpRunRepository` wired against real `POST /api/nwave-runs`/`.../confirm`/`.../waves` routes and the new `nwave_runs`/`nwave_run_waves` tables (migration 028). Highest-value step: first real HTTP/SQLite/subprocess path. |
| 02-02 | Wave chaining (`advanceToNextWave`, DISCUSS→DESIGN→DISTILL→DELIVER, run COMPLETED on clean DELIVER exit), run inspection (`GET /api/nwave-runs/:id`), halt (`POST .../halt`), and redelivery idempotency (keyed off the wave's own recorded status). |
| 03-01 | Start-failure hardening (`START_FAILED`), non-zero exit hardening (`FAILED`, chain halts), pre-confirmation safety (no run row exists before confirmation), and 401 access control on every `/api/nwave-runs*` route. |
| 03-02 | Gated `@requires_external` nWave CLI headless invocation contract smoke test — skipped locally without a fixture, CI-acceptance-stage-only, matching the Trello CLI contract-test convention. |

Post-DELIVER quality passes (also in the commit range, not separate roadmap steps): an adversarial
review (3 findings, fixed in `deda594`); an RPP L1-L4 refactoring pass (`30ce67f`, including the
`packages/schemas` extraction); Stryker mutation testing introduced to the repo for the first time
(`1e05509`); a post-merge integration gate re-run of the full combined suite.

## Lessons Learned

### Stryker + npm-workspace symlink limitation (genuine tooling gotcha for future features)

`apps/api/src/routes/nwave-runs.ts` measured as a false **0.00%** Stryker kill rate (0 killed / 30
survived / 209 no-coverage) despite being exercised by 92 real HTTP-request assertions in
`nwave-invocation.test.ts`. Root cause: `node_modules/@orgops/api` is an npm-workspace symlink to
`../../apps/api`; Stryker's default `symlinkNodeModules: true` links each mutation sandbox's
`node_modules` straight back to the *real* `node_modules`, so a bare-specifier import
(`@orgops/api/src/app`) resolves through two symlink hops back to the **pristine,
non-instrumented** source file, completely bypassing the sandboxed/mutated copy.
`apps/api/src/app.test.ts`, which imports via a relative path (`./app`), is unaffected — which is
why its generic smoke tests show *some* mutant signal while the route-handler-specific test file
shows none. **Any file reached only through a cross-package bare-specifier import in an acceptance
test will show this same false-zero signal under the current Stryker config** — this is a repo-wide
limitation, not specific to this feature. Recommended follow-up (deferred, infra-level, not this
feature's scope): try `symlinkNodeModules: false` with a sandbox `buildCommand` that regenerates
workspace links, or restructure test-support imports to use relative paths from within the owning
package. Full root-cause detail and the verified elimination of test-discovery as an alternate
cause: `docs/scenarios/nwave-invocation-engine/mutation-report.md`.

### Git-hygiene gap: DISTILL scaffolding left uncommitted (process lesson)

DISTILL wave produced acceptance tests, RED scaffolds, the migration, and route/schema changes for
this track, but they were never committed at the time. Steps 01-01/01-02 each cherry-picked only
their own production file out of the untracked pile, leaving test-file changes floating
uncommitted between steps. This was caught by the orchestrator (not self-detected mid-wave) and
fixed with an explicit catch-up commit (`d411467`, "commit DISTILL scaffolding and DELIVER wave
state") before further TDD steps proceeded. **Process lesson for future DELIVER waves**: verify
`git status` is clean at the start of DELIVER, immediately after DISTILL handoff, not just after
each individual step — a wave boundary is a natural point for scaffolding to be left uncommitted
if the DISTILL agent's own commit discipline doesn't extend to hand-off artifacts.

## Issues Encountered

### Adversarial review findings (Phase 4), all fixed in `deda594`

1. The gated `@requires_external` CLI contract test originally used a vacuous
   `expect(true).toBe(true)` placeholder. Fixed by replacing it with an explicit thrown `Error`,
   since asserting a specific exit-code/output-shape contract would have fabricated an unverified
   claim about the real `claude -p ...` invocation (ADR-0001 explicitly defers those exact flags to
   "first real implementation attempt").
2. The walking skeleton's event batch was missing the agent-posted restatement event before Maria's
   "Looks right" confirmation reply, so `confirmedRestatementText` silently defaulted to `""`
   instead of being pulled from real channel history. Fixed by adding the missing event and
   strengthening assertions to verify the confirmed/persisted text is non-empty and matches the
   actually-composed text (US-04 AC1).
3. `POST /api/nwave-runs` did not reject empty/whitespace-only `restatementText`, inconsistent with
   the existing `requireNonEmptyTrimmedString` validation already applied to `ticketRef`/
   `channelId` in the same handler. Fixed with the same validation pattern plus a route-level 400
   test.

### Mutation testing surfaced one real test-integrity bug

A "wave exits non-zero fails the run" test asserted against a fixture (`DISCUSS`-named wave) that
didn't match the wave name (`DISTILL`) the test actually advanced — `advanceToNextWave` returned
`null` via an early not-found guard, and `expect(nextWave).toBeNull()` passed vacuously without
ever exercising `recordWaveFailure`. Fixed as a legitimate Test Integrity policy exception #1
correction (the test itself had a bug, was passing for the wrong reason — nothing was weakened).
Full detail: `docs/scenarios/nwave-invocation-engine/mutation-report.md`.

### ⚠️ Most important open risk — carry forward prominently

**Headless nWave CLI invocation feasibility remains UNVALIDATED.** The DISCUSS-wave SPIKE that
would have tested whether nWave's wave pipeline can actually be invoked headlessly/
non-interactively by the `claude` CLI (correct flags, non-interactive mode, structured output
format) was explicitly skipped per user directive ("I'm confident that the nwave integration can
run headlessly"). DESIGN and DISTILL both carried this forward as an *accepted working assumption,
not a validated fact*, and deliberately designed around it: the walking skeleton's real
`shell_start` proof spawns a trivial `echo` command, never the real nWave CLI, so DELIVER's own
acceptance suite does not exercise this risk either — it is covered only by a **gated, currently
skipped** `@requires_external` contract test with no local fixture provisioned. **This means the
single highest-risk assumption underpinning this entire track — and by extension every downstream
track that depends on its `run_id`/wave-progress contract — has never been exercised against the
real nWave CLI, end to end, by any test at any wave.** The first real implementation attempt
against a real ticket in a real environment with the fixture provisioned is what will actually
prove or disprove this. If that attempt hits friction, ADR-0001/Decision 1 (invocation mechanism)
should be the first thing revisited, exactly as DISCUSS instructed.

The related "median time from confirmation to run start < 2 minutes" Outcome KPI (US-04) also has
no defensible baseline yet and was never asserted by any scenario — consistent with DISCUSS/
DESIGN's own framing of it as "target to be refined," not committed.

## Links

- Architecture (shared SSOT, not migrated — already permanent): `docs/product/architecture/brief.md`
  (covers this track's Quality Attribute Priorities, Component Architecture, C4 L1/L2/L3, Data
  Model, Failure/Timeout Handling, Extension Points, Architecture Enforcement, External
  Integrations, alongside other tracks of the umbrella `nwave-ticket-execution-engine` feature)
- `docs/product/architecture/adr-0001-nwave-invocation-mechanism.md`
- `docs/product/architecture/adr-0002-wave-boundary-process-chaining.md`
- Migrated scenario docs: `docs/scenarios/nwave-invocation-engine/test-scenarios.md`,
  `docs/scenarios/nwave-invocation-engine/walking-skeleton.md`,
  `docs/scenarios/nwave-invocation-engine/mutation-report.md`
