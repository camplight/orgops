import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, hostname, release } from "node:os";
import { join, resolve } from "node:path";
import { generate } from "@orgops/llm";
import {
  listSkills,
  loadSkillEventShapes,
  resolveSkillRoot,
} from "@orgops/skills";
import {
  type EventValidationResult,
  type EventTypeSummary,
  getCoreEventShapes,
  serializeEventShapes,
  validateEventAgainstShapes,
} from "@orgops/schemas";
import { createRunnerTools, executeTool } from "./tools";
import { stopAllRunningProcesses } from "./tools/shell";
import { createChannelLoopManager } from "./channel-loop";
import { pullInjectedEventMessages } from "./channel-injection";
import { shouldHandleEventForAgent } from "./event-routing";
import { getReservedEventTypeError } from "./event-type-guard";
import { createMaintenanceLoop } from "./maintenance-loop";
import type { Agent, Event } from "./types";
import { buildRunnerGuidance } from "./prompt";
import { buildPromptEventRecord } from "./prompt-event-compact";
import { runRlmEventInChild, stopAllRlmChildren } from "./rlm-process";
import {
  buildChannelRecentDeltaSystemMessage,
  buildSystemMemoryMessage,
  getChannelFullMemoryRecord,
  getChannelRecentMemoryRecord,
  getCrossFullMemoryRecord,
  getCrossRecentMemoryRecord,
  getMeaningfulEvents,
  listEventsAfterTimestamp,
} from "./context-maintenance";

const API_URL = process.env.ORGOPS_API_URL ?? "http://localhost:8787";
const PROJECT_ROOT = (() => {
  const envRoot = process.env.ORGOPS_PROJECT_ROOT;
  if (envRoot) return envRoot;
  const cwd = process.cwd();
  const candidate = resolve(cwd, "../..");
  return existsSync(join(candidate, "package.json")) ? candidate : cwd;
})();
const SKILL_ROOT = resolveSkillRoot(PROJECT_ROOT);
const RUNNER_ID_FILE = process.env.ORGOPS_RUNNER_ID_FILE
  ? resolve(PROJECT_ROOT, process.env.ORGOPS_RUNNER_ID_FILE)
  : resolve(PROJECT_ROOT, ".agent-runner-id");

const heartbeats = new Map<string, number>();
const bootstrappedAgents = new Set<string>();
const lifecycleChannels = new Map<string, string>();
const HEARTBEAT_INTERVAL_MS = 5000;
const DEFAULT_CHANNEL_RECENT_MEMORY_INTERVAL_MS = 10_000;
const DEFAULT_CHANNEL_FULL_MEMORY_INTERVAL_MS = 60_000;
const DEFAULT_CROSS_RECENT_MEMORY_INTERVAL_MS = 15_000;
const DEFAULT_CROSS_FULL_MEMORY_INTERVAL_MS = 120_000;
const DEFAULT_MAX_HISTORY_EVENTS = 120;
const DEFAULT_MAX_HISTORY_CHARS = 120_000;
let apiFetchRequestCounter = 0;
let registeredRunnerId: string | null = null;
let lastRunnerHeartbeatAt = 0;

function readPositiveIntEnv(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const HISTORY_MAX_EVENTS = readPositiveIntEnv(
  process.env.ORGOPS_HISTORY_MAX_EVENTS,
  DEFAULT_MAX_HISTORY_EVENTS,
);
const HISTORY_MAX_CHARS = readPositiveIntEnv(
  process.env.ORGOPS_HISTORY_MAX_CHARS,
  DEFAULT_MAX_HISTORY_CHARS,
);
const DEFAULT_LLM_CALL_TIMEOUT_MS = 10_800_000;
const DEFAULT_CLASSIC_MAX_MODEL_STEPS = 100;
const LLM_CALL_TIMEOUT_MS = readPositiveIntEnv(
  process.env.ORGOPS_LLM_CALL_TIMEOUT_MS,
  DEFAULT_LLM_CALL_TIMEOUT_MS,
);
const CHANNEL_RECENT_MEMORY_INTERVAL_MS = readPositiveIntEnv(
  process.env.ORGOPS_CHANNEL_RECENT_MEMORY_INTERVAL_MS,
  DEFAULT_CHANNEL_RECENT_MEMORY_INTERVAL_MS,
);
const CHANNEL_FULL_MEMORY_INTERVAL_MS = readPositiveIntEnv(
  process.env.ORGOPS_CHANNEL_FULL_MEMORY_INTERVAL_MS,
  DEFAULT_CHANNEL_FULL_MEMORY_INTERVAL_MS,
);
const CROSS_RECENT_MEMORY_INTERVAL_MS = readPositiveIntEnv(
  process.env.ORGOPS_CROSS_RECENT_MEMORY_INTERVAL_MS,
  DEFAULT_CROSS_RECENT_MEMORY_INTERVAL_MS,
);
const CROSS_FULL_MEMORY_INTERVAL_MS = readPositiveIntEnv(
  process.env.ORGOPS_CROSS_FULL_MEMORY_INTERVAL_MS,
  DEFAULT_CROSS_FULL_MEMORY_INTERVAL_MS,
);

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function getSkillMarkdownContents(skillPath: string): string | null {
  try {
    return readFileSync(join(skillPath, "SKILL.md"), "utf-8");
  } catch {
    return null;
  }
}

function queryEventTypes(
  eventTypes: EventTypeSummary[],
  input?: { source?: string; typePrefix?: string },
): EventTypeSummary[] {
  const source = input?.source?.trim();
  const typePrefix = input?.typePrefix?.trim();
  return eventTypes.filter((eventType) => {
    if (source && eventType.source !== source) return false;
    if (typePrefix && !eventType.type.startsWith(typePrefix)) return false;
    return true;
  });
}

function getErrorSummary(error: unknown) {
  const err = error as
    | (Error & {
        code?: string;
        errno?: number | string;
        syscall?: string;
        cause?: unknown;
      })
    | undefined;
  const cause = err?.cause as
    | (Error & {
        code?: string;
        errno?: number | string;
        syscall?: string;
      })
    | undefined;
  return {
    message: err?.message ?? String(error),
    name: err?.name,
    code: err?.code,
    errno: err?.errno,
    syscall: err?.syscall,
    cause: cause
      ? {
          message: cause.message ?? String(cause),
          name: cause.name,
          code: cause.code,
          errno: cause.errno,
          syscall: cause.syscall,
        }
      : undefined,
  };
}

function isRetryableToolArgumentValidationError(error: unknown): boolean {
  const errorText =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return (
    errorText.includes("AI_InvalidToolArgumentsError") ||
    (errorText.includes("Invalid arguments for tool") &&
      errorText.includes("Type validation failed"))
  );
}

async function apiFetch(path: string, init?: RequestInit) {
  const runnerToken = process.env.ORGOPS_RUNNER_TOKEN ?? "dev-runner-token";
  const headers = new Headers(init?.headers);
  if (runnerToken) headers.set("x-orgops-runner-token", runnerToken);
  const method = init?.method ?? "GET";
  const url = `${API_URL}${path}`;
  const requestId = `${Date.now()}-${++apiFetchRequestCounter}`;
  const startedAt = Date.now();
  try {
    const res = await fetch(url, { ...init, headers });
    if (!res.ok) {
      const text = await res.text();
      const elapsedMs = Date.now() - startedAt;
      console.error("runner.apiFetch.http_error", {
        requestId,
        method,
        path,
        status: res.status,
        elapsedMs,
        responseBodyPreview: text.slice(0, 1000),
      });
      throw new Error(`API ${path} failed: ${res.status} ${text}`);
    }
    return res;
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    console.error("runner.apiFetch.transport_error", {
      requestId,
      method,
      path,
      url,
      elapsedMs,
      error: getErrorSummary(error),
    });
    throw error;
  }
}

function readRunnerIdFromDisk(): string | null {
  try {
    const value = readFileSync(RUNNER_ID_FILE, "utf-8").trim();
    return value || null;
  } catch {
    return null;
  }
}

function writeRunnerIdToDisk(runnerId: string) {
  try {
    writeFileSync(RUNNER_ID_FILE, `${runnerId}\n`, "utf-8");
  } catch (error) {
    console.error("runner.id.persist_failed", {
      path: RUNNER_ID_FILE,
      error: getErrorSummary(error),
    });
  }
}

async function registerRunnerIdentity(): Promise<string> {
  const existingRunnerId = readRunnerIdFromDisk();
  const displayName =
    process.env.ORGOPS_RUNNER_NAME?.trim() ||
    `${hostname()}-${process.platform}-${arch()}`;
  const response = await apiFetch("/api/runners/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      existingRunnerId,
      displayName,
      hostname: hostname(),
      platform: process.platform,
      arch: process.arch,
      version: process.version,
      metadata: {
        release: release(),
      },
    }),
  });
  const payload = (await response.json()) as { runner?: { id?: string } };
  const runnerId = payload.runner?.id?.trim();
  if (!runnerId) {
    throw new Error("Runner registration did not return a runner ID.");
  }
  writeRunnerIdToDisk(runnerId);
  return runnerId;
}

async function sendRunnerHeartbeat(force = false) {
  if (!registeredRunnerId) return;
  const now = Date.now();
  if (!force && now - lastRunnerHeartbeatAt < HEARTBEAT_INTERVAL_MS) return;
  await apiFetch(`/api/runners/${encodeURIComponent(registeredRunnerId)}/heartbeat`, {
    method: "POST",
  });
  lastRunnerHeartbeatAt = now;
}

async function listAgents(): Promise<Agent[]> {
  if (!registeredRunnerId) return [];
  const query = `assignedRunnerId=${encodeURIComponent(registeredRunnerId)}`;
  const res = await apiFetch(`/api/agents?${query}`);
  return res.json();
}

async function patchAgentState(
  agentName: string,
  patch: { runtimeState?: string; lastHeartbeatAt?: number },
) {
  await apiFetch(`/api/agents/${encodeURIComponent(agentName)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
}

async function emitEvent(event: any) {
  await apiFetch("/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  });
}

function shouldEmitAuditEvents(agent: Agent): boolean {
  return agent.emitAuditEvents !== false;
}

async function emitAudit(
  agent: Agent,
  type: string,
  payload: unknown,
  source = "system",
) {
  if (!shouldEmitAuditEvents(agent)) return;
  const payloadRecord =
    payload && typeof payload === "object"
      ? (payload as { channelId?: unknown })
      : undefined;
  const payloadChannelId =
    typeof payloadRecord?.channelId === "string" && payloadRecord.channelId
      ? payloadRecord.channelId
      : undefined;
  await emitEvent({
    type,
    payload,
    source,
    ...(payloadChannelId ? { channelId: payloadChannelId } : {}),
  });
}

type ChannelParticipant = {
  subscriberType?: string;
  subscriberId?: string;
};

type ChannelRecord = {
  id: string;
  name?: string;
  kind?: string;
  description?: string;
  metadata?: Record<string, unknown> | null;
  participants?: ChannelParticipant[];
};

function lifecycleChannelName(agentName: string) {
  return `agent.lifecycle.${agentName}`;
}

async function listChannels(): Promise<ChannelRecord[]> {
  const res = await apiFetch("/api/channels");
  return res.json();
}

async function getChannelRecord(
  channelId: string,
): Promise<ChannelRecord | null> {
  if (!channelId) return null;
  const channels = await listChannels();
  return channels.find((channel) => channel.id === channelId) ?? null;
}

function isAgentSubscribed(channel: ChannelRecord, agentName: string): boolean {
  return (channel.participants ?? []).some(
    (participant) =>
      String(participant.subscriberType ?? "").toUpperCase() === "AGENT" &&
      participant.subscriberId === agentName,
  );
}

async function getChannelParticipationValidationError(
  agentName: string,
  channelId?: string,
): Promise<string | null> {
  const targetChannelId = channelId?.trim();
  if (!targetChannelId) return null;
  const channel = await getChannelRecord(targetChannelId);
  if (!channel) {
    return `Unknown channelId "${targetChannelId}".`;
  }
  if (!isAgentSubscribed(channel, agentName)) {
    return `Agent "${agentName}" is not an AGENT participant in channel "${targetChannelId}".`;
  }
  return null;
}

async function ensureLifecycleChannel(agentName: string): Promise<string> {
  const cached = lifecycleChannels.get(agentName);
  if (cached) return cached;

  const expectedName = lifecycleChannelName(agentName);
  const channels = await listChannels();
  const existing = channels.find(
    (channel) =>
      channel.name === expectedName && isAgentSubscribed(channel, agentName),
  );
  if (existing?.id) {
    lifecycleChannels.set(agentName, existing.id);
    return existing.id;
  }

  let createdChannelId: string | null = null;
  try {
    const createResponse = await apiFetch("/api/channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: expectedName,
        description: `Lifecycle bootstrap channel for ${agentName}`,
        kind: "GROUP",
      }),
    });
    const created = (await createResponse.json()) as { id?: string };
    createdChannelId = created.id ?? null;
  } catch {
    // Channel may already exist from another runner instance; re-read and continue.
  }

  const refreshedChannels = await listChannels();
  const resolved =
    refreshedChannels.find((channel) => channel.name === expectedName) ??
    (createdChannelId ? { id: createdChannelId } : null);
  if (!resolved?.id) {
    throw new Error(`Unable to resolve lifecycle channel for ${agentName}`);
  }

  await apiFetch(`/api/channels/${encodeURIComponent(resolved.id)}/subscribe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      subscriberType: "AGENT",
      subscriberId: agentName,
    }),
  });

  lifecycleChannels.set(agentName, resolved.id);
  return resolved.id;
}

async function emitStartupEvent(agent: Agent) {
  const channelId = await ensureLifecycleChannel(agent.name);
  await emitEvent({
    type: "agent.lifecycle.started",
    source: "system:runner",
    channelId,
    payload: {
      targetAgentName: agent.name,
      text: "You just started. Review your soul, memory, and current state, then decide your next action.",
      startedAt: Date.now(),
    },
  });
}

export function toHistoryMessage(agent: Agent, event: Event) {
  const role =
    event.source === `agent:${agent.name}`
      ? ("assistant" as const)
      : ("user" as const);
  const baseRecord = buildPromptEventRecord(event);
  const content = JSON.stringify(baseRecord, null, 2);
  return {
    role,
    content,
  };
}

function buildHistoryTruncationMessage(
  omittedCount: number,
  includedCount: number,
  maxEvents: number,
  maxChars: number,
) {
  return {
    role: "user" as const,
    content: JSON.stringify(
      {
        type: "system.history.truncated",
        omittedCount,
        includedCount,
        reason: "history_budget_exceeded",
        limits: {
          maxEvents,
          maxChars,
        },
      },
      null,
      2,
    ),
  };
}

function getToolEventName(event: Event): string | null {
  const payload =
    event.payload && typeof event.payload === "object"
      ? (event.payload as { tool?: unknown })
      : undefined;
  const tool = payload?.tool;
  return typeof tool === "string" && tool.trim().length > 0 ? tool : null;
}

function buildToolResultToStartIndexMap(channelEvents: Event[]) {
  const startsByKey = new Map<string, number[]>();
  const resultToStartIndex = new Map<number, number>();
  for (let index = 0; index < channelEvents.length; index += 1) {
    const event = channelEvents[index];
    const toolName = getToolEventName(event);
    if (!toolName) continue;
    const key = `${event.source}::${toolName}`;
    if (event.type === "tool.started") {
      const stack = startsByKey.get(key) ?? [];
      stack.push(index);
      startsByKey.set(key, stack);
      continue;
    }
    if (
      event.type !== "tool.executed" &&
      event.type !== "tool.failed"
    ) {
      continue;
    }
    const stack = startsByKey.get(key);
    const startIndex = stack?.pop();
    if (startIndex !== undefined) {
      resultToStartIndex.set(index, startIndex);
    }
  }
  return resultToStartIndex;
}

export function buildModelMessages(
  agent: Agent,
  system: string,
  channelEvents: Event[],
  options?: { systemContextMessages?: string[] },
) {
  const orderedChannelEvents = channelEvents
    .slice()
    .sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0));
  const historyMessages = orderedChannelEvents.map((channelEvent) =>
    toHistoryMessage(agent, channelEvent),
  );
  const resultToStartIndex =
    buildToolResultToStartIndexMap(orderedChannelEvents);

  let keptStartIndex = historyMessages.length;
  let keptMessageCount = 0;
  let totalHistoryChars = 0;
  for (let index = historyMessages.length - 1; index >= 0; index -= 1) {
    const messageChars = historyMessages[index]?.content.length ?? 0;
    const exceedsMaxEvents = keptMessageCount + 1 > HISTORY_MAX_EVENTS;
    const exceedsMaxChars =
      keptMessageCount > 0 &&
      totalHistoryChars + messageChars > HISTORY_MAX_CHARS;
    if (
      (keptStartIndex < historyMessages.length && exceedsMaxChars) ||
      exceedsMaxEvents
    ) {
      break;
    }
    keptStartIndex = index;
    keptMessageCount += 1;
    totalHistoryChars += messageChars;
  }
  for (;;) {
    let advanced = false;
    for (
      let index = keptStartIndex;
      index < historyMessages.length;
      index += 1
    ) {
      const startIndex = resultToStartIndex.get(index);
      if (startIndex !== undefined && startIndex < keptStartIndex) {
        keptStartIndex = index + 1;
        advanced = true;
      }
    }
    if (!advanced) break;
  }
  const keptFromEnd = historyMessages.slice(keptStartIndex);
  const omittedCount = orderedChannelEvents.length - keptFromEnd.length;
  return [
    { role: "system" as const, content: system },
    ...((options?.systemContextMessages ?? [])
      .map((content) => content.trim())
      .filter((content) => content.length > 0)
      .map((content) => ({ role: "system" as const, content }))),
    ...(omittedCount > 0
      ? [
          buildHistoryTruncationMessage(
            omittedCount,
            keptFromEnd.length,
            HISTORY_MAX_EVENTS,
            HISTORY_MAX_CHARS,
          ),
        ]
      : []),
    ...keptFromEnd,
  ];
}

const FALLBACK_MODEL_CONTEXT_WINDOW_TOKENS = 128_000;
const CHARS_PER_TOKEN_ESTIMATE = 4;

function resolveModelContextWindowTokens(modelId: string): number {
  const normalized = modelId.toLowerCase();
  if (normalized.includes("gpt-4o-mini")) return 128_000;
  if (normalized.includes("gpt-4o")) return 128_000;
  if (normalized.includes("gpt-4.1-mini")) return 1_000_000;
  if (normalized.includes("gpt-4.1")) return 1_000_000;
  if (normalized.includes("gpt-5")) return 1_000_000;
  return FALLBACK_MODEL_CONTEXT_WINDOW_TOKENS;
}

function estimateTokensForText(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

function estimateContextUsage(messages: Array<{ role: string; content: string }>) {
  const usedTokens = messages.reduce(
    (sum, message) => sum + estimateTokensForText(message.content),
    0,
  );
  return usedTokens;
}

type ModelEventDraft = {
  type: string;
  payload: unknown;
  source: string;
  channelId?: string;
  parentEventId?: string;
  deliverAt?: number;
  idempotencyKey?: string;
};

const MAX_EVENT_DISPATCH_ATTEMPTS = 3;
const DEFAULT_MEMORY_CONTEXT_MODE = "PER_CHANNEL_CROSS_CHANNEL" as const;
type MemoryContextMode = "PER_CHANNEL_CROSS_CHANNEL" | "FULL_CHANNEL_EVENTS" | "OFF";

export function resolveAgentLlmCallTimeoutMs(agent: Agent): number {
  const configured = agent.llmCallTimeoutMs;
  if (typeof configured === "number" && Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured);
  }
  return LLM_CALL_TIMEOUT_MS;
}

export function resolveAgentClassicMaxModelSteps(agent: Agent): number {
  const configured = agent.classicMaxModelSteps;
  if (typeof configured === "number" && Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured);
  }
  return DEFAULT_CLASSIC_MAX_MODEL_STEPS;
}

export function resolveAgentMemoryContextMode(agent: Agent): MemoryContextMode {
  const configured = agent.memoryContextMode;
  if (
    configured === "PER_CHANNEL_CROSS_CHANNEL" ||
    configured === "FULL_CHANNEL_EVENTS" ||
    configured === "OFF"
  ) {
    return configured;
  }
  return DEFAULT_MEMORY_CONTEXT_MODE;
}

function extractJsonObject(rawText: string): unknown {
  const text = rawText.trim();
  if (!text) throw new Error("Empty response.");
  try {
    return JSON.parse(text);
  } catch {
    // Support fenced code blocks with JSON content.
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (!fenced?.[1]) {
      throw new Error("Response was not valid JSON.");
    }
    return JSON.parse(fenced[1]);
  }
}

function normalizeEventDraft(
  parsed: unknown,
  agentName: string,
  channelId?: string,
): ModelEventDraft {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON response must be an object.");
  }
  const event = parsed as Record<string, unknown>;
  const type = typeof event.type === "string" ? event.type.trim() : "";
  if (!type) {
    throw new Error("JSON event is missing a non-empty `type`.");
  }
  const reservedTypeError = getReservedEventTypeError(type);
  if (reservedTypeError) {
    throw new Error(reservedTypeError);
  }
  // Final model-emitted events must always be authored by the active agent.
  // Ignore any model-provided source to prevent impersonation/misattribution.
  const source = `agent:${agentName}`;
  const resolvedChannelId =
    typeof event.channelId === "string" && event.channelId.trim()
      ? event.channelId.trim()
      : channelId;
  const payload = event.payload ?? {};
  const parentEventId =
    typeof event.parentEventId === "string" && event.parentEventId.trim()
      ? event.parentEventId.trim()
      : undefined;
  const idempotencyKey =
    typeof event.idempotencyKey === "string" && event.idempotencyKey.trim()
      ? event.idempotencyKey.trim()
      : undefined;
  const deliverAt =
    typeof event.deliverAt === "number" && Number.isFinite(event.deliverAt)
      ? Math.floor(event.deliverAt)
      : undefined;
  return {
    type,
    payload,
    source,
    ...(resolvedChannelId ? { channelId: resolvedChannelId } : {}),
    ...(parentEventId ? { parentEventId } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(deliverAt !== undefined ? { deliverAt } : {}),
  };
}

function formatValidationErrors(validation: EventValidationResult): string {
  if (validation.ok) return "";
  return validation.issues
    .slice(0, 8)
    .map((issue: any) => `- [${issue.source}] ${issue.message}`)
    .join("\n");
}

function buildFallbackMessageEvent(
  agentName: string,
  channelId: string,
  text: string,
  parentEventId?: string,
) {
  return {
    type: "message.created",
    source: `agent:${agentName}`,
    channelId,
    payload: {
      text: text.trim() || "Unable to produce structured event output.",
    },
    ...(parentEventId ? { parentEventId } : {}),
  };
}

export async function shouldHandleEvent(agent: Agent, event: Event) {
  return shouldHandleEventForAgent(agent, event);
}

async function getPackageSecretsEnv(
  agentName: string,
  channelId?: string,
): Promise<Record<string, string>> {
  try {
    const res = await apiFetch("/api/secrets/env", {
      headers: {
        "x-orgops-agent-name": agentName,
        ...(channelId ? { "x-orgops-channel-id": channelId } : {}),
      },
    });
    return (await res.json()) as Record<string, string>;
  } catch {
    return {};
  }
}

function buildBatchedTriggerMessage(events: Event[]) {
  if (events.length <= 1) return null;
  return {
    role: "user" as const,
    content: JSON.stringify(
      {
        type: "system.pending.events.merged",
        mergedCount: events.length,
        newestEventId: events[events.length - 1]?.id,
        events: events.map(buildPromptEventRecord),
      },
      null,
      2,
    ),
  };
}

export function selectRecentDeltaEventsForPrompt(agent: Agent, events: Event[]): Event[] {
  const ownSource = `agent:${agent.name}`;
  let latestUserLikeEventId: string | undefined;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.source !== ownSource) {
      latestUserLikeEventId = event?.id;
      break;
    }
  }
  if (!latestUserLikeEventId) return events;
  return events.filter((event) => event.id !== latestUserLikeEventId);
}

const channelLoopManager = createChannelLoopManager({
  processBatch: async (agent, _channelId, channelEvents) => {
    await handleEvent(agent, channelEvents);
  },
  onBatchError: async (_agent, _channelId, channelEvents, error) => {
    const triggerEvent = channelEvents[channelEvents.length - 1];
    const channelId = triggerEvent?.channelId;
    if (triggerEvent && channelId) {
      await emitEvent({
        type: "agent.turn.failed",
        source: `agent:${_agent.name}`,
        channelId,
        payload: {
          triggerEventId: triggerEvent.id,
          eventCount: channelEvents.length,
          error: String(error),
        },
      });
    }
    for (const event of channelEvents) {
      await apiFetch(`/api/events/${event.id}/fail`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: String(error) }),
      });
    }
  },
});

const maintenanceLoop = createMaintenanceLoop({
  listChannels,
  getPackageSecretsEnv: (agentName: string, channelId?: string) =>
    getPackageSecretsEnv(agentName, channelId),
  apiFetch,
  channelRecentMemoryIntervalMs: CHANNEL_RECENT_MEMORY_INTERVAL_MS,
  channelFullMemoryIntervalMs: CHANNEL_FULL_MEMORY_INTERVAL_MS,
  crossRecentMemoryIntervalMs: CROSS_RECENT_MEMORY_INTERVAL_MS,
  crossFullMemoryIntervalMs: CROSS_FULL_MEMORY_INTERVAL_MS,
});

async function handleEvent(agent: Agent, events: Event[]) {
  if (events.length === 0) return;
  const triggerEvent = events[events.length - 1]!;
  const channelId = triggerEvent?.channelId;
  if (!channelId) return;
  const emitTurnEvent = async (
    type: string,
    payload: Record<string, unknown>,
  ) => {
    try {
      await emitEvent({
        type,
        source: `agent:${agent.name}`,
        channelId,
        payload: {
          triggerEventId: triggerEvent.id,
          eventCount: events.length,
          ...payload,
        },
      });
    } catch {
      // Lifecycle telemetry should not block turn execution.
    }
  };
  await emitTurnEvent("agent.turn.started", {});
  const injectionEnv = await getPackageSecretsEnv(agent.name, channelId);
  const channelRecord = await getChannelRecord(channelId);
  const soul = typeof agent.soulContents === "string" ? agent.soulContents : "";
  const allSkills = listSkills(SKILL_ROOT);
  const enabledSkillSet = new Set(agent.enabledSkills ?? []);
  const alwaysPreloadedSkillSet = new Set(agent.alwaysPreloadedSkills ?? []);
  const selectedSkills = allSkills.filter((skill: any) =>
    enabledSkillSet.has(skill.name),
  );
  const alwaysPreloadedSkills = selectedSkills.filter((skill: any) =>
    alwaysPreloadedSkillSet.has(skill.name),
  );
  const loadedSkillEventShapes = await loadSkillEventShapes(selectedSkills);
  const coreEventShapes = getCoreEventShapes();
  const eventShapes = [...coreEventShapes, ...loadedSkillEventShapes.shapes];
  const serializedEventTypes = serializeEventShapes(eventShapes);
  const coreEventTypes = queryEventTypes(serializedEventTypes, {
    source: "core",
  });
  const skillIndex = selectedSkills
    .map(
      (skill: any) =>
        `${skill.name} | ${skill.description} | ${join(skill.path, "SKILL.md")}`,
    )
    .join("\n");
  const preloadedSkillsContext = alwaysPreloadedSkills
    .map((skill: any) => {
      const contents = getSkillMarkdownContents(skill.path);
      if (!contents) return null;
      return `# ${skill.name}\n${contents}`;
    })
    .filter((entry: unknown): entry is string => Boolean(entry))
    .join("\n\n");
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const runnerGuidance = buildRunnerGuidance(
    nowMs,
    nowIso,
    SKILL_ROOT.path,
    coreEventTypes,
    {
      platform: process.platform,
      release: release(),
      arch: arch(),
      hostname: hostname(),
      shell: process.env.SHELL ?? process.env.ComSpec ?? "unknown",
      nodeVersion: process.version,
    },
  );
  const memoryContextMode = resolveAgentMemoryContextMode(agent);
  let eventHistory: Event[] = [];
  let systemContextMessages: string[] = [];
  if (memoryContextMode === "PER_CHANNEL_CROSS_CHANNEL") {
    const [channelRecentMemory, channelFullMemory, crossRecentMemory, crossFullMemory] =
      await Promise.all([
        getChannelRecentMemoryRecord(apiFetch, agent.name, channelId),
        getChannelFullMemoryRecord(apiFetch, agent.name, channelId),
        getCrossRecentMemoryRecord(apiFetch, agent.name),
        getCrossFullMemoryRecord(apiFetch, agent.name),
      ]);
    const recentSummaryWatermark = channelRecentMemory?.lastProcessedAt;
    const rawDeltaEvents = await listEventsAfterTimestamp(
      apiFetch,
      channelId,
      typeof recentSummaryWatermark === "number" && recentSummaryWatermark > 0
        ? recentSummaryWatermark
        : undefined,
    );
    eventHistory = getMeaningfulEvents(rawDeltaEvents);
    const recentDeltaForSystemContext = selectRecentDeltaEventsForPrompt(
      agent,
      eventHistory,
    );
    systemContextMessages = [
      channelRecentMemory?.summaryText
        ? buildSystemMemoryMessage(
            `Channel Recent Summary (last 10 minutes, ${channelId})`,
            channelRecentMemory.summaryText,
          )
        : "",
      recentDeltaForSystemContext.length > 0
        ? buildChannelRecentDeltaSystemMessage({
            channelId,
            events: recentDeltaForSystemContext,
          })
        : "",
      channelFullMemory?.summaryText
        ? buildSystemMemoryMessage(
            `Channel Full Memory (${channelId})`,
            channelFullMemory.summaryText,
          )
        : "",
      crossRecentMemory?.summaryText
        ? buildSystemMemoryMessage(
            "Cross-Channel Recent Summary (last 10 minutes)",
            crossRecentMemory.summaryText,
          )
        : "",
      crossFullMemory?.summaryText
        ? buildSystemMemoryMessage(
            "Cross-Channel Full Memory",
            crossFullMemory.summaryText,
          )
        : "",
    ].filter(Boolean);
  } else if (memoryContextMode === "FULL_CHANNEL_EVENTS") {
    const fullChannelHistory = await listEventsAfterTimestamp(apiFetch, channelId);
    eventHistory = getMeaningfulEvents(fullChannelHistory);
  } else {
    eventHistory = [];
    systemContextMessages = [];
  }
  const system = [
    agent.systemInstructions,
    runnerGuidance,
    `Your own workspace:\n${agent.workspacePath}\n`,
    `OrgOps system path:\n${PROJECT_ROOT}\n`,
    `Current channel context:\n${JSON.stringify(
      channelRecord ?? { id: channelId, unresolved: true },
      null,
      2,
    )}`,
    soul ? `Your soul:\n${soul}` : "",
    "Your skills:\n" + skillIndex,
    preloadedSkillsContext
      ? `Always pre-loaded skills (full SKILL.md contents):\n${preloadedSkillsContext}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const baseMessages = buildModelMessages(agent, system, eventHistory, {
    systemContextMessages,
  });
  const mergedTriggerMessage = buildBatchedTriggerMessage(events);
  const invokeMessages = mergedTriggerMessage
    ? [...baseMessages, mergedTriggerMessage]
    : baseMessages;
  try {
    if (shouldEmitAuditEvents(agent)) {
      await emitEvent({
        type: "telemetry.prompt.composed",
        source: "system:runner:prompt",
        status: "DELIVERED",
        channelId,
        payload: {
          agentName: agent.name,
          modelId: agent.modelId,
          memoryContextMode,
          triggerEventId: triggerEvent.id,
          systemPrompt: system,
          systemContextMessages,
          messages: invokeMessages.map((message) => ({
            role: message.role,
            content: String(message.content ?? ""),
          })),
        },
      });
    }
  } catch {
    // Prompt telemetry should never block turn execution.
  }
  const systemContextChars = systemContextMessages.reduce(
    (sum, message) => sum + message.length,
    0,
  );
  const systemChars = system.length;
  const totalPromptChars = invokeMessages.reduce(
    (sum, message) => sum + String(message.content ?? "").length,
    0,
  );
  const estimatedUsedTokens = estimateContextUsage(
    invokeMessages.map((message) => ({
      role: message.role,
      content: String(message.content ?? ""),
    })),
  );
  const contextWindowTokens = resolveModelContextWindowTokens(agent.modelId);
  const estimatedAvailableTokens = Math.max(
    0,
    contextWindowTokens - estimatedUsedTokens,
  );
  const utilizationPct =
    contextWindowTokens > 0
      ? Math.min(100, (estimatedUsedTokens / contextWindowTokens) * 100)
      : 0;
  try {
    if (shouldEmitAuditEvents(agent)) {
      await emitEvent({
        type: "telemetry.context.window.updated",
        source: "system:runner:context",
        status: "DELIVERED",
        channelId,
        payload: {
          agentName: agent.name,
          modelId: agent.modelId,
          contextWindowTokens,
          estimatedUsedTokens,
          estimatedAvailableTokens,
          utilizationPct: Math.round(utilizationPct * 100) / 100,
          memoryContextMode,
          messageCount: invokeMessages.length,
          systemChars,
          systemContextChars,
          historyChars: Math.max(0, totalPromptChars - systemChars - systemContextChars),
          triggerEventId: triggerEvent.id,
        },
      });
    }
  } catch {
    // Context telemetry should never block turn execution.
  }

  const executeCtx = {
    agent,
    triggerEvent,
    channelId,
    extraAllowedRoots: selectedSkills.map((skill: any) => skill.path),
    injectionEnv,
    apiFetch,
    emitEvent,
    emitAudit: (
      type: string,
      payload: unknown,
      source = `agent:${agent.name}`,
    ) => emitAudit(agent, type, payload, source),
    listEventTypes: (input?: { source?: string; typePrefix?: string }) =>
      queryEventTypes(serializedEventTypes, input),
    validateEvent: (eventDraft: {
      type: string;
      payload: unknown;
      source: string;
      channelId?: string;
      parentEventId?: string;
      deliverAt?: number;
      idempotencyKey?: string;
    }) => validateEventAgainstShapes(eventDraft, eventShapes),
  };
  if (loadedSkillEventShapes.errors.length > 0) {
    console.warn(
      "skill event shape load errors",
      loadedSkillEventShapes.errors,
    );
  }
  const tools = createRunnerTools({
    agent,
    event: triggerEvent,
    channelId,
    runTool: (tool, args) => executeTool(executeCtx, tool, args),
    apiFetch,
    emitEvent,
  });
  if ((agent.mode ?? "CLASSIC") === "RLM_REPL") {
    await runRlmEventInChild({
      agent,
      event: triggerEvent,
      channelId,
      systemPrompt: system,
      baseMessages: invokeMessages,
      executeCtx,
      apiFetch,
      emitEvent,
    });
    await emitTurnEvent("agent.turn.completed", {});
    return;
  }
  const seenEventIds = new Set(events.map((event) => event.id));
  const retryMessages: Array<{ role: "user"; content: string }> = [];
  const channelPostingValidationCache = new Map<string, string | null>();
  const llmCallTimeoutMs = resolveAgentLlmCallTimeoutMs(agent);
  const classicMaxModelSteps = resolveAgentClassicMaxModelSteps(agent);
  let lastResponseText = "";
  for (let attempt = 1; attempt <= MAX_EVENT_DISPATCH_ATTEMPTS; attempt += 1) {
    let result: { text?: string };
    try {
      result = (await withTimeout(
        generate(agent.modelId, [...invokeMessages, ...retryMessages], {
          tools,
          maxSteps: classicMaxModelSteps,
          env: injectionEnv,
          pullMessages: async () => {
            const injected = await pullInjectedEventMessages({
              apiFetch,
              agent,
              channelId,
              seenEventIds,
              shouldInclude: shouldHandleEventForAgent,
            });
            return injected?.messages ?? [];
          },
        }),
        llmCallTimeoutMs,
        `LLM generate (attempt ${attempt})`,
      )) as { text?: string };
    } catch (error) {
      if (!isRetryableToolArgumentValidationError(error)) {
        throw error;
      }
      retryMessages.push({
        role: "user",
        content: [
          `Your tool call arguments were invalid on attempt ${attempt}/${MAX_EVENT_DISPATCH_ATTEMPTS}.`,
          `Error: ${String(error)}`,
          "Retry with corrected tool arguments. For optional string filters, omit the field instead of sending an empty string.",
          "Return only a corrected JSON event object.",
        ].join("\n"),
      });
      continue;
    }
    const responseText = result.text ?? "";
    lastResponseText = responseText;

    let parsed: unknown;
    try {
      parsed = extractJsonObject(responseText);
    } catch (error) {
      retryMessages.push({
        role: "user",
        content: [
          `Your previous response was not valid JSON on attempt ${attempt}/${MAX_EVENT_DISPATCH_ATTEMPTS}.`,
          `Error: ${String(error)}`,
          "Return only a corrected JSON event object.",
        ].join("\n"),
      });
      continue;
    }

    let eventDraft: ModelEventDraft;
    try {
      eventDraft = normalizeEventDraft(parsed, agent.name, channelId);
    } catch (error) {
      retryMessages.push({
        role: "user",
        content: [
          `Your previous JSON output was invalid on attempt ${attempt}/${MAX_EVENT_DISPATCH_ATTEMPTS}.`,
          `Error: ${String(error)}`,
          "Return only a corrected JSON event object.",
        ].join("\n"),
      });
      continue;
    }

    const validation = validateEventAgainstShapes(eventDraft, eventShapes);
    if (!validation.ok) {
      const details = formatValidationErrors(validation);
      retryMessages.push({
        role: "user",
        content: [
          `Event validation failed on attempt ${attempt}/${MAX_EVENT_DISPATCH_ATTEMPTS}.`,
          `Type: ${eventDraft.type}`,
          details || "- Unknown validation error.",
          "Return only a corrected JSON event object that validates.",
        ].join("\n"),
      });
      continue;
    }

    const targetChannelId = eventDraft.channelId?.trim();
    let participationError: string | null = null;
    if (targetChannelId) {
      if (!channelPostingValidationCache.has(targetChannelId)) {
        channelPostingValidationCache.set(
          targetChannelId,
          await getChannelParticipationValidationError(agent.name, targetChannelId),
        );
      }
      participationError = channelPostingValidationCache.get(targetChannelId) ?? null;
    }
    if (participationError) {
      retryMessages.push({
        role: "user",
        content: [
          `Event validation failed on attempt ${attempt}/${MAX_EVENT_DISPATCH_ATTEMPTS}.`,
          `Type: ${eventDraft.type}`,
          `- [runner] ${participationError}`,
          "Return only a corrected JSON event object that validates.",
        ].join("\n"),
      });
      continue;
    }

    await emitEvent(eventDraft);
    await emitTurnEvent("agent.turn.completed", {});
    return;
  }

  await emitEvent(
    buildFallbackMessageEvent(
      agent.name,
      channelId,
      lastResponseText,
      triggerEvent.id,
    ),
  );
  await emitTurnEvent("agent.turn.completed", {
    completedWithFallback: true,
  });
}

async function ensureWorkspace(agent: Agent) {
  const workspacePath = agent.workspacePath.startsWith("/")
    ? agent.workspacePath
    : resolve(PROJECT_ROOT, agent.workspacePath);
  mkdirSync(workspacePath, { recursive: true });
  agent.workspacePath = workspacePath;
}

async function pollAgent(agent: Agent) {
  if (
    registeredRunnerId &&
    agent.assignedRunnerId &&
    agent.assignedRunnerId !== registeredRunnerId
  ) {
    return;
  }
  if (agent.desiredState !== "RUNNING") {
    heartbeats.delete(agent.name);
    bootstrappedAgents.delete(agent.name);
    maintenanceLoop.clearAgent(agent.name);
    if (agent.runtimeState !== "STOPPED") {
      await patchAgentState(agent.name, { runtimeState: "STOPPED" });
    }
    return;
  }
  await ensureWorkspace(agent);
  const now = Date.now();
  const previousHeartbeatAt = heartbeats.get(agent.name) ?? 0;
  const needsHeartbeat = now - previousHeartbeatAt >= HEARTBEAT_INTERVAL_MS;
  if (agent.runtimeState !== "RUNNING" || needsHeartbeat) {
    await patchAgentState(agent.name, {
      runtimeState: "RUNNING",
      lastHeartbeatAt: now,
    });
    heartbeats.set(agent.name, now);
  }
  if (!bootstrappedAgents.has(agent.name)) {
    try {
      await emitStartupEvent(agent);
      bootstrappedAgents.add(agent.name);
    } catch (error) {
      console.error(`failed to emit startup event for ${agent.name}`, error);
    }
  }
  if (resolveAgentMemoryContextMode(agent) === "PER_CHANNEL_CROSS_CHANNEL") {
    maintenanceLoop.schedule(agent);
  }
  const query = `agentName=${encodeURIComponent(agent.name)}&status=PENDING&limit=50`;
  const res = await apiFetch(`/api/events?${query}`);
  const events = (await res.json()) as Event[];
  const pendingByChannel = new Map<string, Event[]>();
  for (const event of events) {
    if (!shouldHandleEventForAgent(agent, event)) {
      continue;
    }
    const channelId = event.channelId;
    if (!channelId) continue;
    const bucket = pendingByChannel.get(channelId) ?? [];
    bucket.push(event);
    pendingByChannel.set(channelId, bucket);
  }

  for (const channelEvents of pendingByChannel.values()) {
    channelEvents.sort((left, right) => {
      const leftTs = left.createdAt ?? 0;
      const rightTs = right.createdAt ?? 0;
      return leftTs - rightTs;
    });
    channelLoopManager.enqueue(agent, channelEvents);
  }
}

export async function loop() {
  let shuttingDown = false;
  let shutdownSignal: NodeJS.Signals | null = null;
  const onShutdownSignal = (signal: NodeJS.Signals) => {
    shuttingDown = true;
    shutdownSignal = signal;
  };
  const onSigint = () => onShutdownSignal("SIGINT");
  const onSigterm = () => onShutdownSignal("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  while (!shuttingDown && !registeredRunnerId) {
    try {
      registeredRunnerId = await registerRunnerIdentity();
      await sendRunnerHeartbeat(true);
      console.log(`runner registered as ${registeredRunnerId}`);
    } catch (error) {
      console.error("runner.registration_failed", getErrorSummary(error));
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  while (!shuttingDown) {
    try {
      await sendRunnerHeartbeat();
      const agents = await listAgents();
      const results = await Promise.allSettled(
        agents.map(async (agent) => {
          await pollAgent(agent);
        }),
      );
      for (const result of results) {
        if (result.status === "rejected") {
          console.error(result.reason);
        }
      }
    } catch (error) {
      console.error(error);
    }
    if (shuttingDown) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  process.off("SIGINT", onSigint);
  process.off("SIGTERM", onSigterm);
  await maintenanceLoop.awaitInFlight();
  stopAllRlmChildren();
  const processShutdownSummary = await stopAllRunningProcesses();
  if (processShutdownSummary.processCount > 0) {
    console.log(
      `runner shutdown (${shutdownSignal ?? "STOP"}): stopped ${processShutdownSummary.terminated} process(es), killed ${processShutdownSummary.killed}`,
    );
  }
}
