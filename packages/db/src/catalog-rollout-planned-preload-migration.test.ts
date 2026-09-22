import { afterEach, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate, openDb, type OrgOpsDb } from "./index";

const migrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function migrationCopy(before042: boolean) {
  const root = mkdtempSync(join("/tmp", "orgops-migrations-042-")); roots.push(root);
  for (const file of readdirSync(migrationsDir).filter(file => /^\d+.*\.sql$/.test(file) && (before042 ? file < "042_" : true))) cpSync(join(migrationsDir, file), join(root, basename(file)));
  return root;
}
let seedCount = 0;
function seed(db: OrgOpsDb, prior: string | null, operation = "ENABLE", preload: number | null = null) {
  const rolloutId = `ro-${++seedCount}`;
  db.exec(`INSERT OR IGNORE INTO humans (id,username,password_hash,must_change_password,is_admin,created_at,updated_at) VALUES ('h','h','x',0,1,1,1);
    INSERT OR IGNORE INTO agents (id,name,model_id,soul_path,workspace_path,created_at,updated_at) VALUES ('a','a','m','s','/w',1,1);
    INSERT OR IGNORE INTO catalog_sources (source_id,display_name,canonical_url,repository_identity,ref,enabled,allow_packages,revision,created_at,updated_at) VALUES ('s','s','https://s','s','main',1,1,1,1,1);
    INSERT OR IGNORE INTO catalog_package_releases (package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,manifest_json,execution_preview_json,warnings_json,created_at) VALUES ('r','s','s','skill','n','1.0.0','sha256:${"a".repeat(64)}','c','p','x','{}','{}','[]',1);`);
  db.prepare("INSERT INTO catalog_rollouts (rollout_id,release_id,operation,preload,plan_digest,state,actor_kind,actor_human_id,revision,created_at,updated_at) VALUES (?, 'r',?,?,?,'DRAFT','ADMIN','h',1,1,1)").run(rolloutId, operation, preload, `sha256:${"b".repeat(63)}${seedCount}`);
  db.prepare("INSERT INTO catalog_rollout_targets (rollout_id,agent_id,target_ordinal,expected_assignment_revision,state,attempts,revision,created_at,updated_at,prior_assignment_json) VALUES (?, 'a',0,0,'QUEUED',0,1,1,1,?)").run(rolloutId, prior);
}

describe("migration 042 planned preload", () => {
  it("derives operation-bound values and is idempotent with schema checks", () => {
    const db = openDb(":memory:");
    const old = migrationCopy(true); migrate(db, old);
    seed(db, JSON.stringify({ preload: 1 }), "ENABLE");
    seed(db, JSON.stringify({ preload: 1 }), "DISABLE");
    seed(db, JSON.stringify({ preload: 0 }), "SET_PRELOAD", 1);
    const full = migrationCopy(false); migrate(db, full); migrate(db, full);
    expect(db.prepare("SELECT operation,planned_preload FROM catalog_rollouts JOIN catalog_rollout_targets USING (rollout_id) ORDER BY rollout_id").all()).toEqual([
      { operation: "ENABLE", planned_preload: 1 }, { operation: "DISABLE", planned_preload: 0 }, { operation: "SET_PRELOAD", planned_preload: 1 },
    ]);
    expect(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='catalog_rollout_targets'").get()).toSatisfy((row: { sql: string }) => row.sql.includes("planned_preload INTEGER NOT NULL") && row.sql.includes("CHECK(planned_preload IN (0,1))"));
    db.close();
  });

  it("rolls back instead of accepting a malformed prior assignment preload", () => {
    const db = openDb(":memory:"); const old = migrationCopy(true); migrate(db, old); seed(db, JSON.stringify({ preload: "yes" }));
    const full = migrationCopy(false); expect(() => migrate(db, full)).toThrow();
    expect(db.prepare("SELECT name FROM pragma_table_info('catalog_rollout_targets') WHERE name='planned_preload'").get()).toBeUndefined();
    expect(db.prepare("SELECT id FROM migrations WHERE id='042_catalog_rollout_planned_preload.sql'").get()).toBeUndefined();
    db.close();
  });
});
