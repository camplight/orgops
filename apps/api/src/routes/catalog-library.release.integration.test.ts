import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type OrgOpsDb } from "@orgops/db";
import { createApp } from "../app";

const releaseDigest = `sha256:${"a".repeat(64)}`;
const fileDigest = `sha256:${"b".repeat(64)}`;
const reviewDigest = `sha256:${"c".repeat(64)}`;
const otherDigest = `sha256:${"d".repeat(64)}`;
const commit = "a".repeat(40);
const generatedReleaseId = `release-${"e".repeat(64)}`;
const manifest = {
  formatVersion: 1,
  kind: "skill",
  name: "demo-skill",
  version: "1.0.0",
  description: "Route review fixture.",
  author: "OrgOps",
  license: "MIT",
  compatibility: { orgops: { min: "0.0.1" }, platforms: ["linux"], tools: [] },
  secrets: [],
  dependencies: [],
  files: [{ path: "SKILL.md", size: 12, digest: fileDigest, executable: false }],
  executables: [],
  digest: releaseDigest,
  skill: { entrypoint: "SKILL.md" },
};
const executionPreview = { apiEventShapes: ["event-shapes.ts"], runnerScripts: [], wrappedCommands: [], externalSources: [] };
const warnings = [{ code: "MANUAL_REVIEW_REQUIRED", at: "event-shapes.ts" }];

type Principal = "admin" | "human" | "runner-global" | "runner-scoped" | "anonymous";
type ReviewState = "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";
type ReleaseApp = {
  app: ReturnType<typeof createApp>["app"];
  db: OrgOpsDb;
  headers: Record<string, string>;
  ownerId: string;
  close(): void;
};

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

async function makeReleaseApp(
  principal: Principal,
  state: ReviewState = "PENDING",
  packageReleaseId = "release-skill",
): Promise<ReleaseApp> {
  const dataDir = mkdtempSync(join(tmpdir(), "orgops-release-routes-"));
  const db = openDb(":memory:");
  const created = createApp({
    db,
    dataDir,
    adminUser: "owner",
    adminPass: "test-password",
    runnerToken: "test-global-runner-token",
  });
  const ownerId = db.prepare<[], { id: string }>("SELECT id FROM humans WHERE username='owner'").get()!.id;
  db.prepare(`INSERT INTO humans
    (id,username,password_hash,must_change_password,is_admin,created_at,updated_at)
    SELECT 'ordinary-human','ordinary',password_hash,0,0,1,1 FROM humans WHERE id=?`).run(ownerId);
  db.prepare(`INSERT INTO catalog_sources
    (source_id,display_name,canonical_url,repository_identity,ref,enabled,allow_packages,revision,created_at,updated_at)
    VALUES ('source-team','Team','https://github.com/example/team',?,'main',1,0,1,1,1)`)
    .run(JSON.stringify(["github", "example", "team"]));
  db.prepare(`INSERT INTO catalog_package_releases
    (package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,
     manifest_json,execution_preview_json,warnings_json,created_at)
    VALUES (?,'source-team','source-team','skill','demo-skill','1.0.0',?,?,?,?,?,?,?,1)`)
    .run(packageReleaseId, releaseDigest, commit, commit, "skills/demo-skill", JSON.stringify(manifest), JSON.stringify(executionPreview), JSON.stringify(warnings));
  db.prepare(`INSERT INTO catalog_release_controls
    (package_release_id,review_state,review_digest,reviewed_by_human_id,reviewed_at,revision,created_at,updated_at)
    VALUES (?,?,?,?, ?,1,1,1)`)
    .run(packageReleaseId, state, state === "PENDING" ? null : reviewDigest, state === "PENDING" ? null : ownerId, state === "PENDING" ? null : 1);

  const adminCookie = await login(created.app, "owner");
  const ordinaryCookie = await login(created.app, "ordinary");
  const scopedToken = "org_rt_release_route_test";
  const scopedHash = createHash("sha256").update(scopedToken, "utf8").digest("hex");
  db.prepare(`INSERT INTO runner_tokens
    (id,name,token_hash,token_prefix,allowed_agent_name,allowed_runner_id,allowed_channel_ids_json,invite_id,created_by_human_id,created_at)
    VALUES ('release-route-token','Release route runner',?,?,NULL,NULL,'[]',NULL,?,1)`)
    .run(scopedHash, scopedToken.slice(0, 16), ownerId);
  const headers: Record<string, string> = principal === "admin"
    ? { cookie: adminCookie }
    : principal === "human"
      ? { cookie: ordinaryCookie }
      : principal === "runner-global"
        ? { cookie: adminCookie, "x-orgops-runner-token": "test-global-runner-token" }
        : principal === "runner-scoped"
          ? { cookie: adminCookie, "x-orgops-runner-token": scopedToken }
          : {};
  return { app: created.app, db, headers, ownerId, close() { db.close(); rmSync(dataDir, { recursive: true, force: true }); } };
}

const opened: ReleaseApp[] = [];
afterEach(() => {
  while (opened.length) opened.pop()!.close();
});
async function releaseApp(principal: Principal, state?: ReviewState, packageReleaseId?: string) {
  const fixture = await makeReleaseApp(principal, state, packageReleaseId);
  opened.push(fixture);
  return fixture;
}

function reviewBody(overrides: Record<string, unknown> = {}) {
  return { expectedRevision: 1, digest: releaseDigest, reviewDigest, ...overrides };
}
const jsonHeaders = { "content-type": "application/json" };

type Capability = { name: string; method: "GET" | "POST"; path: string; state: ReviewState; body?: unknown };
const capabilities: readonly Capability[] = [
  { name: "list", method: "GET", path: "/api/catalog-releases", state: "PENDING" },
  { name: "detail", method: "GET", path: "/api/catalog-releases/release-skill", state: "PENDING" },
  { name: "approve", method: "POST", path: "/api/catalog-releases/release-skill/approve", state: "PENDING", body: reviewBody() },
  { name: "reject", method: "POST", path: "/api/catalog-releases/release-skill/reject", state: "PENDING", body: reviewBody() },
  { name: "withdraw", method: "POST", path: "/api/catalog-releases/release-skill/withdraw", state: "APPROVED", body: reviewBody() },
  { name: "reopen", method: "POST", path: "/api/catalog-releases/release-skill/reopen", state: "REJECTED", body: reviewBody() },
];

async function request(fixture: ReleaseApp, capability: Capability) {
  return fixture.app.request(capability.path, {
    method: capability.method,
    headers: { ...fixture.headers, ...(capability.body === undefined ? {} : jsonHeaders) },
    ...(capability.body === undefined ? {} : { body: JSON.stringify(capability.body) }),
  });
}

describe("administrator release routes", () => {
  it("accepts an actual generated release ID for detail and review while rejecting malformed IDs", async () => {
    const fixture = await releaseApp("admin", "PENDING", generatedReleaseId);
    const detail = await fixture.app.request(`/api/catalog-releases/${generatedReleaseId}`, { headers: fixture.headers });
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ packageReleaseId: generatedReleaseId, reviewState: "PENDING", revision: 1 });

    const reviewed = await fixture.app.request(`/api/catalog-releases/${generatedReleaseId}/approve`, {
      method: "POST",
      headers: { ...fixture.headers, ...jsonHeaders },
      body: JSON.stringify(reviewBody()),
    });
    expect(reviewed.status).toBe(200);
    expect(await reviewed.json()).toMatchObject({
      kind: "review",
      release: { packageReleaseId: generatedReleaseId, reviewState: "APPROVED", revision: 2 },
    });

    const malformed = await fixture.app.request(`/api/catalog-releases/release-${"f".repeat(193)}`, { headers: fixture.headers });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: "Invalid catalog library request", code: "INVALID_REQUEST" });
  });

  it.each(["admin", "human", "runner-global", "runner-scoped", "anonymous"] as const)(
    "applies the complete release capability matrix to %s",
    async principal => {
      for (const capability of capabilities) {
        const fixture = await releaseApp(principal, capability.state);
        const response = await request(fixture, capability);
        expect.soft(response.status, capability.name).toBe(principal === "admin" ? 200 : principal === "anonymous" ? 401 : 403);
        expect.soft(response.headers.get("cache-control"), capability.name).toBe("no-store");
      }
    },
  );

  it("returns complete immutable release list/detail projections without bytes, credentials, authorization, or executable content", async () => {
    const fixture = await releaseApp("admin");
    for (const path of ["/api/catalog-releases", "/api/catalog-releases/release-skill"]) {
      const response = await fixture.app.request(path, { headers: fixture.headers });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const payload = await response.json();
      const detail = Array.isArray(payload) ? payload[0] : payload;
      expect(detail).toEqual({
        packageReleaseId: "release-skill", authoritySourceId: "source-team", contentSourceId: "source-team",
        kind: "skill", name: "demo-skill", version: "1.0.0", digest: releaseDigest,
        catalogCommit: commit, packageCommit: commit, packagePath: "skills/demo-skill", manifest,
        executionPreview, warnings, files: [{ path: "SKILL.md", mode: 0o644, size: 12, digest: fileDigest }],
        reviewState: "PENDING", reviewDigest: null, reviewer: null, installationState: "ABSENT",
        apiActivation: { approvalState: "AWAITING_APPROVAL", runtimeState: "INACTIVE", revision: 1, failureCode: null }, revision: 1,
      });
      expect(JSON.stringify(payload)).not.toMatch(/base64|ciphertext|credential|authorization|repository|throw new Error/i);
    }
  });

  it("maps each action route to its canonical command and derives the authenticated reviewer", async () => {
    const cases = [
      ["approve", "APPROVED", "APPROVE"], ["reject", "REJECTED", "REJECT"],
      ["withdraw", "WITHDRAWN", "WITHDRAW"], ["reopen", "PENDING", "REOPEN"],
    ] as const;
    for (const [pathAction, expectedState, auditAction] of cases) {
      const initial: ReviewState = pathAction === "withdraw" ? "APPROVED" : pathAction === "reopen" ? "REJECTED" : "PENDING";
      const fixture = await releaseApp("admin", initial);
      const response = await fixture.app.request(`/api/catalog-releases/release-skill/${pathAction}`, {
        method: "POST", headers: { ...fixture.headers, ...jsonHeaders }, body: JSON.stringify(reviewBody()),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ kind: "review", release: { reviewState: expectedState, revision: 2 } });
      const control = fixture.db.prepare("SELECT reviewed_by_human_id,review_state,revision FROM catalog_release_controls").get();
      expect(control).toEqual({ reviewed_by_human_id: expectedState === "PENDING" ? null : fixture.ownerId, review_state: expectedState, revision: 2 });
      const audit = fixture.db.prepare("SELECT payload_json FROM events WHERE type='audit.catalog.release.reviewed'").get() as { payload_json: string };
      expect(JSON.parse(audit.payload_json)).toMatchObject({ actorKind: "HUMAN_ADMIN", actorId: fixture.ownerId, action: auditAction, releaseId: "release-skill" });
    }
  });

  it("authenticates and authorizes before reading review bodies", async () => {
    for (const [principal, status] of [["anonymous", 401], ["human", 403], ["runner-global", 403], ["runner-scoped", 403]] as const) {
      const fixture = await releaseApp(principal);
      const response = await fixture.app.request("/api/catalog-releases/release-skill/approve", {
        method: "POST", headers: { ...fixture.headers, ...jsonHeaders }, body: "{",
      });
      expect.soft(response.status, principal).toBe(status);
      expect.soft(response.headers.get("cache-control"), principal).toBe("no-store");
      expect(fixture.db.prepare("SELECT review_state FROM catalog_release_controls").get()).toEqual({ review_state: "PENDING" });
    }
  });

  it("uses a fresh live administrator check for release reads and mutations", async () => {
    for (const capability of [capabilities[0], capabilities[2]]) {
      const fixture = await releaseApp("admin", capability.state);
      fixture.db.prepare("UPDATE humans SET is_admin=0 WHERE id=?").run(fixture.ownerId);
      const response = await request(fixture, capability);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Administrator access required" });
    }
  });

  it("rejects strict-body violations, canonical ID violations, and the actual streamed byte over 16 KiB before mutation", async () => {
    const invalidBodies: BodyInit[] = [
      JSON.stringify(reviewBody({ extra: true })),
      JSON.stringify(reviewBody({ actor: { kind: "HUMAN_ADMIN", id: "forged" } })),
      "{",
      new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xff, 0x7d]),
    ];
    for (const body of invalidBodies) {
      const fixture = await releaseApp("admin");
      const response = await fixture.app.request("/api/catalog-releases/release-skill/approve", {
        method: "POST", headers: { ...fixture.headers, ...jsonHeaders }, body,
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid catalog library request", code: "INVALID_REQUEST" });
    }
    for (const requestInit of [
      { headers: { "content-type": "text/plain" }, body: JSON.stringify(reviewBody()) },
      { headers: jsonHeaders },
    ]) {
      const fixture = await releaseApp("admin");
      const response = await fixture.app.request("/api/catalog-releases/release-skill/approve", {
        method: "POST", headers: { ...fixture.headers, ...requestInit.headers }, ...("body" in requestInit ? { body: requestInit.body } : {}),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid catalog library request", code: "INVALID_REQUEST" });
    }

    const invalidId = await releaseApp("admin");
    const invalidIdResponse = await invalidId.app.request("/api/catalog-releases/INVALID!/approve", {
      method: "POST", headers: { ...invalidId.headers, ...jsonHeaders }, body: JSON.stringify(reviewBody()),
    });
    expect(invalidIdResponse.status).toBe(400);

    const oversized = await releaseApp("admin");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8192).fill(0x20));
        controller.enqueue(new Uint8Array(8192).fill(0x20));
        controller.enqueue(new Uint8Array([0x20]));
        controller.close();
      },
    });
    const streamed = await oversized.app.fetch(new Request("http://localhost/api/catalog-releases/release-skill/approve", {
      method: "POST", headers: { ...oversized.headers, ...jsonHeaders }, body: stream, duplex: "half",
    } as RequestInit & { duplex: "half" }));
    expect(streamed.status).toBe(413);
    expect(await streamed.json()).toEqual({ error: "Catalog library request too large", code: "PAYLOAD_TOO_LARGE" });
    expect(oversized.db.prepare("SELECT review_state FROM catalog_release_controls").get()).toEqual({ review_state: "PENDING" });
  });

  it.each([
    ["stale revision", reviewBody({ expectedRevision: 2 }), "REVISION_CONFLICT", "Catalog library changed; reload metadata"],
    ["release digest mismatch", reviewBody({ digest: otherDigest }), "REVISION_CONFLICT", "Catalog library changed; reload metadata"],
  ] as const)("returns a fixed safe envelope for %s", async (_name, body, code, message) => {
    const fixture = await releaseApp("admin");
    const response = await fixture.app.request("/api/catalog-releases/release-skill/approve", {
      method: "POST", headers: { ...fixture.headers, ...jsonHeaders }, body: JSON.stringify(body),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: message, code });
  });

  it("distinguishes review-digest mismatch, transition conflict, and missing release without leaking internals", async () => {
    const approved = await releaseApp("admin", "APPROVED");
    const digestMismatch = await approved.app.request("/api/catalog-releases/release-skill/withdraw", {
      method: "POST", headers: { ...approved.headers, ...jsonHeaders }, body: JSON.stringify(reviewBody({ reviewDigest: otherDigest })),
    });
    expect(digestMismatch.status).toBe(409);
    expect(await digestMismatch.json()).toEqual({ error: "Catalog library changed; reload metadata", code: "REVISION_CONFLICT" });

    const pending = await releaseApp("admin");
    const invalidTransition = await pending.app.request("/api/catalog-releases/release-skill/withdraw", {
      method: "POST", headers: { ...pending.headers, ...jsonHeaders }, body: JSON.stringify(reviewBody()),
    });
    expect(invalidTransition.status).toBe(409);
    expect(await invalidTransition.json()).toEqual({ error: "Catalog library operation conflicts with current state", code: "STATE_CONFLICT" });

    const missing = await releaseApp("admin");
    const notFound = await missing.app.request("/api/catalog-releases/release-missing", { headers: missing.headers });
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toEqual({ error: "Catalog library resource not found", code: "NOT_FOUND" });

    const corrupted = await releaseApp("admin");
    corrupted.db.prepare("DELETE FROM catalog_release_controls WHERE package_release_id='release-skill'").run();
    const storageFailure = await corrupted.app.request("/api/catalog-releases/release-skill", { headers: corrupted.headers });
    expect(storageFailure.status).toBe(500);
    expect(await storageFailure.json()).toEqual({ error: "Catalog library operation failed", code: "STORAGE_FAILURE" });
  });

  it("gives specific release-review action routes deterministic precedence", async () => {
    const fixture = await releaseApp("admin");
    const action = await fixture.app.request("/api/catalog-releases/release-skill/approve", {
      method: "POST", headers: { ...fixture.headers, ...jsonHeaders }, body: JSON.stringify(reviewBody()),
    });
    expect(action.status).toBe(200);
  });
});
