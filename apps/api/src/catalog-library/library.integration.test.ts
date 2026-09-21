import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type OrgOpsDb } from "@orgops/db";
import { createApp } from "../app";
import { catalogGrantId } from "./grant-identity";
import { approvedRelease } from "./test-fixtures";
import { registerCatalogSourceRoutes } from "../routes/catalog-library";

type Principal = "admin" | "human-with-grant" | "human-without-grant" | "runner-global" | "runner-scoped" | "anonymous";
type LibraryFixture = {
  app: ReturnType<typeof createApp>["app"];
  db: OrgOpsDb;
  headers: Record<string, string>;
  adminHeaders: Record<string, string>;
  ownerId: string;
  grantedId: string;
  ungrantedId: string;
  close(): void;
};

type ReleaseOptions = {
  id: string;
  name?: string;
  version?: string;
  reviewState?: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";
  installationState?: "INSTALLED" | "QUARANTINED" | "ABSENT";
  installationDigest?: string;
};

const digest = `sha256:${"a".repeat(64)}`;
const hiddenMetadata = /source|repository|ref|credential|review|reviewer|comment|artifact|install|path|origin|file|byte|command|warning|activation|grant/i;
const opened: LibraryFixture[] = [];

afterEach(() => {
  while (opened.length) opened.pop()!.close();
});

async function login(app: ReturnType<typeof createApp>["app"], username: string) {
  const response = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "test-password" }),
  });
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")!.match(/orgops_session=[^;]+/)![0];
}

function insertRelease(db: OrgOpsDb, ownerId: string, options: ReleaseOptions) {
  const fixture = approvedRelease();
  const name = options.name ?? options.id.replace(/^release-/, "");
  const version = options.version ?? "1.0.0";
  const reviewState = options.reviewState ?? "APPROVED";
  db.prepare(`INSERT INTO catalog_package_releases
    (package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,
     manifest_json,execution_preview_json,warnings_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)`)
    .run(options.id, "source-team", "source-team", fixture.kind, name, version, digest,
      fixture.catalogCommit, fixture.packageCommit, `skills/${name}`, JSON.stringify({ ...fixture.manifest, name, version }),
      JSON.stringify(fixture.executionPreview), JSON.stringify([{ code: "MANUAL_REVIEW_REQUIRED", at: "private-warning" }]));
  db.prepare(`INSERT INTO catalog_release_controls
    (package_release_id,review_state,review_digest,reviewed_by_human_id,reviewed_at,revision,created_at,updated_at)
    VALUES (?,?,?,?,1,1,1,1)`)
    .run(options.id, reviewState, reviewState === "PENDING" ? null : digest, reviewState === "PENDING" ? null : ownerId);
  if ((options.installationState ?? "INSTALLED") !== "ABSENT") {
    db.prepare(`INSERT INTO catalog_installations
      (release_id,artifact_digest,artifact_path,state,installed_by_human_id,installed_at,last_verified_at,revision)
      VALUES (?,?,?,?,?,1,1,1)`)
      .run(options.id, options.installationDigest ?? digest, join("/private/catalog-artifacts", options.id), options.installationState ?? "INSTALLED", ownerId);
  }
}

function grant(db: OrgOpsDb, ownerId: string, releaseId: string, subject: "ORGANIZATION" | "HUMAN", humanId?: string, grantId?: string) {
  db.prepare(`INSERT INTO catalog_grants
    (grant_id,release_id,subject_type,human_id,revision,revoked_at,created_by_human_id,created_at,updated_at)
    VALUES (?,?,?,?,1,NULL,?,1,1)`)
    .run(grantId ?? catalogGrantId(releaseId, subject, humanId), releaseId, subject, humanId ?? null, ownerId);
}

function insertSource(db: OrgOpsDb, sourceId: string) {
  db.prepare(`INSERT INTO catalog_sources
    (source_id,display_name,canonical_url,repository_identity,ref,enabled,allow_packages,revision,created_at,updated_at)
    VALUES (?,?,?,?,?,1,0,1,1,1)`)
    .run(sourceId, sourceId, `https://github.com/private/${sourceId}`, JSON.stringify(["github", "private", sourceId]), "main");
}

async function makeLibraryApp(principal: Principal): Promise<LibraryFixture> {
  const dataDir = mkdtempSync(join(tmpdir(), "orgops-library-routes-"));
  const db = openDb(":memory:");
  const created = createApp({ db, dataDir, adminUser: "owner", adminPass: "test-password", runnerToken: "global-runner-token" });
  const ownerId = db.prepare<[], { id: string }>("SELECT id FROM humans WHERE username='owner'").get()!.id;
  db.prepare(`INSERT INTO humans (id,username,password_hash,must_change_password,is_admin,created_at,updated_at)
    SELECT 'human-granted','granted',password_hash,0,0,1,1 FROM humans WHERE id=?`).run(ownerId);
  db.prepare(`INSERT INTO humans (id,username,password_hash,must_change_password,is_admin,created_at,updated_at)
    SELECT 'human-ungranted','ungranted',password_hash,0,0,1,1 FROM humans WHERE id=?`).run(ownerId);
  db.prepare(`INSERT INTO catalog_sources
    (source_id,display_name,canonical_url,repository_identity,ref,enabled,allow_packages,revision,created_at,updated_at)
    VALUES ('source-team','Private source','https://github.com/private/catalog',?,'secret-ref',1,0,1,1,1)`)
    .run(JSON.stringify(["github", "private", "catalog"]));
  insertRelease(db, ownerId, { id: "release-zeta", name: "zeta" });
  insertRelease(db, ownerId, { id: "release-alpha", name: "alpha" });
  insertRelease(db, ownerId, { id: "release-beta", name: "beta" });
  grant(db, ownerId, "release-alpha", "HUMAN", "human-granted");
  grant(db, ownerId, "release-beta", "HUMAN", "human-granted");

  const adminCookie = await login(created.app, "owner");
  const grantedCookie = await login(created.app, "granted");
  const ungrantedCookie = await login(created.app, "ungranted");
  const scopedToken = "org_rt_library_route_test";
  db.prepare(`INSERT INTO runner_tokens
    (id,name,token_hash,token_prefix,allowed_agent_name,allowed_runner_id,allowed_channel_ids_json,invite_id,created_by_human_id,created_at)
    VALUES ('library-route-token','Library runner',?,?,NULL,NULL,'[]',NULL,?,1)`)
    .run(createHash("sha256").update(scopedToken).digest("hex"), scopedToken.slice(0, 16), ownerId);
  const headers: Record<string, string> = principal === "admin" ? { cookie: adminCookie }
    : principal === "human-with-grant" ? { cookie: grantedCookie }
      : principal === "human-without-grant" ? { cookie: ungrantedCookie }
        : principal === "runner-global" ? { cookie: adminCookie, "x-orgops-runner-token": "global-runner-token" }
          : principal === "runner-scoped" ? { cookie: adminCookie, "x-orgops-runner-token": scopedToken }
            : {};
  return {
    app: created.app,
    db,
    headers,
    adminHeaders: { cookie: adminCookie },
    ownerId,
    grantedId: "human-granted",
    ungrantedId: "human-ungranted",
    close() { db.close(); rmSync(dataDir, { recursive: true, force: true }); },
  };
}

async function libraryApp(principal: Principal) {
  const fixture = await makeLibraryApp(principal);
  opened.push(fixture);
  return fixture;
}

async function request(fixture: LibraryFixture, path: string) {
  return fixture.app.request(path, { headers: fixture.headers });
}

const expectedAlpha = { packageReleaseId: "release-alpha", kind: "skill", name: "alpha", version: "1.0.0", digest };
const notFound = { error: "Catalog library resource not found", code: "NOT_FOUND" };

describe("grant-filtered user library routes", () => {
  it.each([
    ["admin", 200, 200],
    ["human-with-grant", 200, 200],
    ["human-without-grant", 200, 404],
    ["runner-global", 403, 403],
    ["runner-scoped", 403, 403],
    ["anonymous", 401, 401],
  ] as const)("applies list and detail authorization to %s", async (principal, listStatus, detailStatus) => {
    const fixture = await libraryApp(principal);
    for (const [path, status] of [["/api/library/packages", listStatus], ["/api/library/packages/release-alpha", detailStatus]] as const) {
      const response = await request(fixture, path);
      expect.soft(response.status, path).toBe(status);
      expect.soft(response.headers.get("cache-control"), path).toBe("no-store");
      if (principal === "runner-global" || principal === "runner-scoped") {
        expect.soft(await response.json(), path).toEqual({ error: "Authenticated human access required" });
      } else if (principal === "anonymous") {
        expect.soft(await response.json(), path).toEqual({ error: "Unauthorized" });
      }
    }
  });

  it.each(["AGENT", "PSEUDO_USER"] as const)("denies an authenticated %s principal on both routes", async kind => {
    const app = new Hono();
    const requireAuth = async (c: any, next: () => Promise<void>) => {
      c.set("user", kind === "AGENT" ? { agentName: "agent-a", username: "agent-a" } : { username: "internal" });
      await next();
    };
    registerCatalogSourceRoutes(app as any, {
      authority: { execute: async () => { throw new Error("not called"); }, query: async () => { throw new Error("not called"); } },
      requireAuth,
      requireAdmin: async (c: any) => c.json({ error: "Administrator access required" }, 403),
      resolveLibraryActor: () => undefined,
      library: { list: async () => { throw new Error("not called"); }, detail: async () => { throw new Error("not called"); } },
    } as any);
    for (const path of ["/api/library/packages", "/api/library/packages/release-alpha"]) {
      const response = await app.request(path);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Authenticated human access required" });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("returns only the bounded public projection in deterministic order and deduplicates overlapping grants", async () => {
    const fixture = await libraryApp("human-with-grant");
    grant(fixture.db, fixture.ownerId, "release-beta", "ORGANIZATION");
    const response = await request(fixture, "/api/library/packages");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      packages: [
        expectedAlpha,
        { packageReleaseId: "release-beta", kind: "skill", name: "beta", version: "1.0.0", digest },
      ],
    });
    const detail = await request(fixture, "/api/library/packages/release-alpha");
    expect(await detail.json()).toEqual({ package: expectedAlpha, description: "Deterministic Source Library fixture.", author: "OrgOps", license: "MIT", compatibility: { orgops: { min: "0.0.1" }, platforms: ["linux"], tools: [] }, dependencies: [], secretRequirements: [] });
    expect(JSON.stringify(await (await request(fixture, "/api/library/packages")).json())).not.toMatch(hiddenMetadata);
  });

  it("lets an administrator see the eligible installed projection without a grant", async () => {
    const fixture = await libraryApp("admin");
    const body = await (await request(fixture, "/api/library/packages")).json() as { packages: Array<{ name: string }> };
    expect(body.packages.map(value => value.name)).toEqual(["alpha", "beta", "zeta"]);
    expect(await (await request(fixture, "/api/library/packages/release-zeta")).json()).toEqual({
      package: { packageReleaseId: "release-zeta", kind: "skill", name: "zeta", version: "1.0.0", digest }, description: "Deterministic Source Library fixture.", author: "OrgOps", license: "MIT", compatibility: { orgops: { min: "0.0.1" }, platforms: ["linux"], tools: [] }, dependencies: [], secretRequirements: [],
    });
  });

  it("uses only the server-authenticated human and rejects caller-selected query identity", async () => {
    const fixture = await libraryApp("human-without-grant");
    const forgedQuery = await request(fixture, "/api/library/packages?humanId=human-granted");
    expect(forgedQuery.status).toBe(400);
    expect(await forgedQuery.json()).toEqual({ error: "Invalid catalog library request", code: "INVALID_REQUEST" });
    const forgedHeader = await fixture.app.request("/api/library/packages", {
      headers: { ...fixture.headers, "x-orgops-human-id": "human-granted" },
    });
    expect(await forgedHeader.json()).toEqual({ packages: [], emptyReason: "NO_GRANTS" });
  });

  it("derives each bounded empty-state reason without release metadata", async () => {
    const noGrants = await libraryApp("human-without-grant");
    expect(await (await request(noGrants, "/api/library/packages")).json()).toEqual({ packages: [], emptyReason: "NO_GRANTS" });

    const notInstalled = await libraryApp("human-with-grant");
    notInstalled.db.prepare("DELETE FROM catalog_installations").run();
    expect(await (await request(notInstalled, "/api/library/packages")).json()).toEqual({ packages: [], emptyReason: "NOT_INSTALLED" });

    const incompatible = await libraryApp("human-with-grant");
    incompatible.db.prepare("UPDATE catalog_release_controls SET review_state='WITHDRAWN' WHERE package_release_id IN ('release-alpha','release-beta')").run();
    expect(await (await request(incompatible, "/api/library/packages")).json()).toEqual({ packages: [], emptyReason: "NO_COMPATIBLE_RELEASES" });
  });

  it("applies organization grants to future humans without copied rows and revokes them immediately", async () => {
    const fixture = await libraryApp("admin");
    grant(fixture.db, fixture.ownerId, "release-beta", "ORGANIZATION");
    fixture.db.prepare(`INSERT INTO humans (id,username,password_hash,must_change_password,is_admin,created_at,updated_at)
      SELECT 'future-human','future',password_hash,0,0,1,1 FROM humans WHERE id=?`).run(fixture.ownerId);
    const futureCookie = await login(fixture.app, "future");
    const before = await fixture.app.request("/api/library/packages/release-beta", { headers: { cookie: futureCookie } });
    expect(before.status).toBe(200);
    expect(fixture.db.prepare("SELECT count(*) AS count FROM catalog_grants WHERE human_id='future-human'").get()).toEqual({ count: 0 });
    fixture.db.prepare("UPDATE catalog_grants SET revoked_at=2 WHERE release_id='release-beta' AND subject_type='ORGANIZATION'").run();
    const after = await fixture.app.request("/api/library/packages/release-beta", { headers: { cookie: futureCookie } });
    expect(after.status).toBe(404);
    expect(await after.json()).toEqual(notFound);
  });

  it("fails closed on current grant corruption, revocation, withdrawal, source disablement, quarantine, uninstall, and digest drift", async () => {
    const mutations = [
      "UPDATE catalog_grants SET revoked_at=2 WHERE release_id='release-alpha'",
      "UPDATE catalog_grants SET grant_id='grant-corrupt' WHERE release_id='release-alpha'",
      "UPDATE catalog_release_controls SET review_state='WITHDRAWN' WHERE package_release_id='release-alpha'",
      "UPDATE catalog_release_controls SET review_state='REJECTED' WHERE package_release_id='release-alpha'",
      "UPDATE catalog_sources SET enabled=0 WHERE source_id='source-team'",
      "UPDATE catalog_installations SET state='QUARANTINED' WHERE release_id='release-alpha'",
      "DELETE FROM catalog_installations WHERE release_id='release-alpha'",
      `UPDATE catalog_installations SET artifact_digest='sha256:${"b".repeat(64)}' WHERE release_id='release-alpha'`,
    ];
    for (const sql of mutations) {
      const fixture = await libraryApp("human-with-grant");
      fixture.db.prepare(sql).run();
      const response = await request(fixture, "/api/library/packages/release-alpha");
      expect.soft(response.status, sql).toBe(404);
      expect.soft(await response.json(), sql).toEqual(notFound);
      const list = await (await request(fixture, "/api/library/packages")).json() as { packages: Array<{ packageReleaseId: string }> };
      expect.soft(list.packages.some(value => value.packageReleaseId === "release-alpha"), sql).toBe(false);
    }
  });

  it("makes malformed, missing, hidden, and corrupt-grant details indistinguishable", async () => {
    const paths = [
      "/api/library/packages/INVALID!",
      "/api/library/packages/release-missing",
      "/api/library/packages/release-zeta",
    ];
    const fixture = await libraryApp("human-with-grant");
    for (const path of paths) {
      const response = await request(fixture, path);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual(notFound);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    fixture.db.prepare("UPDATE catalog_grants SET grant_id='not-canonical' WHERE release_id='release-alpha'").run();
    const corrupt = await request(fixture, "/api/library/packages/release-alpha");
    expect(corrupt.status).toBe(404);
    expect(await corrupt.json()).toEqual(notFound);
  });

  it("continues bounded candidate pages past 500 earlier policy denials and returns the first 100 authorized rows", async () => {
    const fixture = await libraryApp("admin");
    for (let index = 0; index < 501; index += 1) {
      const suffix = String(index).padStart(3, "0");
      insertRelease(fixture.db, fixture.ownerId, { id: `release-a-ineligible-${suffix}`, name: `a-ineligible-${suffix}` });
    }
    fixture.db.prepare("UPDATE catalog_sources SET enabled=0 WHERE source_id='source-team'").run();
    insertSource(fixture.db, "source-eligible");
    for (let index = 0; index < 105; index += 1) {
      const suffix = String(index).padStart(3, "0");
      insertRelease(fixture.db, fixture.ownerId, { id: `release-z-authorized-${suffix}`, name: `z-authorized-${suffix}` });
    }
    fixture.db.prepare(`UPDATE catalog_package_releases
      SET authority_source_id='source-eligible',content_source_id='source-eligible'
      WHERE package_release_id LIKE 'release-z-authorized-%'`).run();

    const body = await (await request(fixture, "/api/library/packages")).json() as {
      packages: Array<{ packageReleaseId: string; name: string }>;
    };
    expect(body.packages.map(value => value.packageReleaseId)).toEqual(Array.from(
      { length: 100 },
      (_, index) => `release-z-authorized-${String(index).padStart(3, "0")}`,
    ));
    expect(body.packages.map(value => value.name)).toEqual([...body.packages].map(value => value.name).sort());
  });

  it("uses a canonical organization grant when its human sibling is corrupt and keeps corrupt siblings ineffective", async () => {
    const organizationFallback = await libraryApp("human-with-grant");
    organizationFallback.db.prepare("UPDATE catalog_grants SET grant_id='grant-corrupt-human' WHERE release_id='release-alpha'").run();
    grant(organizationFallback.db, organizationFallback.ownerId, "release-alpha", "ORGANIZATION");
    expect((await request(organizationFallback, "/api/library/packages/release-alpha")).status).toBe(200);

    const humanFallback = await libraryApp("human-with-grant");
    grant(humanFallback.db, humanFallback.ownerId, "release-alpha", "ORGANIZATION", undefined, "grant-corrupt-organization");
    expect((await request(humanFallback, "/api/library/packages/release-alpha")).status).toBe(200);
    humanFallback.db.prepare("UPDATE catalog_grants SET grant_id='grant-corrupt-human' WHERE release_id='release-alpha' AND subject_type='HUMAN'").run();
    const neitherCanonical = await request(humanFallback, "/api/library/packages/release-alpha");
    expect(neitherCanonical.status).toBe(404);
    expect(await neitherCanonical.json()).toEqual(notFound);
  });

  it("scans past 100 corrupt grants before classifying a later canonical grant", async () => {
    const fixture = await libraryApp("human-with-grant");
    fixture.db.prepare("DELETE FROM catalog_grants").run();
    for (let index = 0; index < 101; index += 1) {
      const suffix = String(index).padStart(3, "0");
      const releaseId = `release-a-corrupt-${suffix}`;
      insertRelease(fixture.db, fixture.ownerId, { id: releaseId, name: `a-corrupt-${suffix}` });
      grant(fixture.db, fixture.ownerId, releaseId, "HUMAN", fixture.grantedId, `grant-corrupt-${suffix}`);
    }
    insertRelease(fixture.db, fixture.ownerId, { id: "release-z-canonical", name: "z-canonical", reviewState: "WITHDRAWN" });
    grant(fixture.db, fixture.ownerId, "release-z-canonical", "HUMAN", fixture.grantedId);

    expect(await (await request(fixture, "/api/library/packages")).json()).toEqual({
      packages: [],
      emptyReason: "NO_COMPATIBLE_RELEASES",
    });
  });

  it("scans past 100 incompatible canonical grants to find a later installation denial", async () => {
    const fixture = await libraryApp("human-with-grant");
    fixture.db.prepare("DELETE FROM catalog_grants").run();
    for (let index = 0; index < 101; index += 1) {
      const suffix = String(index).padStart(3, "0");
      const releaseId = `release-a-incompatible-${suffix}`;
      insertRelease(fixture.db, fixture.ownerId, { id: releaseId, name: `a-incompatible-${suffix}`, reviewState: "REJECTED" });
      grant(fixture.db, fixture.ownerId, releaseId, "HUMAN", fixture.grantedId);
    }
    insertRelease(fixture.db, fixture.ownerId, { id: "release-z-uninstalled", name: "z-uninstalled", installationState: "ABSENT" });
    grant(fixture.db, fixture.ownerId, "release-z-uninstalled", "HUMAN", fixture.grantedId);

    expect(await (await request(fixture, "/api/library/packages")).json()).toEqual({ packages: [], emptyReason: "NOT_INSTALLED" });
  });

  it("classifies administrator empty lists by policy precedence and never reports NO_GRANTS", async () => {
    const unavailable = await libraryApp("admin");
    unavailable.db.prepare("UPDATE catalog_sources SET enabled=0").run();
    expect(await (await request(unavailable, "/api/library/packages")).json()).toEqual({
      packages: [],
      emptyReason: "NO_COMPATIBLE_RELEASES",
    });

    const notInstalled = await libraryApp("admin");
    for (let index = 0; index < 101; index += 1) {
      const suffix = String(index).padStart(3, "0");
      insertRelease(notInstalled.db, notInstalled.ownerId, {
        id: `release-a-admin-incompatible-${suffix}`,
        name: `a-admin-incompatible-${suffix}`,
      });
    }
    notInstalled.db.prepare("UPDATE catalog_sources SET enabled=0 WHERE source_id='source-team'").run();
    insertSource(notInstalled.db, "source-admin-eligible");
    insertRelease(notInstalled.db, notInstalled.ownerId, {
      id: "release-z-admin-uninstalled",
      name: "z-admin-uninstalled",
      installationState: "ABSENT",
    });
    notInstalled.db.prepare(`UPDATE catalog_package_releases
      SET authority_source_id='source-admin-eligible',content_source_id='source-admin-eligible'
      WHERE package_release_id='release-z-admin-uninstalled'`).run();
    expect(await (await request(notInstalled, "/api/library/packages")).json()).toEqual({ packages: [], emptyReason: "NOT_INSTALLED" });

    const apiInactive = await libraryApp("admin");
    apiInactive.db.prepare("UPDATE catalog_release_controls SET review_state='REJECTED' WHERE package_release_id<>'release-alpha'").run();
    const executionPreview = approvedRelease().executionPreview;
    apiInactive.db.prepare("UPDATE catalog_package_releases SET execution_preview_json=? WHERE package_release_id='release-alpha'")
      .run(JSON.stringify({ ...executionPreview, apiEventShapes: ["event-shapes.ts"] }));
    expect(await (await request(apiInactive, "/api/library/packages")).json()).toEqual({
      packages: [],
      emptyReason: "NO_COMPATIBLE_RELEASES",
    });
  });

  it("keeps every existing administration family protected", async () => {
    const fixture = await libraryApp("human-with-grant");
    for (const path of [
      "/api/catalog-sources",
      "/api/catalog-releases",
      "/api/catalog-releases/release-alpha/grants",
    ]) {
      const response = await request(fixture, path);
      expect.soft(response.status, path).toBe(403);
    }

  });

  it("rejects a stale session whose human row no longer exists", async () => {
    const fixture = await libraryApp("human-with-grant");
    fixture.db.prepare("DELETE FROM catalog_grants WHERE human_id=?").run(fixture.grantedId);
    fixture.db.prepare("DELETE FROM humans WHERE id=?").run(fixture.grantedId);
    for (const path of ["/api/library/packages", "/api/library/packages/release-alpha"]) {
      const response = await request(fixture, path);
      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });
});
