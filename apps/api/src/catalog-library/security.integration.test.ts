import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb, type OrgOpsDb } from "@orgops/db";
import { getCoreEventShapes, validateEventAgainstShapes, CatalogAuditEventSchema, type CatalogAuditEvent } from "@orgops/schemas";
import { canonicalManifestBytes, computePackageDigest } from "@orgops/skills";
import { createApp } from "../app";
import { catalogGrantId } from "./grant-identity";
import { approvedRelease } from "./test-fixtures";
import type { CatalogGitTransport } from "../catalog-sync/git-fetch";

const json = { "content-type": "application/json" };
const fixtureMasterKey = Buffer.alloc(32, 7).toString("base64");
const commit = "a".repeat(40);
const artifactCanaryBytes = Buffer.from("---\nname: security-skill\ndescription: Deterministic Source Library fixture.\nlicense: MIT\n---\nsecurity-artifact-bytes\n", "utf8");
const artifactCanaryEntry = {
  type: "file" as const,
  path: "SKILL.md",
  base64: artifactCanaryBytes.toString("base64"),
  executable: false,
};
const artifactManifestDraft = { ...approvedRelease().manifest, name: "security-skill", files: [{
  path: artifactCanaryEntry.path,
  size: artifactCanaryBytes.length,
  digest: `sha256:${createHash("sha256").update(artifactCanaryBytes).digest("hex")}`,
  executable: false,
}] };
const artifactDigestResult = computePackageDigest(artifactManifestDraft, [artifactCanaryEntry]);
if (!artifactDigestResult.ok) throw new Error("security fixture artifact manifest is invalid");
const digest = artifactDigestResult.value;
const artifactManifest = { ...artifactManifestDraft, digest };
const canaries = [
  "https://github.com/security/security-canary.git", "credential-ref-security-canary", "ciphertext-security-canary",
  "security-username-canary", "security-password-canary", "/private/security-artifacts", "/private/security-workspace", "security-command-canary",
  "security-secret-canary", "security-transport-exception", "security-sql-host-canary", "security-artifact-bytes",
];

type Principal = "admin" | "granted-manageable" | "granted-unmanageable" | "ungranted-ordinary" | "unmanageable-ordinary" | "agent" | "global-runner" | "scoped-runner" | "wrong-runner" | "invalid-runner" | "empty-runner" | "anonymous";
const MATRIX_PRINCIPALS: Principal[] = ["admin", "granted-manageable", "granted-unmanageable", "ungranted-ordinary", "unmanageable-ordinary", "agent", "global-runner", "scoped-runner", "wrong-runner", "invalid-runner", "empty-runner", "anonymous"];
type SecurityApp = ReturnType<typeof createApp>["app"];

type FixtureCookies = {
  admin: string;
  granted: string;
  grantedUnmanageable: string;
  ungranted: string;
  unmanageable: string;
};
type RolloutPlan = { id: string; agentId: string; digest: string };
type RolloutPlans = { admin: RolloutPlan; granted: RolloutPlan };
type FixtureHeaders = Record<Principal, Record<string, string>>;
type Fixture = {
  app: SecurityApp;
  db: OrgOpsDb;
  dir: string;
  scopedToken: string;
  headers: FixtureHeaders;
  owner: string;
  agentId: string;
  agentName: string;
  agentRunnerId: string;
  rolloutPlans: RolloutPlans;
  canaries: string[];
  close: () => void;
};
type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const OPERATION_ROUTES = [
  { operation: "source.create", method: "POST", registeredPath: "/api/catalog-sources" },
  { operation: "source.list", method: "GET", registeredPath: "/api/catalog-sources" },
  { operation: "source.detail", method: "GET", registeredPath: "/api/catalog-sources/:sourceId" },
  { operation: "source.patch", method: "PATCH", registeredPath: "/api/catalog-sources/:sourceId" },
  { operation: "source.remove", method: "DELETE", registeredPath: "/api/catalog-sources/:sourceId" },
  { operation: "source.restore", method: "POST", registeredPath: "/api/catalog-sources/:sourceId/restore" },
  { operation: "source.credential.put", method: "PUT", registeredPath: "/api/catalog-sources/:sourceId/read-credential" },
  { operation: "source.credential.delete", method: "DELETE", registeredPath: "/api/catalog-sources/:sourceId/read-credential" },
  { operation: "source.sync", method: "POST", registeredPath: "/api/catalog-sources/:sourceId/sync" },
  { operation: "source.sync-attempts", method: "GET", registeredPath: "/api/catalog-sources/:sourceId/sync-attempts" },
  { operation: "source.snapshots", method: "GET", registeredPath: "/api/catalog-sources/:sourceId/snapshots" },
  { operation: "release.list", method: "GET", registeredPath: "/api/catalog-releases" },
  { operation: "release.detail", method: "GET", registeredPath: "/api/catalog-releases/:packageReleaseId" },
  { operation: "release.review.approve", method: "POST", registeredPath: "/api/catalog-releases/:packageReleaseId/approve" },
  { operation: "release.review.reject", method: "POST", registeredPath: "/api/catalog-releases/:packageReleaseId/reject" },
  { operation: "release.review.withdraw", method: "POST", registeredPath: "/api/catalog-releases/:packageReleaseId/withdraw" },
  { operation: "release.review.reopen", method: "POST", registeredPath: "/api/catalog-releases/:packageReleaseId/reopen" },
  { operation: "release.install", method: "POST", registeredPath: "/api/catalog-releases/:packageReleaseId/install" },
  { operation: "release.grants.list", method: "GET", registeredPath: "/api/catalog-releases/:packageReleaseId/grants" },
  { operation: "grant.organization.create", method: "PUT", registeredPath: "/api/catalog-releases/:packageReleaseId/grants/organization" },
  { operation: "grant.human.create", method: "PUT", registeredPath: "/api/catalog-releases/:packageReleaseId/grants/humans/:humanId" },
  { operation: "grant.organization.revoke", method: "DELETE", registeredPath: "/api/catalog-releases/:packageReleaseId/grants/organization" },
  { operation: "grant.human.revoke", method: "DELETE", registeredPath: "/api/catalog-releases/:packageReleaseId/grants/humans/:humanId" },
  { operation: "api.approve", method: "POST", registeredPath: "/api/catalog-releases/:packageReleaseId/api-execution/approve" },
  { operation: "api.activate", method: "POST", registeredPath: "/api/catalog-releases/:packageReleaseId/api-execution/activate" },
  { operation: "api.deactivate", method: "POST", registeredPath: "/api/catalog-releases/:packageReleaseId/api-execution/deactivate" },
  { operation: "library.list", method: "GET", registeredPath: "/api/library/packages" },
  { operation: "library.detail", method: "GET", registeredPath: "/api/library/packages/:packageReleaseId" },
  { operation: "library.template-options", method: "GET", registeredPath: "/api/library/packages/:packageReleaseId/template-options" },
  { operation: "library.manageable-agents", method: "GET", registeredPath: "/api/library/packages/:packageReleaseId/manageable-agents" },
  { operation: "library.template-instantiate", method: "POST", registeredPath: "/api/library/templates/:packageReleaseId/instances" },
  { operation: "library.secret-binding", method: "PUT", registeredPath: "/api/library/agents/:agentId/requirements/:requirementName/secret-binding" },
  { operation: "assignment.enable", method: "PUT", registeredPath: "/api/agents/:name/catalog-skills/:packageReleaseId" },
  { operation: "assignment.disable", method: "DELETE", registeredPath: "/api/agents/:name/catalog-skills/:packageReleaseId" },
  { operation: "rollout.plan", method: "POST", registeredPath: "/api/catalog-rollouts/plan" },
  { operation: "rollout.confirm", method: "POST", registeredPath: "/api/catalog-rollouts" },
  { operation: "rollout.get", method: "GET", registeredPath: "/api/catalog-rollouts/:rolloutId" },
  { operation: "rollout.cancel", method: "POST", registeredPath: "/api/catalog-rollouts/:rolloutId/cancel" },
  { operation: "rollout.retry", method: "POST", registeredPath: "/api/catalog-rollouts/:rolloutId/retry-failed" },
  { operation: "runner.poll", method: "GET", registeredPath: "/api/runners/:runnerId/package-deployments" },
  { operation: "runner.claim", method: "POST", registeredPath: "/api/runner-package-deployments/:deploymentId/claim" },
  { operation: "runner.artifact", method: "GET", registeredPath: "/api/runner-package-deployments/:deploymentId/artifact" },
  { operation: "runner.report", method: "POST", registeredPath: "/api/runner-package-deployments/:deploymentId/report" },
  { operation: "runner.start-requirements", method: "GET", registeredPath: "/api/runners/:runnerId/agents/:agentName/start-requirements" },
  { operation: "runner.register", method: "POST", registeredPath: "/api/runners/register" },
] as const satisfies readonly { operation: string; method: HttpMethod; registeredPath: `/${string}` }[];
type OperationRoute = typeof OPERATION_ROUTES[number];
type OperationKey = OperationRoute["operation"];
type Operation = { key: OperationKey; family: string; method: OperationRoute["method"]; path: string; body?: unknown; expected: Record<Principal, number>; code?: string; invoke?: (f: Fixture, principal: Principal) => Promise<Response> };

const FIXTURE_ROUTE_PARAMS: Record<OperationKey, Readonly<Record<string, string>>> = {
  "source.create": {}, "source.list": {}, "source.detail": { sourceId: "source-private" }, "source.patch": { sourceId: "source-private" },
  "source.remove": { sourceId: "source-private" }, "source.restore": { sourceId: "source-private" }, "source.credential.put": { sourceId: "source-put" },
  "source.credential.delete": { sourceId: "source-private" }, "source.sync": { sourceId: "source-private" }, "source.sync-attempts": { sourceId: "source-private" },
  "source.snapshots": { sourceId: "source-private" }, "release.list": {}, "release.detail": { packageReleaseId: "release-skill" },
  "release.review.approve": { packageReleaseId: "release-pending" }, "release.review.reject": { packageReleaseId: "release-pending" },
  "release.review.withdraw": { packageReleaseId: "release-withdrawn" }, "release.review.reopen": { packageReleaseId: "release-rejected" },
  "release.install": { packageReleaseId: "release-install" }, "release.grants.list": { packageReleaseId: "release-skill" },
  "grant.organization.create": { packageReleaseId: "release-install" }, "grant.human.create": { packageReleaseId: "release-install", humanId: "human-ungranted" },
  "grant.organization.revoke": { packageReleaseId: "release-install" }, "grant.human.revoke": { packageReleaseId: "release-skill", humanId: "human-granted" },
  "api.approve": { packageReleaseId: "release-skill" }, "api.activate": { packageReleaseId: "release-skill" }, "api.deactivate": { packageReleaseId: "release-skill" },
  "library.list": {}, "library.detail": { packageReleaseId: "release-skill" }, "library.template-options": { packageReleaseId: "release-native" },
  "library.manageable-agents": { packageReleaseId: "release-skill" }, "library.template-instantiate": { packageReleaseId: "release-native" },
  "library.secret-binding": { agentId: "agent-granted", requirementName: "API_KEY" }, "assignment.enable": { name: "agent-granted", packageReleaseId: "release-skill" },
  "assignment.disable": { name: "agent-granted", packageReleaseId: "release-skill" }, "rollout.plan": {}, "rollout.confirm": {},
  "rollout.get": { rolloutId: "rollout-security" }, "rollout.cancel": { rolloutId: "rollout-security" }, "rollout.retry": { rolloutId: "rollout-security" },
  "runner.poll": { runnerId: "runner-a" }, "runner.claim": { deploymentId: "deployment-security" }, "runner.artifact": { deploymentId: "deployment-security" },
  "runner.report": { deploymentId: "deployment-security" }, "runner.start-requirements": { runnerId: "runner-a", agentName: "agent-granted" }, "runner.register": {},
};

function fixturePath(route: OperationRoute): string {
  const params = FIXTURE_ROUTE_PARAMS[route.operation];
  return route.registeredPath.replace(/:([A-Za-z][A-Za-z0-9]*)/g, (placeholder, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`missing fixture route parameter ${name} for ${route.operation}`);
    return value;
  });
}

const adminOnly = Object.fromEntries(["admin", "granted-manageable", "granted-unmanageable", "ungranted-ordinary", "unmanageable-ordinary"].map(p => [p, p === "admin" ? 200 : 403])) as Record<Principal, number>;
const libraryAuth = Object.fromEntries(["admin", "granted-manageable", "granted-unmanageable", "ungranted-ordinary", "unmanageable-ordinary"].map(p => [p, 200])) as Record<Principal, number>;
const runnerOnly = Object.fromEntries(["global-runner", "scoped-runner"].map(p => [p, 200])) as Record<Principal, number>;
for (const p of ["admin", "granted-manageable", "granted-unmanageable", "ungranted-ordinary", "unmanageable-ordinary", "invalid-runner", "empty-runner", "anonymous"] as Principal[]) runnerOnly[p] = 401;
runnerOnly.agent = 403;
for (const p of ["invalid-runner", "empty-runner", "anonymous"] as Principal[]) { adminOnly[p] = 401; libraryAuth[p] = 401; }
adminOnly.agent = 403;
libraryAuth.agent = 403;
runnerOnly["wrong-runner"] = 403;
for (const p of ["global-runner", "scoped-runner", "wrong-runner"] as Principal[]) adminOnly[p] = 403;
for (const p of ["global-runner", "scoped-runner"] as Principal[]) libraryAuth[p] = 403;
for (const p of ["wrong-runner"] as Principal[]) { adminOnly[p] = 403; libraryAuth[p] = 403; }

function clone<T>(value: T): T { return structuredClone(value); }
function responseBody(response: Response): Promise<any> { return response.text().then(text => text ? JSON.parse(text) : undefined); }
function responseHeaderEntries(headers: Headers): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  headers.forEach((value, key) => entries.push([key, value]));
  return entries;
}
function authError(principal: Principal, runner = false, library = false, operationKey = "") {
  if (principal === "anonymous") return { error: "Unauthorized" };
  if (library && ["agent", "global-runner", "scoped-runner", "wrong-runner"].includes(principal)) return { error: "Authenticated human access required" };
  if ((operationKey.startsWith("assignment.") || operationKey.startsWith("rollout.")) && ["granted-unmanageable", "ungranted-ordinary", "unmanageable-ordinary"].includes(principal)) return { error: "Administrator access required", code: "FORBIDDEN" };
  if (operationKey.startsWith("assignment.") && ["granted-unmanageable", "unmanageable-ordinary"].includes(principal)) return { error: "Administrator access required", code: "FORBIDDEN" };
  if (principal === "agent") {
    if (library) return { error: "Authenticated human access required" };
    if (operationKey === "runner.start-requirements") return { error: "Forbidden", code: "FORBIDDEN" };
    return runner ? { error: "Forbidden runner id for token scope" } : { error: "Administrator access required" };
  }
  if (["invalid-runner", "empty-runner"].includes(principal)) return { error: "Unauthorized" };
  if (principal === "wrong-runner") return runner
    ? operationKey === "runner.start-requirements" ? { error: "Forbidden", code: "FORBIDDEN" } : { error: "Forbidden runner id for token scope" }
    : { error: "Administrator access required" };
  if (runner) return { error: "Runner token required" };
  return { error: "Administrator access required" };
}

async function login(app: SecurityApp, username: string): Promise<string> {
  const result = await app.request("/api/auth/login", { method: "POST", headers: json, body: JSON.stringify({ username, password: "test-password" }) });
  expect(result.status, username).toBe(200);
  const cookie = result.headers.get("set-cookie")?.match(/orgops_session=[^;]+/)?.[0];
  expect(cookie).toBeTruthy();
  return cookie!;
}

async function makeFixture(options: { catalogSyncTransport?: CatalogGitTransport } = {}): Promise<Fixture> {
  const previousMasterKey = process.env.ORGOPS_MASTER_KEY;
  const dir = mkdtempSync(join(tmpdir(), "orgops-security-matrix-"));
  let db!: OrgOpsDb;
  let closed = false;
  const restore = () => {
    if (closed) return;
    closed = true;
    try { db?.close(); } catch { /* setup cleanup is failure-safe */ }
    rmSync(dir, { recursive: true, force: true });
    if (previousMasterKey === undefined) delete process.env.ORGOPS_MASTER_KEY; else process.env.ORGOPS_MASTER_KEY = previousMasterKey;
  };
  process.env.ORGOPS_MASTER_KEY = fixtureMasterKey;
  try {
    const artifactRoot = join(dir, "artifacts"); mkdirSync(artifactRoot, { recursive: true });
    db = openDb(":memory:");
  const created = createApp({ db, dataDir: dir, catalogInstallRoot: artifactRoot, catalogSyncTransport: options.catalogSyncTransport, adminUser: "owner", adminPass: "test-password", runnerToken: "global-runner-token" });
  const owner = db.prepare<[], { id: string }>("SELECT id FROM humans WHERE username='owner'").get()!.id;
  for (const [id, username] of [["human-granted", "granted"], ["human-granted-unmanageable", "granted-unmanageable"], ["human-ungranted", "ungranted"], ["human-unmanageable", "unmanageable"]]) {
    db.prepare(`INSERT INTO humans (id,username,password_hash,must_change_password,is_admin,created_at,updated_at) SELECT ?,?,password_hash,0,0,1,1 FROM humans WHERE id=?`).run(id, username, owner);
  }
  db.exec(`
    INSERT INTO runner_nodes (id,display_name,metadata_json,created_at,updated_at,last_seen_at) VALUES ('runner-a','Runner A','{}',1,1,1);
    INSERT INTO runner_nodes (id,display_name,metadata_json,created_at,updated_at,last_seen_at) VALUES ('runner-b','Runner B','{}',1,1,1);
    INSERT INTO models (id,provider,model_name,enabled,defaults_json,created_at) VALUES ('model-a','fixture','fixture',1,'{}',1);
    INSERT INTO agents (id,name,model_id,soul_path,workspace_path,owner_human_id,visibility,desired_state,runtime_state,assigned_runner_id,created_at,updated_at)
      VALUES ('agent-granted','agent-granted','model-a','/private/security-soul','/private/security-workspace','human-granted','PRIVATE','STOPPED','STOPPED','runner-a',1,1),
             ('agent-stopped','agent-stopped','model-a','/private/security-soul-stopped','/private/security-workspace-stopped','human-granted-unmanageable','PRIVATE','STOPPED','STOPPED','runner-a',1,1),
             ('agent-unmanageable','agent-unmanageable','model-a','/private/security-soul-unmanageable','/private/security-workspace-unmanageable','human-unmanageable','PRIVATE','STOPPED','STOPPED','runner-a',1,1),
             ('agent-admin','agent-admin','model-a','/private/security-soul-admin','/private/security-workspace-admin','${owner}','PRIVATE','STOPPED','STOPPED','runner-a',1,1),
             ('agent-rollout','agent-rollout','model-a','/private/security-soul-rollout','/private/security-workspace-rollout','human-granted','PRIVATE','STOPPED','STOPPED','runner-a',1,1);
    INSERT INTO catalog_sources (source_id,display_name,canonical_url,repository_identity,ref,enabled,allow_packages,revision,created_at,updated_at)
      VALUES ('source-private','Private security source','https://github.com/security/security-canary.git','security-sql-host-canary','security-ref-canary',1,1,1,1,1),
             ('source-put','Credential target source','https://security-put.invalid/catalog.git','security-put-identity','main',1,1,1,1,1);
    INSERT INTO catalog_source_read_credentials (source_id,credential_ref,kind,ciphertext_b64,revision,created_at,updated_at)
      VALUES ('source-private','credential-ref-security-canary','https-basic','ciphertext-security-canary',1,1,1);
    INSERT INTO catalog_sync_attempts (attempt_id,source_id,source_revision,state,resolved_commit,snapshot_id,failure_code,actor_human_id,revision,created_at,updated_at,completed_at)
      VALUES ('attempt-success','source-private',1,'SUCCEEDED','${commit}',NULL,NULL,'${owner}',1,1,1,1),
             ('attempt-failed','source-private',1,'FAILED',NULL,NULL,'SYNC_FAILED','${owner}',1,2,2,2);
    INSERT INTO catalog_snapshots (snapshot_id,source_id,source_commit,index_digest,index_json,observed_ref,attempt_id,created_at)
      VALUES ('snapshot-success','source-private','${commit}','${digest}','{"packages":[]}','security-ref-canary','attempt-success',1);
    UPDATE catalog_sources SET current_snapshot_id='snapshot-success' WHERE source_id='source-private';
  `);
  const skillManifest = structuredClone(artifactManifest);
  const nativeManifest = { ...approvedRelease("native-agent").manifest, digest, secrets: [{ name: "API_KEY", description: "Security fixture key", required: true }] };
  const executionPreview = { apiEventShapes: [], runnerScripts: [], wrappedCommands: [{ at: "setup.sh", command: "security-command-canary", args: [] }], externalSources: [] };
  for (const [id, state, kind, name, packageManifest] of [
    ["release-skill", "APPROVED", "skill", "security-skill", { ...skillManifest, name: "security-skill" }],
    ["release-pending", "PENDING", "skill", "security-pending", { ...skillManifest, name: "security-pending" }],
    ["release-rejected", "REJECTED", "skill", "security-rejected", { ...skillManifest, name: "security-rejected" }],
    ["release-withdrawn", "WITHDRAWN", "skill", "security-withdrawn", { ...skillManifest, name: "security-withdrawn" }],
    ["release-install", "APPROVED", "skill", "security-install", { ...skillManifest, name: "security-install" }],
    ["release-native", "APPROVED", "native-agent", "security-native", { ...nativeManifest, name: "security-native" }],
  ] as const) {
    db.prepare(`INSERT INTO catalog_package_releases (package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,manifest_json,execution_preview_json,warnings_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)`).run(id, "source-private", "source-private", kind, name, "1.0.0", digest, commit, commit, `${kind === "skill" ? "skills" : "agents"}/${name}`, JSON.stringify(packageManifest), JSON.stringify(executionPreview), JSON.stringify([]));
    db.prepare(`INSERT INTO catalog_release_controls (package_release_id,review_state,review_digest,reviewed_by_human_id,reviewed_at,revision,created_at,updated_at) VALUES (?,?,?,?,1,1,1,1)`).run(id, state, state === "PENDING" ? null : digest, state === "PENDING" ? null : owner);
  }
  for (const [releaseId, name] of [["release-skill", "security-skill"], ["release-install", "security-install"], ["release-native", "security-native"]] as const) {
    db.prepare(`INSERT INTO catalog_installations (release_id,artifact_digest,artifact_path,state,installed_by_human_id,installed_at,last_verified_at,revision) VALUES (?,?,?,'INSTALLED',?,1,1,1)`).run(releaseId, digest, join(artifactRoot, name, digest.slice(7)), owner);
  }
  const artifactPath = join(artifactRoot, "security-skill", digest.slice(7)); mkdirSync(artifactPath, { recursive: true, mode: 0o700 }); writeFileSync(join(artifactPath, "orgops-package.json"), canonicalManifestBytes({ ...skillManifest, name: "security-skill" }), { mode: 0o644 }); writeFileSync(join(artifactPath, "SKILL.md"), artifactCanaryBytes, { mode: 0o644 });
  const installArtifactPath = join(artifactRoot, "security-install", digest.slice(7)); mkdirSync(installArtifactPath, { recursive: true, mode: 0o700 }); writeFileSync(join(installArtifactPath, "orgops-package.json"), canonicalManifestBytes({ ...skillManifest, name: "security-install" }), { mode: 0o644 }); writeFileSync(join(installArtifactPath, "SKILL.md"), artifactCanaryBytes, { mode: 0o644 });
  for (const [releaseId, humanId] of [["release-skill", "human-granted"], ["release-skill", "human-granted-unmanageable"], ["release-native", "human-granted"], ["release-native", "human-granted-unmanageable"]] as const) {
    db.prepare(`INSERT INTO catalog_grants (grant_id,release_id,subject_type,human_id,revision,created_by_human_id,created_at,updated_at) VALUES (?,?,?,?,1,?,1,1)`).run(catalogGrantId(releaseId, "HUMAN", humanId), releaseId, "HUMAN", humanId, owner);
  }
  expect(db.prepare("SELECT count(*) AS count FROM catalog_grants WHERE release_id='release-skill' AND subject_type='ORGANIZATION' AND revoked_at IS NULL").get()).toEqual({ count: 0 });
  db.prepare(`INSERT INTO agent_skill_assignments (assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,preload,active_generation,desired_generation,revision,actor_kind,actor_human_id,created_at,updated_at) VALUES ('assignment-security','agent-granted','release-skill','security-skill','DISABLED','DISABLED','STABLE',0,'generation-old','generation-old',1,'ADMIN',?,1,1)`).run(owner);
  db.prepare(`INSERT INTO agent_template_origins
    (agent_id,release_id,mode,consumed_by_kind,consumed_by_human_id,grant_id,authority_source_id,content_source_id,package_kind,package_name,package_version,catalog_commit,package_commit,package_path,package_digest,created_at)
    VALUES ('agent-granted','release-native','RLM_REPL','ADMIN',?,NULL,'source-private','source-private','native-agent','security-native','1.0.0',?,?,?, ?,1)`).run(owner, commit, commit, 'agents/security-native', digest);
  db.prepare(`INSERT INTO runner_package_deployments (deployment_id,target_agent_id,release_id,bound_runner_id,desired_generation,state,revision,created_at,updated_at) VALUES ('deployment-security','agent-granted','release-skill','runner-a','generation-new','QUEUED',1,1,1)`).run();
  const scopedToken = "org_rt_security_matrix";
  db.prepare(`INSERT INTO runner_tokens (id,name,token_hash,token_prefix,allowed_agent_name,allowed_runner_id,allowed_channel_ids_json,created_by_human_id,created_at) VALUES ('security-token','Security runner',?,?,NULL,'runner-a','[]',?,1)`).run(createHash("sha256").update(scopedToken).digest("hex"), scopedToken.slice(0, 16), owner);
  const cookies: FixtureCookies = { admin: await login(created.app, "owner"), granted: await login(created.app, "granted"), grantedUnmanageable: await login(created.app, "granted-unmanageable"), ungranted: await login(created.app, "ungranted"), unmanageable: await login(created.app, "unmanageable") };
  const channelResponse = await created.app.request("/api/channels", { method: "POST", headers: { cookie: cookies.admin, ...json }, body: JSON.stringify({ name: "security-agent-channel", kind: "GROUP" }) });
  expect(channelResponse.status).toBe(201);
  const channel = await responseBody(channelResponse) as { id: string };
  const inviteResponse = await created.app.request("/api/agent-invites", { method: "POST", headers: { cookie: cookies.admin, ...json }, body: JSON.stringify({ name: "security-agent-invite", agentName: "agent-invite-security", channelIds: [channel.id], maxUses: 1 }) });
  expect(inviteResponse.status).toBe(201);
  const invite = await responseBody(inviteResponse) as { id: string; inviteLink: string; agentName: string };
  const inviteToken = decodeURIComponent(invite.inviteLink.split("/public/")[1]!);
  const redeemResponse = await created.app.request(`/api/agent-invites/public/${encodeURIComponent(inviteToken)}/redeem`, { method: "POST" });
  expect(redeemResponse.status).toBe(200);
  const redeemed = await responseBody(redeemResponse) as { runner: { token: string; runnerId: string }; agent: { name: string } };
  expect(redeemed.agent.name).toBe("agent-invite-security");
  const agentId = db.prepare<[string], { id: string }>("SELECT id FROM agents WHERE name=?").get(redeemed.agent.name)?.id;
  expect(agentId).toBeTruthy();
  const invitedTokenRow = db.prepare<[string], { allowed_agent_name: string; allowed_runner_id: string; invite_id: string }>("SELECT allowed_agent_name,allowed_runner_id,invite_id FROM runner_tokens WHERE token_hash=?").get(createHash("sha256").update(redeemed.runner.token).digest("hex"));
  expect(invitedTokenRow).toEqual({ allowed_agent_name: "agent-invite-security", allowed_runner_id: redeemed.runner.runnerId, invite_id: invite.id });
  const secretResponse = await created.app.request("/api/secrets", { method: "POST", headers: { ...json, cookie: cookies.admin }, body: JSON.stringify({ package: "security-native", key: "API_KEY", value: "security-secret-canary" }) });
  expect(secretResponse.status).toBe(201);
  const secretId = (await responseBody(secretResponse) as { id: string }).id;
  db.prepare("DELETE FROM runner_package_deployments WHERE deployment_id='deployment-security'").run();
  const planFor = async (cookie: string, agentId: string): Promise<RolloutPlan> => {
    const response = await created.app.request("/api/catalog-rollouts/plan", { method: "POST", headers: { cookie, ...json }, body: JSON.stringify({ releaseId: "release-skill", operation: "ENABLE", agentIds: [agentId] }) });
    expect(response.status).toBe(200);
    const plan = await responseBody(response);
    const row = db.prepare<[string], { rollout_id: string }>("SELECT rollout_id FROM catalog_rollouts WHERE plan_digest=?").get(plan.planDigest);
    expect(row).toBeTruthy();
    return { id: row!.rollout_id, agentId, digest: plan.planDigest };
  };
  const rolloutPlans: RolloutPlans = {
    admin: await planFor(cookies.admin, "agent-admin"),
    granted: await planFor(cookies.granted, "agent-rollout"),
  };
  db.prepare("INSERT INTO runner_package_deployments (deployment_id,target_agent_id,release_id,bound_runner_id,desired_generation,state,revision,created_at,updated_at) VALUES ('deployment-security','agent-granted','release-skill','runner-a','generation-new','QUEUED',1,1,1)").run();
  const headers: Record<Principal, Record<string, string>> = {
    admin: { cookie: cookies.admin }, "granted-manageable": { cookie: cookies.granted }, "granted-unmanageable": { cookie: cookies.grantedUnmanageable }, "ungranted-ordinary": { cookie: cookies.ungranted }, "unmanageable-ordinary": { cookie: cookies.unmanageable },
    agent: { "x-orgops-runner-token": redeemed.runner.token }, "global-runner": { "x-orgops-runner-token": "global-runner-token", "x-orgops-runner-id": "runner-a" }, "scoped-runner": { "x-orgops-runner-token": scopedToken, "x-orgops-runner-id": "runner-a" }, "wrong-runner": { "x-orgops-runner-token": scopedToken, "x-orgops-runner-id": "runner-b" }, "invalid-runner": { cookie: cookies.admin, "x-orgops-runner-token": "invalid" }, "empty-runner": { cookie: cookies.admin, "x-orgops-runner-token": "" }, anonymous: {},
  };
  expect(db.prepare("SELECT source_id FROM catalog_sources WHERE source_id='source-private'").get()).toBeTruthy();
  expect(db.prepare("SELECT attempt_id FROM catalog_sync_attempts WHERE attempt_id='attempt-success'").get()).toBeTruthy();
  expect(db.prepare("SELECT snapshot_id FROM catalog_snapshots WHERE snapshot_id='snapshot-success'").get()).toBeTruthy();
  expect(db.prepare("SELECT deployment_id FROM runner_package_deployments WHERE deployment_id='deployment-security'").get()).toBeTruthy();
    return { app: created.app, db, dir, scopedToken, headers, owner, agentId: agentId!, agentName: redeemed.agent.name, agentRunnerId: redeemed.runner.runnerId, rolloutPlans,
      canaries: [...canaries, secretId],
      close: restore };
  } catch (error) {
    restore();
    throw error;
  }
}

function bodyFor(key: string): unknown {
  if (key === "source.create") return { sourceId: "source-new", displayName: "Created security source", repository: { url: "https://github.com/security/create-catalog.git" }, ref: "main", enabled: true, allowPackages: false };
  if (key === "source.patch") return { expectedRevision: 1, displayName: "Patched security source" };
  if (["source.remove", "source.credential.delete"].includes(key)) return { expectedRevision: 1 };
  if (key === "source.restore") return { expectedRevision: 2 };
  if (key === "source.credential.put") return { expectedRevision: 1, kind: "https-basic", username: "security-username-canary", password: "security-password-canary" };
  if (key === "source.sync") return { expectedRevision: 1 };
  if (key.startsWith("release.review")) return { expectedRevision: 1, digest, reviewDigest: digest };
  if (key === "release.install") return { dependencyReleaseIds: [] };
  if (key === "library.template-instantiate") return { name: "security-template", visibility: "PRIVATE", runnerId: "runner-a", workspacePath: ".orgops-data/workspaces/security-template", modelId: "model-a", secretBindings: [] };
  if (key === "library.secret-binding") return { expectedAgentRevision: 1, secretId: "security-secret-id" };
  if (key === "grant.organization.create" || key === "grant.human.create") return { expectedRevision: 0 };
  if (key.endsWith("revoke")) return { expectedRevision: 1 };
  if (key === "api.approve") return { expectedRevision: 1, digest };
  if (["api.activate", "api.deactivate"].includes(key)) return { expectedRevision: 1 };
  if (["assignment.enable", "assignment.disable"].includes(key)) return { expectedAgentRevision: 1, expectedAssignmentRevision: 1, preload: false };
  if (key === "rollout.plan") return { releaseId: "release-skill", operation: "ENABLE", agentIds: ["agent-granted"] };
  if (key === "rollout.confirm") return { planDigest: `sha256:${"b".repeat(64)}`, agentIds: ["agent-granted"] };
  if (["rollout.cancel", "rollout.retry"].includes(key)) return { rolloutId: "rollout-security", expectedRevision: 1 };
  if (key === "runner.report") return { state: "STAGED", generation: "generation-new" };
  if (key === "runner.register") return { existingRunnerId: "runner-a", displayName: "Runner A" };
  return undefined;
}

const operations: Operation[] = OPERATION_ROUTES.map(route => {
  const key = route.operation;
  const family = key.split(".")[0]!;
  const runner = key.startsWith("runner.");
  const expected = runner ? clone(runnerOnly) : key.startsWith("library.") || key.startsWith("assignment") || key.startsWith("rollout.") ? clone(libraryAuth) : clone(adminOnly);
  return { key, family, method: route.method, path: fixturePath(route), body: bodyFor(key), expected, code: undefined };
});
operations.find(operation => operation.key === "source.create")!.expected.admin = 201;
for (const principal of ["global-runner", "scoped-runner"] as Principal[]) operations.find(operation => operation.key === "runner.register")!.expected[principal] = 201;
operations.find(operation => operation.key === "release.install")!.expected.admin = 422;
for (const key of ["api.approve", "api.activate", "api.deactivate"]) operations.find(operation => operation.key === key)!.expected.admin = 409;
for (const principal of ["ungranted-ordinary", "unmanageable-ordinary"] as Principal[]) {
  operations.find(operation => operation.key === "library.detail")!.expected[principal] = 404;
  operations.find(operation => operation.key === "library.template-options")!.expected[principal] = 404;
  operations.find(operation => operation.key === "library.manageable-agents")!.expected[principal] = 404;
}
for (const principal of ["admin", "granted-manageable", "granted-unmanageable"] as Principal[]) operations.find(operation => operation.key === "library.template-options")!.expected[principal] = 200;
for (const principal of ["admin", "granted-manageable", "granted-unmanageable"] as Principal[]) operations.find(operation => operation.key === "library.template-instantiate")!.expected[principal] = 201;
operations.find(operation => operation.key === "library.template-instantiate")!.expected["ungranted-ordinary"] = 403;
operations.find(operation => operation.key === "library.template-instantiate")!.expected["unmanageable-ordinary"] = 403;
for (const principal of ["admin", "granted-manageable"] as Principal[]) operations.find(operation => operation.key === "library.secret-binding")!.expected[principal] = 200;
for (const principal of ["granted-unmanageable", "ungranted-ordinary", "unmanageable-ordinary"] as Principal[]) operations.find(operation => operation.key === "library.secret-binding")!.expected[principal] = 403;
for (const key of ["assignment.enable", "assignment.disable", "rollout.plan"]) for (const principal of ["granted-unmanageable", "ungranted-ordinary", "unmanageable-ordinary"] as Principal[]) operations.find(operation => operation.key === key)!.expected[principal] = 403;
for (const principal of ["granted-unmanageable", "ungranted-ordinary", "unmanageable-ordinary"] as Principal[]) operations.find(operation => operation.key === "rollout.confirm")!.expected[principal] = 409;
for (const principal of ["granted-unmanageable", "ungranted-ordinary", "unmanageable-ordinary"] as Principal[]) operations.find(operation => operation.key === "rollout.get")!.expected[principal] = 404;
operations.find(operation => operation.key === "rollout.confirm")!.expected.admin = 201;
operations.find(operation => operation.key === "rollout.confirm")!.expected["granted-manageable"] = 201;
for (const key of ["runner.claim", "runner.artifact", "runner.report"] as const) operations.find(operation => operation.key === key)!.expected.agent = 400;
for (const key of ["rollout.cancel", "rollout.retry"]) {
  for (const principal of ["granted-unmanageable", "ungranted-ordinary", "unmanageable-ordinary"] as Principal[]) operations.find(operation => operation.key === key)!.expected[principal] = 404;
}

async function prepareOperation(f: Fixture, operation: Operation) {
  if (operation.key.startsWith("assignment.")) f.db.prepare("DELETE FROM runner_package_deployments WHERE deployment_id='deployment-security'").run();
  if (operation.key === "source.restore") f.db.prepare("UPDATE catalog_sources SET removed_at=2,enabled=0,allow_packages=0,revision=2 WHERE source_id='source-private'").run();
  if (operation.key === "source.credential.delete") f.db.prepare("UPDATE catalog_source_read_credentials SET revision=1 WHERE source_id='source-private'").run();
  if (operation.key === "grant.organization.create") f.db.prepare("DELETE FROM catalog_grants WHERE grant_id=?").run(catalogGrantId("release-install", "ORGANIZATION"));
  if (operation.key === "grant.organization.revoke") f.db.prepare(`INSERT INTO catalog_grants (grant_id,release_id,subject_type,human_id,revision,created_by_human_id,created_at,updated_at) VALUES (?,?,?,NULL,1,?,1,1)`).run(catalogGrantId("release-install", "ORGANIZATION"), "release-install", "ORGANIZATION", f.owner);
  if (operation.key === "grant.human.create") f.db.prepare("DELETE FROM catalog_grants WHERE release_id='release-install'").run();
  if (operation.key === "release.review.withdraw") f.db.prepare("UPDATE catalog_release_controls SET review_state='APPROVED' WHERE package_release_id='release-withdrawn'").run();
  if (operation.key === "release.review.reopen") f.db.prepare("UPDATE catalog_release_controls SET review_state='REJECTED' WHERE package_release_id='release-rejected'").run();
  if (operation.key.startsWith("rollout.")) {
    f.db.prepare("DELETE FROM runner_package_deployments WHERE deployment_id='deployment-security'").run();
    const confirmPlan = async (owner: "admin" | "granted") => {
      const plan = f.rolloutPlans[owner];
      const response = await f.app.request("/api/catalog-rollouts", { method: "POST", headers: { ...f.headers[owner === "admin" ? "admin" : "granted-manageable"], ...json }, body: JSON.stringify({ planDigest: plan.digest, agentIds: [plan.agentId] }) });
      expect(response.status).toBe(201);
      return plan;
    };
    if (["rollout.cancel", "rollout.retry"].includes(operation.key)) {
      await confirmPlan("admin");
      await confirmPlan("granted");
    }
    if (operation.key === "rollout.retry") {
      for (const owner of ["admin", "granted"] as const) {
        const plan = f.rolloutPlans[owner];
        const deployment = f.db.prepare<[string], { deployment_id: string }>("SELECT deployment_id FROM runner_package_deployments WHERE rollout_id=?").get(plan.id)!;
        const claim = await f.app.request(`/api/runner-package-deployments/${deployment.deployment_id}/claim`, { method: "POST", headers: f.headers["global-runner"] });
        expect(claim.status).toBe(200);
        const claimBody = await responseBody(claim) as { attemptToken: string };
        const desiredGeneration = f.db.prepare<[string], { desired_generation: string }>("SELECT desired_generation FROM runner_package_deployments WHERE deployment_id=?").get(deployment.deployment_id)!.desired_generation;
        const report = await f.app.request(`/api/runner-package-deployments/${deployment.deployment_id}/report`, { method: "POST",
          headers: { ...f.headers["global-runner"], ...json, "x-orgops-deployment-attempt-token": claimBody.attemptToken },
          body: JSON.stringify({ state: "FAILED", generation: desiredGeneration, failureCode: "STORAGE_FAILURE" }) });
        expect(report.status).toBe(200);
        expect(await responseBody(report)).toMatchObject({ state: "FAILED" });
      }
    }
  }
}

async function invoke(f: Fixture, operation: Operation, principal: Principal) {
  const headers: Record<string, string> = { ...f.headers[principal], ...(operation.body === undefined ? {} : json) };
  let requestPath = operation.key.startsWith("assignment.") && principal === "admin" ? operation.path.replace("agent-granted", "agent-admin") : operation.path;
  if (["runner.poll", "runner.start-requirements"].includes(operation.key) && principal === "wrong-runner") requestPath = requestPath.replace("runner-a", "runner-b");
  if (operation.key.startsWith("rollout.")) {
    const owner = principal === "admin" ? "admin" : "granted";
    requestPath = requestPath.replace("rollout-security", f.rolloutPlans[owner].id);
  }
  let body = operation.body;
  if (operation.key.startsWith("assignment.") && principal === "admin") body = { ...(body as Record<string, unknown>), expectedAssignmentRevision: 0 };
  if (operation.key === "rollout.plan") body = { ...(body as Record<string, unknown>), agentIds: [principal === "admin" ? "agent-admin" : "agent-rollout"] };
  if (operation.key === "runner.artifact") {
    const claim = await f.app.request("/api/runner-package-deployments/deployment-security/claim", { method: "POST", headers: f.headers["global-runner"] });
    const claimBody = await responseBody(claim);
    if (principal === "global-runner" || principal === "scoped-runner") headers["x-orgops-deployment-attempt-token"] = claimBody.attemptToken;
  }
  if (operation.key === "runner.report") {
    const claim = await f.app.request("/api/runner-package-deployments/deployment-security/claim", { method: "POST", headers: f.headers["global-runner"] });
    const claimBody = await responseBody(claim);
    if (principal === "global-runner" || principal === "scoped-runner") headers["x-orgops-deployment-attempt-token"] = claimBody.attemptToken;
  }
  if (operation.key === "library.secret-binding") body = { expectedAgentRevision: 1, secretId: f.canaries[f.canaries.length - 1] };
  if (operation.key === "rollout.confirm" && operation.expected[principal] < 400) {
    const owner = principal === "admin" ? "admin" : "granted";
    body = { planDigest: f.rolloutPlans[owner].digest, agentIds: [f.rolloutPlans[owner].agentId] };
  }
  if (["rollout.cancel", "rollout.retry"].includes(operation.key)) {
    const rolloutId = f.rolloutPlans[principal === "admin" ? "admin" : "granted"].id;
    const expectedRevision = operation.key === "rollout.retry"
      ? f.db.prepare<[string], { revision: number }>("SELECT revision FROM catalog_rollouts WHERE rollout_id=?").get(rolloutId)!.revision
      : 2;
    body = { rolloutId, expectedRevision };
  }
  if (operation.key === "runner.report") body = { state: "STAGED", generation: f.db.prepare<[], { desired_generation: string }>("SELECT desired_generation FROM runner_package_deployments WHERE deployment_id='deployment-security'").get()!.desired_generation };
  if (operation.key === "runner.register" && principal === "wrong-runner") body = { existingRunnerId: "runner-b", displayName: "Runner B" };
  const response = await f.app.request(requestPath, { method: operation.method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return response;
}

const catalogSurfacePath = (path: string) =>
  path === "/api/catalog-sources" || path.startsWith("/api/catalog-sources/")
  || path === "/api/catalog-releases" || path.startsWith("/api/catalog-releases/")
  || path === "/api/library/packages" || path.startsWith("/api/library/packages/")
  || path === "/api/library/templates" || path.startsWith("/api/library/templates/")
  || path.startsWith("/api/library/agents/")
  || path.startsWith("/api/agents/:name/catalog-skills/")
  || path === "/api/catalog-rollouts" || path.startsWith("/api/catalog-rollouts/")
  || path.startsWith("/api/runners/:runnerId/package-deployments")
  || path.startsWith("/api/runners/:runnerId/agents/:agentName/start-requirements")
  || path.startsWith("/api/runner-package-deployments/")
  || path === "/api/runners/register";

function routePairs(app: SecurityApp): string[] {
  return [...new Set(app.routes
    .filter(route => route.method !== "ALL" && catalogSurfacePath(route.path))
    .map(route => `${route.method.toUpperCase()} ${route.path}`))].sort();
}

describe("catalog source library complete security matrix", () => {
  it("matches the actual Catalog Source Library route surface", async () => {
    const fixture = await makeFixture();
    try {
      const expectedPairs = OPERATION_ROUTES.map(route => `${route.method} ${route.registeredPath}`).sort();
      expect(OPERATION_ROUTES).toHaveLength(45);
      expect(new Set(OPERATION_ROUTES.map(route => route.operation)).size).toBe(OPERATION_ROUTES.length);
      expect(new Set(expectedPairs).size).toBe(expectedPairs.length);
      expect(MATRIX_PRINCIPALS).toHaveLength(12);
      expect(OPERATION_ROUTES.length * MATRIX_PRINCIPALS.length).toBe(540);
      expect(routePairs(fixture.app)).toEqual(expectedPairs);
    } finally {
      fixture.close();
    }
  });

  it("uses a real invited agent credential for the owning agent endpoint", async () => {
    const fixture = await makeFixture();
    try {
      const response = await fixture.app.request(`/api/agents/${fixture.agentName}`, {
        headers: fixture.headers.agent,
      });
      expect(response.status).toBe(200);
      expect((await responseBody(response)).id).toBe(fixture.agentId);
      const catalogResponse = await fixture.app.request("/api/library/packages", { headers: fixture.headers.agent });
      expect(catalogResponse.status).toBe(403);
      expect(await responseBody(catalogResponse)).toEqual({ error: "Authenticated human access required" });
    } finally {
      fixture.close();
    }
  });

  it("covers the exact registered operation inventory and every authentic principal", async () => {
    expect(operations.map(operation => operation.key)).toEqual(OPERATION_ROUTES.map(route => route.operation));
    const counts = new Map<string, number>(); let executed = 0; let authorizedSuccess = 0;
    const principals = MATRIX_PRINCIPALS;
    for (const operation of operations) for (const principal of principals) {
      const fixture = await makeFixture();
      try {
        await prepareOperation(fixture, operation);
        const response = await invoke(fixture, operation, principal);
        const body = await responseBody(response);
        executed++; counts.set(principal, (counts.get(principal) ?? 0) + 1);
        expect(response.status, `${operation.key}:${operation.path}:${principal}:${JSON.stringify(body)}`).toBe(operation.expected[principal]);
        if (operation.key === "library.template-options" && response.status === 200) {
          expect(body).toEqual({ runners: [{ id: "runner-a" }, { id: "runner-b" }], models: [{ id: "model-a" }], secretReferences: [] });
        }
        const grantDeniedTemplate = operation.key === "library.template-instantiate" && ["ungranted-ordinary", "unmanageable-ordinary"].includes(principal);
        const ownerDeniedSecret = operation.key === "library.secret-binding" && ["granted-unmanageable", "ungranted-ordinary", "unmanageable-ordinary"].includes(principal);
        if ((operation.expected[principal] === 401 || operation.expected[principal] === 403) && !grantDeniedTemplate && !ownerDeniedSecret) expect(body, `${operation.key}:${principal}`).toEqual(authError(principal, operation.key.startsWith("runner."), operation.key.startsWith("library.") || operation.key.startsWith("assignment") || operation.key.startsWith("rollout."), operation.key));
        if (grantDeniedTemplate) expect(body, `${operation.key}:${principal}`).toEqual({ error: "A current grant is required", code: "GRANT_REQUIRED" });
        if (ownerDeniedSecret) expect(body, `${operation.key}:${principal}`).toEqual({ error: "Administrator access required", code: "FORBIDDEN" });
        if (response.status >= 400 && response.status !== 401 && response.status !== 403) {
          const expectedError = response.status === 400
            ? { error: "Invalid catalog library request", code: "INVALID_REQUEST" }
            : response.status === 404
              ? { error: "Catalog library resource not found", code: "NOT_FOUND" }
              : response.status === 422
              ? { error: "Package inspection failed; last-known-good content is unchanged", code: "INSPECTION_FAILED" }
              : operation.key === "rollout.confirm" || operation.key === "api.deactivate"
                ? { error: "Catalog library changed; reload metadata", code: "REVISION_CONFLICT" }
                : { error: "Catalog library operation conflicts with current state", code: "STATE_CONFLICT" };
          expect(body, `${operation.key}:${principal}`).toEqual(expectedError);
        }
        if (principal === "admin" && response.status >= 200 && response.status < 300) authorizedSuccess++;
        if (operation.key !== "runner.register" && (!operation.key.startsWith("runner.") || response.status !== 401)) expect(response.headers.get("cache-control"), `${operation.key}:${principal}`).toBe("no-store");
        const serialized = JSON.stringify(body);
        const headerText = JSON.stringify(responseHeaderEntries(response.headers));
        const authorizedArtifact = operation.key === "runner.artifact" && ["global-runner", "scoped-runner"].includes(principal);
        if (principal !== "admin" && !authorizedArtifact) {
          expect(canaries.some(canary => serialized.includes(canary)), `${operation.key}:${principal}:body`).toBe(false);
          expect(canaries.some(canary => headerText.includes(canary)), `${operation.key}:${principal}:headers`).toBe(false);
        }
        expect(`${serialized}${headerText}`).not.toMatch(principal === "admin"
          ? /SQLITE|SELECT .* FROM|security-workspace|security-artifact-bytes|Error:/i
          : authorizedArtifact
            ? /SQLITE|SELECT .* FROM|security-workspace|security-command|Error:/i
            : /SQLITE|SELECT .* FROM|security-workspace|security-command|security-artifact-bytes|Error:/i);
      } finally { fixture.close(); }
    }
    expect(counts.size).toBe(12); expect([...counts.values()].every(count => count > 0)).toBe(true);
    expect(executed).toBe(OPERATION_ROUTES.length * MATRIX_PRINCIPALS.length); expect(authorizedSuccess).toBeGreaterThan(0);
  }, 120000);

  it("traverses stored leak canaries through protected and safe projections without disclosure", async () => {
    const fixture = await makeFixture();
    try {
      const source = fixture.db.prepare("SELECT canonical_url,repository_identity FROM catalog_sources WHERE source_id='source-private'").get() as { canonical_url: string; repository_identity: string };
      const credential = fixture.db.prepare("SELECT credential_ref,ciphertext_b64 FROM catalog_source_read_credentials WHERE source_id='source-private'").get() as { credential_ref: string; ciphertext_b64: string };
      const agent = fixture.db.prepare("SELECT workspace_path FROM agents WHERE id='agent-granted'").get() as { workspace_path: string };
      const release = fixture.db.prepare("SELECT execution_preview_json FROM catalog_package_releases WHERE package_release_id='release-native'").get() as { execution_preview_json: string };
      expect(source.canonical_url).toBe("https://github.com/security/security-canary.git");
      expect(source.repository_identity).toBe("security-sql-host-canary");
      expect(credential).toEqual({ credential_ref: "credential-ref-security-canary", ciphertext_b64: "ciphertext-security-canary" });
      expect(agent.workspace_path).toBe("/private/security-workspace");
      expect(release.execution_preview_json).toContain("security-command-canary");
      const installation = fixture.db.prepare("SELECT artifact_path FROM catalog_installations WHERE release_id='release-skill'").get() as { artifact_path: string };
      const manifest = JSON.parse((fixture.db.prepare("SELECT manifest_json FROM catalog_package_releases WHERE package_release_id='release-skill'").get() as { manifest_json: string }).manifest_json);
      expect(manifest.files).toEqual([{ path: "SKILL.md", size: artifactCanaryBytes.length, digest: `sha256:${createHash("sha256").update(artifactCanaryBytes).digest("hex")}`, executable: false }]);
      expect(readFileSync(join(installation.artifact_path, "SKILL.md"))).toEqual(artifactCanaryBytes);
      expect(fixture.canaries).toEqual(expect.arrayContaining([source.canonical_url, credential.credential_ref, credential.ciphertext_b64, agent.workspace_path, "security-command-canary", "security-secret-canary", "security-artifact-bytes"]));
      fixture.db.prepare("UPDATE agent_skill_assignments SET desired_state='ENABLED',effective_state='ENABLED' WHERE assignment_id='assignment-security'").run();
      const claim = await fixture.app.request("/api/runner-package-deployments/deployment-security/claim", { method: "POST", headers: fixture.headers["global-runner"] });
      expect(claim.status).toBe(200);
      const claimBody = await responseBody(claim) as { attemptToken: string };
      const authorizedArtifact = await fixture.app.request("/api/runner-package-deployments/deployment-security/artifact", {
        headers: { ...fixture.headers["global-runner"], "x-orgops-deployment-attempt-token": claimBody.attemptToken },
      });
      expect(authorizedArtifact.status).toBe(200);
      expect((await responseBody(authorizedArtifact)).files).toContainEqual(expect.objectContaining({ path: "SKILL.md", bytesBase64: artifactCanaryBytes.toString("base64") }));
      const unauthorizedArtifact = await fixture.app.request("/api/runner-package-deployments/deployment-security/artifact", {
        headers: { ...fixture.headers["wrong-runner"], "x-orgops-deployment-attempt-token": claimBody.attemptToken },
      });
      expect(unauthorizedArtifact.status).toBe(403);
      const unauthorizedText = await unauthorizedArtifact.text();
      expect(unauthorizedText).not.toContain("security-artifact-bytes");
      const responses = await Promise.all([
        fixture.app.request("/api/catalog-sources/source-private", { headers: fixture.headers["ungranted-ordinary"] }),
        fixture.app.request("/api/catalog-releases/release-native", { headers: fixture.headers["ungranted-ordinary"] }),
        fixture.app.request("/api/library/packages", { headers: fixture.headers["ungranted-ordinary"] }),
        fixture.app.request("/api/library/packages/release-skill", { headers: fixture.headers["ungranted-ordinary"] }),
        fixture.app.request("/api/runners/runner-a/package-deployments", { headers: fixture.headers["global-runner"] }),
      ]);
      for (const response of responses) {
        const text = `${response.status}:${JSON.stringify(responseHeaderEntries(response.headers))}:${await response.text()}`;
        expect(fixture.canaries.some((canary: string) => text.includes(canary)), `${response.status}:${text}`).toBe(false);
        expect(text).not.toMatch(/SQLITE|SELECT .* FROM|Error:|security-artifact-bytes|security-transport-exception/i);
      }
      const audits = fixture.db.prepare("SELECT payload_json FROM events WHERE type LIKE 'audit.catalog.%'").all() as Array<{ payload_json: string }>;
      expect(audits.length).toBeGreaterThan(0);
      expect(JSON.stringify(audits)).not.toMatch(/credential-ref|ciphertext-security|security-password|security-secret-canary|security-command-canary|security-artifact-bytes/i);
    } finally { fixture.close(); }
  });

  it("redacts a thrown transport exception across sync HTTP, attempt, audit, and event projections", async () => {
    let transportFetchCalled = false;
    const transport: CatalogGitTransport = {
      async fetch() {
        transportFetchCalled = true;
        throw new Error("transport failure: security-transport-exception");
      },
      async resolveRef() { return { ok: false, issue: { code: "REF_MISSING" } }; },
      async updateRef() { return { ok: true, value: true }; },
      async deleteRef() { return { ok: true, value: true }; },
    };
    const fixture = await makeFixture({ catalogSyncTransport: transport });
    fixture.db.exec("DELETE FROM event_receipts; DELETE FROM events; DELETE FROM catalog_source_read_credentials WHERE source_id='source-private'");
    try {
      const response = await fixture.app.request("/api/catalog-sources/source-private/sync", {
        method: "POST", headers: { ...fixture.headers.admin, ...json }, body: JSON.stringify({ expectedRevision: 1 }),
      });
      expect(transportFetchCalled).toBe(true);
      expect(response.status).toBe(200);
      const body = await responseBody(response);
      expect(body).toMatchObject({ kind: "sync", syncAttempt: { state: "FAILED", failureCode: "SYNC_FAILED" } });
      expect(JSON.stringify(body)).not.toContain("security-transport-exception");
      const attempts = await fixture.app.request("/api/catalog-sources/source-private/sync-attempts", { headers: fixture.headers.admin });
      expect(attempts.status).toBe(200);
      const attemptsText = await attempts.text();
      expect(JSON.parse(attemptsText)[0]).toMatchObject({ state: "FAILED", failureCode: "SYNC_FAILED" });
      expect(attemptsText).not.toContain("security-transport-exception");
      const db = fixture.db as OrgOpsDb;
      const events = db.prepare<[], { id: string; type: string; payload_json: string; channel_id: string | null }>("SELECT id,type,payload_json,channel_id FROM events WHERE type LIKE 'audit.catalog.%'").all();
      expect(events).toHaveLength(1);
      for (const event of events) {
        const payload = JSON.parse(event.payload_json);
        expect(CatalogAuditEventSchema.safeParse({ type: event.type, source: "system", status: "DELIVERED", payload, channelId: null })).toMatchObject({ success: true });
        expect(event.channel_id).toBeNull();
        expect(payload).toMatchObject({ action: "source.sync", outcome: "FAILED", failureCode: "SYNC_FAILED" });
        expect(event.payload_json).not.toContain("security-transport-exception");
        expect(db.prepare<[string], { count: number }>("SELECT count(*) AS count FROM event_receipts WHERE event_id=?").get(event.id)).toEqual({ count: 0 });      }
    } finally { fixture.close(); }
  });

  it("stores and validates typed atomic audits without receipts, and rolls back on audit failure", async () => {
    const fixture = await makeFixture();
    fixture.db.exec("DELETE FROM event_receipts; DELETE FROM events");
    try {
      const response = await fixture.app.request("/api/catalog-sources/source-private", { method: "PATCH", headers: { ...fixture.headers.admin, ...json }, body: JSON.stringify({ expectedRevision: 1, displayName: "Audit-safe source" }) });
      expect(response.status).toBe(200);
      const db = fixture.db as OrgOpsDb;
      const audits = db.prepare<[], { type: string; payload_json: string; channel_id: string | null; id: string }>("SELECT id,type,payload_json,channel_id FROM events WHERE type LIKE 'audit.catalog.%'").all();      expect(audits.length).toBeGreaterThan(0);
      for (const audit of audits) {
        const payload = JSON.parse(audit.payload_json);
        const event = { type: audit.type, source: "system", status: "DELIVERED", payload, channelId: null } as CatalogAuditEvent;
        expect(CatalogAuditEventSchema.safeParse(event), JSON.stringify(event)).toMatchObject({ success: true });
        expect(validateEventAgainstShapes(event as unknown as Parameters<typeof validateEventAgainstShapes>[0], getCoreEventShapes()), JSON.stringify(event)).toMatchObject({ ok: true });
        expect(audit.channel_id).toBeNull();
        expect(db.prepare<[string], { count: number }>("SELECT count(*) AS count FROM event_receipts WHERE event_id=?").get(audit.id)).toEqual({ count: 0 });        expect(JSON.stringify(payload)).not.toMatch(/credential|password|ciphertext|security-workspace|security-command|security-artifact-bytes/i);
      }
    } finally { fixture.close(); }
    const failing = await makeFixture();
    failing.db.exec("DELETE FROM event_receipts; DELETE FROM events");
    try {
      failing.db.exec("CREATE TRIGGER security_audit_failure BEFORE INSERT ON events WHEN NEW.type LIKE 'audit.catalog.%' BEGIN SELECT RAISE(ABORT, 'security-transport-exception'); END");
      const response = await failing.app.request("/api/catalog-sources/source-private", { method: "PATCH", headers: { ...failing.headers.admin, ...json }, body: JSON.stringify({ expectedRevision: 1, displayName: "Should rollback" }) });
      expect(response.status).toBe(500);
      expect(await responseBody(response)).toEqual({ error: "Catalog library operation failed", code: "STORAGE_FAILURE" });
      expect(failing.db.prepare("SELECT revision,display_name FROM catalog_sources WHERE source_id='source-private'").get()).toEqual({ revision: 1, display_name: "Private security source" });
      expect(failing.db.prepare("SELECT count(*) AS count FROM events WHERE type LIKE 'audit.catalog.%'").get()).toEqual({ count: 0 });
      expect(failing.db.prepare("SELECT count(*) AS count FROM event_receipts").get()).toEqual({ count: 0 });
    } finally { failing.close(); }
  }, 120000);
});
