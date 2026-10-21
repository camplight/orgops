ALTER TABLE workspace_publications ADD COLUMN public_path TEXT NOT NULL DEFAULT '';

UPDATE workspace_publications
SET public_path = '/agents/' || agent_name || '/' || slug || '/'
WHERE public_path = '';

CREATE UNIQUE INDEX IF NOT EXISTS uidx_workspace_publications_public_path
  ON workspace_publications(public_path);
