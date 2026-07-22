# Wave Decisions: nWave Invocation Engine Track — DESIGN Wave

## Interaction Mode

**Propose mode.** No interactive access to the human product owner in this session (async
delegation). This document presents the decisions made, with trade-offs, rather than a
question log. Where a decision genuinely requires human confirmation, it is explicitly flagged
below rather than treated as final.

## Key Decisions

1. **Invocation mechanism**: use the existing `shell_start`/`shell_stop`/`shell_status`/
   `shell_tail` async process primitive as the execution substrate, driven by a new
   deterministic orchestration module in `apps/agent-runner/src/nwave-invocation/` — not the
   `WRAPPED` `command` harness, not a new harness type. See
   `docs/product/architecture/adr-0001-nwave-invocation-mechanism.md`.
2. **Wave-boundary process chaining**: one OS process per nWave wave, chained sequentially by
   the orchestrator on clean exit. This is what produces wave-progress signal, and defines the
   safe-checkpoint granularity for future halt/pause (US-09). See
   `docs/product/architecture/adr-0002-wave-boundary-process-chaining.md`.
3. **New data model**: `nwave_runs` (aggregate root) and `nwave_run_waves` (entity) tables,
   distinct from `processes` (one run maps to many wave processes over its lifetime). Full
   shape in `docs/product/architecture/brief.md` under "Data Model."
4. **Architecture style**: modular monolith with local ports-and-adapters
   (`RunRepositoryPort`/`HttpRunRepository`), applied only to the new module — no change to
   OrgOps' overall single-process deployment shape, and no extension of the existing
   `wrapper-harness/` abstraction.
5. **Development paradigm — recommended, pending human confirmation** (see below).

## Architecture Summary

Five new deterministic (non-LLM-turn) components inside `agent-runner`: Restatement Composer
(LLM-backed), Confirmation Gate, Wave Runner (Orchestrator), Wave Progress Translator, Run
Watchdog. Two new DB tables. Six new API routes under `/api/nwave-runs*`. Reuses the existing
event bus, WebSocket topic pub/sub, and `processes`/`process_output` streaming substrate
without modification. Full detail, C4 diagrams (L1/L2/L3), failure-handling table, and
extension points (mid-run input, mid-wave halt — both explicitly not foreclosed) are in
`docs/product/architecture/brief.md`.

## Technology Stack

No new runtime dependencies. Recommended new dev-tooling dependency: `dependency-cruiser`
(MIT license) for architecture-rule enforcement — not yet configured anywhere in this repo;
flagged for `platform-architect`/`software-crafter` to wire into CI, not added in this design
pass.

## Development Paradigm — CONFIRMED by Human Product Owner

**Confirmed: functional-leaning TypeScript**, matching the existing convention already
observed in `apps/agent-runner/src/intent-watchdog.ts`, `channel-loop.ts`, and
`event-routing.ts` (no classes; pure functions taking explicit state as parameters; factory
functions returning closures instead of classes with methods; composed small predicate
functions). The new `nwave-invocation` module's pure state-transition logic (wave status
transitions, watchdog due-timeout detection) should mirror `intent-watchdog.ts`'s
`ingest*`/`collectDue*` pattern exactly, with a thin adapter layer isolating all I/O.

The human product owner confirmed this recommendation. It has been written to the project root
`CLAUDE.md`: "This project follows the **functional programming** paradigm. Use
@nw-functional-software-crafter for implementation." DELIVER-wave implementation for this
track should be dispatched to `nw-functional-software-crafter`, not `nw-software-crafter`.

## Constraints Established

- New module must not import from `wrapper-harness/` (ADR-0001's deliberate non-extension
  boundary — enforced via `dependency-cruiser` rule, see brief.md "Architecture Enforcement").
- Pure logic modules must not perform I/O directly (`fetch`/`apiFetch`/`child_process`) — only
  the `HttpRunRepository` adapter may, preserving testability without spawning real processes.
- No stronger event-delivery guarantee than the platform's existing at-least-once semantics is
  introduced or required.
- `run_id` is created before the first wave process is spawned, so it remains stable and
  referenceable even in a start-failure scenario (US-04 AC4/AC5 together).

## Headless Invocation Feasibility — Still Unvalidated (Restated)

**This design accounts for the shape of the mechanism; it does not validate that nWave can
actually be invoked headlessly by the `claude` CLI's non-interactive mode as assumed.** The
DISCUSS-wave SPIKE that would have tested this was explicitly skipped per user directive
("I'm confident that the nwave integration can run headlessly"). This DESIGN pass treats that
as an accepted working assumption and designs the surrounding orchestration, data model, and
failure handling so that if the assumption turns out wrong (wrong CLI flags, no
non-interactive mode, different output format than assumed, etc.), the blast radius is
contained to the `nwave-invocation` module and the exact command string the `Wave Runner`
spawns — not to any shared abstraction (`wrapper-harness/`) or to the data model
(`nwave_runs`/`nwave_run_waves` shapes do not depend on the exact CLI contract). **The first
real implementation attempt against a real ticket is what actually proves or disproves
feasibility — not this design pass.** If DELIVER encounters friction, Decision 1 from the
umbrella `wave-decisions.md` should be the first thing revisited, exactly as DISCUSS
instructed.

## Upstream Changes

None required. This track has no blocking upstream dependency (confirmed by DISCUSS); this
DESIGN pass introduces no new upstream dependency either — the walking skeleton can still be
built and demoed against a stubbed/manual classification result per the umbrella
`story-map.md`.

## Peer Review

See report to parent agent for outcome (invoked `nw-solution-architect-reviewer`, haiku,
single pass per `.nwave/des-config.json`).
