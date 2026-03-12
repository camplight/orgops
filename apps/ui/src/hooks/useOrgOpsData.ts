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
  SkillMeta,
  Team,
  Thread,
  Conversation
} from "../types";

type DashboardEventStats = {
  total: number;
  processed: number;
  failed: number;
  pending: number;
  scheduled: number;
};

function getDashboardEventStats(events: EventRow[]): DashboardEventStats {
  const statusCounts = events.reduce<Record<string, number>>((acc, event) => {
    const status = (event.status ?? "UNKNOWN").toUpperCase();
    acc[status] = (acc[status] ?? 0) + 1;
    return acc;
  }, {});

  return {
    total: events.length,
    processed: (statusCounts.DELIVERED ?? 0) + (statusCounts.PROCESSED ?? 0),
    failed: (statusCounts.FAILED ?? 0) + (statusCounts.DEAD ?? 0),
    pending: statusCounts.PENDING ?? 0,
    scheduled: statusCounts.SCHEDULED ?? 0
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
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [processes, setProcesses] = useState<ProcessRow[]>([]);
  const [processOutput, setProcessOutput] = useState<Record<string, ProcessOutputRow[]>>({});
  const [secrets, setSecrets] = useState<SecretRow[]>([]);
  const [channelEvents, setChannelEvents] = useState<EventRow[]>([]);
  const [channelParticipants, setChannelParticipants] = useState<ChannelParticipant[]>([]);
  const [dashboardEventStats, setDashboardEventStats] = useState<DashboardEventStats>({
    total: 0,
    processed: 0,
    failed: 0,
    pending: 0,
    scheduled: 0
  });

  const refreshDashboard = useCallback(() => {
    apiJson<Agent[]>("/api/agents").then(setAgents);
    apiJson<SkillMeta[]>("/api/skills").then(setSkills);
  }, []);
  const refreshEvents = useCallback(
    (query = "/api/events?limit=50&order=desc") => apiJson<EventRow[]>(query).then(setEvents),
    []
  );
  const refreshDashboardEvents = useCallback(async () => {
    const [recentEvents, allEvents] = await Promise.all([
      apiJson<EventRow[]>("/api/events?limit=50&order=desc"),
      apiJson<EventRow[]>("/api/events?all=1&order=desc")
    ]);
    setEvents(recentEvents);
    setDashboardEventStats(getDashboardEventStats(allEvents));
  }, []);

  const refreshTeams = useCallback(() => apiJson<Team[]>("/api/teams").then(setTeams), []);
  const refreshHumans = useCallback(() => apiJson<Human[]>("/api/humans").then(setHumans), []);
  const refreshEventTypes = useCallback(
    () =>
      apiJson<{ eventTypes: EventTypeInfo[] }>("/api/event-types").then((response) =>
        setEventTypes(response.eventTypes ?? [])
      ),
    []
  );
  const refreshChannels = useCallback(
    () => apiJson<Channel[]>("/api/channels").then(setChannels),
    []
  );
  const refreshConversations = useCallback(
    () => apiJson<Conversation[]>("/api/conversations").then(setConversations),
    []
  );
  const refreshProcesses = useCallback(
    () => apiJson<ProcessRow[]>("/api/processes?reconcile=1").then(setProcesses),
    []
  );
  const refreshSecrets = useCallback(
    () => apiJson<SecretRow[]>("/api/secrets").then(setSecrets),
    []
  );

  useEffect(() => {
    if (!authenticated) return;
    refreshDashboard();
    refreshDashboardEvents();
    refreshEventTypes();
    refreshChannels();
    refreshProcesses();
    refreshSecrets();
    refreshTeams();
    refreshHumans();
    const id = setInterval(refreshDashboard, 5000);
    return () => clearInterval(id);
  }, [
    authenticated,
    refreshDashboard,
    refreshDashboardEvents,
    refreshEventTypes,
    refreshChannels,
    refreshProcesses,
    refreshSecrets,
    refreshTeams,
    refreshHumans
  ]);

  const loadConversation = useCallback(async (id: string, channelId?: string | null) => {
    const threadsData = await apiJson<Thread[]>(`/api/conversations/${id}/threads`);
    setThreads(threadsData);
    if (channelId) {
      const eventsData = await apiJson<EventRow[]>(
        `/api/events?channelId=${channelId}&limit=200`
      );
      setEvents(eventsData);
    } else {
      setEvents([]);
    }
    return threadsData;
  }, []);

  const loadProcessOutput = useCallback(async (id: string) => {
    const output = await apiJson<ProcessOutputRow[]>(
      `/api/processes/${id}/output?tail=1&limit=2000`
    );
    setProcessOutput((prev) => ({ ...prev, [id]: output }));
  }, []);

  const loadChannelEvents = useCallback(async (channelId: string) => {
    const data = await apiJson<EventRow[]>(
      `/api/events?channelId=${channelId}&limit=200`
    );
    setChannelEvents(data);
    return data;
  }, []);

  const loadChannelParticipants = useCallback(async (channelId: string) => {
    const data = await apiJson<ChannelParticipant[]>(
      `/api/channels/${channelId}/participants`
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
    refreshDashboard,
    refreshEvents,
    refreshDashboardEvents,
    refreshTeams,
    refreshHumans,
    refreshEventTypes,
    refreshChannels,
    refreshConversations,
    refreshProcesses,
    refreshSecrets,
    channelEvents,
    channelParticipants,
    dashboardEventStats,
    loadChannelEvents,
    loadChannelParticipants,
    loadConversation,
    loadProcessOutput,
    apiFetch,
    apiJson,
    getApiHeaders
  };
}
