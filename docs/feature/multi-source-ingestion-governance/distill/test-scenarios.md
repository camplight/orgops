# Acceptance Test Scenarios: Multi-Source Ingestion & Governance

Source of scenarios: `docs/feature/multi-source-ingestion-governance/discuss/user-stories.md`
UAT scenarios (used as starting scenarios, not re-derived) plus additional error/edge/property
scenarios added to meet the 40%+ error-path mandate and cover every AC. Implementation:
colocated `*.test.ts` files (this repo has no Gherkin/Cucumber tooling — see root `CLAUDE.md`),
business-language `describe`/`it` titles, `@tag` markers inside the string since vitest has no
BDD tag mechanism.

Total: **26 scenarios** (3 walking skeletons + 23 focused). Error/edge scenarios: **14/26 (54%)**
— exceeds the 40% mandate.

## US-11: Trello Ingestion — `trello-ingestion.test.ts` (8 scenarios, 4 error/edge = 50%)

| # | Tags | Scenario | AC | Type |
|---|---|---|---|---|
| 1 | `@walking_skeleton @real-io @in-memory @driving_port` | Maria adds a Trello card and it becomes a ticket, identical in structure to a native-form submission | AC1, AC4 | Happy (WS) |
| 2 | `@driving_adapter @real-io` | A governance-team member registers a board for ingestion and can observe its poll status | AC1, AC3 | Happy |
| 3 | (none) | Moving an existing card between lists does not create a duplicate ticket | AC2 | Edge |
| 4 | (none) | Ingestion recovers from a temporary Trello API outage without silently missing the card | AC3 | Error |
| 5 | `@property` | Two near-simultaneous syncs of the same card never create two ticket records | AC5 | Error/race (property) |
| 6 | (none) | Ingested tickets are created through the identical endpoint a native-form submission uses | AC4 | Happy |
| 7 | (none) | A submitter without any session cannot configure Trello ingestion boards | AC1 (implicit access control) | Error |
| 8 | `@requires_external` | The trello-cli CLI invocation contract remains stable (skipped without fixture) | — (brief.md's own recommendation) | Infra contract |

## US-12: Approve/Request-Changes Governance Gate — `governance-approval.test.ts` (11 scenarios, 6 error/edge = 55%)

| # | Tags | Scenario | AC | Type |
|---|---|---|---|---|
| 1 | `@walking_skeleton @real-io @driving_port` | Maria approves a completed implementation and the ticket is marked resolved | AC1, AC2 | Happy (WS) |
| 2 | (none) | Devon requests changes with specific feedback and the original context is preserved | AC3 | Happy alt |
| 3 | (none) | A run that touched a file outside the guardrail allowlist requires governance sign-off before Maria can approve | AC4 | Error/gate |
| 4 | (none) | Anyone with governance access can see who approved TICKET-1043 and when | AC5 | Happy (audit) |
| 5 | (none) | Guardrail evaluation fails closed to governance hold when changed-file data is unavailable | AC4, ADR-0010 | Error (priority-1 correctness) |
| 6 | `@property` | Approve is never available while a run is on governance hold, regardless of who requests it | AC4 | Error (property) |
| 7 | (none) | An unauthorized governance sign-off attempt is rejected before any write | AC4 | Error |
| 8 | (none) | A redelivered approval action is a no-op, not a second decision | AC5 | Edge (idempotency) |
| 9 | `@driving_adapter @real-io` | A governance-team member manages the guardrail allowlist through the API | AC4 (mechanism) | Happy |
| 10 | (none) | The guardrail evaluator itself holds every completion for governance review while file-change data is unavailable | AC4 | Error (direct component) |
| 11 | (none) | The guardrail evaluator clears every path covered by the allowlist | AC4 | Happy (direct component) |

## US-13: Failure/Stuck Recovery — `failure-recovery.test.ts` (7 scenarios, 4 error/edge = 57%)

| # | Tags | Scenario | AC | Type |
|---|---|---|---|---|
| 1 | `@walking_skeleton @driving_port` | Devon sees a clear, non-blaming summary within 2 minutes of a failed run | AC1, AC2, AC3 | Happy (WS) |
| 2 | (none) | TICKET-1043's stalled run is proactively flagged, not silently left for Maria to discover | AC4 | Edge |
| 3 | `@property` | Raw stack traces are never shown without plain-language context, for any failure | AC3 | Error (property) |
| 4 | `@property` | Repeated failures always escalate instead of looping forever, regardless of failure reason | AC5 | Error (property) |
| 5 | `@driving_adapter @real-io` | Devon retries a failed run with one action, without re-entering information | AC1 (implied), retry | Happy alt |
| 6 | (none) | A stuck flag auto-clears once the run's activity resumes | AC4 | Edge |
| 7 | `@driving_adapter @real-io` | Escalation and closure are reachable through the API with accumulated context | AC5 | Happy (recovery journey) |

## Traceability Check (Dimension 8, Check A)

Every story ID (US-11, US-12, US-13) has multiple matching scenarios (tagged in each test
file's `describe` block and referenced in this table) — no story has zero coverage.

## Environment Check (Dimension 8, Check B)

No `docs/feature/multi-source-ingestion-governance/devops/environments.yaml` exists (soft-gate
default applied: clean | with-pre-commit | with-stale-config). All scenarios run against a
freshly-migrated in-memory SQLite instance per test (equivalent to the "clean" environment). This
track's stories have no dependency on pre-commit hook state or stale config files, so
`with-pre-commit`/`with-stale-config` are not applicable preconditions for any Given clause here
(unlike, e.g., an installer-focused feature) — flagged as N/A rather than silently omitted.
