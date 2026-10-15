import type { ConversationGateway } from "../../ports/conversation-gateway";

export function createAddShare(options: { conversationGateway: ConversationGateway }) {
  const { conversationGateway } = options;
  return async function addShare(input: {
    channelId: string;
    viewerType: "HUMAN" | "AGENT";
    viewerId: string;
  }): Promise<void> {
    await conversationGateway.shareChannel({
      channelId: input.channelId,
      viewerType: input.viewerType,
      viewerId: input.viewerId.trim()
    });
  };
}
