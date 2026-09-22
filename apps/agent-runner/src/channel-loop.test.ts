import { describe, expect, it } from "vitest";
import { createChannelLoopManager } from "./channel-loop";
import type { Agent, Event } from "./types";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean, message: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await sleep(5);
  }
  throw new Error(message);
}

function testAgent(id: string, enabledSkills: string[] = []): Agent {
  return {
    id,
    name: "mutable",
    systemInstructions: id,
    soulPath: "",
    enabledSkills,
    workspacePath: "/tmp",
    modelId: "openai:gpt-4o-mini",
    desiredState: "RUNNING",
    runtimeState: "RUNNING",
  };
}

function testEvent(id: string): Event {
  return {
    id,
    type: "message.created",
    source: "human:admin",
    channelId: "chan-mutable",
    payload: { text: id },
    createdAt: id === "event-a" ? 1 : 2,
  };
}

const captureForTurn = async (agentId: string) => ({
  agentId,
  generation: Object.freeze({ generation: "test", skillRoot: "/skills", promptRoot: "/skills", eventShapeRoot: "/skills" }),
  release() {},
});

describe("channel loop manager", () => {
  it("queues late same-channel events onto one running worker", async () => {
    const agent: Agent = {
      id: "browser-id",
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
      captureForTurn,
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

  it("keeps each queued batch bound to the immutable agent snapshot used for capture and errors", async () => {
    const captureGate = deferred();
    const captureStarted = deferred();
    const captures: string[] = [];
    const processed: Array<{ agent: Agent; eventId: string; generation: string }> = [];
    const errors: Array<{ agent: Agent; eventId: string }> = [];
    const manager = createChannelLoopManager({
      captureForTurn: async (agentId) => {
        captures.push(agentId);
        if (captures.length === 1) {
          captureStarted.resolve();
          await captureGate.promise;
        }
        return {
          agentId,
          generation: Object.freeze({ generation: `generation-${agentId}`, skillRoot: "/skills", promptRoot: "/skills", eventShapeRoot: "/skills" }),
          release() {},
        };
      },
      processBatch: async (current, _channelId, events, generation) => {
        processed.push({ agent: current, eventId: events[0]!.id, generation: generation.generation });
        if (events[0]!.id === "event-a") {
          expect(() => { current.id = "mutated"; }).toThrow();
          throw new Error("first batch failed");
        }
      },
      onBatchError: async (current, _channelId, events) => {
        errors.push({ agent: current, eventId: events[0]!.id });
      },
    });
    const first = testAgent("agent-a", ["skill-a"]);
    const replacement = testAgent("agent-b", ["skill-b"]);

    manager.enqueue(first, [testEvent("event-a")]);
    await captureStarted.promise;
    manager.enqueue(replacement, [testEvent("event-b")]);
    captureGate.resolve();
    await waitFor(() => manager.activeWorkerCount() === 0, "replacement batches did not finish");

    expect(captures).toEqual(["agent-a", "agent-b"]);
    expect(processed.map(({ agent, eventId, generation }) => ({ id: agent.id, instructions: agent.systemInstructions, eventId, generation }))).toEqual([
      { id: "agent-a", instructions: "agent-a", eventId: "event-a", generation: "generation-agent-a" },
      { id: "agent-b", instructions: "agent-b", eventId: "event-b", generation: "generation-agent-b" },
    ]);
    expect(errors.map(({ agent, eventId }) => ({ id: agent.id, eventId }))).toEqual([{ id: "agent-a", eventId: "event-a" }]);
    expect(processed.every(({ agent }) => Object.isFrozen(agent))).toBe(true);
  });

  it("keeps same-id configuration changes queued behind the batch's captured configuration", async () => {
    const captureGate = deferred();
    const captureStarted = deferred();
    const observations: Array<{ eventId: string; enabledSkills: string[] }> = [];
    let captures = 0;
    const manager = createChannelLoopManager({
      captureForTurn: async (agentId) => {
        captures += 1;
        if (captures === 1) {
          captureStarted.resolve();
          await captureGate.promise;
        }
        return {
          agentId,
          generation: Object.freeze({ generation: "generation-agent-a", skillRoot: "/skills", promptRoot: "/skills", eventShapeRoot: "/skills" }),
          release() {},
        };
      },
      processBatch: async (current, _channelId, events) => {
        observations.push({ eventId: events[0]!.id, enabledSkills: [...(current.enabledSkills ?? [])] });
      },
    });

    manager.enqueue(testAgent("agent-a", ["skill-a"]), [testEvent("event-a")]);
    await captureStarted.promise;
    manager.enqueue(testAgent("agent-a", ["skill-b"]), [testEvent("event-b")]);
    captureGate.resolve();
    await waitFor(() => manager.activeWorkerCount() === 0, "same-id batches did not finish");

    expect(observations).toEqual([
      { eventId: "event-a", enabledSkills: ["skill-a"] },
      { eventId: "event-b", enabledSkills: ["skill-b"] },
    ]);
  });

  it("releases a failed batch lease once and cleans up after a rejecting error handler", async () => {
    let releases = 0;
    let processed = 0;
    const manager = createChannelLoopManager({
      captureForTurn: async (agentId) => ({
        agentId,
        generation: Object.freeze({ generation: "test", skillRoot: "/skills", promptRoot: "/skills", eventShapeRoot: "/skills" }),
        release() { releases += 1; },
      }),
      processBatch: async () => {
        processed += 1;
        if (processed === 1) throw new Error("turn failed");
      },
      onBatchError: async () => { throw new Error("error handler failed"); },
    });
    const current = testAgent("agent-a");

    manager.enqueue(current, [testEvent("event-a")]);
    await waitFor(() => manager.activeWorkerCount() === 0, "failed worker did not clean up");
    manager.enqueue(current, [testEvent("event-b")]);
    await waitFor(() => manager.activeWorkerCount() === 0, "replacement worker did not clean up");

    expect(processed).toBe(2);
    expect(releases).toBe(2);
    expect(manager.workerStarts("mutable", "chan-mutable")).toBe(2);
  });

  it("reports channel busy while worker is active", async () => {
    const agent: Agent = {
      id: "zoro-id",
      name: "zoro",
      systemInstructions: "",
      soulPath: "",
      workspacePath: "/tmp",
      modelId: "openai:gpt-4o-mini",
      desiredState: "RUNNING",
      runtimeState: "RUNNING",
    };
    const gate: { release?: () => void } = {};
    const manager = createChannelLoopManager({
      captureForTurn,
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
      id: "zoro-id",
      name: "zoro",
      systemInstructions: "",
      soulPath: "",
      workspacePath: "/tmp",
      modelId: "openai:gpt-4o-mini",
      desiredState: "RUNNING",
      runtimeState: "RUNNING",
    };
    const alpha: Agent = {
      ...zoro,
      id: "alpha-id",
      name: "alpha",
    };
    const gate: { release?: () => void } = {};
    const manager = createChannelLoopManager({
      captureForTurn,
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
