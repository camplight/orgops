CREATE TABLE IF NOT EXISTS agent_invites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  channel_ids_json TEXT NOT NULL DEFAULT '[]',
  wrapped_config_json TEXT NOT NULL DEFAULT '{}',
  max_uses INTEGER NOT NULL DEFAULT 1,
  use_count INTEGER NOT NULL DEFAULT 0,
  created_by_human_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  last_redeemed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_agent_invites_agent_name
  ON agent_invites (agent_name);

CREATE INDEX IF NOT EXISTS idx_agent_invites_created_at
  ON agent_invites (created_at);

CREATE TABLE IF NOT EXISTS runner_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  allowed_agent_name TEXT,
  allowed_runner_id TEXT,
  allowed_channel_ids_json TEXT NOT NULL DEFAULT '[]',
  invite_id TEXT,
  created_by_human_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  last_used_at INTEGER,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_runner_tokens_allowed_agent
  ON runner_tokens (allowed_agent_name);

CREATE INDEX IF NOT EXISTS idx_runner_tokens_allowed_runner
  ON runner_tokens (allowed_runner_id);
