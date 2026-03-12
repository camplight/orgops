import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { generate } from "@orgops/llm";
import { listSkills, resolveSkillRoots } from "@orgops/skills";
import { createRunnerTools, executeTool } from "./tools";
import { stopAllRunningProcesses } from "./tools/proc";
import type { Agent, Event } from "./types";
import { buildRunnerGuidance } from "./prompt";

const API_URL = process.env.ORGOPS_API_URL ?? "http://localhost:8787";
const PROJECT_ROOT = (() => {
  const envRoot = process.env.ORGOPS_PROJECT_ROOT;
  if (envRoot) return envRoot;
  const cwd = process.cwd();
  const candidate = resolve(cwd, "../..");
  return existsSync(join(candidate, "package.json")) ? candidate : cwd;
})();
const SKILL_ROOTS = resolveSkillRoots({
  projectRoot: PROJECT_ROOT,
  env: process.env,
});

const heartbeats = new Map<string, number>();
const bootstrappedAgents = new Set<string>();
const lifecycleChannels = new Map<string, string>();
const HEARTBEAT_INTERVAL_MS = 5000;
const DEFAULT_MAX_HISTORY_EVENTS = 120;
const DEFAULT_MAX_HISTORY_CHARS = 120_000;

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

async function apiFetch(path: string, init?: RequestInit) {
  const runnerToken = process.env.ORGOPS_RUNNER_TOKEN ?? "dev-runner-token";
  const headers = new Headers(init?.headers);
  if (runnerToken) headers.set("x-orgops-runner-token", runnerToken);
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${path} failed: ${res.status} ${text}`);
  }
  return res;
}

async function listAgents(): Promise<Agent[]> {
  const res = await apiFetch("/api/agents");
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

async function emitAudit(type: string, payload: unknown, source = "system") {
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
  participants?: ChannelParticipant[];
};

function lifecycleChannelName(agentName: string) {
  return `agent.lifecycle.${agentName}`;
}

async function listChannels(): Promise<ChannelRecord[]> {
  const res = await apiFetch("/api/channels");
  return res.json();
}

function isAgentSubscribed(
  channel: ChannelRecord,
  agentName: string,
): boolean {
  return (channel.participants ?? []).some(
    (participant) =>
      String(participant.subscriberType ?? "").toUpperCase() === "AGENT" &&
      participant.subscriberId === agentName,
  );
}

async function ensureLifecycleChannel(agentName: string): Promise<string> {
  const cached = lifecycleChannels.get(agentName);
  if (cached) return cached;

  const expectedName = lifecycleChannelName(agentName);
  const channels = await listChannels();
  const existing = channels.find(
    (channel) => channel.name === expectedName && isAgentSubscribed(channel, agentName),
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
    refreshedChannels.find(
      (channel) => channel.name === expectedName,
    ) ?? (createdChannelId ? { id: createdChannelId } : null);
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

async function listChannelEvents(channelId: string): Promise<Event[]> {
  const res = await apiFetch(
    `/api/events?channelId=${encodeURIComponent(channelId)}&limit=200`,
  );
  return res.json();
}

export function toHistoryMessage(agent: Agent, event: Event) {
  const role =
    event.source === `agent:${agent.name}`
      ? ("assistant" as const)
      : ("user" as const);
  const baseRecord = {
    eventId: event.id,
    channelId: event.channelId,
    parentEventId: event.parentEventId,
    type: event.type,
    source: event.source,
    payload: event.payload ?? {},
  };
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

export function buildModelMessages(
  agent: Agent,
  system: string,
  channelEvents: Event[],
) {
  const boundedByEventCount =
    channelEvents.length > HISTORY_MAX_EVENTS
      ? channelEvents.slice(-HISTORY_MAX_EVENTS)
      : channelEvents;
  const historyMessages = boundedByEventCount.map((channelEvent) =>
    toHistoryMessage(agent, channelEvent),
  );

  const keptFromEnd: Array<{ role: "user" | "assistant"; content: string }> = [];
  let totalHistoryChars = 0;
  for (let index = historyMessages.length - 1; index >= 0; index -= 1) {
    const message = historyMessages[index];
    const messageChars = message.content.length;
    if (
      keptFromEnd.length > 0 &&
      totalHistoryChars + messageChars > HISTORY_MAX_CHARS
    ) {
      break;
    }
    keptFromEnd.push(message);
    totalHistoryChars += messageChars;
  }
  keptFromEnd.reverse();
  const omittedCount = channelEvents.length - keptFromEnd.length;
  return [
    { role: "system" as const, content: system },
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

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasAgentMention(text: string, agentName: string) {
  if (!text) return false;
  const pattern = new RegExp(
    `(^|\\s)@${escapeRegex(agentName)}(?=\\b|\\s|$)`,
    "i",
  );
  return pattern.test(text);
}

type ResponseDirective = {
  mode: "reply" | "no_reply";
  text: string;
};

export function parseResponseDirective(rawText: string): ResponseDirective {
  const text = rawText.trim();
  if (!text) return { mode: "reply", text: "" };
  const noReplyMatch = text.match(/^\[NO_REPLY\]\s*([\s\S]*)$/i);
  if (noReplyMatch) {
    return { mode: "no_reply", text: (noReplyMatch[1] ?? "").trim() };
  }
  const replyMatch = text.match(/^\[REPLY\]\s*([\s\S]*)$/i);
  if (replyMatch) {
    return { mode: "reply", text: (replyMatch[1] ?? "").trim() };
  }
  return { mode: "reply", text };
}

export async function shouldHandleEvent(agent: Agent, event: Event) {
  if (event.type?.startsWith("agent.control.")) return false;
  // Skip bookkeeping events that should never trigger model replies.
  if (event.type?.startsWith("audit.")) return false;
  if (event.type?.startsWith("channel.command.")) return false;
  if (event.type === "task.created") return false;
  if (event.source === `agent:${agent.name}`) return false;
  const targetAgentName =
    typeof event.payload?.targetAgentName === "string"
      ? event.payload.targetAgentName.trim()
      : "";
  if (targetAgentName && targetAgentName !== agent.name) return false;
  const hopCount = Number(event.payload?.hopCount ?? 0);
  if (Number.isFinite(hopCount) && hopCount >= 3) return false;
  if (!event.channelId) return false;

  const text = String(event.payload?.text ?? "");
  if (hasAgentMention(text, agent.name)) return true;

  if (typeof event.source === "string" && event.source.startsWith("agent:")) {
    return false;
  }
  return true;
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

async function handleEvent(agent: Agent, event: Event) {
  const channelId = event.channelId;
  if (!channelId) return;
  const injectionEnv = await getPackageSecretsEnv(agent.name, channelId);
  const soul = typeof agent.soulContents === "string" ? agent.soulContents : "";
  const allSkills = listSkills(SKILL_ROOTS);
  const enabledSkillSet = new Set(agent.enabledSkills ?? []);
  const selectedSkills = allSkills.filter((skill) =>
    enabledSkillSet.has(skill.name),
  );
  const skillIndex = selectedSkills
    .map(
      (skill) =>
        `${skill.name} | ${skill.description} | ${skill.location} | ${join(skill.path, "SKILL.md")}`,
    )
    .join("\n");
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const runnerGuidance = buildRunnerGuidance(nowMs, nowIso);
  const system = [
    agent.systemInstructions,
    `Workspace:\n${agent.workspacePath}\n\n`,
    `Allow outside workspace:\n${agent.allowOutsideWorkspace ? "enabled" : "disabled"}\n\n`,
    soul ? `Soul:\n${soul}` : "",
    runnerGuidance,
    "Use skills:\n" + skillIndex,
  ]
    .filter(Boolean)
    .join("\n\n");
  const eventHistory = await listChannelEvents(channelId);
  const messages = buildModelMessages(agent, system, eventHistory);

  const executeCtx = {
    agent,
    triggerEvent: event,
    channelId,
    extraAllowedRoots: selectedSkills.map((skill) => skill.path),
    injectionEnv,
    apiFetch,
    emitEvent,
    emitAudit: (
      type: string,
      payload: unknown,
      source = `agent:${agent.name}`,
    ) => emitAudit(type, payload, source),
  };
  const tools = createRunnerTools({
    agent,
    event,
    channelId,
    runTool: (tool, args) => executeTool(executeCtx, tool, args),
    apiFetch,
    emitEvent,
  });
  const result = await generate(agent.modelId, messages, {
    tools,
    maxSteps: 8,
    env: injectionEnv,
  });

  const toolResultCount = result.toolResults?.length ?? 0;
  if (toolResultCount > 0) {
    await emitEvent({
      type: "task.created",
      payload: {
        eventType: event.type,
        toolResultCount,
      },
      source: `agent:${agent.name}`,
      channelId,
    });
  }

  const directive = parseResponseDirective(result.text ?? "");
  if (!directive.text && directive.mode === "reply") {
    return;
  }
  if (directive.mode === "no_reply") {
    await emitEvent({
      type: "audit.response.skipped",
      payload: {
        eventType: event.type,
        reason: "agent_requested_no_reply",
        note: directive.text || undefined
      },
      source: `agent:${agent.name}`,
      channelId
    });
    return;
  }

  await emitEvent({
    type: "message.created",
    payload: {
      text: directive.text,
      eventType: event.type,
      hopCount: Number(event.payload?.hopCount ?? 0) + 1,
    },
    source: `agent:${agent.name}`,
    channelId,
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
  if (agent.desiredState !== "RUNNING") {
    heartbeats.delete(agent.name);
    bootstrappedAgents.delete(agent.name);
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
  const query = `agentName=${encodeURIComponent(agent.name)}&status=PENDING&limit=50`;
  const res = await apiFetch(`/api/events?${query}`);
  const events = (await res.json()) as Event[];
  for (const event of events) {
    if (!(await shouldHandleEvent(agent, event))) {
      continue;
    }
    try {
      await handleEvent(agent, event);
    } catch (error) {
      await apiFetch(`/api/events/${event.id}/fail`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: String(error) }),
      });
    }
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
  while (!shuttingDown) {
    try {
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
  const processShutdownSummary = await stopAllRunningProcesses();
  if (processShutdownSummary.processCount > 0) {
    console.log(
      `runner shutdown (${shutdownSignal ?? "STOP"}): stopped ${processShutdownSummary.terminated} process(es), killed ${processShutdownSummary.killed}`,
    );
  }
}
