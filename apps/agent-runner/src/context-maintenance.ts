import { createHash } from "node:crypto";
import { generate } from "@orgops/llm";
import { recordLlmUsage } from "./billing";
import { listChannelEventsAfter } from "./channel-events";
import { getLatestContextBoundary } from "./context-boundary";
import type { Agent, Event } from "./types";

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

export const RECENT_MEMORY_WINDOW_MS = 600_000;
const MAX_EVENTS_PER_PROMPT = 120;
const MAX_CROSS_CHANNEL_INPUTS = 80;
const DEFAULT_MEMORY_SUMMARY_MAX_CHARS = 24_000;
const DEFAULT_MEMORY_PROMPT_SUMMARY_MAX_CHARS = 16_000;

function normalizeTimestamp(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 0;
}

function isMeaningfulEvent(event: Event): boolean {
  const excludedPrefixes = [
    "audit.",
    "telemetry.",
    "tool.",
    "process.",
    "voice.",
    "wrapper.",
    "agent.turn.",
    "agent.control.",
    "agent.context.",
    "agent.lifecycle.",
    "memory.",
    "scheduler.",
  ];
  if (excludedPrefixes.some((prefix) => event.type.startsWith(prefix))) return false;
  if (
    event.type === "noop" ||
    event.type === "event.deadlettered" ||
    event.source === "system:scheduler"
  ) {
    return false;
  }
  const source = String(event.source ?? "");
  return (
    source.startsWith("human:") ||
    source.startsWith("agent:") ||
    (!source.startsWith("system:") && event.type.includes("."))
  );
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

function readPositiveIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const MEMORY_SUMMARY_MAX_CHARS = readPositiveIntEnv(
  process.env.ORGOPS_MEMORY_SUMMARY_MAX_CHARS,
  DEFAULT_MEMORY_SUMMARY_MAX_CHARS,
);
const MEMORY_PROMPT_SUMMARY_MAX_CHARS = readPositiveIntEnv(
  process.env.ORGOPS_MEMORY_PROMPT_SUMMARY_MAX_CHARS,
  DEFAULT_MEMORY_PROMPT_SUMMARY_MAX_CHARS,
);

function clampSummaryText(text: string, maxChars: number): string {
  const normalized = trimText(text);
  if (normalized.length <= maxChars) return normalized;
  const omitted = normalized.length - maxChars;
  return `${normalized.slice(0, maxChars)}\n...[truncated ${omitted} chars]`;
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
  inputSignature?: string;
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
    expectedVersion?: number | null;
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

function isVersionConflict(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  if (status === 409) return true;
  return error instanceof Error && error.message.includes("failed: 409");
}

/**
 * Background maintenance holds an optimistic version across a slow summarization
 * call, so an agent memory tool writing the same record mid-pass legitimately wins.
 * Losing the race is a no-op for this pass: keep whatever is stored now.
 */
async function upsertOrKeepNewer<T>(
  upsert: () => Promise<T>,
  reread: () => Promise<T | null>,
): Promise<T | null> {
  try {
    return await upsert();
  } catch (error) {
    if (!isVersionConflict(error)) throw error;
    return await reread();
  }
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
    inputSignature: string;
    expectedVersion?: number | null;
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
  apiFetch: ApiFetch,
  channelId: string | undefined,
  purpose: string,
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
      openaiCompatibleReasoningEffort:
        agent.openaiCompatibleReasoningEffort ?? undefined,
      env,
    },
  );
  await recordLlmUsage(apiFetch, {
    channelId,
    agentName: agent.name,
    modelId: agent.modelId,
    runtime: "memory",
    purpose,
    usage: result.usage,
  });
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

function isCurrentlyDeliverable(event: Event, now: number): boolean {
  return !event.deliverAt || event.deliverAt <= now;
}

/**
 * Summaries may only claim contiguous createdAt coverage. Skipping a not-yet-due
 * event and watermarking a later due event would permanently hide the skipped
 * event from both memory refreshes and prompt "events after coverage" queries.
 */
function contiguousDeliverablePrefix(events: Event[], now: number): Event[] {
  const ordered = events
    .slice()
    .sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0));
  const prefix: Event[] = [];
  for (const event of ordered) {
    if (!isCurrentlyDeliverable(event, now)) break;
    prefix.push(event);
  }
  return prefix;
}

export async function refreshChannelRecentMemory(input: {
  agent: Agent;
  channelId: string;
  apiFetch: ApiFetch;
  getEnv: () => Promise<Record<string, string>>;
}): Promise<ChannelMemoryRecord | null> {
  const now = Date.now();
  const windowStartAt = now - RECENT_MEMORY_WINDOW_MS;
  const [storedExisting, boundary] = await Promise.all([
    getChannelMemoryRecord(
      input.apiFetch,
      "recent",
      input.agent.name,
      input.channelId,
    ),
    getLatestContextBoundary(input.apiFetch, input.agent.name, input.channelId),
  ]);
  const existing =
    storedExisting &&
    normalizeTimestamp(storedExisting.lastProcessedAt) >=
      normalizeTimestamp(boundary?.cutoffAt)
      ? storedExisting
      : null;
  const events = await listChannelEventsAfter(
    input.apiFetch,
    input.channelId,
    Math.max(0, windowStartAt - 1, normalizeTimestamp(boundary?.cutoffAt)),
  );
  const meaningfulEvents = contiguousDeliverablePrefix(events, now).filter(
    isMeaningfulEvent,
  );
  if (meaningfulEvents.length === 0) {
    const currentBoundary = await getLatestContextBoundary(
      input.apiFetch,
      input.agent.name,
      input.channelId,
    );
    if (currentBoundary?.eventId !== boundary?.eventId) {
      return getChannelMemoryRecord(
        input.apiFetch,
        "recent",
        input.agent.name,
        input.channelId,
      );
    }
    const emptyRecord = await upsertChannelMemoryRecord(input.apiFetch, "recent", {
      agentName: input.agent.name,
      channelId: input.channelId,
      summaryText: "",
      windowStartAt,
      lastProcessedAt: 0,
      expectedVersion: existing?.version ?? null,
    });
    return emptyRecord;
  }
  let summaryText = "";
  let processedEvents: Event[] = [];
  for (const chunk of chunkEvents(meaningfulEvents, MAX_EVENTS_PER_PROMPT)) {
    const summary = await summarizeText(
      input.agent,
      await input.getEnv(),
      input.apiFetch,
      input.channelId,
      "memory.channel.recent",
      "You summarize only the supplied current 10-minute channel window. Keep it concise, factual, and action-oriented. Return plain text only.",
      [
        "Produce a current-window channel summary for agent execution context.",
        "- Include active tasks, decisions, blockers, and unresolved questions.",
        "- Do not preserve facts merely because they appeared in an older recent summary.",
        "",
        `Agent: ${input.agent.name}`,
        `Channel: ${input.channelId}`,
        `WindowStartAt: ${windowStartAt}`,
        summaryText ? `Current summary built in this pass:\n${summaryText}` : "Current summary: <none>",
        "",
        "Next meaningful events (ordered):",
        JSON.stringify(chunk.map(compactEvent), null, 2),
      ].join("\n"),
    );
    if (!summary) return existing;
    summaryText = clampSummaryText(summary, MEMORY_SUMMARY_MAX_CHARS);
    processedEvents = processedEvents.concat(chunk);
  }
  const currentBoundary = await getLatestContextBoundary(
    input.apiFetch,
    input.agent.name,
    input.channelId,
  );
  if (currentBoundary?.eventId !== boundary?.eventId) {
    return getChannelMemoryRecord(
      input.apiFetch,
      "recent",
      input.agent.name,
      input.channelId,
    );
  }
  return await upsertOrKeepNewer(
    () =>
      upsertChannelMemoryRecord(input.apiFetch, "recent", {
        agentName: input.agent.name,
        channelId: input.channelId,
        summaryText,
        windowStartAt,
        lastProcessedAt: maxEventTimestamp(processedEvents),
        ...(getLastEventId(processedEvents)
          ? { lastProcessedEventId: getLastEventId(processedEvents) }
          : {}),
        expectedVersion: existing?.version ?? null,
      }),
    () =>
      getChannelMemoryRecord(input.apiFetch, "recent", input.agent.name, input.channelId),
  );
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
}): Promise<ChannelMemoryRecord | null> {
  const [storedExisting, boundary] = await Promise.all([
    getChannelMemoryRecord(
      input.apiFetch,
      "full",
      input.agent.name,
      input.channelId,
    ),
    getLatestContextBoundary(input.apiFetch, input.agent.name, input.channelId),
  ]);
  const existing =
    storedExisting &&
    normalizeTimestamp(storedExisting.lastProcessedAt) >=
      normalizeTimestamp(boundary?.cutoffAt)
      ? storedExisting
      : null;
  const after = Math.max(
    normalizeTimestamp(existing?.lastProcessedAt),
    normalizeTimestamp(boundary?.cutoffAt),
  );
  const newEvents = await listChannelEventsAfter(
    input.apiFetch,
    input.channelId,
    after > 0 ? after : undefined,
  );
  const now = Date.now();
  const meaningfulNewEvents = contiguousDeliverablePrefix(newEvents, now).filter(
    isMeaningfulEvent,
  );
  if (meaningfulNewEvents.length === 0) {
    if (existing) return existing;
    const currentBoundary = await getLatestContextBoundary(
      input.apiFetch,
      input.agent.name,
      input.channelId,
    );
    if (currentBoundary?.eventId !== boundary?.eventId) {
      return getChannelMemoryRecord(
        input.apiFetch,
        "full",
        input.agent.name,
        input.channelId,
      );
    }
    return await upsertOrKeepNewer(
      () =>
        upsertChannelMemoryRecord(input.apiFetch, "full", {
          agentName: input.agent.name,
          channelId: input.channelId,
          summaryText:
            boundary?.kind === "compact" ? boundary.summary ?? "" : "",
          lastProcessedAt: after,
          ...(boundary?.cutoffEventId || boundary?.eventId
            ? { lastProcessedEventId: boundary.cutoffEventId ?? boundary.eventId }
            : {}),
          expectedVersion: storedExisting?.version ?? null,
        }),
      () =>
        getChannelMemoryRecord(
          input.apiFetch,
          "full",
          input.agent.name,
          input.channelId,
        ),
    );
  }
  const chunks = chunkEvents(meaningfulNewEvents, MAX_EVENTS_PER_PROMPT);
  let summaryText = clampSummaryText(
    existing?.summaryText ??
      (boundary?.kind === "compact" ? boundary.summary ?? "" : ""),
    MEMORY_SUMMARY_MAX_CHARS,
  );
  const processedEvents: Event[] = [];
  for (const chunk of chunks) {
    const nextSummary = await summarizeText(
      input.agent,
      await input.getEnv(),
      input.apiFetch,
      input.channelId,
      "memory.channel.full",
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
    if (!nextSummary) break;
    summaryText = clampSummaryText(nextSummary, MEMORY_SUMMARY_MAX_CHARS);
    processedEvents.push(...chunk);
  }
  if (processedEvents.length === 0) return existing;
  const nextLastProcessedAt = Math.max(
    maxEventTimestamp(processedEvents),
    normalizeTimestamp(existing?.lastProcessedAt),
    normalizeTimestamp(boundary?.cutoffAt),
  );
  const currentBoundary = await getLatestContextBoundary(
    input.apiFetch,
    input.agent.name,
    input.channelId,
  );
  if (currentBoundary?.eventId !== boundary?.eventId) {
    return getChannelMemoryRecord(
      input.apiFetch,
      "full",
      input.agent.name,
      input.channelId,
    );
  }
  return await upsertOrKeepNewer(
    () =>
      upsertChannelMemoryRecord(input.apiFetch, "full", {
        agentName: input.agent.name,
        channelId: input.channelId,
        summaryText,
        lastProcessedAt: nextLastProcessedAt,
        ...(getLastEventId(processedEvents)
          ? { lastProcessedEventId: getLastEventId(processedEvents) }
          : {}),
        expectedVersion: existing?.version ?? null,
      }),
    () => getChannelMemoryRecord(input.apiFetch, "full", input.agent.name, input.channelId),
  );
}

function compactChannelMemoryInput(record: ChannelMemoryRecord) {
  return {
    channelId: record.channelId,
    summaryText: clampSummaryText(record.summaryText, MEMORY_PROMPT_SUMMARY_MAX_CHARS),
    lastProcessedAt: normalizeTimestamp(record.lastProcessedAt),
    updatedAt: normalizeTimestamp(record.updatedAt),
  };
}

function buildCrossInputSignature(
  mode: CrossMemoryMode,
  channelIds: string[],
  records: ChannelMemoryRecord[],
  boundarySignature: string,
): string {
  const byChannel = new Map(records.map((record) => [record.channelId, record]));
  const canonical = [...new Set(channelIds)]
    .sort()
    .map((channelId) => {
      const record = byChannel.get(channelId);
      return {
        channelId,
        version: record?.version ?? 0,
        lastProcessedAt: record?.lastProcessedAt ?? 0,
        lastProcessedEventId: record?.lastProcessedEventId ?? "",
        summaryHash: createHash("sha256").update(record?.summaryText ?? "").digest("hex"),
      };
    });
  return createHash("sha256")
    .update(JSON.stringify({ mode, boundarySignature, channels: canonical }))
    .digest("hex");
}

async function getContextBoundarySignature(
  apiFetch: ApiFetch,
  agentName: string,
  channelIds: string[],
): Promise<string> {
  const entries = await Promise.all(
    [...channelIds]
      .sort()
      .map(async (channelId) => {
        const boundary = await getLatestContextBoundary(
          apiFetch,
          agentName,
          channelId,
        );
        return `${channelId}:${boundary?.eventId ?? ""}`;
      }),
  );
  return entries.join("|");
}

async function refreshCrossChannelMemory(input: {
  agent: Agent;
  mode: CrossMemoryMode;
  channelIds: string[];
  apiFetch: ApiFetch;
  getEnv: () => Promise<Record<string, string>>;
}): Promise<CrossChannelMemoryRecord | null> {
  const boundarySignature = await getContextBoundarySignature(
    input.apiFetch,
    input.agent.name,
    input.channelIds,
  );
  const existing = await getCrossMemoryRecord(input.apiFetch, input.mode, input.agent.name);
  const channelMemories = await listChannelMemoryRecords(
    input.apiFetch,
    input.mode === "recent" ? "recent" : "full",
    input.agent.name,
    input.channelIds,
  );
  const inputSignature = buildCrossInputSignature(
    input.mode,
    input.channelIds,
    channelMemories,
    boundarySignature,
  );
  const usable = channelMemories.filter((record) => trimText(record.summaryText).length > 0);
  const maxProcessedAt = usable.reduce(
    (max, record) => Math.max(max, normalizeTimestamp(record.lastProcessedAt)),
    0,
  );
  if (
    existing &&
    existing.inputSignature === inputSignature
  ) {
    return existing;
  }
  if (usable.length === 0) {
    const currentBoundarySignature = await getContextBoundarySignature(
      input.apiFetch,
      input.agent.name,
      input.channelIds,
    );
    const currentChannelMemories = await listChannelMemoryRecords(
      input.apiFetch,
      input.mode === "recent" ? "recent" : "full",
      input.agent.name,
      input.channelIds,
    );
    const currentInputSignature = buildCrossInputSignature(
      input.mode,
      input.channelIds,
      currentChannelMemories,
      currentBoundarySignature,
    );
    if (currentInputSignature !== inputSignature) {
      return getCrossMemoryRecord(input.apiFetch, input.mode, input.agent.name);
    }
    const emptyRecord = await upsertCrossMemoryRecord(input.apiFetch, input.mode, {
      agentName: input.agent.name,
      summaryText: "",
      ...(input.mode === "recent"
        ? { windowStartAt: Date.now() - RECENT_MEMORY_WINDOW_MS }
        : {}),
      lastProcessedAt: maxProcessedAt,
      inputSignature,
      expectedVersion: existing?.version ?? null,
    });
    return emptyRecord;
  }
  let finalSummary =
    input.mode === "full"
      ? clampSummaryText(existing?.summaryText ?? "", MEMORY_SUMMARY_MAX_CHARS)
      : "";
  for (const chunk of chunkEvents(usable, MAX_CROSS_CHANNEL_INPUTS)) {
    const summaryText = await summarizeText(
      input.agent,
      await input.getEnv(),
      input.apiFetch,
      undefined,
      `memory.cross.${input.mode}`,
      input.mode === "recent"
        ? "You summarize only the supplied current cross-channel window. Return plain text only."
        : "You maintain full cross-channel memory for agent execution. Return plain text only.",
      [
        input.mode === "recent"
          ? "Produce a single cross-channel summary for the latest 10-minute context."
          : "Produce/refresh a full cross-channel memory summary.",
        "- Synthesize overlaps and dependencies across channels.",
        "- Highlight blockers, assignments, pending follow-ups, and open decisions.",
        "",
        `Agent: ${input.agent.name}`,
        finalSummary
          ? `Summary built so far:\n${finalSummary}`
          : "Summary built so far: <none>",
        "",
        "Next per-channel memory inputs:",
        JSON.stringify(chunk.map(compactChannelMemoryInput), null, 2),
      ].join("\n"),
    );
    if (!summaryText) return existing;
    finalSummary = clampSummaryText(summaryText, MEMORY_SUMMARY_MAX_CHARS);
  }
  const currentBoundarySignature = await getContextBoundarySignature(
    input.apiFetch,
    input.agent.name,
    input.channelIds,
  );
  const currentChannelMemories = await listChannelMemoryRecords(
    input.apiFetch,
    input.mode === "recent" ? "recent" : "full",
    input.agent.name,
    input.channelIds,
  );
  const currentInputSignature = buildCrossInputSignature(
    input.mode,
    input.channelIds,
    currentChannelMemories,
    currentBoundarySignature,
  );
  if (currentInputSignature !== inputSignature) {
    return getCrossMemoryRecord(input.apiFetch, input.mode, input.agent.name);
  }
  return await upsertOrKeepNewer(
    () =>
      upsertCrossMemoryRecord(input.apiFetch, input.mode, {
        agentName: input.agent.name,
        summaryText: finalSummary,
        ...(input.mode === "recent"
          ? { windowStartAt: Date.now() - RECENT_MEMORY_WINDOW_MS }
          : {}),
        lastProcessedAt: maxProcessedAt,
        inputSignature,
        ...(usable[usable.length - 1]?.lastProcessedEventId
          ? { lastProcessedEventId: usable[usable.length - 1]?.lastProcessedEventId }
          : {}),
        expectedVersion: existing?.version ?? null,
      }),
    () => getCrossMemoryRecord(input.apiFetch, input.mode, input.agent.name),
  );
}

export async function refreshCrossChannelRecentMemory(input: {
  agent: Agent;
  channelIds: string[];
  apiFetch: ApiFetch;
  getEnv: () => Promise<Record<string, string>>;
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
  return `${title}\n${clampSummaryText(summaryText, MEMORY_PROMPT_SUMMARY_MAX_CHARS)}`;
}