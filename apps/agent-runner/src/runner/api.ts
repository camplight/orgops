import { readFileSync, writeFileSync } from "node:fs";
import { arch, hostname, release } from "node:os";
import { ChannelRecord, isAgentSubscribed } from "../models/channel";
import type { Agent, Event } from "../types";
import type { RunnerState } from "./state";
import {
  CatalogLibraryErrorCodeSchema,
  DeploymentClaimSchema,
  DeploymentCommandSchema,
  DeploymentReceiptSchema,
  DeploymentReportSchema,
  StartRequirementsResultSchema,
  VerifiedArtifactEnvelopeSchema,
  type CatalogLibraryErrorCode,
  type DeploymentClaim,
  type DeploymentCommand,
  type DeploymentReceipt,
  type DeploymentReport,
  type StartRequirementsResult,
  type VerifiedArtifactEnvelope,
} from "@orgops/schemas";
import { z } from "zod";

type RunnerApiDeps = {
  apiUrl: string;
  runnerToken: string;
  heartbeatIntervalMs: number;
  runnerIdFile: string;
  runnerState: RunnerState;
  fetch?: typeof fetch;
};

type RunnerIdentityPayload = { runner?: { id?: string } };

let apiFetchRequestCounter = 0;

export class RunnerApiHttpError extends Error {
  constructor(readonly status: number, readonly code: CatalogLibraryErrorCode | undefined, path: string, statusText?: string) {
    super(`API ${path} failed: ${status}${statusText ? ` ${statusText}` : ""}`);
    this.name = "RunnerApiHttpError";
  }
}

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
      const res = await (deps.fetch ?? fetch)(url, { ...init, headers });
      if (!res.ok) {
        const text = await res.text();
        const elapsedMs = Date.now() - startedAt;
        let code: CatalogLibraryErrorCode | undefined;
        try {
          const parsed = z.object({ code: CatalogLibraryErrorCodeSchema }).safeParse(JSON.parse(text));
          if (parsed.success) code = parsed.data.code;
        } catch { /* Malformed error bodies remain status-only and retryable. */ }
        console.error("runner.apiFetch.http_error", {
          requestId,
          method,
          path,
          status: res.status,
          ...(code ? { code } : {}),
          elapsedMs,
        });
        throw new RunnerApiHttpError(res.status, code, path, res.statusText || (path === "/api/secrets/env" && res.status === 403 ? "Forbidden" : undefined));
      }
      return res;
    } catch (error) {
      // HTTP failures are already logged above; only report transport-level faults here.
      if (typeof (error as { status?: number } | null)?.status === "number") throw error;
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

  function deploymentHeaders(attemptToken?: string): HeadersInit {
    const runnerId = deps.runnerState.registeredRunnerId;
    if (!runnerId) throw new Error("Runner is not registered.");
    return {
      "x-orgops-runner-id": runnerId,
      ...(attemptToken ? { "x-orgops-deployment-attempt-token": attemptToken } : {}),
    };
  }

  async function getAgentStartRequirements(agentName: string): Promise<StartRequirementsResult> {
    const runnerId = deps.runnerState.registeredRunnerId;
    if (!runnerId) throw new Error("Runner is not registered.");
    const response = await apiFetch(`/api/runners/${encodeURIComponent(runnerId)}/agents/${encodeURIComponent(agentName)}/start-requirements`);
    return StartRequirementsResultSchema.parse(await response.json());
  }

  async function listPackageDeployments(): Promise<DeploymentCommand[]> {
    const runnerId = deps.runnerState.registeredRunnerId;
    if (!runnerId) return [];
    const response = await apiFetch(`/api/runners/${encodeURIComponent(runnerId)}/package-deployments`);
    return z.array(DeploymentCommandSchema).max(32).parse(await response.json());
  }

  async function claimPackageDeployment(deploymentId: string): Promise<DeploymentClaim> {
    const response = await apiFetch(`/api/runner-package-deployments/${encodeURIComponent(deploymentId)}/claim`, {
      method: "POST", headers: deploymentHeaders(),
    });
    return DeploymentClaimSchema.parse(await response.json());
  }

  async function getPackageArtifact(deploymentId: string, attemptToken: string): Promise<VerifiedArtifactEnvelope> {
    const response = await apiFetch(`/api/runner-package-deployments/${encodeURIComponent(deploymentId)}/artifact`, {
      headers: deploymentHeaders(attemptToken),
    });
    return VerifiedArtifactEnvelopeSchema.parse(await response.json());
  }

  async function reportPackageDeployment(deploymentId: string, attemptToken: string, rawReport: DeploymentReport): Promise<DeploymentReceipt> {
    const report = DeploymentReportSchema.parse(rawReport);
    const response = await apiFetch(`/api/runner-package-deployments/${encodeURIComponent(deploymentId)}/report`, {
      method: "POST", headers: { ...deploymentHeaders(attemptToken), "content-type": "application/json" }, body: JSON.stringify(report),
    });
    return DeploymentReceiptSchema.parse(await response.json());
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
    const res = await apiFetch("/api/secrets/env", {
      headers: {
        "x-orgops-agent-name": agentName,
        ...(channelId ? { "x-orgops-channel-id": channelId } : {}),
      },
    });
    return (await res.json()) as Record<string, string>;
  }

  return {
    apiFetch,
    registerRunnerIdentity,
    sendRunnerHeartbeat,
    listAgents,
    getAgentStartRequirements,
    listPackageDeployments,
    claimPackageDeployment,
    getPackageArtifact,
    reportPackageDeployment,
    listPendingEventsForAgentChannel,
    patchAgentState,
    emitEvent,
    listChannels,
    getChannelRecord,
    getChannelParticipationValidationError,
    ensureLifecycleChannel,
    emitStartupEvent,
    getPackageSecretsEnv,
  };
}

export type RunnerApi = ReturnType<typeof createRunnerApi>;
