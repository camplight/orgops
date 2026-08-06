-- Tables owned by the nwave-invocation-engine track (US-04).
-- See docs/product/architecture/brief.md "Application Architecture" -> "Data Model".

CREATE TABLE IF NOT EXISTS nwave_runs (
  id TEXT PRIMARY KEY,
  ticket_ref TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  status TEXT NOT NULL,
  current_wave TEXT NULL,
  restatement_text TEXT NOT NULL,
  confirmed_at INTEGER NULL,
  started_at INTEGER NULL,
  ended_at INTEGER NULL,
  failure_reason TEXT NULL
);

CREATE TABLE IF NOT EXISTS nwave_run_waves (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  wave_name TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  process_id TEXT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NULL,
  ended_at INTEGER NULL,
  exit_code INTEGER NULL
);

CREATE INDEX IF NOT EXISTS idx_nwave_run_waves_run_id ON nwave_run_waves (run_id);
