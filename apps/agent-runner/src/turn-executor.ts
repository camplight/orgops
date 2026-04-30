import { arch, hostname, release } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { generate } from "@orgops/llm";
import { listSkills, loadSkillEventShapes } from "@orgops/skills";
import {
  type EventValidationResult,
  type EventTypeSummary,
  getCoreEventShapes,
  serializeEventShapes,
  validateEventAgainstShapes,
} from "@orgops/schemas";
import { createRunnerTools, executeTool } from "./tools";
import { pullInjectedEventMessages } from "./channel-injection";
import { shouldHandleEventForAgent } from "./event-routing";
import { getReservedEventTypeError } from "./event-type-guard";
import { buildRunnerGuidance } from "./prompt";
import { runRlmEventInChild } from "./rlm-process";
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
import {
  buildModelMessages,
  contentCharLength,
  contentForTelemetry,
  estimateContextUsage,
  selectRecentDeltaEventsForPrompt,
} from "./prompt-composer";
import type { Agent, Event } from "./types";
import type { RunnerApi } from "./runner/api";

const DEFAULT_LLM_CALL_TIMEOUT_MS = 10_800_000;
const DEFAULT_CLASSIC_MAX_MODEL_STEPS = 100;
const MAX_EVENT_DISPATCH_ATTEMPTS = 3;
const DEFAULT_MEMORY_CONTEXT_MODE = "PER_CHANNEL_CROSS_CHANNEL" as const;
const FALLBACK_MODEL_CONTEXT_WINDOW_TOKENS = 128_000;

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
  skillRoot: { path: string };
  llmCallTimeoutMs: number;
  api: Pick<
    RunnerApi,
    | "apiFetch"
    | "emitEvent"
    | "listChannels"
    | "getChannelRecord"
    | "getChannelParticipationValidationError"
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

function shouldEmitAuditEvents(agent: Agent): boolean {
  return agent.emitAuditEvents !== false;
}

function resolveModelContextWindowTokens(modelId: string): number {
  const normalized = modelId.toLowerCase();
  if (normalized.includes("gpt-4o-mini")) return 128_000;
  if (normalized.includes("gpt-4o")) return 128_000;
  if (normalized.includes("gpt-4.1-mini")) return 1_000_000;
  if (normalized.includes("gpt-4.1")) return 1_000_000;
  if (normalized.includes("gpt-5")) return 1_000_000;
  return FALLBACK_MODEL_CONTEXT_WINDOW_TOKENS;
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
  retryMessages: Array<{ role: "user"; content: string }>;
  attempt: number;
  maxAttempts: number;
}) {
  const injected = await pullInjectedEventMessages({
    apiFetch: input.apiFetch,
    agent: input.agent,
    channelId: input.channelId,
    seenEventIds: input.seenEventIds,
    shouldInclude: shouldHandleEventForAgent,
  });
  if (!injected || injected.messages.length === 0) return false;
  input.retryMessages.push(...injected.messages);
  input.retryMessages.push({
    role: "user",
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
    const injectionEnv = await input.api.getPackageSecretsEnv(agent.name, channelId);
    const channelRecord = await input.api.getChannelRecord(channelId);
    const soul = typeof agent.soulContents === "string" ? agent.soulContents : "";
    const allSkills = listSkills(input.skillRoot);
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
    const runnerGuidance = buildRunnerGuidance(
      nowMs,
      nowIso,
      input.skillRoot.path,
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
      const fullChannelHistory = await listEventsAfterTimestamp(input.api.apiFetch, channelId);
      eventHistory = getMeaningfulEvents(fullChannelHistory);
    }
    const system = [
      agent.systemInstructions,
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
    const baseMessages = await buildModelMessages(agent, system, eventHistory, {
      systemContextMessages,
      apiFetch: input.api.apiFetch,
    });
    const mergedTriggerMessage =
      events.length > 1
        ? {
            role: "user" as const,
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
    const contextWindowTokens = resolveModelContextWindowTokens(agent.modelId);
    const estimatedAvailableTokens = Math.max(0, contextWindowTokens - estimatedUsedTokens);
    const utilizationPct =
      contextWindowTokens > 0
        ? Math.min(100, (estimatedUsedTokens / contextWindowTokens) * 100)
        : 0;
    if (shouldEmitAuditEvents(agent)) {
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
      });
    }

    const executeCtx = {
      agent,
      triggerEvent,
      channelId,
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
    const tools = createRunnerTools({
      agent,
      event: triggerEvent,
      channelId,
      runTool: (tool, args) => executeTool(executeCtx, tool, args),
      apiFetch: input.api.apiFetch,
      emitEvent: input.api.emitEvent,
    });
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
    const retryMessages: Array<{ role: "user"; content: string }> = [];
    const channelPostingValidationCache = new Map<string, string | null>();
    const llmCallTimeoutMs =
      typeof agent.llmCallTimeoutMs === "number" &&
      Number.isFinite(agent.llmCallTimeoutMs) &&
      agent.llmCallTimeoutMs > 0
        ? Math.floor(agent.llmCallTimeoutMs)
        : input.llmCallTimeoutMs;
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
                apiFetch: input.api.apiFetch,
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
        if (!isRetryableToolArgumentValidationError(error)) throw error;
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
      const hasLateInjectedEvents = await reconcileLateInjectedMessages({
        apiFetch: input.api.apiFetch,
        agent,
        channelId,
        seenEventIds,
        retryMessages,
        attempt,
        maxAttempts: MAX_EVENT_DISPATCH_ATTEMPTS,
      });
      if (hasLateInjectedEvents) continue;
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
            await input.api.getChannelParticipationValidationError(agent.name, targetChannelId),
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
      await input.api.emitEvent(eventDraft);
      await emitTurnEvent("agent.turn.completed", {});
      return;
    }
    await input.api.emitEvent(
      buildFallbackMessageEvent(agent.name, channelId, lastResponseText, triggerEvent.id),
    );
    await emitTurnEvent("agent.turn.completed", { completedWithFallback: true });
  };
}
