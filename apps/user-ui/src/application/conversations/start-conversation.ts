import type { ConversationGateway } from "../../ports/conversation-gateway";

export function createStartConversation(options: { conversationGateway: ConversationGateway }) {
  const { conversationGateway } = options;
  return async function startConversation(input: {
    name: string;
    description: string;
    visibility: "PUBLIC" | "PRIVATE";
    selectedAgents: string[];
    username: string;
    onChannelReady: (group: "direct" | "channels") => void;
  }): Promise<{ channelId: string }> {
    const { name, description, visibility, selectedAgents, username, onChannelReady } = input;
    if (!name) {
      const direct = await conversationGateway.openDirectChannel({ agentName: selectedAgents[0] });
      onChannelReady("direct");
      return { channelId: direct.id };
    }
    const created = await conversationGateway.createChannel({
      name,
      description: description || undefined,
      visibility
    });
    await Promise.all([
      username
        ? conversationGateway
            .subscribe({ channelId: created.id, subscriberType: "HUMAN", subscriberId: username })
            .catch(() => undefined)
        : Promise.resolve(),
      ...selectedAgents.map((agentName) =>
        conversationGateway.subscribe({
          channelId: created.id,
          subscriberType: "AGENT",
          subscriberId: agentName
        })
      )
    ]);
    onChannelReady("channels");
    return { channelId: created.id };
  };
}
