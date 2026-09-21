import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDb, type OrgOpsDb } from "@orgops/db";
import { createApp } from "../app";
import { createRunnerApi } from "../../../agent-runner/src/runner/api";
import { createRunnerState } from "../../../agent-runner/src/runner/state";
import { validateCatalogAgentLocally } from "../../../agent-runner/src/runner";

const opened: Array<{ db: OrgOpsDb; dir: string }> = [];
afterEach(() => {
  while (opened.length) {
    const fixture = opened.pop()!;
    fixture.db.close();
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

function runnerFixture() {
  const dir = mkdtempSync(join(tmpdir(), "orgops-start-gate-route-"));
  const db = openDb(":memory:");
  opened.push({ db, dir });
  const created = createApp({ db, dataDir: dir, runnerToken: "runner-token" });
  db.exec(`
    INSERT INTO runner_nodes (id,display_name,metadata_json,created_at,updated_at,last_seen_at)
      VALUES ('runner-a','Runner A','{}',1,1,1),('runner-b','Runner B','{}',1,1,1);
    INSERT INTO models (id,provider,model_name,enabled,defaults_json,created_at)
      VALUES ('model-a','fixture','fixture',1,'{}',1);
    INSERT INTO agents (id,name,model_id,soul_path,workspace_path,assigned_runner_id,desired_state,runtime_state,created_at,updated_at)
      VALUES ('agent-a','agent-a','model-a','soul','workspace','runner-a','STOPPED','STOPPED',1,1);
  `);
  return { ...created, db };
}

describe("runner start requirements delivery", () => {
  it("serves the central validator only to the agent's exact assigned registered runner", async () => {
    const fixture = runnerFixture();
    const allowed = await fixture.app.request("/api/runners/runner-a/agents/agent-a/start-requirements", {
      headers: { "x-orgops-runner-token": "runner-token" },
    });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("cache-control")).toBe("no-store");
    expect(await allowed.json()).toEqual({ ok: true });

    const wrongRunner = await fixture.app.request("/api/runners/runner-b/agents/agent-a/start-requirements", {
      headers: { "x-orgops-runner-token": "runner-token" },
    });
    expect(wrongRunner.status).toBe(403);

    const anonymous = await fixture.app.request("/api/runners/runner-a/agents/agent-a/start-requirements");
    expect(anonymous.status).toBe(401);
    const login = await fixture.app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }) });
    expect((await fixture.app.request("/api/runners/runner-a/agents/agent-a/start-requirements",
      { headers: { cookie: login.headers.get("set-cookie") ?? "" } })).status).toBe(401);
    const owner = fixture.db.prepare<[], { id: string }>("SELECT id FROM humans WHERE username='admin'").get()!.id;
    const scopedToken = "org_rt_start_gate_scoped";
    fixture.db.prepare(`INSERT INTO runner_tokens
      (id,name,token_hash,token_prefix,allowed_agent_name,allowed_runner_id,allowed_channel_ids_json,created_by_human_id,created_at)
      VALUES ('start-gate-token','Start gate',?,?, 'agent-a','runner-a','[]',?,1)`)
      .run(createHash("sha256").update(scopedToken).digest("hex"), scopedToken.slice(0, 16), owner);
    const forbiddenRequests = [
      fixture.app.request("/api/runners/runner-a/agents/other/start-requirements", { headers: { "x-orgops-runner-token": scopedToken } }),
      fixture.app.request("/api/runners/runner-b/agents/agent-a/start-requirements", { headers: { "x-orgops-runner-token": scopedToken } }),
      fixture.app.request("/api/runners/runner-a/agents/missing/start-requirements", { headers: { "x-orgops-runner-token": "runner-token" } }),
      fixture.app.request("/api/runners/runner-b/agents/agent-a/start-requirements", { headers: { "x-orgops-runner-token": "runner-token" } }),
      fixture.app.request("/api/runners/missing-runner/agents/agent-a/start-requirements", { headers: { "x-orgops-runner-token": "runner-token" } }),
    ];
    const forbidden = await Promise.all(forbiddenRequests);
    const normalized = await Promise.all(forbidden.map(async response => ({
      status: response.status,
      body: await response.text(),
      cacheControl: response.headers.get("cache-control"),
      contentType: response.headers.get("content-type"),
    })));
    expect(new Set(normalized.map(value => JSON.stringify(value)))).toEqual(new Set([JSON.stringify({
      status: 403, body: JSON.stringify({ error: "Forbidden", code: "FORBIDDEN" }), cacheControl: "no-store", contentType: "application/json",
    })]));
    const query = await fixture.app.request("/api/runners/runner-a/agents/agent-a/start-requirements?detail=1", {
      headers: { "x-orgops-runner-token": "runner-token" },
    });
    expect(query.status).toBe(400);
  });

  it("uses the registered runner ID in the strict runner client and rejects malformed results", async () => {
    const dir = mkdtempSync(join(tmpdir(), "orgops-runner-client-"));
    const state = createRunnerState();
    state.registeredRunnerId = "runner-a";
    const requests: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      requests.push(String(input));
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const api = createRunnerApi({ apiUrl: "http://api.test", runnerToken: "token", heartbeatIntervalMs: 1000,
      runnerIdFile: join(dir, "runner-id"), runnerState: state });
    await expect(api.getAgentStartRequirements("agent/a")).resolves.toEqual({ ok: true });
    expect(requests).toEqual(["http://api.test/api/runners/runner-a/agents/agent%2Fa/start-requirements"]);
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, details: "private" }), { status: 200 }));
    await expect(api.getAgentStartRequirements("agent-a")).rejects.toThrow();
    fetchSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects a catalog workspace symlink escape before workspace creation", () => {
    const root = mkdtempSync(join(tmpdir(), "orgops-runner-root-"));
    const outside = mkdtempSync(join(tmpdir(), "orgops-runner-outside-"));
    mkdirSync(join(root, "workspaces"));
    symlinkSync(outside, join(root, "workspaces", "agent-a"));
    const result = validateCatalogAgentLocally({ name: "agent-a", systemInstructions: "", soulPath: "soul",
      workspacePath: join(root, "workspaces", "agent-a"), modelId: "model-a", desiredState: "RUNNING",
      runtimeState: "STARTING", mode: "CLASSIC", catalogDerived: true }, root);
    expect(result).toEqual({ ok: false, code: "REQUIREMENTS_UNSATISFIED", reasons: [{ code: "WORKSPACE_BINDING_MISSING" }] });
    expect(existsSync(join(outside, "created-by-runner"))).toBe(false);
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
});
