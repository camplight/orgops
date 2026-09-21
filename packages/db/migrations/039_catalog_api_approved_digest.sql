BEGIN IMMEDIATE;

CREATE TABLE catalog_api_activations_new_039 (
  release_id TEXT PRIMARY KEY NOT NULL REFERENCES catalog_package_releases(package_release_id),
  approval_state TEXT NOT NULL CHECK(approval_state IN ('NOT_REQUIRED','AWAITING_APPROVAL','APPROVED','REVOKED')),
  runtime_state TEXT NOT NULL CHECK(runtime_state IN ('INACTIVE','ACTIVATING','ACTIVE','DEACTIVATING','FAILED')),
  failure_code TEXT CHECK(failure_code IS NULL OR failure_code IN ('INSTALLATION_REQUIRED','API_ACTIVATION_REQUIRED','INSPECTION_FAILED','STORAGE_FAILURE')),
  approved_digest TEXT,
  approved_by_human_id TEXT REFERENCES humans(id),
  approved_at INTEGER,
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK((approval_state='APPROVED' AND approved_digest IS NOT NULL
          AND typeof(approved_by_human_id)='text' AND length(approved_by_human_id) BETWEEN 1 AND 200
          AND typeof(approved_at)='integer' AND approved_at BETWEEN 0 AND 9007199254740991)
     OR (approval_state<>'APPROVED' AND approved_digest IS NULL AND approved_by_human_id IS NULL AND approved_at IS NULL)),
  CHECK((runtime_state IN ('ACTIVE','ACTIVATING','DEACTIVATING') AND approval_state='APPROVED')
     OR runtime_state NOT IN ('ACTIVE','ACTIVATING','DEACTIVATING')),
  CHECK((runtime_state='FAILED' AND failure_code IS NOT NULL) OR (runtime_state<>'FAILED' AND failure_code IS NULL)),
  CHECK(approved_digest IS NULL OR (length(approved_digest)=71 AND substr(approved_digest,1,7)='sha256:' AND substr(approved_digest,8) NOT GLOB '*[^0-9a-f]*'))
);

-- Valid legacy approvals are bound to the immutable release digest. Malformed
-- approvals are made safely REVOKED/INACTIVE rather than remaining executable.
INSERT INTO catalog_api_activations_new_039 (
  release_id,approval_state,runtime_state,failure_code,approved_digest,
  approved_by_human_id,approved_at,revision,created_at,updated_at
)
WITH classified AS (
  SELECT a.*,r.digest,
    CASE WHEN (a.runtime_state='FAILED' AND a.failure_code IN ('INSTALLATION_REQUIRED','API_ACTIVATION_REQUIRED','INSPECTION_FAILED','STORAGE_FAILURE'))
             OR (a.runtime_state<>'FAILED' AND a.failure_code IS NULL)
         THEN 1 ELSE 0 END AS valid_failure,
    CASE WHEN typeof(a.approved_by_human_id)='text' AND length(a.approved_by_human_id) BETWEEN 1 AND 200
           AND typeof(a.approved_at)='integer' AND a.approved_at BETWEEN 0 AND 9007199254740991
           AND length(r.digest)=71 AND substr(r.digest,1,7)='sha256:'
           AND substr(r.digest,8) NOT GLOB '*[^0-9a-f]*'
         THEN 1 ELSE 0 END AS valid_approval_binding
  FROM catalog_api_activations a
  LEFT JOIN catalog_package_releases r ON r.package_release_id=a.release_id
), validated AS (
  SELECT classified.*,
    CASE WHEN approval_state='APPROVED' AND valid_failure=1 AND valid_approval_binding=1 THEN 1 ELSE 0 END AS valid_approval,
    CASE WHEN valid_failure=1 AND (approval_state<>'APPROVED' OR valid_approval_binding=1) THEN 1 ELSE 0 END AS valid_row
  FROM classified
)
SELECT release_id,
  CASE WHEN valid_row=1 THEN approval_state ELSE 'REVOKED' END,
  CASE WHEN valid_row=1 THEN runtime_state ELSE 'INACTIVE' END,
  CASE WHEN valid_row=1 THEN failure_code ELSE NULL END,
  CASE WHEN valid_approval=1 THEN digest ELSE NULL END,
  CASE WHEN valid_approval=1 THEN approved_by_human_id ELSE NULL END,
  CASE WHEN valid_approval=1 THEN approved_at ELSE NULL END,
  revision,created_at,updated_at
FROM validated;

DROP TABLE catalog_api_activations;
ALTER TABLE catalog_api_activations_new_039 RENAME TO catalog_api_activations;
CREATE INDEX idx_catalog_api_activations_runtime ON catalog_api_activations(runtime_state,approval_state);

COMMIT;
