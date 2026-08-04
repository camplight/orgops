# Acceptance Test Scenarios: nWave Invocation Engine

Source of scenarios: `docs/feature/nwave-invocation-engine/discuss/user-stories.md` US-04's four
UAT scenarios (used as starting scenarios 1, 2, 3, 4 below, not re-derived) plus additional
error/edge/property scenarios added to meet the 40%+ error-path mandate, cover every AC, and
cover every row of brief.md's Failure/Timeout Handling table. Implementation: colocated
`nwave-invocation.test.ts` (this repo has no Gherkin/Cucumber tooling — see root `CLAUDE.md`),
business-language `describe`/`it` titles, `@tag` markers inside the string since vitest has no
BDD tag mechanism (same convention `multi-source-ingestion-governance` already established in
this codebase).

Total: **15 scenarios** (1 walking skeleton + 14 focused). Error/edge scenarios: **9/15 (60%)**
— exceeds the 40% mandate.

## US-04: nWave Implementation Run Triggering — `nwave-invocation.test.ts`

| # | Tags | Scenario | AC | Type |
|---|---|---|---|---|
| 1 | `@walking_skeleton @real-io @in-memory @driving_port` | Maria confirms the system's understood intent and an nWave implementation run starts, identified by a stable run id | AC1, AC2, AC4 | Happy (WS) |
| 2 | `@driving_port` | Carlos corrects a misunderstood restatement and the run does not start until re-confirmed | AC3 | Edge |
| 3 | (none) | Maria is told clearly a run could not start when the execution environment is unavailable, never shown false progress | AC5 | Error |
| 4 | `@property` | The run id remains stable and is referenced by every wave transition for the life of the run | AC4 | Edge/property |
| 5 | `@driving_adapter @real-io` | A run's current status and wave history are observable through the run detail view | AC4 | Happy |
| 6 | (none) | A wave that exits with a non-zero code fails the run and halts the chain without starting the next wave | AC5 | Error |
| 7 | (none) | A wave that produces no output for longer than the configured threshold is halted with a clear "no progress" signal | AC5 (brief.md Run Watchdog row) | Error |
| 8 | (none) | A run's wave-progress signal is derived from process lifecycle events, not from parsing agent output | AC4 (core observable contract) | Happy |
| 9 | `@driving_adapter @real-io` | A stalled run can be halted through the run's halt action, and no further waves proceed after halting | AC5 | Error/edge |
| 10 | `@property` | A redelivered wave-completion notification does not advance the run a second time | AC5 (at-least-once event guarantee) | Edge (idempotency) |
| 11 | (none) | Before any confirmation is observed, no run is ever created or shown as in progress | AC2 | Error |
| 12 | (none) | Wave chaining follows DISCUSS, DESIGN, DISTILL, DELIVER in order, and the run completes once DELIVER exits cleanly | AC4, AC5 (ADR-0002) | Happy |
| 13 | (none) | Someone with no authenticated session cannot halt or inspect an implementation run | (implicit access control) | Error |
| 14 | (none) | The system composes a plain-language restatement of the ticket's intent before any run starts | AC1 | Happy |
| 15 | `@requires_external` | The nWave CLI headless invocation contract remains stable (skipped without fixture) | — (brief.md's own recommendation) | Infra contract |

## Traceability Check (Dimension 8, Check A)

US-04 (this track's only story) has multiple matching scenarios (all 15, tagged `@US-04` in each
scenario title and referenced in the AC column above) — no zero-coverage story.

## AC Coverage Check (Dimension 4)

| AC | Scenarios |
|---|---|
| AC1: restatement posted before any run starts | 1, 14 |
| AC2: confirmation required before run starts | 1, 11 |
| AC3: correction prevents run start until re-confirmed | 2 |
| AC4: stable run id used consistently in all later messages | 1, 4, 5, 8, 12 |
| AC5: failed trigger attempt clearly communicated, never silently "in progress" | 3, 6, 7, 9, 10, 12 |

All 5 ACs covered, most by multiple scenarios.

## Environment Check (Dimension 8, Check B)

No `docs/feature/nwave-invocation-engine/devops/environments.yaml` exists (soft-gate default
applied: `clean | with-pre-commit | with-stale-config`). Every scenario runs against a
freshly-migrated in-memory SQLite instance and, where relevant, a freshly-spawned trivial OS
process (equivalent to the "clean" environment). This track's story has no dependency on
pre-commit hook state or stale config files — `with-pre-commit`/`with-stale-config` are not
applicable preconditions for any Given clause here (same conclusion the sibling
`multi-source-ingestion-governance` track reached for its own stories), flagged as N/A rather
than silently omitted.
