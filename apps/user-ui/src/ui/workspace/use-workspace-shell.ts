import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { Channel, EventRow } from "../../types";
import type { claimPendingShareLinkUseCase, loadWorkspaceUseCase, messageGateway } from "../../composition-root";
import type { useConversationsState } from "../conversations/use-conversations-state";
import type { useChannelSelection } from "../conversations/use-channel-selection";
import type { useTimeline } from "../messaging/use-timeline";
import type { useMessagesScroll } from "../messaging/use-messages-scroll";
import type { useUnreadTracker } from "../messaging/use-unread-tracker";

type SessionState = string;

export function useWorkspaceShell(options: {
  authenticated: boolean;
  sessionState: SessionState;
  activeChannelId: string | null;
  userId: string | null;
  username: string;
  channels: Channel[];
  viewerTeamIds: Set<string>;
  timelineItemCount: number;
  messagesLoading: boolean;
  activeChannelIdRef: MutableRefObject<string | null>;
  channelsRef: MutableRefObject<Channel[]>;
  usernameRef: MutableRefObject<string>;
  userIdRef: MutableRefObject<string | null>;
  viewerTeamIdsRef: MutableRefObject<Set<string>>;
  messageFetchSeqRef: MutableRefObject<number>;
  loadingChannelIdRef: MutableRefObject<string | null>;
  forceScrollToBottomOnLoadRef: MutableRefObject<boolean>;
  claimPendingShareLinkUseCase: typeof claimPendingShareLinkUseCase;
  loadWorkspaceUseCase: typeof loadWorkspaceUseCase;
  messageGateway: typeof messageGateway;
  loadSession: () => Promise<unknown> | unknown;
  loadMessages: ReturnType<typeof useTimeline>["loadMessages"];
  loadMessageNotificationsFor: ReturnType<typeof useUnreadTracker>["loadMessageNotifications"];
  scrollMessagesToBottom: ReturnType<typeof useMessagesScroll>["scrollMessagesToBottom"];
  setWorkspace: ReturnType<typeof useConversationsState>["setWorkspace"];
  selectChannel: ReturnType<typeof useChannelSelection>["selectChannel"];
  setError: (error: string | null) => void;
  setLoading: (loading: boolean) => void;
  setSelectedConversationAgents: Dispatch<SetStateAction<string[]>>;
  setShowArchivedChannels: (show: boolean) => void;
  setShowConversationDialog: (show: boolean) => void;
  setShowParticipantsDialog: (show: boolean) => void;
  setShowChannelManageDialog: (show: boolean) => void;
  setEvents: Dispatch<SetStateAction<EventRow[]>>;
  setMessagesLoading: (loading: boolean) => void;
  setLoadingOlderMessages: (loading: boolean) => void;
  setHasOlderMessages: (hasOlder: boolean) => void;
  setHasNewMessagesBelow: (hasNew: boolean) => void;
  setExpandedTraceEventId: (eventId: string | null) => void;
  setPendingAttachments: (attachments: []) => void;
}) {
  const {
    authenticated,
    sessionState,
    activeChannelId,
    userId,
    username,
    channels,
    viewerTeamIds,
    timelineItemCount,
    messagesLoading,
    activeChannelIdRef,
    channelsRef,
    usernameRef,
    userIdRef,
    viewerTeamIdsRef,
    messageFetchSeqRef,
    loadingChannelIdRef,
    forceScrollToBottomOnLoadRef,
    claimPendingShareLinkUseCase,
    loadWorkspaceUseCase,
    messageGateway,
    loadSession,
    loadMessages,
    loadMessageNotificationsFor,
    scrollMessagesToBottom,
    setWorkspace,
    selectChannel,
    setError,
    setLoading,
    setSelectedConversationAgents,
    setShowArchivedChannels,
    setShowConversationDialog,
    setShowParticipantsDialog,
    setShowChannelManageDialog,
    setEvents,
    setMessagesLoading,
    setLoadingOlderMessages,
    setHasOlderMessages,
    setHasNewMessagesBelow,
    setExpandedTraceEventId,
    setPendingAttachments
  } = options;

  useEffect(() => {
    channelsRef.current = channels;
  }, [channels]);

  useEffect(() => {
    usernameRef.current = username;
  }, [username]);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    viewerTeamIdsRef.current = viewerTeamIds;
  }, [viewerTeamIds]);

  async function loadShell() {
    if (!authenticated) return;
    setError(null);
    setLoading(true);
    try {
      const { claimedShareChannelId, errorMessage: claimErrorMessage } = await claimPendingShareLinkUseCase();
      if (claimErrorMessage) setError(claimErrorMessage);
      const workspace = await loadWorkspaceUseCase({
        claimedShareChannelId,
        activeChannelId,
        userId,
        username
      });
      setWorkspace(workspace);
      setSelectedConversationAgents((current) =>
        current.filter((agentName) => workspace.visibleAgentNames.has(agentName))
      );
      if (workspace.expandArchivedChannels) setShowArchivedChannels(true);
      selectChannel(workspace.nextActiveChannelId, { replace: true });
      await loadMessageNotifications({ initialize: true });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load OrgOps");
    } finally {
      setLoading(false);
    }
  }

  function loadMessageNotifications(options?: { initialize?: boolean }) {
    return loadMessageNotificationsFor({
      initialize: options?.initialize,
      authenticated,
      channels,
      activeChannelIdRef,
      messageGateway
    });
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
  }, [activeChannelId, messagesLoading, timelineItemCount]);

  useEffect(() => {
    if (sessionState !== "ready") return;
    void loadMessageNotifications();
  }, [sessionState, channels]);

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

  return { loadMessageNotifications };
}
