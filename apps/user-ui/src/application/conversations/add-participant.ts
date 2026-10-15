import type { ConversationGateway } from "../../ports/conversation-gateway";

export function createAddParticipant(options: { conversationGateway: ConversationGateway }) {
  const { conversationGateway } = options;
  return async function addParticipant(input: {
    channelId: string;
    subscriberType: "HUMAN" | "AGENT";
    subscriberId: string;
  }): Promise<void> {
    await conversationGateway.subscribe({
      channelId: input.channelId,
      subscriberType: input.subscriberType,
      subscriberId: input.subscriberId.trim()
    });
  };
}
