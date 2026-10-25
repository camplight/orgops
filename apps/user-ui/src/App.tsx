import {
  useMemo,
  useRef,
  useState
} from "react";
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
import { useDerivedChannels } from "./ui/conversations/use-derived-channels";
import { AuthGate } from "./ui/auth/auth-gate";
import { WorkspaceLayout } from "./ui/workspace/workspace-layout";
import { useWorkspaceShell } from "./ui/workspace/use-workspace-shell";
import { useSidebarAndDialogState } from "./ui/workspace/use-sidebar-and-dialog-state";
import { useMessagingController } from "./ui/messaging/use-messaging-controller";
import { useChatStack } from "./ui/messaging/use-chat-stack";
import type { Channel } from "./types";
import { canManageUserChannel } from "./domain/conversations/channel-rules";

import {
  messageGateway,
  loadCurrentSession,
  signIn,
  signOut,
  changePassword,
  confirmPort,
  deepLink,
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const messaging = useMessagingController({ activeChannelId, activeChannelIdRef, setError });
  const {
    unreadCounts,
    recordActiveChannelEvent,
    incrementUnreadForInactiveChannel,
    resetUnreadTracking,
    loadMessageNotificationsFor,
    setHasNewMessagesBelow,
    scrollMessagesToBottom,
    isMessagesPanelNearBottom,
    events,
    setEvents,
    messagesLoading,
    setMessagesLoading,
    setLoadingOlderMessages,
    setHasOlderMessages,
    messageFetchSeqRef,
    loadingChannelIdRef,
    forceScrollToBottomOnLoadRef,
    loadMessages,
    setExpandedTraceEventId,
    setPendingAttachments,
    timelineItems,
    agentIsThinking
  } = messaging;
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
  const activeChannel = useMemo(
    () => channels.find((channel) => channel.id === activeChannelId) ?? null,
    [activeChannelId, channels]
  );

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

  const chatStack = useChatStack({
    messaging,
    activeChannelId,
    activeChannel,
    activeChannelCanPost,
    username,
    wsConnected,
    offlineAgentNames,
    setError
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
        chatStack={chatStack}
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
