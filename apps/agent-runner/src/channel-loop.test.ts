import { describe, expect, it, vi } from "vitest";
import { createChannelLoopManager } from "./channel-loop";
import type { Agent, Event } from "./types";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("channel loop manager", () => {
  it("handles events from one poll as a single batch", async () => {
    const agent: Agent = {
      name: "browser",
      workspacePath: "/tmp",
      modelId: "openai:gpt-4o-mini",
      desiredState: "RUNNING",
      runtimeState: "RUNNING",
    };
    const processedBatches: string[][] = [];
    const manager = createChannelLoopManager({
      processBatch: async (_agent, _channelId, events) => {
        processedBatches.push(events.map((event) => event.id));
      },
    });
    const event = (id: string, createdAt: number): Event => ({
      id,
      type: "message.created",
      source: "human:admin",
      channelId: "chan-1",
      payload: { text: id },
      createdAt,
    });
    manager.enqueue(agent, [event("evt-1", 1000), event("evt-2", 1001), event("evt-3", 1002)]);
    await sleep(10);
    expect(processedBatches).toEqual([["evt-1", "evt-2", "evt-3"]]);
  });

  it("queues late same-channel events onto one running worker", async () => {
    const agent: Agent = {
      name: "browser",
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

  it("reports channel busy while worker is active", async () => {
    const agent: Agent = {
      name: "zoro",
      workspacePath: "/tmp",
      modelId: "openai:gpt-4o-mini",
      desiredState: "RUNNING",
      runtimeState: "RUNNING",
    };
    const gate: { release?: () => void } = {};
    const manager = createChannelLoopManager({
      processBatch: async () =>
        await new Promise<void>((resolve) => {
          gate.release = () => resolve();
        }),
    });
    const first: Event = {
      id: "evt-1",
      type: "message.created",
      source: "human:admin",
      channelId: "chan-1",
      payload: { text: "hello" },
      createdAt: 1000,
    };

    manager.enqueue(agent, [first]);
    await sleep(5);
    expect(manager.isChannelBusy("zoro", "chan-1")).toBe(true);

    gate.release?.();
    for (let idx = 0; idx < 20; idx += 1) {
      if (!manager.isChannelBusy("zoro", "chan-1")) break;
      await sleep(10);
    }
    expect(manager.isChannelBusy("zoro", "chan-1")).toBe(false);
  });

  it("tracks busy state per agent and channel key", async () => {
    const zoro: Agent = {
      name: "zoro",
      workspacePath: "/tmp",
      modelId: "openai:gpt-4o-mini",
      desiredState: "RUNNING",
      runtimeState: "RUNNING",
    };
    const alpha: Agent = {
      ...zoro,
      name: "alpha",
    };
    const gate: { release?: () => void } = {};
    const manager = createChannelLoopManager({
      processBatch: async (_agent, _channelId, events) => {
        if (events[0]?.channelId === "chan-1" && _agent.name === "zoro") {
          await new Promise<void>((resolve) => {
            gate.release = () => resolve();
          });
        }
      },
    });
    manager.enqueue(zoro, [
      {
        id: "evt-zoro",
        type: "message.created",
        source: "human:admin",
        channelId: "chan-1",
        payload: {},
        createdAt: 1,
      },
    ]);
    await sleep(5);
    expect(manager.isChannelBusy("zoro", "chan-1")).toBe(true);
    expect(manager.isChannelBusy("alpha", "chan-1")).toBe(false);
    expect(manager.isChannelBusy("zoro", "chan-2")).toBe(false);

    gate.release?.();
    for (let idx = 0; idx < 20; idx += 1) {
      if (!manager.isChannelBusy("zoro", "chan-1")) break;
      await sleep(10);
    }
    expect(manager.isChannelBusy("zoro", "chan-1")).toBe(false);
  });
});


describe("runner batch budget", () => {
  it("admits FIFO across agents, coalesces queued events, and releases failed slots", async () => {
    const releases: Array<() => void> = [];
    const batches: string[][] = [];
    let active = 0;
    let peak = 0;
    const manager = createChannelLoopManager({
      maxConcurrentBatches: 1,
      processBatch: async (_agent, _channel, events) => {
        active += 1;
        peak = Math.max(peak, active);
        batches.push(events.map(e => e.id));
        await new Promise<void>(resolve => releases.push(resolve));
        active -= 1;
        if (events[0].id === "a") throw new Error("provider unavailable");
      },
      onBatchError: async () => {},
    });
    const agent = (name: string) => ({name, workspacePath: "/tmp", modelId: "stub", desiredState: "RUNNING", runtimeState: "RUNNING"}) as Agent;
    const event = (id: string, channelId: string, createdAt: number) => ({id, channelId, createdAt, type: "message.created", source: "human:test", payload: {text: id}}) as Event;
    manager.enqueue(agent("one"), [event("a", "one", 1)]);
    manager.enqueue(agent("two"), [event("b", "two", 2)]);
    manager.enqueue(agent("three"), [event("c", "three", 3)]);
    manager.enqueue(agent("two"), [event("b2", "two", 4)]);
    await vi.waitFor(() => expect(batches).toEqual([["a"]]));
    expect(manager.isChannelBusy("two", "two")).toBe(true);
    releases.shift()!();
    await vi.waitFor(() => expect(batches).toEqual([["a"], ["b", "b2"]]));
    releases.shift()!();
    await vi.waitFor(() => expect(batches).toEqual([["a"], ["b", "b2"], ["c"]]));
    releases.shift()!();
    await vi.waitFor(() => expect(manager.activeWorkerCount()).toBe(0));
    expect(peak).toBe(1);
  });

  it("rejects invalid explicit concurrency instead of leaving queued turns stuck", () => {
    for (const maxConcurrentBatches of [0, -1, 1.5, NaN]) {
      expect(() => createChannelLoopManager({maxConcurrentBatches, processBatch: async () => {}})).toThrow();
    }
  });
});
