import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Hono, type MiddlewareHandler } from "hono";
import { openDb } from "@orgops/db";
import { CatalogAuditEventSchema, getCoreEventShapes, validateEventAgainstShapes, type ApiExecutionCoordinator, type CatalogAuthority, type HumanAdmin } from "@orgops/schemas";
import { z } from "zod";
import { createApp } from "../app";
import { registerCatalogSourceRoutes } from "../routes/catalog-library";

const digest = `sha256:${"a".repeat(64)}`;
type Principal = "admin" | "human" | "agent" | "runner-global" | "runner-scoped" | "anonymous";

function routeFixture() {
  const app = new Hono();
  const calls: Array<{ method: string; command: unknown; actor: HumanAdmin }> = [];
  const coordinator: ApiExecutionCoordinator = {
    async approveApiExecution(command, actor) {
      calls.push({ method: "approve", command, actor });
      return { releaseId: command.releaseId, approvalState: "APPROVED", runtimeState: "INACTIVE", revision: 2, failureCode: null };
    },
    async activateApiExecution(command, actor) {
      calls.push({ method: "activate", command, actor });
      return { releaseId: command.releaseId, approvalState: "APPROVED", runtimeState: "ACTIVE", revision: 4, failureCode: null };
    },
    async deactivateApiExecution(command, actor) {
      calls.push({ method: "deactivate", command, actor });
      return { releaseId: command.releaseId, approvalState: "APPROVED", runtimeState: "INACTIVE", revision: 6, failureCode: null };
    },
  };
  const requireAuth: MiddlewareHandler = async (c, next) => {
    const principal = c.req.header("x-test-principal") as Principal | undefined;
    if (!principal || principal === "anonymous") return c.json({ error: "Unauthorized" }, 401);
    if (principal === "admin") c.set("user", { id: "human-admin", username: "admin", mustChangePassword: false });
    else if (principal === "human") c.set("user", { id: "human-user", username: "human", mustChangePassword: false });
    else if (principal === "agent") c.set("user", { username: "agent:demo" });
    else c.set("user", { username: "runner", runnerScope: { mode: principal === "runner-global" ? "GLOBAL" : "SCOPED" } });
    await next();
  };
  const requireAdmin: MiddlewareHandler = async (c, next) => {
    if ((c.get("user") as { id?: string }).id !== "human-admin") return c.json({ error: "Administrator access required" }, 403);
    await next();
  };
  registerCatalogSourceRoutes(app, {
    authority: {} as CatalogAuthority,
    apiExecution: coordinator,
    requireAuth,
    requireAdmin,
  });
  return { app, calls };
}

const operations = [
  ["approve", { expectedRevision: 1, digest }],
  ["activate", { expectedRevision: 2 }],
  ["deactivate", { expectedRevision: 4 }],
] as const;

async function send(app: Hono, principal: Principal, operation: typeof operations[number]) {
  return app.request(`/api/catalog-releases/release-skill/api-execution/${operation[0]}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-principal": principal },
    body: JSON.stringify(operation[1]),
  });
}

describe("API execution activation routes", () => {
  it.each(operations)("maps the admin %s route to the exact coordinator command", async (name, body) => {
    const fixture = routeFixture();
    const response = await send(fixture.app, "admin", [name, body] as typeof operations[number]);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fixture.calls).toEqual([{ method: name, command: { releaseId: "release-skill", ...body }, actor: { kind: "HUMAN_ADMIN", id: "human-admin" } }]);
  });

  it.each(operations)("allows only a fresh live admin on %s", async (_name, operationBody) => {
    const operation = [_name, operationBody] as typeof operations[number];
    for (const principal of ["admin", "human", "agent", "runner-global", "runner-scoped", "anonymous"] as const) {
      const fixture = routeFixture();
      const response = await send(fixture.app, principal, operation);
      expect.soft(response.status, principal).toBe(principal === "admin" ? 200 : principal === "anonymous" ? 401 : 403);
      expect.soft(response.headers.get("cache-control"), principal).toBe("no-store");
      expect.soft(fixture.calls.length, principal).toBe(principal === "admin" ? 1 : 0);
    }
  });

  it.each(operations)("authenticates and authorizes before reading the %s body", async name => {
    for (const principal of ["human", "agent", "runner-global", "runner-scoped", "anonymous"] as const) {
      const fixture = routeFixture();
      const response = await fixture.app.request(`/api/catalog-releases/release-skill/api-execution/${name}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-principal": principal },
        body: "{",
      });
      expect(response.status).toBe(principal === "anonymous" ? 401 : 403);
    }
  });

  it("drives real event validation, discovery, scheduled updates, audits, and restart through createApp", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "api-activation-create-app-"));
    const artifactRoot = join(dataDir, "artifacts");
    const installRoot = join(artifactRoot, "demo-skill", "a".repeat(64));
    const moduleBytes = Buffer.from("export const eventShapes = [];\n");
    const moduleDigest = `sha256:${createHash("sha256").update(moduleBytes).digest("hex")}`;
    await mkdir(installRoot, { recursive: true });
    await writeFile(join(installRoot, "event-shapes.ts"), moduleBytes, { mode: 0o644 });
    const db = openDb(":memory:");
    try {
      let failModuleLoad = true;
      const catalogSchema = z.object({ value: z.string() }).strict();
      const configured = {
        db, dataDir, catalogInstallRoot: artifactRoot, adminUser: "admin", adminPass: "admin", runnerToken: "runner-token",
        catalogEventShapeModuleLoader: async (module: { bytes: string }) => {
          expect(module.bytes).toBe(moduleBytes.toString("base64"));
          if (failModuleLoad) throw new Error("authored private error");
          return { eventShapes: [{
            type: "catalog.integration", description: "integration", payloadSchema: catalogSchema,
          }] };
        },
      };
      const { app } = createApp(configured);
      const admin = db.prepare("SELECT id FROM humans WHERE username='admin'").get() as { id: string };
      const manifest = {
        formatVersion: 1, kind: "skill", name: "demo-skill", version: "1.0.0", description: "fixture", author: "OrgOps", license: "MIT",
        compatibility: { orgops: { min: "0.0.1" }, platforms: ["linux"], tools: [] }, secrets: [], dependencies: [],
        files: [{ path: "event-shapes.ts", size: moduleBytes.length, digest: moduleDigest, executable: false }],
        executables: [{ path: "event-shapes.ts", execution: "api-event-shapes" }], digest, skill: { entrypoint: "SKILL.md" },
      };
      db.prepare(`INSERT INTO catalog_sources
        (source_id,display_name,canonical_url,repository_identity,ref,enabled,allow_packages,revision,created_at,updated_at)
        VALUES ('source-integration','Integration','https://example.invalid/integration','integration','main',1,0,1,1,1)`).run();
      db.prepare(`INSERT INTO catalog_package_releases
        (package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,manifest_json,execution_preview_json,warnings_json,created_at)
        VALUES ('release-integration','source-integration','source-integration','skill','demo-skill','1.0.0',?,'a','a','skills/demo-skill',?,?,'[]',1)`)
        .run(digest, JSON.stringify(manifest), JSON.stringify({ apiEventShapes: ["event-shapes.ts"], runnerScripts: [], wrappedCommands: [], externalSources: [] }));
      db.prepare(`INSERT INTO catalog_release_controls
        (package_release_id,review_state,review_digest,reviewed_by_human_id,reviewed_at,revision,created_at,updated_at)
        VALUES ('release-integration','APPROVED',?,?,1,1,1,1)`).run(digest, admin.id);
      db.prepare(`INSERT INTO catalog_installations
        (release_id,artifact_digest,artifact_path,state,installed_by_human_id,installed_at,last_verified_at,revision)
        VALUES ('release-integration',?,?,'INSTALLED',?,1,1,1)`).run(digest, installRoot, admin.id);

      const login = await app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin" }) });
      const cookie = login.headers.get("set-cookie") ?? "";
      const runnerHeaders = { "content-type": "application/json", "x-orgops-runner-token": "runner-token" };
      const postEvent = (payload: unknown = { value: "ok" }) => app.request("/api/events", { method: "POST", headers: runnerHeaders, body: JSON.stringify({ type: "catalog.integration", source: "runner:test", payload, deliverAt: Date.now() + 60_000 }) });
      expect((await postEvent()).status).toBe(400);

      const approvePath = "/api/catalog-releases/release-integration/api-execution/approve";
      expect((await app.request(approvePath, { method: "POST", headers: { "content-type": "application/json", cookie, "x-orgops-runner-token": "runner-token" }, body: JSON.stringify({ expectedRevision: 1, digest }) })).status).toBe(403);
      expect((await app.request(approvePath, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ expectedRevision: 1, digest }) })).status).toBe(200);
      expect((await app.request("/api/catalog-releases/release-integration/api-execution/activate", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ expectedRevision: 2 }) })).status).toBe(500);
      expect((await postEvent()).status).toBe(400);
      expect(db.prepare("SELECT runtime_state,revision FROM catalog_api_activations WHERE release_id='release-integration'").get())
        .toEqual({ runtime_state: "FAILED", revision: 4 });
      failModuleLoad = false;
      expect((await app.request("/api/catalog-releases/release-integration/api-execution/activate", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ expectedRevision: 4 }) })).status).toBe(200);

      (catalogSchema as unknown as { _def: { shape: () => unknown } })._def.shape = () => ({ value: z.number() });
      expect((await postEvent({ value: 1 })).status).toBe(400);
      const created = await postEvent();
      expect(created.status).toBe(201);
      (catalogSchema as unknown as { _def: { shape: () => unknown } })._def.shape = () => ({ value: z.string() });
      const createdBody = await created.json() as { id: string };
      expect((await app.request(`/api/events/${createdBody.id}`, { method: "PATCH", headers: runnerHeaders, body: JSON.stringify({ payload: { value: "updated" } }) })).status).toBe(200);
      const types = await app.request("/api/event-types", { headers: { "x-orgops-runner-token": "runner-token" } });
      expect((await types.json() as { eventTypes: Array<{ type: string }> }).eventTypes).toContainEqual(expect.objectContaining({ type: "catalog.integration" }));

      expect((await app.request("/api/catalog-releases/release-integration/api-execution/deactivate", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ expectedRevision: 6 }) })).status).toBe(200);
      expect((await postEvent()).status).toBe(400);
      expect((await app.request(`/api/events/${createdBody.id}`, { method: "PATCH", headers: runnerHeaders, body: JSON.stringify({ payload: { value: "again" } }) })).status).toBe(400);
      expect(db.prepare("SELECT count(*) AS count FROM events WHERE type='audit.catalog.api_activation.changed'").get()).toEqual({ count: 4 });
      const apiAudits = db.prepare("SELECT id,type,source,status,channel_id,payload_json FROM events WHERE type='audit.catalog.api_activation.changed' ORDER BY created_at").all() as Array<{ id: string; type: string; source: string; status: string; channel_id: string | null; payload_json: string }>;
      expect(apiAudits.map(row => row.type)).toEqual(Array(4).fill("audit.catalog.api_activation.changed"));
      for (const row of apiAudits) {
        const payload = JSON.parse(row.payload_json);
        const event = { type: row.type, source: row.source, status: row.status, channelId: row.channel_id, payload };
        expect(CatalogAuditEventSchema.safeParse(event), JSON.stringify(event)).toMatchObject({ success: true });
        expect(validateEventAgainstShapes(event, getCoreEventShapes()), JSON.stringify(event)).toMatchObject({ ok: true });
        expect(row.channel_id).toBeNull();
        expect(db.prepare("SELECT count(*) AS count FROM event_receipts WHERE event_id=?").get(row.id)).toEqual({ count: 0 });
        expect(row.payload_json).not.toMatch(/authored|private|Error:|SELECT|ciphertext|password|https?:/i);
      }
      expect(db.prepare(`SELECT count(*) AS count FROM event_receipts r JOIN events e ON e.id=r.event_id WHERE e.type='audit.catalog.api_activation.changed'`).get()).toEqual({ count: 0 });

      expect((await app.request("/api/catalog-releases/release-integration/api-execution/activate", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ expectedRevision: 8 }) })).status).toBe(200);
      const restarted = createApp(configured).app;
      expect((await restarted.request("/api/events", { method: "POST", headers: runnerHeaders, body: JSON.stringify({ type: "catalog.integration", source: "runner:test", payload: { value: "restart" } }) })).status).toBe(201);

      const restartedLogin = await restarted.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin" }) });
      const restartedCookie = restartedLogin.headers.get("set-cookie") ?? "";
      db.exec(`CREATE TRIGGER reject_api_activation_audit BEFORE INSERT ON events
        WHEN NEW.type='audit.catalog.api_activation.changed' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;`);
      const failedDeactivation = await restarted.request("/api/catalog-releases/release-integration/api-execution/deactivate", {
        method: "POST", headers: { "content-type": "application/json", cookie: restartedCookie }, body: JSON.stringify({ expectedRevision: 10 }),
      });
      expect(failedDeactivation.status).toBe(500);
      expect(db.prepare("SELECT runtime_state,revision FROM catalog_api_activations WHERE release_id='release-integration'").get())
        .toEqual({ runtime_state: "DEACTIVATING", revision: 11 });
      expect((await restarted.request("/api/events", { method: "POST", headers: runnerHeaders, body: JSON.stringify({ type: "catalog.integration", source: "runner:test", payload: { value: "rollback" } }) })).status).toBe(201);
      db.exec("DROP TRIGGER reject_api_activation_audit");
      const afterFailedRestart = createApp(configured).app;
      expect((await afterFailedRestart.request("/api/events", { method: "POST", headers: runnerHeaders, body: JSON.stringify({ type: "catalog.integration", source: "runner:test", payload: { value: "excluded" } }) })).status).toBe(400);
    } finally { db.close(); await rm(dataDir, { recursive: true, force: true }); }
  });

  it.each(operations)("rejects query, non-JSON, malformed UTF-8, unknown fields, malformed IDs, and streamed overflow on %s", async (name, body) => {
    const invalid = [
      { path: `/api/catalog-releases/release-skill/api-execution/${name}?x=1`, headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      { path: `/api/catalog-releases/release-skill/api-execution/${name}`, headers: { "content-type": "text/plain" }, body: JSON.stringify(body) },
      { path: `/api/catalog-releases/release-skill/api-execution/${name}`, headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, extra: true }) },
      { path: `/api/catalog-releases/INVALID!/api-execution/${name}`, headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      { path: `/api/catalog-releases/release-skill/api-execution/${name}`, headers: { "content-type": "application/json" }, body: new Uint8Array([0x7b, 0xff, 0x7d]) },
    ];
    for (const request of invalid) {
      const fixture = routeFixture();
      const response = await fixture.app.request(request.path, { method: "POST", headers: { ...request.headers, "x-test-principal": "admin" }, body: request.body });
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(fixture.calls).toEqual([]);
    }
    const fixture = routeFixture();
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(16 * 1024)); controller.enqueue(new Uint8Array([1])); controller.close(); } });
    const response = await fixture.app.fetch(new Request(`http://localhost/api/catalog-releases/release-skill/api-execution/${name}`, {
      method: "POST", headers: { "content-type": "application/json", "x-test-principal": "admin" }, body: stream, duplex: "half",
    } as RequestInit & { duplex: "half" }));
    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
