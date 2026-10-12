CREATE TABLE composio_connections (
  id TEXT PRIMARY KEY,
  human_id TEXT NOT NULL REFERENCES humans(id) ON DELETE CASCADE,
  external_user_id TEXT NOT NULL,
  toolkit TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE composio_agent_grants (
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  human_id TEXT NOT NULL REFERENCES humans(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES composio_connections(id) ON DELETE CASCADE,
  tools_json TEXT NOT NULL,
  PRIMARY KEY(agent_id, connection_id)
);
