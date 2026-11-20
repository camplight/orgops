import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getMeaningfulEvents,
  refreshChannelFullMemory,
  refreshChannelRecentMemory,
  refreshCrossChannelFullMemory,
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

  it("chunks the entire current recent window and excludes future delivery", async () => {
    const now = Date.now();
    const events: Event[] = Array.from({ length: 121 }, (_, index) => ({
      id: `event-${index}`,
      type: "message.created",
      source: "human:admin",
      channelId: "channel",
      payload: { text: `message ${index}` },
      createdAt: now - 1_000 + index,
    }));
    events.push({
      id: "future",
      type: "message.created",
      source: "human:admin",
      channelId: "channel",
      payload: { text: "not yet" },
      createdAt: now + 122,
      deliverAt: now + 60_000,
    });
    generateMock
      .mockResolvedValueOnce({ text: "first chunk" })
      .mockResolvedValueOnce({ text: "complete current window" });
    let writtenBody: Record<string, unknown> | null = null;
    const apiFetch = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/api/memory/channel/recent?")) {
        return Response.json({ record: null });
      }
      if (path.includes("typePrefix=agent.context.")) return Response.json([]);
      if (path.startsWith("/api/events?")) return Response.json(events);
      if (path === "/api/billing/usage") return Response.json({ ok: true });
      if (path === "/api/memory/channel/recent" && init?.method === "PUT") {
        writtenBody = JSON.parse(String(init.body));
        return Response.json({ record: { ...writtenBody, version: 1, createdAt: now, updatedAt: now } });
      }
      throw new Error(`Unexpected API call ${init?.method ?? "GET"} ${path}`);
    });

    await refreshChannelRecentMemory({
      agent,
      channelId: "channel",
      apiFetch,
      getEnv: async () => ({}),
    });

    expect(generateMock).toHaveBeenCalledTimes(2);
    const prompts = generateMock.mock.calls.map((call) => JSON.stringify(call[1])).join("\n");
    expect(prompts).toContain("message 0");
    expect(prompts).toContain("message 120");
    expect(prompts).not.toContain("not yet");
    expect(writtenBody).toMatchObject({
      summaryText: "complete current window",
      lastProcessedEventId: "event-120",
    });
  });

  it("does not advance full memory when summarization returns empty output", async () => {
    generateMock.mockResolvedValue({ text: "   " });
    let wrote = false;
    const apiFetch = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/api/memory/channel/full?")) return Response.json({ record: null });
      if (path.includes("typePrefix=agent.context.")) return Response.json([]);
      if (path.startsWith("/api/events?")) {
        return Response.json([{
          id: "message",
          type: "message.created",
          source: "human:admin",
          channelId: "channel",
          payload: { text: "must not be skipped" },
          createdAt: 100,
        }]);
      }
      if (path === "/api/billing/usage") return Response.json({ ok: true });
      if (path === "/api/memory/channel/full" && init?.method === "PUT") {
        wrote = true;
      }
      throw new Error(`Unexpected API call ${init?.method ?? "GET"} ${path}`);
    });

    expect(await refreshChannelFullMemory({
      agent,
      channelId: "channel",
      apiFetch,
      getEnv: async () => ({}),
    })).toBeNull();
    expect(wrote).toBe(false);
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

  it("does not commit cross memory when channel memory changes during summarization", async () => {
    generateMock.mockResolvedValue({ text: "stale cross summary" });
    let channelReadCount = 0;
    let wrote = false;
    const apiFetch = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/api/memory/cross/full?")) {
        return Response.json({ record: null });
      }
      if (path.startsWith("/api/memory/channel/full?")) {
        channelReadCount += 1;
        return Response.json({
          records: [
            {
              agentName: "worker",
              channelId: "channel",
              summaryText:
                channelReadCount === 1 ? "initial channel memory" : "updated channel memory",
              lastProcessedAt: channelReadCount === 1 ? 100 : 200,
              version: channelReadCount,
              createdAt: 100,
              updatedAt: channelReadCount === 1 ? 100 : 200,
            },
          ],
        });
      }
      if (path.includes("typePrefix=agent.context.")) return Response.json([]);
      if (path === "/api/billing/usage") return Response.json({ ok: true });
      if (path === "/api/memory/cross/full" && init?.method === "PUT") {
        wrote = true;
      }
      throw new Error(`Unexpected API call ${init?.method ?? "GET"} ${path}`);
    });

    expect(
      await refreshCrossChannelFullMemory({
        agent,
        channelIds: ["channel"],
        apiFetch,
        getEnv: async () => ({}),
      }),
    ).toBeNull();
    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(channelReadCount).toBe(2);
    expect(wrote).toBe(false);
  });

  it("stops full memory watermark before an interleaved future event", async () => {
    const now = Date.now();
    generateMock.mockResolvedValue({ text: "summarized due prefix" });
    let writtenBody: Record<string, unknown> | null = null;
    const apiFetch = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/api/memory/channel/full?")) return Response.json({ record: null });
      if (path.includes("typePrefix=agent.context.")) return Response.json([]);
      if (path.startsWith("/api/events?")) {
        return Response.json([
          {
            id: "due-1",
            type: "message.created",
            source: "human:admin",
            channelId: "channel",
            payload: { text: "first" },
            createdAt: now - 30,
          },
          {
            id: "future",
            type: "message.created",
            source: "human:admin",
            channelId: "channel",
            payload: { text: "later" },
            createdAt: now - 20,
            deliverAt: now + 60_000,
          },
          {
            id: "due-2",
            type: "message.created",
            source: "human:admin",
            channelId: "channel",
            payload: { text: "second" },
            createdAt: now - 10,
          },
        ]);
      }
      if (path === "/api/billing/usage") return Response.json({ ok: true });
      if (path === "/api/memory/channel/full" && init?.method === "PUT") {
        writtenBody = JSON.parse(String(init.body));
        return Response.json({
          record: { ...writtenBody, version: 1, createdAt: now, updatedAt: now },
        });
      }
      throw new Error(`Unexpected API call ${init?.method ?? "GET"} ${path}`);
    });

    await refreshChannelFullMemory({
      agent,
      channelId: "channel",
      apiFetch,
      getEnv: async () => ({}),
    });

    const prompts = generateMock.mock.calls.map((call) => JSON.stringify(call[1])).join("\n");
    expect(prompts).toContain("first");
    expect(prompts).not.toContain("second");
    expect(prompts).not.toContain("later");
    expect(writtenBody).toMatchObject({
      lastProcessedAt: now - 30,
      lastProcessedEventId: "due-1",
    });
  });

  it("uses CAS expectedVersion when seeding empty full memory", async () => {
    let writtenBody: Record<string, unknown> | null = null;
    const apiFetch = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/api/memory/channel/full?")) {
        return Response.json({
          record: {
            agentName: "worker",
            channelId: "channel",
            summaryText: "stale",
            lastProcessedAt: 0,
            version: 4,
            createdAt: 1,
            updatedAt: 1,
          },
        });
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
              summary: "boundary summary",
              cutoffAt: 50,
              cutoffEventId: "cutoff",
            },
            createdAt: 60,
          },
        ]);
      }
      if (path.startsWith("/api/events?")) return Response.json([]);
      if (path === "/api/memory/channel/full" && init?.method === "PUT") {
        writtenBody = JSON.parse(String(init.body));
        return Response.json({
          record: { ...writtenBody, version: 5, createdAt: 70, updatedAt: 70 },
        });
      }
      throw new Error(`Unexpected API call ${init?.method ?? "GET"} ${path}`);
    });

    await refreshChannelFullMemory({
      agent,
      channelId: "channel",
      apiFetch,
      getEnv: async () => ({}),
    });

    expect(writtenBody).toMatchObject({
      expectedVersion: 4,
      lastProcessedAt: 50,
      lastProcessedEventId: "cutoff",
      summaryText: "boundary summary",
    });
  });
});
