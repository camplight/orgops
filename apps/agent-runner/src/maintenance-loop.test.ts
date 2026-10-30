import { beforeEach, describe, expect, it, vi } from "vitest";

const refreshMocks = vi.hoisted(() => ({
  refreshChannelRecentMemory: vi.fn(),
  refreshChannelFullMemory: vi.fn(),
  refreshCrossChannelRecentMemory: vi.fn(),
  refreshCrossChannelFullMemory: vi.fn(),
}));

vi.mock("./context-maintenance", () => refreshMocks);

import { createMaintenanceLoop } from "./maintenance-loop";
import type { Agent } from "./types";

describe("maintenance loop", () => {
  beforeEach(() => {
    for (const mock of Object.values(refreshMocks)) {
      mock.mockReset();
    }
    delete process.env.OPENAI_API_KEY;
  });

  it("uses host provider key fallback for realtime memory refreshes", async () => {
    process.env.OPENAI_API_KEY = "host-openai-key";
    let seenEnv: Record<string, string> | undefined;
    refreshMocks.refreshChannelRecentMemory.mockImplementation(
      async (input: { getEnv: () => Promise<Record<string, string>> }) => {
        seenEnv = await input.getEnv();
        return null;
      },
    );
    const getPackageSecretsEnv = vi.fn(async () => ({ TAVILY_API_KEY: "scoped-tool-key" }));
    const loop = createMaintenanceLoop({
      listChannels: async () => [
        {
          id: "chan-1",
          name: "voice",
          participants: [{ subscriberType: "AGENT", subscriberId: "voice-agent" }],
        },
      ],
      getPackageSecretsEnv,
      apiFetch: vi.fn(),
      channelRecentMemoryIntervalMs: 60_000,
      channelFullMemoryIntervalMs: Number.MAX_SAFE_INTEGER,
      crossRecentMemoryIntervalMs: Number.MAX_SAFE_INTEGER,
      crossFullMemoryIntervalMs: Number.MAX_SAFE_INTEGER,
    });
    const agent = { name: "voice-agent", modelId: "openai:gpt-realtime" } as Agent;

    loop.schedule(agent);
    await loop.awaitInFlight();

    expect(seenEnv).toMatchObject({
      OPENAI_API_KEY: "host-openai-key",
      TAVILY_API_KEY: "scoped-tool-key",
    });
  });

  it("does not use host provider key fallback for non-realtime memory refreshes", async () => {
    process.env.OPENAI_API_KEY = "host-openai-key";
    let seenEnv: Record<string, string> | undefined;
    refreshMocks.refreshChannelRecentMemory.mockImplementation(
      async (input: { getEnv: () => Promise<Record<string, string>> }) => {
        seenEnv = await input.getEnv();
        return null;
      },
    );
    const loop = createMaintenanceLoop({
      listChannels: async () => [
        {
          id: "chan-1",
          name: "chat",
          participants: [{ subscriberType: "AGENT", subscriberId: "chat-agent" }],
        },
      ],
      getPackageSecretsEnv: vi.fn(async () => ({})),
      apiFetch: vi.fn(),
      channelRecentMemoryIntervalMs: 60_000,
      channelFullMemoryIntervalMs: Number.MAX_SAFE_INTEGER,
      crossRecentMemoryIntervalMs: Number.MAX_SAFE_INTEGER,
      crossFullMemoryIntervalMs: Number.MAX_SAFE_INTEGER,
    });
    const agent = { name: "chat-agent", modelId: "openai:gpt-5.2" } as Agent;

    loop.schedule(agent);
    await loop.awaitInFlight();

    expect(seenEnv).toEqual({});
  });

  it("does not retry failing channel memory refreshes on every pass", async () => {
    refreshMocks.refreshChannelRecentMemory.mockRejectedValue(
      new Error("model does not support chat completions"),
    );
    refreshMocks.refreshChannelFullMemory.mockRejectedValue(
      new Error("model does not support chat completions"),
    );
    refreshMocks.refreshCrossChannelRecentMemory.mockResolvedValue(null);
    refreshMocks.refreshCrossChannelFullMemory.mockResolvedValue(null);
    const getPackageSecretsEnv = vi.fn(async () => ({}));
    const loop = createMaintenanceLoop({
      listChannels: async () => [
        {
          id: "chan-1",
          name: "voice",
          participants: [{ subscriberType: "AGENT", subscriberId: "voice-agent" }],
        },
      ],
      getPackageSecretsEnv,
      apiFetch: vi.fn(),
      channelRecentMemoryIntervalMs: 60_000,
      channelFullMemoryIntervalMs: 60_000,
      crossRecentMemoryIntervalMs: 60_000,
      crossFullMemoryIntervalMs: 60_000,
    });
    const agent = { name: "voice-agent" } as Agent;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    for (let pass = 0; pass < 3; pass += 1) {
      loop.schedule(agent);
      await loop.awaitInFlight();
    }

    warn.mockRestore();
    expect(refreshMocks.refreshChannelRecentMemory).toHaveBeenCalledTimes(1);
    expect(refreshMocks.refreshChannelFullMemory).toHaveBeenCalledTimes(1);
  });
});
