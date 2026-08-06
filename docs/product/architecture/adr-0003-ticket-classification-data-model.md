# ADR-0003: Ticket & Classification Data Model — Current State Plus Append-Only Audit Log

## Status

Accepted.

## Context

`ticket-classification` owns two new domain concepts (per the umbrella
`shared-artifacts-registry.md`): the OrgOps-native ticket store (`ticket_id`) and the
classification decision (`classification_result`). US-03 requires that classification
overrides be "recorded with who made them and when, visible to governance review" (AC4), and
that Priya Nair can see "the original classification, the override, and who made it" — i.e. a
durable, queryable history, not just the current value.

The existing `nwave_runs`/`nwave_run_waves` pair (ADR-0001/0002, this track's sibling) already
establishes a precedent: an aggregate-root table holding current state plus a related entity
table holding a sequence of history rows. A separate question is *where* that history lives:
folded into the generic `events` table (already used for channel messages and audit events
like `audit.events.cleared`), or in a dedicated table.

A material fact changes the calculus versus reusing `events`: `apps/api/src/routes/events.ts`
exposes `DELETE /api/events` (bulk, filterable) and `DELETE /api/events/:id` (single, though
guarded to future-scheduled events only). The bulk delete has no such guard — any caller with
channel-post permission can delete arbitrary historical events for a channel. A classification
audit trail that submitters and Priya Nair depend on for governance review must not be
erasable by a channel-message cleanup action taken for an unrelated reason.

## Decision

Two new tables in `packages/db/src/schema.ts`:

- **`tickets`** (aggregate root, current state) — one row per ticket, holding the *current*
  `classification_result`/`classification_status`/`classification_rationale`.
- **`ticket_classification_audit`** (entity, append-only log) — one row per classification
  decision or override, holding `from_result`/`to_result`/`actor_type`/`actor_id`/`rationale`/
  `created_at`. Never updated or deleted by any code path in this design.

See `docs/product/architecture/brief.md` "Ticket Classification" → "Data Model" for exact
column shapes.

## Alternatives Considered

### 1. Event-sourced only — derive current classification state by replaying audit events on every read

**Rejected.** No requirement in this track needs temporal replay, alternate projections, or
event-sourcing's consistency guarantees beyond "show the current state and show the history."
Replaying on every read adds real complexity and a real performance cost for a three-value
enum with no other consumer of intermediate states. Small team, no CQRS driver — same
reasoning the sibling track already applied when it chose a plain current-state table
(`nwave_runs.status`) over event-sourcing that table.

### 2. Store the audit trail as `events` rows only (channel messages), with no dedicated table

**Rejected.** Two problems, one structural and one integrity-related:

- **Structural**: reconstructing "the classification history for TICKET-1042" would require
  filtering the generic, cross-concern `events` table by channel id and a payload shape
  convention, rather than querying a purpose-built, indexed table. Governance review (Priya
  Nair's audit view, US-03 AC4) becomes a query against unstructured event payloads instead of
  a first-class read.
- **Integrity**: `DELETE /api/events` (bulk) and the channel-message-clear endpoint
  (`DELETE /api/channels/:channelId/messages`) can remove exactly the `message.created` events
  this alternative would rely on as the audit record. A governance audit trail must not share
  fate with an operational cleanup action that has nothing to do with classification history.

### 3. `tickets` (current state) + `ticket_classification_audit` (append-only entity) — chosen

**Accepted.** Mirrors the `nwave_runs`/`nwave_run_waves` precedent already established in this
codebase (ADR-0001/0002): current state is cheap to read for routing/UI decisions
(`tickets.classification_result`), while the append-only table gives governance review a
durable, structured, indexable history immune to unrelated event-cleanup operations. No new
architectural idiom introduced — same shape as the sibling track's aggregate-root-plus-entity
pattern, applied to a different domain.

## Consequences

**Positive**

- Governance audit trail (US-03 AC4) is a direct, indexed query
  (`SELECT * FROM ticket_classification_audit WHERE ticket_id = ? ORDER BY created_at`), not a
  filtered scan of the generic event stream.
- Audit rows are immune to `DELETE /api/events`/channel-message-clear operations — durability
  is structural, not dependent on callers never invoking an unrelated cleanup endpoint.
- Consistent with the existing aggregate-root-plus-entity idiom (`nwave_runs`/
  `nwave_run_waves`) — no new pattern for the team to learn.

**Negative**

- Two tables to keep in sync (`tickets.classification_result` must always match the latest
  `to_result` in `ticket_classification_audit` for that ticket) — this invariant is owned by
  the `TicketRepositoryPort` adapter (single write path, see brief.md), not left to callers to
  maintain independently.
- Duplicates in miniature what `events` already does generically (append-only, timestamped
  records). Accepted as the smaller cost versus the integrity risk in Alternative 2.

## Enforcement

No new structural rule beyond the general `ticket-classification` module rules (see brief.md
"Architecture Enforcement"): all writes to `tickets`/`ticket_classification_audit` happen
through the `TicketRepositoryPort`/`HttpTicketRepository` seam — pure orchestration logic never
writes either table directly.
