BEGIN;

CREATE TABLE catalog_installed_origins (
  name TEXT PRIMARY KEY NOT NULL,
  catalog_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  catalog_commit TEXT NOT NULL,
  package_commit TEXT NOT NULL,
  path TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind='skill'),
  version TEXT NOT NULL,
  digest TEXT NOT NULL,
  local_path TEXT NOT NULL,
  installed_by_human_id TEXT,
  installed_at INTEGER NOT NULL
);
CREATE INDEX idx_catalog_installed_origins_catalog ON catalog_installed_origins(catalog_id, name, version);

COMMIT;
