import { describe, expect, it } from "vitest";
import type { Event } from "./types";
import {
  agentChannelKey,
  shouldSuppressProcessLifecycleTrigger,
} from "./turn-trigger-filter";

describe("process events turn triggering", () => {
  it("suppresses in-turn process lifecycle events but allows post-turn wakeups", () => {
    const agentName = "tester";
    const channelId = "chan-1";
    const key = agentChannelKey(agentName, channelId);
    expect(key).toBe("tester::chan-1");

    const recentTurnWindow = { startedAt: 1000, completedAt: 2000 };
    const inTurnStarted: Event = {
      id: "evt-1",
      type: "process.started",
      payload: { processId: "p-1", targetAgentName: "tester" },
      source: "system:process-runner",
      channelId,
      createdAt: 1200,
    };
    const inTurnOutput: Event = {
      id: "evt-2",
      type: "process.output",
      payload: { processId: "p-1", targetAgentName: "tester", text: "working" },
      source: "system:process-runner",
      channelId,
      createdAt: 1600,
    };
    const inTurnExited: Event = {
      id: "evt-3",
      type: "process.exited",
      payload: { processId: "p-1", targetAgentName: "tester", exitCode: 0 },
      source: "system:process-runner",
      channelId,
      createdAt: 1900,
    };
    const postTurnOutput: Event = {
      id: "evt-4",
      type: "process.output",
      payload: { processId: "p-2", targetAgentName: "tester", text: "later output" },
      source: "system:process-runner",
      channelId,
      createdAt: 2200,
    };
    const postTurnExited: Event = {
      id: "evt-5",
      type: "process.exited",
      payload: { processId: "p-2", targetAgentName: "tester", exitCode: 0 },
      source: "system:process-runner",
      channelId,
      createdAt: 2300,
    };
    const userMessage: Event = {
      id: "evt-6",
      type: "message.created",
      payload: { text: "hello" },
      source: "human:alice",
      channelId,
      createdAt: 1100,
    };

    expect(
      shouldSuppressProcessLifecycleTrigger({
        agentName,
        event: inTurnStarted,
        recentWindow: recentTurnWindow,
      }),
    ).toBe(true);
    expect(
      shouldSuppressProcessLifecycleTrigger({
        agentName,
        event: inTurnOutput,
        recentWindow: recentTurnWindow,
      }),
    ).toBe(true);
    expect(
      shouldSuppressProcessLifecycleTrigger({
        agentName,
        event: inTurnExited,
        recentWindow: recentTurnWindow,
      }),
    ).toBe(true);
    expect(
      shouldSuppressProcessLifecycleTrigger({
        agentName,
        event: postTurnOutput,
        recentWindow: recentTurnWindow,
      }),
    ).toBe(false);
    expect(
      shouldSuppressProcessLifecycleTrigger({
        agentName,
        event: postTurnExited,
        recentWindow: recentTurnWindow,
      }),
    ).toBe(false);
    expect(
      shouldSuppressProcessLifecycleTrigger({
        agentName,
        event: userMessage,
        recentWindow: recentTurnWindow,
      }),
    ).toBe(false);
  });
});
