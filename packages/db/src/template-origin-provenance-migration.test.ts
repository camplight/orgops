import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDb, type OrgOpsDb } from "./index";

const migrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));
const roots: string[] = [];

function migrateThrough034(db: OrgOpsDb) {
  const root = mkdtempSync(join(tmpdir(), "orgops-migrations-034-"));
  roots.push(root);
  for (const file of readdirSync(migrationsDir).filter(file => /^\d+.*\.sql$/.test(file) && file < "035_")) {
    cpSync(join(migrationsDir, file), join(root, basename(file)));
  }
  migrate(db, root);
}

function seedOriginParents(db: OrgOpsDb) {
  db.exec(`
    INSERT INTO humans (id,username,password_hash,must_change_password,is_admin,created_at,updated_at)
      VALUES ('human-a','human-a','fixture',0,1,1,1);
    INSERT INTO models (id,provider,model_name,enabled,defaults_json,created_at)
      VALUES ('model-a','fixture','fixture',1,'{}',1);
    INSERT INTO agents (id,name,model_id,soul_path,workspace_path,owner_human_id,created_at,updated_at)
      VALUES ('agent-admin','agent-admin','model-a','soul','workspace','human-a',1,1),
             ('agent-grant','agent-grant','model-a','soul','workspace','human-a',1,1),
             ('agent-invalid','agent-invalid','model-a','soul','workspace','human-a',1,1);
    INSERT INTO catalog_sources
      (source_id,display_name,canonical_url,repository_identity,ref,enabled,allow_packages,revision,created_at,updated_at)
      VALUES ('source-team','Team','https://github.com/example/team','identity','main',1,1,1,1,1);
    INSERT INTO catalog_package_releases
      (package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,manifest_json,execution_preview_json,warnings_json,created_at)
      VALUES ('release-a','source-team','source-team','native-agent','agent-template','1.0.0','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','agents/template','{"formatVersion":1,"kind":"native-agent","name":"agent-template","version":"1.0.0","description":"fixture","author":"OrgOps","license":"MIT","compatibility":{"orgops":{"min":"0.0.1"},"platforms":["linux"],"tools":[]},"secrets":[],"dependencies":[],"files":[],"executables":[],"digest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","native":{"mode":"CLASSIC","systemInstructions":"fixture","runtime":{},"alwaysPreloadedSkills":[]}}','{}','[]',1);
    INSERT INTO catalog_grants
      (grant_id,release_id,subject_type,human_id,revision,created_by_human_id,created_at,updated_at)
      VALUES ('grant-a','release-a','HUMAN','human-a',1,'human-a',1,1);
  `);
}

function insertLegacyOrigin(db: OrgOpsDb, kind: "ADMIN" | "GRANT", agentId = "agent-admin") {
  db.prepare(`INSERT INTO agent_template_origins
    (agent_id,release_id,mode,consumed_by_kind,consumed_by_human_id,authority_source_id,content_source_id,package_name,package_version,package_digest,created_at)
    VALUES (?,'release-a','CLASSIC',?,'human-a','source-team','source-team','agent-template','1.0.0','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',1)`)
    .run(agentId, kind);
}

function insertOrigin(db: OrgOpsDb, agentId: string, kind: "ADMIN" | "GRANT", grantId: string | null) {
  db.prepare(`INSERT INTO agent_template_origins
    (agent_id,release_id,mode,consumed_by_kind,consumed_by_human_id,grant_id,authority_source_id,content_source_id,package_kind,
     package_name,package_version,catalog_commit,package_commit,package_path,package_digest,created_at)
    VALUES (?,'release-a','CLASSIC',?,'human-a',?,'source-team','source-team','native-agent','agent-template','1.0.0',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','agents/template',
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',1)`)
    .run(agentId, kind, grantId);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("migration 035 template origin grant provenance", () => {
  it("creates the constrained provenance column on fresh databases and is idempotent", () => {
    const db = openDb(":memory:");
    try {
      migrate(db);
      migrate(db);
      expect(db.prepare("PRAGMA table_info(agent_template_origins)").all()).toContainEqual(expect.objectContaining({ name: "grant_id", notnull: 0 }));
      expect(db.prepare("SELECT count(*) AS count FROM migrations WHERE id='035_agent_template_origin_grants.sql'").get()).toEqual({ count: 1 });
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_agent_template_origins_grant'").get())
        .toEqual({ name: "idx_agent_template_origins_grant" });
    } finally { db.close(); }
  });

  it("preserves valid legacy ADMIN origins with null provenance", () => {
    const db = openDb(":memory:");
    try {
      migrateThrough034(db);
      seedOriginParents(db);
      insertLegacyOrigin(db, "ADMIN");
      migrate(db);
      migrate(db);
      expect(db.prepare("SELECT consumed_by_kind,grant_id FROM agent_template_origins").get())
        .toEqual({ consumed_by_kind: "ADMIN", grant_id: null });
    } finally { db.close(); }
  });

  it("fails closed and rolls back when a legacy GRANT origin has no verifiable grant ID", () => {
    const db = openDb(":memory:");
    try {
      migrateThrough034(db);
      seedOriginParents(db);
      insertLegacyOrigin(db, "GRANT", "agent-grant");
      expect(() => migrate(db)).toThrow();
      expect(db.inTransaction).toBe(false);
      expect(db.prepare("PRAGMA table_info(agent_template_origins)").all()).not.toContainEqual(expect.objectContaining({ name: "grant_id" }));
      expect(db.prepare("SELECT count(*) AS count FROM migrations WHERE id='035_agent_template_origin_grants.sql'").get()).toEqual({ count: 0 });
    } finally { db.close(); }
  });

  it("enforces ADMIN/null, GRANT/non-null, and catalog grant foreign keys", () => {
    const db = openDb(":memory:");
    try {
      migrate(db);
      seedOriginParents(db);
      insertOrigin(db, "agent-admin", "ADMIN", null);
      insertOrigin(db, "agent-grant", "GRANT", "grant-a");
      expect(() => insertOrigin(db, "agent-invalid", "ADMIN", "grant-a")).toThrow(/CHECK constraint failed/);
      expect(() => insertOrigin(db, "agent-invalid", "GRANT", null)).toThrow(/CHECK constraint failed/);
      expect(() => insertOrigin(db, "agent-invalid", "GRANT", "grant-missing")).toThrow(/FOREIGN KEY constraint failed/);
    } finally { db.close(); }
  });
});
