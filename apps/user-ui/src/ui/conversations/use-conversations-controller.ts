import { useMemo } from "react";
import { useParticipants } from "./use-participants";
import { useShares } from "./use-shares";
import { useShareLink } from "./use-share-link";
import { useConversationsState } from "./use-conversations-state";
import { useChannelSelection } from "./use-channel-selection";
import { useStartConversation } from "./use-start-conversation";
import { useConversationAgentSelection } from "./use-conversation-agent-selection";
import { useChannelManagement } from "./use-channel-management";
import { useDerivedChannels } from "./use-derived-channels";
import { useSidebarAndDialogState } from "../workspace/use-sidebar-and-dialog-state";
import { canManageUserChannel, type ChannelGroupId } from "../../domain/conversations/channel-rules";
import type { SessionState } from "../../domain/identity/session-state";
import {
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
  refreshChannelsUseCase
} from "../../composition-root";

export function useConversationsController(options: {
  username: string;
  userId: string | null;
  sessionState: SessionState;
  setError: (message: string | null) => void;
  setLoading: (loading: boolean) => void;
}) {
  const { username, userId, sessionState, setError, setLoading } = options;
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

  const sidebarProps = {
    mobileOpen: mobileSidebarOpen,
    username,
    channelQuery,
    isSearchingChannels,
    groupedChannels,
    collapsedChannelGroups,
    filteredChannels,
    filteredArchivedChannels,
    showArchivedChannels,
    activeChannelId,
    onCloseMobile: () => setMobileSidebarOpen(false),
    onChannelQueryChange: setChannelQuery,
    onToggleChannelGroup: (groupId: ChannelGroupId) =>
      setCollapsedChannelGroups((current) => ({
        ...current,
        [groupId]: !current[groupId]
      })),
    onToggleArchivedChannels: () => setShowArchivedChannels((current) => !current),
    onSelectChannel: selectChannel,
    onNewConversation: () => setShowConversationDialog(true)
  };

  const headerProps = {
    activeChannel,
    username,
    activeChannelCanPost,
    activeChannelManageable,
    onOpenMobileSidebar: () => setMobileSidebarOpen(true),
    onManageChannel: () => setShowChannelManageDialog(true)
  };

  const dialogsProps = {
    showConversationDialog,
    showParticipantsDialog,
    showChannelManageDialog,
    setShowConversationDialog,
    setShowParticipantsDialog,
    setShowChannelManageDialog,
    activeChannel,
    activeChannelManageable,
    canStartConversation,
    visibleAgents,
    humans,
    conversation,
    agentSelection,
    participants,
    shares,
    shareLink,
    channelManagement
  };

  return {
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
  };
}
