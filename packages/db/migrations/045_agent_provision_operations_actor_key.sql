PRAGMA foreign_keys=OFF;
BEGIN IMMEDIATE;
CREATE TABLE agent_provision_operations_v045 (
  operation_id TEXT NOT NULL CHECK(length(operation_id) BETWEEN 36 AND 36),
  actor_human_id TEXT NOT NULL REFERENCES humans(id),
  request_digest TEXT NOT NULL CHECK(length(request_digest)=64),
  state TEXT NOT NULL DEFAULT 'COMPLETED' CHECK(state='COMPLETED'),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  receipt_json TEXT NOT NULL CHECK(length(receipt_json) BETWEEN 2 AND 65536),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(actor_human_id, operation_id)
);
INSERT INTO agent_provision_operations_v045
  (operation_id,actor_human_id,request_digest,state,agent_id,receipt_json,created_at,updated_at)
SELECT operation_id,actor_human_id,request_digest,state,agent_id,receipt_json,created_at,updated_at
FROM agent_provision_operations;
DROP TABLE agent_provision_operations;
ALTER TABLE agent_provision_operations_v045 RENAME TO agent_provision_operations;
CREATE INDEX agent_provision_operations_digest ON agent_provision_operations(request_digest);
COMMIT;
PRAGMA foreign_keys=ON;
