CREATE TABLE IF NOT EXISTS webhook_definitions (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  verification_kind TEXT NOT NULL,
  secret TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
