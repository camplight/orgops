import { describe, expect, it, vi } from "vitest";
import { providerError, setUpTurn } from "./attempt-loop-support";
import { arrivingDuring, createPendingEvents, modelEvents } from "./injection-support";
import { useFakeNetwork } from "./lifecycle";
import { chatCompletion, createFakeProvider, replyWithText } from "./provider";
import { createFakeOrgops } from "./orgops-api";
import { getMockAgent, getMockChannelRecord, getMockEvent, getMockExecutor } from "./factories";
import { server } from "./server";

useFakeNetwork();

const FRIENDLY_FORMAT_ERROR =
  "I hit a response-format issue and could not produce a clean chat message. Please try again.";
const EMPTY_TEXT = "Unable to produce structured event output.";

const silenceLogs = () => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
};

const toolArgumentsError = () => providerError(400, "AI_InvalidToolArgumentsError: bad args");

const fallbackTextFor = async (lastResponse: string) => {
  const { orgops, run } = setUpTurn({
    responders: [replyWithText("one"), replyWithText("two"), replyWithText(lastResponse)],
  });
  await run();
  const [message] = modelEvents(orgops.emitted());
  return message?.payload.text;
};

const completedEvent = <T extends { type: string }>(emitted: T[]) =>
  emitted.filter((event) => event.type === "agent.turn.completed");

describe("Fallback: text taken from JSON the model sent", () => {
  it.each([
    ["a JSON object without a type", '{"payload":{"text":"clean fallback text"}}', "clean fallback text"],
    [
      "pretty-printed JSON without a type",
      JSON.stringify({ payload: { text: "pretty text" } }, null, 2),
      "pretty text",
    ],
    [
      "fenced JSON with a json tag",
      '```json\n{"payload":{"text":"from fenced json"}}\n```',
      "from fenced json",
    ],
    ["fenced JSON without a tag", '```\n{"payload":{"text":"untagged fence"}}\n```', "untagged fence"],
    ["a fence with an upper-case tag", '```JSON\n{"payload":{"text":"upper tag"}}\n```', "upper tag"],
    ["payload text with surrounding whitespace", '{"payload":{"text":"  padded \\n"}}', "padded"],
    [
      "a reserved event type",
      '{"type":"agent.turn.completed","payload":{"text":"reserved type text"}}',
      "reserved type text",
    ],
    [
      "a type no shape knows",
      '{"type":"made.up.type","payload":{"text":"unknown type text"}}',
      "unknown type text",
    ],
    ["JSON with extra fields", '{"type":"","channelId":"x","payload":{"text":"extra ok","n":1}}', "extra ok"],
    [
      "surrounding whitespace around the whole response",
      '  \n {"payload":{"text":"outer padded"}}\n\n',
      "outer padded",
    ],
  ])("uses payload.text for %s", async (_name, response, expected) => {
    expect(await fallbackTextFor(response)).toBe(expected);
  });
});

describe("Fallback: JSON without usable payload.text gives the friendly error", () => {
  it.each([
    ["payload without text", '{"payload":{"eventType":"status"}}'],
    ["no payload at all", '{"type":"message.created"}'],
    ["an empty object", "{}"],
    ["blank payload text", '{"payload":{"text":"   "}}'],
    ["empty payload text", '{"payload":{"text":""}}'],
    ["numeric payload text", '{"payload":{"text":5}}'],
    ["null payload text", '{"payload":{"text":null}}'],
    ["array payload text", '{"payload":{"text":["a"]}}'],
    ["payload as an array", '{"payload":[{"text":"in array"}]}'],
    ["payload as a string", '{"payload":"just a string"}'],
    ["null payload", '{"payload":null}'],
    ["text at the top level only", '{"text":"top level"}'],
    ["fenced JSON without payload.text", '```json\n{"type":"x"}\n```'],
  ])("replaces %s with the friendly error", async (_name, response) => {
    expect(await fallbackTextFor(response)).toBe(FRIENDLY_FORMAT_ERROR);
  });

  it("never leaks the raw JSON into the chat message", async () => {
    const text = await fallbackTextFor('{"type":"status.update","payload":{"secret":"do-not-leak"}}');

    expect(text).not.toContain("do-not-leak");
  });
});

describe("Fallback: text taken from responses that are not event JSON", () => {
  it.each([
    ["plain text", "I could not do that", "I could not do that"],
    ["plain text with surrounding whitespace", "  \n spaced answer \n ", "spaced answer"],
    ["multi-line plain text", "line one\nline two", "line one\nline two"],
    ["text that starts like JSON but is broken", '{"payload": {"text": "cut off', '{"payload": {"text": "cut off'],
    ["a JSON array", '[{"payload":{"text":"inside"}}]', '[{"payload":{"text":"inside"}}]'],
    ["a JSON number", " 42 ", "42"],
    ["a JSON string", '"quoted"', '"quoted"'],
    ["JSON null", "null", "null"],
    ["JSON true", "true", "true"],
    [
      "a fence around text that is not JSON",
      "```json\nnot json at all\n```",
      "```json\nnot json at all\n```",
    ],
    [
      "a fence around a JSON array",
      '```json\n["a"]\n```',
      '```json\n["a"]\n```',
    ],
    [
      "prose before a fenced event",
      'Here you go:\n```json\n{"payload":{"text":"after prose"}}\n```',
      "after prose",
    ],
  ])("handles %s", async (_name, response, expected) => {
    expect(await fallbackTextFor(response)).toBe(expected);
  });

  it("keeps a very long plain-text response whole, without clamping it", async () => {
    const long = "x".repeat(250_000);

    expect(await fallbackTextFor(long)).toBe(long);
  });

  it("keeps a very long payload.text whole", async () => {
    const long = "y".repeat(250_000);

    expect(await fallbackTextFor(JSON.stringify({ payload: { text: long } }))).toBe(long);
  });
});

describe("Fallback: empty last response", () => {
  it.each([
    ["an empty string", ""],
    ["spaces", "   "],
    ["newlines and tabs", "\n\t \n"],
  ])("says it could not produce structured output for %s", async (_name, response) => {
    expect(await fallbackTextFor(response)).toBe(EMPTY_TEXT);
  });

  it("treats a response with no content like an empty one", async () => {
    const { orgops, run } = setUpTurn({
      responders: [replyWithText("one"), replyWithText("two"), () => chatCompletion({})],
    });

    await run();

    expect(modelEvents(orgops.emitted())).toMatchObject([{ payload: { text: EMPTY_TEXT } }]);
  });
});

describe("Fallback: which response is used", () => {
  it("uses the last attempt's response, not an earlier one", async () => {
    const { orgops, run } = setUpTurn({
      responders: [
        replyWithText('{"payload":{"text":"first"}}'),
        replyWithText('{"payload":{"text":"second"}}'),
        replyWithText("third"),
      ],
    });

    await run();

    expect(modelEvents(orgops.emitted())).toMatchObject([{ payload: { text: "third" } }]);
  });

  it("[quirk] uses the second attempt's response when the third attempt raises the tool-argument error", async () => {
    const { orgops, provider, run } = setUpTurn({
      responders: [replyWithText("first answer"), replyWithText("second answer"), toolArgumentsError()],
    });

    await run();

    expect(provider.requests).toHaveLength(3);
    expect(modelEvents(orgops.emitted())).toMatchObject([{ payload: { text: "second answer" } }]);
  });

  it("[quirk] uses the first attempt's response when attempts two and three raise the tool-argument error", async () => {
    const { orgops, run } = setUpTurn({
      responders: [replyWithText("first answer"), toolArgumentsError(), toolArgumentsError()],
    });

    await run();

    expect(modelEvents(orgops.emitted())).toMatchObject([{ payload: { text: "first answer" } }]);
  });

  it("uses the empty-output text when every attempt raised the tool-argument error", async () => {
    const { orgops, provider, run } = setUpTurn({ responders: [toolArgumentsError()] });

    await run();

    expect(provider.requests).toHaveLength(3);
    expect(modelEvents(orgops.emitted())).toMatchObject([{ payload: { text: EMPTY_TEXT } }]);
    expect(completedEvent(orgops.emitted())).toMatchObject([{ payload: { completedWithFallback: true } }]);
  });

  it("[quirk] uses the discarded response of the third attempt when events arrive during it", async () => {
    const pending = createPendingEvents();
    const { orgops, run } = setUpTurn({
      pendingEvents: pending.list,
      responders: [
        replyWithText("one"),
        replyWithText("two"),
        arrivingDuring(
          pending,
          [getMockEvent({ id: "evt-2", source: "human:bob", createdAt: 2_000 })],
          replyWithText('{"type":"message.created","payload":{"text":"discarded but sent"}}'),
        ),
      ],
    });

    await run();

    expect(modelEvents(orgops.emitted())).toMatchObject([{ payload: { text: "discarded but sent" } }]);
  });

  it("[quirk] turns a discarded valid event without payload.text into the friendly error, ignoring its own channel", async () => {
    const pending = createPendingEvents();
    const { orgops, run } = setUpTurn({
      pendingEvents: pending.list,
      responders: [
        replyWithText("one"),
        replyWithText("two"),
        arrivingDuring(
          pending,
          [getMockEvent({ id: "evt-2", source: "human:bob", createdAt: 2_000 })],
          replyWithText('{"type":"task.created","channelId":"elsewhere","payload":{"title":"t"}}'),
        ),
      ],
    });

    await run();

    expect(modelEvents(orgops.emitted())).toMatchObject([
      { type: "message.created", channelId: "chan-1", payload: { text: FRIENDLY_FORMAT_ERROR } },
    ]);
  });

  it("uses the last response after three late-injection discards", async () => {
    const pending = createPendingEvents();
    const late = (id: string, createdAt: number, text: string) =>
      arrivingDuring(
        pending,
        [getMockEvent({ id, source: "human:bob", createdAt })],
        replyWithText(text),
      );
    const { orgops, run } = setUpTurn({
      pendingEvents: pending.list,
      responders: [late("evt-2", 2_000, "a"), late("evt-3", 3_000, "b"), late("evt-4", 4_000, "c")],
    });

    await run();

    expect(modelEvents(orgops.emitted())).toMatchObject([{ payload: { text: "c" } }]);
  });
});

describe("Fallback: the emitted message", () => {
  it("is a message.created from the agent in the turn's channel, parented to the trigger event", async () => {
    const { orgops, run } = setUpTurn({
      agent: { name: "bob" },
      channels: [getMockChannelRecord({ participants: [{ subscriberType: "AGENT", subscriberId: "bob" }] })],
      responders: [replyWithText("one"), replyWithText("two"), replyWithText("three")],
    });

    await run();

    expect(modelEvents(orgops.emitted())).toEqual([
      {
        type: "message.created",
        source: "agent:bob",
        channelId: "chan-1",
        payload: { text: "three" },
        parentEventId: "evt-1",
      },
    ]);
  });

  it("is parented to the last event of a merged batch, not the first", async () => {
    const { orgops, run } = setUpTurn({
      events: [
        getMockEvent({ id: "evt-1", createdAt: 1_000 }),
        getMockEvent({ id: "evt-2", createdAt: 2_000 }),
        getMockEvent({ id: "evt-3", createdAt: 3_000 }),
      ],
      responders: [replyWithText("one"), replyWithText("two"), replyWithText("three")],
    });

    await run();

    expect(modelEvents(orgops.emitted())).toMatchObject([{ parentEventId: "evt-3" }]);
  });

  it("goes to the channel of the last event of the batch", async () => {
    const { orgops, run } = setUpTurn({
      events: [
        getMockEvent({ id: "evt-1", channelId: "chan-1" }),
        getMockEvent({ id: "evt-2", channelId: "chan-2" }),
      ],
      responders: [replyWithText("one"), replyWithText("two"), replyWithText("three")],
    });

    await run();

    expect(modelEvents(orgops.emitted())).toMatchObject([{ channelId: "chan-2", parentEventId: "evt-2" }]);
  });

  it("carries only type, source, channelId, payload.text and parentEventId", async () => {
    const { orgops, run } = setUpTurn({
      responders: [
        replyWithText("one"),
        replyWithText("two"),
        replyWithText('{"channelId":"other","parentEventId":"evt-9","idempotencyKey":"k","payload":{"text":"hi","extra":1}}'),
      ],
    });

    await run();

    expect(modelEvents(orgops.emitted())).toEqual([
      {
        type: "message.created",
        source: "agent:alice",
        channelId: "chan-1",
        payload: { text: "hi" },
        parentEventId: "evt-1",
      },
    ]);
  });
});

describe("Fallback: turn completion", () => {
  it("completes with completedWithFallback, the trigger event id and the event count", async () => {
    const { orgops, run } = setUpTurn({
      events: [getMockEvent({ id: "evt-1" }), getMockEvent({ id: "evt-2" })],
      responders: [replyWithText("one"), replyWithText("two"), replyWithText("three")],
    });

    await run();

    expect(completedEvent(orgops.emitted())).toEqual([
      {
        type: "agent.turn.completed",
        source: "agent:alice",
        channelId: "chan-1",
        payload: { triggerEventId: "evt-2", eventCount: 2, completedWithFallback: true },
      },
    ]);
  });

  it("completes with exactly the three payload fields for a single event", async () => {
    const { orgops, run } = setUpTurn({
      responders: [replyWithText("one"), replyWithText("two"), replyWithText("three")],
    });

    await run();

    expect(completedEvent(orgops.emitted()).map((event) => Object.keys(event.payload).sort())).toEqual([
      ["completedWithFallback", "eventCount", "triggerEventId"],
    ]);
    expect(completedEvent(orgops.emitted())[0]?.payload).toMatchObject({
      triggerEventId: "evt-1",
      eventCount: 1,
    });
  });

  it("emits started, the fallback message, then completed, each once, in that order", async () => {
    const { orgops, run } = setUpTurn({
      responders: [replyWithText("one"), replyWithText("two"), replyWithText("three")],
    });

    await run();

    expect(
      orgops.emitted().map((event) => event.type).filter((type) => !type.startsWith("telemetry.")),
    ).toEqual(["agent.turn.started", "message.created", "agent.turn.completed"]);
  });

  it("emits the fallback only after the third provider call, never earlier", async () => {
    const orgops = createFakeOrgops({ channels: [getMockChannelRecord()] });
    const messagesWhenAnswering: number[] = [];
    const answer = (text: string) => (request: Parameters<ReturnType<typeof replyWithText>>[0], index: number) => {
      messagesWhenAnswering.push(modelEvents(orgops.emitted()).length);
      return replyWithText(text)(request, index);
    };
    const provider = createFakeProvider([answer("one"), answer("two"), answer("three")]);
    server.use(...orgops.handlers, provider.handler);

    await getMockExecutor()(getMockAgent(), [getMockEvent()]);

    expect(messagesWhenAnswering).toEqual([0, 0, 0]);
    expect(modelEvents(orgops.emitted())).toHaveLength(1);
  });

  it("makes no fourth provider call", async () => {
    const { provider, run } = setUpTurn({
      responders: [replyWithText("one"), replyWithText("two"), replyWithText("three"), replyWithText("four")],
    });

    await run();

    expect(provider.requests).toHaveLength(3);
  });

  it("resolves the turn without throwing", async () => {
    const { run } = setUpTurn({
      responders: [replyWithText("one"), replyWithText("two"), replyWithText("three")],
    });

    await expect(run()).resolves.toBeUndefined();
  });
});

describe("Fallback: a failing emit", () => {
  it("rejects the turn when the fallback message cannot be delivered, and sends no completed event", async () => {
    silenceLogs();
    const orgops = createFakeOrgops({
      channels: [getMockChannelRecord()],
      rejectEvent: (event) => event.type === "message.created",
    });
    const provider = createFakeProvider([replyWithText("one"), replyWithText("two"), replyWithText("three")]);
    server.use(...orgops.handlers, provider.handler);

    await expect(getMockExecutor()(getMockAgent(), [getMockEvent()])).rejects.toThrow(
      "API /api/events failed: 500",
    );

    expect(provider.requests).toHaveLength(3);
    expect(orgops.callLog().filter((entry) => entry === "POST /api/events message.created")).toHaveLength(1);
    expect(completedEvent(orgops.emitted())).toEqual([]);
  });
});
