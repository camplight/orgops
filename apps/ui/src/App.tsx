import { useCallback, useState } from "react";
import type { Screen } from "./types";
import { apiFetch, apiJson, getApiHeaders } from "./api";
import { AppLayout } from "./components/layout";
import { LoginForm } from "./components/auth";
import {
  DashboardScreen,
  AgentsScreen,
  TeamsScreen,
  ChannelsScreen,
  ChatScreen,
  EventsScreen,
  ProcessesScreen,
  SkillsScreen,
  SecretsScreen,
  ProfileScreen
} from "./screens";
import { useAuth, useOrgOpsData, useWebSocket } from "./hooks";
import type { EventRow, TeamMember } from "./types";

type ChatTarget = { kind: "channel"; id: string };

const DEFAULT_EVENT_FILTERS = {
  agentName: "",
  channelId: "",
  type: "",
  source: "",
  status: "",
  teamId: "",
  auditOnly: false
};

export default function App() {
  const { authChecked, authenticated, username, refreshAuth, logout } = useAuth();
  const [activeScreen, setActiveScreen] = useState<Screen>("dashboard");
  const [activeProcessId, setActiveProcessId] = useState<string | null>(null);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [activeChatTarget, setActiveChatTarget] = useState<ChatTarget | null>(null);
  const [chatEvents, setChatEvents] = useState<EventRow[]>([]);
  const [messageText, setMessageText] = useState("");
  const [eventFilters, setEventFilters] = useState(DEFAULT_EVENT_FILTERS);

  const data = useOrgOpsData(authenticated);

  const appendUniqueEvent = useCallback((list: EventRow[], incoming: EventRow) => {
    if (list.some((event) => event.id === incoming.id)) return list;
    return [...list, incoming];
  }, []);

  const eventMatchesChatTarget = useCallback(
    (event: EventRow) => {
      if (!activeChatTarget) return false;
      return event.channelId === activeChatTarget.id;
    },
    [activeChatTarget]
  );

  const handleAgentStatus = useCallback((agentName: string, runtimeState: string) => {
    data.setAgents((prev) =>
      prev.map((agent) =>
        agent.name === agentName ? { ...agent, runtimeState } : agent
      )
    );
  }, [data.setAgents]);

  const handleWsEvent = useCallback((event: EventRow) => {
    data.setEvents((prev) => appendUniqueEvent(prev, event));
    if (eventMatchesChatTarget(event)) {
      setChatEvents((prev) => appendUniqueEvent(prev, event));
    }
  }, [appendUniqueEvent, data.setEvents, eventMatchesChatTarget]);

  const handleProcessOutput = useCallback(
    (processId: string, msgData: { text?: string }[]) => {
      const entry = Array.isArray(msgData) ? msgData : [msgData];
      data.setProcessOutput((prev) => ({
        ...prev,
        [processId]: [...(prev[processId] ?? []), ...entry]
      }));
    },
    [data.setProcessOutput]
  );

  useWebSocket({
    authenticated,
    onAgentStatus: handleAgentStatus,
    onEvent: handleWsEvent,
    onProcessOutput: (processId, d) =>
      handleProcessOutput(processId, [d as { text?: string }]),
    activeChannelId,
    activeProcessId
  });

  const fetchAllEvents = useCallback(
    async (baseParams: URLSearchParams) => {
      const limit = 1000;
      const seen = new Set<string>();
      const collected: EventRow[] = [];
      let after = 0;

      while (true) {
        const params = new URLSearchParams(baseParams);
        params.set("limit", String(limit));
        params.set("order", "asc");
        if (after > 0) params.set("after", String(after));

        const chunk = await apiJson<EventRow[]>(`/api/events?${params.toString()}`);
        if (chunk.length === 0) break;

        for (const event of chunk) {
          if (!seen.has(event.id)) {
            seen.add(event.id);
            collected.push(event);
          }
          after = Math.max(after, event.createdAt ?? 0);
        }

        if (chunk.length < limit) break;
      }

      return collected.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    },
    []
  );

  const loadChatEventsForTarget = useCallback(
    async (target: ChatTarget) => {
      const params = new URLSearchParams();
      params.set("channelId", target.id);
      return fetchAllEvents(params);
    },
    [fetchAllEvents]
  );

  const ensureDirectChannel = useCallback(
    async (agentName: string) => {
      if (!username) {
        throw new Error("You must be logged in to start a direct chat.");
      }
      const response = await apiFetch("/api/channels/direct/human-agent", {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({
          agentName
        })
      });
      const body = (await response.json()) as { id: string };
      await data.refreshChannels();
      return body.id;
    },
    [data, username]
  );

  const onScreenFocus = useCallback(
    (screen: Screen) => {
      if (screen === "dashboard") data.refreshEvents();
      if (screen === "channels") data.refreshChannels();
      if (screen === "teams") data.refreshTeams();
      if (screen === "chat") {
        data.refreshChannels();
        if (activeChatTarget) {
          loadChatEventsForTarget(activeChatTarget).then(setChatEvents);
        }
      }
      if (screen === "processes") data.refreshProcesses();
      if (screen === "secrets") data.refreshSecrets();
      if (screen === "events") {
        fetchAllEvents(new URLSearchParams()).then(data.setEvents);
        data.refreshChannels();
        data.refreshEventTypes();
      }
    },
    [activeChatTarget, data, fetchAllEvents, loadChatEventsForTarget]
  );

  const handleSelectChatTarget = useCallback(
    async (value: string) => {
      const [kind, id] = value.split(":", 2);
      if (!id || (kind !== "agent" && kind !== "channel")) return;
      const channelId = kind === "channel" ? id : await ensureDirectChannel(id);
      const nextTarget: ChatTarget = { kind: "channel", id: channelId };
      setActiveChannelId(channelId);
      setActiveChatTarget(nextTarget);
      const list = await loadChatEventsForTarget(nextTarget);
      setChatEvents(list);
    },
    [ensureDirectChannel, loadChatEventsForTarget]
  );

  const handleSendMessage = useCallback(async () => {
    if (!activeChatTarget || !messageText.trim()) return;
    const eventSource = `human:${username ?? "unknown"}`;
    await apiFetch("/api/events", {
      method: "POST",
      headers: getApiHeaders(),
      body: JSON.stringify({
        type: "message.created",
        payload: { text: messageText },
        source: eventSource,
        channelId: activeChatTarget.id
      })
    });
    setMessageText("");
    const list = await loadChatEventsForTarget(activeChatTarget);
    setChatEvents(list);
  }, [
    activeChatTarget,
    messageText,
    loadChatEventsForTarget,
    username
  ]);

  const handleApplyEventFilters = useCallback(async () => {
    const params = new URLSearchParams();
    if (eventFilters.agentName) params.set("agentName", eventFilters.agentName);
    if (eventFilters.channelId) params.set("channelId", eventFilters.channelId);
    if (eventFilters.type) params.set("type", eventFilters.type);
    if (eventFilters.source) params.set("source", eventFilters.source);
    if (eventFilters.status) params.set("status", eventFilters.status);
    if (eventFilters.teamId) params.set("teamId", eventFilters.teamId);
    if (eventFilters.auditOnly) params.set("typePrefix", "audit.");
    const list = await fetchAllEvents(params);
    data.setEvents(list);
  }, [eventFilters, data.setEvents, fetchAllEvents]);

  const handleEmitEvent = useCallback(
    async (rawJson: string) => {
      const parsed = JSON.parse(rawJson);
      await apiFetch("/api/events", {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify(parsed)
      });
      await handleApplyEventFilters();
    },
    [handleApplyEventFilters]
  );

  const handleClearEvents = useCallback(async () => {
    await apiFetch("/api/events", {
      method: "DELETE",
      headers: getApiHeaders()
    });
    data.setEvents([]);
  }, [data.setEvents]);

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-400">
        Loading...
      </div>
    );
  }

  if (!authenticated) {
    return <LoginForm onSuccess={refreshAuth} />;
  }

  return (
    <AppLayout
      activeScreen={activeScreen}
      onScreenChange={setActiveScreen}
      onScreenFocus={onScreenFocus}
      username={username}
      onOpenProfile={() => setActiveScreen("profile")}
      onLogout={logout}
    >
      {activeScreen === "dashboard" && (
        <DashboardScreen
          agents={data.agents}
          events={data.events}
          skills={data.skills}
        />
      )}

      {activeScreen === "agents" && (
        <AgentsScreen
          agents={data.agents}
          skills={data.skills}
          onCreateAgent={async (agent) => {
            await data.apiFetch("/api/agents", {
              method: "POST",
              headers: data.getApiHeaders(),
              body: JSON.stringify(agent)
            });
            data.refreshDashboard();
          }}
          onUpdateAgent={async (name, agent) => {
            await data.apiFetch(`/api/agents/${name}`, {
              method: "PATCH",
              headers: data.getApiHeaders(),
              body: JSON.stringify(agent)
            });
            data.refreshDashboard();
          }}
          onStartAgent={(name) =>
            data.apiFetch(`/api/agents/${name}/start`, { method: "POST" })
          }
          onStopAgent={(name) =>
            data.apiFetch(`/api/agents/${name}/stop`, { method: "POST" })
          }
          onCleanupAgentWorkspace={async (name) => {
            await data.apiFetch(`/api/agents/${name}/cleanup-workspace`, { method: "POST" });
          }}
        />
      )}

      {activeScreen === "teams" && (
        <TeamsScreen
          teams={data.teams}
          agents={data.agents}
          onCreateTeam={async (team) => {
            const res = await data.apiFetch("/api/teams", {
              method: "POST",
              headers: data.getApiHeaders(),
              body: JSON.stringify(team)
            });
            const body = (await res.json()) as { id: string };
            await data.refreshTeams();
            return body.id;
          }}
          onRenameTeam={async (teamId, name) => {
            await data.apiFetch(`/api/teams/${teamId}`, {
              method: "PATCH",
              headers: data.getApiHeaders(),
              body: JSON.stringify({ name })
            });
            await data.refreshTeams();
          }}
          onDeleteTeam={async (teamId) => {
            await data.apiFetch(`/api/teams/${teamId}/delete`, {
              method: "POST"
            });
            await data.refreshTeams();
          }}
          onLoadMembers={(teamId) =>
            data.apiJson<TeamMember[]>(`/api/teams/${teamId}/members`)
          }
          onAddMember={async (teamId, memberType, memberId) => {
            await data.apiFetch(`/api/teams/${teamId}/members`, {
              method: "POST",
              headers: data.getApiHeaders(),
              body: JSON.stringify({ memberType, memberId })
            });
          }}
        />
      )}

      {activeScreen === "channels" && (
        <ChannelsScreen
          agents={data.agents}
          channels={data.channels}
          channelEvents={data.channelEvents}
          channelParticipants={data.channelParticipants}
          activeChannelId={activeChannelId}
          onSelectChannel={setActiveChannelId}
          loadChannelEvents={data.loadChannelEvents}
          loadChannelParticipants={data.loadChannelParticipants}
          onCreateChannel={async (channel) => {
            await data.apiFetch("/api/channels", {
              method: "POST",
              headers: data.getApiHeaders(),
              body: JSON.stringify(channel)
            });
            await data.refreshChannels();
          }}
          onDeleteChannel={async (channelId) => {
            await data.apiFetch(`/api/channels/${channelId}`, {
              method: "DELETE"
            });
            if (activeChannelId === channelId) {
              setActiveChannelId(null);
            }
            data.setChannels((prev) => prev.filter((channel) => channel.id !== channelId));
            await data.refreshChannels();
          }}
          onSubscribe={async (channelId, agentName) => {
            await data.apiFetch(`/api/channels/${channelId}/subscribe`, {
              method: "POST",
              headers: data.getApiHeaders(),
              body: JSON.stringify({ subscriberType: "AGENT", subscriberId: agentName })
            });
          }}
          onUnsubscribe={async (channelId, agentName) => {
            await data.apiFetch(`/api/channels/${channelId}/unsubscribe`, {
              method: "POST",
              headers: data.getApiHeaders(),
              body: JSON.stringify({ subscriberType: "AGENT", subscriberId: agentName })
            });
          }}
        />
      )}

      {activeScreen === "chat" && (
        <ChatScreen
          targetOptions={[
            ...data.agents
              .filter((agent) => agent.runtimeState === "RUNNING")
              .map((agent) => ({
                id: `agent:${agent.name}`,
                label: `DM Agent: ${agent.name}`,
                meta: "Creates/uses a direct channel"
              })),
            ...data.channels.map((channel) => ({
              id: `channel:${channel.id}`,
              label: `Channel: ${channel.name}`,
              meta:
                channel.kind?.includes("DM") || channel.kind === "DIRECT_GROUP"
                  ? (channel.participants ?? [])
                      .map((participant) => `${participant.subscriberType}:${participant.subscriberId}`)
                      .join(" | ")
                  : channel.description ?? undefined
            }))
          ]}
          events={chatEvents}
          activeTargetId={
            activeChatTarget ? `${activeChatTarget.kind}:${activeChatTarget.id}` : null
          }
          messageText={messageText}
          onSelectTarget={handleSelectChatTarget}
          onMessageTextChange={setMessageText}
          onSendMessage={handleSendMessage}
        />
      )}

      {activeScreen === "events" && (
        <EventsScreen
          events={data.events}
          channels={data.channels}
          eventTypes={data.eventTypes}
          filters={eventFilters}
          onFiltersChange={setEventFilters}
          onApplyFilters={handleApplyEventFilters}
          onClearEvents={handleClearEvents}
          onEmitEvent={handleEmitEvent}
          onRefreshEventTypes={data.refreshEventTypes}
        />
      )}

      {activeScreen === "processes" && (
        <ProcessesScreen
          processes={data.processes}
          processOutput={data.processOutput}
          activeProcessId={activeProcessId}
          onSelectProcess={async (id) => {
            setActiveProcessId(id);
            data.loadProcessOutput(id);
          }}
          onRefresh={data.refreshProcesses}
        />
      )}

      {activeScreen === "skills" && <SkillsScreen skills={data.skills} />}

      {activeScreen === "secrets" && (
        <SecretsScreen
          secrets={data.secrets}
          onAddSecret={async (secret) => {
            await data.apiFetch("/api/secrets", {
              method: "POST",
              headers: data.getApiHeaders(),
              body: JSON.stringify({
                name: secret.name,
                scopeType: secret.scopeType,
                scopeId: secret.scopeId,
                value: secret.value
              })
            });
            await data.refreshSecrets();
          }}
          onDeleteSecret={async (id) => {
            await data.apiFetch(`/api/secrets/${id}`, { method: "DELETE" });
            await data.refreshSecrets();
          }}
        />
      )}
      {activeScreen === "profile" && <ProfileScreen username={username} />}
    </AppLayout>
  );
}
