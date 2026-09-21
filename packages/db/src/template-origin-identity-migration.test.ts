import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDb, type OrgOpsDb } from "./index";

const migrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function migrateThrough037(db: OrgOpsDb) {
  const root = mkdtempSync(join(tmpdir(), "orgops-migrations-037-")); roots.push(root);
  for (const file of readdirSync(migrationsDir).filter(file => /^\d+.*\.sql$/.test(file) && file < "038_")) {
    cpSync(join(migrationsDir, file), join(root, basename(file)));
  }
  migrate(db, root);
}

const digest = `sha256:${"a".repeat(64)}`;
const commit = "a".repeat(40);
function seed(db: OrgOpsDb, corrupt = false) {
  const manifest = { formatVersion: 1, kind: "native-agent", name: "template", version: "1.0.0", description: "fixture", author: "OrgOps", license: "MIT",
    compatibility: { orgops: { min: "0.0.1" }, platforms: ["linux"], tools: [] }, secrets: [], dependencies: [], files: [], executables: [], digest,
    native: { mode: "CLASSIC", systemInstructions: "fixture", runtime: {}, alwaysPreloadedSkills: [] } };
  db.exec(`
    INSERT INTO humans (id,username,password_hash,must_change_password,is_admin,created_at,updated_at) VALUES ('human-a','human-a','x',0,1,1,1);
    INSERT INTO models (id,provider,model_name,enabled,defaults_json,created_at) VALUES ('model-a','x','x',1,'{}',1);
    INSERT INTO runner_nodes (id,display_name,metadata_json,created_at,updated_at,last_seen_at) VALUES ('runner-a','A','{}',1,1,1);
    INSERT INTO agents (id,name,model_id,soul_path,workspace_path,mode,owner_human_id,created_at,updated_at) VALUES ('agent-a','agent-a','model-a','soul','workspace','CLASSIC','human-a',1,1);
    INSERT INTO catalog_sources (source_id,display_name,canonical_url,repository_identity,ref,enabled,allow_packages,revision,created_at,updated_at)
      VALUES ('source-a','A','https://example.test/a','identity','main',1,0,1,1,1);
  `);
  db.prepare(`INSERT INTO catalog_package_releases
    (package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,manifest_json,execution_preview_json,warnings_json,created_at)
    VALUES ('release-a','source-a','source-a','native-agent','template','1.0.0',?,?,?,?,?,'{}','[]',1)`)
    .run(digest, commit, commit, "agents/template", JSON.stringify(manifest));
  db.prepare(`INSERT INTO agent_template_origins
    (agent_id,release_id,mode,consumed_by_kind,consumed_by_human_id,grant_id,authority_source_id,content_source_id,package_name,package_version,package_digest,created_at)
    VALUES ('agent-a','release-a','CLASSIC','ADMIN','human-a',NULL,'source-a','source-a','template','1.0.0',?,1)`).run(corrupt ? `sha256:${"b".repeat(64)}` : digest);
}

describe("migration 038 complete immutable template origin identity", () => {
  it("creates complete constrained provenance on fresh databases and remains idempotent", () => {
    const db = openDb(":memory:");
    try {
      migrate(db); migrate(db);
      const columns = db.prepare("PRAGMA table_info(agent_template_origins)").all() as Array<{ name: string; notnull: number }>;
      for (const name of ["package_kind", "catalog_commit", "package_commit", "package_path"]) {
        expect(columns).toContainEqual(expect.objectContaining({ name, notnull: 1 }));
      }
      expect(db.prepare("SELECT count(*) AS count FROM migrations WHERE id='038_agent_template_origin_identity.sql'").get()).toEqual({ count: 1 });
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_agent_template_origins_release'").get()).toEqual({ name: "idx_agent_template_origins_release" });
    } finally { db.close(); }
  });

  it("copies every immutable release identity field only for a verifiable legacy row", () => {
    const db = openDb(":memory:");
    try {
      migrateThrough037(db); seed(db); migrate(db);
      expect(db.prepare(`SELECT package_kind,catalog_commit,package_commit,package_path FROM agent_template_origins WHERE agent_id='agent-a'`).get())
        .toEqual({ package_kind: "native-agent", catalog_commit: commit, package_commit: commit, package_path: "agents/template" });
    } finally { db.close(); }
  });

  it("rolls back a corrupt legacy identity instead of substituting current release data", () => {
    const db = openDb(":memory:");
    try {
      migrateThrough037(db); seed(db, true);
      expect(() => migrate(db)).toThrow();
      expect(db.inTransaction).toBe(false);
      expect(db.prepare("PRAGMA table_info(agent_template_origins)").all()).not.toContainEqual(expect.objectContaining({ name: "package_kind" }));
      expect(db.prepare("SELECT count(*) AS count FROM migrations WHERE id='038_agent_template_origin_identity.sql'").get()).toEqual({ count: 0 });
    } finally { db.close(); }
  });

  it.each([
    ["missing kind", "kind", undefined], ["null kind", "kind", null],
    ["missing name", "name", undefined], ["null name", "name", null],
    ["missing version", "version", undefined], ["null version", "version", null],
    ["missing digest", "digest", undefined], ["null digest", "digest", null],
    ["missing native mode", "native.mode", undefined], ["null native mode", "native.mode", null],
  ] as const)("rolls back unchanged for %s", (_case, path, value) => {
    const db = openDb(":memory:");
    try {
      migrateThrough037(db); seed(db);
      const row = db.prepare("SELECT manifest_json FROM catalog_package_releases WHERE package_release_id='release-a'").get() as { manifest_json: string };
      const manifest = JSON.parse(row.manifest_json) as Record<string, unknown>;
      if (path === "native.mode") {
        const native = manifest.native as Record<string, unknown>;
        if (value === undefined) delete native.mode; else native.mode = value;
      } else if (value === undefined) delete manifest[path];
      else manifest[path] = value;
      db.prepare("UPDATE catalog_package_releases SET manifest_json=? WHERE package_release_id='release-a'").run(JSON.stringify(manifest));
      const before = {
        schema: db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='agent_template_origins'").get(),
        columns: db.prepare("PRAGMA table_info(agent_template_origins)").all(),
        origins: db.prepare("SELECT * FROM agent_template_origins ORDER BY agent_id").all(),
        migrations: db.prepare("SELECT * FROM migrations ORDER BY id").all(),
      };

      expect(() => migrate(db)).toThrow();
      expect(db.inTransaction).toBe(false);
      expect({
        schema: db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='agent_template_origins'").get(),
        columns: db.prepare("PRAGMA table_info(agent_template_origins)").all(),
        origins: db.prepare("SELECT * FROM agent_template_origins ORDER BY agent_id").all(),
        migrations: db.prepare("SELECT * FROM migrations ORDER BY id").all(),
      }).toEqual(before);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('_migration_038_origin_guard','agent_template_origins_legacy_037')").all()).toEqual([]);
    } finally { db.close(); }
  });

  it("DB-enforces native and wrapped mode-kind compatibility", () => {
    const db = openDb(":memory:");
    try {
      migrate(db);
      const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='agent_template_origins'").get() as { sql: string }).sql;
      expect(sql).toContain("package_kind='native-agent'");
      expect(sql).toContain("package_kind='wrapped-agent'");
      expect(sql).toContain("mode='WRAPPED'");
    } finally { db.close(); }
  });
});
