import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { generate } from "@orgops/llm";
import { listSkills, resolveSkillRoots } from "@orgops/skills";
import { createRunnerTools, executeTool } from "./tools";
import type { Agent, Event } from "./types";

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

const cursors = new Map<string, number>();
const heartbeats = new Map<string, number>();
const HEARTBEAT_INTERVAL_MS = 5000;

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
  await emitEvent({ type, payload, source });
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
  return {
    role,
    content: JSON.stringify(
      {
        eventId: event.id,
        channelId: event.channelId,
        parentEventId: event.parentEventId,
        type: event.type,
        source: event.source,
        payload: event.payload ?? {},
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
  return [
    { role: "system" as const, content: system },
    ...channelEvents.map((channelEvent) =>
      toHistoryMessage(agent, channelEvent),
    ),
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
  if (event.source === `agent:${agent.name}`) return false;
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

function loadSoul(path: string) {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

async function getPackageSecretsEnv(
  agentName: string,
): Promise<Record<string, string>> {
  try {
    const res = await apiFetch("/api/secrets/env", {
      headers: { "x-orgops-agent-name": agentName },
    });
    return (await res.json()) as Record<string, string>;
  } catch {
    return {};
  }
}

async function handleEvent(agent: Agent, event: Event) {
  const channelId = event.channelId;
  if (!channelId) return;
  const injectionEnv = await getPackageSecretsEnv(agent.name);
  const soul = loadSoul(agent.soulPath);
  const allSkills = listSkills(SKILL_ROOTS);
  const enabledSkillSet = new Set(agent.enabledSkills ?? []);
  enabledSkillSet.add("local-memory");
  const selectedSkills = allSkills.filter((skill) =>
    enabledSkillSet.has(skill.name),
  );
  const skillIndex = selectedSkills
    .map(
      (skill) =>
        `${skill.name} | ${skill.description} | ${skill.location} | ${join(skill.path, "SKILL.md")}`,
    )
    .join("\n");
  const runnerGuidance = [
    "Runner environment contract:",
    "- You are running inside OrgOps agent-runner and receive one triggering event at a time from a channel.",
    "- The runner executes your tool calls and records audit events for observability.",
    "- The runner does not orchestrate your collaboration; you must decide delegation, waiting, and completion behavior.",
    "- Skills are available as files and should be read explicitly with fs_read before use when needed.",
    "",
    "Tools and channels:",
    "- Use tools directly: shell_run, fs_read/fs_write/fs_list/fs_stat/fs_mkdir/fs_rm/fs_move, proc_* and events_*.",
    "- For agent-to-agent direct messaging use events_dm_send.",
    "- For replies in the current channel use events_dm_reply or events_channel_send.",
    "- For self-reminders/continuations use events_schedule_self.",
    "- For delayed follow-ups, set deliverAt (unix ms) on events send/reply tools.",
    "- Propagate payload.originChannelId for delegated work so validated handoffs can return to origin channel.",
    "- Only the origin agent should post final handoff to payload.originChannelId; collaborators should reply in current channel.",
    "",
    "Response ownership:",
    "- Decide whether the runner should emit a final message reply for this step.",
    "- Return `[REPLY] <text>` to instruct the runner to emit a message.created reply.",
    "- Return `[NO_REPLY]` when you already sent the needed message via events tools or intentionally want silence.",
    "- If no directive is provided, runner defaults to reply behavior.",
    "- Avoid duplicate final responses: do not both send via tool and also return `[REPLY]` with the same content.",
    "",
    "Output quality:",
    "- Final user-facing text must be concise and human-readable.",
    "- Never emit raw tool JSON as prose.",
  ].join("\n");
  const system = [
    agent.systemInstructions,
    `Workspace:\n${agent.workspacePath}\n\n`,
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
    injectionEnv,
    apiFetch,
    emitEvent,
    emitAudit: (
      type: string,
      payload: unknown,
      source = `agent:${agent.name}`,
    ) => emitEvent({ type, payload, source }),
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

  const originChannelId =
    typeof event.payload?.originChannelId === "string"
      ? event.payload.originChannelId.trim()
      : "";
  await emitEvent({
    type: "message.created",
    payload: {
      text: directive.text,
      eventType: event.type,
      hopCount: Number(event.payload?.hopCount ?? 0) + 1,
      ...(originChannelId ? { originChannelId } : {}),
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
  const cursor = cursors.get(agent.name) ?? 0;
  const baseQuery = `agentName=${encodeURIComponent(agent.name)}&status=PENDING&limit=50`;
  const res = await apiFetch(`/api/events?${baseQuery}&after=${cursor}`);
  let events = (await res.json()) as Event[];
  if (events.length === 0 && cursor > 0) {
    // Recover from stale in-memory cursors when event history is cleared between scenario runs.
    const fallbackRes = await apiFetch(`/api/events?${baseQuery}&after=0`);
    events = (await fallbackRes.json()) as Event[];
  }
  for (const event of events) {
    cursors.set(
      agent.name,
      Math.max(cursors.get(agent.name) ?? 0, event.createdAt ?? 0),
    );
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
  while (true) {
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
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
