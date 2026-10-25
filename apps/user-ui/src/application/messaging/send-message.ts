import type { MessageGateway } from "../../ports/message-gateway";
import type { UploadedAttachment } from "../../types";

export function createSendMessage(options: { messageGateway: MessageGateway }) {
  const { messageGateway } = options;
  return async function sendMessage(input: {
    trimmedText: string;
    attachments: UploadedAttachment[];
    username: string;
    channelId: string;
  }): Promise<void> {
    const { trimmedText, attachments, username, channelId } = input;
    const effectiveText =
      trimmedText ||
      `Attached ${attachments.length} file${attachments.length === 1 ? "" : "s"} for reference.`;
    await messageGateway.sendMessage({
      text: effectiveText,
      attachments,
      username,
      channelId
    });
  };
}
