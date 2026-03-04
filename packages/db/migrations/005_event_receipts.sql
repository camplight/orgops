CREATE TABLE IF NOT EXISTS event_receipts (
  event_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  delivered_at INTEGER NULL,
  PRIMARY KEY (event_id, agent_name),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_event_receipts_agent_status
  ON event_receipts (agent_name, status, delivered_at);

CREATE INDEX IF NOT EXISTS idx_event_receipts_event_status
  ON event_receipts (event_id, status);

INSERT OR IGNORE INTO event_receipts (event_id, agent_name, status, delivered_at)
SELECT
  recipients.event_id,
  recipients.agent_name,
  recipients.status,
  recipients.delivered_at
FROM (
  SELECT
    e.id AS event_id,
    cs.subscriber_id AS agent_name,
    e.status AS status,
    CASE WHEN e.status = 'DELIVERED' THEN e.created_at ELSE NULL END AS delivered_at
  FROM events e
  JOIN channel_subscriptions cs
    ON cs.channel_id = e.channel_id
   AND cs.subscriber_type = 'AGENT'

  UNION

  SELECT
    e.id AS event_id,
    tm.member_id AS agent_name,
    e.status AS status,
    CASE WHEN e.status = 'DELIVERED' THEN e.created_at ELSE NULL END AS delivered_at
  FROM events e
  JOIN channel_subscriptions cs
    ON cs.channel_id = e.channel_id
   AND cs.subscriber_type = 'TEAM'
  JOIN team_memberships tm
    ON tm.team_id = cs.subscriber_id
   AND tm.member_type = 'AGENT'
) recipients;
