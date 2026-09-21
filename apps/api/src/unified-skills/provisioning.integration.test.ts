import { afterEach, describe, expect, it } from "vitest";
import { openDb, migrate } from "@orgops/db";
import { encryptSecret } from "@orgops/crypto";
import { createAgentProvisioning, createSecretReferenceResolver, type SecretReferenceResolver } from "./provisioning";
import { createAgentSkillManagement } from "./management";
import { createApp } from "../app";
import { approvedRelease } from "../catalog-library/test-fixtures";

const actor = { kind: "HUMAN_ADMIN" as const, id: "human-a" };
const secondActor = { kind: "AUTHENTICATED_HUMAN" as const, id: "human-b" };
const masterKey = Buffer.alloc(32, 9);
const commit = "a".repeat(40);
const digest = `sha256:${"a".repeat(64)}`;
const now = 1_000;

function seed(db: ReturnType<typeof openDb>, requirements = true) {
  const manifest = { ...approvedRelease("native-agent").manifest, name: "demo-native", secrets: requirements ? [{ name: "API_KEY", description: "API key", required: true }] : [] } as any;
  db.exec(`INSERT INTO humans (id,username,password_hash,must_change_password,is_admin,created_at,updated_at) VALUES ('human-a','admin','fixture',0,1,1,1),('human-b','ordinary','fixture',0,0,1,1);
    INSERT INTO runner_nodes (id,display_name,metadata_json,created_at,updated_at,last_seen_at) VALUES ('runner-a','Runner','{}',1,1,1);
    INSERT INTO models (id,provider,model_name,enabled,defaults_json,created_at) VALUES ('model-a','fixture','fixture',1,'{}',1);
    INSERT INTO catalog_sources (source_id,display_name,canonical_url,repository_identity,ref,enabled,allow_packages,revision,created_at,updated_at) VALUES ('source-team','Team','https://example.test','[]','main',1,0,1,1,1);`);
  db.prepare(`INSERT INTO catalog_package_releases (package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,manifest_json,execution_preview_json,warnings_json,created_at) VALUES ('release-native','source-team','source-team',?,?,?,?,?,?,?,?,?,?,1)`).run(manifest.kind, manifest.name, manifest.version, manifest.digest, commit, commit, "agents/demo-native", JSON.stringify(manifest), JSON.stringify({ apiEventShapes: [], runnerScripts: [], wrappedCommands: [], externalSources: [] }), "[]");
  db.prepare(`INSERT INTO catalog_release_controls (package_release_id,review_state,review_digest,reviewed_by_human_id,reviewed_at,revision,created_at,updated_at) VALUES ('release-native','APPROVED',?,'human-a',1,1,1,1)`).run(digest);
  db.prepare(`INSERT INTO catalog_installations (release_id,artifact_digest,artifact_path,state,installed_by_human_id,installed_at,last_verified_at,revision) VALUES ('release-native',?,'/private/release-native','INSTALLED','human-a',1,1,1)`).run(digest);
  db.prepare("INSERT INTO secrets (id,name,scope_type,scope_id,ciphertext_b64,created_at) VALUES ('secret-1','API_KEY','package','release-native',?,1)").run(encryptSecret(masterKey, "secret-value"));
}

afterEach(() => {});

describe("real SQLite provisioning atomicity", () => {
  it("scopes the same idempotency UUID to each actor", async () => {
    const db = openDb(":memory:"); migrate(db); seed(db);
    const provisioning = createAgentProvisioning({ db });
    const input = { kind: "BLANK" as const, name: "same-key-a", visibility: "PRIVATE" as const, runnerId: "runner-a", workspacePath: "workspace/same-key-a", modelId: "model-a", localSkills: [], catalogSkills: [], idempotencyKey: "00000000-0000-4000-8000-000000000099", mode: "CLASSIC" as const, desiredState: "STOPPED" as const };
    const first = await provisioning.create(provisioning.toAgentCreation(input, actor), actor);
    const second = await provisioning.create(provisioning.toAgentCreation({ ...input, name: "same-key-b", workspacePath: "workspace/same-key-b" }, secondActor), secondActor);
    expect(second.id).not.toBe(first.id);
    expect(db.prepare("SELECT count(*) AS count FROM agent_provision_operations WHERE operation_id=?").get(input.idempotencyKey)).toEqual({ count: 2 });
    const replayForFirst = await provisioning.create(provisioning.toAgentCreation(input, actor), actor);
    expect(replayForFirst.id).toBe(first.id);
    db.close();
  });

  it.each(["BLANK", "TEMPLATE"] as const)("provisions %s with multiple local skills and preload through one management batch", async kind => {
    const db = openDb(":memory:"); migrate(db); seed(db, false);
    const management = createAgentSkillManagement({ db, localSkillExists: (_tx, name) => ["local-a", "local-b"].includes(name) });
    const provisioning = createAgentProvisioning({
      db, management, requireLiveHuman: () => undefined,
      resolvePortableConfig: () => kind === "TEMPLATE" ? { mode: "CLASSIC", requirements: [] } : {},
      writeTemplateOriginAndRequirements: (tx, agentId) => tx.prepare("INSERT INTO agent_template_origins (agent_id,release_id,mode,consumed_by_kind,consumed_by_human_id,authority_source_id,content_source_id,package_kind,package_name,package_version,catalog_commit,package_commit,package_path,package_digest,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(agentId,"release-native","CLASSIC","ADMIN","human-a","source-team","source-team","native-agent","demo-native","1.0.0",commit,commit,"agents/demo-native",digest,now),
    });
    const base = { name: `local-${kind.toLowerCase()}`, visibility: "PRIVATE" as const, runnerId: "runner-a", workspacePath: `workspace/${kind.toLowerCase()}`, modelId: "model-a", localSkills: [{ name: "local-a", preload: true }, { name: "local-b", preload: false }], catalogSkills: [] };
    const input = kind === "BLANK"
      ? { ...base, kind, idempotencyKey: "00000000-0000-4000-8000-000000000091", mode: "CLASSIC" as const, desiredState: "STOPPED" as const }
      : { ...base, kind, packageReleaseId: "release-native", secretBindings: [] };
    const result = await provisioning.create(provisioning.toAgentCreation(input, actor), actor);
    expect(db.prepare("SELECT enabled_skills_json,always_preloaded_skills_json,revision FROM agents WHERE id=?").get(result.id)).toEqual({ enabled_skills_json: '["local-a","local-b"]', always_preloaded_skills_json: '["local-a"]', revision: 2 });
    db.close();
  });

  it("rolls back every real row when the handle expires at bind time", async () => {
    const db = openDb(":memory:"); migrate(db); seed(db);
    let clock = now;
    const base = createSecretReferenceResolver({ db, key: masterKey, now: () => clock });
    const handle = base.issue(actor, "secret-1");
    const resolver: SecretReferenceResolver = { ...base, bindForWrite(tx, currentActor, agentId, bindings) { clock = now + 10 * 60 * 1000 + 1; base.bindForWrite(tx, currentActor, agentId, bindings); } };
    const provisioning = createAgentProvisioning({ db, secretReferenceResolver: resolver, requireLiveHuman: () => undefined,
      resolvePortableConfig: () => ({ mode: "RLM_REPL", requirements: [{ name: "API_KEY", required: true }] }),
      writeTemplateOriginAndRequirements: (tx, agentId) => tx.prepare("INSERT INTO agent_template_origins (agent_id,release_id,mode,consumed_by_kind,consumed_by_human_id,authority_source_id,content_source_id,package_kind,package_name,package_version,catalog_commit,package_commit,package_path,package_digest,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(agentId,"release-native","RLM_REPL","ADMIN","human-a","source-team","source-team","native-agent","demo-native","1.0.0",commit,commit,"agents/demo-native",digest,now),
    });
    const command = provisioning.toAgentCreation({ kind: "TEMPLATE", name: "expired", visibility: "PRIVATE", runnerId: "runner-a", workspacePath: "workspace/expired", modelId: "model-a", packageReleaseId: "release-native", localSkills: [], catalogSkills: [], secretBindings: [{ requirementName: "API_KEY", secretReferenceId: handle }] }, actor);
    await expect(provisioning.create(command, actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const table of ["agents", "agent_template_origins", "agent_skill_assignments", "agent_package_secret_bindings", "runner_package_deployments"]) expect(db.prepare(`SELECT count(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
    db.close();
  });

  it("rolls back management assignments when deployment queue insertion fails", async () => {
    const db = openDb(":memory:"); migrate(db); seed(db);
    db.prepare(`INSERT INTO catalog_package_releases (package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,manifest_json,execution_preview_json,warnings_json,created_at) VALUES ('release-skill','source-team','source-team','skill','demo-skill','1.0.0',?,?,?,?,?,?,?,1)`).run(digest, commit, commit, "skills/demo-skill", JSON.stringify({ ...approvedRelease("skill").manifest, name: "demo-skill" }), JSON.stringify({ apiEventShapes: [], runnerScripts: [], wrappedCommands: [], externalSources: [] }), "[]");
    db.prepare("INSERT INTO catalog_release_controls (package_release_id,review_state,review_digest,reviewed_by_human_id,reviewed_at,revision,created_at,updated_at) VALUES ('release-skill','APPROVED',?,'human-a',1,1,1,1)").run(digest);
    db.prepare("INSERT INTO catalog_installations (release_id,artifact_digest,artifact_path,state,installed_by_human_id,installed_at,last_verified_at,revision) VALUES ('release-skill',?,'/private/release-skill','INSTALLED','human-a',1,1,1)").run(digest);
    db.exec("CREATE TEMP TRIGGER fail_provision_deployment BEFORE INSERT ON runner_package_deployments BEGIN SELECT RAISE(ABORT, 'private deployment failure'); END");
    const management = createAgentSkillManagement({ db, localSkillExists: (_tx, name) => ["local-a", "local-b"].includes(name), validateCatalog: () => ({ localSkillName: "demo-skill", runnerId: "runner-a", actorKind: "ADMIN", grantId: null }), enqueueCompleteGeneration: tx => { tx.prepare("INSERT INTO runner_package_deployments (deployment_id,target_agent_id,release_id,bound_runner_id,desired_generation,state,revision,created_at,updated_at) VALUES (?,?,?,?,?,'QUEUED',1,?,?)").run("deployment-a", "pending", "release-skill", "runner-a", "generation-a", now, now); return "deployment-a"; }, writeAudit: () => undefined });
    const provisioning = createAgentProvisioning({ db, management, requireLiveHuman: () => undefined, resolvePortableConfig: () => ({ mode: "RLM_REPL", requirements: [{ name: "API_KEY", required: true }], digest }), writeTemplateOriginAndRequirements: (tx, agentId) => tx.prepare("INSERT INTO agent_template_origins (agent_id,release_id,mode,consumed_by_kind,consumed_by_human_id,authority_source_id,content_source_id,package_kind,package_name,package_version,catalog_commit,package_commit,package_path,package_digest,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(agentId,"release-native","RLM_REPL","ADMIN","human-a","source-team","source-team","native-agent","demo-native","1.0.0",commit,commit,"agents/demo-native",digest,now) });
    const command = provisioning.toAgentCreation({ kind: "TEMPLATE", name: "deployment-failure", visibility: "PRIVATE", runnerId: "runner-a", workspacePath: "workspace/deployment-failure", modelId: "model-a", packageReleaseId: "release-native", localSkills: [{ name: "local-a", preload: true }, { name: "local-b", preload: false }], catalogSkills: [{ packageReleaseId: "release-skill", preload: false }], secretBindings: [] }, actor);
    await expect(provisioning.create(command, actor)).rejects.toMatchObject({ code: "STORAGE_FAILURE" });
    for (const table of ["agents", "agent_template_origins", "agent_skill_assignments", "runner_package_deployments", "events"]) expect(db.prepare(`SELECT count(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
    db.close();
  });

  it("rolls back all state when the production provisioning audit insert fails without leaking handles", async () => {
    const db = openDb(":memory:"); migrate(db); seed(db);
    const resolver = createSecretReferenceResolver({ db, key: masterKey, now: () => now });
    const handle = resolver.issue(actor, "secret-1");
    db.exec("CREATE TEMP TRIGGER fail_provision_audit BEFORE INSERT ON events WHEN NEW.type='audit.catalog.template.instantiated' BEGIN SELECT RAISE(ABORT, 'private audit failure'); END");
    const provisioning = createAgentProvisioning({ db, secretReferenceResolver: resolver, requireLiveHuman: () => undefined, resolvePortableConfig: () => ({ mode: "RLM_REPL", requirements: [{ name: "API_KEY", required: true }], digest }), writeAudit: (tx, event) => tx.prepare("INSERT INTO events (id,type,payload_json,source,status,created_at) VALUES (?,?,?,?,?,?)").run("audit-failure", String(event.type), JSON.stringify(event.payload), "system", "DELIVERED", now), writeTemplateOriginAndRequirements: (tx, agentId) => tx.prepare("INSERT INTO agent_template_origins (agent_id,release_id,mode,consumed_by_kind,consumed_by_human_id,authority_source_id,content_source_id,package_kind,package_name,package_version,catalog_commit,package_commit,package_path,package_digest,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(agentId,"release-native","RLM_REPL","ADMIN","human-a","source-team","source-team","native-agent","demo-native","1.0.0",commit,commit,"agents/demo-native",digest,now) });
    const command = provisioning.toAgentCreation({ kind: "TEMPLATE", name: "audit-failure", visibility: "PRIVATE", runnerId: "runner-a", workspacePath: "workspace/audit-failure", modelId: "model-a", packageReleaseId: "release-native", localSkills: [], catalogSkills: [], secretBindings: [{ requirementName: "API_KEY", secretReferenceId: handle }] }, actor);
    let thrown: unknown;
    try { await provisioning.create(command, actor); } catch (error) { thrown = error; }
    expect(thrown).toMatchObject({ code: "STORAGE_FAILURE" });
    expect(JSON.stringify(thrown)).not.toContain(handle);
    expect(JSON.stringify(thrown)).not.toContain("secret-1");
    for (const table of ["agents", "agent_template_origins", "agent_package_secret_bindings", "events", "runner_package_deployments"]) expect(db.prepare(`SELECT count(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
    db.close();
  });

  it("creates a real stopped missing-secret template without runtime side effects", async () => {
    const db = openDb(":memory:"); migrate(db); seed(db);
    const provisioning = createAgentProvisioning({ db, requireLiveHuman: () => undefined,
      resolvePortableConfig: () => ({ mode: "RLM_REPL", requirements: [{ name: "API_KEY", required: true }] }),
      writeAudit: (tx, event) => tx.prepare("INSERT INTO events (id,type,payload_json,source,status,created_at) VALUES (?,?,?,?,?,?)").run("audit-1", String(event.type), JSON.stringify(event.payload), "system", "DELIVERED", now),
      writeTemplateOriginAndRequirements: (tx, agentId) => tx.prepare("INSERT INTO agent_template_origins (agent_id,release_id,mode,consumed_by_kind,consumed_by_human_id,authority_source_id,content_source_id,package_kind,package_name,package_version,catalog_commit,package_commit,package_path,package_digest,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(agentId,"release-native","RLM_REPL","ADMIN","human-a","source-team","source-team","native-agent","demo-native","1.0.0",commit,commit,"agents/demo-native",digest,now),
    });
    const result = await provisioning.create(provisioning.toAgentCreation({ kind: "TEMPLATE", name: "missing", visibility: "PRIVATE", runnerId: "runner-a", workspacePath: "workspace/missing", modelId: "model-a", packageReleaseId: "release-native", localSkills: [], catalogSkills: [], secretBindings: [] }, actor), actor);
    expect(result).toMatchObject({ desiredState: "STOPPED", runtimeState: "STOPPED" });
    expect(db.prepare("SELECT desired_state,runtime_state FROM agents WHERE id=?").get(result.id)).toEqual({ desired_state: "STOPPED", runtime_state: "STOPPED" });
    expect(db.prepare("SELECT count(*) AS count FROM agent_template_origins WHERE agent_id=?").get(result.id)).toEqual({ count: 1 });
    expect(db.prepare("SELECT count(*) AS count FROM events").get()).toEqual({ count: 1 });
    expect(JSON.stringify(result)).not.toContain("secret-1");
    db.close();
  });
});
