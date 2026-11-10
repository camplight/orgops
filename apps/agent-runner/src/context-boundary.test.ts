import { describe, expect, it, vi } from "vitest";
import { getLatestContextBoundary } from "./context-boundary";

describe("context boundary", () => {
  it("uses the newest lifecycle marker and compact cutoff watermark", async () => {
    const apiFetch = vi.fn(async () =>
      new Response(
        JSON.stringify([
          {
            id: "compact-2",
            type: "agent.context.compacted",
            source: "agent:worker",
            channelId: "channel",
            payload: {
              targetAgentName: "worker",
              summary: "durable summary",
              cutoffAt: 150,
              cutoffEventId: "event-150",
            },
            createdAt: 300,
          },
          {
            id: "clear-1",
            type: "agent.context.cleared",
            source: "agent:worker",
            channelId: "channel",
            payload: { targetAgentName: "worker" },
            createdAt: 200,
          },
        ]),
      ),
    );

    await expect(
      getLatestContextBoundary(apiFetch, "worker", "channel"),
    ).resolves.toEqual({
      kind: "compact",
      eventId: "compact-2",
      markerAt: 300,
      cutoffAt: 150,
      cutoffEventId: "event-150",
      summary: "durable summary",
    });
    expect(apiFetch).toHaveBeenCalledWith(
      expect.stringContaining("typePrefix=agent.context."),
    );
  });

  it("uses a clear marker timestamp as a hard cutoff", async () => {
    const apiFetch = vi.fn(async () =>
      new Response(
        JSON.stringify([
          {
            id: "clear-2",
            type: "agent.context.cleared",
            source: "agent:worker",
            channelId: "channel",
            payload: { targetAgentName: "worker" },
            createdAt: 400,
          },
        ]),
      ),
    );

    await expect(
      getLatestContextBoundary(apiFetch, "worker", "channel"),
    ).resolves.toMatchObject({
      kind: "clear",
      eventId: "clear-2",
      cutoffAt: 400,
    });
  });
});
