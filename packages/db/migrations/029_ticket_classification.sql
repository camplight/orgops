-- Tables owned by the ticket-classification track (US-01/US-02/US-03).
-- See docs/product/architecture/brief.md "Ticket Classification" -> "Data Model", ADR-0003
-- (current-state-plus-append-only-audit-log rationale), and ADR-0009 (the (source, source_ref)
-- uniqueness guarantee required so Trello-sourced tickets reusing this same table can never be
-- double-inserted on redelivery).

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NULL,
  source TEXT NOT NULL DEFAULT 'NATIVE_FORM',
  source_ref TEXT NULL,
  channel_id TEXT NOT NULL,
  submitter_human_id TEXT NOT NULL,
  is_low_detail INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT NULL,
  classification_status TEXT NOT NULL DEFAULT 'PENDING',
  classification_result TEXT NULL,
  classification_rationale TEXT NULL,
  classification_failure_reason TEXT NULL,
  classified_at INTEGER NULL,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_tickets_idempotency
  ON tickets (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_tickets_source_source_ref
  ON tickets (source, source_ref)
  WHERE source_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS ticket_classification_audit (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  from_result TEXT NULL,
  to_result TEXT NULL,
  rationale TEXT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ticket_classification_audit_ticket_id
  ON ticket_classification_audit (ticket_id);
