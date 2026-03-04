import { describe, expect, it } from "bun:test";
import { createRunnerTools } from "./tools";
import {
  buildModelMessages,
  parseResponseDirective,
  shouldHandleEvent,
} from "./runner";
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

  it("filters control, self, and unaddressed agent channel events", async () => {
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
    const ownEvent: Event = {
      id: "evt-own",
      type: "message.created",
      payload: { text: "self" },
      source: "agent:tester",
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

    expect(await shouldHandleEvent(agent, controlEvent)).toBe(false);
    expect(await shouldHandleEvent(agent, ownEvent)).toBe(false);
    expect(await shouldHandleEvent(agent, otherAgentChannelEvent)).toBe(false);
    expect(await shouldHandleEvent(agent, addressedByMention)).toBe(true);
    expect(await shouldHandleEvent(agent, agentThreadReply)).toBe(false);
    expect(await shouldHandleEvent(agent, highHopCount)).toBe(false);
    expect(await shouldHandleEvent(agent, userEvent)).toBe(true);
  });

  it("parses explicit response directives", () => {
    expect(parseResponseDirective("[REPLY] hello")).toEqual({
      mode: "reply",
      text: "hello",
    });
    expect(parseResponseDirective("[NO_REPLY] already sent")).toEqual({
      mode: "no_reply",
      text: "already sent",
    });
    expect(parseResponseDirective("plain text")).toEqual({
      mode: "reply",
      text: "plain text",
    });
  });
});
