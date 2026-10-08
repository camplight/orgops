ALTER TABLE agents
  ADD COLUMN additional_skill_roots_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE agents
  ADD COLUMN allow_owner_human_secrets INTEGER NOT NULL DEFAULT 0;
