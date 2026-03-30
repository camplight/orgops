import type { Event } from "./types";

const MAX_STRING_CHARS = 280;
const MAX_ARRAY_ITEMS = 8;
const MAX_OBJECT_KEYS = 16;
const MAX_DEPTH = 3;

function compactString(value: string): string {
  if (value.length <= MAX_STRING_CHARS) return value;
  const omitted = value.length - MAX_STRING_CHARS;
  return `${value.slice(0, MAX_STRING_CHARS)}... [truncated ${omitted} chars]`;
}

function compactUnknown(value: unknown, depth = 0): unknown {
  if (value === null) return null;
  if (typeof value === "string") return compactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value === undefined) return undefined;
  if (depth >= MAX_DEPTH) {
    if (Array.isArray(value)) {
      return `[array(${value.length}) truncated]`;
    }
    if (typeof value === "object") {
      return "[object truncated]";
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    const next = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => compactUnknown(item, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) {
      next.push(`[+${value.length - MAX_ARRAY_ITEMS} more items]`);
    }
    return next;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const out: Record<string, unknown> = {};
    for (const [key, entryValue] of entries.slice(0, MAX_OBJECT_KEYS)) {
      out[key] = compactUnknown(entryValue, depth + 1);
    }
    if (entries.length > MAX_OBJECT_KEYS) {
      out.__truncatedKeys = entries.length - MAX_OBJECT_KEYS;
    }
    return out;
  }
  return String(value);
}

export function buildPromptEventRecord(event: Event) {
  return {
    eventId: event.id,
    channelId: event.channelId,
    parentEventId: event.parentEventId,
    type: event.type,
    source: event.source,
    payload: compactUnknown(event.payload ?? {}),
  };
}
