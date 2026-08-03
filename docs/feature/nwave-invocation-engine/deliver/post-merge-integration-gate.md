# Post-Merge Integration Gate

`execution-log.json`'s schema/CLI (`des.cli.log_phase`) supports only per-step TDD phase events,
not an arbitrary `gate` event type — recording this gate here instead, per the same adaptation
already made by the sibling `multi-source-ingestion-governance` track for its own post-merge
gate, and for the (also CLI-unsupported) `--roadmap-only` structural-only check earlier in this
DELIVER pass.

- **Command**: `ORGOPS_PROJECT_ROOT="$(pwd)" npx vitest run apps/agent-runner/src/nwave-invocation apps/api/src/app.test.ts apps/agent-runner/src/multi-source-ingestion-governance --reporter=verbose`
- **Result**: 81 passed, 0 failed (across all three suites combined). `nwave-invocation.test.ts` itself: 15 passed, 1 skipped (`@requires_external` CLI contract test, by design — no local fixture, step 03-02).
- **Environments tested**: `docs/feature/nwave-invocation-engine/devops/` does not exist — default matrix applied (`clean` | `with-pre-commit` | `with-stale-config`). Every scenario runs against a freshly-migrated in-memory SQLite instance and, where relevant, a freshly-spawned trivial OS process (`clean`). `with-pre-commit`/`with-stale-config` are N/A for this track's domain (no installer/pre-commit-hook-state concern in US-04) — same reasoning already established in `distill/wave-decisions.md`'s Environment Check (Dimension 8 Check B), applied consistently here.
- **Regression check**: `apps/api/src/app.test.ts` (52 tests) and `apps/agent-runner/src/multi-source-ingestion-governance` (14 active + 17 skipped, deferred per that track's own `deferred-scenarios.md`) both pass unmodified on current HEAD.
- **Status**: PASS.
- **Timestamp**: 2026-08-03T14:05:00Z
