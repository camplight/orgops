import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { getMockAgent, getMockChannelRecord, getMockEvent, getMockExecutor } from "./factories";
import { useFakeNetwork } from "./lifecycle";
import { createFakeOrgops, DEFAULT_SECRETS_ENV } from "./orgops-api";
import { chatCompletion, createFakeProvider } from "./provider";
import { server } from "./server";
import type { Agent, Event } from "../types";

vi.mock("../wrapped-runtime", () => ({ runWrappedAgentTurn: vi.fn() }));
vi.mock("../rlm-process", () => ({ runRlmEventInChild: vi.fn() }));

useFakeNetwork();

type Reply = { text: string; usage?: { promptTokens: number; completionTokens: number } };

type RunTurnOptions = {
  agent?: Partial<Agent>;
  replies?: Reply[];
  channelHistory?: Event[];
  rejectTypePrefix?: string;
};

type ContextPayload = {
  contextWindowTokens: number;
  usageSource: string;
  estimatedUsedTokens: number;
  estimatedAvailableTokens: number;
  utilizationPct: number;
  messageCount: number;
  systemChars: number;
  systemContextChars: number;
  historyChars: number;
  attempt?: number;
  finishReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

type PromptPayload = {
  systemPrompt: string;
  systemContextMessages: string[];
  messages: Array<{ role: string; content: string }>;
};

const SECRETS = {
  ...DEFAULT_SECRETS_ENV,
  OPENAI_API_KEY: "test-key",
  ANTHROPIC_API_KEY: "test-key",
};

const trigger = getMockEvent({ id: "evt-trigger", createdAt: 1_000 });

const validEvent = JSON.stringify({ type: "message.created", payload: { text: "hi" } });

const anthropicMessage = () =>
  HttpResponse.json({
    id: "msg-test",
    type: "message",
    role: "assistant",
    model: "claude-test",
    content: [{ type: "text", text: validEvent }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  });

const runTurn = async (options: RunTurnOptions = {}) => {
  const { agent, replies = [{ text: validEvent }], channelHistory, rejectTypePrefix } = options;
  const orgops = createFakeOrgops({
    channels: [getMockChannelRecord()],
    channelHistory,
    secretsEnv: SECRETS,
    rejectEvent: rejectTypePrefix ? (event) => event.type.startsWith(rejectTypePrefix) : undefined,
  });
  const provider = createFakeProvider(
    replies.map((reply) => () => chatCompletion({ text: reply.text, usage: reply.usage })),
  );
  server.use(
    ...orgops.handlers,
    provider.handler,
    http.post("https://api.openai.com/v1/chat/completions", () =>
      chatCompletion({ text: validEvent }),
    ),
    http.post("https://api.anthropic.com/v1/messages", anthropicMessage),
  );
  const completed = await getMockExecutor()(getMockAgent(agent), [trigger]).then(
    () => true,
    () => false,
  );
  return { orgops, provider, completed };
};

type Orgops = Awaited<ReturnType<typeof runTurn>>["orgops"];

const contextEvents = (orgops: Orgops) =>
  orgops.emitted().filter((event) => event.type === "telemetry.context.window.updated");

const firstContext = (orgops: Orgops) => contextEvents(orgops)[0]!.payload as ContextPayload;

const secondContext = (orgops: Orgops) => contextEvents(orgops)[1]!.payload as ContextPayload;

const promptPayload = (orgops: Orgops) =>
  orgops.emitted().find((event) => event.type === "telemetry.prompt.composed")!
    .payload as PromptPayload;

const emittedTypes = (orgops: Orgops) => orgops.emitted().map((event) => event.type);

const windowOf = async (modelId: string) => {
  const { orgops } = await runTurn({ agent: { modelId } });
  return firstContext(orgops).contextWindowTokens;
};

const tokensOf = (text: string) => Math.ceil(text.length / 4);

describe("Telemetry events", () => {
  it("emits prompt and context telemetry between the turn start and the model event", async () => {
    const { orgops } = await runTurn();

    expect(emittedTypes(orgops)).toEqual([
      "agent.turn.started",
      "telemetry.prompt.composed",
      "telemetry.context.window.updated",
      "telemetry.context.window.updated",
      "message.created",
      "agent.turn.completed",
    ]);
  });

  it("emits the prompt telemetry as a delivered event from the runner prompt source on the turn channel", async () => {
    const { orgops } = await runTurn();

    expect(orgops.emitted()[1]).toMatchObject({
      type: "telemetry.prompt.composed",
      source: "system:runner:prompt",
      status: "DELIVERED",
      channelId: "chan-1",
      payload: { agentName: "alice", modelId: "openrouter:test-model", triggerEventId: "evt-trigger" },
    });
  });

  it("emits the context telemetry as delivered events from the runner context source on the turn channel", async () => {
    const { orgops } = await runTurn();

    expect(contextEvents(orgops)).toHaveLength(2);
    for (const event of contextEvents(orgops)) {
      expect(event).toMatchObject({
        source: "system:runner:context",
        status: "DELIVERED",
        channelId: "chan-1",
        payload: {
          agentName: "alice",
          modelId: "openrouter:test-model",
          memoryContextMode: "PER_CHANNEL_CROSS_CHANNEL",
          triggerEventId: "evt-trigger",
        },
      });
    }
  });

  it.each([true, undefined])("emits telemetry when emitAuditEvents is %s", async (emitAuditEvents) => {
    const { orgops } = await runTurn({ agent: { emitAuditEvents } });

    expect(emittedTypes(orgops)).toContain("telemetry.prompt.composed");
    expect(contextEvents(orgops)).toHaveLength(2);
  });

  it("emits no telemetry when emitAuditEvents is false and still completes the turn", async () => {
    const { orgops } = await runTurn({ agent: { emitAuditEvents: false } });

    expect(emittedTypes(orgops)).toEqual([
      "agent.turn.started",
      "message.created",
      "agent.turn.completed",
    ]);
  });
});

describe("Failing telemetry emits", () => {
  it("swallows a failing prompt telemetry emit and carries on", async () => {
    const { orgops } = await runTurn({ rejectTypePrefix: "telemetry.prompt" });

    expect(emittedTypes(orgops)).toEqual([
      "agent.turn.started",
      "telemetry.context.window.updated",
      "telemetry.context.window.updated",
      "message.created",
      "agent.turn.completed",
    ]);
  });

  it("swallows failing context telemetry emits and carries on", async () => {
    const { orgops } = await runTurn({ rejectTypePrefix: "telemetry.context" });

    expect(emittedTypes(orgops)).toEqual([
      "agent.turn.started",
      "telemetry.prompt.composed",
      "message.created",
      "agent.turn.completed",
    ]);
  });
});

describe("Estimated context usage", () => {
  const history = [
    getMockEvent({ id: "evt-0", createdAt: 10, payload: { text: "an earlier question" } }),
    getMockEvent({ id: "evt-9", createdAt: 20, source: "agent:bob", payload: { text: "bob answers" } }),
  ];

  it("reports the first context event as an estimate", async () => {
    const { orgops } = await runTurn();

    expect(firstContext(orgops).usageSource).toBe("estimate");
  });

  it("estimates the used tokens as a quarter of the characters of every composed message, rounded up per message", async () => {
    const { orgops } = await runTurn({
      agent: { memoryContextMode: "FULL_CHANNEL_EVENTS" },
      channelHistory: history,
    });

    const prompt = promptPayload(orgops);
    const expectedUsed = prompt.messages.reduce((sum, message) => sum + tokensOf(message.content), 0);
    expect(prompt.messages).toHaveLength(3);
    expect(firstContext(orgops).estimatedUsedTokens).toBe(expectedUsed);
  });

  it("reports the role of each composed message, with another agent's event as a system message", async () => {
    const { orgops } = await runTurn({
      agent: { memoryContextMode: "FULL_CHANNEL_EVENTS" },
      channelHistory: history,
    });

    expect(promptPayload(orgops).messages.map((message) => message.role)).toEqual([
      "system",
      "user",
      "system",
    ]);
  });

  it("reports the remaining tokens, the message count and the character split of the prompt", async () => {
    const { orgops } = await runTurn({
      agent: { memoryContextMode: "FULL_CHANNEL_EVENTS" },
      channelHistory: history,
    });

    const prompt = promptPayload(orgops);
    const [, ...historyMessages] = prompt.messages;
    const context = firstContext(orgops);
    expect(context).toMatchObject({
      messageCount: 3,
      systemChars: prompt.systemPrompt.length,
      systemContextChars: 0,
      historyChars: historyMessages.reduce((sum, message) => sum + message.content.length, 0),
      estimatedAvailableTokens: context.contextWindowTokens - context.estimatedUsedTokens,
    });
  });

  it("counts the system context messages apart from the history characters", async () => {
    const { orgops } = await runTurn({ channelHistory: history });

    const prompt = promptPayload(orgops);
    const context = firstContext(orgops);
    expect(prompt.systemContextMessages.length).toBeGreaterThan(0);
    expect(context.systemContextChars).toBe(
      prompt.systemContextMessages.reduce((sum, message) => sum + message.length, 0),
    );
    expect(context.historyChars).toBe(
      prompt.messages
        .filter((message) => !prompt.systemContextMessages.includes(message.content))
        .slice(1)
        .reduce((sum, message) => sum + message.content.length, 0),
    );
  });

  it("rounds the utilisation to two decimals", async () => {
    const { orgops } = await runTurn({ agent: { modelId: "openrouter:tel-round-other" } });

    const context = firstContext(orgops);
    const exact = (context.estimatedUsedTokens / context.contextWindowTokens) * 100;
    expect(context.utilizationPct).toBe(Math.round(exact * 100) / 100);
    expect(context.utilizationPct).not.toBe(exact);
  });

  it("caps the estimated utilisation at 100 and leaves no available tokens", async () => {
    const { orgops } = await runTurn({
      agent: {
        modelId: "openrouter:tel-cap-estimate-other",
        systemInstructions: "x".repeat(600_000),
      },
    });

    expect(firstContext(orgops)).toMatchObject({
      contextWindowTokens: 128_000,
      utilizationPct: 100,
      estimatedAvailableTokens: 0,
    });
    expect(firstContext(orgops).estimatedUsedTokens).toBeGreaterThan(128_000);
  });
});

describe("Provider usage telemetry", () => {
  it("adds a provider-sourced event with the reported tokens, the attempt and the finish reason", async () => {
    const { orgops } = await runTurn({
      agent: { modelId: "openrouter:tel-usage-claude" },
      replies: [{ text: validEvent, usage: { promptTokens: 1_000, completionTokens: 200 } }],
    });

    expect(secondContext(orgops)).toMatchObject({
      usageSource: "provider",
      contextWindowTokens: 200_000,
      estimatedUsedTokens: 1_000,
      estimatedAvailableTokens: 199_000,
      utilizationPct: 0.5,
      inputTokens: 1_000,
      outputTokens: 200,
      totalTokens: 1_200,
      attempt: 1,
      finishReason: "stop",
    });
  });

  it("rounds fractional token counts down", async () => {
    const { orgops } = await runTurn({
      replies: [{ text: validEvent, usage: { promptTokens: 10.7, completionTokens: 2.9 } }],
    });

    expect(secondContext(orgops)).toMatchObject({ inputTokens: 10, outputTokens: 2 });
  });

  it("clamps a negative token count to zero", async () => {
    const { orgops } = await runTurn({
      replies: [{ text: validEvent, usage: { promptTokens: -5, completionTokens: -1 } }],
    });

    expect(secondContext(orgops)).toMatchObject({
      usageSource: "provider",
      inputTokens: 0,
      outputTokens: 0,
      estimatedUsedTokens: 0,
    });
  });

  it("keeps the character split of the prompt on the provider event", async () => {
    const { orgops } = await runTurn({
      replies: [{ text: validEvent, usage: { promptTokens: 10, completionTokens: 2 } }],
    });

    const { messageCount, systemChars, systemContextChars, historyChars } = firstContext(orgops);
    expect(secondContext(orgops)).toMatchObject({
      messageCount,
      systemChars,
      systemContextChars,
      historyChars,
    });
  });

  it("falls back to the estimate when the provider response carries no usage", async () => {
    const { orgops } = await runTurn({ replies: [{ text: validEvent }] });

    const second = secondContext(orgops);
    expect(second).toMatchObject({
      usageSource: "estimate",
      estimatedUsedTokens: firstContext(orgops).estimatedUsedTokens,
      attempt: 1,
      finishReason: "stop",
    });
    expect(second.inputTokens).toBeUndefined();
  });

  it("emits one provider event per attempt with the attempt number and that attempt's tokens", async () => {
    const { orgops } = await runTurn({
      replies: [
        { text: "not json", usage: { promptTokens: 100, completionTokens: 1 } },
        { text: validEvent, usage: { promptTokens: 150, completionTokens: 2 } },
      ],
    });

    const providerEvents = contextEvents(orgops)
      .map((event) => event.payload as ContextPayload)
      .filter((payload) => payload.usageSource === "provider");
    expect(providerEvents.map((payload) => [payload.attempt, payload.inputTokens])).toEqual([
      [1, 100],
      [2, 150],
    ]);
  });

  it("emits the provider event before the model event", async () => {
    const { orgops } = await runTurn({
      replies: [{ text: validEvent, usage: { promptTokens: 10, completionTokens: 2 } }],
    });

    const types = emittedTypes(orgops);
    expect(types.lastIndexOf("telemetry.context.window.updated")).toBeLessThan(
      types.indexOf("message.created"),
    );
  });

  it("emits no provider event when emitAuditEvents is false", async () => {
    const { orgops } = await runTurn({
      agent: { emitAuditEvents: false },
      replies: [{ text: validEvent, usage: { promptTokens: 10, completionTokens: 2 } }],
    });

    expect(contextEvents(orgops)).toHaveLength(0);
  });

  it("caps the provider utilisation at 100 and leaves no available tokens", async () => {
    const { orgops } = await runTurn({
      agent: { modelId: "openrouter:tel-usage-cap-claude" },
      replies: [{ text: validEvent, usage: { promptTokens: 300_000, completionTokens: 2 } }],
    });

    expect(secondContext(orgops)).toMatchObject({
      estimatedUsedTokens: 300_000,
      estimatedAvailableTokens: 0,
      utilizationPct: 100,
    });
  });

  it("rounds the provider utilisation to two decimals", async () => {
    const { orgops } = await runTurn({
      agent: { modelId: "openrouter:tel-usage-round-claude" },
      replies: [{ text: validEvent, usage: { promptTokens: 1_234, completionTokens: 2 } }],
    });

    expect(secondContext(orgops).utilizationPct).toBe(0.62);
  });
});

describe("Context window resolution", () => {
  it.each([
    ["openai:gpt-4o", 128_000],
    ["openai:gpt-5", 400_000],
    ["openai:gpt-4.1", 1_047_576],
    ["anthropic:claude-sonnet-4-5", 200_000],
  ])("takes the window of %s from the model metadata: %d", async (modelId, expected) => {
    expect(await windowOf(modelId)).toBe(expected);
  });

  it("lowercases and trims the provider before the metadata lookup", async () => {
    expect(await windowOf(" OpenAI :gpt-5")).toBe(400_000);
  });

  it.each(["or:anthropic/claude-sonnet-4.5", "openrouter:anthropic/claude-sonnet-4.5"])(
    "resolves the openrouter metadata window of %s",
    async (modelId) => {
      expect(await windowOf(modelId)).toBe(1_000_000);
    },
  );

  it("keeps the colons of a model name when it looks up the metadata", async () => {
    expect(await windowOf("openrouter:moonshotai/kimi-k2:free")).toBe(32_800);
  });

  it("resolves the claude provider alias as anthropic", async () => {
    expect(await windowOf("claude:claude-sonnet-4-5")).toBe(200_000);
  });

  it.each([
    ["openrouter:tel-fallback-gpt-4o-mini-a", 128_000],
    ["openrouter:tel-fallback-gpt-4o-a", 128_000],
    ["openrouter:tel-fallback-gpt-4.1-mini-a", 1_000_000],
    ["openrouter:tel-fallback-gpt-4.1-a", 1_000_000],
    ["openrouter:tel-fallback-gpt-5-a", 1_000_000],
    ["openrouter:tel-fallback-claude-a", 200_000],
    ["openrouter:tel-fallback-other-a", 128_000],
  ])("uses the fallback table for the unknown model %s: %d", async (modelId, expected) => {
    expect(await windowOf(modelId)).toBe(expected);
  });

  it("matches the fallback table case-insensitively", async () => {
    expect(await windowOf("openrouter:TEL-FALLBACK-GPT-5-UPPER")).toBe(1_000_000);
  });

  it.each([
    ["tel-nocolon-claude", 200_000],
    ["tel-nocolon-gpt-5:", 1_000_000],
    [":tel-noprovider-gpt-5", 1_000_000],
  ])("uses the fallback table without a lookup for the malformed id %s", async (modelId, expected) => {
    expect(await windowOf(modelId)).toBe(expected);
  });

  it("gives the same window to a second turn with the same model id", async () => {
    const first = await windowOf("openai:gpt-5");
    const second = await windowOf("openai:gpt-5");

    expect([first, second]).toEqual([400_000, 400_000]);
  });
});
