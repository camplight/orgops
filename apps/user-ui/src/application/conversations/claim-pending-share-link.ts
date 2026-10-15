import type { ConversationGateway } from "../../ports/conversation-gateway";
import type { DeepLink } from "../../ports/deep-link";

export function createClaimPendingShareLink(options: {
  conversationGateway: ConversationGateway;
  deepLink: DeepLink;
}) {
  const { conversationGateway, deepLink } = options;
  return async function claimPendingShareLink(): Promise<{
    claimedShareChannelId: string | null;
    errorMessage: string | null;
  }> {
    const pendingShareToken = deepLink.readPendingShareToken();
    let claimedShareChannelId: string | null = null;
    let errorMessage: string | null = null;
    if (pendingShareToken) {
      try {
        const claimed = await conversationGateway.claimShareLink({ token: pendingShareToken });
        claimedShareChannelId = claimed.channelId;
        deepLink.consumeShareToken(claimed.channelId);
      } catch (claimError) {
        deepLink.consumeShareToken(deepLink.readLinkedChannelId());
        errorMessage =
          claimError instanceof Error
            ? claimError.message
            : "Unable to claim shared channel link";
      }
    }
    return { claimedShareChannelId, errorMessage };
  };
}
