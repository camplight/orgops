import { taskModelRequest } from "./task-model";
import type { LlmMessage } from "@orgops/llm";
import { hydrateEventPayload } from "./channel-events";
import { toHistoryMessage } from "./prompt-composer";
import { boundCurrentEventMessages } from "./current-event-budget";
import type { Agent, Event } from "./types";

type PullInjectedEventsInput = {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  agent: Agent;
  channelId: string;
  seenEventIds: Set<string>;
  shouldInclude: (agent: Agent, event: Event) => boolean;
  shouldSuppress?: (agent: Agent, event: Event) => boolean;
  maxChars?: number;
};

export async function pullInjectedEventMessages(
  input: PullInjectedEventsInput,
): Promise<
  | {
      events: Event[];
      messages: LlmMessage[];
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
    if (input.shouldSuppress?.(input.agent, event)) { input.seenEventIds.add(event.id); continue; }
    // Hydrate before include checks: truncated payloads are intentionally
    // excluded by routing until their complete body is available.
    const hydrated = await hydrateEventPayload(input.apiFetch, event);
    if (!input.shouldInclude(input.agent, hydrated)) { input.seenEventIds.add(event.id); continue; }
    // Leave this and later events pending for a separate task/model boundary.
    if (taskModelRequest(input.agent, hydrated)) break;
    fresh.push(hydrated);
  }
  for (const event of fresh) {
    input.seenEventIds.add(event.id);
  }
  if (fresh.length === 0) return null;
  const unbounded = await Promise.all(
    fresh.map((event) =>
      toHistoryMessage(input.agent, event, { apiFetch: input.apiFetch }),
    ),
  );
  const messages = boundCurrentEventMessages(
    fresh,
    unbounded,
    Math.max(0, input.maxChars ?? 32_000),
  );
  return {
    events: fresh,
    messages,
  };
}
