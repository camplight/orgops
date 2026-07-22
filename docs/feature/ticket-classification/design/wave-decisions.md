# Wave Decisions: Ticket Classification Track — DESIGN Wave

## Interaction Mode

**Propose mode.** No interactive access to the human product owner in this session (async
delegation), per explicit product-owner scope decision passed into this DESIGN wave. This
document presents the decisions made, with trade-offs, rather than a question log.

## Key Decisions

1. **Ticket intake vs. classification live in different containers.** Ticket intake (US-01) is
   a synchronous request/response concern, implemented directly in a new
   `apps/api/src/routes/tickets.ts` route file (matching the existing per-domain route-file
   convention). Classification (US-02/US-03) is the asynchronous, LLM-backed concern and lives
   in a new `apps/agent-runner/src/ticket-classification/` module, matching where the sibling
   `nwave-invocation-engine` track's own LLM-backed component (Restatement Composer) already
   lives. See `docs/product/architecture/brief.md` "Ticket Classification" → "Architecture
   Style."
2. **Classification is triggered by a generic, source-agnostic `ticket.created` event**, not a
   function call embedded in the native-form intake handler. This is the concrete mechanism
   that keeps the classification step reusable for a future non-native ingestion path (Trello,
   `multi-source-ingestion-governance` US-11) without that future track needing to modify this
   module at all. See `docs/product/architecture/adr-0004-classification-decoupled-from-intake.md`.
3. **Data model**: `tickets` (aggregate root, current state) and `ticket_classification_audit`
   (entity, append-only decision/override log) — distinct tables, not folded into the generic
   `events` table, specifically because `events` is bulk-deletable
   (`DELETE /api/events`) and a governance audit trail must not share fate with an unrelated
   cleanup action. See `docs/product/architecture/adr-0003-ticket-classification-data-model.md`.
4. **A single observable contract event, `ticket.classification.confirmed`**, is the only
   signal `nwave-invocation-engine` needs to subscribe to. It is emitted exactly once per
   ticket, gated identically whether `DEVELOPMENT_WORK` is reached via the initial Classifier
   decision or via a later override — the gating rule (which result values may unblock
   downstream implementation) lives in exactly one place, not duplicated into the downstream
   consumer. Full detail in brief.md "Observable Contract for `nwave-invocation-engine`."
5. **Architecture style**: modular monolith with local ports-and-adapters
   (`TicketRepositoryPort`/`HttpTicketRepository`), applied only to the new
   `ticket-classification` module — consistent with the sibling track and the project default.
6. **Access control for overrides** reuses the existing `teams`/`team_memberships` primitives
   (a designated governance team) rather than introducing new RBAC, plus a direct
   submitter-match check.

## Architecture Summary

Ticket Intake (`apps/api/src/routes/tickets.ts`) creates a `tickets` row and reuses the
existing channel creation/subscription primitive (no new channel infrastructure, per US-01
Technical Notes) — then emits `ticket.created`. Three new components inside `agent-runner`
consume that event and downstream events: **Classifier** (LLM-backed, wraps the existing
`@orgops/llm generate()`), **Classification Orchestrator** (deterministic, invokes Classifier,
records result/failure, gates the downstream contract event), and **Override/Audit Handler**
(deterministic, validates authorization, records overrides, gates the same contract event).
Two new DB tables. Seven new API routes under `/api/tickets*`. Full detail, C4 diagrams
(L1/L2/L3), failure-handling table, and extension points (Trello ingestion, low-detail
refinement — both explicitly not foreclosed) are in
`docs/product/architecture/brief.md` → `## Ticket Classification`.

## Technology Stack

No new runtime dependencies. Reuses `@orgops/llm`'s existing `generate()` abstraction (already
a project dependency, used by the sibling track's Restatement Composer). Same recommended new
dev-tooling dependency as the sibling track: `dependency-cruiser` (MIT license) for
architecture-rule enforcement, covering both tracks' rules together — not yet configured
anywhere in this repo; flagged for `platform-architect`/`software-crafter`, not added in this
design pass.

## Development Paradigm

**Applied, not re-derived.** Confirmed project convention (root `CLAUDE.md`): functional-
leaning TypeScript. This track's pure decision/orchestration logic (classification gating,
audit-append transitions) mirrors the sibling track's `ingest*`/`collectDue*` pattern shape;
all I/O (LLM call, HTTP calls to `/api/tickets*`) is isolated behind explicit dependency
injection (`generate()` passed in) or the `TicketRepositoryPort`/`HttpTicketRepository` seam.

## Constraints Established

- `apps/agent-runner/src/ticket-classification/**` must not import from
  `apps/agent-runner/src/nwave-invocation/**` or `wrapper-harness/**` — classification is
  upstream of and independent from invocation; the only coupling is the
  `ticket.classification.confirmed` event on the shared bus.
- `apps/agent-runner/src/ticket-classification/**` must not import from
  `apps/api/src/routes/tickets.ts` or assume a native-form-specific event shape — the
  decoupling ADR-0004 establishes.
- Pure logic modules must not perform I/O directly (`fetch`/`apiFetch`) — only
  `HttpTicketRepository` may.
- No stronger event-delivery guarantee than the platform's existing at-least-once semantics is
  introduced or required; the Classification Orchestrator's idempotency check
  (`classification_status` before invoking the Classifier) is the mechanism that makes
  at-least-once safe for this track's writes.
- `ticket.classification.confirmed` is the single, sole trigger contract
  `nwave-invocation-engine` should subscribe to for "classification confirmed as development
  work" — do not have that track inspect `ticket.classification.completed`/`overridden`
  payloads directly, to avoid duplicating the gating rule in two places.

## Observable Contract for Downstream Tracks

- **`nwave-invocation-engine`** (already designed, per the `## Application Architecture`
  section of brief.md): subscribes to `ticket.classification.confirmed`
  (`{ ticketId, channelId, rationale }`) to know when US-04's trigger step becomes available.
  This event is the concrete instance of the "confirmed `classification_result`" dependency
  documented in this track's `discuss/wave-decisions.md`.
- **`multi-source-ingestion-governance`** (not yet designed): its future US-11 (Trello
  ingestion) needs only to (a) write a `tickets` row and (b) emit `ticket.created` to get
  classification "for free," per ADR-0004. See "Upstream Changes" below for the one open
  question that track's own DESIGN pass should resolve.

## Upstream Changes

**None required to already-designed content.** The `## Application Architecture` section's
`nwave_runs.ticket_ref`/`nwave_runs.channel_id` placeholders reconcile cleanly with this
track's `tickets.id`/`tickets.channel_id` — no schema change, no inconsistency found for the
native-form path. See brief.md "Reconciliation with `nwave_runs`."

## Changed Assumptions

One open question is flagged, not silently resolved, for a track that has not yet reached
DESIGN:

- The umbrella `shared-artifacts-registry.md` implies a Trello-sourced ticket might exist only
  as a Trello card id, with no corresponding row in this track's `tickets` store. That would
  break `nwave_runs.ticket_ref → tickets.id` resolution for Trello-sourced runs.
  **Blocking dependency** (raised from recommendation to blocking after peer review — the
  alternative is a correctness defect, not a style choice): `multi-source-ingestion-
  governance`'s future DESIGN must have Trello ingestion create a `tickets` row (`id` in the
  `TICKET-{n}` format, `source = TRELLO`, `source_ref = <Trello card id>`) and emit
  `ticket.created`, exactly like the native-form path — or explicitly supersede this note and
  update the reconciliation in `nwave-invocation-engine`'s section accordingly. Full detail in
  brief.md "Changed Assumptions."
- `tickets.id` format is now explicitly fixed as `TICKET-{n}` (monotonic integer sequence,
  TEXT column) — added during peer-review remediation to close a silent-reconciliation risk
  the reviewer flagged: without a fixed format, `software-crafter` could pick an id shape that
  no longer matches `nwave_runs.ticket_ref`'s existing example value, breaking reconciliation
  in practice even though it "matched" on paper. See brief.md Data Model.

## Peer Review

Invoked `nw-solution-architect-reviewer` (haiku), single pass per `.nwave/des-config.json`
(`review_enabled: true`, `double_review: false`). Outcome: **conditionally approved**, 0
critical issues, 3 high issues (all completeness gaps — observability strategy not specified,
`tickets.id` format not fixed, post-Release-0 accuracy-measurement strategy not specified), 2
medium issues (override-redelivery idempotency not explicit, Trello blocking dependency
under-flagged as a mere recommendation).

All three high issues and both medium issues were remediated in `brief.md` before this design
was finalized:

1. **Observability** — added a subsection to Quality Attribute Priorities showing the
   `ticket_classification_audit` table (already part of this design, ADR-0003) is reused as
   the observability substrate for decision distribution, latency, error rate, and
   post-Release-0 accuracy sampling — no new instrumentation mechanism required.
2. **`tickets.id` format** — fixed as `TICKET-{n}` (monotonic sequence, TEXT), matching the
   example value already used in `nwave_runs.ticket_ref`, so reconciliation holds by
   construction.
3. **Accuracy measurement strategy** — folded into the same observability subsection: the
   audit trail already captures everything a human reviewer needs (`title`/`description`,
   `classification_result`, `classification_rationale`) for the >=90%-accuracy validation
   sample via `GET /api/tickets/:id/classification-history`.
4. **Override idempotency** — added an explicit guard to the Override/Audit Handler
   description and the Failure/Timeout table: compare requested `toResult` against the
   ticket's current `classification_result` before writing, mirroring the Orchestrator's
   existing idempotency shape.
5. **Trello dependency severity** — reworded from "recommendation" to "blocking dependency" in
   both brief.md and this document, with an explicit instruction that
   `multi-source-ingestion-governance` must either follow the pattern or explicitly supersede
   it, not silently diverge.

No second review iteration was run (single-pass config); remediations were applied directly
against the reviewer's stated findings. This design is ready for handoff to DISTILL.
