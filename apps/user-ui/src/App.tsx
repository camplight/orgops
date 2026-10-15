import {
  FormEvent,
  type ChangeEvent,
  type ClipboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { wsUrl } from "./infrastructure/http/config";
import { createBrowserConfirm } from "./infrastructure/browser/browser-confirm";
import { createBrowserClipboard } from "./infrastructure/browser/browser-clipboard";
import { createWebSocketRealtimeFeed } from "./infrastructure/websocket/websocket-realtime-feed";
import type { RealtimeFeed } from "./ports/realtime-feed";
import { usePollingFallback } from "./ui/realtime/use-polling-fallback";
import { createBrowserDeepLink } from "./infrastructure/browser/browser-deep-link";
import { createLogin } from "./application/identity/login";
import { createUpdatePassword } from "./application/identity/update-password";
import { createLogout } from "./application/identity/logout";
import { createLoadSession } from "./application/identity/load-session";
import { useSession } from "./ui/identity/use-session";
import { validateNewPassword } from "./domain/identity/password-rules";
import { createHttpSessionGateway } from "./infrastructure/http/http-session-gateway";
import { createHttpConversationGateway } from "./infrastructure/http/http-conversation-gateway";
import { createHttpFileGateway } from "./infrastructure/http/http-file-gateway";
import { createHttpMessageGateway } from "./infrastructure/http/http-message-gateway";
import { ChangePasswordScreen } from "./ui/auth/change-password-screen";
import { MessageItem } from "./ui/timeline/message-item";
import { TurnFailureItem } from "./ui/timeline/turn-failure-item";
import { TraceGroup } from "./ui/timeline/trace-group";
import { ComposerTextarea } from "./ui/composer/composer-textarea";
import { ComposerActions } from "./ui/composer/composer-actions";
import { ComposerAttachments } from "./ui/composer/composer-attachments";
import { Sidebar } from "./ui/sidebar/sidebar";
import { ActivityPanel } from "./ui/activity/activity-panel";
import { ConversationDialog } from "./ui/dialogs/conversation-dialog";
import { ParticipantsDialog } from "./ui/dialogs/participants-dialog";
import { ChannelManageDialog } from "./ui/dialogs/channel-manage-dialog";
import { LoginScreen } from "./ui/auth/login-screen";
import type {
  Agent,
  Channel,
  ChannelParticipant,
  ChannelShare,
  EventRow,
  Team,
  UploadedAttachment
} from "./types";
import {
  CHANNEL_GROUPS,
  agentVisibleToUserUi,
  canManageUserChannel,
  channelGroupId,
  channelHasHumanParticipant,
  channelLabel,
  channelMatchesQuery,
  channelVisibleToUserUi,
  isHumanAgentDirectChannel,
  isSharedChannelForUser,
  normalizedSubscriberType,
  participantAgentStatus,
  type ChannelGroupId
} from "./domain/conversations/channel-rules";
import { mergeEventsChronologically } from "./domain/messaging/event-ordering";
import { isHiddenUiActionMessage } from "./domain/messaging/event-interpretation";
import { isTraceEvent } from "./domain/messaging/trace-rules";
import { formatTime } from "./domain/messaging/time-format";

type PendingAttachment = {
  localId: string;
  name: string;
  mime: string;
  size: number;
  status: "uploading" | "ready" | "error";
  uploaded?: UploadedAttachment;
  error?: string;
};

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

function createLocalAttachmentId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const messageGateway = createHttpMessageGateway();
const sessionGateway = createHttpSessionGateway();
const loadCurrentSession = createLoadSession({ sessionGateway });
const signIn = createLogin({ sessionGateway });
const signOut = createLogout({ sessionGateway });
const changePassword = createUpdatePassword({ sessionGateway });
const confirmPort = createBrowserConfirm();
const clipboard = createBrowserClipboard();
const deepLink = createBrowserDeepLink();
const fileGateway = createHttpFileGateway();
const conversationGateway = createHttpConversationGateway();

export default function App() {
  const messagesPanelRef = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const activeChannelIdRef = useRef<string | null>(null);
  const lastSeenByChannelRef = useRef<Record<string, number>>({});
  const lastLoadedMessageAtByChannelRef = useRef<Record<string, number>>({});
  const lastLoadedTimelineAtByChannelRef = useRef<Record<string, number>>({});
  const channelsRef = useRef<Channel[]>([]);
  const usernameRef = useRef("");
  const userIdRef = useRef<string | null>(null);
  const viewerTeamIdsRef = useRef<Set<string>>(new Set());
  const seenWsEventIdsRef = useRef<Set<string>>(new Set());
  const realtimeFeedRef = useRef<RealtimeFeed | null>(null);
  const messageFetchSeqRef = useRef(0);
  const loadingChannelIdRef = useRef<string | null>(null);
  const forceScrollToBottomOnLoadRef = useRef(false);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [humans, setHumans] = useState<Array<{ username: string }>>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [collapsedChannelGroups, setCollapsedChannelGroups] = useState<Record<ChannelGroupId, boolean>>({
    channels: false,
    direct: false,
    shared: false
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
  const [showParticipantsDialog, setShowParticipantsDialog] = useState(false);
  const [showChannelManageDialog, setShowChannelManageDialog] = useState(false);
  const [draft, setDraft] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    username,
    userId,
    loginUsername,
    mustChangePassword,
    authenticated,
    authLoading,
    sessionState,
    loadSession,
    loginPassword,
    setLoginPassword,
    handleLogin,
    setUsername,
    setUserId,
    setLoginUsername,
    setMustChangePassword,
    setAuthenticated,
    setAuthLoading
  } = useSession({ loadCurrentSession, signIn, setError });
  const [participantKind, setParticipantKind] = useState<"HUMAN" | "AGENT">("AGENT");
  const [participantValue, setParticipantValue] = useState("");
  const [participantSubmitting, setParticipantSubmitting] = useState(false);
  const [participantRemovingKey, setParticipantRemovingKey] = useState<string | null>(null);
  const [shareKind, setShareKind] = useState<"HUMAN" | "AGENT">("HUMAN");
  const [shareValue, setShareValue] = useState("");
  const [shareSubmitting, setShareSubmitting] = useState(false);
  const [shareRemovingKey, setShareRemovingKey] = useState<string | null>(null);
  const [channelVisibilityDraft, setChannelVisibilityDraft] = useState<"PUBLIC" | "PRIVATE">("PRIVATE");
  const [updatingChannelVisibility, setUpdatingChannelVisibility] = useState(false);
  const [archiveDraft, setArchiveDraft] = useState(false);
  const [expandedTraceEventId, setExpandedTraceEventId] = useState<string | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [shareLinkCopied, setShareLinkCopied] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sensitiveRevealPasswords, setSensitiveRevealPasswords] = useState<Record<string, string>>({});
  const [revealedSensitiveByEvent, setRevealedSensitiveByEvent] = useState<Record<string, string>>({});
  const [revealingSensitiveEventId, setRevealingSensitiveEventId] = useState<string | null>(null);
  const [sensitiveRevealErrors, setSensitiveRevealErrors] = useState<Record<string, string>>({});

  const activeChannel = useMemo(
    () => channels.find((channel) => channel.id === activeChannelId) ?? null,
    [activeChannelId, channels]
  );

  useEffect(() => {
    channelsRef.current = channels;
  }, [channels]);

  useEffect(() => {
    usernameRef.current = username;
  }, [username]);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  const visibleTimelineEvents = useMemo(
    () =>
      events.filter(
        (event) => (event.type === "message.created" && !isHiddenUiActionMessage(event)) || isTraceEvent(event)
      ),
    [events]
  );

  const timelineItems = useMemo(() => {
    const items: Array<
      | { kind: "message"; id: string; event: EventRow }
      | { kind: "trace-group"; id: string; traceEvents: EventRow[]; tone: "agent" | "system" }
    > = [];
    let traceBuffer: EventRow[] = [];
    let groupCounter = 0;

    const flushTraceBuffer = () => {
      if (traceBuffer.length === 0) return;
      const tone: "agent" | "system" = traceBuffer.some(
        (entry) => entry.type === "tool.failed" || entry.type === "wrapper.turn.failed"
      )
        ? "system"
        : "agent";
      items.push({
        kind: "trace-group",
        id: `trace-group-${traceBuffer[0]?.id ?? groupCounter}`,
        traceEvents: traceBuffer,
        tone
      });
      traceBuffer = [];
      groupCounter += 1;
    };

    for (const event of visibleTimelineEvents) {
      if (event.type === "message.created" || event.type === "agent.turn.failed") {
        flushTraceBuffer();
        items.push({ kind: "message", id: event.id, event });
      } else {
        traceBuffer.push(event);
      }
    }
    flushTraceBuffer();
    return items;
  }, [visibleTimelineEvents]);
  const isConversationEmpty = !messagesLoading && timelineItems.length === 0;

  const offlineAgentNames = useMemo(
    () =>
      (activeChannel?.participants ?? [])
        .filter((participant) => participantAgentStatus(participant, agents) === "off")
        .map((participant) => participant.subscriberId),
    [activeChannel, agents]
  );

  const agentIsThinking = useMemo(() => {
    let activeTurns = 0;
    for (const event of events) {
      if (event.type === "agent.turn.started") activeTurns += 1;
      if (event.type === "agent.turn.completed" || event.type === "agent.turn.failed") {
        activeTurns = Math.max(0, activeTurns - 1);
      }
    }
    return activeTurns > 0;
  }, [events]);

  const viewerTeamIds = useMemo(() => new Set(teams.map((team) => team.id)), [teams]);
  useEffect(() => {
    viewerTeamIdsRef.current = viewerTeamIds;
  }, [viewerTeamIds]);
  const visibleChannels = useMemo(
    () =>
      channels.filter((channel) =>
        channelVisibleToUserUi(channel, userId, username, viewerTeamIds)
      ),
    [channels, userId, username, viewerTeamIds]
  );
  const activeChannels = useMemo(
    () => visibleChannels.filter((channel) => !channel.archivedAt),
    [visibleChannels]
  );
  const archivedChannels = useMemo(
    () => visibleChannels.filter((channel) => Boolean(channel.archivedAt)),
    [visibleChannels]
  );
  const visibleChannelAgentNames = useMemo(() => {
    const names = new Set<string>();
    for (const channel of visibleChannels) {
      for (const participant of channel.participants ?? []) {
        if (normalizedSubscriberType(participant) === "AGENT" && participant.subscriberId) {
          names.add(participant.subscriberId);
        }
      }
    }
    return names;
  }, [visibleChannels]);
  const visibleAgents = useMemo(
    () => agents.filter((agent) => agentVisibleToUserUi(agent, visibleChannelAgentNames, userId)),
    [agents, visibleChannelAgentNames, userId]
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
        channels: filteredChannels.filter((channel) => {
          const shared = isSharedChannelForUser(channel, username);
          if (group.id === "shared") return shared;
          if (group.id === "direct") {
            if (shared || !username) return false;
            return (
              channelGroupId(channel) === "direct" &&
              isHumanAgentDirectChannel(channel) &&
              channelHasHumanParticipant(channel, username)
            );
          }
          if (shared) return false;
          return channelGroupId(channel) === "channels";
        })
      })).filter((group) => group.channels.length > 0),
    [filteredChannels, username]
  );

  const isSearchingChannels = Boolean(channelQuery.trim());
  const uploadingAttachmentCount = pendingAttachments.filter((item) => item.status === "uploading").length;
  const readyAttachments = pendingAttachments
    .filter((item) => item.status === "ready" && item.uploaded)
    .map((item) => item.uploaded as UploadedAttachment);
  const hasAttachmentErrors = pendingAttachments.some((item) => item.status === "error");
  const activeChannelManageable = canManageUserChannel(activeChannel, userId);
  const activeChannelCanPost = activeChannel ? activeChannel.canPost !== false : false;
  const canStartConversation =
    Boolean(conversationName.trim()) || selectedConversationAgents.length === 1;
  const selectedConversationAgentRecords = useMemo(
    () =>
      selectedConversationAgents.map((agentName) => visibleAgents.find((agent) => agent.name === agentName) ?? { name: agentName }),
    [visibleAgents, selectedConversationAgents]
  );
  const agentSuggestions = useMemo(() => {
    const query = agentSearchQuery.trim().toLowerCase();
    return visibleAgents
      .filter((agent) => !selectedConversationAgents.includes(agent.name))
      .filter((agent) => !query || agent.name.toLowerCase().includes(query))
      .slice(0, 8);
  }, [agentSearchQuery, visibleAgents, selectedConversationAgents]);

  useEffect(() => {
    if (!activeChannel) return;
    setChannelVisibilityDraft(activeChannel.visibility === "PUBLIC" ? "PUBLIC" : "PRIVATE");
    setArchiveDraft(Boolean(activeChannel.archivedAt));
  }, [activeChannel?.id, activeChannel?.visibility, activeChannel?.archivedAt]);

  async function handleRevealSensitive(eventId: string) {
    const password = sensitiveRevealPasswords[eventId] ?? "";
    if (!password) {
      setSensitiveRevealErrors((current) => ({ ...current, [eventId]: "Enter your password to reveal." }));
      return;
    }
    setRevealingSensitiveEventId(eventId);
    setSensitiveRevealErrors((current) => ({ ...current, [eventId]: "" }));
    try {
      const response = await messageGateway.revealSensitive({ eventId, password });
      const text = typeof response.text === "string" ? response.text : "";
      if (!text) {
        setSensitiveRevealErrors((current) => ({ ...current, [eventId]: "No sensitive content was returned." }));
        return;
      }
      setRevealedSensitiveByEvent((current) => ({ ...current, [eventId]: text }));
      setSensitiveRevealPasswords((current) => ({ ...current, [eventId]: "" }));
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unable to reveal sensitive content";
      setSensitiveRevealErrors((current) => ({ ...current, [eventId]: detail || "Unable to reveal sensitive content" }));
    } finally {
      setRevealingSensitiveEventId((current) => (current === eventId ? null : current));
    }
  }

  function handleHideSensitive(eventId: string) {
    setRevealedSensitiveByEvent((current) => {
      if (!Object.prototype.hasOwnProperty.call(current, eventId)) return current;
      const next = { ...current };
      delete next[eventId];
      return next;
    });
  }

  function selectChannel(channelId: string | null, options?: { replace?: boolean }) {
    setActiveChannelId(channelId);
    setMobileSidebarOpen(false);
    deepLink.updateChannelDeepLink(channelId, options?.replace);
  }

  async function loadShell() {
    if (!authenticated) return;
    setError(null);
    setLoading(true);
    try {
      const pendingShareToken = deepLink.readPendingShareToken();
      let claimedShareChannelId: string | null = null;
      if (pendingShareToken) {
        try {
          const claimed = await conversationGateway.claimShareLink({ token: pendingShareToken });
          claimedShareChannelId = claimed.channelId;
          deepLink.consumeShareToken(claimed.channelId);
        } catch (claimError) {
          deepLink.consumeShareToken(deepLink.readLinkedChannelId());
          setError(
            claimError instanceof Error
              ? claimError.message
              : "Unable to claim shared channel link"
          );
        }
      }
      const [nextChannels, nextAgents, nextHumans, nextTeams] = await Promise.all([
        conversationGateway.listChannels(),
        conversationGateway.listAgents(),
        conversationGateway.listHumans().catch(() => []),
        conversationGateway.listMyTeams().catch(() => [])
      ]);
      setChannels(nextChannels);
      setAgents(nextAgents);
      setHumans(nextHumans);
      setTeams(nextTeams);
      const nextViewerTeamIds = new Set(nextTeams.map((team) => team.id));
      const visibleChannels = nextChannels.filter((channel) =>
        channelVisibleToUserUi(channel, userId, username, nextViewerTeamIds)
      );
      const nextVisibleChannelAgentNames = new Set<string>();
      for (const channel of visibleChannels) {
        for (const participant of channel.participants ?? []) {
          if (normalizedSubscriberType(participant) === "AGENT" && participant.subscriberId) {
            nextVisibleChannelAgentNames.add(participant.subscriberId);
          }
        }
      }
      const nextVisibleAgents = nextAgents.filter((agent) =>
        agentVisibleToUserUi(agent, nextVisibleChannelAgentNames, userId)
      );
      setSelectedConversationAgents((current) =>
        current.filter((agentName) => nextVisibleAgents.some((agent) => agent.name === agentName))
      );
      const linkedChannelId = deepLink.readLinkedChannelId();
      const preferredLinkedId = claimedShareChannelId ?? linkedChannelId;
      const linkedChannel = visibleChannels.find((channel) => channel.id === preferredLinkedId);
      const nextActiveChannelId =
        linkedChannel?.id ??
        (activeChannelId && visibleChannels.some((channel) => channel.id === activeChannelId && !channel.archivedAt)
          ? activeChannelId
          : visibleChannels.find((channel) => !channel.archivedAt)?.id ?? null);
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
      if (isHiddenUiActionMessage(event)) return newest;
      if (event.type !== "message.created" && event.type !== "agent.turn.failed") return newest;
      return Math.max(newest, event.createdAt ?? 0);
    }, 0);
  }

  function newestTimelineEventTime(channelEvents: EventRow[]) {
    return channelEvents.reduce((newest, event) => {
      if (isHiddenUiActionMessage(event)) return newest;
      if (event.type !== "message.created" && !isTraceEvent(event)) return newest;
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

  function rememberWsEvent(eventId: string) {
    const seen = seenWsEventIdsRef.current;
    if (seen.has(eventId)) return false;
    seen.add(eventId);
    if (seen.size > 3000) {
      const first = seen.values().next();
      if (!first.done) seen.delete(first.value);
    }
    return true;
  }

  async function loadMessages(
    channelId: string,
    options?: { scrollToBottom?: boolean; showLoading?: boolean; scrollBehavior?: ScrollBehavior }
  ) {
    const fetchSeq = messageFetchSeqRef.current + 1;
    messageFetchSeqRef.current = fetchSeq;
    const limit = adaptiveMessageBatchSize();
    if (options?.showLoading) {
      loadingChannelIdRef.current = channelId;
      setMessagesLoading(true);
    }
    try {
      const { messageEvents, failureEvents, turnEvents, toolEvents, contextEvents, wrapperEvents, processEvents } =
        await messageGateway.listLatestChannelEvents({ channelId, limit });
      if (fetchSeq !== messageFetchSeqRef.current || channelId !== activeChannelIdRef.current) {
        return;
      }
      const nextEvents = mergeEventsChronologically(
        mergeEventsChronologically(
          mergeEventsChronologically(
            mergeEventsChronologically(mergeEventsChronologically(messageEvents, failureEvents), turnEvents),
            mergeEventsChronologically(toolEvents, contextEvents)
          ),
          wrapperEvents
        ),
        processEvents
      ).reverse();
      const chronologicalEvents = [...nextEvents].reverse();
      const previousNewestMessageAt = lastLoadedMessageAtByChannelRef.current[channelId] ?? 0;
      const nextNewestMessageAt = newestMessageTime(nextEvents);
      const previousNewestTimelineAt = lastLoadedTimelineAtByChannelRef.current[channelId] ?? 0;
      const nextNewestTimelineAt = newestTimelineEventTime(nextEvents);
      const hasNewTimelineEvents =
        previousNewestTimelineAt > 0 && nextNewestTimelineAt > previousNewestTimelineAt;

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
      lastLoadedTimelineAtByChannelRef.current[channelId] = Math.max(
        previousNewestTimelineAt,
        nextNewestTimelineAt
      );
      if (options?.scrollToBottom) {
        forceScrollToBottomOnLoadRef.current = true;
        setHasNewMessagesBelow(false);
        scrollMessagesToBottom(options.scrollBehavior);
      }
      if (!options?.scrollToBottom && hasNewTimelineEvents && channelId === activeChannelIdRef.current) {
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
      if (
        loadingChannelIdRef.current === channelId &&
        fetchSeq === messageFetchSeqRef.current
      ) {
        loadingChannelIdRef.current = null;
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
      const { olderMessages, olderTurns, olderTools, olderWrappers, olderProcesses } =
        await messageGateway.listOlderChannelEvents({ channelId, limit, before: oldestEventAt });
      const olderEvents = mergeEventsChronologically(
        mergeEventsChronologically(
          mergeEventsChronologically(olderMessages, olderTurns),
          mergeEventsChronologically(olderTools, olderWrappers)
        ),
        olderProcesses
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
      setHasOlderMessages(
        olderMessages.length === limit ||
          olderTurns.length === limit ||
          olderTools.length === limit ||
          olderWrappers.length === limit ||
          olderProcesses.length === limit
      );
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
      const nextEvents = await messageGateway.listRecentMessageEvents();
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
        if (isHiddenUiActionMessage(event)) continue;
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

  function handleIncomingRealtimeEvent(event: EventRow) {
    if (!event.id || !rememberWsEvent(event.id)) return;
    const eventChannelId = event.channelId;
    if (!eventChannelId) return;

    const currentActiveId = activeChannelIdRef.current;
    if (eventChannelId === currentActiveId && (event.type === "message.created" || isTraceEvent(event))) {
      const hiddenUiAction = isHiddenUiActionMessage(event);
      const shouldAutoScroll = isMessagesPanelNearBottom();
      if (!hiddenUiAction) {
        setEvents((current) => mergeEventsChronologically(current, [event]));
      }
      if (event.type === "message.created" || event.type === "agent.turn.failed") {
        const eventCreatedAt = event.createdAt ?? 0;
        if (eventCreatedAt > 0) {
          lastSeenByChannelRef.current[eventChannelId] = Math.max(
            lastSeenByChannelRef.current[eventChannelId] ?? 0,
            eventCreatedAt
          );
          lastLoadedMessageAtByChannelRef.current[eventChannelId] = Math.max(
            lastLoadedMessageAtByChannelRef.current[eventChannelId] ?? 0,
            eventCreatedAt
          );
        }
      }
      const timelineCreatedAt = event.createdAt ?? 0;
      if (timelineCreatedAt > 0) {
        lastLoadedTimelineAtByChannelRef.current[eventChannelId] = Math.max(
          lastLoadedTimelineAtByChannelRef.current[eventChannelId] ?? 0,
          timelineCreatedAt
        );
      }
      setUnreadCounts((current) => {
        if (!current[eventChannelId]) return current;
        const next = { ...current };
        delete next[eventChannelId];
        return next;
      });
      if (hiddenUiAction) return;
      if (shouldAutoScroll) {
        setHasNewMessagesBelow(false);
        scrollMessagesToBottom();
      } else {
        setHasNewMessagesBelow(true);
      }
      return;
    }

    if (event.type !== "message.created") return;
    if (isHiddenUiActionMessage(event)) return;
    if (eventChannelId === currentActiveId) return;

    const channel = channelsRef.current.find((candidate) => candidate.id === eventChannelId);
    if (!channel || channel.archivedAt) return;
    if (
      !channelVisibleToUserUi(
        channel,
        userIdRef.current,
        usernameRef.current,
        viewerTeamIdsRef.current
      )
    ) {
      return;
    }
    const eventCreatedAt = event.createdAt ?? 0;
    if (eventCreatedAt <= (lastSeenByChannelRef.current[eventChannelId] ?? 0)) return;

    setUnreadCounts((current) => ({
      ...current,
      [eventChannelId]: (current[eventChannelId] ?? 0) + 1
    }));
  }

  useEffect(() => {
    document.title = "OrgOps User UI";
    void loadSession();
  }, []);

  useEffect(() => {
    if (sessionState !== "ready") return;
    void loadShell();
  }, [sessionState]);

  useEffect(() => {
    messageFetchSeqRef.current += 1;
    activeChannelIdRef.current = activeChannelId;
    loadingChannelIdRef.current = activeChannelId;
    forceScrollToBottomOnLoadRef.current = Boolean(activeChannelId);
    setEvents([]);
    setMessagesLoading(Boolean(activeChannelId));
    setLoadingOlderMessages(false);
    setHasOlderMessages(false);
    setHasNewMessagesBelow(false);
    setExpandedTraceEventId(null);
    setShowParticipantsDialog(false);
    setShowChannelManageDialog(false);
    setPendingAttachments([]);
    setShareValue("");
    setShareLinkCopied(false);
    setShareRemovingKey(null);
    setShareSubmitting(false);
  }, [activeChannelId]);

  useEffect(() => {
    if (sessionState !== "ready") return;
    if (!activeChannelId) {
      setEvents([]);
      return;
    }
    void loadMessages(activeChannelId, {
      scrollBehavior: "auto",
      scrollToBottom: true,
      showLoading: true
    });
  }, [activeChannelId, sessionState]);

  useEffect(() => {
    if (!activeChannelId || messagesLoading) return;
    if (!forceScrollToBottomOnLoadRef.current) return;
    forceScrollToBottomOnLoadRef.current = false;
    // Run after paint to handle initial DOM/layout settling on hard reload.
    window.requestAnimationFrame(() => {
      scrollMessagesToBottom("auto");
      window.requestAnimationFrame(() => {
        scrollMessagesToBottom("auto");
      });
    });
  }, [activeChannelId, messagesLoading, timelineItems.length]);

  useEffect(() => {
    if (sessionState !== "ready") return;
    void loadMessageNotifications();
  }, [sessionState, channels]);

  useEffect(() => {
    if (sessionState !== "ready") return;
    const feed = createWebSocketRealtimeFeed({
      url: wsUrl(),
      handlers: {
        onOpen: () => {
          setWsConnected(true);
          const liveChannelId = activeChannelIdRef.current;
          if (liveChannelId) {
            void loadMessages(liveChannelId);
          }
          void loadMessageNotifications();
        },
        onClose: () => setWsConnected(false),
        onEvent: (event) => handleIncomingRealtimeEvent(event)
      }
    });
    realtimeFeedRef.current = feed;
    feed.start();

    return () => {
      feed.stop();
      realtimeFeedRef.current = null;
    };
  }, [sessionState]);

  useEffect(() => {
    if (sessionState !== "ready") return;
    const desiredTopics = new Set<string>();
    for (const channel of visibleChannels) {
      desiredTopics.add(`channel:${channel.id}`);
    }
    realtimeFeedRef.current?.setTopics(desiredTopics);
  }, [sessionState, visibleChannels]);

  usePollingFallback({
    enabled: sessionState === "ready" && !wsConnected,
    poll: () => {
      const liveChannelId = activeChannelIdRef.current;
      if (liveChannelId) void loadMessages(liveChannelId);
      void loadMessageNotifications();
    }
  });

  useEffect(() => {
    if (sessionState !== "ready") return;
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
  }, [sessionState]);

  useEffect(() => {
    if (sessionState !== "ready") return;
    function handlePopState() {
      const linkedChannelId = deepLink.readLinkedChannelId();
      const linkedChannel = channels.find(
        (channel) =>
          channel.id === linkedChannelId &&
          channelVisibleToUserUi(channel, userId, username, viewerTeamIds)
      );
      if (linkedChannel?.archivedAt) setShowArchivedChannels(true);
      setActiveChannelId(linkedChannel?.id ?? null);
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [sessionState, channels, userId, username, viewerTeamIds]);

  async function handleLogout() {
    await signOut();
    setAuthenticated(false);
    setUsername("");
    setUserId(null);
    setMustChangePassword(false);
    setNewPassword("");
    setConfirmPassword("");
    setChannels([]);
    setAgents([]);
    setTeams([]);
    setEvents([]);
    setActiveChannelId(null);
    deepLink.updateChannelDeepLink(null, true);
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
    setExpandedTraceEventId(null);
    lastSeenByChannelRef.current = {};
    lastLoadedMessageAtByChannelRef.current = {};
    lastLoadedTimelineAtByChannelRef.current = {};
  }

  async function handlePasswordUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const nextPassword = newPassword.trim();
    const passwordError = validateNewPassword(newPassword, confirmPassword);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    setAuthLoading(true);
    try {
      await changePassword({
        username,
        fallbackUsername: loginUsername,
        newPassword: nextPassword
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
    if (!activeChannelId || activeChannel?.archivedAt || !activeChannelCanPost) return;
    if (uploadingAttachmentCount > 0) return;
    const trimmedText = draft.trim();
    if (!trimmedText && readyAttachments.length === 0) return;

    setSending(true);
    setError(null);
    try {
      const effectiveText =
        trimmedText ||
        `Attached ${readyAttachments.length} file${readyAttachments.length === 1 ? "" : "s"} for reference.`;
      await messageGateway.sendMessage({
        text: effectiveText,
        attachments: readyAttachments,
        username,
        channelId: activeChannelId
      });
      setDraft("");
      setPendingAttachments([]);
      setHasNewMessagesBelow(false);
      if (wsConnected) {
        scrollMessagesToBottom();
      } else {
        await loadMessages(activeChannelId, { scrollToBottom: true });
      }
      window.requestAnimationFrame(() => {
        scrollMessagesToBottom("auto");
        composerTextareaRef.current?.scrollIntoView({ block: "nearest" });
      });
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
    const nextChannels = await conversationGateway.listChannels();
    setChannels(nextChannels);
    const visibleChannels = nextChannels.filter((channel) =>
      channelVisibleToUserUi(channel, userId, username, viewerTeamIds)
    );
    const nextSelectedChannelId =
      nextActiveChannelId !== undefined
        ? nextActiveChannelId
        : activeChannelId &&
            visibleChannels.some((channel) => channel.id === activeChannelId && !channel.archivedAt)
          ? activeChannelId
          : visibleChannels.find((channel) => !channel.archivedAt)?.id ?? null;
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
        const direct = await conversationGateway.openDirectChannel({ agentName: selectedAgents[0] });
        setCollapsedChannelGroups((current) => ({ ...current, direct: false }));
        await refreshChannels(direct.id);
      } else {
        const created = await conversationGateway.createChannel({
          name,
          description: description || undefined,
          visibility: conversationVisibility
        });
        await Promise.all([
          username
            ? conversationGateway
                .subscribe({ channelId: created.id, subscriberType: "HUMAN", subscriberId: username })
                .catch(() => undefined)
            : Promise.resolve(),
          ...selectedAgents.map((agentName) =>
            conversationGateway.subscribe({
              channelId: created.id,
              subscriberType: "AGENT",
              subscriberId: agentName
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

  async function handleDeleteChannel(channel: Channel) {
    if (!confirmPort.confirm(`Permanently delete ${channelLabel(channel, username)}?`)) return;
    setError(null);
    setLoading(true);
    try {
      await conversationGateway.deleteChannel({ channelId: channel.id });
      await refreshChannels(activeChannelId === channel.id ? null : undefined);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete channel");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveChannelSettings() {
    if (!activeChannel) return;
    setUpdatingChannelVisibility(true);
    setError(null);
    try {
      const currentVisibility = activeChannel.visibility === "PUBLIC" ? "PUBLIC" : "PRIVATE";
      if (channelVisibilityDraft !== currentVisibility) {
        await conversationGateway.updateChannelVisibility({
          channelId: activeChannel.id,
          visibility: channelVisibilityDraft
        });
      }
      const currentlyArchived = Boolean(activeChannel.archivedAt);
      if (archiveDraft !== currentlyArchived) {
        await conversationGateway.setChannelArchived({
          channelId: activeChannel.id,
          archived: archiveDraft
        });
        if (archiveDraft) setShowArchivedChannels(true);
      }
      await refreshChannels(activeChannel.id);
      setShowChannelManageDialog(false);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update channel settings");
    } finally {
      setUpdatingChannelVisibility(false);
    }
  }

  async function handleAddParticipant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeChannelId || !participantValue.trim()) return;
    setParticipantSubmitting(true);
    setError(null);
    try {
      await conversationGateway.subscribe({
        channelId: activeChannelId,
        subscriberType: participantKind,
        subscriberId: participantValue.trim()
      });
      await refreshChannels(activeChannelId);
      setParticipantValue("");
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Unable to add participant");
    } finally {
      setParticipantSubmitting(false);
    }
  }

  async function handleRemoveParticipant(participant: ChannelParticipant) {
    if (!activeChannelId) return;
    const participantKey = `${participant.subscriberType}:${participant.subscriberId}`;
    setParticipantRemovingKey(participantKey);
    setError(null);
    try {
      await conversationGateway.unsubscribe({
        channelId: activeChannelId,
        subscriberType: participant.subscriberType,
        subscriberId: participant.subscriberId
      });
      await refreshChannels(activeChannelId);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Unable to remove participant");
    } finally {
      setParticipantRemovingKey(null);
    }
  }

  async function handleAddShare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeChannelId || !shareValue.trim()) return;
    setShareSubmitting(true);
    setError(null);
    try {
      await conversationGateway.shareChannel({
        channelId: activeChannelId,
        viewerType: shareKind,
        viewerId: shareValue.trim()
      });
      await refreshChannels(activeChannelId);
      setShareValue("");
    } catch (shareError) {
      setError(shareError instanceof Error ? shareError.message : "Unable to share channel");
    } finally {
      setShareSubmitting(false);
    }
  }

  async function handleRemoveShare(share: ChannelShare) {
    if (!activeChannelId) return;
    const shareKey = `${share.viewerType}:${share.viewerId}`;
    setShareRemovingKey(shareKey);
    setError(null);
    try {
      await conversationGateway.unshareChannel({
        channelId: activeChannelId,
        viewerType: share.viewerType,
        viewerId: share.viewerId
      });
      await refreshChannels(activeChannelId);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Unable to remove shared viewer");
    } finally {
      setShareRemovingKey(null);
    }
  }

  function handleMessagesScroll() {
    if (hasNewMessagesBelow && isMessagesPanelNearBottom()) {
      setHasNewMessagesBelow(false);
    }
  }

  async function handleCopyShareLink() {
    if (!activeChannelId) return;
    try {
      const created = await conversationGateway.createShareLink({ channelId: activeChannelId });
      const shareLink = deepLink.buildShareLink({ token: created.token, channelId: created.channelId });
      await clipboard.writeText(shareLink);
      setShareLinkCopied(true);
      window.setTimeout(() => setShareLinkCopied(false), 2000);
    } catch {
      setError("Unable to copy link. Please copy it from the address bar.");
    }
  }

  async function uploadSingleFile(file: File) {
    const localId = createLocalAttachmentId();
    const mime = file.type || "application/octet-stream";
    setPendingAttachments((current) => [
      ...current,
      {
        localId,
        name: file.name || "upload",
        mime,
        size: file.size,
        status: "uploading"
      }
    ]);
    try {
      const uploadPayload = await fileGateway.upload(file);
      const meta = await fileGateway.getMeta(uploadPayload.id);
      const uploaded: UploadedAttachment = {
        localId,
        fileId: uploadPayload.id,
        name: meta.original_name || file.name || "upload",
        mime: meta.mime || mime,
        size: typeof meta.size === "number" ? meta.size : file.size,
        ...(typeof meta.sha256 === "string" && meta.sha256 ? { sha256: meta.sha256 } : {})
      };
      setPendingAttachments((current) =>
        current.map((item) =>
          item.localId === localId
            ? {
                ...item,
                name: uploaded.name,
                mime: uploaded.mime,
                size: uploaded.size,
                status: "ready",
                uploaded,
                error: undefined
              }
            : item
        )
      );
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : "Upload failed";
      setPendingAttachments((current) =>
        current.map((item) =>
          item.localId === localId ? { ...item, status: "error", error: message } : item
        )
      );
    }
  }

  function uploadFiles(files: File[]) {
    for (const file of files) {
      void uploadSingleFile(file);
    }
  }

  function handlePickFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    uploadFiles(files);
    event.currentTarget.value = "";
  }

  function resizeComposerTextarea(textarea?: HTMLTextAreaElement | null) {
    const target = textarea ?? composerTextareaRef.current;
    if (!target) return;
    const viewportMax = isConversationEmpty
      ? Math.max(56, Math.floor(window.innerHeight / 8))
      : Math.max(120, Math.floor(window.innerHeight / 3));
    const minHeight = isConversationEmpty ? 34 : 56;
    target.style.maxHeight = `${viewportMax}px`;
    target.style.height = "auto";
    const nextHeight = Math.min(target.scrollHeight, viewportMax);
    target.style.height = `${Math.max(minHeight, nextHeight)}px`;
    target.style.overflowY = target.scrollHeight > viewportMax ? "auto" : "hidden";
  }

  function handleComposerPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(event.clipboardData.items ?? []);
    const imageFiles = items
      .map((item) => {
        if (!item.type.startsWith("image/")) return null;
        return item.getAsFile();
      })
      .filter((file): file is File => Boolean(file));
    if (imageFiles.length === 0) return;
    event.preventDefault();
    const filesToUpload = imageFiles.map((image) => {
      const ext = image.type.includes("/") ? image.type.split("/")[1] : "png";
      const safeExt = ext.replace(/[^a-zA-Z0-9]/g, "") || "png";
      const filename = `pasted-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.${safeExt}`;
      return new File([image], filename, { type: image.type || "image/png" });
    });
    uploadFiles(filesToUpload);
  }

  useEffect(() => {
    resizeComposerTextarea();
  }, [draft, isConversationEmpty, activeChannelId]);

  useEffect(() => {
    function handleWindowResize() {
      resizeComposerTextarea();
    }
    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, []);

  if (sessionState === "loading") {
    return <main className="loading-screen">Loading OrgOps...</main>;
  }

  if (sessionState === "signedOut") {
    return (
      <LoginScreen
        error={error}
        username={loginUsername}
        password={loginPassword}
        loading={authLoading}
        onUsernameChange={setLoginUsername}
        onPasswordChange={setLoginPassword}
        onSubmit={handleLogin}
      />
    );
  }

  if (sessionState === "mustChangePassword") {
    return (
      <ChangePasswordScreen
        error={error}
        username={username}
        newPassword={newPassword}
        confirmPassword={confirmPassword}
        loading={authLoading}
        onNewPasswordChange={setNewPassword}
        onConfirmPasswordChange={setConfirmPassword}
        onSubmit={handlePasswordUpdate}
        onSignOut={() => void handleLogout()}
      />
    );
  }

  return (
    <main className="app-shell">
      <Sidebar
        mobileOpen={mobileSidebarOpen}
        username={username}
        loading={loading}
        channelQuery={channelQuery}
        isSearchingChannels={isSearchingChannels}
        groupedChannels={groupedChannels}
        collapsedChannelGroups={collapsedChannelGroups}
        filteredChannels={filteredChannels}
        filteredArchivedChannels={filteredArchivedChannels}
        showArchivedChannels={showArchivedChannels}
        activeChannelId={activeChannelId}
        unreadCounts={unreadCounts}
        onCloseMobile={() => setMobileSidebarOpen(false)}
        onChannelQueryChange={setChannelQuery}
        onToggleChannelGroup={(groupId) =>
          setCollapsedChannelGroups((current) => ({
            ...current,
            [groupId]: !current[groupId]
          }))
        }
        onToggleArchivedChannels={() => setShowArchivedChannels((current) => !current)}
        onSelectChannel={selectChannel}
        onNewConversation={() => setShowConversationDialog(true)}
        onLogout={() => void handleLogout()}
      />
      {mobileSidebarOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          className="sidebar-mobile-backdrop"
          onClick={() => setMobileSidebarOpen(false)}
        />
      ) : null}

      <section className="workspace">
        <header className="workspace-header">
          <button
            type="button"
            className="sidebar-mobile-toggle"
            onClick={() => setMobileSidebarOpen(true)}
          >
            Menu
          </button>
          <div>
            <span>Workspace</span>
            <div className="workspace-title-row">
              <h1>{channelLabel(activeChannel, username)}</h1>
            </div>
            <p>
              {activeChannel?.archivedAt
                ? "Archived channel"
                : activeChannel && !activeChannelCanPost
                  ? "Read-only shared channel"
                : activeChannel?.description || "Talk to the team and agents in plain language."}
            </p>
          </div>
          {activeChannel && activeChannelManageable ? (
            <div className="channel-actions">
              <button type="button" onClick={() => setShowChannelManageDialog(true)}>
                Manage channel
              </button>
            </div>
          ) : null}
        </header>

        {error ? <div className="notice error">{error}</div> : null}
        {loading ? <div className="notice">Loading OrgOps...</div> : null}

        <section className="chat-stack">
          <section
            className={`messages-panel${isConversationEmpty ? " messages-panel-empty" : ""}`}
            ref={messagesPanelRef}
            onScroll={handleMessagesScroll}
          >
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
            ) : timelineItems.length === 0 ? (
              <div className="empty-state">
                <strong>No messages yet</strong>
                <p>Send a short update or request to start the conversation.</p>
              </div>
            ) : (
              timelineItems.map((item) => {
                if (item.kind === "message" && item.event.type === "agent.turn.failed") {
                  return (
                    <TurnFailureItem
                      key={item.id}
                      event={item.event}
                      createdAtLabel={formatTime(item.event.createdAt)}
                    />
                  );
                }
                if (item.kind === "message") {
                  const event = item.event;
                  return (
                    <MessageItem
                      key={item.id}
                      event={event}
                      canPost={activeChannelCanPost && !activeChannel?.archivedAt}
                      channelId={activeChannelId}
                      username={username}
                      revealedSensitive={revealedSensitiveByEvent[event.id] ?? ""}
                      revealError={sensitiveRevealErrors[event.id] ?? ""}
                      revealPassword={sensitiveRevealPasswords[event.id] ?? ""}
                      revealing={revealingSensitiveEventId === event.id}
                      onPasswordChange={(value) => {
                        setSensitiveRevealPasswords((current) => ({
                          ...current,
                          [event.id]: value
                        }));
                        setSensitiveRevealErrors((current) => ({ ...current, [event.id]: "" }));
                      }}
                      onReveal={() => void handleRevealSensitive(event.id)}
                      onHide={() => handleHideSensitive(event.id)}
                    />
                  );
                }
                return (
                  <TraceGroup
                    key={item.id}
                    traceEvents={item.traceEvents}
                    tone={item.tone}
                    expandedTraceEventId={expandedTraceEventId}
                    onToggleTraceEvent={(eventId) =>
                      setExpandedTraceEventId((current) => (current === eventId ? null : eventId))
                    }
                  />
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

          <form className={`composer${isConversationEmpty ? " composer-compact" : ""}`} onSubmit={handleSubmit}>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="composer-file-input"
            onChange={handlePickFiles}
          />
          {offlineAgentNames.length > 0 ? (
            <p className="composer-offline-hint">
              {offlineAgentNames.join(", ")} {offlineAgentNames.length === 1 ? "is" : "are"} off — will reply once
              started.
            </p>
          ) : null}
          {pendingAttachments.length > 0 ? (
            <ComposerAttachments
              attachments={pendingAttachments}
              onRemove={(localId) =>
                setPendingAttachments((current) =>
                  current.filter((item) => item.localId !== localId)
                )
              }
            />
          ) : null}
          <ComposerTextarea
            textareaRef={composerTextareaRef}
            value={draft}
            activeChannel={activeChannel}
            activeChannelCanPost={activeChannelCanPost}
            sending={sending}
            isConversationEmpty={isConversationEmpty}
            username={username}
            onChange={(event) => {
              setDraft(event.target.value);
              resizeComposerTextarea(event.currentTarget);
            }}
            onPaste={handleComposerPaste}
          />
          <ComposerActions
            canAttach={
              !(!activeChannel || Boolean(activeChannel.archivedAt) || !activeChannelCanPost || sending)
            }
            canSend={
              !(
                !activeChannel ||
                Boolean(activeChannel.archivedAt) ||
                !activeChannelCanPost ||
                sending ||
                uploadingAttachmentCount > 0 ||
                (!draft.trim() && readyAttachments.length === 0)
              )
            }
            sending={sending}
            uploadingAttachmentCount={uploadingAttachmentCount}
            onAttachClick={() => fileInputRef.current?.click()}
          />
          {hasAttachmentErrors ? (
            <p className="composer-attachment-error">
              One or more attachments failed to upload. Remove them or retry.
            </p>
          ) : null}
          </form>
        </section>
      </section>

      <ActivityPanel
        channel={activeChannel}
        agents={agents}
        events={events}
        agentIsThinking={agentIsThinking}
      />

      {showConversationDialog ? (
        <ConversationDialog
          name={conversationName}
          description={conversationDescription}
          visibility={conversationVisibility}
          selectedAgents={selectedConversationAgentRecords}
          agentSearchQuery={agentSearchQuery}
          visibleAgents={visibleAgents}
          agentSuggestions={agentSuggestions}
          loading={loading}
          canStart={canStartConversation}
          onClose={() => setShowConversationDialog(false)}
          onSubmit={handleStartConversation}
          onNameChange={setConversationName}
          onDescriptionChange={setConversationDescription}
          onVisibilityChange={setConversationVisibility}
          onRemoveAgent={removeConversationAgent}
          onAddAgent={addConversationAgent}
          onAgentSearchQueryChange={setAgentSearchQuery}
        />
      ) : null}

      {showParticipantsDialog && activeChannel && activeChannelManageable ? (
        <ParticipantsDialog
          channel={activeChannel}
          visibleAgents={visibleAgents}
          humans={humans}
          participantKind={participantKind}
          participantValue={participantValue}
          participantSubmitting={participantSubmitting}
          participantRemovingKey={participantRemovingKey}
          shareKind={shareKind}
          shareValue={shareValue}
          shareSubmitting={shareSubmitting}
          shareRemovingKey={shareRemovingKey}
          onClose={() => setShowParticipantsDialog(false)}
          onParticipantKindChange={setParticipantKind}
          onParticipantValueChange={setParticipantValue}
          onAddParticipant={handleAddParticipant}
          onRemoveParticipant={(participant) => void handleRemoveParticipant(participant)}
          onShareKindChange={setShareKind}
          onShareValueChange={setShareValue}
          onAddShare={handleAddShare}
          onRemoveShare={(share) => void handleRemoveShare(share)}
        />
      ) : null}

      {showChannelManageDialog && activeChannel && activeChannelManageable ? (
        <ChannelManageDialog
          channel={activeChannel}
          underlay={showParticipantsDialog}
          visibilityDraft={channelVisibilityDraft}
          archiveDraft={archiveDraft}
          updating={updatingChannelVisibility}
          shareLinkCopied={shareLinkCopied}
          onClose={() => setShowChannelManageDialog(false)}
          onVisibilityDraftChange={setChannelVisibilityDraft}
          onArchiveDraftChange={setArchiveDraft}
          onManageParticipants={() => {
            setShowParticipantsDialog(true);
          }}
          onCopyShareLink={() => void handleCopyShareLink()}
          onSave={() => void handleSaveChannelSettings()}
          onDelete={(channel) => void handleDeleteChannel(channel)}
        />
      ) : null}
    </main>
  );
}
