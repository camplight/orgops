import { describe, expect, it } from "vitest";
import { shouldHandleEventForAgent } from "./event-routing";
import type { Agent, Event } from "./types";

const agent: Agent = {
  name: "browser",
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
        makeEvent({ type: "wrapper.setup.completed", source: "system:runner:wrapper" }),
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

it("routes target lists without widening legacy targets or bypassing exclusions", () => {
  const message = makeEvent({ payload: { targetAgentNames: ["browser", "worker"] } });
  expect(shouldHandleEventForAgent(agent, message)).toBe(true);
  expect(shouldHandleEventForAgent({ ...agent, name: "worker" }, message)).toBe(true);
  expect(shouldHandleEventForAgent({ ...agent, name: "other" }, message)).toBe(false);
  expect(shouldHandleEventForAgent(agent, { ...message, source: "agent:browser" })).toBe(false);
  expect(shouldHandleEventForAgent(agent, { ...message, channelId: undefined })).toBe(false);
  expect(
    shouldHandleEventForAgent(
      agent,
      makeEvent({ payload: { targetAgentNames: ["browser"], targetAgentName: "worker" } }),
    ),
  ).toBe(false);
  expect(shouldHandleEventForAgent(agent, { ...message, type: "agent.scheduled.trigger" })).toBe(false);
  for (const targetAgentNames of [[], null, "browser", [123], [" "]]) {
    expect(shouldHandleEventForAgent(agent, makeEvent({ payload: { targetAgentNames } }))).toBe(false);
  }
});

it("treats voice presence and raw audio as bookkeeping but wakes on transcribed speech", () => {
  for (const type of [
    "voice.room.started",
    "voice.room.ended",
    "voice.session.started",
    "voice.session.ended",
    "voice.participant.muted",
    "voice.active_speaker.changed",
    "voice.input.chunk",
  ]) {
    expect(
      shouldHandleEventForAgent(
        agent,
        makeEvent({ type, payload: { sessionId: "voice-1", speakerId: "admin" } }),
      ),
    ).toBe(false);
  }
  const transcript = makeEvent({
    source: "human:admin",
    payload: { text: "hello", voice: { mode: "live", status: "transcribed" } },
  });
  expect(shouldHandleEventForAgent(agent, transcript)).toBe(true);
});

it("never wakes agents on realtime call lifecycle or call transcripts", () => {
  for (const type of ["voice.realtime.call.started", "voice.realtime.call.ended"]) {
    expect(
      shouldHandleEventForAgent(
        agent,
        makeEvent({ type, payload: { targetAgentName: agent.name, callId: "rtc_1" } }),
      ),
    ).toBe(false);
  }
  const callTranscript = makeEvent({
    source: "human:admin",
    payload: { text: "hello", voice: { mode: "realtime", callId: "rtc_1" } },
  });
  expect(shouldHandleEventForAgent(agent, callTranscript)).toBe(false);
});
