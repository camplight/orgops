BEGIN IMMEDIATE;

-- Task 8 had no pre-existing route, so a GRANT origin without its exact grant ID is
-- unverifiable state. Force a transaction rollback instead of inventing provenance.
CREATE TABLE _migration_035_origin_guard (value INTEGER PRIMARY KEY);
INSERT INTO _migration_035_origin_guard(value) VALUES (1);
INSERT OR ROLLBACK INTO _migration_035_origin_guard(value)
  SELECT 1 FROM agent_template_origins WHERE consumed_by_kind='GRANT' LIMIT 1;
DROP TABLE _migration_035_origin_guard;

ALTER TABLE agent_template_origins RENAME TO agent_template_origins_legacy_034;

CREATE TABLE agent_template_origins (
  agent_id TEXT PRIMARY KEY NOT NULL REFERENCES agents(id),
  release_id TEXT NOT NULL REFERENCES catalog_package_releases(package_release_id),
  mode TEXT NOT NULL CHECK(mode IN ('CLASSIC','RLM_REPL','WRAPPED')),
  consumed_by_kind TEXT NOT NULL CHECK(consumed_by_kind IN ('ADMIN','GRANT')),
  consumed_by_human_id TEXT NOT NULL REFERENCES humans(id),
  grant_id TEXT REFERENCES catalog_grants(grant_id),
  authority_source_id TEXT NOT NULL,
  content_source_id TEXT NOT NULL,
  package_name TEXT NOT NULL,
  package_version TEXT NOT NULL,
  package_digest TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK((consumed_by_kind='ADMIN' AND grant_id IS NULL) OR
        (consumed_by_kind='GRANT' AND grant_id IS NOT NULL))
);

INSERT INTO agent_template_origins (
  agent_id,release_id,mode,consumed_by_kind,consumed_by_human_id,grant_id,
  authority_source_id,content_source_id,package_name,package_version,package_digest,created_at
)
SELECT agent_id,release_id,mode,consumed_by_kind,consumed_by_human_id,NULL,
       authority_source_id,content_source_id,package_name,package_version,package_digest,created_at
FROM agent_template_origins_legacy_034;

DROP TABLE agent_template_origins_legacy_034;
CREATE INDEX idx_agent_template_origins_release ON agent_template_origins(release_id);
CREATE INDEX idx_agent_template_origins_grant ON agent_template_origins(grant_id);

COMMIT;
