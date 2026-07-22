# Monitoring & Alerting — nWave Ticket Execution Engine

## Honest Scope Statement (read first)

**No paging/alerting infrastructure exists anywhere in OrgOps today** (confirmed absent, same
category of finding as `progress-trust-ux`'s ADR-0005 for notification infrastructure and
`multi-source-ingestion-governance`'s ADR-0008 for webhook infrastructure). Per this agent's own
Decision 7 precondition ("continuous learning not included — no existing monitoring/alerting
infrastructure exists to build on"), this document does **not** invent a paging system. It
designs the three cross-release guardrail metrics from `outcome-kpis.md` as **scheduled query +
channel-message** checks — reusing the existing event bus/channel-post mechanism every track
already uses for human-facing messages — not simulated "alerts" that look like they page someone
when nothing actually pages anyone.

## Guardrail Metric 1: Classification Accuracy Floor (must not drop below 90%)

**Cannot be fully automated.** Accuracy requires a human-reviewed sample compared against the
classifier's output (per `ticket-classification`'s own DESIGN-wave observability subsection) —
there is no ground truth in the database to query against automatically; a human must judge
whether `DEVELOPMENT_WORK`/`NOT_DEVELOPMENT_WORK`/`LOW_CONFIDENCE` was the *correct* call.

- **Mechanism**: weekly manual review batch (matches `outcome-kpis.md`'s own "Weekly during
  Release 0" cadence), querying `GET /api/tickets/:id/classification-history` across a
  random/stratified sample of the week's tickets (query substrate already exists per ADR-0003 —
  no new instrumentation).
- **Tier**: Warning-equivalent (per `nw-production-readiness`'s tiering, adapted to "no paging
  infra" reality) — a documented runbook step for whoever owns weekly KPI review (see
  `kpi-instrumentation.md` Owner column), not an automated page. If the sample shows accuracy
  below 90%, the reviewer posts a summary to a designated ops/governance channel (reusing the
  existing channel-message mechanism, not new notification infrastructure) and opens a ticket
  (dogfooding this feature's own ticket flow) to investigate the classifier prompt/threshold.
- **What can be automated**: the *decision distribution* (count of DEVELOPMENT_WORK /
  NOT_DEVELOPMENT_WORK / LOW_CONFIDENCE per week) and *error rate*
  (`CLASSIFICATION_FAILED` count) are both queryable now (see `observability-design.md`) and can
  flag a volume/error-rate anomaly automatically even without resolving the accuracy question
  itself — see "Automatable Anomaly Checks" below.

## Guardrail Metric 2: Zero Corrupted-Artifact Incidents from Halt/Pause

**Structurally near-impossible by construction, per ADR-0006** — the Pause/Halt Controller never
sends a stop signal to a running wave process; it only declines to spawn the next one. There is,
by design, no code path in `progress-trust-ux/**` that can interrupt an in-progress file write.
This guardrail is therefore primarily a **design invariant to verify stayed true**, not a runtime
metric to compute:

- **Mechanism**: the dependency-cruiser rule already recommended in ADR-0006's own Enforcement
  section (`progress-trust-ux/**` must not import `node:child_process` or the `shell_stop` tool
  definition) is the CI-time verification that this guarantee holds structurally — see
  `ci-cd-pipeline.md`'s dependency-cruiser job. This is a **CI gate**, not a production alert: the
  guardrail is enforced before code ships, which is a stronger guarantee than detecting a
  corruption incident after the fact.
- **Runtime signal (secondary, defense-in-depth)**: if a corrupted-artifact incident is ever
  reported by a submitter (a support/bug report, since no automated corruption-detector exists),
  it should be logged against the specific `run_id`/`wave_id` and treated as a Page-tier incident
  (per `nw-production-readiness` tiering) requiring immediate investigation — the zero-tolerance
  NFR means any confirmed occurrence is a stop-the-line event, not a metric to trend.

## Guardrail Metric 3: Zero Unauthorized Guardrail-Allowlist Violations Reaching Approval

**Enforced server-side by construction (ADR-0010)**: "Approve" is only ever available when
`approval_status = PENDING`, never `GOVERNANCE_HOLD` — checked in the Governance Approval
Handler before every write, not merely hidden in the UI. Monitoring this guardrail means
verifying the invariant held, not detecting violations after the fact where none should be
structurally possible:

- **Automatable integrity check** (weekly, or on every deploy as a smoke-test-adjacent script):
  query `guardrail_decision_audit` for any run where an `APPROVED` row exists but the
  corresponding `nwave_run_completions.governance_signoff_at` is `NULL` **while**
  `governance_hold_reason` was ever set for that run without a subsequent `GOVERNANCE_SIGNOFF`
  row — i.e., an approval that occurred while a hold was never cleared. This should return zero
  rows, always; a non-zero result is a correctness defect in the Governance Approval Handler,
  not a policy violation, and should be treated as a Page-tier incident (a governance gate that
  can be bypassed defeats the entire reason `multi-source-ingestion-governance`'s US-12 exists).
- **Known Release 2 operational reality (already flagged in that track's `wave-decisions.md`)**:
  because `changedFilePaths` is unpopulated for every run until the DELIVER-wave contract closes,
  **100% of completed runs will show `GOVERNANCE_HOLD`** — this is the correct, intended
  fail-closed behavior, not a bug to alert on. The operational risk this creates is a governance
  sign-off *throughput* bottleneck (a single role must clear every hold), not a security
  violation — see "Guardrail Sign-off Throughput" below.

## Automatable Anomaly Checks (what genuinely can run without new infrastructure)

These are the checks this DEVOPS pass can specify concretely, reusing existing tables, runnable
as a scheduled script (e.g., a cron-equivalent invocation of a small Node script against
`.orgops-data/orgops.sqlite`, or folded into the existing `maintenance-loop.ts` cadence at a
coarser interval — implementation choice for `software-crafter`):

| Check | Query substrate | Tier | Action |
|---|---|---|---|
| Classification failure rate spike | `COUNT(*) WHERE ticket_classification_audit.event_type = 'CLASSIFICATION_FAILED'` over trailing 1h vs. trailing 7d baseline | Warning | Post to ops channel; investigate LLM provider health |
| Wave failure rate spike | `COUNT(*) WHERE nwave_run_waves.status = 'FAILED'` over trailing 1h vs. baseline | Warning | Post to ops channel; check nWave CLI contract smoke test status (may indicate the unvalidated invocation assumption broke) |
| Trello poll failure streak | `trello_ingestion_boards.last_poll_status = 'FAILED'` for N consecutive polls | Warning | Post to ops channel; check Trello API credentials/rate limits |
| Guardrail sign-off throughput | `COUNT(*) WHERE nwave_run_completions.approval_status = 'GOVERNANCE_HOLD'` with `posted_at` older than 3 business days and no `governance_signoff_at` | Warning (directly the US-12 outcome KPI's guardrail: "overdue-ticket count") | Post to designated governance-team channel — this is the concrete, queryable form of the KPI's own "overdue-ticket count" guardrail |
| Retry-exhaustion / escalation rate | `COUNT(*) WHERE tickets.resolution_status = 'ESCALATED'` over trailing 7d | Info | Weekly review; feeds retrospective |
| Stuck-run flags not auto-clearing | `nwave_run_stuck_flags` rows with `flagged_at` set and `cleared_at` still `NULL` after N hours | Urgent-equivalent | Post to ticket's own channel (reuses `progress-trust-ux`'s existing pattern) — a stuck flag that never clears likely means a genuinely dead run, not noise |

All "post to channel" actions reuse the existing event bus / channel-message mechanism — this is
the same "queryable state as the alerting substitute" pattern `ticket-classification`'s own
brief.md already named for its error-rate signal, applied consistently across all four tracks
rather than invented per-track.

## What Is Explicitly Not Built

- Real paging (PagerDuty/Opsgenie-equivalent) — no infra exists, no NFR justifies standing it up
  for a walking-skeleton-scale feature.
- A statistical anomaly-detection model for any of the above — every threshold above is a simple,
  explicit, documented comparison (matching this feature's own design-wave preference for honest
  static heuristics over fabricated statistical rigor, per ADR-0012's own rejected alternative
  #3).
- Automated accuracy measurement for classification — genuinely requires human judgment; not a
  gap this pass can close with more instrumentation.
