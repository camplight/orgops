import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createApp } from "../app";
import { approvedRelease } from "../catalog-library/test-fixtures";
import { catalogGrantId } from "../catalog-library/grant-identity";
import { openDb } from "@orgops/db";
import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { registerUnifiedSkillRoutes } from "./unified-skills";

const human = { kind: "AUTHENTICATED_HUMAN" as const, id: "human-user" };

describe("canonical unified skill routes", () => {
  it("covers real createApp principal precedence, projections, no-store, and legacy shape", async () => {
    const dataDir = mkdtempSync(`${tmpdir()}/orgops-unified-skills-`);
    const db = openDb(":memory:");
    const { app } = createApp({ db, dataDir, adminUser: "admin", adminPass: "admin", runnerToken: "global-token" });
    try {
      const anonymous = await app.request("http://localhost/api/skills/inventory");
      expect(anonymous.status).toBe(401);
      expect(anonymous.headers.get("cache-control")).toBe("no-store");
      const login = await app.request("http://localhost/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin" }) });
      expect(login.status).toBe(200);
      const cookie = login.headers.get("set-cookie") ?? "";
      const admin = db.prepare<[], { id: string; password_hash: string }>("SELECT id,password_hash FROM humans WHERE username='admin'").get()!;
      db.prepare("INSERT INTO humans (id,username,password_hash,must_change_password,is_admin,created_at,updated_at) VALUES ('ordinary-human','ordinary-human',?,0,0,1,1)").run(admin.password_hash);
      const release = approvedRelease("skill");
      db.exec("INSERT INTO catalog_sources (source_id,display_name,canonical_url,repository_identity,ref,enabled,allow_packages,revision,created_at,updated_at) VALUES ('source-team','Team','https://github.com/example/team','[\\\"github\\\",\\\"example\\\",\\\"team\\\"]','main',1,0,1,1,1)");
      db.prepare("INSERT INTO catalog_package_releases (package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,manifest_json,execution_preview_json,warnings_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)").run(release.packageReleaseId, release.authoritySourceId, release.contentSourceId, release.kind, release.name, release.version, release.digest, release.catalogCommit, release.packageCommit, release.packagePath, JSON.stringify(release.manifest), JSON.stringify(release.executionPreview), JSON.stringify(release.warnings));
      db.prepare("INSERT INTO catalog_release_controls (package_release_id,review_state,review_digest,reviewed_by_human_id,reviewed_at,revision,created_at,updated_at) VALUES (?,?,?,?,1,1,1,1)").run(release.packageReleaseId, "APPROVED", release.reviewDigest, admin.id);
      db.prepare("INSERT INTO catalog_installations (release_id,artifact_digest,artifact_path,state,installed_by_human_id,installed_at,last_verified_at,revision) VALUES (?,?,?,'INSTALLED',?,1,1,1)").run(release.packageReleaseId, release.digest, "/private/catalog", admin.id);
      db.prepare("INSERT INTO catalog_grants (grant_id,release_id,subject_type,human_id,revision,created_by_human_id,created_at,updated_at) VALUES (? ,?,'HUMAN','ordinary-human',1,?,1,1)").run(catalogGrantId(release.packageReleaseId, "HUMAN", "ordinary-human"), release.packageReleaseId, admin.id);
      const adminInventory = await app.request("http://localhost/api/skills/inventory", { headers: { cookie } });
      expect(adminInventory.status).toBe(200);
      expect(adminInventory.headers.get("cache-control")).toBe("no-store");
      const adminItems = await adminInventory.json() as { items: Array<Record<string, unknown>> };
      expect(Array.isArray(adminItems.items)).toBe(true);
      const adminCatalog = adminItems.items.find(item => (item.ref as { packageReleaseId?: string }).packageReleaseId === "release-skill");
      expect(adminCatalog).toMatchObject({ provenance: "FULL_ADMIN", adminProvenance: {
        kind: "CATALOG", authoritySourceId: "source-team", contentSourceId: "source-team",
        catalogCommit: release.catalogCommit, packageCommit: release.packageCommit, packagePath: release.packagePath,
        sourceReadiness: "READY", reviewState: "APPROVED", installationState: "INSTALLED",
        grantCount: 1, compatibility: release.manifest.compatibility,
        links: {
          overview: "/?screen=source-library&source=source-team&release=release-skill&tab=OVERVIEW",
          contents: "/?screen=source-library&source=source-team&release=release-skill&tab=CONTENTS",
          security: "/?screen=source-library&source=source-team&release=release-skill&tab=SECURITY",
        },
      } });
      expect(JSON.stringify(adminItems)).not.toMatch(/(?:^|[" ])(?:\/home|[A-Za-z]:\\)/);
      db.prepare("UPDATE catalog_installations SET state='QUARANTINED' WHERE release_id='release-skill'").run();
      const quarantined = await (await app.request("http://localhost/api/skills/inventory", { headers: { cookie } })).json() as { items: Array<any> };
      expect(quarantined.items.find(item => item.ref?.packageReleaseId === "release-skill")?.readiness).toEqual({ state: "BLOCKED", blockers: [{ code: "INSTALLATION_REQUIRED" }] });
      db.prepare("UPDATE catalog_installations SET state='INSTALLED' WHERE release_id='release-skill'").run();
      db.prepare("UPDATE catalog_package_releases SET execution_preview_json=? WHERE package_release_id='release-skill'").run(JSON.stringify({ apiEventShapes: ["event-shapes.ts"], runnerScripts: [], wrappedCommands: [], externalSources: [] }));
      const apiBlocked = await (await app.request("http://localhost/api/skills/inventory", { headers: { cookie } })).json() as { items: Array<any> };
      expect(apiBlocked.items.find(item => item.ref?.packageReleaseId === "release-skill")?.readiness.state).toBe("BLOCKED");
      expect(apiBlocked.items.find(item => item.ref?.packageReleaseId === "release-skill")?.readiness.blockers).toContainEqual({ code: "REQUIREMENT_MISSING", requirement: "API_ACTIVATION" });
      db.prepare("UPDATE catalog_package_releases SET execution_preview_json=? WHERE package_release_id='release-skill'").run(JSON.stringify(release.executionPreview));
      db.prepare("UPDATE catalog_sources SET enabled=0 WHERE source_id='source-team'").run();
      const sourceHidden = await (await app.request("http://localhost/api/skills/inventory", { headers: { cookie } })).json() as { items: Array<any> };
      expect(sourceHidden.items.some(item => item.ref?.packageReleaseId === "release-skill")).toBe(false);
      db.prepare("UPDATE catalog_sources SET enabled=1 WHERE source_id='source-team'").run();
      db.prepare("UPDATE catalog_package_releases SET manifest_json='{}' WHERE package_release_id='release-skill'").run();
      const corrupt = await (await app.request("http://localhost/api/skills/inventory", { headers: { cookie } })).json() as { items: Array<any> };
      expect(corrupt.items.some(item => item.ref?.packageReleaseId === "release-skill")).toBe(false);
      db.prepare("UPDATE catalog_package_releases SET manifest_json=? WHERE package_release_id='release-skill'").run(JSON.stringify(release.manifest));
      const incompatibleManifest = { ...release.manifest, compatibility: { ...release.manifest.compatibility, platforms: ["darwin"] } };
      db.prepare("UPDATE catalog_package_releases SET manifest_json=? WHERE package_release_id='release-skill'").run(JSON.stringify(incompatibleManifest));
      const incompatible = await (await app.request("http://localhost/api/skills/inventory", { headers: { cookie } })).json() as { items: Array<any> };
      expect(incompatible.items.find(item => item.ref?.packageReleaseId === "release-skill")?.readiness.blockers).toContainEqual(expect.objectContaining({ code: "INCOMPATIBLE" }));
      db.prepare("UPDATE catalog_package_releases SET manifest_json=? WHERE package_release_id='release-skill'").run(JSON.stringify(release.manifest));
      db.prepare("UPDATE catalog_release_controls SET review_state='WITHDRAWN' WHERE package_release_id='release-skill'").run();
      const withdrawn = await (await app.request("http://localhost/api/skills/inventory", { headers: { cookie } })).json() as { items: Array<any> };
      expect(withdrawn.items.some(item => item.ref?.packageReleaseId === "release-skill")).toBe(false);
      db.prepare("UPDATE catalog_release_controls SET review_state='APPROVED' WHERE package_release_id='release-skill'").run();
      const legacy = await app.request("http://localhost/api/skills", { headers: { cookie } });
      expect(legacy.status).toBe(200);
      expect(Array.isArray(await legacy.json())).toBe(true);
      const invalidRunner = await app.request("http://localhost/api/skills/inventory", { headers: { cookie, "x-orgops-runner-token": "" } });
      expect(invalidRunner.status).toBe(401);
      expect(invalidRunner.headers.get("cache-control")).toBe("no-store");
      const globalRunner = await app.request("http://localhost/api/skills/inventory", { headers: { "x-orgops-runner-token": "global-token" } });
      expect(globalRunner.status).toBe(403);
      const scopedToken = "org_rt_unified_scope";
      db.prepare(`INSERT INTO runner_tokens (id,name,token_hash,token_prefix,allowed_channel_ids_json,created_by_human_id,created_at) VALUES ('unified-scope','Unified scope',?,?, '[]',?,1)`).run(createHash("sha256").update(scopedToken).digest("hex"), scopedToken.slice(0, 16), admin.id);
      const scopedRunner = await app.request("http://localhost/api/skills/inventory", { headers: { "x-orgops-runner-token": scopedToken } });
      expect(scopedRunner.status).toBe(403);
      const humanLogin = await app.request("http://localhost/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "ordinary-human", password: "admin" }) });
      const humanCookie = humanLogin.headers.get("set-cookie") ?? "";
      const humanInventory = await app.request("http://localhost/api/skills/inventory", { headers: { cookie: humanCookie } });
      expect(humanInventory.status).toBe(200);
      const humanItems = await humanInventory.json() as { items: Array<Record<string, unknown>> };
      const humanCatalog = humanItems.items.find(item => (item.ref as { packageReleaseId?: string }).packageReleaseId === "release-skill");
      expect(humanCatalog).toMatchObject({ provenance: "BOUNDED_HUMAN" });
      expect(JSON.stringify(humanCatalog)).not.toContain("adminProvenance");
      for (const path of ["/api/catalog-sources", "/api/catalog-releases", "/api/agents/hidden/skills", "/api/agents/hidden/skills/history?kind=CATALOG&packageReleaseId=hidden"]) {
        const response = await app.request(`http://localhost${path}`, { headers: { cookie: humanCookie } });
        expect([403, 404]).toContain(response.status);
        expect(await response.text()).not.toMatch(/private|credential|sourceId|hidden|secret|command|path/i);
      }
      db.prepare("UPDATE catalog_grants SET revoked_at=2 WHERE release_id='release-skill'").run();
      const revokedHuman = await (await app.request("http://localhost/api/skills/inventory", { headers: { cookie: humanCookie } })).json() as { items: Array<any> };
      expect(revokedHuman.items.some(item => item.ref?.packageReleaseId === "release-skill")).toBe(false);
    } finally { db.close(); rmSync(dataDir, { recursive: true, force: true }); }
  });

  it("omits removal tombstone internals from agent inventory projections", async () => {
    const dataDir = mkdtempSync(`${tmpdir()}/orgops-unified-tombstone-`);
    const db = openDb(":memory:");
    const { app } = createApp({ db, dataDir, adminUser: "admin", adminPass: "admin", runnerToken: "global-token" });
    try {
      const login = await app.request("http://localhost/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin" }) });
      const cookie = login.headers.get("set-cookie") ?? "";
      const admin = db.prepare<[], { id: string }>("SELECT id FROM humans WHERE username='admin'").get()!;
      const release = approvedRelease("skill");
      db.exec("INSERT INTO catalog_sources (source_id,display_name,canonical_url,repository_identity,ref,enabled,allow_packages,revision,created_at,updated_at) VALUES ('source-tomb','Tomb','https://github.com/example/tomb','[\\\"github\\\",\\\"example\\\",\\\"tomb\\\"]','main',1,0,1,1,1)");
      db.prepare("INSERT INTO catalog_package_releases (package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,manifest_json,execution_preview_json,warnings_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)").run(release.packageReleaseId, "source-tomb", "source-tomb", "skill", release.name, release.version, release.digest, release.catalogCommit, release.packageCommit, release.packagePath, JSON.stringify(release.manifest), JSON.stringify(release.executionPreview), "[]");
      db.prepare("INSERT INTO catalog_release_controls (package_release_id,review_state,review_digest,reviewed_by_human_id,reviewed_at,revision,created_at,updated_at) VALUES (?,?,?,?,1,1,1,1)").run(release.packageReleaseId, "APPROVED", release.digest, admin.id);
      db.prepare("INSERT INTO catalog_installations (release_id,artifact_digest,artifact_path,state,installed_by_human_id,installed_at,last_verified_at,revision) VALUES (?,?,?,'INSTALLED',?,1,1,1)").run(release.packageReleaseId, release.digest, "/private/tomb", admin.id);
      db.prepare("INSERT INTO agents (id,name,model_id,soul_path,workspace_path,revision,created_at,updated_at) VALUES ('agent-tomb','agent-tomb','model','soul','/workspace',7,1,1)").run();
      db.prepare("INSERT INTO agent_skill_assignments (assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,preload,effective_preload,active_generation,desired_generation,revision,actor_kind,actor_human_id,created_at,updated_at,removal_requested) VALUES ('assignment-tomb','agent-tomb',?,?,?,?,?,?,?,?,?,?, 'ADMIN',?,1,1,1)").run(release.packageReleaseId, release.name, "DISABLED", "DISABLED", "STABLE", 0, 0, "tomb-generation", "tomb-generation", 9, admin.id);
      const response = await app.request(`http://localhost/api/skills/inventory?agentId=agent-tomb`, { headers: { cookie } });
      expect(response.status).toBe(200);
      const body = await response.json() as { items: Array<{ ref?: { packageReleaseId?: string }; assignment?: unknown }> };
      const item = body.items.find(candidate => candidate.ref?.packageReleaseId === release.packageReleaseId);
      expect(item).toBeDefined();
      expect(item?.assignment).toBeUndefined();
      expect(JSON.stringify(item)).not.toContain("assignment-tomb");
      expect(JSON.stringify(item)).not.toContain("tomb-generation");
      expect(JSON.stringify(item)).not.toContain("revision");
    } finally { db.close(); rmSync(dataDir, { recursive: true, force: true }); }
  });

  it("passes parsed filters directly to inventory with and without agent context", async () => {
    const inventory = { list: vi.fn(async () => []), listForAgent: vi.fn(async () => ({ items: [], agentRevision: 2 })) };
    const app = new Hono();
    registerUnifiedSkillRoutes(app, { inventory, requireAuth: async (c: any, next: any) => { c.set("user", { id: "human-user", username: "human", mustChangePassword: false }); await next(); }, actor: () => human });
    await app.request("/api/skills/inventory?q=deploy&origin=CATALOG");
    expect(inventory.list).toHaveBeenCalledWith(human, { query: "deploy", origin: "CATALOG", availability: "ALL" });
    await app.request("/api/skills/inventory?agentId=agent-1&q=deploy&origin=CATALOG");
    expect(inventory.listForAgent).toHaveBeenCalledWith(human, "agent-1", { query: "deploy", origin: "CATALOG", availability: "ALL" });
  });

  it("sets no-store before auth and rejects runner principals", async () => {
    const app = new Hono();
    registerUnifiedSkillRoutes(app, { inventory: { list: vi.fn(), listForAgent: vi.fn() }, requireAuth: async (c: any, next: any) => { c.set("user", { username: "runner" }); await next(); }, actor: () => human });
    const response = await app.request("/api/skills/inventory");
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects an explicitly empty agentId instead of falling back to unscoped inventory", async () => {
    const inventory = { list: vi.fn(async () => []), listForAgent: vi.fn(async () => ({ items: [], agentRevision: 2 })) };
    const app = new Hono();
    registerUnifiedSkillRoutes(app, { inventory, requireAuth: async (c: any, next: any) => next(), actor: () => human });
    const response = await app.request("/api/skills/inventory?agentId=");
    expect(response.status).toBe(400);
    expect(inventory.list).not.toHaveBeenCalled();
  });

  it("maps known not-found and unexpected inventory errors to fixed responses", async () => {
    const app = new Hono();
    registerUnifiedSkillRoutes(app, { inventory: { list: vi.fn(async () => { throw { code: "NOT_FOUND" }; }), listForAgent: vi.fn() }, requireAuth: async (c: any, next: any) => next(), actor: () => human });
    const notFound = await app.request("/api/skills/inventory");
    expect(notFound.status).toBe(404);
    const storageApp = new Hono();
    registerUnifiedSkillRoutes(storageApp, { inventory: { list: vi.fn(async () => { throw new Error("db offline"); }), listForAgent: vi.fn() }, requireAuth: async (c: any, next: any) => next(), actor: () => human });
    const storage = await storageApp.request("/api/skills/inventory");
    expect(storage.status).toBe(500);
    expect(await storage.json()).toEqual({ error: "OrgOps could not save this change", code: "STORAGE_FAILURE" });
  });

  it("does not advertise the Task 2 history route", async () => {
    const app = new Hono();
    registerUnifiedSkillRoutes(app, { inventory: { list: vi.fn(), listForAgent: vi.fn() }, requireAuth: async (c: any, next: any) => next(), actor: () => human });
    expect((await app.request("/api/agents/agent-1/skills/history?kind=LOCAL&name=x&localOrigin=WORKSPACE")).status).toBe(404);
  });

  it("rejects unknown query keys", async () => {
    const app = new Hono();
    registerUnifiedSkillRoutes(app, { inventory: { list: vi.fn(), listForAgent: vi.fn() }, requireAuth: async (c: any, next: any) => next(), actor: () => human });
    const response = await app.request("/api/skills/inventory?wat=1");
    expect(response.status).toBe(400);
  });
});
