# JTBD Opportunity Scores: nWave Ticket Execution Engine

Outcome-Driven Innovation (ODI) style scoring: `Opportunity = Importance + max(Importance -
Satisfaction, 0)`. Both Importance and Satisfaction are rated 1-10.

## IMPORTANT — Data Provenance Disclaimer

No DISCOVER-wave customer interviews exist for this feature (confirmed absent). The
Importance/Satisfaction ratings below are **analyst-estimated priors** derived from the job
stories and forces analysis, not measured survey data. They exist to give the team a
directional priority order for DISCUSS-wave sequencing (walking skeleton vs. later releases),
**not** a validated business case. Treat scores as hypotheses. Recommended validation:
interview 5-8 real ticket submitters (product managers, support engineers) after the walking
skeleton ships, using these outcome statements as the survey instrument. This gap is also
flagged in `wave-decisions.md`.

## Outcome Statements and Scores

| # | Outcome Statement (job-map-derived) | Importance | Satisfaction (current state) | Opportunity | Rank |
|---|---|---|---|---|---|
| 1 | Minimize the time between filing a ticket and implementation starting | 7 | 3 | 11 | 6 |
| 2 | Minimize the likelihood that ambiguous/non-dev tickets get misrouted into automated implementation | 8 | 2 | 14 | 4 (tie) |
| 3 | Maximize the submitter's ability to tell, at a glance, whether a run is progressing or stuck | 9 | 1 | 17 | 1 (tie) |
| 4 | Minimize the time to detect that an autonomous run is heading in the wrong direction | 9 | 1 | 17 | 1 (tie) |
| 5 | Maximize the submitter's ability to intervene (pause/redirect) before wasted effort accumulates | 8 | 1 | 15 | 3 |
| 6 | Minimize the effort required to review and verify completed autonomous work | 7 | 2 | 12 | 5 |
| 7 | Maximize confidence that engineering guardrails/governance are respected | 8 | 2 | 14 | 4 (tie) |
| 8 | Minimize the number of tickets that still require a human developer's direct involvement end-to-end | 6 | 4 | 8 | 7 |

Current-state Satisfaction is uniformly low (1-4) because none of this capability exists in
OrgOps today — there is no ticket classification, no nWave invocation path, and no
ticket-scoped progress/feedback channel. This is expected for a greenfield capability and is
itself evidence that the underserved-opportunity framing is directionally sound even without
survey data; it does not substitute for validating the *relative* priority across outcomes.

## Underserved Opportunities (Opportunity Score >= 15 — Overserved/Underserved Quadrant: Underserved)

1. **#3 — Glanceable progress visibility** (17) and **#4 — Fast detection of wrong-direction
   runs** (17): tied for highest opportunity. Both are anxiety-driven (see
   `jtbd-four-forces.md`) and both concern the "Monitor" and "Modify" job-map steps.
2. **#5 — Ability to intervene** (15): directly follows from #3/#4 — visibility without the
   ability to act on what you see is not enough to build trust.
3. **#2 — Correct classification** (14) and **#7 — Governance confidence** (14) (tie): both
   concern trust in the *front door* of the system — if submitters or engineering leads don't
   trust classification/guardrails, nothing downstream matters.

## Implication for Sequencing

The top opportunities cluster around **visibility and control during execution**, not around
breadth of ticket sources or speed of kickoff. This directly informs `story-map.md`'s Priority
Rationale: the walking skeleton (Release 0) proves the ticket-to-implementation loop closes
end-to-end with *minimal* visibility, and Release 1 ("Build Trust") is prioritized ahead of
Release 2 ("Scale & Harden") specifically because it targets outcomes #3, #4, and #5 — the
three highest-scored opportunities — while Release 2 targets the lower-ranked #1 and the
governance/breadth outcomes #7/#2 refinement plus multi-source ingestion.
