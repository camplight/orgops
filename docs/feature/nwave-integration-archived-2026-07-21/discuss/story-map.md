# Story Map: nwave-integration

## User: Priya Raman (OrgOps engineering lead) / solution-architect agent (secondary, consumer of the SSOT)
## Goal: Formalize OrgOps's already-shipped architecture into nWave's SSOT doc model (`docs/product/`) so future feature work can flow through the wave pipeline instead of re-deriving context from `docs/SPEC.md`/source code every time.

## Backbone

| Recognize SSOT Gap | Inventory Existing Knowledge | Formalize Architecture Brief | Capture Decisions as ADRs | Preserve Use-Case Narrative | Define Routing Rules | Validate Readiness |
|---|---|---|---|---|---|---|
| Run `/nw-design` and observe migration/bootstrap gate | Read `docs/SPEC.md` + `docs/use-cases.md` end-to-end | Write `## System Context` + `## Component Architecture` | Write ADR for WRAPPED agent mode delegation | Trace each of the 5 use cases to a brief.md capability statement | Record DISCOVER-skip rule in `wave-decisions.md` | Run `/nw-design` against next real feature-id (dry run) |
| Confirm `docs/feature/` has no prior features (greenfield, not migration) | Cross-check WRAPPED mode against `apps/agent-runner/src/wrapped-runtime.ts` | Write `## Core Data Model` summary, link to SPEC.md for exhaustive detail | Write ADR for at-least-once event delivery + idempotency model | Note any use case that has no current brief.md equivalent (gap) | Document criteria for when a future feature DOES need full DISCOVER | Confirm reading-enforcement gate shows zero missing-file markers |
| | Triage each SPEC.md section into brief.md / ADR / link-only | Write `## Agent Execution Modes` (CLASSIC / RLM_REPL / WRAPPED) | Write ADR for SQLite + Drizzle as embedded datastore choice | | | Confirm routing rule is cited in the dry-run feature's own `wave-decisions.md` |
| | | Add C4 context diagram (Mermaid) | Write ADR for in-process event bus (vs. external message queue) | | | |

---

### Walking Skeleton

Thinnest end-to-end slice — one task per activity, proving the SSOT bootstrap works at all before going deeper:

1. Run `/nw-design` and observe the migration/bootstrap gate (Recognize SSOT Gap)
2. Read `docs/SPEC.md` + `docs/use-cases.md` end-to-end (Inventory Existing Knowledge)
3. Write `## System Context` + `## Component Architecture` sections of `brief.md` (Formalize Architecture Brief)
4. Write the WRAPPED-agent-mode ADR (Capture Decisions as ADRs)
5. Trace the "collaboration-system augmentation" use case to a brief.md capability statement (Preserve Use-Case Narrative)
6. Record the DISCOVER-skip rule in `wave-decisions.md` (Define Routing Rules)
7. Run `/nw-design` against the next real feature-id and confirm zero missing-file markers (Validate Readiness)

**Note on walking skeleton applicability**: per the confirmed decision for this feature, `walking_skeleton: no` — this is not a runtime feature slice, so there is no "thinnest deployable behavior" in the traditional DELIVER-wave sense. The skeleton above is retained here only as the story-mapping technique's minimum cross-activity trace, used to validate ordering and coverage, not as a DELIVER-wave milestone.

### Release 1: SSOT Structurally Exists and Is Trustworthy

Tasks: SPEC.md/use-cases.md triage (full), remaining `brief.md` sections (Core Data Model, Agent Execution Modes), remaining ADRs (event delivery, SQLite/Drizzle), full use-case traceability, DISCOVER-skip-criteria documentation.

Outcome targeted: solution-architect on the next feature's DESIGN wave can read a complete, non-duplicative `brief.md` and a complete ADR set without hitting an undocumented decision.

KPI: KPI-1 (reading-enforcement gate pass rate) and KPI-2 (ADR coverage of decision-shaped statements) — see `outcome-kpis.md`.

Rationale: this is the bulk of the actual formalization work — necessary before any dry run can meaningfully validate readiness (Release 2 depends on Release 1 being complete).

### Release 2: SSOT Is Battle-Tested for Real Use

Tasks: C4 context diagram (Mermaid), in-process-event-bus ADR, full dry-run validation against the next real feature-id, confirmation that the routing rule is actually cited (not just written).

Outcome targeted: the SSOT isn't just present — it is proven usable by a real subsequent feature, and richer diagrams exist for architects who need visual context beyond prose.

KPI: KPI-1 (gate pass rate, confirmed via real usage not just presence) and KPI-3 (routing-rule citation rate) — see `outcome-kpis.md`.

Rationale: dry-run validation only produces a meaningful signal once Release 1's content exists to validate; diagrams are additive polish, not blocking for a first usable SSOT.

## Scope Assessment: PASS — 5 stories, 1 bounded context, estimated 7 days

- **Story count**: 5 (US-01 through US-05) — well under the >10 oversized threshold.
- **Bounded contexts**: 1 — all stories serve OrgOps's own documentation/process meta-layer (the SSOT itself); none touch a second product domain.
- **Walking skeleton integration points**: N/A — `walking_skeleton: no` per confirmed decision; no runtime integration points to count.
- **Estimated effort**: 5 stories x 1-2 days each ≈ 7 days total — under the 2-week oversized threshold.
- **Independent outcomes signal**: each story IS independently demonstrable (elephant carpaccio by design), but all 5 serve one coherent outcome — "solution-architect can ground DESIGN decisions in documented architecture instead of code archaeology" — not disparate features that should live in separate feature-ids. This is the intended shape of thin end-to-end slices, not an oversized signal.
- **Verdict**: 0-1 signals present (out of the 5 oversized indicators) → right-sized. No split required.

## Priority Rationale

Priority order follows the Value x Urgency / Effort formula with Walking Skeleton > Riskiest Assumption > Highest Value tie-breaking, per the user-story-mapping methodology:

1. **US-01 (Formalize Architecture Brief) first** — every other story either depends on `brief.md` existing (US-04's dry run needs something to validate) or is naturally sequenced alongside it (US-05's use-case traceability targets `brief.md`'s System Context section). Highest value (5/5): without this, DESIGN wave has nothing to read at all.
2. **US-02 (Capture ADRs) second** — riskiest assumption: undocumented decisions (like WRAPPED mode's rationale) are the highest-risk gap, since losing them to tribal knowledge compounds over time as team members change. Value 4/5, Urgency 4/5.
3. **US-05 (Preserve Use-Case Narrative) third** — smaller, low-effort slice (Effort 2/5) that prevents the 5 existing use cases from being silently dropped when SPEC.md-derived content dominates the brief. Value 3/5.
4. **US-03 (Define Routing Rules) fourth** — low effort (Effort 1/5, a single documented decision), but doesn't produce value until Releases 1's content exists to route toward. Value 3/5, Urgency 3/5.
5. **US-04 (Validate Readiness, dry run) last** — deliberately sequenced last: it is the acceptance test for the whole bootstrap and can only produce a meaningful signal once US-01, US-02, US-03 are done. Value 5/5 (it's the proof the bootstrap worked) but has a hard dependency on everything above it.

| Priority | Story | Target Outcome | Value | Urgency | Effort | Dependencies |
|---|---|---|---|---|---|---|
| 1 | US-01 | DESIGN wave has canonical architecture context | 5 | 5 | 3 | None |
| 2 | US-02 | Undocumented decisions become discoverable | 4 | 4 | 2 | Benefits from US-01 (same triage pass) |
| 3 | US-05 | Use cases remain traceable, not orphaned | 3 | 2 | 2 | US-01 (brief.md must exist to trace into) |
| 4 | US-03 | Future features route correctly, skip needless DISCOVER | 3 | 3 | 1 | None (can run in parallel with US-01/02) |
| 5 | US-04 | SSOT proven usable by a real next feature | 5 | 3 | 2 | US-01, US-02, US-03 |
