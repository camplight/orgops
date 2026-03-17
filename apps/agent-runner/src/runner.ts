import { existsSync, mkdirSync, readFileSync } from "node:fs";
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
const SKILL_ROOT = resolveSkillRoot(PROJECT_ROOT);

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

  const keptFromEnd: Array<{ role: "user" | "assistant"; content: string }> =
    [];
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
  const source =
    typeof event.source === "string" && event.source.trim()
      ? event.source.trim()
      : `agent:${agentName}`;
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
    .map((issue) => `- [${issue.source}] ${issue.message}`)
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
    payload: { text: text.trim() || "Unable to produce structured event output." },
    ...(parentEventId ? { parentEventId } : {}),
  };
}

export async function shouldHandleEvent(agent: Agent, event: Event) {
  if (event.type?.startsWith("agent.control.")) return false;
  // Skip bookkeeping events that should never trigger model replies.
  if (event.type?.startsWith("audit.")) return false;
  if (event.source === `agent:${agent.name}`) return false;
  if (!event.channelId) return false;
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
  const channelRecord = await getChannelRecord(channelId);
  const injectionEnv = await getPackageSecretsEnv(agent.name, channelId);
  const soul = typeof agent.soulContents === "string" ? agent.soulContents : "";
  const allSkills = listSkills(SKILL_ROOT);
  const enabledSkillSet = new Set(agent.enabledSkills ?? []);
  const alwaysPreloadedSkillSet = new Set(agent.alwaysPreloadedSkills ?? []);
  const selectedSkills = allSkills.filter((skill) =>
    enabledSkillSet.has(skill.name),
  );
  const alwaysPreloadedSkills = selectedSkills.filter((skill) =>
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
      (skill) =>
        `${skill.name} | ${skill.description} | ${join(skill.path, "SKILL.md")}`,
    )
    .join("\n");
  const preloadedSkillsContext = alwaysPreloadedSkills
    .map((skill) => {
      const contents = getSkillMarkdownContents(skill.path);
      if (!contents) return null;
      return `# ${skill.name}\n${contents}`;
    })
    .filter((entry): entry is string => Boolean(entry))
    .join("\n\n");
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const runnerGuidance = buildRunnerGuidance(
    nowMs,
    nowIso,
    SKILL_ROOT.path,
    coreEventTypes,
  );
  const system = [
    agent.systemInstructions,
    runnerGuidance,
    `Workspace:\n${agent.workspacePath}\n\n`,
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
  const eventHistory = await listChannelEvents(channelId);
  const baseMessages = buildModelMessages(agent, system, eventHistory);

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
    event,
    channelId,
    runTool: (tool, args) => executeTool(executeCtx, tool, args),
    apiFetch,
    emitEvent,
  });
  const retryMessages: Array<{ role: "user"; content: string }> = [];
  let lastResponseText = "";

  for (let attempt = 1; attempt <= MAX_EVENT_DISPATCH_ATTEMPTS; attempt += 1) {
    const result = await generate(
      agent.modelId,
      [...baseMessages, ...retryMessages],
      {
        tools,
        maxSteps: 8,
        env: injectionEnv,
      },
    );
    lastResponseText = result.text ?? "";

    let parsed: unknown;
    try {
      parsed = extractJsonObject(lastResponseText);
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
    if (validation.ok) {
      await emitEvent(eventDraft);
      return;
    }

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
  }

  await emitEvent(
    buildFallbackMessageEvent(agent.name, channelId, lastResponseText, event.id),
  );
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
