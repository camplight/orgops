import { fork, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Agent, Event } from "./types";
import type { ExecuteContext } from "./tools";
import type { LlmMessage } from "@orgops/llm";

type RunEventResultMessage = {
  type: "runEventResult";
  id: string;
  ok: boolean;
  error?: string;
};

type AgentChildState = {
  process: ChildProcess;
  pending: Map<
    string,
    {
      resolve: () => void;
      reject: (error: unknown) => void;
      timeout: NodeJS.Timeout;
    }
  >;
  nextId: number;
};

const childByAgent = new Map<string, AgentChildState>();
const CHILD_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

function childEntryPath() {
  return resolve(fileURLToPath(new URL(".", import.meta.url)), "rlm-child-run.ts");
}

function createChild(agent: Agent): AgentChildState {
  const child = fork(childEntryPath(), {
    cwd: agent.workspacePath,
    stdio: ["inherit", "inherit", "inherit", "ipc"],
    env: process.env,
  });
  const state: AgentChildState = {
    process: child,
    pending: new Map(),
    nextId: 1,
  };
  child.on("message", (message: unknown) => {
    const parsed = message as Partial<RunEventResultMessage>;
    if (!parsed || parsed.type !== "runEventResult" || typeof parsed.id !== "string") return;
    const pending = state.pending.get(parsed.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    state.pending.delete(parsed.id);
    if (parsed.ok) {
      pending.resolve();
      return;
    }
    pending.reject(new Error(parsed.error ?? "RLM child runEvent failed."));
  });
  child.on("exit", (code, signal) => {
    childByAgent.delete(agent.name);
    for (const pending of state.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(
        new Error(
          `RLM child exited before response (code=${String(code)}, signal=${String(signal)})`,
        ),
      );
    }
    state.pending.clear();
  });
  child.on("error", (error) => {
    for (const pending of state.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    state.pending.clear();
  });
  return state;
}

function ensureChild(agent: Agent): AgentChildState {
  const existing = childByAgent.get(agent.name);
  if (existing && existing.process.connected && !existing.process.killed) {
    return existing;
  }
  const created = createChild(agent);
  childByAgent.set(agent.name, created);
  return created;
}

export async function runRlmEventInChild(input: {
  agent: Agent;
  event: Event;
  channelId: string;
  systemPrompt: string;
  baseMessages: LlmMessage[];
  executeCtx: ExecuteContext;
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  emitEvent: (event: unknown) => Promise<void>;
}) {
  const { agent, event, channelId, systemPrompt, baseMessages, executeCtx } = input;
  const state = ensureChild(agent);
  const requestId = `${agent.name}:${state.nextId++}`;
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      state.pending.delete(requestId);
      rejectPromise(new Error(`RLM child request timed out (${CHILD_REQUEST_TIMEOUT_MS}ms)`));
    }, CHILD_REQUEST_TIMEOUT_MS);
    state.pending.set(requestId, {
      resolve: resolvePromise,
      reject: rejectPromise,
      timeout,
    });
    state.process.send({
      type: "runEvent",
      id: requestId,
      payload: {
        agent,
        event,
        channelId,
        systemPrompt,
        baseMessages,
        injectionEnv: executeCtx.injectionEnv,
        extraAllowedRoots: executeCtx.extraAllowedRoots ?? [],
        eventTypes: executeCtx.listEventTypes?.() ?? [],
        apiUrl: process.env.ORGOPS_API_URL ?? "http://localhost:8787",
        runnerToken: process.env.ORGOPS_RUNNER_TOKEN ?? "dev-runner-token",
      },
    });
  });
}

export function stopAllRlmChildren() {
  for (const [agentName, state] of childByAgent) {
    for (const pending of state.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`RLM child stopped for agent ${agentName}`));
    }
    state.pending.clear();
    state.process.kill("SIGTERM");
  }
  childByAgent.clear();
}

