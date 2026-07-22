# Prioritization: nwave-integration

## Release Priority

| Priority | Release | Target Outcome | KPI | Rationale |
|---|---|---|---|---|
| 1 | Release 1: SSOT Structurally Exists and Is Trustworthy | `brief.md` and ADR set are complete and non-duplicative | KPI-1 (gate pass rate), KPI-2 (ADR coverage) | Nothing downstream (dry run, diagrams) is meaningful until the core content exists |
| 2 | Release 2: SSOT Is Battle-Tested for Real Use | Next real feature's DESIGN wave proves the SSOT usable | KPI-1 (confirmed via real usage), KPI-3 (routing-rule citation rate) | Validates the investment from Release 1 actually pays off, not just exists |

## Backlog Suggestions

| Story | Release | Priority | Outcome Link | Dependencies |
|---|---|---|---|---|
| US-01: Formalize Shipped Architecture into the SSOT Brief | Release 1 | P1 | KPI-1 | None |
| US-02: Capture Undocumented Architectural Decisions as ADRs | Release 1 | P2 | KPI-2 | Benefits from US-01's triage pass |
| US-05: Preserve Use-Case Narratives as SSOT-Referenced Capability Documentation | Release 1 | P3 | KPI-2 (completeness) | US-01 (brief.md must exist) |
| US-03: Define Wave-Routing Rules for Future OrgOps Features | Release 1 | P4 | KPI-3 | None (parallelizable) |
| US-04: Validate SSOT Readiness with a Real Next-Feature Dry Run | Release 2 | P5 | KPI-1, KPI-3 | US-01, US-02, US-03 |

> **Note**: Story IDs above match `user-stories.md`. All 5 stories were sized directly in Phase 4 (Requirements) since this feature's story count (5) is small enough that story-map-level task placeholders and final story IDs converge without needing revision.
