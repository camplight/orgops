import { createHash } from "node:crypto";
import { chmod, link, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalManifestBytes, exportSkillPackage } from "@orgops/skills";
import { openDb } from "@orgops/db";
import type { CatalogAuditEvent, PackageManifest } from "@orgops/schemas";
import { createRunnerArtifactDelivery, RunnerDeliveryError } from "./runner-delivery";
import { registerRunnersRoutes } from "../routes/runners";
import { createApp } from "../app";
import { openCatalogFixture } from "./test-fixtures";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const commit = "a".repeat(40);
async function fixture(options: { onFileRead?: (path: string) => void | Promise<void> } = {}) {
  const opened = openCatalogFixture();
  const artifactRoot = await mkdtemp(join(tmpdir(), "orgops-delivery-api-")); roots.push(artifactRoot);
  const exported = exportSkillPackage([{ type: "file", path: "SKILL.md", base64: Buffer.from("---\nname: alpha\ndescription: Alpha.\n---\nBody\n").toString("base64"), executable: false }], {
    metadata: { formatVersion: 1, name: "alpha", version: "1.0.0", description: "Alpha.", author: "Test", license: "MIT",
      compatibility: { orgops: { min: "0.0.1" }, platforms: ["linux"], tools: [] }, secrets: [] },
    dependencies: [], executables: [], selectedPaths: ["SKILL.md"],
  });
  if (!exported.ok) throw new Error("fixture");
  const manifest = exported.value.snapshot.manifest;
  const installedPath = join(artifactRoot, "alpha", manifest.digest.slice(7));
  await mkdir(installedPath, { recursive: true, mode: 0o700 });
  for (const file of exported.value.snapshot.files) {
    const path = join(installedPath, file.path); await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, Buffer.from(file.base64, "base64"), { mode: file.executable ? 0o755 : 0o644 });
  }
  await writeFile(join(installedPath, "orgops-package.json"), canonicalManifestBytes(manifest), { mode: 0o644 });
  opened.db.exec(`INSERT INTO catalog_sources
    (source_id,display_name,canonical_url,repository_identity,ref,enabled,allow_packages,revision,created_at,updated_at)
    VALUES ('source-a','A','https://github.com/example/a','["github","example","a"]','main',1,0,1,1,1)`);
  opened.db.prepare(`INSERT INTO catalog_package_releases
    (package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,
     manifest_json,execution_preview_json,warnings_json,created_at) VALUES
    ('release-alpha','source-a','source-a','skill','alpha','1.0.0',?,?,?,?,?,'{"apiEventShapes":[],"runnerScripts":[],"wrappedCommands":[],"externalSources":[]}','[]',1)`)
    .run(manifest.digest, commit, commit, "skills/alpha", JSON.stringify(manifest));
  opened.db.prepare(`INSERT INTO catalog_release_controls
    (package_release_id,review_state,review_digest,reviewed_by_human_id,reviewed_at,revision,created_at,updated_at)
    VALUES ('release-alpha','APPROVED',?,'human-a',1,1,1,1)`).run(manifest.digest);
  opened.db.prepare(`INSERT INTO catalog_installations
    (release_id,artifact_digest,artifact_path,state,installed_by_human_id,installed_at,last_verified_at,revision)
    VALUES ('release-alpha',?,?,'INSTALLED','human-a',1,1,1)`).run(manifest.digest, installedPath);
  opened.db.exec(`INSERT INTO agent_skill_assignments
    (assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,preload,effective_preload,
     active_generation,desired_generation,revision,actor_kind,actor_human_id,created_at,updated_at)
    VALUES ('assignment-a','agent-a','release-alpha','alpha','ENABLED','DISABLED','REQUESTED',1,0,NULL,'generation-a',1,'ADMIN','human-a',1,1);
    INSERT INTO runner_package_deployments
    (deployment_id,target_agent_id,release_id,bound_runner_id,desired_generation,state,revision,created_at,updated_at)
    VALUES ('deploy-a','agent-a','release-alpha','runner-a','generation-a','QUEUED',1,1,1)`);
  const audits: CatalogAuditEvent[] = [];
  let token = 0;
  const delivery = createRunnerArtifactDelivery({ db: opened.db, artifactRoot, now: () => 1000,
    newId: () => `generated-${++token}`, newAttemptToken: () => `${String(++token).padStart(43, "x")}`,
    onFileRead: options.onFileRead,
    writeAudit(tx, audit) { audits.push(audit); tx.prepare(`INSERT INTO events
      (id,type,payload_json,source,status,fail_count,created_at) VALUES (?,?,?,?, 'DELIVERED',0,?)`)
      .run(`audit-${audits.length}`, audit.type, JSON.stringify(audit.payload), "system", 1000); } });
  return { ...opened, delivery, artifactRoot, manifest: manifest as PackageManifest, audits };
}

async function addSyntheticRelease(f: Awaited<ReturnType<typeof fixture>>, releaseId: string, name: string, manifest: PackageManifest) {
  const path = join(f.artifactRoot, name, manifest.digest.slice(7)); await mkdir(path, { recursive: true, mode: 0o700 });
  await writeFile(join(path, "orgops-package.json"), canonicalManifestBytes(manifest), { mode: 0o644 });
  f.db.prepare(`INSERT INTO catalog_package_releases
    (package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,
     manifest_json,execution_preview_json,warnings_json,created_at) VALUES
    (?,'source-a','source-a','skill',?,'1.0.0',?,?,?,?,?,'{"apiEventShapes":[],"runnerScripts":[],"wrappedCommands":[],"externalSources":[]}','[]',1)`)
    .run(releaseId, name, manifest.digest, commit, commit, `skills/${name}`, JSON.stringify(manifest));
  f.db.prepare(`INSERT INTO catalog_release_controls
    (package_release_id,review_state,review_digest,reviewed_by_human_id,reviewed_at,revision,created_at,updated_at)
    VALUES (?,'APPROVED',?,'human-a',1,1,1,1)`).run(releaseId, manifest.digest);
  f.db.prepare(`INSERT INTO catalog_installations
    (release_id,artifact_digest,artifact_path,state,installed_by_human_id,installed_at,last_verified_at,revision)
    VALUES (?,?,?,'INSTALLED','human-a',1,1,1)`).run(releaseId, manifest.digest, path);
  f.db.prepare(`INSERT INTO agent_skill_assignments
    (assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,preload,effective_preload,
     active_generation,desired_generation,revision,actor_kind,actor_human_id,created_at,updated_at)
    VALUES (?, 'agent-a', ?, ?, 'ENABLED','DISABLED','REQUESTED',0,0,NULL,'generation-a',1,'ADMIN','human-a',1,1)`)
    .run(`assignment-${name}`, releaseId, name);
}

function syntheticManifest(base: PackageManifest, name: string, count: number, size: number): PackageManifest {
  const emptyDigest = `sha256:${createHash("sha256").update(Buffer.alloc(0)).digest("hex")}`;
  return { ...structuredClone(base), name, files: Array.from({ length: count }, (_, index) => ({
    path: `file-${String(index).padStart(3, "0")}.txt`, size, digest: emptyDigest, executable: false,
  })) };
}

describe("runner delivery routes", () => {
  function appFor(scope: { mode: "GLOBAL" | "SCOPED"; allowedRunnerId?: string }) {
    const app = new Hono();
    const delivery = {
      poll: vi.fn(async ({ runnerId }) => [{ deploymentId: "deploy-a", agentId: "agent-a", agentName: "agent-a", assignedRunnerId: runnerId, releaseId: "release-alpha", desiredGeneration: "generation-a" }]),
      claim: vi.fn(async ({ deploymentId }) => ({ deploymentId, attemptToken: "x".repeat(43), leaseExpiresAt: 1 })),
      getArtifact: vi.fn(), report: vi.fn(async (_context, report) => ({ deploymentId: "deploy-a", state: report.state, revision: 2 })),
    } as any;
    registerRunnersRoutes(app, { orm: {} as any, bus: { publish() {} } as any, jsonResponse: (c: any, data: unknown, status = 200) => c.json(data, status),
      requireRunnerAuth: async (c: any, next: any) => { c.set("user", { runnerScope: scope }); await next(); }, runnerToken: "secret", runnerApiUrl: "url", runnerArtifactDelivery: delivery } as any);
    return { app, delivery };
  }

  it("denies anonymous and human-cookie principals on all four routes and treats an invalid runner header as authoritative", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "orgops-delivery-auth-")); roots.push(dataDir);
    const db = openDb(":memory:");
    try {
      const created = createApp({ db, dataDir, adminUser: "owner", adminPass: "test-password", runnerToken: "runner-token" });
      const login = await created.app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "owner", password: "test-password" }) });
      const cookie = login.headers.get("set-cookie")!.match(/orgops_session=[^;]+/)![0];
      const routes = [
        ["/api/runners/runner-a/package-deployments", "GET"],
        ["/api/runner-package-deployments/deploy-a/claim", "POST"],
        ["/api/runner-package-deployments/deploy-a/artifact", "GET"],
        ["/api/runner-package-deployments/deploy-a/report", "POST"],
      ] as const;
      for (const [path, method] of routes) {
        for (const headers of [{}, { cookie }, { cookie, "x-orgops-runner-token": "invalid" }] as Array<Record<string, string>>) {
          const response = await created.app.request(path, { method, headers });
          expect(response.status, `${method}:${path}`).toBe(401);
          expect(response.headers.get("cache-control"), `${method}:${path}`).toBe("no-store");
        }
      }
      const owner = db.prepare<[], { id: string }>("SELECT id FROM humans WHERE username='owner'").get()!.id;
      const scopedToken = "org_rt_scoped_delivery_token";
      db.prepare(`INSERT INTO runner_tokens
        (id,name,token_hash,token_prefix,allowed_agent_name,allowed_runner_id,allowed_channel_ids_json,invite_id,created_by_human_id,created_at)
        VALUES ('delivery-token','Delivery',?,?,'agent-a','runner-a','[]',NULL,?,1)`)
        .run(createHash("sha256").update(scopedToken).digest("hex"), scopedToken.slice(0, 16), owner);
      expect((await created.app.request("/api/runners/runner-b/package-deployments", {
        headers: { "x-orgops-runner-token": scopedToken },
      })).status).toBe(403);
    } finally { db.close(); }
  });

  it("does not revive a superseded rollout target after runner reassignment", async () => {
    const f = await fixture();
    try {
      f.db.exec(`INSERT INTO runner_nodes (id,display_name,metadata_json,created_at,updated_at,last_seen_at)
        VALUES ('runner-b','B','{}',1,1,1);
        INSERT INTO catalog_rollouts
          (rollout_id,release_id,operation,preload,plan_digest,state,actor_kind,actor_human_id,revision,created_at,updated_at)
          VALUES ('rollout-reassign','release-alpha','ENABLE',NULL,'sha256:${"b".repeat(64)}','RUNNING','ADMIN','human-a',1,1,1);
        INSERT INTO catalog_rollout_targets
          (rollout_id,agent_id,captured_runner_id,target_ordinal,expected_assignment_revision,state,attempts,reason_code,blocker_json,prior_assignment_json,revision,created_at,updated_at)
          VALUES ('rollout-reassign','agent-a','runner-a',0,1,'SUPERSEDED',1,'DEPLOYMENT_SUPERSEDED',NULL,NULL,2,1,1);
        UPDATE runner_package_deployments SET rollout_id='rollout-reassign' WHERE deployment_id='deploy-a';`);
      await f.delivery.poll({ runnerId: "runner-a" });
      f.db.exec("UPDATE agents SET assigned_runner_id='runner-b'");
      await f.delivery.poll({ runnerId: "runner-b" });
      expect(f.db.prepare("SELECT COUNT(*) AS count FROM runner_package_deployments WHERE rollout_id='rollout-reassign'").get()).toEqual({ count: 1 });
      expect(f.db.prepare("SELECT state FROM catalog_rollout_targets WHERE rollout_id='rollout-reassign'").get()).toEqual({ state: "SUPERSEDED" });
    } finally { f.close(); }
  });

  it("binds scoped and global principals to an explicit registered runner and never caches", async () => {
    const scoped = appFor({ mode: "SCOPED", allowedRunnerId: "runner-a" });
    const ok = await scoped.app.request("/api/runners/runner-a/package-deployments");
    expect(ok.status).toBe(200); expect(ok.headers.get("cache-control")).toBe("no-store");
    expect((await scoped.app.request("/api/runners/runner-b/package-deployments")).status).toBe(403);
    const global = appFor({ mode: "GLOBAL" });
    expect((await global.app.request("/api/runner-package-deployments/deploy-a/claim", { method: "POST" })).status).toBe(400);
    expect((await global.app.request("/api/runner-package-deployments/deploy-a/claim", { method: "POST",
      headers: { "x-orgops-runner-id": "runner-a" } })).status).toBe(200);
  });

  it("rejects query strings, claim bodies, and attempt tokens outside the dedicated header", async () => {
    const f = appFor({ mode: "GLOBAL" });
    expect((await f.app.request("/api/runners/runner-a/package-deployments?x=1")).status).toBe(400);
    expect((await f.app.request("/api/runner-package-deployments/deploy-a/claim", { method: "POST",
      headers: { "x-orgops-runner-id": "runner-a", "content-type": "application/json" }, body: "{}" })).status).toBe(400);
    expect((await f.app.request("/api/runner-package-deployments/deploy-a/artifact?attemptToken=x", {
      headers: { "x-orgops-runner-id": "runner-a" } })).status).toBe(400);
    expect((await f.app.request("/api/runner-package-deployments/deploy-a/report", { method: "POST", headers: {
      "x-orgops-runner-id": "runner-a", "x-orgops-deployment-attempt-token": "x".repeat(43), "content-type": "application/json",
    }, body: JSON.stringify({ state: "STAGED", generation: "generation-a" }) })).status).toBe(200);
  });
});

describe("RunnerArtifactDelivery", () => {
  it("accepts the canonical installer envelope metadata without delivering it as package content", async () => {
    const f = await fixture();
    try {
      const claim = await f.delivery.claim({ runnerId: "runner-a", deploymentId: "deploy-a" });
      const artifact = await f.delivery.getArtifact({ runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: claim.attemptToken });
      expect(artifact.files.map(file => file.path)).toEqual(["SKILL.md"]);
      expect(artifact.files.some(file => file.path === "orgops-package.json")).toBe(false);
    } finally { f.close(); }
  });

  it.each(["compact", "bytes", "mode", "symlink", "hardlink", "root-mode"] as const)("rejects canonical installer metadata tampering: %s", async variant => {
    const f = await fixture();
    try {
      const metadata = join(f.artifactRoot, "alpha", f.manifest.digest.slice(7), "orgops-package.json");
      if (variant === "compact") await writeFile(metadata, JSON.stringify(f.manifest), { mode: 0o644 });
      if (variant === "bytes") await writeFile(metadata, Buffer.from("tampered"), { mode: 0o644 });
      if (variant === "mode") await chmod(metadata, 0o755);
      if (variant === "symlink") {
        await rm(metadata);
        await symlink("SKILL.md", metadata);
      }
      if (variant === "hardlink") {
        const replacement = join(f.artifactRoot, "alpha", f.manifest.digest.slice(7), "metadata-copy");
        await link(metadata, replacement);
      }
      if (variant === "root-mode") await chmod(join(f.artifactRoot, "alpha", f.manifest.digest.slice(7)), 0o755);
      const claim = await f.delivery.claim({ runnerId: "runner-a", deploymentId: "deploy-a" });
      await expect(f.delivery.getArtifact({ runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: claim.attemptToken }))
        .rejects.toEqual(new RunnerDeliveryError("INSPECTION_FAILED"));
    } finally { f.close(); }
  });

  it("polls, claims idempotently, reads verified bytes once, and activates the complete generation", async () => {
    const f = await fixture();
    try {
      expect(await f.delivery.poll({ runnerId: "runner-a" })).toEqual([{ deploymentId: "deploy-a", agentId: "agent-a",
        agentName: "agent-a", assignedRunnerId: "runner-a", releaseId: "release-alpha", desiredGeneration: "generation-a",
        desiredRoots: [expect.objectContaining({ packageReleaseId: "release-alpha", name: "alpha" })], packageSetDigest: expect.stringMatching(/^sha256:/) }]);
      expect(f.db.prepare("SELECT assignment_id,role,target_state,assignment_revision FROM runner_deployment_participants").all())
        .toEqual([{ assignment_id: "assignment-a", role: "APPLY_DESIRED", target_state: "ENABLED", assignment_revision: 1 }]);
      f.db.exec(`INSERT INTO runner_nodes (id,display_name,metadata_json,created_at,updated_at,last_seen_at)
        VALUES ('runner-b','B','{}',1,1,1)`);
      expect(await f.delivery.poll({ runnerId: "runner-b" })).toEqual([]);
      const claim = await f.delivery.claim({ runnerId: "runner-a", deploymentId: "deploy-a" });
      expect(await f.delivery.claim({ runnerId: "runner-a", deploymentId: "deploy-a" })).toEqual(claim);
      const artifact = await f.delivery.getArtifact({ runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: claim.attemptToken });
      expect(artifact.packages.map(pkg => [pkg.release.packageReleaseId, pkg.direct])).toEqual([["release-alpha", true]]);
      expect(Buffer.from(artifact.files[0]!.bytesBase64, "base64").toString()).toContain("Body");
      expect((await f.delivery.report({ runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: claim.attemptToken },
        { state: "STAGED", generation: "generation-a" })).state).toBe("STAGED");
      await f.delivery.report({ runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: claim.attemptToken },
        { state: "WAITING_FOR_IDLE", generation: "generation-a" });
      const active = await f.delivery.report({ runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: claim.attemptToken },
        { state: "ACTIVE", generation: "generation-a" });
      expect(await f.delivery.report({ runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: claim.attemptToken },
        { state: "ACTIVE", generation: "generation-a" })).toEqual(active);
      expect(f.db.prepare("SELECT effective_state,effective_preload,deployment_state,active_generation FROM agent_skill_assignments").get())
        .toEqual({ effective_state: "ENABLED", effective_preload: 1, deployment_state: "STABLE", active_generation: "generation-a" });
      expect(f.audits.map(audit => audit.payload.action)).toEqual(["STAGED", "WAITING_FOR_IDLE", "ACTIVE"]);
      expect(f.db.prepare("SELECT count(*) AS count FROM event_receipts").get()).toEqual({ count: 0 });
    } finally { f.close(); }
  });

  it("carries a failed sibling's effective content into one common active generation without retrying its desired state", async () => {
    const f = await fixture();
    try {
      const pin = { catalogId: "source-a", sourceId: "source-a", name: "alpha", version: "1.0.0",
        revision: { type: "same-package-revision" as const }, digest: f.manifest.digest };
      const exported = exportSkillPackage([{ type: "file", path: "SKILL.md", base64: Buffer.from("---\nname: beta\ndescription: Beta.\n---\nBeta\n").toString("base64"), executable: false }], {
        metadata: { formatVersion: 1, name: "beta", version: "1.0.0", description: "Beta.", author: "Test", license: "MIT",
          compatibility: { orgops: { min: "0.0.1" }, platforms: ["linux"], tools: [] }, secrets: [] },
        dependencies: [pin], executables: [], selectedPaths: ["SKILL.md"],
      });
      if (!exported.ok) throw new Error("fixture");
      const beta = exported.value.snapshot.manifest;
      const betaPath = join(f.artifactRoot, "beta", beta.digest.slice(7)); await mkdir(betaPath, { recursive: true, mode: 0o700 });
      for (const file of exported.value.snapshot.files) await writeFile(join(betaPath, file.path), Buffer.from(file.base64, "base64"), { mode: 0o644 });
      await writeFile(join(betaPath, "orgops-package.json"), canonicalManifestBytes(beta), { mode: 0o644 });
      f.db.prepare(`INSERT INTO catalog_package_releases
        (package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,
         manifest_json,execution_preview_json,warnings_json,created_at) VALUES
        ('release-beta','source-a','source-a','skill','beta','1.0.0',?,?,?,?,?,'{"apiEventShapes":[],"runnerScripts":[],"wrappedCommands":[],"externalSources":[]}','[]',1)`)
        .run(beta.digest, commit, commit, "skills/beta", JSON.stringify(beta));
      f.db.prepare(`INSERT INTO catalog_release_controls
        (package_release_id,review_state,review_digest,reviewed_by_human_id,reviewed_at,revision,created_at,updated_at)
        VALUES ('release-beta','APPROVED',?,'human-a',1,1,1,1)`).run(beta.digest);
      f.db.prepare(`INSERT INTO catalog_installations
        (release_id,artifact_digest,artifact_path,state,installed_by_human_id,installed_at,last_verified_at,revision)
        VALUES ('release-beta',?,?,'INSTALLED','human-a',1,1,1)`).run(beta.digest, betaPath);
      f.db.exec(`UPDATE agent_skill_assignments SET desired_state='DISABLED',preload=0;
        INSERT INTO agent_skill_assignments
        (assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,preload,effective_preload,
         active_generation,desired_generation,revision,actor_kind,actor_human_id,created_at,updated_at)
        VALUES ('assignment-b','agent-a','release-beta','beta','DISABLED','ENABLED','FAILED',0,1,'old','failed-generation',1,'ADMIN','human-a',1,1)`);
      await f.delivery.poll({ runnerId: "runner-a" });
      const claim = await f.delivery.claim({ runnerId: "runner-a", deploymentId: "deploy-a" });
      const artifact = await f.delivery.getArtifact({ runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: claim.attemptToken });
      expect(artifact.packages.map(pkg => [pkg.release.name, pkg.direct])).toEqual([["beta", true], ["alpha", false]]);
      await f.delivery.report({ runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: claim.attemptToken }, { state: "STAGED", generation: "generation-a" });
      await f.delivery.report({ runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: claim.attemptToken }, { state: "WAITING_FOR_IDLE", generation: "generation-a" });
      await f.delivery.report({ runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: claim.attemptToken }, { state: "ACTIVE", generation: "generation-a" });
      expect(f.db.prepare("SELECT local_skill_name,desired_state,effective_state,effective_preload,deployment_state,desired_generation,active_generation FROM agent_skill_assignments ORDER BY local_skill_name").all())
        .toEqual([{ local_skill_name: "alpha", desired_state: "DISABLED", effective_state: "DISABLED", effective_preload: 0,
          deployment_state: "STABLE", desired_generation: "generation-a", active_generation: "generation-a" },
        { local_skill_name: "beta", desired_state: "DISABLED", effective_state: "ENABLED", effective_preload: 1,
          deployment_state: "FAILED", desired_generation: "failed-generation", active_generation: "generation-a" }]);
    } finally { f.close(); }
  });

  it("keeps a disabled trigger as identity evidence without delivering its package or files", async () => {
    const f = await fixture();
    try {
      f.db.exec("UPDATE agent_skill_assignments SET desired_state='DISABLED',preload=0");
      const exported = exportSkillPackage([{ type: "file", path: "SKILL.md", base64: Buffer.from("---\nname: beta\ndescription: Beta.\n---\nBeta\n").toString("base64"), executable: false }], {
        metadata: { formatVersion: 1, name: "beta", version: "1.0.0", description: "Beta.", author: "Test", license: "MIT",
          compatibility: { orgops: { min: "0.0.1" }, platforms: ["linux"], tools: [] }, secrets: [] },
        dependencies: [], executables: [], selectedPaths: ["SKILL.md"],
      });
      if (!exported.ok) throw new Error("fixture");
      await addSyntheticRelease(f, "release-beta", "beta", exported.value.snapshot.manifest);
      const betaRoot = join(f.artifactRoot, "beta", exported.value.snapshot.manifest.digest.slice(7));
      for (const file of exported.value.snapshot.files) await writeFile(join(betaRoot, file.path), Buffer.from(file.base64, "base64"), { mode: 0o644 });
      const claim = await f.delivery.claim({ runnerId: "runner-a", deploymentId: "deploy-a" });
      const artifact = await f.delivery.getArtifact({ runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: claim.attemptToken });
      expect(artifact.release.packageReleaseId).toBe("release-alpha");
      expect(artifact.packages.map(pkg => pkg.release.packageReleaseId)).toEqual(["release-beta"]);
      expect(artifact.files.every(file => file.packageReleaseId === "release-beta")).toBe(true);
    } finally { f.close(); }
  });

  it("denies every operation after assignment to another runner and supersedes history", async () => {
    const f = await fixture();
    try {
      f.db.exec(`INSERT INTO runner_nodes (id,display_name,metadata_json,created_at,updated_at,last_seen_at)
        VALUES ('runner-b','B','{}',1,1,1); UPDATE agents SET assigned_runner_id=NULL WHERE id='agent-a'`);
      await expect(f.delivery.claim({ runnerId: "runner-a", deploymentId: "deploy-a" })).rejects.toEqual(new RunnerDeliveryError("DEPLOYMENT_SUPERSEDED"));
      expect(f.db.prepare("SELECT state FROM runner_package_deployments WHERE deployment_id='deploy-a'").get()).toEqual({ state: "SUPERSEDED" });
      expect(await f.delivery.poll({ runnerId: "runner-b" })).toEqual([]);
      f.db.exec("UPDATE agents SET assigned_runner_id='runner-b' WHERE id='agent-a'");
      const replacements = await f.delivery.poll({ runnerId: "runner-b" });
      expect(replacements).toHaveLength(1);
      expect(replacements[0]).toMatchObject({ assignedRunnerId: "runner-b", agentId: "agent-a" });
      f.db.exec("UPDATE agents SET assigned_runner_id='runner-a' WHERE id='agent-a'");
      const reassignedBack = await f.delivery.poll({ runnerId: "runner-a" });
      expect(reassignedBack).toHaveLength(1);
      expect(reassignedBack[0]!.deploymentId).not.toBe(replacements[0]!.deploymentId);
      expect(f.db.prepare("SELECT state FROM runner_package_deployments WHERE deployment_id=?").get(replacements[0]!.deploymentId))
        .toEqual({ state: "SUPERSEDED" });
    } finally { f.close(); }
  });

  it.each(["QUEUED", "CLAIMED", "STAGED", "WAITING_FOR_IDLE"] as const)(
    "replaces a carry-only %s deployment once after a second reassignment, but not while unassigned",
    async targetState => {
      const f = await fixture();
      try {
        f.db.exec(`INSERT INTO runner_nodes (id,display_name,metadata_json,created_at,updated_at,last_seen_at) VALUES
          ('runner-b','B','{}',1,1,1),('runner-c','C','{}',1,1,1)`);
        const finish = async (runnerId: string, deploymentId: string, generation: string) => {
          const claim = await f.delivery.claim({ runnerId, deploymentId });
          await f.delivery.getArtifact({ runnerId, deploymentId, attemptToken: claim.attemptToken });
          for (const state of ["STAGED", "WAITING_FOR_IDLE", "ACTIVE"] as const) await f.delivery.report(
            { runnerId, deploymentId, attemptToken: claim.attemptToken }, { state, generation });
        };
        await finish("runner-a", "deploy-a", "generation-a");
        f.db.exec("UPDATE agents SET assigned_runner_id='runner-b' WHERE id='agent-a'");
        const carry = (await f.delivery.poll({ runnerId: "runner-b" }))[0]!;
        expect(f.db.prepare("SELECT DISTINCT role FROM runner_deployment_participants WHERE deployment_id=?").all(carry.deploymentId))
          .toEqual([{ role: "CARRY_EFFECTIVE" }]);
        if (targetState !== "QUEUED") {
          const claim = await f.delivery.claim({ runnerId: "runner-b", deploymentId: carry.deploymentId });
          if (targetState === "STAGED" || targetState === "WAITING_FOR_IDLE") {
            await f.delivery.getArtifact({ runnerId: "runner-b", deploymentId: carry.deploymentId, attemptToken: claim.attemptToken });
            await f.delivery.report({ runnerId: "runner-b", deploymentId: carry.deploymentId, attemptToken: claim.attemptToken },
              { state: "STAGED", generation: carry.desiredGeneration });
          }
          if (targetState === "WAITING_FOR_IDLE") await f.delivery.report(
            { runnerId: "runner-b", deploymentId: carry.deploymentId, attemptToken: claim.attemptToken },
            { state: "WAITING_FOR_IDLE", generation: carry.desiredGeneration });
        }
        f.db.exec("UPDATE agents SET assigned_runner_id=NULL WHERE id='agent-a'");
        expect(await f.delivery.poll({ runnerId: "runner-b" })).toEqual([]);
        f.db.exec("UPDATE agents SET assigned_runner_id='runner-c' WHERE id='agent-a'");
        const replacement = await f.delivery.poll({ runnerId: "runner-c" });
        expect(replacement).toHaveLength(1);
        expect(replacement[0]!.desiredGeneration).not.toBe(carry.desiredGeneration);
        expect(f.db.prepare("SELECT DISTINCT role,target_state FROM runner_deployment_participants WHERE deployment_id=?").all(replacement[0]!.deploymentId))
          .toEqual([{ role: "CARRY_EFFECTIVE", target_state: "ENABLED" }]);
        expect(await f.delivery.poll({ runnerId: "runner-c" })).toEqual(replacement);
        f.db.exec("UPDATE agents SET assigned_runner_id='runner-b' WHERE id='agent-a'");
        const back = await f.delivery.poll({ runnerId: "runner-b" });
        expect(back).toHaveLength(1);
        expect(back[0]!.desiredGeneration).not.toBe(replacement[0]!.desiredGeneration);
        expect(await f.delivery.poll({ runnerId: "runner-b" })).toEqual(back);
      } finally { f.close(); }
    },
  );

  it.each(["SUCCEEDED", "FAILED", "PARTIAL", "CANCELLED"] as const)("reassigns an active deployment from a terminal %s rollout as standalone without mutating rollout history", async rolloutState => {
    const f = await fixture();
    try {
      const targetState = rolloutState === "SUCCEEDED" ? "SUCCEEDED" : rolloutState === "CANCELLED" ? "SKIPPED" : "FAILED";
      f.db.exec(`INSERT INTO runner_nodes (id,display_name,metadata_json,created_at,updated_at,last_seen_at) VALUES ('runner-b','B','{}',1,1,1);
        INSERT INTO catalog_rollouts
          (rollout_id,release_id,operation,preload,plan_digest,state,actor_kind,actor_human_id,revision,created_at,updated_at,completed_at)
          VALUES ('rollout-terminal','release-alpha','ENABLE',NULL,'sha256:${"c".repeat(64)}','${rolloutState}','ADMIN','human-a',4,1,2,2);
        INSERT INTO catalog_rollout_targets
          (rollout_id,agent_id,captured_runner_id,target_ordinal,expected_assignment_revision,planned_preload,state,attempts,reason_code,blocker_json,prior_assignment_json,revision,created_at,updated_at,completed_at)
          VALUES ('rollout-terminal','agent-a','runner-a',0,1,1,'${targetState}',1,NULL,NULL,NULL,3,1,2,2);
        `);
      // Make the deployment active through the production state machine.
      const claim = await f.delivery.claim({ runnerId: "runner-a", deploymentId: "deploy-a" });
      await f.delivery.getArtifact({ runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: claim.attemptToken });
      for (const state of ["STAGED", "WAITING_FOR_IDLE", "ACTIVE"] as const) await f.delivery.report(
        { runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: claim.attemptToken }, { state, generation: "generation-a" });
      f.db.exec("UPDATE runner_package_deployments SET rollout_id='rollout-terminal' WHERE deployment_id='deploy-a'");
      const beforeRollout = f.db.prepare("SELECT * FROM catalog_rollouts WHERE rollout_id='rollout-terminal'").get();
      const beforeTarget = f.db.prepare("SELECT * FROM catalog_rollout_targets WHERE rollout_id='rollout-terminal'").get();
      f.db.exec("UPDATE agents SET assigned_runner_id='runner-b' WHERE id='agent-a'");
      const replacement = (await f.delivery.poll({ runnerId: "runner-b" }))[0]!;
      expect(replacement).toBeTruthy();
      expect(f.db.prepare("SELECT rollout_id FROM runner_package_deployments WHERE deployment_id=?").get(replacement.deploymentId)).toEqual({ rollout_id: null });
      expect(f.db.prepare("SELECT * FROM catalog_rollouts WHERE rollout_id='rollout-terminal'").get()).toEqual(beforeRollout);
      expect(f.db.prepare("SELECT * FROM catalog_rollout_targets WHERE rollout_id='rollout-terminal'").get()).toEqual(beforeTarget);
    } finally { f.close(); }
  });

  it("reprovisions after ACTIVE reassignment and reassigned-back uses a fresh generation", async () => {
    const f = await fixture();
    try {
      f.db.exec("INSERT INTO runner_nodes (id,display_name,metadata_json,created_at,updated_at,last_seen_at) VALUES ('runner-b','B','{}',1,1,1)");
      const finish = async (runnerId: string, deploymentId: string) => {
        const claim = await f.delivery.claim({ runnerId, deploymentId });
        await f.delivery.getArtifact({ runnerId, deploymentId, attemptToken: claim.attemptToken });
        for (const state of ["STAGED", "WAITING_FOR_IDLE", "ACTIVE"] as const) await f.delivery.report(
          { runnerId, deploymentId, attemptToken: claim.attemptToken }, { state, generation: (f.db.prepare("SELECT desired_generation FROM runner_package_deployments WHERE deployment_id=?").get(deploymentId) as any).desired_generation });
      };
      await finish("runner-a", "deploy-a");
      await addSyntheticRelease(f, "release-removed", "removed", syntheticManifest(f.manifest, "removed", 0, 0));
      f.db.exec(`UPDATE agent_skill_assignments SET desired_state='DISABLED',effective_state='DISABLED',deployment_state='STABLE',removal_requested=1,
        preload=0,effective_preload=0,active_generation='removed-generation',desired_generation='removed-generation'
        WHERE assignment_id='assignment-removed'`);
      f.db.exec("UPDATE agents SET assigned_runner_id='runner-b' WHERE id='agent-a'");
      const onB = (await f.delivery.poll({ runnerId: "runner-b" }))[0]!;
      expect(f.db.prepare("SELECT local_skill_name FROM runner_deployment_participants WHERE deployment_id=? ORDER BY local_skill_name").all(onB.deploymentId)).toEqual([{ local_skill_name: "alpha" }]);
      await finish("runner-b", onB.deploymentId);
      f.db.exec("UPDATE agents SET assigned_runner_id='runner-a' WHERE id='agent-a'");
      const back = await f.delivery.poll({ runnerId: "runner-a" });
      expect(back).toHaveLength(1);
      expect(back[0]!.desiredGeneration).not.toBe("generation-a");
      expect(back[0]!.desiredGeneration).not.toBe(onB.desiredGeneration);
    } finally { f.close(); }
  });

  it("reassigns a failed desired update by carrying its last-known-good effective content without retrying it", async () => {
    const f = await fixture();
    try {
      f.db.exec(`INSERT INTO runner_nodes (id,display_name,metadata_json,created_at,updated_at,last_seen_at) VALUES ('runner-b','B','{}',1,1,1);
        UPDATE agent_skill_assignments SET effective_state='ENABLED',effective_preload=1,active_generation='old' WHERE assignment_id='assignment-a'`);
      const first = await f.delivery.claim({ runnerId: "runner-a", deploymentId: "deploy-a" });
      await f.delivery.report({ runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: first.attemptToken },
        { state: "FAILED", generation: "generation-a", failureCode: "STORAGE_FAILURE" });
      f.db.exec("UPDATE agents SET assigned_runner_id='runner-b' WHERE id='agent-a'");
      const replacement = await f.delivery.poll({ runnerId: "runner-b" });
      expect(replacement).toHaveLength(1);
      const participant = f.db.prepare("SELECT role,target_state,prior_active_generation FROM runner_deployment_participants WHERE deployment_id=?").get(replacement[0]!.deploymentId);
      expect(participant).toEqual({ role: "CARRY_EFFECTIVE", target_state: "ENABLED", prior_active_generation: "old" });
    } finally { f.close(); }
  });

  it("does not automatically retry a failed reassignment provisioning deployment", async () => {
    const f = await fixture();
    try {
      f.db.exec("INSERT INTO runner_nodes (id,display_name,metadata_json,created_at,updated_at,last_seen_at) VALUES ('runner-b','B','{}',1,1,1)");
      const first = await f.delivery.claim({ runnerId: "runner-a", deploymentId: "deploy-a" });
      await f.delivery.getArtifact({ runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: first.attemptToken });
      for (const state of ["STAGED", "WAITING_FOR_IDLE", "ACTIVE"] as const) await f.delivery.report(
        { runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: first.attemptToken }, { state, generation: "generation-a" });
      f.db.exec("UPDATE agents SET assigned_runner_id='runner-b' WHERE id='agent-a'");
      const replacement = (await f.delivery.poll({ runnerId: "runner-b" }))[0]!;
      const claim = await f.delivery.claim({ runnerId: "runner-b", deploymentId: replacement.deploymentId });
      await f.delivery.report({ runnerId: "runner-b", deploymentId: replacement.deploymentId, attemptToken: claim.attemptToken },
        { state: "FAILED", generation: replacement.desiredGeneration, failureCode: "STORAGE_FAILURE" });
      expect(await f.delivery.poll({ runnerId: "runner-b" })).toEqual([]);
    } finally { f.close(); }
  });

  it("coalesces multiple requested pins of the same release into one deterministic desired root", async () => {
    const f = await fixture();
    try {
      f.db.exec(`INSERT INTO agent_skill_assignments
        (assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,preload,effective_preload,
         active_generation,desired_generation,revision,actor_kind,actor_human_id,created_at,updated_at)
        VALUES ('assignment-alias','agent-a','release-alpha','alpha-alias','ENABLED','DISABLED','REQUESTED',0,0,NULL,'generation-a',1,'ADMIN','human-a',1,1)`);
      const command = (await f.delivery.poll({ runnerId: "runner-a" }))[0]!;
      expect(command.desiredRoots.map(root => root.packageReleaseId)).toEqual(["release-alpha"]);
      expect(f.db.prepare("SELECT count(*) AS count FROM runner_deployment_participants WHERE deployment_id='deploy-a'").get()).toEqual({ count: 2 });
    } finally { f.close(); }
  });

  it("coalesces template-requested pins that have no deployment", async () => {
    const f = await fixture();
    try {
      f.db.exec("DELETE FROM runner_package_deployments");
      const commands = await f.delivery.poll({ runnerId: "runner-a" });
      expect(commands).toHaveLength(1);
      expect(commands[0]!.desiredGeneration).not.toBe("generation-a");
      expect(f.db.prepare("SELECT desired_generation,deployment_state FROM agent_skill_assignments").get())
        .toEqual({ desired_generation: commands[0]!.desiredGeneration, deployment_state: "REQUESTED" });
    } finally { f.close(); }
  });

  it("reissues an expired claim but keeps a live claim stable", async () => {
    const f = await fixture();
    try {
      const first = await f.delivery.claim({ runnerId: "runner-a", deploymentId: "deploy-a" });
      f.db.prepare("UPDATE runner_package_deployments SET lease_expires_at=999 WHERE deployment_id='deploy-a'").run();
      const second = await f.delivery.claim({ runnerId: "runner-a", deploymentId: "deploy-a" });
      expect(second.attemptToken).not.toBe(first.attemptToken);
      await expect(f.delivery.getArtifact({ runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: first.attemptToken }))
        .rejects.toEqual(new RunnerDeliveryError("STATE_CONFLICT"));
    } finally { f.close(); }
  });

  it("revalidates the complete live authority after async reads and never pins a stale artifact", async () => {
    let entered!: () => void; let release!: () => void;
    const enteredRead = new Promise<void>(resolve => { entered = resolve; });
    const continueRead = new Promise<void>(resolve => { release = resolve; });
    let first = true;
    const f = await fixture({ onFileRead: async () => { if (first) { first = false; entered(); await continueRead; } } });
    try {
      f.db.exec("INSERT INTO runner_nodes (id,display_name,metadata_json,created_at,updated_at,last_seen_at) VALUES ('runner-b','B','{}',1,1,1)");
      const claim = await f.delivery.claim({ runnerId: "runner-a", deploymentId: "deploy-a" });
      const request = f.delivery.getArtifact({ runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: claim.attemptToken });
      await enteredRead;
      f.db.exec("UPDATE agents SET assigned_runner_id='runner-b' WHERE id='agent-a'");
      release();
      await expect(request).rejects.toEqual(new RunnerDeliveryError("FORBIDDEN"));
      expect(f.db.prepare("SELECT artifact_semantic_digest FROM runner_package_deployments WHERE deployment_id='deploy-a'").get())
        .toEqual({ artifact_semantic_digest: null });
    } finally { release?.(); f.close(); }
  });

  it.each([
    ["state", "UPDATE runner_package_deployments SET state='STAGED' WHERE deployment_id='deploy-a'"],
    ["token", "UPDATE runner_package_deployments SET attempt_token='yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy' WHERE deployment_id='deploy-a'"],
    ["lease", "UPDATE runner_package_deployments SET lease_expires_at=3000 WHERE deployment_id='deploy-a'"],
    ["participant", "UPDATE runner_deployment_participants SET target_preload=0; UPDATE agent_skill_assignments SET preload=0"],
    ["review", "UPDATE catalog_release_controls SET revision=revision+1 WHERE package_release_id='release-alpha'"],
    ["installation", "UPDATE catalog_installations SET revision=revision+1 WHERE release_id='release-alpha'"],
    ["API policy", `INSERT INTO catalog_api_activations
      (release_id,approval_state,runtime_state,failure_code,approved_by_human_id,approved_at,revision,created_at,updated_at)
      VALUES ('release-alpha','NOT_REQUIRED','INACTIVE',NULL,NULL,NULL,1,1,1)`],
  ] as const)("rejects %s drift during artifact reads", async (_kind, mutation) => {
    let f: Awaited<ReturnType<typeof fixture>>;
    let changed = false;
    f = await fixture({ onFileRead: () => { if (!changed) { changed = true; f.db.exec(mutation); } } });
    try {
      const claim = await f.delivery.claim({ runnerId: "runner-a", deploymentId: "deploy-a" });
      await expect(f.delivery.getArtifact({ runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: claim.attemptToken }))
        .rejects.toEqual(new RunnerDeliveryError("STATE_CONFLICT"));
      expect(f.db.prepare("SELECT artifact_semantic_digest FROM runner_package_deployments WHERE deployment_id='deploy-a'").get())
        .toEqual({ artifact_semantic_digest: null });
    } finally { f.close(); }
  });

  it("increments revision only when first pinning an artifact digest and revalidates idempotent fetches", async () => {
    const f = await fixture();
    try {
      const claim = await f.delivery.claim({ runnerId: "runner-a", deploymentId: "deploy-a" });
      const before = f.db.prepare("SELECT revision FROM runner_package_deployments WHERE deployment_id='deploy-a'").get() as { revision: number };
      const first = await f.delivery.getArtifact({ runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: claim.attemptToken });
      expect(f.db.prepare("SELECT revision,artifact_semantic_digest FROM runner_package_deployments WHERE deployment_id='deploy-a'").get())
        .toEqual({ revision: before.revision + 1, artifact_semantic_digest: first.semanticDigest });
      expect((await f.delivery.getArtifact({ runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: claim.attemptToken })).semanticDigest)
        .toBe(first.semanticDigest);
      expect(f.db.prepare("SELECT revision FROM runner_package_deployments WHERE deployment_id='deploy-a'").get())
        .toEqual({ revision: before.revision + 1 });
    } finally { f.close(); }
  });

  it("rejects participant drift after artifact fetch and never activates unstaged assignment changes", async () => {
    const f = await fixture();
    try {
      const claim = await f.delivery.claim({ runnerId: "runner-a", deploymentId: "deploy-a" });
      await f.delivery.getArtifact({ runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: claim.attemptToken });
      f.db.exec("UPDATE agent_skill_assignments SET preload=0,revision=revision+1 WHERE assignment_id='assignment-a'");
      await expect(f.delivery.report({ runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: claim.attemptToken },
        { state: "STAGED", generation: "generation-a" })).rejects.toEqual(new RunnerDeliveryError("STATE_CONFLICT"));
      expect(f.db.prepare("SELECT state FROM runner_package_deployments WHERE deployment_id='deploy-a'").get()).toEqual({ state: "CLAIMED" });
    } finally { f.close(); }
  });

  it("replaces a reassigned staged deployment and resets only applying participants", async () => {
    const f = await fixture();
    try {
      f.db.exec("INSERT INTO runner_nodes (id,display_name,metadata_json,created_at,updated_at,last_seen_at) VALUES ('runner-b','B','{}',1,1,1)");
      const claim = await f.delivery.claim({ runnerId: "runner-a", deploymentId: "deploy-a" });
      await f.delivery.report({ runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: claim.attemptToken },
        { state: "STAGED", generation: "generation-a" });
      f.db.exec("UPDATE agents SET assigned_runner_id='runner-b' WHERE id='agent-a'");
      const replacement = await f.delivery.poll({ runnerId: "runner-b" });
      expect(replacement).toHaveLength(1);
      expect(replacement[0]).toMatchObject({ assignedRunnerId: "runner-b" });
      expect(f.db.prepare("SELECT deployment_state FROM agent_skill_assignments WHERE assignment_id='assignment-a'").get())
        .toEqual({ deployment_state: "REQUESTED" });
    } finally { f.close(); }
  });

  it("rejects DEPLOYMENT_SUPERSEDED as a runner-reported FAILED code", async () => {
    const f = await fixture();
    try {
      const claim = await f.delivery.claim({ runnerId: "runner-a", deploymentId: "deploy-a" });
      await expect(f.delivery.report({ runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: claim.attemptToken },
        { state: "FAILED", generation: "generation-a", failureCode: "DEPLOYMENT_SUPERSEDED" }))
        .rejects.toEqual(new RunnerDeliveryError("STATE_CONFLICT"));
      expect(f.db.prepare("SELECT state,failure_code,completed_at FROM runner_package_deployments WHERE deployment_id='deploy-a'").get())
        .toEqual({ state: "CLAIMED", failure_code: null, completed_at: null });
    } finally { f.close(); }
  });

  it("rejects changed FAILED replay codes without another audit", async () => {
    const f = await fixture();
    try {
      const claim = await f.delivery.claim({ runnerId: "runner-a", deploymentId: "deploy-a" });
      await f.delivery.report({ runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: claim.attemptToken },
        { state: "FAILED", generation: "generation-a", failureCode: "STORAGE_FAILURE" });
      await expect(f.delivery.report({ runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: claim.attemptToken },
        { state: "FAILED", generation: "generation-a", failureCode: "INSPECTION_FAILED" }))
        .rejects.toEqual(new RunnerDeliveryError("STATE_CONFLICT"));
      expect(f.audits).toHaveLength(1);
    } finally { f.close(); }
  });

  it.each([
    ["poll", "attempt_token='xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'"],
    ["claim", "lease_expires_at=2000"],
  ] as const)("fails closed on a malformed QUEUED lone token/lease through %s", async (operation, assignment) => {
    const f = await fixture();
    try {
      f.db.exec(`PRAGMA ignore_check_constraints=ON; UPDATE runner_package_deployments SET ${assignment} WHERE deployment_id='deploy-a'`);
      const request = operation === "poll" ? f.delivery.poll({ runnerId: "runner-a" }) : f.delivery.claim({ runnerId: "runner-a", deploymentId: "deploy-a" });
      await expect(request).rejects.toEqual(new RunnerDeliveryError("STATE_CONFLICT"));
    } finally { f.close(); }
  });

  it("fails closed on unsafe leases and terminal failure/completion invariants in get/report paths", async () => {
    const f = await fixture();
    try {
      const claim = await f.delivery.claim({ runnerId: "runner-a", deploymentId: "deploy-a" });
      f.db.exec("PRAGMA ignore_check_constraints=ON; UPDATE runner_package_deployments SET lease_expires_at=9007199254740992 WHERE deployment_id='deploy-a'");
      await expect(f.delivery.getArtifact({ runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: claim.attemptToken }))
        .rejects.toEqual(new RunnerDeliveryError("STATE_CONFLICT"));
      f.db.prepare("UPDATE runner_package_deployments SET lease_expires_at=2000,completed_at=123 WHERE deployment_id='deploy-a'").run();
      await expect(f.delivery.report({ runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: claim.attemptToken },
        { state: "STAGED", generation: "generation-a" })).rejects.toEqual(new RunnerDeliveryError("STATE_CONFLICT"));
      f.db.prepare("UPDATE runner_package_deployments SET state='FAILED',failure_code='DEPLOYMENT_SUPERSEDED',completed_at=123 WHERE deployment_id='deploy-a'").run();
      await expect(f.delivery.report({ runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: claim.attemptToken },
        { state: "FAILED", generation: "generation-a", failureCode: "DEPLOYMENT_SUPERSEDED" })).rejects.toEqual(new RunnerDeliveryError("STATE_CONFLICT"));
    } finally { f.close(); }
  });

  it("rejects a symlinked installation generation even when it targets matching external bytes", async () => {
    const f = await fixture();
    try {
      const { rename, symlink } = await import("node:fs/promises");
      const installed = join(f.artifactRoot, "alpha", f.manifest.digest.slice(7));
      const externalRoot = await mkdtemp(join(tmpdir(), "orgops-install-link-")); roots.push(externalRoot);
      const external = join(externalRoot, "generation");
      await rename(installed, external); await symlink(external, installed, "dir");
      const claim = await f.delivery.claim({ runnerId: "runner-a", deploymentId: "deploy-a" });
      await expect(f.delivery.getArtifact({ runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: claim.attemptToken }))
        .rejects.toEqual(new RunnerDeliveryError("INSPECTION_FAILED"));
    } finally { f.close(); }
  });

  it("rejects hard-linked installation bytes before artifact delivery", async () => {
    const f = await fixture();
    try {
      const { link } = await import("node:fs/promises");
      const aliasRoot = await mkdtemp(join(tmpdir(), "orgops-alias-")); roots.push(aliasRoot);
      await link(join(f.artifactRoot, "alpha", f.manifest.digest.slice(7), "SKILL.md"), join(aliasRoot, "alias"));
      const claim = await f.delivery.claim({ runnerId: "runner-a", deploymentId: "deploy-a" });
      await expect(f.delivery.getArtifact({ runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: claim.attemptToken }))
        .rejects.toEqual(new RunnerDeliveryError("INSPECTION_FAILED"));
    } finally { f.close(); }
  });

  it("preflights 257 aggregate files across packages before reading any installation byte", async () => {
    const reads: string[] = []; const f = await fixture({ onFileRead: path => { reads.push(path); } });
    try {
      await addSyntheticRelease(f, "release-beta", "beta", syntheticManifest(f.manifest, "beta", 256, 0));
      const claim = await f.delivery.claim({ runnerId: "runner-a", deploymentId: "deploy-a" });
      await expect(f.delivery.getArtifact({ runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: claim.attemptToken }))
        .rejects.toEqual(new RunnerDeliveryError("INSPECTION_FAILED"));
      expect(reads).toEqual([]);
    } finally { f.close(); }
  });

  it("preflights more than 8 MiB declared across packages before reading any installation byte", async () => {
    const reads: string[] = []; const f = await fixture({ onFileRead: path => { reads.push(path); } });
    try {
      await addSyntheticRelease(f, "release-beta", "beta", syntheticManifest(f.manifest, "beta", 5, 1_000_000));
      await addSyntheticRelease(f, "release-gamma", "gamma", syntheticManifest(f.manifest, "gamma", 4, 1_000_000));
      const claim = await f.delivery.claim({ runnerId: "runner-a", deploymentId: "deploy-a" });
      await expect(f.delivery.getArtifact({ runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: claim.attemptToken }))
        .rejects.toEqual(new RunnerDeliveryError("INSPECTION_FAILED"));
      expect(reads).toEqual([]);
    } finally { f.close(); }
  });

  it("rolls back report state, assignment projection, and audit when the transactional audit writer fails", async () => {
    const f = await fixture();
    try {
      const failing = createRunnerArtifactDelivery({ db: f.db, artifactRoot: f.artifactRoot, now: () => 1000,
        newAttemptToken: () => "x".repeat(43), writeAudit() { throw new Error("private SQL"); } });
      const claim = await failing.claim({ runnerId: "runner-a", deploymentId: "deploy-a" });
      await expect(failing.report({ runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: claim.attemptToken },
        { state: "STAGED", generation: "generation-a" })).rejects.toEqual(new RunnerDeliveryError("STORAGE_FAILURE"));
      expect(f.db.prepare("SELECT state,revision FROM runner_package_deployments WHERE deployment_id='deploy-a'").get())
        .toEqual({ state: "CLAIMED", revision: 2 });
      expect(f.db.prepare("SELECT deployment_state,revision FROM agent_skill_assignments").get())
        .toEqual({ deployment_state: "REQUESTED", revision: 1 });
      expect(f.db.prepare("SELECT count(*) AS count FROM events").get()).toEqual({ count: 0 });
    } finally { f.close(); }
  });

  it.each(["missing", "overflow", "wrong-state"] as const)("rolls back deployment, participant, and audit when rollout target is %s", async variant => {
    const f = await fixture();
    try {
      f.db.exec(`INSERT INTO catalog_rollouts
        (rollout_id,release_id,operation,preload,plan_digest,state,actor_kind,actor_human_id,revision,created_at,updated_at)
        VALUES ('rollout-a','release-alpha','ENABLE',NULL,'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','RUNNING','ADMIN','human-a',1,1,1);
        UPDATE runner_package_deployments SET rollout_id='rollout-a' WHERE deployment_id='deploy-a'`);
      if (variant !== "missing") f.db.prepare(`INSERT INTO catalog_rollout_targets
        (rollout_id,agent_id,captured_runner_id,expected_assignment_revision,state,attempts,reason_code,revision,created_at,updated_at)
        VALUES ('rollout-a','agent-a','runner-a',1,?,0,NULL,?,1,1)`)
        .run(variant === "wrong-state" ? "VERIFYING" : "QUEUED", variant === "overflow" ? 2_147_483_647 : 1);
      const claim = await f.delivery.claim({ runnerId: "runner-a", deploymentId: "deploy-a" });
      await expect(f.delivery.report({ runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: claim.attemptToken },
        { state: "STAGED", generation: "generation-a" })).rejects.toMatchObject({ code: variant === "wrong-state" ? "STATE_CONFLICT" : "REVISION_CONFLICT" });
      expect(f.db.prepare("SELECT state FROM runner_package_deployments WHERE deployment_id='deploy-a'").get()).toEqual({ state: "CLAIMED" });
      expect(f.db.prepare("SELECT deployment_state FROM agent_skill_assignments WHERE assignment_id='assignment-a'").get()).toEqual({ deployment_state: "REQUESTED" });
      expect(f.audits).toEqual([]);
    } finally { f.close(); }
  });

  it.each([
    ["string revision", "revision='oops'"],
    ["fraction revision", "revision=1.5"],
    ["negative revision", "revision=-1"],
    ["overflow revision", "revision=2147483648"],
    ["unknown state", "state='UNKNOWN'"],
  ] as const)("fails closed on rollout target %s before state logic", async (_variant, mutation) => {
    const f = await fixture();
    try {
      f.db.exec(`INSERT INTO catalog_rollouts
        (rollout_id,release_id,operation,preload,plan_digest,state,actor_kind,actor_human_id,revision,created_at,updated_at)
        VALUES ('rollout-a','release-alpha','ENABLE',NULL,'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','RUNNING','ADMIN','human-a',1,1,1);
        INSERT INTO catalog_rollout_targets
        (rollout_id,agent_id,captured_runner_id,expected_assignment_revision,state,attempts,reason_code,revision,created_at,updated_at)
        VALUES ('rollout-a','agent-a','runner-a',1,'QUEUED',0,NULL,1,1,1);
        UPDATE runner_package_deployments SET rollout_id='rollout-a' WHERE deployment_id='deploy-a'`);
      const claim = await f.delivery.claim({ runnerId: "runner-a", deploymentId: "deploy-a" });
      f.db.exec(`PRAGMA ignore_check_constraints=ON; UPDATE catalog_rollout_targets SET ${mutation} WHERE rollout_id='rollout-a'`);
      await expect(f.delivery.report({ runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: claim.attemptToken },
        { state: "STAGED", generation: "generation-a" })).rejects.toEqual(new RunnerDeliveryError("STATE_CONFLICT"));
      expect(f.db.prepare("SELECT state FROM runner_package_deployments WHERE deployment_id='deploy-a'").get()).toEqual({ state: "CLAIMED" });
      expect(f.audits).toEqual([]);
    } finally { f.close(); }
  });

  it("a failed report preserves the last-known-good effective projection", async () => {
    const f = await fixture();
    try {
      f.db.prepare(`UPDATE agent_skill_assignments SET effective_state='ENABLED',effective_preload=1,active_generation='old'`).run();
      const claim = await f.delivery.claim({ runnerId: "runner-a", deploymentId: "deploy-a" });
      await f.delivery.report({ runnerId: "runner-a", deploymentId: "deploy-a", attemptToken: claim.attemptToken },
        { state: "FAILED", generation: "generation-a", failureCode: "STORAGE_FAILURE" });
      expect(f.db.prepare("SELECT effective_state,effective_preload,active_generation,deployment_state FROM agent_skill_assignments").get())
        .toEqual({ effective_state: "ENABLED", effective_preload: 1, active_generation: "old", deployment_state: "FAILED" });
    } finally { f.close(); }
  });
});
