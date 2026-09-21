CREATE TABLE IF NOT EXISTS channel_viewers (
  channel_id TEXT NOT NULL,
  viewer_type TEXT NOT NULL,
  viewer_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (channel_id, viewer_type, viewer_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_viewers_channel
  ON channel_viewers(channel_id, viewer_type);

CREATE INDEX IF NOT EXISTS idx_channel_viewers_viewer
  ON channel_viewers(viewer_type, viewer_id);
