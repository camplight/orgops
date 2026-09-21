import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type OrgOpsDb } from "@orgops/db";
import { createApp } from "../app";
import { approvedRelease } from "./test-fixtures";
import { catalogGrantId } from "./grant-identity";

const opened: Array<{ db: OrgOpsDb; dir: string }> = [];
afterEach(() => { while (opened.length) { const value = opened.pop()!; value.db.close(); rmSync(value.dir, { recursive: true, force: true }); } });
const json = { "content-type": "application/json" };
const digest = `sha256:${"a".repeat(64)}`;

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "orgops-assignment-route-"));
  const db = openDb(":memory:");
  opened.push({ db, dir });
  const created = createApp({ db, dataDir: dir, adminUser: "owner", adminPass: "test-password", runnerToken: "runner-token" });
  const owner = db.prepare<[], { id: string }>("SELECT id FROM humans WHERE username='owner'").get()!.id;
  db.prepare(`INSERT INTO humans (id,username,password_hash,must_change_password,is_admin,created_at,updated_at)
    SELECT 'human-granted','granted',password_hash,0,0,1,1 FROM humans WHERE id=?`).run(owner);
  db.prepare(`INSERT INTO humans (id,username,password_hash,must_change_password,is_admin,created_at,updated_at)
    SELECT 'human-ungranted','ungranted',password_hash,0,0,1,1 FROM humans WHERE id=?`).run(owner);
  const login = async (username: string) => {
    const response = await created.app.request("/api/auth/login", { method: "POST", headers: json, body: JSON.stringify({ username, password: "test-password" }) });
    return response.headers.get("set-cookie")!.match(/orgops_session=[^;]+/)![0];
  };
  const cookies = { admin: await login("owner"), granted: await login("granted"), ungranted: await login("ungranted") };
  const manifest = approvedRelease("skill").manifest;
  db.exec(`
    INSERT INTO runner_nodes (id,display_name,metadata_json,created_at,updated_at,last_seen_at) VALUES ('runner-a','Runner A','{}',1,1,1);
    INSERT INTO models (id,provider,model_name,enabled,defaults_json,created_at) VALUES ('model-a','fixture','fixture',1,'{}',1);
    INSERT INTO agents (id,name,model_id,soul_path,workspace_path,visibility,owner_human_id,assigned_runner_id,created_at,updated_at)
      VALUES ('agent-a','agent-a','model-a','soul','workspace','PRIVATE','${owner}','runner-a',1,1),
             ('agent-granted','agent-granted','model-a','soul','workspace','PRIVATE','human-granted','runner-a',1,1),
             ('agent-ungranted','agent-ungranted','model-a','soul','workspace','PRIVATE','human-ungranted','runner-a',1,1);
    INSERT INTO catalog_sources (source_id,display_name,canonical_url,repository_identity,ref,enabled,allow_packages,revision,created_at,updated_at)
      VALUES ('source-team','Team','https://github.com/example/team','["github","example","team"]','main',1,0,1,1,1);
  `);
  db.prepare(`INSERT INTO catalog_package_releases
    (package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,manifest_json,execution_preview_json,warnings_json,created_at)
    VALUES ('release-skill','source-team','source-team','skill','demo-skill','1.0.0',?,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','skills/demo-skill',?,?,'[]',1)`)
    .run(digest, JSON.stringify(manifest), JSON.stringify({ apiEventShapes: [], runnerScripts: [], wrappedCommands: [], externalSources: [] }));
  db.prepare(`INSERT INTO catalog_release_controls (package_release_id,review_state,review_digest,reviewed_by_human_id,reviewed_at,revision,created_at,updated_at)
    VALUES ('release-skill','APPROVED',?,?,1,1,1,1)`).run(digest, owner);
  db.prepare(`INSERT INTO catalog_installations (release_id,artifact_digest,artifact_path,state,installed_by_human_id,installed_at,last_verified_at,revision)
    VALUES ('release-skill',?,'/private/release-skill','INSTALLED',?,1,1,1)`).run(digest, owner);
  const grantId = catalogGrantId("release-skill", "HUMAN", "human-granted");
  db.prepare(`INSERT INTO catalog_grants
    (grant_id,release_id,subject_type,human_id,revision,created_by_human_id,created_at,updated_at)
    VALUES (?,'release-skill','HUMAN','human-granted',1,?,1,1)`).run(grantId, owner);
  const scopedToken = "org_rt_assignment_test";
  db.prepare(`INSERT INTO runner_tokens
    (id,name,token_hash,token_prefix,allowed_agent_name,allowed_runner_id,allowed_channel_ids_json,invite_id,created_by_human_id,created_at)
    VALUES ('assignment-token','Assignment runner',?,?,'agent-a','runner-a','[]',NULL,?,1)`)
    .run(createHash("sha256").update(scopedToken).digest("hex"), scopedToken.slice(0, 16), owner);
  return { ...created, db, cookies, scopedToken };
}

describe("PUT/DELETE /api/agents/:name/catalog-skills/:packageReleaseId", () => {
  it("creates an exact normalized assignment and durable runner-bound deployment", async () => {
    const value = await fixture();
    const response = await value.app.request("/api/agents/agent-a/catalog-skills/release-skill", {
      method: "PUT", headers: { ...json, cookie: value.cookies.admin },
      body: JSON.stringify({ expectedAgentRevision: 1, expectedAssignmentRevision: 0, preload: true }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ desiredState: "ENABLED", effectiveState: "DISABLED", deploymentState: "REQUESTED", revision: 1 });
    expect(value.db.prepare("SELECT release_id,local_skill_name,desired_state,effective_state,deployment_state,preload FROM agent_skill_assignments").get())
      .toEqual({ release_id: "release-skill", local_skill_name: "demo-skill", desired_state: "ENABLED", effective_state: "DISABLED", deployment_state: "REQUESTED", preload: 1 });
    expect(value.db.prepare("SELECT target_agent_id,release_id,bound_runner_id,state FROM runner_package_deployments").get())
      .toEqual({ target_agent_id: "agent-a", release_id: "release-skill", bound_runner_id: "runner-a", state: "QUEUED" });
  });
});

describe("manageable agent assignment projection", () => {
  it("omits removal tombstone metadata while preserving an active sibling", async () => {
    const value = await fixture();
    value.db.exec(`INSERT INTO agents (id,name,model_id,soul_path,workspace_path,visibility,owner_human_id,assigned_runner_id,created_at,updated_at)
      SELECT 'agent-active','agent-active',model_id,soul_path,workspace_path,visibility,owner_human_id,assigned_runner_id,1,1 FROM agents WHERE id='agent-a';
      INSERT INTO agent_skill_assignments (assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,removal_requested,preload,effective_preload,active_generation,desired_generation,revision,actor_kind,actor_human_id,created_at,updated_at)
      VALUES ('assignment-removed','agent-a','release-skill','removed-private-name','DISABLED','DISABLED','STABLE',1,0,0,'removed-generation','removed-generation',88,'ADMIN','human-granted',1,1),
             ('assignment-active','agent-active','release-skill','demo-skill','ENABLED','ENABLED','STABLE',0,1,1,'active-generation','active-generation',5,'ADMIN','human-granted',1,1);`);
    const response = await value.app.request("/api/library/packages/release-skill/manageable-agents", { headers: { cookie: value.cookies.admin } });
    expect(response.status).toBe(200);
    const body = await response.json() as Array<{ id: string; assignmentRevision: number; effectiveState: string; preload: boolean }>;
    expect(body.find(agent => agent.id === "agent-a")).toMatchObject({ assignmentRevision: 0, effectiveState: "DISABLED", preload: false });
    expect(body.find(agent => agent.id === "agent-active")).toMatchObject({ assignmentRevision: 5, effectiveState: "ENABLED", preload: true });
    expect(JSON.stringify(body)).not.toContain("removed-private-name");
    expect(JSON.stringify(body)).not.toContain("88");
  });
});

describe("assignment route authorization and transport contract", () => {
  const assign = (value: Awaited<ReturnType<typeof fixture>>, agent: string, cookie: string | undefined,
    body: unknown = { expectedAgentRevision: 1, expectedAssignmentRevision: 0, preload: false },
    method = "PUT", extraHeaders: Record<string, string> = {}, suffix = "", releaseId = "release-skill") => value.app.request(
      `/api/agents/${agent}/catalog-skills/${releaseId}${suffix}`,
      { method, headers: { ...json, ...(cookie ? { cookie } : {}), ...extraHeaders }, body: JSON.stringify(body) },
    );

  it("applies the exact denied-principal contract to both PUT and DELETE", async () => {
    const cases = [
      ["granted-owner", "agent-granted", "granted", 200, undefined, undefined],
      ["ungranted-owner", "agent-ungranted", "ungranted", 403, undefined, { error: "A current grant is required", code: "GRANT_REQUIRED" }],
      ["admin-unmanageable", "agent-granted", "admin", 403, undefined, { error: "Administrator access required", code: "FORBIDDEN" }],
      ["granted-unmanageable", "agent-a", "granted", 403, undefined, { error: "Administrator access required", code: "FORBIDDEN" }],
      ["global-runner", "agent-a", "admin", 403, "runner-token", { error: "Authenticated human access required" }],
      ["scoped-runner", "agent-a", "admin", 403, "scoped", { error: "Authenticated human access required" }],
      ["anonymous", "agent-a", undefined, 401, undefined, { error: "Unauthorized" }],
    ] as const;
    for (const method of ["PUT", "DELETE"] as const) {
      for (const [label, agent, cookieName, status, runner, expectedBody] of cases) {
        const value = await fixture();
        const cookie = cookieName ? value.cookies[cookieName] : undefined;
        const response = await assign(value, agent, cookie, undefined, method, runner ? {
          "x-orgops-runner-token": runner === "scoped" ? value.scopedToken : runner,
        } : {});
        expect.soft(response.status, `${method}:${label}`).toBe(status);
        expect.soft(response.headers.get("cache-control"), `${method}:${label}`).toBe("no-store");
        if (expectedBody) expect.soft(await response.json(), `${method}:${label}`).toEqual(expectedBody);
      }
    }
  });

  it("does not enumerate any target-local state for an unmanageable agent", async () => {
    const cases = [
      ["stale agent revision", (value: Awaited<ReturnType<typeof fixture>>) => ({ expectedAgentRevision: 99, expectedAssignmentRevision: 0, preload: false })],
      ["stale assignment revision", (value: Awaited<ReturnType<typeof fixture>>) => ({ expectedAgentRevision: 1, expectedAssignmentRevision: 99, preload: false })],
      ["unassigned runner", (value: Awaited<ReturnType<typeof fixture>>) => {
        value.db.prepare("UPDATE agents SET assigned_runner_id=NULL WHERE id='agent-granted'").run();
        return { expectedAgentRevision: 1, expectedAssignmentRevision: 0, preload: false };
      }],
      ["maximum assignment revision", (value: Awaited<ReturnType<typeof fixture>>) => {
        value.db.prepare(`INSERT INTO agent_skill_assignments
          (assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,preload,effective_preload,
           active_generation,desired_generation,revision,actor_kind,actor_human_id,created_at,updated_at)
          VALUES ('private-max','agent-granted','release-skill','demo-skill','DISABLED','DISABLED','FAILED',0,0,NULL,'old',2147483647,'ADMIN',
            (SELECT id FROM humans WHERE username='owner'),1,1)`).run();
        return { expectedAgentRevision: 1, expectedAssignmentRevision: 2147483647, preload: false };
      }],
      ["legacy collision", (value: Awaited<ReturnType<typeof fixture>>) => {
        value.db.prepare(`UPDATE agents SET enabled_skills_json='["demo-skill"]' WHERE id='agent-granted'`).run();
        return { expectedAgentRevision: 1, expectedAssignmentRevision: 0, preload: false };
      }],
    ] as const;
    for (const method of ["PUT", "DELETE"] as const) {
      for (const [label, arrange] of cases) {
        const value = await fixture();
        const requestBody = arrange(value);
        const before = {
          assignments: value.db.prepare("SELECT count(*) AS count FROM agent_skill_assignments").get(),
          deployments: value.db.prepare("SELECT count(*) AS count FROM runner_package_deployments").get(),
          events: value.db.prepare("SELECT count(*) AS count FROM events").get(),
        };
        const response = await assign(value, "agent-granted", value.cookies.admin, requestBody, method);
        expect.soft(response.status, `${method}:${label}`).toBe(403);
        expect.soft(await response.json(), `${method}:${label}`).toEqual({ error: "Administrator access required", code: "FORBIDDEN" });
        expect.soft(response.headers.get("cache-control"), `${method}:${label}`).toBe("no-store");
        expect.soft({
          assignments: value.db.prepare("SELECT count(*) AS count FROM agent_skill_assignments").get(),
          deployments: value.db.prepare("SELECT count(*) AS count FROM runner_package_deployments").get(),
          events: value.db.prepare("SELECT count(*) AS count FROM events").get(),
        }, `${method}:${label}`).toEqual(before);
      }
    }
  });

  it("hides absent and malformed releases behind target manageability for both methods", async () => {
    const releaseCases = [
      ["absent release", (_value: Awaited<ReturnType<typeof fixture>>) => "release-absent"],
      ["malformed release", (value: Awaited<ReturnType<typeof fixture>>) => {
        value.db.prepare("UPDATE catalog_package_releases SET manifest_json='{}' WHERE package_release_id='release-skill'").run();
        return "release-skill";
      }],
    ] as const;
    const actorCases = [
      ["ordinary human", "agent-a", "granted"],
      ["admin", "agent-granted", "admin"],
    ] as const;
    for (const method of ["PUT", "DELETE"] as const) {
      for (const [releaseLabel, arrangeRelease] of releaseCases) {
        for (const [actorLabel, agent, cookieName] of actorCases) {
          const missing = await fixture();
          const missingReleaseId = arrangeRelease(missing);
          const missingResponse = await assign(missing, "missing-agent", missing.cookies[cookieName], undefined,
            method, {}, "", missingReleaseId);
          const missingBody = await missingResponse.json();

          const existing = await fixture();
          const existingReleaseId = arrangeRelease(existing);
          const before = {
            assignments: existing.db.prepare("SELECT count(*) AS count FROM agent_skill_assignments").get(),
            deployments: existing.db.prepare("SELECT count(*) AS count FROM runner_package_deployments").get(),
            audits: existing.db.prepare("SELECT count(*) AS count FROM events WHERE type='audit.catalog.assignment.changed'").get(),
          };
          const response = await assign(existing, agent, existing.cookies[cookieName], undefined,
            method, {}, "", existingReleaseId);
          const label = `${method}:${releaseLabel}:${actorLabel}`;
          expect.soft(response.status, label).toBe(missingResponse.status);
          expect.soft(await response.json(), label).toEqual(missingBody);
          expect.soft(response.status, label).toBe(403);
          expect.soft(missingBody, label).toEqual({ error: "Administrator access required", code: "FORBIDDEN" });
          expect.soft(response.headers.get("cache-control"), label).toBe("no-store");
          expect.soft(missingResponse.headers.get("cache-control"), label).toBe("no-store");
          expect.soft({
            assignments: existing.db.prepare("SELECT count(*) AS count FROM agent_skill_assignments").get(),
            deployments: existing.db.prepare("SELECT count(*) AS count FROM runner_package_deployments").get(),
            audits: existing.db.prepare("SELECT count(*) AS count FROM events WHERE type='audit.catalog.assignment.changed'").get(),
          }, label).toEqual(before);
        }
      }
    }
  });

  it("routes DELETE through a new bound generation while preserving prior effective state", async () => {
    const value = await fixture();
    const enabled = await assign(value, "agent-a", value.cookies.admin, { expectedAgentRevision: 1, expectedAssignmentRevision: 0, preload: true });
    expect(enabled.status).toBe(200);
    const first = await enabled.json() as any;
    value.db.prepare("UPDATE runner_package_deployments SET state='ACTIVE',completed_at=2 WHERE desired_generation=?").run(first.desiredGeneration);
    value.db.prepare(`UPDATE agent_skill_assignments SET effective_state='ENABLED',effective_preload=1,deployment_state='STABLE',
      active_generation=desired_generation WHERE assignment_id=?`).run(first.assignmentId);
    const disabled = await assign(value, "agent-a", value.cookies.admin,
      { expectedAgentRevision: 1, expectedAssignmentRevision: 1, preload: false }, "DELETE");
    expect(disabled.status).toBe(200);
    expect(await disabled.json()).toMatchObject({ desiredState: "DISABLED", effectiveState: "ENABLED", activeGeneration: first.desiredGeneration, revision: 2 });
  });

  it("enforces strict bounded JSON, query rejection, canonical IDs and runner-header precedence", async () => {
    for (const [label, body, headers, suffix, expected] of [
      ["unknown", { expectedAgentRevision: 1, expectedAssignmentRevision: 0, preload: false, owner: "human-a" }, {}, "", 400],
      ["fraction", { expectedAgentRevision: 1.5, expectedAssignmentRevision: 0, preload: false }, {}, "", 400],
      ["missing", { expectedAgentRevision: 1, expectedAssignmentRevision: 0 }, {}, "", 400],
      ["query", { expectedAgentRevision: 1, expectedAssignmentRevision: 0, preload: false }, {}, "?owner=human-a", 400],
      ["wrong-content", { expectedAgentRevision: 1, expectedAssignmentRevision: 0, preload: false }, { "content-type": "text/plain" }, "", 400],
      ["invalid-runner-precedence", { expectedAgentRevision: 1, expectedAssignmentRevision: 0, preload: false }, { "x-orgops-runner-token": "invalid" }, "", 401],
    ] as const) {
      const value = await fixture();
      const response = await assign(value, "agent-a", value.cookies.admin, body, "PUT", headers, suffix);
      expect.soft(response.status, label).toBe(expected);
      expect.soft(response.headers.get("cache-control"), label).toBe("no-store");
    }
    const value = await fixture();
    const tooLarge = await value.app.request("/api/agents/agent-a/catalog-skills/release-skill", {
      method: "PUT", headers: { ...json, cookie: value.cookies.admin }, body: JSON.stringify({ padding: "x".repeat(17_000) }),
    });
    expect(tooLarge.status).toBe(413);
    const invalidUtf8 = await value.app.request("/api/agents/agent-a/catalog-skills/release-skill", {
      method: "PUT", headers: { ...json, cookie: value.cookies.admin }, body: new Uint8Array([0xc3, 0x28]),
    });
    expect(invalidUtf8.status).toBe(400);
    const invalidBody = await assign(value, "agent-a", value.cookies.admin, {}, "PUT", {}, "");
    expect(invalidBody.headers.get("cache-control")).toBe("no-store");
    const malformedId = await value.app.request("/api/agents/agent-a/catalog-skills/BAD%20ID", {
      method: "PUT", headers: { ...json, cookie: value.cookies.admin },
      body: JSON.stringify({ expectedAgentRevision: 1, expectedAssignmentRevision: 0, preload: false }),
    });
    expect(malformedId.status).toBe(404);
  });

  it.each([
    ["source", "UPDATE catalog_sources SET enabled=0", 403, "SOURCE_NOT_ALLOWED"],
    ["review", "UPDATE catalog_release_controls SET review_state='WITHDRAWN'", 409, "RELEASE_NOT_APPROVED"],
    ["install", "UPDATE catalog_installations SET state='QUARANTINED'", 409, "INSTALLATION_REQUIRED"],
    ["API activation", `UPDATE catalog_package_releases SET execution_preview_json='{"apiEventShapes":["event-shapes.ts"],"runnerScripts":[],"wrappedCommands":[],"externalSources":[]}'`, 409, "API_ACTIVATION_REQUIRED"],
  ] as const)("rereads current %s state in the mutation transaction", async (_name, sql, status, code) => {
    const value = await fixture();
    value.db.exec(sql);
    const response = await assign(value, "agent-a", value.cookies.admin);
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code });
    expect(value.db.prepare("SELECT count(*) AS count FROM agent_skill_assignments").get()).toEqual({ count: 0 });
  });
});

describe("agent revision and runner projection integration", () => {
  it("increments assignment-relevant agent configuration but not heartbeat-only updates", async () => {
    const value = await fixture();
    const before = await value.app.request("/api/agents/agent-a", { headers: { cookie: value.cookies.admin } });
    expect((await before.json() as any).revision).toBe(1);
    const config = await value.app.request("/api/agents/agent-a", {
      method: "PATCH", headers: { ...json, cookie: value.cookies.admin }, body: JSON.stringify({ workspacePath: "workspace-next" }),
    });
    expect(config.status).toBe(200);
    expect(value.db.prepare("SELECT revision FROM agents WHERE id='agent-a'").get()).toEqual({ revision: 2 });
    const heartbeat = await value.app.request("/api/agents/agent-a", {
      method: "PATCH", headers: { ...json, "x-orgops-runner-token": "runner-token" },
      body: JSON.stringify({ lastHeartbeatAt: 1234, runtimeState: "RUNNING" }),
    });
    expect(heartbeat.status).toBe(200);
    expect(value.db.prepare("SELECT revision FROM agents WHERE id='agent-a'").get()).toEqual({ revision: 2 });
    const stale = await value.app.request("/api/agents/agent-a/catalog-skills/release-skill", {
      method: "PUT", headers: { ...json, cookie: value.cookies.admin },
      body: JSON.stringify({ expectedAgentRevision: 1, expectedAssignmentRevision: 0, preload: false }),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "REVISION_CONFLICT" });
  });

  it("advances ownership and every successful configuration update with guarded revisions", async () => {
    const ownership = await fixture();
    const transferred = await ownership.app.request("/api/agents/agent-a", {
      method: "PATCH", headers: { ...json, cookie: ownership.cookies.admin }, body: JSON.stringify({ ownerHumanId: "human-ungranted" }),
    });
    expect(transferred.status).toBe(200);
    expect(ownership.db.prepare("SELECT owner_human_id,revision FROM agents WHERE id='agent-a'").get())
      .toEqual({ owner_human_id: "human-ungranted", revision: 2 });

    const concurrent = await fixture();
    const updates = await Promise.all(["workspace-one", "workspace-two"].map(workspacePath => concurrent.app.request("/api/agents/agent-a", {
      method: "PATCH", headers: { ...json, cookie: concurrent.cookies.admin }, body: JSON.stringify({ workspacePath }),
    })));
    expect(updates.map(response => response.status)).toEqual([200, 200]);
    expect(concurrent.db.prepare("SELECT revision FROM agents WHERE id='agent-a'").get()).toEqual({ revision: 3 });

    concurrent.db.prepare("UPDATE agents SET revision=2147483647 WHERE id='agent-a'").run();
    const overflow = await concurrent.app.request("/api/agents/agent-a", {
      method: "PATCH", headers: { ...json, cookie: concurrent.cookies.admin }, body: JSON.stringify({ workspacePath: "overflow" }),
    });
    expect(overflow.status).toBe(409);
    expect(await overflow.json()).toEqual({ error: "Agent revision conflict" });
    expect(concurrent.db.prepare("SELECT revision FROM agents WHERE id='agent-a'").get()).toEqual({ revision: 2147483647 });
  });

  it("rolls back every agent and the runner when deregistration encounters revision overflow", async () => {
    const value = await fixture();
    value.db.prepare("UPDATE agents SET revision=2147483647 WHERE id='agent-granted'").run();
    const dashboard: unknown[] = [];
    const unsubscribe = value.bus.subscribe("org:dashboard", event => dashboard.push(event));
    const eventCount = value.db.prepare("SELECT count(*) AS count FROM events").get();
    const response = await value.app.request("/api/runners/runner-a", { method: "DELETE", headers: { cookie: value.cookies.admin } });
    unsubscribe();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Agent revision conflict" });
    expect(value.db.prepare("SELECT name,assigned_runner_id,revision FROM agents ORDER BY name").all()).toEqual([
      { name: "agent-a", assigned_runner_id: "runner-a", revision: 1 },
      { name: "agent-granted", assigned_runner_id: "runner-a", revision: 2147483647 },
      { name: "agent-ungranted", assigned_runner_id: "runner-a", revision: 1 },
    ]);
    expect(value.db.prepare("SELECT count(*) AS count FROM runner_nodes WHERE id='runner-a'").get()).toEqual({ count: 1 });
    expect(value.db.prepare("SELECT count(*) AS count FROM events").get()).toEqual(eventCount);
    expect(dashboard).toEqual([]);
  });

  it("rolls back invite redemption when agent reassignment revision overflows", async () => {
    const value = await fixture();
    const channel = await value.app.request("/api/channels", {
      method: "POST", headers: { ...json, cookie: value.cookies.admin }, body: JSON.stringify({ name: "invite-overflow", kind: "GROUP" }),
    });
    expect(channel.status).toBe(201);
    const channelId = (await channel.json() as { id: string }).id;
    const invite = await value.app.request("/api/agent-invites", {
      method: "POST", headers: { ...json, cookie: value.cookies.admin },
      body: JSON.stringify({ name: "overflow", agentName: "agent-a", channelIds: [channelId] }),
    });
    expect(invite.status).toBe(201);
    const inviteBody = await invite.json() as { id: string; inviteLink: string };
    const token = decodeURIComponent(inviteBody.inviteLink.split("/public/")[1]!);
    value.db.prepare("UPDATE agents SET revision=2147483647 WHERE id='agent-a'").run();
    const before = {
      tokens: value.db.prepare("SELECT count(*) AS count FROM runner_tokens").get(),
      channels: value.db.prepare("SELECT count(*) AS count FROM channels").get(),
      subscriptions: value.db.prepare("SELECT count(*) AS count FROM channel_subscriptions").get(),
    };
    const response = await value.app.request(`/api/agent-invites/public/${encodeURIComponent(token)}/redeem`, { method: "POST" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Agent revision conflict" });
    expect(value.db.prepare("SELECT assigned_runner_id,revision FROM agents WHERE id='agent-a'").get())
      .toEqual({ assigned_runner_id: "runner-a", revision: 2147483647 });
    expect({
      tokens: value.db.prepare("SELECT count(*) AS count FROM runner_tokens").get(),
      channels: value.db.prepare("SELECT count(*) AS count FROM channels").get(),
      subscriptions: value.db.prepare("SELECT count(*) AS count FROM channel_subscriptions").get(),
    }).toEqual(before);
    expect(value.db.prepare("SELECT use_count,last_redeemed_at FROM agent_invites WHERE id=?").get(inviteBody.id))
      .toEqual({ use_count: 0, last_redeemed_at: null });
  });

  it("returns only effective normalized names to authenticated runners and fails duplicate projection", async () => {
    const value = await fixture();
    const response = await value.app.request("/api/agents/agent-a/catalog-skills/release-skill", {
      method: "PUT", headers: { ...json, cookie: value.cookies.admin },
      body: JSON.stringify({ expectedAgentRevision: 1, expectedAssignmentRevision: 0, preload: true }),
    });
    expect(response.status).toBe(200);
    const requested = await value.app.request("/api/agents?assignedRunnerId=runner-a", { headers: { "x-orgops-runner-token": "runner-token" } });
    expect((await requested.json() as any[]).find(agent => agent.name === "agent-a")).toMatchObject({ enabledSkills: [], alwaysPreloadedSkills: [] });
    value.db.prepare("UPDATE agent_skill_assignments SET effective_state='ENABLED',effective_preload=1,active_generation=desired_generation").run();
    const active = await value.app.request("/api/agents?assignedRunnerId=runner-a", { headers: { "x-orgops-runner-token": "runner-token" } });
    expect((await active.json() as any[]).find(agent => agent.name === "agent-a")).toMatchObject({ enabledSkills: ["demo-skill"], alwaysPreloadedSkills: ["demo-skill"] });
    value.db.prepare(`UPDATE agents SET enabled_skills_json='["demo-skill"]' WHERE id='agent-a'`).run();
    const ambiguous = await value.app.request("/api/agents?assignedRunnerId=runner-a", { headers: { "x-orgops-runner-token": "runner-token" } });
    expect(ambiguous.status).toBe(409);
    expect(await ambiguous.json()).toEqual({ error: "Agent skill projection conflicts with current state", code: "STATE_CONFLICT" });
    const detail = await value.app.request("/api/agents/agent-a", { headers: { "x-orgops-runner-token": "runner-token" } });
    expect(detail.status).toBe(409);
    expect(await detail.json()).toEqual({ error: "Agent skill projection conflicts with current state", code: "STATE_CONFLICT" });
  });

  it("filters inaccessible agents before attempting normalized projection", async () => {
    const value = await fixture();
    value.db.prepare(`INSERT INTO agent_skill_assignments
      (assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,preload,effective_preload,
       active_generation,desired_generation,revision,actor_kind,actor_human_id,created_at,updated_at)
      VALUES ('hidden-corrupt','agent-granted','release-skill','demo-skill','ENABLED','ENABLED','REQUESTED',0,0,NULL,'next',1,'ADMIN',
       (SELECT id FROM humans WHERE username='owner'),1,1)`).run();
    const humanDetail = await value.app.request("/api/agents/agent-granted", { headers: { cookie: value.cookies.admin } });
    expect(humanDetail.status).toBe(404);
    expect(await humanDetail.json()).toEqual({ error: "Not found" });
    const scopedList = await value.app.request("/api/agents", { headers: { "x-orgops-runner-token": value.scopedToken } });
    expect(scopedList.status).toBe(200);
    expect((await scopedList.json() as Array<{ name: string }>).map(agent => agent.name)).toEqual(["agent-a"]);
    const scopedDetail = await value.app.request("/api/agents/agent-granted", { headers: { "x-orgops-runner-token": value.scopedToken } });
    expect(scopedDetail.status).toBe(404);
    expect(await scopedDetail.json()).toEqual({ error: "Not found" });
  });
});

describe("assignment provenance revocation independence", () => {
  it("keeps the existing assignment and exact provenance after grant revocation but denies a new command", async () => {
    const value = await fixture();
    const enabled = await value.app.request("/api/agents/agent-granted/catalog-skills/release-skill", {
      method: "PUT", headers: { ...json, cookie: value.cookies.granted },
      body: JSON.stringify({ expectedAgentRevision: 1, expectedAssignmentRevision: 0, preload: false }),
    });
    expect(enabled.status).toBe(200);
    const before = value.db.prepare("SELECT assignment_id,grant_id,desired_state FROM agent_skill_assignments WHERE agent_id='agent-granted'").get();
    value.db.prepare("UPDATE catalog_grants SET revoked_at=2 WHERE human_id='human-granted'").run();
    const denied = await value.app.request("/api/agents/agent-granted/catalog-skills/release-skill", {
      method: "DELETE", headers: { ...json, cookie: value.cookies.granted },
      body: JSON.stringify({ expectedAgentRevision: 1, expectedAssignmentRevision: 1, preload: false }),
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ code: "GRANT_REQUIRED" });
    expect(value.db.prepare("SELECT assignment_id,grant_id,desired_state FROM agent_skill_assignments WHERE agent_id='agent-granted'").get()).toEqual(before);
  });
});

describe("canonical empty-generation removal", () => {
  it("remove-last persists a tombstone deployment and runner poll freezes empty roots", async () => {
    const value = await fixture();
    value.db.prepare(`INSERT INTO agent_skill_assignments
      (assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,preload,effective_preload,active_generation,desired_generation,revision,actor_kind,actor_human_id,created_at,updated_at)
      VALUES ('assignment-active','agent-a','release-skill','demo-skill','ENABLED','ENABLED','STABLE',1,1,'old-generation','old-generation',2,'ADMIN',(SELECT id FROM humans WHERE username='owner'),1,1)`).run();
    const removed = await value.app.request("/api/agents/agent-a/skills", {
      method: "PATCH", headers: { ...json, cookie: value.cookies.admin },
      body: JSON.stringify({ kind: "CATALOG", operation: "REMOVE", agentId: "agent-a", packageReleaseId: "release-skill", expectedAgentRevision: 1, expectedAssignmentRevision: 2 }),
    });
    expect(removed.status).toBe(200);
    expect(value.db.prepare("SELECT desired_state,effective_state,deployment_state,preload,desired_generation FROM agent_skill_assignments WHERE assignment_id='assignment-active'").get()).toMatchObject({ desired_state: "DISABLED", effective_state: "ENABLED", deployment_state: "REQUESTED", preload: 0 });
    const deployment = value.db.prepare("SELECT deployment_id,desired_generation,state FROM runner_package_deployments WHERE target_agent_id='agent-a'").get() as { deployment_id: string; desired_generation: string; state: string };
    expect(deployment.state).toBe("QUEUED");
    const poll = await value.app.request("/api/runners/runner-a/package-deployments", { headers: { "x-orgops-runner-token": "runner-token", "x-orgops-runner-id": "runner-a" } });
    expect(poll.status).toBe(200);
    expect((await poll.json() as any[]).find(item => item.deploymentId === deployment.deployment_id)).toMatchObject({ desiredRoots: [], desiredGeneration: deployment.desired_generation });
    expect(value.db.prepare("SELECT COUNT(*) AS count FROM runner_deployment_participants WHERE deployment_id=?").get(deployment.deployment_id)).toEqual({ count: 1 });
  });
});
