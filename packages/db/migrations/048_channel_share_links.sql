CREATE TABLE IF NOT EXISTS channel_share_links (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  channel_id TEXT NOT NULL,
  created_by_human_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_channel_share_links_channel
  ON channel_share_links(channel_id, created_at);
