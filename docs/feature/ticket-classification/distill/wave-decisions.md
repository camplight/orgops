# Wave Decisions: Ticket Classification Track — DISTILL Wave

## Prior-Wave Reconciliation Gate

Read in full before writing any scenario, per the port-to-port principle:

- `docs/product/architecture/brief.md` -> `## Ticket Classification` (full section: Scope,
  Quality Attribute Priorities, Constraints, Development Paradigm, Architecture Style, Component
  Architecture, Observable Contract, C4 L1/L2/L3, Data Model, Reconciliation, Changed
  Assumptions, Access Control, Failure/Timeout Handling, Extension Points, Architecture
  Enforcement, External Integrations, Quality Gate Self-Check). No literal `## For Acceptance
  Designer` heading exists anywhere in `brief.md` (grepped, zero matches) — graceful-degradation
  note, not a blocking gap: driving ports, component boundaries, and adapter list were derived
  directly from `## Ticket Classification`'s own Component Architecture / Data Model / C4
  sections instead, which is where every other track's equivalent detail already lives too.
- `docs/product/architecture/adr-0003-ticket-classification-data-model.md` (tickets +
  ticket_classification_audit, current-state-plus-append-only-audit-log rationale)
- `docs/product/architecture/adr-0004-classification-decoupled-from-intake.md`
  (`ticket.created`, source-agnostic trigger)
- `docs/product/architecture/adr-0009-trello-tickets-row-resolves-blocking-dependency.md`
  (Trello-sourced tickets reuse `POST /api/tickets`; `(source, source_ref)` uniqueness)
- `docs/product/journeys/nwave-ticket-execution-engine.yaml` — no dedicated
  `ticket-classification` journey file exists (confirmed: only
  `nwave-ticket-execution-engine.yaml`/`.md` present under `docs/product/journeys/`). Graceful-
  degradation note per methodology: derived scenarios from DISCUSS `user-stories.md`'s own UAT
  Gherkin (already BDD-shaped, US-01/US-02/US-03, 4/5/4 scenarios respectively) plus DESIGN
  component boundaries instead of a journey file. This is expected — the umbrella journey's own
  `steps_summary` (Submit Ticket / Classification Result Returned / ...) maps to this track's
  scope at the journey-step level, not scenario level; no `failure_modes` per step are recorded
  there for this granularity, so failure-path scenarios below are derived from brief.md's own
  Failure/Timeout Handling table instead (a structural source, not inferred).
- `docs/feature/ticket-classification/discuss/user-stories.md`, `dor-validation.md`,
  `wave-decisions.md`
- `docs/feature/ticket-classification/design/wave-decisions.md`
- No `docs/feature/ticket-classification/devops/` directory exists — default environment matrix
  applied (clean | with-pre-commit | with-stale-config), per graceful-degradation rules (soft
  gate, logged, not blocking) — matching the precedent already set by
  `multi-source-ingestion-governance/distill/wave-decisions.md`.
- No `docs/product/kpi-contracts.yaml` exists anywhere in this repo (soft gate, warned, proceeded
  — a repo-wide gap, not specific to this feature; confirmed by the same absence
  `multi-source-ingestion-governance`'s own DISTILL pass already logged).
- No SPIKE artifacts for this track — `dor-validation.md` confirms no SPIKE dependency ("none of
  its stories carry a SPIKE dependency or a confirmed-absent-infrastructure flag").

**Reconciliation passed — 0 contradictions between DISCUSS and DESIGN.** Cross-checked
independently: US-01/US-02/US-03's DISCUSS-wave UAT scenarios and ACs (4/5/4 respectively) map
cleanly onto DESIGN's Component Architecture (Ticket Intake; Classifier + Classification
Orchestrator; Override/Audit Handler). No AC references a component absent from DESIGN; no
DESIGN component lacks a traceable AC. DESIGN's own peer review
(`nw-solution-architect-reviewer`, haiku, conditionally approved, 0 critical / 3 high / 2 medium)
was already remediated in full before this DISTILL pass began (observability substrate,
`tickets.id` format fixed as `TICKET-{n}`, accuracy-measurement strategy, override-redelivery
idempotency, Trello blocking-dependency severity — see `design/wave-decisions.md` "Peer Review").

## Codebase Reality Check (load-bearing for DISTILL's scaffold placement, not itself a
contradiction)

`nwave-invocation-engine` has already reached DELIVER in this codebase for its own base scope:
`apps/api/src/routes/nwave-runs.ts`'s core routes (`createRun`/`confirmRun`/wave lifecycle/
`halt`/`GET`) are real, not scaffolds; `nwave_runs`/`nwave_run_waves` exist for real in
`packages/db/src/schema.ts` (migration `028_nwave_invocation_engine.sql`); its own
`apps/agent-runner/src/nwave-invocation/types.ts` already declares
`TicketClassificationConfirmedPayload = { ticketId, channelId, rationale }` as the contract it
expects this track to emit — matching brief.md's "Observable Contract" section exactly, so no
adjustment was needed there. `apps/api/src/routes/tickets.ts` existed only as a minimal
PREREQUISITE SCAFFOLD (one throwing `POST /api/tickets` handler, `multi-source-ingestion-
governance`'s DISTILL pass, `distill/wave-decisions.md` DWD-02) — this DISTILL pass replaces it
with `ticket-classification`'s own full RED scaffold (all seven routes from brief.md's Data
Model, still throwing; see DWD-02 below). `.dependency-cruiser.cjs` already encodes this track's
two module-boundary rules (`no-ticket-classification-into-nwave-invocation-or-wrapper-harness`,
`no-ticket-classification-into-native-form-routes`) from an earlier DEVOPS pass — confirms the
exact module path this DISTILL pass needed
(`apps/agent-runner/src/ticket-classification/**`) was not a guess.

## DWD-01: Walking-Skeleton Strategy — Strategy B (Real Local + Fake Costly)

**Auto-detected during the DISTILL agent pass, human-confirmed afterward** (agent interactivity
constraint meant the auto-detection ran first; the orchestrator then presented it to the human
for confirmation before commit, per the same gate `multi-source-ingestion-governance`'s own
DWD-01 went through interactively during its own DISTILL pass). This
track's component shapes are structurally identical to both already-confirmed sibling tracks
(LLM-backed decision component mirroring the Restatement Composer; deterministic orchestration
mirroring Confirmation Gate/Wave Runner; HTTP routes mirroring `nwave-runs.ts`), which is the
basis for this auto-detection rather than a guess:

- **Real** (`@real-io`): SQLite via `@orgops/db`'s `openDb(":memory:")` + `migrate(db)`, and the
  real Hono API app via `createApp` from `@orgops/api/src/app` — driven through
  `app.request(...)`/`authedRequest`, exactly matching both sibling tracks' own
  `acceptance-test-support.ts` convention.
- **Fake** (`@in-memory`): the Classifier's `generate()` LLM call — a costly external
  dependency, faked via an injected `GenerateFn` test double in every scenario, mirroring
  `nwave-invocation`'s Restatement Composer exactly.
- **No `@requires_external` scenario for this track.** Unlike `multi-source-ingestion-
  governance`'s Trello CLI, the LLM call here is not a new external contract — brief.md's own
  "External Integrations Requiring Contract Awareness" section for this track states explicitly
  it inherits the sibling tracks' existing `generate()` annotation and recommends no new
  contract test. No fixture-gated scenario was added on this basis (not an oversight).

## DWD-02: RED Scaffold Placement (Mandate 7)

Two categories, kept explicitly distinct in every file's own doc comment, mirroring `multi-
source-ingestion-governance`'s DWD-02 precedent:

1. **Owned by this track, real DESIGN content (RED per Mandate 7 — modules exist, compile,
   throw or call through to something that throws):**
   - `apps/api/src/routes/tickets.ts` — rewritten from a one-route prerequisite scaffold into
     the full seven-route contract from brief.md's Data Model (all still throwing).
   - `apps/api/src/routes/access.ts` — added `canOverrideClassification` (throwing stub;
     `canSignOffGuardrail`, already present, explicitly names this function as the idiom it will
     reuse once implemented).
   - `packages/db/src/schema.ts` + `packages/db/migrations/029_ticket_classification.sql` —
     `tickets` (with the `(source, source_ref)` unique index ADR-0009 requires) and
     `ticket_classification_audit`, following the existing migration-file numbering convention
     (`028` was the last, owned by `nwave-invocation-engine`).
   - `apps/agent-runner/src/ticket-classification/{types,ticket-repository-port}.ts` —
     `__SCAFFOLD__ = true` contract-defining files, mirroring the sibling tracks' own convention
     (types/port files are marked scaffold; concrete adapter/logic files are not, since their
     wiring code is real even though the routes underneath still throw).
   - `apps/agent-runner/src/ticket-classification/{http-ticket-repository,classifier,
     classification-orchestrator}.ts` — real wiring/orchestration/parsing logic (not marked
     scaffold), calling through to the still-throwing routes above — this is what makes the
     enabled walking-skeleton scenario fail with a genuine business-logic-shaped RED (a 500 from
     `POST /api/tickets`'s "not implemented" throw, caught by Hono's `onError` handler) rather
     than an import or wiring error. Verified directly: `npx vitest run
     apps/agent-runner/src/ticket-classification/ticket-classification.test.ts` -> 1 failed
     (`expected 500 to be 201`), 19 skipped, 0 passed.
2. **No prerequisite scaffold needed for any other track.** This track has no upstream
   dependency (`discuss/wave-decisions.md`: "Upstream: None... the entry point of the journey").

## DWD-03: Override Driving-Port Interpretation (DESIGN-internal nuance, not a DISCUSS/DESIGN
contradiction — resolved here, not escalated)

Brief.md's Component Architecture describes the "Override/Audit Handler" as living in
`apps/agent-runner/src/ticket-classification/`, "event-consuming... same injected-stream shape
as the Orchestrator." Its own Data Model section, describing `POST /api/tickets/:id/override`,
says the route itself "validates `canOverrideClassification`; appends audit row, posts channel
message, gates `ticket.classification.confirmed`" — with no "(called by HttpTicketRepository)"
annotation (unlike the `/classification` and `/classification/failed` routes, which explicitly
carry that annotation). Access Control further fixes `canOverrideClassification(user, ticket)`
inside `apps/api/src/routes/access.ts` — the API container, which has the authenticated human's
session; `agent-runner` never has human session context (it authenticates server-to-server via
the runner token only). Given access control fundamentally requires the HTTP request's session,
this DISTILL pass treats **`POST /api/tickets/:id/override` as the real driving port** for every
US-03 override scenario, doing the full authorize-write-audit-message-gate sequence server-side
— not a channel-watching agent-runner component. This is a DISTILL-time component-boundary
mapping decision (explicitly within acceptance-designer's own "map scenarios to component
boundaries" remit), not a DISCUSS-vs-DESIGN contradiction requiring escalation. Mirrors `multi-
source-ingestion-governance`'s own DWD-03 precedent (a similarly justified, logged
simplification, not a silent guess). **Human-confirmed after the DISTILL pass, before commit.**

## Adapter Coverage Table

| Adapter | `@real-io` scenario? | `@in-memory` scenario? | Notes |
|---|---|---|---|
| `TicketRepositoryPort` / `HttpTicketRepository` | Yes — every `@driving_port` scenario drives through it indirectly via the real HTTP routes | Yes — one dedicated `@infrastructure-failure` scenario injects a failing `apiFetch` directly against the adapter | Real local adapter (not costly); never faked in the acceptance-flow scenarios, only in the dedicated failure-injection unit-style check per Mandate 4 |
| Classifier / `generate()` (LLM) | No (Strategy B: costly, always faked) | Yes — every scenario that invokes `classifyWithFakeLlm` (11 of 20) | Costly external dependency, faked per DWD-01; not a new contract per brief.md, no `@requires_external` scenario needed |
| SQLite (`@orgops/db`) | Yes — every scenario's `createRealApiApp()` uses real `openDb(":memory:")` + `migrate(db)` | No | Matches both sibling tracks' convention exactly |
| HTTP (Hono `app.request`) | Yes — every `@driving_port` scenario | No | In-process HTTP, real routing/middleware/serialization, no network socket needed |

Audit: every driven adapter named in brief.md's Component Architecture for this track has at
least one `@real-io` scenario, except the Classifier's `generate()` call — the single adapter
Strategy B explicitly designates as faked (consistent with both sibling tracks' own audit
conclusions for their own costly external dependency).

## Verification Performed This Pass

- `npx tsc --noEmit -p apps/agent-runner/tsconfig.json` — zero new errors (one pre-existing,
  unrelated `runner.ts` error confirmed present on the unmodified branch via `git stash`).
- `npx tsc --noEmit -p apps/api/tsconfig.json` — clean.
- `npx tsc --noEmit -p packages/db/tsconfig.json` — clean.
- `npx vitest run apps/api apps/agent-runner/src/nwave-invocation
  apps/agent-runner/src/multi-source-ingestion-governance` — 91 passed, 1 failed; the failure
  (`app.test.ts` "lists TypeScript event shape definitions from core and skills") reproduces
  identically with this pass's changes stashed out, confirming it is pre-existing and unrelated.
- `npx vitest run packages/db/src/index.test.ts` — passes; migration `029` applies cleanly
  alongside all prior migrations, `tickets`/`ticket_classification_audit` tables created.
- `npx vitest run apps/agent-runner/src/ticket-classification/ticket-classification.test.ts` —
  1 failed (the enabled walking skeleton, `expected 500 to be 201` — a genuine business-logic
  RED), 19 skipped, 0 passed. Matches Phase 3's "first scenario executable, fails for a business
  logic reason" gate.
