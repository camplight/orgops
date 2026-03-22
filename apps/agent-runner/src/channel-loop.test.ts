import { describe, expect, it } from "vitest";
import { createChannelLoopManager } from "./channel-loop";
import type { Agent, Event } from "./types";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("channel loop manager", () => {
  it("queues late same-channel events onto one running worker", async () => {
    const agent: Agent = {
      name: "browser",
      systemInstructions: "",
      soulPath: "",
      workspacePath: "/tmp",
      modelId: "openai:gpt-4o-mini",
      desiredState: "RUNNING",
      runtimeState: "RUNNING",
    };
    const processedBatches: string[][] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const manager = createChannelLoopManager({
      processBatch: async (_agent, _channelId, events) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        processedBatches.push(events.map((event) => event.id));
        await sleep(30);
        inFlight -= 1;
      },
    });

    const first: Event = {
      id: "evt-1",
      type: "message.created",
      source: "human:admin",
      channelId: "chan-1",
      payload: { text: "start" },
      createdAt: 1000,
    };
    const late: Event = {
      id: "evt-2",
      type: "process.output",
      source: "system:process-runner",
      channelId: "chan-1",
      payload: { text: "progress" },
      createdAt: 1001,
    };

    manager.enqueue(agent, [first]);
    await sleep(5);
    manager.enqueue(agent, [late]);

    for (let idx = 0; idx < 20; idx += 1) {
      if (
        manager.activeWorkerCount() === 0 &&
        processedBatches.length >= 2
      ) {
        break;
      }
      await sleep(20);
    }

    expect(processedBatches).toEqual([["evt-1"], ["evt-2"]]);
    expect(maxInFlight).toBe(1);
    expect(manager.workerStarts("browser", "chan-1")).toBe(1);
  });
});
