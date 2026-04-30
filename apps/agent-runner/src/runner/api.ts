import { readFileSync, writeFileSync } from "node:fs";
import { arch, hostname, release } from "node:os";
import { ChannelRecord, isAgentSubscribed } from "../models/channel";
import type { Agent, Event } from "../types";
import type { RunnerState } from "./state";

type RunnerApiDeps = {
  apiUrl: string;
  runnerToken: string;
  heartbeatIntervalMs: number;
  runnerIdFile: string;
  runnerState: RunnerState;
};

type RunnerIdentityPayload = { runner?: { id?: string } };

let apiFetchRequestCounter = 0;

function getErrorSummary(error: unknown) {
  const err = error as
    | (Error & {
        code?: string;
        errno?: number | string;
        syscall?: string;
        cause?: unknown;
      })
    | undefined;
  const cause = err?.cause as
    | (Error & {
        code?: string;
        errno?: number | string;
        syscall?: string;
      })
    | undefined;
  return {
    message: err?.message ?? String(error),
    name: err?.name,
    code: err?.code,
    errno: err?.errno,
    syscall: err?.syscall,
    cause: cause
      ? {
          message: cause.message ?? String(cause),
          name: cause.name,
          code: cause.code,
          errno: cause.errno,
          syscall: cause.syscall,
        }
      : undefined,
  };
}

function readRunnerIdFromDisk(filePath: string): string | null {
  try {
    const value = readFileSync(filePath, "utf-8").trim();
    return value || null;
  } catch {
    return null;
  }
}

function writeRunnerIdToDisk(filePath: string, runnerId: string) {
  try {
    writeFileSync(filePath, `${runnerId}\n`, "utf-8");
  } catch (error) {
    console.warn("runner.id.persist_failed", {
      path: filePath,
      error: getErrorSummary(error),
    });
  }
}

export function createRunnerApi(deps: RunnerApiDeps) {
  async function apiFetch(path: string, init?: RequestInit) {
    const headers = new Headers(init?.headers);
    if (deps.runnerToken) headers.set("x-orgops-runner-token", deps.runnerToken);
    const method = init?.method ?? "GET";
    const url = `${deps.apiUrl}${path}`;
    const requestId = `${Date.now()}-${++apiFetchRequestCounter}`;
    const startedAt = Date.now();
    try {
      const res = await fetch(url, { ...init, headers });
      if (!res.ok) {
        const text = await res.text();
        const elapsedMs = Date.now() - startedAt;
        console.error("runner.apiFetch.http_error", {
          requestId,
          method,
          path,
          status: res.status,
          elapsedMs,
          responseBodyPreview: text.slice(0, 1000),
        });
        throw new Error(`API ${path} failed: ${res.status} ${text}`);
      }
      return res;
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      console.error("runner.apiFetch.transport_error", {
        requestId,
        method,
        path,
        url,
        elapsedMs,
        error: getErrorSummary(error),
      });
      throw error;
    }
  }

  async function registerRunnerIdentity(): Promise<string> {
    const existingRunnerId = readRunnerIdFromDisk(deps.runnerIdFile);
    const displayName =
      process.env.ORGOPS_RUNNER_NAME?.trim() ||
      `${hostname()}-${process.platform}-${arch()}`;
    const response = await apiFetch("/api/runners/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        existingRunnerId,
        displayName,
        hostname: hostname(),
        platform: process.platform,
        arch: process.arch,
        version: process.version,
        metadata: {
          release: release(),
        },
      }),
    });
    const payload = (await response.json()) as RunnerIdentityPayload;
    const runnerId = payload.runner?.id?.trim();
    if (!runnerId) {
      throw new Error("Runner registration did not return a runner ID.");
    }
    writeRunnerIdToDisk(deps.runnerIdFile, runnerId);
    deps.runnerState.registeredRunnerId = runnerId;
    return runnerId;
  }

  async function sendRunnerHeartbeat(force = false) {
    const runnerId = deps.runnerState.registeredRunnerId;
    if (!runnerId) return;
    const now = Date.now();
    if (!force && now - deps.runnerState.lastRunnerHeartbeatAt < deps.heartbeatIntervalMs) {
      return;
    }
    await apiFetch(`/api/runners/${encodeURIComponent(runnerId)}/heartbeat`, {
      method: "POST",
    });
    deps.runnerState.lastRunnerHeartbeatAt = now;
  }

  async function listAgents(): Promise<Agent[]> {
    const runnerId = deps.runnerState.registeredRunnerId;
    if (!runnerId) return [];
    const query = `assignedRunnerId=${encodeURIComponent(runnerId)}`;
    const res = await apiFetch(`/api/agents?${query}`);
    return res.json();
  }

  async function listPendingEventsForAgentChannel(
    agentName: string,
    channelId: string,
  ): Promise<Event[]> {
    const query =
      `agentName=${encodeURIComponent(agentName)}` +
      `&status=PENDING` +
      `&channelId=${encodeURIComponent(channelId)}` +
      `&limit=50`;
    const res = await apiFetch(`/api/events?${query}`);
    const payload = await res.json();
    return Array.isArray(payload) ? (payload as Event[]) : [];
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

  async function emitEvent(event: unknown) {
    await apiFetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    });
  }

  async function listChannels(): Promise<ChannelRecord[]> {
    const res = await apiFetch("/api/channels");
    return res.json();
  }

  async function getChannelRecord(channelId: string): Promise<ChannelRecord | null> {
    if (!channelId) return null;
    const channels = await listChannels();
    return channels.find((channel) => channel.id === channelId) ?? null;
  }

  async function getChannelParticipationValidationError(
    agentName: string,
    channelId?: string,
  ): Promise<string | null> {
    const targetChannelId = channelId?.trim();
    if (!targetChannelId) return null;
    const channel = await getChannelRecord(targetChannelId);
    if (!channel) {
      return `Unknown channelId "${targetChannelId}".`;
    }
    if (!isAgentSubscribed(channel, agentName)) {
      return `Agent "${agentName}" is not an AGENT participant in channel "${targetChannelId}".`;
    }
    return null;
  }

  function lifecycleChannelName(agentName: string) {
    return `agent.lifecycle.${agentName}`;
  }

  async function ensureLifecycleChannel(agentName: string): Promise<string> {
    const cached = deps.runnerState.lifecycleChannels.get(agentName);
    if (cached) return cached;
    const expectedName = lifecycleChannelName(agentName);
    const channels = await listChannels();
    const existing = channels.find(
      (channel) => channel.name === expectedName && isAgentSubscribed(channel, agentName),
    );
    if (existing?.id) {
      deps.runnerState.lifecycleChannels.set(agentName, existing.id);
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
      // Channel may already exist from another runner instance; proceed with a fresh read.
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
    deps.runnerState.lifecycleChannels.set(agentName, resolved.id);
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

  return {
    apiFetch,
    registerRunnerIdentity,
    sendRunnerHeartbeat,
    listAgents,
    listPendingEventsForAgentChannel,
    patchAgentState,
    emitEvent,
    listChannels,
    getChannelRecord,
    getChannelParticipationValidationError,
    emitStartupEvent,
    getPackageSecretsEnv,
  };
}

export type RunnerApi = ReturnType<typeof createRunnerApi>;
