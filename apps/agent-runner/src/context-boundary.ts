import type { Event } from "./types";

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

export type ContextBoundary = {
  kind: "compact" | "clear";
  eventId: string;
  markerAt: number;
  cutoffAt: number;
  cutoffEventId?: string;
  summary?: string;
};

function payloadRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

function eventTimestamp(event: Event | null): number {
  return typeof event?.createdAt === "number" && Number.isFinite(event.createdAt)
    ? Math.floor(event.createdAt)
    : 0;
}

export async function getLatestContextBoundary(
  apiFetch: ApiFetch,
  agentName: string,
  channelId: string,
): Promise<ContextBoundary | null> {
  const query = new URLSearchParams({
    channelId,
    typePrefix: "agent.context.",
    source: `agent:${agentName}`,
    order: "desc",
    limit: "10",
  });
  const response = await apiFetch(`/api/events?${query.toString()}`);
  const events = (await response.json()) as Event[];
  const latest = Array.isArray(events)
    ? events
        .filter(
          (event) =>
            event.type === "agent.context.compacted" ||
            event.type === "agent.context.cleared",
        )
        .sort((left, right) => eventTimestamp(right) - eventTimestamp(left))[0] ??
      null
    : null;
  if (!latest) return null;
  const markerAt = eventTimestamp(latest);
  const payload = payloadRecord(latest.payload);
  if (latest.type === "agent.context.cleared") {
    return {
      kind: "clear",
      eventId: latest.id,
      markerAt,
      cutoffAt: markerAt,
    };
  }
  const cutoffAt = Number(payload.cutoffAt);
  const summary =
    typeof payload.summary === "string" ? payload.summary.trim() : "";
  const cutoffEventId =
    typeof payload.cutoffEventId === "string"
      ? payload.cutoffEventId.trim()
      : "";
  return {
    kind: "compact",
    eventId: latest.id,
    markerAt,
    cutoffAt: Number.isFinite(cutoffAt) ? Math.floor(cutoffAt) : markerAt,
    ...(cutoffEventId ? { cutoffEventId } : {}),
    ...(summary ? { summary } : {}),
  };
}
