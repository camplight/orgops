ALTER TABLE agent_skill_assignments ADD COLUMN removal_requested INTEGER NOT NULL DEFAULT 0 CHECK(removal_requested IN (0,1));
CREATE INDEX idx_agent_skill_assignments_removal ON agent_skill_assignments(agent_id,removal_requested);
