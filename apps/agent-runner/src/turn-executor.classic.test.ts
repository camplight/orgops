import { beforeEach, describe, expect, it, vi } from "vitest";
import { generate, type LlmTool } from "@orgops/llm";
import { createTurnExecutor } from "./turn-executor";
import type { Agent, Event } from "./types";

vi.mock("@orgops/llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@orgops/llm")>()),
  generate: vi.fn(),
}));

const agent: Agent = {
  name: "tester",
  workspacePath: "/tmp",
  modelId: "openai:gpt-4o-mini",
  desiredState: "RUNNING",
  runtimeState: "RUNNING",
  memoryContextMode: "OFF",
  emitAuditEvents: false,
};

const trigger: Event = {
  id: "trigger",
  type: "message.created",
  source: "human:test",
  channelId: "chat",
  payload: { text: "question" },
};

function setup(options: { pendingEventBatches?: Event[][] } = {}) {
  const emitted: Array<{ type?: string; payload?: Record<string, unknown> }> = [];
  let pendingEventBatchIndex = 0;
  const apiFetch = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/api/channels") {
      return Response.json([
        {
          id: "chat",
          participants: [{ subscriberType: "AGENT", subscriberId: "tester" }],
        },
      ]);
    }
    if (path.startsWith("/api/events?")) {
      return Response.json(options.pendingEventBatches?.[pendingEventBatchIndex++] ?? []);
    }
    if (path === "/api/events" && init?.method === "POST") {
      const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
      return Response.json({ id: "evt-posted", status: "DELIVERED", ...body });
    }
    throw new Error(`Unexpected API call ${init?.method ?? "GET"} ${path}`);
  });
  const execute = createTurnExecutor({
    projectRoot: "/tmp",
    skillRoots: [],
    llmCallTimeoutMs: 10_000,
    api: {
      apiFetch,
      emitEvent: async (event) => {
        emitted.push(event as { type?: string; payload?: Record<string, unknown> });
      },
      listChannels: async () => [],
      getChannelRecord: async () => ({
        id: "chat",
        participants: [{ subscriberType: "AGENT", subscriberId: "tester" }],
      }),
      getChannelParticipationValidationError: async () => null,
      ensureLifecycleChannel: async () => "lifecycle",
      getPackageSecretsEnv: async () => ({}),
    },
  });
  return {
    emitted,
    apiFetch,
    run: () => execute(agent, [trigger]),
  };
}

async function emit(
  tools: Record<string, LlmTool> | undefined,
  text: string,
  input?: { stageUntilTurnSettled?: boolean },
) {
  return tools?.events_emit?.execute?.({
    type: "message.created",
    payload: { text },
    ...(input?.stageUntilTurnSettled ? { stageUntilTurnSettled: true } : {}),
  });
}

beforeEach(() => {
  vi.mocked(generate).mockReset();
});

describe("CLASSIC empty final output", () => {
  it("does not post a structured-output fallback after tool-calls with empty text", async () => {
    const ctx = setup();
    vi.mocked(generate).mockResolvedValue({
      text: "",
      toolCalls: [{ toolName: "shell_run" }],
      toolResults: [{ toolName: "shell_run" }],
      finishReason: "tool-calls",
    });
    await ctx.run();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(ctx.emitted.filter((event) => event.type === "message.created")).toHaveLength(0);
    expect(ctx.emitted.find((event) => event.type === "agent.turn.completed")?.payload).toMatchObject({
      noReply: true,
    });
  });

  it("still posts a format fallback when the model returns invalid JSON without tools", async () => {
    const ctx = setup();
    vi.mocked(generate).mockResolvedValue({
      text: "not json",
      toolCalls: [],
      toolResults: [],
      finishReason: "stop",
    });
    await ctx.run();
    expect(generate).toHaveBeenCalledTimes(3);
    const messages = ctx.emitted.filter((event) => event.type === "message.created");
    expect(messages).toHaveLength(0);
    expect(
      ctx.emitted.find(
        (event) =>
          event.type === "agent.turn.phase" &&
          event.payload?.phase === "response.format_error",
      )?.payload?.detail,
    ).toContain("response-format issue");
  });

  it("discards contradictory staged messages on validation retry", async () => {
    const ctx = setup();
    vi.mocked(generate)
      .mockImplementationOnce(async (_model, _messages, options) => {
        expect(await emit(options?.tools, "yes", { stageUntilTurnSettled: true })).toMatchObject({
          delivery: { status: "staged_until_turn_settled" },
        });
        expect(ctx.emitted.filter((event) => event.type === "message.created")).toHaveLength(0);
        return {
          toolCalls: [] as never[],
          toolResults: [] as never[],
          text: '{"type":"message.created","payload":"bad"}',
        };
      })
      .mockImplementationOnce(async (_model, messages, options) => {
        expect(JSON.stringify(messages)).toContain("Event validation failed");
        await emit(options?.tools, "no", { stageUntilTurnSettled: true });
        return {
          toolCalls: [] as never[],
          toolResults: [] as never[],
          text: '{"type":"noop","payload":{}}',
        };
      });
    await ctx.run();
    expect(
      ctx.emitted
        .filter((event) => event.type === "message.created")
        .map((event) => event.payload?.text),
    ).toEqual(["no"]);
  });

  it("flushes staged message without posting generic format error chat", async () => {
    const ctx = setup();
    vi.mocked(generate).mockImplementation(async (_model, _messages, options) => {
      await emit(options?.tools, "answer", { stageUntilTurnSettled: true });
      return { toolCalls: [] as never[], toolResults: [] as never[], text: '{"type":"message.created","payload":{}}' };
    });
    await ctx.run();
    expect(generate).toHaveBeenCalledTimes(3);
    expect(
      ctx.emitted
        .filter((event) => event.type === "message.created")
        .map((event) => event.payload?.text),
    ).toEqual(["answer"]);
    expect(
      ctx.emitted.find(
        (event) =>
          event.type === "agent.turn.phase" &&
          event.payload?.phase === "response.format_error",
      ),
    ).toBeUndefined();
  });

  it("keeps immediate mid-turn chat when stageUntilTurnSettled is not set", async () => {
    const ctx = setup();
    vi.mocked(generate).mockImplementationOnce(async (_model, _messages, options) => {
      const emitted = await emit(options?.tools, "streaming update");
      expect(emitted).toMatchObject({
        delivery: { status: "not_waited" },
      });
      return {
        toolCalls: [] as never[],
        toolResults: [] as never[],
        text: '{"type":"noop","payload":{}}',
      };
    });
    await ctx.run();
    const posted = ctx.apiFetch.mock.calls
      .filter(([path, init]) => path === "/api/events" && init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    expect(
      posted.some((event) => {
        const payload = event.payload as Record<string, unknown> | undefined;
        return event.type === "message.created" && payload?.text === "streaming update";
      }),
    ).toBe(true);
  });

  it("posts a final answer, then continues the same turn for late human events", async () => {
    const lateEvent: Event = {
      id: "late-human",
      type: "message.created",
      source: "human:test",
      channelId: "chat",
      payload: { text: "also answer this" },
      createdAt: 2,
    };
    const ctx = setup({ pendingEventBatches: [[lateEvent], []] });
    vi.mocked(generate)
      .mockResolvedValueOnce({
        toolCalls: [] as never[],
        toolResults: [] as never[],
        text: '{"type":"message.created","payload":{"text":"first answer"}}',
      })
      .mockImplementationOnce(async (_model, messages) => {
        const serialized = JSON.stringify(messages);
        expect(serialized).toContain("system.turn.events_posted");
        expect(serialized).toContain("also answer this");
        return {
          toolCalls: [] as never[],
          toolResults: [] as never[],
          text: '{"type":"message.created","payload":{"text":"second answer"}}',
        };
      });

    await ctx.run();

    expect(generate).toHaveBeenCalledTimes(2);
    expect(
      ctx.emitted
        .filter((event) => event.type === "message.created")
        .map((event) => event.payload?.text),
    ).toEqual(["first answer", "second answer"]);
    expect(
      ctx.emitted.find(
        (event) =>
          event.type === "agent.turn.completed" &&
          event.payload?.responseFormatError,
      ),
    ).toBeUndefined();
  });

  it("does not let current-turn sync process events consume a valid final answer", async () => {
    const processEvents: Event[] = [
      {
        id: "proc-start",
        type: "process.started",
        source: "system:process-runner",
        channelId: "chat",
        payload: {
          processId: "proc-1",
          executionMode: "SYNC",
          ownerAgentName: "tester",
          targetAgentName: "tester",
        },
        createdAt: 2,
      },
      {
        id: "proc-output",
        type: "process.output",
        source: "system:process-runner",
        channelId: "chat",
        payload: {
          processId: "proc-1",
          text: "tool output",
          ownerAgentName: "tester",
          targetAgentName: "tester",
        },
        createdAt: 3,
      },
      {
        id: "proc-exit",
        type: "process.exited",
        source: "system:process-runner",
        channelId: "chat",
        payload: {
          processId: "proc-1",
          exitCode: 0,
          ownerAgentName: "tester",
          targetAgentName: "tester",
        },
        createdAt: 4,
      },
    ];
    const ctx = setup({ pendingEventBatches: [processEvents] });
    vi.mocked(generate).mockResolvedValueOnce({
      toolCalls: [] as never[],
      toolResults: [] as never[],
      text: '{"type":"message.created","payload":{"text":"answer survives"}}',
    });

    await ctx.run();

    expect(generate).toHaveBeenCalledTimes(1);
    expect(
      ctx.emitted
        .filter((event) => event.type === "message.created")
        .map((event) => event.payload?.text),
    ).toEqual(["answer survives"]);
    expect(
      ctx.emitted.find(
        (event) =>
          event.type === "agent.turn.phase" &&
          event.payload?.phase === "response.format_error",
      ),
    ).toBeUndefined();
  });

  it("keeps async process events available as late turn context", async () => {
    const asyncOutput: Event = {
      id: "async-output",
      type: "process.output",
      source: "system:process-runner",
      channelId: "chat",
      payload: {
        processId: "proc-async",
        text: "server ready",
        ownerAgentName: "tester",
        targetAgentName: "tester",
      },
      createdAt: 2,
    };
    const ctx = setup({ pendingEventBatches: [[asyncOutput], []] });
    vi.mocked(generate)
      .mockResolvedValueOnce({
        toolCalls: [] as never[],
        toolResults: [] as never[],
        text: '{"type":"message.created","payload":{"text":"started"}}',
      })
      .mockImplementationOnce(async (_model, messages) => {
        expect(JSON.stringify(messages)).toContain("server ready");
        return {
          toolCalls: [] as never[],
          toolResults: [] as never[],
          text: '{"type":"noop","payload":{"reason":"observed async output"}}',
        };
      });

    await ctx.run();

    expect(generate).toHaveBeenCalledTimes(2);
    expect(
      ctx.emitted
        .filter((event) => event.type === "message.created")
        .map((event) => event.payload?.text),
    ).toEqual(["started"]);
    expect(ctx.emitted.some((event) => event.type === "noop")).toBe(true);
  });
});
