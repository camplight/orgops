import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getMeaningfulEvents,
  refreshChannelFullMemory,
} from "./context-maintenance";
import type { Agent, Event } from "./types";

const generateMock = vi.fn();
vi.mock("@orgops/llm", () => ({
  generate: (...args: unknown[]) => generateMock(...args),
}));

const agent: Agent = {
  name: "worker",
  workspacePath: "/tmp/worker",
  modelId: "openai:gpt-4o-mini",
  desiredState: "RUNNING",
  runtimeState: "RUNNING",
};

describe("context-boundary memory maintenance", () => {
  beforeEach(() => {
    generateMock.mockReset();
  });

  it("does not summarize lifecycle markers as channel content", () => {
    const events = [
      {
        id: "compact",
        type: "agent.context.compacted",
        source: "agent:worker",
        channelId: "channel",
        payload: { targetAgentName: "worker", summary: "summary", cutoffAt: 10 },
        createdAt: 20,
      },
      {
        id: "message",
        type: "message.created",
        source: "human:admin",
        channelId: "channel",
        payload: { text: "new work" },
        createdAt: 30,
      },
    ] satisfies Event[];
    expect(getMeaningfulEvents(events).map((event) => event.id)).toEqual([
      "message",
    ]);
  });

  it("seeds rebuilt full memory from compact summary and only later events", async () => {
    generateMock.mockImplementation(async (_model, messages) => {
      const prompt = JSON.stringify(messages);
      expect(prompt).toContain("Compacted whole-channel memory");
      expect(prompt).toContain("new work");
      expect(prompt).not.toContain("old work");
      return { text: "Updated memory with new work" };
    });
    let writtenBody: Record<string, unknown> | null = null;
    const apiFetch = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/api/memory/channel/full?")) {
        return Response.json({ record: null });
      }
      if (path.includes("typePrefix=agent.context.")) {
        return Response.json([
          {
            id: "compact",
            type: "agent.context.compacted",
            source: "agent:worker",
            channelId: "channel",
            payload: {
              targetAgentName: "worker",
              summary: "Compacted whole-channel memory",
              cutoffAt: 100,
              cutoffEventId: "old-cutoff",
            },
            createdAt: 150,
          },
        ]);
      }
      if (path.startsWith("/api/events?")) {
        expect(path).toContain("after=100");
        return Response.json([
          {
            id: "new-message",
            type: "message.created",
            source: "human:admin",
            channelId: "channel",
            payload: { text: "new work" },
            createdAt: 200,
          },
        ]);
      }
      if (path === "/api/billing/usage") return Response.json({ ok: true });
      if (path === "/api/memory/channel/full" && init?.method === "PUT") {
        writtenBody = JSON.parse(String(init.body));
        return Response.json({
          record: {
            ...writtenBody,
            version: 1,
            createdAt: 210,
            updatedAt: 210,
          },
        });
      }
      throw new Error(`Unexpected API call ${init?.method ?? "GET"} ${path}`);
    });

    const record = await refreshChannelFullMemory({
      agent,
      channelId: "channel",
      apiFetch,
      getEnv: async () => ({}),
    });
    expect(record?.summaryText).toBe("Updated memory with new work");
    expect(writtenBody).toMatchObject({
      lastProcessedAt: 200,
      lastProcessedEventId: "new-message",
    });
  });
});
