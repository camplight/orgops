import type { ChangeEvent, ClipboardEvent, RefObject } from "react";
import { channelLabel } from "../../domain/conversations/channel-rules";
import type { Channel } from "../../types";

type ComposerTextareaProps = {
  textareaRef: RefObject<HTMLTextAreaElement>;
  value: string;
  activeChannel: Channel | null;
  activeChannelCanPost: boolean;
  sending: boolean;
  isConversationEmpty: boolean;
  username: string;
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
};

export function ComposerTextarea({
  textareaRef,
  value,
  activeChannel,
  activeChannelCanPost,
  sending,
  isConversationEmpty,
  username,
  onChange,
  onPaste
}: ComposerTextareaProps) {
  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={onChange}
      onPaste={onPaste}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.currentTarget.form?.requestSubmit();
        }
      }}
      placeholder={
        activeChannel?.archivedAt
          ? "Restore this channel to send messages"
          : activeChannel && !activeChannelCanPost
            ? "This channel is shared with you as read-only"
          : activeChannel
            ? isConversationEmpty
              ? `Message ${channelLabel(activeChannel, username)}`
              : `Message ${channelLabel(activeChannel, username)} (Enter to send, Shift+Enter for newline)`
            : "Select a channel first"
      }
      disabled={!activeChannel || Boolean(activeChannel.archivedAt) || !activeChannelCanPost || sending}
      rows={isConversationEmpty ? 1 : 3}
    />
  );
}
