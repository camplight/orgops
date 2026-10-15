import { channelVisibleToUserUi } from "../../domain/conversations/channel-rules";
import type { ConversationGateway } from "../../ports/conversation-gateway";
import type { Channel } from "../../types";

export function createRefreshChannels(options: { conversationGateway: ConversationGateway }) {
  const { conversationGateway } = options;
  return async function refreshChannels(input: {
    nextActiveChannelId?: string | null;
    activeChannelId: string | null;
    userId: string | null;
    username: string;
    viewerTeamIds: Set<string>;
  }): Promise<{ channels: Channel[]; nextSelectedChannelId: string | null }> {
    const { nextActiveChannelId, activeChannelId, userId, username, viewerTeamIds } = input;
    const nextChannels = await conversationGateway.listChannels();
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
    return { channels: nextChannels, nextSelectedChannelId };
  };
}
