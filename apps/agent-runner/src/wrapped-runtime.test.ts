import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ensureWrappedAgentReady,
  parseWrappedRuntimeOutput,
  runWrappedAgentTurn,
  stopWrappedAgentRuntime,
} from "./wrapped-runtime";
import type { Agent, Event } from "./types";

describe("wrapped runtime", () => {
  it("extracts OpenClaw-style payload text from JSON output", () => {
    const output = JSON.stringify({ payloads: [{ text: "hello" }, { text: "world" }] });
    expect(parseWrappedRuntimeOutput(output, "", "json-payloads")).toBe("hello\n\nworld");
  });

  it("extracts OpenClaw-style payload text from stdout when stderr has diagnostics", () => {
    const output = JSON.stringify({ payloads: [{ text: "hello" }], meta: { durationMs: 10 } });
    expect(parseWrappedRuntimeOutput(output, "gateway warning", "json-payloads")).toBe("hello");
  });

  it("runs a command recipe and emits a message event", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "orgops-wrapped-"));
    const emitted: unknown[] = [];
    const agent: Agent = {
      name: "wrapped-test",
      systemInstructions: "",
      soulPath: "",
      workspacePath,
      modelId: "wrapped:none",
      desiredState: "RUNNING",
      runtimeState: "RUNNING",
      mode: "WRAPPED",
      wrappedConfig: {
        kind: "test",
        runtime: {
          command:
            'node -e "process.stdout.write(JSON.stringify({payloads:[{text:process.env.ORGOPS_WRAPPED_MESSAGE}]}))"',
          parse: "json-payloads",
        },
      },
    };
    const event: Event = {
      id: "evt-1",
      type: "message.created",
      payload: { text: "hello wrapped" },
      source: "human:alice",
      channelId: "chan-1",
      createdAt: Date.now(),
    };

    try {
      await runWrappedAgentTurn(
        {
          projectRoot: workspacePath,
          api: {
            emitEvent: async (outbound: unknown) => {
              emitted.push(outbound);
            },
            getPackageSecretsEnv: async () => ({}),
          },
        },
        agent,
        [event],
      );
    } finally {
      rmSync(workspacePath, { recursive: true, force: true });
    }

    expect(
      emitted.some(
        (outbound) =>
          (outbound as any).type === "wrapper.setup.skipped" &&
          (outbound as any).payload?.targetAgentName === "wrapped-test",
      ),
    ).toBe(true);
    expect(
      emitted.some(
        (outbound) =>
          (outbound as any).type === "message.created" &&
          (outbound as any).source === "agent:wrapped-test" &&
          (outbound as any).payload?.text === "hello wrapped",
      ),
    ).toBe(true);
  });

  it("passes the wrapped workspace path to command recipes", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "orgops-workspace-wrapped-"));
    const emitted: unknown[] = [];
    const agent: Agent = {
      name: "openclaw-test",
      systemInstructions: "",
      soulPath: "",
      workspacePath,
      modelId: "wrapped:none",
      desiredState: "RUNNING",
      runtimeState: "RUNNING",
      mode: "WRAPPED",
      wrappedConfig: {
        kind: "custom",
        runtime: {
          command:
            'node -e "process.stdout.write(JSON.stringify({payloads:[{text:process.env.ORGOPS_WRAPPED_WORKSPACE_PATH}]}))"',
          parse: "json-payloads",
        },
      },
    };
    const event: Event = {
      id: "evt-1",
      type: "message.created",
      payload: { text: "hello wrapped" },
      source: "human:alice",
      channelId: "chan-1",
      createdAt: Date.now(),
    };

    try {
      await runWrappedAgentTurn(
        {
          projectRoot: workspacePath,
          api: {
            emitEvent: async (outbound: unknown) => {
              emitted.push(outbound);
            },
            getPackageSecretsEnv: async () => ({}),
          },
        },
        agent,
        [event],
      );

      expect(
        emitted.some(
          (outbound) =>
            (outbound as any).type === "message.created" &&
            (outbound as any).payload?.text === workspacePath,
        ),
      ).toBe(true);
    } finally {
      rmSync(workspacePath, { recursive: true, force: true });
    }
  });

  it("starts configured wrapper sidecars", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "orgops-sidecar-wrapped-"));
    const emitted: unknown[] = [];
    const processRequests: Array<{ path: string; body: any }> = [];
    const agent: Agent = {
      name: "sidecar-test",
      systemInstructions: "",
      soulPath: "",
      workspacePath,
      modelId: "wrapped:none",
      desiredState: "RUNNING",
      runtimeState: "RUNNING",
      mode: "WRAPPED",
      wrappedConfig: {
        kind: "test",
        sidecars: [
          {
            name: "gateway",
            command: 'node -e "setInterval(() => {}, 1000)"',
            restart: false,
          },
        ],
      },
    };

    try {
      await ensureWrappedAgentReady(
        {
          projectRoot: workspacePath,
          api: {
            apiFetch: async (path: string, init?: RequestInit) => {
              processRequests.push({
                path,
                body: init?.body ? JSON.parse(String(init.body)) : null,
              });
              return new Response(JSON.stringify({ ok: true }), { status: 200 });
            },
            emitEvent: async (outbound: unknown) => {
              emitted.push(outbound);
            },
            getPackageSecretsEnv: async () => ({}),
          },
        },
        agent,
      );

      expect(
        emitted.some(
          (outbound) =>
            (outbound as any).type === "wrapper.sidecar.started" &&
            (outbound as any).payload?.targetAgentName === "sidecar-test" &&
            (outbound as any).payload?.name === "gateway" &&
            typeof (outbound as any).payload?.processId === "string",
        ),
      ).toBe(true);
      expect(
        processRequests.some(
          (request) =>
            request.path === "/api/processes" &&
            request.body?.agentName === "sidecar-test" &&
            request.body?.cmd === 'node -e "setInterval(() => {}, 1000)"',
        ),
      ).toBe(true);
    } finally {
      await stopWrappedAgentRuntime(agent.name);
      rmSync(workspacePath, { recursive: true, force: true });
    }
  });
});
