import { useCallback, useEffect, useState } from "react";
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
  HumansScreen,
  ProfileScreen
} from "./screens";
import { useAuth, useOrgOpsData, useWebSocket } from "./hooks";
import type {
  AgentWorkspaceFileResponse,
  AgentWorkspaceListResponse,
  EventRow,
  ProcessOutputRow,
  TeamMember
} from "./types";

type ChatTarget = { kind: "channel"; id: string };

function formatParticipantLabel(subscriberType: string, subscriberId: string) {
  if (subscriberType === "HUMAN") return `${subscriberId} (human)`;
  if (subscriberType === "AGENT") return `${subscriberId} (agent)`;
  return `${subscriberId} (${subscriberType.toLowerCase()})`;
}

function isDirectMessageChannel(channel: { kind?: string; directParticipantKey?: string }) {
  if (channel.directParticipantKey) return true;
  return (
    channel.kind === "HUMAN_AGENT_DM" ||
    channel.kind === "AGENT_AGENT_DM" ||
    channel.kind === "DIRECT_GROUP"
  );
}

function isSlackBridgeChannel(channel: { kind?: string }) {
  return channel.kind === "INTEGRATION_BRIDGE";
}

function isAgentLifecycleChannel(channel: { name?: string }) {
  return (channel.name ?? "").startsWith("agent.lifecycle.");
}

const DEFAULT_EVENT_FILTERS = {
  agentName: "",
  channelId: "",
  type: "",
  source: "",
  status: "",
  auditOnly: false,
  scheduledOnly: false,
};

export default function App() {
  const [activeScreen, setActiveScreen] = useState<Screen>("dashboard");
  const [activeProcessId, setActiveProcessId] = useState<string | null>(null);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [activeChatTarget, setActiveChatTarget] = useState<ChatTarget | null>(null);
  const [activeChatSelectionId, setActiveChatSelectionId] = useState<string | null>(null);
  const [chatEvents, setChatEvents] = useState<EventRow[]>([]);
  const [messageText, setMessageText] = useState("");
  const [eventFilters, setEventFilters] = useState(DEFAULT_EVENT_FILTERS);

  const { authChecked, authenticated, username, mustChangePassword, refreshAuth, logout } = useAuth();
  const data = useOrgOpsData(authenticated && !mustChangePassword);

  useEffect(() => {
    if (mustChangePassword) {
      setActiveScreen("profile");
    }
  }, [mustChangePassword]);

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
    (processId: string, msgData: ProcessOutputRow[]) => {
      const incoming = Array.isArray(msgData) ? msgData : [msgData];
      data.setProcessOutput((prev) => ({
        ...prev,
        [processId]: (() => {
          const base = prev[processId] ?? [];
          const baseSeq = base[base.length - 1]?.seq ?? 0;
          const normalized = incoming.map((entry, index) => ({
            ...entry,
            seq:
              typeof entry.seq === "number" && Number.isFinite(entry.seq)
                ? entry.seq
                : baseSeq + index + 1,
            stream: entry.stream ?? "STDOUT",
            text: typeof entry.text === "string" ? entry.text : String(entry.text ?? "")
          }));
          return [...base, ...normalized]
            .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
            .filter((entry, index, list) => {
              if (index === 0) return true;
              return entry.seq !== list[index - 1]?.seq;
            })
            .slice(-5000);
        })()
      }));
    },
    [data.setProcessOutput]
  );

  useWebSocket({
    authenticated,
    onAgentStatus: handleAgentStatus,
    onEvent: handleWsEvent,
    onProcessOutput: (processId, d) =>
      handleProcessOutput(processId, [d as ProcessOutputRow]),
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
      if (screen === "dashboard") {
        data.refreshDashboard();
        data.refreshDashboardEvents();
        data.refreshChannels();
        data.refreshProcesses();
        data.refreshSecrets();
        data.refreshTeams();
      }
      if (screen === "channels") data.refreshChannels();
      if (screen === "teams") {
        data.refreshTeams();
        data.refreshHumans();
      }
      if (screen === "chat") {
        data.refreshChannels();
        if (activeChatTarget) {
          loadChatEventsForTarget(activeChatTarget).then(setChatEvents);
        }
      }
      if (screen === "processes") data.refreshProcesses();
      if (screen === "secrets") data.refreshSecrets();
      if (screen === "humans") data.refreshHumans();
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
      setActiveChatSelectionId(value);
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

  const handleClearChatMessages = useCallback(async () => {
    if (!activeChatTarget) return;
    await apiFetch(`/api/channels/${activeChatTarget.id}/messages`, {
      method: "DELETE",
      headers: getApiHeaders()
    });
    const list = await loadChatEventsForTarget(activeChatTarget);
    setChatEvents(list);
  }, [activeChatTarget, loadChatEventsForTarget]);

  const handleApplyEventFilters = useCallback(async () => {
    const params = new URLSearchParams();
    if (eventFilters.agentName) params.set("agentName", eventFilters.agentName);
    if (eventFilters.channelId) params.set("channelId", eventFilters.channelId);
    if (eventFilters.type) params.set("type", eventFilters.type);
    if (eventFilters.source) params.set("source", eventFilters.source);
    if (eventFilters.status) params.set("status", eventFilters.status);
    if (eventFilters.auditOnly) params.set("typePrefix", "audit.");
    if (eventFilters.scheduledOnly) params.set("scheduled", "1");
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
    await data.refreshEvents();
  }, [data.refreshEvents]);

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
          eventStats={data.dashboardEventStats}
          skills={data.skills}
          channels={data.channels}
          processes={data.processes}
          secrets={data.secrets}
          teams={data.teams}
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
          onStartAgent={async (name) => {
            await data.apiFetch(`/api/agents/${name}/start`, { method: "POST" });
          }}
          onStopAgent={async (name) => {
            await data.apiFetch(`/api/agents/${name}/stop`, { method: "POST" });
          }}
          onCleanupAgentWorkspace={async (name) => {
            await data.apiFetch(`/api/agents/${name}/cleanup-workspace`, { method: "POST" });
          }}
          loadAgentEvents={async (name) => {
            const params = new URLSearchParams();
            params.set("agentName", name);
            params.set("limit", "200");
            params.set("order", "desc");
            return data.apiJson<EventRow[]>(`/api/events?${params.toString()}`);
          }}
          loadAgentWorkspace={(name, path) => {
            const params = new URLSearchParams();
            if (path && path !== ".") {
              params.set("path", path);
            }
            const query = params.toString();
            const suffix = query ? `?${query}` : "";
            return data.apiJson<AgentWorkspaceListResponse>(
              `/api/agents/${encodeURIComponent(name)}/workspace${suffix}`
            );
          }}
          loadAgentWorkspaceFile={(name, path) => {
            const params = new URLSearchParams();
            params.set("path", path);
            return data.apiJson<AgentWorkspaceFileResponse>(
              `/api/agents/${encodeURIComponent(name)}/workspace/file?${params.toString()}`
            );
          }}
          onDownloadAgentWorkspaceFile={(name, path) => {
            const params = new URLSearchParams();
            params.set("path", path);
            const href = `/api/agents/${encodeURIComponent(
              name
            )}/workspace/download?${params.toString()}`;
            const link = document.createElement("a");
            link.href = href;
            link.rel = "noopener";
            document.body.appendChild(link);
            link.click();
            link.remove();
          }}
        />
      )}

      {activeScreen === "teams" && (
        <TeamsScreen
          teams={data.teams}
          agents={data.agents}
          humans={data.humans}
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
          onRemoveMember={async (teamId, memberType, memberId) => {
            await data.apiFetch(
              `/api/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(memberType)}/${encodeURIComponent(memberId)}`,
              {
                method: "DELETE",
                headers: data.getApiHeaders()
              }
            );
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
              .filter(
                (agent) =>
                  agent.runtimeState === "RUNNING" ||
                  activeChatSelectionId === `agent:${agent.name}`
              )
              .map((agent) => ({
                id: `agent:${agent.name}`,
                label: `DM Agent: ${agent.name}`,
                meta: "Creates/uses a direct channel"
              })),
            ...data.channels
              .filter(
                (channel) =>
                  !isDirectMessageChannel(channel) &&
                  !isSlackBridgeChannel(channel) &&
                  !isAgentLifecycleChannel(channel)
              )
              .map((channel) => ({
                id: `channel:${channel.id}`,
                label: `Channel: ${channel.name}`,
                meta: channel.description ?? undefined,
                participantsText: (channel.participants ?? [])
                  .map((participant) =>
                    formatParticipantLabel(participant.subscriberType, participant.subscriberId)
                  )
                  .join(" | ")
              }))
          ]}
          events={chatEvents}
          activeTargetId={activeChatSelectionId}
          messageText={messageText}
          onSelectTarget={handleSelectChatTarget}
          onMessageTextChange={setMessageText}
          onSendMessage={handleSendMessage}
          onClearMessages={handleClearChatMessages}
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
            if (id) {
              await data.loadProcessOutput(id);
            }
          }}
          onRefresh={data.refreshProcesses}
          onClearAll={async () => {
            await data.apiFetch("/api/processes", {
              method: "DELETE",
              headers: data.getApiHeaders()
            });
            setActiveProcessId(null);
            data.setProcessOutput({});
            data.setProcesses([]);
          }}
          onExitProcess={async (id) => {
            await data.apiFetch(`/api/processes/${id}`, {
              method: "DELETE",
              headers: data.getApiHeaders()
            });
            await data.refreshProcesses();
          }}
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
      {activeScreen === "humans" && (
        <HumansScreen
          humans={data.humans}
          onInviteHuman={async (input) => {
            const res = await data.apiFetch("/api/humans/invite", {
              method: "POST",
              headers: data.getApiHeaders(),
              body: JSON.stringify(input)
            });
            const body = (await res.json()) as {
              id: string;
              username: string;
              temporaryPassword: string;
            };
            await data.refreshHumans();
            return body;
          }}
          onRefresh={async () => {
            await data.refreshHumans();
          }}
        />
      )}
      {activeScreen === "profile" && (
        <ProfileScreen
          username={username}
          mustChangePassword={mustChangePassword}
          onSaveProfile={async (input) => {
            await data.apiFetch("/api/auth/profile", {
              method: "PATCH",
              headers: data.getApiHeaders(),
              body: JSON.stringify(input)
            });
            await refreshAuth();
            try {
              await data.refreshHumans();
            } catch {
              // Human listing can stay stale if the request is still blocked.
            }
          }}
        />
      )}
    </AppLayout>
  );
}
