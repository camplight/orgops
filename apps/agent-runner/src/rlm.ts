import { createRequire } from "node:module";
import { inspect } from "node:util";
import { generate, type LlmMessage, type LlmTool } from "@orgops/llm";
import { createJsRuntimeSession, type JsRuntimeSession } from "@orgops/js-runtime";
import { createRunnerTools, executeTool, type ExecuteContext } from "./tools";
import type { Agent, Event } from "./types";
import { pullInjectedEventMessages } from "./channel-injection";
import { shouldHandleEventForAgent } from "./event-routing";
import { getReservedEventTypeError } from "./event-type-guard";

const DEFAULT_MAX_STEPS = 24;
const DEFAULT_MAX_OUTPUT_CHARS = 16_000;
const DEFAULT_MAX_INPUT_CHARS = 16_000;
const DEFAULT_EVAL_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_SUBAGENT_DEPTH = 3;
const DEFAULT_MAX_SUBAGENTS_PER_EVENT = 12;

function readPositiveIntEnv(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const RLM_MAX_STEPS = readPositiveIntEnv(
  process.env.ORGOPS_RLM_MAX_STEPS,
  DEFAULT_MAX_STEPS,
);
const RLM_MAX_OUTPUT_CHARS = readPositiveIntEnv(
  process.env.ORGOPS_RLM_MAX_OUTPUT_CHARS,
  DEFAULT_MAX_OUTPUT_CHARS,
);
const RLM_MAX_INPUT_CHARS = readPositiveIntEnv(
  process.env.ORGOPS_RLM_MAX_INPUT_CHARS,
  DEFAULT_MAX_INPUT_CHARS,
);
const RLM_PROMPT_PREVIEW_MAX_CHARS = readPositiveIntEnv(
  process.env.ORGOPS_RLM_PROMPT_PREVIEW_MAX_CHARS,
  RLM_MAX_INPUT_CHARS,
);
const RLM_EVAL_TIMEOUT_MS = readPositiveIntEnv(
  process.env.ORGOPS_RLM_EVAL_TIMEOUT_MS,
  DEFAULT_EVAL_TIMEOUT_MS,
);
const RLM_MAX_SUBAGENT_DEPTH = readPositiveIntEnv(
  process.env.ORGOPS_RLM_MAX_SUBAGENT_DEPTH,
  DEFAULT_MAX_SUBAGENT_DEPTH,
);
const RLM_MAX_SUBAGENTS_PER_EVENT = readPositiveIntEnv(
  process.env.ORGOPS_RLM_MAX_SUBAGENTS_PER_EVENT,
  DEFAULT_MAX_SUBAGENTS_PER_EVENT,
);

type RlmSession = {
  id: string;
  depth: number;
  runtime: JsRuntimeSession;
  context: Record<string, unknown>;
  reservedKeys: Set<string>;
  done: boolean;
  doneValue: unknown;
};

type RunState = {
  spawnedSubagents: number;
  toolCallsThisStep: ToolCallRecord[];
};

type ToolDoc = {
  name: string;
  description?: string;
  parameters?: unknown;
};

type ToolCallRecord = {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  output?: unknown;
  error?: string;
};

type RunReplLoopInput = {
  agent: Agent;
  event: Event;
  channelId: string;
  executeCtx: ExecuteContext;
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  emitEvent: (event: unknown) => Promise<void>;
  session: RlmSession;
  runState: RunState;
  promptText: string;
  depth: number;
  maxSteps: number;
  toolDocs?: ToolDoc[];
  includeChannelMessages: boolean;
  baseMessages?: LlmMessage[];
  generateFn?: RlmGenerateFn;
  seenEventIds?: Set<string>;
  enableChannelInjection?: boolean;
};

type RlmGenerateFn = (
  modelId: string,
  messages: LlmMessage[],
  options?: {
    maxSteps?: number;
    env?: Record<string, string | undefined>;
  },
) => Promise<{ text: string }>;

const rootSessions = new Map<string, RlmSession>();
const requireFromRunner = createRequire(import.meta.url);

function shouldEmitAgentAuditEvents(agent: Agent): boolean {
  return agent.emitAuditEvents !== false;
}

function newSessionId(agentName: string, depth: number) {
  return `${agentName}:${depth}:${Date.now()}:${Math.floor(Math.random() * 1_000_000)}`;
}

function truncateText(
  value: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (value.length <= maxChars) return { text: value, truncated: false };
  return {
    text: `${value.slice(0, maxChars)}\n...[truncated ${value.length - maxChars} chars]`,
    truncated: true,
  };
}

function extractCode(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const fenced = trimmed.match(
    /```(?:repl|js|javascript|ts|typescript)?\s*([\s\S]*?)\s*```/i,
  );
  return fenced?.[1] ? fenced[1].trim() : trimmed;
}

function formatValue(value: unknown): string {
  try {
    return inspect(value, {
      depth: 4,
      maxArrayLength: 100,
      maxStringLength: 10_000,
      breakLength: 120,
      compact: false,
    });
  } catch {
    try {
      return String(value);
    } catch {
      return "<unprintable>";
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type DoneEventNormalizationResult =
  | {
      ok: true;
      eventDraft: {
        type: string;
        payload: unknown;
        source: string;
        channelId?: string;
        parentEventId?: string;
        deliverAt?: number;
        idempotencyKey?: string;
      };
    }
  | { ok: false; error: string };

function normalizeDoneEventDraft(
  doneValue: unknown,
  agent: Agent,
  channelId: string,
): DoneEventNormalizationResult | null {
  if (!isRecord(doneValue) || typeof doneValue.type !== "string") return null;
  const type = doneValue.type.trim();
  if (!type) {
    return {
      ok: false,
      error: 'done(result) event draft is invalid: `type` must be a non-empty string.',
    };
  }
  const reservedTypeError = getReservedEventTypeError(type);
  if (reservedTypeError) return { ok: false, error: reservedTypeError };
  const resolvedChannelId =
    typeof doneValue.channelId === "string" && doneValue.channelId.trim().length > 0
      ? doneValue.channelId.trim()
      : channelId;
  if (!resolvedChannelId) {
    return {
      ok: false,
      error:
        "done(result) event draft is invalid: unable to resolve `channelId`; include a non-empty channelId.",
    };
  }
  const parentEventId =
    doneValue.parentEventId === undefined
      ? undefined
      : typeof doneValue.parentEventId === "string" && doneValue.parentEventId.trim().length > 0
        ? doneValue.parentEventId.trim()
        : null;
  if (parentEventId === null) {
    return {
      ok: false,
      error:
        "done(result) event draft is invalid: `parentEventId` must be a non-empty string when provided.",
    };
  }
  const idempotencyKey =
    doneValue.idempotencyKey === undefined
      ? undefined
      : typeof doneValue.idempotencyKey === "string" && doneValue.idempotencyKey.trim().length > 0
        ? doneValue.idempotencyKey.trim()
        : null;
  if (idempotencyKey === null) {
    return {
      ok: false,
      error:
        "done(result) event draft is invalid: `idempotencyKey` must be a non-empty string when provided.",
    };
  }
  const deliverAt =
    doneValue.deliverAt === undefined
      ? undefined
      : typeof doneValue.deliverAt === "number" && Number.isFinite(doneValue.deliverAt)
        ? Math.floor(doneValue.deliverAt)
        : null;
  if (deliverAt === null) {
    return {
      ok: false,
      error:
        "done(result) event draft is invalid: `deliverAt` must be a finite number (unix ms) when provided.",
    };
  }
  return {
    ok: true,
    eventDraft: {
      type,
      payload: doneValue.payload ?? {},
      source: `agent:${agent.name}`,
      channelId: resolvedChannelId,
      ...(parentEventId ? { parentEventId } : {}),
      ...(idempotencyKey ? { idempotencyKey } : {}),
      ...(deliverAt !== undefined ? { deliverAt } : {}),
    },
  };
}

function formatEventValidationIssues(
  validation:
    | { ok: true; matchedDefinitions: number }
    | {
        ok: false;
        type: string;
        matchedDefinitions: number;
        issues: Array<{ source: string; message: string }>;
      },
): string {
  if (validation.ok) return "";
  return validation.issues
    .slice(0, 8)
    .map((issue) => `- [${issue.source}] ${issue.message}`)
    .join("\n");
}

async function ensurePostingAgentParticipantInChannel(
  executeCtx: ExecuteContext,
  channelId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await executeCtx.apiFetch("/api/channels");
  const channels = (await response.json()) as Array<{
    id: string;
    participants?: Array<{ subscriberType?: string; subscriberId?: string }>;
  }>;
  const channel = channels.find((entry) => entry.id === channelId);
  if (!channel) return { ok: false, error: `Unknown channelId "${channelId}".` };
  const isParticipant = (channel.participants ?? []).some(
    (participant) =>
      String(participant.subscriberType ?? "").toUpperCase() === "AGENT" &&
      participant.subscriberId === executeCtx.agent.name,
  );
  if (!isParticipant) {
    return {
      ok: false,
      error: `Event validation failed: agent "${executeCtx.agent.name}" is not an AGENT participant in channel "${channelId}".`,
    };
  }
  return { ok: true };
}

async function tryEmitDoneValueAsEvent(input: {
  doneValue: unknown;
  agent: Agent;
  channelId: string;
  executeCtx: ExecuteContext;
  emitEvent: (event: unknown) => Promise<void>;
}): Promise<{ emitted: boolean; error?: string; eventType?: string }> {
  const normalized = normalizeDoneEventDraft(input.doneValue, input.agent, input.channelId);
  if (!normalized) return { emitted: false };
  if (!normalized.ok) return { emitted: false, error: normalized.error };
  const targetChannelId = normalized.eventDraft.channelId ?? input.channelId;
  const postingMembership = await ensurePostingAgentParticipantInChannel(
    input.executeCtx,
    targetChannelId,
  );
  if (!postingMembership.ok) return { emitted: false, error: postingMembership.error };
  const validation = input.executeCtx.validateEvent?.(normalized.eventDraft);
  if (validation && !validation.ok) {
    const details = formatEventValidationIssues(validation);
    return {
      emitted: false,
      error: [
        `Event validation failed for type "${normalized.eventDraft.type}".`,
        "Adjust the payload/schema and retry.",
        details || "- Unknown validation issue.",
      ].join("\n"),
    };
  }
  await input.emitEvent(normalized.eventDraft);
  return { emitted: true, eventType: normalized.eventDraft.type };
}

function withTimeout<T>(value: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    value.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function evaluateInput(
  session: RlmSession,
  code: string,
): Promise<{ value: unknown; outputText: string; outputTruncated: boolean }> {
  const scriptValue = await session.runtime.evaluate(code, {
    filename: "rlm-repl",
    bootstrapTimeoutMs: RLM_EVAL_TIMEOUT_MS,
  });
  const value =
    scriptValue && typeof (scriptValue as Promise<unknown>).then === "function"
      ? await withTimeout(scriptValue as Promise<unknown>, RLM_EVAL_TIMEOUT_MS)
      : scriptValue;
  const output = truncateText(formatValue(value), RLM_MAX_OUTPUT_CHARS);
  return { value, outputText: output.text, outputTruncated: output.truncated };
}

function createToolFunctions(
  agent: Agent,
  event: Event,
  channelId: string,
  executeCtx: ExecuteContext,
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>,
  emitEvent: (event: unknown) => Promise<void>,
  onToolCall: (record: ToolCallRecord) => void,
) {
  const llmTools = createRunnerTools({
    agent,
    event,
    channelId,
    runTool: (tool, args) => executeTool(executeCtx, tool, args),
    apiFetch,
    emitEvent,
  });
  const docs: ToolDoc[] = Object.entries(llmTools).map(([name, tool]) => ({
    name,
    description: tool.description,
    parameters: tool.parameters,
  }));
  const entries = Object.entries(llmTools).map(([toolName, tool]) => {
    const executeFn = tool.execute;
    const wrapper = async (args: Record<string, unknown> = {}) => {
      if (!executeFn) {
        const errorText = `Tool ${toolName} is missing execute function.`;
        onToolCall({
          tool: toolName,
          args,
          ok: false,
          error: errorText,
        });
        throw new Error(errorText);
      }
      try {
        const output = await executeFn(args);
        const maybeError =
          output &&
          typeof output === "object" &&
          "error" in (output as Record<string, unknown>)
            ? String((output as { error: unknown }).error)
            : null;
        onToolCall({
          tool: toolName,
          args,
          ok: !maybeError,
          ...(maybeError ? { error: maybeError } : { output }),
        });
        return output;
      } catch (error) {
        onToolCall({
          tool: toolName,
          args,
          ok: false,
          error: String(error),
        });
        throw error;
      }
    };
    return [toolName, wrapper] as const;
  });
  return { functions: Object.fromEntries(entries), docs };
}

function createBaseContext() {
  return {
    console,
    process,
    Buffer,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    setImmediate,
    clearImmediate,
    fetch,
    require: requireFromRunner,
  };
}

function buildSystemMessage(depth: number): string {
  const recursionHint =
    depth === 0
      ? "You are the root recursive JavaScript agent."
      : `You are a recursive subagent at depth ${depth}.`;
  return [
    recursionHint,
    "Execution runs in a persistent Node.js vm context (not node:repl).",
    "Read and use the global `prompt` variable before taking actions.",
    "Respond with exactly one JavaScript snippet each turn.",
    "Do not wrap your response in markdown fences.",
    "Module loading is available via `require(...)` and `await import(...)`.",
    "Use the available tool functions directly (e.g., events_emit({...})).",
    "The only completion signal is done(result). Never use any other completion marker.",
    "You may call spawnSubagent(promptText) for recursive delegation.",
    "Store important state in global variables if you need it across turns.",
  ].join("\n");
}

async function createSession(input: {
  agent: Agent;
  depth: number;
}): Promise<RlmSession> {
  const { agent, depth } = input;
  const runtime = createJsRuntimeSession();
  const context = runtime.context;
  Object.assign(context, createBaseContext());
  const session: RlmSession = {
    id: newSessionId(agent.name, depth),
    depth,
    runtime,
    context,
    reservedKeys: new Set(),
    done: false,
    doneValue: undefined,
  };
  session.reservedKeys = new Set(
    Object.keys(context as Record<string, unknown>),
  );
  return session;
}

async function bindSessionRuntime(
  input: Omit<
    RunReplLoopInput,
    "includeChannelMessages" | "baseMessages" | "maxSteps"
  > & {
    runState: RunState;
    promptText: string;
    depth: number;
  },
) {
  const {
    agent,
    event,
    channelId,
    executeCtx,
    apiFetch,
    emitEvent,
    session,
    runState,
    promptText,
    depth,
  } = input;
  const context = session.context;
  const toolRuntime = createToolFunctions(
    agent,
    event,
    channelId,
    executeCtx,
    apiFetch,
    emitEvent,
    (record) => {
      runState.toolCallsThisStep.push(record);
    },
  );
  const toolFns = toolRuntime.functions;
  const toolDocs = toolRuntime.docs;
  Object.assign(context, toolFns);
  Object.assign(context, {
    prompt: promptText,
    done: (result?: unknown) => {
      session.done = true;
      session.doneValue = result;
      return result;
    },
    clear: () => {
      const ctx = session.context as Record<string, unknown>;
      for (const key of Object.keys(ctx)) {
        if (session.reservedKeys.has(key)) continue;
        delete ctx[key];
      }
      return "Context cleared.";
    },
    listTools: () =>
      toolDocs.map((tool) => ({
        name: tool.name,
        description: tool.description ?? "",
      })),
    toolHelp: (name?: string) => {
      if (!name) {
        return toolDocs.map((tool) => ({
          name: tool.name,
          description: tool.description ?? "",
          parameters: formatValue(tool.parameters),
        }));
      }
      const tool = toolDocs.find((candidate) => candidate.name === name);
      if (!tool) {
        return {
          error: `Unknown tool: ${name}`,
          availableTools: toolDocs.map((candidate) => candidate.name),
        };
      }
      return {
        name: tool.name,
        description: tool.description ?? "",
        parameters: formatValue(tool.parameters),
      };
    },
    help: () =>
      "Use `prompt`, tool functions (events_*/fs_*/shell_*), listTools(), toolHelp(name?), done(result), and spawnSubagent(promptText).",
  });
  context.spawnSubagent = async (subPromptText: string) => {
    if (typeof subPromptText !== "string" || !subPromptText.trim()) {
      throw new Error("spawnSubagent(promptText) requires a non-empty string.");
    }
    if (depth >= RLM_MAX_SUBAGENT_DEPTH) {
      throw new Error(
        `Maximum subagent depth reached (${RLM_MAX_SUBAGENT_DEPTH}). Cannot spawn deeper.`,
      );
    }
    if (runState.spawnedSubagents >= RLM_MAX_SUBAGENTS_PER_EVENT) {
      throw new Error(
        `Maximum subagent count reached (${RLM_MAX_SUBAGENTS_PER_EVENT}) for this event.`,
      );
    }
    runState.spawnedSubagents += 1;
    const childSession = await createSession({ agent, depth: depth + 1 });
    if (shouldEmitAgentAuditEvents(agent)) {
      await emitEvent({
        type: "telemetry.rlm.subagent.started",
        source: `agent:${agent.name}`,
        channelId,
        payload: {
          parentSessionId: session.id,
          sessionId: childSession.id,
          depth: childSession.depth,
        },
      });
    }
    const childToolDocs = await bindSessionRuntime({
      agent,
      event,
      channelId,
      executeCtx,
      apiFetch,
      emitEvent,
      session: childSession,
      runState,
      promptText: subPromptText,
      depth: depth + 1,
    });
    const childResult = await runReplLoop({
      agent,
      event,
      channelId,
      executeCtx,
      apiFetch,
      emitEvent,
      session: childSession,
      runState,
      promptText: subPromptText,
      depth: depth + 1,
      maxSteps: RLM_MAX_STEPS,
      toolDocs: childToolDocs,
      includeChannelMessages: false,
      generateFn: input.generateFn,
      enableChannelInjection: false,
    });
    if (shouldEmitAgentAuditEvents(agent)) {
      await emitEvent({
        type: "telemetry.rlm.subagent.finished",
        source: `agent:${agent.name}`,
        channelId,
        payload: {
          parentSessionId: session.id,
          sessionId: childSession.id,
          depth: childSession.depth,
          done: childResult.done,
        },
      });
    }
    childSession.runtime.close();
    return childResult.doneValue;
  };
  for (const key of Object.keys(context)) {
    if (session.reservedKeys.has(key)) continue;
    if (
      key.startsWith("events_") ||
      key.startsWith("fs_") ||
      key.startsWith("shell_")
    ) {
      session.reservedKeys.add(key);
    }
  }
  session.reservedKeys.add("prompt");
  session.reservedKeys.add("done");
  session.reservedKeys.add("spawnSubagent");
  session.reservedKeys.add("help");
  session.reservedKeys.add("listTools");
  session.reservedKeys.add("toolHelp");
  session.reservedKeys.add("clear");
  return toolDocs;
}

async function runReplLoop(
  input: RunReplLoopInput,
): Promise<{ done: boolean; doneValue: unknown }> {
  const {
    agent,
    event,
    channelId,
    executeCtx,
    emitEvent,
    session,
    runState,
    promptText,
    depth,
    maxSteps,
    toolDocs,
    includeChannelMessages,
    baseMessages,
    generateFn,
    seenEventIds,
    enableChannelInjection,
  } = input;
  session.done = false;
  session.doneValue = undefined;
  (session.context as Record<string, unknown>).prompt = promptText;
  const promptPreview = truncateText(promptText, RLM_PROMPT_PREVIEW_MAX_CHARS);
  const localMessages: LlmMessage[] = [
    {
      role: "system",
      content: JSON.stringify(
        {
          type: "rlm.prompt.preview",
          depth,
          text: promptPreview.text,
          truncated: promptPreview.truncated,
          promptAvailableInRepl: true,
          promptReplPath: "globalThis.prompt",
        },
        null,
        2,
      ),
    },
  ];
  if (toolDocs && toolDocs.length > 0) {
    localMessages.push({
      role: "system",
      content: JSON.stringify(
        {
          type: "rlm.tools.available",
          depth,
          totalTools: toolDocs.length,
          tools: toolDocs.map((tool) => ({
            name: tool.name,
            description: tool.description ?? "",
          })),
          discoveryHint:
            "Tool functions are injected as globals. Use listTools() for names and toolHelp(name?) for argument details.",
        },
        null,
        2,
      ),
    });
  }
  for (let step = 1; step <= maxSteps; step += 1) {
    runState.toolCallsThisStep = [];
    const messages: LlmMessage[] = [];
    if (includeChannelMessages && baseMessages) {
      messages.push(...baseMessages);
    }
    messages.push({ role: "system", content: buildSystemMessage(depth) });
    messages.push(...localMessages);
    messages.push({
      role: "system",
      content: JSON.stringify(
        {
          type: "rlm.repl.next_input.requested",
          depth,
          step,
          triggerEventId: event.id,
          promptAvailableInRepl: true,
          promptReplPath: "globalThis.prompt",
          promptReminder:
            "Read global `prompt` and produce one JS snippet. Call done(result) when complete.",
        },
        null,
        2,
      ),
    });
    const callGenerate = generateFn ?? generate;
    const response = await callGenerate(agent.modelId, messages, {
      maxSteps: 1,
      env: executeCtx.injectionEnv,
    });
    const rawCode = response.text ?? "";
    const extractedCode = extractCode(rawCode);
    const inputText = truncateText(extractedCode, RLM_MAX_INPUT_CHARS);
    if (shouldEmitAgentAuditEvents(agent)) {
      await emitEvent({
        type: "telemetry.rlm.repl_input",
        source: `agent:${agent.name}`,
        channelId,
        payload: {
          sessionId: session.id,
          depth,
          step,
          text: inputText.text,
          truncated: inputText.truncated,
        },
      });
    }
    localMessages.push({
      role: "system",
      content: extractedCode,
    });
    let outputText = "";
    let outputTruncated = false;
    let executionError: string | null = null;
    try {
      const evaluated = await evaluateInput(session, extractedCode);
      outputText = evaluated.outputText;
      outputTruncated = evaluated.outputTruncated;
    } catch (error) {
      outputText = truncateText(String(error), RLM_MAX_OUTPUT_CHARS).text;
      executionError = String(error);
    }
    const toolCallsForStep = runState.toolCallsThisStep.map((record) => ({
      tool: record.tool,
      args: record.args,
      ok: record.ok,
      ...(record.ok
        ? {
            output: truncateText(
              formatValue(record.output),
              RLM_MAX_OUTPUT_CHARS,
            ).text,
          }
        : {
            error: record.error ?? "Unknown tool error",
          }),
    }));
    if (shouldEmitAgentAuditEvents(agent)) {
      await emitEvent({
        type: executionError
          ? "telemetry.rlm.repl_output.error"
          : "telemetry.rlm.repl_output",
        source: `agent:${agent.name}`,
        channelId,
        payload: {
          sessionId: session.id,
          depth,
          step,
          text: outputText,
          truncated: outputTruncated,
          toolCalls: toolCallsForStep,
          ...(executionError ? { error: executionError } : {}),
        },
      });
    }
    localMessages.push({
      role: "system",
      content: JSON.stringify(
        {
          type: executionError ? "rlm.repl.output.error" : "rlm.repl.output",
          depth,
          step,
          output: outputText,
          toolCalls: toolCallsForStep,
        },
        null,
        2,
      ),
    });
    if (session.done) {
      const doneEmission = await tryEmitDoneValueAsEvent({
        doneValue: session.doneValue,
        agent,
        channelId,
        executeCtx,
        emitEvent,
      });
      if (doneEmission.error) {
        if (shouldEmitAgentAuditEvents(agent)) {
          await emitEvent({
            type: "telemetry.rlm.done_validation_error",
            source: `agent:${agent.name}`,
            channelId,
            payload: {
              sessionId: session.id,
              depth,
              step,
              error: doneEmission.error,
            },
          });
        }
        localMessages.push({
          role: "system",
          content: JSON.stringify(
            {
              type: "rlm.done.validation_error",
              depth,
              step,
              error: doneEmission.error,
              guidance:
                "When using done(result) as an event, pass a valid event draft object. You can also call events_emit(...) directly and then done(\"ok\").",
            },
            null,
            2,
          ),
        });
        session.done = false;
        session.doneValue = undefined;
        continue;
      }
      if (shouldEmitAgentAuditEvents(agent)) {
        await emitEvent({
          type: "telemetry.rlm.done",
          source: `agent:${agent.name}`,
          channelId,
          payload: {
            sessionId: session.id,
            depth,
            step,
            ...(doneEmission.emitted
              ? {
                  emittedEventType: doneEmission.eventType,
                  doneValueEmittedAsEvent: true,
                }
              : {}),
            doneValue: truncateText(
              formatValue(session.doneValue),
              RLM_MAX_OUTPUT_CHARS,
            ).text,
          },
        });
      }
      return { done: true, doneValue: session.doneValue };
    }
    if (enableChannelInjection && seenEventIds) {
      const injected = await pullInjectedEventMessages({
        apiFetch: executeCtx.apiFetch,
        agent,
        channelId,
        seenEventIds,
        shouldInclude: shouldHandleEventForAgent,
      });
      if (injected) {
        localMessages.push(...injected.messages);
      }
    }
  }
  if (shouldEmitAgentAuditEvents(agent)) {
    await emitEvent({
      type: "telemetry.rlm.max_steps_reached",
      source: `agent:${agent.name}`,
      channelId,
      payload: {
        sessionId: session.id,
        depth,
        maxSteps,
      },
    });
  }
  return { done: false, doneValue: undefined };
}

export async function runRlmEvent(input: {
  agent: Agent;
  event: Event;
  channelId: string;
  systemPrompt: string;
  baseMessages: LlmMessage[];
  executeCtx: ExecuteContext;
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  emitEvent: (event: unknown) => Promise<void>;
  generateFn?: RlmGenerateFn;
}) {
  const {
    agent,
    event,
    channelId,
    systemPrompt,
    baseMessages,
    executeCtx,
    apiFetch,
    emitEvent,
    generateFn,
  } = input;
  const promptText = [
    systemPrompt,
    "Incoming event:",
    JSON.stringify(
      {
        id: event.id,
        type: event.type,
        source: event.source,
        channelId: event.channelId,
        parentEventId: event.parentEventId,
        payload: event.payload ?? {},
      },
      null,
      2,
    ),
  ].join("\n\n");
  let rootSession = rootSessions.get(agent.name);
  if (!rootSession) {
    rootSession = await createSession({ agent, depth: 0 });
    rootSessions.set(agent.name, rootSession);
  }
  const runState: RunState = { spawnedSubagents: 0, toolCallsThisStep: [] };
  const seenEventIds = new Set<string>([event.id]);
  const rootToolDocs = await bindSessionRuntime({
    agent,
    event,
    channelId,
    executeCtx,
    apiFetch,
    emitEvent,
    session: rootSession,
    runState,
    promptText,
    depth: 0,
    generateFn,
  });
  await runReplLoop({
    agent,
    event,
    channelId,
    executeCtx,
    apiFetch,
    emitEvent,
    session: rootSession,
    runState,
    promptText,
    depth: 0,
    maxSteps: RLM_MAX_STEPS,
    toolDocs: rootToolDocs,
    includeChannelMessages: true,
    baseMessages,
    generateFn,
    seenEventIds,
    enableChannelInjection: true,
  });
}

export function __resetRlmSessionsForTests() {
  for (const session of rootSessions.values()) {
    session.runtime.close();
  }
  rootSessions.clear();
}
