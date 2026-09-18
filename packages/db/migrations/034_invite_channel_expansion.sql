ALTER TABLE agent_invites
  ADD COLUMN allow_channel_expansion INTEGER NOT NULL DEFAULT 0;

ALTER TABLE runner_tokens
  ADD COLUMN allow_channel_expansion INTEGER NOT NULL DEFAULT 0;
