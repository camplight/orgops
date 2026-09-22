BEGIN IMMEDIATE;

ALTER TABLE runner_package_deployments ADD COLUMN desired_roots_json TEXT CHECK(desired_roots_json IS NULL OR (json_valid(desired_roots_json) AND length(CAST(desired_roots_json AS BLOB))<=262144));
ALTER TABLE runner_package_deployments ADD COLUMN package_set_digest TEXT CHECK(package_set_digest IS NULL OR (length(package_set_digest)=71 AND substr(package_set_digest,1,7)='sha256:' AND substr(package_set_digest,8) NOT GLOB '*[^0-9a-f]*'));
ALTER TABLE runner_package_deployments ADD COLUMN artifact_semantic_digest TEXT CHECK(artifact_semantic_digest IS NULL OR (length(artifact_semantic_digest)=71 AND substr(artifact_semantic_digest,1,7)='sha256:' AND substr(artifact_semantic_digest,8) NOT GLOB '*[^0-9a-f]*'));

CREATE TABLE runner_deployment_participants (
  deployment_id TEXT NOT NULL REFERENCES runner_package_deployments(deployment_id) ON DELETE CASCADE,
  assignment_id TEXT NOT NULL REFERENCES agent_skill_assignments(assignment_id),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  release_id TEXT NOT NULL REFERENCES catalog_package_releases(package_release_id),
  local_skill_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('APPLY_DESIRED','CARRY_EFFECTIVE')),
  target_state TEXT NOT NULL CHECK(target_state IN ('DISABLED','ENABLED')),
  target_preload INTEGER NOT NULL CHECK(target_preload IN (0,1)),
  prior_effective_state TEXT NOT NULL CHECK(prior_effective_state IN ('DISABLED','ENABLED')),
  prior_effective_preload INTEGER NOT NULL CHECK(prior_effective_preload IN (0,1)),
  prior_active_generation TEXT,
  assignment_revision INTEGER NOT NULL CHECK(assignment_revision BETWEEN 1 AND 2147483647),
  PRIMARY KEY(deployment_id,assignment_id),
  UNIQUE(deployment_id,local_skill_name),
  CHECK((target_state='ENABLED') OR target_preload=0),
  CHECK((prior_effective_state='ENABLED') OR prior_effective_preload=0)
);
CREATE INDEX idx_runner_deployment_participants_assignment ON runner_deployment_participants(assignment_id,deployment_id);
CREATE INDEX idx_runner_deployment_participants_agent ON runner_deployment_participants(agent_id,deployment_id);

COMMIT;
