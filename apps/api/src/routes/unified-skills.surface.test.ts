import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openDb } from "@orgops/db";
import { createApp } from "../app";

const featureManifest = [
  "DELETE /api/agents/:name",
  "DELETE /api/agents/:name/catalog-skills/:packageReleaseId",
  "DELETE /api/catalog-releases/:packageReleaseId/grants/humans/:humanId",
  "DELETE /api/catalog-releases/:packageReleaseId/grants/organization",
  "DELETE /api/catalog-sources/:sourceId",
  "DELETE /api/catalog-sources/:sourceId/read-credential",
  "GET /api/agents",
  "GET /api/agents/:agentId/skills",
  "GET /api/agents/:name",
  "GET /api/agents/:name/start-readiness",
  "GET /api/agents/:agentId/skills/history",
  "GET /api/agents/template-options",
  "GET /api/catalog-releases",
  "GET /api/catalog-releases/:packageReleaseId",
  "GET /api/catalog-releases/:packageReleaseId/grants",
  "GET /api/catalog-rollouts/:rolloutId",
  "GET /api/catalog-sources",
  "GET /api/catalog-sources/:sourceId",
  "GET /api/catalog-sources/:sourceId/snapshots",
  "GET /api/catalog-sources/:sourceId/sync-attempts",
  "GET /api/library/packages",
  "GET /api/library/packages/:packageReleaseId",
  "GET /api/library/packages/:packageReleaseId/manageable-agents",
  "GET /api/library/packages/:packageReleaseId/template-options",
  "GET /api/runner-package-deployments/:deploymentId/artifact",
  "GET /api/runners/:runnerId/agents/:agentName/start-requirements",
  "GET /api/runners/:runnerId/package-deployments",
  "GET /api/skills",
  "GET /api/skills/inventory",
  "PATCH /api/agents/:agentId/skills",
  "PATCH /api/agents/:name",
  "PATCH /api/catalog-sources/:sourceId",
  "POST /api/agents",
  "POST /api/agents/:agentId/skills/preflight",
  "POST /api/agents/provision",
  "POST /api/agents/:name/:action",
  "POST /api/catalog-releases/:packageReleaseId/api-execution/activate",
  "POST /api/catalog-releases/:packageReleaseId/api-execution/approve",
  "POST /api/catalog-releases/:packageReleaseId/api-execution/deactivate",
  "POST /api/catalog-releases/:packageReleaseId/approve",
  "POST /api/catalog-releases/:packageReleaseId/install",
  "POST /api/catalog-releases/:packageReleaseId/reject",
  "POST /api/catalog-releases/:packageReleaseId/reopen",
  "POST /api/catalog-releases/:packageReleaseId/withdraw",
  "POST /api/catalog-rollouts",
  "POST /api/catalog-rollouts/:rolloutId/cancel",
  "POST /api/catalog-rollouts/:rolloutId/retry-failed",
  "POST /api/catalog-rollouts/plan",
  "POST /api/catalog-sources",
  "POST /api/catalog-sources/:sourceId/restore",
  "POST /api/catalog-sources/:sourceId/sync",
  "POST /api/library/templates/:packageReleaseId/instances",
  "POST /api/runner-package-deployments/:deploymentId/claim",
  "POST /api/runner-package-deployments/:deploymentId/report",
  "POST /api/runners/:id/heartbeat",
  "POST /api/runners/register",
  "PUT /api/agents/:name/catalog-skills/:packageReleaseId",
  "PUT /api/catalog-releases/:packageReleaseId/grants/humans/:humanId",
  "PUT /api/catalog-releases/:packageReleaseId/grants/organization",
  "PUT /api/catalog-sources/:sourceId/read-credential",
  "PUT /api/library/agents/:agentId/requirements/:requirementName/secret-binding",
].sort();

const retiredAliases = [
  "/api/catalogs",
  "/api/catalogs/legacy",
  "/api/catalogs/legacy/sync",
  "/api/catalogs/legacy/packages",
  "/api/catalogs/legacy/packages/demo-skill/1.0.0",
  "/api/catalogs/legacy/deep/path",
];

function isFeaturePath(path: string) {
  if (path === "/api/agents" || path === "/api/agents/:name") return true;
  return /^\/api\/(?:catalog-sources|catalog-releases|catalog-rollouts|library\/|skills(?:$|\/)|runner-package-deployments\/|runners\/(?:register|[^/]+\/heartbeat|[^/]+\/package-deployments|[^/]+\/agents\/[^/]+\/start-requirements)|agents\/(?:[^/]+\/(?:skills|catalog-skills|start-readiness)|:name\/:action|provision|template-options))/.test(path);
}
function routePairs(app: { routes: Array<{ method: string; path: string }> }) {
  return [...new Set(app.routes.filter(route => route.method !== "ALL" && isFeaturePath(route.path)).map(route => `${route.method.toUpperCase()} ${route.path}`))].sort();
}
function concretePath(path: string) {
  return path.replace(":agentId", "agent-1").replace(":name", "agent-1").replace(":action", "start").replace(":packageReleaseId", "release-1").replace(":sourceId", "source-1").replace(":humanId", "human-1").replace(":rolloutId", "rollout-1").replace(":runnerId", "runner-1").replace(":agentName", "agent-1").replace(":deploymentId", "deployment-1").replace(":requirementName", "API_KEY").replace(":id", "runner-1");
}
function makeApp() {
  const db = openDb(":memory:");
  const dataDir = mkdtempSync(join(tmpdir(), "orgops-route-surface-"));
  const app = createApp({ db, dataDir, adminUser: "admin", adminPass: "admin", runnerToken: "global-token" }).app;
  return { app, db, dataDir };
}

describe("unified skills actual Hono route surface", () => {
  it("matches the independently reviewed whole feature manifest exactly", () => {
    const { app, db, dataDir } = makeApp();
    try { expect(routePairs(app)).toEqual(featureManifest); } finally { db.close(); rmSync(dataDir, { recursive: true, force: true }); }
  });

  it("serves privacy-safe owner/admin start readiness from the central gate", async () => {
    const { app, db, dataDir } = makeApp();
    try {
      db.exec("INSERT INTO runner_nodes(id,display_name,metadata_json,created_at,updated_at,last_seen_at) VALUES ('runner-1','Runner','{}',1,1,1); INSERT INTO models(id,provider,model_name,enabled,defaults_json,created_at) VALUES ('model','p','m',1,'{}',1); INSERT INTO agents(id,name,model_id,soul_path,workspace_path,assigned_runner_id,desired_state,runtime_state,created_at,updated_at) VALUES ('agent-1','agent-1','model','soul','/tmp/workspace','runner-1','STOPPED','STOPPED',1,1)");
      const login = await app.request("http://localhost/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin" }) });
      const response = await app.request("http://localhost/api/agents/agent-1/start-readiness", { headers: { cookie: login.headers.get("set-cookie") ?? "" } });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ ready: true, queuedDeployment: false, blockers: [] });
      expect(await (await app.request("http://localhost/api/agents/missing/start-readiness", { headers: { cookie: login.headers.get("set-cookie") ?? "" } })).json()).toEqual({ error: "Not found", code: "NOT_FOUND" });
    } finally { db.close(); rmSync(dataDir, { recursive: true, force: true }); }
  });

  it("rejects an exactly assigned and allowed scoped runner from human start readiness", async () => {
    const { app, db, dataDir } = makeApp();
    try {
      const admin = db.prepare<[], { id: string }>("SELECT id FROM humans WHERE username='admin'").get()!;
      db.exec("INSERT INTO runner_nodes(id,display_name,metadata_json,created_at,updated_at,last_seen_at) VALUES ('runner-1','Runner','{}',1,1,1); INSERT INTO models(id,provider,model_name,enabled,defaults_json,created_at) VALUES ('model','p','m',1,'{}',1); INSERT INTO agents(id,name,model_id,soul_path,workspace_path,assigned_runner_id,desired_state,runtime_state,created_at,updated_at) VALUES ('agent-1','agent-1','model','soul','/tmp/workspace','runner-1','STOPPED','STOPPED',1,1)");
      const scopedToken = "org_rt_exact_readiness_scope";
      db.prepare("INSERT INTO runner_tokens(id,name,token_hash,token_prefix,allowed_agent_name,allowed_runner_id,allowed_channel_ids_json,created_by_human_id,created_at) VALUES ('readiness-scope','Readiness scope',?,?,?,?,'[]',?,1)").run(createHash("sha256").update(scopedToken).digest("hex"), scopedToken.slice(0, 16), "agent-1", "runner-1", admin.id);
      const response = await app.request("http://localhost/api/agents/agent-1/start-readiness", { headers: { "x-orgops-runner-token": scopedToken, "x-orgops-runner-id": "runner-1" } });
      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: "Forbidden", code: "FORBIDDEN" });
    } finally { db.close(); rmSync(dataDir, { recursive: true, force: true }); }
  });

  it("proves concrete start behavior separately from the generic action route", async () => {
    const { app, db, dataDir } = makeApp();
    try {
      db.exec("INSERT INTO agents(id,name,model_id,soul_path,workspace_path,created_at,updated_at) VALUES ('agent-1','agent-1','model','soul','workspace/agent-1',1,1)");
      const login = await app.request("http://localhost/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin" }) });
      const cookie = login.headers.get("set-cookie") ?? "";
      const started = await app.request("http://localhost/api/agents/agent-1/start", { method: "POST", headers: { cookie } });
      expect(started.status).not.toBe(404);
      expect(started.headers.get("cache-control")).toBe("no-store");
      const invalid = await app.request("http://localhost/api/agents/agent-1/not-an-action", { method: "POST", headers: { cookie } });
      expect(invalid.status).toBe(400);
    } finally { db.close(); rmSync(dataDir, { recursive: true, force: true }); }
  });

  it.each(featureManifest.filter(route => !route.startsWith("GET /api/skills") && !route.startsWith("GET /api/catalog")))
    ("protects %s with an explicit non-404 auth response and no-store", async route => {
      const { app, db, dataDir } = makeApp();
      try {
        const method = route.split(" ", 1)[0]!;
        const response = await app.request(`http://localhost${concretePath(route.slice(method.length + 1))}`, { method, headers: method === "GET" ? undefined : { "content-type": "application/json" }, body: method === "GET" ? undefined : "{}" });
        expect(response.status).not.toBe(404);
        expect(response.headers.get("cache-control")).toBe("no-store");
      } finally { db.close(); rmSync(dataDir, { recursive: true, force: true }); }
    });

  it("applies runner-header precedence and unsupported-credential status across every new protected family", async () => {
    const { app, db, dataDir } = makeApp();
    try {
      const login = await app.request("http://localhost/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin" }) });
      const cookie = login.headers.get("set-cookie") ?? "";
      const admin = db.prepare<{ username: string }, { id: string }>("SELECT id FROM humans WHERE username=@username").get({ username: "admin" })!;
      db.prepare("INSERT INTO humans(id,username,password_hash,must_change_password,is_admin,created_at,updated_at) VALUES ('ordinary','ordinary',(SELECT password_hash FROM humans WHERE id=?),0,0,1,1)").run(admin.id);
      db.exec("INSERT INTO agents(id,name,model_id,soul_path,workspace_path,created_at,updated_at) VALUES ('agent-1','agent-1','model','soul','workspace/agent-1',1,1)");
      const scopedToken = "org_rt_surface_matrix";
      db.prepare("INSERT INTO runner_tokens(id,name,token_hash,token_prefix,allowed_agent_name,allowed_runner_id,allowed_channel_ids_json,created_by_human_id,created_at) VALUES ('surface-scope','Surface scope',?,?,?,?,'[]',?,1)").run(createHash("sha256").update(scopedToken).digest("hex"), scopedToken.slice(0, 16), "agent-1", "runner-1", admin.id);
      const ordinaryLogin = await app.request("http://localhost/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "ordinary", password: "admin" }) });
      const ordinaryCookie = ordinaryLogin.headers.get("set-cookie") ?? "";
      const routes = [
        ["GET", "/api/skills/inventory"], ["GET", "/api/skills/inventory?agentId=agent-1"], ["GET", "/api/agents/agent-1/skills"], ["GET", "/api/agents/agent-1/skills/history?kind=LOCAL&name=missing&localOrigin=WORKSPACE"],
        ["POST", "/api/agents/agent-1/skills/preflight"], ["PATCH", "/api/agents/agent-1/skills"], ["GET", "/api/agents/template-options"], ["POST", "/api/agents/provision"], ["GET", "/api/agents/agent-1/start-readiness"], ["POST", "/api/agents/agent-1/start"],
      ] as const;
      const bodyFor = (method: string, path: string) => path.includes("/preflight") ? { selection: [] } : path.endsWith("/skills") && method === "PATCH" ? { kind: "LOCAL", operation: "REMOVE", agentId: "agent-1", name: "missing", expectedAgentRevision: 1 } : path.endsWith("/provision") ? { kind: "BLANK", idempotencyKey: "00000000-0000-4000-8000-000000000098", name: "matrix-agent", visibility: "PRIVATE", mode: "CLASSIC", modelId: "model", workspacePath: "workspace/matrix-agent", runnerId: "runner-1", desiredState: "STOPPED", localSkills: [], catalogSkills: [] } : undefined;
      const request = (method: string, path: string, headers: Record<string, string>) => { const body = bodyFor(method, path); return app.request(`http://localhost${path}`, { method, headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); };
      const precedenceHeaders: Array<Record<string, string>> = [{}, { cookie, "x-orgops-runner-token": "invalid" }, { cookie, "x-orgops-runner-token": "" }];
      const principalHeaders: Array<[string, Record<string, string>, "runner" | "admin" | "ordinary" | "agent"]> = [
        ["global", { "x-orgops-runner-token": "global-token" }, "runner"], ["scoped", { "x-orgops-runner-token": scopedToken }, "runner"], ["wrong-scoped", { "x-orgops-runner-token": scopedToken, "x-orgops-runner-id": "wrong-runner" }, "runner"],
        ["invite-agent", { "x-orgops-runner-token": scopedToken }, "runner"], ["unsupported-agent", { "x-orgops-agent-token": "agent-token" }, "agent"], ["admin", { cookie }, "admin"], ["ordinary", { cookie: ordinaryCookie }, "ordinary"],
      ];
      for (const [method, path] of routes) {
        for (const headers of precedenceHeaders) {
          const response = await request(method, path, headers);
          expect(response.status).toBe(401);
          expect(await response.json()).toMatchObject({ error: "Unauthorized", code: "UNAUTHORIZED" });
          expect(response.headers.get("cache-control")).toBe("no-store");
        }
        for (const [principal, headers, kind] of principalHeaders) {
          const response = await request(method, path, headers);
          if (kind === "runner") {
            expect(response.status).toBe(403);
            const runnerBody = await response.json();
            expect(runnerBody).toMatchObject({ code: "FORBIDDEN" });
          } else if (kind === "agent") {
            expect(response.status).toBe(401);
            expect(await response.json()).toMatchObject({ error: "Unauthorized", code: "UNAUTHORIZED" });
          } else {
            const expected = path.endsWith("/provision") ? 400 : path.includes("/skills") && method === "PATCH" ? 404 : 200;
            expect(response.status, `${principal} ${method} ${path}`).toBe(expected);
          }
          expect(response.headers.get("cache-control")).toBe("no-store");
        }
      }
    } finally { db.close(); rmSync(dataDir, { recursive: true, force: true }); }
  });

  it("keeps retired Catalog aliases principal-independent and redaction-safe", async () => {
    const { app, db, dataDir } = makeApp();
    try {
      for (const path of retiredAliases) for (const headers of [{}, { "x-orgops-runner-token": "global-token" }, { "x-orgops-runner-token": "invalid" }] as Array<Record<string, string>>) {
        const response = await app.request(`http://localhost${path}`, { headers });
        expect(response.status).toBe(404);
        expect(await response.text()).not.toMatch(/CATALOG_RESOURCE_RETIRED|sourceId|credential|secret|private/i);
      }
    } finally { db.close(); rmSync(dataDir, { recursive: true, force: true }); }
  });
});
