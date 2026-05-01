import { describe, expect, it } from "vitest";
import {
  clearAgentIntentWatch,
  collectDueIntentTimeouts,
  ingestIntentEvents,
  type IntentWatchRecord,
} from "./intent-watchdog";
import type { Event } from "./types";

function makeEvent(input: Partial<Event>): Event {
  return {
    id: "evt-1",
    type: "message.created",
    source: "agent:worker-a",
    channelId: "chan-1",
    payload: {},
    createdAt: 1,
    ...input,
  };
}

describe("intent watchdog", () => {
  it("tracks an intent message and emits timeout reminders", () => {
    const intents = new Map<string, IntentWatchRecord>();
    ingestIntentEvents({
      intents,
      agentName: "worker-a",
      events: [
        makeEvent({
          id: "evt-intent",
          payload: {
            text: "I will prepare the summary",
            intent: { id: "sum-1", label: "prepare summary", timeoutMs: 10_000 },
          },
          createdAt: 5_000,
        }),
      ],
    });
    expect(intents.size).toBe(1);

    const dueBeforeTimeout = collectDueIntentTimeouts({
      intents,
      agentName: "worker-a",
      channelIds: ["chan-1"],
      nowMs: 14_000,
      maxTimeoutsPerIntent: 2,
    });
    expect(dueBeforeTimeout).toHaveLength(0);

    const due = collectDueIntentTimeouts({
      intents,
      agentName: "worker-a",
      channelIds: ["chan-1"],
      nowMs: 15_000,
      maxTimeoutsPerIntent: 2,
    });
    expect(due).toHaveLength(1);
    expect(due[0]?.intentId).toBe("sum-1");
    expect(due[0]?.timeoutCount).toBe(1);
  });

  it("clears tracked intents after an actionable follow-up event", () => {
    const intents = new Map<string, IntentWatchRecord>();
    ingestIntentEvents({
      intents,
      agentName: "worker-a",
      events: [
        makeEvent({
          id: "evt-intent",
          payload: { text: "starting", intent: true },
          createdAt: 2_000,
        }),
        makeEvent({
          id: "evt-action",
          type: "channel.command.requested",
          payload: { command: { action: "chat.postMessage" } },
          createdAt: 3_000,
        }),
      ],
    });
    expect(intents.size).toBe(0);
  });

  it("ignores bookkeeping/self telemetry as action completion", () => {
    const intents = new Map<string, IntentWatchRecord>();
    ingestIntentEvents({
      intents,
      agentName: "worker-a",
      events: [
        makeEvent({
          id: "evt-intent",
          payload: { text: "starting", intent: { id: "x-1" } },
          createdAt: 2_000,
        }),
        makeEvent({
          id: "evt-turn-completed",
          type: "agent.turn.completed",
          payload: { triggerEventId: "evt-trigger" },
          createdAt: 3_000,
        }),
      ],
    });
    expect(intents.size).toBe(1);
  });

  it("drops intents once max timeout attempts are exhausted", () => {
    const intents = new Map<string, IntentWatchRecord>();
    ingestIntentEvents({
      intents,
      agentName: "worker-a",
      events: [
        makeEvent({
          id: "evt-intent",
          payload: { text: "starting", intent: { id: "x-2", timeoutMs: 2_000 } },
          createdAt: 1_000,
        }),
      ],
    });

    const first = collectDueIntentTimeouts({
      intents,
      agentName: "worker-a",
      channelIds: ["chan-1"],
      nowMs: 3_000,
      maxTimeoutsPerIntent: 1,
    });
    expect(first).toHaveLength(1);

    const second = collectDueIntentTimeouts({
      intents,
      agentName: "worker-a",
      channelIds: ["chan-1"],
      nowMs: 6_000,
      maxTimeoutsPerIntent: 1,
    });
    expect(second).toHaveLength(0);
    expect(intents.size).toBe(0);
  });

  it("can clear intent tracking per agent", () => {
    const intents = new Map<string, IntentWatchRecord>();
    ingestIntentEvents({
      intents,
      agentName: "worker-a",
      events: [makeEvent({ id: "evt-intent", payload: { intent: true } })],
    });
    expect(intents.size).toBe(1);
    clearAgentIntentWatch(intents, "worker-a");
    expect(intents.size).toBe(0);
  });
});
