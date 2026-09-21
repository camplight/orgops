BEGIN IMMEDIATE;
CREATE TEMP TABLE catalog_rollout_planned_preload_validation (value INTEGER NOT NULL CHECK(value IN (0,1)));
INSERT INTO catalog_rollout_planned_preload_validation(value)
  SELECT CASE
    WHEN r.operation='SET_PRELOAD' THEN r.preload
    WHEN r.operation='DISABLE' OR t.prior_assignment_json IS NULL OR json_type(t.prior_assignment_json,'$')='null' THEN 0
    WHEN json_type(t.prior_assignment_json,'$.preload')='integer'
      AND json_extract(t.prior_assignment_json,'$.preload') IN (0,1) THEN json_extract(t.prior_assignment_json,'$.preload')
    ELSE -1
  END
  FROM catalog_rollout_targets t JOIN catalog_rollouts r ON r.rollout_id=t.rollout_id;
DROP TABLE catalog_rollout_planned_preload_validation;
DROP INDEX IF EXISTS idx_catalog_rollout_targets_runner_state;
DROP INDEX IF EXISTS idx_catalog_rollout_targets_agent;
ALTER TABLE catalog_rollout_targets RENAME TO catalog_rollout_targets_041;
CREATE TABLE catalog_rollout_targets (
  rollout_id TEXT NOT NULL REFERENCES catalog_rollouts(rollout_id),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  captured_runner_id TEXT REFERENCES runner_nodes(id),
  target_ordinal INTEGER NOT NULL DEFAULT 0 CHECK(target_ordinal BETWEEN 0 AND 255),
  expected_assignment_revision INTEGER NOT NULL CHECK(expected_assignment_revision BETWEEN 0 AND 2147483647),
  planned_preload INTEGER NOT NULL DEFAULT 0 CHECK(planned_preload IN (0,1)),
  state TEXT NOT NULL CHECK(state IN ('QUEUED','BLOCKED','STAGING','VERIFYING','WAITING_FOR_IDLE','ACTIVATING','SUCCEEDED','FAILED','SKIPPED','SUPERSEDED')),
  attempts INTEGER NOT NULL CHECK(attempts BETWEEN 0 AND 2147483647),
  reason_code TEXT CHECK(reason_code IS NULL OR reason_code IN ('FORBIDDEN','REVISION_CONFLICT','STATE_CONFLICT','GRANT_REQUIRED','INSTALLATION_REQUIRED','DEPLOYMENT_REQUIRED','API_ACTIVATION_REQUIRED','SECRET_BINDING_MISSING','RUNNER_BINDING_MISSING','MODEL_BINDING_MISSING','WORKSPACE_BINDING_MISSING','WRAPPED_WIRING_MISSING','QUARANTINED','REQUIREMENTS_UNSATISFIED','DEPLOYMENT_SUPERSEDED','INSPECTION_FAILED','STORAGE_FAILURE')),
  blocker_json TEXT CHECK(blocker_json IS NULL OR (length(CAST(blocker_json AS BLOB)) <= 16384 AND json_valid(blocker_json))),
  prior_assignment_json TEXT CHECK(prior_assignment_json IS NULL OR (length(CAST(prior_assignment_json AS BLOB)) <= 16384 AND json_valid(prior_assignment_json) AND (json_type(prior_assignment_json,'$')='null' OR (json_type(prior_assignment_json,'$.preload')='integer' AND json_extract(prior_assignment_json,'$.preload') IN (0,1))))),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  PRIMARY KEY(rollout_id,agent_id), UNIQUE(rollout_id,target_ordinal)
);
CREATE INDEX idx_catalog_rollout_targets_runner_state ON catalog_rollout_targets(captured_runner_id,state);
CREATE INDEX idx_catalog_rollout_targets_agent ON catalog_rollout_targets(agent_id,updated_at);
INSERT INTO catalog_rollout_targets (rollout_id,agent_id,captured_runner_id,target_ordinal,expected_assignment_revision,planned_preload,state,attempts,reason_code,blocker_json,prior_assignment_json,revision,created_at,updated_at,completed_at)
  SELECT t.rollout_id,t.agent_id,t.captured_runner_id,t.target_ordinal,t.expected_assignment_revision,
    CASE
      WHEN r.operation='SET_PRELOAD' THEN r.preload
      WHEN r.operation='DISABLE' THEN 0
      WHEN t.prior_assignment_json IS NULL OR json_type(t.prior_assignment_json,'$')='null' THEN 0
      WHEN json_type(t.prior_assignment_json,'$.preload')='integer'
        AND json_extract(t.prior_assignment_json,'$.preload') IN (0,1) THEN json_extract(t.prior_assignment_json,'$.preload')
      ELSE -1
    END,
    t.state,t.attempts,t.reason_code,t.blocker_json,t.prior_assignment_json,t.revision,t.created_at,t.updated_at,t.completed_at
  FROM catalog_rollout_targets_041 t JOIN catalog_rollouts r ON r.rollout_id=t.rollout_id;
DROP TABLE catalog_rollout_targets_041;
COMMIT;
