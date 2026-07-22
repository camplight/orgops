# KPI Instrumentation — nWave Ticket Execution Engine

Source: `docs/feature/nwave-ticket-execution-engine/discuss/outcome-kpis.md`. Every KPI listed
there is mapped below to a concrete data source/query against the tables this feature's four
DESIGN passes already created — per this feature's own design-wave convention (established by
`ticket-classification` and extended by every sibling track), instrumentation reuses existing
persistence; it does not invent a parallel metrics mechanism. Where a KPI cannot yet be fully
measured, that is stated plainly rather than papered over — consistent with `progress-trust-ux`'s
ADR-0007 and this feature's own honesty standard for unclosed gaps.

## Release 0 (Walking Skeleton)

| # | KPI | Query / Data Source | Status |
|---|---|---|---|
| 1 | Ticket creation success rate (95% first-attempt) | `COUNT(tickets.id)` per submission window as the success numerator. **Denominator gap**: failed `POST /api/tickets` attempts (validation errors, unexpected 5xx) are not persisted anywhere today — only successful rows exist in `tickets`. Recommend a structured log line (`{ module: "tickets-intake", event: "creation_failed", reason }`, per `observability-design.md`) as the failure-count source, since a failed attempt-by-definition never produces a row to query. | **Partially automatable now** (numerator only); denominator requires the log-line addition above — a small, concrete DELIVER-wave action item, not a redesign. |
| 2 | Classification accuracy (>=90% vs. human-reviewed sample of 50) | `GET /api/tickets/:id/classification-history` across a stratified sample; compare `classification_result`/`classification_rationale` against human judgment | **Not automatable** — inherently requires human review (see `monitoring-alerting.md` Guardrail Metric 1). Query substrate exists now; the judgment step does not. |
| 3 | Confirmation-to-run-start latency (median < 2 min) | `nwave_runs.started_at - nwave_runs.confirmed_at`. Note: per `nwave-invocation-engine`'s Wave Runner design, `createRun` (which assigns `run_id`) happens **at the moment of confirmation**, so `confirmed_at` is effectively the "run_id creation" timestamp the KPI description refers to — no separate "creation event" exists or is needed. | **Fully automatable now** — both columns exist in the `nwave_runs` schema as designed; no dependency on the DELIVER-wave contract gap. |
| 4 | Time-to-verify (median < 5 min) | `nwave_run_completions.posted_at` to a decision timestamp | **Proxy only, honestly**, exactly as `outcome-kpis.md` itself states ("proxy manual timing pre-US-12"): no formal Approve/Request-Changes decision action exists until US-12 ships (Release 2). Until then, "time-to-verify" can only be approximated by manual observation of when a submitter's next channel message follows a completion post — not a queryable column. Automated measurement becomes possible the moment `nwave_run_completions.approval_decided_at` (a US-12/Release-2 column) exists. |

## Release 1 ("Build Trust")

| # | KPI | Query / Data Source | Status |
|---|---|---|---|
| 5 | Stuck-vs-progressing clarity (0% report inability to tell, survey n>=5) | Post-run survey (external to this codebase) + `nwave_run_stuck_flags` count as a proxy signal for how often the system itself judged a run "possibly stuck" | **Survey is inherently manual.** The stuck-flag count is a fully automatable secondary signal (see `monitoring-alerting.md`), not a substitute for the survey itself. |
| 6 | Curated-view sufficiency (>=80% report sufficient, survey + click ratio) | Post-run survey (manual) + raw-output-click vs. wave-status-view click ratio | **Click analytics do not exist today.** No UI click-tracking mechanism is built. Recommend a minimal, additive instrumentation: emit a lightweight `progress-trust-ux.raw_output.viewed` / `progress-trust-ux.wave_status.viewed` event (reusing the existing event bus, no new tracking infra) whenever `RawOutputViewer`/`WaveStatusPanel` is opened, then compute the ratio via `COUNT` per event type. This is a concrete, small DELIVER-wave addition flagged here, not silently assumed to already exist. |
| 7 | Mid-run acknowledgment latency (100% within 60s) | `mid_run_message_acks.acknowledged_at - events.created_at` (joined on `mid_run_message_acks.message_event_id = events.id`) | **Fully automatable now** — both sides of the delta exist in the schema as designed. |
| 8 | Halt/pause honor latency (100% within one safe checkpoint) + corrupted-state incident count | Latency: `nwave_run_waves.ended_at` (the wave active at request time) minus `nwave_run_controls.requested_at`. Corruption count: no automated detector exists (see `monitoring-alerting.md` Guardrail Metric 2 — structurally near-impossible by construction, verified by CI dependency-cruiser rule, not a runtime metric). | **Latency: fully automatable now.** **Corruption count: verified structurally at CI time, not measured at runtime** — a confirmed incident (if one ever occurred despite the design guarantee) would be a manually-reported, Page-tier event, not a query result. |

## Release 2 ("Scale & Harden")

| # | KPI | Query / Data Source | Status |
|---|---|---|---|
| 9 | Trello-sourced ticket share (>=50% within first month) | `COUNT(tickets.id) WHERE source = 'TRELLO'` / `COUNT(tickets.id)` total, over a rolling window | **Fully automatable now** — `tickets.source` is part of the schema as designed (this track's own table, ADR-0009). |
| 10 | Decision latency (100% within 3 business days) + overdue-ticket count | `nwave_run_completions.approval_decided_at - nwave_run_completions.posted_at`; overdue count is the same query used for the "Guardrail sign-off throughput" check in `monitoring-alerting.md` | **Automatable once Release 2's `approval_status`/`approval_decided_at` columns exist and are populated.** Until then, not measurable (the columns do not exist pre-Release-2). **Known confound, already flagged by that track's own `wave-decisions.md`**: because `changedFilePaths` is unpopulated until the DELIVER-wave contract closes, every run requires governance sign-off (ADR-0010's fail-closed default), so this KPI will reflect governance-sign-off throughput, not submitter responsiveness, until that gap closes — report it as such, do not present it as a clean submitter-behavior metric. |
| 11 | Failure/staleness detection latency (0% undetected beyond 10 min past system-detectable point) | `nwave_run_stuck_flags.flagged_at - (last_output_at + staleThresholdMs)` as the detection-lag proxy; for hard failures, `nwave_run_waves.ended_at` (FAILED) to the corresponding channel message's `events.created_at` (these occur in the same handler invocation, so latency should be ~0 for hard failures, and bounded by the poll interval for staleness) | **Fully automatable now** — all inputs are schema columns as designed. |

## Cross-Release Guardrails

See `monitoring-alerting.md` for full detail (these are the same three guardrail metrics, detailed
there with tiers and actions, not duplicated in full here):

- Classification accuracy floor (>=90%) — not automatable, human-reviewed.
- Zero corrupted-artifact incidents — enforced structurally at CI time (ADR-0006), not measured
  at runtime.
- Zero unauthorized guardrail-allowlist violations reaching approval — automatable integrity
  check against `guardrail_decision_audit`/`nwave_run_completions`.

## Summary: What This DEVOPS Pass Can and Cannot Close

**Fully automatable today, no gaps**: KPIs #3, #7, #9, #11, and the latency half of #8.

**Automatable with a small, named DELIVER-wave addition** (not a redesign): KPI #1's failure
denominator (structured log line), KPI #6's click-ratio (lightweight view-event emission).

**Blocked on a later release's own schema landing** (not a DEVOPS-wave gap — those columns are
scoped to Release 2's own DESIGN, already reflected in `multi-source-ingestion-governance`'s
brief.md): KPI #4 (proxy only, pre-US-12), KPI #10 (needs `approval_status`/`approval_decided_at`
to exist and be populated).

**Genuinely not automatable, requires human judgment or external survey tooling**: KPI #2, #5,
#6's survey half, #8's corruption-count half.

**Owners**: per `outcome-kpis.md`'s own "Owner" column (capability owners per story) — this
document specifies *how* to measure; it does not reassign *who* measures, consistent with this
agent's remit (platform/infrastructure, not product ownership).
