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
