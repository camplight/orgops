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

function setup(
  options: {
    pendingEventBatches?: Event[][];
    source?: string;
    agentOverrides?: Partial<Agent>;
    trigger?: Partial<Event>;
    events?: Event[];
  } = {},
) {
  const emitted: Array<{
    type?: string;
    payload?: Record<string, unknown>;
    idempotencyKey?: string;
    deliverAt?: number;
  }> = [];
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
    run: () =>
      execute(
        { ...agent, ...options.agentOverrides },
        options.events ?? [
          {
            ...trigger,
            ...options.trigger,
            source: options.source ?? options.trigger?.source ?? trigger.source,
          },
        ],
      ),
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
  it("posts an incomplete-work notice for a human tool-only turn without a transcript", async () => {
    const ctx = setup();
    vi.mocked(generate).mockResolvedValue({
      text: "",
      toolCalls: [{ toolName: "shell_run" }],
      toolResults: [{ toolName: "shell_run" }],
      finishReason: "tool-calls",
    });
    await ctx.run();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(ctx.emitted.filter((event) => event.type === "message.created")).toHaveLength(1);
    expect(ctx.emitted.find((event) => event.type === "message.created")?.payload?.text).toContain("may be incomplete");
    expect(ctx.emitted.find((event) => event.type === "agent.turn.completed")?.payload).toMatchObject({
      completedWithFallback: true,
    });
  });

  it("starts future prompt history at a compacted whole-channel boundary", async () => {
    const compactMarker: Event = {
      id: "compact-1",
      type: "agent.context.compacted",
      source: "agent:tester",
      channelId: "chat",
      payload: {
        targetAgentName: "tester",
        summary: "Preserved whole-channel memory.",
        cutoffAt: 100,
      },
      createdAt: 150,
    };
    const postCutEvent: Event = {
      id: "after-cut",
      type: "message.created",
      source: "human:test",
      channelId: "chat",
      payload: { text: "Visible after cut" },
      createdAt: 200,
    };
    const ctx = setup({
      agentOverrides: { memoryContextMode: "FULL_CHANNEL_EVENTS" },
      pendingEventBatches: [[compactMarker], [postCutEvent], []],
    });
    vi.mocked(generate).mockImplementationOnce(async (_model, messages) => {
      const serialized = JSON.stringify(messages);
      expect(serialized).toContain("Preserved whole-channel memory.");
      expect(serialized).toContain("Visible after cut");
      expect(serialized).not.toContain("invisible old history");
      return {
        toolCalls: [] as never[],
        toolResults: [] as never[],
        text: '{"turnStatus":"DONE","type":"noop","payload":{}}',
      };
    });
    await ctx.run();
    expect(
      ctx.apiFetch.mock.calls.some(([path]) =>
        String(path).includes("after=100"),
      ),
    ).toBe(true);
  });

  it("posts a completion fallback when the model never returns the contract", async () => {
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
    expect(messages).toHaveLength(1);
    expect(messages[0]?.payload?.text).toContain("without confirming");
    expect(
      ctx.emitted.find(
        (event) =>
          event.type === "agent.turn.phase" &&
          event.payload?.phase === "turn.completion_error",
      )?.payload?.detail,
    ).toContain("may be incomplete");
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
          text: '{"turnStatus":"DONE","type":"message.created","payload":"bad"}',
        };
      })
      .mockImplementationOnce(async (_model, messages, options) => {
        expect(JSON.stringify(messages)).toContain("completion event failed validation");
        await emit(options?.tools, "no", { stageUntilTurnSettled: true });
        return {
          toolCalls: [] as never[],
          toolResults: [] as never[],
          text: '{"turnStatus":"DONE","type":"noop","payload":{}}',
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
      return { toolCalls: [] as never[], toolResults: [] as never[], text: '{"turnStatus":"DONE","type":"noop","payload":{}}' };
    });
    await ctx.run();
    expect(generate).toHaveBeenCalledTimes(1);
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
        text: '{"turnStatus":"DONE","type":"noop","payload":{}}',
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
        text: '{"turnStatus":"DONE","type":"message.created","payload":{"text":"first answer"}}',
      })
      .mockImplementationOnce(async (_model, messages) => {
        const serialized = JSON.stringify(messages);
        expect(serialized).toContain("system.turn.events_posted");
        expect(serialized).toContain("also answer this");
        return {
          toolCalls: [] as never[],
          toolResults: [] as never[],
          text: '{"turnStatus":"DONE","type":"message.created","payload":{"text":"second answer"}}',
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
      ctx.emitted
        .filter((event) => event.type === "message.created")
        .map((event) => event.idempotencyKey),
    ).toEqual([
      "turn:tester:trigger:completion:0",
      "turn:tester:trigger:completion:1",
    ]);
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
      text: '{"turnStatus":"DONE","type":"message.created","payload":{"text":"answer survives"}}',
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
        text: '{"turnStatus":"DONE","type":"message.created","payload":{"text":"started"}}',
      })
      .mockImplementationOnce(async (_model, messages) => {
        expect(JSON.stringify(messages)).toContain("server ready");
        return {
          toolCalls: [] as never[],
          toolResults: [] as never[],
          text: '{"turnStatus":"DONE","type":"noop","payload":{"reason":"observed async output"}}',
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

describe("CLASSIC turn completion contract", () => {
  it("accepts a terminal tool call and posts only its user-facing message", async () => {
    const ctx = setup();
    vi.mocked(generate).mockImplementationOnce(async (_model, _messages, options) => {
      expect(options?.tools?.turn_finish).toBeDefined();
      expect(options?.tools?.turn_finish.execute).toBeUndefined();
      return {
        text: "",
        toolCalls: [
          {
            toolName: "turn_finish",
            input: { status: "DONE", message: "The report is complete." },
          },
        ],
        toolResults: [],
        finishReason: "tool-calls",
      };
    });

    await ctx.run();

    expect(generate).toHaveBeenCalledTimes(1);
    expect(
      ctx.emitted
        .filter((event) => event.type === "message.created")
        .map((event) => event.payload?.text),
    ).toEqual(["The report is complete."]);
    expect(
      ctx.emitted.find((event) => event.type === "agent.turn.completed")?.payload,
    ).toMatchObject({ turnStatus: "DONE" });
  });

  it("corrects an invalid terminal tool call before closing", async () => {
    const ctx = setup();
    vi.mocked(generate)
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [{ toolName: "turn_finish", input: { status: "DONE" } }],
        toolResults: [],
        finishReason: "tool-calls",
      })
      .mockImplementationOnce(async (_model, messages) => {
        expect(JSON.stringify(messages)).toContain("turn_finish call was invalid");
        return {
          text: "",
          toolCalls: [
            {
              toolName: "turn_finish",
              input: { status: "DONE", message: "Finished after correction." },
            },
          ],
          toolResults: [],
          finishReason: "tool-calls",
        };
      });

    await ctx.run();

    expect(generate).toHaveBeenCalledTimes(2);
    expect(
      ctx.emitted.find((event) => event.type === "message.created")?.payload?.text,
    ).toBe("Finished after correction.");
  });

  it("withholds a plain-text CONTINUE message and keeps the same turn running", async () => {
    const ctx = setup({
      agentOverrides: { modelCapabilities: { replyContract: "plain-text" } },
    });
    vi.mocked(generate)
      .mockResolvedValueOnce({
        text: "I will continue now.\nORGOPS_TURN_STATUS: CONTINUE",
        toolCalls: [],
        toolResults: [],
        finishReason: "stop",
      })
      .mockImplementationOnce(async (_model, messages) => {
        expect(JSON.stringify(messages)).toContain("requested CONTINUE");
        expect(JSON.stringify(messages)).toContain("I will continue now.");
        return {
          text: "The report is complete.\nORGOPS_TURN_STATUS: DONE",
          toolCalls: [],
          toolResults: [],
          finishReason: "stop",
        };
      });

    await ctx.run();

    expect(generate).toHaveBeenCalledTimes(2);
    expect(
      ctx.emitted
        .filter((event) => event.type === "message.created")
        .map((event) => event.payload?.text),
    ).toEqual(["The report is complete."]);
  });

  it("does not publish an unmarked promise to continue as a completed reply", async () => {
    const ctx = setup({
      agentOverrides: { modelCapabilities: { replyContract: "plain-text" } },
    });
    vi.mocked(generate).mockResolvedValue({
      text: "I will continue with the remaining work next.",
      toolCalls: [],
      toolResults: [],
      finishReason: "stop",
    });

    await ctx.run();

    expect(generate).toHaveBeenCalledTimes(3);
    expect(
      ctx.emitted
        .filter((event) => event.type === "message.created")
        .map((event) => event.payload?.text),
    ).toEqual([
      "I stopped without confirming whether the requested work was completed. The work may be incomplete; please ask me to continue.",
    ]);
  });

  it("schedules a bounded self-trigger for RETRY_LATER", async () => {
    const before = Date.now();
    const ctx = setup();
    vi.mocked(generate).mockResolvedValueOnce({
      text: "",
      toolCalls: [
        {
          toolName: "turn_finish",
          input: {
            status: "RETRY_LATER",
            message: "Sheets is rate-limited; I will retry shortly.",
            retryAfterSeconds: 30,
          },
        },
      ],
      toolResults: [],
      finishReason: "tool-calls",
    });

    await ctx.run();

    const scheduled = ctx.emitted.find(
      (event) => event.type === "agent.scheduled.trigger",
    ) as
      | {
          deliverAt?: number;
          payload?: Record<string, unknown>;
        }
      | undefined;
    expect(scheduled?.deliverAt).toBeGreaterThanOrEqual(before + 30_000);
    expect(scheduled?.payload).toMatchObject({
      targetAgentName: "tester",
      turnCompletionAttempt: 1,
    });
    expect(
      ctx.emitted.find((event) => event.type === "agent.turn.completed")?.payload,
    ).toMatchObject({
      scheduledContinuation: true,
      retryAfterSeconds: 30,
    });
  });

  it("reconciles late events before scheduling RETRY_LATER", async () => {
    const lateEvent: Event = {
      id: "late-human",
      type: "message.created",
      source: "human:test",
      channelId: "chat",
      payload: { text: "Use the cached export instead." },
      createdAt: 2,
    };
    const ctx = setup({ pendingEventBatches: [[lateEvent], []] });
    vi.mocked(generate)
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          {
            toolName: "turn_finish",
            input: {
              status: "RETRY_LATER",
              message: "Sheets is rate-limited; I will retry shortly.",
              retryAfterSeconds: 30,
            },
          },
        ],
        toolResults: [],
        finishReason: "tool-calls",
      })
      .mockImplementationOnce(async (_model, messages) => {
        expect(JSON.stringify(messages)).toContain("Use the cached export instead.");
        return {
          text: "",
          toolCalls: [
            {
              toolName: "turn_finish",
              input: { status: "DONE", message: "Used the cached export." },
            },
          ],
          toolResults: [],
          finishReason: "tool-calls",
        };
      });

    await ctx.run();

    expect(generate).toHaveBeenCalledTimes(2);
    expect(
      ctx.emitted.filter((event) => event.type === "agent.scheduled.trigger"),
    ).toHaveLength(0);
    expect(
      ctx.emitted
        .filter((event) => event.type === "message.created")
        .map((event) => event.payload?.text),
    ).toEqual([
      "Sheets is rate-limited; I will retry shortly.",
      "Used the cached export.",
    ]);
  });

  it("keeps trusted retry bounds when a newer human event shares the batch", async () => {
    const scheduled: Event = {
      id: "scheduled-retry",
      type: "agent.scheduled.trigger",
      source: "system:scheduler",
      channelId: "chat",
      payload: {
        text: "resume",
        targetAgentName: "tester",
        turnCompletionAttempt: 2,
        originalTriggerEventId: "root-trigger",
      },
      createdAt: 1,
    };
    const newerHuman: Event = {
      id: "newer-human",
      type: "message.created",
      source: "human:test",
      channelId: "chat",
      payload: { text: "Also check this.", turnCompletionAttempt: 3 },
      createdAt: 2,
    };
    const ctx = setup({ events: [scheduled, newerHuman] });
    vi.mocked(generate).mockResolvedValueOnce({
      text: "",
      toolCalls: [
        {
          toolName: "turn_finish",
          input: { status: "RETRY_LATER", retryAfterSeconds: 30 },
        },
      ],
      toolResults: [],
      finishReason: "tool-calls",
    });

    await ctx.run();

    const retry = ctx.emitted.find(
      (event) => event.type === "agent.scheduled.trigger",
    );
    expect(retry?.payload).toMatchObject({
      turnCompletionAttempt: 3,
      originalTriggerEventId: "root-trigger",
    });
  });

  it("does not schedule beyond the continuation limit", async () => {
    const ctx = setup({
      source: "system:scheduler",
      trigger: {
        type: "agent.scheduled.trigger",
        payload: {
          text: "resume",
          targetAgentName: "tester",
          turnCompletionAttempt: 3,
        },
      },
    });
    vi.mocked(generate).mockResolvedValueOnce({
      text: "",
      toolCalls: [
        {
          toolName: "turn_finish",
          input: { status: "RETRY_LATER", retryAfterSeconds: 30 },
        },
      ],
      toolResults: [],
      finishReason: "tool-calls",
    });

    await ctx.run();

    expect(
      ctx.emitted.filter((event) => event.type === "agent.scheduled.trigger"),
    ).toHaveLength(0);
    expect(
      ctx.emitted.find((event) => event.type === "message.created")?.payload?.text,
    ).toContain("remains incomplete");
  });
});


describe("human tool-only final summaries", () => {
  const exhausted = {
    text: "", finishReason: "tool-calls",
    toolCalls: [{toolName: "shell_run"}],
    responseMessages: [{role: "assistant" as const, content: "Retrieved interview notes, but analysis is unfinished."}],
  };
  it("makes one tool-free summary call with the completed tool history", async () => {
    const ctx = setup();
    vi.mocked(generate).mockResolvedValueOnce(exhausted).mockResolvedValueOnce({text: "I retrieved the notes; analysis remains incomplete."});
    await ctx.run();
    expect(generate).toHaveBeenCalledTimes(2);
    const [, messages, options] = vi.mocked(generate).mock.calls[1];
    expect(messages).toContainEqual(exhausted.responseMessages[0]);
    expect(options?.tools).toBeUndefined();
    expect(options?.maxSteps).toBe(1);
    expect(options?.abortSignal).toBeDefined();
    const replies = ctx.emitted.filter(event => event.type === "message.created");
    expect(replies).toHaveLength(1);
    expect(replies[0].payload?.text).toContain("analysis remains incomplete");
  });
  it.each(["empty", "error", "structured"])("posts a notice when the summary is %s", async failure => {
    const ctx = setup();
    vi.mocked(generate).mockResolvedValueOnce(exhausted);
    if (failure === "error") vi.mocked(generate).mockRejectedValueOnce(new Error("provider failed"));
    else vi.mocked(generate).mockResolvedValueOnce({text: failure === "empty" ? "" : '{"type":"noop"}'});
    await ctx.run();
    expect(generate).toHaveBeenCalledTimes(2);
    const replies = ctx.emitted.filter(event => event.type === "message.created");
    expect(replies).toHaveLength(1);
    expect(replies[0].payload?.text).toContain("may be incomplete");
  });
  it("bounds a hanging summary and posts one notice", async () => {
    vi.useFakeTimers();
    try {
      const ctx = setup();
      vi.mocked(generate).mockResolvedValueOnce(exhausted).mockImplementationOnce(() => new Promise(() => {}));
      const run = ctx.run();
      await vi.advanceTimersByTimeAsync(10_001);
      await run;
      expect(generate).toHaveBeenCalledTimes(2);
      const replies = ctx.emitted.filter(event => event.type === "message.created");
      expect(replies).toHaveLength(1);
      expect(replies[0].payload?.text).toContain("may be incomplete");
    } finally { vi.useRealTimers(); }
  });

  it("preserves explicit no-reply calls", async () => {
    const ctx = setup();
    vi.mocked(generate).mockResolvedValueOnce({...exhausted,toolCalls:[{toolName:"noop"}]});
    await ctx.run();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(ctx.emitted.filter(event=>event.type === "message.created")).toHaveLength(0);
  });

  it("keeps non-human tool-only turns silent", async () => {
    const ctx = setup({source:"system:timer"});
    vi.mocked(generate).mockResolvedValueOnce(exhausted);
    await ctx.run();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(ctx.emitted.filter(event=>event.type === "message.created")).toHaveLength(0);
  });
});
