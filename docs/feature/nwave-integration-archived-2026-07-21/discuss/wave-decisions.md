# DISCUSS Decisions — nwave-integration

## Key Decisions

- [D1] Feature type: Cross-cutting — confirmed by user prior to this DISCUSS session. This feature spans documentation/process tooling rather than a single layer of the running system, and produces no runtime code changes (see: `user-stories.md` System Constraints).
- [D2] Walking skeleton: No — confirmed by user. This is not a runtime feature slice; there is no "thinnest deployable behavior" in the DELIVER-wave sense. Story mapping still traces one task per activity for ordering/coverage purposes only (see: `story-map.md` Walking Skeleton section, which explicitly notes this caveat).
- [D3] JTBD analysis: Skipped — confirmed by user. The user explicitly agreed this isn't a case of competing end-user motivations; the "job" is internal (enable future OrgOps development work to flow through nWave), not something JTBD's four-forces/emotional-arc machinery is built to untangle. Every story in `user-stories.md` states `Job Traceability: JTBD skipped` per the JTBD-BDD integration rule for Decision 4 = No.
- [D4] **Future OrgOps features skip DISCOVER by default**: product-market fit is already established (working, in-production brownfield system with 5 documented use cases in `docs/use-cases.md`). Features start at DISCUSS (if requirements need discovery/journey work) or directly at DESIGN (if requirements are already clear). Exception: a feature targeting a genuinely new user segment or unvalidated problem space (not served by any of the 5 existing use cases) still requires DISCOVER. See `user-stories.md` US-03 for the full rule, worked examples, and rationale.
- [D5] UX research depth: Lightweight — confirmed by user. The journey artifacts (`journey-nwave-integration-visual.md`, `.yaml`, `.feature`) map a maintainer/process journey rather than a classic end-user emotional journey. This is noted explicitly in the journey's Framing Note rather than padded with invented end-user delight/frustration that doesn't apply to a documentation-adoption task.
- [D6] SSOT bootstrap scope: `docs/product/` did not exist prior to this feature and `docs/feature/` had no prior features — confirmed greenfield bootstrap, not a migration scenario. This feature creates `docs/product/journeys/nwave-integration.yaml` and `docs/product/journeys/nwave-integration-visual.md` as the first SSOT journey artifacts. `docs/product/architecture/brief.md` and `adr-*.md` are NOT created by this DISCUSS wave — per methodology, architecture documents are authored by solution-architect during the DESIGN wave that follows. This feature's deliverables define *what* that DESIGN wave must produce (US-01, US-02) and *validate that it worked* (US-04).
- [D7] `docs/product/jobs.yaml` is NOT created by this feature, by design. Since JTBD was explicitly skipped (D3), there is no validated job to record in the jobs SSOT. A future feature that runs full JTBD analysis will initialize `jobs.yaml` at that time. This is an intentional gap, not an oversight — noted here so a future DISCUSS/DIVERGE run doesn't mistake an absent `jobs.yaml` for a missed bootstrap step from this feature.

## Requirements Summary

- Primary jobs/user needs: Enable OrgOps's next real feature (and all subsequent features) to run through nWave's DESIGN/DISTILL/DELIVER waves grounded in the system's actual, already-shipped architecture — rather than re-deriving that architecture from `docs/SPEC.md` prose and source-code archaeology on every DESIGN wave invocation.
- Walking skeleton scope: N/A (see D2)
- Feature type: Cross-cutting (see D1)

## Constraints Established

- No runtime code changes — every deliverable in this feature is a documentation artifact (`docs/product/` SSOT content, ADRs, routing rules)
- Single-source-of-truth discipline: `docs/product/architecture/brief.md` and `adr-*.md` must summarize and link to `docs/SPEC.md`, never duplicate it verbatim (no block >3 lines copied) — enforced as a guardrail metric in `outcome-kpis.md` and as explicit acceptance criteria in US-01/US-02
- All 5 stories are sized 1-2 days, 4-5 UAT scenarios each, single bounded context (OrgOps's documentation/process meta-layer) — see `story-map.md` Scope Assessment: PASS

## Upstream Changes

None. No DISCOVER or DIVERGE artifacts exist for this feature-id (confirmed absent at session start, by design — this is the first feature under `docs/feature/`), so there are no prior assumptions from those waves to reconcile or back-propagate against.

## Risk Note

Per the discovery-methodology gate, the absence of DISCOVER/DIVERGE artifacts would normally be flagged as a risk requiring resolution before proceeding. Here it is not a gap but an explicit, user-confirmed decision: OrgOps's product-market fit is already established by its status as a working, in-production system with 5 documented, real use cases — re-running DISCOVER to re-prove that would be wasted effort, not rigor. This reasoning is itself formalized as the D4 routing rule so future features don't need to re-derive it.
