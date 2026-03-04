import { describe, expect, it } from "bun:test";
import { EventSchema } from "./index";

describe("schemas", () => {
  it("validates event payload", () => {
    const parsed = EventSchema.safeParse({
      type: "message.created",
      payload: { text: "hello" },
      source: "human:admin",
    });
    expect(parsed.success).toBe(true);
  });
});
