import { afterEach, describe, expect, it, vi } from "vitest";
import { getAgentStartReadiness, getProvisioningTemplateOptions, provisionAgent, ProvisioningRequestError } from "./api";

const receipt = { id: "agent-1", name: "new-agent", desiredState: "STOPPED" as const, runtimeState: "STOPPED" as const, queuedDeploymentIds: ["deployment-1"], startBlockers: [] };
const input = { kind: "BLANK" as const, idempotencyKey: "00000000-0000-4000-8000-000000000001", name: "new-agent", visibility: "PUBLIC" as const, mode: "CLASSIC" as const, modelId: "model-a", workspacePath: ".orgops-data/workspaces/new-agent", runnerId: "runner-a", desiredState: "STOPPED" as const, localSkills: [], catalogSkills: [] };

afterEach(() => vi.restoreAllMocks());

describe("admin provisioning API", () => {
  it("posts a strict flat command without cache and decodes the receipt", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(receipt), { status: 201 }));
    await expect(provisionAgent(input)).resolves.toEqual(receipt);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/agents/provision"), expect.objectContaining({ cache: "no-store", method: "POST", body: expect.stringContaining('"kind":"BLANK"') }));
  });

  it("maps fixed server provisioning errors without exposing response details", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "REQUIREMENTS_UNSATISFIED", error: "internal detail" }), { status: 409 }));
    await expect(provisionAgent(input)).rejects.toEqual(expect.objectContaining({ code: "REQUIREMENTS_UNSATISFIED", message: "Required bindings are missing; review the setup and try again." } satisfies Partial<ProvisioningRequestError>));
  });

  it("forwards AbortSignal on start-readiness requests", async () => {
    const controller = new AbortController();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ready: true, queuedDeployment: false, blockers: [] })));
    await expect(getAgentStartReadiness("agent/name", controller.signal)).resolves.toEqual({ ready: true, queuedDeployment: false, blockers: [] });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/agents/agent%2Fname/start-readiness"), expect.objectContaining({ signal: controller.signal, cache: "no-store" }));
  });

  it("decodes template options as a no-store request", async () => {
    const options = { runners: [{ id: "runner-a" }], models: [{ id: "model-a" }], secretReferences: [], templates: [] };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(options)));
    await expect(getProvisioningTemplateOptions()).resolves.toEqual(options);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/agents/template-options"), expect.objectContaining({ cache: "no-store", method: "GET" }));
  });
});
