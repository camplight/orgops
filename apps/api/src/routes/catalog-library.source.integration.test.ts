import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { openDb, type OrgOpsDb } from "@orgops/db";
import type {
  AuthenticatedHuman,
  CatalogAuthorityCommand,
  CatalogAuthorityQuery,
  CatalogAuthorityQueryResult,
  CatalogAuthorityResult,
  HumanAdmin,
  SnapshotView,
  SourceView,
  SyncAttemptView,
} from "@orgops/schemas";
import { createApp } from "../app";
import { CatalogAuthorityError } from "../catalog-library/authority";

type Principal = "admin" | "human" | "runner-global" | "runner-scoped" | "anonymous";
type AuthorityFixture = {
  execute: Mock<(command: CatalogAuthorityCommand, actor: HumanAdmin) => Promise<CatalogAuthorityResult>>;
  query: Mock<(query: CatalogAuthorityQuery, actor: AuthenticatedHuman) => Promise<CatalogAuthorityQueryResult>>;
};

type MigratedTestApp = {
  app: ReturnType<typeof createApp>["app"];
  authority: AuthorityFixture;
  db: OrgOpsDb;
  headers: Record<string, string>;
  close(): void;
};

const source: SourceView = {
  sourceId: "source-team",
  displayName: "Team",
  canonicalUrl: "https://github.com/acme/catalog",
  repositoryIdentity: '["github","acme","catalog"]',
  ref: "main",
  enabled: true,
  allowPackages: false,
  revision: 1,
  removedAt: null,
  currentSnapshotId: "snapshot-good",
  hasReadCredential: true,
};
const syncAttempt: SyncAttemptView = {
  attemptId: "attempt-one",
  sourceId: "source-team",
  state: "SUCCEEDED",
  snapshotId: "snapshot-good",
  failureCode: null,
  revision: 2,
};
const snapshot: SnapshotView = {
  snapshotId: "snapshot-good",
  sourceId: "source-team",
  sourceCommit: "a".repeat(40),
  indexDigest: `sha256:${"b".repeat(64)}`,
  observedRef: "main",
  createdAt: 1,
};

function sourceBody() {
  return {
    sourceId: "source-new",
    displayName: "Team",
    repository: { url: "https://github.com/acme/catalog.git" },
    ref: "main",
    enabled: true,
    allowPackages: false,
  };
}

function authorityFixture(): AuthorityFixture {
  const execute = vi.fn(async (command: CatalogAuthorityCommand, _actor: HumanAdmin): Promise<CatalogAuthorityResult> =>
    command.kind === "source.sync"
      ? { kind: "sync", source, syncAttempt }
      : { kind: "source", source, ...(command.kind === "source.create" ? { syncAttempt } : {}) });
  const query = vi.fn(async (queryInput: CatalogAuthorityQuery, _actor: AuthenticatedHuman): Promise<CatalogAuthorityQueryResult> => {
    if (queryInput.kind === "source.detail") return source;
    if (queryInput.kind === "source.sync-attempts") return [syncAttempt];
    if (queryInput.kind === "source.snapshots") return [snapshot];
    return [source];
  });
  return { execute, query };
}

async function login(app: ReturnType<typeof createApp>["app"], username: string) {
  const response = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "test-password" }),
  });
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")?.match(/orgops_session=[^;]+/)?.[0];
  expect(cookie).toBeTruthy();
  return cookie!;
}

async function createMigratedTestApp({
  principal,
  catalogAuthority,
}: {
  principal: Principal;
  catalogAuthority: AuthorityFixture;
}): Promise<MigratedTestApp> {
  const dataDir = mkdtempSync(join(tmpdir(), "orgops-source-routes-"));
  const db = openDb(":memory:");
  const created = createApp({
    db,
    dataDir,
    adminUser: "owner",
    adminPass: "test-password",
    runnerToken: "test-global-runner-token",
  });
  vi.spyOn(created.catalogAuthority, "execute").mockImplementation(catalogAuthority.execute);
  vi.spyOn(created.catalogAuthority, "query").mockImplementation(catalogAuthority.query);

  const owner = db.prepare<[], { id: string }>("SELECT id FROM humans WHERE username='owner'").get()!;
  db.prepare(`INSERT INTO humans
    (id,username,password_hash,must_change_password,is_admin,created_at,updated_at)
    SELECT 'ordinary-human','ordinary',password_hash,0,0,1,1 FROM humans WHERE id=?`).run(owner.id);
  const adminCookie = await login(created.app, "owner");
  const ordinaryCookie = await login(created.app, "ordinary");

  const scopedToken = "org_rt_source_route_test";
  const scopedHash = createHash("sha256").update(scopedToken, "utf8").digest("hex");
  db.prepare(`INSERT INTO runner_tokens
    (id,name,token_hash,token_prefix,allowed_agent_name,allowed_runner_id,allowed_channel_ids_json,invite_id,created_by_human_id,created_at)
    VALUES ('source-route-token','Source route runner',?,?,NULL,NULL,'[]',NULL,?,1)`)
    .run(scopedHash, scopedToken.slice(0, 16), owner.id);

  const headers: Record<string, string> = principal === "admin"
    ? { cookie: adminCookie }
    : principal === "human"
      ? { cookie: ordinaryCookie }
      : principal === "runner-global"
        ? { cookie: adminCookie, "x-orgops-runner-token": "test-global-runner-token" }
        : principal === "runner-scoped"
          ? { cookie: adminCookie, "x-orgops-runner-token": scopedToken }
          : {};
  return {
    app: created.app,
    authority: catalogAuthority,
    db,
    headers,
    close() {
      db.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

async function sourceApp(principal: Principal) {
  return createMigratedTestApp({ principal, catalogAuthority: authorityFixture() });
}

const jsonHeaders = { "content-type": "application/json" };
type Capability = {
  name: string;
  method: string;
  path: string;
  body?: unknown;
  adminStatus: number;
};
const capabilities: readonly Capability[] = [
  { name: "create", method: "POST", path: "/api/catalog-sources", body: sourceBody(), adminStatus: 201 },
  { name: "patch", method: "PATCH", path: "/api/catalog-sources/source-team", body: { expectedRevision: 1, displayName: "Renamed" }, adminStatus: 200 },
  { name: "remove", method: "DELETE", path: "/api/catalog-sources/source-team", body: { expectedRevision: 1 }, adminStatus: 200 },
  { name: "restore", method: "POST", path: "/api/catalog-sources/source-team/restore", body: { expectedRevision: 1 }, adminStatus: 200 },
  { name: "credential put", method: "PUT", path: "/api/catalog-sources/source-team/read-credential", body: { expectedRevision: 1, kind: "https-basic", username: "reader", password: "credential-secret" }, adminStatus: 200 },
  { name: "credential delete", method: "DELETE", path: "/api/catalog-sources/source-team/read-credential", body: { expectedRevision: 1 }, adminStatus: 200 },
  { name: "sync", method: "POST", path: "/api/catalog-sources/source-team/sync", body: { expectedRevision: 1 }, adminStatus: 200 },
  { name: "attempts", method: "GET", path: "/api/catalog-sources/source-team/sync-attempts", adminStatus: 200 },
  { name: "snapshots", method: "GET", path: "/api/catalog-sources/source-team/snapshots", adminStatus: 200 },
  { name: "list", method: "GET", path: "/api/catalog-sources", adminStatus: 200 },
  { name: "detail", method: "GET", path: "/api/catalog-sources/source-team", adminStatus: 200 },
];

const opened: MigratedTestApp[] = [];
afterEach(() => {
  while (opened.length) opened.pop()!.close();
});

async function trackedSourceApp(principal: Principal) {
  const fixture = await sourceApp(principal);
  opened.push(fixture);
  return fixture;
}

async function requestCapability(fixture: MigratedTestApp, capability: Capability) {
  return fixture.app.request(capability.path, {
    method: capability.method,
    headers: { ...fixture.headers, ...(capability.body === undefined ? {} : jsonHeaders) },
    ...(capability.body === undefined ? {} : { body: JSON.stringify(capability.body) }),
  });
}

describe("Source Library HTTP routes", () => {
  it.each([
    ["admin", 200],
    ["human", 403],
    ["runner-global", 403],
    ["runner-scoped", 403],
    ["anonymous", 401],
  ] as const)("applies every Source-management capability to %s", async (principal, deniedOrReadStatus) => {
    const fixture = await trackedSourceApp(principal);
    for (const capability of capabilities) {
      const response = await requestCapability(fixture, capability);
      const expected = principal === "admin" ? capability.adminStatus : deniedOrReadStatus;
      expect.soft(response.status, capability.name).toBe(expected);
      expect.soft(response.headers.get("cache-control"), capability.name).toBe("no-store");
    }
    if (principal === "admin") {
      expect(fixture.authority.execute).toHaveBeenCalledTimes(7);
      expect(fixture.authority.query).toHaveBeenCalledTimes(4);
    } else {
      expect(fixture.authority.execute).not.toHaveBeenCalled();
      expect(fixture.authority.query).not.toHaveBeenCalled();
    }
  });

  it("translates canonical Source commands, fixed sync input, and authenticated actor identity", async () => {
    const fixture = await trackedSourceApp("admin");
    for (const capability of capabilities) await requestCapability(fixture, capability);

    expect(fixture.authority.execute.mock.calls.map(([command]) => command)).toEqual([
      { kind: "source.create", source: sourceBody() },
      { kind: "source.patch", sourceId: "source-team", patch: { expectedRevision: 1, displayName: "Renamed" } },
      { kind: "source.remove", sourceId: "source-team", expectedRevision: 1 },
      { kind: "source.restore", sourceId: "source-team", expectedRevision: 1 },
      { kind: "source.credential.put", sourceId: "source-team", expectedRevision: 1, username: "reader", password: "credential-secret" },
      { kind: "source.credential.delete", sourceId: "source-team", expectedRevision: 1 },
      { kind: "source.sync", sourceId: "source-team", expectedRevision: 1 },
    ]);
    expect(fixture.authority.query.mock.calls.map(([query]) => query)).toEqual([
      { kind: "source.sync-attempts", sourceId: "source-team" },
      { kind: "source.snapshots", sourceId: "source-team" },
      { kind: "source.list" },
      { kind: "source.detail", sourceId: "source-team" },
    ]);
    const expectedActorId = fixture.db.prepare<[], { id: string }>("SELECT id FROM humans WHERE username='owner'").get()!.id;
    for (const call of [...fixture.authority.execute.mock.calls, ...fixture.authority.query.mock.calls]) {
      expect(call[1]).toEqual({ kind: "HUMAN_ADMIN", id: expectedActorId });
    }
  });

  it("exposes attempts and last-good snapshots without repository credentials", async () => {
    const fixture = await trackedSourceApp("admin");
    for (const path of [
      "/api/catalog-sources",
      "/api/catalog-sources/source-team",
      "/api/catalog-sources/source-team/sync-attempts",
      "/api/catalog-sources/source-team/snapshots",
    ]) {
      const response = await fixture.app.request(path, { headers: fixture.headers });
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain(path.endsWith("snapshots") ? "snapshot-good" : "source-team");
      expect(text).not.toMatch(/ciphertext|credentialRef|credential-secret|repository\s*:/i);
    }
  });

  it("rejects unknown fields, malformed JSON, invalid UTF-8, wrong content type, forged actor fields, and invalid source IDs before authority work", async () => {
    const fixture = await trackedSourceApp("admin");
    const invalidRequests: Array<{ path?: string; method?: string; headers?: Record<string, string>; body: BodyInit }> = [
      { body: JSON.stringify({ ...sourceBody(), extra: true }), headers: jsonHeaders },
      { body: "{", headers: jsonHeaders },
      { body: new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xff, 0x7d]), headers: jsonHeaders },
      { body: JSON.stringify(sourceBody()), headers: { "content-type": "text/plain" } },
      { body: JSON.stringify({ ...sourceBody(), actor: { kind: "HUMAN_ADMIN", id: "forged" }, admin: true }), headers: jsonHeaders },
      { path: "/api/catalog-sources/INVALID!", method: "PATCH", body: JSON.stringify({ expectedRevision: 1, enabled: false }), headers: jsonHeaders },
      { path: "/api/catalog-sources/source-team/sync", body: JSON.stringify({ expectedRevision: 1, indexPath: "other/index.json" }), headers: jsonHeaders },
    ];
    for (const invalid of invalidRequests) {
      const response = await fixture.app.request(invalid.path ?? "/api/catalog-sources", {
        method: invalid.method ?? "POST",
        headers: { ...fixture.headers, ...invalid.headers },
        body: invalid.body,
      });
      expect.soft(response.status).toBe(400);
      expect.soft(await response.json()).toEqual({ error: "Invalid catalog library request", code: "INVALID_REQUEST" });
      expect.soft(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(fixture.authority.execute).not.toHaveBeenCalled();
    expect(fixture.authority.query).not.toHaveBeenCalled();
  });

  it("counts an actual streamed request body and rejects the byte crossing 16 KiB before authority work", async () => {
    const fixture = await trackedSourceApp("admin");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8192).fill(0x20));
        controller.enqueue(new Uint8Array(8192).fill(0x20));
        controller.enqueue(new Uint8Array([0x20]));
        controller.close();
      },
    });
    const request = new Request("http://localhost/api/catalog-sources", {
      method: "POST",
      headers: { ...fixture.headers, ...jsonHeaders },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const response = await fixture.app.fetch(request);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Catalog library request too large", code: "PAYLOAD_TOO_LARGE" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fixture.authority.execute).not.toHaveBeenCalled();
  });

  it("returns PAYLOAD_TOO_LARGE when cancelling an oversized stream rejects", async () => {
    const fixture = await trackedSourceApp("admin");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8192).fill(0x20));
        controller.enqueue(new Uint8Array(8192).fill(0x20));
        controller.enqueue(new Uint8Array([0x20]));
      },
      cancel() {
        return Promise.reject(new Error("cancel failed"));
      },
    });
    const request = new Request("http://localhost/api/catalog-sources", {
      method: "POST",
      headers: { ...fixture.headers, ...jsonHeaders },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const response = await fixture.app.fetch(request);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Catalog library request too large", code: "PAYLOAD_TOO_LARGE" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fixture.authority.execute).not.toHaveBeenCalled();
    expect(fixture.authority.query).not.toHaveBeenCalled();
  });

  it("authenticates and authorizes before reading request bodies", async () => {
    for (const [principal, status] of [["anonymous", 401], ["human", 403], ["runner-global", 403], ["runner-scoped", 403]] as const) {
      const fixture = await trackedSourceApp(principal);
      const response = await fixture.app.request("/api/catalog-sources", {
        method: "POST",
        headers: { ...fixture.headers, ...jsonHeaders },
        body: "{",
      });
      expect.soft(response.status, principal).toBe(status);
      expect.soft(response.headers.get("cache-control"), principal).toBe("no-store");
      expect(fixture.authority.execute).not.toHaveBeenCalled();
    }
  });

  it("uses a fresh live administrator check for reads and mutations", async () => {
    const fixture = await trackedSourceApp("admin");
    fixture.db.prepare("UPDATE humans SET is_admin=0 WHERE username='owner'").run();
    for (const capability of [capabilities[0], capabilities[9]]) {
      const response = await requestCapability(fixture, capability);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Administrator access required" });
    }
    expect(fixture.authority.execute).not.toHaveBeenCalled();
    expect(fixture.authority.query).not.toHaveBeenCalled();
  });

  it.each([
    ["REVISION_CONFLICT", 409, "Catalog library changed; reload metadata"],
    ["NOT_FOUND", 404, "Catalog library resource not found"],
    ["OPERATION_IN_PROGRESS", 409, "Catalog operation is already in progress"],
    ["IDENTITY_CONFLICT", 409, "Catalog release identity already reserved"],
    ["SOURCE_NOT_ALLOWED", 403, "Package source is not enabled for this operation"],
    ["STORAGE_FAILURE", 500, "Catalog library operation failed"],
  ] as const)("maps %s to a fixed safe envelope", async (code, status, message) => {
    const fixture = await trackedSourceApp("admin");
    fixture.authority.execute.mockRejectedValueOnce(new CatalogAuthorityError(code));
    const response = await requestCapability(fixture, capabilities[6]);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: message, code });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("maps unexpected authority failures to a fixed internal-safe storage error", async () => {
    const fixture = await trackedSourceApp("admin");
    fixture.authority.query.mockRejectedValueOnce(new Error("SQL contained credential-secret and /host/path"));
    const response = await fixture.app.request("/api/catalog-sources", { headers: fixture.headers });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Catalog library operation failed", code: "STORAGE_FAILURE" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("retains consumed catalog evidence when real authenticated Source removal tombstones the Source", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-source-retention-"));
    const db = openDb(":memory:");
    try {
      const { app } = createApp({ db, dataDir, adminUser: "admin", adminPass: "test-password" });
      const loginResponse = await app.request("/api/auth/login", {
        method: "POST", headers: jsonHeaders, body: JSON.stringify({ username: "admin", password: "test-password" }),
      });
      expect(loginResponse.status).toBe(200);
      const cookie = loginResponse.headers.get("set-cookie")?.match(/orgops_session=[^;]+/)?.[0];
      expect(cookie).toBeTruthy();
      if (!cookie) throw new Error("Admin login did not return a session cookie");
      const adminId = db.prepare<[], { id: string }>("SELECT id FROM humans WHERE username='admin'").get()!.id;
      const digest = `sha256:${"a".repeat(64)}`;
      const catalogCommit = "b".repeat(40), packageCommit = "c".repeat(40), artifactPath = "/tmp/orgops-retained-artifact";
      db.prepare(`INSERT INTO catalog_sources
        (source_id,display_name,canonical_url,repository_identity,ref,enabled,allow_packages,revision,removed_at,current_snapshot_id,created_at,updated_at)
        VALUES ('source-retain','Retain','https://github.com/acme/retain.git','["github","acme","retain"]','main',1,1,1,NULL,NULL,1,1)`).run();
      db.prepare(`INSERT INTO catalog_source_read_credentials
        (source_id,credential_ref,kind,ciphertext_b64,legacy_binding_source_id,legacy_credential_ref,revision,created_at,updated_at)
        VALUES ('source-retain','credential-retain','https-basic','ciphertext',NULL,NULL,1,1,1)`).run();
      db.prepare(`INSERT INTO catalog_sync_attempts
        (attempt_id,source_id,source_revision,state,resolved_commit,snapshot_id,failure_code,actor_human_id,revision,created_at,updated_at,completed_at)
        VALUES ('attempt-retain','source-retain',1,'SUCCEEDED',?,NULL,NULL,?,2,1,1,1)`).run(catalogCommit, adminId);
      db.prepare(`INSERT INTO catalog_snapshots
        (snapshot_id,source_id,source_commit,index_digest,index_json,observed_ref,attempt_id,created_at)
        VALUES ('snapshot-retain','source-retain',?,'sha256:${"d".repeat(64)}','{}','main','attempt-retain',1)`).run(catalogCommit);
      db.prepare("UPDATE catalog_sync_attempts SET snapshot_id='snapshot-retain' WHERE attempt_id='attempt-retain'").run();
      db.prepare("UPDATE catalog_sources SET current_snapshot_id='snapshot-retain' WHERE source_id='source-retain'").run();
      db.prepare(`INSERT INTO catalog_package_releases
        (package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,manifest_json,execution_preview_json,warnings_json,created_at)
        VALUES ('release-retain','source-retain','source-retain','skill','retained-skill','1.0.0',?,?,?,'skills/retained-skill','{}','[]','[]',1)`).run(digest, catalogCommit, packageCommit);
      db.prepare("INSERT INTO catalog_snapshot_entries (snapshot_id,package_release_id,ordinal) VALUES ('snapshot-retain','release-retain',0)").run();
      db.prepare(`INSERT INTO catalog_release_controls
        (package_release_id,review_state,review_digest,revision,created_at,updated_at)
        VALUES ('release-retain','PENDING',NULL,1,1,1)`).run();
      db.prepare(`INSERT INTO catalog_installations
        (release_id,artifact_digest,artifact_path,state,installed_by_human_id,installed_at,last_verified_at,revision)
        VALUES ('release-retain',?,?, 'INSTALLED',?,1,1,1)`).run(digest, artifactPath, adminId);
      db.prepare(`INSERT INTO catalog_installed_origins
        (name,catalog_id,source_id,catalog_commit,package_commit,path,kind,version,digest,local_path,installed_by_human_id,installed_at)
        VALUES ('retained-skill','source-retain','source-retain',?,?, 'skills/retained-skill','skill','1.0.0',?,?,?,1)`).run(catalogCommit, packageCommit, digest, artifactPath, adminId);
      db.prepare(`INSERT INTO agents
        (id,name,model_id,soul_path,workspace_path,owner_human_id,created_at,updated_at)
        VALUES ('agent-retain','retained-agent','openai:test','/tmp/retained-soul','/tmp/retained-workspace',?,1,1)`).run(adminId);
      db.prepare(`INSERT INTO catalog_grants
        (grant_id,release_id,subject_type,human_id,revision,revoked_at,created_by_human_id,created_at,updated_at)
        VALUES ('grant-retain','release-retain','HUMAN',?,1,NULL,?,1,1)`).run(adminId, adminId);
      db.prepare(`INSERT INTO agent_skill_assignments
        (assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,preload,effective_preload,active_generation,desired_generation,revision,actor_kind,actor_human_id,grant_id,created_at,updated_at)
        VALUES ('assignment-retain','agent-retain','release-retain','retained-skill','ENABLED','ENABLED','STABLE',0,0,'generation-retain','generation-retain',1,'GRANT',?,'grant-retain',1,1)`).run(adminId);

      const response = await app.request("/api/catalog-sources/source-retain", {
        method: "DELETE", headers: { ...jsonHeaders, cookie }, body: JSON.stringify({ expectedRevision: 1 }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ source: { sourceId: "source-retain", revision: 2, enabled: false, allowPackages: false } });
      expect(db.prepare("SELECT source_id,removed_at,enabled,allow_packages,revision FROM catalog_sources WHERE source_id='source-retain'").get()).toMatchObject({
        source_id: "source-retain", enabled: 0, allow_packages: 0, revision: 2,
      });
      expect(db.prepare("SELECT snapshot_id,source_id,source_commit,index_json FROM catalog_snapshots WHERE snapshot_id='snapshot-retain'").get()).toEqual({
        snapshot_id: "snapshot-retain", source_id: "source-retain", source_commit: catalogCommit, index_json: "{}",
      });
      expect(db.prepare("SELECT package_release_id,authority_source_id,content_source_id,manifest_json FROM catalog_package_releases WHERE package_release_id='release-retain'").get()).toEqual({
        package_release_id: "release-retain", authority_source_id: "source-retain", content_source_id: "source-retain", manifest_json: "{}",
      });
      expect(db.prepare("SELECT snapshot_id,package_release_id,ordinal FROM catalog_snapshot_entries WHERE snapshot_id='snapshot-retain'").get()).toEqual({ snapshot_id: "snapshot-retain", package_release_id: "release-retain", ordinal: 0 });
      expect(db.prepare("SELECT release_id,artifact_digest,artifact_path,state,installed_by_human_id FROM catalog_installations WHERE release_id='release-retain'").get()).toEqual({
        release_id: "release-retain", artifact_digest: digest, artifact_path: artifactPath, state: "INSTALLED", installed_by_human_id: adminId,
      });
      expect(db.prepare("SELECT name,catalog_id,source_id,catalog_commit,package_commit,path,kind,version,digest,local_path,installed_by_human_id FROM catalog_installed_origins WHERE name='retained-skill'").get()).toEqual({
        name: "retained-skill", catalog_id: "source-retain", source_id: "source-retain", catalog_commit: catalogCommit, package_commit: packageCommit,
        path: "skills/retained-skill", kind: "skill", version: "1.0.0", digest, local_path: artifactPath, installed_by_human_id: adminId,
      });
      expect(db.prepare("SELECT id,name FROM agents WHERE id='agent-retain'").get()).toEqual({ id: "agent-retain", name: "retained-agent" });
      expect(db.prepare("SELECT assignment_id,agent_id,release_id,grant_id FROM agent_skill_assignments WHERE assignment_id='assignment-retain'").get()).toEqual({
        assignment_id: "assignment-retain", agent_id: "agent-retain", release_id: "release-retain", grant_id: "grant-retain",
      });
      expect(db.prepare("SELECT grant_id,release_id,subject_type,human_id,revoked_at FROM catalog_grants WHERE grant_id='grant-retain'").get()).toEqual({
        grant_id: "grant-retain", release_id: "release-retain", subject_type: "HUMAN", human_id: adminId, revoked_at: null,
      });
      expect(db.prepare("SELECT source_id FROM catalog_source_read_credentials WHERE source_id='source-retain'").get()).toBeUndefined();
    } finally {
      db.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("keeps the retired Catalog namespace at framework-default 404 without legacy archive tables", async () => {
    const fixture = await trackedSourceApp("anonymous");
    fixture.db.exec(`DROP TABLE catalog_read_credentials_legacy_032;
      DROP TABLE catalogs_legacy_032;
      DROP TABLE catalog_sources_legacy_032;`);
    for (const path of ["/api/catalogs", "/api/catalogs/legacy", "/api/catalogs/legacy/sync"]) {
      const response = await fixture.app.request(path, { method: "POST" });
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).not.toBe("no-store");
      expect(await response.text()).not.toContain("CATALOG_RESOURCE_RETIRED");
    }
  });
});
