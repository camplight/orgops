import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { rawRetryTail, retryTail, setUpTurn } from "./attempt-loop-support";
import { getMockChannelRecord, getMockEvent } from "./factories";
import {
  arrivingDuring,
  createPendingEvents,
  eventRecord,
  injectedUserMessages,
  lateEventsNotice,
  modelEvents,
  pendingListings,
} from "./injection-support";
import { useFakeNetwork } from "./lifecycle";
import { API_ORIGIN } from "./orgops-api";
import { chatCompletion, replyWithEvent, replyWithText } from "./provider";
import { server } from "./server";

useFakeNetwork();

const finalAnswer = replyWithEvent({ type: "message.created", payload: { text: "final" } });
const staleAnswer = replyWithEvent({ type: "message.created", payload: { text: "stale" } });
const unusableAnswer = replyWithText("not json");
const harmlessEvent = replyWithEvent({ type: "noop", payload: {} });

const late = (id: string, overrides = {}) => getMockEvent({ id, createdAt: 2_000, ...overrides });
const botMessage = (id: string, overrides = {}) =>
  late(id, { source: "agent:bob", payload: { text: `text of ${id}` }, ...overrides });

const finalEvent = {
  type: "message.created",
  source: "agent:alice",
  channelId: "chan-1",
  payload: { text: "final" },
};

const completedPayload = (emitted: Array<{ type: string; payload: Record<string, unknown> }>) =>
  emitted.filter((event) => event.type === "agent.turn.completed").at(-1)?.payload;

describe("Mid-turn injection: events that were already known", () => {
  it("does not retry when the pending list only holds the trigger event", async () => {
    const pending = createPendingEvents([getMockEvent()]);
    const { orgops, provider, run } = setUpTurn({ pendingEvents: pending.list, responders: [finalAnswer] });

    await run();

    expect(provider.requests).toHaveLength(1);
    expect(modelEvents(orgops.emitted())).toEqual([finalEvent]);
  });

  it("treats every event of a merged batch as seen, not only the trigger", async () => {
    const batch = [getMockEvent({ id: "evt-1" }), getMockEvent({ id: "evt-2", createdAt: 1_500 })];
    const pending = createPendingEvents(batch);
    const { provider, run } = setUpTurn({ pendingEvents: pending.list, events: batch, responders: [finalAnswer] });

    await run();

    expect(provider.requests).toHaveLength(1);
  });

  it("looks for pending events once per attempt, for this agent and channel, limited to 50", async () => {
    const { orgops, run } = setUpTurn({ responders: [finalAnswer] });

    await run();

    expect(pendingListings(orgops.requestLog())).toEqual([
      "GET /api/events?agentName=alice&status=PENDING&channelId=chan-1&limit=50",
    ]);
  });

  it("url-encodes the channel id of the pending listing", async () => {
    const { orgops, run } = setUpTurn({
      channels: [getMockChannelRecord({ id: "chan/1" })],
      events: [getMockEvent({ channelId: "chan/1" })],
      responders: [finalAnswer],
    });

    await run();

    expect(pendingListings(orgops.requestLog())).toEqual([
      "GET /api/events?agentName=alice&status=PENDING&channelId=chan%2F1&limit=50",
    ]);
  });
});

describe("Mid-turn injection: pending events the agent ignores", () => {
  it.each([
    ["an agent turn lifecycle event", { type: "agent.turn.started" }],
    ["an agent control event", { type: "agent.control.restart" }],
    ["a wrapper event", { type: "wrapper.turn.started" }],
    ["a noop event", { type: "noop" }],
    ["an audit event", { type: "audit.secret.set" }],
    ["a telemetry event", { type: "telemetry.prompt.composed" }],
    ["a tool event", { type: "tool.executed" }],
    ["a message addressed to another agent", { payload: { text: "hi", targetAgentName: "bob" } }],
    ["a scheduled trigger without a target", { type: "agent.scheduled.trigger", payload: {} }],
    ["the agent's own event", { source: "agent:alice" }],
    ["an event without a channel", { channelId: undefined }],
  ])("does not retry for %s", async (_name, overrides) => {
    const pending = createPendingEvents();
    const { orgops, provider, run } = setUpTurn({
      pendingEvents: pending.list,
      responders: [arrivingDuring(pending, [late("evt-2", overrides)], finalAnswer)],
    });

    await run();

    expect(provider.requests).toHaveLength(1);
    expect(modelEvents(orgops.emitted())).toEqual([finalEvent]);
  });

  it("injects a scheduled trigger that names this agent", async () => {
    const pending = createPendingEvents();
    const { provider, run } = setUpTurn({
      pendingEvents: pending.list,
      responders: [
        arrivingDuring(
          pending,
          [late("evt-2", { type: "agent.scheduled.trigger", payload: { targetAgentName: "alice" } })],
          unusableAnswer,
        ),
        finalAnswer,
      ],
    });

    await run();

    expect(provider.requests).toHaveLength(2);
  });

  it("marks an ignored event as seen, so a later change to the same id is still not injected", async () => {
    const polls: number[] = [];
    const { provider, run } = setUpTurn({
      pendingEvents: () => {
        polls.push(1);
        return [late("evt-9", { type: polls.length === 1 ? "noop" : "message.created" })];
      },
      responders: [unusableAnswer, finalAnswer],
    });

    await run();

    expect(provider.requests).toHaveLength(2);
    expect(JSON.stringify(provider.requests[1])).not.toContain("evt-9");
  });

  it("treats a pending listing that is not an array as no events", async () => {
    const { orgops, provider, run } = setUpTurn({ responders: [finalAnswer] });
    server.use(
      http.get(`${API_ORIGIN}/api/events`, ({ request }) =>
        new URL(request.url).searchParams.get("status") === "PENDING"
          ? HttpResponse.json({ error: "unexpected" })
          : undefined,
      ),
    );

    await run();

    expect(provider.requests).toHaveLength(1);
    expect(modelEvents(orgops.emitted())).toEqual([finalEvent]);
  });

  it("fails the turn when the pending listing request fails", async () => {
    const { orgops, provider, run } = setUpTurn({ responders: [finalAnswer] });
    server.use(
      http.get(`${API_ORIGIN}/api/events`, ({ request }) =>
        new URL(request.url).searchParams.get("status") === "PENDING"
          ? HttpResponse.json({ error: "down" }, { status: 500 })
          : undefined,
      ),
    );

    await expect(run()).rejects.toThrow(/API \/api\/events\?agentName=alice.*failed: 500/);
    expect(provider.requests).toHaveLength(1);
    expect(modelEvents(orgops.emitted())).toEqual([]);
    expect(completedPayload(orgops.emitted())).toBeUndefined();
  });
});

describe("Mid-turn injection: events that arrive during the model call", () => {
  it("retries once with the new event and the attempt notice", async () => {
    const pending = createPendingEvents();
    const { orgops, provider, run } = setUpTurn({
      pendingEvents: pending.list,
      responders: [arrivingDuring(pending, [botMessage("evt-2")], staleAnswer), finalAnswer],
    });

    await run();

    expect(provider.requests).toHaveLength(2);
    expect(retryTail(provider, 1)).toEqual([
      JSON.stringify(eventRecord(botMessage("evt-2")), null, 2),
      lateEventsNotice(1),
    ]);
    expect(modelEvents(orgops.emitted())).toEqual([finalEvent]);
    expect(completedPayload(orgops.emitted())).not.toHaveProperty("completedWithFallback");
  });

  it("discards a response that was valid when events arrived while it was produced", async () => {
    const pending = createPendingEvents();
    const { orgops, run } = setUpTurn({
      pendingEvents: pending.list,
      responders: [arrivingDuring(pending, [botMessage("evt-2")], staleAnswer), finalAnswer],
    });

    await run();

    expect(JSON.stringify(orgops.emitted())).not.toContain("stale");
  });

  it("does not add a parse failure message when the discarded response was not valid JSON", async () => {
    const pending = createPendingEvents();
    const { provider, run } = setUpTurn({
      pendingEvents: pending.list,
      responders: [arrivingDuring(pending, [botMessage("evt-2")], unusableAnswer), finalAnswer],
    });

    await run();

    expect(retryTail(provider, 1)).toHaveLength(2);
    expect(rawRetryTail(provider, 1)).not.toContain("not valid JSON");
  });

  it("lists pending events after each response, one listing per attempt", async () => {
    const pending = createPendingEvents();
    const { orgops, run } = setUpTurn({
      pendingEvents: pending.list,
      responders: [arrivingDuring(pending, [botMessage("evt-2")], staleAnswer), finalAnswer],
    });

    await run();

    expect(pendingListings(orgops.requestLog())).toHaveLength(2);
  });

  it("still reports provider usage for the attempt whose response was discarded", async () => {
    const pending = createPendingEvents();
    const { orgops, run } = setUpTurn({
      pendingEvents: pending.list,
      responders: [
        arrivingDuring(pending, [botMessage("evt-2")], () =>
          chatCompletion({ text: "first", usage: { promptTokens: 10, completionTokens: 5 } }),
        ),
        finalAnswer,
      ],
    });

    await run();

    const providerUsage = orgops
      .emitted()
      .filter((event) => event.type === "telemetry.context.window.updated")
      .filter((event) => event.payload.usageSource === "provider");
    expect(providerUsage.map((event) => event.payload.attempt)).toEqual([1]);
  });

  it("sends an event from a human as a user message and the notice in the system prompt", async () => {
    const pending = createPendingEvents();
    const human = late("evt-2", { payload: { text: "from a human" } });
    const { provider, run } = setUpTurn({
      pendingEvents: pending.list,
      responders: [arrivingDuring(pending, [human], unusableAnswer), finalAnswer],
    });

    await run();

    expect(injectedUserMessages(provider, 1).map((text) => JSON.parse(text))).toEqual([eventRecord(human)]);
    expect(retryTail(provider, 1)).toEqual([lateEventsNotice(1)]);
  });

  it("sends a message without a source as a user message", async () => {
    const pending = createPendingEvents();
    const { provider, run } = setUpTurn({
      pendingEvents: pending.list,
      responders: [
        arrivingDuring(pending, [late("evt-2", { source: undefined })], unusableAnswer),
        finalAnswer,
      ],
    });

    await run();

    expect(injectedUserMessages(provider, 1)).toHaveLength(1);
  });

  it.each([
    ["an agent", { source: "agent:bob" }],
    ["an agent with a differently cased source", { source: "Agent:Bob" }],
    ["the system", { source: "system:runner" }],
    ["a human, when the event is not a message", { type: "task.created" }],
  ])("sends an event from %s as a system message", async (_name, overrides) => {
    const pending = createPendingEvents();
    const event = late("evt-2", overrides);
    const { provider, run } = setUpTurn({
      pendingEvents: pending.list,
      responders: [arrivingDuring(pending, [event], unusableAnswer), finalAnswer],
    });

    await run();

    expect(injectedUserMessages(provider, 1)).toEqual([]);
    expect(retryTail(provider, 1)).toEqual([
      JSON.stringify(eventRecord(event), null, 2),
      lateEventsNotice(1),
    ]);
  });

  it("includes the parent event id and shortens long text in the event record", async () => {
    const pending = createPendingEvents();
    const event = late("evt-2", { parentEventId: "evt-0", payload: { text: "x".repeat(300) } });
    const { provider, run } = setUpTurn({
      pendingEvents: pending.list,
      responders: [arrivingDuring(pending, [event], unusableAnswer), finalAnswer],
    });

    await run();

    expect(JSON.parse(injectedUserMessages(provider, 1)[0] ?? "")).toEqual({
      eventId: "evt-2",
      channelId: "chan-1",
      parentEventId: "evt-0",
      type: "message.created",
      source: "human:admin",
      payload: { text: `${"x".repeat(280)}... [truncated 20 chars]` },
    });
  });

  it("orders several new events by creation time, oldest first", async () => {
    const pending = createPendingEvents();
    const { provider, run } = setUpTurn({
      pendingEvents: pending.list,
      responders: [
        arrivingDuring(
          pending,
          [late("evt-4", { createdAt: 4_000 }), late("evt-2", { createdAt: 2_000 }), late("evt-3", { createdAt: 3_000 })],
          unusableAnswer,
        ),
        finalAnswer,
      ],
    });

    await run();

    expect(injectedUserMessages(provider, 1).map((text) => JSON.parse(text).eventId)).toEqual([
      "evt-2",
      "evt-3",
      "evt-4",
    ]);
  });

  it("treats an event without a creation time as the oldest", async () => {
    const pending = createPendingEvents();
    const { provider, run } = setUpTurn({
      pendingEvents: pending.list,
      responders: [
        arrivingDuring(
          pending,
          [late("evt-2", { createdAt: 500 }), late("evt-3", { createdAt: undefined })],
          unusableAnswer,
        ),
        finalAnswer,
      ],
    });

    await run();

    expect(injectedUserMessages(provider, 1).map((text) => JSON.parse(text).eventId)).toEqual(["evt-3", "evt-2"]);
  });

  it("adds one notice for several new events", async () => {
    const pending = createPendingEvents();
    const { provider, run } = setUpTurn({
      pendingEvents: pending.list,
      responders: [
        arrivingDuring(pending, [botMessage("evt-2"), botMessage("evt-3", { createdAt: 3_000 })], unusableAnswer),
        finalAnswer,
      ],
    });

    await run();

    expect(retryTail(provider, 1)).toEqual([
      JSON.stringify(eventRecord(botMessage("evt-2")), null, 2),
      JSON.stringify(eventRecord(botMessage("evt-3", { createdAt: 3_000 })), null, 2),
      lateEventsNotice(1),
    ]);
  });
});

describe("Mid-turn injection: events are injected once", () => {
  it("does not inject an event again when it stays pending after the retry", async () => {
    const pending = createPendingEvents();
    const { orgops, provider, run } = setUpTurn({
      pendingEvents: pending.list,
      responders: [arrivingDuring(pending, [botMessage("evt-2")], staleAnswer), finalAnswer],
    });

    await run();

    expect(provider.requests).toHaveLength(2);
    expect(modelEvents(orgops.emitted())).toEqual([finalEvent]);
    expect(retryTail(provider, 1).filter((block) => block.includes(`"eventId": "evt-2"`))).toHaveLength(1);
  });

  it("keeps earlier injected events and notices in later requests, each wave once", async () => {
    const pending = createPendingEvents();
    const { provider, run } = setUpTurn({
      pendingEvents: pending.list,
      responders: [
        arrivingDuring(pending, [botMessage("evt-2")], staleAnswer),
        arrivingDuring(pending, [botMessage("evt-3", { createdAt: 3_000 })], staleAnswer),
        finalAnswer,
      ],
    });

    await run();

    expect(provider.requests).toHaveLength(3);
    expect(retryTail(provider, 2)).toEqual([
      JSON.stringify(eventRecord(botMessage("evt-2")), null, 2),
      lateEventsNotice(1),
      JSON.stringify(eventRecord(botMessage("evt-3", { createdAt: 3_000 })), null, 2),
      lateEventsNotice(2),
    ]);
  });

  it("puts a parse failure message and later events in the order they happened", async () => {
    const pending = createPendingEvents();
    const { provider, run } = setUpTurn({
      pendingEvents: pending.list,
      responders: [unusableAnswer, arrivingDuring(pending, [botMessage("evt-2")], staleAnswer), finalAnswer],
    });

    await run();

    const tail = retryTail(provider, 2);
    expect(tail[0]).toContain("not valid JSON on attempt 1/3");
    expect(tail.slice(1)).toEqual([JSON.stringify(eventRecord(botMessage("evt-2")), null, 2), lateEventsNotice(2)]);
  });
});

describe("Mid-turn injection: events arriving on the last attempt", () => {
  it("falls back instead of emitting when events arrive during the third attempt", async () => {
    const pending = createPendingEvents();
    const { orgops, provider, run } = setUpTurn({
      pendingEvents: pending.list,
      responders: [unusableAnswer, unusableAnswer, arrivingDuring(pending, [botMessage("evt-2")], harmlessEvent)],
    });

    await run();

    expect(provider.requests).toHaveLength(3);
    expect(modelEvents(orgops.emitted()).map((event) => event.type)).toEqual(["message.created"]);
    expect(completedPayload(orgops.emitted())).toMatchObject({ completedWithFallback: true });
  });

  it("makes a late injection use up an attempt, so a third late injection ends in the fallback", async () => {
    const pending = createPendingEvents();
    const { orgops, provider, run } = setUpTurn({
      pendingEvents: pending.list,
      responders: [
        arrivingDuring(pending, [botMessage("evt-2")], harmlessEvent),
        arrivingDuring(pending, [botMessage("evt-3", { createdAt: 3_000 })], harmlessEvent),
        arrivingDuring(pending, [botMessage("evt-4", { createdAt: 4_000 })], harmlessEvent),
      ],
    });

    await run();

    expect(provider.requests).toHaveLength(3);
    expect(modelEvents(orgops.emitted()).map((event) => event.type)).toEqual(["message.created"]);
    expect(completedPayload(orgops.emitted())).toMatchObject({ completedWithFallback: true });
    expect(retryTail(provider, 2).filter((block) => block.startsWith("New channel events"))).toEqual([
      lateEventsNotice(1),
      lateEventsNotice(2),
    ]);
  });

  it("emits normally when the third attempt has no new events after two late injections", async () => {
    const pending = createPendingEvents();
    const { orgops, provider, run } = setUpTurn({
      pendingEvents: pending.list,
      responders: [
        arrivingDuring(pending, [botMessage("evt-2")], staleAnswer),
        arrivingDuring(pending, [botMessage("evt-3", { createdAt: 3_000 })], staleAnswer),
        finalAnswer,
      ],
    });

    await run();

    expect(provider.requests).toHaveLength(3);
    expect(modelEvents(orgops.emitted())).toEqual([finalEvent]);
    expect(completedPayload(orgops.emitted())).not.toHaveProperty("completedWithFallback");
  });
});

describe("Mid-turn injection: tool loop", () => {
  it("[quirk] does not add events that arrive between two provider requests of one attempt to the second request", async () => {
    const pending = createPendingEvents();
    const { provider, run } = setUpTurn({
      pendingEvents: pending.list,
      responders: [
        arrivingDuring(pending, [botMessage("evt-2")], () =>
          chatCompletion({ toolCalls: [{ id: "call-1", name: "events_channels_list", arguments: {} }] }),
        ),
        staleAnswer,
        finalAnswer,
      ],
    });

    await run();

    expect(JSON.stringify(provider.requests[1])).not.toContain("evt-2");
  });

  it("finds those events only after the attempt's final response, and retries then", async () => {
    const pending = createPendingEvents();
    const { orgops, provider, run } = setUpTurn({
      pendingEvents: pending.list,
      responders: [
        arrivingDuring(pending, [botMessage("evt-2")], () =>
          chatCompletion({ toolCalls: [{ id: "call-1", name: "events_channels_list", arguments: {} }] }),
        ),
        staleAnswer,
        finalAnswer,
      ],
    });

    await run();

    expect(provider.requests).toHaveLength(3);
    expect(retryTail(provider, 2)).toEqual([
      JSON.stringify(eventRecord(botMessage("evt-2")), null, 2),
      lateEventsNotice(1),
    ]);
    expect(modelEvents(orgops.emitted())).toEqual([finalEvent]);
  });
});
