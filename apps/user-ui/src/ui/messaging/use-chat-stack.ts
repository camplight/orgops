import { useRef, useState } from "react";
import { useComposerSend } from "./use-composer-send";
import { sendMessage } from "../../composition-root";
import type { Channel, UploadedAttachment } from "../../types";
import type { MessagingController } from "./use-messaging-controller";

export function useChatStack(options: {
  messaging: MessagingController;
  activeChannelId: string | null;
  activeChannel: Channel | null;
  activeChannelCanPost: boolean;
  username: string;
  wsConnected: boolean;
  offlineAgentNames: string[];
  setError: (error: string | null) => void;
}) {
  const {
    messaging,
    activeChannelId,
    activeChannel,
    activeChannelCanPost,
    username,
    wsConnected,
    offlineAgentNames,
    setError
  } = options;
  const {
    messagesPanelRef,
    handleMessagesScroll,
    isConversationEmpty,
    messagesLoading,
    hasOlderMessages,
    loadingOlderMessages,
    handleLoadOlderMessages,
    timelineItems,
    revealedSensitiveByEvent,
    sensitiveRevealErrors,
    sensitiveRevealPasswords,
    revealingSensitiveEventId,
    handleSensitivePasswordChange,
    handleRevealSensitive,
    handleHideSensitive,
    expandedTraceEventId,
    setExpandedTraceEventId,
    hasNewMessagesBelow,
    setHasNewMessagesBelow,
    scrollMessagesToBottom,
    pendingAttachments,
    setPendingAttachments,
    uploadFiles,
    handlePickFiles,
    loadMessages
  } = messaging;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [draft, setDraft] = useState("");
  const uploadingAttachmentCount = pendingAttachments.filter((item) => item.status === "uploading").length;
  const readyAttachments = pendingAttachments
    .filter((item) => item.status === "ready" && item.uploaded)
    .map((item) => item.uploaded as UploadedAttachment);
  const hasAttachmentErrors = pendingAttachments.some((item) => item.status === "error");

  const { sending, handleSubmit } = useComposerSend({
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
  });

  return {
    messagesPanelRef,
    handleMessagesScroll,
    isConversationEmpty,
    messagesLoading,
    hasOlderMessages,
    loadingOlderMessages,
    handleLoadOlderMessages,
    timelineItems,
    activeChannelCanPost,
    activeChannel,
    activeChannelId,
    username,
    revealedSensitiveByEvent,
    sensitiveRevealErrors,
    sensitiveRevealPasswords,
    revealingSensitiveEventId,
    handleSensitivePasswordChange,
    handleRevealSensitive,
    handleHideSensitive,
    expandedTraceEventId,
    setExpandedTraceEventId,
    hasNewMessagesBelow,
    setHasNewMessagesBelow,
    scrollMessagesToBottom,
    composer: {
      textareaRef: composerTextareaRef,
      fileInputRef,
      isConversationEmpty,
      activeChannelId,
      activeChannel,
      activeChannelCanPost,
      username,
      draft,
      setDraft,
      sending,
      offlineAgentNames,
      pendingAttachments,
      setPendingAttachments,
      readyAttachments,
      uploadingAttachmentCount,
      hasAttachmentErrors,
      uploadFiles,
      handlePickFiles,
      handleSubmit
    }
  };
}
