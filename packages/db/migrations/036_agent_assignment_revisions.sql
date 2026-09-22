BEGIN IMMEDIATE;

ALTER TABLE agents ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK(revision BETWEEN 1 AND 2147483647);
ALTER TABLE agent_skill_assignments ADD COLUMN effective_preload INTEGER NOT NULL DEFAULT 0 CHECK(effective_preload IN (0,1));
UPDATE agent_skill_assignments SET effective_preload=preload WHERE deployment_state='STABLE';

COMMIT;
