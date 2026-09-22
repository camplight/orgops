CREATE TABLE IF NOT EXISTS agent_provision_operations (
  operation_id TEXT PRIMARY KEY NOT NULL CHECK(length(operation_id) BETWEEN 36 AND 36),
  actor_human_id TEXT NOT NULL REFERENCES humans(id),
  request_digest TEXT NOT NULL CHECK(length(request_digest)=64),
  state TEXT NOT NULL CHECK(state='COMPLETED'),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  receipt_json TEXT NOT NULL CHECK(length(receipt_json) BETWEEN 2 AND 65536),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(actor_human_id, operation_id)
);
CREATE INDEX IF NOT EXISTS agent_provision_operations_digest ON agent_provision_operations(request_digest);
