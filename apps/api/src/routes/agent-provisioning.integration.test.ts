import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { registerAgentProvisioningRoutes } from "./agent-provisioning";
import { AgentProvisioningError } from "../unified-skills/provisioning";

const body = { kind: "BLANK", idempotencyKey: "00000000-0000-4000-8000-000000000001", name: "agent-a", visibility: "PRIVATE", mode: "CLASSIC", modelId: "model-a", workspacePath: "workspace/agent-a", runnerId: "runner-a", desiredState: "STOPPED", localSkills: [], catalogSkills: [] };

describe("agent provisioning routes", () => {
  it.each(["REVISION_CONFLICT", "IDENTITY_CONFLICT", "SOURCE_NOT_ALLOWED", "RELEASE_NOT_APPROVED", "INSPECTION_FAILED"])("preserves reachable %s failures", async code => {
    const provisioning = { toAgentCreation: vi.fn(() => ({ kind: "BLANK" })), create: vi.fn(async () => { throw new AgentProvisioningError(code); }), templateOptions: vi.fn() } as any;
    const app = new Hono();
    registerAgentProvisioningRoutes(app, { requireAuth: async (c, next) => { c.set("user", { id: "human-a", username: "admin" }); await next(); }, provisioning });
    const response = await app.request("http://localhost/api/agents/provision", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect(response.status).toBe(code === "SOURCE_NOT_ALLOWED" ? 403 : code === "INSPECTION_FAILED" ? 422 : 409);
    expect(await response.json()).toMatchObject({ code });
  });

  it("rejects punctuation in opaque secret references before the provisioning seam", async () => {
    const provisioning = { toAgentCreation: vi.fn(), create: vi.fn(), templateOptions: vi.fn() } as any;
    const app = new Hono();
    registerAgentProvisioningRoutes(app, { requireAuth: async (c, next) => { c.set("user", { id: "human-a", username: "admin" }); await next(); }, provisioning });
    const response = await app.request("http://localhost/api/agents/provision", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, kind: "TEMPLATE", packageReleaseId: "release-native", secretBindings: [{ requirementName: "API_KEY", secretReferenceId: "bad.token=" }] }) });
    expect(response.status).toBe(400);
    expect(provisioning.toAgentCreation).not.toHaveBeenCalled();
  });

  it("rejects malformed and oversized bodies before calling the provisioning seam", async () => {
    const provisioning = { toAgentCreation: vi.fn(), create: vi.fn(), templateOptions: vi.fn() } as any;
    const app = new Hono();
    registerAgentProvisioningRoutes(app, { requireAuth: async (c, next) => { c.set("user", { id: "human-a", username: "admin" }); await next(); }, provisioning });
    const malformed = await app.request("http://localhost/api/agents/provision", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(malformed.status).toBe(400);
    const serialized = JSON.stringify(body);
    const exactLimit = await app.request("http://localhost/api/agents/provision", { method: "POST", headers: { "content-type": "application/json" }, body: serialized + " ".repeat(16 * 1024 - new TextEncoder().encode(serialized).byteLength) });
    expect(exactLimit.status).toBe(201);
    const oversized = await app.request("http://localhost/api/agents/provision", { method: "POST", headers: { "content-type": "application/json" }, body: serialized + " ".repeat(16 * 1024 - new TextEncoder().encode(serialized).byteLength + 1) });
    expect(oversized.status).toBe(413);
    const invalidUtf8 = await app.request("http://localhost/api/agents/provision", { method: "POST", headers: { "content-type": "application/json" }, body: new Uint8Array([0x7b, 0x22, 0xc3, 0x28, 0x22, 0x3a, 0x31, 0x7d]) });
    expect(invalidUtf8.status).toBe(400);
    expect(provisioning.create).toHaveBeenCalledTimes(1);
  });

  it("translates and creates through one provisioning seam with no-store responses", async () => {
    const provisioning = { toAgentCreation: vi.fn(() => ({ kind: "BLANK" })), create: vi.fn(async () => ({ id: "agent-a", name: "agent-a", desiredState: "STOPPED", runtimeState: "STOPPED", queuedDeploymentIds: [] })), templateOptions: vi.fn() } as any;
    const app = new Hono();
    registerAgentProvisioningRoutes(app, { requireAuth: async (c, next) => { c.set("user", { id: "human-a", username: "admin" }); await next(); }, provisioning });
    const response = await app.request("http://localhost/api/agents/provision", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(provisioning.toAgentCreation).toHaveBeenCalledTimes(1);
    expect(provisioning.create).toHaveBeenCalledTimes(1);
  });
});
