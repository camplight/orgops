import { describe, expect, it } from "vitest";
import { getMockChannelRecord, getMockSkillRoot } from "./factories";
import { useFakeNetwork } from "./lifecycle";
import { replyWithEvent, replyWithText } from "./provider";
import { rawRetryTail, retryTail, setUpTurn } from "./attempt-loop-support";

useFakeNetwork();

const notJson = (attempt: number, error: string) =>
  [
    `Your previous response was not valid JSON on attempt ${attempt}/3.`,
    `Error: Error: ${error}`,
    "Return only a corrected JSON event object.",
  ].join("\n");

const invalidOutput = (attempt: number, error: string) =>
  [
    `Your previous JSON output was invalid on attempt ${attempt}/3.`,
    `Error: Error: ${error}`,
    "Return only a corrected JSON event object.",
  ].join("\n");

const validationFailed = (attempt: number, type: string, lines: string[]) =>
  [
    `Event validation failed on attempt ${attempt}/3.`,
    `Type: ${type}`,
    ...lines,
    "Return only a corrected JSON event object that validates.",
  ].join("\n");

const goodEvent = replyWithEvent({ type: "message.created", payload: { text: "fixed" } });

const emittedModelEvents = (emitted: Array<{ type: string }>) =>
  emitted.filter((event) => !event.type.startsWith("agent.turn.") && !event.type.startsWith("telemetry."));

describe("Attempt loop: happy path", () => {
  it("emits the model's event as the agent on the turn channel and then completes the turn", async () => {
    const { orgops, provider, run } = setUpTurn({
      responders: [replyWithEvent({ type: "message.created", payload: { text: "hi there" } })],
    });

    await run();

    const emitted = orgops.emitted();
    expect(emitted.slice(-2).map((event) => event.type)).toEqual(["message.created", "agent.turn.completed"]);
    expect(emitted.at(-2)).toEqual({
      type: "message.created",
      source: "agent:alice",
      channelId: "chan-1",
      payload: { text: "hi there" },
    });
    expect(emitted.at(-1)).toMatchObject({
      type: "agent.turn.completed",
      payload: { triggerEventId: "evt-1", eventCount: 1 },
    });
    expect(provider.requests).toHaveLength(1);
  });

  it("uses the channelId the model names when the agent takes part in that channel", async () => {
    const { orgops, run } = setUpTurn({
      channels: [getMockChannelRecord(), getMockChannelRecord({ id: "chan-2", name: "random" })],
      responders: [
        replyWithEvent({ type: "message.created", channelId: "  chan-2  ", payload: { text: "over here" } }),
      ],
    });

    await run();

    expect(emittedModelEvents(orgops.emitted())).toEqual([
      { type: "message.created", source: "agent:alice", channelId: "chan-2", payload: { text: "over here" } },
    ]);
  });

  it("falls back to the turn channel when the model's channelId is blank", async () => {
    const { orgops, run } = setUpTurn({
      responders: [replyWithEvent({ type: "message.created", channelId: "   ", payload: { text: "blank" } })],
    });

    await run();

    expect(emittedModelEvents(orgops.emitted())[0]).toMatchObject({ channelId: "chan-1" });
  });

  it("falls back to the turn channel when the model's channelId is not a string", async () => {
    const { orgops, run } = setUpTurn({
      responders: [replyWithText('{"type":"message.created","channelId":7,"payload":{"text":"numeric"}}')],
    });

    await run();

    expect(emittedModelEvents(orgops.emitted())[0]).toMatchObject({ channelId: "chan-1" });
  });

  it("forces the source to the agent, trims the type, and passes parent, idempotency key and floored deliverAt on", async () => {
    const { orgops, run } = setUpTurn({
      responders: [
        replyWithText(
          JSON.stringify({
            type: "  message.created  ",
            source: "human:admin",
            payload: { text: "scheduled" },
            parentEventId: "  evt-9  ",
            idempotencyKey: "  key-1  ",
            deliverAt: 5_000.9,
          }),
        ),
      ],
    });

    await run();

    expect(emittedModelEvents(orgops.emitted())).toEqual([
      {
        type: "message.created",
        source: "agent:alice",
        channelId: "chan-1",
        payload: { text: "scheduled" },
        parentEventId: "evt-9",
        idempotencyKey: "key-1",
        deliverAt: 5_000,
      },
    ]);
  });

  it("leaves out parent, idempotency key and deliverAt when they are blank or not usable", async () => {
    const { orgops, run } = setUpTurn({
      responders: [
        replyWithText(
          JSON.stringify({
            type: "message.created",
            payload: { text: "plain" },
            parentEventId: "  ",
            idempotencyKey: 7,
            deliverAt: "soon",
          }),
        ),
      ],
    });

    await run();

    expect(emittedModelEvents(orgops.emitted())).toEqual([
      { type: "message.created", source: "agent:alice", channelId: "chan-1", payload: { text: "plain" } },
    ]);
  });

  it("leaves out deliverAt when it is not a finite number", async () => {
    const { orgops, run } = setUpTurn({
      responders: [
        replyWithText('{"type":"message.created","payload":{"text":"x"},"deliverAt":1e999}'),
      ],
    });

    await run();

    expect(emittedModelEvents(orgops.emitted())[0]).not.toHaveProperty("deliverAt");
  });

  it("accepts JSON wrapped in a json code fence", async () => {
    const { orgops, provider, run } = setUpTurn({
      responders: [
        replyWithText('```json\n{"type":"message.created","payload":{"text":"fenced"}}\n```'),
      ],
    });

    await run();

    expect(emittedModelEvents(orgops.emitted())).toHaveLength(1);
    expect(emittedModelEvents(orgops.emitted())[0]).toMatchObject({ payload: { text: "fenced" } });
    expect(provider.requests).toHaveLength(1);
  });

  it("accepts JSON wrapped in a bare code fence", async () => {
    const { orgops, provider, run } = setUpTurn({
      responders: [replyWithText('```\n{"type":"message.created","payload":{"text":"bare"}}\n```')],
    });

    await run();

    expect(emittedModelEvents(orgops.emitted())[0]).toMatchObject({ payload: { text: "bare" } });
    expect(provider.requests).toHaveLength(1);
  });

  it("accepts a code fence surrounded by prose", async () => {
    const { orgops, provider, run } = setUpTurn({
      responders: [
        replyWithText('Here you go:\n```json\n{"type":"message.created","payload":{"text":"prose"}}\n```\nDone.'),
      ],
    });

    await run();

    expect(emittedModelEvents(orgops.emitted())[0]).toMatchObject({ payload: { text: "prose" } });
    expect(provider.requests).toHaveLength(1);
  });

  it("accepts JSON with surrounding whitespace", async () => {
    const { orgops, run } = setUpTurn({
      responders: [replyWithText('\n  {"type":"message.created","payload":{"text":"spaced"}}  \n')],
    });

    await run();

    expect(emittedModelEvents(orgops.emitted())[0]).toMatchObject({ payload: { text: "spaced" } });
  });

  it("sends an event without payload as an empty payload", async () => {
    const { orgops, provider, run } = setUpTurn({
      responders: [replyWithText('{"type":"noop"}')],
    });

    await run();

    expect(provider.requests).toHaveLength(1);
    expect(emittedModelEvents(orgops.emitted())).toEqual([
      { type: "noop", source: "agent:alice", channelId: "chan-1", payload: {} },
    ]);
  });
});

describe("Attempt loop: retry messages by failure kind", () => {
  it("retries with the not-valid-JSON message when the response has no JSON", async () => {
    const { orgops, provider, run } = setUpTurn({
      responders: [replyWithText("I think we should talk."), goodEvent],
    });

    await run();

    expect(provider.requests).toHaveLength(2);
    expect(retryTail(provider, 1)).toEqual([notJson(1, "Response was not valid JSON.")]);
    expect(emittedModelEvents(orgops.emitted())).toEqual([
      { type: "message.created", source: "agent:alice", channelId: "chan-1", payload: { text: "fixed" } },
    ]);
    expect(orgops.emitted().at(-1)?.payload).not.toHaveProperty("completedWithFallback");
  });

  it("retries with the not-valid-JSON message when the response is empty", async () => {
    const { provider, run } = setUpTurn({ responders: [replyWithText(""), goodEvent] });

    await run();

    expect(retryTail(provider, 1)).toEqual([notJson(1, "Empty response.")]);
  });

  it("retries with the not-valid-JSON message when the response is only whitespace", async () => {
    const { provider, run } = setUpTurn({ responders: [replyWithText(" \n\t "), goodEvent] });

    await run();

    expect(retryTail(provider, 1)).toEqual([notJson(1, "Empty response.")]);
  });

  it("retries with the JSON parser's own message when a fenced block holds broken JSON", async () => {
    const { provider, run } = setUpTurn({
      responders: [replyWithText('```json\n{"type":\n```'), goodEvent],
    });

    await run();

    const tail = rawRetryTail(provider, 1);
    expect(tail.startsWith("\n\n\nYour previous response was not valid JSON on attempt 1/3.\nError: SyntaxError: ")).toBe(true);
    expect(tail.endsWith("\nReturn only a corrected JSON event object.")).toBe(true);
  });

  it("retries with the invalid-output message when the JSON is not an object", async () => {
    const { provider, run } = setUpTurn({ responders: [replyWithText('["message.created"]'), goodEvent] });

    await run();

    expect(retryTail(provider, 1)).toEqual([invalidOutput(1, "JSON response must be an object.")]);
  });

  it("retries with the invalid-output message when the JSON is null", async () => {
    const { provider, run } = setUpTurn({ responders: [replyWithText("null"), goodEvent] });

    await run();

    expect(retryTail(provider, 1)).toEqual([invalidOutput(1, "JSON response must be an object.")]);
  });

  it("retries with the invalid-output message when a JSON string is returned", async () => {
    const { provider, run } = setUpTurn({ responders: [replyWithText('"hello"'), goodEvent] });

    await run();

    expect(retryTail(provider, 1)).toEqual([invalidOutput(1, "JSON response must be an object.")]);
  });

  it("retries with the invalid-output message when the event has no type", async () => {
    const { provider, run } = setUpTurn({ responders: [replyWithText('{"payload":{"text":"x"}}'), goodEvent] });

    await run();

    expect(retryTail(provider, 1)).toEqual([invalidOutput(1, "JSON event is missing a non-empty `type`.")]);
  });

  it("retries with the invalid-output message when the type is blank", async () => {
    const { provider, run } = setUpTurn({ responders: [replyWithText('{"type":"   ","payload":{}}'), goodEvent] });

    await run();

    expect(retryTail(provider, 1)).toEqual([invalidOutput(1, "JSON event is missing a non-empty `type`.")]);
  });

  it("retries with the invalid-output message when the type is not a string", async () => {
    const { provider, run } = setUpTurn({ responders: [replyWithText('{"type":42,"payload":{}}'), goodEvent] });

    await run();

    expect(retryTail(provider, 1)).toEqual([invalidOutput(1, "JSON event is missing a non-empty `type`.")]);
  });

  it.each(["agent.turn.completed", "audit.anything", "telemetry.prompt.composed", "tool.call.started"])(
    "retries with the reserved-type message for the type %s",
    async (type) => {
      const { orgops, provider, run } = setUpTurn({
        responders: [replyWithEvent({ type, payload: {} }), goodEvent],
      });

      await run();

      expect(retryTail(provider, 1)).toEqual([
        invalidOutput(
          1,
          `Event type "${type}" is reserved for runtime bookkeeping/telemetry. Agent-authored events cannot use "agent.*", "audit.*", "telemetry.*", or "tool.*" types. Use a domain/channel/custom event type instead.`,
        ),
      ]);
      expect(emittedModelEvents(orgops.emitted())).toHaveLength(1);
    },
  );

  it("retries with the validation message when the event type is unknown", async () => {
    const { provider, run } = setUpTurn({
      responders: [replyWithEvent({ type: "invoice.paid", payload: {} }), goodEvent],
    });

    await run();

    expect(retryTail(provider, 1)).toEqual([
      validationFailed(1, "invoice.paid", ["- [core] Unsupported event type: invoice.paid"]),
    ]);
  });

  it("retries with the validation message listing the payload issue when the payload breaks the shape", async () => {
    const { provider, run } = setUpTurn({
      responders: [replyWithEvent({ type: "message.created", payload: {} }), goodEvent],
    });

    await run();

    expect(retryTail(provider, 1)).toEqual([validationFailed(1, "message.created", ["- [core] payload.text: Required"])]);
  });

  it("lists at most 8 validation issues in the retry message", async () => {
    const root = getMockSkillRoot([
      {
        name: "wide",
        eventShapesFile: {
          filename: "event-shapes.js",
          contents: `export const eventShapes = [{ type: "wide.event", description: "Wide", payloadSchema: { safeParse: () => ({ success: false, error: { issues: Array.from({ length: 10 }, (_, index) => ({ path: ["field" + index], message: "bad " + index })) } }) } }];`,
        },
      },
    ]);
    const { provider, run } = setUpTurn({
      agent: { enabledSkills: ["wide"] },
      skillRoots: [root],
      responders: [replyWithEvent({ type: "wide.event", payload: {} }), goodEvent],
    });

    await run();

    expect(retryTail(provider, 1)).toEqual([
      validationFailed(
        1,
        "wide.event",
        Array.from({ length: 8 }, (_, index) => `- [skill:wide] payload.field${index}: bad ${index}`),
      ),
    ]);
  });

  it("lists all validation issues when there are exactly 8", async () => {
    const root = getMockSkillRoot([
      {
        name: "eight",
        eventShapesFile: {
          filename: "event-shapes.js",
          contents: `export const eventShapes = [{ type: "eight.event", description: "Eight", payloadSchema: { safeParse: () => ({ success: false, error: { issues: Array.from({ length: 8 }, (_, index) => ({ path: ["field" + index], message: "bad " + index })) } }) } }];`,
        },
      },
    ]);
    const { provider, run } = setUpTurn({
      agent: { enabledSkills: ["eight"] },
      skillRoots: [root],
      responders: [replyWithEvent({ type: "eight.event", payload: {} }), goodEvent],
    });

    await run();

    expect(rawRetryTail(provider, 1).split("\n").filter((line) => line.startsWith("- "))).toHaveLength(8);
  });

  it("labels an issue without a path as <root>", async () => {
    const root = getMockSkillRoot([
      {
        name: "rooty",
        eventShapesFile: {
          filename: "event-shapes.js",
          contents: `export const eventShapes = [{ type: "rooty.event", description: "Rooty", payloadSchema: { safeParse: () => ({ success: false, error: { issues: [{ path: [], message: "nope" }] } }) } }];`,
        },
      },
    ]);
    const { provider, run } = setUpTurn({
      agent: { enabledSkills: ["rooty"] },
      skillRoots: [root],
      responders: [replyWithEvent({ type: "rooty.event", payload: {} }), goodEvent],
    });

    await run();

    expect(retryTail(provider, 1)).toEqual([validationFailed(1, "rooty.event", ["- [skill:rooty] payload.<root>: nope"])]);
  });

  it("retries with the participation error when the target channel does not exist", async () => {
    const { orgops, provider, run } = setUpTurn({
      responders: [
        replyWithEvent({ type: "message.created", channelId: "chan-404", payload: { text: "lost" } }),
        goodEvent,
      ],
    });

    await run();

    expect(retryTail(provider, 1)).toEqual([
      validationFailed(1, "message.created", ['- [runner] Unknown channelId "chan-404".']),
    ]);
    expect(emittedModelEvents(orgops.emitted())).toEqual([
      { type: "message.created", source: "agent:alice", channelId: "chan-1", payload: { text: "fixed" } },
    ]);
  });

  it("retries with the participation error when the agent is not an AGENT participant of the target channel", async () => {
    const { provider, run } = setUpTurn({
      channels: [
        getMockChannelRecord(),
        getMockChannelRecord({
          id: "chan-2",
          participants: [{ subscriberType: "HUMAN", subscriberId: "alice" }],
        }),
      ],
      responders: [
        replyWithEvent({ type: "message.created", channelId: "chan-2", payload: { text: "outsider" } }),
        goodEvent,
      ],
    });

    await run();

    expect(retryTail(provider, 1)).toEqual([
      validationFailed(1, "message.created", ['- [runner] Agent "alice" is not an AGENT participant in channel "chan-2".']),
    ]);
  });

  it("does not check participation for an event that already failed validation", async () => {
    const { orgops, run } = setUpTurn({
      responders: [replyWithEvent({ type: "invoice.paid", channelId: "chan-404", payload: {} }), goodEvent],
    });

    await run();

    const channelLookups = orgops.requestLog().filter((entry) => entry === "GET /api/channels").length;
    expect(channelLookups).toBe(await setUpBaselineLookups());
  });
});

const setUpBaselineLookups = async () => {
  const { orgops, run } = setUpTurn({ responders: [goodEvent] });
  await run();
  return orgops.requestLog().filter((entry) => entry === "GET /api/channels").length;
};

describe("Attempt loop: participation cache", () => {
  it("looks a target channel up once even when the model keeps naming it across attempts", async () => {
    const outsider = replyWithEvent({ type: "message.created", channelId: "chan-404", payload: { text: "x" } });
    const { orgops, provider, run } = setUpTurn({ responders: [outsider, outsider, goodEvent] });

    await run();

    const singleLookup = await setUpBaselineLookups();
    expect(orgops.requestLog().filter((entry) => entry === "GET /api/channels").length).toBe(singleLookup + 1);
    expect(provider.requests).toHaveLength(3);
    expect(retryTail(provider, 2)).toEqual([
      validationFailed(1, "message.created", ['- [runner] Unknown channelId "chan-404".']),
      validationFailed(2, "message.created", ['- [runner] Unknown channelId "chan-404".']),
    ]);
  });

  it("looks up each different target channel once", async () => {
    const toChannel = (channelId: string) =>
      replyWithEvent({ type: "message.created", channelId, payload: { text: "x" } });
    const { orgops, run } = setUpTurn({
      responders: [toChannel("chan-404"), toChannel("chan-405"), goodEvent],
    });

    await run();

    const singleLookup = await setUpBaselineLookups();
    expect(orgops.requestLog().filter((entry) => entry === "GET /api/channels").length).toBe(singleLookup + 2);
  });
});

describe("Attempt loop: accumulated retry messages", () => {
  it("sends the base messages unchanged on the first request and adds each retry message in order", async () => {
    const { orgops, provider, run } = setUpTurn({
      responders: [
        replyWithText("no json here"),
        replyWithText('{"payload":{}}'),
        replyWithEvent({ type: "message.created", payload: {} }),
        goodEvent,
      ],
    });

    await run();

    expect(provider.requests).toHaveLength(3);
    expect(rawRetryTail(provider, 0)).toBe("");
    expect(rawRetryTail(provider, 1)).toBe(`\n\n\n${notJson(1, "Response was not valid JSON.")}`);
    expect(retryTail(provider, 1)).toEqual([notJson(1, "Response was not valid JSON.")]);
    expect(retryTail(provider, 2)).toEqual([
      notJson(1, "Response was not valid JSON."),
      invalidOutput(2, "JSON event is missing a non-empty `type`."),
    ]);
    expect(emittedModelEvents(orgops.emitted())).toHaveLength(1);
  });

  it("emits the model's event on the third attempt, not the fallback, after two failures", async () => {
    const { orgops, provider, run } = setUpTurn({
      responders: [replyWithText("one"), replyWithText("two"), goodEvent],
    });

    await run();

    expect(provider.requests).toHaveLength(3);
    expect(retryTail(provider, 2)).toEqual([
      notJson(1, "Response was not valid JSON."),
      notJson(2, "Response was not valid JSON."),
    ]);
    expect(emittedModelEvents(orgops.emitted())).toEqual([
      { type: "message.created", source: "agent:alice", channelId: "chan-1", payload: { text: "fixed" } },
    ]);
    expect(orgops.emitted().at(-1)?.payload).not.toHaveProperty("completedWithFallback");
  });

  it("stops asking the model after three attempts", async () => {
    const { orgops, provider, run } = setUpTurn({
      responders: [replyWithText("one"), replyWithText("two"), replyWithText("three"), goodEvent],
    });

    await run();

    expect(provider.requests).toHaveLength(3);
    expect(emittedModelEvents(orgops.emitted())).toEqual([
      { type: "message.created", source: "agent:alice", channelId: "chan-1", payload: { text: "three" }, parentEventId: "evt-1" },
    ]);
    expect(orgops.emitted().at(-1)).toMatchObject({
      type: "agent.turn.completed",
      payload: { completedWithFallback: true },
    });
  });
});
