import { describe, expect, it, vi } from "vitest";
import {
  TURN_CANCEL_EVENT_TYPE,
  TurnCancelledError,
  createTurnCancellations,
  listBusyChannelEvents,
} from "./turn-cancel";
import type { Event } from "./types";

let nextId = 0;
const stop = (
  agentName: string,
  channelId: string,
  triggerEventId: string,
  type = TURN_CANCEL_EVENT_TYPE,
): Event => ({
  id: `stop-${(nextId += 1)}`,
  type,
  channelId,
  source: "human:ana",
  payload: { targetAgentName: agentName, triggerEventId, requestedBy: "human:ana" },
});

describe("turn cancellations", () => {
  it("aborts the running turn whose trigger matches", () => {
    const turns = createTurnCancellations();
    const active = turns.begin({ agentName: "pip", channelId: "c", triggerEventId: "t1" });
    expect(turns.request(stop("pip", "c", "t1"))).toBe(true);
    expect(active.signal.aborted).toBe(true);
    expect(active.signal.reason).toBeInstanceOf(TurnCancelledError);
  });

  it("ignores a Stop for another trigger, agent, channel or event type", () => {
    const turns = createTurnCancellations();
    const active = turns.begin({ agentName: "pip", channelId: "c", triggerEventId: "t2" });
    expect(turns.request(stop("pip", "c", "t1"))).toBe(false);
    expect(turns.request(stop("ann", "c", "t2"))).toBe(false);
    expect(turns.request(stop("pip", "other", "t2"))).toBe(false);
    expect(turns.request(stop("pip", "c", "t2", "message.created"))).toBe(false);
    expect(active.signal.aborted).toBe(false);
  });

  it("runs a stop registered after the turn was stopped right away", () => {
    const turns = createTurnCancellations();
    const active = turns.begin({ agentName: "pip", channelId: "c", triggerEventId: "t1" });
    turns.request(stop("pip", "c", "t1"));
    const late = vi.fn(async () => {});
    active.onCancel(late);
    expect(late).toHaveBeenCalledTimes(1);
  });

  it("settle waits for stops but gives up after the bound", async () => {
    const turns = createTurnCancellations();
    const active = turns.begin({ agentName: "pip", channelId: "c", triggerEventId: "t1" });
    let finished = false;
    active.onCancel(() => new Promise((resolve) => setTimeout(() => resolve((finished = true)), 30)));
    active.onCancel(() => new Promise(() => {}));
    active.onCancel(async () => {
      throw new Error("already gone");
    });
    turns.request(stop("pip", "c", "t1"));
    const started = Date.now();
    await active.settle(100);
    expect(Date.now() - started).toBeGreaterThanOrEqual(90);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(finished).toBe(true);
  });

  it("end leaves a newer turn registered", () => {
    const turns = createTurnCancellations();
    const first = turns.begin({ agentName: "pip", channelId: "c", triggerEventId: "t1" });
    const second = turns.begin({ agentName: "pip", channelId: "c", triggerEventId: "t2" });
    first.end();
    expect(turns.request(stop("pip", "c", "t2"))).toBe(true);
    expect(second.signal.aborted).toBe(true);
  });
});

describe("busy channel fetch", () => {
  it("a busy channel fetches voice and Stop events only", async () => {
    const calls: Array<{ agentName: string; channelId: string; options: { typePrefix?: string } }> = [];
    const byPrefix: Record<string, Event> = {
      "voice.": { id: "voice", type: "voice.call.requested", source: "human:ana", channelId: "c", payload: {}, createdAt: 5 },
      "agent.turn.cancel_requested": { id: "stop", type: "agent.turn.cancel_requested", source: "human:ana", channelId: "c", payload: {}, createdAt: 2 },
    };
    const events = await listBusyChannelEvents(
      async (agentName, channelId, options) => {
        calls.push({ agentName, channelId, options });
        return [byPrefix[options.typePrefix ?? ""]!];
      },
      "pip",
      "c",
    );
    expect(calls.map((call) => call.options)).toEqual([
      { typePrefix: "voice." },
      { typePrefix: "agent.turn.cancel_requested" },
    ]);
    expect(calls.every((call) => call.agentName === "pip" && call.channelId === "c")).toBe(true);
    expect(events.map((event) => event.id)).toEqual(["stop", "voice"]);
  });
});
