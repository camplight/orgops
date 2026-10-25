import {
  useEffect,
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
import { ChangePasswordScreen } from "./ui/auth/change-password-screen";
import { ChatStack } from "./ui/workspace/chat-stack";
import { Sidebar } from "./ui/sidebar/sidebar";
import { ActivityPanel } from "./ui/activity/activity-panel";
import { ConversationDialog } from "./ui/dialogs/conversation-dialog";
import { ParticipantsDialog } from "./ui/dialogs/participants-dialog";
import { ChannelManageDialog } from "./ui/dialogs/channel-manage-dialog";
import { LoginScreen } from "./ui/auth/login-screen";
import type { Channel, UploadedAttachment } from "./types";
import {
  canManageUserChannel,
  channelLabel,
  type ChannelGroupId
} from "./domain/conversations/channel-rules";

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
  const [collapsedChannelGroups, setCollapsedChannelGroups] = useState<Record<ChannelGroupId, boolean>>({
    channels: false,
    direct: false,
    shared: false
  });
  const [hasNewMessagesBelow, setHasNewMessagesBelow] = useState(false);
  const { messagesPanelRef, scrollMessagesToBottom, isMessagesPanelNearBottom, handleMessagesScroll } =
    useMessagesScroll({ hasNewMessagesBelow, setHasNewMessagesBelow });
  const [channelQuery, setChannelQuery] = useState("");
  const [showArchivedChannels, setShowArchivedChannels] = useState(false);
  const [showConversationDialog, setShowConversationDialog] = useState(false);
  const [showParticipantsDialog, setShowParticipantsDialog] = useState(false);
  const [showChannelManageDialog, setShowChannelManageDialog] = useState(false);
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
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
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
  const {
    participantKind,
    participantValue,
    participantSubmitting,
    participantRemovingKey,
    setParticipantKind,
    setParticipantValue,
    handleAddParticipant,
    handleRemoveParticipant
  } = useParticipants({
    activeChannelId,
    addParticipant,
    removeParticipant,
    refreshChannels,
    setError
  });
  const {
    shareKind,
    shareValue,
    shareSubmitting,
    shareRemovingKey,
    setShareKind,
    setShareValue,
    handleAddShare,
    handleRemoveShare
  } = useShares({
    activeChannelId,
    addShare,
    removeShare,
    refreshChannels,
    setError
  });
  const { shareLinkCopied, handleCopyShareLink } = useShareLink({
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

  useEffect(() => {
    channelsRef.current = channels;
  }, [channels]);

  useEffect(() => {
    usernameRef.current = username;
  }, [username]);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

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

  const {
    selectedConversationAgents,
    setSelectedConversationAgents,
    agentSearchQuery,
    setAgentSearchQuery,
    selectedConversationAgentRecords,
    agentSuggestions,
    addConversationAgent,
    removeConversationAgent
  } = useConversationAgentSelection({ visibleAgents });

  useEffect(() => {
    viewerTeamIdsRef.current = viewerTeamIds;
  }, [viewerTeamIds]);
  const isSearchingChannels = Boolean(channelQuery.trim());
  const uploadingAttachmentCount = pendingAttachments.filter((item) => item.status === "uploading").length;
  const readyAttachments = pendingAttachments
    .filter((item) => item.status === "ready" && item.uploaded)
    .map((item) => item.uploaded as UploadedAttachment);
  const hasAttachmentErrors = pendingAttachments.some((item) => item.status === "error");
  const activeChannelManageable = canManageUserChannel(activeChannel, userId);
  const activeChannelCanPost = activeChannel ? activeChannel.canPost !== false : false;
  const {
    conversationName,
    conversationDescription,
    conversationVisibility,
    setConversationName,
    setConversationDescription,
    setConversationVisibility,
    handleStartConversation
  } = useStartConversation({
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
  const canStartConversation =
    Boolean(conversationName.trim()) || selectedConversationAgents.length === 1;

  const {
    channelVisibilityDraft,
    archiveDraft,
    updatingChannelVisibility,
    setChannelVisibilityDraft,
    setArchiveDraft,
    handleDeleteChannel,
    handleSaveChannelSettings
  } = useChannelManagement({
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
  }, [activeChannelId, messagesLoading, timelineItems.length]);

  useEffect(() => {
    if (sessionState !== "ready") return;
    void loadMessageNotifications();
  }, [sessionState, channels]);

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

        <ChatStack
          messagesPanelRef={messagesPanelRef}
          handleMessagesScroll={handleMessagesScroll}
          isConversationEmpty={isConversationEmpty}
          messagesLoading={messagesLoading}
          hasOlderMessages={hasOlderMessages}
          loadingOlderMessages={loadingOlderMessages}
          handleLoadOlderMessages={handleLoadOlderMessages}
          timelineItems={timelineItems}
          activeChannelCanPost={activeChannelCanPost}
          activeChannel={activeChannel}
          activeChannelId={activeChannelId}
          username={username}
          revealedSensitiveByEvent={revealedSensitiveByEvent}
          sensitiveRevealErrors={sensitiveRevealErrors}
          sensitiveRevealPasswords={sensitiveRevealPasswords}
          revealingSensitiveEventId={revealingSensitiveEventId}
          handleSensitivePasswordChange={handleSensitivePasswordChange}
          handleRevealSensitive={handleRevealSensitive}
          handleHideSensitive={handleHideSensitive}
          expandedTraceEventId={expandedTraceEventId}
          setExpandedTraceEventId={setExpandedTraceEventId}
          hasNewMessagesBelow={hasNewMessagesBelow}
          setHasNewMessagesBelow={setHasNewMessagesBelow}
          scrollMessagesToBottom={scrollMessagesToBottom}
          composer={{
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
          }}
        />
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
