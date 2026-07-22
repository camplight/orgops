# ADR-0012: Provisional Staleness Threshold — Reuses `progress-trust-ux`'s Per-Wave Baseline at a Stricter Multiplier, Explicitly Flagged as Provisional

## Status

Accepted.

## Context

US-13 requires stalled runs to be "proactively flagged as possibly stuck" once activity stops for
longer than "a defined threshold," explicitly relative to typical wave duration rather than a
single fixed value — the story's own Technical Notes state this is "likely informed by data
gathered during `progress-trust-ux`'s Release 0/Release 1 operation." No such data exists yet:
this track's DESIGN pass runs before any of the three prior tracks have shipped and operated, so
there is no measured wave-duration distribution to build an adaptive threshold from.

`progress-trust-ux` already faced a structurally identical problem for a different purpose (its
`Wave Status Projector`'s "unusually long wave" UI hint) and already resolved it with a stated,
explicit provisional heuristic: a static per-wave-type baseline (DISCUSS 15 min, DESIGN 30 min,
DISTILL 20 min, DELIVER 60 min — analyst-estimated priors, not measured), flagged at
`durationMs > baseline * 1.5`, with an explicit commitment to replace it with a measured rolling
baseline (median of the last 20 completed runs per wave) once real data exists.

This track's staleness detection is not the same concern as that UI hint — it triggers a proactive
channel notification and reasons about "possibly stuck," a stronger claim than "this wave is
running a bit long" — but it is the same underlying signal (elapsed time within a wave, judged
against a per-wave-type expectation) facing the identical data-availability problem.

## Decision

**Reuse `progress-trust-ux`'s exact same per-wave baseline table, at a stricter (larger) provisional
multiplier than that track's own 1.5x "unusually long" hint**, to reflect that this track's action
(a proactive "possibly stuck" notification) is a stronger, more attention-demanding claim than a
passive UI annotation and should trigger less readily on ordinary variance. Provisional
`staleThresholdMs = baseline * 2`, giving: DISCUSS 30 min, DESIGN 60 min, DISTILL 40 min, DELIVER
120 min. This is fed as the `staleThresholdMs` parameter to the **same, unmodified** `Run Activity
Deriver` (`packages/schemas/src/run-activity.ts`) `progress-trust-ux`'s `ActivityIndicator` already
calls with its own (different) threshold — one shared pure function, two different callers
supplying different thresholds for different purposes, not two competing definitions of
"staleness."

**This threshold is explicitly provisional**, analyst-estimated exactly like its sibling baseline,
and **must be replaced by the same measured-rolling-baseline plan `progress-trust-ux` already
committed to** (median of the last 20 completed runs per wave) once real operational data exists —
this ADR does not invent a second, competing follow-up plan; it inherits the one already stated.

## Alternatives Considered

### 1. Skip stuck-run detection until real wave-duration data exists

**Rejected.** US-13's own problem statement is unambiguous that this is a core requirement, not an
optional polish item ("the single worst outcome in this entire journey is dead silence after a
failure" applies with equal force to a silently-stuck run). Deferring an explicit AC to an
unscheduled future data-collection milestone, with no interim behavior at all, is the same category
of under-scoping this design's own standards already reject elsewhere (e.g. `progress-trust-ux`'s
own rejection of skipping its "unusually long wave" AC for the identical reason).

### 2. A single fixed threshold across all wave types (e.g., "30 minutes of no activity, regardless of wave")

**Rejected.** US-13's Technical Notes explicitly call out that typical duration "will vary
significantly by ticket complexity" and, implicitly via the domain example ("no activity for 30
minutes during what is normally a 5-minute wave"), by wave type. A single fixed threshold would
either be too sensitive for long waves (DELIVER) — generating false "possibly stuck" alarms that
would themselves erode trust, the opposite of this track's purpose — or too insensitive for short
waves (DISCUSS), leaving a genuinely stuck short wave undetected for far longer than necessary.

### 3. Build a statistical/adaptive threshold now, seeded with an assumed distribution

**Rejected.** There is no real data to seed such a model with, and inventing a plausible-looking
distribution to train against would be fabricating data this design has no basis for — the same
category of rejection `progress-trust-ux`'s ADR-0007 already applied to inferring completion data
from unconfirmed assumptions about nWave's git workflow. A statistical model built on invented
inputs is worse than an honestly-labeled static heuristic, because it looks more rigorous than it
is.

### 4. Reuse `progress-trust-ux`'s exact baseline table at a stricter multiplier, explicitly provisional (chosen)

**Accepted.** Costs nothing new to build (the baseline table and the `Run Activity Deriver`
function both already exist) and is honestly labeled as provisional with a concrete replacement
plan this track does not need to invent, since `progress-trust-ux` already committed to one. The
stricter multiplier (2x vs. the sibling's 1.5x) is a deliberate, stated choice reflecting that this
track's action (an active notification) should be more conservative than a passive UI hint, not an
arbitrary numeric difference.

## Consequences

**Positive**

- Zero new instrumentation or data-collection mechanism required — reuses baseline data and a pure
  function that already exist, satisfying US-13's AC now rather than waiting on unscheduled future
  data.
- Two callers of the same `Run Activity Deriver` function, each supplying their own threshold for
  their own purpose, avoids two competing implementations of "what counts as stale" — a single
  shared definition, parameterized, not duplicated.
- The replacement plan is already defined (median of last 20 completed runs, per
  `progress-trust-ux`'s own stated commitment) — this track does not need its own separate
  follow-up design pass to close this gap; whoever revisits the baseline for one purpose can revisit
  it for both in the same pass.

**Negative**

- Both the "unusually long" UI hint (1.5x) and the "possibly stuck" notification (2x) are
  analyst-estimated priors with no empirical grounding — false positives (flagging a genuinely
  ordinary long DELIVER wave as stuck) and false negatives (a short wave stuck for under 2x its
  baseline going undetected) are both realistic outcomes of this provisional heuristic. This is
  named plainly as the honest cost of shipping something now rather than waiting for data that does
  not exist, not hidden in the acceptance criteria language.
- If `progress-trust-ux`'s own baseline table is ever revised, this track's threshold must be
  revised in lockstep (same source values, different multiplier) — a small coordination cost
  between two tracks' provisional heuristics, accepted because duplicating a second independent
  baseline table would be worse (two numbers to keep consistent instead of one multiplier to keep
  in sync).

## Enforcement

No new structural rule beyond existing module-boundary rules. The Stuck-Run Detector must import
`Run Activity Deriver` from its existing shared-package location
(`packages/schemas/src/run-activity.ts`) rather than reimplementing staleness computation locally —
this is a natural dependency-cruiser assertion (only one module in the codebase may define
staleness logic; every consumer imports it) recommended as an addition to the shared config.
