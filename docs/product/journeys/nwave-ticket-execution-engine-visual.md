# Product SSOT Journey (Visual Summary): nWave Ticket Execution Engine

Canonical pointer for cross-feature reference. Full mockups, per-step failure modes, and
integration checkpoints live in the feature-scoped copy — this file is a thin summary so
future features can quickly see whether this journey overlaps with theirs.

**Full detail**: `docs/feature/nwave-ticket-execution-engine/discuss/journey-nwave-ticket-execution-engine-visual.md`

## Summary

A ticket submitter (Maria Santos, Senior Product Manager, primary persona) files a ticket
(Trello card or OrgOps-native form), receives an automatic classification into
"development work" or not, confirms the system's understood intent, and an nWave
implementation run is triggered. While the run executes, the submitter can monitor real
progress (curated wave-by-wave status backed by real activity signal), intervene with
mid-run notes or a full pause/halt, and is proactively notified if the run needs their input
or has failed/stalled. On completion, the submitter reviews a verifiable summary and
approves or requests changes.

## Emotional Arc

`Hopeful but wary -> Watchful (oscillating) -> Relieved/Confident (happy) | Supported, not
blamed (error path)`

## Backbone (7 activities)

Submit Ticket -> Classify Ticket -> Prepare & Confirm Intent -> Execute Implementation ->
Monitor Progress -> Intervene / Get Notified -> Receive & Review Completed Work

## Cross-Feature Reuse Notes

- Reuses existing OrgOps channel/event/WebSocket primitives — any future feature building
  another "long-running autonomous work with a human feedback loop" journey should look at
  this journey's shared-artifacts registry first (`wave_status`, `last_activity_at` patterns
  are directly reusable).
- Reuses the existing `trello-cli` skill as a ticket-source integration pattern — future
  features adding other external ticket sources (e.g., Jira) should follow the same
  ingestion-as-a-skill pattern documented in US-11.
- Introduces `guardrail_config` as a new governance domain concept (not yet implemented) —
  future features involving autonomous code changes should check whether this concept has
  matured into a shared governance capability before inventing a parallel one.

## Open Question Carried Forward

Invocation mechanism for headlessly triggering nWave's wave pipeline is unresolved pending a
SPIKE. See `docs/feature/nwave-ticket-execution-engine/discuss/wave-decisions.md`.
