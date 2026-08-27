CREATE TABLE IF NOT EXISTS embed_conversations (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL UNIQUE,
  agent_name TEXT NOT NULL,
  integration_key_id TEXT NOT NULL,
  idempotency_key TEXT,
  metadata_json TEXT,
  created_at INTEGER NOT NULL,
  archived_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_embed_conversations_key_idempotency
  ON embed_conversations (integration_key_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
