import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { registerAgentSkillRoutes } from "./agent-skills";
import { AgentSkillManagementError } from "../unified-skills/management";

function fixture(execute?: () => Promise<any>) {
  const app = new Hono<any>();
  app.use("*", async (c, next) => { c.set("user", { id: "human-1", username: "admin" }); await next(); });
  registerAgentSkillRoutes(app, {
    requireAuth: async (_c: any, next: any) => next(),
    actor: () => ({ kind: "HUMAN_ADMIN", id: "human-1" }),
    management: { execute: execute ?? (async () => ({ ref: { kind: "LOCAL", name: "x" }, desired: "ENABLED", effective: "ENABLED", preload: false, deployment: "STABLE", revision: 2, agentRevision: 2 })), executeBatch: async () => ({ agentRevision: 2, catalogSetChanged: false, results: [] }), updateLocalBatch: async () => ({ agentRevision: 2, catalogSetChanged: false, results: [] }), updateLocalBatchInTransaction: () => ({ agentRevision: 2, catalogSetChanged: false, results: [] }), executeLegacyCatalog: async () => ({ ref: { kind: "CATALOG", packageReleaseId: "r" }, desired: "ENABLED", effective: "DISABLED", preload: false, deployment: "REQUESTED", revision: 1, agentRevision: 1 }), preflight: async () => ({}) as any, inTransaction: () => ({}) as any, history: () => [] },
  });
  return app;
}

describe("canonical agent skill routes", () => {
  it.each(["API_ACTIVATION_REQUIRED", "REQUIREMENTS_UNSATISFIED", "OPERATION_IN_PROGRESS", "SOURCE_NOT_ALLOWED", "DEPLOYMENT_SUPERSEDED"] as const)("preserves reachable %s failures", async code => {
    const response = await fixture(async () => { throw new AgentSkillManagementError(code); }).request("/api/agents/agent-1/skills", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "LOCAL", operation: "ADD", agentId: "agent-1", name: "x", preload: true, expectedAgentRevision: 1 }),
    });
    expect(response.status).toBe(code === "SOURCE_NOT_ALLOWED" ? 403 : 409);
    expect(await response.json()).toMatchObject({ code });
  });

  it("rejects unknown fields with no-store without invoking mutation", async () => {
    const response = await fixture().request("/api/agents/agent-1/skills", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "LOCAL", operation: "ADD", agentId: "agent-1", name: "x", preload: true, expectedAgentRevision: 1, unexpected: true }),
    });
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects preflight query strings and unbounded agent IDs before the seam", async () => {
    const response = await fixture().request("/api/agents/agent-1/skills/preflight?unexpected=1", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ selection: { local: [], catalog: [] } }) });
    expect(response.status).toBe(400);
    expect(response.body).toBeTruthy();
    const unbounded = await fixture().request(`/api/agents/${"x".repeat(201)}/skills/preflight`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ selection: { local: [], catalog: [] } }) });
    expect(unbounded.status).toBe(400);
  });

  it("enforces the actual 16 KiB stream limit and fatal UTF-8 decoding", async () => {
    const command = JSON.stringify({ kind: "LOCAL", operation: "ADD", agentId: "agent-1", name: "x", preload: true, expectedAgentRevision: 1 });
    const padding = 16 * 1024 - new TextEncoder().encode(command).byteLength;
    const exact = await fixture().request("/api/agents/agent-1/skills", { method: "PATCH", headers: { "content-type": "application/json" }, body: command + " ".repeat(padding) });
    expect(exact.status).toBe(200);
    const over = await fixture().request("/api/agents/agent-1/skills", { method: "PATCH", headers: { "content-type": "application/json" }, body: command + " ".repeat(padding + 1) });
    expect(over.status).toBe(413);
    const invalidUtf8 = await fixture().request("/api/agents/agent-1/skills", { method: "PATCH", headers: { "content-type": "application/json" }, body: new Uint8Array([0x7b, 0x22, 0xc3, 0x28, 0x22, 0x3a, 0x31, 0x7d]) });
    expect(invalidUtf8.status).toBe(400);
  });
});
