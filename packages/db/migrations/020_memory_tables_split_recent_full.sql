CREATE TABLE IF NOT EXISTS channel_memory_recent (
  agent_name TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  summary_text TEXT NOT NULL DEFAULT '',
  window_start_at INTEGER NOT NULL DEFAULT 0,
  last_processed_at INTEGER NOT NULL DEFAULT 0,
  last_processed_event_id TEXT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (agent_name, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_memory_recent_agent_updated
  ON channel_memory_recent (agent_name, updated_at);

CREATE TABLE IF NOT EXISTS channel_memory_full (
  agent_name TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  summary_text TEXT NOT NULL DEFAULT '',
  last_processed_at INTEGER NOT NULL DEFAULT 0,
  last_processed_event_id TEXT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (agent_name, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_memory_full_agent_updated
  ON channel_memory_full (agent_name, updated_at);

CREATE TABLE IF NOT EXISTS cross_channel_memory_recent (
  agent_name TEXT PRIMARY KEY,
  summary_text TEXT NOT NULL DEFAULT '',
  window_start_at INTEGER NOT NULL DEFAULT 0,
  last_processed_at INTEGER NOT NULL DEFAULT 0,
  last_processed_event_id TEXT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cross_channel_memory_recent_updated
  ON cross_channel_memory_recent (updated_at);

CREATE TABLE IF NOT EXISTS cross_channel_memory_full (
  agent_name TEXT PRIMARY KEY,
  summary_text TEXT NOT NULL DEFAULT '',
  last_processed_at INTEGER NOT NULL DEFAULT 0,
  last_processed_event_id TEXT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cross_channel_memory_full_updated
  ON cross_channel_memory_full (updated_at);
