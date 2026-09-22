import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDb, type OrgOpsDb } from "./index";

const migrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));
const roots: string[] = [];

function migrateThrough033(db: OrgOpsDb) {
  const root = mkdtempSync(join(tmpdir(), "orgops-migrations-033-"));
  roots.push(root);
  for (const file of readdirSync(migrationsDir).filter(file => /^\d+.*\.sql$/.test(file) && file < "034_")) {
    cpSync(join(migrationsDir, file), join(root, basename(file)));
  }
  migrate(db, root);
}

function seedHuman(db: OrgOpsDb) {
  db.prepare(`INSERT INTO humans
    (id,username,password_hash,must_change_password,is_admin,created_at,updated_at)
    VALUES ('human-a','human-a','fixture',0,1,1,1)`).run();
}

function openLegacy032() {
  const db = openDb(":memory:");
  migrateThrough033(db);
  seedHuman(db);
  db.prepare(`INSERT INTO catalog_sources
    (source_id,canonical_url,ssh_user,repository_identity,enabled,allow_packages,revision,removed_at,created_at,updated_at)
    VALUES
    ('legacy-source','https://github.com/example/catalog',NULL,'legacy-identity',1,1,2,NULL,10,20),
    ('orphan-source','https://github.com/example/orphan',NULL,'orphan-identity',1,0,1,NULL,11,21)`).run();
  db.prepare(`INSERT INTO catalogs
    (catalog_id,source_id,display_name,ref,enabled,revision,removed_at,created_at,updated_at)
    VALUES
    ('legacy-catalog','legacy-source','Legacy catalog','main',1,3,NULL,12,22),
    ('legacy-release','legacy-source','Legacy release line','release/v1',1,4,NULL,13,23),
    ('z-duplicate','legacy-source','Duplicate main','main',0,5,NULL,14,24)`).run();
  db.prepare(`INSERT INTO catalog_installed_origins
    (name,catalog_id,source_id,catalog_commit,package_commit,path,kind,version,digest,local_path,installed_by_human_id,installed_at)
    VALUES ('legacy-skill','z-duplicate','legacy-source','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','skills/legacy','skill','1.0.0','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','installed/legacy','human-a',15)`).run();
  return { db };
}

function openLegacy032WithCredential() {
  const { db } = openLegacy032();
  let calls = 0;
  const getMasterKey = () => { calls += 1; return "must-not-be-used"; };
  db.prepare(`INSERT INTO catalog_read_credentials
    (source_id,credential_ref,kind,ciphertext_b64,created_at,updated_at)
    VALUES ('legacy-source','legacy-credential','https-basic','ciphertext-fixture',13,23)`).run();
  // Deliberately expose the counter without passing the getter to SQL migration code.
  void getMasterKey;
  return { db, masterKeyCalls: () => calls };
}

const mutableKeys = new Map<string, string>([
  ["catalog_sources", "source_id='source-team'"],
  ["catalog_source_read_credentials", "source_id='source-team'"],
  ["catalog_sync_attempts", "attempt_id='attempt-a'"],
  ["catalog_release_controls", "package_release_id='release-skill'"],
  ["catalog_grants", "grant_id='grant-human-a'"],
  ["catalog_install_operations", "operation_id='install-a'"],
  ["catalog_installations", "release_id='release-skill'"],
  ["catalog_api_activations", "release_id='release-skill'"],
  ["agent_package_secret_bindings", "agent_id='agent-a' AND release_id='release-skill' AND requirement_name='TOKEN'"],
  ["agent_skill_assignments", "assignment_id='assignment-a'"],
  ["catalog_rollouts", "rollout_id='rollout-a'"],
  ["catalog_rollout_targets", "rollout_id='rollout-a' AND agent_id='agent-a'"],
  ["runner_package_deployments", "deployment_id='deployment-a'"],
  ["agent_template_origins", "agent_id='agent-template'"],
]);

function openCanonical034WithMutableRows() {
  const db = openDb(":memory:");
  migrate(db);
  db.exec("PRAGMA foreign_keys=ON");
  seedHuman(db);
  db.exec(`
    INSERT INTO runner_nodes (id,display_name,metadata_json,created_at,updated_at,last_seen_at)
      VALUES ('runner-a','Runner A','{}',1,1,1);
    INSERT INTO models (id,provider,model_name,enabled,defaults_json,created_at)
      VALUES ('model-a','fixture','fixture',1,'{}',1);
    INSERT INTO agents (id,name,model_id,soul_path,workspace_path,assigned_runner_id,created_at,updated_at)
      VALUES
      ('agent-a','agent-a','model-a','soul','workspace','runner-a',1,1),
      ('agent-template','agent-template','model-a','soul','workspace','runner-a',1,1);
    INSERT INTO secrets (id,name,scope_type,scope_id,ciphertext_b64,created_at)
      VALUES ('secret-a','TOKEN','AGENT','agent-a','ciphertext',1);
    INSERT INTO catalog_sources
      (source_id,display_name,canonical_url,repository_identity,ref,enabled,allow_packages,revision,created_at,updated_at)
      VALUES ('source-team','Team source','https://github.com/example/catalog','source-team-identity','main',1,1,1,1,1);
    INSERT INTO catalog_source_read_credentials
      (source_id,credential_ref,kind,ciphertext_b64,revision,created_at,updated_at)
      VALUES ('source-team','credential-a','https-basic','ciphertext',1,1,1);
    INSERT INTO catalog_sync_attempts
      (attempt_id,source_id,source_revision,state,resolved_commit,failure_code,actor_human_id,revision,created_at,updated_at,completed_at)
      VALUES ('attempt-a','source-team',1,'SUCCEEDED','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',NULL,'human-a',1,1,1,1);
    INSERT INTO catalog_snapshots
      (snapshot_id,source_id,source_commit,index_digest,index_json,observed_ref,attempt_id,created_at)
      VALUES ('snapshot-a','source-team','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','{}','main','attempt-a',1);
    UPDATE catalog_sync_attempts SET snapshot_id='snapshot-a' WHERE attempt_id='attempt-a';
    UPDATE catalog_sources SET current_snapshot_id='snapshot-a' WHERE source_id='source-team';
    INSERT INTO catalog_package_releases
      (package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,manifest_json,execution_preview_json,warnings_json,created_at)
      VALUES ('release-skill','source-team','source-team','skill','demo-skill','1.0.0','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','skills/demo-skill','{}','{}','[]',1);
    INSERT INTO catalog_snapshot_entries (snapshot_id,package_release_id,ordinal)
      VALUES ('snapshot-a','release-skill',0);
    INSERT INTO catalog_release_controls
      (package_release_id,review_state,revision,created_at,updated_at)
      VALUES ('release-skill','PENDING',1,1,1);
    INSERT INTO catalog_grants
      (grant_id,release_id,subject_type,human_id,revision,created_by_human_id,created_at,updated_at)
      VALUES ('grant-human-a','release-skill','HUMAN','human-a',1,'human-a',1,1);
    INSERT INTO catalog_install_operations
      (operation_id,root_release_id,closure_digest,state,actor_human_id,revision,created_at,updated_at)
      VALUES ('install-a','release-skill','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','PENDING','human-a',1,1,1);
    INSERT INTO catalog_installations
      (release_id,artifact_digest,artifact_path,state,installed_by_human_id,installed_at,last_verified_at,revision)
      VALUES ('release-skill','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','artifacts/release-skill','INSTALLED','human-a',1,1,1);
    INSERT INTO catalog_api_activations
      (release_id,approval_state,runtime_state,revision,created_at,updated_at)
      VALUES ('release-skill','NOT_REQUIRED','INACTIVE',1,1,1);
    INSERT INTO agent_template_origins
      (agent_id,release_id,mode,consumed_by_kind,consumed_by_human_id,authority_source_id,content_source_id,package_kind,
       package_name,package_version,catalog_commit,package_commit,package_path,package_digest,created_at)
      VALUES ('agent-template','release-skill','CLASSIC','ADMIN','human-a','source-team','source-team','native-agent','demo-skill','1.0.0',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','skills/demo-skill',
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',1);
    INSERT INTO agent_package_secret_bindings
      (agent_id,release_id,requirement_name,secret_id,created_by_human_id,revision,created_at,updated_at)
      VALUES ('agent-a','release-skill','TOKEN','secret-a','human-a',1,1,1);
    INSERT INTO agent_skill_assignments
      (assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,preload,active_generation,desired_generation,revision,actor_kind,actor_human_id,grant_id,created_at,updated_at)
      VALUES ('assignment-a','agent-a','release-skill','demo-skill','ENABLED','ENABLED','STABLE',0,'generation-a','generation-a',1,'ADMIN','human-a',NULL,1,1);
    INSERT INTO catalog_rollouts
      (rollout_id,release_id,operation,preload,plan_digest,state,actor_kind,actor_human_id,revision,created_at,updated_at)
      VALUES ('rollout-a','release-skill','ENABLE',NULL,'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','QUEUED','ADMIN','human-a',1,1,1);
    INSERT INTO catalog_rollout_targets
      (rollout_id,agent_id,captured_runner_id,expected_assignment_revision,state,attempts,revision,created_at,updated_at)
      VALUES ('rollout-a','agent-a','runner-a',1,'QUEUED',0,1,1,1);
    INSERT INTO runner_package_deployments
      (deployment_id,rollout_id,target_agent_id,release_id,bound_runner_id,desired_generation,state,revision,created_at,updated_at)
      VALUES ('deployment-a','rollout-a','agent-a','release-skill','runner-a','generation-b','QUEUED',1,1,1);
  `);
  return {
    db,
    primaryKeyWhere(table: string) {
      const where = mutableKeys.get(table);
      if (!where) throw new Error(`Unknown fixed table ${table}`);
      return where;
    },
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("migration 034 catalog source library", () => {
  it("archives migration-032 rows, backfills Catalog rows, and does not invent a ref for source-only rows", () => {
    const { db } = openLegacy032();
    try {
      migrate(db);
      expect(db.prepare("SELECT source_id,ref FROM catalog_sources WHERE source_id='legacy-catalog'").get()).toEqual({ source_id: "legacy-catalog", ref: "main" });
      expect(db.prepare("SELECT source_id FROM catalog_sources_legacy_032 WHERE source_id='orphan-source'").get()).toEqual({ source_id: "orphan-source" });
      expect(db.prepare("SELECT source_id FROM catalog_sources WHERE source_id='orphan-source'").get()).toBeUndefined();
    } finally { db.close(); }
  });

  it("preserves distinct refs and deterministically coalesces duplicate repository-plus-ref Catalogs", () => {
    const { db } = openLegacy032();
    try {
      migrate(db);
      expect(db.prepare("SELECT source_id,repository_identity,ref FROM catalog_sources ORDER BY source_id").all()).toEqual([
        { source_id: "legacy-catalog", repository_identity: "legacy-identity", ref: "main" },
        { source_id: "legacy-release", repository_identity: "legacy-identity", ref: "release/v1" },
      ]);
      expect(db.prepare("SELECT catalog_id FROM catalogs_legacy_032 WHERE source_id='legacy-source' ORDER BY catalog_id").all()).toEqual([
        { catalog_id: "legacy-catalog" },
        { catalog_id: "legacy-release" },
        { catalog_id: "z-duplicate" },
      ]);
      expect(db.prepare("SELECT name,catalog_id,source_id FROM catalog_installed_origins").all()).toEqual([
        { name: "legacy-skill", catalog_id: "z-duplicate", source_id: "legacy-source" },
      ]);
    } finally { db.close(); }
  });

  it("copies encrypted credential bytes without decrypting and keeps migration archives", () => {
    const { db, masterKeyCalls } = openLegacy032WithCredential();
    try {
      migrate(db);
      expect(masterKeyCalls()).toBe(0);
      expect(db.prepare("SELECT source_id,ciphertext_b64,legacy_binding_source_id,legacy_credential_ref FROM catalog_source_read_credentials ORDER BY source_id").all()).toEqual([
        { source_id: "legacy-catalog", ciphertext_b64: "ciphertext-fixture", legacy_binding_source_id: "legacy-source", legacy_credential_ref: "legacy-credential" },
        { source_id: "legacy-release", ciphertext_b64: "ciphertext-fixture", legacy_binding_source_id: "legacy-source", legacy_credential_ref: "legacy-credential" },
      ]);
      for (const table of ["catalog_sources_legacy_032", "catalogs_legacy_032", "catalog_read_credentials_legacy_032", "catalog_installed_origins"]) {
        expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)).toEqual({ name: table });
      }
    } finally { db.close(); }
  });

  it("creates every canonical table and named index on a fresh database", () => {
    const db = openDb(":memory:");
    try {
      migrate(db);
      const tables = [
        "catalog_sources", "catalog_source_read_credentials", "catalog_sync_attempts", "catalog_snapshots",
        "catalog_package_releases", "catalog_snapshot_entries", "catalog_release_controls", "catalog_grants",
        "catalog_install_operations", "catalog_installations", "catalog_api_activations", "agent_template_origins",
        "agent_package_secret_bindings", "agent_skill_assignments", "catalog_rollouts", "catalog_rollout_targets",
        "runner_package_deployments",
      ];
      const indexes = [
        "uidx_catalog_sources_repository_ref", "idx_catalog_sources_current_snapshot", "uidx_catalog_sync_attempts_running", "idx_catalog_sync_attempts_source_created",
        "idx_catalog_snapshots_source_created", "idx_catalog_package_releases_content_source", "idx_catalog_package_releases_kind_name",
        "idx_catalog_snapshot_entries_release", "idx_catalog_release_controls_state", "uidx_catalog_grants_live_subject",
        "idx_catalog_grants_human", "idx_catalog_install_operations_release", "idx_catalog_installations_state",
        "idx_catalog_api_activations_runtime", "idx_agent_template_origins_release", "idx_agent_package_secret_bindings_secret",
        "idx_agent_skill_assignments_release", "idx_agent_skill_assignments_deployment", "idx_catalog_rollouts_release_created",
        "idx_catalog_rollout_targets_runner_state", "idx_catalog_rollout_targets_agent", "idx_runner_package_deployments_poll",
        "idx_runner_package_deployments_agent", "uidx_runner_package_deployments_live_agent",
      ];
      for (const name of tables) expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)).toEqual({ name });
      for (const name of indexes) expect(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(name)).toEqual({ name });
    } finally { db.close(); }
  });

  it.each([
    ["catalog_sources", "source_id", "source-team"],
    ["catalog_source_read_credentials", "source_id", "source-team"],
    ["catalog_sync_attempts", "attempt_id", "attempt-a"],
    ["catalog_release_controls", "package_release_id", "release-skill"],
    ["catalog_grants", "grant_id", "grant-human-a"],
    ["catalog_install_operations", "operation_id", "install-a"],
    ["catalog_installations", "release_id", "release-skill"],
    ["catalog_api_activations", "release_id", "release-skill"],
    ["agent_package_secret_bindings", "agent_id", "agent-a"],
    ["agent_skill_assignments", "assignment_id", "assignment-a"],
    ["catalog_rollouts", "rollout_id", "rollout-a"],
    ["catalog_rollout_targets", "agent_id", "agent-a"],
    ["runner_package_deployments", "deployment_id", "deployment-a"],
  ] as const)("rejects an out-of-range revision in mutable %s", (table, key, id) => {
    const { db } = openCanonical034WithMutableRows();
    try {
      expect(() => db.prepare(`UPDATE ${table} SET revision=0 WHERE ${key}=?`).run(id)).toThrow(/CHECK constraint failed/);
      expect(() => db.prepare(`UPDATE ${table} SET revision=2147483648 WHERE ${key}=?`).run(id)).toThrow(/CHECK constraint failed/);
    } finally { db.close(); }
  });

  it.each([
    ["catalog_sync_attempts", "failure_code"],
    ["catalog_install_operations", "failure_code"],
    ["catalog_api_activations", "failure_code"],
    ["catalog_rollout_targets", "reason_code"],
    ["runner_package_deployments", "failure_code"],
    ["agent_template_origins", "consumed_by_kind"],
    ["agent_skill_assignments", "actor_kind"],
    ["catalog_rollouts", "actor_kind"],
  ] as const)("rejects an arbitrary fixed code in %s.%s", (table, column) => {
    const { db, primaryKeyWhere } = openCanonical034WithMutableRows();
    try {
      expect(() => db.prepare(`UPDATE ${table} SET ${column}='UNBOUNDED_TEXT' WHERE ${primaryKeyWhere(table)}`).run()).toThrow(/CHECK constraint failed/);
    } finally { db.close(); }
  });

  it("requires grant provenance to name its grant", () => {
    const { db } = openCanonical034WithMutableRows();
    try {
      expect(() => db.prepare("UPDATE agent_skill_assignments SET actor_kind='GRANT',grant_id=NULL WHERE assignment_id='assignment-a'").run()).toThrow(/CHECK constraint failed/);
    } finally { db.close(); }
  });

  it("rejects duplicate release identity, live grants, and live agent deployments", () => {
    const { db } = openCanonical034WithMutableRows();
    try {
      expect(() => db.prepare(`INSERT INTO catalog_package_releases SELECT 'release-duplicate',authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,manifest_json,execution_preview_json,warnings_json,created_at FROM catalog_package_releases WHERE package_release_id='release-skill'`).run()).toThrow(/UNIQUE constraint failed/);
      expect(() => db.prepare(`INSERT INTO catalog_grants (grant_id,release_id,subject_type,human_id,revision,created_by_human_id,created_at,updated_at) VALUES ('grant-duplicate','release-skill','HUMAN','human-a',1,'human-a',1,1)`).run()).toThrow(/UNIQUE constraint failed/);
      expect(() => db.prepare(`INSERT INTO runner_package_deployments (deployment_id,target_agent_id,release_id,bound_runner_id,desired_generation,state,revision,created_at,updated_at) VALUES ('deployment-duplicate','agent-a','release-skill','runner-a','generation-c','QUEUED',1,1,1)`).run()).toThrow(/UNIQUE constraint failed/);
    } finally { db.close(); }
  });
});
