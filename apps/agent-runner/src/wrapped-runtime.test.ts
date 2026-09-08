import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
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

  it("extracts OpenClaw agent result payload text from JSON output", () => {
    const output = JSON.stringify({
      runId: "run-1",
      status: "ok",
      result: {
        payloads: [{ text: "nested hello", mediaUrl: null }],
        meta: { durationMs: 10 },
      },
    });
    expect(parseWrappedRuntimeOutput(output, "", "json-payloads")).toBe("nested hello");
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

  it("uses Node's cross-platform shell for wrapped commands", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "orgops-shell-wrapped-"));
    const emitted: unknown[] = [];
    const agent: Agent = {
      name: "shell-test",
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
            'node -e "process.stdout.write(JSON.stringify({payloads:[{text:\\"first\\"}]}))" && node -e "process.stdout.write(JSON.stringify({payloads:[{text:\\"second\\"}]}))"',
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
            (outbound as any).payload?.text === "first",
        ),
      ).toBe(true);
    } finally {
      rmSync(workspacePath, { recursive: true, force: true });
    }
  });

  it("creates configured command cwd before spawning", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "orgops-cwd-wrapped-"));
    const emitted: unknown[] = [];
    const setupCwd = join(workspacePath, "missing", "wrapper");
    const agent: Agent = {
      name: "cwd-test",
      systemInstructions: "",
      soulPath: "",
      workspacePath,
      modelId: "wrapped:none",
      desiredState: "RUNNING",
      runtimeState: "RUNNING",
      mode: "WRAPPED",
      wrappedConfig: {
        kind: "test",
        setup: {
          command: 'node -e "process.stdout.write(process.cwd())"',
          cwd: setupCwd,
        },
      },
    };

    try {
      await ensureWrappedAgentReady(
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
      );

      expect(
        emitted.some(
          (outbound) =>
            (outbound as any).type === "wrapper.setup.completed" &&
            (outbound as any).payload?.stdout === realpathSync(setupCwd),
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
            ensureLifecycleChannel: async () => "lifecycle-channel",
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
            request.body?.channelId === "lifecycle-channel" &&
            request.body?.cmd === 'node -e "setInterval(() => {}, 1000)"',
        ),
      ).toBe(true);
    } finally {
      await stopWrappedAgentRuntime(agent.name);
      rmSync(workspacePath, { recursive: true, force: true });
    }
  });

  it("passes attachment payloads to wrapped runtime message input", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "orgops-wrapped-attachments-"));
    const emitted: unknown[] = [];
    const agent: Agent = {
      name: "wrapped-attachments-test",
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
      id: "evt-attachments",
      type: "message.created",
      payload: {
        text: "please inspect attached screenshot",
        attachments: [{ fileId: "img-123", mime: "image/png", name: "screen.png" }],
      },
      source: "human:alice",
      channelId: "chan-attachments",
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

    const wrappedReply = emitted.find(
      (outbound) =>
        (outbound as any).type === "message.created" &&
        (outbound as any).source === "agent:wrapped-attachments-test",
    ) as { payload?: { text?: string } } | undefined;
    expect(wrappedReply?.payload?.text).toContain('"attachments"');
    expect(wrappedReply?.payload?.text).toContain('"img-123"');
    expect(wrappedReply?.payload?.text).toContain('"orgops.pending.events"');
  });

  it("streams wrapped runtime output via process output events", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "orgops-wrapped-stream-"));
    const emitted: unknown[] = [];
    const apiRequests: Array<{ path: string; body: any }> = [];
    const agent: Agent = {
      name: "wrapped-stream-test",
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
            'node -e "process.stdout.write(\\"stream-a\\"); setTimeout(() => process.stderr.write(\\"stream-b\\"), 20); setTimeout(() => process.exit(0), 40)"',
          parse: "text",
        },
      },
    };
    const event: Event = {
      id: "evt-stream",
      type: "message.created",
      payload: { text: "stream test" },
      source: "human:alice",
      channelId: "chan-stream",
      createdAt: Date.now(),
    };

    try {
      await runWrappedAgentTurn(
        {
          projectRoot: workspacePath,
          api: {
            apiFetch: async (path: string, init?: RequestInit) => {
              apiRequests.push({
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
        [event],
      );
    } finally {
      rmSync(workspacePath, { recursive: true, force: true });
    }

    expect(apiRequests.some((request) => request.path === "/api/processes")).toBe(true);
    expect(
      apiRequests.some((request) => request.path.includes("/api/processes/") && request.path.endsWith("/output")),
    ).toBe(true);
    expect(
      apiRequests.some((request) => request.path.includes("/api/processes/") && request.path.endsWith("/exit")),
    ).toBe(true);
    expect(
      apiRequests.some((request) => request.body?.source === "system:process-runner"),
    ).toBe(true);
    expect(
      emitted.some((outbound) => (outbound as any).type === "message.created"),
    ).toBe(true);
  });

  it("downloads attached files for wrapped runtime when tempPath is absent", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "orgops-wrapped-attachment-download-"));
    const emitted: unknown[] = [];
    const agent: Agent = {
      name: "wrapped-attachment-download-test",
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
      id: "evt-download",
      type: "message.created",
      payload: {
        text: "inspect this image",
        attachments: [
          {
            fileId: "img-777",
            name: "capture.png",
            mime: "image/png",
          },
        ],
      },
      source: "human:alice",
      channelId: "chan-download",
      createdAt: Date.now(),
    };

    try {
      await runWrappedAgentTurn(
        {
          projectRoot: workspacePath,
          api: {
            apiFetch: async (path: string) => {
              if (path === "/api/files/img-777") {
                return new Response(new Uint8Array([1, 2, 3, 4]));
              }
              if (path === "/api/processes") {
                return new Response(JSON.stringify({ ok: true }), { status: 200 });
              }
              if (path.includes("/api/processes/") && path.endsWith("/output")) {
                return new Response(JSON.stringify({ ok: true }), { status: 200 });
              }
              if (path.includes("/api/processes/") && path.endsWith("/exit")) {
                return new Response(JSON.stringify({ ok: true }), { status: 200 });
              }
              throw new Error(`Unexpected path: ${path}`);
            },
            emitEvent: async (outbound: unknown) => {
              emitted.push(outbound);
            },
            getPackageSecretsEnv: async () => ({}),
          },
        },
        agent,
        [event],
      );

      const wrappedReply = emitted.find(
        (outbound) =>
          (outbound as any).type === "message.created" &&
          (outbound as any).source === "agent:wrapped-attachment-download-test",
      ) as { payload?: { text?: string } } | undefined;
      const replyText = wrappedReply?.payload?.text ?? "";
      expect(replyText).toContain('"fileId": "img-777"');
      expect(replyText).toContain('"downloadedByRunner": true');
      const tempPathMatch = replyText.match(/"tempPath":\s*"([^"]+)"/);
      expect(tempPathMatch?.[1]).toBeTruthy();
      const hydratedPath = tempPathMatch?.[1] ?? "";
      expect(existsSync(hydratedPath)).toBe(true);
      expect(readFileSync(hydratedPath)).toEqual(Buffer.from([1, 2, 3, 4]));
    } finally {
      rmSync(workspacePath, { recursive: true, force: true });
    }
  });
});
