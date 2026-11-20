import type { LlmMessage } from "@orgops/llm";
import { contentCharLength } from "./prompt-composer";
import type { Event } from "./types";

export function truncateToBudget(value: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (value.length <= maxChars) return value;
  const suffix = "...[truncated]";
  if (maxChars <= suffix.length) return value.slice(0, maxChars);
  return `${value.slice(0, maxChars - suffix.length)}${suffix}`;
}

export function compactCurrentEvent(event: Event, maxChars: number): string {
  const minimumEnvelope = JSON.stringify({
    payloadRead: { tool: "events_payload_read", eventId: event.id },
    eventId: event.id,
    type: event.type,
  });
  if (maxChars <= minimumEnvelope.length) return minimumEnvelope;
  const payloadPreview =
    typeof event.payload === "string"
      ? event.payload
      : JSON.stringify(event.payload ?? {});
  return truncateToBudget(
    JSON.stringify({
      payloadRead: {
        tool: "events_payload_read",
        eventId: event.id,
        note: "Read the complete payload when this compact representation is insufficient.",
      },
      eventId: event.id,
      type: event.type,
      source: event.source,
      channelId: event.channelId,
      createdAt: event.createdAt,
      payloadPreview,
      payloadTruncatedForPromptBudget: true,
    }),
    maxChars,
  );
}

export function boundCurrentEventMessages(
  events: Event[],
  messages: LlmMessage[],
  maxChars: number,
): LlmMessage[] {
  let remainingChars = Math.max(0, maxChars);
  return messages.map((message, index) => {
    const remainingMessages = messages.length - index;
    const minimumChars = compactCurrentEvent(events[index]!, 0).length;
    const allocation = Math.max(
      minimumChars,
      Math.floor(remainingChars / Math.max(1, remainingMessages)),
    );
    const messageChars = contentCharLength(message.content);
    if (messageChars <= allocation) {
      remainingChars = Math.max(0, remainingChars - messageChars);
      return message;
    }
    const content = compactCurrentEvent(events[index]!, allocation);
    remainingChars = Math.max(0, remainingChars - content.length);
    return { ...message, content } as LlmMessage;
  });
}
