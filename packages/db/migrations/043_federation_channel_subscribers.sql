CREATE TABLE IF NOT EXISTS federation_channel_subscribers (
  id TEXT PRIMARY KEY,
  local_channel_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  remote_channel_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  last_push_at INTEGER,
  last_ack_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_federation_channel_subscribers
  ON federation_channel_subscribers (local_channel_id, instance_id, remote_channel_id);

CREATE INDEX IF NOT EXISTS idx_federation_channel_subscribers_channel
  ON federation_channel_subscribers (local_channel_id);
