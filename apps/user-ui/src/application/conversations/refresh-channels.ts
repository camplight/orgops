import { channelVisibleToUserUi } from "../../domain/conversations/channel-rules";
import { keepOrFirstActiveChannelId } from "../../domain/conversations/active-channel";
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
        : keepOrFirstActiveChannelId({ activeChannelId, visibleChannels });
    return { channels: nextChannels, nextSelectedChannelId };
  };
}
