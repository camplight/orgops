# ADR-0006: Pause/Halt Only Takes Effect at the Next Wave Boundary; the Running Wave Is Never Signaled

## Status

Accepted.

## Context

US-09 requires Pause and Halt controls with a **zero-tolerance** reliability NFR: "Halt/pause
requests must never corrupt in-progress artifact state — zero tolerance, not a percentage
target." At the same time, the story's own Problem statement wants a genuine ability to stop a
run that is "clearly heading the wrong direction" without burning further time.

ADR-0002 (`nwave-invocation-engine`) already established that one nWave run is a sequence of
separate OS processes, one per wave, chained on clean exit — and that wave completion is the
only structurally guaranteed safe checkpoint; no nWave-side mid-wave checkpointing capability
exists. This track inherits that constraint; it does not get to assume finer granularity than
the mechanism `nwave-invocation-engine` actually built.

This forces a direct trade-off between halt/pause **latency** (how quickly a request takes
effect) and halt/pause **safety** (whether it can ever corrupt in-progress work), and the NFR is
explicit that safety is non-negotiable while latency is not.

## Decision

Pause and Halt requests are recorded immediately (`nwave_run_controls.pending_control`) and
acknowledged immediately, but **take effect only when the currently running wave's process exits
on its own** — at the Wave Runner's existing next-wave-spawn decision point (ADR-0002's
already-guaranteed checkpoint). **The currently running wave process is never signaled** by this
design — no `shell_stop`/`SIGTERM` is ever sent to an in-progress wave as part of Pause or Halt.
The Wave Runner simply does not spawn the next wave when `pending_control` is set.

The realistic worst-case latency is therefore **up to the remainder of the currently running
wave** — potentially tens of minutes for a long DESIGN or DELIVER wave. This is stated
plainly as the honest granularity this mechanism provides, not assumed away or rounded down to
"near-instant."

## Alternatives Considered

### 1. Send `SIGTERM` (via the existing `shell_stop` tool) to the current wave's process immediately on Halt

**Rejected.** `shell_stop` sends `SIGTERM` to whatever the wave's nWave process happens to be
doing at that instant — there is no defined safe point in the middle of, say, a DELIVER wave's
file-write or git-commit sequence. This directly risks corrupting in-progress artifact state,
which the NFR treats as zero-tolerance, not a percentage. Domain Example #3 in US-09 ("Halt while
mid-write to a file... system waits for the current safe checkpoint rather than corrupting
partial output") explicitly describes the failure mode this alternative would risk.

### 2. Wait for nWave to expose a mid-wave checkpointing capability, then build against it

**Rejected for this release.** No such capability exists today, and there is no committed
timeline for nWave itself to add one. Blocking US-09 entirely on an unscheduled upstream
capability would mean shipping no pause/halt control at all, which fails the story outright. Not
foreclosed as a future enhancement — if nWave ever exposes finer-grained checkpointing, this
mechanism can adopt it without changing the `pending_control` contract, only its trigger
granularity.

### 3. Wave-boundary-only checkpoint; never signal the running process (chosen)

**Accepted.** Zero risk of corrupting in-progress state, because the design never interrupts a
wave process mid-work — the only thing it ever does is decline to start the *next* one. This is
a stronger safety guarantee than "signal at a best-effort safe point," achieved by giving up
speed, which is exactly the trade-off the NFR demands (safety is zero-tolerance; latency is not).
Requires no new nWave-side capability — it reuses ADR-0002's existing guarantee unchanged.

## Consequences

**Positive**

- Meets the zero-tolerance corruption NFR by construction: there is no code path in this design
  that sends a stop signal to a running wave process.
- Requires no new capability from `nwave-invocation-engine` or nWave itself beyond the additive
  `pending_control` check already described as an Integration Point in `brief.md`.
- Resume is trivial and equally safe: clearing `pending_control` lets the Wave Runner spawn the
  next wave through its existing, unmodified logic — resuming is structurally identical to how
  the first wave already starts.
- Concurrent pause-request-plus-mid-run-note handling (a separate NFR) composes naturally with
  this mechanism: because Pause/Halt never touches the running process, there is no timing
  conflict between "stop the wave" and "let the note be acknowledged" — they are fully
  independent operations against independent state.

**Negative**

- Halt/pause latency can be as long as the remainder of the currently running wave — potentially
  tens of minutes. Submitters who need an *instant* stop (e.g., realizing the ticket itself was
  wrong) do not get one. This is named as a real, accepted limitation, not hidden in the
  acceptance criteria language ("next safe checkpoint" is honestly wave-boundary-sized, not
  sub-second).
- A submitter halting a long-running DELIVER wave may wait a long time before the halt visibly
  takes effect, which could itself read as "is this stuck?" — the same anxiety this whole track
  exists to resolve. **Mandatory mitigation, not optional polish**: the UI must render "Halt
  requested — will take effect when the current wave finishes" (or the Pause equivalent)
  immediately upon request, sourced from `nwave_run_controls.pending_control` being non-null,
  well before the checkpoint is actually reached. This is elevated to an explicit acceptance
  criterion for `acceptance-designer`'s DISTILL pass (see brief.md and this track's
  `design/wave-decisions.md`), not left as an implied nicety — an unresponsive-looking control
  during a multi-minute wait would recreate the exact anxiety this track exists to resolve.

## Enforcement

No new structural rule beyond existing module-boundary rules (see brief.md's Architecture
Enforcement). The one behavioral invariant this ADR depends on — "no code path in
`progress-trust-ux/**` calls `shell_stop`/sends a process signal" — is a natural fit for a
dependency-cruiser rule (`progress-trust-ux/**` must not import `node:child_process` or the
`shell_stop` tool definition) and is recommended as an explicit addition to the shared
dependency-cruiser config alongside this track's other rules.
