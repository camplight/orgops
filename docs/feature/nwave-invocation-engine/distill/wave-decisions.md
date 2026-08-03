# Wave Decisions: nWave Invocation Engine Track — DISTILL Wave

## Interaction Mode

**Propose mode**, same as DESIGN. No interactive access to the human product owner in this
session (async subagent invocation). This document presents the decisions made, with
trade-offs, rather than a question log. Anything genuinely requiring human sign-off is flagged
explicitly below, not silently defaulted.

## Prior-Wave Reconciliation Gate

Read in full before writing any scenario, per the port-to-port principle:

- `docs/product/journeys/nwave-ticket-execution-engine-visual.md` / `.yaml` (umbrella journey;
  this track implements Step 3 "Implementation Triggered")
- `docs/product/architecture/brief.md` → `## Application Architecture` (lines 1-380, the
  nwave-invocation-engine section in full: Quality Attribute Priorities, Component Architecture,
  C4 L1/L2/L3, Data Model, Failure/Timeout Handling table, Extension Points, Architecture
  Enforcement, External Integrations)
- `docs/product/architecture/adr-0001-nwave-invocation-mechanism.md`,
  `adr-0002-wave-boundary-process-chaining.md` (both directly govern this track)
- `docs/product/jobs.yaml` (JTBD context)
- `docs/feature/nwave-invocation-engine/discuss/user-stories.md`, `dor-validation.md`,
  `wave-decisions.md`, `README.md`
- `docs/feature/nwave-invocation-engine/design/wave-decisions.md`
- No `docs/feature/nwave-invocation-engine/devops/` exists (soft gate: default environment
  matrix `clean | with-pre-commit | with-stale-config` applied, logged, not blocking)
- No `docs/feature/nwave-invocation-engine/spike/` exists — the headless-invocation SPIKE was
  explicitly skipped per user directive; headless feasibility remains an **accepted working
  assumption, not a validated fact** (Decision 1, inherited in full through DISCUSS → DESIGN →
  this DISTILL pass)
- No `docs/product/kpi-contracts.yaml` exists anywhere in this repo (soft gate, warned, proceeded
  — a repo-wide gap, not specific to this feature; US-04's own Outcome KPIs in `user-stories.md`
  are used as the closest available signal instead)
- Grounding code read directly: `apps/agent-runner/src/intent-watchdog.ts`, `channel-loop.ts`,
  `event-routing.ts`, `wrapper-harness/command.ts`, `tools/shell.ts`,
  `apps/api/src/routes/runtime.ts` (the `processes`/`process_output`/`reconcile` substrate),
  `apps/api/src/routes/access.ts`

**Reconciliation passed — 0 contradictions.** DESIGN's mechanism choice (ADR-0001's
`shell_start` primitive, ADR-0002's one-process-per-wave chaining) is fully consistent with
DISCUSS's "observable contract only" constraint: US-04's four UAT scenarios and five ACs
reference only a run starting, having a stable id, emitting wave-progress signal, and
communicating start failure clearly — never a specific mechanism. DESIGN's five components
(Restatement Composer, Confirmation Gate, Wave Runner, Wave Progress Translator, Run Watchdog)
map cleanly onto every AC (brief.md's own "Quality Gate Self-Check" already confirms this
per-component AC traceability; this DISTILL pass independently re-verified it against the raw
AC text, not merely trusting that checklist). No AC references a mechanism absent from DESIGN;
no DESIGN component lacks a traceable AC.

## Codebase Reality Check (not itself a contradiction, load-bearing for scaffold placement)

This track has not reached DELIVER in this codebase: `apps/agent-runner/src/nwave-invocation/`
did not exist before this pass; `packages/db/src/schema.ts` had no `nwave_runs`/`nwave_run_waves`
tables (confirmed by grep before writing this pass — only `nwave_run_stuck_flags`, owned by the
sibling `multi-source-ingestion-governance` track, existed). That sibling track, however, *has*
progressed partway into DELIVER (per its own commit history) and already created a
**prerequisite-only scaffold** for `apps/api/src/routes/nwave-runs.ts` (seven
completion-summary/retry/escalate/close/cycle-history handlers it owns, explicitly documented in
its own file doc comment as "neither track has reached DELIVER... created here only so
[that track's] acceptance tests have a real HTTP driving port to call"). This DISTILL pass
**extends that same file** with the six base routes this track actually owns
(`POST /api/nwave-runs`, `.../confirm`, `.../waves`, `.../waves/:waveId/complete`, `.../halt`,
`GET /api/nwave-runs/:id`) rather than duplicating a second route file, and updates the file's
doc comment and `apps/api/src/app.ts`'s registration comment to reflect the corrected ownership
now that this track has reached DISTILL. The sibling track's own seven handlers were left
untouched (out of this track's scope).

## DWD-01: Walking-Skeleton Strategy — Strategy B (Real Local + Fake Costly)

**Auto-detected per the task's own resource classification, not decided interactively with the
human this session — flagged for explicit human confirmation below.**

Resource classification for this track's driven ports:

- **`shell_start`/`shell_stop` async process primitive** (`apps/agent-runner/src/tools/
  shell.ts`) — a **local resource** (spawns a real OS process on the same host). Per Strategy B,
  local resources should be real in the walking skeleton, not faked, to prove genuine wiring
  (Dimension 9d's litmus test: "if I deleted the real adapter, would this WS still pass?").
- **`HttpRunRepository` / SQLite via `@orgops/db`** — also a **local resource** (in-memory
  SQLite + real Hono API app, the same substrate `apps/api/src/app.test.ts` and the sibling
  track's own acceptance tests already use). Real in the walking skeleton.
- **Restatement Composer's `generate()` LLM call** (`@orgops/llm`, the Anthropic API) — a
  **costly, external, non-deterministic dependency**. Faked in every scenario via an injected
  `GenerateFn` test double, per Strategy B's "fake costly" half.
- **The actual nWave CLI invocation** (`claude -p ...`, the command string `shellStart` would
  spawn in production) — this is a *third*, distinct category: not a plain local resource in the
  same sense as a throwaway subprocess. Spawning the real nWave CLI recursively from within an
  acceptance test would be multi-hour, non-deterministic, require live credentials, and — most
  importantly — would recursively invoke this same agent, which is unsafe and not something an
  acceptance-test walking skeleton should ever do. This is deliberately **not** what "real
  `shell_start`" means in this track's walking skeleton.

**Decision**: Strategy B, with a refinement specific to this track's highest-risk boundary — the
walking skeleton's "real" `shell_start` proof spawns a **trivial, near-instantaneous, genuinely
real local OS process** (e.g. `echo "invoking DISCUSS for TICKET-1043"`), not the actual nWave
CLI. This proves the real `shell_start`-shaped wiring (real `spawn`, a real process lifecycle,
the shape a production `ShellStart` adapter would use) without the cost/recursion/non-determinism
risk of a real nWave invocation. The nWave CLI's own invocation contract (flags, exit codes,
structured output format) — already named by brief.md as "the single highest-risk boundary in
this design" — is covered separately by a dedicated `@requires_external` CLI contract smoke test
(gated on a local fixture, skipped by default), mirroring exactly the pattern
`multi-source-ingestion-governance`'s own Trello CLI contract test already established in this
codebase, and matching brief.md's own explicit recommendation under "External Integrations
Requiring Contract Awareness."

**Flagged for human confirmation**: whether "a trivial real subprocess proves shell_start wiring
well enough" is the right line to draw, versus fully faking `shell_start` in the walking skeleton
and relying solely on the `@requires_external` contract test for real-process proof. This
DISTILL pass's judgment is that a trivial real spawn is strictly more honest about wiring
(Dimension 9d) at negligible cost/risk, and is not the same claim as "the nWave CLI itself
works" — but this is a genuinely debatable design choice given ADR-0001/Decision 1's explicit
framing of the CLI invocation as still-unvalidated, and the human product owner should confirm
or override it before DELIVER treats it as settled.

## DWD-02: Driving-Port Shape for Acceptance Tests

Following the same precedent `multi-source-ingestion-governance` already established in this
exact codebase (its poller/evaluator/advisor components are tested via their own exported
processing function, not via HTTP for every scenario): this track's acceptance tests invoke each
of the five components' own exported entry function directly
(`composeRestatement`, `evaluateConfirmationResponse`, `triggerRunForConfirmedIntent`,
`advanceToNextWave`, `deriveWaveProgressEvents`, `collectStaleWaves`) as the driving port for
scenarios exercising that component's own logic, and the real Hono app (`app.request(...)`) for
scenarios proving the HTTP/API layer itself (`@driving_adapter` scenarios). This mirrors
`intent-watchdog.ts`'s own directly-called-function shape (no event-bus subscription inside the
tested unit) exactly, per DESIGN's explicit instruction to mirror that file's pattern.

## DWD-03: Ticket-Classification Precondition Handled as Synthetic Event Data, Not a Scaffold

US-04's precondition (`ticket.classification.confirmed`, per brief.md's "Observable Contract for
nwave-invocation-engine") is data on the existing channel-scoped event bus, not a route or table
owned by `ticket-classification`. No prerequisite scaffold was needed for it (unlike the sibling
track's `tickets.ts`/`nwave-runs.ts` scaffolds, which stand in for actual HTTP routes) — every
scenario constructs the documented payload shape (`{ ticketId, channelId, rationale }`) directly
as a synthetic event object, avoiding any cross-track import (which `.dependency-cruiser.cjs`'s
"no-ticket-classification-into-nwave-invocation..." rule would in any case forbid in the other
direction, and which this track has no need to violate in this direction either).

## Adapter Coverage Table

| Adapter | `@real-io` scenario? | `@in-memory` scenario? | Notes |
|---|---|---|---|
| `shell_start` (via injected `ShellStart`) | Yes — every walking-skeleton/Wave-Runner scenario uses `createRealShellStart()`, a genuine `node:child_process.spawn` of a trivial command | Only the one designated failure-simulation double (`createFailingRealShellStart`, itself still a real spawn attempt against a nonexistent binary — a real OS-level failure, not a hand-authored fake error) | Local resource; real per Strategy B |
| `RunRepositoryPort` / `HttpRunRepository` | Yes — every scenario wraps the real Hono app via `apiFetchAsRunner`/`authedRequest` | No | Local resource; real per Strategy B, matches `apps/api/src/app.test.ts`'s existing convention |
| SQLite (`@orgops/db`) | Yes — every test's `createRealApiApp` uses real `openDb(":memory:")` + `migrate(db)` | No | Local resource; real per Strategy B |
| HTTP (Hono `app.request`) | Yes — every `@driving_adapter` scenario | No | In-process HTTP, real routing/middleware/serialization |
| Restatement Composer's `generate()` (LLM) | `@requires_external` contract test not applicable here (composer calls `@orgops/llm` directly, already used elsewhere; no separate contract-test recommendation exists for it in brief.md, unlike the CLI invocation) | Yes — every scenario uses a fake `GenerateFn` | Costly external dependency; faked per Strategy B |
| nWave CLI headless invocation (the command `shellStart` would spawn in production) | `@requires_external` contract test only, skipped by default (no fixture in this environment) | N/A | Brief.md's own named highest-risk boundary; not exercised by the trivial-subprocess walking skeleton, deliberately (see DWD-01) |

Audit: every driven adapter named in brief.md's Component Architecture has at least one
`@real-io` scenario except the Restatement Composer's LLM call and the nWave CLI's own
invocation contract — both explicitly designated as the "costly" half of Strategy B, with the
CLI invocation additionally covered by the gated `@requires_external` contract test brief.md
itself recommends.

## Risks Carried Forward (Restated, Not Resolved by This Pass)

- **Decision 1 (headless nWave invocation feasibility)** remains unvalidated by this DISTILL
  pass, exactly as DESIGN stated it would remain unvalidated by DESIGN. This pass's walking
  skeleton deliberately does not attempt to validate it (see DWD-01) — the first real DELIVER-wave
  implementation attempt against a real ticket is still what proves or disproves it.
- The "median time from confirmation to run start < 2 minutes" Outcome KPI (US-04) has no
  defensible baseline yet and is not asserted by any scenario in this pass — consistent with
  DISCUSS/DESIGN's own framing that this target is "to be refined," not committed.
