# ADR-0009: Trello-Ingested Tickets Create a Real `tickets` Row, Resolving the Blocking Cross-Track Dependency

## Status

Accepted.

## Context

`ticket-classification`'s DESIGN pass (see `docs/feature/ticket-classification/design/
wave-decisions.md` "Changed Assumptions") flagged, as a **blocking dependency** (raised from a
mere recommendation to blocking during that track's own peer review), that this track's future
Trello ingestion must create a real `tickets` row — `id` in the `TICKET-{n}` format, `source =
TRELLO`, `source_ref = <Trello card id>` — and emit `ticket.created` exactly like the native-form
path, or explicitly supersede that note with justification and update
`nwave-invocation-engine`'s `nwave_runs.ticket_ref → tickets.id` reconciliation accordingly.

The alternative the note warns against — a Trello-sourced ticket existing only as a bare Trello
card id with no corresponding `tickets` row (an interpretation the umbrella
`shared-artifacts-registry.md`'s `ticket_id` description could be read to imply) — was identified
as a correctness defect: `nwave_runs.ticket_ref` is defined as a `TICKET-{n}`-shaped identifier
that resolves to a `tickets.id` row; a bare Trello card id (a different shape, e.g. a Trello
object id) resolving nowhere would break that resolution for every Trello-sourced run.

## Decision

**Follow the note exactly; do not supersede it.** US-11's Trello Ingestion Poller creates ticket
records through the **same** `POST /api/tickets` endpoint the native form already uses (extended
with two additive optional fields, `sourceRef` and an explicit `submitterHumanId` — see brief.md
Data Model), with `source = "TRELLO"` and `source_ref = <Trello card id>` populated. The resulting
row receives an `id` in the same `TICKET-{n}` monotonic-sequence format `ticket-classification`'s
ADR-0003/data model already fixed, and the same `ticket.created` event is emitted afterward,
through the same code path — not a parallel Trello-specific ticket-creation mechanism.

No superseding justification is offered, because this pass found no evidence that changes the
sibling track's assessment: the correctness argument (uniform `ticket_ref → tickets.id`
resolution) holds regardless of ticket source, and reusing the existing endpoint costs nothing
extra — it was already designed to accept a `source` field defaulting to `NATIVE_FORM`, precisely
so a future non-native path could supply a different value without needing a new endpoint.

## Alternatives Considered

### 1. Store Trello-sourced work as a bare Trello card id, with no `tickets` row, and have downstream components branch on ticket source

**Rejected.** This is the exact alternative the blocking note identifies as a correctness defect.
It would require `nwave-invocation-engine`'s Wave Runner, `ticket-classification`'s Classification
Orchestrator, and every consumer of `tickets.id`/`nwave_runs.ticket_ref` to add source-specific
branching (`if Trello card id, look here; if native ticket id, look there`) — directly
contradicting US-11's own AC that ingested tickets must be "indistinguishable downstream from a
native-form ticket" and ADR-0004's decoupling principle (classification, and everything
downstream of it, must operate on ticket content, never on how the ticket arrived).

### 2. A new, separate `trello_cards` table, synced/mirrored into `tickets` by a background process

**Rejected.** This introduces a second source of truth and a synchronization problem (keeping
`trello_cards` and its mirrored `tickets` row consistent) for no benefit this track's
requirements actually need — nothing in US-11's ACs requires retaining Trello-specific card
fields beyond what `tickets.source_ref`/`title`/`description` already capture. It would also
duplicate, in a new table, exactly the current-state-plus-audit-log idiom `ticket-classification`
already applies directly to `tickets` — a second table achieving the same thing the existing one
already does is unjustified complexity, matching this project's general preference (see ADR-0003)
against inventing parallel storage where an existing table already fits.

### 3. Reuse the existing `tickets` row and `POST /api/tickets` endpoint, with `source`/`source_ref` populated (chosen)

**Accepted.** Zero new ticket-storage concept. The existing endpoint was already built to accept a
`source` field for exactly this reason (see `## Ticket Classification`'s intake description:
"`source` (defaults to `NATIVE_FORM`)"). `ticket-classification`'s Classification Orchestrator,
`nwave-invocation-engine`'s Wave Runner, and every other downstream consumer require zero
modification — they already operate on `tickets` rows and `ticket.created` events without regard
to source, exactly as ADR-0004 intended.

## Consequences

**Positive**

- `nwave_runs.ticket_ref → tickets.id` resolution holds uniformly, with no source-specific branch
  anywhere in the codebase — the correctness property the blocking note demanded.
- Zero modification required to `ticket-classification`'s or `nwave-invocation-engine`'s existing
  design — this track's Trello Ingestion Poller is purely an additional *caller* of an endpoint
  those tracks already built to accept exactly this shape of input.
- US-11's "indistinguishable downstream" AC is satisfied structurally, not by convention: nothing
  downstream of `POST /api/tickets` can tell a Trello-sourced ticket apart from a native-form one
  except by reading the informational `source` field itself, which no component branches on.

**Negative**

- Requires a database-level uniqueness guarantee (`tickets (source, source_ref)` unique index,
  see brief.md "Changed Assumptions") that the native-form-only design did not previously need —
  a small, real, additive schema change to a table owned by a sibling track, applied via the
  back-propagation pattern rather than a silent edit.
- `submitter_human_id` has no natural per-card mapping from Trello (Trello cards do not carry an
  OrgOps human identity) — resolved via a per-board configured default submitter, with per-card
  mapping named as a non-built extension point (see brief.md), not a defect this ADR needed to
  solve to satisfy US-11's own written ACs.

## Enforcement

No new structural rule beyond the general module-boundary rules already listed in brief.md's
Architecture Enforcement — the correctness guarantee here is a database constraint
(`tickets (source, source_ref)` unique index), not a code-import rule.
