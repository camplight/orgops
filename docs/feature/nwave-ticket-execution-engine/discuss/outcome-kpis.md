# Outcome KPIs: nWave Ticket Execution Engine

Per `nw-outcome-kpi-framework`: 4+ stories exist in this feature, so KPIs are grouped by
release (epic-equivalent) with feature-level north-star/guardrail metrics, plus per-story KPIs
already embedded in `user-stories.md`.

## Feature: nWave Ticket Execution Engine

### Objective

By the end of Release 1, a ticket submitter at Fenwick Analytics can file a development
ticket and trust an autonomous implementation run enough to walk away from it — checking in
when they choose, not because they're afraid it's silently failed.

### Metric Hierarchy

- **North Star**: % of implementation runs where the submitter reports (survey or explicit
  approval action) that they felt informed and in control throughout, without needing to
  contact a human developer to find out what was happening.
- **Leading Indicators**: "is it stuck?" support questions per run; ratio of raw-output views
  to curated wave-status views (lower over time = curated signal is trusted); median time
  from mid-run message to acknowledgment; median time from pause/halt request to confirmed
  stop.
- **Guardrail Metrics**: classification accuracy (must not degrade as ticket volume grows);
  zero corrupted-artifact incidents from halt/pause; zero unauthorized guardrail-allowlist
  violations reaching submitter approval without governance sign-off.

## Release 0 (Walking Skeleton): "Prove the Loop Closes"

| # | Who | Does What | By How Much | Baseline | Measured By | Type |
|---|---|---|---|---|---|---|
| 1 | Ticket submitters (Maria, Devon, Carlos) | Successfully submit a ticket and land on its channel | 95% first-attempt success | 0% (capability absent) | Ticket creation success rate | Leading |
| 2 | Ticket submitters | Receive an accurate classification | >= 90% accuracy vs. human-reviewed sample of 50 tickets | 0% (capability absent) | Human-reviewed accuracy sample | Leading |
| 3 | Ticket submitters | Move from confirmed intent to a running implementation | Median < 2 minutes (target pending SPIKE) | N/A | Confirmation-to-run-start timestamp delta | Leading |
| 4 | Ticket submitters | Verify completed work without reading a raw diff unassisted | Median time-to-verify < 5 minutes | N/A | Completion-message-to-decision timestamp delta | Leading |

### Measurement Plan

| KPI | Data Source | Collection Method | Frequency | Owner |
|---|---|---|---|---|
| Ticket creation success rate | Ticket intake records + failed-submission logs | Automated event count | Continuous | Implementation Trigger capability owner (DESIGN) |
| Classification accuracy | Human-reviewed sample vs. classifier output | Manual review batch | Weekly during Release 0 | Ticket Classification capability owner |
| Confirmation-to-run-start latency | `run_id` creation event timestamp minus confirmation event timestamp | Automated event delta | Continuous | Implementation Trigger capability owner (post-SPIKE) |
| Time-to-verify | Completion message timestamp minus decision/close timestamp | Automated event delta (proxy manual timing pre-US-12) | Continuous | Completion & Review capability owner |

### Hypothesis

We believe that closing the ticket-to-implementation loop end-to-end, even at low fidelity,
for Fenwick Analytics ticket submitters will validate that autonomous implementation is
viable at all.
We will know this is true when at least 3 real tickets are submitted, classified correctly,
executed, and reach a completion summary within one week of Release 0 shipping.

## Release 1: "Build Trust" (targets `jtbd-opportunity-scores.md` #3, #4, #5)

| # | Who | Does What | By How Much | Baseline | Measured By | Type |
|---|---|---|---|---|---|---|
| 5 | Submitters with an active run | Check progress and receive real, current signal | 0% report inability to tell stuck-vs-progressing (survey, n>=5) | 100% uncertainty | Post-run survey + "is it stuck?" support request count | Leading |
| 6 | Submitters with an active run | Understand run stage without reading raw logs | >= 80% report curated view alone is sufficient | 0% (raw output only) | Post-run survey; raw-output-click ratio | Leading |
| 7 | Submitters posting a mid-run message | Receive a timely, concrete acknowledgment | 100% acknowledged within 60 seconds | N/A | Message-to-acknowledgment timestamp delta | Leading |
| 8 | Submitters who intervene | Successfully stop/pause without losing prior progress | 100% honored within one safe-checkpoint interval; zero corrupted-state incidents | N/A | Request-to-stop timestamp delta; corrupted-state incident count | Leading (guardrail: corrupted-state count) |

### Measurement Plan

| KPI | Data Source | Collection Method | Frequency | Owner |
|---|---|---|---|---|
| Stuck-vs-progressing clarity | Post-run survey; support ticket tags | Survey + manual tag review | Per-run survey, weekly aggregate | Progress Monitoring capability owner |
| Curated-view sufficiency | Post-run survey; UI click analytics | Survey + automated click tracking | Weekly aggregate | Progress Monitoring capability owner |
| Mid-run acknowledgment latency | Message event timestamp minus acknowledgment event timestamp | Automated event delta | Continuous | Intervention capability owner |
| Halt/pause honor latency + corruption count | Halt/pause request event minus confirmed-stop event; artifact integrity check | Automated event delta + automated integrity check | Continuous | Intervention capability owner |

### Hypothesis

We believe that giving submitters curated progress visibility and real intervention controls
will remove the dominant anxiety force identified in `jtbd-four-forces.md`.
We will know this is true when post-run survey respondents report feeling informed and in
control in >= 80% of runs, and "is it stuck?" support questions drop to near zero.

## Release 2: "Scale & Harden" (targets `jtbd-opportunity-scores.md` #1, #2, #6, #7)

| # | Who | Does What | By How Much | Baseline | Measured By | Type |
|---|---|---|---|---|---|---|
| 9 | Submitters already using Trello | Get tickets implemented without leaving their existing tool | >= 50% of implemented tickets originate from Trello ingestion within the first month | 0% (capability absent) | Ticket source field on ticket records | Leading |
| 10 | Submitters and governance reviewers | Reach a clear resolved/needs-changes decision without ambiguity | 100% of completed runs decided within 3 business days | N/A | Completion-to-decision timestamp delta; overdue-ticket count | Leading (guardrail: overdue count) |
| 11 | Submitters whose runs fail/stall | Receive proactive, actionable notice instead of discovering the problem themselves | 0% undetected beyond 10 minutes past system-detectable point | N/A | Failure/staleness-detection-to-notification timestamp delta | Leading (guardrail) |

### Measurement Plan

| KPI | Data Source | Collection Method | Frequency | Owner |
|---|---|---|---|---|
| Trello-sourced ticket share | Ticket source field | Automated aggregation | Weekly | Multi-Source Ingestion capability owner |
| Decision latency | Completion event minus approve/request-changes event | Automated event delta | Continuous | Completion & Review capability owner |
| Failure/staleness detection latency | Failure/staleness detection event minus notification event | Automated event delta | Continuous | Recovery capability owner |

### Hypothesis

We believe that broadening ticket sources and adding governance-aware review will let this
capability scale beyond the walking skeleton's trust-building cohort to the whole
organization, including Priya Nair's governance requirements.
We will know this is true when >= 50% of tickets originate from Trello and zero
guardrail-allowlist violations reach submitter approval without sign-off.

## Cross-Release Guardrails (must not degrade across any release)

- Classification accuracy must not drop below 90% as ticket volume/variety grows.
- Zero corrupted-artifact incidents from halt/pause, ever.
- Zero unauthorized guardrail-allowlist violations reaching submitter approval without
  governance sign-off, ever (from Release 2 onward).

## Validation Caveat (see also `jtbd-opportunity-scores.md` and `wave-decisions.md`)

Baselines and targets above are analyst-estimated for a greenfield capability with no
existing usage data. Release 0 shipping is itself the mechanism for establishing real
baselines; targets should be revisited once real usage data exists rather than treated as
committed OKRs.
