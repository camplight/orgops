ALTER TABLE agent_invites
  ADD COLUMN runner_scope_mode TEXT NOT NULL DEFAULT 'SCOPED';

ALTER TABLE runner_tokens
  ADD COLUMN runner_scope_mode TEXT NOT NULL DEFAULT 'SCOPED';
