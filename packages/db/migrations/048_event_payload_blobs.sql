CREATE TABLE IF NOT EXISTS event_payload_blobs (
  event_id TEXT PRIMARY KEY,
  storage_path TEXT NOT NULL,
  char_length INTEGER NOT NULL,
  byte_length INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);
