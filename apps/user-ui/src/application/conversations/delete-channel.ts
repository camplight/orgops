import type { ConversationGateway } from "../../ports/conversation-gateway";

export function createDeleteChannel(options: { conversationGateway: ConversationGateway }) {
  const { conversationGateway } = options;
  return async function deleteChannel(input: { channelId: string }): Promise<void> {
    await conversationGateway.deleteChannel({ channelId: input.channelId });
  };
}
