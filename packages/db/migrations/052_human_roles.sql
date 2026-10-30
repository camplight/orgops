ALTER TABLE humans
  ADD COLUMN human_role TEXT NOT NULL DEFAULT 'MEMBER';

UPDATE humans
  SET human_role = 'OWNER'
  WHERE id = (
    SELECT id
    FROM humans
    ORDER BY created_at, id
    LIMIT 1
  );
