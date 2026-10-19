CREATE TABLE IF NOT EXISTS federation_instances (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  base_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_seen_at INTEGER
);

CREATE TABLE IF NOT EXISTS federation_channels (
  local_channel_id TEXT PRIMARY KEY,
  home_instance_id TEXT,
  remote_channel_id TEXT,
  role TEXT NOT NULL,
  sync_cursor TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_federation_channels_home
  ON federation_channels (home_instance_id, remote_channel_id);
