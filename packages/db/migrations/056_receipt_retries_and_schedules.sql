ALTER TABLE event_receipts ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE event_receipts ADD COLUMN last_error TEXT NULL;
ALTER TABLE event_receipts ADD COLUMN retry_at INTEGER NULL;
ALTER TABLE event_receipts ADD COLUMN acked_at INTEGER NULL;

CREATE INDEX IF NOT EXISTS idx_event_receipts_agent_pending_retry
  ON event_receipts (agent_name, status, retry_at);

CREATE TABLE IF NOT EXISTS recurring_schedules (
  id TEXT PRIMARY KEY,
  name TEXT NULL,
  channel_id TEXT NOT NULL,
  target_agent_name TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  timezone TEXT NOT NULL,
  text TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  misfire_policy TEXT NOT NULL DEFAULT 'FIRE_ONCE',
  next_fire_at INTEGER NOT NULL,
  last_occurrence_at INTEGER NULL,
  last_error TEXT NULL,
  created_by_type TEXT NOT NULL,
  created_by_id TEXT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recurring_schedules_due
  ON recurring_schedules (status, next_fire_at);

CREATE INDEX IF NOT EXISTS idx_recurring_schedules_channel
  ON recurring_schedules (channel_id, created_at);
