import { useState, type FormEvent, type RefObject } from "react";
import type { Channel, UploadedAttachment } from "../../types";
import type { PendingAttachment } from "./use-pending-attachments";

export function useComposerSend(options: {
  sendMessage: (input: {
    trimmedText: string;
    attachments: UploadedAttachment[];
    username: string;
    channelId: string;
  }) => Promise<void>;
  activeChannelId: string | null;
  activeChannel: Channel | null;
  activeChannelCanPost: boolean;
  uploadingAttachmentCount: number;
  readyAttachments: UploadedAttachment[];
  draft: string;
  username: string;
  wsConnected: boolean;
  composerTextareaRef: RefObject<HTMLTextAreaElement | null>;
  setError: (error: string | null) => void;
  setDraft: (draft: string) => void;
  setPendingAttachments: (attachments: PendingAttachment[]) => void;
  setHasNewMessagesBelow: (value: boolean) => void;
  scrollMessagesToBottom: (behavior?: ScrollBehavior) => void;
  loadMessages: (channelId: string, options?: { scrollToBottom?: boolean }) => Promise<void>;
}) {
  const {
    sendMessage,
    activeChannelId,
    activeChannel,
    activeChannelCanPost,
    uploadingAttachmentCount,
    readyAttachments,
    draft,
    username,
    wsConnected,
    composerTextareaRef,
    setError,
    setDraft,
    setPendingAttachments,
    setHasNewMessagesBelow,
    scrollMessagesToBottom,
    loadMessages
  } = options;
  const [sending, setSending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeChannelId || activeChannel?.archivedAt || !activeChannelCanPost) return;
    if (uploadingAttachmentCount > 0) return;
    const trimmedText = draft.trim();
    if (!trimmedText && readyAttachments.length === 0) return;

    setSending(true);
    setError(null);
    try {
      await sendMessage({
        trimmedText,
        attachments: readyAttachments,
        username,
        channelId: activeChannelId
      });
      setDraft("");
      setPendingAttachments([]);
      setHasNewMessagesBelow(false);
      if (wsConnected) {
        scrollMessagesToBottom();
      } else {
        await loadMessages(activeChannelId, { scrollToBottom: true });
      }
      window.requestAnimationFrame(() => {
        scrollMessagesToBottom("auto");
        composerTextareaRef.current?.scrollIntoView({ block: "nearest" });
      });
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Unable to send message");
    } finally {
      setSending(false);
    }
  }

  return { sending, handleSubmit };
}
