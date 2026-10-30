import type { Agent, Event } from "./types";
import { buildPromptEventRecord } from "./prompt-event-compact";

type PullInjectedEventsInput = {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  agent: Agent;
  channelId: string;
  seenEventIds: Set<string>;
  shouldInclude: (agent: Agent, event: Event) => boolean;
  shouldSuppress?: (agent: Agent, event: Event) => boolean;
};

function roleForEvent(event: Event): "user" | "system" {
  if (event.type !== "message.created") return "system";
  const source = String(event.source ?? "").toLowerCase();
  return !source.startsWith("agent:") && !source.startsWith("system:") ? "user" : "system";
}

export async function pullInjectedEventMessages(
  input: PullInjectedEventsInput,
): Promise<
  | {
      events: Event[];
      messages: Array<{ role: "user" | "system"; content: string }>;
    }
  | null
> {
  const query =
    `agentName=${encodeURIComponent(input.agent.name)}` +
    `&status=PENDING&channelId=${encodeURIComponent(input.channelId)}&limit=50`;
  const res = await input.apiFetch(`/api/events?${query}`);
  const raw = await res.json();
  const events = Array.isArray(raw) ? (raw as Event[]) : [];
  const fresh: Event[] = [];
  for (const event of [...events].sort(
    (left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0),
  )) {
    if (input.seenEventIds.has(event.id)) continue;
    if (input.shouldSuppress?.(input.agent, event)) continue;
    if (!input.shouldInclude(input.agent, event)) continue;
    fresh.push(event);
  }
  for (const event of events) {
    input.seenEventIds.add(event.id);
  }
  if (fresh.length === 0) return null;
  return {
    events: fresh,
    messages: fresh.map((event) => ({
      role: roleForEvent(event),
      content: JSON.stringify(buildPromptEventRecord(event), null, 2),
    })),
  };
}
