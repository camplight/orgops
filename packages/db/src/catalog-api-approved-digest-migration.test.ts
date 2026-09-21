import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDb, type OrgOpsDb } from "./index";

const migrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function migrateThrough038(db: OrgOpsDb) {
  const root = mkdtempSync(join(tmpdir(), "orgops-migrations-038-")); roots.push(root);
  for (const file of readdirSync(migrationsDir).filter(file => /^\d+.*\.sql$/.test(file) && file < "039_")) {
    cpSync(join(migrationsDir, file), join(root, basename(file)));
  }
  migrate(db, root);
}

const digest = `sha256:${"a".repeat(64)}`;
function seed(db: OrgOpsDb) {
  const manifest = { formatVersion: 1, kind: "skill", name: "demo", version: "1.0.0", description: "fixture", author: "OrgOps", license: "MIT",
    compatibility: { orgops: { min: "0.0.1" }, platforms: ["linux"], tools: [] }, secrets: [], dependencies: [], files: [], executables: [], digest,
    skill: { entrypoint: "SKILL.md" } };
  db.exec(`
    INSERT INTO humans (id,username,password_hash,must_change_password,is_admin,created_at,updated_at) VALUES ('human-a','human-a','x',0,1,1,1);
    INSERT INTO catalog_sources (source_id,display_name,canonical_url,repository_identity,ref,enabled,allow_packages,revision,created_at,updated_at)
      VALUES ('source-a','A','https://example.test/a','identity','main',1,0,1,1,1);
  `);
  db.prepare(`INSERT INTO catalog_package_releases
    (package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,manifest_json,execution_preview_json,warnings_json,created_at)
    VALUES ('release-a','source-a','source-a','skill','demo','1.0.0',?,'a','a','skills/demo',?,'{}','[]',1)`)
    .run(digest, JSON.stringify(manifest));
}

describe("migration 039 exact API approval digest", () => {
  it("creates the constrained binding on fresh databases and remains idempotent", () => {
    const db = openDb(":memory:");
    try {
      migrate(db); migrate(db);
      expect(db.prepare("PRAGMA table_info(catalog_api_activations)").all()).toContainEqual(expect.objectContaining({ name: "approved_digest", notnull: 0 }));
      expect(db.prepare("SELECT count(*) AS count FROM migrations WHERE id='039_catalog_api_approved_digest.sql'").get()).toEqual({ count: 1 });
    } finally { db.close(); }
  });

  it("binds valid legacy approvals and safely revokes malformed approvals", () => {
    const db = openDb(":memory:");
    try {
      migrateThrough038(db); seed(db);
      db.prepare(`INSERT INTO catalog_api_activations
        (release_id,approval_state,runtime_state,failure_code,approved_by_human_id,approved_at,revision,created_at,updated_at)
        VALUES ('release-a','APPROVED','ACTIVE',NULL,'human-a',1,2,1,1)`).run();
      migrate(db);
      expect(db.prepare("SELECT approval_state,runtime_state,approved_digest,approved_by_human_id,approved_at FROM catalog_api_activations").get())
        .toEqual({ approval_state: "APPROVED", runtime_state: "ACTIVE", approved_digest: digest, approved_by_human_id: "human-a", approved_at: 1 });

      db.prepare("DELETE FROM catalog_api_activations").run();
      expect(() => db.prepare(`INSERT INTO catalog_api_activations
        (release_id,approval_state,runtime_state,failure_code,approved_digest,approved_by_human_id,approved_at,revision,created_at,updated_at)
        VALUES ('release-a','APPROVED','ACTIVE',NULL,NULL,'human-a',1,1,1,1)`).run()).toThrow();
      expect(() => db.prepare(`INSERT INTO catalog_api_activations
        (release_id,approval_state,runtime_state,failure_code,approved_digest,approved_by_human_id,approved_at,revision,created_at,updated_at)
        VALUES ('release-a','REVOKED','ACTIVE',NULL,NULL,NULL,NULL,1,1,1)`).run()).toThrow();
    } finally { db.close(); }
  });

  it.each([
    ["missing approver", null, 1, null],
    ["invalid approver ID", "x".repeat(201), 1, null],
    ["text timestamp", "human-a", "bad", null],
    ["fractional timestamp", "human-a", 1.5, null],
    ["negative timestamp", "human-a", -1, null],
    ["unsafe timestamp", "human-a", 9_007_199_254_740_992, null],
    ["failure code on ACTIVE", "human-a", 1, "INSPECTION_FAILED"],
  ] as const)("turns a malformed legacy APPROVED row (%s) into REVOKED and INACTIVE", (_case, approver, approvedAt, failureCode) => {
    const db = openDb(":memory:");
    try {
      migrateThrough038(db); seed(db);
      if (approver && approver !== "human-a") {
        db.prepare("INSERT INTO humans (id,username,password_hash,must_change_password,is_admin,created_at,updated_at) VALUES (?,?,'x',0,0,1,1)")
          .run(approver, "invalid-approver");
      }
      db.prepare(`INSERT INTO catalog_api_activations
        (release_id,approval_state,runtime_state,failure_code,approved_by_human_id,approved_at,revision,created_at,updated_at)
        VALUES ('release-a','APPROVED','ACTIVE',?,?,?,2,1,1)`).run(failureCode, approver, approvedAt);
      migrate(db);
      expect(db.prepare("SELECT approval_state,runtime_state,failure_code,approved_digest,approved_by_human_id,approved_at FROM catalog_api_activations").get())
        .toEqual({ approval_state: "REVOKED", runtime_state: "INACTIVE", failure_code: null, approved_digest: null, approved_by_human_id: null, approved_at: null });
    } finally { db.close(); }
  });

  it.each([
    ["APPROVED FAILED", "APPROVED", "FAILED"],
    ["AWAITING_APPROVAL INACTIVE", "AWAITING_APPROVAL", "INACTIVE"],
    ["NOT_REQUIRED INACTIVE", "NOT_REQUIRED", "INACTIVE"],
  ] as const)("normalizes an arbitrary failure code on %s instead of aborting", (_case, approvalState, runtimeState) => {
    const db = openDb(":memory:");
    try {
      migrateThrough038(db); seed(db);
      db.pragma("ignore_check_constraints = ON");
      db.prepare(`INSERT INTO catalog_api_activations
        (release_id,approval_state,runtime_state,failure_code,approved_by_human_id,approved_at,revision,created_at,updated_at)
        VALUES ('release-a',?,?, 'ARBITRARY_UNSAFE_CODE',NULL,NULL,2,1,1)`).run(approvalState, runtimeState);
      db.pragma("ignore_check_constraints = OFF");
      migrate(db);
      expect(db.prepare("SELECT approval_state,runtime_state,failure_code,approved_digest,approved_by_human_id,approved_at FROM catalog_api_activations").get())
        .toEqual({ approval_state: "REVOKED", runtime_state: "INACTIVE", failure_code: null, approved_digest: null, approved_by_human_id: null, approved_at: null });
    } finally { db.close(); }
  });

  it("fails without committing when a corrupted legacy approval has no immutable release", () => {
    const db = openDb(":memory:");
    try {
      migrateThrough038(db); seed(db);
      db.pragma("foreign_keys=OFF");
      db.prepare(`INSERT INTO catalog_api_activations
        (release_id,approval_state,runtime_state,failure_code,approved_by_human_id,approved_at,revision,created_at,updated_at)
        VALUES ('release-missing','APPROVED','ACTIVE',NULL,'human-a',1,2,1,1)`).run();
      db.pragma("foreign_keys=ON");
      expect(() => migrate(db)).toThrow();
      if (db.inTransaction) db.exec("ROLLBACK");
      expect(db.prepare("SELECT approval_state,runtime_state FROM catalog_api_activations WHERE release_id='release-missing'").get())
        .toEqual({ approval_state: "APPROVED", runtime_state: "ACTIVE" });
      expect(db.prepare("SELECT 1 FROM migrations WHERE id='039_catalog_api_approved_digest.sql'").get()).toBeUndefined();
    } finally { db.close(); }
  });

  it("preserves valid APPROVED FAILED and non-approved legacy rows under exact constraints", () => {
    const db = openDb(":memory:");
    try {
      migrateThrough038(db); seed(db);
      db.prepare(`INSERT INTO catalog_api_activations
        (release_id,approval_state,runtime_state,failure_code,approved_by_human_id,approved_at,revision,created_at,updated_at)
        VALUES ('release-a','APPROVED','FAILED','INSPECTION_FAILED','human-a',1,2,1,1)`).run();
      migrate(db);
      expect(db.prepare("SELECT approval_state,runtime_state,failure_code,approved_digest,approved_by_human_id,approved_at FROM catalog_api_activations").get())
        .toEqual({ approval_state: "APPROVED", runtime_state: "FAILED", failure_code: "INSPECTION_FAILED", approved_digest: digest, approved_by_human_id: "human-a", approved_at: 1 });
    } finally { db.close(); }

    for (const approvalState of ["NOT_REQUIRED", "AWAITING_APPROVAL"] as const) {
      const pending = openDb(":memory:");
      try {
        migrateThrough038(pending); seed(pending);
        pending.prepare(`INSERT INTO catalog_api_activations
          (release_id,approval_state,runtime_state,failure_code,approved_by_human_id,approved_at,revision,created_at,updated_at)
          VALUES ('release-a',?,'INACTIVE',NULL,NULL,NULL,2,1,1)`).run(approvalState);
        migrate(pending);
        expect(pending.prepare("SELECT approval_state,runtime_state,failure_code,approved_digest,approved_by_human_id,approved_at FROM catalog_api_activations").get())
          .toEqual({ approval_state: approvalState, runtime_state: "INACTIVE", failure_code: null, approved_digest: null, approved_by_human_id: null, approved_at: null });
      } finally { pending.close(); }
    }
  });
});
