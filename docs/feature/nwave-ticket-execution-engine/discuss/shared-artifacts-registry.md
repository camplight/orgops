# Shared Artifacts Registry: nWave Ticket Execution Engine

Every `${variable}` referenced in the journey mockups and user stories is tracked here with a
single source of truth and documented consumers, per `nw-shared-artifact-tracking`.

## `ticket_id`

- **Source of truth**: Ticket intake record — either an OrgOps-native ticket store row, or a
  Trello card id ingested via the existing `trello-cli` skill (`skills/trello-cli/`).
- **Consumers**: ticket-scoped channel title/topic, classification message, restatement
  message, progress messages, intervention acknowledgments, completion summary, OrgOps UI
  ticket dashboard list.
- **Owner**: Ticket Intake capability (US-01, US-11).
- **Integration risk**: HIGH — if the id shown in a channel message ever diverges from the id
  in the ticket record, the submitter loses the ability to correlate progress with their
  actual ticket, directly undermining trust (the feature's core value proposition).
- **Validation**: `integration_validation.shared_artifact_consistency` in the journey YAML
  requires this artifact to match across all 6 journey steps.

## `channel_id`

- **Source of truth**: Ticket-scoped OrgOps channel created at intake time (one channel per
  ticket).
- **Consumers**: every message/event tied to this ticket; WebSocket topic
  (`channel:<channelId>`) the submitter's browser subscribes to.
- **Owner**: Ticket Intake capability (US-01).
- **Integration risk**: HIGH — a message posted to the wrong channel is invisible to the
  submitter, which is functionally identical to the "dead silence" failure mode called out
  throughout the journey.
- **Validation**: verify every event emitted during a run carries the same `channelId` as the
  one created at intake.

## `classification_result`

- **Source of truth**: Classifier decision event (`ticket.classified` or equivalent), emitted
  once per ticket by the classification step.
- **Consumers**: routing logic (fire nWave vs. route elsewhere), channel message to
  submitter, Priya Nair's governance/audit view.
- **Owner**: Ticket Classification capability (US-02, US-03).
- **Integration risk**: HIGH — misclassification either wastes engine time on non-dev work or
  silently drops real dev work; this is the #2/#7 underserved opportunity in
  `jtbd-opportunity-scores.md`.
- **Validation**: classification result and rationale must be posted to the channel before
  any downstream trigger fires (never a same-step race).

## `run_id`

- **Source of truth**: nWave execution invocation record. **Mechanism intentionally
  unspecified** — depends on SPIKE outcome (see `wave-decisions.md`). Whatever the mechanism,
  it must produce a stable identifier at trigger time.
- **Consumers**: progress messages, process output stream, intervention routing, completion
  summary, `produced_artifacts_links`.
- **Owner**: Implementation Trigger capability (US-04) — DESIGN wave, blocked on SPIKE.
- **Integration risk**: HIGH — without a stable run id, progress/intervention/completion
  cannot be correlated back to the correct ticket, especially if a submitter files a second
  ticket before the first completes.
- **Validation**: `run_id` must remain constant for the full lifetime of a single
  implementation run, from trigger through completion or failure.

## `wave_status`

- **Source of truth**: Wave-progress events emitted during the nWave run (DISCUSS / DESIGN /
  DISTILL / DELIVER transitions).
- **Consumers**: progress UI (Step 4 of the journey), channel messages, OrgOps UI ticket
  dashboard card.
- **Owner**: Progress Monitoring capability (US-05, US-07) — the #3/#4 highest-opportunity
  outcomes in `jtbd-opportunity-scores.md`.
- **Integration risk**: HIGH — a stale or fabricated wave status is explicitly called out in
  the journey as "worse than showing nothing" (Step 4 integration checkpoint).
- **Validation**: wave status shown to the submitter must always reflect the run's actual
  current wave; property-shaped criterion, see `@property` scenario in the journey `.feature`
  file.

## `last_activity_at`

- **Source of truth**: Most recent timestamp from the underlying process output stream or
  wave-progress event for the active run (leverages OrgOps' existing `processes`/
  `process_output` tables and `process:<processId>` WebSocket topic).
- **Consumers**: "Last activity" indicator in the progress UI (Step 4).
- **Owner**: Progress Monitoring capability (US-05).
- **Integration risk**: MEDIUM — a stale timestamp reads as false reassurance; must be tied to
  a real, live signal, not a fixed "in progress" label.
- **Validation**: timestamp updates whenever new process output or a wave-progress event is
  recorded for the run; never hardcoded.

## `produced_artifacts_links`

- **Source of truth**: DELIVER-wave output — branch name and/or PR reference produced by the
  implementation run.
- **Consumers**: completion summary, review step (US-12), OrgOps UI ticket dashboard card.
- **Owner**: Completion & Review capability (US-06, US-12).
- **Integration risk**: MEDIUM — a broken or missing link at completion undermines the
  "relieved/confident" end-state the emotional arc depends on.
- **Validation**: link must resolve to the actual branch/PR the run produced; never a
  placeholder.

## `guardrail_config`

- **Source of truth**: Engineering-defined ruleset (owned by Priya Nair) — allowed
  repos/paths, approval requirements, and any constraints on what the engine may touch
  autonomously. Not yet modeled in OrgOps (new domain concept — see `wave-decisions.md`).
- **Consumers**: classification step (to decide auto-trigger vs. require approval),
  execution trigger, Priya Nair's oversight view.
- **Owner**: Governance capability (US-12, referenced by US-02/US-03 for classification
  confidence).
- **Integration risk**: HIGH — this is the #7 underserved opportunity
  (`jtbd-opportunity-scores.md`) and the primary anxiety force for the engineering
  stakeholder persona; without it, any ticket could trigger autonomous code changes with no
  human-defined boundary.
- **Validation**: DESIGN wave must define where this configuration lives and how the
  classification/trigger steps read it before Release 2 (US-12) ships.

## Consistency Check Summary

| Artifact | Source Exists Today? | New Domain Concept? |
|---|---|---|
| `ticket_id` | Partial — Trello card id exists via `trello-cli`; OrgOps-native ticket store does not | Yes (OrgOps-native ticket store) |
| `channel_id` | Yes — OrgOps channels already exist | No |
| `classification_result` | No | Yes |
| `run_id` | No — closest analog is `processes.id`, but no "nWave run" concept exists | Yes |
| `wave_status` | No | Yes |
| `last_activity_at` | Partial — `process_output` timestamps exist for shell-based processes | No (composition of existing primitive) |
| `produced_artifacts_links` | No | Yes |
| `guardrail_config` | No | Yes |

Five of eight shared artifacts require new domain modeling in DESIGN. This is expected for a
greenfield capability and is reflected in the Scope Assessment in `story-map.md`.
