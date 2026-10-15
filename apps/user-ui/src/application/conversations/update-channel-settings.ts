import type { ConversationGateway } from "../../ports/conversation-gateway";
import type { Channel } from "../../types";

export function createUpdateChannelSettings(options: { conversationGateway: ConversationGateway }) {
  const { conversationGateway } = options;
  return async function updateChannelSettings(input: {
    channel: Channel;
    visibilityDraft: "PUBLIC" | "PRIVATE";
    archiveDraft: boolean;
  }): Promise<{ archivedNow: boolean }> {
    const { channel, visibilityDraft, archiveDraft } = input;
    const currentVisibility = channel.visibility === "PUBLIC" ? "PUBLIC" : "PRIVATE";
    if (visibilityDraft !== currentVisibility) {
      await conversationGateway.updateChannelVisibility({
        channelId: channel.id,
        visibility: visibilityDraft
      });
    }
    const currentlyArchived = Boolean(channel.archivedAt);
    let archivedNow = false;
    if (archiveDraft !== currentlyArchived) {
      await conversationGateway.setChannelArchived({
        channelId: channel.id,
        archived: archiveDraft
      });
      if (archiveDraft) archivedNow = true;
    }
    return { archivedNow };
  };
}
