import { beforeEach, describe, expect, it, vi } from "vitest";
import { execute, memoryToolDefs } from "./memory";
import type { ExecuteContext } from "./types";

const generateMock = vi.fn();
vi.mock("@orgops/llm", () => ({
  generate: (...args: unknown[]) => generateMock(...args),
}));

function createContext(apiFetch: ExecuteContext["apiFetch"]): ExecuteContext {
  return {
    agent: {
      name: "worker",
      workspacePath: "/tmp/worker",
      modelId: "openai:gpt-4o-mini",
      desiredState: "RUNNING",
      runtimeState: "RUNNING",
    },
    triggerEvent: {
      id: "trigger-1",
      type: "message.created",
      source: "human:admin",
      channelId: "channel-1",
      payload: { text: "work" },
      createdAt: 200,
    },
    channelId: "channel-1",
    injectionEnv: {},
    apiFetch,
    emitEvent: vi.fn(async () => undefined),
    emitAudit: vi.fn(async () => undefined),
  };
}

describe("context lifecycle memory tools", () => {
  beforeEach(() => {
    generateMock.mockReset();
  });

  it("exposes compact and clear tools", () => {
    const names = memoryToolDefs.map(([name]) => name);
    expect(names).toContain("memory_context_compact");
    expect(names).toContain("memory_context_clear");
  });

  it("clears future context without creating a summary", async () => {
    const apiFetch = vi.fn(async (path: string, init?: RequestInit) => {
      expect(path).toBe("/api/agents/worker/context/clear");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        channelId: "channel-1",
        reason: "start fresh",
        idempotencyKey: "context:clear:worker:channel-1:trigger-1",
      });
      return new Response(JSON.stringify({ id: "clear-1" }), { status: 201 });
    });

    await expect(
      execute(createContext(apiFetch), "memory_context_clear", {
        reason: "start fresh",
      }),
    ).resolves.toMatchObject({
      ok: true,
      operation: "clear",
      channelId: "channel-1",
    });
  });

  it("refreshes whole-channel memory before compacting at its watermark", async () => {
    generateMock.mockResolvedValue({
      text: "Summary of every participant's durable context.",
    });
    const apiFetch = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/api/memory/channel/full?")) {
        return new Response(JSON.stringify({ record: null }));
      }
      if (path.includes("typePrefix=agent.context.")) {
        return new Response(JSON.stringify([]));
      }
      if (path.startsWith("/api/events?")) {
        return new Response(
          JSON.stringify([
            {
              id: "event-100",
              type: "message.created",
              source: "human:admin",
              channelId: "channel-1",
              payload: { text: "Human and agent discussion" },
              createdAt: 100,
            },
          ]),
        );
      }
      if (path === "/api/billing/usage") {
        return new Response(JSON.stringify({ ok: true }));
      }
      if (path === "/api/memory/channel/full" && init?.method === "PUT") {
        return new Response(
          JSON.stringify({
            record: {
              agentName: "worker",
              channelId: "channel-1",
              summaryText: "Summary of every participant's durable context.",
              lastProcessedAt: 100,
              lastProcessedEventId: "event-100",
              version: 1,
              createdAt: 110,
              updatedAt: 110,
            },
          }),
        );
      }
      if (path === "/api/agents/worker/context/compact") {
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({
          channelId: "channel-1",
          summary: "Summary of every participant's durable context.",
          cutoffAt: 100,
          cutoffEventId: "event-100",
          idempotencyKey: "context:compact:worker:channel-1:trigger-1",
        });
        return new Response(JSON.stringify({ id: "compact-1" }), {
          status: 201,
        });
      }
      return new Response(JSON.stringify({ ok: true }));
    });

    await expect(
      execute(createContext(apiFetch), "memory_context_compact", {}),
    ).resolves.toMatchObject({
      ok: true,
      operation: "compact",
      channelId: "channel-1",
      summarizedThrough: 100,
    });
    expect(generateMock).toHaveBeenCalledOnce();
  });
});
