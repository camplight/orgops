# Shared Artifacts Registry — nwave-integration

Every artifact that appears in more than one journey step or is consumed by a downstream wave is tracked here with its single source of truth, per the shared-artifact-tracking methodology.

```yaml
shared_artifacts:
  docs_spec_md:
    source_of_truth: "docs/SPEC.md"
    consumers: ["docs/product/architecture/brief.md (summarized + linked)", "ADR authoring (docs/product/architecture/adr-*.md)", "US-01, US-02, US-05"]
    owner: "OrgOps maintainers (existing, pre-nWave document)"
    integration_risk: "HIGH -- if brief.md duplicates SPEC.md content instead of linking to it, the two documents will drift, since SPEC.md is the doc contributors already update when implementation changes"
    validation: "brief.md sections cross-checked against SPEC.md at DESIGN wave review; any verbatim-copied block >3 lines is flagged"

  docs_use_cases_md:
    source_of_truth: "docs/use-cases.md"
    consumers: ["docs/product/architecture/brief.md System Context section", "US-01, US-05"]
    owner: "OrgOps maintainers (existing, pre-nWave document)"
    integration_risk: "MEDIUM -- use cases could be paraphrased inconsistently if brief.md doesn't reference the numbered use cases directly"
    validation: "Each of the 5 use cases in use-cases.md is traceable to a brief.md capability statement or explicitly noted as out of scope for the SSOT bootstrap"

  architecture_brief_md:
    source_of_truth: "docs/product/architecture/brief.md"
    consumers: ["DESIGN wave (solution-architect, ddd-architect, system-designer -- each own a section)", "DISTILL wave (acceptance-designer, for driving ports)", "DELIVER wave (crafters, for structural context)", "US-01, US-04"]
    owner: "solution-architect (DESIGN wave), created off this feature's handoff"
    integration_risk: "HIGH -- every future OrgOps feature's DESIGN wave depends on this file existing and being structured with the headings other architects/waves expect (## Application Architecture, ## System Architecture, ## Domain Model)"
    validation: "US-04 dry-run: next real feature's DESIGN wave reading-enforcement gate must show zero missing-file markers"

  architecture_adrs:
    source_of_truth: "docs/product/architecture/adr-*.md"
    consumers: ["DESIGN wave (all architects, must not silently contradict recorded decisions)", "solution-architect-reviewer", "US-02, US-04"]
    owner: "solution-architect / relevant architect (DESIGN wave), created off this feature's handoff"
    integration_risk: "MEDIUM -- a missed decision doesn't break anything immediately, but risks contradictory future decisions (e.g. someone reintroducing a rejected pattern)"
    validation: "Every decision-shaped statement identified during SPEC.md triage (US-02) has a corresponding ADR or a recorded deferral"

  wave_routing_rule:
    source_of_truth: "docs/feature/nwave-integration/discuss/wave-decisions.md, section [D4]"
    consumers: ["future nw-discuss migration-gate checks", "future nw-diverge migration-gate checks", "future nw-design migration-gate checks", "US-03"]
    owner: "product-owner (this feature, DISCUSS wave)"
    integration_risk: "MEDIUM -- if not consulted, future features may re-run an unnecessary DISCOVER pass or, worse, skip discovery that was actually needed for a genuinely new problem space"
    validation: "US-04 dry-run: next real feature explicitly cites this rule in its own wave-decisions.md rather than re-deciding from scratch"

  feature_id_namespace:
    source_of_truth: "docs/feature/nwave-integration/ (this feature's own directory)"
    consumers: ["all artifacts in this feature", "future features referencing this bootstrap as precedent"]
    owner: "product-owner (this feature, DISCUSS wave) -- first feature directory under docs/feature/, establishes the precedent for feature-id naming"
    integration_risk: "LOW -- naming convention, easy to correct later if inconsistent"
    validation: "feature-id matches kebab-case convention used across DISCUSS artifacts"
```

## Integration Checkpoints Summary

| Checkpoint | Validates | Owner |
|---|---|---|
| Brief.md is a thin index, not a SPEC.md copy | `docs_spec_md` vs `architecture_brief_md` consistency | US-01, reviewed at DoR |
| Every decision-shaped SPEC.md statement has an ADR or a recorded deferral | `docs_spec_md` vs `architecture_adrs` completeness | US-02, reviewed at DoR |
| Next feature's DESIGN wave passes reading-enforcement gate with zero missing-file markers | `architecture_brief_md` + `architecture_adrs` readiness | US-04 (dry run) |
| Next feature's wave-decisions.md cites the DISCOVER-skip rule | `wave_routing_rule` actually consulted, not just written | US-04 (dry run) |

## Quality Gate Self-Check

- Journey completeness: all 6 steps have clear goals, commands/actions, emotional annotations, shared artifacts, and integration checkpoints — PASS (see `journey-nwave-integration.yaml`)
- Emotional coherence: arc defined (uncertain → methodical → confident/unblocked), no jarring transitions, confidence builds progressively — PASS
- Horizontal integration: every artifact above has one documented source and documented consumers — PASS
- CLI/process vocabulary: consistent naming (`brief.md`, `adr-*.md`, `wave-decisions.md`) used identically across all six artifacts produced this wave — PASS
