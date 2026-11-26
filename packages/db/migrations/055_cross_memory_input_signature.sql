ALTER TABLE cross_channel_memory_recent
  ADD COLUMN input_signature TEXT NOT NULL DEFAULT '';

ALTER TABLE cross_channel_memory_full
  ADD COLUMN input_signature TEXT NOT NULL DEFAULT '';
