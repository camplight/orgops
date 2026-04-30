import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveSkillRoot } from "@orgops/skills";
import { stopAllRunningProcesses } from "./tools/shell";
import { createChannelLoopManager } from "./channel-loop";
import { shouldHandleEventForAgent } from "./event-routing";
import { createMaintenanceLoop } from "./maintenance-loop";
import { stopAllRlmChildren } from "./rlm-process";
import { createRunnerState } from "./runner/state";
import { createRunnerApi } from "./runner/api";
import {
  agentChannelKey,
  shouldSuppressProcessLifecycleTrigger,
} from "./turn-trigger-filter";
import {
  createTurnExecutor,
  reconcileLateInjectedMessages,
  resolveAgentClassicMaxModelSteps,
  resolveAgentLlmCallTimeoutMs,
  resolveAgentMemoryContextMode,
} from "./turn-executor";
import { buildModelMessages, selectRecentDeltaEventsForPrompt } from "./prompt-composer";
import type { Agent, Event } from "./types";

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
const HEARTBEAT_INTERVAL_MS = 5000;
const DEFAULT_CHANNEL_RECENT_MEMORY_INTERVAL_MS = 10_000;
const DEFAULT_CHANNEL_FULL_MEMORY_INTERVAL_MS = 60_000;
const DEFAULT_CROSS_RECENT_MEMORY_INTERVAL_MS = 15_000;
const DEFAULT_CROSS_FULL_MEMORY_INTERVAL_MS = 120_000;
const DEFAULT_LLM_CALL_TIMEOUT_MS = 10_800_000;

function readPositiveIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

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

const state = createRunnerState();
const api = createRunnerApi({
  apiUrl: API_URL,
  runnerToken: process.env.ORGOPS_RUNNER_TOKEN ?? "dev-runner-token",
  heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
  runnerIdFile: RUNNER_ID_FILE,
  runnerState: state,
});
const handleTurn = createTurnExecutor({
  projectRoot: PROJECT_ROOT,
  skillRoot: SKILL_ROOT,
  llmCallTimeoutMs: LLM_CALL_TIMEOUT_MS,
  api: {
    apiFetch: api.apiFetch,
    emitEvent: api.emitEvent,
    listChannels: api.listChannels,
    getChannelRecord: api.getChannelRecord,
    getChannelParticipationValidationError: api.getChannelParticipationValidationError,
    getPackageSecretsEnv: api.getPackageSecretsEnv,
  },
});
const maintenanceLoop = createMaintenanceLoop({
  listChannels: api.listChannels,
  getPackageSecretsEnv: api.getPackageSecretsEnv,
  apiFetch: api.apiFetch,
  channelRecentMemoryIntervalMs: CHANNEL_RECENT_MEMORY_INTERVAL_MS,
  channelFullMemoryIntervalMs: CHANNEL_FULL_MEMORY_INTERVAL_MS,
  crossRecentMemoryIntervalMs: CROSS_RECENT_MEMORY_INTERVAL_MS,
  crossFullMemoryIntervalMs: CROSS_FULL_MEMORY_INTERVAL_MS,
});

const channelLoopManager = createChannelLoopManager({
  processBatch: async (agent, channelId, channelEvents) => {
    const key = agentChannelKey(agent.name, channelId);
    const startedAt = Date.now();
    state.recentTurnWindows.set(key, {
      startedAt,
      completedAt: startedAt,
    });
    try {
      await handleTurn(agent, channelEvents);
    } finally {
      const existing = state.recentTurnWindows.get(key);
      if (!existing) return;
      existing.completedAt = Date.now();
      state.recentTurnWindows.set(key, existing);
    }
  },
  onBatchError: async (agent, _channelId, channelEvents, error) => {
    const triggerEvent = channelEvents[channelEvents.length - 1];
    const channelId = triggerEvent?.channelId;
    if (triggerEvent && channelId) {
      await api.emitEvent({
        type: "agent.turn.failed",
        source: `agent:${agent.name}`,
        channelId,
        payload: {
          triggerEventId: triggerEvent.id,
          eventCount: channelEvents.length,
          error: String(error),
        },
      });
    }
    for (const event of channelEvents) {
      await api.apiFetch(`/api/events/${event.id}/fail`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: String(error) }),
      });
    }
  },
});

async function ensureWorkspace(agent: Agent) {
  const workspacePath = agent.workspacePath.startsWith("/")
    ? agent.workspacePath
    : resolve(PROJECT_ROOT, agent.workspacePath);
  mkdirSync(workspacePath, { recursive: true });
  agent.workspacePath = workspacePath;
}

async function pollAgent(agent: Agent) {
  if (
    state.registeredRunnerId &&
    agent.assignedRunnerId &&
    agent.assignedRunnerId !== state.registeredRunnerId
  ) {
    return;
  }
  if (agent.desiredState !== "RUNNING") {
    state.heartbeats.delete(agent.name);
    state.bootstrappedAgents.delete(agent.name);
    maintenanceLoop.clearAgent(agent.name);
    if (agent.runtimeState !== "STOPPED") {
      await api.patchAgentState(agent.name, { runtimeState: "STOPPED" });
    }
    return;
  }
  await ensureWorkspace(agent);
  const now = Date.now();
  const previousHeartbeatAt = state.heartbeats.get(agent.name) ?? 0;
  const needsHeartbeat = now - previousHeartbeatAt >= HEARTBEAT_INTERVAL_MS;
  if (agent.runtimeState !== "RUNNING" || needsHeartbeat) {
    await api.patchAgentState(agent.name, {
      runtimeState: "RUNNING",
      lastHeartbeatAt: now,
    });
    state.heartbeats.set(agent.name, now);
  }
  if (!state.bootstrappedAgents.has(agent.name)) {
    try {
      await api.emitStartupEvent(agent);
      state.bootstrappedAgents.add(agent.name);
    } catch (error) {
      console.error(`failed to emit startup event for ${agent.name}`, error);
    }
  }
  if (resolveAgentMemoryContextMode(agent) === "PER_CHANNEL_CROSS_CHANNEL") {
    maintenanceLoop.schedule(agent);
  }
  const channels = await api.listChannels();
  const subscribedChannelIds = channels
    .filter((channel) =>
      (channel.participants ?? []).some(
        (participant) =>
          String(participant.subscriberType ?? "").toUpperCase() === "AGENT" &&
          participant.subscriberId === agent.name,
      ),
    )
    .map((channel) => channel.id)
    .filter((channelId): channelId is string => Boolean(channelId));
  const pendingBuckets = await Promise.all(
    subscribedChannelIds.map(async (channelId) => {
      if (channelLoopManager.isChannelBusy(agent.name, channelId)) {
        return [] as Event[];
      }
      return api.listPendingEventsForAgentChannel(agent.name, channelId);
    }),
  );
  const events = pendingBuckets.flat();
  const pendingByChannel = new Map<string, Event[]>();
  for (const event of events) {
    const channelId = event.channelId;
    if (!channelId) continue;
    const recentWindow = state.recentTurnWindows.get(
      agentChannelKey(agent.name, channelId),
    );
    if (
      shouldSuppressProcessLifecycleTrigger({
        agentName: agent.name,
        event,
        recentWindow,
      })
    ) {
      continue;
    }
    if (!shouldHandleEventForAgent(agent, event)) continue;
    const bucket = pendingByChannel.get(channelId) ?? [];
    bucket.push(event);
    pendingByChannel.set(channelId, bucket);
  }
  for (const channelEvents of pendingByChannel.values()) {
    channelEvents.sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0));
    channelLoopManager.enqueue(agent, channelEvents);
  }
}

function summarizeError(error: unknown) {
  const err = error as Error | undefined;
  return {
    name: err?.name,
    message: err?.message ?? String(error),
  };
}

export async function shouldHandleEvent(agent: Agent, event: Event) {
  return shouldHandleEventForAgent(agent, event);
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

  while (!shuttingDown && !state.registeredRunnerId) {
    try {
      const runnerId = await api.registerRunnerIdentity();
      await api.sendRunnerHeartbeat(true);
      console.log(`runner registered as ${runnerId}`);
    } catch (error) {
      console.error("runner.registration_failed", summarizeError(error));
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  while (!shuttingDown) {
    try {
      await api.sendRunnerHeartbeat();
      const agents = await api.listAgents();
      const results = await Promise.allSettled(agents.map(async (agent) => pollAgent(agent)));
      for (const result of results) {
        if (result.status === "rejected") {
          console.error("runner.poll_agent_failed", summarizeError(result.reason));
        }
      }
    } catch (error) {
      console.error("runner.loop_iteration_failed", summarizeError(error));
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

export {
  buildModelMessages,
  reconcileLateInjectedMessages,
  resolveAgentClassicMaxModelSteps,
  resolveAgentLlmCallTimeoutMs,
  resolveAgentMemoryContextMode,
  selectRecentDeltaEventsForPrompt,
};
