# ADR-0001: nWave Invocation Mechanism for the Invocation Engine Track

## Status

Accepted — with an explicit caveat: this decision selects the mechanism, but does not itself
validate headless nWave feasibility. That validation happens on first real implementation
(see `docs/feature/nwave-invocation-engine/discuss/wave-decisions.md` Decision 1 and this
track's `design/wave-decisions.md`).

## Context

US-04 requires OrgOps to trigger a headless nWave wave-pipeline run for a confirmed
development ticket, receive a stable `run_id`, and receive mid-run wave-progress signal — not
just a result at completion. The planned validation SPIKE for headless feasibility was
explicitly skipped per user directive; feasibility is an accepted working assumption, not an
empirically validated fact. DESIGN must still pick a concrete mechanism.

Two mechanisms exist today in `apps/agent-runner/src/` that are plausible substrates:

1. **`WRAPPED` agent `command` harness** (`apps/agent-runner/src/wrapper-harness/command.ts`).
   Its `runTurn` shells a command via `spawn`, buffers stdout/stderr in memory, and resolves
   only at process exit (or timeout). It has no mid-run streaming for `runTurn` itself — though
   the *same file* already implements a second, structurally different pattern for `sidecars`
   (`ensureSidecarStarted`) that spawns a long-running child, incrementally posts stdout/stderr
   chunks to `/api/processes/:id/output`, and registers the process in the `processes` table.
   That sidecar pattern is functionally identical to the `shell_start` primitive below — it is
   not a novel capability, it is a re-implementation of the same idea in a different file.

2. **`shell_start` / `shell_stop` / `shell_status` / `shell_tail`** tool primitive
   (`apps/agent-runner/src/tools/shell.ts`). Spawns a tracked async child process, persists it
   in the `processes` table, streams stdout/stderr chunks to the `process_output` table via
   `/api/processes/:id/output`, which in turn (`apps/api/src/routes/runtime.ts`) inserts a
   `process.output` domain event on the shared event bus *and* publishes to the
   `process:<processId>` WebSocket topic (`apps/api/src/app.ts`). `shell_stop` sends `SIGTERM`.
   `shell_status`/`shell_tail` read current state and output history. This is a fully built,
   tested, DB-backed, event-bus-integrated streaming substrate already used by the UI
   (`apps/ui/src/hooks/useWebSocket.ts` subscribes to `process:<processId>`).

A third candidate — invoking the `claude` CLI's non-interactive/print mode directly — is not a
separate architectural option; it is the *command string* that either substrate above would
spawn (`claude -p "/nw-design <feature>" --output-format=stream-json`, exact flags to be
confirmed on first real implementation attempt). It does not change which substrate hosts it.

## Decision

Use the **`shell_start`/`shell_stop`/`shell_status`/`shell_tail` async process primitive** as
the execution substrate for nWave wave invocations, driven by a new deterministic
(non-LLM-turn) orchestration module in `apps/agent-runner/src/nwave-invocation/` — not the
`WRAPPED` `command` harness, and not a new purpose-built harness type.

Each nWave wave (DISCUSS/DESIGN/DISTILL/DELIVER) is invoked as a **separate OS process**,
chained sequentially by the orchestration module once the prior wave's process exits 0. See
ADR-0002 for the wave-boundary chaining decision in detail.

## Alternatives Considered

### 1. Extend the `WRAPPED` `command` harness's `runTurn`

**Rejected.** `runTurn`'s blocking, single-shot, resolve-at-exit contract is the shared
abstraction every `WRAPPED` agent depends on for turn/reply semantics inside the channel loop
(`channel-loop.ts`, `event-routing.ts`). Retrofitting async, multi-hour, streaming behavior
into it changes a load-bearing shared interface used by other agents, for the benefit of one
integration whose feasibility is still unvalidated. It also duplicates work: the sidecar code
path in the same file already solved "long-running process with incremental output capture"
by essentially reimplementing `shell_start`'s registration/streaming logic in parallel. Two
independent implementations of the same capability is worse than one, regardless of which one
we'd pick.

### 2. New purpose-built `streaming-command` harness variant

**Rejected for this track (Release 0).** Formalizing a new async-turn contract in
`wrapper-harness/types.ts` and `registry.ts` would be the architecturally "correct" long-term
answer if multiple `WRAPPED` agents needed the same streaming capability — but today only this
one integration needs it, and the mechanism itself is unproven. Expanding the shared harness
abstraction before the approach is validated maximizes blast radius exactly when we most need
to keep it small (per Decision 1's "accepted working assumption, not fact" framing — the first
real implementation attempt is the actual test). Revisit if/when a second `WRAPPED` agent needs
mid-run streaming; at that point promoting the `shell_start` pattern into a formal harness
capability becomes justified by two real consumers, not speculative reuse.

### 3. `shell_start`/`shell_stop`/`shell_status`/`shell_tail` primitive (chosen)

**Accepted.** Reuses a fully built, tested, already-integrated substrate (DB tables, event
bus, WebSocket topic, existing UI hooks) with **zero changes to any shared abstraction**. Every
consumer this track's downstream tracks need (`progress-trust-ux`'s `last_activity_at`,
per the umbrella `shared-artifacts-registry.md`, is explicitly documented as "leverages
OrgOps' existing `processes`/`process_output` tables and `process:<processId>` WebSocket
topic") already expects this substrate. Lowest blast radius, fastest to build, cheapest to
revert if the first real implementation attempt reveals the assumption was wrong.

## Consequences

**Positive**

- No changes required to `wrapper-harness/` — the shared abstraction every other `WRAPPED`
  agent depends on is untouched.
- Streaming, persistence, and WebSocket delivery are already built, tested, and running in
  production for other uses (sidecars, `shell_run`/`shell_start` tool calls) — no new
  infrastructure risk.
- `progress-trust-ux`'s downstream `last_activity_at` artifact is satisfied by construction
  (it already targets this exact substrate).
- Cheap to abandon or replace if first-implementation feedback proves the assumption wrong —
  the blast radius is contained to the new `nwave-invocation` module and two new tables, not a
  shared harness contract.

**Negative**

- `shell_start`'s current `stdio` configuration ignores stdin (`stdio: ["ignore", "pipe",
  "pipe"]` in `tools/shell.ts`), so it does not support mid-run input today. This does not
  block US-04 (which does not require mid-run input) but must not be silently foreclosed for
  future US-08 — see the "Extension Points, Not Implemented" section of
  `docs/product/architecture/brief.md`.
- `shell_start` has no built-in idle/timeout detection (unlike `shell_run`'s `timeoutMs`). A
  new watchdog component is required (see brief.md, Run Watchdog) — this is new code, not
  reuse, and is the primary net-new implementation surface this decision creates.
- `run_id` is not the same identifier as `processId` (one run spans multiple wave processes),
  requiring new `nwave_runs`/`nwave_run_waves` tables rather than a bare read of the `processes`
  table. This is expected per the umbrella `shared-artifacts-registry.md`, which already flags
  `run_id` as a new domain concept with `processes.id` only as "the closest analog, not the
  same concept."

## Enforcement

Style: Modular monolith with dependency-inversion (ports-and-adapters) applied locally to the
new `nwave-invocation` module — see `docs/product/architecture/brief.md` "Architecture
Enforcement" section for the specific rule and tool (`dependency-cruiser`).
