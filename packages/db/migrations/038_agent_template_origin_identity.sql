BEGIN IMMEDIATE;

-- Existing origins are trustworthy only when every copied field still identifies the
-- referenced immutable release and the agent/template modes remain compatible.
CREATE TABLE _migration_038_origin_guard (value INTEGER NOT NULL CHECK(value=0));
INSERT OR ROLLBACK INTO _migration_038_origin_guard(value)
SELECT 1
WHERE EXISTS (
  SELECT 1
  FROM agent_template_origins o
  LEFT JOIN agents a ON a.id=o.agent_id
  LEFT JOIN catalog_package_releases r ON r.package_release_id=o.release_id
  WHERE a.id IS NULL OR r.package_release_id IS NULL
     OR o.authority_source_id<>r.authority_source_id
     OR o.content_source_id<>r.content_source_id
     OR o.package_name<>r.name
     OR o.package_version<>r.version
     OR o.package_digest<>r.digest
     OR o.mode<>a.mode
     OR json_valid(r.manifest_json)=0
     OR json_type(r.manifest_json,'$.kind') IS NULL
     OR json_extract(r.manifest_json,'$.kind') IS NOT r.kind
     OR json_type(r.manifest_json,'$.name') IS NULL
     OR json_extract(r.manifest_json,'$.name') IS NOT r.name
     OR json_type(r.manifest_json,'$.version') IS NULL
     OR json_extract(r.manifest_json,'$.version') IS NOT r.version
     OR json_type(r.manifest_json,'$.digest') IS NULL
     OR json_extract(r.manifest_json,'$.digest') IS NOT r.digest
     OR COALESCE(
       (r.kind='native-agent' AND o.mode IN ('CLASSIC','RLM_REPL')
         AND json_type(r.manifest_json,'$.native.mode') IS NOT NULL
         AND json_extract(r.manifest_json,'$.native.mode')=o.mode)
       OR (r.kind='wrapped-agent' AND o.mode='WRAPPED'),
       0
     )=0
);
DROP TABLE _migration_038_origin_guard;

ALTER TABLE agent_template_origins RENAME TO agent_template_origins_legacy_037;

CREATE TABLE agent_template_origins (
  agent_id TEXT PRIMARY KEY NOT NULL REFERENCES agents(id),
  release_id TEXT NOT NULL REFERENCES catalog_package_releases(package_release_id),
  mode TEXT NOT NULL CHECK(mode IN ('CLASSIC','RLM_REPL','WRAPPED')),
  consumed_by_kind TEXT NOT NULL CHECK(consumed_by_kind IN ('ADMIN','GRANT')),
  consumed_by_human_id TEXT NOT NULL REFERENCES humans(id),
  grant_id TEXT REFERENCES catalog_grants(grant_id),
  authority_source_id TEXT NOT NULL REFERENCES catalog_sources(source_id),
  content_source_id TEXT NOT NULL REFERENCES catalog_sources(source_id),
  package_kind TEXT NOT NULL CHECK(package_kind IN ('native-agent','wrapped-agent')),
  package_name TEXT NOT NULL,
  package_version TEXT NOT NULL,
  catalog_commit TEXT NOT NULL CHECK(length(catalog_commit) BETWEEN 1 AND 64),
  package_commit TEXT NOT NULL CHECK(length(package_commit) BETWEEN 1 AND 64),
  package_path TEXT NOT NULL CHECK(length(package_path) BETWEEN 1 AND 4096),
  package_digest TEXT NOT NULL CHECK(length(package_digest)=71 AND substr(package_digest,1,7)='sha256:' AND substr(package_digest,8) NOT GLOB '*[^0-9a-f]*'),
  created_at INTEGER NOT NULL,
  CHECK((consumed_by_kind='ADMIN' AND grant_id IS NULL) OR
        (consumed_by_kind='GRANT' AND grant_id IS NOT NULL)),
  CHECK((package_kind='native-agent' AND mode IN ('CLASSIC','RLM_REPL')) OR
        (package_kind='wrapped-agent' AND mode='WRAPPED'))
);

INSERT INTO agent_template_origins (
  agent_id,release_id,mode,consumed_by_kind,consumed_by_human_id,grant_id,
  authority_source_id,content_source_id,package_kind,package_name,package_version,
  catalog_commit,package_commit,package_path,package_digest,created_at
)
SELECT o.agent_id,o.release_id,o.mode,o.consumed_by_kind,o.consumed_by_human_id,o.grant_id,
       o.authority_source_id,o.content_source_id,r.kind,o.package_name,o.package_version,
       r.catalog_commit,r.package_commit,r.package_path,o.package_digest,o.created_at
FROM agent_template_origins_legacy_037 o
JOIN catalog_package_releases r ON r.package_release_id=o.release_id;

DROP TABLE agent_template_origins_legacy_037;
CREATE INDEX idx_agent_template_origins_release ON agent_template_origins(release_id);
CREATE INDEX idx_agent_template_origins_grant ON agent_template_origins(grant_id);
CREATE INDEX idx_agent_template_origins_identity ON agent_template_origins(
  authority_source_id,content_source_id,package_kind,package_name,package_version,package_digest
);

COMMIT;
