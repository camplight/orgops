import type { Clipboard } from "../../ports/clipboard";
import type { ConversationGateway } from "../../ports/conversation-gateway";
import type { DeepLink } from "../../ports/deep-link";

export function createCopyShareLink(options: {
  conversationGateway: ConversationGateway;
  deepLink: DeepLink;
  clipboard: Clipboard;
}) {
  const { conversationGateway, deepLink, clipboard } = options;
  return async function copyShareLink(input: { channelId: string }): Promise<void> {
    const created = await conversationGateway.createShareLink({ channelId: input.channelId });
    const shareLink = deepLink.buildShareLink({ token: created.token, channelId: created.channelId });
    await clipboard.writeText(shareLink);
  };
}
