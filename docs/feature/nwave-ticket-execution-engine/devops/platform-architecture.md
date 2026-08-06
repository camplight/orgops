# Platform Architecture — nWave Ticket Execution Engine (DEVOPS Wave, Umbrella-Level)

## Why This Runs Once, at the Umbrella Level

DESIGN was split per track (`ticket-classification`, `nwave-invocation-engine`,
`progress-trust-ux`, `multi-source-ingestion-governance`) because each track has a distinct
application-level component boundary. All four tracks deploy as **one monolith**: new modules
under the existing `apps/agent-runner/src/*` tree, new routes under the existing
`apps/api/src/routes/*` tree, and new tables in the single `packages/db` SQLite schema. There is
no independent deployment unit per track. Doing CI/CD, infra, and observability design four times
would produce four incompatible or redundant pipelines for one process topology — this pass
produces one.

## Current Deployment Reality (confirmed by reading the repo, not assumed)

- No `Dockerfile`, no `docker-compose.yml` anywhere in the repo.
- `npm run prod:all` runs `api`, `ui` (Vite preview), and `agent-runner` as three plain Node
  processes on one host via `concurrently`, gated by `scripts/start-runner-after-api.ts` (polls
  `GET /api/auth/me` until the API is ready before starting the runner — this pattern already
  exists and this feature does not need to invent a second one).
- `apps/opscli` is a separate bootstrap/maintenance CLI, built into standalone binaries
  (Linux/macOS/Windows) via `.github/workflows/release-main.yml` — unrelated to this feature's
  runtime deployment; not touched here.
- Single-instance, no load balancer, no container orchestration.

## Rejected Simpler Alternatives (per `nw-cicd-and-deployment` simplest-first check)

Before accepting "no new infrastructure," two even-simpler-looking options were considered and
rejected as insufficient — not skipped:

1. **Do nothing beyond application code changes (no new env vars, no migration ordering
   guidance).** Rejected: this feature adds 8 new tables, 2 new interval-scheduled background
   loops (Trello Ingestion Poller, Stuck-Run Detector), and new external-integration config
   (Trello board registration). Treating that as "pure business logic, no environments needed"
   would ship silently-missing migrations and undocumented new env vars into production.
2. **Introduce containerization (Docker) now, to make this feature "cloud-ready."** Rejected:
   no evidence of a scaling or portability requirement anywhere in DISCUSS/DESIGN for this
   feature (NFRs cap at "5 concurrent runs, walking-skeleton scale" per
   `nwave-invocation-engine`'s brief.md). Introducing Docker would be new infrastructure with no
   stated need, contradicting the project's own bare-process convention and this feature's own
   "no new deployment shape" architecture decisions (every track's brief.md section explicitly
   states "no change to OrgOps' overall single-process deployment shape").

Confirmed target: **stay on the existing bare-process, self-hosted model.** This feature adds
code and schema to the existing three-process topology; it does not change the topology.

## Process Topology (unchanged shape, new internal components)

```
Host (single instance)
├── api            (Hono + WebSocket) — owns all persistence + event bus + pub/sub
│     + new routes: tickets.ts, nwave-runs.ts (extended), trello-ingestion.ts,
│       guardrail-allowlist.ts
├── agent-runner    (Node.js, long-lived poll loop, ~1s cadence)
│     existing:      intent-watchdog.ts, maintenance-loop.ts, wrapper-harness/*
│     + new modules (all deterministic, non-LLM-turn, same architectural position as
│       intent-watchdog.ts/maintenance-loop.ts — not new processes):
│         nwave-invocation/          (Restatement Composer, Confirmation Gate, Wave Runner,
│                                      Wave Progress Translator, Run Watchdog)
│         ticket-classification/     (Classifier, Classification Orchestrator,
│                                      Override/Audit Handler)
│         progress-trust-ux/         (Completion Summary Composer, Mid-Run Message Handler,
│                                      Conflict Assessor, Pause/Halt Controller)
│         multi-source-ingestion-governance/
│                                     (Trello Ingestion Poller, Guardrail Evaluator,
│                                      Governance Approval Handler, Failure/Recovery Advisor,
│                                      Stuck-Run Detector)
├── ui              (Vite preview, same-origin /api + /ws)
└── SQLite (WAL mode, packages/db) — 8 new tables (see Migration Strategy below)
```

No new deployment unit. The two new interval-scheduled loops (Trello Ingestion Poller,
Stuck-Run Detector) run **inside the existing `agent-runner` process**, mirroring
`maintenance-loop.ts`'s schedule/in-flight-guard shape — they are new code paths in an existing
process, not new services.

## Coexistence Matrix (must not break existing `agent-runner` capabilities)

| Existing capability | Risk from this feature | Mitigation |
|---|---|---|
| `intent-watchdog.ts` (existing idle/timeout detection for `WRAPPED` agents) | New Run Watchdog (nwave-invocation) uses a structurally similar `ingest*`/`collectDue*` pattern but a **separate** timeout domain (`nwave_run_waves`, not agent intents) | No shared state; dependency-cruiser rules (per every track's brief.md "Architecture Enforcement") keep the new modules from importing `wrapper-harness/**`. CI enforces this once the shared config lands (see `ci-cd-pipeline.md`). |
| `maintenance-loop.ts` (existing scheduled loop) | Two new scheduled loops (Trello poll, stuck-run scan) added to the same runner process — additive CPU/interval load, not a conflicting schedule (per-board/per-run keyed, independently configurable intervals, coarser than the 1s poll cadence, explicitly to respect Trello API rate limits) | New loops must ship with their own configurable interval env vars (see Environments below) so operators can tune load without redeploying code. |
| `WRAPPED`/`CLASSIC` agents, `wrapper-harness/` | New modules explicitly forbidden (by every track's own architecture-enforcement rules) from importing `wrapper-harness/**` — ADR-0001's deliberate non-extension boundary | Verified structurally by the recommended `dependency-cruiser` config (not yet wired into CI — see `ci-cd-pipeline.md` for the gap and how this pass closes it). |
| `shell_start`/`shell_stop`/`shell_tail` (existing async process primitive) | Reused, not modified, by the Wave Runner (ADR-0001) and `TrelloCliBoardReader`'s async `spawn`/`execFile` calls | No change to `tools/shell.ts`. `TrelloCliBoardReader` is the only new module permitted to invoke `node:child_process` directly (per ADR-0008/brief.md enforcement rule) — this is a CI-checkable constraint once dependency-cruiser lands. |
| `GET /api/processes?reconcile=1` (existing PID-liveness reconciliation on restart) | New `nwave_run_waves`/`nwave_runs` rows can be left `RUNNING` with no live process after an `agent-runner` restart mid-wave — named as an explicit gap in `nwave-invocation-engine`'s brief.md ("Not solved in this design pass... platform-architect (DEVOPS wave)") | **Addressed in this DEVOPS pass** — see "Boot-Time Reconciliation" below. |

## Boot-Time Reconciliation (closing the named DESIGN-wave gap)

`nwave-invocation-engine`'s brief.md explicitly named this as a DEVOPS-wave follow-up, not
designed in full during DESIGN: on `agent-runner` boot, for every `nwave_run_waves` row in
`RUNNING` status with a `process_id`, call the same PID-liveness check the existing
`GET /api/processes?reconcile=1` route already performs. If the PID is dead, mark the wave
`HALTED` and the run `HALTED` (never left silently `RUNNING`) via the same
`RunRepositoryPort.haltRun` path the Run Watchdog already uses.

This is a direct extension of an already-tested reconciliation pattern — not new logic, a new
call site. **Required for the Recreate deployment strategy specifically**: because Recreate stops
the old process and starts a new one (no live handoff), every deployment is exactly the scenario
this reconciliation must handle correctly, not an edge case. It must run before the runner begins
polling for new work, not after. Implementation is `software-crafter`'s task during DELIVER;
this pass specifies the requirement and where it must run in the boot sequence (see
`ci-cd-pipeline.md` → Deployment Stage).

## New Environment Variables Introduced by This Feature

None of these existed before this feature; all follow the existing `ORGOPS_*` naming and
`.env.example` documentation convention.

| Variable | Purpose | Default (recommended) |
|---|---|---|
| `ORGOPS_NWAVE_TICKET_ENGINE_ENABLED` | Feature flag gating every new route (`/api/tickets*`, `/api/nwave-runs*`, `/api/trello-ingestion*`, `/api/guardrail-allowlist*`) and every new `agent-runner` module's poll/consume loop — required so this feature's necessarily-incremental trunk-based landing does not expose incomplete work in production (see `branching-strategy.md`) | `false` until Release 0 is ready to ship. **The gating logic itself is `software-crafter`'s DELIVER-wave implementation task, not built by this pass** — this pass documents the variable in `.env.example` (committed this pass) and treats it as a mandatory precondition, not an optional nicety, per peer review. |
| `ORGOPS_NWAVE_WAVE_IDLE_TIMEOUT_MS` | Run Watchdog per-wave idle/staleness threshold (hard halt) | `1800000` (30 min) — provisional, per this feature's own DESIGN-wave honesty about unmeasured baselines |
| `ORGOPS_NWAVE_STALE_MULTIPLIER` | Stuck-Run Detector's multiplier over `progress-trust-ux`'s per-wave baseline table (ADR-0012: 2x) | `2` |
| `ORGOPS_TRELLO_POLL_INTERVAL_MS` | Trello Ingestion Poller cycle interval, independently configurable and coarser than the 1s runner poll cadence (ADR-0008) | `300000` (5 min) |
| `ORGOPS_TRELLO_CLI_TIMEOUT_MS` | Bounded timeout for `TrelloCliBoardReader`'s async CLI invocation (ADR-0008 Consequences — must reject, never hang) | `30000` |
| `ORGOPS_NWAVE_MAX_AUTO_RETRY_COUNT` | Failure/Recovery Advisor's retry-exhaustion threshold (fixed at 2 per US-13's own domain example, exposed as config rather than a hardcoded magic number per code-style guidance) | `2` |
| `ORGOPS_GUARDRAIL_DEFAULT_MODE` | Documents, does not change, ADR-0010's fail-closed default (`GOVERNANCE_HOLD` when `changedFilePaths` unavailable) — present for operator visibility, not a toggle to disable the fail-closed gate | `GOVERNANCE_HOLD` (fixed, not operator-overridable — see `monitoring-alerting.md`) |
| `TRELLO_API_KEY` / `TRELLO_API_TOKEN` (or equivalent, matching whatever `@trello-cli/cli` itself expects) | Credentials for the existing `trello-cli` skill, now invoked programmatically by `TrelloCliBoardReader` rather than only interactively by an LLM turn | none (must be set before enabling any Trello board) |

All new variables are additive to `.env.example`; none change the meaning of an existing
variable.

## Infrastructure Artifacts Committed This Pass

Unlike application/test code (outside this agent's remit), the following are infrastructure
configuration and tooling, and are committed directly as part of this DEVOPS pass, not merely
described:

- `.github/workflows/ci.yml` — the CI gate closing the pre-existing gap (see `ci-cd-pipeline.md`)
- `.dependency-cruiser.cjs` — architecture-boundary rules for all four new modules (ADR-0001/
  0004/0006/0008/0012), wired into `ci.yml` as a blocking check
- `scripts/ci-migration-check.ts` — migration dry-run used by CI
- `scripts/prod-smoke-check.ts` — post-deploy smoke check (`npm run deploy:smoke-check`)
- `.env.example` — extended with this feature's new variables, including
  `ORGOPS_NWAVE_TICKET_ENGINE_ENABLED`

## Handoff

Full CI/CD, observability, alerting, branching, KPI-instrumentation, and environment detail are
in the sibling documents in this directory. This document is the single platform-architecture
reference all four tracks' DELIVER-wave implementers should read before writing infra-adjacent
code (migrations, background loop scheduling, new route files).
