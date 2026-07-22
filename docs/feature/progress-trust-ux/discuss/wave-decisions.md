# Wave Decisions: Progress & Trust UX Track

## Source of Shared Context

This track was split out of the umbrella feature `nwave-ticket-execution-engine` per the
human product owner's confirmed decision (umbrella `wave-decisions.md` Decision 4). The
umbrella feature directory (`docs/feature/nwave-ticket-execution-engine/discuss/`) remains
the shared discovery source for this track:

- JTBD job stories, four forces, and opportunity scores: `jtbd-job-stories.md`,
  `jtbd-four-forces.md`, `jtbd-opportunity-scores.md`
- Full 6-step journey (visual + YAML, including this track's Steps 4-6 "Monitor",
  "Intervene", "Conclude"): `journey-nwave-ticket-execution-engine-visual.md`,
  `journey-nwave-ticket-execution-engine.yaml`
- Shared artifact registry (`wave_status`, `last_activity_at`, `produced_artifacts_links`):
  `shared-artifacts-registry.md`
- Full story map, prioritization, and outcome KPIs: `story-map.md`, `prioritization.md`,
  `outcome-kpis.md`

Do not re-derive these — reference them.

## Cross-Track Dependencies

- **Upstream**: `progress-trust-ux` depends on `nwave-invocation-engine`'s `run_id`/
  wave-progress-signal contract from US-04. Without a stable run id and an emitting
  wave-progress stream, none of this track's stories (US-05 through US-10) can function. This
  is the single most important cross-track dependency for this track.
- **Internal to this track**: US-07 (curated wave-by-wave view) depends on US-05 (raw
  activity signal) — it is a curated layer built on top of the same underlying event stream,
  per the original Technical Notes ("Requires nWave's wave pipeline to emit distinguishable
  per-wave start/complete signals..."). US-08 (mid-run question) and US-09 (pause/halt) both
  depend directly on US-04's invocation mechanism supporting, respectively, mid-run message
  injection and safe-checkpoint control — two additional capabilities beyond one-shot
  triggering that `nwave-invocation-engine`'s SPIKE-skipped assumption must eventually prove
  out. US-10 (notify when input needed) depends on US-07 per the umbrella
  `prioritization.md` backlog table.
- **Downstream**: `multi-source-ingestion-governance`'s US-12 depends on this track's US-06
  (completion summary) — the Approve/Request Changes actions attach to the completion summary
  UI this track produces. `multi-source-ingestion-governance`'s US-13 depends on this track's
  US-05 and US-07 (Technical Notes: "Depends on US-05, US-07") — stalled/failed-run detection
  needs both the raw activity signal and the curated wave-status layer.

## Risks Inherited From Umbrella `wave-decisions.md`

- **Decision 1 (invocation mechanism) — partially inherited.** The umbrella document names
  this track's stories explicitly: "Stories carrying this dependency: US-04, US-05
  (partially — depends on US-04), US-07, US-08, US-09." Carry forward the "accepted working
  assumption, not empirically validated fact" framing for these four stories specifically —
  do not treat mid-run streaming (US-05/US-07), mid-run message injection (US-08), or
  safe-checkpoint granularity (US-09) as proven capabilities of whatever mechanism
  `nwave-invocation-engine` DESIGN selects. If that mechanism's actual granularity is coarser
  than assumed, US-07's "flag unusually long waves" and US-09's halt latency both need
  re-estimation.
- **Decision 6 (notification infrastructure confirmed absent) — applies specifically to
  US-10.** A targeted codebase search (`notif`, `sendEmail`, `smtp`/`SMTP` across all `.ts`
  files) found zero matches — no email/notification sending infrastructure exists anywhere in
  OrgOps today. US-10 requires building new out-of-band notification infrastructure from
  scratch (provider selection, delivery reliability, opt-out/preferences), not wiring into an
  existing capability. This has direct effort implications: DESIGN should re-assess whether
  US-10 belongs in Release 1 at all (its current story-map placement) or should move to a
  later release once its true scope is understood — it is plausibly a larger, more
  independent piece of work than a single 1-3 day story.
- **Decision 2 (JTBD unvalidated)**: Several of this track's Outcome KPIs (US-05's "0% of
  submitters report inability to tell if a run is stuck," US-07's ">= 80% report curated view
  sufficient") are analyst-estimated priors pending post-release survey validation with real
  submitters (n >= 5).

## Track-Specific Notes

- US-05's Technical Notes flag a conditional risk worth restating here: it reuses OrgOps'
  existing `processes`/`process_output` tables and `process:<processId>` WebSocket topic as a
  composition of existing primitives — but only "provided the invocation mechanism (US-04)
  actually produces a trackable process." If `nwave-invocation-engine`'s DESIGN selects a
  mechanism that does not naturally produce process-level output (e.g., a fully external
  service), this track's US-05 technical approach needs revisiting.
- `wave_status` is a property-shaped requirement (US-07 AC: "always reflects the run's actual
  current wave") — see the `@property` scenario convention in the umbrella journey `.feature`
  file for how this should be tested downstream in DISTILL.
