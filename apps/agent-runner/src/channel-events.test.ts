import { describe, expect, it, vi } from "vitest";
import { listLatestChannelEvents } from "./channel-events";
import type { Event } from "./types";

describe("listLatestChannelEvents", () => {
  it("pages past bookkeeping until it collects meaningful due events", async () => {
    const now = 1_000_000;
    const all: Event[] = [
      {
        id: "tool-1",
        type: "tool.started",
        source: "agent:worker",
        channelId: "channel",
        payload: {},
        createdAt: now - 1,
      },
      {
        id: "future",
        type: "message.created",
        source: "human:admin",
        channelId: "channel",
        payload: { text: "later" },
        createdAt: now - 2,
        deliverAt: now + 10_000,
      },
      {
        id: "msg-1",
        type: "message.created",
        source: "human:admin",
        channelId: "channel",
        payload: { text: "kept" },
        createdAt: now - 3,
      },
      {
        id: "audit-1",
        type: "tool.finished",
        source: "agent:worker",
        channelId: "channel",
        payload: {},
        createdAt: now - 4,
      },
      {
        id: "msg-2",
        type: "message.created",
        source: "human:admin",
        channelId: "channel",
        payload: { text: "older kept" },
        createdAt: now - 5,
      },
    ];
    const apiFetch = vi.fn(async (path: string) => {
      expect(path).toContain("order=desc");
      const url = new URL(path, "http://localhost");
      const limit = Number(url.searchParams.get("limit") ?? "0");
      const before = url.searchParams.get("before");
      const filtered = all.filter((event) =>
        before === null ? true : (event.createdAt ?? 0) < Number(before),
      );
      return Response.json(filtered.slice(0, limit));
    });

    const events = await listLatestChannelEvents(apiFetch, "channel", 2, {
      now,
      isMeaningful: (event) => event.type === "message.created",
    });

    expect(events.map((event) => event.id)).toEqual(["msg-2", "msg-1"]);
  });
});
