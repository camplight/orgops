import { existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { PortableWrappedRecipeSchema, StartRequirementsResultSchema, type RequirementReason, type StartRequirementsResult } from "@orgops/schemas";
import { resolveSkillRoot } from "@orgops/skills";
import { stopAllRunningProcesses } from "./tools/shell";
import { createChannelLoopManager } from "./channel-loop";
import { shouldHandleEventForAgent } from "./event-routing";
import { createMaintenanceLoop } from "./maintenance-loop";
import { stopAllRlmChildren } from "./rlm-process";
import { createRunnerState } from "./runner/state";
import { createRunnerApi } from "./runner/api";
import { listWrapperHarnesses } from "./wrapper-harness/registry";
import {
  clearAgentIntentWatch,
  collectDueIntentTimeouts,
  ingestIntentEvents,
} from "./intent-watchdog";
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
import {
  ensureWrappedAgentReady,
  stopAllWrappedRuntimes,
  stopWrappedAgentRuntime,
} from "./wrapped-runtime";
import { buildModelMessages, selectRecentDeltaEventsForPrompt } from "./prompt-composer";
import { createAgentRuntimeGeneration } from "./runtime-generation";
import { createPackageDeploymentProcessor } from "./package-delivery";
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
const RUNNER_PACKAGE_ROOT = process.env.ORGOPS_RUNNER_PACKAGE_ROOT
  ? resolve(PROJECT_ROOT, process.env.ORGOPS_RUNNER_PACKAGE_ROOT)
  : resolve(PROJECT_ROOT, ".orgops-data", "runner-packages");
const HEARTBEAT_INTERVAL_MS = 5000;
const DEFAULT_CHANNEL_RECENT_MEMORY_INTERVAL_MS = 10_000;
const DEFAULT_CHANNEL_FULL_MEMORY_INTERVAL_MS = 60_000;
const DEFAULT_CROSS_RECENT_MEMORY_INTERVAL_MS = 15_000;
const DEFAULT_CROSS_FULL_MEMORY_INTERVAL_MS = 120_000;
const DEFAULT_LLM_CALL_TIMEOUT_MS = 10_800_000;
const DEFAULT_AGENT_INTENT_TIMEOUT_MS = 45_000;
const DEFAULT_AGENT_INTENT_MAX_TIMEOUTS = 3;

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
const AGENT_INTENT_TIMEOUT_MS = readPositiveIntEnv(
  process.env.ORGOPS_AGENT_INTENT_TIMEOUT_MS,
  DEFAULT_AGENT_INTENT_TIMEOUT_MS,
);
const AGENT_INTENT_MAX_TIMEOUTS = readPositiveIntEnv(
  process.env.ORGOPS_AGENT_INTENT_MAX_TIMEOUTS,
  DEFAULT_AGENT_INTENT_MAX_TIMEOUTS,
);

const state = createRunnerState();
const runtimeGeneration = createAgentRuntimeGeneration({ packageRoot: RUNNER_PACKAGE_ROOT, fallbackRoot: SKILL_ROOT.path });
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
  runtimeAuth: {
    apiBaseUrl: API_URL,
    runnerToken: process.env.ORGOPS_RUNNER_TOKEN ?? "dev-runner-token",
  },
  api: {
    apiFetch: api.apiFetch,
    emitEvent: api.emitEvent,
    listChannels: api.listChannels,
    getChannelRecord: api.getChannelRecord,
    getChannelParticipationValidationError: api.getChannelParticipationValidationError,
    getPackageSecretsEnv: api.getPackageSecretsEnv,
    ensureLifecycleChannel: api.ensureLifecycleChannel,
  },
});
const packageDeploymentProcessor = createPackageDeploymentProcessor({
  api,
  runtime: runtimeGeneration,
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
  captureForTurn: runtimeGeneration.captureForTurn,
  processBatch: async (agent, channelId, channelEvents, generation) => {
    const key = agentChannelKey(agent.name, channelId);
    const startedAt = Date.now();
    state.recentTurnWindows.set(key, {
      startedAt,
      completedAt: startedAt,
    });
    try {
      await handleTurn(agent, channelEvents, generation);
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

function inside(root: string, target: string) {
  const path = relative(root, target);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !path.startsWith(sep));
}

export function validateCatalogAgentLocally(agent: Agent, projectRoot: string): StartRequirementsResult {
  if (!agent.catalogDerived) return { ok: true };
  const reasons: RequirementReason[] = [];
  const add = (reason: RequirementReason) => { if (!reasons.some(existing => existing.code === reason.code)) reasons.push(reason); };
  if (!agent.modelId?.trim()) {
    add({ code: "MODEL_BINDING_MISSING" });
  }
  if ((agent.mode ?? "CLASSIC") === "WRAPPED") {
    const parsed = PortableWrappedRecipeSchema.safeParse(agent.wrappedConfig);
    if (!parsed.success || !listWrapperHarnesses().includes(parsed.data.harness)) add({ code: "WRAPPED_WIRING_MISSING" });
  }
  try {
    const canonicalRoot = realpathSync(projectRoot);
    const candidate = agent.workspacePath.startsWith("/") ? resolve(agent.workspacePath) : resolve(projectRoot, agent.workspacePath);
    if (candidate === resolve(projectRoot) || !inside(resolve(projectRoot), candidate)) throw new Error("escape");
    let ancestor = candidate;
    while (!existsSync(ancestor)) {
      const parent = dirname(ancestor);
      if (parent === ancestor) throw new Error("missing ancestor");
      ancestor = parent;
    }
    if (lstatSync(ancestor).isSymbolicLink() || !inside(canonicalRoot, realpathSync(ancestor))) throw new Error("unsafe ancestor");
    if (existsSync(candidate) && (lstatSync(candidate).isSymbolicLink() || !inside(canonicalRoot, realpathSync(candidate)))) throw new Error("unsafe workspace");
  } catch {
    add({ code: "WORKSPACE_BINDING_MISSING" });
  }
  reasons.sort((left, right) => left.code.localeCompare(right.code));
  return reasons.length ? { ok: false, code: "REQUIREMENTS_UNSATISFIED", reasons } : { ok: true };
}

async function ensureWorkspace(agent: Agent) {
  const workspacePath = agent.workspacePath.startsWith("/")
    ? agent.workspacePath
    : resolve(PROJECT_ROOT, agent.workspacePath);
  mkdirSync(workspacePath, { recursive: true });
  agent.workspacePath = workspacePath;
}

type AgentBootstrapDeps = {
  projectRoot: string;
  registeredRunnerId?: string;
  bootstrappedAgents: Set<string>;
  bootstrappedAgentKeys: Map<string, string>;
  heartbeats: Map<string, number>;
  getStartRequirements: (agentName: string) => Promise<unknown>;
  validateLocal: (agent: Agent, projectRoot: string) => unknown;
  ensureWorkspace: (agent: Agent) => Promise<void>;
  patchRunning: (agent: Agent, now: number) => Promise<void>;
  bootstrap: (agent: Agent) => Promise<void>;
  scheduleMaintenance: (agent: Agent) => void;
  now: () => number;
  heartbeatIntervalMs: number;
  warn: (...values: unknown[]) => void;
  bootstrapFailed?: (agentName: string) => void;
};

/** The production bootstrap boundary: prerequisite denial returns before every host/runtime side effect. */
export async function reconcileAgentBootstrap(agent: Agent, deps: AgentBootstrapDeps): Promise<boolean> {
  if (deps.registeredRunnerId && agent.assignedRunnerId && agent.assignedRunnerId !== deps.registeredRunnerId) return false;
  const bootstrapKey = (agent.mode ?? "CLASSIC") === "WRAPPED" ? JSON.stringify(agent.wrappedConfig ?? {}) : "classic";
  const needsStartGate = !deps.bootstrappedAgents.has(agent.name)
    || deps.bootstrappedAgentKeys.get(agent.name) !== bootstrapKey || agent.runtimeState !== "RUNNING";
  if (needsStartGate) {
    let apiResult: ReturnType<typeof StartRequirementsResultSchema.parse>;
    let localResult: ReturnType<typeof StartRequirementsResultSchema.parse>;
    try {
      apiResult = StartRequirementsResultSchema.parse(await deps.getStartRequirements(agent.name));
      localResult = StartRequirementsResultSchema.parse(deps.validateLocal(agent, deps.projectRoot));
    } catch {
      deps.warn("runner.agent.start_requirements_unavailable", { agentName: agent.name });
      return false;
    }
    const reasons = [...(apiResult.ok ? [] : apiResult.reasons), ...(localResult.ok ? [] : localResult.reasons)]
      .filter((reason, index, all) => all.findIndex(candidate => JSON.stringify(candidate) === JSON.stringify(reason)) === index)
      .sort((left, right) => `${left.code}\0${left.packageReleaseId ?? ""}\0${left.requirementName ?? ""}`
        .localeCompare(`${right.code}\0${right.packageReleaseId ?? ""}\0${right.requirementName ?? ""}`));
    if (reasons.length) {
      deps.warn("runner.agent.start_requirements_unsatisfied", { agentName: agent.name, reasonCodes: reasons.map(reason => reason.code) });
      return false;
    }
  }
  await deps.ensureWorkspace(agent);
  const timestamp = deps.now();
  const previousHeartbeatAt = deps.heartbeats.get(agent.name) ?? 0;
  if (agent.runtimeState !== "RUNNING" || timestamp - previousHeartbeatAt >= deps.heartbeatIntervalMs) {
    await deps.patchRunning(agent, timestamp);
    deps.heartbeats.set(agent.name, timestamp);
  }
  if (!deps.bootstrappedAgents.has(agent.name) || deps.bootstrappedAgentKeys.get(agent.name) !== bootstrapKey) {
    try {
      await deps.bootstrap(agent);
      deps.bootstrappedAgents.add(agent.name);
      deps.bootstrappedAgentKeys.set(agent.name, bootstrapKey);
    } catch { deps.bootstrapFailed?.(agent.name); }
  }
  if ((agent.mode ?? "CLASSIC") !== "WRAPPED" && resolveAgentMemoryContextMode(agent) === "PER_CHANNEL_CROSS_CHANNEL") {
    deps.scheduleMaintenance(agent);
  }
  return true;
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
    state.bootstrappedAgentKeys.delete(agent.name);
    clearAgentIntentWatch(state.intentWatch, agent.name);
    maintenanceLoop.clearAgent(agent.name);
    if ((agent.mode ?? "CLASSIC") === "WRAPPED") {
      await stopWrappedAgentRuntime(agent.name);
    }
    if (agent.runtimeState !== "STOPPED") {
      await api.patchAgentState(agent.name, { runtimeState: "STOPPED" });
    }
    return;
  }
  const ready = await reconcileAgentBootstrap(agent, {
    projectRoot: PROJECT_ROOT,
    registeredRunnerId: state.registeredRunnerId ?? undefined,
    bootstrappedAgents: state.bootstrappedAgents,
    bootstrappedAgentKeys: state.bootstrappedAgentKeys,
    heartbeats: state.heartbeats,
    getStartRequirements: api.getAgentStartRequirements,
    validateLocal: validateCatalogAgentLocally,
    ensureWorkspace,
    patchRunning: async (current, timestamp) => api.patchAgentState(current.name, {
      runtimeState: "RUNNING", lastHeartbeatAt: timestamp,
    }),
    bootstrap: async current => {
      if ((current.mode ?? "CLASSIC") === "WRAPPED") {
        await stopWrappedAgentRuntime(current.name);
        await ensureWrappedAgentReady({ projectRoot: PROJECT_ROOT, api: {
          apiFetch: api.apiFetch, emitEvent: api.emitEvent, ensureLifecycleChannel: api.ensureLifecycleChannel,
          getPackageSecretsEnv: api.getPackageSecretsEnv,
        } }, current);
      } else await api.emitStartupEvent(current);
    },
    scheduleMaintenance: maintenanceLoop.schedule,
    now: Date.now,
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    warn: console.warn,
    bootstrapFailed: agentName => console.error("runner.agent.bootstrap_failed", { agentName }),
  });
  if (!ready) return;
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
  ingestIntentEvents({
    intents: state.intentWatch,
    agentName: agent.name,
    events,
    defaultTimeoutMs: AGENT_INTENT_TIMEOUT_MS,
  });
  const dueIntentTimeouts = collectDueIntentTimeouts({
    intents: state.intentWatch,
    agentName: agent.name,
    channelIds: subscribedChannelIds,
    nowMs: Date.now(),
    maxTimeoutsPerIntent: AGENT_INTENT_MAX_TIMEOUTS,
  });
  for (const due of dueIntentTimeouts) {
    await api.emitEvent({
      type: "agent.intent.timeout",
      source: "system:runner:intent-watchdog",
      channelId: due.channelId,
      payload: {
        targetAgentName: agent.name,
        intentId: due.intentId,
        intentMessageEventId: due.messageEventId,
        label: due.label,
        timeoutMs: due.timeoutMs,
        timeoutCount: due.timeoutCount,
        text: `Intent "${due.label}" has not been acted on yet. Continue by taking a concrete next action now.`,
      },
    });
  }
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

async function reconcileRemovedAgents(activeAgents: Agent[]) {
  const activeNames = new Set(activeAgents.map((agent) => agent.name));
  for (const agentName of [...state.bootstrappedAgents]) {
    if (activeNames.has(agentName)) continue;
    state.heartbeats.delete(agentName);
    state.bootstrappedAgents.delete(agentName);
    state.bootstrappedAgentKeys.delete(agentName);
    clearAgentIntentWatch(state.intentWatch, agentName);
    maintenanceLoop.clearAgent(agentName);
    await stopWrappedAgentRuntime(agentName);
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

export async function heartbeatDeliverThenList(deps: {
  sendRunnerHeartbeat(): Promise<void>;
  processPackageDeployments(): Promise<void>;
  listAgents(): Promise<Agent[]>;
}): Promise<Agent[]> {
  await deps.sendRunnerHeartbeat();
  await deps.processPackageDeployments();
  return deps.listAgents();
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
      const agents = await heartbeatDeliverThenList({
        sendRunnerHeartbeat: api.sendRunnerHeartbeat,
        processPackageDeployments: packageDeploymentProcessor.processPackageDeployments,
        listAgents: api.listAgents,
      });
      await reconcileRemovedAgents(agents);
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
  const wrappedShutdownSummary = await stopAllWrappedRuntimes();
  if (wrappedShutdownSummary.stopped > 0) {
    console.log(
      `runner shutdown (${shutdownSignal ?? "STOP"}): stopped ${wrappedShutdownSummary.stopped} wrapped sidecar(s)`,
    );
  }
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
