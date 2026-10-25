import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getMockAgent, getMockChannelRecord, getMockEvent } from "./factories";
import { useFakeNetwork } from "./lifecycle";
import { API_ORIGIN, createFakeOrgops } from "./orgops-api";
import { chatCompletion, createFakeProvider } from "./provider";
import { server } from "./server";
import type { Agent, Event } from "../types";

vi.mock("../wrapped-runtime", () => ({ runWrappedAgentTurn: vi.fn() }));
vi.mock("../rlm-process", () => ({ runRlmEventInChild: vi.fn() }));

useFakeNetwork();

afterEach(() => vi.unstubAllEnvs());

type RunTurnOptions = {
  limit?: string;
  agent?: Partial<Agent>;
  history?: Event[];
  replies?: string[];
  routes?: Parameters<typeof server.use>;
};

type WireMessage = { role: string; content: unknown };

const DEFAULT_LIMIT = 200_000;

const trigger = getMockEvent({ id: "evt-trigger", createdAt: 1_000 });

const validEvent = JSON.stringify({ type: "message.created", payload: { text: "hi" } });

const runTurn = async (options: RunTurnOptions = {}) => {
  const { limit, agent, history = [getMockEvent({ id: "h0", createdAt: 5, payload: { text: "hello" } })], replies = [validEvent], routes = [] } = options;
  vi.resetModules();
  vi.stubEnv("ORGOPS_MAX_LLM_MESSAGE_CHARS", limit);
  const { getMockExecutor } = await import("./factories");
  const orgops = createFakeOrgops({ channels: [getMockChannelRecord()], channelHistory: history });
  const provider = createFakeProvider(
    replies.map((text) => () => chatCompletion({ text })),
  );
  server.use(...orgops.handlers, provider.handler, ...routes);
  await getMockExecutor()(
    getMockAgent({ memoryContextMode: "FULL_CHANNEL_EVENTS", ...agent }),
    [trigger],
  );
  const promptTelemetry = orgops
    .emitted()
    .find((event) => event.type === "telemetry.prompt.composed")!.payload as {
    systemPrompt: string;
  };
  return {
    orgops,
    requests: provider.requests,
    systemPrompt: promptTelemetry.systemPrompt,
    sent: (provider.requests[0]?.messages ?? []) as WireMessage[],
  };
};

const marker = (omitted: number) => `\n...[truncated ${omitted} chars]`;

const historyEvent = (id: string, createdAt: number, payload: Record<string, unknown>) =>
  getMockEvent({ id, createdAt, payload });

const systemContentOf = (sent: WireMessage[]) =>
  sent.find((message) => message.role === "system")!.content as string;

const userContentsOf = (sent: WireMessage[]) =>
  sent.filter((message) => message.role === "user").map((message) => message.content);

const systemInstructionsFor = async (systemLength: number) => {
  const probe = await runTurn({ agent: { systemInstructions: "x".repeat(10) } });
  return "x".repeat(systemLength - (probe.systemPrompt.length - 10));
};

const userMessageOf = async (text: string, id = "h1") => {
  const probe = await runTurn({ history: [historyEvent(id, 10, { text })] });
  return userContentsOf(probe.sent)[0] as string;
};

describe("Default message limit", () => {
  it("leaves a message of exactly 200000 characters untouched", async () => {
    const { sent, systemPrompt } = await runTurn({
      agent: { systemInstructions: await systemInstructionsFor(DEFAULT_LIMIT) },
    });

    expect(systemPrompt).toHaveLength(DEFAULT_LIMIT);
    expect(systemContentOf(sent)).toBe(systemPrompt);
  });

  it("cuts a message one character over 200000 and marks the one omitted character", async () => {
    const { sent, systemPrompt } = await runTurn({
      agent: { systemInstructions: await systemInstructionsFor(DEFAULT_LIMIT + 1) },
    });

    expect(systemPrompt).toHaveLength(DEFAULT_LIMIT + 1);
    expect(systemContentOf(sent)).toBe(systemPrompt.slice(0, DEFAULT_LIMIT) + marker(1));
  });

  it("marks the number of omitted characters of a much larger message", async () => {
    const { sent, systemPrompt } = await runTurn({
      agent: { systemInstructions: "y".repeat(250_000) },
    });

    expect(systemContentOf(sent)).toBe(
      systemPrompt.slice(0, DEFAULT_LIMIT) + marker(systemPrompt.length - DEFAULT_LIMIT),
    );
  });
});

describe("Configured message limit", () => {
  it("cuts the system message at the limit from ORGOPS_MAX_LLM_MESSAGE_CHARS", async () => {
    const { sent, systemPrompt } = await runTurn({ limit: "1000" });

    expect(systemContentOf(sent)).toBe(systemPrompt.slice(0, 1000) + marker(systemPrompt.length - 1000));
  });

  it("rounds a fractional limit down", async () => {
    const { sent, systemPrompt } = await runTurn({ limit: "1500.7" });

    expect(systemContentOf(sent)).toBe(systemPrompt.slice(0, 1500) + marker(systemPrompt.length - 1500));
  });

  it.each(["abc", "", "0", "-5", "Infinity"])(
    "falls back to the default limit for the invalid setting %j",
    async (limit) => {
      const { sent, systemPrompt } = await runTurn({
        limit,
        agent: { systemInstructions: "y".repeat(250_000) },
      });

      expect(systemContentOf(sent)).toBe(
        systemPrompt.slice(0, DEFAULT_LIMIT) + marker(systemPrompt.length - DEFAULT_LIMIT),
      );
    },
  );
});

describe("Message content kinds", () => {
  it("keeps a string history message that is exactly at the limit", async () => {
    const full = await userMessageOf("a history message");

    const { sent } = await runTurn({
      limit: String(full.length),
      history: [historyEvent("h1", 10, { text: "a history message" })],
    });

    expect(userContentsOf(sent)).toEqual([full]);
  });

  it("cuts a string history message one character over the limit", async () => {
    const full = await userMessageOf("a history message");

    const { sent } = await runTurn({
      limit: String(full.length - 1),
      history: [historyEvent("h1", 10, { text: "a history message" })],
    });

    expect(userContentsOf(sent)).toEqual([full.slice(0, full.length - 1) + marker(1)]);
  });

  it("clamps each message on its own and leaves the shorter ones whole", async () => {
    const short = await userMessageOf("short");
    const long = await userMessageOf("a much longer history message that goes over the limit", "h2");

    const { sent } = await runTurn({
      limit: String(short.length),
      history: [
        historyEvent("h1", 10, { text: "short" }),
        historyEvent("h2", 20, { text: "a much longer history message that goes over the limit" }),
      ],
    });

    expect(userContentsOf(sent)).toEqual([
      short,
      long.slice(0, short.length) + marker(long.length - short.length),
    ]);
  });

  it("clamps the retry messages that follow a failed attempt", async () => {
    const { requests } = await runTurn({ limit: "100", replies: ["not json", validEvent] });

    expect(systemContentOf(requests[1]!.messages)).toMatch(
      /\n\nYour previous response was not valid JSON on attempt 1\/3\.\nError: [\s\S]*\n\.\.\.\[truncated \d+ chars\]$/,
    );
  });

  it("cuts the text part of an array message and keeps its image part", async () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const routes = [
      http.get(`${API_ORIGIN}/api/files/file-1`, () =>
        HttpResponse.arrayBuffer(png.buffer, { headers: { "content-type": "image/png" } }),
      ),
    ] as const;
    const attachments = [{ fileId: "file-1", mime: "image/png" }];
    const history = [historyEvent("h1", 10, { text: "look at this picture", attachments })];

    const probe = await runTurn({ history, routes: [...routes] });
    const [probeText, probeImage] = userContentsOf(probe.sent)[0] as Array<{
      type: string;
      text?: string;
    }>;
    const { sent } = await runTurn({ limit: "200", history, routes: [...routes] });

    const [text, image] = userContentsOf(sent)[0] as Array<{ type: string; text?: string }>;
    expect(probeText!.text!.length).toBeGreaterThan(200);
    expect(text).toEqual({
      type: "text",
      text: probeText!.text!.slice(0, 200) + marker(probeText!.text!.length - 200),
    });
    expect(image).toEqual(probeImage);
  });

  it("leaves the text part of an array message whole when it is within the limit", async () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const routes = [
      http.get(`${API_ORIGIN}/api/files/file-1`, () =>
        HttpResponse.arrayBuffer(png.buffer, { headers: { "content-type": "image/png" } }),
      ),
    ];
    const attachments = [{ fileId: "file-1", mime: "image/png" }];
    const history = [historyEvent("h1", 10, { text: "look at this picture", attachments })];

    const probe = await runTurn({ history, routes });
    const { sent } = await runTurn({ limit: "5000", history, routes });

    expect(userContentsOf(sent)).toEqual(userContentsOf(probe.sent));
  });
});
