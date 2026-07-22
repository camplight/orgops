# Prioritization: nWave Ticket Execution Engine

## Release Priority

| Priority | Release | Target Outcome | KPI | Rationale |
|---|---|---|---|---|
| 1 | Walking Skeleton (Release 0) | End-to-end ticket-to-implementation loop closes at least once, at low fidelity | Loop-closure rate (see `outcome-kpis.md`) | Validates the riskiest assumption — including whether the invocation mechanism is viable at all (pending SPIKE) — before investing in polish |
| 2 | Release 1 — Build Trust | Submitters can see real progress and intervene mid-run | Reduction in "is it stuck?" questions; % of submitters confirming they'd trust an unattended run | Targets opportunity scores #3 (17), #4 (17), #5 (15) — the three highest-ranked underserved outcomes in `jtbd-opportunity-scores.md`; anxiety is the dominant force per `jtbd-four-forces.md` |
| 3 | Release 2 — Scale & Harden | More ticket sources, governed auto-trigger, recovery from failure | % tickets closed without human developer involvement; reduction in time-to-implementation-start | Targets opportunity scores #1 (11), #2/#7 (14), #6 (12) — lower-ranked than trust, appropriately sequenced after it |

## Backlog Suggestions

| Story | Release | Priority | Outcome Link | Dependencies |
|---|---|---|---|---|
| US-01 Submit ticket via OrgOps-native form | Release 0 | P1 | Loop-closure rate | None |
| US-02 Classify ticket as dev work or not | Release 0 | P1 | Loop-closure rate; opportunity #2 | US-01 |
| US-03 Submitter sees classification result and rationale | Release 0 | P1 | Opportunity #2 | US-02 |
| US-04 nWave run triggered for classified ticket | Release 0 | P1 (conditionally blocked) | Loop-closure rate | US-03; **SPIKE outcome** (see `wave-decisions.md`) |
| US-05 Live "it's working" signal during run | Release 0 | P1 | Opportunity #3 | US-04 |
| US-06 Completion summary with links | Release 0 | P1 | Loop-closure rate; opportunity #6 | US-04 |
| US-07 Wave-by-wave progress (curated, not raw) | Release 1 | P2 | Opportunity #3, #4 | US-05 |
| US-08 Ask a clarifying question mid-run | Release 1 | P2 | Opportunity #5 | US-04 |
| US-09 Pause or halt a running implementation | Release 1 | P2 | Opportunity #5 | US-04 |
| US-10 Notified when implementation needs input | Release 1 | P2 | Opportunity #5, #4 | US-07 |
| US-11 Trello-sourced ticket triggers same flow | Release 2 | P3 | Opportunity #1 | US-01; existing `trello-cli` skill |
| US-12 Approve or request changes to completed work | Release 2 | P3 | Opportunity #6, #7 | US-06 |
| US-13 Failed/stuck runs surfaced with recovery options | Release 2 | P3 | Opportunity #4, #6 | US-05, US-07 |

> **Note**: Story IDs above were assigned during Phase 6 (Requirements/User Story Crafting)
> and are reflected consistently in `story-map.md`, `user-stories.md`, and this table (unlike
> the generic template's Phase-2.5 placeholder convention, Phase 6 for this feature reused
> the same IDs established during story mapping since the mapping session already produced
> stable, uniquely named tasks).

## Value / Effort Positioning (Directional, Pending DESIGN Estimates)

| | Low Effort | High Effort |
|---|---|---|
| **High Value** | US-06 (completion summary — mostly existing event/message primitives), US-11 (Trello — `trello-cli` already exists) | US-04 (invocation — blocked on SPIKE), US-07 (curated wave-status — new domain concept), US-09 (pause/halt — needs mid-run control semantics not yet in agent-runner) |
| **Low Value** | — | US-13 low-frequency edge case, but high anxiety-relief value once needed; kept in Release 2 rather than eliminated |

US-06 and US-11 are the clearest "quick wins" once their dependencies land, reusing existing
OrgOps primitives (`processes`/events for US-06's completion path structurally, `trello-cli`
for US-11) rather than requiring new domain modeling.
