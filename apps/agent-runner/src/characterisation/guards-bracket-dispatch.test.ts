import { describe, expect, it, vi } from "vitest";
import { runRlmEventInChild } from "../rlm-process";
import { runWrappedAgentTurn } from "../wrapped-runtime";
import { getMockAgent, getMockChannelRecord, getMockEvent, getMockExecutor } from "./factories";
import { useFakeNetwork } from "./lifecycle";
import { createFakeOrgops } from "./orgops-api";
import { createFakeProvider, replyWithEvent } from "./provider";
import { server } from "./server";

vi.mock("../wrapped-runtime", () => ({ runWrappedAgentTurn: vi.fn() }));
vi.mock("../rlm-process", () => ({ runRlmEventInChild: vi.fn() }));

useFakeNetwork();

const helloReply = () =>
  createFakeProvider([replyWithEvent({ type: "message.created", payload: { text: "hi" } })]);

const silenceLogs = () => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
};

const freshRuntimeMocks = () => {
  vi.mocked(runWrappedAgentTurn).mockReset();
  vi.mocked(runRlmEventInChild).mockReset();
};

describe("Guards", () => {
  it("emits nothing when there are no events", async () => {
    const orgops = createFakeOrgops({ channels: [getMockChannelRecord()] });
    server.use(...orgops.handlers);

    await getMockExecutor()(getMockAgent(), []);

    expect(orgops.callLog()).toEqual([]);
  });

  it("emits nothing when the last event has no channelId", async () => {
    const orgops = createFakeOrgops({ channels: [getMockChannelRecord()] });
    server.use(...orgops.handlers);

    await getMockExecutor()(getMockAgent(), [getMockEvent({ channelId: undefined })]);

    expect(orgops.callLog()).toEqual([]);
  });

  it("emits nothing when the last event has an empty channelId", async () => {
    const orgops = createFakeOrgops({ channels: [getMockChannelRecord()] });
    server.use(...orgops.handlers);

    await getMockExecutor()(getMockAgent(), [getMockEvent({ channelId: "" })]);

    expect(orgops.callLog()).toEqual([]);
  });

  it("emits nothing when only an earlier event has a channelId", async () => {
    const orgops = createFakeOrgops({ channels: [getMockChannelRecord()] });
    server.use(...orgops.handlers);

    await getMockExecutor()(getMockAgent(), [
      getMockEvent({ id: "evt-1", channelId: "chan-1" }),
      getMockEvent({ id: "evt-2", channelId: undefined }),
    ]);

    expect(orgops.callLog()).toEqual([]);
  });

  it("takes the trigger and the channel from the last event, not the first", async () => {
    const orgops = createFakeOrgops({
      channels: [
        getMockChannelRecord({ id: "chan-1" }),
        getMockChannelRecord({ id: "chan-2", name: "other" }),
      ],
    });
    server.use(...orgops.handlers, helloReply().handler);

    await getMockExecutor()(getMockAgent(), [
      getMockEvent({ id: "evt-1", channelId: "chan-1" }),
      getMockEvent({ id: "evt-2", channelId: "chan-2" }),
    ]);

    const emitted = orgops.emitted();
    expect(emitted[0]).toMatchObject({
      type: "agent.turn.started",
      channelId: "chan-2",
      payload: { triggerEventId: "evt-2", eventCount: 2 },
    });
    expect(emitted.at(-2)).toMatchObject({ type: "message.created", channelId: "chan-2" });
  });

  it("takes the trigger from the last event even when the first has no channelId", async () => {
    const orgops = createFakeOrgops({ channels: [getMockChannelRecord()] });
    server.use(...orgops.handlers, helloReply().handler);

    await getMockExecutor()(getMockAgent(), [
      getMockEvent({ id: "evt-1", channelId: undefined }),
      getMockEvent({ id: "evt-2", channelId: "chan-1" }),
    ]);

    expect(orgops.emitted()[0]).toMatchObject({
      type: "agent.turn.started",
      channelId: "chan-1",
      payload: { triggerEventId: "evt-2", eventCount: 2 },
    });
  });
});

describe("Turn bracket", () => {
  it("emits agent.turn.started before any other API call, including the secrets lookup", async () => {
    const orgops = createFakeOrgops({ channels: [getMockChannelRecord()] });
    server.use(...orgops.handlers, helloReply().handler);

    await getMockExecutor()(getMockAgent(), [getMockEvent()]);

    const calls = orgops.callLog();
    expect(calls[0]).toBe("POST /api/events agent.turn.started");
    expect(calls.indexOf("GET /api/secrets/env")).toBeGreaterThan(0);
  });

  it("emits agent.turn.started as the agent on the turn channel with trigger id and event count", async () => {
    const orgops = createFakeOrgops({ channels: [getMockChannelRecord()] });
    server.use(...orgops.handlers, helloReply().handler);

    await getMockExecutor()(getMockAgent(), [getMockEvent({ id: "evt-9" })]);

    expect(orgops.emitted()[0]).toEqual({
      type: "agent.turn.started",
      source: "agent:alice",
      channelId: "chan-1",
      payload: { triggerEventId: "evt-9", eventCount: 1 },
    });
  });

  it("emits agent.turn.completed last, with the trigger id and the number of events", async () => {
    const orgops = createFakeOrgops({ channels: [getMockChannelRecord()] });
    server.use(...orgops.handlers, helloReply().handler);

    await getMockExecutor()(getMockAgent(), [
      getMockEvent({ id: "evt-1" }),
      getMockEvent({ id: "evt-2" }),
      getMockEvent({ id: "evt-3" }),
    ]);

    const emitted = orgops.emitted();
    expect(emitted.at(-1)).toEqual({
      type: "agent.turn.completed",
      source: "agent:alice",
      channelId: "chan-1",
      payload: { triggerEventId: "evt-3", eventCount: 3 },
    });
    expect(emitted.filter((event) => event.type === "agent.turn.completed")).toHaveLength(1);
    expect(emitted.filter((event) => event.type === "agent.turn.started")).toHaveLength(1);
  });

  it("carries on with the turn when agent.turn.started cannot be delivered", async () => {
    silenceLogs();
    const orgops = createFakeOrgops({
      channels: [getMockChannelRecord()],
      rejectEvent: (event) => event.type === "agent.turn.started",
    });
    const provider = helloReply();
    server.use(...orgops.handlers, provider.handler);

    await getMockExecutor()(getMockAgent(), [getMockEvent()]);

    expect(orgops.callLog()[0]).toBe("POST /api/events agent.turn.started");
    expect(provider.requests).toHaveLength(1);
    expect(orgops.emitted().map((event) => event.type)).toEqual([
      "telemetry.prompt.composed",
      "telemetry.context.window.updated",
      "telemetry.context.window.updated",
      "message.created",
      "agent.turn.completed",
    ]);
  });

  it("resolves when agent.turn.completed cannot be delivered", async () => {
    silenceLogs();
    const orgops = createFakeOrgops({
      channels: [getMockChannelRecord()],
      rejectEvent: (event) => event.type === "agent.turn.completed",
    });
    server.use(...orgops.handlers, helloReply().handler);

    await expect(getMockExecutor()(getMockAgent(), [getMockEvent()])).resolves.toBeUndefined();

    expect(orgops.callLog().at(-1)).toBe("POST /api/events agent.turn.completed");
    expect(orgops.emitted().at(-1)?.type).toBe("message.created");
  });
});

describe("Mode dispatch", () => {
  it("delegates a WRAPPED agent to the wrapped runtime with the events", async () => {
    freshRuntimeMocks();
    const orgops = createFakeOrgops({ channels: [getMockChannelRecord()] });
    server.use(...orgops.handlers);
    const agent = getMockAgent({ mode: "WRAPPED" });
    const events = [getMockEvent({ id: "evt-1" }), getMockEvent({ id: "evt-2" })];

    await getMockExecutor()(agent, events);

    expect(runWrappedAgentTurn).toHaveBeenCalledTimes(1);
    expect(runWrappedAgentTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot: "/orgops",
        api: {
          apiFetch: expect.any(Function),
          emitEvent: expect.any(Function),
          ensureLifecycleChannel: expect.any(Function),
          getPackageSecretsEnv: expect.any(Function),
        },
      }),
      agent,
      events,
    );
  });

  it("brackets a WRAPPED turn with started and completed, makes no model call and emits no prompt telemetry", async () => {
    freshRuntimeMocks();
    const orgops = createFakeOrgops({ channels: [getMockChannelRecord()] });
    server.use(...orgops.handlers);

    await getMockExecutor()(getMockAgent({ mode: "WRAPPED" }), [getMockEvent()]);

    expect(orgops.callLog()).toEqual([
      "POST /api/events agent.turn.started",
      "POST /api/events agent.turn.completed",
    ]);
    expect(orgops.emitted()[1]).toEqual({
      type: "agent.turn.completed",
      source: "agent:alice",
      channelId: "chan-1",
      payload: { triggerEventId: "evt-1", eventCount: 1, runtime: "wrapped" },
    });
  });

  it("runs the wrapped runtime between started and completed", async () => {
    freshRuntimeMocks();
    const orgops = createFakeOrgops({ channels: [getMockChannelRecord()] });
    const emittedWhenWrappedRan: string[] = [];
    vi.mocked(runWrappedAgentTurn).mockImplementation(async () => {
      emittedWhenWrappedRan.push(...orgops.emitted().map((event) => event.type));
    });
    server.use(...orgops.handlers);

    await getMockExecutor()(getMockAgent({ mode: "WRAPPED" }), [getMockEvent()]);

    expect(emittedWhenWrappedRan).toEqual(["agent.turn.started"]);
  });

  it("does not run the RLM runtime for a WRAPPED agent", async () => {
    freshRuntimeMocks();
    const orgops = createFakeOrgops({ channels: [getMockChannelRecord()] });
    server.use(...orgops.handlers);

    await getMockExecutor()(getMockAgent({ mode: "WRAPPED" }), [getMockEvent()]);

    expect(runRlmEventInChild).not.toHaveBeenCalled();
  });

  it("runs an RLM_REPL agent after the prompt and context telemetry, with the system prompt and composed messages", async () => {
    freshRuntimeMocks();
    const orgops = createFakeOrgops({ channels: [getMockChannelRecord()] });
    const emittedWhenRlmRan: string[] = [];
    vi.mocked(runRlmEventInChild).mockImplementation(async () => {
      emittedWhenRlmRan.push(...orgops.emitted().map((event) => event.type));
    });
    server.use(...orgops.handlers);
    const agent = getMockAgent({ mode: "RLM_REPL" });
    const trigger = getMockEvent();

    await getMockExecutor()(agent, [trigger]);

    expect(emittedWhenRlmRan).toEqual([
      "agent.turn.started",
      "telemetry.prompt.composed",
      "telemetry.context.window.updated",
    ]);
    const prompt = orgops.emitted()[1]!.payload as {
      systemPrompt: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(prompt.systemPrompt).toContain("You are alice.");
    expect(runRlmEventInChild).toHaveBeenCalledTimes(1);
    const call = vi.mocked(runRlmEventInChild).mock.calls[0]![0];
    expect(call).toMatchObject({ agent, event: trigger, channelId: "chan-1" });
    expect(call.systemPrompt).toBe(prompt.systemPrompt);
    expect(call.baseMessages.map(({ role, content }) => ({ role, content }))).toEqual(
      prompt.messages,
    );
  });

  it("completes an RLM_REPL turn with an empty payload, makes no model call and emits no output event", async () => {
    freshRuntimeMocks();
    const orgops = createFakeOrgops({ channels: [getMockChannelRecord()] });
    server.use(...orgops.handlers);

    await getMockExecutor()(getMockAgent({ mode: "RLM_REPL" }), [
      getMockEvent({ id: "evt-1" }),
      getMockEvent({ id: "evt-2" }),
    ]);

    const emitted = orgops.emitted();
    expect(emitted.map((event) => event.type)).toEqual([
      "agent.turn.started",
      "telemetry.prompt.composed",
      "telemetry.context.window.updated",
      "agent.turn.completed",
    ]);
    expect(emitted[3]).toEqual({
      type: "agent.turn.completed",
      source: "agent:alice",
      channelId: "chan-1",
      payload: { triggerEventId: "evt-2", eventCount: 2 },
    });
    expect(runWrappedAgentTurn).not.toHaveBeenCalled();
  });

  it("does not complete an RLM_REPL turn when the RLM runtime fails", async () => {
    freshRuntimeMocks();
    vi.mocked(runRlmEventInChild).mockRejectedValue(new Error("child died"));
    const orgops = createFakeOrgops({ channels: [getMockChannelRecord()] });
    server.use(...orgops.handlers);

    await expect(
      getMockExecutor()(getMockAgent({ mode: "RLM_REPL" }), [getMockEvent()]),
    ).rejects.toThrow("child died");

    expect(orgops.emitted().map((event) => event.type)).not.toContain("agent.turn.completed");
  });

  it("treats a missing mode as CLASSIC", async () => {
    freshRuntimeMocks();
    const orgops = createFakeOrgops({ channels: [getMockChannelRecord()] });
    const provider = helloReply();
    server.use(...orgops.handlers, provider.handler);

    await getMockExecutor()(getMockAgent({ mode: undefined }), [getMockEvent()]);

    expect(provider.requests).toHaveLength(1);
    expect(orgops.emitted().map((event) => event.type)).toContain("message.created");
    expect(runWrappedAgentTurn).not.toHaveBeenCalled();
    expect(runRlmEventInChild).not.toHaveBeenCalled();
  });

  it("runs an explicit CLASSIC agent through the model without either runtime", async () => {
    freshRuntimeMocks();
    const orgops = createFakeOrgops({ channels: [getMockChannelRecord()] });
    const provider = helloReply();
    server.use(...orgops.handlers, provider.handler);

    await getMockExecutor()(getMockAgent({ mode: "CLASSIC" }), [getMockEvent()]);

    expect(provider.requests).toHaveLength(1);
    expect(runWrappedAgentTurn).not.toHaveBeenCalled();
    expect(runRlmEventInChild).not.toHaveBeenCalled();
  });
});
