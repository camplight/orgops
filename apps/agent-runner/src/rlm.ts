import { createRequire } from "node:module";
import * as vm from "node:vm";
import { inspect } from "node:util";
import { generate, type LlmMessage } from "@orgops/llm";
import { createRunnerTools, executeTool, type ExecuteContext } from "./tools";
import type { Agent, Event } from "./types";

const DEFAULT_MAX_STEPS = 24;
const DEFAULT_MAX_OUTPUT_CHARS = 16_000;
const DEFAULT_MAX_INPUT_CHARS = 16_000;
const DEFAULT_EVAL_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_SUBAGENT_DEPTH = 3;
const DEFAULT_MAX_SUBAGENTS_PER_EVENT = 12;

function readPositiveIntEnv(value: string | undefined, fallback: number): number {
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
  context: vm.Context;
  reservedKeys: Set<string>;
  done: boolean;
  doneValue: unknown;
};

type RunState = {
  spawnedSubagents: number;
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
  includeChannelMessages: boolean;
  baseMessages?: LlmMessage[];
  generateFn?: RlmGenerateFn;
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

function newSessionId(agentName: string, depth: number) {
  return `${agentName}:${depth}:${Date.now()}:${Math.floor(Math.random() * 1_000_000)}`;
}

function truncateText(value: string, maxChars: number): { text: string; truncated: boolean } {
  if (value.length <= maxChars) return { text: value, truncated: false };
  return {
    text: `${value.slice(0, maxChars)}\n...[truncated ${value.length - maxChars} chars]`,
    truncated: true,
  };
}

function extractCode(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const fenced = trimmed.match(/```(?:repl|js|javascript|ts|typescript)?\s*([\s\S]*?)\s*```/i);
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
  const scriptValue = vm.runInContext(code, session.context, {
    timeout: RLM_EVAL_TIMEOUT_MS,
    displayErrors: true,
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
) {
  const llmTools = createRunnerTools({
    agent,
    event,
    channelId,
    runTool: (tool, args) => executeTool(executeCtx, tool, args),
    apiFetch,
    emitEvent,
  });
  const entries = Object.entries(llmTools).map(([toolName, tool]) => {
    const executeFn = tool.execute;
    const wrapper = async (args: Record<string, unknown> = {}) => {
      if (!executeFn) {
        throw new Error(`Tool ${toolName} is missing execute function.`);
      }
      return executeFn(args);
    };
    return [toolName, wrapper] as const;
  });
  return Object.fromEntries(entries);
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
      ? "You are the root recursive REPL agent."
      : `You are a recursive subagent at depth ${depth}.`;
  return [
    recursionHint,
    "Read and use the global `prompt` variable before taking actions.",
    "Respond with exactly one JavaScript REPL input snippet each turn.",
    "Do not wrap your response in markdown fences.",
    "Use the available tool functions directly (e.g., events_emit({...})).",
    "The only completion signal is done(result). Never use any other completion marker.",
    "You may call spawnSubagent(promptText) for recursive delegation.",
    "Store important state in global variables if you need it across turns.",
  ].join("\n");
}

async function createSession(input: { agent: Agent; depth: number }): Promise<RlmSession> {
  const { agent, depth } = input;
  const context = vm.createContext(createBaseContext());
  const session: RlmSession = {
    id: newSessionId(agent.name, depth),
    depth,
    context,
    reservedKeys: new Set(),
    done: false,
    doneValue: undefined,
  };
  session.reservedKeys = new Set(Object.keys(context as Record<string, unknown>));
  return session;
}

async function bindSessionRuntime(
  input: Omit<RunReplLoopInput, "includeChannelMessages" | "baseMessages" | "maxSteps"> & {
    runState: RunState;
    promptText: string;
    depth: number;
  },
) {
  const { agent, event, channelId, executeCtx, apiFetch, emitEvent, session, runState, promptText, depth } =
    input;
  const context = session.context as Record<string, unknown>;
  const toolFns = createToolFunctions(agent, event, channelId, executeCtx, apiFetch, emitEvent);
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
    help: () =>
      "Use `prompt`, tool functions (events_*/fs_*/shell_run/proc_*), done(result), and spawnSubagent(promptText).",
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
    await emitEvent({
      type: "audit.rlm.subagent.started",
      source: `agent:${agent.name}`,
      channelId,
      payload: {
        parentSessionId: session.id,
        sessionId: childSession.id,
        depth: childSession.depth,
      },
    });
    await bindSessionRuntime({
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
      includeChannelMessages: false,
      generateFn: input.generateFn,
    });
    await emitEvent({
      type: "audit.rlm.subagent.finished",
      source: `agent:${agent.name}`,
      channelId,
      payload: {
        parentSessionId: session.id,
        sessionId: childSession.id,
        depth: childSession.depth,
        done: childResult.done,
      },
    });
    return childResult.doneValue;
  };
  for (const key of Object.keys(context)) {
    if (session.reservedKeys.has(key)) continue;
    if (key.startsWith("events_") || key.startsWith("fs_") || key.startsWith("proc_") || key === "shell_run") {
      session.reservedKeys.add(key);
    }
  }
  session.reservedKeys.add("prompt");
  session.reservedKeys.add("done");
  session.reservedKeys.add("spawnSubagent");
  session.reservedKeys.add("help");
  session.reservedKeys.add("clear");
}

async function runReplLoop(input: RunReplLoopInput): Promise<{ done: boolean; doneValue: unknown }> {
  const {
    agent,
    event,
    channelId,
    executeCtx,
    emitEvent,
    session,
    promptText,
    depth,
    maxSteps,
    includeChannelMessages,
    baseMessages,
    generateFn,
  } = input;
  session.done = false;
  session.doneValue = undefined;
  (session.context as Record<string, unknown>).prompt = promptText;
  const promptPreview = truncateText(promptText, RLM_PROMPT_PREVIEW_MAX_CHARS);
  const localMessages: LlmMessage[] = [
    {
      role: "user",
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
  for (let step = 1; step <= maxSteps; step += 1) {
    const messages: LlmMessage[] = [];
    if (includeChannelMessages && baseMessages) {
      messages.push(...baseMessages);
    }
    messages.push({ role: "system", content: buildSystemMessage(depth) });
    messages.push(...localMessages);
    messages.push({
      role: "user",
      content: JSON.stringify(
        {
          type: "rlm.repl.next_input.requested",
          depth,
          step,
          triggerEventId: event.id,
          promptAvailableInRepl: true,
          promptReplPath: "globalThis.prompt",
          promptReminder: "Read global `prompt` and produce one JS REPL input. Call done(result) when complete.",
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
    await emitEvent({
      type: "audit.rlm.repl_input",
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
    localMessages.push({
      role: "assistant",
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
    await emitEvent({
      type: executionError ? "audit.rlm.repl_output.error" : "audit.rlm.repl_output",
      source: `agent:${agent.name}`,
      channelId,
      payload: {
        sessionId: session.id,
        depth,
        step,
        text: outputText,
        truncated: outputTruncated,
        ...(executionError ? { error: executionError } : {}),
      },
    });
    localMessages.push({
      role: "user",
      content: JSON.stringify(
        {
          type: executionError ? "rlm.repl.output.error" : "rlm.repl.output",
          depth,
          step,
          output: outputText,
        },
        null,
        2,
      ),
    });
    if (session.done) {
      await emitEvent({
        type: "audit.rlm.done",
        source: `agent:${agent.name}`,
        channelId,
        payload: {
          sessionId: session.id,
          depth,
          step,
          doneValue: truncateText(formatValue(session.doneValue), RLM_MAX_OUTPUT_CHARS).text,
        },
      });
      return { done: true, doneValue: session.doneValue };
    }
  }
  await emitEvent({
    type: "audit.rlm.max_steps_reached",
    source: `agent:${agent.name}`,
    channelId,
    payload: {
      sessionId: session.id,
      depth,
      maxSteps,
    },
  });
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
  } =
    input;
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
    const runState: RunState = { spawnedSubagents: 0 };
    await bindSessionRuntime({
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
      includeChannelMessages: true,
      baseMessages,
      generateFn,
    });
}

export function __resetRlmSessionsForTests() {
  rootSessions.clear();
}

