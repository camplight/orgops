import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDb, type OrgOpsDb } from "./index";

const migrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function migrateThrough035(db: OrgOpsDb) {
  const root = mkdtempSync(join(tmpdir(), "orgops-migrations-035-"));
  roots.push(root);
  for (const file of readdirSync(migrationsDir).filter(file => /^\d+.*\.sql$/.test(file) && file < "036_")) {
    cpSync(join(migrationsDir, file), join(root, basename(file)));
  }
  migrate(db, root);
}

describe("migration 036 agent assignment revisions", () => {
  it("creates bounded defaults on a fresh database and is idempotent", () => {
    const db = openDb(":memory:");
    try {
      migrate(db); migrate(db);
      expect(db.prepare("SELECT count(*) AS count FROM migrations WHERE id='036_agent_assignment_revisions.sql'").get()).toEqual({ count: 1 });
      expect(db.prepare("PRAGMA table_info(agents)").all()).toContainEqual(expect.objectContaining({ name: "revision", notnull: 1, dflt_value: "1" }));
      expect(db.prepare("PRAGMA table_info(agent_skill_assignments)").all())
        .toContainEqual(expect.objectContaining({ name: "effective_preload", notnull: 1, dflt_value: "0" }));
    } finally { db.close(); }
  });

  it("backfills existing agents and only stable assignment preload as effective", () => {
    const db = openDb(":memory:");
    try {
      migrateThrough035(db);
      db.exec(`
        INSERT INTO humans (id,username,password_hash,must_change_password,is_admin,created_at,updated_at) VALUES ('h','h','x',0,1,1,1);
        INSERT INTO models (id,provider,model_name,enabled,defaults_json,created_at) VALUES ('m','x','x',1,'{}',1);
        INSERT INTO agents (id,name,model_id,soul_path,workspace_path,created_at,updated_at) VALUES ('a','a','m','s','w',1,1),('b','b','m','s','w',1,1);
        INSERT INTO catalog_sources (source_id,display_name,canonical_url,repository_identity,ref,enabled,allow_packages,revision,created_at,updated_at)
          VALUES ('s','S','https://github.com/o/r','["github","o","r"]','main',1,0,1,1,1);
        INSERT INTO catalog_package_releases
          (package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,manifest_json,execution_preview_json,warnings_json,created_at)
          VALUES ('r','s','s','skill','skill-a','1.0.0','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','c','c','skills/skill-a','{}','{}','[]',1);
        INSERT INTO agent_skill_assignments
          (assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,preload,active_generation,desired_generation,revision,actor_kind,actor_human_id,created_at,updated_at)
          VALUES ('stable','a','r','skill-a','ENABLED','ENABLED','STABLE',1,'g','g',1,'ADMIN','h',1,1),
                 ('requested','b','r','skill-a','ENABLED','DISABLED','REQUESTED',1,NULL,'g2',1,'ADMIN','h',1,1);
      `);
      migrate(db);
      expect(db.prepare("SELECT id,revision FROM agents ORDER BY id").all()).toEqual([{ id: "a", revision: 1 }, { id: "b", revision: 1 }]);
      expect(db.prepare("SELECT assignment_id,effective_preload FROM agent_skill_assignments ORDER BY assignment_id").all())
        .toEqual([{ assignment_id: "requested", effective_preload: 0 }, { assignment_id: "stable", effective_preload: 1 }]);
      expect(() => db.prepare("UPDATE agents SET revision=2147483648 WHERE id='a'").run()).toThrow(/CHECK constraint failed/);
      expect(() => db.prepare("UPDATE agent_skill_assignments SET effective_preload=2 WHERE assignment_id='stable'").run()).toThrow(/CHECK constraint failed/);
    } finally { db.close(); }
  });
});
