import { describe, expect, it } from "vitest";
import { EventBus } from "./index";

describe("event-bus", () => {
  it("publishes to subscribers", () => {
    const bus = new EventBus<string>();
    let received = "";
    bus.subscribe("topic", (payload) => {
      received = payload;
    });
    bus.publish("topic", "hello");
    expect(received).toBe("hello");
  });
});
