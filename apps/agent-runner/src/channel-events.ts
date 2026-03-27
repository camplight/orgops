import type { Event } from "./types";

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

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
    out.push(...page);
    cursor = page.reduce(
      (max, event) =>
        Math.max(max, typeof event.createdAt === "number" ? event.createdAt : 0),
      cursor,
    );
    if (page.length < pageSize) break;
  }
  return out;
}

export async function listChannelEvents(
  apiFetch: ApiFetch,
  channelId: string,
): Promise<Event[]> {
  return listChannelEventsAfter(apiFetch, channelId);
}
