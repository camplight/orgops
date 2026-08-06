-- Tables owned by the multi-source-ingestion-governance track (US-11/US-12/US-13).
-- See docs/product/architecture/brief.md "Multi-Source Ingestion & Governance" -> "Data Model".

CREATE TABLE IF NOT EXISTS trello_ingestion_boards (
  board_id TEXT PRIMARY KEY,
  trigger_list_ids TEXT NULL,
  default_submitter_human_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  activated_at INTEGER NOT NULL,
  last_polled_at INTEGER NULL,
  last_poll_status TEXT NULL,
  last_poll_error TEXT NULL
);

CREATE TABLE IF NOT EXISTS trello_ingestion_seen_cards (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  first_observed_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_trello_ingestion_seen_cards_board_card
  ON trello_ingestion_seen_cards (board_id, card_id);

CREATE TABLE IF NOT EXISTS guardrail_allowlist_entries (
  id TEXT PRIMARY KEY,
  path_pattern TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS guardrail_decision_audit (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NULL,
  note TEXT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS nwave_run_stuck_flags (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  wave_sequence INTEGER NOT NULL,
  flagged_at INTEGER NOT NULL,
  cleared_at INTEGER NULL
);
