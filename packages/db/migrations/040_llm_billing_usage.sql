CREATE TABLE IF NOT EXISTS llm_model_prices (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  input_price_per_million TEXT NOT NULL,
  output_price_per_million TEXT NOT NULL,
  cached_input_price_per_million TEXT,
  reasoning_price_per_million TEXT,
  source TEXT NOT NULL,
  source_url TEXT,
  effective_at INTEGER NOT NULL,
  fetched_at INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_llm_model_prices_lookup
  ON llm_model_prices (provider, model_id, effective_at);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_llm_model_prices_effective
  ON llm_model_prices (provider, model_id, effective_at);

CREATE TABLE IF NOT EXISTS llm_usage (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  channel_id TEXT,
  agent_name TEXT,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  runtime TEXT NOT NULL,
  purpose TEXT NOT NULL,
  trigger_event_id TEXT,
  usage_source TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd_micros INTEGER NOT NULL DEFAULT 0,
  price_snapshot_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_llm_usage_created_at
  ON llm_usage (created_at);

CREATE INDEX IF NOT EXISTS idx_llm_usage_channel_created
  ON llm_usage (channel_id, created_at);

CREATE INDEX IF NOT EXISTS idx_llm_usage_agent_created
  ON llm_usage (agent_name, created_at);

CREATE INDEX IF NOT EXISTS idx_llm_usage_provider_created
  ON llm_usage (provider, created_at);
