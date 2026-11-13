import { beforeEach, describe, expect, it, vi } from "vitest";
import { generate } from "@orgops/llm";
import {
  compactChannelHistory,
  planHistoryCompaction,
} from "./history-compaction";
import type { Agent, Event } from "./types";

vi.mock("@orgops/llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@orgops/llm")>()),
  generate: vi.fn(),
}));

const agent: Agent = {
  name: "tester",
  workspacePath: "/tmp",
  modelId: "openai:gpt-4o-mini",
  desiredState: "RUNNING",
  runtimeState: "RUNNING",
  memoryContextMode: "FULL_CHANNEL_EVENTS_AUTO_COMPACT",
};

function message(index: number, createdAt = index * 10): Event {
  return {
    id: `m${index}`,
    type: "message.created",
    source: index % 2 ? "agent:tester" : "human:test",
    channelId: "chat",
    payload: { text: `message ${index}` },
    createdAt,
  };
}

beforeEach(() => {
  vi.mocked(generate).mockReset();
});

describe("planHistoryCompaction", () => {
  it("leaves history that fits alone", () => {
    const events = [message(1), message(2), message(3)];
    expect(
      planHistoryCompaction({ events, sizes: [10, 10, 10], maxChars: 100, maxEvents: 10 }),
    ).toBeNull();
  });

  it("keeps about half the budget of recent messages when history overflows", () => {
    const events = Array.from({ length: 10 }, (_, index) => message(index + 1));
    const plan = planHistoryCompaction({
      events,
      sizes: events.map(() => 20),
      maxChars: 100,
      maxEvents: 50,
    });
    expect(plan?.older.map((event) => event.id)).toEqual(["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"]);
    expect(plan?.kept.map((event) => event.id)).toEqual(["m9", "m10"]);
  });

  it("splits on the event cap too", () => {
    const events = Array.from({ length: 6 }, (_, index) => message(index + 1));
    const plan = planHistoryCompaction({
      events,
      sizes: events.map(() => 1),
      maxChars: 1_000,
      maxEvents: 4,
    });
    expect(plan?.kept.map((event) => event.id)).toEqual(["m5", "m6"]);
  });

  it("moves events that share the split timestamp into the summarized part", () => {
    const events = [message(1), message(2), message(3), message(4), message(5, 40), message(6)];
    const plan = planHistoryCompaction({
      events,
      sizes: events.map(() => 20),
      maxChars: 80,
      maxEvents: 50,
    });
    expect(plan?.older.map((event) => event.id)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    expect(plan?.kept.map((event) => event.id)).toEqual(["m6"]);
  });
});

describe("compactChannelHistory", () => {
  it("merges the previous summary with older messages and records a boundary", async () => {
    vi.mocked(generate).mockImplementationOnce(async (_model, messages) => {
      const prompt = JSON.stringify(messages);
      expect(prompt).toContain("Earlier summary.");
      expect(prompt).toContain("message 2");
      return { text: "  Merged summary.  ", toolCalls: [], toolResults: [] } as never;
    });
    const apiFetch = vi.fn(async (_path: string, _init?: RequestInit) =>
      Response.json({ id: "boundary" }, { status: 201 }),
    );
    const result = await compactChannelHistory({
      agent,
      channelId: "chat",
      older: [message(1), message(2)],
      previousSummary: "Earlier summary.",
      env: {},
      apiFetch,
    });
    expect(result).toEqual({ summary: "Merged summary.", cutoffAt: 20, cutoffEventId: "m2" });
    const [path, init] = apiFetch.mock.calls.at(-1)!;
    expect(path).toBe("/api/agents/tester/context/compact");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      channelId: "chat",
      summary: "Merged summary.",
      cutoffAt: 20,
      cutoffEventId: "m2",
      idempotencyKey: "context:auto-compact:tester:chat:m2",
    });
  });

  it("drops command output instead of summarizing it", async () => {
    const output = (index: number): Event => ({
      id: `p${index}`,
      type: "process.output",
      source: "system:process-runner",
      channelId: "chat",
      payload: { text: `raw output ${index}` },
      createdAt: index * 10,
    });
    const apiFetch = vi.fn(async (_path: string, _init?: RequestInit) => Response.json({}, { status: 201 }));
    expect(
      await compactChannelHistory({ agent, channelId: "chat", older: [output(1), output(2)], env: {}, apiFetch }),
    ).toBeNull();
    expect(generate).not.toHaveBeenCalled();
    expect(apiFetch).not.toHaveBeenCalled();

    vi.mocked(generate).mockImplementationOnce(async (_model, messages) => {
      expect(JSON.stringify(messages)).not.toContain("raw output");
      return { text: "Summary.", toolCalls: [], toolResults: [] } as never;
    });
    const result = await compactChannelHistory({
      agent, channelId: "chat", older: [message(1), output(2), output(3)], env: {}, apiFetch,
    });
    expect(result).toMatchObject({ cutoffEventId: "p3", cutoffAt: 30 });
  });

  it("stops summarizing when the turn is cancelled", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(
      compactChannelHistory({
        agent, channelId: "chat", older: [message(1)], env: {},
        apiFetch: async () => Response.json({}), abortSignal: controller.signal,
      }),
    ).rejects.toThrow("cancelled");
    expect(generate).not.toHaveBeenCalled();
  });

  it("returns null when the boundary is rejected", async () => {
    vi.mocked(generate).mockResolvedValue({ text: "Summary.", toolCalls: [], toolResults: [] } as never);
    const result = await compactChannelHistory({
      agent,
      channelId: "chat",
      older: [message(1)],
      env: {},
      apiFetch: async () => Response.json({ error: "older" }, { status: 409 }),
    });
    expect(result).toBeNull();
  });
});

