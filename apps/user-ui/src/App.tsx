import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, apiJson, getApiHeaders } from "./api";
import type { Agent, AuthMe, Channel, ChannelParticipant, EventRow } from "./types";

function formatTime(value?: number) {
  if (!value) return "";
  const date = new Date(value);
  const today = new Date();
  const isToday =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  return new Intl.DateTimeFormat(undefined, {
    ...(isToday
      ? {}
      : {
          day: "numeric",
          month: "short",
          ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" })
        }),
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function messageText(event: EventRow) {
  const payload = event.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  if (event.type === "agent.turn.failed") {
    const error = (payload as { error?: unknown }).error;
    return typeof error === "string" ? `Agent error: ${error}` : "Agent failed to respond.";
  }
  const text = (payload as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

function sourceLabel(source: string) {
  if (source.startsWith("human:")) return source.slice("human:".length) || "Human";
  if (source.startsWith("agent:")) return source.slice("agent:".length) || "Agent";
  return source || "System";
}

function messageRole(source: string) {
  if (source.startsWith("human:")) return "human";
  if (source.startsWith("agent:")) return "agent";
  return "system";
}

const DIRECT_CHANNEL_KINDS = new Set(["HUMAN_AGENT_DM", "AGENT_AGENT_DM", "DIRECT_GROUP"]);
const CHANNEL_GROUPS = [
  { id: "direct", label: "Direct messages" },
  { id: "channels", label: "Channels" },
  { id: "lifecycle", label: "Lifecycle" }
] as const;

type ChannelGroupId = (typeof CHANNEL_GROUPS)[number]["id"];

function normalizedSubscriberType(participant: ChannelParticipant) {
  return participant.subscriberType.trim().toUpperCase();
}

function isDirectChannel(channel?: Channel | null) {
  return Boolean(channel?.kind && DIRECT_CHANNEL_KINDS.has(channel.kind.toUpperCase()));
}

function isLifecycleChannel(channel: Channel) {
  return channel.name.toLowerCase().startsWith("agent.lifecycle.");
}

function lifecycleAgentName(channel: Channel) {
  return channel.name.slice("agent.lifecycle.".length) || channel.name;
}

function channelGroupId(channel: Channel): ChannelGroupId {
  if (isLifecycleChannel(channel)) return "lifecycle";
  if (isDirectChannel(channel)) return "direct";
  return "channels";
}

function participantDisplayName(participant: ChannelParticipant, currentUsername?: string) {
  if (
    normalizedSubscriberType(participant) === "HUMAN" &&
    currentUsername &&
    participant.subscriberId === currentUsername
  ) {
    return "you";
  }
  return participant.subscriberId || participant.subscriberType || "participant";
}

function channelDisplayName(channel?: Channel | null, currentUsername?: string) {
  if (!channel) return "Select a channel";
  if (isLifecycleChannel(channel)) return lifecycleAgentName(channel);
  if (!isDirectChannel(channel)) return channel.name;

  const participants = channel.participants ?? [];
  const visibleParticipants = participants.filter(
    (participant) =>
      normalizedSubscriberType(participant) !== "HUMAN" || participant.subscriberId !== currentUsername
  );
  const names = (visibleParticipants.length > 0 ? visibleParticipants : participants).map((participant) =>
    participantDisplayName(participant, currentUsername)
  );

  if (channel.kind?.toUpperCase() === "HUMAN_AGENT_DM" && names[0]) return names[0];
  if (names.length > 0) return `Direct: ${names.join(", ")}`;
  return channel.name;
}

function channelLabel(channel?: Channel | null, currentUsername?: string) {
  if (!channel) return "Select a channel";
  return isDirectChannel(channel) || isLifecycleChannel(channel)
    ? channelDisplayName(channel, currentUsername)
    : `# ${channel.name}`;
}

function participantName(participant: ChannelParticipant) {
  return participant.subscriberId || participant.subscriberType || "Participant";
}

function participantType(participant: ChannelParticipant) {
  const type = normalizedSubscriberType(participant);
  if (type === "HUMAN") return "Human";
  if (type === "AGENT") return "Agent";
  return participant.subscriberType || "Participant";
}

function participantAgentStatus(participant: ChannelParticipant, agents: Agent[]) {
  if (normalizedSubscriberType(participant) !== "AGENT") return null;
  const agent = agents.find((candidate) => candidate.name === participant.subscriberId);
  return agent?.runtimeState === "RUNNING" ? "running" : "off";
}

function channelMatchesQuery(channel: Channel, query: string, currentUsername: string) {
  const displayName = channelDisplayName(channel, currentUsername).toLowerCase();
  return channel.name.toLowerCase().includes(query) || displayName.includes(query);
}

function canManageUserChannel(channel: Channel | null, userId: string | null) {
  if (!channel || isDirectChannel(channel) || isLifecycleChannel(channel)) return false;
  if (channel.visibility === "PRIVATE") return Boolean(userId && channel.ownerHumanId === userId);
  return true;
}

function readLinkedChannelId() {
  return new URL(window.location.href).searchParams.get("channel");
}

function updateChannelDeepLink(channelId: string | null, replace = false) {
  const url = new URL(window.location.href);
  if (channelId) {
    url.searchParams.set("channel", channelId);
  } else {
    url.searchParams.delete("channel");
  }
  const method = replace ? "replaceState" : "pushState";
  window.history[method](null, "", url);
}

function adaptiveMessageBatchSize() {
  const connection = (
    navigator as Navigator & {
      connection?: { downlink?: number; effectiveType?: string; saveData?: boolean };
    }
  ).connection;
  if (connection?.saveData) return 12;
  const effectiveType = connection?.effectiveType ?? "";
  if (effectiveType.includes("2g")) return 10;
  if (effectiveType.includes("3g")) return 20;
  if (typeof connection?.downlink === "number") {
    if (connection.downlink >= 10) return 50;
    if (connection.downlink >= 5) return 40;
  }
  return 30;
}

function mergeEventsChronologically(current: EventRow[], incoming: EventRow[]) {
  const byId = new Map<string, EventRow>();
  for (const event of current) byId.set(event.id, event);
  for (const event of incoming) byId.set(event.id, event);
  return [...byId.values()].sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0));
}

export default function App() {
  const messagesPanelRef = useRef<HTMLElement | null>(null);
  const activeChannelIdRef = useRef<string | null>(null);
  const lastSeenByChannelRef = useRef<Record<string, number>>({});
  const lastLoadedMessageAtByChannelRef = useRef<Record<string, number>>({});
  const messageFetchSeqRef = useRef(0);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [collapsedChannelGroups, setCollapsedChannelGroups] = useState<Record<ChannelGroupId, boolean>>({
    channels: false,
    direct: false,
    lifecycle: true
  });
  const [hasNewMessagesBelow, setHasNewMessagesBelow] = useState(false);
  const [channelQuery, setChannelQuery] = useState("");
  const [conversationName, setConversationName] = useState("");
  const [conversationDescription, setConversationDescription] = useState("");
  const [conversationVisibility, setConversationVisibility] = useState<"PUBLIC" | "PRIVATE">("PRIVATE");
  const [selectedConversationAgents, setSelectedConversationAgents] = useState<string[]>([]);
  const [agentSearchQuery, setAgentSearchQuery] = useState("");
  const [showArchivedChannels, setShowArchivedChannels] = useState(false);
  const [showConversationDialog, setShowConversationDialog] = useState(false);
  const [draft, setDraft] = useState("");
  const [username, setUsername] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [loginUsername, setLoginUsername] = useState("admin");
  const [loginPassword, setLoginPassword] = useState("");
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeChannel = useMemo(
    () => channels.find((channel) => channel.id === activeChannelId) ?? null,
    [activeChannelId, channels]
  );

  const visibleMessages = useMemo(
    () => events.filter((event) => event.type === "message.created" || event.type === "agent.turn.failed"),
    [events]
  );

  const activeChannels = useMemo(
    () => channels.filter((channel) => !channel.archivedAt),
    [channels]
  );

  const archivedChannels = useMemo(
    () => channels.filter((channel) => channel.archivedAt),
    [channels]
  );

  const filteredChannels = useMemo(() => {
    const query = channelQuery.trim().toLowerCase();
    if (!query) return activeChannels;
    return activeChannels.filter((channel) => channelMatchesQuery(channel, query, username));
  }, [activeChannels, channelQuery, username]);

  const filteredArchivedChannels = useMemo(() => {
    const query = channelQuery.trim().toLowerCase();
    if (!query) return archivedChannels;
    return archivedChannels.filter((channel) => channelMatchesQuery(channel, query, username));
  }, [archivedChannels, channelQuery, username]);

  const groupedChannels = useMemo(
    () =>
      CHANNEL_GROUPS.map((group) => ({
        ...group,
        channels: filteredChannels.filter((channel) => channelGroupId(channel) === group.id)
      })).filter((group) => group.channels.length > 0),
    [filteredChannels]
  );

  const isSearchingChannels = Boolean(channelQuery.trim());
  const activeChannelManageable = canManageUserChannel(activeChannel, userId);
  const canStartConversation =
    Boolean(conversationName.trim()) || selectedConversationAgents.length === 1;
  const selectedConversationAgentRecords = useMemo(
    () =>
      selectedConversationAgents.map((agentName) => agents.find((agent) => agent.name === agentName) ?? { name: agentName }),
    [agents, selectedConversationAgents]
  );
  const agentSuggestions = useMemo(() => {
    const query = agentSearchQuery.trim().toLowerCase();
    return agents
      .filter((agent) => !selectedConversationAgents.includes(agent.name))
      .filter((agent) => !query || agent.name.toLowerCase().includes(query))
      .slice(0, 8);
  }, [agentSearchQuery, agents, selectedConversationAgents]);

  function selectChannel(channelId: string | null, options?: { replace?: boolean }) {
    setActiveChannelId(channelId);
    updateChannelDeepLink(channelId, options?.replace);
  }

  async function loadSession() {
    setAuthLoading(true);
    setError(null);
    try {
      const me = await apiJson<AuthMe>("/api/auth/me");
      const nextUsername = me.username ?? "";
      setUsername(nextUsername);
      setUserId(me.id ?? null);
      setLoginUsername(nextUsername || "admin");
      setAuthenticated(Boolean(nextUsername));
      setMustChangePassword(Boolean(me.mustChangePassword));
    } catch {
      setAuthenticated(false);
      setUsername("");
      setUserId(null);
      setMustChangePassword(false);
    } finally {
      setAuthLoading(false);
    }
  }

  async function loadShell() {
    if (!authenticated) return;
    setError(null);
    setLoading(true);
    try {
      const [nextChannels, nextAgents] = await Promise.all([
        apiJson<Channel[]>("/api/channels?includeArchived=1"),
        apiJson<Agent[]>("/api/agents")
      ]);
      setChannels(nextChannels);
      setAgents(nextAgents);
      setSelectedConversationAgents((current) =>
        current.filter((agentName) => nextAgents.some((agent) => agent.name === agentName))
      );
      const linkedChannelId = readLinkedChannelId();
      const linkedChannel = nextChannels.find((channel) => channel.id === linkedChannelId);
      const nextActiveChannelId =
        linkedChannel?.id ??
        (activeChannelId && nextChannels.some((channel) => channel.id === activeChannelId && !channel.archivedAt)
          ? activeChannelId
          : nextChannels.find((channel) => !channel.archivedAt)?.id ?? null);
      if (linkedChannel?.archivedAt) setShowArchivedChannels(true);
      selectChannel(nextActiveChannelId, { replace: true });
      await loadMessageNotifications({ initialize: true });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load OrgOps");
    } finally {
      setLoading(false);
    }
  }

  function scrollMessagesToBottom(behavior: ScrollBehavior = "smooth") {
    window.requestAnimationFrame(() => {
      const panel = messagesPanelRef.current;
      if (!panel) return;
      panel.scrollTo({ top: panel.scrollHeight, behavior });
    });
  }

  function isMessagesPanelNearBottom() {
    const panel = messagesPanelRef.current;
    if (!panel) return true;
    return panel.scrollHeight - panel.scrollTop - panel.clientHeight < 80;
  }

  function newestMessageTime(channelEvents: EventRow[]) {
    return channelEvents.reduce((newest, event) => {
      if (event.type !== "message.created" && event.type !== "agent.turn.failed") return newest;
      return Math.max(newest, event.createdAt ?? 0);
    }, 0);
  }

  function markChannelSeen(channelId: string, channelEvents: EventRow[]) {
    const newestMessageAt = newestMessageTime(channelEvents);
    if (newestMessageAt > 0) {
      lastSeenByChannelRef.current[channelId] = Math.max(
        lastSeenByChannelRef.current[channelId] ?? 0,
        newestMessageAt
      );
    }
    setUnreadCounts((current) => {
      if (!current[channelId]) return current;
      const next = { ...current };
      delete next[channelId];
      return next;
    });
  }

  async function loadMessages(
    channelId: string,
    options?: { scrollToBottom?: boolean; showLoading?: boolean; scrollBehavior?: ScrollBehavior }
  ) {
    const fetchSeq = messageFetchSeqRef.current + 1;
    messageFetchSeqRef.current = fetchSeq;
    const limit = adaptiveMessageBatchSize();
    if (options?.showLoading) setMessagesLoading(true);
    try {
      const [messageEvents, failureEvents] = await Promise.all([
        apiJson<EventRow[]>(
          `/api/events?channelId=${encodeURIComponent(channelId)}&type=message.created&limit=${limit}&order=desc`
        ),
        apiJson<EventRow[]>(
          `/api/events?channelId=${encodeURIComponent(channelId)}&type=agent.turn.failed&limit=${limit}&order=desc`
        )
      ]);
      if (fetchSeq !== messageFetchSeqRef.current || channelId !== activeChannelIdRef.current) {
        return;
      }
      const nextEvents = mergeEventsChronologically(messageEvents, failureEvents).reverse();
      const chronologicalEvents = [...nextEvents].reverse();
      const previousNewestMessageAt = lastLoadedMessageAtByChannelRef.current[channelId] ?? 0;
      const nextNewestMessageAt = newestMessageTime(nextEvents);
      const hasNewMessages = previousNewestMessageAt > 0 && nextNewestMessageAt > previousNewestMessageAt;

      setEvents((current) =>
        options?.showLoading ? chronologicalEvents : mergeEventsChronologically(current, chronologicalEvents)
      );
      if (options?.showLoading) {
        setHasOlderMessages(messageEvents.length === limit);
      }
      markChannelSeen(channelId, nextEvents);
      lastLoadedMessageAtByChannelRef.current[channelId] = Math.max(
        previousNewestMessageAt,
        nextNewestMessageAt
      );
      if (options?.scrollToBottom) {
        setHasNewMessagesBelow(false);
        scrollMessagesToBottom(options.scrollBehavior);
      }
      if (!options?.scrollToBottom && hasNewMessages && channelId === activeChannelIdRef.current) {
        if (isMessagesPanelNearBottom()) {
          setHasNewMessagesBelow(false);
          scrollMessagesToBottom();
        } else {
          setHasNewMessagesBelow(true);
        }
      }
    } catch (loadError) {
      if (fetchSeq === messageFetchSeqRef.current) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load messages");
      }
    } finally {
      if (options?.showLoading && fetchSeq === messageFetchSeqRef.current) {
        setMessagesLoading(false);
      }
    }
  }

  async function handleLoadOlderMessages() {
    if (!activeChannelId || events.length === 0 || loadingOlderMessages) return;
    const oldestEventAt = events[0]?.createdAt;
    if (!oldestEventAt) return;
    const channelId = activeChannelId;
    const limit = adaptiveMessageBatchSize();
    const panel = messagesPanelRef.current;
    const previousScrollHeight = panel?.scrollHeight ?? 0;

    setLoadingOlderMessages(true);
    setError(null);
    try {
      const olderEvents = await apiJson<EventRow[]>(
        `/api/events?channelId=${encodeURIComponent(channelId)}&type=message.created&limit=${limit}&order=desc&before=${oldestEventAt}`
      );
      if (channelId !== activeChannelIdRef.current) return;
      const chronologicalOlderEvents = [...olderEvents].reverse();
      setEvents((current) => {
        const existingIds = new Set(current.map((event) => event.id));
        return [
          ...chronologicalOlderEvents.filter((event) => !existingIds.has(event.id)),
          ...current
        ];
      });
      setHasOlderMessages(olderEvents.length === limit);
      window.requestAnimationFrame(() => {
        const currentPanel = messagesPanelRef.current;
        if (!currentPanel) return;
        currentPanel.scrollTop += currentPanel.scrollHeight - previousScrollHeight;
      });
    } catch (olderError) {
      setError(olderError instanceof Error ? olderError.message : "Unable to load previous messages");
    } finally {
      setLoadingOlderMessages(false);
    }
  }

  async function loadMessageNotifications(options?: { initialize?: boolean }) {
    if (!authenticated) return;
    try {
      const nextEvents = await apiJson<EventRow[]>(
        "/api/events?type=message.created&limit=100&order=desc"
      );
      if (options?.initialize) {
        const nextSeen = { ...lastSeenByChannelRef.current };
        for (const event of nextEvents) {
          if (!event.channelId) continue;
          nextSeen[event.channelId] = Math.max(nextSeen[event.channelId] ?? 0, event.createdAt ?? 0);
        }
        lastSeenByChannelRef.current = nextSeen;
        setUnreadCounts({});
        return;
      }

      const activeId = activeChannelIdRef.current;
      const nextCounts: Record<string, number> = {};
      for (const event of nextEvents) {
        if (!event.channelId || event.channelId === activeId) continue;
        const channel = channels.find((candidate) => candidate.id === event.channelId);
        if (channel?.archivedAt) continue;
        if ((event.createdAt ?? 0) > (lastSeenByChannelRef.current[event.channelId] ?? 0)) {
          nextCounts[event.channelId] = (nextCounts[event.channelId] ?? 0) + 1;
        }
      }
      setUnreadCounts(nextCounts);
    } catch {
      // Notification polling is best-effort; active channel loading reports visible errors.
    }
  }

  useEffect(() => {
    document.title = "OrgOps User UI";
    void loadSession();
  }, []);

  useEffect(() => {
    if (!authenticated || mustChangePassword) return;
    void loadShell();
  }, [authenticated, mustChangePassword]);

  useEffect(() => {
    messageFetchSeqRef.current += 1;
    activeChannelIdRef.current = activeChannelId;
    setEvents([]);
    setMessagesLoading(Boolean(activeChannelId));
    setLoadingOlderMessages(false);
    setHasOlderMessages(false);
    setHasNewMessagesBelow(false);
  }, [activeChannelId]);

  useEffect(() => {
    if (!authenticated || mustChangePassword) return;
    if (!activeChannelId) {
      setEvents([]);
      return;
    }
    void loadMessages(activeChannelId, {
      scrollBehavior: "auto",
      scrollToBottom: true,
      showLoading: true
    });
    const interval = window.setInterval(() => void loadMessages(activeChannelId), 5000);
    return () => window.clearInterval(interval);
  }, [activeChannelId, authenticated, mustChangePassword]);

  useEffect(() => {
    if (!authenticated || mustChangePassword) return;
    void loadMessageNotifications();
    const interval = window.setInterval(() => void loadMessageNotifications(), 5000);
    return () => window.clearInterval(interval);
  }, [authenticated, mustChangePassword, channels]);

  useEffect(() => {
    if (!authenticated || mustChangePassword) return;
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setShowConversationDialog(true);
      }
      if (event.key === "Escape") {
        setShowConversationDialog(false);
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [authenticated, mustChangePassword]);

  useEffect(() => {
    if (!authenticated || mustChangePassword) return;
    function handlePopState() {
      const linkedChannelId = readLinkedChannelId();
      const linkedChannel = channels.find((channel) => channel.id === linkedChannelId);
      if (linkedChannel?.archivedAt) setShowArchivedChannels(true);
      setActiveChannelId(linkedChannel?.id ?? null);
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [authenticated, channels, mustChangePassword]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setAuthLoading(true);
    try {
      await apiFetch("/api/auth/login", {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({
          username: loginUsername.trim(),
          password: loginPassword
        })
      });
      setLoginPassword("");
      await loadSession();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Unable to sign in");
      setAuthenticated(false);
      setAuthLoading(false);
    }
  }

  async function handleLogout() {
    await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setAuthenticated(false);
    setUsername("");
    setUserId(null);
    setMustChangePassword(false);
    setNewPassword("");
    setConfirmPassword("");
    setChannels([]);
    setAgents([]);
    setEvents([]);
    setActiveChannelId(null);
    updateChannelDeepLink(null, true);
    setChannelQuery("");
    setConversationName("");
    setConversationDescription("");
    setConversationVisibility("PRIVATE");
    setSelectedConversationAgents([]);
    setAgentSearchQuery("");
    setShowArchivedChannels(false);
    setShowConversationDialog(false);
    setUnreadCounts({});
    setHasNewMessagesBelow(false);
    lastSeenByChannelRef.current = {};
    lastLoadedMessageAtByChannelRef.current = {};
  }

  async function handlePasswordUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const nextPassword = newPassword.trim();
    if (nextPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (nextPassword !== confirmPassword.trim()) {
      setError("New password and confirmation do not match.");
      return;
    }

    setAuthLoading(true);
    try {
      await apiFetch("/api/auth/profile", {
        method: "PATCH",
        headers: getApiHeaders(),
        body: JSON.stringify({
          username: username || loginUsername.trim(),
          newPassword: nextPassword
        })
      });
      setNewPassword("");
      setConfirmPassword("");
      await loadSession();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update password");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeChannelId || activeChannel?.archivedAt || !draft.trim()) return;

    setSending(true);
    setError(null);
    try {
      await apiFetch("/api/events", {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({
          type: "message.created",
          payload: { text: draft.trim() },
          source: `human:${username || "user"}`,
          channelId: activeChannelId
        })
      });
      setDraft("");
      await loadMessages(activeChannelId, { scrollToBottom: true });
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Unable to send message");
    } finally {
      setSending(false);
    }
  }

  function addConversationAgent(agentName: string) {
    setSelectedConversationAgents((current) =>
      current.includes(agentName) ? current : [...current, agentName]
    );
    setAgentSearchQuery("");
  }

  function removeConversationAgent(agentName: string) {
    setSelectedConversationAgents((current) => current.filter((name) => name !== agentName));
  }

  async function refreshChannels(nextActiveChannelId?: string | null) {
    const nextChannels = await apiJson<Channel[]>("/api/channels?includeArchived=1");
    setChannels(nextChannels);
    const nextSelectedChannelId =
      nextActiveChannelId !== undefined
        ? nextActiveChannelId
        : activeChannelId && nextChannels.some((channel) => channel.id === activeChannelId && !channel.archivedAt)
          ? activeChannelId
          : nextChannels.find((channel) => !channel.archivedAt)?.id ?? null;
    selectChannel(nextSelectedChannelId, { replace: true });
    return nextChannels;
  }

  async function handleStartConversation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = conversationName.trim();
    const description = conversationDescription.trim();
    const selectedAgents = selectedConversationAgents.filter(Boolean);
    setError(null);

    if (!name && selectedAgents.length !== 1) {
      setError("Choose one agent for a direct message, or add a channel name.");
      return;
    }

    setLoading(true);
    try {
      if (!name) {
        const direct = await apiJson<{ id: string }>("/api/channels/direct/human-agent", {
          method: "POST",
          headers: getApiHeaders(),
          body: JSON.stringify({ agentName: selectedAgents[0] })
        });
        setCollapsedChannelGroups((current) => ({ ...current, direct: false }));
        await refreshChannels(direct.id);
      } else {
        const created = await apiJson<{ id: string }>("/api/channels", {
          method: "POST",
          headers: getApiHeaders(),
          body: JSON.stringify({
            name,
            description: description || undefined,
            visibility: conversationVisibility
          })
        });
        await Promise.all([
          username
            ? apiFetch(`/api/channels/${encodeURIComponent(created.id)}/subscribe`, {
                method: "POST",
                headers: getApiHeaders(),
                body: JSON.stringify({ subscriberType: "HUMAN", subscriberId: username })
              }).catch(() => undefined)
            : Promise.resolve(),
          ...selectedAgents.map((agentName) =>
            apiFetch(`/api/channels/${encodeURIComponent(created.id)}/subscribe`, {
              method: "POST",
              headers: getApiHeaders(),
              body: JSON.stringify({ subscriberType: "AGENT", subscriberId: agentName })
            })
          )
        ]);
        setCollapsedChannelGroups((current) => ({ ...current, channels: false }));
        await refreshChannels(created.id);
      }
      setConversationName("");
      setConversationDescription("");
      setSelectedConversationAgents([]);
      setConversationVisibility("PRIVATE");
      setAgentSearchQuery("");
      setChannelQuery("");
      setShowConversationDialog(false);
    } catch (conversationError) {
      setError(
        conversationError instanceof Error
          ? conversationError.message
          : "Unable to start conversation"
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleArchiveChannel(channel: Channel) {
    if (!window.confirm(`Archive ${channelLabel(channel, username)}?`)) return;
    setError(null);
    setLoading(true);
    try {
      await apiFetch(`/api/channels/${encodeURIComponent(channel.id)}/archive`, { method: "POST" });
      setShowArchivedChannels(true);
      await refreshChannels(activeChannelId === channel.id ? null : undefined);
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Unable to archive channel");
    } finally {
      setLoading(false);
    }
  }

  async function handleUnarchiveChannel(channel: Channel) {
    setError(null);
    setLoading(true);
    try {
      await apiFetch(`/api/channels/${encodeURIComponent(channel.id)}/unarchive`, { method: "POST" });
      setShowArchivedChannels(true);
      await refreshChannels(channel.id);
    } catch (unarchiveError) {
      setError(unarchiveError instanceof Error ? unarchiveError.message : "Unable to restore channel");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteChannel(channel: Channel) {
    if (!window.confirm(`Permanently delete ${channelLabel(channel, username)}?`)) return;
    setError(null);
    setLoading(true);
    try {
      await apiFetch(`/api/channels/${encodeURIComponent(channel.id)}`, { method: "DELETE" });
      await refreshChannels(activeChannelId === channel.id ? null : undefined);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete channel");
    } finally {
      setLoading(false);
    }
  }

  function handleMessagesScroll() {
    if (hasNewMessagesBelow && isMessagesPanelNearBottom()) {
      setHasNewMessagesBelow(false);
    }
  }

  if (authLoading && !authenticated) {
    return <main className="loading-screen">Loading OrgOps...</main>;
  }

  if (!authenticated) {
    return (
      <main className="login-screen">
        <section className="login-copy">
          <div className="brand-mark large">OO</div>
          <p>OrgOps User Workspace</p>
          <h1>Welcome back</h1>
          <span>Sign in to talk to your team and agents.</span>
        </section>

        <form className="login-card" onSubmit={handleLogin}>
          <div>
            <span>Sign in</span>
            <strong>OrgOps</strong>
          </div>
          {error ? <div className="notice error">{error}</div> : null}
          <label>
            Username
            <input
              value={loginUsername}
              onChange={(event) => setLoginUsername(event.target.value)}
              autoComplete="username"
            />
          </label>
          <label>
            Password
            <input
              value={loginPassword}
              onChange={(event) => setLoginPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
            />
          </label>
          <button disabled={!loginUsername.trim() || !loginPassword || authLoading}>
            {authLoading ? "Signing in..." : "Continue"}
          </button>
        </form>
      </main>
    );
  }

  if (mustChangePassword) {
    return (
      <main className="login-screen">
        <section className="login-copy">
          <div className="brand-mark large">OO</div>
          <p>OrgOps User Workspace</p>
          <h1>Set a new password</h1>
          <span>Finish first-time setup before opening your workspace.</span>
        </section>

        <form className="login-card" onSubmit={handlePasswordUpdate}>
          <div>
            <span>First login</span>
            <strong>{username || "OrgOps"}</strong>
          </div>
          <p className="login-hint">
            Your temporary password worked. Choose a new password with at least 8 characters.
          </p>
          {error ? <div className="notice error">{error}</div> : null}
          <label>
            New password
            <input
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              type="password"
              autoComplete="new-password"
            />
          </label>
          <label>
            Confirm new password
            <input
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              type="password"
              autoComplete="new-password"
            />
          </label>
          <button
            disabled={
              newPassword.trim().length < 8 ||
              newPassword.trim() !== confirmPassword.trim() ||
              authLoading
            }
          >
            {authLoading ? "Updating..." : "Update password"}
          </button>
          <button className="secondary-button" type="button" onClick={() => void handleLogout()}>
            Sign out
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">OO</div>
          <div>
            <strong>OrgOps</strong>
            <span>User workspace</span>
          </div>
        </div>

        <section className="sidebar-section">
          <label className="channel-search">
            <span>Search channels</span>
            <input
              value={channelQuery}
              onChange={(event) => setChannelQuery(event.target.value)}
              placeholder="Search channels..."
            />
          </label>
          <div className="channel-list">
            {groupedChannels.map((group) => {
              const isCollapsed = !isSearchingChannels && collapsedChannelGroups[group.id];
              return (
                <section className="channel-group" key={group.id}>
                  <button
                    type="button"
                    className="channel-group-toggle"
                    aria-expanded={!isCollapsed}
                    onClick={() =>
                      setCollapsedChannelGroups((current) => ({
                        ...current,
                        [group.id]: !current[group.id]
                      }))
                    }
                  >
                    <span>{group.label}</span>
                    <em>{group.channels.length}</em>
                    <strong>{isCollapsed ? "+" : "-"}</strong>
                  </button>

                  {!isCollapsed ? (
                    <div className="channel-group-items">
                      {group.channels.map((channel) => (
                        <button
                          key={channel.id}
                          className={channel.id === activeChannelId ? "active" : undefined}
                          onClick={() => selectChannel(channel.id)}
                        >
                          <span>{channelLabel(channel, username)}</span>
                          {unreadCounts[channel.id] ? <em>{unreadCounts[channel.id]}</em> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </section>
              );
            })}
            {filteredArchivedChannels.length > 0 ? (
              <section className="channel-group">
                <button
                  type="button"
                  className="channel-group-toggle"
                  aria-expanded={isSearchingChannels || showArchivedChannels}
                  onClick={() => setShowArchivedChannels((current) => !current)}
                >
                  <span>Archived</span>
                  <em>{filteredArchivedChannels.length}</em>
                  <strong>{isSearchingChannels || showArchivedChannels ? "-" : "+"}</strong>
                </button>

                {isSearchingChannels || showArchivedChannels ? (
                  <div className="channel-group-items archived-channel-items">
                    {filteredArchivedChannels.map((channel) => (
                      <button
                        key={channel.id}
                        className={channel.id === activeChannelId ? "active" : undefined}
                        onClick={() => selectChannel(channel.id)}
                      >
                        <span>{channelLabel(channel, username)}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}
            {!loading &&
            channelQuery.trim() &&
            filteredChannels.length === 0 &&
            filteredArchivedChannels.length === 0 ? (
              <p className="channel-empty">No channels match "{channelQuery.trim()}".</p>
            ) : null}
          </div>
        </section>

        <section className="sidebar-section start-conversation">
          <button className="new-conversation-button" onClick={() => setShowConversationDialog(true)}>
            <span>New conversation</span>
            <kbd>Cmd+K</kbd>
          </button>
        </section>

        <section className="sidebar-section account-actions">
          <button className="logout-button" onClick={() => void handleLogout()}>
            Sign out {username ? `(${username})` : ""}
          </button>
        </section>
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <div>
            <span>Workspace</span>
            <h1>{channelLabel(activeChannel, username)}</h1>
            <p>
              {activeChannel?.archivedAt
                ? "Archived channel"
                : activeChannel?.description || "Talk to the team and agents in plain language."}
            </p>
          </div>
          {activeChannel && activeChannelManageable ? (
            <div className="channel-actions">
              {activeChannel?.archivedAt ? (
                <>
                  <button onClick={() => void handleUnarchiveChannel(activeChannel)}>Restore</button>
                  <button
                    className="danger"
                    onClick={() => void handleDeleteChannel(activeChannel)}
                  >
                    Delete
                  </button>
                </>
              ) : (
                <button onClick={() => void handleArchiveChannel(activeChannel)}>Archive</button>
              )}
            </div>
          ) : null}
        </header>

        {error ? <div className="notice error">{error}</div> : null}
        {loading ? <div className="notice">Loading OrgOps...</div> : null}

        <section className="messages-panel" ref={messagesPanelRef} onScroll={handleMessagesScroll}>
          {!messagesLoading && hasOlderMessages ? (
            <button
              className="load-older-button"
              disabled={loadingOlderMessages}
              onClick={() => void handleLoadOlderMessages()}
            >
              {loadingOlderMessages ? "Loading previous messages..." : "Load previous messages"}
            </button>
          ) : null}
          {messagesLoading ? (
            <div className="empty-state">
              <strong>Loading messages...</strong>
              <p>Fetching the latest channel activity.</p>
            </div>
          ) : visibleMessages.length === 0 ? (
            <div className="empty-state">
              <strong>No messages yet</strong>
              <p>Send a short update or request to start the conversation.</p>
            </div>
          ) : (
            visibleMessages.map((event) => {
              const role = event.type === "agent.turn.failed" ? "system" : messageRole(event.source);
              return (
                <article className={`message message-${role}`} key={event.id}>
                  <div className="message-meta">
                    <strong>{sourceLabel(event.source)}</strong>
                    <span>{formatTime(event.createdAt)}</span>
                  </div>
                  <p>{messageText(event)}</p>
                </article>
              );
            })
          )}
        </section>

        {hasNewMessagesBelow ? (
          <button
            className="new-messages-button"
            onClick={() => {
              setHasNewMessagesBelow(false);
              scrollMessagesToBottom();
            }}
          >
            New messages below
          </button>
        ) : null}

        <form className="composer" onSubmit={handleSubmit}>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={
              activeChannel?.archivedAt
                ? "Restore this channel to send messages"
                : activeChannel
                  ? `Message ${channelLabel(activeChannel, username)}`
                  : "Select a channel first"
            }
            disabled={!activeChannel || Boolean(activeChannel.archivedAt) || sending}
            rows={3}
          />
          <button disabled={!activeChannel || Boolean(activeChannel.archivedAt) || !draft.trim() || sending}>
            {sending ? "Sending..." : "Send"}
          </button>
        </form>
      </section>

      <aside className="activity-panel">
        <section className="participants-card">
          <h2>Participants</h2>
          <div className="participant-list">
            {activeChannel?.participants?.map((participant, index) => {
              const agentStatus = participantAgentStatus(participant, agents);
              return (
                <article key={`${participant.subscriberType}:${participant.subscriberId}:${index}`}>
                  <div className="participant-avatar">{participantName(participant).slice(0, 2)}</div>
                  <div>
                    <strong>
                      {agentStatus ? (
                        <i
                          className={`agent-status-dot agent-status-${agentStatus}`}
                          title={agentStatus === "running" ? "Agent running" : "Agent off"}
                        />
                      ) : null}
                      {participantName(participant)}
                    </strong>
                    <span>{participantType(participant)}</span>
                  </div>
                </article>
              );
            })}
            {!activeChannel?.participants?.length ? (
              <p>No participants listed for this channel.</p>
            ) : null}
          </div>
        </section>

        <section>
          <h2>Recent Activity</h2>
          <div className="activity-list">
            {events.slice(-6).reverse().map((event) => (
              <article key={event.id}>
                <strong>{sourceLabel(event.source)}</strong>
                <span>{event.type.replaceAll(".", " ")}</span>
              </article>
            ))}
            {events.length === 0 ? <p>No recent activity in this channel.</p> : null}
          </div>
        </section>
      </aside>

      {showConversationDialog ? (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => setShowConversationDialog(false)}>
          <section
            aria-modal="true"
            className="conversation-dialog"
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>Start conversation</span>
                <h2>New conversation</h2>
              </div>
              <button
                aria-label="Close dialog"
                className="dialog-close"
                onClick={() => setShowConversationDialog(false)}
              >
                Close
              </button>
            </header>
            <form className="conversation-form" onSubmit={handleStartConversation}>
              <label>
                <span>Channel name</span>
                <input
                  autoFocus
                  value={conversationName}
                  onChange={(event) => setConversationName(event.target.value)}
                  placeholder="Leave blank for a DM"
                />
              </label>
              <label>
                <span>Description</span>
                <input
                  value={conversationDescription}
                  onChange={(event) => setConversationDescription(event.target.value)}
                  placeholder="Optional"
                />
              </label>
              <label>
                <span>Visibility</span>
                <select
                  value={conversationVisibility}
                  onChange={(event) =>
                    setConversationVisibility(event.target.value === "PUBLIC" ? "PUBLIC" : "PRIVATE")
                  }
                >
                  <option value="PRIVATE">Private</option>
                  <option value="PUBLIC">Public</option>
                </select>
              </label>
              <div className="agent-combobox">
                <span>Agents</span>
                {selectedConversationAgentRecords.length > 0 ? (
                  <div className="selected-agent-chips">
                    {selectedConversationAgentRecords.map((agent) => (
                      <button
                        key={agent.name}
                        onClick={() => removeConversationAgent(agent.name)}
                        type="button"
                      >
                        {agent.name}
                        <span>Remove</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="agent-picker-hint">Select one agent for a DM, or many for a channel.</p>
                )}
                <label className="agent-search-field">
                  <span>Search agents</span>
                  <input
                    value={agentSearchQuery}
                    onChange={(event) => setAgentSearchQuery(event.target.value)}
                    placeholder="Type an agent name..."
                  />
                </label>
                {agents.length === 0 ? (
                  <p className="sidebar-note">No available agents.</p>
                ) : agentSuggestions.length > 0 ? (
                  <div className="agent-suggestions">
                    {agentSuggestions.map((agent) => (
                      <button
                        key={agent.name}
                        onClick={() => addConversationAgent(agent.name)}
                        type="button"
                      >
                        <span>{agent.name}</span>
                        <em>{agent.runtimeState === "RUNNING" ? "Running" : "Off"}</em>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="agent-picker-hint">No matching agents.</p>
                )}
              </div>
              <button disabled={loading || !canStartConversation}>Start</button>
            </form>
          </section>
        </div>
      ) : null}
    </main>
  );
}
