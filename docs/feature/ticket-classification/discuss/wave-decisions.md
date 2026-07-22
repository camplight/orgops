# Wave Decisions: Ticket Classification Track

## Source of Shared Context

This track was split out of the umbrella feature `nwave-ticket-execution-engine` per the
human product owner's confirmed decision (umbrella `wave-decisions.md` Decision 4). The
umbrella feature directory (`docs/feature/nwave-ticket-execution-engine/discuss/`) remains
the shared discovery source for this track:

- JTBD job stories, four forces, and opportunity scores: `jtbd-job-stories.md`,
  `jtbd-four-forces.md`, `jtbd-opportunity-scores.md`
- Full 6-step journey (visual + YAML, including this track's Steps 1-2):
  `journey-nwave-ticket-execution-engine-visual.md`,
  `journey-nwave-ticket-execution-engine.yaml`
- Shared artifact registry (`ticket_id`, `channel_id`, `classification_result` and others):
  `shared-artifacts-registry.md`
- Full story map, prioritization, and outcome KPIs: `story-map.md`, `prioritization.md`,
  `outcome-kpis.md`

Do not re-derive these — reference them.

## Cross-Track Dependencies

- **Upstream**: None. `ticket-classification` is the entry point of the journey (the "front
  door") and has no dependency on any other track.
- **Downstream**: `nwave-invocation-engine` depends on this track's US-03 — an nWave
  implementation run (US-04) is only triggered once a ticket's classification is confirmed as
  DEVELOPMENT WORK (either directly by the classifier or via a submitter override). US-04's
  Problem statement is explicit: "Once Maria Santos's ticket is confirmed as development
  work, she needs implementation to actually start..." Per `nwave-invocation-engine`'s own
  `wave-decisions.md`, that track can build against a *stubbed* classification contract
  without waiting for this track's actual delivery — but the observable contract (a confirmed
  `classification_result`) still originates here.
- **Downstream**: `multi-source-ingestion-governance`'s US-11 (Trello ingestion) depends on
  this track's US-02 — the classification step must be callable for tickets ingested from a
  non-native source (Trello card), not only tickets submitted via the OrgOps-native form.
  US-11's UAT scenario "Ingested tickets follow the identical downstream flow" explicitly
  requires a Trello-sourced ticket to "proceed through classification, confirmation,
  execution, and monitoring" identically to a native-form ticket. DESIGN for
  `multi-source-ingestion-governance` must confirm this track's US-02 classification step
  accepts ticket content regardless of source, not only from the native-form code path built
  here.

## Risks Inherited From Umbrella `wave-decisions.md`

- **Decision 2 (JTBD unvalidated)**: The classification accuracy target (>= 90% against a
  human-reviewed sample of 50 tickets, US-02 Outcome KPI) is an analyst-estimated prior, not
  validated against real ticket submitters. Validate post-Release-0 per the umbrella
  mitigation plan (interview 5-8 real ticket submitters).
- **Decision 1 (invocation mechanism) does NOT apply directly to this track's stories.**
  US-01 through US-03 do not touch nWave invocation at all — the classification step is a
  self-contained agent-driven decision with no dependency on the invocation mechanism. That
  risk belongs to `nwave-invocation-engine` and everything downstream of it.

## Track-Specific Notes

- This track owns two new domain concepts requiring DESIGN-wave data modeling (see umbrella
  `shared-artifacts-registry.md`): the OrgOps-native ticket store (`ticket_id` is new for
  native-form submissions; a Trello card id already exists via `trello-cli` for the ingestion
  path built in `multi-source-ingestion-governance`) and the classification decision event
  (`classification_result` — entirely new).
- `channel_id` (ticket-scoped channel) is **not** a new domain concept for this track — it
  reuses existing OrgOps channel creation and subscription primitives (US-01 Technical
  Notes).
