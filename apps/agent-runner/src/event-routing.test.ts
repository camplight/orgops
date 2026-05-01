import { describe, expect, it } from "vitest";
import { shouldHandleEventForAgent } from "./event-routing";
import type { Agent, Event } from "./types";

const agent: Agent = {
  name: "browser",
  systemInstructions: "",
  soulPath: "",
  workspacePath: "/tmp",
  modelId: "openai:gpt-4o-mini",
  desiredState: "RUNNING",
  runtimeState: "RUNNING",
};

function makeEvent(input: Partial<Event>): Event {
  return {
    id: "evt-1",
    type: "message.created",
    source: "human:admin",
    channelId: "chan-1",
    payload: {},
    createdAt: Date.now(),
    ...input,
  };
}

describe("event routing", () => {
  it("excludes bookkeeping lifecycle events", () => {
    expect(
      shouldHandleEventForAgent(
        agent,
        makeEvent({ type: "agent.turn.started", source: "agent:worker-a" }),
      ),
    ).toBe(false);
    expect(
      shouldHandleEventForAgent(
        agent,
        makeEvent({ type: "agent.turn.completed", source: "agent:worker-a" }),
      ),
    ).toBe(false);
    expect(
      shouldHandleEventForAgent(
        agent,
        makeEvent({ type: "tool.executed", source: "agent:worker-a" }),
      ),
    ).toBe(false);
    expect(
      shouldHandleEventForAgent(
        agent,
        makeEvent({ type: "noop", source: "agent:worker-a" }),
      ),
    ).toBe(false);
  });

  it("still allows normal channel events from others", () => {
    expect(
      shouldHandleEventForAgent(
        agent,
        makeEvent({ type: "message.created", source: "agent:worker-a" }),
      ),
    ).toBe(true);
  });

  it("only handles scheduled triggers for the target agent", () => {
    expect(
      shouldHandleEventForAgent(
        agent,
        makeEvent({
          type: "agent.scheduled.trigger",
          source: "system:scheduler",
          payload: { text: "run later", targetAgentName: "worker-a" },
        }),
      ),
    ).toBe(false);
    expect(
      shouldHandleEventForAgent(
        agent,
        makeEvent({
          type: "agent.scheduled.trigger",
          source: "system:scheduler",
          payload: { text: "run later", targetAgentName: "browser" },
        }),
      ),
    ).toBe(true);
  });

  it("only handles intent timeout nudges for the target agent", () => {
    expect(
      shouldHandleEventForAgent(
        agent,
        makeEvent({
          type: "agent.intent.timeout",
          source: "system:runner:intent-watchdog",
          payload: { intentId: "i-1", targetAgentName: "worker-a", timeoutCount: 1 },
        }),
      ),
    ).toBe(false);
    expect(
      shouldHandleEventForAgent(
        agent,
        makeEvent({
          type: "agent.intent.timeout",
          source: "system:runner:intent-watchdog",
          payload: { intentId: "i-1", targetAgentName: "browser", timeoutCount: 1 },
        }),
      ),
    ).toBe(true);
  });
});
