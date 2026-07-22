# Observability Design — nWave Ticket Execution Engine

## Substrate Decision: Structured Logs + Existing Tables, Not a New Stack

No metrics/tracing stack exists in OrgOps today (confirmed: no Prometheus/OTel/Grafana
dependency anywhere in `package.json`), and this feature introduces no NFR that requires one
(walking-skeleton/5-concurrent-runs scale, single-host deployment). `ticket-classification`'s own
DESIGN pass already established the pattern this DEVOPS pass extends project-wide: reuse the
durable, structured tables each track's DESIGN already created as the observability substrate,
rather than inventing a parallel logging/metrics mechanism. This mirrors that track's own
peer-review remediation (observability was elevated from "not addressed" specifically because
"reliability cannot be claimed as a top priority without a way to observe whether it's holding" —
the same reasoning applies to every other track's reliability/correctness priority-1 quality
attribute).

**Rejected alternative**: stand up Prometheus + Grafana (or equivalent) for this feature. Rejected
because (a) no other part of OrgOps has this infrastructure, making this feature an isolated,
unmaintained island of tooling nobody else operates; (b) every metric this feature's outcome KPIs
need is already a queryable column on a table the DESIGN passes deliberately built for this exact
purpose (see `kpi-instrumentation.md`); (c) it would be new infrastructure with no evidence of a
scale/query-frequency need beyond what `SELECT` against SQLite already serves at this project's
size.

## Three Pillars, Applied at This Project's Actual Scale

### Logs

Continue the existing pattern (`console.warn`/`console.log` in `maintenance-loop.ts` and
similar), extended to structured JSON for every new module, so log lines are greppable/parseable
without a log-aggregation stack:

- Every new deterministic component (Wave Runner, Classification Orchestrator, Guardrail
  Evaluator, Trello Ingestion Poller, Stuck-Run Detector, etc.) logs state transitions as
  single-line JSON: `{ ts, module, event, runId?, ticketId?, waveId?, boardId?, outcome }`.
- Failure paths (per every track's Failure/Timeout Handling table — LLM errors, spawn failures,
  Trello API errors, unauthorized access attempts) log at `warn`/`error` level with the same
  shape plus a `reason` field, matching the "never silent" reliability priority every track
  shares.
- No new logging library dependency — matches this project's existing convention (plain
  `console.*`, no Winston/Pino anywhere in the codebase today).

### Metrics (derived from tables, not a metrics pipeline)

Every "metric" this feature needs is a `SELECT` against an existing/new table, run on demand or
on a schedule (see `monitoring-alerting.md` for cadence), not a push-based metrics pipeline:

| RED/Golden Signal | Query substrate |
|---|---|
| Rate (ticket creation, run starts, board polls) | `COUNT(*)` over `tickets.created_at`, `nwave_runs.started_at`, `trello_ingestion_boards.last_polled_at` windows |
| Errors (classification failures, wave failures, poll failures, guardrail holds) | `COUNT(*)` over `ticket_classification_audit.event_type = CLASSIFICATION_FAILED`, `nwave_run_waves.status = FAILED`, `trello_ingestion_boards.last_poll_status = FAILED`, `nwave_run_completions.approval_status = GOVERNANCE_HOLD` |
| Duration (classification latency, run duration, decision latency) | `tickets.classified_at - tickets.created_at`; `nwave_runs.ended_at - nwave_runs.started_at`; `guardrail_decision_audit.created_at - nwave_run_completions.posted_at` |
| Saturation (concurrent runs vs. the 5-concurrent-runs NFR) | `COUNT(*) WHERE nwave_runs.status = 'RUNNING'` |

### Traces

Not built. No multi-service request flow exists to trace (single process, single host); the
`run_id` → `nwave_run_waves.process_id` → `processes` chain already gives causal linkage across a
run's lifetime, which is what a trace would otherwise provide, without new tooling. This is the
same "no new mechanism where an existing identifier already serves the purpose" reasoning every
track's own DESIGN applied to its own domain (e.g., `ticket_classification_audit`'s reuse of
`ticket_id` for correlation).

## Correlation

Every event this feature emits already carries `runId`/`ticketId`/`channelId` (per every track's
domain-event list in `brief.md`) — this is the correlation key across logs, tables, and the
existing channel-scoped event bus. No new correlation-id scheme is introduced.

## Known Instrumentation Gap: DELIVER-Wave Output Contract (ADR-0007)

Stated plainly, matching this feature's own design-wave honesty standard rather than glossed
over: `nwave_run_completions.contract_data_available` is `false` for every run until the
DELIVER-wave output contract (named as an open cross-cutting gap by `progress-trust-ux`'s
brief.md and inherited by `multi-source-ingestion-governance`'s guardrail evaluation) is defined.
This means:

- Metrics derived from `branchRef`/`prUrl`/`scenariosPassed`/`scenariosTotal`/`changedFilePaths`
  (e.g., "median time-to-verify" from the outcome KPIs) can be **partially** instrumented today
  (the timestamp deltas around the completion message are real) but **cannot** yet reflect the
  full committed intent of those KPIs (e.g., verifying against actual scenario-pass counts). See
  `kpi-instrumentation.md` for exactly which KPIs are fully measurable today vs. blocked.
- This is not a DEVOPS-wave defect to silently work around by inventing a `changedFilePaths`
  substitute (e.g., inferring it from `git diff`) — doing so would presume unconfirmed specifics
  of nWave's own git workflow, the same risk `progress-trust-ux`'s ADR-0007 already rejected for
  the same reason. Instrumentation waits for the real contract, honestly, rather than fabricating
  data to make a dashboard look complete.

## Dashboard (query-based, not a live dashboard tool)

No dashboarding tool exists in this repo today. Recommend a lightweight, versioned SQL script
(`docs/feature/nwave-ticket-execution-engine/devops/queries/`, to be authored by whoever owns the
weekly KPI review — see `kpi-instrumentation.md` "Owner" column) run against `.orgops-data/
orgops.sqlite` directly, rather than building a UI dashboard with no NFR requiring one. If this
feature's usage grows past the "5 concurrent runs" NFR, revisit — not before.
