import { afterEach, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate, openDb, type OrgOpsDb } from "./index";

const migrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function migrationsBefore(file: string) {
  const root = mkdtempSync(join("/tmp", "orgops-migrations-provision-"));
  roots.push(root);
  for (const name of readdirSync(migrationsDir).filter(name => /^\d+.*\.sql$/.test(name) && name < file)) {
    cpSync(join(migrationsDir, name), join(root, basename(name)));
  }
  return root;
}

function seedOwnerAndAgent(db: OrgOpsDb) {
  db.exec("INSERT INTO humans(id,username,password_hash,must_change_password,is_admin,created_at,updated_at) VALUES ('h1','h1','x',0,1,1,1),('h2','h2','x',0,0,1,1); INSERT INTO models(id,provider,model_name,enabled,defaults_json,created_at) VALUES ('m','p','m',1,'{}',1); INSERT INTO agents(id,name,model_id,soul_path,workspace_path,created_at,updated_at) VALUES ('a','a','m','s','w',1,1);");
}

function seedPre043Assignment(db: OrgOpsDb) {
  db.exec("INSERT INTO catalog_sources(source_id,display_name,canonical_url,repository_identity,ref,enabled,allow_packages,revision,created_at,updated_at) VALUES ('s','Source','https://example.test','identity','main',1,0,1,1,1);");
  db.prepare("INSERT INTO catalog_package_releases(package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,manifest_json,execution_preview_json,warnings_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)").run("r", "s", "s", "skill", "skill", "1.0.0", `sha256:${"a".repeat(64)}`, "c", "p", "skills/skill", "{}", "{}", "[]");
  db.prepare("INSERT INTO agent_skill_assignments(assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,preload,active_generation,desired_generation,revision,actor_kind,actor_human_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run("assignment-1", "a", "r", "skill", "ENABLED", "ENABLED", "STABLE", 0, "generation-1", "generation-1", 4, "ADMIN", "h1", 1, 2);
}

function seedOperation(db: OrgOpsDb, actor = "h1", operation = "00000000-0000-4000-8000-000000000001") {
  db.prepare("INSERT INTO agent_provision_operations(operation_id,actor_human_id,request_digest,state,agent_id,receipt_json,created_at,updated_at) VALUES (?,?,?,?,?,?,1,1)").run(operation, actor, "a".repeat(64), "COMPLETED", "a", "{}");
}

describe("migration 045 provision operation actor-scoped identity", () => {
  it("fresh migration creates composite identity and remains idempotent", () => {
    const db = openDb(":memory:");
    try {
      migrate(db); migrate(db); seedOwnerAndAgent(db); seedOperation(db);
      expect(db.prepare("SELECT pk,name FROM pragma_table_info('agent_provision_operations') WHERE pk > 0 ORDER BY pk").all()).toEqual([{ pk: 1, name: "actor_human_id" }, { pk: 2, name: "operation_id" }]);
      expect(db.prepare("SELECT count(*) AS count FROM migrations WHERE id='045_agent_provision_operations_actor_key.sql'").get()).toEqual({ count: 1 });
      seedOperation(db, "h2");
      expect(() => seedOperation(db)).toThrow(/UNIQUE|PRIMARY KEY/);
    } finally { db.close(); }
  });

  it.each(["042_", "043_", "044_"]) ("upgrades from %s without losing existing rows or constraints", (boundary) => {
    const db = openDb(":memory:");
    try {
      migrate(db, migrationsBefore(boundary === "042_" ? "043_" : boundary === "043_" ? "044_" : "045_"));
      seedOwnerAndAgent(db);
      if (boundary === "042_") seedPre043Assignment(db);
      if (boundary !== "044_") migrate(db, migrationsBefore("045_"));
      seedOperation(db);
      migrate(db); migrate(db);
      expect(db.prepare("SELECT actor_human_id,operation_id FROM agent_provision_operations").all()).toEqual([{ actor_human_id: "h1", operation_id: "00000000-0000-4000-8000-000000000001" }]);
      if (boundary === "042_") {
        expect(db.prepare("SELECT assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,preload,active_generation,desired_generation,revision,actor_kind,actor_human_id,removal_requested FROM agent_skill_assignments").get()).toEqual({ assignment_id: "assignment-1", agent_id: "a", release_id: "r", local_skill_name: "skill", desired_state: "ENABLED", effective_state: "ENABLED", deployment_state: "STABLE", preload: 0, active_generation: "generation-1", desired_generation: "generation-1", revision: 4, actor_kind: "ADMIN", actor_human_id: "h1", removal_requested: 0 });
        expect(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_agent_skill_assignments_removal'").get()).toBeTruthy();
        expect(() => db.prepare("UPDATE agent_skill_assignments SET removal_requested=-1 WHERE assignment_id='assignment-1'").run()).toThrow(/CHECK/);
        expect(() => db.prepare("UPDATE agent_skill_assignments SET removal_requested=2 WHERE assignment_id='assignment-1'").run()).toThrow(/CHECK/);
        db.prepare("UPDATE agent_skill_assignments SET removal_requested=1 WHERE assignment_id='assignment-1'").run();
        expect(db.prepare("SELECT removal_requested FROM agent_skill_assignments WHERE assignment_id='assignment-1'").get()).toEqual({ removal_requested: 1 });
      }
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='agent_provision_operations_digest'").get()).toBeTruthy();
      expect(() => db.prepare("DELETE FROM humans WHERE id='h1'").run()).toThrow(/FOREIGN KEY/);
    } finally { db.close(); }
  });

  it("rolls back a failed rebuild, restores foreign keys, and can rerun after repair", () => {
    const db = openDb(":memory:");
    try {
      migrate(db, migrationsBefore("045_")); seedOwnerAndAgent(db); seedOperation(db);
      db.exec("PRAGMA ignore_check_constraints=ON");
      db.prepare("UPDATE agent_provision_operations SET request_digest='bad'").run();
      db.exec("PRAGMA ignore_check_constraints=OFF");
      expect(() => migrate(db)).toThrow(/CHECK/);
      expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
      expect(db.prepare("SELECT request_digest FROM agent_provision_operations").get()).toEqual({ request_digest: "bad" });
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_provision_operations_v045'").get()).toBeUndefined();
      expect(db.prepare("SELECT count(*) AS count FROM migrations WHERE id='045_agent_provision_operations_actor_key.sql'").get()).toEqual({ count: 0 });
      db.prepare("UPDATE agent_provision_operations SET request_digest=?").run("a".repeat(64));
      migrate(db);
      expect(db.prepare("SELECT count(*) AS count FROM migrations WHERE id='045_agent_provision_operations_actor_key.sql'").get()).toEqual({ count: 1 });
      expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    } finally { db.close(); }
  });

  it("rejects malformed rows after the rebuild", () => {
    const db = openDb(":memory:");
    try {
      migrate(db); seedOwnerAndAgent(db);
      const insert = db.prepare("INSERT INTO agent_provision_operations(operation_id,actor_human_id,request_digest,state,agent_id,receipt_json,created_at,updated_at) VALUES (?,?,?,?,?,?,1,1)");
      expect(() => insert.run("bad", "h1", "a".repeat(64), "COMPLETED", "a", "{}")).toThrow(/CHECK/);
      expect(() => insert.run("00000000-0000-4000-8000-000000000002", "h1", "bad", "COMPLETED", "a", "{}")).toThrow(/CHECK/);
      expect(() => insert.run("00000000-0000-4000-8000-000000000003", "h1", "a".repeat(64), "FAILED", "a", "{}")).toThrow(/CHECK/);
      expect(() => insert.run("00000000-0000-4000-8000-000000000004", "h1", "a".repeat(64), "COMPLETED", "missing", "{}")).toThrow(/FOREIGN KEY/);
    } finally { db.close(); }
  });
});
