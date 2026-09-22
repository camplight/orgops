import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type OrgOpsDb } from "@orgops/db";
import { approvedRelease } from "./test-fixtures";
import { createApp } from "../app";

type Principal = "admin" | "human" | "runner-global" | "runner-scoped" | "anonymous";
type GrantApp = {
  app: ReturnType<typeof createApp>["app"];
  db: OrgOpsDb;
  headers: Record<string, string>;
  adminHeaders: Record<string, string>;
  ownerId: string;
  close(): void;
};

async function login(app: ReturnType<typeof createApp>["app"], username: string) {
  const response = await app.request("/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "test-password" }),
  });
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")!.match(/orgops_session=[^;]+/)![0];
}

async function makeGrantApp(principal: Principal): Promise<GrantApp> {
  const dataDir = mkdtempSync(join(tmpdir(), "orgops-grant-routes-"));
  const db = openDb(":memory:");
  const created = createApp({ db, dataDir, adminUser: "owner", adminPass: "test-password", runnerToken: "global-runner-token" });
  const ownerId = db.prepare<[], { id: string }>("SELECT id FROM humans WHERE username='owner'").get()!.id;
  db.prepare(`INSERT INTO humans
    (id,username,password_hash,must_change_password,is_admin,created_at,updated_at)
    SELECT 'human-selected','selected',password_hash,0,0,1,1 FROM humans WHERE id=?`).run(ownerId);
  const release = approvedRelease();
  db.prepare(`INSERT INTO catalog_sources
    (source_id,display_name,canonical_url,repository_identity,ref,enabled,allow_packages,revision,created_at,updated_at)
    VALUES ('source-team','Team','https://github.com/example/team',?,'main',1,0,1,1,1)`)
    .run(JSON.stringify(["github", "example", "team"]));
  db.prepare(`INSERT INTO catalog_package_releases
    (package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,
     manifest_json,execution_preview_json,warnings_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)`)
    .run(release.packageReleaseId, release.authoritySourceId, release.contentSourceId, release.kind, release.name, release.version,
      release.digest, release.catalogCommit, release.packageCommit, release.packagePath, JSON.stringify(release.manifest),
      JSON.stringify(release.executionPreview), JSON.stringify(release.warnings));
  db.prepare(`INSERT INTO catalog_release_controls
    (package_release_id,review_state,review_digest,reviewed_by_human_id,reviewed_at,revision,created_at,updated_at)
    VALUES (?,'APPROVED',?,?,1,1,1,1)`).run(release.packageReleaseId, release.digest, ownerId);
  db.prepare(`INSERT INTO catalog_installations
    (release_id,artifact_digest,artifact_path,state,installed_by_human_id,installed_at,last_verified_at,revision)
    VALUES (?,?,?,'INSTALLED',?,1,1,1)`)
    .run(release.packageReleaseId, release.digest, join(dataDir, "private-artifact"), ownerId);

  const adminCookie = await login(created.app, "owner");
  const humanCookie = await login(created.app, "selected");
  const scopedToken = "org_rt_grant_route_test";
  db.prepare(`INSERT INTO runner_tokens
    (id,name,token_hash,token_prefix,allowed_agent_name,allowed_runner_id,allowed_channel_ids_json,invite_id,created_by_human_id,created_at)
    VALUES ('grant-route-token','Grant runner',?,?,NULL,NULL,'[]',NULL,?,1)`)
    .run(createHash("sha256").update(scopedToken).digest("hex"), scopedToken.slice(0, 16), ownerId);
  const headers: Record<string, string> = principal === "admin" ? { cookie: adminCookie }
    : principal === "human" ? { cookie: humanCookie }
      : principal === "runner-global" ? { cookie: adminCookie, "x-orgops-runner-token": "global-runner-token" }
        : principal === "runner-scoped" ? { cookie: adminCookie, "x-orgops-runner-token": scopedToken }
          : {};
  return {
    app: created.app,
    db,
    headers,
    adminHeaders: { cookie: adminCookie },
    ownerId,
    close() { db.close(); rmSync(dataDir, { recursive: true, force: true }); },
  };
}

const opened: GrantApp[] = [];
afterEach(() => { while (opened.length) opened.pop()!.close(); });
async function grantApp(principal: Principal) {
  const value = await makeGrantApp(principal);
  opened.push(value);
  return value;
}
const json = { "content-type": "application/json" };
const revision = (expectedRevision: number) => JSON.stringify({ expectedRevision });

type Capability = { name: string; method: "GET" | "PUT" | "DELETE"; path: string };
const capabilities: readonly Capability[] = [
  { name: "list", method: "GET", path: "/api/catalog-releases/release-skill/grants" },
  { name: "organization put", method: "PUT", path: "/api/catalog-releases/release-skill/grants/organization" },
  { name: "organization delete", method: "DELETE", path: "/api/catalog-releases/release-skill/grants/organization" },
  { name: "human put", method: "PUT", path: "/api/catalog-releases/release-skill/grants/humans/human-selected" },
  { name: "human delete", method: "DELETE", path: "/api/catalog-releases/release-skill/grants/humans/human-selected" },
];

async function seedForDelete(fixture: GrantApp, capability: Capability) {
  if (capability.method !== "DELETE") return;
  const response = await fixture.app.request(capability.path, {
    method: "PUT", headers: { ...fixture.adminHeaders, ...json }, body: revision(0),
  });
  expect(response.status).toBe(200);
}

async function call(fixture: GrantApp, capability: Capability) {
  return fixture.app.request(capability.path, {
    method: capability.method,
    headers: { ...fixture.headers, ...(capability.method === "GET" ? {} : json) },
    ...(capability.method === "GET" ? {} : { body: revision(capability.method === "PUT" ? 0 : 1) }),
  });
}

describe("administrator grant routes", () => {
  it.each(["admin", "human", "runner-global", "runner-scoped", "anonymous"] as const)(
    "applies the complete grant route matrix to %s",
    async principal => {
      for (const capability of capabilities) {
        const fixture = await grantApp(principal);
        await seedForDelete(fixture, capability);
        const beforeAudits = (fixture.db.prepare("SELECT count(*) AS count FROM events WHERE type='audit.catalog.grant.changed'").get() as { count: number }).count;
        const response = await call(fixture, capability);
        expect.soft(response.status, capability.name).toBe(principal === "admin" ? 200 : principal === "anonymous" ? 401 : 403);
        expect.soft(response.headers.get("cache-control"), capability.name).toBe("no-store");
        const afterAudits = (fixture.db.prepare("SELECT count(*) AS count FROM events WHERE type='audit.catalog.grant.changed'").get() as { count: number }).count;
        expect.soft(afterAudits - beforeAudits, `${capability.name}: domain call count`).toBe(principal === "admin" && capability.method !== "GET" ? 1 : 0);
      }
    },
  );

  it("maps each route once to the exact authenticated actor and returns metadata only", async () => {
    const fixture = await grantApp("admin");
    const organization = await fixture.app.request(capabilities[1].path, {
      method: "PUT", headers: { ...fixture.headers, ...json }, body: revision(0),
    });
    expect(organization.status).toBe(200);
    expect(await organization.json()).toMatchObject({ kind: "grant", grant: { releaseId: "release-skill", subject: { kind: "ORGANIZATION" }, revision: 1 } });
    const human = await fixture.app.request(capabilities[3].path, {
      method: "PUT", headers: { ...fixture.headers, ...json }, body: revision(0),
    });
    expect(human.status).toBe(200);
    expect(await human.json()).toMatchObject({ kind: "grant", grant: { releaseId: "release-skill", subject: { kind: "HUMAN", humanId: "human-selected" }, revision: 1 } });

    const list = await fixture.app.request(capabilities[0].path, { headers: fixture.headers });
    expect(list.status).toBe(200);
    const body = await list.json();
    expect(body).toHaveLength(2);
    expect(JSON.stringify(body)).not.toMatch(/artifact|private-artifact|path|credential|secret|digest|createdBy/i);
    const audits = fixture.db.prepare("SELECT channel_id,payload_json FROM events WHERE type='audit.catalog.grant.changed' ORDER BY created_at").all() as Array<{ channel_id: string | null; payload_json: string }>;
    expect(audits).toHaveLength(2);
    for (const audit of audits) {
      expect(audit.channel_id).toBeNull();
      expect(JSON.parse(audit.payload_json)).toMatchObject({ actorKind: "HUMAN_ADMIN", actorId: fixture.ownerId, releaseId: "release-skill" });
    }
  });

  it("authenticates and authorizes before reading mutation bodies", async () => {
    for (const [principal, status] of [["anonymous", 401], ["human", 403], ["runner-global", 403], ["runner-scoped", 403]] as const) {
      const fixture = await grantApp(principal);
      const response = await fixture.app.request(capabilities[1].path, {
        method: "PUT", headers: { ...fixture.headers, ...json }, body: "{",
      });
      expect.soft(response.status, principal).toBe(status);
      expect(fixture.db.prepare("SELECT count(*) AS count FROM catalog_grants").get()).toEqual({ count: 0 });
    }
  });

  it("uses a fresh live administrator check for grant reads and writes", async () => {
    for (const capability of [capabilities[0], capabilities[1]]) {
      const fixture = await grantApp("admin");
      fixture.db.prepare("UPDATE humans SET is_admin=0 WHERE id=?").run(fixture.ownerId);
      const response = await call(fixture, capability);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Administrator access required" });
    }
  });

  it("rejects strict body, identifier, UTF-8, and actual streamed-size violations before domain mutation", async () => {
    const invalidBodies: BodyInit[] = [
      JSON.stringify({ expectedRevision: 0, extra: true }),
      JSON.stringify({ expectedRevision: 0, actor: { kind: "HUMAN_ADMIN", id: "forged" } }),
      JSON.stringify({ expectedRevision: -1 }),
      "{",
      new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xff, 0x7d]),
    ];
    for (const body of invalidBodies) {
      const fixture = await grantApp("admin");
      const response = await fixture.app.request(capabilities[1].path, { method: "PUT", headers: { ...fixture.headers, ...json }, body });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid catalog library request", code: "INVALID_REQUEST" });
      expect(fixture.db.prepare("SELECT count(*) AS count FROM catalog_grants").get()).toEqual({ count: 0 });
    }
    for (const requestInit of [
      { headers: { "content-type": "text/plain" }, body: revision(0) },
      { headers: json },
    ]) {
      const fixture = await grantApp("admin");
      const response = await fixture.app.request(capabilities[1].path, {
        method: "PUT", headers: { ...fixture.headers, ...requestInit.headers },
        ...("body" in requestInit ? { body: requestInit.body } : {}),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid catalog library request", code: "INVALID_REQUEST" });
    }
    for (const path of [
      "/api/catalog-releases/INVALID!/grants/organization",
      "/api/catalog-releases/release-skill/grants/humans/",
      `/api/catalog-releases/release-skill/grants/humans/${"x".repeat(201)}`,
    ]) {
      const fixture = await grantApp("admin");
      const response = await fixture.app.request(path, { method: "PUT", headers: { ...fixture.headers, ...json }, body: revision(0) });
      expect([400, 404]).toContain(response.status);
      expect(fixture.db.prepare("SELECT count(*) AS count FROM catalog_grants").get()).toEqual({ count: 0 });
    }

    const fixture = await grantApp("admin");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8192).fill(0x20));
        controller.enqueue(new Uint8Array(8192).fill(0x20));
        controller.enqueue(new Uint8Array([0x20]));
        controller.close();
      },
    });
    const response = await fixture.app.fetch(new Request(`http://localhost${capabilities[1].path}`, {
      method: "PUT", headers: { ...fixture.headers, ...json }, body: stream, duplex: "half",
    } as RequestInit & { duplex: "half" }));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Catalog library request too large", code: "PAYLOAD_TOO_LARGE" });
  });

  it("returns fixed revision errors", async () => {
    const fixture = await grantApp("admin");
    const stale = await fixture.app.request(capabilities[1].path, { method: "PUT", headers: { ...fixture.headers, ...json }, body: revision(1) });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: "Catalog library changed; reload metadata", code: "REVISION_CONFLICT" });
  });
});
