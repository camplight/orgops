CREATE TABLE IF NOT EXISTS workspace_publications (
  id TEXT PRIMARY KEY,
  agent_name TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT,
  source_path TEXT NOT NULL DEFAULT '.',
  enabled INTEGER NOT NULL DEFAULT 1,
  auth_type TEXT NOT NULL DEFAULT 'PUBLIC',
  password_hash TEXT,
  sync_mode TEXT NOT NULL DEFAULT 'SNAPSHOT',
  active_revision_id TEXT,
  created_by_type TEXT NOT NULL,
  created_by_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_published_at INTEGER,
  last_error TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_workspace_publications_agent_slug
  ON workspace_publications(agent_name, slug);

CREATE INDEX IF NOT EXISTS idx_workspace_publications_agent
  ON workspace_publications(agent_name);

CREATE INDEX IF NOT EXISTS idx_workspace_publications_active_revision
  ON workspace_publications(active_revision_id);

CREATE TABLE IF NOT EXISTS workspace_publication_blobs (
  sha256 TEXT PRIMARY KEY,
  storage_path TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_publication_revisions (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  file_count INTEGER NOT NULL,
  total_bytes INTEGER NOT NULL,
  created_by_agent_name TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspace_publication_revisions_publication
  ON workspace_publication_revisions(publication_id, created_at);
