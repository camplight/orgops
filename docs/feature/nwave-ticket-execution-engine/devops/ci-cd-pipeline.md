# CI/CD Pipeline — nWave Ticket Execution Engine

## The Gap This Closes

`.github/workflows/` contains exactly one workflow, `release-main.yml`, which builds and
publishes the `opscli` binary on every push to `main`. **There is no PR-triggered or push-triggered
test/lint gate anywhere in this repository.** `npm test` (`vitest run`) and `npm run lint`
(per-workspace `tsc --noEmit`) both exist and work locally, but nothing runs them in CI today.
Combined with this project's trunk-based practice (direct commits to `main`, confirmed by
observed git history — no long-lived feature branches), this means **main can currently receive
an untested, unlinted commit with no automated gate at all.**

This is a real gap, not a stylistic preference, and it is materially more important given the
size of what this feature introduces: 8 new tables across 4 modules, 2 new external-integration
surfaces (nWave CLI, `trello-cli`), and a fail-closed governance gate whose correctness (ADR-0010)
depends on server-side logic being tested, not merely reviewed. This DEVOPS pass adds the missing
gate — it is not optional scope, it is a precondition for trunk-based development being safe at
all (see `branching-strategy.md`).

## Rejected Simpler Alternatives

1. **Rely on the existing `release-main.yml` alone, adding test/lint steps to it.** Rejected:
   that workflow's job is "build and publish `opscli`" — a release action, not a change-quality
   gate. Conflating the two means a broken test only surfaces at release time (after `git push`
   to `main` already happened), which is exactly backwards for trunk-based development (the gate
   must run before/at the point of merge, not after release packaging).
2. **Add a full multi-stage pipeline (build → acceptance → capacity → production) immediately.**
   Rejected as premature for this project's current maturity: no acceptance-test suite runs
   against a deployed environment today (no staging environment exists — see `environments.yaml`),
   and capacity/load testing has no NFR evidence requiring it (walking-skeleton scale, 5
   concurrent runs). Build the commit-stage gate now; add acceptance/capacity stages only when a
   real deployed test environment and load requirement exist.

## New Workflow: `.github/workflows/ci.yml` (created, not just specified)

Trigger: `push: [main]`, `pull_request: [main]` — matches trunk-based development (every commit
to `main` gets the full gate; short-lived PRs, if used, get the same gate before merge). The
actual workflow file is committed at `.github/workflows/ci.yml` (this DEVOPS pass writes the
file itself, not only this description — CI/pipeline config is infrastructure-as-code, squarely
in this agent's remit, unlike application/test code). Supporting scripts:
`scripts/ci-migration-check.ts` (migration dry-run), `scripts/prod-smoke-check.ts` (post-deploy
smoke check, see "Deployment Sequence" below), and `.dependency-cruiser.cjs` (architecture
boundary rules, also committed this pass — see "Architecture Boundary Enforcement" below).

Job summary (see the committed file for exact steps):

1. **`build-and-test`**: install → type-check (`npm run lint`) → unit/component tests
   (`npm test`) → migration dry-run (`npm run ci:check-migrations`, backed by
   `scripts/ci-migration-check.ts`) → secrets scan (`gitleaks-action`, **blocking**, not
   `continue-on-error` — a detected secret fails the job) → SCA (`npm audit --audit-level=high`)
   → architecture boundary check (`dependency-cruiser`, **blocking**, config now exists) → build
   UI.
2. **`external-cli-contract-smoke-tests`** (depends on job 1): runs
   `npm run test:contract:nwave-cli --workspaces --if-present` and
   `npm run test:contract:trello-cli --workspaces --if-present`. The `--if-present` flag is the
   concrete fix for the peer-review finding that these scripts don't exist yet: with it, the step
   is a no-op (exit 0) until a workspace defines the script, rather than failing the build on
   every commit until DELIVER lands the test files. **This means CI does not break today, and
   these smoke tests activate automatically — with no further CI change required — the moment
   `software-crafter` adds `test:contract:nwave-cli`/`test:contract:trello-cli` to the relevant
   workspace's `package.json` during DELIVER.** Writing the actual test assertions remains
   `software-crafter`'s task (test code is outside this agent's remit); this pass guarantees the
   CI plumbing is ready and safe the moment that code lands.

## Why Two Dedicated Smoke-Test Jobs, Not Generic Boilerplate

Both are named explicitly in this feature's own DESIGN artifacts as the highest-risk external
boundaries, and both are quasi-external contracts (a CLI's flags/exit codes/output shape, not a
REST API) — Pact-style consumer-driven contract testing does not apply, so a fixed-input/
fixed-expected-shape regression test is the recommended mechanism per every track's brief.md
"External Integrations Requiring Contract Awareness" section.

- **nWave CLI invocation surface** (`nwave-invocation-engine`'s brief.md): this feature's entire
  core mechanism — headless nWave invocation via `shell_start` — is an **unvalidated assumption**.
  The DISCUSS-wave SPIKE that would have tested feasibility was explicitly skipped per user
  directive. A CI smoke test that invokes the actual `claude -p ...` non-interactive command
  against a fixed, minimal fixture and asserts on exit code + output shape is the single
  highest-value CI addition for this feature specifically — it is the earliest automated point at
  which a broken assumption (wrong flags, no non-interactive mode, changed output format) would be
  caught, rather than discovered mid-production-run when a real ticket is already in flight. This
  is flagged as high-value, not boilerplate, precisely because the alternative (first real
  ticket) is a production incident, not a test failure.
- **`trello-cli` invocation surface** (`multi-source-ingestion-governance`'s brief.md/ADR-0008):
  same category of risk — a third-party CLI wrapper (`@trello-cli/cli`) whose output shape
  `TrelloCliBoardReader` depends on staying stable. Lower urgency than the nWave smoke test
  (Release 2 scope, not Release 0), but designed into the pipeline now so it exists before Release
  2 code lands, not retrofitted under release pressure later.

The **assertions inside** each smoke test (exact fixture input, expected exit code, expected
output-shape regex) are new test files `software-crafter` writes during DELIVER — this pass
specifies the CI job structure, the guard mechanism that keeps CI green until they exist, and the
reason they must exist; it does not write the test assertions themselves (application/test code
is outside this agent's remit).

## Quality Gate Taxonomy (full spectrum, per shift-left principle)

| Stage | Gate | Type | Mechanism |
|---|---|---|---|
| Local pre-commit | Format, type-check (fast subset), secrets scan | Blocking (developer) | **New**: recommend `lefthook` (polyglot, fast parallel execution, no existing hook framework in this repo) — not yet configured; DELIVER-wave action item, named here so it is not lost |
| Local pre-push | Full `npm test` + `npm run lint` (mirrors CI commit stage) | Blocking (developer) | Same `lefthook` config, `pre-push` stage |
| PR / push to `main` | `ci.yml`: lint, test, migration dry-run, secrets scan (blocking), SCA, dependency-cruiser (blocking, config committed), build | Blocking (merge/push) | `.github/workflows/ci.yml` (committed this pass) |
| PR / push to `main` | CLI contract smoke tests (nWave, trello-cli) | Blocking once assertions exist; no-op (not a failure) until then | Same workflow, `--workspaces --if-present` guard, separate job for isolation/parallelism |
| Deployment | Migrations applied before new process starts (Recreate strategy) | Blocking (deploy script) | `scripts/ci-migration-check.ts` pattern extended to the real deploy target — see "Deployment Sequence" below |
| Deployment | Boot-time `nwave_run_waves`/`nwave_runs` reconciliation (platform-architecture.md) | Blocking (must complete before runner polls for new work) | New boot-sequence step — **verification test spec below**, not yet an automated CI gate (requires `agent-runner` process control, which is an integration test `software-crafter` must write) |
| Deployment | `ORGOPS_NWAVE_TICKET_ENGINE_ENABLED` feature flag defaults to `false` until Release 0 is ready | Blocking (must be implemented in application code before the first route/module lands on `main`) | `.env.example` documents the variable (committed this pass); the gating logic itself is `software-crafter`'s DELIVER-wave task — see `branching-strategy.md` |
| Production | `npm run deploy:smoke-check` (`scripts/prod-smoke-check.ts`, committed this pass): asserts `GET /api/auth/me` returns 200, `GET /api/nwave-runs` returns 200 with a JSON array (or `{ runs: [...] }`) shape, `GET /api/tickets` returns 200 | Advisory (monitoring; can be promoted to blocking once wired into an automated deploy script) | Post-deploy script, run manually or by an operator's deploy tooling |
| Production | Structured-log + existing-table queries (guardrail accuracy, corrupted-artifact incidents) | Advisory (scheduled review, no paging infra) | See `monitoring-alerting.md` |

`release-main.yml` is **unmodified** by this pass — it remains the `opscli` binary release
workflow; `ci.yml` is additive, not a replacement.

### Boot-Time Reconciliation — Verification Test Spec (for `software-crafter`, DELIVER wave)

Per peer review, the reconciliation requirement named in `platform-architecture.md` needs an
explicit, automatable verification scenario, not only a prose requirement. This is the exact
scenario `software-crafter` should implement as an integration test once the reconciliation code
exists (this agent does not write test code, but a vague requirement is not acceptable either —
this is the concrete spec):

1. Insert an `nwave_run_waves` row with `status = 'RUNNING'` and a `process_id` pointing at a
   `processes` row whose PID does not correspond to any live process (simulating a crash/Recreate
   restart mid-wave).
2. Start (or restart) `agent-runner` against that database.
3. Before the runner's poll loop begins accepting new ticket/run/board work, assert: the
   `nwave_run_waves` row's `status` is now `HALTED`, and the corresponding `nwave_runs` row's
   `status` is `HALTED` (never left `RUNNING`).
4. Assert this happens via the same `RunRepositoryPort.haltRun` path the Run Watchdog uses (no
   parallel halt mechanism introduced).

This test must exist before Release 0 is declared production-ready, because Recreate deployment
makes this the common case on every deploy, not an edge case (see `platform-architecture.md`).

## Deployment Strategy: Recreate

**Chosen because it matches current reality, not because it is the ideal deployment strategy in
the abstract**: single-instance host, no load balancer, `npm run prod:all` already runs all three
processes as one unit. Rolling/blue-green/canary all require either multiple instances or a
routing layer that does not exist and has no NFR justifying building one for this feature
(walking-skeleton scale).

### Rollback First (designed before rollout, per this agent's own mandate)

1. **Application rollback**: the previous known-good commit/tag is redeployable by checking it
   out and re-running the deploy script — no build artifact registry exists today beyond git
   history itself; this is consistent with the project's existing lack of container images.
2. **Database rollback**: every new migration (see below) must ship with the project's existing
   forward-only migration convention (`packages/db/migrations/*.sql`, tracked in a `migrations`
   table, applied in filename order, never re-applied). **This project's migration mechanism has
   no down-migration/rollback script convention today** (confirmed: `migrate()` in
   `packages/db/src/index.ts` only ever applies files forward). Recommendation for this feature's
   new tables specifically: because all 8 new tables are additive (no existing table's columns
   are dropped or renamed — every change across all four tracks' ADRs is additive-only, per each
   track's own "Changed Assumptions" back-propagation discipline), a rollback to a pre-feature
   application version can safely leave the new tables in place (unused by old code, no
   foreign-key conflict) rather than requiring a down-migration. This is only true because the
   schema changes are additive; any future non-additive migration for this feature would need a
   real down-script, which does not exist as a project convention today and is flagged here as a
   gap, not silently assumed solved.
3. **Configuration rollback**: previous `.env` is git/backup-restorable (no secrets manager in
   use today — matches existing project convention, not a new gap this feature introduces).
4. **Process rollback**: Recreate — stop all three processes, redeploy previous version, restart.
   No traffic-shifting mechanism exists to roll back gradually; this is the accepted trade-off of
   the Recreate strategy for a single-instance host.

### Deployment Sequence (migrations before new process, not concurrent)

```
1. Stop agent-runner, api, ui processes (existing prod:all shutdown)
2. Deploy new code (git pull / artifact copy to the host)
3. Confirm ORGOPS_NWAVE_TICKET_ENGINE_ENABLED is set to the intended value for this deploy
   (false until Release 0 is ready to ship in production — see .env.example and
   branching-strategy.md)
4. Run migrations: node --env-file=.env --import tsx -e "
     const { openDb, migrate } = require('@orgops/db');
     migrate(openDb());
   "
   (the same mechanism scripts/ci-migration-check.ts exercises against a throwaway database in
   CI — production runs it against the real .orgops-data/orgops.sqlite)
   — MUST complete successfully before step 5. This is the concrete answer to "several DB
   migrations will be needed... must run migrations before the new process starts, not
   concurrently": migrations run as an explicit, separate, blocking step in the deploy script,
   never implicitly inside `api`'s own startup path racing against `agent-runner`'s startup.
5. Start api (existing `prod:runner:after-api`/`prod:all` sequencing already waits for API
   readiness before starting agent-runner — reused, not re-invented)
6. agent-runner boot-time reconciliation runs (platform-architecture.md) BEFORE the runner
   begins polling for new ticket/run/board work — see the verification test spec above
7. Start ui (Vite preview)
8. Run `npm run deploy:smoke-check` (scripts/prod-smoke-check.ts) — see Quality Gate Taxonomy above
```

Migrations are idempotent by construction (the existing `migrations` tracking table skips
already-applied files) — safe to run on every deploy, including a deploy with zero new migration
files.

## Architecture Boundary Enforcement (committed this pass, closing a peer-review finding)

`.dependency-cruiser.cjs` is committed at the repo root, encoding every module-boundary rule
named across all four tracks' `brief.md` "Architecture Enforcement" sections and ADR-0001/0004/
0006/0008/0012 (e.g., `nwave-invocation/**` must not import `wrapper-harness/**`;
`progress-trust-ux/**` must never import `node:child_process`/the `shell_stop` tool, the
CI-checkable proof behind ADR-0006's zero-tolerance corruption guarantee; only
`TrelloCliBoardReader` may shell out to `trello-cli`). The `ci.yml` job that runs it is
**blocking**, not a warning — this closes the peer-review finding that the check was previously
advisory-only pending a config file that did not exist. The rule `path` patterns assume the
directory names DESIGN's `brief.md` used
(`apps/agent-runner/src/{nwave-invocation,ticket-classification,progress-trust-ux,
multi-source-ingestion-governance}/`); if `software-crafter` names the directories differently
during DELIVER, the config's `path` patterns must be updated to match in the same commit that
introduces the new directory — the rule is the ADR-mandated invariant, not the exact string.

## DORA Metrics Baseline (to establish, not yet measured)

No deployment-frequency/lead-time/change-failure-rate/time-to-restore data exists today (no CI
gate has ever run, so "change failure rate" has no denominator). Once `ci.yml` lands:

- **Deployment frequency**: currently ad hoc/manual — target established once this feature ships:
  at minimum, weekly (matches the project's small-team, trunk-based cadence).
- **Lead time for changes**: currently unmeasured — target < 1 day once CI gate + Recreate deploy
  script are both in place (Elite/High boundary per Accelerate).
- **Change failure rate**: currently unmeasured (no gate to fail against). Target < 15% once
  `ci.yml` has run for several weeks — revisit, do not commit to, until real data exists (same
  honesty standard this feature's own ADRs apply to their KPI baselines).
- **Time to restore**: bounded by Recreate's manual redeploy time; target < 1 hour given a
  single-host, no-load-balancer topology (redeploy + migration + restart is the entire recovery
  path — no traffic-shifting step to add latency).
