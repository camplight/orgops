BEGIN IMMEDIATE;
ALTER TABLE catalog_sources RENAME TO catalog_sources_legacy_032;
ALTER TABLE catalogs RENAME TO catalogs_legacy_032;
ALTER TABLE catalog_read_credentials RENAME TO catalog_read_credentials_legacy_032;

CREATE TABLE catalog_sources (
  source_id TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 200),
  canonical_url TEXT NOT NULL,
  ssh_user TEXT,
  repository_identity TEXT NOT NULL,
  ref TEXT NOT NULL CHECK(length(ref) BETWEEN 1 AND 1024),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  allow_packages INTEGER NOT NULL CHECK(allow_packages IN (0,1)),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
  removed_at INTEGER,
  current_snapshot_id TEXT REFERENCES catalog_snapshots(snapshot_id) DEFERRABLE INITIALLY DEFERRED,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK(removed_at IS NULL OR (enabled=0 AND allow_packages=0))
);
CREATE UNIQUE INDEX uidx_catalog_sources_repository_ref ON catalog_sources(repository_identity,ref);
CREATE INDEX idx_catalog_sources_current_snapshot ON catalog_sources(current_snapshot_id);

CREATE TABLE catalog_source_read_credentials (
  source_id TEXT PRIMARY KEY NOT NULL REFERENCES catalog_sources(source_id),
  credential_ref TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind='https-basic'),
  ciphertext_b64 TEXT NOT NULL,
  legacy_binding_source_id TEXT,
  legacy_credential_ref TEXT,
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK((legacy_binding_source_id IS NULL)=(legacy_credential_ref IS NULL))
);

CREATE TABLE catalog_sync_attempts (
  attempt_id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL REFERENCES catalog_sources(source_id),
  source_revision INTEGER NOT NULL CHECK(source_revision BETWEEN 1 AND 2147483647),
  state TEXT NOT NULL CHECK(state IN ('RUNNING','SUCCEEDED','FAILED','ABANDONED')),
  resolved_commit TEXT,
  snapshot_id TEXT REFERENCES catalog_snapshots(snapshot_id) DEFERRABLE INITIALLY DEFERRED,
  failure_code TEXT CHECK(failure_code IS NULL OR failure_code IN ('SOURCE_UNAVAILABLE','SOURCE_NOT_ALLOWED','IDENTITY_CONFLICT','INSPECTION_FAILED','STORAGE_FAILURE','SYNC_FAILED')),
  actor_human_id TEXT NOT NULL REFERENCES humans(id),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  CHECK((state='RUNNING' AND completed_at IS NULL) OR (state<>'RUNNING' AND completed_at IS NOT NULL)),
  CHECK((state='FAILED' AND failure_code IS NOT NULL) OR state<>'FAILED')
);
CREATE UNIQUE INDEX uidx_catalog_sync_attempts_running ON catalog_sync_attempts(source_id) WHERE state='RUNNING';
CREATE INDEX idx_catalog_sync_attempts_source_created ON catalog_sync_attempts(source_id,created_at);

CREATE TABLE catalog_snapshots (
  snapshot_id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL REFERENCES catalog_sources(source_id),
  source_commit TEXT NOT NULL,
  index_digest TEXT NOT NULL,
  index_json TEXT NOT NULL CHECK(json_valid(index_json) AND length(CAST(index_json AS BLOB))<=2097152),
  observed_ref TEXT NOT NULL,
  attempt_id TEXT NOT NULL UNIQUE REFERENCES catalog_sync_attempts(attempt_id),
  created_at INTEGER NOT NULL,
  UNIQUE(source_id,source_commit),
  UNIQUE(source_id,source_commit,index_digest,index_json)
);
CREATE INDEX idx_catalog_snapshots_source_created ON catalog_snapshots(source_id,created_at);

CREATE TABLE catalog_package_releases (
  package_release_id TEXT PRIMARY KEY NOT NULL,
  authority_source_id TEXT NOT NULL REFERENCES catalog_sources(source_id),
  content_source_id TEXT NOT NULL REFERENCES catalog_sources(source_id),
  kind TEXT NOT NULL CHECK(kind IN ('skill','native-agent','wrapped-agent')),
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  digest TEXT NOT NULL,
  catalog_commit TEXT NOT NULL,
  package_commit TEXT NOT NULL,
  package_path TEXT NOT NULL,
  manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json) AND length(CAST(manifest_json AS BLOB))<=262144),
  execution_preview_json TEXT NOT NULL CHECK(json_valid(execution_preview_json) AND length(CAST(execution_preview_json AS BLOB))<=262144),
  warnings_json TEXT NOT NULL CHECK(json_valid(warnings_json) AND length(CAST(warnings_json AS BLOB))<=262144),
  created_at INTEGER NOT NULL,
  UNIQUE(authority_source_id,name,version)
);
CREATE INDEX idx_catalog_package_releases_content_source ON catalog_package_releases(content_source_id);
CREATE INDEX idx_catalog_package_releases_kind_name ON catalog_package_releases(kind,name,version);

CREATE TABLE catalog_snapshot_entries (
  snapshot_id TEXT NOT NULL REFERENCES catalog_snapshots(snapshot_id),
  package_release_id TEXT NOT NULL REFERENCES catalog_package_releases(package_release_id),
  ordinal INTEGER NOT NULL CHECK(ordinal>=0),
  PRIMARY KEY(snapshot_id,package_release_id),
  UNIQUE(snapshot_id,ordinal)
);
CREATE INDEX idx_catalog_snapshot_entries_release ON catalog_snapshot_entries(package_release_id);

CREATE TABLE catalog_release_controls (
  package_release_id TEXT PRIMARY KEY NOT NULL REFERENCES catalog_package_releases(package_release_id),
  review_state TEXT NOT NULL CHECK(review_state IN ('PENDING','APPROVED','REJECTED','WITHDRAWN')),
  review_digest TEXT,
  reviewed_by_human_id TEXT REFERENCES humans(id),
  reviewed_at INTEGER,
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK((review_state='PENDING' AND review_digest IS NULL) OR (review_state<>'PENDING' AND review_digest IS NOT NULL))
);
CREATE INDEX idx_catalog_release_controls_state ON catalog_release_controls(review_state,updated_at);

CREATE TABLE catalog_grants (
  grant_id TEXT PRIMARY KEY NOT NULL,
  release_id TEXT NOT NULL REFERENCES catalog_package_releases(package_release_id),
  subject_type TEXT NOT NULL CHECK(subject_type IN ('ORGANIZATION','HUMAN')),
  human_id TEXT REFERENCES humans(id),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
  revoked_at INTEGER,
  created_by_human_id TEXT NOT NULL REFERENCES humans(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK((subject_type='ORGANIZATION' AND human_id IS NULL) OR (subject_type='HUMAN' AND human_id IS NOT NULL))
);
CREATE UNIQUE INDEX uidx_catalog_grants_live_subject ON catalog_grants(release_id,subject_type,COALESCE(human_id,'')) WHERE revoked_at IS NULL;
CREATE INDEX idx_catalog_grants_human ON catalog_grants(human_id,release_id) WHERE revoked_at IS NULL;

CREATE TABLE catalog_install_operations (
  operation_id TEXT PRIMARY KEY NOT NULL,
  root_release_id TEXT NOT NULL REFERENCES catalog_package_releases(package_release_id),
  closure_digest TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('PENDING','INSTALLING','INSTALLED','FAILED')),
  actor_human_id TEXT NOT NULL REFERENCES humans(id),
  failure_code TEXT CHECK(failure_code IS NULL OR failure_code IN ('RELEASE_NOT_APPROVED','SOURCE_NOT_ALLOWED','SOURCE_UNAVAILABLE','IDENTITY_CONFLICT','INSPECTION_FAILED','STORAGE_FAILURE')),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  CHECK((state='FAILED' AND failure_code IS NOT NULL) OR state<>'FAILED')
);
CREATE INDEX idx_catalog_install_operations_release ON catalog_install_operations(root_release_id,created_at);

CREATE TABLE catalog_installations (
  release_id TEXT PRIMARY KEY NOT NULL REFERENCES catalog_package_releases(package_release_id),
  artifact_digest TEXT NOT NULL,
  artifact_path TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('INSTALLED','QUARANTINED')),
  installed_by_human_id TEXT NOT NULL REFERENCES humans(id),
  installed_at INTEGER NOT NULL,
  last_verified_at INTEGER NOT NULL,
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647)
);
CREATE INDEX idx_catalog_installations_state ON catalog_installations(state,last_verified_at);

CREATE TABLE catalog_api_activations (
  release_id TEXT PRIMARY KEY NOT NULL REFERENCES catalog_package_releases(package_release_id),
  approval_state TEXT NOT NULL CHECK(approval_state IN ('NOT_REQUIRED','AWAITING_APPROVAL','APPROVED','REVOKED')),
  runtime_state TEXT NOT NULL CHECK(runtime_state IN ('INACTIVE','ACTIVATING','ACTIVE','DEACTIVATING','FAILED')),
  failure_code TEXT CHECK(failure_code IS NULL OR failure_code IN ('INSTALLATION_REQUIRED','API_ACTIVATION_REQUIRED','INSPECTION_FAILED','STORAGE_FAILURE')),
  approved_by_human_id TEXT REFERENCES humans(id),
  approved_at INTEGER,
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK((runtime_state='FAILED' AND failure_code IS NOT NULL) OR runtime_state<>'FAILED')
);
CREATE INDEX idx_catalog_api_activations_runtime ON catalog_api_activations(runtime_state,approval_state);

CREATE TABLE agent_template_origins (
  agent_id TEXT PRIMARY KEY NOT NULL REFERENCES agents(id),
  release_id TEXT NOT NULL REFERENCES catalog_package_releases(package_release_id),
  mode TEXT NOT NULL CHECK(mode IN ('CLASSIC','RLM_REPL','WRAPPED')),
  consumed_by_kind TEXT NOT NULL CHECK(consumed_by_kind IN ('ADMIN','GRANT')),
  consumed_by_human_id TEXT NOT NULL REFERENCES humans(id),
  authority_source_id TEXT NOT NULL,
  content_source_id TEXT NOT NULL,
  package_name TEXT NOT NULL,
  package_version TEXT NOT NULL,
  package_digest TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_agent_template_origins_release ON agent_template_origins(release_id);

CREATE TABLE agent_package_secret_bindings (
  agent_id TEXT NOT NULL REFERENCES agents(id),
  release_id TEXT NOT NULL REFERENCES catalog_package_releases(package_release_id),
  requirement_name TEXT NOT NULL,
  secret_id TEXT NOT NULL REFERENCES secrets(id),
  created_by_human_id TEXT NOT NULL REFERENCES humans(id),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(agent_id,release_id,requirement_name)
);
CREATE INDEX idx_agent_package_secret_bindings_secret ON agent_package_secret_bindings(secret_id);

CREATE TABLE agent_skill_assignments (
  assignment_id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  release_id TEXT NOT NULL REFERENCES catalog_package_releases(package_release_id),
  local_skill_name TEXT NOT NULL,
  desired_state TEXT NOT NULL CHECK(desired_state IN ('DISABLED','ENABLED')),
  effective_state TEXT NOT NULL CHECK(effective_state IN ('DISABLED','ENABLED')),
  deployment_state TEXT NOT NULL CHECK(deployment_state IN ('STABLE','REQUESTED','DEPLOYING','FAILED')),
  preload INTEGER NOT NULL CHECK(preload IN (0,1)),
  active_generation TEXT,
  desired_generation TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
  actor_kind TEXT NOT NULL CHECK(actor_kind IN ('ADMIN','GRANT')),
  actor_human_id TEXT NOT NULL REFERENCES humans(id),
  grant_id TEXT REFERENCES catalog_grants(grant_id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(agent_id,local_skill_name),
  CHECK((actor_kind='ADMIN' AND grant_id IS NULL) OR (actor_kind='GRANT' AND grant_id IS NOT NULL)),
  CHECK((deployment_state='STABLE' AND active_generation=desired_generation) OR deployment_state<>'STABLE')
);
CREATE INDEX idx_agent_skill_assignments_release ON agent_skill_assignments(release_id);
CREATE INDEX idx_agent_skill_assignments_deployment ON agent_skill_assignments(agent_id,deployment_state);

CREATE TABLE catalog_rollouts (
  rollout_id TEXT PRIMARY KEY NOT NULL,
  release_id TEXT NOT NULL REFERENCES catalog_package_releases(package_release_id),
  operation TEXT NOT NULL CHECK(operation IN ('ENABLE','DISABLE','SET_PRELOAD')),
  preload INTEGER CHECK(preload IN (0,1)),
  plan_digest TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('DRAFT','QUEUED','RUNNING','SUCCEEDED','PARTIAL','FAILED','CANCELLED')),
  actor_kind TEXT NOT NULL CHECK(actor_kind IN ('ADMIN','GRANT')),
  actor_human_id TEXT NOT NULL REFERENCES humans(id),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  CHECK((operation='SET_PRELOAD' AND preload IS NOT NULL) OR (operation<>'SET_PRELOAD' AND preload IS NULL))
);
CREATE INDEX idx_catalog_rollouts_release_created ON catalog_rollouts(release_id,created_at);

CREATE TABLE catalog_rollout_targets (
  rollout_id TEXT NOT NULL REFERENCES catalog_rollouts(rollout_id),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  captured_runner_id TEXT NOT NULL REFERENCES runner_nodes(id),
  expected_assignment_revision INTEGER NOT NULL CHECK(expected_assignment_revision BETWEEN 0 AND 2147483647),
  state TEXT NOT NULL CHECK(state IN ('QUEUED','BLOCKED','STAGING','VERIFYING','WAITING_FOR_IDLE','ACTIVATING','SUCCEEDED','FAILED','SKIPPED','SUPERSEDED')),
  attempts INTEGER NOT NULL CHECK(attempts BETWEEN 0 AND 2147483647),
  reason_code TEXT CHECK(reason_code IS NULL OR reason_code IN ('FORBIDDEN','REVISION_CONFLICT','STATE_CONFLICT','GRANT_REQUIRED','INSTALLATION_REQUIRED','DEPLOYMENT_REQUIRED','API_ACTIVATION_REQUIRED','SECRET_BINDING_MISSING','RUNNER_BINDING_MISSING','MODEL_BINDING_MISSING','WORKSPACE_BINDING_MISSING','WRAPPED_WIRING_MISSING','QUARANTINED','REQUIREMENTS_UNSATISFIED','DEPLOYMENT_SUPERSEDED','INSPECTION_FAILED','STORAGE_FAILURE')),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  PRIMARY KEY(rollout_id,agent_id)
);
CREATE INDEX idx_catalog_rollout_targets_runner_state ON catalog_rollout_targets(captured_runner_id,state);
CREATE INDEX idx_catalog_rollout_targets_agent ON catalog_rollout_targets(agent_id,updated_at);

CREATE TABLE runner_package_deployments (
  deployment_id TEXT PRIMARY KEY NOT NULL,
  rollout_id TEXT REFERENCES catalog_rollouts(rollout_id),
  target_agent_id TEXT NOT NULL REFERENCES agents(id),
  release_id TEXT NOT NULL REFERENCES catalog_package_releases(package_release_id),
  bound_runner_id TEXT NOT NULL REFERENCES runner_nodes(id),
  desired_generation TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('QUEUED','CLAIMED','STAGED','WAITING_FOR_IDLE','ACTIVE','FAILED','SUPERSEDED')),
  attempt_token TEXT,
  lease_expires_at INTEGER,
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
  failure_code TEXT CHECK(failure_code IS NULL OR failure_code IN ('DEPLOYMENT_SUPERSEDED','INSPECTION_FAILED','STORAGE_FAILURE')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE(target_agent_id,desired_generation),
  CHECK((state IN ('CLAIMED','STAGED','WAITING_FOR_IDLE') AND attempt_token IS NOT NULL) OR state NOT IN ('CLAIMED','STAGED','WAITING_FOR_IDLE')),
  CHECK((state='FAILED' AND failure_code IS NOT NULL) OR state<>'FAILED')
);
CREATE INDEX idx_runner_package_deployments_poll ON runner_package_deployments(bound_runner_id,state,created_at);
CREATE INDEX idx_runner_package_deployments_agent ON runner_package_deployments(target_agent_id,updated_at);
CREATE UNIQUE INDEX uidx_runner_package_deployments_live_agent ON runner_package_deployments(target_agent_id) WHERE state IN ('QUEUED','CLAIMED','STAGED','WAITING_FOR_IDLE');

INSERT INTO catalog_sources (
  source_id,display_name,canonical_url,ssh_user,repository_identity,ref,
  enabled,allow_packages,revision,removed_at,current_snapshot_id,created_at,updated_at
)
SELECT MIN(c.catalog_id),
       (SELECT c2.display_name
        FROM catalogs_legacy_032 c2
        JOIN catalog_sources_legacy_032 s2 ON s2.source_id=c2.source_id
        WHERE s2.repository_identity=s.repository_identity AND c2.ref=c.ref
        ORDER BY c2.catalog_id LIMIT 1),
       s.canonical_url,s.ssh_user,s.repository_identity,c.ref,
       CASE WHEN s.removed_at IS NULL AND MAX(CASE WHEN c.removed_at IS NULL THEN c.enabled ELSE 0 END)=1 THEN 1 ELSE 0 END,
       CASE WHEN s.removed_at IS NULL AND MAX(CASE WHEN c.removed_at IS NULL THEN 1 ELSE 0 END)=1 THEN s.allow_packages ELSE 0 END,
       MAX(MAX(s.revision,c.revision)),
       CASE WHEN s.removed_at IS NULL AND MAX(CASE WHEN c.removed_at IS NULL THEN 1 ELSE 0 END)=1
            THEN NULL ELSE COALESCE(s.removed_at,MIN(c.removed_at)) END,
       NULL,MIN(MIN(s.created_at,c.created_at)),MAX(MAX(s.updated_at,c.updated_at))
FROM catalogs_legacy_032 c
JOIN catalog_sources_legacy_032 s ON s.source_id=c.source_id
GROUP BY s.repository_identity,c.ref;

INSERT INTO catalog_source_read_credentials (
  source_id,credential_ref,kind,ciphertext_b64,legacy_binding_source_id,
  legacy_credential_ref,revision,created_at,updated_at
)
SELECT MIN(c.catalog_id),'migrated:' || MIN(c.catalog_id) || ':' || rc.credential_ref,
       rc.kind,rc.ciphertext_b64,rc.source_id,rc.credential_ref,1,rc.created_at,rc.updated_at
FROM catalogs_legacy_032 c
JOIN catalog_sources_legacy_032 s ON s.source_id=c.source_id
JOIN catalog_read_credentials_legacy_032 rc ON rc.source_id=c.source_id
GROUP BY s.repository_identity,c.ref,rc.kind,rc.ciphertext_b64,rc.source_id,rc.credential_ref,rc.created_at,rc.updated_at;

COMMIT;
