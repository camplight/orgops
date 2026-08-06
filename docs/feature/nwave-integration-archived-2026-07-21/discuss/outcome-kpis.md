## Feature: nwave-integration

### Objective

Enable every future OrgOps feature to run its DESIGN wave grounded in documented, canonical architecture — instead of re-deriving context from `docs/SPEC.md` prose and source-code archaeology each time — by formalizing the already-shipped system into nWave's SSOT doc model.

### Outcome KPIs

| # | Who | Does What | By How Much | Baseline | Measured By | Type |
|---|---|---|---|---|---|---|
| 1 | solution-architect (DESIGN wave agent), on any subsequent OrgOps feature | Reads `docs/product/architecture/brief.md` and extends it instead of re-deriving architecture from `docs/SPEC.md`/source cold | 100% of DESIGN wave runs pass the reading-enforcement gate with zero missing-file markers on architecture files | 0% (file did not exist; gate could not pass) | DESIGN wave's reading-enforcement checklist output, captured in that feature's `wave-decisions.md` | Leading |
| 2 | OrgOps contributors adding a new architectural decision | Write an ADR in `docs/product/architecture/` instead of leaving the decision undocumented | 100% ADR coverage of decision-shaped statements identified (4 of 4 found during this feature's inventory; convention available for 100% of future decisions) | 0 ADRs exist despite 4+ identifiable historical decisions already shipped | Count of `adr-*.md` files against decision-shaped statements identified in DESIGN wave review | Leading |
| 3 | Contributors starting a new OrgOps feature | Correctly route to DISCUSS/DESIGN (skip DISCOVER) or correctly route to DISCOVER when the exception criterion applies | 100% of subsequent features cite the `wave-decisions.md` routing rule rather than re-litigating wave entry point from scratch | 0 features have used the rule — it does not exist yet | Presence of routing-rule citation in each subsequent feature's own `wave-decisions.md` | Leading (secondary) |

### Metric Hierarchy

- **North Star**: Every future OrgOps feature's DESIGN wave starts from documented architecture, not code archaeology — operationalized as KPI-1's reading-enforcement gate pass rate.
- **Leading Indicators**: ADR coverage (KPI-2) and routing-rule citation rate (KPI-3) both predict whether the North Star holds over multiple features, not just the first one.
- **Guardrail Metrics**: `docs/product/architecture/brief.md` and `adr-*.md` content must not duplicate `docs/SPEC.md` verbatim (no block >3 lines copied without a link). A guardrail breach means the SSOT is drifting into a second, unmaintained source of truth — checked at every DESIGN-wave review going forward, not just at this feature's DoR gate.

### Measurement Plan

| KPI | Data Source | Collection Method | Frequency | Owner |
|---|---|---|---|---|
| 1: Reading-enforcement gate pass rate | DESIGN wave execution logs / each feature's `wave-decisions.md` | Manual check during DESIGN wave's Prior Wave Consultation step, recorded as ✓/⊘ per file | Every DESIGN wave invocation after this feature ships | solution-architect (self-reported), spot-checked by product-owner |
| 2: ADR coverage | `docs/product/architecture/adr-*.md` file count vs. decision log | Manual audit during DESIGN wave review | At this feature's completion (baseline), then per subsequent architectural decision | solution-architect / relevant specialist architect |
| 3: Routing-rule citation rate | Each subsequent feature's `wave-decisions.md` | Grep/manual check for citation of this feature's `[D4]` decision | Per new feature started | product-owner |

### Hypothesis

We believe that formalizing OrgOps's shipped architecture into `docs/product/architecture/brief.md` and `adr-*.md`, plus a written DISCOVER-skip routing rule, for OrgOps engineering leads and contributors (starting with Priya Raman) will achieve faster, better-grounded DESIGN waves for every subsequent feature.

We will know this is true when solution-architect reads and extends the SSOT with zero missing-file gate failures on 100% of subsequent DESIGN wave runs (KPI-1), when 100% of identified architectural decisions have a discoverable ADR (KPI-2), and when 100% of subsequent features cite the routing rule instead of re-litigating wave entry point from scratch (KPI-3).
