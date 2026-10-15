import { describe, expect, it } from "vitest";
import { getMockAgent, getMockChannelRecord, getMockEvent, getMockExecutor } from "./factories";
import { useFakeNetwork } from "./lifecycle";
import { createFakeOrgops } from "./orgops-api";
import { createFakeProvider, replyWithEvent } from "./provider";
import { server } from "./server";

useFakeNetwork();

describe("Classic turn harness", () => {
  it("answers a human message with the event the model returned", async () => {
    const orgops = createFakeOrgops({ channels: [getMockChannelRecord()] });
    const provider = createFakeProvider([
      replyWithEvent({ type: "message.created", payload: { text: "hi there" } }),
    ]);
    server.use(...orgops.handlers, provider.handler);

    await getMockExecutor()(getMockAgent(), [getMockEvent()]);

    const emitted = orgops.emitted();
    expect(emitted.map((event) => event.type)).toEqual([
      "agent.turn.started",
      "telemetry.prompt.composed",
      "telemetry.context.window.updated",
      "telemetry.context.window.updated",
      "message.created",
      "agent.turn.completed",
    ]);
    expect(emitted[4]).toMatchObject({
      source: "agent:alice",
      channelId: "chan-1",
      payload: { text: "hi there" },
    });
    expect(provider.requests).toHaveLength(1);
  });
});
