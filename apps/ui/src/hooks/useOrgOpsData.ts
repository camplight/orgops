import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiJson, getApiHeaders } from "../api";
import type {
  Agent,
  Channel,
  ChannelParticipant,
  EventRow,
  EventTypeInfo,
  ProcessRow,
  SecretRow,
  SkillMeta,
  Team,
  Thread,
  Conversation
} from "../types";

export function useOrgOpsData(authenticated: boolean) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventTypes, setEventTypes] = useState<EventTypeInfo[]>([]);
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [processes, setProcesses] = useState<ProcessRow[]>([]);
  const [processOutput, setProcessOutput] = useState<Record<string, unknown[]>>({});
  const [secrets, setSecrets] = useState<SecretRow[]>([]);
  const [channelEvents, setChannelEvents] = useState<EventRow[]>([]);
  const [channelParticipants, setChannelParticipants] = useState<ChannelParticipant[]>([]);

  const refreshDashboard = useCallback(() => {
    apiJson<Agent[]>("/api/agents").then(setAgents);
    apiJson<SkillMeta[]>("/api/skills").then(setSkills);
  }, []);
  const refreshEvents = useCallback(
    (query = "/api/events?limit=50&order=desc") => apiJson<EventRow[]>(query).then(setEvents),
    []
  );

  const refreshTeams = useCallback(() => apiJson<Team[]>("/api/teams").then(setTeams), []);
  const refreshEventTypes = useCallback(
    () => apiJson<EventTypeInfo[]>("/api/event-types").then(setEventTypes),
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
    () => apiJson<ProcessRow[]>("/api/processes").then(setProcesses),
    []
  );
  const refreshSecrets = useCallback(
    () => apiJson<SecretRow[]>("/api/secrets").then(setSecrets),
    []
  );

  useEffect(() => {
    if (!authenticated) return;
    refreshDashboard();
    refreshEvents();
    refreshEventTypes();
    const id = setInterval(refreshDashboard, 5000);
    return () => clearInterval(id);
  }, [authenticated, refreshDashboard, refreshEvents, refreshEventTypes]);

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
    const output = await apiJson<unknown[]>(`/api/processes/${id}/output`);
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
    refreshTeams,
    refreshEventTypes,
    refreshChannels,
    refreshConversations,
    refreshProcesses,
    refreshSecrets,
    channelEvents,
    channelParticipants,
    loadChannelEvents,
    loadChannelParticipants,
    loadConversation,
    loadProcessOutput,
    apiFetch,
    apiJson,
    getApiHeaders
  };
}
