# Wave Decisions: Multi-Source Ingestion & Governance Track

## Source of Shared Context

This track was split out of the umbrella feature `nwave-ticket-execution-engine` per the
human product owner's confirmed decision (umbrella `wave-decisions.md` Decision 4). The
umbrella feature directory (`docs/feature/nwave-ticket-execution-engine/discuss/`) remains
the shared discovery source for this track:

- JTBD job stories, four forces, and opportunity scores: `jtbd-job-stories.md`,
  `jtbd-four-forces.md`, `jtbd-opportunity-scores.md`
- Full 6-step journey (visual + YAML): `journey-nwave-ticket-execution-engine-visual.md`,
  `journey-nwave-ticket-execution-engine.yaml`
- Shared artifact registry (`produced_artifacts_links`, `guardrail_config`):
  `shared-artifacts-registry.md`
- Full story map, prioritization, and outcome KPIs: `story-map.md`, `prioritization.md`,
  `outcome-kpis.md`

Do not re-derive these — reference them.

## Cross-Track Dependencies

- **Upstream**: US-11 depends on `ticket-classification`'s US-02 classification step being
  callable from a non-native ticket source. Trello-ingested tickets must enter the identical
  classification/confirmation/execution/monitoring flow already validated for native-form
  tickets (US-11's UAT scenario "Ingested tickets follow the identical downstream flow"
  requires this explicitly) — this depends on `ticket-classification`'s US-02 not being
  hardcoded to the native-form intake path.
- **Upstream**: US-12 depends on `progress-trust-ux`'s US-06 (completion summary) — the
  Approve/Request Changes actions this story adds attach directly to the completion summary
  UI that track produces; US-12 cannot be built before US-06 exists.
- **Upstream**: US-13 depends on `progress-trust-ux`'s US-05 and US-07 (raw activity signal
  and curated wave status) — stalled/failed-run detection needs both signals to determine
  what "no activity for 30 minutes during a typically-5-minute wave" means.
- **Upstream (transitive)**: All three stories in this track ultimately depend on
  `nwave-invocation-engine`'s US-04 run contract — none of classification-on-ingestion,
  completion review, or failure detection exist without an active, identifiable run.
- **Internal to this track**: US-12 additionally depends on `guardrail_config` existing as a
  real, checkable ruleset — a new domain concept with no defined owner or storage location
  yet (see Decision 5 below). This is a dependency on organizational policy input, not on
  another delivery track.

## Risks Inherited From Umbrella `wave-decisions.md`

- **Decision 5 (governance/guardrail policy deliberately deferred) — applies in full to
  US-12.** `guardrail_config` (allowed repos/paths, approval requirements) does not exist
  anywhere in OrgOps today and requires organizational policy input (from an
  engineering-lead-equivalent role, represented by Priya Nair) that is outside this feature's
  control to define unilaterally. US-12 is the first story in this feature requiring
  `guardrail_config` to exist as a real, checkable ruleset. DESIGN should treat "who defines
  and enforces `guardrail_config`" as a required question before this track's US-12 is built
  — it is a conscious, documented trade-off, not a silent gap.
- **Decision 2 (JTBD unvalidated)**: The >= 50% Trello-adoption target (US-11 Outcome KPI)
  and the "100% of completed runs decided within 3 business days" target (US-12) are
  analyst-estimated priors requiring post-release validation with real usage data.
- **Decision 1 (invocation mechanism) — indirectly inherited via US-13.** US-13's staleness
  detection depends on the granularity of wave-progress events, which in turn depends on the
  invocation mechanism `nwave-invocation-engine` DESIGN eventually selects under its accepted
  working assumption. If that assumption proves wrong or the chosen mechanism has coarser
  event granularity than expected, US-13's "staleness threshold relative to typical wave
  duration" design will need rework.

## Track-Specific Notes

- US-11 is the lowest-risk story in this track — `trello-cli` (`skills/trello-cli/`) already
  exists as a working read/polling path; this is largely a wiring/scheduling task, not new
  integration capability (per original Technical Notes).
- `produced_artifacts_links` (consumed by US-12) is a new domain concept sourced from
  DELIVER-wave output (branch/PR reference) — see umbrella `shared-artifacts-registry.md`.
