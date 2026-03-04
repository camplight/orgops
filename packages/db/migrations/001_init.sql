PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS migrations (
  id TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  icon TEXT NULL,
  description TEXT NULL,
  model_id TEXT NOT NULL,
  system_instructions TEXT NOT NULL DEFAULT '',
  soul_path TEXT NOT NULL,
  workspace_path TEXT NOT NULL,
  desired_state TEXT NOT NULL DEFAULT 'RUNNING',
  runtime_state TEXT NOT NULL DEFAULT 'STOPPED',
  last_heartbeat_at INTEGER NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS team_memberships (
  team_id TEXT NOT NULL,
  member_type TEXT NOT NULL,
  member_id TEXT NOT NULL,
  PRIMARY KEY (team_id, member_type, member_id)
);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_subscriptions (
  channel_id TEXT NOT NULL,
  subscriber_type TEXT NOT NULL,
  subscriber_id TEXT NOT NULL,
  PRIMARY KEY (channel_id, subscriber_type, subscriber_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  human_id TEXT NOT NULL,
  agent_name TEXT NULL,
  channel_id TEXT NULL,
  title TEXT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  title TEXT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  source TEXT NOT NULL,
  channel_id TEXT NULL,
  team_id TEXT NULL,
  parent_event_id TEXT NULL,
  deliver_at INTEGER NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  idempotency_key TEXT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_deliver_at ON events (status, deliver_at);
CREATE INDEX IF NOT EXISTS idx_events_channel ON events (channel_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_events_idempotency ON events (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS processes (
  id TEXT PRIMARY KEY,
  agent_name TEXT NOT NULL,
  channel_id TEXT NULL,
  cmd TEXT NOT NULL,
  cwd TEXT NOT NULL,
  pid INTEGER NULL,
  state TEXT NOT NULL,
  exit_code INTEGER NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NULL
);

CREATE TABLE IF NOT EXISTS process_output (
  id TEXT PRIMARY KEY,
  process_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  stream TEXT NOT NULL,
  text TEXT NOT NULL,
  ts INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_process_output ON process_output (process_id, seq);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  storage_path TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_by_human_id TEXT NULL,
  created_by_agent_name TEXT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS secrets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id TEXT NULL,
  ciphertext_b64 TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (name, scope_type, scope_id)
);

CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model_name TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  defaults_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
