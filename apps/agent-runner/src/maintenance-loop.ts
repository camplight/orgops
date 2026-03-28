import {
  ensureChannelSessionSummary,
  refreshAgentLocalMemory,
  resolveAgentContextSessionGapMs,
} from "./context-maintenance";
import { listChannelEventsAfter } from "./channel-events";
import type { Agent, Event } from "./types";

type ChannelParticipant = {
  subscriberType?: string;
  subscriberId?: string;
};

type ChannelRecord = {
  id: string;
  participants?: ChannelParticipant[];
};

type Dependencies = {
  listChannels: () => Promise<ChannelRecord[]>;
  ensureLifecycleChannel: (agentName: string) => Promise<string>;
  getPackageSecretsEnv: (
    agentName: string,
    channelId?: string,
  ) => Promise<Record<string, string>>;
  emitEvent: (event: unknown) => Promise<void>;
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  summaryIntervalMs: number;
  localMemoryIntervalMs: number;
};

function isAuditEvent(event: Event): boolean {
  return typeof event.type === "string" && event.type.startsWith("audit.");
}

function isMeaningfulMemoryEvent(event: Event): boolean {
  if (isAuditEvent(event)) return false;
  return event.type !== "session.summary.created";
}

function normalizeTs(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 0;
}

function isAgentSubscribed(channel: ChannelRecord, agentName: string): boolean {
  return (channel.participants ?? []).some(
    (participant) =>
      String(participant.subscriberType ?? "").toUpperCase() === "AGENT" &&
      participant.subscriberId === agentName,
  );
}

export function createMaintenanceLoop(deps: Dependencies) {
  const maintenanceInFlight = new Map<string, Promise<void>>();
  const summaryLastRunAtByChannel = new Map<string, number>();
  const memoryLastRunAtByChannel = new Map<string, number>();
  const summaryProcessedAtByChannel = new Map<string, number>();
  const memoryProcessedAtByChannel = new Map<string, number>();

  async function runAgentMaintenancePass(agent: Agent) {
    const sessionGapMs = resolveAgentContextSessionGapMs(agent);
    const channels = await deps.listChannels();
    const injectionEnvByChannel = new Map<string, Record<string, string>>();
    let cachedLifecycleChannelId: string | null = null;
    const ensureInjectionEnv = async (
      channelId: string,
    ): Promise<Record<string, string>> => {
      const cached = injectionEnvByChannel.get(channelId);
      if (cached) return cached;
      const env = await deps.getPackageSecretsEnv(agent.name, channelId);
      injectionEnvByChannel.set(channelId, env);
      return env;
    };
    const ensureLifecycleChannelId = async (): Promise<string> => {
      if (cachedLifecycleChannelId) return cachedLifecycleChannelId;
      cachedLifecycleChannelId = await deps.ensureLifecycleChannel(agent.name);
      return cachedLifecycleChannelId;
    };
    const subscribedChannels = channels.filter((channel) =>
      isAgentSubscribed(channel, agent.name),
    );
    const now = Date.now();
    for (const channel of subscribedChannels) {
      if (!channel.id) continue;
      const channelKey = `${agent.name}::${channel.id}`;
      const summaryLastRun = summaryLastRunAtByChannel.get(channelKey) ?? 0;
      const memoryLastRun = memoryLastRunAtByChannel.get(channelKey) ?? 0;
      const shouldRunSummary = now - summaryLastRun >= deps.summaryIntervalMs;
      const shouldRunMemory = now - memoryLastRun >= deps.localMemoryIntervalMs;
      if (!shouldRunSummary && !shouldRunMemory) continue;
      try {
        if (shouldRunSummary) {
          const summaryProcessedAt = summaryProcessedAtByChannel.get(channelKey);
          const summaryAfter =
            typeof summaryProcessedAt === "number"
              ? Math.max(0, summaryProcessedAt - sessionGapMs - 1)
              : undefined;
          const summaryEventsAll = await listChannelEventsAfter(
            deps.apiFetch,
            channel.id,
            summaryAfter,
          );
          const summaryEvents = summaryEventsAll.filter((event) => !isAuditEvent(event));
          if (summaryEvents.length > 0) {
            const injectionEnv = await ensureInjectionEnv(channel.id);
            await ensureChannelSessionSummary({
              agent,
              channelId: channel.id,
              events: summaryEvents,
              sessionGapMs,
              env: injectionEnv,
              emitEvent: deps.emitEvent,
            });
          }
          const maxSummaryTs = summaryEventsAll.reduce(
            (max, event) =>
              Math.max(max, typeof event.createdAt === "number" ? event.createdAt : 0),
            summaryProcessedAt ?? 0,
          );
          summaryProcessedAtByChannel.set(channelKey, maxSummaryTs);
          summaryLastRunAtByChannel.set(channelKey, now);
        }
        if (shouldRunMemory) {
          const memoryProcessedAt = memoryProcessedAtByChannel.get(channelKey);
          const memoryAfter =
            typeof memoryProcessedAt === "number"
              ? Math.max(0, memoryProcessedAt - sessionGapMs - 1)
              : undefined;
          const memoryEventsAll = await listChannelEventsAfter(
            deps.apiFetch,
            channel.id,
            memoryAfter,
          );
          const memoryEvents = memoryEventsAll.filter((event) => !isAuditEvent(event));
          const meaningfulMemoryEvents = memoryEventsAll.filter(isMeaningfulMemoryEvent);
          const hasNewMeaningfulEvents =
            typeof memoryProcessedAt !== "number"
              ? meaningfulMemoryEvents.length > 0
              : meaningfulMemoryEvents.some(
                  (event) => normalizeTs(event.createdAt) > memoryProcessedAt,
                );
          if (hasNewMeaningfulEvents) {
            const injectionEnv = await ensureInjectionEnv(channel.id);
            const lifecycleChannelId = await ensureLifecycleChannelId();
            await refreshAgentLocalMemory({
              agent,
              channelId: channel.id,
              events: memoryEvents,
              sessionGapMs,
              env: injectionEnv,
              lifecycleChannelId,
              emitEvent: deps.emitEvent,
            });
          }
          const maxMemoryTs = memoryEventsAll.reduce(
            (max, event) =>
              Math.max(max, typeof event.createdAt === "number" ? event.createdAt : 0),
            memoryProcessedAt ?? 0,
          );
          memoryProcessedAtByChannel.set(channelKey, maxMemoryTs);
          memoryLastRunAtByChannel.set(channelKey, now);
        }
      } catch (error) {
        console.warn(
          `runner maintenance failed for ${agent.name} channel=${channel.id}`,
          error,
        );
      }
    }
  }

  function schedule(agent: Agent) {
    if (maintenanceInFlight.has(agent.name)) return;
    const task = runAgentMaintenancePass(agent)
      .catch((error) => {
        console.warn(`runner maintenance pass failed for ${agent.name}`, error);
      })
      .finally(() => {
        maintenanceInFlight.delete(agent.name);
      });
    maintenanceInFlight.set(agent.name, task);
  }

  function clearAgent(agentName: string) {
    maintenanceInFlight.delete(agentName);
    for (const key of [...summaryLastRunAtByChannel.keys()]) {
      if (!key.startsWith(`${agentName}::`)) continue;
      summaryLastRunAtByChannel.delete(key);
      memoryLastRunAtByChannel.delete(key);
      summaryProcessedAtByChannel.delete(key);
      memoryProcessedAtByChannel.delete(key);
    }
  }

  async function awaitInFlight() {
    if (maintenanceInFlight.size === 0) return;
    await Promise.allSettled([...maintenanceInFlight.values()]);
  }

  return {
    schedule,
    clearAgent,
    awaitInFlight,
  };
}
