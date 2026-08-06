# Wave Decisions: Progress & Trust UX Track — DESIGN Wave

## Mode and Scope

Interaction mode: **Propose** (per `/nw-design` Decision 1, confirmed by the human product
owner before this session). Scope: application/component-level design, same class as both prior
DESIGN passes on this project (`nwave-invocation-engine`, `ticket-classification`). This document
records the decisions made during this pass and explicitly carries forward the constraints the
task required not to be silently glossed over.

Full architecture output: `docs/product/architecture/brief.md` `## Progress & Trust UX` section.
ADRs: `docs/product/architecture/adr-0005-us10-notification-scope-deferred.md`,
`adr-0006-halt-pause-wave-boundary-checkpoint.md`,
`adr-0007-completion-summary-anchor-pending-deliver-contract.md`.

## Decisions Required to Be Carried Forward Explicitly

### 1. US-08's mid-run input delivery is a live, unresolved cross-track dependency

This design builds the **complete acknowledgment/tracking layer** for US-08 (Mid-Run Message
Handler, Conflict Assessor, `mid_run_message_acks` table, per-message idempotent acknowledgment
within 60 seconds, concurrent-message handling). It does **not** solve delivery of a note's
content into a *currently running* wave process — that capability does not exist anywhere in
`nwave-invocation-engine`'s design (`shell_start`'s stdio ignores stdin; no `shell_send_input`
tool or side-channel exists, per that track's own Extension Points).

One real, buildable exception is identified: a note arriving *before* the next wave's process is
spawned can be incorporated at spawn time, because ADR-0002 already composes each wave's
invocation fresh. This is implemented as an additive Integration Point on the sibling module's
Wave Runner (checking `mid_run_message_acks` at its existing next-wave-spawn decision point) —
not a workaround for the blocked mid-wave case, a genuinely different (narrower) capability.

**This is not this track's job to solve.** It is a cross-track dependency on
`nwave-invocation-engine` extending its mechanism (pipe stdin + `shell_send_input`, or a
side-channel), tracked here so it is not lost, and restated in `brief.md`'s Extension Points.

### 2. US-09's realistic halt/pause latency is "up to the remainder of the current wave," not instant

Per ADR-0006: because only a wave-boundary checkpoint is structurally guaranteed (ADR-0002), and
the zero-tolerance corruption NFR rules out signaling a running wave process at all, the design
**never sends a stop signal to the currently running wave**. Pause/Halt requests are acknowledged
immediately but only take effect when the current wave's process exits on its own. **Worst-case
latency is honestly stated as up to the remainder of the currently running wave** — potentially
tens of minutes for a long DESIGN or DELIVER wave — not assumed to be near-instant or
sub-minute. The UI must communicate this immediately upon request ("will take effect when the
current wave finishes") so the latency itself does not read as the run being stuck.

### 3. US-10 scope decision: out-of-band notification deferred; in-app half ships now

Per ADR-0005: notification/email infrastructure is confirmed absent from OrgOps (zero matches
for `notif`/`sendEmail`/`smtp` across the codebase, verified directly in this pass). This is
net-new infrastructure — provider selection, delivery reliability, opt-out/preferences — a
materially larger and differently-shaped effort than every other story in this release.

**Decision: recommend moving the out-of-band delivery half of US-10 out of Release 1 to a later
release (Release 2 recommended).** The in-app indication that a run is waiting on input ships
now, for free, as a byproduct of US-07's Wave Status Panel — but this does **not** satisfy
US-10's AC5 ("notification reaches the submitter through at least one channel outside the
OrgOps UI"), and this document does not claim it does. A `NotificationPort` interface is named
as a seam for the future adapter; no adapter, provider, or delivery mechanism is built now.

Separately, and independent of the notification-infrastructure gap: the *trigger* for US-10 (a
running wave signaling "I need input, pausing myself," distinct from failure) is not buildable
today either — see Decision 5 below. Even once a notification provider exists, there is currently
nothing for it to fire on.

**This scope call is presented as a firm recommendation with rationale (per Propose-mode
convention), not a silent decision** — the human product owner should confirm or override the
story-map placement change.

### 4. Completion-summary attachment point for `multi-source-ingestion-governance`'s future US-12

The new `nwave_run_completions` table (one row per completed/terminated run) is the explicit,
stable attachment point for US-12's future Approve/Request-Changes actions: that track's future
DESIGN pass should add an `approval_status` column (and any related audit fields) to this same
row and build its UI against the completion message this row already anchors — not invent a
second completion-tracking mechanism. This row's existence and shape are fixed now specifically
so US-12 has a defined seam whenever that track's DESIGN pass happens.

### 5. DELIVER-wave output format gap for US-06 — flagged, not invented

No defined contract exists today for how nWave's DELIVER wave would communicate branch/PR
references or scenario-pass/fail counts back to `agent-runner`. Per ADR-0007, this design does
**not** invent that contract. It ships a **degraded-but-honest** completion summary now
(states the run finished/failed/halted, links to raw output, states explicitly that detailed
change/scenario data is unavailable pending the contract) and defines the read-side port shape
(`CompletionArtifact`) the Composer needs, without mandating how nWave/`nwave-invocation-engine`
produce it.

**This is the same underlying limitation as two other gaps found in this pass** — see
`brief.md`'s "Cross-Cutting Gap: Wave Completion Signal Vocabulary." US-07's "skipped wave" AC
and US-10's "wave pauses itself" trigger both also need a richer wave-completion signal than
ADR-0002's binary exit-code contract provides. All three are named together as one
recommendation for a future DESIGN/DISTILL pass on `nwave-invocation-engine` (or nWave itself)
to resolve — not resolved unilaterally here, since it is outside this track's authority.

## Additional Notes

- Two additive proposals to already-written enums in `## Application Architecture` are made via
  the "Changed Assumptions" back-propagation pattern in `brief.md`, not silent edits:
  `nwave_runs.status` gains `PAUSED` (resumable, distinct from terminal `HALTED`);
  `nwave_run_waves.status` reserves `SKIPPED` (currently unreachable — see Decision 5 above).
- Access control for Pause/Halt (`canControlRun`) reuses the exact submitter/governance-team
  resolution path `ticket-classification` already established (`nwave_runs.ticket_ref →
  tickets.id → tickets.submitter_human_id`, plus the same governance `teams` membership) — no
  new RBAC concept, no new column needed on `nwave_runs`.
- Concurrency NFRs (concurrent messages both acknowledged; concurrent pause+note both honored)
  are satisfied structurally by having every new component batch-process the full new-event set
  each poll cycle (mirroring `intent-watchdog.ts`'s existing `ingestIntentEvents` shape) — never
  "latest wins" — rather than by any explicit locking mechanism.
- Quality attribute priority order for this pass: (1) reliability/data-integrity — zero
  tolerance on halt/pause corruption; (2) usability/accessibility — WCAG 2.2 AA, live-region
  announcements; (3) testability — pure-function batch-processing cores enabling synthetic
  concurrent-event unit tests. This differs from both prior passes' ranking (which did not
  elevate accessibility) because this track's components are almost entirely user-facing, unlike
  the invocation-engine and classification tracks.

## Peer Review

Reviewer: `nw-solution-architect-reviewer` (haiku model, per `.nwave/des-config.json`:
`review_enabled: true`, `double_review: false`, max 2 iterations).

**Outcome (iteration 1): `conditionally_approved`. 0 critical issues, 1 high issue, 1 medium
issue.**

Strengths noted: all three explicitly-required honesty checks passed (US-08 cross-track
dependency not silently assumed solved; US-09 latency stated as wave-remainder, not instant;
US-10 scope call justified with genuine alternatives and no overclaiming). ADR quality,
dependency-inversion compliance, and structural handling of the concurrency NFRs were all rated
positively. No architectural bias detected (no resume-driven development, no unjustified new
technology).

**High issue — remediated in this pass**: the Conflict Assessor's `completedWaveArtifactsSummary`
input was under-specified (no stated source or fallback). Fixed: `brief.md`'s Mid-Run Message
Handler component now specifies the source (each completed wave's own committed SSOT
artifacts, read from the workspace path already known to `agent-runner`, mirroring ADR-0002's
existing artifact-handoff assumption) and the fallback (no LLM call when no wave has completed
yet — deterministically `false`, not a meaningless prompt).

**Medium issue — remediated in this pass**: the Halt/Pause immediate-feedback UI requirement
("will take effect when the current wave finishes") was framed as an implied mitigation rather
than a mandatory acceptance criterion. Fixed: elevated to an explicit, mandatory requirement in
both `brief.md`'s US-09 component description and ADR-0006's Consequences, flagged for
`acceptance-designer` to carry into a formal AC during DISTILL.

No second review iteration was required — both findings were addressable without changing any
architectural decision, only clarifying/strengthening already-chosen designs.
