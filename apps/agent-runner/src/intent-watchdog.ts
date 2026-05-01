import type { Event } from "./types";

const DEFAULT_INTENT_TIMEOUT_MS = 45_000;

export type IntentWatchRecord = {
  key: string;
  agentName: string;
  channelId: string;
  intentId: string;
  messageEventId: string;
  label: string;
  timeoutMs: number;
  declaredAt: number;
  dueAt: number;
  timeoutCount: number;
  lastTimeoutAt?: number;
};

type IntentPayload = {
  id?: string;
  label?: string;
  timeoutMs?: number;
  active?: boolean;
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseIntentPayload(payload: unknown): IntentPayload | null {
  const payloadObj = asObject(payload);
  const rawIntent = payloadObj.intent;
  if (rawIntent === true) return {};
  if (!rawIntent || typeof rawIntent !== "object" || Array.isArray(rawIntent)) return null;
  const intentObj = rawIntent as Record<string, unknown>;
  const active =
    typeof intentObj.active === "boolean"
      ? intentObj.active
      : typeof intentObj.isActive === "boolean"
        ? intentObj.isActive
        : undefined;
  return {
    id: typeof intentObj.id === "string" ? intentObj.id.trim() : undefined,
    label: typeof intentObj.label === "string" ? intentObj.label.trim() : undefined,
    timeoutMs:
      typeof intentObj.timeoutMs === "number" && Number.isFinite(intentObj.timeoutMs)
        ? intentObj.timeoutMs
        : undefined,
    active,
  };
}

function hasActiveIntentFlag(event: Event): boolean {
  if (event.type !== "message.created") return false;
  const parsed = parseIntentPayload(event.payload);
  if (!parsed) return false;
  return parsed.active !== false;
}

function resolveEventTimestamp(event: Event): number {
  if (typeof event.createdAt === "number" && Number.isFinite(event.createdAt)) {
    return Math.floor(event.createdAt);
  }
  return Date.now();
}

function clampTimeoutMs(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(600_000, Math.max(1_000, Math.floor(value)));
}

function makeIntentKey(agentName: string, channelId: string, intentId: string): string {
  return `${agentName}::${channelId}::${intentId}`;
}

function isBookkeepingEvent(event: Event): boolean {
  if (event.type?.startsWith("agent.turn.")) return true;
  if (event.type?.startsWith("audit.")) return true;
  if (event.type?.startsWith("telemetry.")) return true;
  if (event.type?.startsWith("tool.")) return true;
  if (event.type?.startsWith("process.")) return true;
  return false;
}

function isAgentActionEvent(agentName: string, event: Event): boolean {
  if (event.source !== `agent:${agentName}`) return false;
  if (isBookkeepingEvent(event)) return false;
  if (event.type === "noop") return false;
  if (hasActiveIntentFlag(event)) return false;
  return true;
}

export function ingestIntentEvents(input: {
  intents: Map<string, IntentWatchRecord>;
  agentName: string;
  events: Event[];
  defaultTimeoutMs?: number;
}) {
  const defaultTimeoutMs = clampTimeoutMs(input.defaultTimeoutMs, DEFAULT_INTENT_TIMEOUT_MS);
  const sorted = [...input.events].sort((left, right) => {
    const leftTs = resolveEventTimestamp(left);
    const rightTs = resolveEventTimestamp(right);
    if (leftTs !== rightTs) return leftTs - rightTs;
    return left.id.localeCompare(right.id);
  });

  for (const event of sorted) {
    if (!event.channelId) continue;
    const eventTs = resolveEventTimestamp(event);
    if (event.type === "message.created" && event.source === `agent:${input.agentName}`) {
      const parsed = parseIntentPayload(event.payload);
      if (parsed && parsed.active !== false) {
        const intentId = parsed.id || event.id;
        const key = makeIntentKey(input.agentName, event.channelId, intentId);
        const timeoutMs = clampTimeoutMs(parsed.timeoutMs, defaultTimeoutMs);
        input.intents.set(key, {
          key,
          agentName: input.agentName,
          channelId: event.channelId,
          intentId,
          messageEventId: event.id,
          label: parsed.label || "intent",
          timeoutMs,
          declaredAt: eventTs,
          dueAt: eventTs + timeoutMs,
          timeoutCount: 0,
        });
        continue;
      }
    }

    if (!isAgentActionEvent(input.agentName, event)) continue;
    for (const [key, record] of input.intents.entries()) {
      if (record.agentName !== input.agentName) continue;
      if (record.channelId !== event.channelId) continue;
      if (eventTs <= record.declaredAt) continue;
      input.intents.delete(key);
    }
  }
}

export function collectDueIntentTimeouts(input: {
  intents: Map<string, IntentWatchRecord>;
  agentName: string;
  channelIds: string[];
  nowMs: number;
  maxTimeoutsPerIntent: number;
}) {
  const due: IntentWatchRecord[] = [];
  const channels = new Set(input.channelIds);
  for (const [key, record] of input.intents.entries()) {
    if (record.agentName !== input.agentName) continue;
    if (!channels.has(record.channelId)) continue;
    if (record.timeoutCount >= input.maxTimeoutsPerIntent) {
      input.intents.delete(key);
      continue;
    }
    if (record.dueAt > input.nowMs) continue;
    record.timeoutCount += 1;
    record.lastTimeoutAt = input.nowMs;
    record.dueAt = input.nowMs + record.timeoutMs;
    input.intents.set(key, record);
    due.push({ ...record });
  }
  return due;
}

export function clearAgentIntentWatch(
  intents: Map<string, IntentWatchRecord>,
  agentName: string,
) {
  for (const [key, record] of intents.entries()) {
    if (record.agentName === agentName) {
      intents.delete(key);
    }
  }
}
