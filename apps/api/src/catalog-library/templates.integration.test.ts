import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type OrgOpsDb } from "@orgops/db";
import type { PackageManifest } from "@orgops/schemas";
import { createApp } from "../app";
import { catalogGrantId } from "./grant-identity";
import { approvedRelease } from "./test-fixtures";

const opened: Array<{ db: OrgOpsDb; dir: string }> = [];
afterEach(() => { while (opened.length) { const value = opened.pop()!; value.db.close(); rmSync(value.dir, { recursive: true, force: true }); } });
const json = { "content-type": "application/json" };
const digest = `sha256:${"a".repeat(64)}`;
const templateBody = (name = "agent-from-template") => ({ name, visibility: "PRIVATE", runnerId: "runner-a",
  workspacePath: `.orgops-data/workspaces/${name}`, modelId: "model-a", secretBindings: [] });

async function login(app: ReturnType<typeof createApp>["app"], username: string) {
  const response = await app.request("/api/auth/login", { method: "POST", headers: json, body: JSON.stringify({ username, password: "test-password" }) });
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")!.match(/orgops_session=[^;]+/)![0];
}

function insertRelease(db: OrgOpsDb, owner: string, id: string, manifest: PackageManifest) {
  db.prepare(`INSERT INTO catalog_package_releases
    (package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,manifest_json,execution_preview_json,warnings_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)`).run(id, "source-team", "source-team", manifest.kind, manifest.name, manifest.version, manifest.digest,
      "a".repeat(40), "a".repeat(40), `agents/${manifest.name}`, JSON.stringify(manifest),
      JSON.stringify({ apiEventShapes: [], runnerScripts: [], wrappedCommands: [], externalSources: [] }), "[]");
  db.prepare(`INSERT INTO catalog_release_controls
    (package_release_id,review_state,review_digest,reviewed_by_human_id,reviewed_at,revision,created_at,updated_at)
    VALUES (?,'APPROVED',?,?,1,1,1,1)`).run(id, digest, owner);
  db.prepare(`INSERT INTO catalog_installations
    (release_id,artifact_digest,artifact_path,state,installed_by_human_id,installed_at,last_verified_at,revision)
    VALUES (?,?,?,'INSTALLED',?,1,1,1)`).run(id, digest, `/private/catalog-artifacts/${id}`, owner);
}

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "orgops-template-route-"));
  const db = openDb(":memory:");
  opened.push({ db, dir });
  const created = createApp({ db, dataDir: dir, adminUser: "owner", adminPass: "test-password", runnerToken: "runner-token" });
  const owner = db.prepare<[], { id: string }>("SELECT id FROM humans WHERE username='owner'").get()!.id;
  db.prepare(`INSERT INTO humans (id,username,password_hash,must_change_password,is_admin,created_at,updated_at)
    SELECT 'human-granted','granted',password_hash,0,0,1,1 FROM humans WHERE id=?`).run(owner);
  db.prepare(`INSERT INTO humans (id,username,password_hash,must_change_password,is_admin,created_at,updated_at)
    SELECT 'human-ungranted','ungranted',password_hash,0,0,1,1 FROM humans WHERE id=?`).run(owner);
  db.exec(`
    INSERT INTO runner_nodes (id,display_name,metadata_json,created_at,updated_at,last_seen_at) VALUES ('runner-a','Runner A','{}',1,1,1);
    INSERT INTO models (id,provider,model_name,enabled,defaults_json,created_at) VALUES ('model-a','fixture','fixture',1,'{}',1);
    INSERT INTO catalog_sources (source_id,display_name,canonical_url,repository_identity,ref,enabled,allow_packages,revision,created_at,updated_at)
      VALUES ('source-team','Team','https://github.com/example/team','["github","example","team"]','main',1,0,1,1,1);
  `);
  const native = approvedRelease("native-agent").manifest as Extract<PackageManifest, { kind: "native-agent" }>;
  insertRelease(db, owner, "release-native-rlm", native);
  insertRelease(db, owner, "release-native-classic", { ...native, name: "demo-classic", native: { ...native.native, mode: "CLASSIC",
    systemInstructions: "Reviewed portable instructions", soulContents: "Reviewed portable soul",
    runtime: { llmCallTimeoutMs: 1000, classicMaxModelSteps: 4, emitAuditEvents: false }, suggestedModel: { provider: "fixture", modelName: "fixture" } } });
  insertRelease(db, owner, "release-wrapped", approvedRelease("wrapped-agent").manifest);
  insertRelease(db, owner, "release-skill", approvedRelease("skill").manifest);
  db.prepare(`INSERT INTO catalog_grants
    (grant_id,release_id,subject_type,human_id,revision,revoked_at,created_by_human_id,created_at,updated_at)
    VALUES (?,?, 'HUMAN','human-granted',1,NULL,?,1,1)`)
    .run(catalogGrantId("release-native-rlm", "HUMAN", "human-granted"), "release-native-rlm", owner);
  db.prepare(`INSERT INTO secrets (id,name,scope_type,scope_id,ciphertext_b64,created_at)
    VALUES ('secret-a','TOKEN','package','demo-native','DO_NOT_EXPORT_SECRET_VALUE',1)`).run();
  const scopedToken = "org_rt_template_test";
  db.prepare(`INSERT INTO runner_tokens
    (id,name,token_hash,token_prefix,allowed_agent_name,allowed_runner_id,allowed_channel_ids_json,invite_id,created_by_human_id,created_at)
    VALUES ('template-token','Template runner',?,?,NULL,NULL,'[]',NULL,?,1)`)
    .run(createHash("sha256").update(scopedToken).digest("hex"), scopedToken.slice(0, 16), owner);
  return { ...created, db, owner, scopedToken, cookies: {
    admin: await login(created.app, "owner"), granted: await login(created.app, "granted"), ungranted: await login(created.app, "ungranted"),
  } };
}

async function post(value: Awaited<ReturnType<typeof fixture>>, releaseId: string, cookie: string | undefined, body: unknown = templateBody(), headers: Record<string, string> = {}) {
  return value.app.request(`/api/library/templates/${releaseId}/instances`, {
    method: "POST", headers: { ...(cookie ? { cookie } : {}), ...json, ...headers }, body: JSON.stringify(body),
  });
}

describe("POST /api/library/templates/:packageReleaseId/instances", () => {
  it("requires an injected project root to be absolute and canonical", () => {
    const dir = mkdtempSync(join(tmpdir(), "orgops-project-root-"));
    const db = openDb(":memory:");
    const linkedDb = openDb(":memory:");
    const link = `${dir}-link`;
    try {
      expect(() => createApp({ db, projectRoot: `${dir}/` })).toThrow();
      symlinkSync(dir, link);
      expect(() => createApp({ db: linkedDb, projectRoot: link })).toThrow();
    } finally { db.close(); linkedDb.close(); rmSync(link, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); }
  });

  it("authorizes admin and granted owner, derives owner from the live session, and denies ungranted/runner/anonymous", async () => {
    const cases = [
      ["admin", 201, undefined], ["granted", 201, undefined], ["ungranted", 403, undefined],
      ["admin", 403, "runner-token"], ["admin", 403, "SCOPED"], ["anonymous", 401, undefined],
    ] as const;
    for (const [principal, status, runner] of cases) {
      const value = await fixture();
      const cookie = principal === "anonymous" ? undefined : value.cookies[principal];
      const response = await post(value, "release-native-rlm", cookie, templateBody(`agent-${principal}-${runner ?? "human"}`),
        runner ? { "x-orgops-runner-token": runner === "SCOPED" ? value.scopedToken : runner } : {});
      expect.soft(response.status, `${principal}/${runner}`).toBe(status);
      expect.soft(response.headers.get("cache-control")).toBe("no-store");
      if (status === 201) {
        const result = await response.json() as any;
        expect(result.agent.ownerHumanId).toBeUndefined();
        expect(result.origin.actorHumanId).toBeUndefined();
        expect(JSON.stringify(result)).not.toContain(value.owner);
        expect(JSON.stringify(result)).not.toContain("human-granted");
      } else if (runner) {
        expect(await response.json()).toEqual({ error: "Authenticated human access required" });
      } else if (principal === "anonymous") {
        expect(await response.json()).toEqual({ error: "Unauthorized" });
      }
    }
  });

  it.each([
    ["release-native-classic", "CLASSIC"], ["release-native-rlm", "RLM_REPL"], ["release-wrapped", "WRAPPED"],
  ] as const)("creates %s stopped from reviewed positive fields only", async (releaseId, mode) => {
    const value = await fixture();
    const response = await post(value, releaseId, value.cookies.admin, templateBody(`agent-${mode.toLowerCase()}`));
    expect(response.status).toBe(201);
    const result = await response.json() as any;
    expect(result.agent).toMatchObject({ mode, desiredState: "STOPPED", runtimeState: "STOPPED", channelIds: [] });
    expect(JSON.stringify(result)).not.toMatch(/command|path|repository|warning|review|grantId|secretId|DO_NOT_EXPORT/i);
    const row = value.db.prepare("SELECT * FROM agents WHERE name=?").get(`agent-${mode.toLowerCase()}`) as any;
    expect(row.desired_state).toBe("STOPPED"); expect(row.runtime_state).toBe("STOPPED");
    expect(row.enabled_skills_json).toBe("[]"); expect(row.always_preloaded_skills_json).toBe("[]");
    if (mode === "CLASSIC") expect(row).toMatchObject({ system_instructions: "Reviewed portable instructions", soul_contents: "Reviewed portable soul", llm_call_timeout_ms: 1000, classic_max_model_steps: 4, emit_audit_events: 0 });
    if (mode === "WRAPPED") expect(JSON.parse(row.wrapped_config_json)).not.toHaveProperty("source");
    expect(value.db.prepare("SELECT count(*) AS count FROM channels").get()).toEqual({ count: 0 });
    expect(value.db.prepare("SELECT count(*) AS count FROM processes").get()).toEqual({ count: 0 });
  });

  it("enforces strict media type, fatal UTF-8, streamed 16KiB, no query, unknown fields and duplicate bindings", async () => {
    const value = await fixture();
    const path = "/api/library/templates/release-native-rlm/instances";
    const badRequests = [
      Promise.resolve(value.app.request(path, { method: "POST", headers: { cookie: value.cookies.admin, "content-type": "text/plain" }, body: JSON.stringify(templateBody()) })),
      Promise.resolve(value.app.request(`${path}?ownerHumanId=${value.owner}`, { method: "POST", headers: { cookie: value.cookies.admin, ...json }, body: JSON.stringify(templateBody()) })),
      post(value, "release-native-rlm", value.cookies.admin, { ...templateBody(), desiredState: "RUNNING" }),
      post(value, "release-native-rlm", value.cookies.admin, { ...templateBody(), secretBindings: [{ requirementName: "TOKEN", secretId: "secret-a" }, { requirementName: "TOKEN", secretId: "secret-a" }] }),
      Promise.resolve(value.app.request(path, { method: "POST", headers: { cookie: value.cookies.admin, ...json }, body: new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xff, 0x7d]) })),
    ];
    for (const response of await Promise.all(badRequests)) expect.soft(response.status).toBe(400);
    const tooLarge = await value.app.request(path, { method: "POST", headers: { cookie: value.cookies.admin, ...json }, body: JSON.stringify({ ...templateBody(), workspacePath: "x".repeat(17 * 1024) }) });
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toEqual({ error: "Catalog library request too large", code: "PAYLOAD_TOO_LARGE" });
    expect(value.db.prepare("SELECT count(*) AS count FROM agent_template_origins").get()).toEqual({ count: 0 });
  });

  it("fails closed on stale/deleted/must-reset sessions and every runner header overrides an admin cookie", async () => {
    const stale = await fixture();
    stale.db.prepare("UPDATE humans SET must_change_password=1 WHERE id='human-granted'").run();
    expect((await post(stale, "release-native-rlm", stale.cookies.granted)).status).toBe(403);
    const deleted = await fixture();
    deleted.db.prepare("DELETE FROM humans WHERE id='human-ungranted'").run();
    expect((await post(deleted, "release-native-rlm", deleted.cookies.ungranted)).status).toBe(403);
    const runner = await fixture();
    expect((await post(runner, "release-native-rlm", runner.cookies.admin, templateBody(), { "x-orgops-runner-token": "runner-token" })).status).toBe(403);
    for (const token of ["invalid-runner-token", ""]) {
      const response = await post(runner, "release-native-rlm", runner.cookies.admin, templateBody(`invalid-runner-${token.length}`),
        { "x-orgops-runner-token": token });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    }
  });

  it("rejects symlink workspace escapes while canonicalizing safe existing and nonexistent contained paths", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "orgops-template-project-"));
    const outside = mkdtempSync(join(tmpdir(), "orgops-template-outside-"));
    const previousRoot = process.env.ORGOPS_PROJECT_ROOT;
    mkdirSync(join(projectRoot, "safe"));
    symlinkSync(outside, join(projectRoot, "escape"));
    process.env.ORGOPS_PROJECT_ROOT = projectRoot;
    try {
      const value = await fixture();
      if (previousRoot === undefined) delete process.env.ORGOPS_PROJECT_ROOT;
      else process.env.ORGOPS_PROJECT_ROOT = previousRoot;

      const escaped = await post(value, "release-native-rlm", value.cookies.admin,
        { ...templateBody("escaped-agent"), workspacePath: "escape/child" });
      expect(escaped.status).toBe(400);
      expect(value.db.prepare("SELECT count(*) AS count FROM agents WHERE name='escaped-agent'").get()).toEqual({ count: 0 });
      expect(value.db.prepare("SELECT count(*) AS count FROM agent_template_origins").get()).toEqual({ count: 0 });
      expect(value.db.prepare("SELECT count(*) AS count FROM events WHERE type='audit.catalog.template.instantiated'").get()).toEqual({ count: 0 });

      expect((await post(value, "release-native-rlm", value.cookies.admin,
        { ...templateBody("safe-agent"), workspacePath: "safe" })).status).toBe(201);
      expect(value.db.prepare("SELECT workspace_path FROM agents WHERE name='safe-agent'").get())
        .toEqual({ workspace_path: join(projectRoot, "safe") });

      const nonexistent = join(projectRoot, "safe", "not-created", "child");
      expect((await post(value, "release-native-rlm", value.cookies.admin,
        { ...templateBody("future-agent"), workspacePath: "safe/not-created/child" })).status).toBe(201);
      expect(value.db.prepare("SELECT workspace_path FROM agents WHERE name='future-agent'").get())
        .toEqual({ workspace_path: nonexistent });
      expect(existsSync(nonexistent)).toBe(false);
    } finally {
      if (previousRoot === undefined) delete process.env.ORGOPS_PROJECT_ROOT;
      else process.env.ORGOPS_PROJECT_ROOT = previousRoot;
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it.each([
    ["review withdrawal", "UPDATE catalog_release_controls SET review_state='WITHDRAWN' WHERE package_release_id='release-native-rlm'", 409, "RELEASE_NOT_APPROVED"],
    ["source disablement", "UPDATE catalog_sources SET enabled=0 WHERE source_id='source-team'", 403, "SOURCE_NOT_ALLOWED"],
    ["uninstall", "DELETE FROM catalog_installations WHERE release_id='release-native-rlm'", 409, "INSTALLATION_REQUIRED"],
    ["quarantine", "UPDATE catalog_installations SET state='QUARANTINED' WHERE release_id='release-native-rlm'", 409, "INSTALLATION_REQUIRED"],
    ["digest drift", `UPDATE catalog_installations SET artifact_digest='sha256:${"b".repeat(64)}' WHERE release_id='release-native-rlm'`, 409, "INSTALLATION_REQUIRED"],
  ] as const)("rechecks current %s immediately before creation", async (_name, mutation, status, code) => {
    const value = await fixture(); value.db.exec(mutation);
    const response = await post(value, "release-native-rlm", value.cookies.admin);
    expect(response.status).toBe(status); expect(await response.json()).toMatchObject({ code });
    expect(value.db.prepare("SELECT count(*) AS count FROM agent_template_origins").get()).toEqual({ count: 0 });
  });

  it("rechecks grants and API activation and returns fixed redacted errors", async () => {
    const grant = await fixture();
    grant.db.prepare("UPDATE catalog_grants SET revoked_at=2 WHERE release_id='release-native-rlm'").run();
    const revoked = await post(grant, "release-native-rlm", grant.cookies.granted);
    expect(revoked.status).toBe(403); expect(await revoked.json()).toMatchObject({ code: "GRANT_REQUIRED" });

    const api = await fixture();
    api.db.prepare(`UPDATE catalog_package_releases SET execution_preview_json=? WHERE package_release_id='release-native-rlm'`)
      .run(JSON.stringify({ apiEventShapes: ["event-shapes.ts"], runnerScripts: [], wrappedCommands: [], externalSources: [] }));
    const inactive = await post(api, "release-native-rlm", api.cookies.admin);
    const inactiveText = await inactive.text();
    expect(inactive.status).toBe(409); expect(JSON.parse(inactiveText)).toMatchObject({ code: "API_ACTIVATION_REQUIRED" });
    expect(inactiveText).not.toMatch(/sql|private|artifact/i);
  });

  it("validates runner, workspace, model and supplied secret references without disclosing submitted values", async () => {
    const cases = [
      [{ ...templateBody(), runnerId: "missing-runner" }, 400],
      [{ ...templateBody(), workspacePath: "/outside/project" }, 400],
      [{ ...templateBody(), modelId: "missing-model" }, 400],
      [{ ...templateBody(), secretBindings: [{ requirementName: "UNKNOWN", secretId: "secret-a" }] }, 400],
    ] as const;
    for (const [body, status] of cases) {
      const value = await fixture(); const response = await post(value, "release-native-rlm", value.cookies.admin, body);
      expect(response.status).toBe(status); expect(JSON.stringify(await response.json())).not.toContain("missing-");
    }
  });

  it("never mutates an existing unmanageable name and handles duplicate retries deterministically", async () => {
    const value = await fixture();
    value.db.prepare(`INSERT INTO agents (id,name,model_id,soul_path,workspace_path,owner_human_id,visibility,created_at,updated_at)
      VALUES ('other-agent','owned-name','model-a','soul','workspace','human-ungranted','PRIVATE',1,1)`).run();
    const forbidden = await post(value, "release-native-rlm", value.cookies.granted, templateBody("owned-name"));
    expect(forbidden.status).toBe(403);
    expect(value.db.prepare("SELECT owner_human_id FROM agents WHERE id='other-agent'").get()).toEqual({ owner_human_id: "human-ungranted" });

    const first = await post(value, "release-native-rlm", value.cookies.admin, templateBody("same-name"));
    const second = await post(value, "release-native-rlm", value.cookies.admin, templateBody("same-name"));
    expect(first.status).toBe(201); expect(second.status).toBe(403);
    expect(value.db.prepare("SELECT count(*) AS count FROM agents WHERE name='same-name'").get()).toEqual({ count: 1 });
    expect(value.db.prepare("SELECT count(*) AS count FROM events WHERE type='audit.catalog.template.instantiated'").get()).toEqual({ count: 1 });
  });

  it("persists one delivered channel-less privacy-safe audit and no receipts or secret values", async () => {
    const value = await fixture();
    const response = await post(value, "release-native-rlm", value.cookies.admin, templateBody("audited-agent"));
    expect(response.status).toBe(201);
    const audit = value.db.prepare("SELECT payload_json,channel_id,status FROM events WHERE type='audit.catalog.template.instantiated'").get() as any;
    expect(audit).toMatchObject({ channel_id: null, status: "DELIVERED" });
    expect(audit.payload_json).not.toMatch(/secret|command|path|repository|warning|review|grant/i);
    expect(value.db.prepare("SELECT count(*) AS count FROM event_receipts").get()).toEqual({ count: 0 });
    expect(JSON.stringify(await response.json())).not.toContain("DO_NOT_EXPORT_SECRET_VALUE");
  });

  it("rejects malformed IDs, skill releases, and absent releases", async () => {
    const value = await fixture();
    for (const [id, expected] of [["BAD ID", 404], ["release-skill", 409], ["missing-release", 404]] as const) {
      const response = await post(value, id, value.cookies.admin); expect.soft(response.status, id).toBe(expected);
    }
    expect((await value.app.request("/api/catalog-sources", { headers: { cookie: value.cookies.granted } })).status).toBe(403);
  });
});
