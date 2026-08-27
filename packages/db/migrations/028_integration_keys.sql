CREATE TABLE IF NOT EXISTS integration_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  created_by_human_id TEXT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NULL,
  revoked_at INTEGER NULL
);

CREATE INDEX IF NOT EXISTS idx_integration_keys_agent_name
  ON integration_keys (agent_name);
