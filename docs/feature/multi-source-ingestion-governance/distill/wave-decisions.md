# Wave Decisions: Multi-Source Ingestion & Governance Track — DISTILL Wave

## Prior-Wave Reconciliation Gate

Read in full before writing any scenario, per the port-to-port principle:

- `docs/feature/multi-source-ingestion-governance/discuss/README.md`, `user-stories.md`,
  `wave-decisions.md`, `dor-validation.md`
- `docs/feature/multi-source-ingestion-governance/design/wave-decisions.md`
- `docs/product/architecture/brief.md` → `## Multi-Source Ingestion & Governance` (lines
  1470-2146, full section, including C4 component diagram, failure-handling table, extension
  points, architecture enforcement rules)
- `docs/product/journeys/nwave-ticket-execution-engine.yaml` /
  `journey-nwave-ticket-execution-engine-visual.md` (umbrella journey; this track implements
  steps 6-7 approval/recovery plus an alternate step-1 ingestion path)
- No SPIKE artifacts for this track (`dor-validation.md` confirms no SPIKE dependency)
- No DEVOPS artifacts for this track yet — default environment matrix applied (clean |
  with-pre-commit | with-stale-config), per graceful degradation rules (soft gate, logged, not
  blocking)
- No `docs/product/kpi-contracts.yaml` exists anywhere in this repo (soft gate, warned, proceeded
  — repo-wide gap, not specific to this feature)

**Reconciliation passed — 0 contradictions.** Cross-checked independently (not merely trusting
the prompt's prior claim): US-11/US-12/US-13's DISCUSS-wave UAT scenarios and ACs (five, five,
four respectively) map cleanly onto DESIGN's Component Architecture (Trello Ingestion Poller +
Trello Ingestion Config; Guardrail Evaluator + Governance Approval Handler + Guardrail Allowlist
Config; Failure/Recovery Advisor + Stuck-Run Detector + Retry/Escalate/Close). No AC references a
component absent from DESIGN; no DESIGN component lacks a traceable AC. DESIGN's own peer review
(`nw-solution-architect-reviewer`, conditionally approved, 0 critical) already remediated the one
item that would otherwise have been a DISTILL-blocking ambiguity (`TrelloCliBoardReader`
async-spawn error contract) before this wave began.

## Codebase Reality Check (not itself a contradiction, but load-bearing for DISTILL's design)

None of the three sibling DESIGN-wave tracks this track depends on (`ticket-classification`,
`nwave-invocation-engine`, `progress-trust-ux`) have reached DELIVER in this codebase yet:
`apps/api/src/routes/` has no `tickets.ts` or `nwave-runs.ts`; `packages/db/src/schema.ts` has no
`tickets`/`nwave_runs`/`nwave_run_completions` tables; `packages/schemas/src/` has no
`run-activity.ts`. `.dependency-cruiser.cjs` (already present from the DEVOPS pass) independently
confirms the exact paths this DISTILL pass needed (`apps/api/src/routes/tickets.ts`,
`apps/agent-runner/src/multi-source-ingestion-governance/trello-cli-board-reader.ts`,
`packages/schemas/src/run-activity.ts`), so scaffold placement is not a guess.

## DWD-01: Walking-Skeleton Strategy — Strategy B (Real Local + Fake Costly)

**Decided interactively with the human before this DISTILL pass ran** (per the task prompt);
recorded here as the formal, numbered wave decision this skill requires.

- **Real** (`@real-io`): SQLite via `@orgops/db`'s `openDb(":memory:")` + `migrate(db)`, and the
  real Hono API app via `createApp` from `@orgops/api/src/app` — driven through
  `app.request(...)`, exactly matching the existing convention in `apps/api/src/app.test.ts`.
- **Fake** (`@in-memory`): `TrelloIngestionPort` — the Trello CLI integration is a costly,
  rate-limited external dependency; every US-11 scenario uses an in-memory test double
  (`createFakeTrelloIngestionPort`) instead.
- **`@requires_external`**: one CLI contract smoke test recommended by the architecture brief
  itself ("External Integrations Requiring Contract Awareness"), skipped by default (no
  fixture/credentials in this environment), matching the CI workflow's own
  `test:contract:trello-cli --if-present` guard already wired in `.github/workflows/ci.yml`.

## DWD-02: Prerequisite Scaffolds for Undelivered Sibling Contracts

Since `ticket-classification` and `nwave-invocation-engine`/`progress-trust-ux` have not reached
DELIVER, this track's acceptance tests need real driving ports to call. Two categories of
scaffold were created, kept explicitly distinct in every file's own doc comment:

1. **Owned by this track** (real DESIGN content, RED per Mandate 7): `trello-ingestion.ts`,
   `guardrail-allowlist.ts`, and the five new DB tables
   (`trello_ingestion_boards`/`trello_ingestion_seen_cards`/`guardrail_allowlist_entries`/
   `guardrail_decision_audit`/`nwave_run_stuck_flags`) plus migration `027`.
2. **Prerequisite-only scaffolds for sibling tracks** (minimal, out-of-scope structure only,
   never real business logic): `apps/api/src/routes/tickets.ts` (base `POST /api/tickets`,
   `ticket-classification`'s contract), `apps/api/src/routes/nwave-runs.ts` (base run actions,
   `nwave-invocation-engine`/`progress-trust-ux`'s contract — this track only extends it with the
   seven completion-summary/retry/escalate/close/cycle-history handlers it actually owns), and
   `packages/schemas/src/run-activity.ts` (`progress-trust-ux`'s shared `Run Activity Deriver`).
   No table for `tickets`/`nwave_runs`/`nwave_run_completions` was added to `packages/db/src/
   schema.ts` — the prerequisite route scaffolds never touch the database at all (every handler
   throws before any I/O), so no sibling-track data model needed to be invented here.

This keeps this DISTILL pass's actual scope bounded to its own three stories while still
satisfying Mandate 7 ("never a bare import failure").

## DWD-03: Access Modeling Simplification for Acceptance Tests

The codebase's only human fixture today is the seeded admin account (`apps/api/src/app.ts`'s
bootstrap). No second human + `teams`/`team_memberships` fixture exists yet to distinguish
"authenticated submitter" from "authenticated governance-team member" from "authenticated but
wrong role." Acceptance tests therefore authenticate as the seeded admin for every scenario that
needs *a* human session (standing in for whichever role the scenario names — Maria, Devon, or
Priya), and use *no* session at all for the two scenarios that test the already-real,
already-implemented global `/api/*` authentication gate (`apps/api/src/routes/auth.ts`'s
`app.use("/api/*", ...)` middleware) — those two scenarios pass today because that cross-cutting
behavior genuinely already works, not because of scaffold accident (see `acceptance-review.md`
for verification of this distinction). Fine-grained role authorization
(`canSignOffGuardrail`/`canManageTrelloIngestion`) remains untestable at the acceptance level
until a second human + team fixture exists; DELIVER wave should add one when implementing those
checks.

## Adapter Coverage Table

| Adapter | `@real-io` scenario? | `@in-memory` scenario? | Notes |
|---|---|---|---|
| `TrelloIngestionPort` / `TrelloCliBoardReader` | `@requires_external` contract test only (skipped without fixture) | Yes — all 6 non-contract US-11 scenarios use `createFakeTrelloIngestionPort` | Costly/rate-limited external dependency; faked per Strategy B, exactly as decided |
| `GovernanceRepositoryPort` / `HttpGovernanceRepository` | Yes — every US-11 poller scenario wraps the real Hono app via `apiFetchAsRunner` | No | Never faked; this is the "real local" half of Strategy B |
| SQLite (`@orgops/db`) | Yes — every test file's `createRealApiApp` uses real `openDb(":memory:")` + `migrate(db)` | No | Matches `apps/api/src/app.test.ts`'s existing convention exactly |
| HTTP (Hono `app.request`) | Yes — every `@driving_adapter` scenario across all three test files | No | In-process HTTP, real routing/middleware/serialization, no network socket needed |

Audit: every driven adapter named in brief.md's Component Architecture has at least one
`@real-io` scenario except `TrelloIngestionPort` itself, which is the single adapter Strategy B
explicitly designates as faked (its `@real-io` coverage is the gated `@requires_external`
contract test, matching brief.md's own recommendation).
