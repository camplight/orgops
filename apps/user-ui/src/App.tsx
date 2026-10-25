import { useRef, useState } from "react";
import { useRealtimeFeed } from "./ui/realtime/use-realtime-feed";
import { useSession } from "./ui/identity/use-session";
import { AuthGate } from "./ui/auth/auth-gate";
import { WorkspaceLayout } from "./ui/workspace/workspace-layout";
import { useWorkspaceShell } from "./ui/workspace/use-workspace-shell";
import { useMessagingController } from "./ui/messaging/use-messaging-controller";
import { useChatStack } from "./ui/messaging/use-chat-stack";
import type { Channel } from "./types";
import { useConversationsController } from "./ui/conversations/use-conversations-controller";

import {
  messageGateway,
  loadCurrentSession,
  signIn,
  signOut,
  changePassword,
  deepLink,
  claimPendingShareLinkUseCase,
  loadWorkspaceUseCase
} from "./composition-root";

export default function App() {
  const activeChannelIdRef = useRef<string | null>(null);
  const channelsRef = useRef<Channel[]>([]);
  const usernameRef = useRef("");
  const userIdRef = useRef<string | null>(null);
  const viewerTeamIdsRef = useRef<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
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
    setLoginUsername,
    newPassword,
    confirmPassword,
    setNewPassword,
    setConfirmPassword,
    handlePasswordUpdate,
    handleLogout
  } = useSession({ loadCurrentSession, signIn, signOut, changePassword, setError, onSignedOut: handleSignedOut });
  const conversations = useConversationsController({
    username,
    userId,
    sessionState,
    setError,
    setLoading
  });
  const {
    channels,
    agents,
    activeChannelId,
    activeChannel,
    activeChannelCanPost,
    viewerTeamIds,
    visibleChannels,
    offlineAgentNames,
    mobileSidebarOpen,
    setMobileSidebarOpen,
    setWorkspace,
    selectChannel,
    resetForSignOut,
    setChannelQuery,
    setConversationName,
    setConversationDescription,
    setConversationVisibility,
    setSelectedConversationAgents,
    setAgentSearchQuery,
    setShowArchivedChannels,
    setShowConversationDialog,
    setShowParticipantsDialog,
    setShowChannelManageDialog,
    sidebarProps,
    headerProps,
    dialogsProps
  } = conversations;
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
          ...sidebarProps,
          loading,
          unreadCounts,
          onLogout: () => void handleLogout()
        }}
        header={headerProps}
        chatStack={chatStack}
        activityPanel={{
          channel: activeChannel,
          agents,
          events,
          agentIsThinking
        }}
        dialogs={{ ...dialogsProps, loading }}
      />
    </AuthGate>
  );
}
