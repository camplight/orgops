import {
  refreshChannelFullMemory,
  refreshChannelRecentMemory,
  refreshCrossChannelFullMemory,
  refreshCrossChannelRecentMemory,
} from "./context-maintenance";
import type { Agent } from "./types";

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
  getPackageSecretsEnv: (
    agentName: string,
    channelId?: string,
  ) => Promise<Record<string, string>>;
  emitEvent: (event: unknown) => Promise<void>;
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  channelRecentMemoryIntervalMs: number;
  channelFullMemoryIntervalMs: number;
  crossRecentMemoryIntervalMs: number;
  crossFullMemoryIntervalMs: number;
};

function isAgentSubscribed(channel: ChannelRecord, agentName: string): boolean {
  return (channel.participants ?? []).some(
    (participant) =>
      String(participant.subscriberType ?? "").toUpperCase() === "AGENT" &&
      participant.subscriberId === agentName,
  );
}

export function createMaintenanceLoop(deps: Dependencies) {
  const maintenanceInFlight = new Map<string, Promise<void>>();
  const channelRecentLastRunAtByChannel = new Map<string, number>();
  const channelFullLastRunAtByChannel = new Map<string, number>();
  const crossRecentLastRunAtByAgent = new Map<string, number>();
  const crossFullLastRunAtByAgent = new Map<string, number>();

  async function runAgentMaintenancePass(agent: Agent) {
    const channels = await deps.listChannels();
    const injectionEnvByChannel = new Map<string, Record<string, string>>();
    const ensureInjectionEnv = async (
      channelId: string,
    ): Promise<Record<string, string>> => {
      const cached = injectionEnvByChannel.get(channelId);
      if (cached) return cached;
      const env = await deps.getPackageSecretsEnv(agent.name, channelId);
      injectionEnvByChannel.set(channelId, env);
      return env;
    };
    let crossMemoryEnv: Record<string, string> | null = null;
    const ensureCrossMemoryEnv = async (): Promise<Record<string, string>> => {
      if (crossMemoryEnv) return crossMemoryEnv;
      crossMemoryEnv = await deps.getPackageSecretsEnv(agent.name);
      return crossMemoryEnv;
    };
    const subscribedChannels = channels.filter((channel) =>
      isAgentSubscribed(channel, agent.name),
    );
    const subscribedChannelIds = subscribedChannels
      .map((channel) => channel.id)
      .filter((channelId): channelId is string => Boolean(channelId));
    const now = Date.now();
    let updatedAnyChannelRecent = false;
    let updatedAnyChannelFull = false;
    for (const channel of subscribedChannels) {
      if (!channel.id) continue;
      const channelKey = `${agent.name}::${channel.id}`;
      const channelRecentLastRun =
        channelRecentLastRunAtByChannel.get(channelKey) ?? 0;
      const channelFullLastRun = channelFullLastRunAtByChannel.get(channelKey) ?? 0;
      const shouldRunChannelRecent =
        now - channelRecentLastRun >= deps.channelRecentMemoryIntervalMs;
      const shouldRunChannelFull =
        now - channelFullLastRun >= deps.channelFullMemoryIntervalMs;
      if (!shouldRunChannelRecent && !shouldRunChannelFull) continue;
      try {
        if (shouldRunChannelRecent) {
          const result = await refreshChannelRecentMemory({
            agent,
            channelId: channel.id,
            apiFetch: deps.apiFetch,
            getEnv: () => ensureInjectionEnv(channel.id),
            emitEvent: deps.emitEvent,
          });
          if (result) updatedAnyChannelRecent = true;
          channelRecentLastRunAtByChannel.set(channelKey, now);
        }
        if (shouldRunChannelFull) {
          const result = await refreshChannelFullMemory({
            agent,
            channelId: channel.id,
            apiFetch: deps.apiFetch,
            getEnv: () => ensureInjectionEnv(channel.id),
            emitEvent: deps.emitEvent,
          });
          if (result) updatedAnyChannelFull = true;
          channelFullLastRunAtByChannel.set(channelKey, now);
        }
      } catch (error) {
        console.warn(
          `runner maintenance failed for ${agent.name} channel=${channel.id}`,
          error,
        );
      }
    }

    const crossRecentLastRun = crossRecentLastRunAtByAgent.get(agent.name) ?? 0;
    const crossFullLastRun = crossFullLastRunAtByAgent.get(agent.name) ?? 0;
    const shouldRunCrossRecent =
      updatedAnyChannelRecent ||
      now - crossRecentLastRun >= deps.crossRecentMemoryIntervalMs;
    const shouldRunCrossFull =
      updatedAnyChannelFull ||
      now - crossFullLastRun >= deps.crossFullMemoryIntervalMs;
    if (subscribedChannelIds.length === 0) return;
    if (shouldRunCrossRecent) {
      try {
        const env = await ensureCrossMemoryEnv();
        await refreshCrossChannelRecentMemory({
          agent,
          channelIds: subscribedChannelIds,
          apiFetch: deps.apiFetch,
          getEnv: ensureCrossMemoryEnv,
          emitEvent: deps.emitEvent,
        });
      } catch (error) {
        console.warn(`runner cross recent memory failed for ${agent.name}`, error);
      } finally {
        crossRecentLastRunAtByAgent.set(agent.name, now);
      }
    }
    if (shouldRunCrossFull) {
      try {
        const env = await ensureCrossMemoryEnv();
        await refreshCrossChannelFullMemory({
          agent,
          channelIds: subscribedChannelIds,
          apiFetch: deps.apiFetch,
          getEnv: ensureCrossMemoryEnv,
          emitEvent: deps.emitEvent,
        });
      } catch (error) {
        console.warn(`runner cross full memory failed for ${agent.name}`, error);
      } finally {
        crossFullLastRunAtByAgent.set(agent.name, now);
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
    crossRecentLastRunAtByAgent.delete(agentName);
    crossFullLastRunAtByAgent.delete(agentName);
    for (const key of [...channelRecentLastRunAtByChannel.keys()]) {
      if (!key.startsWith(`${agentName}::`)) continue;
      channelRecentLastRunAtByChannel.delete(key);
      channelFullLastRunAtByChannel.delete(key);
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
