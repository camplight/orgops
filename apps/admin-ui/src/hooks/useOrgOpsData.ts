import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiJson, getApiHeaders } from "../api";
import type {
  Agent,
  Channel,
  ChannelParticipant,
  EventRow,
  EventTypeInfo,
  Human,
  ProcessRow,
  ProcessOutputRow,
  SecretRow,
  IntegrationKey,
  SkillMeta,
  RunnerNode,
  Team,
  Thread,
  Conversation,
} from "../types";

type DashboardEventStats = {
  total: number;
  processed: number;
  failed: number;
  pending: number;
  scheduled: number;
};

function toDashboardEventStats(stats: {
  total: number;
  byStatus: Record<string, number>;
}): DashboardEventStats {
  return {
    total: stats.total,
    processed: (stats.byStatus.DELIVERED ?? 0) + (stats.byStatus.PROCESSED ?? 0),
    failed: (stats.byStatus.FAILED ?? 0) + (stats.byStatus.DEAD ?? 0),
    pending: stats.byStatus.PENDING ?? 0,
    scheduled: stats.byStatus.SCHEDULED ?? 0,
  };
}

export function useOrgOpsData(authenticated: boolean) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventTypes, setEventTypes] = useState<EventTypeInfo[]>([]);
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [humans, setHumans] = useState<Human[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [runners, setRunners] = useState<RunnerNode[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [processes, setProcesses] = useState<ProcessRow[]>([]);
  const [processOutput, setProcessOutput] = useState<
    Record<string, ProcessOutputRow[]>
  >({});
  const [secrets, setSecrets] = useState<SecretRow[]>([]);
  const [integrationKeys, setIntegrationKeys] = useState<IntegrationKey[]>([]);
  const [channelEvents, setChannelEvents] = useState<EventRow[]>([]);
  const [channelParticipants, setChannelParticipants] = useState<
    ChannelParticipant[]
  >([]);
  const [dashboardEventStats, setDashboardEventStats] =
    useState<DashboardEventStats>({
      total: 0,
      processed: 0,
      failed: 0,
      pending: 0,
      scheduled: 0,
    });

  const refreshDashboard = useCallback(() => {
    apiJson<Agent[]>("/api/agents").then(setAgents);
    apiJson<RunnerNode[]>("/api/runners").then(setRunners);
  }, []);
  const refreshSkills = useCallback(
    () => apiJson<SkillMeta[]>("/api/skills").then(setSkills),
    [],
  );
  const refreshEvents = useCallback(
    (query = "/api/events?limit=50&order=desc") =>
      apiJson<EventRow[]>(query).then(setEvents),
    [],
  );
  // Counters come from the aggregate endpoint — never from an event dump. The
  // previous `all=1` fetch pulled the ENTIRE events table (~273k rows) up to
  // 4×/s during a live build, saturating the single-threaded API so hard that
  // agents' own event posts (step.status, orgops-report) timed out.
  const refreshDashboardEvents = useCallback(async () => {
    const [recentEvents, stats] = await Promise.all([
      apiJson<EventRow[]>("/api/events?limit=50&order=desc"),
      apiJson<{ total: number; byStatus: Record<string, number> }>(
        "/api/events/stats",
      ),
    ]);
    setEvents(recentEvents);
    setDashboardEventStats(toDashboardEventStats(stats));
  }, []);

  const refreshTeams = useCallback(
    () => apiJson<Team[]>("/api/teams").then(setTeams),
    [],
  );
  const refreshHumans = useCallback(
    () => apiJson<Human[]>("/api/humans").then(setHumans),
    [],
  );
  const refreshEventTypes = useCallback(
    () =>
      apiJson<{ eventTypes: EventTypeInfo[] }>("/api/event-types").then(
        (response) => setEventTypes(response.eventTypes ?? []),
      ),
    [],
  );
  const refreshChannels = useCallback(
    () => apiJson<Channel[]>("/api/channels").then(setChannels),
    [],
  );
  const refreshRunners = useCallback(
    () => apiJson<RunnerNode[]>("/api/runners").then(setRunners),
    [],
  );
  const refreshConversations = useCallback(
    () => apiJson<Conversation[]>("/api/conversations").then(setConversations),
    [],
  );
  const refreshProcesses = useCallback(
    () =>
      apiJson<ProcessRow[]>("/api/processes?reconcile=1").then(setProcesses),
    [],
  );
  const refreshSecrets = useCallback(
    () => apiJson<SecretRow[]>("/api/secrets").then(setSecrets),
    [],
  );
  const refreshIntegrationKeys = useCallback(
    () => apiJson<IntegrationKey[]>("/api/integration-keys").then(setIntegrationKeys),
    [],
  );

  useEffect(() => {
    if (!authenticated) return;
    refreshDashboard();
    refreshSkills();
    refreshDashboardEvents();
    refreshEventTypes();
    refreshChannels();
    refreshRunners();
    refreshProcesses();
    refreshSecrets();
    refreshIntegrationKeys();
    refreshTeams();
    refreshHumans();
  }, [
    authenticated,
    refreshDashboard,
    refreshSkills,
    refreshDashboardEvents,
    refreshEventTypes,
    refreshChannels,
    refreshRunners,
    refreshProcesses,
    refreshSecrets,
    refreshIntegrationKeys,
    refreshTeams,
    refreshHumans,
  ]);

  const loadConversation = useCallback(
    async (id: string, channelId?: string | null) => {
      const threadsData = await apiJson<Thread[]>(
        `/api/conversations/${id}/threads`,
      );
      setThreads(threadsData);
      if (channelId) {
        const eventsData = await apiJson<EventRow[]>(
          `/api/events?channelId=${channelId}&limit=200`,
        );
        setEvents(eventsData);
      } else {
        setEvents([]);
      }
      return threadsData;
    },
    [],
  );

  const loadProcessOutput = useCallback(async (id: string) => {
    const output = await apiJson<ProcessOutputRow[]>(
      `/api/processes/${id}/output?tail=1&limit=2000`,
    );
    setProcessOutput((prev) => ({ ...prev, [id]: output }));
  }, []);

  const loadChannelEvents = useCallback(async (channelId: string) => {
    const data = await apiJson<EventRow[]>(
      `/api/events?channelId=${channelId}&limit=200`,
    );
    setChannelEvents(data);
    return data;
  }, []);

  const loadChannelParticipants = useCallback(async (channelId: string) => {
    const data = await apiJson<ChannelParticipant[]>(
      `/api/channels/${channelId}/participants`,
    );
    setChannelParticipants(data);
  }, []);

  return {
    agents,
    setAgents,
    events,
    setEvents,
    eventTypes,
    setEventTypes,
    skills,
    teams,
    setTeams,
    humans,
    setHumans,
    channels,
    runners,
    setChannels,
    conversations,
    setConversations,
    threads,
    setThreads,
    processes,
    setProcesses,
    processOutput,
    setProcessOutput,
    secrets,
    setSecrets,
    integrationKeys,
    setIntegrationKeys,
    refreshDashboard,
    refreshSkills,
    refreshEvents,
    refreshDashboardEvents,
    refreshTeams,
    refreshHumans,
    refreshEventTypes,
    refreshChannels,
    refreshRunners,
    refreshConversations,
    refreshProcesses,
    refreshSecrets,
    refreshIntegrationKeys,
    channelEvents,
    channelParticipants,
    dashboardEventStats,
    loadChannelEvents,
    loadChannelParticipants,
    loadConversation,
    loadProcessOutput,
    apiFetch,
    apiJson,
    getApiHeaders,
  };
}
