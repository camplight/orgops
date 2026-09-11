ALTER TABLE agent_invites
  ADD COLUMN agent_visibility TEXT NOT NULL DEFAULT 'PUBLIC';

ALTER TABLE agent_invites
  ADD COLUMN created_by_type TEXT NOT NULL DEFAULT 'HUMAN';

ALTER TABLE agent_invites
  ADD COLUMN created_by_id TEXT;

UPDATE agent_invites
SET created_by_id = COALESCE(created_by_id, created_by_human_id)
WHERE created_by_id IS NULL;
