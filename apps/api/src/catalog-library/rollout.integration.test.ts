import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type OrgOpsDb } from "@orgops/db";
import { createApp } from "../app";
import { catalogGrantId } from "./grant-identity";
import { approvedRelease } from "./test-fixtures";

type Fixture = {
  app: ReturnType<typeof createApp>["app"];
  db: OrgOpsDb;
  admin: Record<string, string>;
  granted: Record<string, string>;
  ungranted: Record<string, string>;
  runner: Record<string, string>;
  close(): void;
};

const digest = `sha256:${"a".repeat(64)}`;
const opened: Fixture[] = [];

async function login(app: Fixture["app"], username: string) {
  const response = await app.request("/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "test-password" }),
  });
  expect(response.status).toBe(200);
  return { cookie: response.headers.get("set-cookie")!.match(/orgops_session=[^;]+/)![0] };
}

function seed(fixture: { db: OrgOpsDb; ownerId: string; artifactRoot: string }) {
  const release = approvedRelease();
  const content = Buffer.from("---\\nname: demo-skill\\ndescription: Demo.\\n---\\nDemo\\n");
  const fileDigest = `sha256:${createHash("sha256").update(content).digest("hex")}`;
  const manifest = { ...release.manifest, files: [{ path: "SKILL.md", size: content.byteLength, digest: fileDigest, executable: false }] };
  const artifactPath = join(fixture.artifactRoot, "demo-skill", digest.slice(7));
  if (!existsSync(artifactPath)) mkdirSync(artifactPath, { recursive: true });
  writeFileSync(join(artifactPath, "SKILL.md"), content);
  fixture.db.exec(`
    INSERT INTO humans (id,username,password_hash,must_change_password,is_admin,created_at,updated_at)
      SELECT 'human-granted','granted',password_hash,0,0,1,1 FROM humans WHERE id='${fixture.ownerId}';
    INSERT INTO humans (id,username,password_hash,must_change_password,is_admin,created_at,updated_at)
      SELECT 'human-ungranted','ungranted',password_hash,0,0,1,1 FROM humans WHERE id='${fixture.ownerId}';
    INSERT INTO runner_nodes (id,display_name,metadata_json,created_at,updated_at,last_seen_at)
      VALUES ('runner-a','Runner A','{}',1,1,1);
    INSERT INTO models (id,provider,model_name,enabled,defaults_json,created_at)
      VALUES ('model-a','fixture','fixture',1,'{}',1);
    INSERT INTO agents (id,name,model_id,soul_path,workspace_path,assigned_runner_id,visibility,owner_human_id,created_at,updated_at)
      VALUES ('agent-a','agent-a','model-a','soul','/tmp/orgops-agent-a','runner-a','PUBLIC','${fixture.ownerId}',1,1),
             ('agent-b','agent-b','model-a','soul','/tmp/orgops-agent-b','runner-a','PUBLIC','${fixture.ownerId}',1,1),
             ('agent-private','agent-private','model-a','soul','/tmp/orgops-agent-private','runner-a','PRIVATE','${fixture.ownerId}',1,1);
    INSERT INTO catalog_sources (source_id,display_name,canonical_url,repository_identity,ref,enabled,allow_packages,revision,created_at,updated_at)
      VALUES ('source-team','Team','https://example.test/team','team','main',1,1,1,1,1);
    INSERT INTO catalog_package_releases (package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,manifest_json,execution_preview_json,warnings_json,created_at)
      VALUES ('release-skill','source-team','source-team','skill','demo-skill','1.0.0','${digest}','${"a".repeat(40)}','${"a".repeat(40)}','skills/demo-skill', '${JSON.stringify(manifest)}', '${JSON.stringify(release.executionPreview)}','[]',1);
    INSERT INTO catalog_release_controls (package_release_id,review_state,review_digest,reviewed_by_human_id,reviewed_at,revision,created_at,updated_at)
      VALUES ('release-skill','APPROVED','${digest}','${fixture.ownerId}',1,1,1,1);
    INSERT INTO catalog_installations (release_id,artifact_digest,artifact_path,state,installed_by_human_id,installed_at,last_verified_at,revision)
      VALUES ('release-skill','${digest}','${artifactPath}','INSTALLED','${fixture.ownerId}',1,1,1);
    INSERT INTO catalog_grants (grant_id,release_id,subject_type,human_id,revision,created_by_human_id,created_at,updated_at)
      VALUES ('${catalogGrantId("release-skill", "HUMAN", "human-granted")}','release-skill','HUMAN','human-granted',1,'${fixture.ownerId}',1,1);
  `);
}

async function fixture(): Promise<Fixture> {
  const dataDir = mkdtempSync(join(tmpdir(), "orgops-rollout-http-"));
  const db = openDb(":memory:");
  const artifactRoot = join(dataDir, "artifacts");
  const created = createApp({ db, dataDir, catalogInstallRoot: artifactRoot, adminUser: "owner", adminPass: "test-password", runnerToken: "global-runner-token" });
  const ownerId = db.prepare<[], { id: string }>("SELECT id FROM humans WHERE username='owner'").get()!.id;
  seed({ db, ownerId, artifactRoot });
  const value: Fixture = {
    app: created.app, db,
    admin: await login(created.app, "owner"),
    granted: await login(created.app, "granted"),
    ungranted: await login(created.app, "ungranted"),
    runner: { "x-orgops-runner-token": "global-runner-token", "x-orgops-runner-id": "runner-a" },
    close() { db.close(); rmSync(dataDir, { recursive: true, force: true }); },
  };
  opened.push(value);
  return value;
}

async function jsonRequest(f: Fixture, path: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  const response = await f.app.request(path, init);
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) as any : undefined };
}

const planBody = (agentIds = ["agent-a"]) => ({ releaseId: "release-skill", operation: "ENABLE", agentIds });

async function activateDeployment(f: Fixture, deploymentId: string) {
  const claim = await jsonRequest(f, `/api/runner-package-deployments/${deploymentId}/claim`, { method: "POST", headers: f.runner });
  expect(claim.response.status).toBe(200);
  const generation = f.db.prepare<[string], { desired_generation: string }>("SELECT desired_generation FROM runner_package_deployments WHERE deployment_id=?").get(deploymentId)!.desired_generation;
  f.db.prepare("UPDATE runner_package_deployments SET artifact_semantic_digest=?,revision=revision+1 WHERE deployment_id=?").run(`sha256:${"d".repeat(64)}`, deploymentId);
  const headers = { ...f.runner, "x-orgops-deployment-attempt-token": claim.body.attemptToken, "content-type": "application/json" };
  for (const state of ["STAGED", "WAITING_FOR_IDLE", "ACTIVE"]) {
    const report = await jsonRequest(f, `/api/runner-package-deployments/${deploymentId}/report`, { method: "POST", headers, body: JSON.stringify({ state, generation }) });
    expect(report.response.status, state).toBe(200);
  }
}

afterEach(() => { while (opened.length) opened.pop()!.close(); });

describe("catalog rollout HTTP integration", () => {
  it.each([
    ["admin", "admin", "/api/catalog-rollouts/plan", 200],
    ["granted owner", "granted", "/api/catalog-rollouts/plan", 200],
    ["ungranted", "ungranted", "/api/catalog-rollouts/plan", 403],
  ] as const)("uses real createApp authorization for %s", async (_name, principal, path, status) => {
    const f = await fixture();
    const headers = principal === "admin" ? f.admin : principal === "granted" ? f.granted : f.ungranted;
    const result = await jsonRequest(f, path, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(planBody()) });
    expect(result.response.status).toBe(status);
    expect(result.response.headers.get("cache-control")).toBe("no-store");
    if (status !== 200) expect(result.body).toEqual(expect.objectContaining({ code: "GRANT_REQUIRED" }));
  });

  it("denies anonymous, agent/pseudo-user, and runner principals before private rollout details", async () => {
    const f = await fixture();
    const cases = [
      [{}, 401],
      [{ cookie: f.admin.cookie, "x-orgops-runner-token": "global-runner-token", "x-orgops-runner-id": "runner-a" }, 403],
    ] as const;
    for (const [headers, status] of cases) {
      const result = await jsonRequest(f, "/api/catalog-rollouts/plan", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(planBody()) });
      expect(result.response.status).toBe(status);
      expect(result.body).not.toHaveProperty("planDigest");
    }
    const privatePlan = await jsonRequest(f, "/api/catalog-rollouts/plan", { method: "POST", headers: { ...f.granted, "content-type": "application/json" }, body: JSON.stringify(planBody(["agent-private"])) });
    expect(privatePlan.response.status).toBe(403);
  });

  it("round-trips a real plan and confirmation, freezes IDs, and completes through runner HTTP reports", async () => {
    const f = await fixture();
    const planned = await jsonRequest(f, "/api/catalog-rollouts/plan", { method: "POST", headers: { ...f.admin, "content-type": "application/json" }, body: JSON.stringify(planBody(["agent-a", "agent-b"])) });
    expect(planned.response.status).toBe(200);
    expect(planned.body.targets.map((target: any) => target.agentId)).toEqual(["agent-a", "agent-b"]);
    const confirmed = await jsonRequest(f, "/api/catalog-rollouts", { method: "POST", headers: { ...f.admin, "content-type": "application/json" }, body: JSON.stringify({ planDigest: planned.body.planDigest, agentIds: ["agent-a", "agent-b"] }) });
    expect(confirmed.response.status).toBe(201);
    f.db.exec("INSERT INTO agents (id,name,model_id,soul_path,workspace_path,assigned_runner_id,created_at,updated_at) VALUES ('future','future','model-a','soul','/tmp/future','runner-a',1,1)");
    expect(confirmed.body.targetIds).toEqual(["agent-a", "agent-b"]);

    const polled = await jsonRequest(f, "/api/runners/runner-a/package-deployments", { headers: f.runner });
    expect(polled.response.status).toBe(200);
    const deploymentId = polled.body.find((row: any) => row.agentId === "agent-a").deploymentId as string;
    const claim = await jsonRequest(f, `/api/runner-package-deployments/${deploymentId}/claim`, { method: "POST", headers: f.runner });
    expect(claim.response.status).toBe(200);
    const generation = f.db.prepare<[string], { desired_generation: string }>("SELECT desired_generation FROM runner_package_deployments WHERE deployment_id=?").get(deploymentId)!.desired_generation;
    const reportHeaders = { ...f.runner, "x-orgops-deployment-attempt-token": claim.body.attemptToken, "content-type": "application/json" };
    f.db.prepare("UPDATE runner_package_deployments SET artifact_semantic_digest=?,revision=revision+1 WHERE deployment_id=?").run(`sha256:${"b".repeat(64)}`, deploymentId);
    for (const state of ["STAGED", "WAITING_FOR_IDLE", "ACTIVE"]) {
      const report = await jsonRequest(f, `/api/runner-package-deployments/${deploymentId}/report`, { method: "POST", headers: reportHeaders, body: JSON.stringify({ state, generation }) });
      expect(report.response.status, state).toBe(200);
    }
    const duplicate = await jsonRequest(f, `/api/runner-package-deployments/${deploymentId}/report`, { method: "POST", headers: reportHeaders, body: JSON.stringify({ state: "ACTIVE", generation }) });
    expect(duplicate.response.status).toBe(200);
    const sibling = f.db.prepare<[string, string], { deployment_id: string; desired_generation: string }>("SELECT deployment_id,desired_generation FROM runner_package_deployments WHERE rollout_id=? AND target_agent_id=?").get(confirmed.body.id, "agent-b")!;
    const siblingClaim = await jsonRequest(f, `/api/runner-package-deployments/${sibling.deployment_id}/claim`, { method: "POST", headers: f.runner });
    f.db.prepare("UPDATE runner_package_deployments SET artifact_semantic_digest=?,revision=revision+1 WHERE deployment_id=?").run(`sha256:${"c".repeat(64)}`, sibling.deployment_id);
    const siblingReport = await jsonRequest(f, `/api/runner-package-deployments/${sibling.deployment_id}/report`, { method: "POST", headers: { ...f.runner, "x-orgops-deployment-attempt-token": siblingClaim.body.attemptToken, "content-type": "application/json" }, body: JSON.stringify({ state: "FAILED", failureCode: "STORAGE_FAILURE", generation: sibling.desired_generation }) });
    expect(siblingReport.response.status).toBe(200);
    const view = await jsonRequest(f, `/api/catalog-rollouts/${confirmed.body.id}`, { headers: f.admin });
    expect(view.body.state).toBe("PARTIAL");
    expect(f.db.prepare("SELECT COUNT(*) AS count FROM event_receipts").get()).toEqual({ count: 0 });
    expect(f.db.prepare("SELECT type,channel_id,status FROM events WHERE type LIKE 'audit.catalog.%' ORDER BY id").all()).toSatisfy((rows: any[]) => rows.every(row => row.channel_id === null && row.status === "DELIVERED"));
  });

  it("cancels only queued siblings after a real HTTP success", async () => {
    const f = await fixture();
    const planned = await jsonRequest(f, "/api/catalog-rollouts/plan", { method: "POST", headers: { ...f.admin, "content-type": "application/json" }, body: JSON.stringify(planBody(["agent-a", "agent-b"])) });
    const confirmed = await jsonRequest(f, "/api/catalog-rollouts", { method: "POST", headers: { ...f.admin, "content-type": "application/json" }, body: JSON.stringify({ planDigest: planned.body.planDigest, agentIds: planned.body.targets.map((target: any) => target.agentId) }) });
    const polled = await jsonRequest(f, "/api/runners/runner-a/package-deployments", { headers: f.runner });
    const first = polled.body.find((row: any) => row.agentId === "agent-a").deploymentId as string;
    await activateDeployment(f, first);
    const beforeCancel = await jsonRequest(f, `/api/catalog-rollouts/${confirmed.body.id}`, { headers: f.admin });
    const cancelled = await jsonRequest(f, `/api/catalog-rollouts/${confirmed.body.id}/cancel`, { method: "POST", headers: { ...f.admin, "content-type": "application/json" }, body: JSON.stringify({ rolloutId: confirmed.body.id, expectedRevision: beforeCancel.body.revision }) });
    expect(cancelled.response.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(cancelled.body.rollout.state).toBe("CANCELLED");
    expect(cancelled.body.rollout.targets).toEqual(expect.arrayContaining([
      expect.objectContaining({ agentId: "agent-a", state: "SUCCEEDED" }),
      expect.objectContaining({ agentId: "agent-b", state: "SKIPPED" }),
    ]));

  });

  it("rejects strict transport bodies before invoking the real coordinator", async () => {
    const f = await fixture();
    const base = { ...f.admin, "content-type": "application/json" };
    for (const body of [JSON.stringify({ ...planBody(), extra: true }), "{", "\ud800"]) {
      const result = await jsonRequest(f, "/api/catalog-rollouts/plan", { method: "POST", headers: base, body });
      expect(result.response.status).toBe(400);
    }
    const query = await jsonRequest(f, "/api/catalog-rollouts/plan?x=1", { method: "POST", headers: base, body: JSON.stringify(planBody()) });
    expect(query.response.status).toBe(400);
    const oversized = await jsonRequest(f, "/api/catalog-rollouts/plan", { method: "POST", headers: base, body: "{" + "x".repeat(16 * 1024) });
    expect(oversized.response.status).toBe(413);
  });
});
