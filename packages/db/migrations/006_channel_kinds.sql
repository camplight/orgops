ALTER TABLE channels ADD COLUMN kind TEXT NOT NULL DEFAULT 'GROUP';
ALTER TABLE channels ADD COLUMN direct_participant_key TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_channels_direct_participant_key
ON channels (direct_participant_key)
WHERE direct_participant_key IS NOT NULL;
