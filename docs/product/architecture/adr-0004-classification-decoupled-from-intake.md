# ADR-0004: Classification Triggered by a Source-Agnostic Event, Not the Native-Form Handler

## Status

Accepted.

## Context

US-02's classification step must run automatically within 60 seconds of ticket submission.
Per this track's `wave-decisions.md`, `multi-source-ingestion-governance`'s US-11 (Trello
ingestion, not yet designed) will depend on this same classification step being callable for
tickets that never go through the OrgOps-native submission form. US-11's UAT scenario
explicitly requires a Trello-sourced ticket to "proceed through classification, confirmation,
execution, and monitoring" identically to a native-form ticket.

This forces a DESIGN-time choice about *what* triggers classification: something tied to the
native form's HTTP request/response cycle, or something tied only to ticket content existing
in the `tickets` table, regardless of how it got there.

## Decision

Classification is triggered by a generic, source-agnostic domain event, `ticket.created`,
carrying `ticketId`, a snapshot of `title`/`description`, and `source` (informational only —
never branched on by the classifier). `POST /api/tickets` (the native-form intake endpoint)
emits this event after creating the `tickets` row, exactly the way any other ticket-creation
code path (including a future Trello-ingestion path) would. The Classification Orchestrator
(`apps/agent-runner/src/ticket-classification/`) consumes `ticket.created` via the existing
agent-runner polling loop — the same event-consumption shape already used by
`intent-watchdog.ts` and (in the sibling track) the Confirmation Gate — and is structurally
incapable of assuming a native-form origin, because it never receives form-specific data.

## Alternatives Considered

### 1. Classify synchronously inline inside the `POST /api/tickets` handler

**Rejected.** Two independent problems:

- **Coupling to the wrong lifecycle.** Ticket-creation latency (an HTTP request/response) would
  become dependent on LLM call latency. A slow or failed classification call would degrade or
  fail ticket *creation* — a concern US-01's acceptance criteria say nothing about and that
  this design should not introduce.
- **Source lock-in.** A future Trello-ingestion path would need to duplicate this inline call
  (or refactor it out) rather than getting classification "for free" by emitting the same
  event a native-form ticket already emits. This is exactly the coupling
  `multi-source-ingestion-governance`'s US-11 needs this track to avoid, called out explicitly
  in this track's `wave-decisions.md`.

### 2. A source-specific event (e.g. `ticket.submitted_via_form`)

**Rejected.** Narrower than the problem requires: the event *name* itself encodes the source,
so a Trello-ingestion path would either need to emit a same-shaped-but-differently-named event
(forcing the Classification Orchestrator to subscribe to multiple event types, or to be
modified when a new source is added) or awkwardly reuse a form-named event for non-form data.
Neither is a real decoupling — it just moves the coupling from a function call to an event
name.

### 3. Generic `ticket.created` event, consumed by an independent orchestrator (chosen)

**Accepted.** The event's payload only ever describes ticket *content*
(`ticketId`/`title`/`description`), never submission mechanics. Any current or future ticket
source that (a) writes a row to `tickets` and (b) emits `ticket.created` gets classification
without the Classification Orchestrator changing at all. This is the concrete mechanism that
satisfies the "operates on ticket content, not the native-form submission event" requirement
without building any Trello-specific integration now — the decoupling is achieved by *what
the event does not contain* (no form-specific shape), not by speculative Trello-aware code.

## Consequences

**Positive**

- `multi-source-ingestion-governance`'s future US-11 can reuse the entire
  `ticket-classification` module unchanged — it only needs to ensure its Trello-ingestion path
  writes a `tickets` row and emits `ticket.created`. See brief.md "Changed Assumptions" for the
  one open question this raises for that track's own DESIGN pass (whether Trello-sourced work
  gets a `tickets` row at all, and how `source_ref` is populated).
- Ticket creation (`POST /api/tickets`) response latency is decoupled from LLM latency —
  the 60-second classification SLA is satisfied by the agent-runner's existing ~1s polling
  cadence (see `apps/agent-runner/src/runner.ts`) acting on the event asynchronously, not by
  blocking the HTTP request.
- Matches the event-driven consumption shape already established by
  `intent-watchdog.ts`/the sibling track's Confirmation Gate — no new integration idiom.

**Negative**

- Requires at-least-once-delivery-aware handling: `ticket.created` could in principle be
  redelivered. The Classification Orchestrator guards against double-classification by
  checking `tickets.classification_status` before invoking the Classifier (see brief.md
  Failure/Timeout Handling table) — a small but real piece of idempotency logic that an
  inline synchronous call (Alternative 1) would not have needed.
- One additional network hop conceptually (event bus round-trip via the agent-runner polling
  loop) versus a same-process function call. Not a measured performance concern at this
  project's scale (walking-skeleton, single-team, ~1s polling loop already well inside the
  60-second budget) — flagged here only for completeness, not because it changed the decision.

## Enforcement

`apps/agent-runner/src/ticket-classification/**` must not import anything from
`apps/api/src/routes/tickets.ts` or otherwise assume a native-form-specific payload shape for
`ticket.created` — see brief.md "Architecture Enforcement" for the `dependency-cruiser` rule.
