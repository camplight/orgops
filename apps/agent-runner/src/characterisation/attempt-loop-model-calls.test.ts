import { describe, expect, it } from "vitest";
import { resolveAgentClassicMaxModelSteps } from "../turn-executor";
import { providerError, rawRetryTail, retryTail, setUpTurn } from "./attempt-loop-support";
import { getMockAgent, getMockChannelRecord } from "./factories";
import { useFakeNetwork } from "./lifecycle";
import { chatCompletion, replyWithEvent, replyWithText } from "./provider";

useFakeNetwork();

const goodEvent = replyWithEvent({ type: "message.created", payload: { text: "fixed" } });

const listChannelsCall = (id: string) => () =>
  chatCompletion({ toolCalls: [{ id, name: "events_channels_list", arguments: {} }] });

const toolArgumentsInvalid = (attempt: number, error: string) =>
  [
    `Your tool call arguments were invalid on attempt ${attempt}/3.`,
    `Error: ${error}`,
    "Retry with corrected tool arguments. For optional string filters, omit the field instead of sending an empty string.",
    "Return only a corrected JSON event object.",
  ].join("\n");

const contextEvents = (emitted: Array<{ type: string; payload: Record<string, unknown> }>) =>
  emitted.filter((event) => event.type === "telemetry.context.window.updated");

const modelEvents = (emitted: Array<{ type: string }>) =>
  emitted.filter((event) => !event.type.startsWith("agent.turn.") && !event.type.startsWith("telemetry.") && !event.type.startsWith("tool."));

describe("Attempt loop: invalid tool arguments error", () => {
  it("retries with the tool-arguments message when the provider failure names AI_InvalidToolArgumentsError", async () => {
    const { orgops, provider, run } = setUpTurn({
      responders: [providerError(400, "AI_InvalidToolArgumentsError: bad args"), goodEvent],
    });

    await run();

    expect(provider.requests).toHaveLength(2);
    expect(retryTail(provider, 1)).toEqual([
      toolArgumentsInvalid(1, "AI_APICallError: AI_InvalidToolArgumentsError: bad args"),
    ]);
    expect(rawRetryTail(provider, 1).startsWith("\n\n\n")).toBe(true);
    expect(modelEvents(orgops.emitted())).toEqual([
      { type: "message.created", source: "agent:alice", channelId: "chan-1", payload: { text: "fixed" } },
    ]);
    expect(orgops.emitted().at(-1)?.payload).not.toHaveProperty("completedWithFallback");
  });

  it("retries with the tool-arguments message when the failure says invalid arguments for a tool and type validation failed", async () => {
    const { provider, run } = setUpTurn({
      responders: [providerError(400, "Invalid arguments for tool events_search: Type validation failed"), goodEvent],
    });

    await run();

    expect(retryTail(provider, 1)).toEqual([
      toolArgumentsInvalid(
        1,
        "AI_APICallError: Invalid arguments for tool events_search: Type validation failed",
      ),
    ]);
  });

  it("does not retry when the failure only says invalid arguments for a tool", async () => {
    const { provider, run } = setUpTurn({
      responders: [providerError(400, "Invalid arguments for tool events_search"), goodEvent],
    });

    await expect(run()).rejects.toThrow("Invalid arguments for tool events_search");
    expect(provider.requests).toHaveLength(1);
  });

  it("does not retry when the failure only says type validation failed", async () => {
    const { provider, run } = setUpTurn({
      responders: [providerError(400, "Type validation failed"), goodEvent],
    });

    await expect(run()).rejects.toThrow("Type validation failed");
    expect(provider.requests).toHaveLength(1);
  });

  it("emits no usage telemetry for the failed attempt and reports the next one as attempt 2", async () => {
    const { orgops, run } = setUpTurn({
      responders: [
        providerError(400, "AI_InvalidToolArgumentsError: bad"),
        () => chatCompletion({ text: '{"type":"message.created","payload":{"text":"ok"}}', usage: { promptTokens: 120, completionTokens: 30 } }),
      ],
    });

    await run();

    expect(contextEvents(orgops.emitted()).map((event) => event.payload.usageSource)).toEqual([
      "estimate",
      "provider",
    ]);
    expect(contextEvents(orgops.emitted())[1]?.payload).toMatchObject({ attempt: 2, inputTokens: 120 });
  });

  it("counts the failed attempt against the three-attempt cap", async () => {
    const { orgops, provider, run } = setUpTurn({
      responders: [
        providerError(400, "AI_InvalidToolArgumentsError: bad"),
        providerError(400, "AI_InvalidToolArgumentsError: bad"),
        providerError(400, "AI_InvalidToolArgumentsError: bad"),
        goodEvent,
      ],
    });

    await run();

    expect(provider.requests).toHaveLength(3);
    expect(retryTail(provider, 2)).toEqual([
      toolArgumentsInvalid(1, "AI_APICallError: AI_InvalidToolArgumentsError: bad"),
      toolArgumentsInvalid(2, "AI_APICallError: AI_InvalidToolArgumentsError: bad"),
    ]);
    expect(modelEvents(orgops.emitted())).toEqual([
      {
        type: "message.created",
        source: "agent:alice",
        channelId: "chan-1",
        payload: { text: "Unable to produce structured event output." },
        parentEventId: "evt-1",
      },
    ]);
    expect(orgops.emitted().at(-1)).toMatchObject({ payload: { completedWithFallback: true } });
  });

  it("[quirk] feeds malformed tool arguments back to the model as a tool result instead of retrying the attempt", async () => {
    const malformed = () =>
      chatCompletion({
        toolCalls: [{ id: "call-bad", name: "events_channels_list", arguments: { kind: 5 } }],
      });
    const { provider, run } = setUpTurn({ responders: [malformed, goodEvent] });

    await run();

    const toolMessage = provider.requests[1]?.messages.find((message) => message.role === "tool");
    expect(provider.requests).toHaveLength(2);
    expect(toolMessage?.tool_call_id).toBe("call-bad");
    expect(String(toolMessage?.content)).toContain("Invalid input for tool events_channels_list: Type validation failed");
    expect(retryTail(provider, 1)).toEqual([]);
  });
});

describe("Attempt loop: other failures propagate", () => {
  it("rejects with the provider's error and emits no completed event for a 400", async () => {
    const { orgops, provider, run } = setUpTurn({ responders: [providerError(400, "bad request"), goodEvent] });

    await expect(run()).rejects.toThrow("bad request");

    expect(provider.requests).toHaveLength(1);
    expect(orgops.emitted().map((event) => event.type)).not.toContain("agent.turn.completed");
    expect(modelEvents(orgops.emitted())).toEqual([]);
  });

  it("rejects without a retry message for an authentication failure", async () => {
    const { provider, run } = setUpTurn({ responders: [providerError(401, "bad key"), goodEvent] });

    await expect(run()).rejects.toThrow("bad key");

    expect(provider.requests).toHaveLength(1);
  });

  it("rejects when the provider keeps answering 500 and emits no completed event", async () => {
    const quickRetry = { "retry-after-ms": "1" };
    const { orgops, provider, run } = setUpTurn({
      responders: [providerError(500, "boom", quickRetry)],
    });

    await expect(run()).rejects.toThrow("boom");

    expect(provider.requests).toHaveLength(3);
    expect(orgops.emitted().map((event) => event.type)).not.toContain("agent.turn.completed");
    expect(modelEvents(orgops.emitted())).toEqual([]);
  });

  it("[quirk] the SDK retries a single 500 on its own, so the turn succeeds without a retry message", async () => {
    const { orgops, provider, run } = setUpTurn({
      responders: [providerError(500, "boom", { "retry-after-ms": "1" }), goodEvent],
    });

    await run();

    expect(provider.requests).toHaveLength(2);
    expect(retryTail(provider, 1)).toEqual([]);
    expect(modelEvents(orgops.emitted())).toHaveLength(1);
    expect(orgops.emitted().at(-1)?.payload).not.toHaveProperty("completedWithFallback");
  });
});

describe("Attempt loop: tool calls", () => {
  it("executes the tool the provider asks for and sends its result in the next request", async () => {
    const { orgops, provider, run } = setUpTurn({
      channels: [getMockChannelRecord(), getMockChannelRecord({ id: "chan-2", name: "random" })],
      responders: [listChannelsCall("call-1"), goodEvent],
    });

    await run();

    const [first, second] = provider.requests;
    expect(first?.messages.map((message) => message.role)).toEqual(["user"]);
    expect(second?.messages.map((message) => message.role)).toEqual(["user", "assistant", "tool"]);
    expect(second?.messages[2]).toEqual({
      role: "tool",
      tool_call_id: "call-1",
      content: JSON.stringify({
        channels: [
          getMockChannelRecord(),
          getMockChannelRecord({ id: "chan-2", name: "random" }),
        ],
        totalMatched: 2,
      }),
    });
    expect(orgops.emitted().map((event) => event.type)).toEqual([
      "agent.turn.started",
      "telemetry.prompt.composed",
      "telemetry.context.window.updated",
      "tool.started",
      "tool.executed",
      "telemetry.context.window.updated",
      "message.created",
      "agent.turn.completed",
    ]);
  });

  it("echoes the tool call back to the model in the assistant message", async () => {
    const { provider, run } = setUpTurn({ responders: [listChannelsCall("call-1"), goodEvent] });

    await run();

    expect(provider.requests[1]?.messages[1]).toMatchObject({
      role: "assistant",
      tool_calls: [
        { id: "call-1", type: "function", function: { name: "events_channels_list", arguments: "{}" } },
      ],
    });
  });

  it("passes the tool arguments to the real tool", async () => {
    const { provider, run } = setUpTurn({
      channels: [getMockChannelRecord(), getMockChannelRecord({ id: "chan-2", name: "random" })],
      responders: [
        () =>
          chatCompletion({
            toolCalls: [{ id: "call-2", name: "events_channels_list", arguments: { nameContains: "rand" } }],
          }),
        goodEvent,
      ],
    });

    await run();

    expect(provider.requests[1]?.messages[2]?.content).toBe(
      JSON.stringify({ channels: [getMockChannelRecord({ id: "chan-2", name: "random" })], totalMatched: 1 }),
    );
  });

  it("keeps a multi-step tool loop inside one attempt", async () => {
    const { provider, run } = setUpTurn({
      responders: [listChannelsCall("call-1"), listChannelsCall("call-2"), goodEvent],
    });

    await run();

    expect(provider.requests).toHaveLength(3);
    expect(provider.requests[2]?.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
      "tool",
    ]);
    expect(retryTail(provider, 2)).toEqual([]);
  });

  it("keeps earlier retry messages in the request after a tool call in a later attempt", async () => {
    const { provider, run } = setUpTurn({
      responders: [replyWithText("no json"), listChannelsCall("call-1"), goodEvent],
    });

    await run();

    expect(provider.requests).toHaveLength(3);
    expect(retryTail(provider, 2)).toHaveLength(1);
    expect(provider.requests[2]?.messages.map((message) => message.role)).toEqual(["user", "assistant", "tool"]);
  });
});

describe("Attempt loop: step cap", () => {
  it("stops a provider that keeps requesting tool calls after classicMaxModelSteps requests per attempt", async () => {
    const { orgops, provider, run } = setUpTurn({
      agent: { classicMaxModelSteps: 2 },
      responders: [listChannelsCall("call-loop")],
    });

    await run();

    expect(provider.requests).toHaveLength(6);
    expect(orgops.emitted().at(-1)).toMatchObject({ payload: { completedWithFallback: true } });
  });

  it("allows exactly the configured number of requests before the model gives its answer", async () => {
    const { orgops, provider, run } = setUpTurn({
      agent: { classicMaxModelSteps: 3 },
      responders: [listChannelsCall("c1"), listChannelsCall("c2"), goodEvent],
    });

    await run();

    expect(provider.requests).toHaveLength(3);
    expect(modelEvents(orgops.emitted())).toHaveLength(1);
    expect(orgops.emitted().at(-1)?.payload).not.toHaveProperty("completedWithFallback");
  });

  it("stops at one request per attempt when the cap is 1", async () => {
    const { provider, run } = setUpTurn({
      agent: { classicMaxModelSteps: 1 },
      responders: [listChannelsCall("call-loop")],
    });

    await run();

    expect(provider.requests).toHaveLength(3);
  });

  it("rounds a fractional cap down", async () => {
    const { provider, run } = setUpTurn({
      agent: { classicMaxModelSteps: 2.9 },
      responders: [listChannelsCall("call-loop")],
    });

    await run();

    expect(provider.requests).toHaveLength(6);
  });

  it("treats a step cap that stops the loop as an empty answer and retries with the empty-response message", async () => {
    const { provider, run } = setUpTurn({
      agent: { classicMaxModelSteps: 1 },
      responders: [listChannelsCall("call-loop")],
    });

    await run();

    expect(retryTail(provider, 1)[0]).toBe(
      [
        "Your previous response was not valid JSON on attempt 1/3.",
        "Error: Error: Empty response.",
        "Return only a corrected JSON event object.",
      ].join("\n"),
    );
  });
});

describe("resolveAgentClassicMaxModelSteps", () => {
  it.each([
    { configured: undefined, expected: 100 },
    { configured: 5, expected: 5 },
    { configured: 1, expected: 1 },
    { configured: 7.9, expected: 7 },
    { configured: 0, expected: 100 },
    { configured: -3, expected: 100 },
    { configured: Number.NaN, expected: 100 },
    { configured: Number.POSITIVE_INFINITY, expected: 100 },
    { configured: 0.5, expected: 0 },
  ])("resolves $configured to $expected", ({ configured, expected }) => {
    expect(resolveAgentClassicMaxModelSteps(getMockAgent({ classicMaxModelSteps: configured }))).toBe(expected);
  });
});
