import { arch, hostname, release } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import {
  generate,
  normalizeLlmStyle,
  type GenerateResult,
  type LlmMessage,
  type LlmMessageContent,
  type LlmStyle,
  type LlmUsage,
} from "@orgops/llm";
import { getModel } from "models-dev-db";
import { z } from "zod";
import { listSkillsFromRoots, loadSkillEventShapes } from "@orgops/skills";
import {
  type EventValidationResult,
  type EventTypeSummary,
  getCoreEventShapes,
  inferModelCapabilities,
  resolveReplyContract,
  serializeEventShapes,
  validateEventAgainstShapes,
} from "@orgops/schemas";
import { createRunnerTools, executeTool } from "./tools";
import { pullInjectedEventMessages } from "./channel-injection";
import { shouldHandleEventForAgent } from "./event-routing";
import { getReservedEventTypeError } from "./event-type-guard";
import { buildRunnerGuidance, NOOP_TOOL_NAME } from "./prompt";
import { runRlmEventInChild } from "./rlm-process";
import { runWrappedAgentTurn } from "./wrapped-runtime";
import {
  buildSystemMemoryMessage,
  getChannelFullMemoryRecord,
  getChannelRecentMemoryRecord,
  getCrossFullMemoryRecord,
  getCrossRecentMemoryRecord,
  getMeaningfulEvents,
  listEventsAfterTimestamp,
} from "./context-maintenance";
import {
  buildModelMessages,
  computeHistoryBudgetChars,
  contentCharLength,
  contentForTelemetry,
  estimateContextUsage,
} from "./prompt-composer";
import { recordLlmUsage } from "./billing";
import type { Agent, Event } from "./types";
import type { RunnerApi } from "./runner/api";
import {
  MAX_SCHEDULED_COMPLETION_ATTEMPTS,
  MAX_TURN_COMPLETION_CONTINUATIONS,
  TURN_FINISH_TOOL_NAME,
  calledTurnFinish,
  clampCompletionRetrySeconds,
  completionFromJson,
  completionFromPlainText,
  completionFromToolCalls,
  scheduledCompletionAttempt,
  turnFinishTool,
  type TurnCompletionOutcome,
} from "./turn-completion";

const DEFAULT_LLM_CALL_TIMEOUT_MS = 10_800_000;
const DEFAULT_CLASSIC_MAX_MODEL_STEPS = 100;
const MAX_EVENT_DISPATCH_ATTEMPTS = 3;
const MAX_LATE_EVENT_CONTINUATIONS = 3;
const DEFAULT_MEMORY_CONTEXT_MODE = "PER_CHANNEL_CROSS_CHANNEL" as const;
const FALLBACK_MODEL_CONTEXT_WINDOW_TOKENS = 128_000;
const DEFAULT_MAX_LLM_MESSAGE_CHARS = 200_000;
const RESPONSE_FORMAT_ERROR =
  "I hit a response-format issue and could not produce a clean chat message. Please try again.";
const TURN_COMPLETION_ERROR =
  "I stopped without confirming whether the requested work was completed. The work may be incomplete; please ask me to continue.";
const TURN_CONTINUATION_EXHAUSTED =
  "I could not complete the work after several continuation attempts. The work remains incomplete; please ask me to continue.";

type MemoryContextMode = "PER_CHANNEL_CROSS_CHANNEL" | "FULL_CHANNEL_EVENTS" | "OFF";

type ModelEventDraft = {
  type: string;
  payload: unknown;
  source: string;
  channelId?: string;
  parentEventId?: string;
  deliverAt?: number;
  idempotencyKey?: string;
};

type CreateTurnExecutorInput = {
  projectRoot: string;
  skillRoots: Array<{ path: string }>;
  llmCallTimeoutMs: number;
  runtimeAuth?: {
    apiBaseUrl?: string;
    runnerToken?: string;
  };
  api: Pick<
    RunnerApi,
    | "apiFetch"
    | "emitEvent"
    | "listChannels"
    | "getChannelRecord"
    | "getChannelParticipationValidationError"
    | "ensureLifecycleChannel"
    | "getPackageSecretsEnv"
  >;
};

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

function readPositiveIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const MAX_LLM_MESSAGE_CHARS = readPositiveIntEnv(
  process.env.ORGOPS_MAX_LLM_MESSAGE_CHARS,
  DEFAULT_MAX_LLM_MESSAGE_CHARS,
);

function truncateOversizedText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const omitted = value.length - maxChars;
  return `${value.slice(0, maxChars)}\n...[truncated ${omitted} chars]`;
}

function clampMessageContent(content: LlmMessageContent, maxChars: number): LlmMessageContent {
  if (typeof content === "string") {
    return truncateOversizedText(content, maxChars);
  }
  const clamped = [...content] as Array<Record<string, unknown>>;
  for (let index = 0; index < clamped.length; index += 1) {
    const part = clamped[index];
    if (!part || typeof part !== "object" || part.type !== "text") continue;
    const text = typeof part.text === "string" ? part.text : "";
    clamped[index] = {
      ...part,
      text: truncateOversizedText(text, maxChars),
    };
  }
  return clamped as LlmMessageContent;
}

function clampMessagesForProviderLimit(messages: LlmMessage[]): LlmMessage[] {
  const clamped = messages.map((message) => ({ ...message })) as LlmMessage[];
  for (const message of clamped) {
    if (message.role === "system") {
      const content =
        typeof message.content === "string"
          ? truncateOversizedText(message.content, MAX_LLM_MESSAGE_CHARS)
          : truncateOversizedText(contentForTelemetry(message.content), MAX_LLM_MESSAGE_CHARS);
      (message as { content: string }).content = content;
      continue;
    }
    (message as { content: LlmMessageContent }).content = clampMessageContent(
      message.content,
      MAX_LLM_MESSAGE_CHARS,
    );
  }
  return clamped;
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

function getSkillMarkdownContents(skillPath: string): string | null {
  try {
    return readFileSync(join(skillPath, "SKILL.md"), "utf-8");
  } catch {
    return null;
  }
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

function extractJsonObject(rawText: string): unknown {
  const text = rawText.trim();
  if (!text) throw new Error("Empty response.");
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (!fenced?.[1]) throw new Error("Response was not valid JSON.");
    return JSON.parse(fenced[1]);
  }
}

// Display fallback can recover a trailing event envelope; strict dispatch still requires clean JSON.
function extractTrailingEvent(rawText: string): unknown {
  if (!rawText.endsWith("}")) throw new Error("No trailing object.");
  let depth = 0;
  let inString = false;
  for (let index = rawText.length - 1; index >= 0; index -= 1) {
    const char = rawText[index];
    if (char === "\"") {
      let backslashes = 0;
      for (let previous = index - 1; previous >= 0 && rawText[previous] === "\\"; previous -= 1) {
        backslashes += 1;
      }
      if (backslashes % 2 === 0) inString = !inString;
    }
    if (inString) continue;
    if (char === "}") depth += 1;
    if (char === "{" && --depth === 0) {
      const parsed = JSON.parse(rawText.slice(index));
      if (parsed && typeof parsed === "object" && "type" in parsed && "payload" in parsed) {
        return parsed;
      }
      break;
    }
  }
  throw new Error("No trailing event envelope.");
}

export function normalizeFallbackMessageText(rawText: string): string {
  const trimmed = rawText.trim();
  if (!trimmed) return "Unable to produce structured event output.";
  try {
    let parsed: unknown;
    try {
      parsed = extractJsonObject(trimmed);
    } catch {
      parsed = extractTrailingEvent(trimmed);
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const payload = (parsed as Record<string, unknown>).payload;
      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        const payloadText = (payload as Record<string, unknown>).text;
        if (typeof payloadText === "string" && payloadText.trim()) {
          return payloadText.trim();
        }
      }
      // Do not leak raw event JSON into chat when fallback is triggered.
      return RESPONSE_FORMAT_ERROR;
    }
  } catch {
    // Keep plain-text fallbacks as-is.
  }
  return trimmed;
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
  if (!type) throw new Error("JSON event is missing a non-empty `type`.");
  const reservedTypeError = getReservedEventTypeError(type);
  if (reservedTypeError) throw new Error(reservedTypeError);
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

function generateUsedTools(result: GenerateResult): boolean {
  if ((result.toolCalls?.length ?? 0) > 0) return true;
  if ((result.toolResults?.length ?? 0) > 0) return true;
  return result.finishReason === "tool-calls";
}

function isProcessLifecycleEvent(event: Event): boolean {
  return (
    event.type === "process.started" ||
    event.type === "process.output" ||
    event.type === "process.exited"
  );
}

function getPayloadRecord(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  return payload as Record<string, unknown>;
}

function createSyncProcessInjectionSuppressor() {
  const syncProcessIds = new Set<string>();
  return (agent: Agent, event: Event): boolean => {
    if (!isProcessLifecycleEvent(event)) return false;
    if (event.source !== "system:process-runner") return false;
    const payload = getPayloadRecord(event.payload);
    if (!payload) return false;
    const processId = typeof payload.processId === "string" ? payload.processId.trim() : "";
    if (!processId) return false;
    const targetAgentName =
      typeof payload.targetAgentName === "string" ? payload.targetAgentName.trim() : "";
    const ownerAgentName =
      typeof payload.ownerAgentName === "string" ? payload.ownerAgentName.trim() : "";
    if (targetAgentName && targetAgentName !== agent.name) return false;
    if (ownerAgentName && ownerAgentName !== agent.name) return false;
    if (event.type === "process.started" && payload.executionMode === "SYNC") {
      syncProcessIds.add(processId);
      return true;
    }
    return syncProcessIds.has(processId);
  };
}

function shouldEmitAuditEvents(agent: Agent): boolean {
  return agent.emitAuditEvents !== false;
}

const modelContextWindowCache = new Map<string, Promise<number>>();

function normalizeModelMetadataProvider(provider: string) {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "claude") return "anthropic";
  if (normalized === "or") return "openrouter";
  return normalized;
}

function inferModelCapabilitiesForId(modelId: string) {
  const separator = modelId.indexOf(":");
  if (separator <= 0) return {};
  return inferModelCapabilities(modelId.slice(0, separator), modelId.slice(separator + 1));
}

function resolveFallbackModelContextWindowTokens(modelId: string): number {
  const normalized = modelId.toLowerCase();
  if (normalized.includes("gpt-4o-mini")) return 128_000;
  if (normalized.includes("gpt-4o")) return 128_000;
  if (normalized.includes("gpt-4.1-mini")) return 1_000_000;
  if (normalized.includes("gpt-4.1")) return 1_000_000;
  if (normalized.includes("gpt-5")) return 1_000_000;
  if (normalized.includes("claude")) return 200_000;
  return FALLBACK_MODEL_CONTEXT_WINDOW_TOKENS;
}

async function resolveModelContextWindowTokens(agent: Agent): Promise<number> {
  const declared = agent.modelCapabilities?.contextWindowTokens;
  if (typeof declared === "number" && declared > 0) return Math.floor(declared);
  const inferred = inferModelCapabilitiesForId(agent.modelId).contextWindowTokens;
  if (inferred) return inferred;
  const modelId = agent.modelId;
  const cached = modelContextWindowCache.get(modelId);
  if (cached) return cached;
  const pending = (async () => {
    const [rawProvider, ...modelParts] = modelId.split(":");
    const modelName = modelParts.join(":");
    if (!rawProvider || !modelName) return resolveFallbackModelContextWindowTokens(modelId);
    try {
      const model = await getModel(normalizeModelMetadataProvider(rawProvider), modelName);
      const contextWindow = model.limit.context ?? model.limit.input;
      if (typeof contextWindow === "number" && Number.isFinite(contextWindow) && contextWindow > 0) {
        return Math.floor(contextWindow);
      }
    } catch {
      // Metadata may lag brand-new model IDs; keep runner behavior stable.
    }
    return resolveFallbackModelContextWindowTokens(modelId);
  })();
  modelContextWindowCache.set(modelId, pending);
  return pending;
}

function readUsageTokenCount(usage: LlmUsage | undefined, keys: string[]) {
  if (!usage) return undefined;
  for (const key of keys) {
    const value = usage[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, Math.floor(value));
    }
  }
  return undefined;
}

function buildProviderUsageTelemetry(
  usage: LlmUsage | undefined,
  contextWindowTokens: number,
  fallbackUsedTokens: number,
) {
  const inputTokens = readUsageTokenCount(usage, [
    "inputTokens",
    "promptTokens",
    "prompt_tokens",
  ]);
  const outputTokens = readUsageTokenCount(usage, [
    "outputTokens",
    "completionTokens",
    "completion_tokens",
  ]);
  const totalTokens = readUsageTokenCount(usage, ["totalTokens", "total_tokens"]);
  const reasoningTokens = readUsageTokenCount(usage, [
    "reasoningTokens",
    "reasoning_tokens",
  ]);
  const cachedInputTokens = readUsageTokenCount(usage, [
    "cachedInputTokens",
    "cachedPromptTokens",
    "cached_input_tokens",
    "cached_prompt_tokens",
  ]);
  const usedTokens = inputTokens ?? fallbackUsedTokens;
  const utilizationPct =
    contextWindowTokens > 0 ? Math.min(100, (usedTokens / contextWindowTokens) * 100) : 0;
  return {
    usageSource: inputTokens !== undefined ? "provider" : "estimate",
    estimatedUsedTokens: usedTokens,
    estimatedAvailableTokens: Math.max(0, contextWindowTokens - usedTokens),
    utilizationPct: Math.round(utilizationPct * 100) / 100,
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
  };
}

export function resolveAgentLlmCallTimeoutMs(agent: Agent): number {
  const configured = agent.llmCallTimeoutMs;
  if (typeof configured === "number" && Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured);
  }
  return readPositiveIntEnv(
    process.env.ORGOPS_LLM_CALL_TIMEOUT_MS,
    DEFAULT_LLM_CALL_TIMEOUT_MS,
  );
}

export function resolveAgentClassicMaxModelSteps(agent: Agent): number {
  const configured = agent.classicMaxModelSteps;
  if (typeof configured === "number" && Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured);
  }
  return DEFAULT_CLASSIC_MAX_MODEL_STEPS;
}

export function resolveTurnLlmStyle(agent: Agent, _events?: Event[]): LlmStyle {
  return normalizeLlmStyle(agent.llmStyle);
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

export async function reconcileLateInjectedMessages(input: {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  agent: Agent;
  channelId: string;
  seenEventIds: Set<string>;
  retryMessages: Array<{ role: "system" | "user"; content: string }>;
  attempt: number;
  maxAttempts: number;
  shouldSuppress?: (agent: Agent, event: Event) => boolean;
}) {
  const injected = await pullInjectedEventMessages({
    apiFetch: input.apiFetch,
    agent: input.agent,
    channelId: input.channelId,
    seenEventIds: input.seenEventIds,
    shouldInclude: shouldHandleEventForAgent,
    shouldSuppress: input.shouldSuppress,
  });
  if (!injected || injected.messages.length === 0) return false;
  input.retryMessages.push(...injected.messages);
  input.retryMessages.push({
    role: "system",
    content: [
      `New channel events arrived while you were responding on attempt ${input.attempt}/${input.maxAttempts}.`,
      "Re-evaluate using these events and return exactly one final JSON event object.",
    ].join("\n"),
  });
  return true;
}

export function createTurnExecutor(input: CreateTurnExecutorInput) {
  return async function executeTurn(agent: Agent, events: Event[]) {
    if (events.length === 0) return;
    const triggerEvent = events[events.length - 1]!;
    const channelId = triggerEvent?.channelId;
    if (!channelId) return;
    const bestEffort = async (label: string, fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (error) {
        console.warn(label, error);
      }
    };
    const emitTurnEvent = async (type: string, payload: Record<string, unknown>) => {
      await bestEffort("runner.turn.telemetry_failed", async () => {
        await input.api.emitEvent({
          type,
          source: `agent:${agent.name}`,
          channelId,
          payload: {
            triggerEventId: triggerEvent.id,
            eventCount: events.length,
            ...payload,
          },
        });
      });
    };

    await emitTurnEvent("agent.turn.started", {});
    if ((agent.mode ?? "CLASSIC") === "WRAPPED") {
      await runWrappedAgentTurn(
        {
          projectRoot: input.projectRoot,
          runtimeAuth: input.runtimeAuth,
          api: {
            apiFetch: input.api.apiFetch,
            emitEvent: input.api.emitEvent,
            ensureLifecycleChannel: input.api.ensureLifecycleChannel,
            getPackageSecretsEnv: input.api.getPackageSecretsEnv,
          },
        },
        agent,
        events,
      );
      await emitTurnEvent("agent.turn.completed", { runtime: "wrapped" });
      return;
    }
    const injectionEnv = await input.api.getPackageSecretsEnv(agent.name, channelId);
    const channelRecord = await input.api.getChannelRecord(channelId);
    const soul = typeof agent.soulContents === "string" ? agent.soulContents : "";
    const resolvedSkillRoots = (() => {
      const rootSet = new Set<string>();
      const roots: Array<{ path: string }> = [];
      for (const root of input.skillRoots) {
        const normalized = root.path.trim();
        if (!normalized || rootSet.has(normalized)) continue;
        rootSet.add(normalized);
        roots.push({ path: normalized });
      }
      for (const root of agent.additionalSkillRoots ?? []) {
        const normalized = root.trim();
        if (!normalized || rootSet.has(normalized)) continue;
        rootSet.add(normalized);
        roots.push({ path: normalized });
      }
      return roots;
    })();
    const allSkills = listSkillsFromRoots(resolvedSkillRoots);
    const enabledSkillSet = new Set(agent.enabledSkills ?? []);
    const alwaysPreloadedSkillSet = new Set(agent.alwaysPreloadedSkills ?? []);
    const selectedSkills = allSkills.filter((skill: any) => enabledSkillSet.has(skill.name));
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
    const plainTextReplies =
      resolveReplyContract(agent.modelId, agent.modelCapabilities) === "plain-text";
    const runnerGuidance = buildRunnerGuidance(
      nowMs,
      nowIso,
      resolvedSkillRoots.map((root) => root.path),
      coreEventTypes,
      {
        platform: process.platform,
        release: release(),
        arch: arch(),
        hostname: hostname(),
        shell: process.env.SHELL ?? process.env.ComSpec ?? "unknown",
        nodeVersion: process.version,
      },
      { replyContract: plainTextReplies ? "plain-text" : "json", agentName: agent.name },
    );
    const memoryContextMode = resolveAgentMemoryContextMode(agent);
    let eventHistory: Event[] = [];
    let systemContextMessages: string[] = [];
    if (memoryContextMode === "PER_CHANNEL_CROSS_CHANNEL") {
      const [channelRecentMemory, channelFullMemory, crossRecentMemory, crossFullMemory] =
        await Promise.all([
          getChannelRecentMemoryRecord(input.api.apiFetch, agent.name, channelId),
          getChannelFullMemoryRecord(input.api.apiFetch, agent.name, channelId),
          getCrossRecentMemoryRecord(input.api.apiFetch, agent.name),
          getCrossFullMemoryRecord(input.api.apiFetch, agent.name),
        ]);
      const recentSummaryWatermark = channelRecentMemory?.lastProcessedAt;
      const rawDeltaEvents = await listEventsAfterTimestamp(
        input.api.apiFetch,
        channelId,
        typeof recentSummaryWatermark === "number" && recentSummaryWatermark > 0
          ? recentSummaryWatermark
          : undefined,
      );
      eventHistory = getMeaningfulEvents(rawDeltaEvents);
      systemContextMessages = [
        channelRecentMemory?.summaryText
          ? buildSystemMemoryMessage(
              `Channel Recent Summary (last 10 minutes, ${channelId})`,
              channelRecentMemory.summaryText,
            )
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
      const fullChannelHistory = await listEventsAfterTimestamp(input.api.apiFetch, channelId);
      eventHistory = getMeaningfulEvents(fullChannelHistory);
    }
    const system = [
      runnerGuidance,
      `Your own workspace:\n${agent.workspacePath}\n`,
      `OrgOps system path:\n${input.projectRoot}\n`,
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
    const contextWindowTokens = await resolveModelContextWindowTokens(agent);
    const historyMaxChars = computeHistoryBudgetChars({
      contextWindowTokens,
      system,
      systemContextMessages,
    });
    const baseMessages = await buildModelMessages(agent, system, eventHistory, {
      systemContextMessages,
      apiFetch: input.api.apiFetch,
      historyMaxChars,
    });
    const mergedTriggerMessage =
      events.length > 1
        ? {
            role: "system" as const,
            content: JSON.stringify(
              {
                type: "system.pending.events.merged",
                mergedCount: events.length,
                newestEventId: events[events.length - 1]?.id,
                events: events.map((event) => ({
                  eventId: event.id,
                  type: event.type,
                  source: event.source,
                  channelId: event.channelId,
                  payload: event.payload ?? {},
                  createdAt: event.createdAt,
                })),
              },
              null,
              2,
            ),
          }
        : null;
    const invokeMessages = mergedTriggerMessage
      ? [...baseMessages, mergedTriggerMessage]
      : baseMessages;

    if (shouldEmitAuditEvents(agent)) {
      await bestEffort("runner.prompt.telemetry_failed", async () => {
        await input.api.emitEvent({
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
              content: contentForTelemetry(message.content),
            })),
          },
        });
      });
    }

    const systemContextChars = systemContextMessages.reduce(
      (sum, message) => sum + message.length,
      0,
    );
    const systemChars = system.length;
    const totalPromptChars = invokeMessages.reduce(
      (sum, message) => sum + contentCharLength(message.content),
      0,
    );
    const estimatedUsedTokens = estimateContextUsage(invokeMessages);
    const estimatedAvailableTokens = Math.max(0, contextWindowTokens - estimatedUsedTokens);
    const utilizationPct =
      contextWindowTokens > 0
        ? Math.min(100, (estimatedUsedTokens / contextWindowTokens) * 100)
        : 0;
    const emitContextWindowTelemetry = async (payload: Record<string, unknown>) => {
      if (!shouldEmitAuditEvents(agent)) return;
      await bestEffort("runner.context.telemetry_failed", async () => {
        await input.api.emitEvent({
          type: "telemetry.context.window.updated",
          source: "system:runner:context",
          status: "DELIVERED",
          channelId,
          payload: {
            agentName: agent.name,
            modelId: agent.modelId,
            contextWindowTokens,
            memoryContextMode,
            messageCount: invokeMessages.length,
            systemChars,
            systemContextChars,
            historyChars: Math.max(0, totalPromptChars - systemChars - systemContextChars),
            historyMaxChars,
            triggerEventId: triggerEvent.id,
            ...payload,
          },
        });
      });
    };
    await emitContextWindowTelemetry({
      usageSource: "estimate",
      estimatedUsedTokens,
      estimatedAvailableTokens,
      utilizationPct: Math.round(utilizationPct * 100) / 100,
    });

    let pendingMessages: ModelEventDraft[] = [];
    let stagedMessageSequence = 0;
    const flushMessages = async () => {
      const flushed = [...pendingMessages];
      for (const [index, draft] of pendingMessages.entries()) {
        await input.api.emitEvent({
          ...draft,
          idempotencyKey:
            draft.idempotencyKey ??
            `turn:${agent.name}:${triggerEvent.id}:message:${stagedMessageSequence + index}`,
        });
      }
      stagedMessageSequence += pendingMessages.length;
      pendingMessages = [];
      return flushed;
    };

    const executeCtx = {
      agent,
      triggerEvent,
      channelId,
      ...((agent.mode ?? "CLASSIC") === "CLASSIC"
        ? {
            deferMessage: (draft: ModelEventDraft) => {
              pendingMessages.push(draft);
            },
          }
        : {}),
      extraAllowedRoots: selectedSkills.map((skill: any) => skill.path),
      injectionEnv,
      apiFetch: input.api.apiFetch,
      emitEvent: input.api.emitEvent,
      emitAudit: (
        type: string,
        payload: unknown,
        source = `agent:${agent.name}`,
      ) =>
        shouldEmitAuditEvents(agent)
          ? input.api.emitEvent({
              type,
              payload,
              source,
              ...(channelId ? { channelId } : {}),
            })
          : Promise.resolve(),
      listEventTypes: (query?: { source?: string; typePrefix?: string }) =>
        queryEventTypes(serializedEventTypes, query),
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
      console.warn("skill event shape load errors", loadedSkillEventShapes.errors);
    }
    let postedMessageToChannel = false;
    const runnerTools = createRunnerTools({
      agent,
      event: triggerEvent,
      channelId,
      runTool: async (tool, args) => {
        const output = await executeTool(executeCtx, tool, args);
        const emitted = output as { channelId?: unknown; event?: { type?: unknown; deliverAt?: unknown } };
        if (
          tool === "events_emit" &&
          emitted?.channelId === channelId &&
          emitted.event?.type === "message.created" &&
          !emitted.event.deliverAt
        ) {
          postedMessageToChannel = true;
        }
        return output;
      },
      apiFetch: input.api.apiFetch,
      emitEvent: input.api.emitEvent,
    });
    const tools = {
      ...runnerTools,
      [TURN_FINISH_TOOL_NAME]: turnFinishTool,
      ...(plainTextReplies
        ? {
            // No execute: the model loop stops on this call and the runner ends the turn silently.
            [NOOP_TOOL_NAME]: {
              description: "Finish your turn without posting a reply.",
              inputSchema: z.object({ reason: z.string().optional() }),
            },
          }
        : {}),
    };
    if ((agent.mode ?? "CLASSIC") === "RLM_REPL") {
      await runRlmEventInChild({
        agent,
        event: triggerEvent,
        channelId,
        systemPrompt: system,
        baseMessages: invokeMessages,
        executeCtx,
        apiFetch: input.api.apiFetch,
        emitEvent: input.api.emitEvent,
      });
      await emitTurnEvent("agent.turn.completed", {});
      return;
    }
    const seenEventIds = new Set(events.map((event) => event.id));
    const retryMessages: LlmMessage[] = [];
    const shouldSuppressInjectedEvent = createSyncProcessInjectionSuppressor();
    const channelPostingValidationCache = new Map<string, string | null>();
    const llmCallTimeoutMs =
      typeof agent.llmCallTimeoutMs === "number" &&
      Number.isFinite(agent.llmCallTimeoutMs) &&
      agent.llmCallTimeoutMs > 0
        ? Math.floor(agent.llmCallTimeoutMs)
        : input.llmCallTimeoutMs;
    const classicMaxModelSteps = resolveAgentClassicMaxModelSteps(agent);
    let lastResponseText = "";
    let correctionAttempts = 0;
    let lateEventContinuations = 0;
    let completionContinuations = 0;
    let completionProtocolFailed = false;
    const humanRequest = events.some(
      (event) => event.type === "message.created" && event.source?.startsWith("human:"),
    );
    const currentScheduledCompletionAttempt = scheduledCompletionAttempt(triggerEvent.payload);
    const maxModelAttempts =
      MAX_EVENT_DISPATCH_ATTEMPTS +
      MAX_LATE_EVENT_CONTINUATIONS +
      MAX_TURN_COMPLETION_CONTINUATIONS;
    const appendPostedEventsForContinuation = (
      postedEvents: ModelEventDraft[],
    ) => {
      if (postedEvents.length === 0) return;
      retryMessages.push({
        role: "system",
        content: JSON.stringify(
          {
            type: "system.turn.events_posted",
            note: "These events were already posted during this turn before later channel events arrived.",
            events: postedEvents,
          },
          null,
          2,
        ),
      });
    };
    const continueForLateEvents = async (
      postedEvents: ModelEventDraft[],
      attempt: number,
    ): Promise<boolean> => {
      if (lateEventContinuations >= MAX_LATE_EVENT_CONTINUATIONS) return false;
      const injected = await pullInjectedEventMessages({
        apiFetch: input.api.apiFetch,
        agent,
        channelId,
        seenEventIds,
        shouldInclude: shouldHandleEventForAgent,
        shouldSuppress: shouldSuppressInjectedEvent,
      });
      if (!injected || injected.messages.length === 0) return false;
      lateEventContinuations += 1;
      appendPostedEventsForContinuation(postedEvents);
      retryMessages.push(...injected.messages);
      retryMessages.push({
        role: "system",
        content: [
          `New channel events arrived after your previous response was already posted on model attempt ${attempt}.`,
          `Continue the same turn using those events. If no follow-up is needed, ${plainTextReplies ? `call ${NOOP_TOOL_NAME}` : "finish with a noop event"}.`,
          `Otherwise close the follow-up with ${TURN_FINISH_TOOL_NAME} or the documented fallback completion contract.`,
        ].join("\n"),
      });
      return true;
    };
    for (let attempt = 1; attempt <= maxModelAttempts; attempt += 1) {
      pendingMessages = [];
      postedMessageToChannel = false;
      lastResponseText = "";
      let result: GenerateResult;
      try {
        result = await withTimeout(
          generate(
            agent.modelId,
            clampMessagesForProviderLimit([...invokeMessages, ...retryMessages]),
            {
            tools,
            maxSteps: classicMaxModelSteps,
            llmStyle: resolveTurnLlmStyle(agent, events),
            env: injectionEnv,
            pullMessages: async () => {
              const injected = await pullInjectedEventMessages({
                apiFetch: input.api.apiFetch,
                agent,
                channelId,
                seenEventIds,
                shouldInclude: shouldHandleEventForAgent,
                shouldSuppress: shouldSuppressInjectedEvent,
              });
              return injected?.messages ?? [];
            },
          },
          ),
          llmCallTimeoutMs,
          `LLM generate (attempt ${attempt})`,
        );
      } catch (error) {
        if (!isRetryableToolArgumentValidationError(error)) throw error;
        correctionAttempts += 1;
        completionProtocolFailed = true;
        if (correctionAttempts >= MAX_EVENT_DISPATCH_ATTEMPTS) break;
        retryMessages.push({
          role: "system",
          content: [
            `Your tool call arguments were invalid on correction attempt ${correctionAttempts}/${MAX_EVENT_DISPATCH_ATTEMPTS}.`,
            `Error: ${String(error)}`,
            "Retry with corrected tool arguments. For optional string filters, omit the field instead of sending an empty string.",
            `Close the turn with ${TURN_FINISH_TOOL_NAME} or the documented fallback completion contract.`,
          ].join("\n"),
        });
        continue;
      }
      if (result.usage) {
        await recordLlmUsage(input.api.apiFetch, {
          channelId,
          agentName: agent.name,
          modelId: agent.modelId,
          runtime: "classic",
          purpose: "turn",
          triggerEventId: triggerEvent.id,
          usage: result.usage,
          metadata: {
            attempt,
            finishReason: result.finishReason ?? "unknown",
          },
        });
        await emitContextWindowTelemetry({
          ...buildProviderUsageTelemetry(
            result.usage,
            contextWindowTokens,
            estimatedUsedTokens,
          ),
          attempt,
          finishReason: result.finishReason ?? "unknown",
        });
      }
      const responseText = result.text ?? "";
      lastResponseText = responseText;
      let appendedAttemptTranscript = false;
      const appendAttemptTranscript = (stripTerminalToolCall = false) => {
        if (appendedAttemptTranscript) return;
        appendedAttemptTranscript = true;
        const responseMessages = stripTerminalToolCall
          ? result.responseMessages?.slice(0, -1)
          : result.responseMessages;
        if (responseMessages?.length) {
          retryMessages.push(...responseMessages);
        } else if (!stripTerminalToolCall && responseText.trim()) {
          retryMessages.push({ role: "assistant", content: responseText.trim() });
        }
      };
      const explicitNoop = (result.toolCalls ?? []).some(
        (call) => (call as { toolName?: unknown }).toolName === NOOP_TOOL_NAME,
      );
      if (explicitNoop) {
        const postedEvents = await flushMessages();
        if (await continueForLateEvents(postedEvents, attempt)) continue;
        await emitTurnEvent("agent.turn.completed", { noReply: postedEvents.length === 0 });
        return;
      }

      let completion: TurnCompletionOutcome | null = completionFromToolCalls(result);
      const malformedTurnFinish = calledTurnFinish(result) && !completion;
      if (!completion && responseText.trim()) {
        completion = plainTextReplies
          ? completionFromPlainText(responseText)
          : completionFromJson(responseText);
      }

      if (completion?.status === "CONTINUE") {
        completionContinuations += 1;
        if (completionContinuations > MAX_TURN_COMPLETION_CONTINUATIONS) {
          completionProtocolFailed = true;
          break;
        }
        pendingMessages = [];
        appendAttemptTranscript();
        retryMessages.push({
          role: "system",
          content: [
            `You requested CONTINUE on completion continuation ${completionContinuations}/${MAX_TURN_COMPLETION_CONTINUATIONS}.`,
            "Continue the unfinished work now using tools. Do not repeat the withheld progress message.",
            `When the turn can end, call ${TURN_FINISH_TOOL_NAME} with a terminal status.`,
          ].join("\n"),
        });
        continue;
      }

      if (completion) {
        let eventDraft: ModelEventDraft | null = null;
        try {
          if (completion.event) {
            eventDraft = normalizeEventDraft(completion.event, agent.name, channelId);
          } else if (completion.message) {
            eventDraft = {
              type: "message.created",
              source: `agent:${agent.name}`,
              channelId,
              payload: { text: completion.message },
              parentEventId: triggerEvent.id,
            };
          }
        } catch (error) {
          correctionAttempts += 1;
          completionProtocolFailed = true;
          if (correctionAttempts >= MAX_EVENT_DISPATCH_ATTEMPTS) break;
          appendAttemptTranscript(completion.source === "tool");
          retryMessages.push({
            role: "system",
            content: [
              `Your ${TURN_FINISH_TOOL_NAME} event was invalid on correction attempt ${correctionAttempts}/${MAX_EVENT_DISPATCH_ATTEMPTS}.`,
              `Error: ${String(error)}`,
              `Call ${TURN_FINISH_TOOL_NAME} again with a corrected terminal outcome.`,
            ].join("\n"),
          });
          continue;
        }

        if (completion.status !== "RETRY_LATER" && !eventDraft) {
          correctionAttempts += 1;
          completionProtocolFailed = true;
          if (correctionAttempts >= MAX_EVENT_DISPATCH_ATTEMPTS) break;
          appendAttemptTranscript(completion.source === "tool");
          retryMessages.push({
            role: "system",
            content: [
              `Your completion outcome omitted its user-facing message or event on correction attempt ${correctionAttempts}/${MAX_EVENT_DISPATCH_ATTEMPTS}.`,
              `Call ${TURN_FINISH_TOOL_NAME} with a corrected terminal outcome.`,
            ].join("\n"),
          });
          continue;
        }

        if (eventDraft) {
          eventDraft.idempotencyKey ??=
            `turn:${agent.name}:${triggerEvent.id}:completion`;
          const validation = validateEventAgainstShapes(eventDraft, eventShapes);
          let validationError = validation.ok ? "" : formatValidationErrors(validation);
          const targetChannelId = eventDraft.channelId?.trim();
          if (!validationError && targetChannelId) {
            if (!channelPostingValidationCache.has(targetChannelId)) {
              channelPostingValidationCache.set(
                targetChannelId,
                await input.api.getChannelParticipationValidationError(
                  agent.name,
                  targetChannelId,
                ),
              );
            }
            validationError = channelPostingValidationCache.get(targetChannelId) ?? "";
          }
          if (validationError) {
            correctionAttempts += 1;
            completionProtocolFailed = true;
            if (correctionAttempts >= MAX_EVENT_DISPATCH_ATTEMPTS) break;
            appendAttemptTranscript(completion.source === "tool");
            retryMessages.push({
              role: "system",
              content: [
                `Your completion event failed validation on correction attempt ${correctionAttempts}/${MAX_EVENT_DISPATCH_ATTEMPTS}.`,
                validationError,
                `Call ${TURN_FINISH_TOOL_NAME} again with a corrected terminal outcome.`,
              ].join("\n"),
            });
            continue;
          }
        }

        if (completion.status === "RETRY_LATER") {
          if (
            !channelId ||
            currentScheduledCompletionAttempt >= MAX_SCHEDULED_COMPLETION_ATTEMPTS
          ) {
            const exhausted: ModelEventDraft = {
              type: "message.created",
              source: `agent:${agent.name}`,
              channelId,
              payload: { text: TURN_CONTINUATION_EXHAUSTED },
              parentEventId: triggerEvent.id,
              idempotencyKey: `turn:${agent.name}:${triggerEvent.id}:continuation-exhausted`,
            };
            await input.api.emitEvent(exhausted);
            await emitTurnEvent("agent.turn.completed", {
              completedWithFallback: true,
              turnStatus: "RETRY_EXHAUSTED",
            });
            return;
          }
          const retryAfterSeconds = clampCompletionRetrySeconds(
            completion.retryAfterSeconds,
          );
          const postedEvents = await flushMessages();
          if (eventDraft) {
            await input.api.emitEvent(eventDraft);
            postedEvents.push(eventDraft);
          }
          const scheduledEvent: ModelEventDraft = {
            type: "agent.scheduled.trigger",
            source: "system:scheduler",
            channelId,
            deliverAt: Date.now() + retryAfterSeconds * 1_000,
            payload: {
              text: "Resume the unfinished work from the previous turn. Verify current state before repeating side effects.",
              targetAgentName: agent.name,
              turnCompletionAttempt: currentScheduledCompletionAttempt + 1,
              originalTriggerEventId:
                (triggerEvent.payload as { originalTriggerEventId?: unknown } | null)
                  ?.originalTriggerEventId ?? triggerEvent.id,
            },
            idempotencyKey: `turn:${agent.name}:${triggerEvent.id}:scheduled-continuation`,
          };
          await input.api.emitEvent(scheduledEvent);
          await emitTurnEvent("agent.turn.completed", {
            scheduledContinuation: true,
            retryAfterSeconds,
            turnStatus: completion.status,
          });
          return;
        }

        const postedEvents = await flushMessages();
        if (eventDraft) {
          await input.api.emitEvent(eventDraft);
          postedEvents.push(eventDraft);
        }
        if (await continueForLateEvents(postedEvents, attempt)) continue;
        await emitTurnEvent("agent.turn.completed", {
          turnStatus: completion.status,
        });
        return;
      }

      if (!responseText.trim() && postedMessageToChannel) {
        correctionAttempts += 1;
        completionProtocolFailed = true;
        if (correctionAttempts >= MAX_EVENT_DISPATCH_ATTEMPTS) break;
        appendAttemptTranscript();
        retryMessages.push({
          role: "system",
          content: [
            `You posted a channel message but did not close the turn on correction attempt ${correctionAttempts}/${MAX_EVENT_DISPATCH_ATTEMPTS}.`,
            `Do not repeat that message. Continue unfinished work or call ${TURN_FINISH_TOOL_NAME} with the actual terminal outcome.`,
          ].join("\n"),
        });
        continue;
      }

      if (
        !responseText.trim() &&
        humanRequest &&
        generateUsedTools(result) &&
        !malformedTurnFinish
      ) {
        // A tool loop that exhausted its model-step budget cannot reliably
        // self-classify. Summarize its real transcript once, without tools.
        let reply =
          "I stopped after using tools without producing an answer. The requested work may be incomplete. Please ask me to continue.";
        if (result.responseMessages?.length) {
          try {
            const summary = await withTimeout(
              generate(
                agent.modelId,
                clampMessagesForProviderLimit([
                  ...invokeMessages,
                  ...retryMessages,
                  ...result.responseMessages,
                  {
                    role: "system",
                    content:
                      "The tool phase has ended. Write a short plain-text reply to the human using only the results above. Explain what was accomplished, what failed, and what remains incomplete. Do not claim completion without evidence. Do not call tools or return a JSON event. Do not reveal credentials or secret tool output.",
                  },
                ]),
                {
                  maxSteps: 1,
                  maxTokens: 1200,
                  env: injectionEnv,
                  abortSignal: AbortSignal.timeout(Math.min(llmCallTimeoutMs, 15_000)),
                },
              ),
              Math.min(llmCallTimeoutMs, 15_000),
              "LLM final summary",
            );
            if (summary.usage) {
              await recordLlmUsage(input.api.apiFetch, {
                channelId,
                agentName: agent.name,
                modelId: agent.modelId,
                runtime: "classic",
                purpose: "turn",
                triggerEventId: triggerEvent.id,
                usage: summary.usage,
                metadata: { attempt, finalSummary: true },
              });
            }
            const text = summary.text?.trim();
            if (text && !/^(\{|```)/.test(text) && !generateUsedTools(summary)) {
              reply = text;
            }
          } catch {
            // A failed or timed-out summary must still leave a visible notice.
          }
        }
        const notice: ModelEventDraft = {
          type: "message.created",
          source: `agent:${agent.name}`,
          channelId,
          payload: { text: reply },
          parentEventId: triggerEvent.id,
          idempotencyKey: `turn:${agent.name}:${triggerEvent.id}:final-summary:${attempt}`,
        };
        await input.api.emitEvent(notice);
        if (await continueForLateEvents([notice], attempt)) continue;
        await emitTurnEvent("agent.turn.completed", { completedWithFallback: true });
        return;
      }

      if (!humanRequest && !responseText.trim() && generateUsedTools(result)) {
        await emitTurnEvent("agent.turn.completed", { noReply: true });
        return;
      }

      completionProtocolFailed = true;
      correctionAttempts += 1;
      appendAttemptTranscript(malformedTurnFinish);
      if (correctionAttempts >= MAX_EVENT_DISPATCH_ATTEMPTS) break;
      retryMessages.push({
        role: "system",
        content: [
          malformedTurnFinish
            ? `Your ${TURN_FINISH_TOOL_NAME} call was invalid.`
            : "Your previous response did not include a valid turn completion outcome.",
          `This is correction attempt ${correctionAttempts}/${MAX_EVENT_DISPATCH_ATTEMPTS}.`,
          `Continue unfinished work now, or call ${TURN_FINISH_TOOL_NAME} with DONE, BLOCKED, WAITING_USER, or RETRY_LATER.`,
          plainTextReplies
            ? "If function tools are unavailable, use the ORGOPS_TURN_STATUS trailer."
            : "If function tools are unavailable, return fallback JSON with turnStatus.",
        ].join("\n"),
      });
      continue;
    }
    if (completionProtocolFailed) {
      pendingMessages = [];
      await emitTurnEvent("agent.turn.phase", {
        phase: "turn.completion_error",
        detail: TURN_COMPLETION_ERROR,
        attempts: MAX_EVENT_DISPATCH_ATTEMPTS,
        responsePreview: truncateOversizedText(lastResponseText.trim(), 500),
      });
      if (humanRequest || currentScheduledCompletionAttempt > 0) {
        await input.api.emitEvent({
          type: "message.created",
          source: `agent:${agent.name}`,
          channelId,
          payload: { text: TURN_COMPLETION_ERROR },
          parentEventId: triggerEvent.id,
          idempotencyKey: `turn:${agent.name}:${triggerEvent.id}:completion-fallback`,
        });
      }
      await emitTurnEvent("agent.turn.completed", {
        completedWithFallback: true,
        noReply: !humanRequest && currentScheduledCompletionAttempt === 0,
        turnCompletionError: true,
      });
      return;
    }
    const flushedAtEnd = await flushMessages();
    const hasAnswer = flushedAtEnd.some((draft) => draft.channelId === channelId);
    if (hasAnswer) {
      await emitTurnEvent("agent.turn.completed", { completedWithFallback: true });
      return;
    }
    if (!lastResponseText.trim()) {
      await emitTurnEvent("agent.turn.completed", { noReply: true });
      return;
    }
    await emitTurnEvent("agent.turn.phase", {
      phase: "response.format_error",
      detail: RESPONSE_FORMAT_ERROR,
      attempts: MAX_EVENT_DISPATCH_ATTEMPTS,
      responsePreview: truncateOversizedText(lastResponseText.trim(), 500),
    });
    await emitTurnEvent("agent.turn.completed", {
      completedWithFallback: true,
      noReply: true,
      responseFormatError: true,
    });
  };
}
