ALTER TABLE agents ADD COLUMN assigned_runner_id TEXT;

CREATE TABLE IF NOT EXISTS runner_nodes (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  hostname TEXT,
  platform TEXT,
  arch TEXT,
  version TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
