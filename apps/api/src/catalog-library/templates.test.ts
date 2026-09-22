import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { CATALOG_LIMITS, type CatalogAuditEvent, type CatalogPolicy, type PackageManifest } from "@orgops/schemas";
import { registerCatalogSourceRoutes } from "../routes/catalog-library";
import { createTemplateInstantiation, TemplateInstantiationError } from "./templates";
import { createSecretBindingMutation } from "./secret-binding";
import { createAgentSkillManagement } from "../unified-skills/management";
import { adminActor, approvedRelease, humanActor, openCatalogFixture } from "./test-fixtures";
import { catalogGrantId } from "./grant-identity";

const json = { "content-type": "application/json" };
const requestBody = {
  name: "agent-from-template", visibility: "PRIVATE" as const, runnerId: "runner-a",
  workspacePath: ".orgops-data/workspaces/agent-from-template", modelId: "model-a", secretBindings: [],
};
const commit = "a".repeat(40);
const digest = `sha256:${"a".repeat(64)}`;

function insertRelease(db: ReturnType<typeof openCatalogFixture>["db"], manifest: PackageManifest, id: string, install = true) {
  db.prepare(`INSERT INTO catalog_sources
    (source_id,display_name,canonical_url,repository_identity,ref,enabled,allow_packages,revision,created_at,updated_at)
    VALUES ('source-team','Team','https://github.com/example/team','["github","example","team"]','main',1,0,1,1,1)
    ON CONFLICT(source_id) DO NOTHING`).run();
  db.prepare(`INSERT INTO catalog_package_releases
    (package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,
     manifest_json,execution_preview_json,warnings_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)`)
    .run(id, "source-team", "source-team", manifest.kind, manifest.name, manifest.version, manifest.digest, commit, commit,
      `${manifest.kind === "skill" ? "skills" : "agents"}/${manifest.name}`, JSON.stringify(manifest),
      JSON.stringify({ apiEventShapes: [], runnerScripts: [], wrappedCommands: [], externalSources: [] }), "[]");
  db.prepare(`INSERT INTO catalog_release_controls
    (package_release_id,review_state,review_digest,reviewed_by_human_id,reviewed_at,revision,created_at,updated_at)
    VALUES (?,'APPROVED',?,'human-a',1,1,1,1)`).run(id, digest);
  if (install) db.prepare(`INSERT INTO catalog_installations
    (release_id,artifact_digest,artifact_path,state,installed_by_human_id,installed_at,last_verified_at,revision)
    VALUES (?,?,?,'INSTALLED','human-a',1,1,1)`).run(id, digest, `/private/${id}`);
}

function dependencyPin(name: string) {
  return { catalogId: "source-team", sourceId: "source-team", name, version: "1.0.0",
    revision: { type: "exact" as const, commit }, digest };
}

function skillManifest(name: string, dependencies: ReturnType<typeof dependencyPin>[] = []): PackageManifest {
  return { ...approvedRelease("skill").manifest, name, dependencies } as PackageManifest;
}

function replaceRootDependencies(fixture: ReturnType<typeof templateFixture>, names: string[]) {
  const row = fixture.db.prepare<[string], { manifest_json: string }>(
    "SELECT manifest_json FROM catalog_package_releases WHERE package_release_id=?",
  ).get(fixture.releaseId)!;
  const manifest = { ...JSON.parse(row.manifest_json), dependencies: names.map(dependencyPin) };
  fixture.db.prepare("UPDATE catalog_package_releases SET manifest_json=? WHERE package_release_id=?")
    .run(JSON.stringify(manifest), fixture.releaseId);
}

function templateFixture(options: { mode?: "CLASSIC" | "RLM_REPL" | "WRAPPED"; withSkill?: boolean; failAudit?: boolean; denySecrets?: boolean } = {}) {
  const opened = openCatalogFixture();
  const mode = options.mode ?? "CLASSIC";
  const base = approvedRelease(mode === "WRAPPED" ? "wrapped-agent" : "native-agent").manifest;
  const skill = approvedRelease("skill").manifest;
  if (options.withSkill) insertRelease(opened.db, skill, "release-skill");
  const dependency = { catalogId: "source-team", sourceId: "source-team", name: "demo-skill", version: "1.0.0",
    revision: { type: "exact" as const, commit }, digest };
  const manifest: PackageManifest = mode === "WRAPPED"
    ? { ...base, name: "demo-wrapped", secrets: [{ name: "API_KEY", description: "API key", required: true }] } as PackageManifest
    : { ...base, name: `demo-${mode.toLowerCase()}`, dependencies: options.withSkill ? [dependency] : [],
      secrets: [{ name: "API_KEY", description: "API key", required: true }],
      native: { ...(base as Extract<PackageManifest, { kind: "native-agent" }>).native, mode,
        alwaysPreloadedSkills: options.withSkill ? ["demo-skill"] : [] } } as PackageManifest;
  const releaseId = mode === "CLASSIC" ? "release-native-classic" : mode === "RLM_REPL" ? "release-native-rlm" : "release-wrapped";
  insertRelease(opened.db, manifest, releaseId);
  opened.db.prepare(`INSERT INTO secrets (id,name,scope_type,scope_id,ciphertext_b64,created_at)
    VALUES ('secret-1','API_KEY','package',?,'secret-value',1)`).run(manifest.name);
  const audits: CatalogAuditEvent[] = [];
  const management = createAgentSkillManagement({
    db: opened.db,
    validateCatalog: (tx, command, actor) => {
      const release = tx.prepare<[string], { name: string }>("SELECT name FROM catalog_package_releases WHERE package_release_id=?").get(command.packageReleaseId);
      if (!release) throw new Error("NOT_FOUND");
      return { localSkillName: release.name, runnerId: "runner-a", actorKind: actor.kind === "HUMAN_ADMIN" ? "ADMIN" : "GRANT", grantId: actor.kind === "HUMAN_ADMIN" ? null : catalogGrantId(releaseId, "HUMAN", actor.id) };
    },
    enqueueCompleteGeneration: () => "deployment-fixture",
    writeAudit: () => undefined,
  });
  const policy: CatalogPolicy = { decide: input => input.action === "TEMPLATE_INSTANTIATE" ? { allow: true } : { allow: false, reasonCode: "FORBIDDEN" } };
  let sequence = 0;
  const service = createTemplateInstantiation({
    db: opened.db, policy, management, resolveWorkspacePath: path => `/project/${path}`, isWorkspaceAllowed: path => path.startsWith("/project/"),
    now: () => 1234, newId: () => `generated-${++sequence}`,
    canUseSecret: () => !options.denySecrets,
    writeAudit(tx, event) {
      expect(tx.inTransaction).toBe(true);
      if (options.failAudit) throw new Error("private audit storage detail");
      audits.push(event);
      tx.prepare(`INSERT INTO events
        (id,type,payload_json,source,channel_id,parent_event_id,deliver_at,status,fail_count,last_error,idempotency_key,created_at)
        VALUES (?,?,?,?,NULL,NULL,NULL,'DELIVERED',0,NULL,NULL,?)`).run(`audit-${sequence}`, event.type, JSON.stringify(event.payload), "system", 1234);
    },
  });
  return {
    ...opened, service, releaseId, audits,
    input: (bindings: Array<{ requirementName: string; secretId: string }> = []) => ({ packageReleaseId: releaseId, ownerHumanId: "human-a", ...requestBody, secretBindings: bindings }),
  };
}

describe("createTemplateInstantiation", () => {
  it("does not own agent/template/assignment writes", async () => {
    const source = await import("node:fs/promises").then(fs => fs.readFile(new URL("./templates.ts", import.meta.url), "utf8"));
    expect(source).not.toMatch(/INSERT INTO agents|INSERT INTO agent_template_origins|INSERT INTO agent_skill_assignments/);
  });
  it("binds a required secret through the owner/admin mutation and advances the agent revision", async () => {
    const fixture = templateFixture({ mode: "RLM_REPL" });
    try {
      const created = await fixture.service.instantiateTemplate(fixture.input(), adminActor());
      const audits: CatalogAuditEvent[] = [];
      const binding = createSecretBindingMutation({ db: fixture.db, isSecretUsable: () => true, canUseSecret: () => true,
        writeAudit: (_tx, event) => audits.push(event), now: () => 2000 });
      expect(binding.bind(created.agent.id, "API_KEY", { expectedAgentRevision: 1, secretId: "secret-1" }, adminActor())).toEqual({
        agentId: created.agent.id, requirementName: "API_KEY", revision: 2, state: "SATISFIED",
      });
      expect(fixture.db.prepare("SELECT secret_id,revision FROM agent_package_secret_bindings").get()).toEqual({ secret_id: "secret-1", revision: 1 });
      expect(fixture.db.prepare("SELECT revision FROM agents WHERE id=?").get(created.agent.id)).toEqual({ revision: 2 });
      expect(audits).toHaveLength(1);
      expect(() => binding.bind(created.agent.id, "API_KEY", { expectedAgentRevision: 1, secretId: "secret-1" }, adminActor())).toThrow("REVISION_CONFLICT");
    } finally { fixture.close(); }
  });

  it("rejects immutable origin drift introduced by a secret-policy race", async () => {
    const fixture = templateFixture({ mode: "RLM_REPL" });
    try {
      const created = await fixture.service.instantiateTemplate(fixture.input(), adminActor());
      const binding = createSecretBindingMutation({ db: fixture.db, isSecretUsable: () => {
        fixture.db.prepare("UPDATE agent_template_origins SET package_path='agents/raced' WHERE agent_id=?").run(created.agent.id);
        return true;
      }, canUseSecret: () => true, writeAudit: () => undefined });
      expect(() => binding.bind(created.agent.id, "API_KEY", { expectedAgentRevision: 1, secretId: "secret-1" }, adminActor()))
        .toThrow("STATE_CONFLICT");
      expect(fixture.db.prepare("SELECT count(*) AS count FROM agent_package_secret_bindings").get()).toEqual({ count: 0 });
    } finally { fixture.close(); }
  });

  it("rejects a corrupted immutable template origin before resolving the secret requirement", async () => {
    const fixture = templateFixture({ mode: "RLM_REPL" });
    try {
      const created = await fixture.service.instantiateTemplate(fixture.input(), adminActor());
      fixture.db.prepare("UPDATE agent_template_origins SET package_version='9.9.9' WHERE agent_id=?").run(created.agent.id);
      const binding = createSecretBindingMutation({ db: fixture.db, isSecretUsable: () => true, canUseSecret: () => true,
        writeAudit: () => undefined });
      expect(() => binding.bind(created.agent.id, "API_KEY", { expectedAgentRevision: 1, secretId: "secret-1" }, adminActor()))
        .toThrow("STATE_CONFLICT");
      expect(fixture.db.prepare("SELECT count(*) AS count FROM agent_package_secret_bindings").get()).toEqual({ count: 0 });
    } finally { fixture.close(); }
  });

  it.each(["CLASSIC", "RLM_REPL", "WRAPPED"] as const)("creates an independent stopped %s instance", async mode => {
    const fixture = templateFixture({ mode });
    try {
      const result = await fixture.service.instantiateTemplate(fixture.input(), adminActor());
      expect(result.agent).toMatchObject({ ownerHumanId: "human-a", mode, desiredState: "STOPPED", runtimeState: "STOPPED", channelIds: [] });
      expect(result.origin).toEqual({ packageReleaseId: fixture.releaseId, mode, actorKind: "ADMIN", actorHumanId: "human-a", createdAt: 1234 });
      expect(fixture.db.prepare("SELECT desired_state,runtime_state,owner_human_id,enabled_skills_json,always_preloaded_skills_json FROM agents WHERE name='agent-from-template'").get())
        .toEqual({ desired_state: "STOPPED", runtime_state: "STOPPED", owner_human_id: "human-a", enabled_skills_json: "[]", always_preloaded_skills_json: "[]" });
      const copied = fixture.db.prepare(`SELECT o.authority_source_id,o.content_source_id,o.package_kind,o.package_name,o.package_version,
        o.catalog_commit,o.package_commit,o.package_path,o.package_digest FROM agent_template_origins o`).get();
      const release = fixture.db.prepare(`SELECT authority_source_id,content_source_id,kind AS package_kind,name AS package_name,
        version AS package_version,catalog_commit,package_commit,package_path,digest AS package_digest
        FROM catalog_package_releases WHERE package_release_id=?`).get(fixture.releaseId);
      expect(copied).toEqual(release);
      expect(fixture.db.prepare("SELECT count(*) AS count FROM channels").get()).toEqual({ count: 0 });
    } finally { fixture.close(); }
  });

  it("binds ordinary-human ownership and normalized provenance to the current canonical grant", async () => {
    const fixture = templateFixture({ mode: "CLASSIC", withSkill: true });
    try {
      fixture.db.exec(`INSERT INTO humans (id,username,password_hash,must_change_password,is_admin,created_at,updated_at)
        VALUES ('human-granted','granted','fixture',0,0,1,1)`);
      const grantId = catalogGrantId(fixture.releaseId, "HUMAN", "human-granted");
      fixture.db.prepare(`INSERT INTO catalog_grants
        (grant_id,release_id,subject_type,human_id,revision,revoked_at,created_by_human_id,created_at,updated_at)
        VALUES (?,?,'HUMAN','human-granted',1,NULL,'human-a',1,1)`).run(grantId, fixture.releaseId);
      const result = await fixture.service.instantiateTemplate({ ...fixture.input(), ownerHumanId: "human-granted" }, humanActor("human-granted"));
      expect(result.agent.ownerHumanId).toBe("human-granted");
      expect(result.origin.actorKind).toBe("GRANT");
      expect(fixture.db.prepare("SELECT actor_kind,actor_human_id,grant_id FROM agent_skill_assignments").get())
        .toEqual({ actor_kind: "GRANT", actor_human_id: "human-granted", grant_id: grantId });
    } finally { fixture.close(); }
  });

  it.each([
    ["human", true, false, "HUMAN"],
    ["organization", false, true, "ORGANIZATION"],
    ["overlap", true, true, "HUMAN"],
  ] as const)("persists the exact %s grant on a dependency-free template origin", async (_case, humanGrant, organizationGrant, expectedSubject) => {
    const fixture = templateFixture({ mode: "CLASSIC" });
    try {
      fixture.db.exec(`INSERT INTO humans (id,username,password_hash,must_change_password,is_admin,created_at,updated_at)
        VALUES ('human-origin','origin','fixture',0,0,1,1)`);
      const humanGrantId = catalogGrantId(fixture.releaseId, "HUMAN", "human-origin");
      const organizationGrantId = catalogGrantId(fixture.releaseId, "ORGANIZATION");
      if (humanGrant) fixture.db.prepare(`INSERT INTO catalog_grants
        (grant_id,release_id,subject_type,human_id,revision,revoked_at,created_by_human_id,created_at,updated_at)
        VALUES (?,?,'HUMAN','human-origin',1,NULL,'human-a',1,1)`).run(humanGrantId, fixture.releaseId);
      if (organizationGrant) fixture.db.prepare(`INSERT INTO catalog_grants
        (grant_id,release_id,subject_type,human_id,revision,revoked_at,created_by_human_id,created_at,updated_at)
        VALUES (?,?,'ORGANIZATION',NULL,1,NULL,'human-a',1,1)`).run(organizationGrantId, fixture.releaseId);

      await fixture.service.instantiateTemplate({ ...fixture.input(), ownerHumanId: "human-origin" }, humanActor("human-origin"));
      expect(fixture.db.prepare("SELECT consumed_by_kind,grant_id FROM agent_template_origins").get()).toEqual({
        consumed_by_kind: "GRANT",
        grant_id: expectedSubject === "HUMAN" ? humanGrantId : organizationGrantId,
      });
      expect(fixture.db.prepare("SELECT count(*) AS count FROM agent_skill_assignments").get()).toEqual({ count: 0 });
    } finally { fixture.close(); }
  });

  it("stores null origin grant provenance for an administrator even when grants exist", async () => {
    const fixture = templateFixture({ mode: "CLASSIC" });
    try {
      fixture.db.prepare(`INSERT INTO catalog_grants
        (grant_id,release_id,subject_type,human_id,revision,revoked_at,created_by_human_id,created_at,updated_at)
        VALUES (?,?,'HUMAN','human-a',1,NULL,'human-a',1,1)`)
        .run(catalogGrantId(fixture.releaseId, "HUMAN", "human-a"), fixture.releaseId);
      await fixture.service.instantiateTemplate(fixture.input(), adminActor());
      expect(fixture.db.prepare("SELECT consumed_by_kind,grant_id FROM agent_template_origins").get())
        .toEqual({ consumed_by_kind: "ADMIN", grant_id: null });
    } finally { fixture.close(); }
  });

  it("rejects a genuine dependency cycle instead of treating the back-edge as a duplicate", async () => {
    const fixture = templateFixture({ mode: "CLASSIC" });
    try {
      insertRelease(fixture.db, skillManifest("cycle-b", [dependencyPin("cycle-c")]), "release-cycle-b");
      insertRelease(fixture.db, skillManifest("cycle-c", [dependencyPin("cycle-b")]), "release-cycle-c");
      replaceRootDependencies(fixture, ["cycle-b"]);
      await expect(fixture.service.instantiateTemplate(fixture.input(), adminActor()))
        .rejects.toMatchObject({ code: "IDENTITY_CONFLICT" });
      expect(fixture.db.prepare("SELECT count(*) AS count FROM agents WHERE name='agent-from-template'").get()).toEqual({ count: 0 });
    } finally { fixture.close(); }
  });

  it("rejects dependency closure recursion deeper than the canonical limit", async () => {
    const fixture = templateFixture({ mode: "CLASSIC" });
    try {
      for (let index = 0; index <= CATALOG_LIMITS.recursionDepth; index += 1) {
        const name = `deep-${index}`;
        const dependencies = index === CATALOG_LIMITS.recursionDepth ? [] : [dependencyPin(`deep-${index + 1}`)];
        insertRelease(fixture.db, skillManifest(name, dependencies), `release-${name}`);
      }
      replaceRootDependencies(fixture, ["deep-0"]);
      await expect(fixture.service.instantiateTemplate(fixture.input(), adminActor()))
        .rejects.toMatchObject({ code: "INSPECTION_FAILED" });
      expect(fixture.db.prepare("SELECT count(*) AS count FROM agent_skill_assignments").get()).toEqual({ count: 0 });
    } finally { fixture.close(); }
  });

  it("rejects an aggregate closure larger than the canonical resolved-package limit", async () => {
    const fixture = templateFixture({ mode: "CLASSIC" });
    try {
      const parentCount = CATALOG_LIMITS.dependencies;
      // The root package is depth zero and counts toward the canonical resolved-package budget.
      const total = CATALOG_LIMITS.resolvedPackages;
      for (let index = 0; index < total; index += 1) {
        const children = index < parentCount
          ? Array.from({ length: Math.min(4, total - parentCount - index * 4) }, (_, offset) => `wide-${parentCount + index * 4 + offset}`)
          : [];
        insertRelease(fixture.db, skillManifest(`wide-${index}`, children.map(dependencyPin)), `release-wide-${index}`);
      }
      replaceRootDependencies(fixture, Array.from({ length: parentCount }, (_, index) => `wide-${index}`));
      await expect(fixture.service.instantiateTemplate(fixture.input(), adminActor()))
        .rejects.toMatchObject({ code: "INSPECTION_FAILED" });
      expect(fixture.db.prepare("SELECT count(*) AS count FROM agent_skill_assignments").get()).toEqual({ count: 0 });
    } finally { fixture.close(); }
  });

  it("deduplicates completed shared DAG nodes while preserving deterministic traversal", async () => {
    const fixture = templateFixture({ mode: "CLASSIC" });
    try {
      insertRelease(fixture.db, skillManifest("dag-d"), "release-dag-d");
      insertRelease(fixture.db, skillManifest("dag-b", [dependencyPin("dag-d")]), "release-dag-b");
      insertRelease(fixture.db, skillManifest("dag-c", [dependencyPin("dag-d")]), "release-dag-c");
      replaceRootDependencies(fixture, ["dag-b", "dag-c"]);
      await fixture.service.instantiateTemplate(fixture.input(), adminActor());
      expect(fixture.db.prepare("SELECT local_skill_name FROM agent_skill_assignments ORDER BY rowid").all()).toEqual([
        { local_skill_name: "dag-b" }, { local_skill_name: "dag-d" }, { local_skill_name: "dag-c" },
      ]);
    } finally { fixture.close(); }
  });

  it("stores secret references only, reports missing requirements, and emits one channel-less delivered audit", async () => {
    const fixture = templateFixture({ mode: "WRAPPED" });
    try {
      const missing = await fixture.service.instantiateTemplate(fixture.input(), adminActor());
      expect(missing.requirements).toEqual([{ name: "API_KEY", state: "MISSING" }]);
      fixture.db.prepare("DELETE FROM events").run(); fixture.db.prepare("DELETE FROM agent_template_origins").run(); fixture.db.prepare("DELETE FROM agents WHERE name='agent-from-template'").run();
      const result = await fixture.service.instantiateTemplate({ ...fixture.input([{ requirementName: "API_KEY", secretId: "secret-1" }]), name: "bound-agent" }, adminActor());
      expect(result.requirements).toEqual([{ name: "API_KEY", state: "SATISFIED" }]);
      expect(fixture.db.prepare("SELECT requirement_name,secret_id FROM agent_package_secret_bindings").all()).toEqual([{ requirement_name: "API_KEY", secret_id: "secret-1" }]);
      expect(JSON.stringify(result)).not.toContain("secret-value");
      expect(fixture.db.prepare("SELECT type,channel_id,status FROM events").all()).toEqual([{ type: "audit.catalog.template.instantiated", channel_id: null, status: "DELIVERED" }]);
      expect(fixture.db.prepare("SELECT count(*) AS count FROM event_receipts").get()).toEqual({ count: 0 });
    } finally { fixture.close(); }
  });

  it.each([
    ["missing", "missing-secret", false], ["inaccessible", "secret-1", true],
  ] as const)("fails closed on a supplied %s secret reference without persisting it", async (_condition, secretId, denySecrets) => {
    const fixture = templateFixture({ mode: "WRAPPED", denySecrets });
    try {
      await expect(fixture.service.instantiateTemplate(fixture.input([{ requirementName: "API_KEY", secretId }]), adminActor()))
        .rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(fixture.db.prepare("SELECT count(*) AS count FROM agent_package_secret_bindings").get()).toEqual({ count: 0 });
      expect(fixture.db.prepare("SELECT count(*) AS count FROM agents WHERE name='agent-from-template'").get()).toEqual({ count: 0 });
    } finally { fixture.close(); }
  });

  it("persists complete exact template skill pins only as normalized disabled assignments", async () => {
    const fixture = templateFixture({ mode: "CLASSIC", withSkill: true });
    try {
      await fixture.service.instantiateTemplate(fixture.input(), adminActor());
      expect(fixture.db.prepare(`SELECT release_id,local_skill_name,desired_state,effective_state,deployment_state,preload,actor_kind,grant_id
        FROM agent_skill_assignments`).all()).toEqual([{ release_id: "release-skill", local_skill_name: "demo-skill", desired_state: "ENABLED",
          effective_state: "DISABLED", deployment_state: "REQUESTED", preload: 1, actor_kind: "ADMIN", grant_id: null }]);
      expect(fixture.db.prepare("SELECT enabled_skills_json,always_preloaded_skills_json FROM agents WHERE name='agent-from-template'").get())
        .toEqual({ enabled_skills_json: "[]", always_preloaded_skills_json: "[]" });
    } finally { fixture.close(); }
  });

  it.each([
    ["absent installation", "DELETE FROM catalog_installations WHERE release_id='release-skill'", "INSTALLATION_REQUIRED"],
    ["quarantined installation", "UPDATE catalog_installations SET state='QUARANTINED' WHERE release_id='release-skill'", "INSTALLATION_REQUIRED"],
    ["digest-drifted installation", `UPDATE catalog_installations SET artifact_digest='sha256:${"b".repeat(64)}' WHERE release_id='release-skill'`, "INSTALLATION_REQUIRED"],
    ["unapproved release", "UPDATE catalog_release_controls SET review_state='WITHDRAWN' WHERE package_release_id='release-skill'", "RELEASE_NOT_APPROVED"],
    ["inactive required API", `UPDATE catalog_package_releases SET execution_preview_json='{"apiEventShapes":["event-shapes.ts"],"runnerScripts":[],"wrappedCommands":[],"externalSources":[]}' WHERE package_release_id='release-skill'`, "API_ACTIVATION_REQUIRED"],
  ] as const)("rejects a %s anywhere in the exact skill closure atomically", async (_condition, mutation, code) => {
    const fixture = templateFixture({ mode: "CLASSIC", withSkill: true });
    try {
      fixture.db.exec(mutation);
      await expect(fixture.service.instantiateTemplate(fixture.input(), adminActor())).rejects.toMatchObject({ code });
      expect(fixture.db.prepare("SELECT count(*) AS count FROM agents WHERE name='agent-from-template'").get()).toEqual({ count: 0 });
      expect(fixture.db.prepare("SELECT count(*) AS count FROM agent_template_origins").get()).toEqual({ count: 0 });
    } finally { fixture.close(); }
  });

  it("rejects absent/ambiguous identity and wrong-kind skill pins", async () => {
    const absent = templateFixture({ mode: "CLASSIC", withSkill: true });
    try {
      const root = absent.db.prepare("SELECT manifest_json FROM catalog_package_releases WHERE package_release_id='release-native-classic'").get() as { manifest_json: string };
      const manifest = JSON.parse(root.manifest_json); manifest.dependencies[0].digest = `sha256:${"b".repeat(64)}`;
      absent.db.prepare("UPDATE catalog_package_releases SET manifest_json=? WHERE package_release_id='release-native-classic'").run(JSON.stringify(manifest));
      await expect(absent.service.instantiateTemplate(absent.input(), adminActor())).rejects.toMatchObject({ code: "IDENTITY_CONFLICT" });
    } finally { absent.close(); }

    const wrongKind = templateFixture({ mode: "CLASSIC", withSkill: true });
    try {
      const native = approvedRelease("native-agent").manifest as Extract<PackageManifest, { kind: "native-agent" }>;
      wrongKind.db.prepare("UPDATE catalog_package_releases SET kind='native-agent',manifest_json=? WHERE package_release_id='release-skill'")
        .run(JSON.stringify({ ...native, name: "demo-skill" }));
      await expect(wrongKind.service.instantiateTemplate(wrongKind.input(), adminActor())).rejects.toMatchObject({ code: "IDENTITY_CONFLICT" });
      expect(wrongKind.db.prepare("SELECT count(*) AS count FROM agent_skill_assignments").get()).toEqual({ count: 0 });
    } finally { wrongKind.close(); }
  });

  it.each([
    ["agent", "agents"], ["origin", "agent_template_origins"], ["assignment", "agent_skill_assignments"], ["binding", "agent_package_secret_bindings"],
  ] as const)("rolls back every row when the %s write seam fails", async (_seam, table) => {
    const fixture = templateFixture({ mode: "CLASSIC", withSkill: true });
    try {
      fixture.db.exec(`CREATE TRIGGER fail_template_write BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'private sqlite detail'); END`);
      await expect(fixture.service.instantiateTemplate(fixture.input([{ requirementName: "API_KEY", secretId: "secret-1" }]), adminActor()))
        .rejects.toEqual(new TemplateInstantiationError("STORAGE_FAILURE"));
      expect(fixture.db.prepare("SELECT count(*) AS count FROM agents WHERE name='agent-from-template'").get()).toEqual({ count: 0 });
      expect(fixture.db.prepare("SELECT count(*) AS count FROM agent_template_origins").get()).toEqual({ count: 0 });
      expect(fixture.db.prepare("SELECT count(*) AS count FROM agent_skill_assignments").get()).toEqual({ count: 0 });
      expect(fixture.db.prepare("SELECT count(*) AS count FROM agent_package_secret_bindings").get()).toEqual({ count: 0 });
      expect(fixture.db.prepare("SELECT count(*) AS count FROM events").get()).toEqual({ count: 0 });
    } finally { fixture.close(); }
  });

  it("rolls back agent, origin, assignments, bindings and audit when the audit seam fails", async () => {
    const fixture = templateFixture({ mode: "CLASSIC", withSkill: true, failAudit: true });
    try {
      await expect(fixture.service.instantiateTemplate(fixture.input([{ requirementName: "API_KEY", secretId: "secret-1" }]), adminActor()))
        .rejects.toEqual(new TemplateInstantiationError("STORAGE_FAILURE"));
      for (const table of ["agents", "agent_template_origins", "agent_skill_assignments", "agent_package_secret_bindings", "events"]) {
        const where = table === "agents" ? " WHERE name='agent-from-template'" : "";
        expect(fixture.db.prepare(`SELECT count(*) AS count FROM ${table}${where}`).get()).toEqual({ count: 0 });
      }
    } finally { fixture.close(); }
  });
});

describe("template instantiation route contract", () => {
  it.each(["AGENT", "PSEUDO_USER"] as const)("denies authenticated %s principals before domain work", async kind => {
    let calls = 0;
    const app = new Hono();
    registerCatalogSourceRoutes(app as any, {
      authority: { execute: async () => { throw new Error("unused"); }, query: async () => { throw new Error("unused"); } },
      requireAuth: async (c: any, next: () => Promise<void>) => {
        c.set("user", kind === "AGENT" ? { agentName: "agent-a", username: "agent-a" } : { username: "internal" });
        await next();
      },
      requireAdmin: async (_c: any, next: () => Promise<void>) => next(), resolveLibraryActor: () => undefined,
      templateInstantiation: { instantiateTemplate: async () => { calls += 1; throw new Error("must not call"); } },
    } as any);
    const response = await app.request("/api/library/templates/release-native/instances", { method: "POST", headers: json, body: JSON.stringify(requestBody) });
    expect(response.status).toBe(403); expect(response.headers.get("cache-control")).toBe("no-store"); expect(calls).toBe(0);
  });

  it("binds through the redacted route with a bounded strict body", async () => {
    let calls = 0;
    const app = new Hono();
    registerCatalogSourceRoutes(app as any, {
      authority: { execute: async () => { throw new Error("unused"); }, query: async () => { throw new Error("unused"); } },
      requireAuth: async (c: any, next: () => Promise<void>) => { c.set("user", { id: "human-a", username: "human-a" }); await next(); },
      requireAdmin: async (_c: any, next: () => Promise<void>) => next(),
      resolveLibraryActor: () => ({ kind: "AUTHENTICATED_HUMAN", id: "human-a" }),
      secretBinding: { bind: async (...args: unknown[]) => { calls += 1; expect(args.slice(0, 2)).toEqual(["agent-a", "API_KEY"]); return { agentId: "agent-a", requirementName: "API_KEY", revision: 2, state: "SATISFIED" }; } },
    } as any);
    const response = await app.request("/api/library/agents/agent-a/requirements/API_KEY/secret-binding", {
      method: "PUT", headers: json, body: JSON.stringify({ expectedAgentRevision: 1, secretId: "secret-1", ignored: "nope" }),
    });
    expect(response.status).toBe(400); expect(calls).toBe(0); expect(response.headers.get("cache-control")).toBe("no-store");
    const ok = await app.request("/api/library/agents/agent-a/requirements/API_KEY/secret-binding", {
      method: "PUT", headers: json, body: JSON.stringify({ expectedAgentRevision: 1, secretId: "secret-1" }),
    });
    expect(ok.status).toBe(200); expect(await ok.json()).toEqual({ agentId: "agent-a", requirementName: "API_KEY", revision: 2, state: "SATISFIED" }); expect(calls).toBe(1);
    const oversized = await app.request("/api/library/agents/agent-a/requirements/API_KEY/secret-binding", {
      method: "PUT", headers: json, body: JSON.stringify({ expectedAgentRevision: 1, secretId: "x".repeat(16 * 1024) }),
    });
    expect(oversized.status).toBe(413); expect(calls).toBe(1);
  });

  it("uses the authenticated actor and rejects caller-owned lifecycle fields before domain work", async () => {
    let calls = 0;
    const app = new Hono();
    registerCatalogSourceRoutes(app as any, {
      authority: { execute: async () => { throw new Error("unused"); }, query: async () => { throw new Error("unused"); } },
      requireAuth: async (c: any, next: () => Promise<void>) => { c.set("user", { id: "human-a", username: "human-a" }); await next(); },
      requireAdmin: async (_c: any, next: () => Promise<void>) => next(),
      resolveLibraryActor: () => ({ kind: "AUTHENTICATED_HUMAN", id: "human-a" }),
      templateInstantiation: { instantiateTemplate: async () => { calls += 1; throw new Error("must not call"); } },
    } as any);
    const response = await app.request("/api/library/templates/release-native/instances", {
      method: "POST", headers: json, body: JSON.stringify({ ...requestBody, ownerHumanId: "human-other", desiredState: "RUNNING", mode: "WRAPPED" }),
    });
    expect(response.status).toBe(400);
    expect(calls).toBe(0);
  });
});
