ALTER TABLE agents
  ADD COLUMN agent_role TEXT NOT NULL DEFAULT 'STANDARD';

UPDATE agents
  SET agent_role = 'SYSTEM'
  WHERE name = 'system';
