import { describe, expect, it } from "vitest";
import { createRunnerTools } from "./tools";
import { executeTool } from "./tools";
import {
  buildModelMessages,
  resolveAgentClassicMaxModelSteps,
  resolveAgentLlmCallTimeoutMs,
  shouldHandleEvent,
} from "./runner";
import { stopAllRunningProcesses } from "./tools/proc";
import type { Agent, Event } from "./types";

describe("agent runner", () => {
  it("exposes runner tools for LLM", () => {
    const tools = createRunnerTools({
      agent: {
        name: "tester",
        systemInstructions: "",
        soulPath: "",
        workspacePath: "/tmp",
        modelId: "openai:gpt-4o-mini",
        desiredState: "RUNNING",
        runtimeState: "RUNNING",
      },
      event: {
        id: "evt-1",
        type: "message.created",
        payload: {},
        source: "test",
      },
      channelId: "chan-1",
      runTool: async () => ({ ok: true }),
      apiFetch: async () => new Response(),
      emitEvent: async () => {},
    });
    expect(Object.keys(tools).length).toBeGreaterThan(0);
    expect(Object.keys(tools)).toContain("shell_run");
  });

  it("builds model messages from all channel events", () => {
    const agent: Agent = {
      name: "tester",
      systemInstructions: "",
      soulPath: "",
      workspacePath: "/tmp",
      modelId: "openai:gpt-4o-mini",
      desiredState: "RUNNING",
      runtimeState: "RUNNING",
    };
    const events: Event[] = [
      {
        id: "evt-1",
        type: "message.created",
        payload: { text: "hello" },
        source: "human:alice",
        channelId: "chan-1",
      },
      {
        id: "evt-2",
        type: "audit.tool.executed",
        payload: { tool: "shell_run" },
        source: "agent:tester",
        channelId: "chan-1",
      },
      {
        id: "evt-3",
        type: "message.created",
        payload: { text: "result" },
        source: "agent:other",
        channelId: "chan-1",
      },
    ];

    const messages = buildModelMessages(agent, "system prompt", events);
    expect(messages).toHaveLength(4);
    expect(messages[0]).toEqual({ role: "system", content: "system prompt" });
    expect(messages[1]?.role).toBe("user");
    expect(messages[2]?.role).toBe("assistant");
    expect(messages[3]?.role).toBe("user");

    const eventIds = messages
      .slice(1)
      .map((message) => JSON.parse(message.content as string).eventId);
    expect(eventIds).toEqual(["evt-1", "evt-2", "evt-3"]);
  });

  it("resolves per-agent timeout and model-step overrides with sane defaults", () => {
    const baseAgent: Agent = {
      name: "tester",
      systemInstructions: "",
      soulPath: "",
      workspacePath: "/tmp",
      modelId: "openai:gpt-4o-mini",
      desiredState: "RUNNING",
      runtimeState: "RUNNING",
    };

    expect(resolveAgentLlmCallTimeoutMs(baseAgent)).toBe(90000);
    expect(resolveAgentClassicMaxModelSteps(baseAgent)).toBe(100);

    expect(
      resolveAgentLlmCallTimeoutMs({ ...baseAgent, llmCallTimeoutMs: 180_000 }),
    ).toBe(180000);
    expect(
      resolveAgentClassicMaxModelSteps({
        ...baseAgent,
        classicMaxModelSteps: 250,
      }),
    ).toBe(250);

    expect(
      resolveAgentLlmCallTimeoutMs({ ...baseAgent, llmCallTimeoutMs: 0 }),
    ).toBe(90000);
    expect(
      resolveAgentClassicMaxModelSteps({
        ...baseAgent,
        classicMaxModelSteps: -1,
      }),
    ).toBe(100);
  });

  it("truncates oversized history to stay within model budget", () => {
    const agent: Agent = {
      name: "tester",
      systemInstructions: "",
      soulPath: "",
      workspacePath: "/tmp",
      modelId: "openai:gpt-4o-mini",
      desiredState: "RUNNING",
      runtimeState: "RUNNING",
    };
    const events: Event[] = Array.from({ length: 130 }, (_, index) => ({
      id: `evt-${index + 1}`,
      type: "message.created",
      payload: { text: `msg-${index + 1}` },
      source: "human:alice",
      channelId: "chan-1",
    }));

    const messages = buildModelMessages(agent, "system prompt", events);
    expect(messages[0]).toEqual({ role: "system", content: "system prompt" });
    expect(messages[1]?.role).toBe("user");
    const truncationMeta = JSON.parse(String(messages[1]?.content));
    expect(truncationMeta.type).toBe("system.history.truncated");
    expect(truncationMeta.omittedCount).toBeGreaterThan(0);
    expect(truncationMeta.includedCount).toBeLessThan(events.length);
    const eventIds = messages
      .slice(2)
      .map((message) => JSON.parse(message.content as string).eventId);
    expect(eventIds[0]).toBe("evt-11");
    expect(eventIds[eventIds.length - 1]).toBe("evt-130");
  });

  it("keeps newest events when history arrives newest-first", () => {
    const agent: Agent = {
      name: "tester",
      systemInstructions: "",
      soulPath: "",
      workspacePath: "/tmp",
      modelId: "openai:gpt-4o-mini",
      desiredState: "RUNNING",
      runtimeState: "RUNNING",
    };
    const eventsNewestFirst: Event[] = Array.from({ length: 130 }, (_, index) => ({
      id: `evt-${index + 1}`,
      type: "message.created",
      payload: { text: `msg-${index + 1}` },
      source: "human:alice",
      channelId: "chan-1",
      createdAt: index + 1,
    })).reverse();

    const messages = buildModelMessages(agent, "system prompt", eventsNewestFirst);
    expect(messages[0]).toEqual({ role: "system", content: "system prompt" });
    expect(messages[1]?.role).toBe("user");
    const truncationMeta = JSON.parse(String(messages[1]?.content));
    expect(truncationMeta.type).toBe("system.history.truncated");
    const eventIds = messages
      .slice(2)
      .map((message) => JSON.parse(message.content as string).eventId);
    expect(eventIds[0]).toBe("evt-11");
    expect(eventIds[eventIds.length - 1]).toBe("evt-130");
  });

  it("does not keep tool result when matching start is truncated", () => {
    const agent: Agent = {
      name: "tester",
      systemInstructions: "",
      soulPath: "",
      workspacePath: "/tmp",
      modelId: "openai:gpt-4o-mini",
      desiredState: "RUNNING",
      runtimeState: "RUNNING",
    };
    const events: Event[] = Array.from({ length: 130 }, (_, index) => ({
      id: `evt-${index + 1}`,
      type: "message.created",
      payload: { text: `msg-${index + 1}` },
      source: "human:alice",
      channelId: "chan-1",
      createdAt: index + 1,
    }));
    events[9] = {
      id: "evt-10",
      type: "audit.tool.started",
      payload: { tool: "shell_run", args: { cmd: "echo hi" } },
      source: "agent:tester",
      channelId: "chan-1",
      createdAt: 10,
    };
    events[10] = {
      id: "evt-11",
      type: "audit.tool.executed",
      payload: { tool: "shell_run", output: { ok: true } },
      source: "agent:tester",
      channelId: "chan-1",
      createdAt: 11,
    };

    const messages = buildModelMessages(agent, "system prompt", events);
    const eventIds = messages
      .slice(2)
      .map((message) => JSON.parse(message.content as string).eventId);
    expect(eventIds).not.toContain("evt-11");
    expect(eventIds[0]).toBe("evt-12");
    expect(eventIds[eventIds.length - 1]).toBe("evt-130");
  });

  it("does not keep failed tool result when matching start is truncated", () => {
    const agent: Agent = {
      name: "tester",
      systemInstructions: "",
      soulPath: "",
      workspacePath: "/tmp",
      modelId: "openai:gpt-4o-mini",
      desiredState: "RUNNING",
      runtimeState: "RUNNING",
    };
    const events: Event[] = Array.from({ length: 130 }, (_, index) => ({
      id: `evt-${index + 1}`,
      type: "message.created",
      payload: { text: `msg-${index + 1}` },
      source: "human:alice",
      channelId: "chan-1",
      createdAt: index + 1,
    }));
    events[9] = {
      id: "evt-10",
      type: "audit.tool.started",
      payload: { tool: "proc_start", args: { cmd: "bad" } },
      source: "agent:tester",
      channelId: "chan-1",
      createdAt: 10,
    };
    events[10] = {
      id: "evt-11",
      type: "audit.tool.failed",
      payload: { tool: "proc_start", error: "boom" },
      source: "agent:tester",
      channelId: "chan-1",
      createdAt: 11,
    };

    const messages = buildModelMessages(agent, "system prompt", events);
    const eventIds = messages
      .slice(2)
      .map((message) => JSON.parse(message.content as string).eventId);
    expect(eventIds).not.toContain("evt-11");
    expect(eventIds[0]).toBe("evt-12");
    expect(eventIds[eventIds.length - 1]).toBe("evt-130");
  });

  it("filters control/audit/self but accepts other agent channel events", async () => {
    const agent: Agent = {
      name: "tester",
      systemInstructions: "",
      soulPath: "",
      workspacePath: "/tmp",
      modelId: "openai:gpt-4o-mini",
      desiredState: "RUNNING",
      runtimeState: "RUNNING",
    };

    const controlEvent: Event = {
      id: "evt-control",
      type: "agent.control.start",
      payload: {},
      source: "system",
    };
    const auditEvent: Event = {
      id: "evt-audit",
      type: "audit.response.skipped",
      payload: { reason: "agent_requested_no_reply" },
      source: "agent:coordinator",
      channelId: "chan-1",
    };
    const channelCommandEvent: Event = {
      id: "evt-command",
      type: "channel.command.succeeded",
      payload: { command: { action: "chat.postMessage" } },
      source: "channel:slack:coordinator",
      channelId: "chan-1",
    };
    const channelCommandRequestedEvent: Event = {
      id: "evt-command-requested",
      type: "channel.command.requested",
      payload: { command: { action: "chat.postMessage" } },
      source: "agent:tester",
      channelId: "chan-1",
    };
    const ownEvent: Event = {
      id: "evt-own",
      type: "message.created",
      payload: { text: "self" },
      source: "agent:tester",
    };
    const processOutputEvent: Event = {
      id: "evt-process-output",
      type: "process.output",
      payload: { processId: "proc-1", stream: "STDOUT", text: "build..." },
      source: "system:process-runner",
      channelId: "chan-1",
    };
    const processStartedEvent: Event = {
      id: "evt-process-started",
      type: "process.started",
      payload: { processId: "proc-1", cmd: "sleep 1" },
      source: "system:process-runner",
      channelId: "chan-1",
    };
    const processExitedEvent: Event = {
      id: "evt-process-exited",
      type: "process.exited",
      payload: { processId: "proc-1", exitCode: 0 },
      source: "system:process-runner",
      channelId: "chan-1",
    };
    const noopEvent: Event = {
      id: "evt-noop",
      type: "noop",
      payload: { reason: "waiting_for_mention" },
      source: "agent:coordinator",
      channelId: "chan-1",
    };
    const userEvent: Event = {
      id: "evt-user",
      type: "message.created",
      payload: { text: "hello" },
      source: "human:alice",
      channelId: "chan-1",
    };
    const otherAgentChannelEvent: Event = {
      id: "evt-agent-channel",
      type: "message.created",
      payload: { text: "agent chatter" },
      source: "agent:coordinator",
      channelId: "chan-1",
    };
    const addressedByMention: Event = {
      id: "evt-mention",
      type: "message.created",
      payload: { text: "@tester please take this task" },
      source: "agent:coordinator",
      channelId: "chan-1",
    };
    const agentThreadReply: Event = {
      id: "evt-thread-reply",
      type: "message.created",
      payload: { text: "done", inReplyTo: "evt-user" },
      source: "agent:coordinator",
      channelId: "chan-1",
      parentEventId: "evt-user",
    };
    const highHopCount: Event = {
      id: "evt-hop",
      type: "message.created",
      payload: { text: "@tester continue", hopCount: 3 },
      source: "agent:coordinator",
      channelId: "chan-1",
    };
    const targetedToOtherAgent: Event = {
      id: "evt-target-other",
      type: "agent.scheduled.trigger",
      payload: { text: "run later", targetAgentName: "worker1" },
      source: "system:scheduler",
      channelId: "chan-1",
    };
    const targetedToThisAgent: Event = {
      id: "evt-target-this",
      type: "agent.scheduled.trigger",
      payload: { text: "run later", targetAgentName: "tester" },
      source: "system:scheduler",
      channelId: "chan-1",
    };

    expect(await shouldHandleEvent(agent, controlEvent)).toBe(false);
    expect(await shouldHandleEvent(agent, auditEvent)).toBe(false);
    expect(await shouldHandleEvent(agent, channelCommandEvent)).toBe(true);
    expect(await shouldHandleEvent(agent, channelCommandRequestedEvent)).toBe(false);
    expect(await shouldHandleEvent(agent, ownEvent)).toBe(false);
    expect(await shouldHandleEvent(agent, processStartedEvent)).toBe(true);
    expect(await shouldHandleEvent(agent, processOutputEvent)).toBe(true);
    expect(await shouldHandleEvent(agent, processExitedEvent)).toBe(true);
    expect(await shouldHandleEvent(agent, noopEvent)).toBe(false);
    expect(await shouldHandleEvent(agent, otherAgentChannelEvent)).toBe(true);
    expect(await shouldHandleEvent(agent, addressedByMention)).toBe(true);
    expect(await shouldHandleEvent(agent, agentThreadReply)).toBe(true);
    expect(await shouldHandleEvent(agent, highHopCount)).toBe(true);
    expect(await shouldHandleEvent(agent, targetedToOtherAgent)).toBe(false);
    expect(await shouldHandleEvent(agent, targetedToThisAgent)).toBe(true);
    expect(await shouldHandleEvent(agent, userEvent)).toBe(true);
  });

  it("schedules internal self trigger event instead of visible message", async () => {
    const requests: Array<{ path: string; body: any }> = [];
    const before = Date.now();
    const ctx = {
      agent: {
        name: "tester",
        systemInstructions: "",
        soulPath: "",
        workspacePath: "/tmp",
        modelId: "openai:gpt-4o-mini",
        desiredState: "RUNNING",
        runtimeState: "RUNNING",
      },
      triggerEvent: {
        id: "evt-trigger",
        type: "message.created",
        payload: { text: "hello" },
        source: "human:alice",
        channelId: "chan-1",
      },
      channelId: "chan-1",
      injectionEnv: {},
      apiFetch: async (path: string, init?: RequestInit) => {
        if (path === "/api/channels") {
          return new Response(
            JSON.stringify([
              {
                id: "chan-1",
                participants: [{ subscriberType: "AGENT", subscriberId: "tester" }],
              },
            ]),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }
        requests.push({
          path,
          body: JSON.parse(String(init?.body ?? "{}")),
        });
        return new Response(JSON.stringify({ id: "evt-scheduled" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      },
      emitEvent: async () => {},
      emitAudit: async () => {},
    };

    await executeTool(ctx, "events_schedule_self", {
      text: "remind me",
      delaySeconds: 30,
    });

    const after = Date.now();
    expect(requests.length).toBe(1);
    expect(requests[0]?.path).toBe("/api/events");
    expect(requests[0]?.body.type).toBe("agent.scheduled.trigger");
    expect(requests[0]?.body.source).toBe("system:scheduler");
    expect(requests[0]?.body.channelId).toBe("chan-1");
    expect(requests[0]?.body.payload?.text).toBe("remind me");
    expect(requests[0]?.body.payload?.targetAgentName).toBe("tester");
    expect(requests[0]?.body.deliverAt).toBeGreaterThanOrEqual(before + 30_000);
    expect(requests[0]?.body.deliverAt).toBeLessThanOrEqual(after + 30_000);
  });

  it("allows zero-delay scheduling for immediate trigger", async () => {
    const requests: Array<{ path: string; body: any }> = [];
    const before = Date.now();
    const ctx = {
      agent: {
        name: "tester",
        systemInstructions: "",
        soulPath: "",
        workspacePath: "/tmp",
        modelId: "openai:gpt-4o-mini",
        desiredState: "RUNNING",
        runtimeState: "RUNNING",
      },
      triggerEvent: {
        id: "evt-trigger",
        type: "message.created",
        payload: { text: "hello" },
        source: "human:alice",
        channelId: "chan-1",
      },
      channelId: "chan-1",
      injectionEnv: {},
      apiFetch: async (path: string, init?: RequestInit) => {
        if (path === "/api/channels") {
          return new Response(
            JSON.stringify([
              {
                id: "chan-1",
                participants: [{ subscriberType: "AGENT", subscriberId: "tester" }],
              },
            ]),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }
        requests.push({
          path,
          body: JSON.parse(String(init?.body ?? "{}")),
        });
        return new Response(JSON.stringify({ id: "evt-scheduled" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      },
      emitEvent: async () => {},
      emitAudit: async () => {},
    };

    await executeTool(ctx, "events_schedule_self", {
      text: "run now",
      delaySeconds: 0,
    });

    const after = Date.now();
    expect(requests.length).toBe(1);
    expect(requests[0]?.path).toBe("/api/events");
    expect(requests[0]?.body.type).toBe("agent.scheduled.trigger");
    expect(requests[0]?.body.deliverAt).toBeGreaterThanOrEqual(before);
    expect(requests[0]?.body.deliverAt).toBeLessThanOrEqual(after);
  });

  it("schedules trigger events for other agents via events_scheduled_create", async () => {
    const requests: Array<{ path: string; body: any }> = [];
    const before = Date.now();
    const ctx = {
      agent: {
        name: "tester",
        systemInstructions: "",
        soulPath: "",
        workspacePath: "/tmp",
        modelId: "openai:gpt-4o-mini",
        desiredState: "RUNNING",
        runtimeState: "RUNNING",
      },
      triggerEvent: {
        id: "evt-trigger",
        type: "message.created",
        payload: { text: "hello" },
        source: "human:alice",
        channelId: "chan-1",
      },
      channelId: "chan-1",
      injectionEnv: {},
      apiFetch: async (path: string, init?: RequestInit) => {
        if (path === "/api/channels") {
          return new Response(
            JSON.stringify([
              {
                id: "chan-1",
                participants: [
                  { subscriberType: "AGENT", subscriberId: "tester" },
                  { subscriberType: "AGENT", subscriberId: "worker-a" },
                ],
              },
            ]),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }
        requests.push({
          path,
          body: JSON.parse(String(init?.body ?? "{}")),
        });
        return new Response(JSON.stringify({ id: "evt-scheduled-other" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      },
      emitEvent: async () => {},
      emitAudit: async () => {},
    };

    await executeTool(ctx, "events_scheduled_create", {
      text: "follow up in 45s",
      targetAgentName: "worker-a",
      delaySeconds: 45,
    });

    const after = Date.now();
    expect(requests.length).toBe(1);
    expect(requests[0]?.path).toBe("/api/events");
    expect(requests[0]?.body.type).toBe("agent.scheduled.trigger");
    expect(requests[0]?.body.source).toBe("system:scheduler");
    expect(requests[0]?.body.channelId).toBe("chan-1");
    expect(requests[0]?.body.payload?.text).toBe("follow up in 45s");
    expect(requests[0]?.body.payload?.targetAgentName).toBe("worker-a");
    expect(requests[0]?.body.deliverAt).toBeGreaterThanOrEqual(before + 45_000);
    expect(requests[0]?.body.deliverAt).toBeLessThanOrEqual(after + 45_000);
  });

  it("rejects scheduling when target agent is not a channel participant", async () => {
    const requests: Array<string> = [];
    const ctx = {
      agent: {
        name: "tester",
        systemInstructions: "",
        soulPath: "",
        workspacePath: "/tmp",
        modelId: "openai:gpt-4o-mini",
        desiredState: "RUNNING",
        runtimeState: "RUNNING",
      },
      triggerEvent: {
        id: "evt-trigger",
        type: "message.created",
        payload: { text: "hello" },
        source: "human:alice",
        channelId: "chan-1",
      },
      channelId: "chan-1",
      injectionEnv: {},
      apiFetch: async (path: string) => {
        requests.push(path);
        if (path === "/api/channels") {
          return new Response(
            JSON.stringify([
              {
                id: "chan-1",
                participants: [{ subscriberType: "AGENT", subscriberId: "tester" }],
              },
            ]),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }
        return new Response(JSON.stringify({ id: "evt-should-not-create" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      },
      emitEvent: async () => {},
      emitAudit: async () => {},
    };

    const result = (await executeTool(ctx, "events_scheduled_create", {
      text: "follow up",
      targetAgentName: "worker-a",
      delaySeconds: 30,
    })) as { error?: string };

    expect(typeof result.error).toBe("string");
    expect(result.error).toContain("not an AGENT participant");
    expect(requests).toEqual(["/api/channels"]);
  });

  it("emits custom channel events via events_emit", async () => {
    const requests: Array<{ path: string; body: any }> = [];
    const ctx = {
      agent: {
        name: "tester",
        systemInstructions: "",
        soulPath: "",
        soulContents: "role prompt",
        workspacePath: "/tmp",
        modelId: "openai:gpt-4o-mini",
        desiredState: "RUNNING",
        runtimeState: "RUNNING",
      },
      triggerEvent: {
        id: "evt-trigger",
        type: "message.created",
        payload: { text: "hello" },
        source: "human:alice",
        channelId: "chan-1",
      },
      channelId: "chan-1",
      injectionEnv: {},
      apiFetch: async (path: string, init?: RequestInit) => {
        requests.push({
          path,
          body: JSON.parse(String(init?.body ?? "{}")),
        });
        return new Response(JSON.stringify({ id: "evt-custom" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      },
      emitEvent: async () => {},
      emitAudit: async () => {},
    };

    await executeTool(ctx, "events_emit", {
      type: "custom.workflow.progressed",
      payload: { step: "diff-ready" },
    });

    expect(requests.length).toBe(1);
    expect(requests[0]?.path).toBe("/api/events");
    expect(requests[0]?.body.type).toBe("custom.workflow.progressed");
    expect(requests[0]?.body.channelId).toBe("chan-1");
    expect(requests[0]?.body.source).toBe("agent:tester");
    expect(requests[0]?.body.payload).toEqual({ step: "diff-ready" });
  });

  it("rejects reserved runtime event types via events_emit", async () => {
    const requests: Array<{ path: string; body: any }> = [];
    const ctx = {
      agent: {
        name: "tester",
        systemInstructions: "",
        soulPath: "",
        soulContents: "role prompt",
        workspacePath: "/tmp",
        modelId: "openai:gpt-4o-mini",
        desiredState: "RUNNING",
        runtimeState: "RUNNING",
      },
      triggerEvent: {
        id: "evt-trigger",
        type: "message.created",
        payload: { text: "hello" },
        source: "human:alice",
        channelId: "chan-1",
      },
      channelId: "chan-1",
      injectionEnv: {},
      apiFetch: async (path: string, init?: RequestInit) => {
        requests.push({
          path,
          body: JSON.parse(String(init?.body ?? "{}")),
        });
        return new Response(JSON.stringify({ id: "evt-custom" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      },
      emitEvent: async () => {},
      emitAudit: async () => {},
    };

    for (const reservedType of ["agent.turn.completed", "audit.tool.executed"]) {
      const result = (await executeTool(ctx, "events_emit", {
        type: reservedType,
        payload: {},
      })) as { error?: string };
      expect(result.error).toContain("reserved for runtime bookkeeping/audit");
    }
    expect(requests).toHaveLength(0);
  });

  it("returns pending-timeout delivery hint when emitted event stays pending", async () => {
    const requests: Array<{ path: string; body: any }> = [];
    const ctx = {
      agent: {
        name: "tester",
        systemInstructions: "",
        soulPath: "",
        soulContents: "role prompt",
        workspacePath: "/tmp",
        modelId: "openai:gpt-4o-mini",
        desiredState: "RUNNING",
        runtimeState: "RUNNING",
      },
      triggerEvent: {
        id: "evt-trigger",
        type: "message.created",
        payload: { text: "hello" },
        source: "human:alice",
        channelId: "chan-1",
      },
      channelId: "chan-1",
      injectionEnv: {},
      apiFetch: async (path: string, init?: RequestInit) => {
        requests.push({
          path,
          body: init?.body ? JSON.parse(String(init.body)) : {},
        });
        if (path === "/api/events") {
          return new Response(JSON.stringify({ id: "evt-custom", status: "PENDING" }), {
            status: 201,
            headers: { "content-type": "application/json" },
          });
        }
        if (path === "/api/events/evt-custom") {
          return new Response(JSON.stringify({ id: "evt-custom", status: "PENDING" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      emitEvent: async () => {},
      emitAudit: async () => {},
      validateEvent: () => ({ ok: true as const, matchedDefinitions: 1 }),
    };

    const result = (await executeTool(ctx, "events_emit", {
      type: "custom.workflow.progressed",
      payload: { step: "dispatch" },
      awaitDeliveryMs: 1,
    })) as { delivery?: { status?: string } };

    expect(requests.some((request) => request.path === "/api/events/evt-custom")).toBe(true);
    expect(result.delivery?.status).toBe("pending_timeout");
  });

  it("fails events_emit fast when composed validator rejects payload", async () => {
    const ctx = {
      agent: {
        name: "tester",
        systemInstructions: "",
        soulPath: "",
        soulContents: "role prompt",
        workspacePath: "/tmp",
        modelId: "openai:gpt-4o-mini",
        desiredState: "RUNNING",
        runtimeState: "RUNNING",
      },
      triggerEvent: {
        id: "evt-trigger",
        type: "message.created",
        payload: { text: "hello" },
        source: "human:alice",
        channelId: "chan-1",
      },
      channelId: "chan-1",
      injectionEnv: {},
      apiFetch: async () =>
        new Response(JSON.stringify({ id: "evt-custom" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      emitEvent: async () => {},
      emitAudit: async () => {},
      validateEvent: () => ({
        ok: false as const,
        type: "channel.command.requested",
        matchedDefinitions: 1,
        issues: [{ source: "skill:slack", message: "payload.command.payload.text: Required" }],
      }),
    };

    const result = (await executeTool(ctx, "events_emit", {
      type: "channel.command.requested",
      payload: {
        channel: { provider: "slack" },
        command: { action: "chat.postMessage", payload: {} },
      },
    })) as { error?: string };
    expect(result.error).toContain("Event validation failed");
  });

  it("searches events globally via events_search", async () => {
    const requests: Array<{ path: string; body: any }> = [];
    const ctx = {
      agent: {
        name: "tester",
        systemInstructions: "",
        soulPath: "",
        soulContents: "role prompt",
        workspacePath: "/tmp",
        modelId: "openai:gpt-4o-mini",
        desiredState: "RUNNING",
        runtimeState: "RUNNING",
      },
      triggerEvent: {
        id: "evt-trigger",
        type: "message.created",
        payload: { text: "hello" },
        source: "human:alice",
        channelId: "chan-1",
      },
      channelId: "chan-1",
      injectionEnv: {},
      apiFetch: async (path: string, init?: RequestInit) => {
        requests.push({
          path,
          body: JSON.parse(String(init?.body ?? "{}")),
        });
        return new Response(JSON.stringify([{ id: "evt-1" }, { id: "evt-2" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      emitEvent: async () => {},
      emitAudit: async () => {},
      listEventTypes: () => [
        { type: "slack.message.created", description: "slack msg", source: "skill:slack" },
      ],
    };

    const result = (await executeTool(ctx, "events_search", {
      typePrefix: "slack.",
      order: "desc",
      limit: 20,
    })) as { events: Array<{ id: string }> };

    expect(requests.length).toBe(1);
    expect(requests[0]?.path).toContain("/api/events?");
    expect(requests[0]?.path).toContain("typePrefix=slack.");
    expect(requests[0]?.path).toContain("order=desc");
    expect(requests[0]?.path).toContain("limit=20");
    expect(result.events).toHaveLength(2);
  });

  it("lists future scheduled events via events_scheduled_list", async () => {
    const requests: string[] = [];
    const ctx = {
      agent: {
        name: "tester",
        systemInstructions: "",
        soulPath: "",
        soulContents: "role prompt",
        workspacePath: "/tmp",
        modelId: "openai:gpt-4o-mini",
        desiredState: "RUNNING",
        runtimeState: "RUNNING",
      },
      triggerEvent: {
        id: "evt-trigger",
        type: "message.created",
        payload: { text: "hello" },
        source: "human:alice",
        channelId: "chan-1",
      },
      channelId: "chan-1",
      injectionEnv: {},
      apiFetch: async (path: string) => {
        requests.push(path);
        return new Response(JSON.stringify([{ id: "evt-scheduled" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      emitEvent: async () => {},
      emitAudit: async () => {},
    };

    const result = (await executeTool(ctx, "events_scheduled_list", {
      channelId: "chan-1",
      limit: 10,
    })) as { events: Array<{ id: string }> };

    expect(requests.length).toBe(1);
    expect(requests[0]).toContain("/api/events?");
    expect(requests[0]).toContain("scheduled=1");
    expect(requests[0]).toContain("channelId=chan-1");
    expect(result.events[0]?.id).toBe("evt-scheduled");
  });

  it("updates scheduled events via events_scheduled_update", async () => {
    const requests: Array<{ path: string; method: string; body: any }> = [];
    const before = Date.now();
    const ctx = {
      agent: {
        name: "tester",
        systemInstructions: "",
        soulPath: "",
        soulContents: "role prompt",
        workspacePath: "/tmp",
        modelId: "openai:gpt-4o-mini",
        desiredState: "RUNNING",
        runtimeState: "RUNNING",
      },
      triggerEvent: {
        id: "evt-trigger",
        type: "message.created",
        payload: { text: "hello" },
        source: "human:alice",
        channelId: "chan-1",
      },
      channelId: "chan-1",
      injectionEnv: {},
      apiFetch: async (path: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const bodyText = init?.body ? String(init.body) : "";
        requests.push({
          path,
          method,
          body: bodyText ? JSON.parse(bodyText) : {},
        });
        if (method === "GET") {
          return new Response(
            JSON.stringify({ id: "evt-scheduled", payload: { text: "old text" } }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }
        return new Response(
          JSON.stringify({ id: "evt-scheduled", payload: { text: "new text" } }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
      emitEvent: async () => {},
      emitAudit: async () => {},
    };

    const result = (await executeTool(ctx, "events_scheduled_update", {
      eventId: "evt-scheduled",
      delaySeconds: 60,
      text: "new text",
    })) as { eventId: string; event: { id: string } };
    const patchRequest = requests.find((request) => request.method === "PATCH");
    expect(requests.some((request) => request.method === "GET")).toBe(true);
    expect(patchRequest?.path).toBe("/api/events/evt-scheduled");
    expect(patchRequest?.body.payload?.text).toBe("new text");
    expect(patchRequest?.body.deliverAt).toBeGreaterThanOrEqual(before + 60_000);
    expect(result.eventId).toBe("evt-scheduled");
    expect(result.event.id).toBe("evt-scheduled");
  });

  it("deletes scheduled events via events_scheduled_delete", async () => {
    const requests: Array<{ path: string; method: string }> = [];
    const ctx = {
      agent: {
        name: "tester",
        systemInstructions: "",
        soulPath: "",
        soulContents: "role prompt",
        workspacePath: "/tmp",
        modelId: "openai:gpt-4o-mini",
        desiredState: "RUNNING",
        runtimeState: "RUNNING",
      },
      triggerEvent: {
        id: "evt-trigger",
        type: "message.created",
        payload: { text: "hello" },
        source: "human:alice",
        channelId: "chan-1",
      },
      channelId: "chan-1",
      injectionEnv: {},
      apiFetch: async (path: string, init?: RequestInit) => {
        requests.push({ path, method: init?.method ?? "GET" });
        return new Response(JSON.stringify({ ok: true, deleted: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      emitEvent: async () => {},
      emitAudit: async () => {},
    };

    const result = (await executeTool(ctx, "events_scheduled_delete", {
      eventId: "evt-scheduled",
    })) as { deleted?: boolean };
    expect(requests).toEqual([
      { path: "/api/events/evt-scheduled", method: "DELETE" },
    ]);
    expect(result.deleted).toBe(true);
  });

  it("returns a validation error for unknown events_search typePrefix", async () => {
    const ctx = {
      agent: {
        name: "tester",
        systemInstructions: "",
        soulPath: "",
        soulContents: "role prompt",
        workspacePath: "/tmp",
        modelId: "openai:gpt-4o-mini",
        desiredState: "RUNNING",
        runtimeState: "RUNNING",
      },
      triggerEvent: {
        id: "evt-trigger",
        type: "message.created",
        payload: { text: "hello" },
        source: "human:alice",
        channelId: "chan-1",
      },
      channelId: "chan-1",
      injectionEnv: {},
      apiFetch: async () =>
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      emitEvent: async () => {},
      emitAudit: async () => {},
      listEventTypes: () => [
        { type: "message.created", description: "msg", source: "core" },
      ],
    };

    const result = (await executeTool(ctx, "events_search", {
      typePrefix: "not-real.",
    })) as { error?: string };

    expect(typeof result.error).toBe("string");
    expect(result.error).toContain("Unknown event typePrefix");
  });

  it("lists/filter agents via events_agents_search", async () => {
    const requests: Array<string> = [];
    const ctx = {
      agent: {
        name: "tester",
        systemInstructions: "",
        soulPath: "",
        soulContents: "role prompt",
        workspacePath: "/tmp",
        modelId: "openai:gpt-4o-mini",
        desiredState: "RUNNING",
        runtimeState: "RUNNING",
      },
      triggerEvent: {
        id: "evt-trigger",
        type: "message.created",
        payload: { text: "hello" },
        source: "human:alice",
        channelId: "chan-1",
      },
      channelId: "chan-1",
      injectionEnv: {},
      apiFetch: async (path: string) => {
        requests.push(path);
        return new Response(
          JSON.stringify([
            { name: "worker-a", runtimeState: "RUNNING", desiredState: "RUNNING" },
            { name: "worker-b", runtimeState: "STOPPED", desiredState: "STOPPED" },
          ]),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
      emitEvent: async () => {},
      emitAudit: async () => {},
    };

    const result = (await executeTool(ctx, "events_agents_search", {
      runtimeState: "RUNNING",
    })) as { agents: Array<{ name: string }>; totalMatched: number };

    expect(requests).toEqual(["/api/agents"]);
    expect(result.totalMatched).toBe(1);
    expect(result.agents[0]?.name).toBe("worker-a");
  });

  it("lists channels via events_channels_list", async () => {
    const requests: Array<{ path: string; body: any }> = [];
    const ctx = {
      agent: {
        name: "tester",
        systemInstructions: "",
        soulPath: "",
        soulContents: "role prompt",
        workspacePath: "/tmp",
        modelId: "openai:gpt-4o-mini",
        desiredState: "RUNNING",
        runtimeState: "RUNNING",
      },
      triggerEvent: {
        id: "evt-trigger",
        type: "message.created",
        payload: { text: "hello" },
        source: "human:alice",
        channelId: "chan-1",
      },
      channelId: "chan-1",
      injectionEnv: {},
      apiFetch: async (path: string, init?: RequestInit) => {
        requests.push({
          path,
          body: JSON.parse(String(init?.body ?? "{}")),
        });
        return new Response(
          JSON.stringify([
            {
              id: "chan-a",
              name: "slack:T1:C1",
              kind: "INTEGRATION_BRIDGE",
              participants: [{ subscriberType: "AGENT", subscriberId: "tester" }],
            },
            {
              id: "chan-b",
              name: "main",
              kind: "GROUP",
              participants: [{ subscriberType: "HUMAN", subscriberId: "admin" }],
            },
          ]),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
      emitEvent: async () => {},
      emitAudit: async () => {},
    };

    const result = (await executeTool(ctx, "events_channels_list", {
      nameContains: "slack:",
      participantType: "agent",
      participantId: "tester",
      limit: 10,
    })) as { channels: Array<{ id: string }>; totalMatched: number };

    expect(requests.length).toBe(1);
    expect(requests[0]?.path).toBe("/api/channels");
    expect(result.totalMatched).toBe(1);
    expect(result.channels[0]?.id).toBe("chan-a");
  });

  it("blocks participant management on integration bridge channels", async () => {
    const requests: string[] = [];
    const ctx = {
      agent: {
        name: "tester",
        systemInstructions: "",
        soulPath: "",
        soulContents: "role prompt",
        workspacePath: "/tmp",
        modelId: "openai:gpt-4o-mini",
        desiredState: "RUNNING",
        runtimeState: "RUNNING",
      },
      triggerEvent: {
        id: "evt-trigger",
        type: "message.created",
        payload: { text: "hello" },
        source: "human:alice",
        channelId: "chan-1",
      },
      channelId: "chan-1",
      injectionEnv: {},
      apiFetch: async (path: string) => {
        requests.push(path);
        if (path === "/api/channels") {
          return new Response(
            JSON.stringify([
              {
                id: "chan-integration",
                name: "slack:T1:C1",
                kind: "INTEGRATION_BRIDGE",
                participants: [],
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
      },
      emitEvent: async () => {},
      emitAudit: async () => {},
    };

    const result = (await executeTool(ctx, "events_channel_participant_add", {
      channelId: "chan-integration",
      agentName: "worker-a",
    })) as { error?: string };

    expect(requests).toEqual(["/api/channels"]);
    expect(result.error).toContain("Integration bridge channels");
  });

  it("gracefully terminates spawned processes during shutdown", async () => {
    const requests: Array<{ path: string; body: any }> = [];
    const ctx = {
      agent: {
        name: "tester",
        systemInstructions: "",
        soulPath: "",
        workspacePath: "/tmp",
        modelId: "openai:gpt-4o-mini",
        desiredState: "RUNNING",
        runtimeState: "RUNNING",
      },
      triggerEvent: {
        id: "evt-trigger",
        type: "message.created",
        payload: { text: "hello" },
        source: "human:alice",
        channelId: "chan-1",
      },
      channelId: "chan-1",
      injectionEnv: {},
      extraAllowedRoots: [],
      apiFetch: async (path: string, init?: RequestInit) => {
        requests.push({
          path,
          body: JSON.parse(String(init?.body ?? "{}")),
        });
        return new Response(JSON.stringify({ ok: true }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      },
      emitEvent: async () => {},
      emitAudit: async () => {},
    };

    const started = (await executeTool(ctx, "proc_start", {
      cmd: "sleep 30",
    })) as { processId: string };
    expect(typeof started.processId).toBe("string");

    const summary = await stopAllRunningProcesses(4000);
    expect(summary.processCount).toBeGreaterThanOrEqual(1);
    expect(summary.terminated + summary.killed).toBeGreaterThanOrEqual(1);

    const exitRequest = requests.find((request) =>
      request.path.includes(`/api/processes/${started.processId}/exit`),
    );
    expect(exitRequest).toBeDefined();
    expect(exitRequest?.body.state).toBe("TERMINATED");
  });

  it("reports proc_status as not running after process exits", async () => {
    const ctx = {
      agent: {
        name: "tester",
        systemInstructions: "",
        soulPath: "",
        workspacePath: "/tmp",
        modelId: "openai:gpt-4o-mini",
        desiredState: "RUNNING",
        runtimeState: "RUNNING",
      },
      triggerEvent: {
        id: "evt-trigger",
        type: "message.created",
        payload: { text: "hello" },
        source: "human:alice",
        channelId: "chan-1",
      },
      channelId: "chan-1",
      injectionEnv: {},
      extraAllowedRoots: [],
      apiFetch: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      emitEvent: async () => {},
      emitAudit: async () => {},
    };

    const started = (await executeTool(ctx, "proc_start", {
      cmd: "sleep 0.1",
    })) as { processId: string };
    await new Promise((resolve) => setTimeout(resolve, 250));
    const status = (await executeTool(ctx, "proc_status", {
      processId: started.processId,
    })) as { running: boolean };
    expect(status.running).toBe(false);
  });
});
