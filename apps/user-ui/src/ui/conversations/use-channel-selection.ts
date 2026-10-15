import { useEffect } from "react";
import { channelVisibleToUserUi } from "../../domain/conversations/channel-rules";
import type { Channel } from "../../types";

export function useChannelSelection(options: {
  activeChannelId: string | null;
  userId: string | null;
  username: string;
  viewerTeamIds: Set<string>;
  sessionState: string;
  channels: Channel[];
  readLinkedChannelId: () => string | null;
  selectChannelUseCase: (input: { channelId: string | null; replace?: boolean }) => void;
  refreshChannelsUseCase: (input: {
    nextActiveChannelId?: string | null;
    activeChannelId: string | null;
    userId: string | null;
    username: string;
    viewerTeamIds: Set<string>;
  }) => Promise<{ channels: Channel[]; nextSelectedChannelId: string | null }>;
  setChannels: (channels: Channel[]) => void;
  setActiveChannelId: (channelId: string | null) => void;
  setMobileSidebarOpen: (open: boolean) => void;
  setShowArchivedChannels: (show: boolean) => void;
}) {
  const {
    activeChannelId,
    userId,
    username,
    viewerTeamIds,
    sessionState,
    channels,
    readLinkedChannelId,
    selectChannelUseCase,
    refreshChannelsUseCase,
    setChannels,
    setActiveChannelId,
    setMobileSidebarOpen,
    setShowArchivedChannels
  } = options;

  function selectChannel(channelId: string | null, options?: { replace?: boolean }) {
    setActiveChannelId(channelId);
    setMobileSidebarOpen(false);
    selectChannelUseCase({ channelId, replace: options?.replace });
  }

  async function refreshChannels(nextActiveChannelId?: string | null) {
    const { channels: nextChannels, nextSelectedChannelId } = await refreshChannelsUseCase({
      nextActiveChannelId,
      activeChannelId,
      userId,
      username,
      viewerTeamIds
    });
    setChannels(nextChannels);
    selectChannel(nextSelectedChannelId, { replace: true });
    return nextChannels;
  }

  useEffect(() => {
    if (sessionState !== "ready") return;
    function handlePopState() {
      const linkedChannelId = readLinkedChannelId();
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

  return { selectChannel, refreshChannels };
}
