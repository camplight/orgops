import { describe, expect, it } from "vitest";
import {
  EventSchema,
  getCoreEventShapes,
  validateEventAgainstShapes,
} from "./index";

describe("schemas", () => {
  it("validates event payload", () => {
    const parsed = EventSchema.safeParse({
      type: "message.created",
      payload: { text: "hello" },
      source: "human:admin",
    });
    expect(parsed.success).toBe(true);
  });

  it("validates typed core event shapes", () => {
    const result = validateEventAgainstShapes(
      {
        type: "message.created",
        source: "human:admin",
        channelId: "chan-1",
        payload: { text: "hello" },
      },
      getCoreEventShapes(),
    );
    expect(result.ok).toBe(true);
  });

  it("validates message.created with intent metadata", () => {
    const result = validateEventAgainstShapes(
      {
        type: "message.created",
        source: "agent:worker-a",
        channelId: "chan-1",
        payload: {
          text: "I will do this shortly.",
          intent: {
            id: "intent-1",
            label: "follow up with concrete output",
            timeoutMs: 45_000,
          },
        },
      },
      getCoreEventShapes(),
    );
    expect(result.ok).toBe(true);
  });

  it("validates agent.intent.timeout core event shape", () => {
    const result = validateEventAgainstShapes(
      {
        type: "agent.intent.timeout",
        source: "system:runner:intent-watchdog",
        channelId: "chan-1",
        payload: {
          targetAgentName: "worker-a",
          intentId: "intent-1",
          intentMessageEventId: "evt-message-1",
          timeoutMs: 45_000,
          timeoutCount: 1,
          text: "Intent has not been acted on yet.",
        },
      },
      getCoreEventShapes(),
    );
    expect(result.ok).toBe(true);
  });

  it("validates noop core event shape", () => {
    const result = validateEventAgainstShapes(
      {
        type: "noop",
        source: "agent:worker-a",
        channelId: "chan-1",
        payload: { reason: "not_mentioned_in_group_channel" },
      },
      getCoreEventShapes(),
    );
    expect(result.ok).toBe(true);
  });

  it("returns shape issues for invalid event payload", () => {
    const result = validateEventAgainstShapes(
      {
        type: "message.created",
        source: "human:admin",
        channelId: "chan-1",
        payload: { text: "" },
      },
      getCoreEventShapes(),
    );
    expect(result.ok).toBe(false);
  });
});
