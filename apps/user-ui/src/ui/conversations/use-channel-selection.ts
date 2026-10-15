import type { Channel } from "../../types";

export function useChannelSelection(options: {
  activeChannelId: string | null;
  userId: string | null;
  username: string;
  viewerTeamIds: Set<string>;
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
}) {
  const {
    activeChannelId,
    userId,
    username,
    viewerTeamIds,
    selectChannelUseCase,
    refreshChannelsUseCase,
    setChannels,
    setActiveChannelId,
    setMobileSidebarOpen
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

  return { selectChannel, refreshChannels };
}
