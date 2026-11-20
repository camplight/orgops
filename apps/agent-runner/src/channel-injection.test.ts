import { describe, expect, it } from "vitest";
import { pullInjectedEventMessages } from "./channel-injection";
import type { Agent, Event } from "./types";
import { shouldHandleEventForAgent } from "./event-routing";

describe("channel injection", () => {
  it("returns only new includable events and tracks seen ids", async () => {
    const agent: Agent = {
      name: "browser",
      workspacePath: "/tmp",
      modelId: "openai:gpt-4o-mini",
      desiredState: "RUNNING",
      runtimeState: "RUNNING",
    };
    const seenEventIds = new Set<string>(["evt-old"]);
    const apiFetch = async () =>
      new Response(
        JSON.stringify([
          {
            id: "evt-old",
            type: "process.output",
            source: "system:process-runner",
            channelId: "chan-1",
            payload: { text: "old" },
            createdAt: 1,
          },
          {
            id: "evt-audit",
            type: "tool.started",
            source: "agent:browser",
            channelId: "chan-1",
            payload: {},
            createdAt: 2,
          },
          {
            id: "evt-new",
            type: "process.output",
            source: "system:process-runner",
            channelId: "chan-1",
            payload: { text: "new" },
            createdAt: 3,
          },
        ] satisfies Event[]),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );

    const injected = await pullInjectedEventMessages({
      apiFetch,
      agent,
      channelId: "chan-1",
      seenEventIds,
      shouldInclude: shouldHandleEventForAgent,
    });

    expect(injected?.events.map((event) => event.id)).toEqual(["evt-new"]);
    expect(String(injected?.messages[0]?.content)).toContain('"type": "process.output"');
    expect(seenEventIds.has("evt-old")).toBe(true);
    expect(seenEventIds.has("evt-audit")).toBe(true);
    expect(seenEventIds.has("evt-new")).toBe(true);
  });

  it("hydrates truncated payloads before building history messages", async () => {
    const agent: Agent = {
      name: "browser",
      workspacePath: "/tmp",
      modelId: "openai:gpt-4o-mini",
      desiredState: "RUNNING",
      runtimeState: "RUNNING",
    };
    const seenEventIds = new Set<string>();
    const apiFetch = async (path: string) => {
      if (path.startsWith("/api/events?")) {
        return Response.json([
          {
            id: "evt-trunc",
            type: "process.output",
            source: "system:process-runner",
            channelId: "chan-1",
            payload: { text: "truncated" },
            payloadTruncated: true,
            createdAt: 1,
          },
        ] satisfies Event[]);
      }
      if (path.startsWith("/api/events/evt-trunc/payload")) {
        return Response.json({
          chunk: JSON.stringify({ text: "full hydrated text" }),
          done: true,
          nextOffset: 1,
        });
      }
      throw new Error(`Unexpected ${path}`);
    };

    const injected = await pullInjectedEventMessages({
      apiFetch,
      agent,
      channelId: "chan-1",
      seenEventIds,
      shouldInclude: shouldHandleEventForAgent,
    });

    expect(injected?.events[0]?.payload).toEqual({ text: "full hydrated text" });
    expect(String(injected?.messages[0]?.content)).toContain("full hydrated text");
  });
});
