import { describe, expect, it, vi } from "vitest";
import { getMockAgent, getMockChannelRecord, getMockEvent, getMockExecutor } from "./factories";
import { useFakeNetwork } from "./lifecycle";
import { createFakeOrgops, type MemoryRecords } from "./orgops-api";
import { createFakeProvider, replyWithEvent } from "./provider";
import { server } from "./server";
import type { Agent, Event } from "../types";

vi.mock("../wrapped-runtime", () => ({ runWrappedAgentTurn: vi.fn() }));
vi.mock("../rlm-process", () => ({ runRlmEventInChild: vi.fn() }));

useFakeNetwork();

type PromptTelemetry = {
  memoryContextMode: string;
  systemContextMessages: string[];
  messages: Array<{ role: string; content: string }>;
};

type RunTurnOptions = {
  agent?: Partial<Agent>;
  channelHistory?: Event[] | ((query: URLSearchParams) => Event[]);
  memoryRecords?: MemoryRecords;
  holdMemoryResponses?: boolean;
};

const trigger = getMockEvent({ id: "evt-trigger", createdAt: 1_000, payload: { text: "trigger text" } });

const runTurn = async (options: RunTurnOptions = {}) => {
  const { agent, channelHistory, memoryRecords, holdMemoryResponses } = options;
  const orgops = createFakeOrgops({
    channels: [getMockChannelRecord()],
    channelHistory,
    memoryRecords,
    holdMemoryResponses,
  });
  const provider = createFakeProvider([
    replyWithEvent({ type: "message.created", payload: { text: "hi" } }),
  ]);
  server.use(...orgops.handlers, provider.handler);
  await getMockExecutor()(getMockAgent(agent), [trigger]);
  const telemetry = orgops
    .emitted()
    .find((event) => event.type === "telemetry.prompt.composed")!.payload as PromptTelemetry;
  return { orgops, provider, telemetry };
};

const record = (summaryText: string, extra: Record<string, unknown> = {}) => ({
  summaryText,
  lastProcessedAt: 0,
  version: 1,
  ...extra,
});

const historyEvent = (id: string, overrides?: Partial<Event>) =>
  getMockEvent({ id, createdAt: 100, ...overrides });

const eventIdOf = (content: string): string[] => {
  try {
    const parsed = JSON.parse(content);
    return typeof parsed.eventId === "string" ? [parsed.eventId] : [];
  } catch {
    return [];
  }
};

const historyIds = (telemetry: PromptTelemetry) =>
  telemetry.messages.flatMap((message) => eventIdOf(message.content));

const deltaIds = (telemetry: PromptTelemetry) => {
  const delta = telemetry.systemContextMessages.find((message) =>
    message.startsWith("Channel Delta Events Since Last Summary"),
  );
  if (!delta) return [];
  return JSON.parse(delta.split("\n").slice(2).join("\n")).map((event: { id: string }) => event.id);
};

const historyListings = (orgops: ReturnType<typeof createFakeOrgops>) =>
  orgops.requestLog().filter((entry) => entry.startsWith("GET /api/events?channelId="));

const memoryCalls = (orgops: ReturnType<typeof createFakeOrgops>) =>
  orgops.callLog().filter((entry) => entry.startsWith("GET /api/memory/"));

describe("Memory mode resolution", () => {
  it("defaults to per-channel and cross-channel memory when the agent has no mode", async () => {
    const { orgops, telemetry } = await runTurn({ agent: { memoryContextMode: undefined } });

    expect(telemetry.memoryContextMode).toBe("PER_CHANNEL_CROSS_CHANNEL");
    expect(memoryCalls(orgops)).toHaveLength(4);
  });

  it.each(["SOMETHING_ELSE", null, ""])(
    "falls back to the default mode for the unrecognised value %j",
    async (value) => {
      const { orgops, telemetry } = await runTurn({
        agent: { memoryContextMode: JSON.parse(JSON.stringify(value)) },
      });

      expect(telemetry.memoryContextMode).toBe("PER_CHANNEL_CROSS_CHANNEL");
      expect(memoryCalls(orgops)).toHaveLength(4);
    },
  );

  it.each(["PER_CHANNEL_CROSS_CHANNEL", "FULL_CHANNEL_EVENTS", "OFF"] as const)(
    "reports the configured mode %s in the prompt telemetry",
    async (mode) => {
      const { telemetry } = await runTurn({ agent: { memoryContextMode: mode } });

      expect(telemetry.memoryContextMode).toBe(mode);
    },
  );
});

describe("Per-channel and cross-channel memory reads", () => {
  it("reads the four memory records for the agent, with the channel for the two channel records", async () => {
    const { orgops } = await runTurn();

    expect(orgops.memoryQueries()).toEqual([
      "/api/memory/channel/recent?agentName=alice&channelId=chan-1",
      "/api/memory/channel/full?agentName=alice&channelId=chan-1",
      "/api/memory/cross/recent?agentName=alice",
      "/api/memory/cross/full?agentName=alice",
    ]);
  });

  it("sends all four memory requests before any of them is answered", async () => {
    const { orgops } = await runTurn({ holdMemoryResponses: true });

    expect(orgops.memoryRequestsArrivedBeforeFirstResponse()).toBe(4);
  });

  it("reads the memory records before it lists the channel events", async () => {
    const { orgops } = await runTurn();

    const calls = orgops.callLog();
    const listing = calls.indexOf("GET /api/events");
    expect(calls.slice(listing - 4, listing)).toEqual([
      "GET /api/memory/channel/recent",
      "GET /api/memory/channel/full",
      "GET /api/memory/cross/recent",
      "GET /api/memory/cross/full",
    ]);
  });
});

describe("Events after the recent-summary watermark", () => {
  it("lists the channel events after the recent summary's lastProcessedAt", async () => {
    const { orgops } = await runTurn({
      memoryRecords: { channelRecent: record("recent", { lastProcessedAt: 4_321 }) },
    });

    expect(historyListings(orgops)).toEqual([
      "GET /api/events?channelId=chan-1&order=asc&limit=500&after=4321",
    ]);
  });

  it.each([
    { name: "no recent record", channelRecent: null },
    { name: "a zero watermark", channelRecent: record("recent", { lastProcessedAt: 0 }) },
    { name: "a negative watermark", channelRecent: record("recent", { lastProcessedAt: -5 }) },
    { name: "a non-numeric watermark", channelRecent: record("recent", { lastProcessedAt: "4321" }) },
  ])("lists the whole channel when there is $name", async ({ channelRecent }) => {
    const { orgops } = await runTurn({ memoryRecords: { channelRecent } });

    expect(historyListings(orgops)).toEqual([
      "GET /api/events?channelId=chan-1&order=asc&limit=500&after=0",
    ]);
  });

  it("only uses the watermark of the channel recent record, not the other records", async () => {
    const { orgops } = await runTurn({
      memoryRecords: {
        channelFull: record("full", { lastProcessedAt: 111 }),
        crossRecent: record("cross recent", { lastProcessedAt: 222 }),
        crossFull: record("cross full", { lastProcessedAt: 333 }),
      },
    });

    expect(historyListings(orgops)[0]).toContain("after=0");
  });
});

describe("System context messages", () => {
  it("emits the five messages in a fixed order: channel recent, delta, channel full, cross recent, cross full", async () => {
    const { telemetry } = await runTurn({
      memoryRecords: {
        crossFull: record("cross full text"),
        crossRecent: record("cross recent text"),
        channelFull: record("channel full text"),
        channelRecent: record("channel recent text"),
      },
      channelHistory: [historyEvent("evt-old"), trigger],
    });

    expect(telemetry.systemContextMessages).toHaveLength(5);
    expect(telemetry.systemContextMessages[0]).toBe(
      "Channel Recent Summary (last 10 minutes, chan-1)\nchannel recent text",
    );
    expect(telemetry.systemContextMessages[1]).toMatch(
      /^Channel Delta Events Since Last Summary \(chan-1\)\n/,
    );
    expect(telemetry.systemContextMessages.slice(2)).toEqual([
      "Channel Full Memory (chan-1)\nchannel full text",
      "Cross-Channel Recent Summary (last 10 minutes)\ncross recent text",
      "Cross-Channel Full Memory\ncross full text",
    ]);
  });

  it("emits no context messages when there are no records and no events", async () => {
    const { telemetry } = await runTurn();

    expect(telemetry.systemContextMessages).toEqual([]);
  });

  it("skips a record whose summary text is empty", async () => {
    const { telemetry } = await runTurn({
      memoryRecords: {
        channelRecent: record(""),
        channelFull: record(""),
        crossRecent: record(""),
        crossFull: record(""),
      },
    });

    expect(telemetry.systemContextMessages).toEqual([]);
  });

  it.each([
    {
      name: "channel recent",
      records: { channelRecent: record("only") },
      expected: ["Channel Recent Summary (last 10 minutes, chan-1)\nonly"],
    },
    {
      name: "channel full",
      records: { channelFull: record("only") },
      expected: ["Channel Full Memory (chan-1)\nonly"],
    },
    {
      name: "cross recent",
      records: { crossRecent: record("only") },
      expected: ["Cross-Channel Recent Summary (last 10 minutes)\nonly"],
    },
    {
      name: "cross full",
      records: { crossFull: record("only") },
      expected: ["Cross-Channel Full Memory\nonly"],
    },
  ])("emits just the $name message when only that record exists", async ({ records, expected }) => {
    const { telemetry } = await runTurn({ memoryRecords: records });

    expect(telemetry.systemContextMessages).toEqual(expected);
  });

  it("trims the summary text", async () => {
    const { telemetry } = await runTurn({
      memoryRecords: { crossFull: record("  \n padded text \n  ") },
    });

    expect(telemetry.systemContextMessages).toEqual(["Cross-Channel Full Memory\npadded text"]);
  });

  it("truncates a summary longer than 16000 characters and says how many were omitted", async () => {
    const { telemetry } = await runTurn({
      memoryRecords: { crossFull: record("x".repeat(16_005)) },
    });

    expect(telemetry.systemContextMessages).toEqual([
      `Cross-Channel Full Memory\n${"x".repeat(16_000)}\n...[truncated 5 chars]`,
    ]);
  });

  it("keeps a summary of exactly 16000 characters whole", async () => {
    const { telemetry } = await runTurn({
      memoryRecords: { crossFull: record("x".repeat(16_000)) },
    });

    expect(telemetry.systemContextMessages).toEqual([
      `Cross-Channel Full Memory\n${"x".repeat(16_000)}`,
    ]);
  });

  it("[quirk] emits a title-only message for a whitespace-only summary", async () => {
    const { telemetry } = await runTurn({ memoryRecords: { crossFull: record("   ") } });

    expect(telemetry.systemContextMessages).toEqual(["Cross-Channel Full Memory\n"]);
  });

  it("reaches the model inside the single system message that the provider receives", async () => {
    const { provider } = await runTurn({
      memoryRecords: { crossFull: record("cross full text") },
      channelHistory: [trigger],
    });

    expect(provider.requests[0]?.messages[0]?.role).toBe("system");
    expect(String(provider.requests[0]?.messages[0]?.content)).toContain(
      "Cross-Channel Full Memory\ncross full text",
    );
  });
});

describe("Channel delta message", () => {
  it("lists the newest meaningful events after the recent summary as compact indented JSON", async () => {
    const { telemetry } = await runTurn({
      channelHistory: [
        historyEvent("evt-old", {
          createdAt: 12.7,
          source: "agent:bob",
          type: "message.created",
          payload: { text: "earlier" },
        }),
        trigger,
      ],
    });

    expect(telemetry.systemContextMessages).toEqual([
      [
        "Channel Delta Events Since Last Summary (chan-1)",
        "These are the newest meaningful events after the latest recent channel summary.",
        JSON.stringify(
          [
            {
              id: "evt-old",
              createdAt: 12,
              type: "message.created",
              source: "agent:bob",
              channelId: "chan-1",
              payload: { text: "earlier" },
            },
          ],
          null,
          2,
        ),
      ].join("\n"),
    ]);
  });

  it("shows an empty payload for an event without one", async () => {
    const { telemetry } = await runTurn({
      channelHistory: [historyEvent("evt-old", { payload: undefined }), trigger],
    });

    const delta = telemetry.systemContextMessages[0]!;
    expect(JSON.parse(delta.split("\n").slice(2).join("\n"))[0].payload).toEqual({});
  });

  it("leaves out the latest event that was not authored by the agent, as it is the trigger", async () => {
    const { telemetry } = await runTurn({
      channelHistory: [
        historyEvent("evt-a", { createdAt: 10 }),
        historyEvent("evt-b", { createdAt: 20 }),
        trigger,
      ],
    });

    expect(deltaIds(telemetry)).toEqual(["evt-a", "evt-b"]);
  });

  it("keeps the agent's own events that came after the latest event from someone else", async () => {
    const { telemetry } = await runTurn({
      channelHistory: [
        historyEvent("evt-human", { createdAt: 10 }),
        historyEvent("evt-own", { createdAt: 20, source: "agent:alice" }),
      ],
    });

    expect(deltaIds(telemetry)).toEqual(["evt-own"]);
  });

  it("lists every event when all of them were authored by the agent", async () => {
    const { telemetry } = await runTurn({
      channelHistory: [
        historyEvent("evt-own-1", { createdAt: 10, source: "agent:alice" }),
        historyEvent("evt-own-2", { createdAt: 20, source: "agent:alice" }),
      ],
    });

    expect(deltaIds(telemetry)).toEqual(["evt-own-1", "evt-own-2"]);
  });

  it("emits no delta message when the trigger is the only event after the watermark", async () => {
    const { telemetry } = await runTurn({ channelHistory: [trigger] });

    expect(telemetry.systemContextMessages).toEqual([]);
  });

  it("keeps only the newest 120 events", async () => {
    const events = Array.from({ length: 122 }, (_, index) =>
      historyEvent(`evt-${String(index).padStart(3, "0")}`, { createdAt: 100 + index }),
    );

    const { telemetry } = await runTurn({ channelHistory: events });

    const ids = deltaIds(telemetry);
    expect(ids).toHaveLength(120);
    expect(ids[0]).toBe("evt-001");
    expect(ids.at(-1)).toBe("evt-120");
  });
});

describe("Meaningful event filter", () => {
  const noise = [
    historyEvent("evt-audit", { type: "audit.something" }),
    historyEvent("evt-telemetry", { type: "telemetry.prompt.composed" }),
    historyEvent("evt-tool", { type: "tool.call.started" }),
    historyEvent("evt-turn", { type: "agent.turn.completed" }),
    historyEvent("evt-memory", { type: "memory.updated" }),
    historyEvent("evt-dead", { type: "event.deadlettered" }),
  ];
  const meaningful = [
    historyEvent("evt-message", { type: "message.created" }),
    historyEvent("evt-bare-audit", { type: "audit" }),
    historyEvent("evt-bare-tool", { type: "tool" }),
    historyEvent("evt-toolbox", { type: "toolbox.opened" }),
    historyEvent("evt-control", { type: "agent.control.pause" }),
    historyEvent("evt-wrapper", { type: "wrapper.started" }),
    historyEvent("evt-dead-suffix", { type: "event.deadlettered.later" }),
  ];

  it("drops audit, telemetry, tool, agent turn, memory and dead-letter events from the delta", async () => {
    const { telemetry } = await runTurn({ channelHistory: [...noise, ...meaningful, trigger] });

    expect(deltaIds(telemetry)).toEqual(meaningful.map((event) => event.id));
  });

  it("drops the same events from the history in per-channel mode", async () => {
    const { telemetry } = await runTurn({ channelHistory: [...noise, ...meaningful, trigger] });

    expect(historyIds(telemetry)).toEqual([...meaningful, trigger].map((event) => event.id));
  });

  it("drops the same events from the history in full-channel mode", async () => {
    const { telemetry } = await runTurn({
      agent: { memoryContextMode: "FULL_CHANNEL_EVENTS" },
      channelHistory: [...noise, ...meaningful, trigger],
    });

    expect(historyIds(telemetry)).toEqual([...meaningful, trigger].map((event) => event.id));
  });
});

describe("Full channel events mode", () => {
  it("lists the whole channel history from the start", async () => {
    const { orgops } = await runTurn({ agent: { memoryContextMode: "FULL_CHANNEL_EVENTS" } });

    expect(historyListings(orgops)).toEqual([
      "GET /api/events?channelId=chan-1&order=asc&limit=500&after=0",
    ]);
  });

  it("makes no memory calls", async () => {
    const { orgops } = await runTurn({ agent: { memoryContextMode: "FULL_CHANNEL_EVENTS" } });

    expect(memoryCalls(orgops)).toEqual([]);
  });

  it("adds no system context messages", async () => {
    const { telemetry } = await runTurn({
      agent: { memoryContextMode: "FULL_CHANNEL_EVENTS" },
      channelHistory: [historyEvent("evt-old"), trigger],
    });

    expect(telemetry.systemContextMessages).toEqual([]);
  });

  it("sends the history to the model as messages in time order", async () => {
    const { telemetry } = await runTurn({
      agent: { memoryContextMode: "FULL_CHANNEL_EVENTS" },
      channelHistory: [
        historyEvent("evt-second", { createdAt: 300 }),
        historyEvent("evt-first", { createdAt: 200 }),
        trigger,
      ],
    });

    expect(historyIds(telemetry)).toEqual(["evt-first", "evt-second", "evt-trigger"]);
  });

  it("ignores memory records even when the API has them", async () => {
    const { telemetry } = await runTurn({
      agent: { memoryContextMode: "FULL_CHANNEL_EVENTS" },
      memoryRecords: { channelRecent: record("recent", { lastProcessedAt: 500 }) },
    });

    expect(telemetry.systemContextMessages).toEqual([]);
  });
});

describe("Memory off mode", () => {
  it("makes no memory calls and lists no channel history", async () => {
    const { orgops } = await runTurn({ agent: { memoryContextMode: "OFF" } });

    expect(memoryCalls(orgops)).toEqual([]);
    expect(historyListings(orgops)).toEqual([]);
  });

  it("adds no system context messages and no history messages", async () => {
    const { telemetry } = await runTurn({
      agent: { memoryContextMode: "OFF" },
      channelHistory: [historyEvent("evt-old"), trigger],
      memoryRecords: { crossFull: record("cross full text") },
    });

    expect(telemetry.systemContextMessages).toEqual([]);
    expect(telemetry.messages.map((message) => message.role)).toEqual(["system"]);
  });

  it("[quirk] shows the model only the system text, as the trigger event is not part of the messages", async () => {
    const { provider } = await runTurn({ agent: { memoryContextMode: "OFF" } });

    expect(provider.requests[0]?.messages).toHaveLength(1);
    expect(provider.requests[0]?.messages[0]?.role).toBe("user");
    expect(String(provider.requests[0]?.messages[0]?.content)).not.toContain("trigger text");
  });
});
