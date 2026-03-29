import { generate } from "@orgops/llm";
import { listChannelEventsAfter } from "./channel-events";
import type { Agent, Event } from "./types";

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

export const RECENT_MEMORY_WINDOW_MS = 600_000;
const MAX_EVENTS_PER_PROMPT = 120;
const MAX_CROSS_CHANNEL_INPUTS = 80;

function normalizeTimestamp(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 0;
}

function isMeaningfulEvent(event: Event): boolean {
  if (event.type.startsWith("audit.")) return false;
  if (event.type.startsWith("agent.turn.")) return false;
  if (event.type.startsWith("memory.")) return false;
  if (event.type === "event.deadlettered") return false;
  return true;
}

function compactEvent(event: Event) {
  return {
    id: event.id,
    createdAt: normalizeTimestamp(event.createdAt),
    type: event.type,
    source: event.source,
    channelId: event.channelId,
    payload: event.payload ?? {},
  };
}

function trimText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

type ChannelMemoryRecord = {
  agentName: string;
  channelId: string;
  summaryText: string;
  windowStartAt?: number;
  lastProcessedAt: number;
  lastProcessedEventId?: string;
  version: number;
  createdAt: number;
  updatedAt: number;
};

type CrossChannelMemoryRecord = {
  agentName: string;
  summaryText: string;
  windowStartAt?: number;
  lastProcessedAt: number;
  lastProcessedEventId?: string;
  version: number;
  createdAt: number;
  updatedAt: number;
};

type ChannelMemoryMode = "recent" | "full";
type CrossMemoryMode = "recent" | "full";

async function getChannelMemoryRecord(
  apiFetch: ApiFetch,
  mode: ChannelMemoryMode,
  agentName: string,
  channelId: string,
): Promise<ChannelMemoryRecord | null> {
  const query = new URLSearchParams();
  query.set("agentName", agentName);
  query.set("channelId", channelId);
  const response = await apiFetch(`/api/memory/channel/${mode}?${query.toString()}`);
  const payload = (await response.json()) as { record?: ChannelMemoryRecord | null };
  return payload.record ?? null;
}

async function listChannelMemoryRecords(
  apiFetch: ApiFetch,
  mode: ChannelMemoryMode,
  agentName: string,
  channelIds: string[],
): Promise<ChannelMemoryRecord[]> {
  const query = new URLSearchParams();
  query.set("agentName", agentName);
  if (channelIds.length > 0) {
    query.set("channelIds", channelIds.join(","));
  }
  const response = await apiFetch(`/api/memory/channel/${mode}?${query.toString()}`);
  const payload = (await response.json()) as { records?: ChannelMemoryRecord[] };
  return Array.isArray(payload.records) ? payload.records : [];
}

async function upsertChannelMemoryRecord(
  apiFetch: ApiFetch,
  mode: ChannelMemoryMode,
  record: {
    agentName: string;
    channelId: string;
    summaryText: string;
    windowStartAt?: number;
    lastProcessedAt: number;
    lastProcessedEventId?: string;
    expectedVersion?: number;
  },
): Promise<ChannelMemoryRecord> {
  const response = await apiFetch(`/api/memory/channel/${mode}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(record),
  });
  const payload = (await response.json()) as { record?: ChannelMemoryRecord | null };
  if (!payload.record) {
    throw new Error(`Unable to upsert channel ${mode} memory for ${record.channelId}`);
  }
  return payload.record;
}

async function getCrossMemoryRecord(
  apiFetch: ApiFetch,
  mode: CrossMemoryMode,
  agentName: string,
): Promise<CrossChannelMemoryRecord | null> {
  const query = new URLSearchParams();
  query.set("agentName", agentName);
  const response = await apiFetch(`/api/memory/cross/${mode}?${query.toString()}`);
  const payload = (await response.json()) as { record?: CrossChannelMemoryRecord | null };
  return payload.record ?? null;
}

async function upsertCrossMemoryRecord(
  apiFetch: ApiFetch,
  mode: CrossMemoryMode,
  record: {
    agentName: string;
    summaryText: string;
    windowStartAt?: number;
    lastProcessedAt: number;
    lastProcessedEventId?: string;
    expectedVersion?: number;
  },
): Promise<CrossChannelMemoryRecord> {
  const response = await apiFetch(`/api/memory/cross/${mode}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(record),
  });
  const payload = (await response.json()) as { record?: CrossChannelMemoryRecord | null };
  if (!payload.record) {
    throw new Error(`Unable to upsert cross-channel ${mode} memory`);
  }
  return payload.record;
}

async function summarizeText(
  agent: Agent,
  env: Record<string, string>,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const result = await generate(
    agent.modelId,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    {
      temperature: 0.2,
      env,
    },
  );
  return trimText(result.text ?? "");
}

function maxEventTimestamp(events: Event[]): number {
  return events.reduce(
    (max, event) => Math.max(max, normalizeTimestamp(event.createdAt)),
    0,
  );
}

function getLastEventId(events: Event[]): string | undefined {
  if (events.length === 0) return undefined;
  return events[events.length - 1]?.id;
}

export async function refreshChannelRecentMemory(input: {
  agent: Agent;
  channelId: string;
  apiFetch: ApiFetch;
  getEnv: () => Promise<Record<string, string>>;
  emitEvent: (event: unknown) => Promise<void>;
}): Promise<ChannelMemoryRecord | null> {
  const now = Date.now();
  const windowStartAt = now - RECENT_MEMORY_WINDOW_MS;
  const existing = await getChannelMemoryRecord(
    input.apiFetch,
    "recent",
    input.agent.name,
    input.channelId,
  );
  const events = await listChannelEventsAfter(
    input.apiFetch,
    input.channelId,
    Math.max(0, windowStartAt - 1),
  );
  const meaningfulEvents = events.filter(isMeaningfulEvent);
  const meaningfulLastProcessedAt = maxEventTimestamp(meaningfulEvents);
  const nextLastProcessedAt = Math.max(
    meaningfulLastProcessedAt,
    normalizeTimestamp(existing?.lastProcessedAt),
  );
  if (meaningfulEvents.length === 0) {
    if (existing) return existing;
    const emptyRecord = await upsertChannelMemoryRecord(input.apiFetch, "recent", {
      agentName: input.agent.name,
      channelId: input.channelId,
      summaryText: "",
      windowStartAt,
      lastProcessedAt: nextLastProcessedAt,
    });
    await input.emitEvent({
      type: "audit.memory.channel.recent.updated",
      source: "system:runner:memory",
      status: "DELIVERED",
      channelId: input.channelId,
      payload: {
        agentName: input.agent.name,
        channelId: input.channelId,
        summaryChars: 0,
        eventCount: 0,
        windowStartAt,
        lastProcessedAt: nextLastProcessedAt,
      },
    });
    return emptyRecord;
  }
  if (existing && nextLastProcessedAt <= normalizeTimestamp(existing.lastProcessedAt)) {
    return existing;
  }
  const summary = await summarizeText(
    input.agent,
    await input.getEnv(),
    "You summarize the last 10 minutes of one channel for execution context. Keep it concise, factual, and action-oriented. Return plain text only.",
    [
      "Produce a rolling 10-minute channel summary for agent execution context.",
      "- Include active tasks, decisions, blockers, and unresolved questions.",
      "- Avoid fluff, speculation, and secrets.",
      "- Keep details concrete so the agent can continue work without raw history.",
      "",
      `Agent: ${input.agent.name}`,
      `Channel: ${input.channelId}`,
      `WindowStartAt: ${windowStartAt}`,
      existing?.summaryText
        ? `Previous recent summary:\n${existing.summaryText}`
        : "Previous recent summary: <none>",
      "",
      "Recent meaningful events (ordered):",
      JSON.stringify(
        meaningfulEvents.slice(-MAX_EVENTS_PER_PROMPT).map(compactEvent),
        null,
        2,
      ),
    ].join("\n"),
  );
  const summaryText = summary || existing?.summaryText || "";
  const nextRecord = await upsertChannelMemoryRecord(input.apiFetch, "recent", {
    agentName: input.agent.name,
    channelId: input.channelId,
    summaryText,
    windowStartAt,
    lastProcessedAt: nextLastProcessedAt,
    ...(getLastEventId(events) ? { lastProcessedEventId: getLastEventId(events) } : {}),
    ...(existing?.version !== undefined ? { expectedVersion: existing.version } : {}),
  });
  await input.emitEvent({
    type: "audit.memory.channel.recent.updated",
    source: "system:runner:memory",
    status: "DELIVERED",
    channelId: input.channelId,
    payload: {
      agentName: input.agent.name,
      channelId: input.channelId,
      summaryChars: summaryText.length,
      eventCount: meaningfulEvents.length,
      windowStartAt,
      lastProcessedAt: nextLastProcessedAt,
    },
  });
  return nextRecord;
}

function chunkEvents<T>(items: T[], chunkSize: number): T[][] {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

export async function refreshChannelFullMemory(input: {
  agent: Agent;
  channelId: string;
  apiFetch: ApiFetch;
  getEnv: () => Promise<Record<string, string>>;
  emitEvent: (event: unknown) => Promise<void>;
}): Promise<ChannelMemoryRecord | null> {
  const existing = await getChannelMemoryRecord(
    input.apiFetch,
    "full",
    input.agent.name,
    input.channelId,
  );
  const after = normalizeTimestamp(existing?.lastProcessedAt);
  const newEvents = await listChannelEventsAfter(
    input.apiFetch,
    input.channelId,
    after > 0 ? after : undefined,
  );
  const meaningfulNewEvents = newEvents.filter(isMeaningfulEvent);
  if (meaningfulNewEvents.length === 0) {
    return existing;
  }
  const chunks = chunkEvents(meaningfulNewEvents, MAX_EVENTS_PER_PROMPT);
  let summaryText = existing?.summaryText ?? "";
  for (const chunk of chunks) {
    const nextSummary = await summarizeText(
      input.agent,
      await input.getEnv(),
      "You maintain a full rolling channel memory for execution context. Keep it concise, durable, and strictly factual. Return plain text only.",
      [
        "Update this full channel memory using existing memory + new events.",
        "- Keep long-term context useful for future execution turns.",
        "- Prefer durable decisions, constraints, active plans, and unresolved follow-ups.",
        "- Remove stale or superseded points when new events invalidate them.",
        "",
        `Agent: ${input.agent.name}`,
        `Channel: ${input.channelId}`,
        "",
        summaryText
          ? `Existing full memory:\n${summaryText}`
          : "Existing full memory: <none>",
        "",
        "New meaningful events to merge:",
        JSON.stringify(chunk.map(compactEvent), null, 2),
      ].join("\n"),
    );
    if (nextSummary) {
      summaryText = nextSummary;
    }
  }
  const nextLastProcessedAt = Math.max(
    maxEventTimestamp(newEvents),
    normalizeTimestamp(existing?.lastProcessedAt),
  );
  const nextRecord = await upsertChannelMemoryRecord(input.apiFetch, "full", {
    agentName: input.agent.name,
    channelId: input.channelId,
    summaryText,
    lastProcessedAt: nextLastProcessedAt,
    ...(getLastEventId(newEvents) ? { lastProcessedEventId: getLastEventId(newEvents) } : {}),
    ...(existing?.version !== undefined ? { expectedVersion: existing.version } : {}),
  });
  await input.emitEvent({
    type: "audit.memory.channel.full.updated",
    source: "system:runner:memory",
    status: "DELIVERED",
    channelId: input.channelId,
    payload: {
      agentName: input.agent.name,
      channelId: input.channelId,
      summaryChars: summaryText.length,
      eventCount: meaningfulNewEvents.length,
      lastProcessedAt: nextLastProcessedAt,
    },
  });
  return nextRecord;
}

function compactChannelMemoryInput(record: ChannelMemoryRecord) {
  return {
    channelId: record.channelId,
    summaryText: trimText(record.summaryText),
    lastProcessedAt: normalizeTimestamp(record.lastProcessedAt),
    updatedAt: normalizeTimestamp(record.updatedAt),
  };
}

async function refreshCrossChannelMemory(input: {
  agent: Agent;
  mode: CrossMemoryMode;
  channelIds: string[];
  apiFetch: ApiFetch;
  getEnv: () => Promise<Record<string, string>>;
  emitEvent: (event: unknown) => Promise<void>;
}): Promise<CrossChannelMemoryRecord | null> {
  const existing = await getCrossMemoryRecord(input.apiFetch, input.mode, input.agent.name);
  const channelMemories = await listChannelMemoryRecords(
    input.apiFetch,
    input.mode === "recent" ? "recent" : "full",
    input.agent.name,
    input.channelIds,
  );
  const usable = channelMemories.filter((record) => trimText(record.summaryText).length > 0);
  const maxProcessedAt = usable.reduce(
    (max, record) => Math.max(max, normalizeTimestamp(record.lastProcessedAt)),
    0,
  );
  if (
    existing &&
    maxProcessedAt <= normalizeTimestamp(existing.lastProcessedAt) &&
    usable.length > 0
  ) {
    return existing;
  }
  if (usable.length === 0) {
    if (existing) return existing;
    const emptyRecord = await upsertCrossMemoryRecord(input.apiFetch, input.mode, {
      agentName: input.agent.name,
      summaryText: "",
      ...(input.mode === "recent"
        ? { windowStartAt: Date.now() - RECENT_MEMORY_WINDOW_MS }
        : {}),
      lastProcessedAt: maxProcessedAt,
    });
    await input.emitEvent({
      type:
        input.mode === "recent"
          ? "audit.memory.cross.recent.updated"
          : "audit.memory.cross.full.updated",
      source: "system:runner:memory",
      status: "DELIVERED",
      payload: {
        agentName: input.agent.name,
        summaryChars: 0,
        channelsConsidered: 0,
        lastProcessedAt: maxProcessedAt,
      },
    });
    return emptyRecord;
  }
  const summaryText = await summarizeText(
    input.agent,
    await input.getEnv(),
    input.mode === "recent"
      ? "You summarize recent cross-channel context (last 10 minutes) for agent execution. Return plain text only."
      : "You maintain full cross-channel memory for agent execution. Return plain text only.",
    [
      input.mode === "recent"
        ? "Produce a single cross-channel summary for the latest 10-minute context."
        : "Produce/refresh a full cross-channel memory summary.",
      "- Synthesize overlaps and dependencies across channels.",
      "- Highlight blockers, assignments, pending follow-ups, and open decisions.",
      "- Keep concise but execution-ready.",
      "",
      `Agent: ${input.agent.name}`,
      "",
      existing?.summaryText
        ? `Existing cross-channel memory:\n${existing.summaryText}`
        : "Existing cross-channel memory: <none>",
      "",
      "Per-channel memory inputs:",
      JSON.stringify(
        usable.slice(0, MAX_CROSS_CHANNEL_INPUTS).map(compactChannelMemoryInput),
        null,
        2,
      ),
    ].join("\n"),
  );
  const finalSummary = summaryText || existing?.summaryText || "";
  const nextRecord = await upsertCrossMemoryRecord(input.apiFetch, input.mode, {
    agentName: input.agent.name,
    summaryText: finalSummary,
    ...(input.mode === "recent"
      ? { windowStartAt: Date.now() - RECENT_MEMORY_WINDOW_MS }
      : {}),
    lastProcessedAt: maxProcessedAt,
    ...(usable[usable.length - 1]?.lastProcessedEventId
      ? { lastProcessedEventId: usable[usable.length - 1]?.lastProcessedEventId }
      : {}),
    ...(existing?.version !== undefined ? { expectedVersion: existing.version } : {}),
  });
  await input.emitEvent({
    type:
      input.mode === "recent"
        ? "audit.memory.cross.recent.updated"
        : "audit.memory.cross.full.updated",
    source: "system:runner:memory",
    status: "DELIVERED",
    payload: {
      agentName: input.agent.name,
      summaryChars: finalSummary.length,
      channelsConsidered: usable.length,
      lastProcessedAt: maxProcessedAt,
      ...(input.mode === "recent"
        ? { windowStartAt: Date.now() - RECENT_MEMORY_WINDOW_MS }
        : {}),
    },
  });
  return nextRecord;
}

export async function refreshCrossChannelRecentMemory(input: {
  agent: Agent;
  channelIds: string[];
  apiFetch: ApiFetch;
  getEnv: () => Promise<Record<string, string>>;
  emitEvent: (event: unknown) => Promise<void>;
}): Promise<CrossChannelMemoryRecord | null> {
  return refreshCrossChannelMemory({
    ...input,
    mode: "recent",
  });
}

export async function refreshCrossChannelFullMemory(input: {
  agent: Agent;
  channelIds: string[];
  apiFetch: ApiFetch;
  getEnv: () => Promise<Record<string, string>>;
  emitEvent: (event: unknown) => Promise<void>;
}): Promise<CrossChannelMemoryRecord | null> {
  return refreshCrossChannelMemory({
    ...input,
    mode: "full",
  });
}

export async function getChannelRecentMemoryRecord(
  apiFetch: ApiFetch,
  agentName: string,
  channelId: string,
): Promise<ChannelMemoryRecord | null> {
  return getChannelMemoryRecord(apiFetch, "recent", agentName, channelId);
}

export async function getChannelFullMemoryRecord(
  apiFetch: ApiFetch,
  agentName: string,
  channelId: string,
): Promise<ChannelMemoryRecord | null> {
  return getChannelMemoryRecord(apiFetch, "full", agentName, channelId);
}

export async function getCrossRecentMemoryRecord(
  apiFetch: ApiFetch,
  agentName: string,
): Promise<CrossChannelMemoryRecord | null> {
  return getCrossMemoryRecord(apiFetch, "recent", agentName);
}

export async function getCrossFullMemoryRecord(
  apiFetch: ApiFetch,
  agentName: string,
): Promise<CrossChannelMemoryRecord | null> {
  return getCrossMemoryRecord(apiFetch, "full", agentName);
}

export async function listEventsAfterTimestamp(
  apiFetch: ApiFetch,
  channelId: string,
  afterExclusive?: number,
): Promise<Event[]> {
  return listChannelEventsAfter(apiFetch, channelId, afterExclusive);
}

export function getMeaningfulEvents(events: Event[]): Event[] {
  return events.filter(isMeaningfulEvent);
}

export function buildSystemMemoryMessage(title: string, summaryText: string): string {
  return `${title}\n${summaryText.trim()}`;
}

export function buildChannelRecentDeltaSystemMessage(input: {
  channelId: string;
  events: Event[];
}): string {
  const compacted = input.events.slice(-MAX_EVENTS_PER_PROMPT).map(compactEvent);
  return [
    `Channel Delta Events Since Last Summary (${input.channelId})`,
    "These are the newest meaningful events after the latest recent channel summary.",
    JSON.stringify(compacted, null, 2),
  ].join("\n");
}
