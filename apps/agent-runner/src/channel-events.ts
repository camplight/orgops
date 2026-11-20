import type { Event } from "./types";

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

export async function hydrateEventPayload(apiFetch: ApiFetch, event: Event): Promise<Event> {
  if (!event.payloadTruncated) return event;
  let offset = 0;
  let json = "";
  const byteChunks: Buffer[] = [];
  let usesByteChunks = false;
  for (;;) {
    const response = await apiFetch(
      `/api/events/${encodeURIComponent(event.id)}/payload?offset=${offset}&limit=65536`,
    );
    const payload = (await response.json()) as {
      chunk?: unknown;
      chunkBase64?: unknown;
      nextOffset?: unknown;
      done?: unknown;
    };
    if (typeof payload.chunk !== "string") {
      throw new Error(`Unable to read complete payload for event ${event.id}`);
    }
    if (typeof payload.chunkBase64 === "string") {
      usesByteChunks = true;
      byteChunks.push(Buffer.from(payload.chunkBase64, "base64"));
    } else {
      json += payload.chunk;
    }
    if (payload.done === true) break;
    const nextOffset =
      typeof payload.nextOffset === "number" && payload.nextOffset > offset
        ? payload.nextOffset
        : offset + payload.chunk.length;
    if (nextOffset <= offset || payload.chunk.length === 0) {
      throw new Error(`Payload read made no progress for event ${event.id}`);
    }
    offset = nextOffset;
  }
  try {
    const completeJson = usesByteChunks ? Buffer.concat(byteChunks).toString("utf8") : json;
    return { ...event, payload: JSON.parse(completeJson), payloadTruncated: false };
  } catch {
    throw new Error(`Complete payload for event ${event.id} is invalid JSON`);
  }
}

export async function listChannelEventsAfter(
  apiFetch: ApiFetch,
  channelId: string,
  afterExclusive?: number,
): Promise<Event[]> {
  const pageSize = 500;
  let cursor = afterExclusive ?? 0;
  const out: Event[] = [];
  for (;;) {
    const query = new URLSearchParams();
    query.set("channelId", channelId);
    query.set("order", "asc");
    query.set("limit", String(pageSize));
    query.set("after", String(cursor));
    const res = await apiFetch(`/api/events?${query.toString()}`);
    const page = (await res.json()) as Event[];
    if (page.length === 0) break;
    out.push(...(await Promise.all(page.map((event) => hydrateEventPayload(apiFetch, event)))));
    cursor = page.reduce(
      (max, event) =>
        Math.max(max, typeof event.createdAt === "number" ? event.createdAt : 0),
      cursor,
    );
    if (page.length < pageSize) break;
  }
  return out;
}

export async function listLatestChannelEvents(
  apiFetch: ApiFetch,
  channelId: string,
  limit: number,
  options?: {
    now?: number;
    isMeaningful?: (event: Event) => boolean;
  },
): Promise<Event[]> {
  const target = Math.max(1, Math.floor(limit));
  const now = options?.now ?? Date.now();
  const isMeaningful = options?.isMeaningful;
  const pageSize = Math.max(target * 3, 20);
  const collected: Event[] = [];
  let before: number | undefined;
  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({
      channelId,
      order: "desc",
      limit: String(pageSize),
    });
    if (before !== undefined) query.set("before", String(before));
    const response = await apiFetch(`/api/events?${query.toString()}`);
    const rows = (await response.json()) as Event[];
    if (rows.length === 0) break;
    const hydrated = await Promise.all(
      rows.map((event) => hydrateEventPayload(apiFetch, event)),
    );
    for (const event of hydrated) {
      const due =
        event.deliverAt === undefined ||
        event.deliverAt === null ||
        event.deliverAt <= now;
      if (!due) continue;
      if (isMeaningful && !isMeaningful(event)) continue;
      collected.push(event);
      if (collected.length >= target) break;
    }
    if (collected.length >= target) break;
    const oldestCreatedAt = rows.reduce(
      (min, event) =>
        Math.min(
          min,
          typeof event.createdAt === "number" ? event.createdAt : Number.POSITIVE_INFINITY,
        ),
      Number.POSITIVE_INFINITY,
    );
    if (
      !Number.isFinite(oldestCreatedAt) ||
      oldestCreatedAt >= (before ?? Number.POSITIVE_INFINITY)
    ) {
      break;
    }
    before = oldestCreatedAt;
    if (rows.length < pageSize) break;
  }
  return collected
    .slice(0, target)
    .sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0));
}

export async function listChannelEvents(
  apiFetch: ApiFetch,
  channelId: string,
): Promise<Event[]> {
  return listChannelEventsAfter(apiFetch, channelId);
}
