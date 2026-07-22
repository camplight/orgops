# ADR-0002: One OS Process Per Wave, Chained Sequentially

## Status

Accepted.

## Context

Given ADR-0001's choice of the `shell_start` async process primitive as the execution
substrate, a second question follows: does one nWave *run* (DISCUSS → DESIGN → DISTILL →
DELIVER) map to a single long-running OS process for the whole run, or to a sequence of
separate OS processes, one per wave?

This choice directly determines the answers to two of US-04's open design questions carried
from DISCUSS (`wave-decisions.md` Decision 1):

- What is the realistic "safe checkpoint" granularity for halt/pause (future US-09)?
- What does failure/timeout handling look like?

It also affects how "mid-run wave-progress signal" (US-04's core observable contract) is
produced, since `shell_start` streams raw stdout/stderr, not structured wave-boundary markers.

## Decision

Model one nWave run as a **sequence of separate OS processes, one per wave**, chained by a new
deterministic orchestration module (not an LLM turn) once the prior wave's process exits with
code 0. Each wave's process is tracked independently via `shell_start`/the `processes` table;
a new `nwave_run_waves` row links each wave to its `run_id` and `processId`.

This mirrors how nWave itself already partitions work: each wave is already triggered by a
distinct slash command in an interactive session (`/nw-design`, `/nw-distill`, ...). Invoking
one headless CLI call per wave is not a new decomposition invented for this integration — it
is the decomposition nWave's own methodology already uses.

## Alternatives Considered

### 1. Single long-running process for the entire run

**Rejected.** A multi-hour, multi-wave process gives only two checkpoints: "still running" and
"exited." Halting it mid-wave (future US-09) has no defined safe point — `shell_stop` sends
`SIGTERM` to whatever nWave is doing at that instant, which could be mid-file-write in
DELIVER's software-crafter step. Failure/timeout handling degrades to "the whole run failed"
even if three of four waves completed cleanly, discarding useful partial progress and making
diagnosis harder (which wave failed is not directly observable from process exit alone; it
would require parsing accumulated stdout after the fact).

### 2. One process per wave, chained sequentially (chosen)

**Accepted.** Wave completion (clean process exit) is a structurally guaranteed safe
checkpoint — nWave's own wave boundaries already assume a wave completes and hands off state
via committed artifacts/documents before the next wave starts (this is how the wave pipeline
already works interactively). Halting a run "between waves" (future US-09) requires no new
nWave-side capability: the orchestrator simply does not start the next wave's process. Failure
is attributable to a specific, named wave. Mid-run wave-progress signal is produced at the
granularity the AC actually asks for ("emits wave-progress signal" — not sub-wave step
signal): a `nwave.run.wave_started`/`nwave.run.wave_completed` event per process
start/exit, which is already directly available from the `process.started`/`process.exited`
events the substrate already emits.

## Consequences

**Positive**

- Safe halt/pause checkpoint (future US-09) is "between waves" — free, requires no new nWave
  capability, and is honest about what "safe" means (never foreclosing finer-grained
  mid-wave checkpointing later if nWave itself grows that capability).
- Failure is attributable to a specific wave, satisfying US-04 AC5 ("a failed trigger attempt
  is clearly communicated") at both run-start and mid-run granularity, and giving
  `progress-trust-ux` a wave name to show, not just a generic "failed."
- Wave-progress signal (US-04's core contract) falls out of process lifecycle events the
  substrate already emits — no new nWave-side instrumentation is required for the walking
  skeleton.
- Each wave is independently retryable/re-runnable in principle (not implemented in this
  track, but not foreclosed).

**Negative**

- Wave-level granularity is coarser than sub-wave step granularity. The submitter sees "now in
  DESIGN" but not "now in Architecture Design vs. Quality Validation" within DESIGN. This is a
  known limitation, not a defect: US-04's AC only requires wave-progress signal, and
  `progress-trust-ux`'s later stories (US-05/US-07) are the ones that would need to decide
  whether finer granularity is worth the added complexity of parsing best-effort stdout
  markers (e.g., `[SKILL LOADED] ...` banners already printed by nWave agents) as a
  supplementary, non-authoritative hint layered on top of the authoritative process-exit
  signal. This track does not implement that layering; it is called out as a non-foreclosed
  extension point in `docs/product/architecture/brief.md`.
- Requires the orchestrator to pass run continuity context (ticket ref, run id, prior wave
  outputs already live in the repo/workspace as committed artifacts) into each new process
  invocation — a small but real piece of new glue code, tracked as the `Wave Runner`
  component in `docs/product/architecture/brief.md`.
- A crashed `agent-runner` host mid-wave leaves a `RUNNING` wave row with no live process.
  The existing `/api/processes?reconcile=1` pattern already reconciles stale `RUNNING`/
  `STARTING` `processes` rows by checking PID liveness; the same reconciliation must be
  extended to `nwave_run_waves`/`nwave_runs` on runner restart. This is flagged for
  `platform-architect` as an operational-readiness item, not implemented in this design pass.

## Enforcement

No new structural rule beyond ADR-0001's — the orchestration module owns wave sequencing
logic; it must not be duplicated into the harness abstraction (see brief.md "Architecture
Enforcement").
