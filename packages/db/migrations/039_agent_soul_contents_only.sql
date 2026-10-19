PRAGMA foreign_keys=OFF;

CREATE TABLE agents_new (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  icon TEXT NULL,
  description TEXT NULL,
  model_id TEXT NOT NULL,
  soul_contents TEXT NOT NULL DEFAULT '',
  workspace_path TEXT NOT NULL,
  allow_outside_workspace INTEGER NOT NULL DEFAULT 0,
  llm_call_timeout_ms INTEGER NULL,
  classic_max_model_steps INTEGER NULL,
  context_session_gap_ms INTEGER NULL,
  emit_audit_events INTEGER NOT NULL DEFAULT 1,
  memory_context_mode TEXT NOT NULL DEFAULT 'PER_CHANNEL_CROSS_CHANNEL',
  mode TEXT NOT NULL DEFAULT 'CLASSIC',
  visibility TEXT NOT NULL DEFAULT 'PUBLIC',
  owner_human_id TEXT NULL,
  desired_state TEXT NOT NULL DEFAULT 'RUNNING',
  runtime_state TEXT NOT NULL DEFAULT 'STOPPED',
  assigned_runner_id TEXT NULL,
  last_heartbeat_at INTEGER NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  enabled_skills_json TEXT NOT NULL DEFAULT '[]',
  always_preloaded_skills_json TEXT NOT NULL DEFAULT '[]',
  additional_skill_roots_json TEXT NOT NULL DEFAULT '[]',
  allow_owner_human_secrets INTEGER NOT NULL DEFAULT 0,
  wrapped_config_json TEXT NOT NULL DEFAULT '{}'
);

INSERT INTO agents_new (
  id,
  name,
  icon,
  description,
  model_id,
  soul_contents,
  workspace_path,
  allow_outside_workspace,
  llm_call_timeout_ms,
  classic_max_model_steps,
  context_session_gap_ms,
  emit_audit_events,
  memory_context_mode,
  mode,
  visibility,
  owner_human_id,
  desired_state,
  runtime_state,
  assigned_runner_id,
  last_heartbeat_at,
  created_at,
  updated_at,
  enabled_skills_json,
  always_preloaded_skills_json,
  additional_skill_roots_json,
  allow_owner_human_secrets,
  wrapped_config_json
)
SELECT
  id,
  name,
  icon,
  description,
  model_id,
  CASE
    WHEN TRIM(COALESCE(system_instructions, '')) <> ''
      AND TRIM(COALESCE(soul_contents, '')) <> ''
      THEN system_instructions || CHAR(10) || CHAR(10) || soul_contents
    WHEN TRIM(COALESCE(system_instructions, '')) <> ''
      THEN system_instructions
    ELSE COALESCE(soul_contents, '')
  END,
  workspace_path,
  COALESCE(allow_outside_workspace, 0),
  llm_call_timeout_ms,
  classic_max_model_steps,
  context_session_gap_ms,
  COALESCE(emit_audit_events, 1),
  COALESCE(memory_context_mode, 'PER_CHANNEL_CROSS_CHANNEL'),
  COALESCE(mode, 'CLASSIC'),
  COALESCE(visibility, 'PUBLIC'),
  owner_human_id,
  desired_state,
  runtime_state,
  assigned_runner_id,
  last_heartbeat_at,
  created_at,
  updated_at,
  COALESCE(enabled_skills_json, '[]'),
  COALESCE(always_preloaded_skills_json, '[]'),
  COALESCE(additional_skill_roots_json, '[]'),
  COALESCE(allow_owner_human_secrets, 0),
  COALESCE(wrapped_config_json, '{}')
FROM agents;

DROP TABLE agents;
ALTER TABLE agents_new RENAME TO agents;

PRAGMA foreign_keys=ON;
