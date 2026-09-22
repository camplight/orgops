import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type OrgOpsDb } from "@orgops/db";
import { PackageManifestSchema, RequirementReasonSchema, StartRequirementsResultSchema } from "@orgops/schemas";
import { createApp } from "../app";
import { createCatalogStartGate } from "./start-gate";

const opened: Array<{ db: OrgOpsDb; dir: string }> = [];
const sha256 = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const computePackageSetDigest = (identities: readonly unknown[]) => sha256(JSON.stringify(identities));
const computeArtifactSemanticDigest = (value: { deploymentId: string; agentId: string; generation: string; packages: readonly unknown[] }) =>
  sha256(JSON.stringify(value));
const packageNamespace = (index: number, release: { name: string; packageReleaseId: string }) =>
  `packages/${String(index).padStart(3, "0")}-${release.name}-${createHash("sha256").update(release.packageReleaseId).digest("hex").slice(0, 12)}`;
afterEach(() => {
  while (opened.length) {
    const fixture = opened.pop()!;
    fixture.db.close();
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

async function deniedCatalogAgentFixture() {
  const dir = mkdtempSync(join(tmpdir(), "orgops-start-gate-unit-"));
  const db = openDb(":memory:");
  opened.push({ db, dir });
  const created = createApp({ db, dataDir: dir, adminUser: "owner", adminPass: "password", runnerToken: "runner-token" });
  const owner = db.prepare<[], { id: string }>("SELECT id FROM humans WHERE username='owner'").get()!.id;
  const digest = `sha256:${"a".repeat(64)}`;
  const manifest = {
    formatVersion: 1, kind: "native-agent", name: "catalog-agent", version: "1.0.0", description: "fixture",
    author: "OrgOps", license: "MIT", compatibility: { orgops: { min: "0.0.1" }, platforms: ["linux"], tools: [] },
    secrets: [], dependencies: [], files: [], executables: [], digest,
    native: { mode: "CLASSIC", systemInstructions: "fixture", runtime: {}, alwaysPreloadedSkills: [] },
  };
  db.prepare("INSERT INTO runner_nodes (id,display_name,metadata_json,created_at,updated_at,last_seen_at) VALUES ('runner-a','Runner A','{}',1,1,1)").run();
  db.prepare("INSERT INTO models (id,provider,model_name,enabled,defaults_json,created_at) VALUES ('model-a','fixture','fixture',1,'{}',1)").run();
  db.prepare(`INSERT INTO agents (id,name,model_id,soul_path,workspace_path,mode,visibility,owner_human_id,desired_state,runtime_state,assigned_runner_id,created_at,updated_at)
    VALUES ('agent-a','agent-a','model-a','soul',?,'CLASSIC','PRIVATE',?,'STOPPED','STOPPED','runner-a',1,1)`).run(join(dir, "workspace"), owner);
  db.prepare(`INSERT INTO catalog_sources (source_id,display_name,canonical_url,repository_identity,ref,enabled,allow_packages,revision,created_at,updated_at)
    VALUES ('source-a','Source','https://github.com/example/catalog','["github","example","catalog"]','main',1,0,1,1,1)`).run();
  db.prepare(`INSERT INTO catalog_package_releases
    (package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,manifest_json,execution_preview_json,warnings_json,created_at)
    VALUES ('release-agent','source-a','source-a','native-agent','catalog-agent','1.0.0',?,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','agents/catalog-agent',?,'{"apiEventShapes":[],"runnerScripts":[],"wrappedCommands":[],"externalSources":[]}','[]',1)`).run(digest, JSON.stringify(manifest));
  db.prepare(`INSERT INTO catalog_release_controls (package_release_id,review_state,review_digest,reviewed_by_human_id,reviewed_at,revision,created_at,updated_at)
    VALUES ('release-agent','APPROVED',?,?,1,1,1,1)`).run(digest, owner);
  db.prepare(`INSERT INTO agent_template_origins
    (agent_id,release_id,mode,consumed_by_kind,consumed_by_human_id,grant_id,authority_source_id,content_source_id,package_kind,
     package_name,package_version,catalog_commit,package_commit,package_path,package_digest,created_at)
    VALUES ('agent-a','release-agent','CLASSIC','ADMIN',?,NULL,'source-a','source-a','native-agent','catalog-agent','1.0.0',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','agents/catalog-agent',?,1)`).run(owner, digest);
  const login = await created.app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "owner", password: "password" }) });
  return { ...created, db, dir, cookie: login.headers.get("set-cookie") ?? "", digest, owner };
}

async function action(fixture: Awaited<ReturnType<typeof deniedCatalogAgentFixture>>, name: string) {
  return fixture.app.request(`/api/agents/agent-a/${name}`, { method: "POST", headers: { cookie: fixture.cookie } });
}

function installRoot(fixture: Awaited<ReturnType<typeof deniedCatalogAgentFixture>>) {
  fixture.db.prepare(`INSERT INTO catalog_installations (release_id,artifact_digest,artifact_path,state,installed_by_human_id,installed_at,last_verified_at,revision)
    VALUES ('release-agent',?,?,'INSTALLED',?,1,1,1)`).run(fixture.digest,
      join(fixture.dir, "catalog-artifacts", "catalog-agent", fixture.digest.slice(7)), fixture.owner);
}

function releaseIdentity(fixture: Awaited<ReturnType<typeof deniedCatalogAgentFixture>>, releaseId = "release-agent") {
  const row = fixture.db.prepare(`SELECT package_release_id,authority_source_id,content_source_id,kind,name,version,digest,
    catalog_commit,package_commit,package_path FROM catalog_package_releases WHERE package_release_id=?`).get(releaseId) as {
      package_release_id: string; authority_source_id: string; content_source_id: string; kind: "skill" | "native-agent" | "wrapped-agent";
      name: string; version: string; digest: string; catalog_commit: string; package_commit: string; package_path: string;
    };
  return { packageReleaseId: row.package_release_id, authoritySourceId: row.authority_source_id, contentSourceId: row.content_source_id,
    kind: row.kind, name: row.name, version: row.version, catalogCommit: row.catalog_commit, packageCommit: row.package_commit,
    packagePath: row.package_path, digest: row.digest };
}

async function activeHistoryFixture() {
  const fixture = await deniedCatalogAgentFixture();
  installRoot(fixture);
  fixture.db.prepare(`INSERT INTO agent_skill_assignments
    (assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,preload,effective_preload,
     active_generation,desired_generation,revision,actor_kind,actor_human_id,created_at,updated_at)
    VALUES ('assignment-active','agent-a','release-agent','demo','ENABLED','ENABLED','STABLE',0,0,
      'generation-current','generation-current',5,'ADMIN',?,1,1)`).run(fixture.owner);
  const identity = releaseIdentity(fixture);
  const manifest = PackageManifestSchema.parse(JSON.parse((fixture.db.prepare(
    "SELECT manifest_json FROM catalog_package_releases WHERE package_release_id='release-agent'",
  ).get() as { manifest_json: string }).manifest_json));
  const packages = [{ release: identity, manifest, direct: true, namespace: packageNamespace(0, identity) }];
  for (const [deploymentId, generation, completedAt] of [
    ["deployment-prior", "generation-prior", 1], ["deployment-current", "generation-current", 2],
  ] as const) {
    fixture.db.prepare(`INSERT INTO runner_package_deployments
      (deployment_id,target_agent_id,release_id,bound_runner_id,desired_generation,state,attempt_token,lease_expires_at,revision,
       desired_roots_json,package_set_digest,artifact_semantic_digest,created_at,updated_at,completed_at)
      VALUES (?,'agent-a','release-agent','runner-a',?,'ACTIVE',?,999999,3,?,?,?,?,?,?)`)
      .run(deploymentId, generation, deploymentId === "deployment-prior" ? "p".repeat(43) : "c".repeat(43),
        JSON.stringify([identity]), computePackageSetDigest([identity]), computeArtifactSemanticDigest({
          deploymentId, agentId: "agent-a", generation, packages,
        }), completedAt, completedAt, completedAt);
  }
  fixture.db.exec(`INSERT INTO runner_deployment_participants
    (deployment_id,assignment_id,agent_id,release_id,local_skill_name,role,target_state,target_preload,
     prior_effective_state,prior_effective_preload,prior_active_generation,assignment_revision)
    VALUES
      ('deployment-prior','assignment-active','agent-a','release-agent','demo','APPLY_DESIRED','ENABLED',0,'DISABLED',0,NULL,1),
      ('deployment-current','assignment-active','agent-a','release-agent','demo','APPLY_DESIRED','ENABLED',0,'ENABLED',0,'generation-prior',3)`);
  return { ...fixture, identity, manifest, packages };
}

describe("catalog package start gate", () => {
  it("holds an immediate transaction across fresh authorization, validation, and the RUNNING write", async () => {
    const fixture = await deniedCatalogAgentFixture();
    fixture.db.prepare(`INSERT INTO catalog_installations (release_id,artifact_digest,artifact_path,state,installed_by_human_id,installed_at,last_verified_at,revision)
      VALUES ('release-agent',?,?,'INSTALLED',?,1,1,1)`).run(fixture.digest,
        join(fixture.dir, "catalog-artifacts", "catalog-agent", fixture.digest.slice(7)), fixture.owner);
    let authorizedInsideTransaction = false;
    const gate = createCatalogStartGate({ db: fixture.db, projectRoot: fixture.dir,
      artifactRoot: join(fixture.dir, "catalog-artifacts"), canManageHuman: () => {
        authorizedInsideTransaction = fixture.db.inTransaction;
        return true;
      } });
    await expect(gate.setDesiredAgentState("agent-a", "RUNNING", { kind: "HUMAN_ADMIN", id: fixture.owner })).resolves.toEqual({ ok: true });
    expect(authorizedInsideTransaction).toBe(true);
    expect(fixture.db.prepare("SELECT desired_state,runtime_state FROM agents WHERE id='agent-a'").get())
      .toEqual({ desired_state: "RUNNING", runtime_state: "STARTING" });
  });

  it("revalidates prerequisite drift inside the same immediate transition transaction", async () => {
    const fixture = await deniedCatalogAgentFixture();
    installRoot(fixture);
    let drifted = false;
    const gate = createCatalogStartGate({ db: fixture.db, projectRoot: fixture.dir, artifactRoot: join(fixture.dir, "catalog-artifacts"),
      canManageHuman: () => {
        if (!drifted) { fixture.db.prepare("DELETE FROM catalog_installations WHERE release_id='release-agent'").run(); drifted = true; }
        return true;
      } });
    await expect(gate.setDesiredAgentState("agent-a", "RUNNING", { kind: "HUMAN_ADMIN", id: fixture.owner }))
      .resolves.toMatchObject({ ok: false, reasons: [{ code: "INSTALLATION_REQUIRED" }] });
    expect(fixture.db.prepare("SELECT desired_state,runtime_state FROM agents WHERE id='agent-a'").get())
      .toEqual({ desired_state: "STOPPED", runtime_state: "STOPPED" });
  });

  it("does not transition a catalog-derived agent to RUNNING when its exact installation is absent", async () => {
    const fixture = await deniedCatalogAgentFixture();
    const response = await fixture.app.request("/api/agents/agent-a/start", { method: "POST", headers: { cookie: fixture.cookie } });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Agent requirements are not satisfied",
      ok: false,
      code: "REQUIREMENTS_UNSATISFIED",
      reasons: [{ code: "INSTALLATION_REQUIRED", packageReleaseId: "release-agent" }],
    });
    expect(fixture.db.prepare("SELECT desired_state,runtime_state FROM agents WHERE id='agent-a'").get())
      .toEqual({ desired_state: "STOPPED", runtime_state: "STOPPED" });
    expect(fixture.db.prepare("SELECT count(*) AS count FROM events WHERE type='agent.control.start'").get()).toEqual({ count: 0 });
  });

  it("uses strict bounded shared result and reason schemas", () => {
    expect(RequirementReasonSchema.safeParse({ code: "SECRET_BINDING_MISSING", packageReleaseId: "release-a", requirementName: "TOKEN" }).success).toBe(true);
    expect(RequirementReasonSchema.safeParse({ code: "SECRET_BINDING_MISSING", packageReleaseId: "release-a", requirementName: "TOKEN", secretId: "secret-a" }).success).toBe(false);
    expect(RequirementReasonSchema.safeParse({ code: "RUNNER_BINDING_MISSING", packageReleaseId: "release-a" }).success).toBe(false);
    expect(StartRequirementsResultSchema.safeParse({ ok: false, code: "REQUIREMENTS_UNSATISFIED",
      reasons: Array.from({ length: 65 }, () => ({ code: "DEPLOYMENT_REQUIRED" })) }).success).toBe(false);
  });

  it.each(["start", "restart", "reload-skills"])("leaves desired and runtime state unchanged when %s fails", async lifecycleAction => {
    const fixture = await deniedCatalogAgentFixture();
    const before = fixture.db.prepare("SELECT desired_state,runtime_state FROM agents WHERE id='agent-a'").get();
    expect((await action(fixture, lifecycleAction)).status).toBe(409);
    expect(fixture.db.prepare("SELECT desired_state,runtime_state FROM agents WHERE id='agent-a'").get()).toEqual(before);
  });

  it("routes PATCH desiredState through the same gate while preserving STOP", async () => {
    const fixture = await deniedCatalogAgentFixture();
    const denied = await fixture.app.request("/api/agents/agent-a", { method: "PATCH",
      headers: { cookie: fixture.cookie, "content-type": "application/json" }, body: JSON.stringify({ desiredState: "RUNNING" }) });
    expect(denied.status).toBe(409);
    expect(fixture.db.prepare("SELECT desired_state FROM agents WHERE id='agent-a'").get()).toEqual({ desired_state: "STOPPED" });
    fixture.db.exec("UPDATE agents SET desired_state='RUNNING',runtime_state='RUNNING' WHERE id='agent-a'");
    expect((await action(fixture, "stop")).status).toBe(200);
    expect(fixture.db.prepare("SELECT desired_state,runtime_state FROM agents WHERE id='agent-a'").get())
      .toEqual({ desired_state: "STOPPED", runtime_state: "STOPPED" });
  });

  it("reports deterministic privacy-safe reasons for independent local prerequisites", async () => {
    const fixture = await deniedCatalogAgentFixture();
    const manifest = JSON.parse((fixture.db.prepare("SELECT manifest_json FROM catalog_package_releases WHERE package_release_id='release-agent'").get() as { manifest_json: string }).manifest_json);
    manifest.secrets = [{ name: "TOKEN", description: "required", required: true }];
    manifest.files = [{ path: "event-shapes.js", executable: false, size: 1, digest: fixture.digest }];
    manifest.executables = [{ path: "event-shapes.js", execution: "api-event-shapes" }];
    fixture.db.prepare("UPDATE catalog_package_releases SET manifest_json=? WHERE package_release_id='release-agent'").run(JSON.stringify(manifest));
    fixture.db.prepare(`INSERT INTO catalog_installations (release_id,artifact_digest,artifact_path,state,installed_by_human_id,installed_at,last_verified_at,revision)
      VALUES ('release-agent',?,?,'QUARANTINED',?,1,1,1)`).run(fixture.digest,
        join(fixture.dir, "catalog-artifacts", "catalog-agent", fixture.digest.slice(7)), fixture.owner);
    fixture.db.exec(`UPDATE agents SET assigned_runner_id=NULL,model_id='missing-model',workspace_path='/';
      INSERT INTO agent_skill_assignments
      (assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,preload,effective_preload,active_generation,desired_generation,revision,actor_kind,actor_human_id,created_at,updated_at)
      VALUES ('assignment-a','agent-a','release-agent','demo','ENABLED','DISABLED','REQUESTED',0,0,NULL,'next',1,'ADMIN','${fixture.owner}',1,1)`);
    const response = await action(fixture, "start");
    const body = await response.json() as { reasons: Array<{ code: string }> };
    expect(body.reasons.map(reason => reason.code)).toEqual([
      "API_ACTIVATION_REQUIRED", "DEPLOYMENT_REQUIRED", "MODEL_BINDING_MISSING", "QUARANTINED",
      "RUNNER_BINDING_MISSING", "SECRET_BINDING_MISSING", "WORKSPACE_BINDING_MISSING",
    ]);
    expect(JSON.stringify(body)).not.toMatch(/secret-a|ciphertext|value/i);
  });

  it("classifies normalized assignments without a template origin as catalog-derived", async () => {
    const fixture = await deniedCatalogAgentFixture();
    fixture.db.exec(`DELETE FROM agent_template_origins;
      INSERT INTO agent_skill_assignments
      (assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,preload,effective_preload,active_generation,desired_generation,revision,actor_kind,actor_human_id,created_at,updated_at)
      VALUES ('assignment-only','agent-a','release-agent','demo','ENABLED','DISABLED','REQUESTED',0,0,NULL,'next',1,'ADMIN','${fixture.owner}',1,1)`);
    const response = await action(fixture, "start");
    const body = await response.json() as { reasons: Array<{ code: string }> };
    expect(body.reasons.map(reason => reason.code)).toEqual(["DEPLOYMENT_REQUIRED", "INSTALLATION_REQUIRED"]);
  });

  it("accepts only a matching ACTIVE deployment generation and complete participant set", async () => {
    const fixture = await deniedCatalogAgentFixture();
    fixture.db.prepare(`INSERT INTO catalog_installations (release_id,artifact_digest,artifact_path,state,installed_by_human_id,installed_at,last_verified_at,revision)
      VALUES ('release-agent',?,?,'INSTALLED',?,1,1,1)`).run(fixture.digest,
        join(fixture.dir, "catalog-artifacts", "catalog-agent", fixture.digest.slice(7)), fixture.owner);
    fixture.db.prepare(`INSERT INTO agent_skill_assignments
      (assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,preload,effective_preload,active_generation,desired_generation,revision,actor_kind,actor_human_id,created_at,updated_at)
      VALUES ('assignment-active','agent-a','release-agent','demo','ENABLED','ENABLED','STABLE',0,0,'generation-a','generation-a',3,'ADMIN',?,1,1)`).run(fixture.owner);
    const identity = { packageReleaseId: "release-agent", authoritySourceId: "source-a", contentSourceId: "source-a", kind: "native-agent" as const,
      name: "catalog-agent", version: "1.0.0", catalogCommit: "a".repeat(40), packageCommit: "a".repeat(40),
      packagePath: "agents/catalog-agent", digest: fixture.digest };
    const manifest = PackageManifestSchema.parse(JSON.parse((fixture.db.prepare("SELECT manifest_json FROM catalog_package_releases WHERE package_release_id='release-agent'").get() as { manifest_json: string }).manifest_json));
    const packages = [{ release: identity, manifest, direct: true, namespace: packageNamespace(0, identity) }];
    fixture.db.prepare(`INSERT INTO runner_package_deployments
      (deployment_id,target_agent_id,release_id,bound_runner_id,desired_generation,state,attempt_token,lease_expires_at,revision,desired_roots_json,package_set_digest,artifact_semantic_digest,created_at,updated_at,completed_at)
      VALUES ('deployment-active','agent-a','release-agent','runner-a','generation-a','ACTIVE',?,999999,3,?,?,?,1,1,1)`)
      .run("a".repeat(43), JSON.stringify([identity]), computePackageSetDigest([identity]), computeArtifactSemanticDigest({
        deploymentId: "deployment-active", agentId: "agent-a", generation: "generation-a", packages,
      }));
    fixture.db.exec(`INSERT INTO runner_deployment_participants
      (deployment_id,assignment_id,agent_id,release_id,local_skill_name,role,target_state,target_preload,prior_effective_state,prior_effective_preload,prior_active_generation,assignment_revision)
      VALUES ('deployment-active','assignment-active','agent-a','release-agent','demo','APPLY_DESIRED','ENABLED',0,'DISABLED',0,NULL,1)`);
    const validStart = await action(fixture, "start");
    expect(validStart.status).toBe(200);
    fixture.db.exec(`UPDATE agents SET desired_state='STOPPED',runtime_state='STOPPED';
      UPDATE runner_package_deployments SET package_set_digest='sha256:${"c".repeat(64)}'`);
    expect((await action(fixture, "restart")).status).toBe(409);
    fixture.db.prepare("UPDATE runner_package_deployments SET package_set_digest=?").run(computePackageSetDigest([identity]));
    fixture.db.exec(`UPDATE runner_package_deployments SET artifact_semantic_digest='sha256:${"b".repeat(64)}'`);
    const drifted = await action(fixture, "restart");
    expect(drifted.status).toBe(409);
    expect((await drifted.json() as { reasons: Array<{ code: string }> }).reasons).toContainEqual({ code: "DEPLOYMENT_REQUIRED" });

    const substituted = { ...identity, catalogCommit: "b".repeat(40) };
    const substitutedPackages = [{ release: substituted, manifest, direct: true, namespace: packageNamespace(0, substituted) }];
    fixture.db.prepare("UPDATE runner_package_deployments SET desired_roots_json=?,package_set_digest=?,artifact_semantic_digest=?")
      .run(JSON.stringify([substituted]), computePackageSetDigest([substituted]), computeArtifactSemanticDigest({
        deploymentId: "deployment-active", agentId: "agent-a", generation: "generation-a", packages: substitutedPackages,
      }));
    expect((await action(fixture, "restart")).status).toBe(409);

    fixture.db.prepare("UPDATE runner_package_deployments SET desired_roots_json=?,package_set_digest=?,artifact_semantic_digest=?")
      .run(JSON.stringify([identity]), computePackageSetDigest([identity]), computeArtifactSemanticDigest({
        deploymentId: "deployment-active", agentId: "agent-a", generation: "generation-a", packages,
      }));
    fixture.db.exec(`UPDATE runner_deployment_participants SET role='CARRY_EFFECTIVE',target_state='ENABLED',prior_effective_state='ENABLED',
      assignment_revision=2,prior_active_generation='generation-old'`);
    expect((await action(fixture, "restart")).status).toBe(409);
  });

  it("accepts a fully validated prior ACTIVE projection for the current participant", async () => {
    const fixture = await activeHistoryFixture();
    expect((await action(fixture, "start")).status).toBe(200);
  });

  it.each([
    ["missing matching participant", "DELETE FROM runner_deployment_participants WHERE deployment_id='deployment-prior'"],
    ["wrong participant release", "UPDATE runner_deployment_participants SET release_id='release-agent-wrong' WHERE deployment_id='deployment-prior'"],
    ["wrong participant local name", "UPDATE runner_deployment_participants SET local_skill_name='other' WHERE deployment_id='deployment-prior'"],
    ["wrong participant target", "UPDATE runner_deployment_participants SET target_state='DISABLED' WHERE deployment_id='deployment-prior'"],
    ["invalid participant prior history", "UPDATE runner_deployment_participants SET prior_effective_state='ENABLED',prior_active_generation=NULL WHERE deployment_id='deployment-prior'"],
    ["wrong participant role", "UPDATE runner_deployment_participants SET role='CARRY_EFFECTIVE' WHERE deployment_id='deployment-prior'"],
    ["implausible participant revision", "UPDATE runner_deployment_participants SET assignment_revision=4 WHERE deployment_id='deployment-prior'"],
  ])("rejects prior ACTIVE history with %s", async (_case, mutation) => {
    const fixture = await activeHistoryFixture();
    if (mutation.includes("release-agent-wrong")) {
      const row = fixture.db.prepare("SELECT * FROM catalog_package_releases WHERE package_release_id='release-agent'").get() as Record<string, unknown>;
      fixture.db.prepare(`INSERT INTO catalog_package_releases
        (package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,
         manifest_json,execution_preview_json,warnings_json,created_at)
        VALUES ('release-agent-wrong',?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(row.authority_source_id, row.content_source_id, row.kind, "other-agent",
          row.version, row.digest, row.catalog_commit, row.package_commit, "agents/other-agent", row.manifest_json,
          row.execution_preview_json, row.warnings_json, row.created_at);
    }
    fixture.db.exec(mutation);
    const response = await action(fixture, "start");
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ reasons: [{ code: "DEPLOYMENT_REQUIRED" }] });
  });

  it("rejects same-release immutable origin substitution including commits, path, and kind", async () => {
    const fixture = await deniedCatalogAgentFixture();
    installRoot(fixture);
    fixture.db.exec("UPDATE catalog_package_releases SET catalog_commit='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' WHERE package_release_id='release-agent'");
    expect((await action(fixture, "start")).status).toBe(409);
  });

  it.each([
    ["wrong name", "OTHER", "package", "catalog-agent", "usable"],
    ["app scope", "TOKEN", "app", null, "usable"],
    ["null scope id", "TOKEN", "package", null, "usable"],
    ["wrong package scope", "TOKEN", "package", "other-package", "usable"],
    ["malformed ciphertext", "TOKEN", "package", "catalog-agent", "malformed"],
  ] as const)("rejects a required secret with %s", async (_case, name, scopeType, scopeId, ciphertext) => {
    const fixture = await deniedCatalogAgentFixture();
    installRoot(fixture);
    const row = fixture.db.prepare("SELECT manifest_json FROM catalog_package_releases WHERE package_release_id='release-agent'").get() as { manifest_json: string };
    const manifest = JSON.parse(row.manifest_json); manifest.secrets = [{ name: "TOKEN", description: "required", required: true }];
    fixture.db.prepare("UPDATE catalog_package_releases SET manifest_json=? WHERE package_release_id='release-agent'").run(JSON.stringify(manifest));
    fixture.db.prepare("INSERT INTO secrets (id,name,scope_type,scope_id,ciphertext_b64,created_at) VALUES ('secret-a',?,?,?,?,1)")
      .run(name, scopeType, scopeId, ciphertext);
    fixture.db.prepare(`INSERT INTO agent_package_secret_bindings
      (agent_id,release_id,requirement_name,secret_id,created_by_human_id,revision,created_at,updated_at)
      VALUES ('agent-a','release-agent','TOKEN','secret-a',?,1,1,1)`).run(fixture.owner);
    const gate = createCatalogStartGate({ db: fixture.db, projectRoot: fixture.dir, artifactRoot: join(fixture.dir, "catalog-artifacts"),
      canManageHuman: () => true, isSecretUsable: ciphertextValue => ciphertextValue === "usable" });
    await expect(gate.validateCatalogStart("agent-a", { kind: "HUMAN_ADMIN", id: fixture.owner })).resolves.toMatchObject({
      ok: false, reasons: [{ code: "SECRET_BINDING_MISSING", packageReleaseId: "release-agent", requirementName: "TOKEN" }],
    });
  });

  it("enforces package scope and usability for required skill-assignment secrets", async () => {
    const fixture = await deniedCatalogAgentFixture();
    fixture.db.exec("DELETE FROM agent_template_origins");
    const row = fixture.db.prepare("SELECT manifest_json FROM catalog_package_releases WHERE package_release_id='release-agent'").get() as { manifest_json: string };
    const manifest = JSON.parse(row.manifest_json); manifest.secrets = [{ name: "TOKEN", description: "required", required: true }];
    fixture.db.prepare("UPDATE catalog_package_releases SET manifest_json=? WHERE package_release_id='release-agent'").run(JSON.stringify(manifest));
    installRoot(fixture);
    fixture.db.prepare(`INSERT INTO agent_skill_assignments
      (assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,preload,effective_preload,active_generation,desired_generation,revision,actor_kind,actor_human_id,created_at,updated_at)
      VALUES ('assignment-skill','agent-a','release-agent','catalog-skill','ENABLED','DISABLED','REQUESTED',0,0,NULL,'next',1,'ADMIN',?,1,1)`).run(fixture.owner);
    fixture.db.prepare("INSERT INTO secrets (id,name,scope_type,scope_id,ciphertext_b64,created_at) VALUES ('secret-skill','TOKEN','package','wrong-skill','usable',1)").run();
    fixture.db.prepare(`INSERT INTO agent_package_secret_bindings
      (agent_id,release_id,requirement_name,secret_id,created_by_human_id,revision,created_at,updated_at)
      VALUES ('agent-a','release-agent','TOKEN','secret-skill',?,1,1,1)`).run(fixture.owner);
    const gate = createCatalogStartGate({ db: fixture.db, projectRoot: fixture.dir, artifactRoot: join(fixture.dir, "catalog-artifacts"),
      canManageHuman: () => true, isSecretUsable: value => value === "usable" });
    const result = await gate.validateCatalogStart("agent-a", { kind: "HUMAN_ADMIN", id: fixture.owner });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons).toContainEqual({ code: "SECRET_BINDING_MISSING", packageReleaseId: "release-agent", requirementName: "TOKEN" });
  });

  it("fails closed when secret usability throws without disclosing secret material", async () => {
    const fixture = await deniedCatalogAgentFixture();
    installRoot(fixture);
    const row = fixture.db.prepare("SELECT manifest_json FROM catalog_package_releases WHERE package_release_id='release-agent'").get() as { manifest_json: string };
    const manifest = JSON.parse(row.manifest_json); manifest.secrets = [{ name: "TOKEN", description: "required", required: true }];
    fixture.db.prepare("UPDATE catalog_package_releases SET manifest_json=? WHERE package_release_id='release-agent'").run(JSON.stringify(manifest));
    fixture.db.prepare("INSERT INTO secrets (id,name,scope_type,scope_id,ciphertext_b64,created_at) VALUES ('private-id','TOKEN','package','catalog-agent','private-ciphertext',1)").run();
    fixture.db.prepare(`INSERT INTO agent_package_secret_bindings
      (agent_id,release_id,requirement_name,secret_id,created_by_human_id,revision,created_at,updated_at)
      VALUES ('agent-a','release-agent','TOKEN','private-id',?,1,1,1)`).run(fixture.owner);
    const gate = createCatalogStartGate({ db: fixture.db, projectRoot: fixture.dir, artifactRoot: join(fixture.dir, "catalog-artifacts"),
      canManageHuman: () => true, isSecretUsable: () => { throw new Error("private-ciphertext"); } });
    const result = await gate.validateCatalogStart("agent-a", { kind: "HUMAN_ADMIN", id: fixture.owner });
    expect(result).toMatchObject({ ok: false, reasons: [{ code: "SECRET_BINDING_MISSING" }] });
    expect(JSON.stringify(result)).not.toMatch(/private-id|private-ciphertext/);
  });

  it("fails closed at the gate boundary for malformed rows and reason overflow", async () => {
    const malformed = await deniedCatalogAgentFixture();
    malformed.db.exec("PRAGMA ignore_check_constraints=ON; UPDATE agents SET revision=0 WHERE id='agent-a'; PRAGMA ignore_check_constraints=OFF");
    const malformedResult = await action(malformed, "start");
    expect(malformedResult.status).toBe(409);
    expect(await malformedResult.json()).toMatchObject({ reasons: [{ code: "DEPLOYMENT_REQUIRED" }] });

    const overflow = await deniedCatalogAgentFixture();
    overflow.db.exec("DELETE FROM agent_template_origins");
    const base = overflow.db.prepare("SELECT * FROM catalog_package_releases WHERE package_release_id='release-agent'").get() as Record<string, unknown>;
    for (let index = 0; index < 65; index++) {
      const releaseId = `release-${index}`; const name = `skill-${index}`;
      const manifest = { ...JSON.parse(String(base.manifest_json)), kind: "skill", name };
      delete manifest.native;
      overflow.db.prepare(`INSERT INTO catalog_package_releases
        (package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,manifest_json,execution_preview_json,warnings_json,created_at)
        VALUES (?,'source-a','source-a','skill',?,'1.0.0',?,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',?,?,'{}','[]',1)`)
        .run(releaseId, name, overflow.digest, `skills/${name}`, JSON.stringify(manifest));
      overflow.db.prepare(`INSERT INTO agent_skill_assignments
        (assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,preload,effective_preload,active_generation,desired_generation,revision,actor_kind,actor_human_id,created_at,updated_at)
        VALUES (?,'agent-a',?,?,'ENABLED','DISABLED','REQUESTED',0,0,NULL,'next',1,'ADMIN',?,1,1)`)
        .run(`assignment-${index}`, releaseId, name, overflow.owner);
    }
    const overflowResult = await action(overflow, "start");
    expect(overflowResult.status).toBe(409);
    const overflowBody = await overflowResult.json() as { reasons: unknown[] };
    expect(overflowBody.reasons).toEqual([{ code: "DEPLOYMENT_REQUIRED" }]);
    expect(JSON.stringify(overflowBody).length).toBeLessThan(512);
  });

  it("rejects malformed catalog wrapped wiring without executing it", async () => {
    const fixture = await deniedCatalogAgentFixture();
    fixture.db.exec(`UPDATE agents SET mode='WRAPPED',model_id='wrapped:none',wrapped_config_json='{}';
      UPDATE agent_template_origins SET mode='WRAPPED',package_kind='wrapped-agent';
      UPDATE catalog_package_releases SET kind='wrapped-agent' WHERE package_release_id='release-agent'`);
    const response = await action(fixture, "start");
    const body = await response.json() as { reasons: Array<{ code: string }> };
    expect(body.reasons.map(reason => reason.code)).toContain("WRAPPED_WIRING_MISSING");
  });

  it("does not recheck grant, Source, or current review policy after local consumption", async () => {
    const fixture = await deniedCatalogAgentFixture();
    fixture.db.prepare(`INSERT INTO catalog_installations (release_id,artifact_digest,artifact_path,state,installed_by_human_id,installed_at,last_verified_at,revision)
      VALUES ('release-agent',?,?,'INSTALLED',?,1,1,1)`).run(fixture.digest,
        join(fixture.dir, "catalog-artifacts", "catalog-agent", fixture.digest.slice(7)), fixture.owner);
    fixture.db.exec(`INSERT INTO catalog_grants
      (grant_id,release_id,subject_type,human_id,revision,revoked_at,created_by_human_id,created_at,updated_at)
      VALUES ('historical-grant','release-agent','HUMAN','${fixture.owner}',1,NULL,'${fixture.owner}',1,1);
      UPDATE agent_template_origins SET consumed_by_kind='GRANT',grant_id='historical-grant';
      INSERT INTO catalog_source_read_credentials
      (source_id,credential_ref,kind,ciphertext_b64,revision,created_at,updated_at)
      VALUES ('source-a','credential-a','https-basic','historical-secret',1,1,1);
      UPDATE catalog_grants SET revoked_at=2 WHERE grant_id='historical-grant';
      DELETE FROM catalog_source_read_credentials WHERE source_id='source-a';
      UPDATE catalog_sources SET enabled=0,removed_at=2 WHERE source_id='source-a';
      UPDATE catalog_release_controls SET review_state='WITHDRAWN',review_digest='sha256:${"b".repeat(64)}' WHERE package_release_id='release-agent'`);
    const response = await action(fixture, "start");
    expect(response.status).toBe(200);
    expect(fixture.db.prepare("SELECT desired_state,runtime_state FROM agents WHERE id='agent-a'").get())
      .toEqual({ desired_state: "RUNNING", runtime_state: "STARTING" });
  });
});
