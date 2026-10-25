import {
  useMemo,
  useRef,
  useState
} from "react";
import { createLocalAttachmentId } from "./infrastructure/browser/browser-local-id";
import { useRealtimeFeed } from "./ui/realtime/use-realtime-feed";
import { useSession } from "./ui/identity/use-session";
import { useParticipants } from "./ui/conversations/use-participants";
import { useShares } from "./ui/conversations/use-shares";
import { useShareLink } from "./ui/conversations/use-share-link";
import { useConversationsState } from "./ui/conversations/use-conversations-state";
import { useChannelSelection } from "./ui/conversations/use-channel-selection";
import { useStartConversation } from "./ui/conversations/use-start-conversation";
import { useConversationAgentSelection } from "./ui/conversations/use-conversation-agent-selection";
import { useChannelManagement } from "./ui/conversations/use-channel-management";
import { useSensitiveReveal } from "./ui/messaging/use-sensitive-reveal";
import { usePendingAttachments } from "./ui/messaging/use-pending-attachments";
import { useComposerSend } from "./ui/messaging/use-composer-send";
import { useUnreadTracker } from "./ui/messaging/use-unread-tracker";
import { useTimelineView } from "./ui/messaging/use-timeline-view";
import { useDerivedChannels } from "./ui/conversations/use-derived-channels";
import { useTimeline } from "./ui/messaging/use-timeline";
import { useMessagesScroll } from "./ui/messaging/use-messages-scroll";
import { AuthGate } from "./ui/auth/auth-gate";
import { WorkspaceLayout } from "./ui/workspace/workspace-layout";
import { useWorkspaceShell } from "./ui/workspace/use-workspace-shell";
import { useSidebarAndDialogState } from "./ui/workspace/use-sidebar-and-dialog-state";
import type { Channel, UploadedAttachment } from "./types";
import { canManageUserChannel } from "./domain/conversations/channel-rules";

import {
  messageGateway,
  revealSensitive,
  sendMessage,
  loadLatestTimeline,
  loadOlderTimeline,
  loadCurrentSession,
  signIn,
  signOut,
  changePassword,
  confirmPort,
  deepLink,
  uploadAttachment,
  addParticipant,
  removeParticipant,
  addShare,
  copyShareLink,
  removeShare,
  updateChannelSettings,
  deleteChannel,
  startConversation,
  selectChannelUseCase,
  refreshChannelsUseCase,
  loadWorkspaceUseCase,
  claimPendingShareLinkUseCase
} from "./composition-root";

export default function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const activeChannelIdRef = useRef<string | null>(null);
  const channelsRef = useRef<Channel[]>([]);
  const usernameRef = useRef("");
  const userIdRef = useRef<string | null>(null);
  const viewerTeamIdsRef = useRef<Set<string>>(new Set());
  const {
    channels,
    agents,
    teams,
    humans,
    activeChannelId,
    setWorkspace,
    setChannels,
    setActiveChannelId,
    resetForSignOut
  } = useConversationsState();
  const {
    unreadCounts,
    recordActiveChannelEvent,
    incrementUnreadForInactiveChannel,
    lastSeenByChannelRef,
    lastLoadedMessageAtByChannelRef,
    lastLoadedTimelineAtByChannelRef,
    clearUnreadForChannel,
    resetUnreadTracking,
    loadMessageNotifications: loadMessageNotificationsFor
  } = useUnreadTracker();
  const {
    collapsedChannelGroups,
    setCollapsedChannelGroups,
    channelQuery,
    setChannelQuery,
    mobileSidebarOpen,
    setMobileSidebarOpen,
    showArchivedChannels,
    setShowArchivedChannels,
    showConversationDialog,
    setShowConversationDialog,
    showParticipantsDialog,
    setShowParticipantsDialog,
    showChannelManageDialog,
    setShowChannelManageDialog
  } = useSidebarAndDialogState();
  const [hasNewMessagesBelow, setHasNewMessagesBelow] = useState(false);
  const { messagesPanelRef, scrollMessagesToBottom, isMessagesPanelNearBottom, handleMessagesScroll } =
    useMessagesScroll({ hasNewMessagesBelow, setHasNewMessagesBelow });
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const {
    events,
    setEvents,
    messagesLoading,
    setMessagesLoading,
    loadingOlderMessages,
    setLoadingOlderMessages,
    setHasOlderMessages,
    hasOlderMessages,
    messageFetchSeqRef,
    loadingChannelIdRef,
    forceScrollToBottomOnLoadRef,
    loadMessages,
    handleLoadOlderMessages
  } = useTimeline({
    activeChannelId,
    activeChannelIdRef,
    lastSeenByChannelRef,
    lastLoadedMessageAtByChannelRef,
    lastLoadedTimelineAtByChannelRef,
    clearUnreadForChannel,
    messagesPanelRef,
    scrollMessagesToBottom,
    isMessagesPanelNearBottom,
    setHasNewMessagesBelow,
    setError,
    loadLatestTimeline,
    loadOlderTimeline
  });
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
    setLoginUsername,
    newPassword,
    confirmPassword,
    setNewPassword,
    setConfirmPassword,
    handlePasswordUpdate,
    handleLogout
  } = useSession({ loadCurrentSession, signIn, signOut, changePassword, setError, onSignedOut: handleSignedOut });
  const viewerTeamIds = useMemo(() => new Set(teams.map((team) => team.id)), [teams]);
  const { selectChannel, refreshChannels } = useChannelSelection({
    activeChannelId,
    userId,
    username,
    viewerTeamIds,
    sessionState,
    channels,
    readLinkedChannelId: deepLink.readLinkedChannelId,
    selectChannelUseCase,
    refreshChannelsUseCase,
    setChannels,
    setActiveChannelId,
    setMobileSidebarOpen,
    setShowArchivedChannels
  });
  const participants = useParticipants({
    activeChannelId,
    addParticipant,
    removeParticipant,
    refreshChannels,
    setError
  });
  const shares = useShares({
    activeChannelId,
    addShare,
    removeShare,
    refreshChannels,
    setError
  });
  const shareLink = useShareLink({
    activeChannelId,
    copyShareLink,
    setError
  });
  const {
    sensitiveRevealPasswords,
    revealedSensitiveByEvent,
    revealingSensitiveEventId,
    sensitiveRevealErrors,
    handleRevealSensitive,
    handleHideSensitive,
    handleSensitivePasswordChange
  } = useSensitiveReveal({ revealSensitive });
  const [expandedTraceEventId, setExpandedTraceEventId] = useState<string | null>(null);
  const { pendingAttachments, setPendingAttachments, uploadFiles, handlePickFiles } = usePendingAttachments({
    uploadAttachment,
    createLocalAttachmentId
  });

  const activeChannel = useMemo(
    () => channels.find((channel) => channel.id === activeChannelId) ?? null,
    [activeChannelId, channels]
  );

  const { timelineItems, agentIsThinking } = useTimelineView({ events });
  const isConversationEmpty = !messagesLoading && timelineItems.length === 0;

  const {
    offlineAgentNames,
    visibleChannels,
    visibleAgents,
    filteredChannels,
    filteredArchivedChannels,
    groupedChannels
  } = useDerivedChannels({
    channels,
    agents,
    activeChannel,
    userId,
    username,
    viewerTeamIds,
    channelQuery
  });

  const agentSelection = useConversationAgentSelection({ visibleAgents });
  const { selectedConversationAgents, setSelectedConversationAgents, setAgentSearchQuery } = agentSelection;

  const isSearchingChannels = Boolean(channelQuery.trim());
  const uploadingAttachmentCount = pendingAttachments.filter((item) => item.status === "uploading").length;
  const readyAttachments = pendingAttachments
    .filter((item) => item.status === "ready" && item.uploaded)
    .map((item) => item.uploaded as UploadedAttachment);
  const hasAttachmentErrors = pendingAttachments.some((item) => item.status === "error");
  const activeChannelManageable = canManageUserChannel(activeChannel, userId);
  const activeChannelCanPost = activeChannel ? activeChannel.canPost !== false : false;
  const conversation = useStartConversation({
    username,
    selectedConversationAgents,
    startConversation,
    refreshChannels,
    expandChannelGroup: (group) =>
      setCollapsedChannelGroups((current) => ({ ...current, [group]: false })),
    setError,
    setLoading,
    setSelectedConversationAgents,
    setAgentSearchQuery,
    setChannelQuery,
    setShowConversationDialog
  });
  const { conversationName, setConversationName, setConversationDescription, setConversationVisibility } =
    conversation;
  const canStartConversation =
    Boolean(conversationName.trim()) || selectedConversationAgents.length === 1;

  const channelManagement = useChannelManagement({
    activeChannel,
    activeChannelId,
    username,
    updateChannelSettings,
    deleteChannel,
    confirm: (message) => confirmPort.confirm(message),
    refreshChannels,
    setError,
    setLoading,
    setShowArchivedChannels,
    setShowChannelManageDialog
  });

  const { loadMessageNotifications } = useWorkspaceShell({
    authenticated,
    sessionState,
    activeChannelId,
    userId,
    username,
    channels,
    viewerTeamIds,
    timelineItemCount: timelineItems.length,
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
  });

  const { wsConnected } = useRealtimeFeed({
    sessionState,
    visibleChannels,
    activeChannelIdRef,
    channelsRef,
    usernameRef,
    userIdRef,
    viewerTeamIdsRef,
    loadMessages,
    loadMessageNotifications,
    setEvents,
    setHasNewMessagesBelow,
    recordActiveChannelEvent,
    incrementUnreadForInactiveChannel,
    isMessagesPanelNearBottom,
    scrollMessagesToBottom
  });

  function handleSignedOut() {
    resetForSignOut();
    setEvents([]);
    deepLink.updateChannelDeepLink(null, true);
    setChannelQuery("");
    setConversationName("");
    setConversationDescription("");
    setConversationVisibility("PRIVATE");
    setSelectedConversationAgents([]);
    setAgentSearchQuery("");
    setShowArchivedChannels(false);
    setShowConversationDialog(false);
    setHasNewMessagesBelow(false);
    setExpandedTraceEventId(null);
    resetUnreadTracking();
  }

  const { sending, handleSubmit } = useComposerSend({
    sendMessage,
    activeChannelId,
    activeChannel,
    activeChannelCanPost,
    uploadingAttachmentCount,
    readyAttachments,
    draft,
    username,
    wsConnected,
    composerTextareaRef,
    setError,
    setDraft,
    setPendingAttachments,
    setHasNewMessagesBelow,
    scrollMessagesToBottom,
    loadMessages
  });

  return (
    <AuthGate
      sessionState={sessionState}
      error={error}
      username={username}
      loginUsername={loginUsername}
      loginPassword={loginPassword}
      authLoading={authLoading}
      setLoginUsername={setLoginUsername}
      setLoginPassword={setLoginPassword}
      handleLogin={handleLogin}
      newPassword={newPassword}
      confirmPassword={confirmPassword}
      setNewPassword={setNewPassword}
      setConfirmPassword={setConfirmPassword}
      handlePasswordUpdate={handlePasswordUpdate}
      handleLogout={handleLogout}
    >
      <WorkspaceLayout
        mobileSidebarOpen={mobileSidebarOpen}
        onCloseMobileSidebar={() => setMobileSidebarOpen(false)}
        error={error}
        loading={loading}
        sidebar={{
          mobileOpen: mobileSidebarOpen,
          username,
          loading,
          channelQuery,
          isSearchingChannels,
          groupedChannels,
          collapsedChannelGroups,
          filteredChannels,
          filteredArchivedChannels,
          showArchivedChannels,
          activeChannelId,
          unreadCounts,
          onCloseMobile: () => setMobileSidebarOpen(false),
          onChannelQueryChange: setChannelQuery,
          onToggleChannelGroup: (groupId) =>
            setCollapsedChannelGroups((current) => ({
              ...current,
              [groupId]: !current[groupId]
            })),
          onToggleArchivedChannels: () => setShowArchivedChannels((current) => !current),
          onSelectChannel: selectChannel,
          onNewConversation: () => setShowConversationDialog(true),
          onLogout: () => void handleLogout()
        }}
        header={{
          activeChannel,
          username,
          activeChannelCanPost,
          activeChannelManageable,
          onOpenMobileSidebar: () => setMobileSidebarOpen(true),
          onManageChannel: () => setShowChannelManageDialog(true)
        }}
        chatStack={{
          messagesPanelRef,
          handleMessagesScroll,
          isConversationEmpty,
          messagesLoading,
          hasOlderMessages,
          loadingOlderMessages,
          handleLoadOlderMessages,
          timelineItems,
          activeChannelCanPost,
          activeChannel,
          activeChannelId,
          username,
          revealedSensitiveByEvent,
          sensitiveRevealErrors,
          sensitiveRevealPasswords,
          revealingSensitiveEventId,
          handleSensitivePasswordChange,
          handleRevealSensitive,
          handleHideSensitive,
          expandedTraceEventId,
          setExpandedTraceEventId,
          hasNewMessagesBelow,
          setHasNewMessagesBelow,
          scrollMessagesToBottom,
          composer: {
            textareaRef: composerTextareaRef,
            fileInputRef,
            isConversationEmpty,
            activeChannelId,
            activeChannel,
            activeChannelCanPost,
            username,
            draft,
            setDraft,
            sending,
            offlineAgentNames,
            pendingAttachments,
            setPendingAttachments,
            readyAttachments,
            uploadingAttachmentCount,
            hasAttachmentErrors,
            uploadFiles,
            handlePickFiles,
            handleSubmit
          }
        }}
        activityPanel={{
          channel: activeChannel,
          agents,
          events,
          agentIsThinking
        }}
        dialogs={{
          showConversationDialog,
          showParticipantsDialog,
          showChannelManageDialog,
          setShowConversationDialog,
          setShowParticipantsDialog,
          setShowChannelManageDialog,
          activeChannel,
          activeChannelManageable,
          loading,
          canStartConversation,
          visibleAgents,
          humans,
          conversation,
          agentSelection,
          participants,
          shares,
          shareLink,
          channelManagement
        }}
      />
    </AuthGate>
  );
}
