import type { ConversationGateway } from "../../ports/conversation-gateway";

export function createRemoveParticipant(options: { conversationGateway: ConversationGateway }) {
  const { conversationGateway } = options;
  return async function removeParticipant(input: {
    channelId: string;
    subscriberType: string;
    subscriberId: string;
  }): Promise<void> {
    await conversationGateway.unsubscribe({
      channelId: input.channelId,
      subscriberType: input.subscriberType,
      subscriberId: input.subscriberId
    });
  };
}
