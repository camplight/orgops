import { beforeEach, describe, expect, it } from "vitest";
import type { LlmMessage } from "@orgops/llm";
import {
  getCoreEventShapes,
  validateEventAgainstShapes,
} from "@orgops/schemas";
import { __resetRlmSessionsForTests, runRlmEvent } from "./rlm";
import type { Agent, Event } from "./types";

function makeAgent(name = "rlm-tester"): Agent {
  return {
    name,
    mode: "RLM_REPL",
    systemInstructions: "You are a test agent.",
    soulPath: "souls/test.md",
    workspacePath: "/tmp",
    modelId: "openai:gpt-4o-mini",
    desiredState: "RUNNING",
    runtimeState: "RUNNING",
  };
}

function makeEvent(id: string): Event {
  return {
    id,
    type: "message.created",
    source: "human:alice",
    channelId: "chan-1",
    payload: { text: "hello" },
  };
}

function makeExecuteContext(agent: Agent, event: Event) {
  return {
    agent,
    triggerEvent: event,
    channelId: event.channelId,
    injectionEnv: {},
    apiFetch: async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    emitEvent: async () => {},
    emitAudit: async () => {},
    listEventTypes: () => [],
    validateEvent: () => ({ ok: true as const, matchedDefinitions: 1 }),
  };
}

function parseDepthStep(messages: LlmMessage[]): {
  depth: number;
  step: number;
} {
  const lastUser = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  if (!lastUser) return { depth: 0, step: 1 };
  const parsed = JSON.parse(lastUser.content) as {
    depth?: number;
    step?: number;
  };
  return { depth: parsed.depth ?? 0, step: parsed.step ?? 1 };
}

describe("RLM mode", () => {
  beforeEach(() => {
    __resetRlmSessionsForTests();
  });

  it("accepts emitted audit.rlm events against core schemas", async () => {
    const agent = makeAgent("rlm-schema");
    const event = makeEvent("evt-schema");
    const emitted: Array<{ type: string; payload: unknown }> = [];
    const coreShapes = getCoreEventShapes();

    await runRlmEvent({
      agent,
      event,
      channelId: "chan-1",
      systemPrompt: "system",
      baseMessages: [],
      executeCtx: makeExecuteContext(agent, event),
      apiFetch: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      emitEvent: async (draft) => {
        const eventDraft = draft as {
          type: string;
          payload: unknown;
          source: string;
          channelId?: string;
        };
        const validation = validateEventAgainstShapes(eventDraft, coreShapes);
        if (!validation.ok) {
          throw new Error(`Validation failed for ${eventDraft.type}`);
        }
        emitted.push({ type: eventDraft.type, payload: eventDraft.payload });
      },
      generateFn: async () => ({ text: "done({ ok: true })" }),
    });

    expect(emitted.some((entry) => entry.type === "telemetry.rlm.repl_input")).toBe(
      true,
    );
    expect(
      emitted.some((entry) => entry.type === "telemetry.rlm.repl_output"),
    ).toBe(true);
    expect(emitted.some((entry) => entry.type === "telemetry.rlm.done")).toBe(true);
  });

  it("supports recursive subagent flow with done()", async () => {
    const agent = makeAgent("rlm-subagent");
    const event = makeEvent("evt-subagent");
    const emittedTypes: string[] = [];

    await runRlmEvent({
      agent,
      event,
      channelId: "chan-1",
      systemPrompt: "system",
      baseMessages: [],
      executeCtx: makeExecuteContext(agent, event),
      apiFetch: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      emitEvent: async (draft) => {
        emittedTypes.push((draft as { type: string }).type);
      },
      generateFn: async (_modelId, messages) => {
        const { depth, step } = parseDepthStep(messages);
        if (depth === 1) return { text: 'done("child-result")' };
        if (step === 1) {
          return {
            text: '(async () => { globalThis.child = await spawnSubagent("child prompt"); return globalThis.child; })()',
          };
        }
        return { text: "done({ child: globalThis.child })" };
      },
    });

    expect(emittedTypes).toContain("telemetry.rlm.subagent.started");
    expect(emittedTypes).toContain("telemetry.rlm.subagent.finished");
    expect(emittedTypes).toContain("telemetry.rlm.done");
  });

  it("persists root REPL context across events for same agent", async () => {
    const agent = makeAgent("rlm-persist");
    const firstEvent = makeEvent("evt-persist-1");
    const secondEvent = makeEvent("evt-persist-2");
    const donePayloads: unknown[] = [];

    await runRlmEvent({
      agent,
      event: firstEvent,
      channelId: "chan-1",
      systemPrompt: "system",
      baseMessages: [],
      executeCtx: makeExecuteContext(agent, firstEvent),
      apiFetch: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      emitEvent: async (draft) => {
        if ((draft as { type: string }).type === "telemetry.rlm.done") {
          donePayloads.push(
            (draft as { payload: { doneValue: string } }).payload.doneValue,
          );
        }
      },
      generateFn: async () => ({
        text: "globalThis.counter = (globalThis.counter ?? 0) + 1; done(globalThis.counter)",
      }),
    });

    await runRlmEvent({
      agent,
      event: secondEvent,
      channelId: "chan-1",
      systemPrompt: "system",
      baseMessages: [],
      executeCtx: makeExecuteContext(agent, secondEvent),
      apiFetch: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      emitEvent: async (draft) => {
        if ((draft as { type: string }).type === "telemetry.rlm.done") {
          donePayloads.push(
            (draft as { payload: { doneValue: string } }).payload.doneValue,
          );
        }
      },
      generateFn: async () => ({
        text: "done(globalThis.counter)",
      }),
    });

    expect(String(donePayloads[0])).toContain("1");
    expect(String(donePayloads[1])).toContain("1");
  });

  it("injects new pending channel events between RLM steps", async () => {
    const agent = makeAgent("rlm-inject");
    const event = makeEvent("evt-inject-root");
    let pendingPolled = 0;
    const executeCtx = {
      ...makeExecuteContext(agent, event),
      apiFetch: async (path: string) => {
        if (path.startsWith("/api/events?")) {
          pendingPolled += 1;
          if (pendingPolled === 1) {
            return new Response(
              JSON.stringify([
                {
                  id: "evt-injected",
                  type: "process.output",
                  source: "system:process-runner",
                  channelId: "chan-1",
                  payload: { text: "build running" },
                  createdAt: Date.now(),
                },
              ]),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              },
            );
          }
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    };

    await runRlmEvent({
      agent,
      event,
      channelId: "chan-1",
      systemPrompt: "system",
      baseMessages: [],
      executeCtx,
      apiFetch: executeCtx.apiFetch,
      emitEvent: async () => {},
      generateFn: async (_modelId, messages) => {
        const hasInjected = messages.some((message) =>
          message.content.includes('"type": "process.output"'),
        );
        if (hasInjected) {
          return { text: "done({ injected: true })" };
        }
        return { text: "globalThis.step = (globalThis.step ?? 0) + 1" };
      },
    });

    expect(pendingPolled).toBeGreaterThanOrEqual(1);
  });

  it("auto-emits done(eventDraft) when validation passes", async () => {
    const agent = makeAgent("rlm-done-emit");
    const event = makeEvent("evt-done-emit");
    const emitted: Array<{ type: string; source?: string; channelId?: string }> = [];
    const apiFetch = async (path: string) => {
      if (path === "/api/channels") {
        return new Response(
          JSON.stringify([
            {
              id: "chan-1",
              participants: [{ subscriberType: "AGENT", subscriberId: agent.name }],
            },
          ]),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const executeCtx = {
      ...makeExecuteContext(agent, event),
      apiFetch,
    };

    await runRlmEvent({
      agent,
      event,
      channelId: "chan-1",
      systemPrompt: "system",
      baseMessages: [],
      executeCtx,
      apiFetch,
      emitEvent: async (draft) => {
        const eventDraft = draft as {
          type: string;
          source?: string;
          channelId?: string;
        };
        emitted.push(eventDraft);
      },
      generateFn: async () => ({
        text: 'done({ type: "message.created", payload: { text: "hello from done" } })',
      }),
    });

    expect(
      emitted.some(
        (entry) =>
          entry.type === "message.created" &&
          entry.source === `agent:${agent.name}` &&
          entry.channelId === "chan-1",
      ),
    ).toBe(true);
  });

  it("returns descriptive validation error when done(eventDraft) is invalid", async () => {
    const agent = makeAgent("rlm-done-validation");
    const event = makeEvent("evt-done-validation");
    const emittedTypes: string[] = [];
    const doneErrorMessages: string[] = [];
    let messageCreatedValidationAttempts = 0;
    const apiFetch = async (path: string) => {
      if (path === "/api/channels") {
        return new Response(
          JSON.stringify([
            {
              id: "chan-1",
              participants: [{ subscriberType: "AGENT", subscriberId: agent.name }],
            },
          ]),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const executeCtx = {
      ...makeExecuteContext(agent, event),
      apiFetch,
      validateEvent: (draft: {
        type: string;
        payload: unknown;
        source: string;
        channelId?: string;
        parentEventId?: string;
        deliverAt?: number;
        idempotencyKey?: string;
      }) => {
        if (draft.type === "message.created") {
          messageCreatedValidationAttempts += 1;
          if (messageCreatedValidationAttempts > 1) {
            return { ok: true as const, matchedDefinitions: 1 };
          }
          return {
            ok: false as const,
            type: draft.type,
            matchedDefinitions: 1,
            issues: [{ source: "core", message: "payload.text is required" }],
          };
        }
        return { ok: true as const, matchedDefinitions: 1 };
      },
    };

    await runRlmEvent({
      agent,
      event,
      channelId: "chan-1",
      systemPrompt: "system",
      baseMessages: [],
      executeCtx,
      apiFetch,
      emitEvent: async (draft) => {
        const eventDraft = draft as {
          type: string;
          payload?: { error?: string };
        };
        emittedTypes.push(eventDraft.type);
        if (
          eventDraft.type === "telemetry.rlm.done_validation_error" &&
          typeof eventDraft.payload?.error === "string"
        ) {
          doneErrorMessages.push(eventDraft.payload.error);
        }
      },
      generateFn: async (_modelId, messages) => {
        const hasDoneValidationError = messages.some((message) =>
          message.content.includes('"type": "rlm.done.validation_error"'),
        );
        if (hasDoneValidationError) {
          return {
            text: 'done({ type: "message.created", payload: { text: "fixed after validation error" } })',
          };
        }
        return { text: 'done({ type: "message.created", payload: {} })' };
      },
    });

    expect(emittedTypes).toContain("telemetry.rlm.done_validation_error");
    expect(doneErrorMessages.some((message) => message.includes("payload.text is required"))).toBe(
      true,
    );
    expect(emittedTypes).toContain("message.created");
  });
});
