BEGIN;

CREATE TABLE catalog_sources (
  source_id TEXT PRIMARY KEY NOT NULL,
  canonical_url TEXT NOT NULL,
  ssh_user TEXT,
  repository_identity TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  allow_packages INTEGER NOT NULL CHECK(allow_packages IN (0,1)),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
  removed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK(removed_at IS NULL OR (enabled=0 AND allow_packages=0))
);
CREATE TABLE catalogs (
  catalog_id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL REFERENCES catalog_sources(source_id),
  display_name TEXT NOT NULL,
  ref TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
  removed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK(removed_at IS NULL OR enabled=0)
);
CREATE INDEX idx_catalogs_source_id ON catalogs(source_id);
CREATE TABLE catalog_read_credentials (
  source_id TEXT PRIMARY KEY NOT NULL REFERENCES catalog_sources(source_id),
  credential_ref TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind='https-basic'),
  ciphertext_b64 TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

COMMIT;
