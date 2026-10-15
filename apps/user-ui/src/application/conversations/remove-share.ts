import type { ConversationGateway } from "../../ports/conversation-gateway";

export function createRemoveShare(options: { conversationGateway: ConversationGateway }) {
  const { conversationGateway } = options;
  return async function removeShare(input: {
    channelId: string;
    viewerType: string;
    viewerId: string;
  }): Promise<void> {
    await conversationGateway.unshareChannel({
      channelId: input.channelId,
      viewerType: input.viewerType,
      viewerId: input.viewerId
    });
  };
}
