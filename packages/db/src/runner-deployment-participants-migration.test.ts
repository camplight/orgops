import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { migrate, openDb, type OrgOpsDb } from "./index";
import { runnerDeploymentParticipants, runnerPackageDeployments } from "./schema";

const migrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function migrateThrough036(db: OrgOpsDb) {
  const root = mkdtempSync(join(tmpdir(), "orgops-migrations-036-"));
  roots.push(root);
  for (const file of readdirSync(migrationsDir).filter(file => /^\d+.*\.sql$/.test(file) && file < "037_")) {
    cpSync(join(migrationsDir, file), join(root, basename(file)));
  }
  migrate(db, root);
}

function expectDeploymentSchema(db: OrgOpsDb) {
  const deploymentColumns = db.prepare("PRAGMA table_info(runner_package_deployments)").all();
  expect(deploymentColumns).toContainEqual(expect.objectContaining({ name: "desired_roots_json", notnull: 0 }));
  expect(deploymentColumns).toContainEqual(expect.objectContaining({ name: "package_set_digest", notnull: 0 }));
  expect(deploymentColumns).toContainEqual(expect.objectContaining({ name: "artifact_semantic_digest", notnull: 0 }));
  expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='runner_deployment_participants'").get())
    .toEqual({ name: "runner_deployment_participants" });
}

describe("migration 037 immutable runner deployment generations", () => {
  it("creates participant and package identity storage on fresh databases and is idempotent", () => {
    const db = openDb(":memory:");
    try {
      migrate(db); migrate(db);
      expectDeploymentSchema(db);
      expect(db.prepare("SELECT count(*) AS count FROM migrations WHERE id='037_runner_deployment_participants.sql'").get()).toEqual({ count: 1 });
    } finally { db.close(); }
  });

  it("keeps schema.ts check declarations exactly aligned with migration 037 additions", () => {
    expect(getTableConfig(runnerPackageDeployments).checks.map(item => item.name)).toEqual(expect.arrayContaining([
      "runner_package_deployments_package_set_digest_check",
      "runner_package_deployments_artifact_digest_check",
    ]));
    expect(getTableConfig(runnerDeploymentParticipants).checks.map(item => item.name)).toEqual(expect.arrayContaining([
      "runner_deployment_participants_target_disabled_preload_check",
      "runner_deployment_participants_effective_disabled_preload_check",
    ]));
    const digestChecks = getTableConfig(runnerPackageDeployments).checks
      .filter(item => item.name.endsWith("digest_check"))
      .map(item => JSON.stringify(item.value.queryChunks.map(chunk => chunk && "value" in chunk ? chunk.value : "")));
    expect(digestChecks).toHaveLength(2);
    expect(digestChecks.every(sql => sql.includes("NOT GLOB '*[^0-9a-f]*'"))).toBe(true);
  });

  it("upgrades a migration-036 database and enforces participant role, booleans, foreign keys, and uniqueness", () => {
    const db = openDb(":memory:");
    try {
      migrateThrough036(db);
      migrate(db);
      expectDeploymentSchema(db);
      db.exec(`
        INSERT INTO humans (id,username,password_hash,must_change_password,is_admin,created_at,updated_at) VALUES ('h','h','x',0,1,1,1);
        INSERT INTO models (id,provider,model_name,enabled,defaults_json,created_at) VALUES ('m','x','x',1,'{}',1);
        INSERT INTO runner_nodes (id,display_name,metadata_json,created_at,updated_at,last_seen_at) VALUES ('runner','Runner','{}',1,1,1);
        INSERT INTO agents (id,name,model_id,soul_path,workspace_path,assigned_runner_id,created_at,updated_at) VALUES ('agent','agent','m','s','w','runner',1,1);
        INSERT INTO catalog_sources (source_id,display_name,canonical_url,repository_identity,ref,enabled,allow_packages,revision,created_at,updated_at)
          VALUES ('source','Source','https://github.com/o/r','["github","o","r"]','main',1,0,1,1,1);
        INSERT INTO catalog_package_releases
          (package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,manifest_json,execution_preview_json,warnings_json,created_at)
          VALUES ('release','source','source','skill','skill','1.0.0','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','c','c','skills/skill','{}','{}','[]',1);
        INSERT INTO agent_skill_assignments
          (assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,preload,effective_preload,active_generation,desired_generation,revision,actor_kind,actor_human_id,created_at,updated_at)
          VALUES ('assignment','agent','release','skill','ENABLED','DISABLED','REQUESTED',1,0,NULL,'generation',1,'ADMIN','h',1,1);
        INSERT INTO runner_package_deployments
          (deployment_id,target_agent_id,release_id,bound_runner_id,desired_generation,state,revision,created_at,updated_at)
          VALUES ('deployment','agent','release','runner','generation','QUEUED',1,1,1);
      `);
      const insert = (role: string, targetState = "ENABLED", targetPreload = 1, priorState = "DISABLED", priorPreload = 0) =>
        db.prepare(`INSERT INTO runner_deployment_participants
          (deployment_id,assignment_id,agent_id,release_id,local_skill_name,role,target_state,target_preload,
           prior_effective_state,prior_effective_preload,prior_active_generation,assignment_revision)
          VALUES ('deployment','assignment','agent','release','skill',?,?,?,?,?,NULL,1)`)
          .run(role, targetState, targetPreload, priorState, priorPreload);
      for (const column of ["package_set_digest", "artifact_semantic_digest"] as const) {
        for (const suffix of ["A".repeat(64), "g".repeat(64)]) {
          expect(() => db.prepare(`INSERT INTO runner_package_deployments
            (deployment_id,target_agent_id,release_id,bound_runner_id,desired_generation,state,revision,${column},created_at,updated_at)
            VALUES ('invalid-digest','agent','release','runner','invalid-generation','ACTIVE',1,?,1,1)`)
            .run(`sha256:${suffix}`)).toThrow(/CHECK constraint failed/);
          expect(() => db.prepare(`UPDATE runner_package_deployments SET ${column}=? WHERE deployment_id='deployment'`)
            .run(`sha256:${suffix}`)).toThrow(/CHECK constraint failed/);
        }
      }
      expect(() => insert("OTHER")).toThrow(/CHECK constraint failed/);
      expect(() => insert("APPLY_DESIRED", "ENABLED", 2)).toThrow(/CHECK constraint failed/);
      expect(() => insert("APPLY_DESIRED", "DISABLED", 1)).toThrow(/CHECK constraint failed/);
      expect(() => insert("APPLY_DESIRED", "ENABLED", 1, "DISABLED", 1)).toThrow(/CHECK constraint failed/);
      insert("APPLY_DESIRED");
      expect(() => db.prepare("UPDATE runner_deployment_participants SET target_state='DISABLED' WHERE deployment_id='deployment'").run())
        .toThrow(/CHECK constraint failed/);
      expect(() => db.prepare("UPDATE runner_deployment_participants SET prior_effective_preload=1 WHERE deployment_id='deployment'").run())
        .toThrow(/CHECK constraint failed/);
      expect(() => insert("APPLY_DESIRED")).toThrow(/UNIQUE constraint failed/);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_runner_deployment_participants_assignment'").get())
        .toEqual({ name: "idx_runner_deployment_participants_assignment" });
    } finally { db.close(); }
  });
});
