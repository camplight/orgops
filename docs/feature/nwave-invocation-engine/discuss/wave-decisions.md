# Wave Decisions: nWave Invocation Engine Track

## Source of Shared Context

This track was split out of the umbrella feature `nwave-ticket-execution-engine` per the
human product owner's confirmed decision (umbrella `wave-decisions.md` Decision 4). The
umbrella feature directory (`docs/feature/nwave-ticket-execution-engine/discuss/`) remains
the shared discovery source for this track:

- JTBD job stories, four forces, and opportunity scores: `jtbd-job-stories.md`,
  `jtbd-four-forces.md`, `jtbd-opportunity-scores.md`
- Full 6-step journey (visual + YAML, including this track's Step 3 "Implementation
  Triggered"): `journey-nwave-ticket-execution-engine-visual.md`,
  `journey-nwave-ticket-execution-engine.yaml`
- Shared artifact registry (`run_id`, `wave_status`): `shared-artifacts-registry.md`
- Full story map, prioritization, and outcome KPIs: `story-map.md`, `prioritization.md`,
  `outcome-kpis.md`

Do not re-derive these — reference them.

## Decision 1 (Inherited in Full): Invocation Mechanism — SPIKE Skipped; Headless Feasibility Accepted as a Working Assumption

**This is the central open risk of this track and the most important item in this document.**

Carried forward verbatim from the umbrella `wave-decisions.md` Decision 1, which this track
inherits in full because US-04 *is* the invocation-triggering story:

The planned validation SPIKE for this assumption was explicitly skipped per user directive
("go straight to the track split. I'm confident that the nwave integration can run
headlessly"). Headless invocation feasibility is therefore carried into DESIGN as an
**accepted working assumption, not an empirically validated fact**. If DESIGN or DELIVER
encounters friction implementing US-04, this assumption should be the first thing revisited —
treat it as unproven until a real implementation exercises it, even though no further spike is
planned.

How OrgOps' agent-runner actually triggers and communicates with an nWave wave-pipeline run
is **not decided** anywhere in the original DISCUSS-wave output. nWave's wave pipeline
(DISCUSS -> DESIGN -> DISTILL -> DELIVER) currently runs as interactive Claude Code
skills/subagents driven by slash commands inside a Claude Code session. Whether and how that
pipeline can be invoked headlessly/programmatically from OrgOps' `agent-runner` is unresolved
by evidence, though assumed feasible per the above.

**What is grounded (from reading `apps/agent-runner/src/`)**:

- OrgOps has a `WRAPPED` agent mode with a pluggable "harness" model
  (`apps/agent-runner/src/wrapper-harness/`). The built-in `command` harness
  (`wrapper-harness/command.ts`) shells out to an external command and is a *plausible*
  candidate — but its `runTurn` is blocking, single-shot, and only returns stdout/stderr at
  process exit. It has **no existing support for streaming intermediate per-wave progress
  mid-run**, which conflicts directly with `progress-trust-ux`'s highest-priority requirement
  (US-05/US-07, opportunity scores #3/#4 in `jtbd-opportunity-scores.md`).
- OrgOps separately has `shell_start`/`shell_stop`/`shell_status`/`shell_tail` tools available
  to native (`CLASSIC`/`RLM_REPL`) agents, which support long-running async processes with
  tail-able streaming output via the existing `processes`/`process_output` tables and
  `process:<processId>` WebSocket topic. This is a different, non-`WRAPPED` path that might
  be a better fit for streaming, but has not been evaluated for its suitability to host a
  multi-hour, multi-wave nWave run.
- Neither path has been validated against nWave's actual runtime requirements (headless
  invocation flag/mode, ability to accept mid-run input, ability to emit structured
  wave-boundary events).

**What DISCUSS deliberately did NOT do**: prescribe a mechanism. US-04's acceptance criteria
are written against the *observable contract* only (a run starts, has a stable id, emits
wave-progress signal, can receive input, can be halted at a safe checkpoint) — never against
an assumed implementation.

**DESIGN must still pick a concrete mechanism** from the two candidates above (or another it
identifies) and account for these unresolved sub-questions during design rather than assuming
them away: (1) streaming mid-run wave-progress signal, (2) accepting mid-run input, (3)
realistic "safe checkpoint" granularity for halt/pause, (4) failure/timeout handling. Only
"can it invoke nWave headlessly at all" is treated as answered (yes, per user directive) — the
rest remain open design questions, not validated facts.

## Cross-Track Dependencies

- **Upstream**: None (blocking). US-04's precondition is a confirmed DEVELOPMENT WORK
  classification (produced by `ticket-classification`'s US-02/US-03), but per the umbrella
  `story-map.md`'s walking-skeleton design, this track can be built and demoed against a
  stubbed/manual classification result without waiting for `ticket-classification`'s actual
  delivery — the dependency is on the *classification contract* (a confirmed ticket + intent),
  not on that track being complete. This is why `nwave-invocation-engine` has **no blocking
  upstream dependency** and is the **critical-path track**: every other track depends on it,
  but it depends on no other track's completion, only on a stable interface.
- **Downstream**: `progress-trust-ux` depends on this track's `run_id`/wave-progress-signal
  contract from US-04 in full — none of US-05 through US-10 can function without a stable run
  id and an emitting wave-progress stream. Per the umbrella Decision 1, US-05 (partially),
  US-07, US-08, and US-09 explicitly carry this same invocation-mechanism dependency forward.
- **Downstream (indirect)**: `multi-source-ingestion-governance`'s US-13 (failure/stuck
  recovery) depends transitively on this track — staleness/failure detection requires the
  wave-progress signal this track produces, consumed via `progress-trust-ux`'s US-05/US-07.

## Risks Inherited From Umbrella `wave-decisions.md`

- **Decision 1 in full** — see above; this is this track's central risk.
- **Decision 2 (JTBD unvalidated)**: The "median time from confirmation to run start < 2
  minutes" target (US-04 Outcome KPI) is explicitly marked "target to be refined" and has no
  defensible baseline until a real implementation exists — do not treat it as committed.

## Track-Specific Notes

- `run_id` and `wave_status` are both entirely new domain concepts (no existing OrgOps analog
  — the closest is `processes.id`, which is not the same concept). See umbrella
  `shared-artifacts-registry.md`.
- Technical Notes on US-04 (carried into this track's `user-stories.md`) explicitly name
  `apps/agent-runner/src/wrapper-harness/command.ts` as the harness contract any DESIGN-wave
  candidate mechanism must satisfy or extend.
