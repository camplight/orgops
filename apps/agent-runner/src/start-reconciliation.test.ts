import { describe, expect, it, vi } from "vitest";
import type { Agent } from "./types";
import { reconcileAgentBootstrap } from "./runner";

const agent = (overrides: Partial<Agent> = {}): Agent => ({ name: "agent-a", systemInstructions: "", soulPath: "soul",
  workspacePath: "/safe/agent-a", modelId: "model-a", desiredState: "RUNNING", runtimeState: "STARTING",
  mode: "CLASSIC", catalogDerived: true, assignedRunnerId: "runner-a", ...overrides });

function fixture(options: { api?: unknown; local?: unknown; bootstrapped?: boolean } = {}) {
  const calls: string[] = [];
  const bootstrappedAgents = new Set<string>(options.bootstrapped ? ["agent-a"] : []);
  const bootstrappedAgentKeys = new Map<string, string>(options.bootstrapped ? [["agent-a", "classic"]] : []);
  const heartbeats = new Map<string, number>(options.bootstrapped ? [["agent-a", 1000]] : []);
  const deps = {
    projectRoot: "/safe", registeredRunnerId: "runner-a", bootstrappedAgents, bootstrappedAgentKeys, heartbeats,
    getStartRequirements: vi.fn(async () => options.api ?? ({ ok: false, code: "REQUIREMENTS_UNSATISFIED", reasons: [{ code: "DEPLOYMENT_REQUIRED" }] })),
    validateLocal: vi.fn(() => options.local ?? ({ ok: true })), now: () => 1001, heartbeatIntervalMs: 5000,
    ensureWorkspace: vi.fn(async () => { calls.push("workspace"); }),
    patchRunning: vi.fn(async () => { calls.push("patch-running"); }),
    bootstrap: vi.fn(async () => { calls.push("bootstrap"); }),
    scheduleMaintenance: vi.fn(() => { calls.push("maintenance"); }),
    warn: vi.fn((...values: unknown[]) => { calls.push(`warn:${JSON.stringify(values)}`); }),
  };
  return { calls, deps, bootstrappedAgents, bootstrappedAgentKeys, heartbeats };
}

describe("runner start reconciliation side-effect boundary", () => {
  it.each([
    ["classic denial", agent()],
    ["wrapped denial", agent({ mode: "WRAPPED", modelId: "wrapped:none", wrappedConfig: { kind: "command", harness: "command", runtime: { command: "private-command" } } })],
    ["runner restart", agent({ runtimeState: "STARTING" })],
    ["explicit STARTING", agent({ runtimeState: "STARTING" })],
  ] as const)("has zero bootstrap effects for %s", async (_case, value) => {
    const f = fixture();
    await expect(reconcileAgentBootstrap(value, f.deps)).resolves.toBe(false);
    expect(f.calls.filter(call => !call.startsWith("warn:"))).toEqual([]);
    expect(f.bootstrappedAgents.size).toBe(0);
    expect(f.bootstrappedAgentKeys.size).toBe(0);
    expect(f.heartbeats.size).toBe(0);
    expect(JSON.stringify(f.calls)).not.toContain("private-command");
  });

  it.each([null, { ok: true, extra: "malformed" }, { ok: false, code: "REQUIREMENTS_UNSATISFIED", reasons: [] }])(
    "fails closed without effects for malformed API result %#", async api => {
      const f = fixture({ api });
      await expect(reconcileAgentBootstrap(agent(), f.deps)).resolves.toBe(false);
      expect(f.calls.filter(call => !call.startsWith("warn:"))).toEqual([]);
    });

  it("checks local denial before workspace/runtime/bootstrap/maintenance effects", async () => {
    const f = fixture({ api: { ok: true }, local: { ok: false, code: "REQUIREMENTS_UNSATISFIED", reasons: [{ code: "WORKSPACE_BINDING_MISSING" }] } });
    await expect(reconcileAgentBootstrap(agent(), f.deps)).resolves.toBe(false);
    expect(f.calls.filter(call => !call.startsWith("warn:"))).toEqual([]);
  });

  it("keeps an already-running bootstrapped agent active without silently stopping or re-gating", async () => {
    const f = fixture({ bootstrapped: true });
    await expect(reconcileAgentBootstrap(agent({ runtimeState: "RUNNING" }), f.deps)).resolves.toBe(true);
    expect(f.deps.getStartRequirements).not.toHaveBeenCalled();
    expect(f.calls).toEqual(["workspace", "maintenance"]);
    expect(f.bootstrappedAgents.has("agent-a")).toBe(true);
  });
});
