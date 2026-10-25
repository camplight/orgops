import { useState } from "react";
import type { ChannelGroupId } from "../../domain/conversations/channel-rules";

export function useSidebarAndDialogState() {
  const [collapsedChannelGroups, setCollapsedChannelGroups] = useState<Record<ChannelGroupId, boolean>>({
    channels: false,
    direct: false,
    shared: false
  });
  const [channelQuery, setChannelQuery] = useState("");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [showArchivedChannels, setShowArchivedChannels] = useState(false);
  const [showConversationDialog, setShowConversationDialog] = useState(false);
  const [showParticipantsDialog, setShowParticipantsDialog] = useState(false);
  const [showChannelManageDialog, setShowChannelManageDialog] = useState(false);

  return {
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
  };
}
