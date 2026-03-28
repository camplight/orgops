import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@orgops/llm";
import type { Agent, Event } from "./types";

export const DEFAULT_CONTEXT_SESSION_GAP_MS = 300_000;
const MEMORY_RELATIVE_PATH = "memory/memory.md";
const MAX_MEMORY_CONTEXT_CHARS = 20_000;
const MAX_MEMORY_ITEMS = 40;
const MAX_MEMORY_PROMPT_CHARS = 25_000;

function normalizeTs(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 0;
}

export function resolveAgentContextSessionGapMs(agent: Agent): number {
  const configured = agent.contextSessionGapMs;
  if (typeof configured === "number" && Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured);
  }
  return DEFAULT_CONTEXT_SESSION_GAP_MS;
}

function sortByCreatedAt(events: Event[]): Event[] {
  return events.slice().sort((left, right) => normalizeTs(left.createdAt) - normalizeTs(right.createdAt));
}

export function getCurrentSessionEvents(events: Event[], sessionGapMs: number): Event[] {
  const ordered = sortByCreatedAt(events);
  if (ordered.length <= 1) return ordered;
  let startIndex = ordered.length - 1;
  for (let index = ordered.length - 1; index > 0; index -= 1) {
    const currentTs = normalizeTs(ordered[index]?.createdAt);
    const previousTs = normalizeTs(ordered[index - 1]?.createdAt);
    if (currentTs - previousTs > sessionGapMs) break;
    startIndex = index - 1;
  }
  return ordered.slice(startIndex);
}

function compactEventsForPrompt(events: Event[]) {
  return events.map((event) => ({
    id: event.id,
    createdAt: normalizeTs(event.createdAt),
    type: event.type,
    source: event.source,
    payload: event.payload ?? {},
  }));
}

function parseSummaryPayload(event: Event): {
  summary?: string;
  sessionEndAt?: number;
} {
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) {
    return {};
  }
  const payload = event.payload as { summary?: unknown; sessionEndAt?: unknown };
  return {
    summary: typeof payload.summary === "string" ? payload.summary : undefined,
    sessionEndAt: normalizeTs(payload.sessionEndAt),
  };
}

export async function ensureChannelSessionSummary(input: {
  agent: Agent;
  channelId: string;
  events: Event[];
  sessionGapMs: number;
  env: Record<string, string>;
  emitEvent: (event: unknown) => Promise<void>;
}): Promise<boolean> {
  const sessionEvents = getCurrentSessionEvents(input.events, input.sessionGapMs);
  const meaningfulEvents = sessionEvents.filter(
    (event) => event.type !== "session.summary.created" && !event.type.startsWith("audit."),
  );
  if (meaningfulEvents.length < 2) return false;
  const sessionEndAt = normalizeTs(meaningfulEvents[meaningfulEvents.length - 1]?.createdAt);
  const latestSummary = [...sessionEvents]
    .reverse()
    .find((event) => event.type === "session.summary.created");
  if (latestSummary) {
    const payload = parseSummaryPayload(latestSummary);
    if (
      typeof payload.summary === "string" &&
      payload.summary.trim().length > 0 &&
      normalizeTs(payload.sessionEndAt) >= sessionEndAt
    ) {
      return false;
    }
  }
  const summaryPrompt = [
    "Summarize this OrgOps channel session for context compression.",
    "- Focus on durable decisions, active tasks, blockers, and open questions.",
    "- Keep it concise and factual.",
    "- Return plain text only.",
    "",
    `Agent: ${input.agent.name}`,
    `Channel: ${input.channelId}`,
    "Session events:",
    JSON.stringify(compactEventsForPrompt(meaningfulEvents), null, 2),
  ].join("\n");
  const summaryResult = await generate(
    input.agent.modelId,
    [
      {
        role: "system",
        content: "You produce concise session summaries for prompt context.",
      },
      {
        role: "user",
        content: summaryPrompt,
      },
    ],
    {
      temperature: 0.2,
      env: input.env,
    },
  );
  const summary = (summaryResult.text ?? "").trim();
  if (!summary) return false;
  await input.emitEvent({
    type: "session.summary.created",
    source: "system:runner:session-summary",
    status: "DELIVERED",
    channelId: input.channelId,
    payload: {
      agentName: input.agent.name,
      summary,
      sessionStartAt: normalizeTs(meaningfulEvents[0]?.createdAt),
      sessionEndAt,
      eventCount: meaningfulEvents.length,
    },
  });
  return true;
}

function ensureMemoryFile(workspacePath: string): string {
  const memoryFilePath = join(workspacePath, MEMORY_RELATIVE_PATH);
  mkdirSync(join(workspacePath, "memory"), { recursive: true });
  if (!existsSync(memoryFilePath)) {
    writeFileSync(memoryFilePath, "# Memory\n\n", "utf-8");
  }
  return memoryFilePath;
}

export function loadAgentMemoryContext(agent: Agent): string {
  const memoryFilePath = ensureMemoryFile(agent.workspacePath);
  const raw = readFileSync(memoryFilePath, "utf-8");
  if (raw.length <= MAX_MEMORY_CONTEXT_CHARS) return raw;
  return raw.slice(-MAX_MEMORY_CONTEXT_CHARS);
}

function extractJsonObject(rawText: string): unknown {
  const text = rawText.trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (!fenced?.[1]) return {};
    return JSON.parse(fenced[1]);
  }
}

function parseMemoryItems(raw: unknown): string[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const items = (raw as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0)
    .slice(0, MAX_MEMORY_ITEMS);
}

function normalizeMemoryItem(item: string): string {
  return item.replace(/\s+/g, " ").trim();
}

function memoryDedupKey(item: string): string {
  return normalizeMemoryItem(item)
    .toLowerCase()
    .replace(/[.,;:!?'"`*_~()[\]{}]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseExistingMemoryItems(memoryText: string): string[] {
  return memoryText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => normalizeMemoryItem(line.slice(2)))
    .filter((line) => line.length > 0);
}

function uniqueItems(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const normalized = normalizeMemoryItem(item);
    if (!normalized) continue;
    const key = memoryDedupKey(normalized);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= MAX_MEMORY_ITEMS) break;
  }
  return out;
}

function truncateForPrompt(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(-maxChars);
}

function renderMemoryFile(items: string[]): string {
  const nowIso = new Date().toISOString();
  const lines = [
    "# Memory",
    "",
    `Updated: ${nowIso}`,
    "",
    "## Durable Notes",
    ...items.map((item) => `- ${item}`),
    "",
  ];
  return lines.join("\n");
}

export async function refreshAgentLocalMemory(input: {
  agent: Agent;
  channelId: string;
  events: Event[];
  sessionGapMs: number;
  env: Record<string, string>;
  lifecycleChannelId: string;
  emitEvent: (event: unknown) => Promise<void>;
}): Promise<void> {
  const sessionEvents = getCurrentSessionEvents(input.events, input.sessionGapMs).filter(
    (event) => event.type !== "session.summary.created" && !event.type.startsWith("audit."),
  );
  if (sessionEvents.length < 2) return;
  const memoryFilePath = ensureMemoryFile(input.agent.workspacePath);
  const existingMemory = readFileSync(memoryFilePath, "utf-8");
  const prompt = [
    "Refresh this agent's durable memory snapshot.",
    "Take existing memory and latest session events, then produce a compact merged list.",
    "Keep only durable facts: decisions, stable constraints, preferences, commitments, unresolved follow-ups.",
    "Exclude transient chatter and anything secret-looking.",
    "De-duplicate aggressively: if two entries overlap in meaning, keep only one canonical entry.",
    "Ensure every returned item is unique (including near-duplicates with different wording, punctuation, or casing).",
    "Keep at most 40 items.",
    "Return strict JSON only: {\"items\":[\"...\"]}",
    "",
    `Agent: ${input.agent.name}`,
    `Channel: ${input.channelId}`,
    "Existing memory markdown:",
    truncateForPrompt(existingMemory, MAX_MEMORY_PROMPT_CHARS),
    "",
    "Session events:",
    JSON.stringify(compactEventsForPrompt(sessionEvents.slice(-40)), null, 2),
  ].join("\n");
  const result = await generate(
    input.agent.modelId,
    [
      { role: "system", content: "You extract concise durable memory entries. Return JSON only." },
      { role: "user", content: prompt },
    ],
    {
      temperature: 0.2,
      env: input.env,
    },
  );
  const llmItems = parseMemoryItems(extractJsonObject(result.text ?? ""));
  const fallbackItems = uniqueItems([
    ...parseExistingMemoryItems(existingMemory),
    ...llmItems,
  ]);
  const mergedItems = uniqueItems(
    llmItems.length > 0
      ? [...llmItems, ...fallbackItems]
      : fallbackItems,
  );
  if (mergedItems.length === 0) return;
  const nextMemoryText = renderMemoryFile(mergedItems);
  if (nextMemoryText !== existingMemory) {
    writeFileSync(memoryFilePath, nextMemoryText, "utf-8");
  }
  await input.emitEvent({
    type: "audit.local-memory.recorded",
    source: "system:runner:local-memory",
    status: "DELIVERED",
    channelId: input.lifecycleChannelId,
    payload: {
      agentName: input.agent.name,
      filePath: memoryFilePath,
      entriesWritten: mergedItems.length,
      channelsProcessed: 1,
      recycled: true,
    },
  });
}
