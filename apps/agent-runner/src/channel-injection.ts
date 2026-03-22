import type { Agent, Event } from "./types";

type PullInjectedEventsInput = {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  agent: Agent;
  channelId: string;
  seenEventIds: Set<string>;
  shouldInclude: (agent: Agent, event: Event) => boolean;
};

export async function pullInjectedEventMessages(
  input: PullInjectedEventsInput,
): Promise<
  | {
      events: Event[];
      messages: Array<{ role: "user"; content: string }>;
    }
  | null
> {
  const query =
    `agentName=${encodeURIComponent(input.agent.name)}` +
    `&status=PENDING&channelId=${encodeURIComponent(input.channelId)}&limit=50`;
  const res = await input.apiFetch(`/api/events?${query}`);
  const raw = await res.json();
  const events = Array.isArray(raw) ? (raw as Event[]) : [];
  const fresh = events
    .filter((event) => !input.seenEventIds.has(event.id))
    .filter((event) => input.shouldInclude(input.agent, event))
    .sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0));
  for (const event of events) {
    input.seenEventIds.add(event.id);
  }
  if (fresh.length === 0) return null;
  return {
    events: fresh,
    messages: fresh.map((event) => ({
      role: "user" as const,
      content: JSON.stringify(
        {
          eventId: event.id,
          channelId: event.channelId,
          parentEventId: event.parentEventId,
          type: event.type,
          source: event.source,
          payload: event.payload ?? {},
        },
        null,
        2,
      ),
    })),
  };
}
