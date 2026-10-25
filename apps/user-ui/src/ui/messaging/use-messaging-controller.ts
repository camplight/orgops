import { useState, type MutableRefObject } from "react";
import { createLocalAttachmentId } from "../../infrastructure/browser/browser-local-id";
import { useSensitiveReveal } from "./use-sensitive-reveal";
import { usePendingAttachments } from "./use-pending-attachments";
import { useUnreadTracker } from "./use-unread-tracker";
import { useTimelineView } from "./use-timeline-view";
import { useTimeline } from "./use-timeline";
import { useMessagesScroll } from "./use-messages-scroll";
import {
  revealSensitive,
  loadLatestTimeline,
  loadOlderTimeline,
  uploadAttachment
} from "../../composition-root";

export function useMessagingController(options: {
  activeChannelId: string | null;
  activeChannelIdRef: MutableRefObject<string | null>;
  setError: (error: string | null) => void;
}) {
  const { activeChannelId, activeChannelIdRef, setError } = options;
  const {
    unreadCounts,
    recordActiveChannelEvent,
    incrementUnreadForInactiveChannel,
    lastSeenByChannelRef,
    lastLoadedMessageAtByChannelRef,
    lastLoadedTimelineAtByChannelRef,
    clearUnreadForChannel,
    resetUnreadTracking,
    loadMessageNotifications: loadMessageNotificationsFor
  } = useUnreadTracker();
  const [hasNewMessagesBelow, setHasNewMessagesBelow] = useState(false);
  const { messagesPanelRef, scrollMessagesToBottom, isMessagesPanelNearBottom, handleMessagesScroll } =
    useMessagesScroll({ hasNewMessagesBelow, setHasNewMessagesBelow });
  const {
    events,
    setEvents,
    messagesLoading,
    setMessagesLoading,
    loadingOlderMessages,
    setLoadingOlderMessages,
    setHasOlderMessages,
    hasOlderMessages,
    messageFetchSeqRef,
    loadingChannelIdRef,
    forceScrollToBottomOnLoadRef,
    loadMessages,
    handleLoadOlderMessages
  } = useTimeline({
    activeChannelId,
    activeChannelIdRef,
    lastSeenByChannelRef,
    lastLoadedMessageAtByChannelRef,
    lastLoadedTimelineAtByChannelRef,
    clearUnreadForChannel,
    messagesPanelRef,
    scrollMessagesToBottom,
    isMessagesPanelNearBottom,
    setHasNewMessagesBelow,
    setError,
    loadLatestTimeline,
    loadOlderTimeline
  });
  const {
    sensitiveRevealPasswords,
    revealedSensitiveByEvent,
    revealingSensitiveEventId,
    sensitiveRevealErrors,
    handleRevealSensitive,
    handleHideSensitive,
    handleSensitivePasswordChange
  } = useSensitiveReveal({ revealSensitive });
  const [expandedTraceEventId, setExpandedTraceEventId] = useState<string | null>(null);
  const { pendingAttachments, setPendingAttachments, uploadFiles, handlePickFiles } = usePendingAttachments({
    uploadAttachment,
    createLocalAttachmentId
  });
  const { timelineItems, agentIsThinking } = useTimelineView({ events });
  const isConversationEmpty = !messagesLoading && timelineItems.length === 0;

  return {
    unreadCounts,
    recordActiveChannelEvent,
    incrementUnreadForInactiveChannel,
    resetUnreadTracking,
    loadMessageNotificationsFor,
    hasNewMessagesBelow,
    setHasNewMessagesBelow,
    messagesPanelRef,
    scrollMessagesToBottom,
    isMessagesPanelNearBottom,
    handleMessagesScroll,
    events,
    setEvents,
    messagesLoading,
    setMessagesLoading,
    loadingOlderMessages,
    setLoadingOlderMessages,
    setHasOlderMessages,
    hasOlderMessages,
    messageFetchSeqRef,
    loadingChannelIdRef,
    forceScrollToBottomOnLoadRef,
    loadMessages,
    handleLoadOlderMessages,
    sensitiveRevealPasswords,
    revealedSensitiveByEvent,
    revealingSensitiveEventId,
    sensitiveRevealErrors,
    handleRevealSensitive,
    handleHideSensitive,
    handleSensitivePasswordChange,
    expandedTraceEventId,
    setExpandedTraceEventId,
    pendingAttachments,
    setPendingAttachments,
    uploadFiles,
    handlePickFiles,
    timelineItems,
    agentIsThinking,
    isConversationEmpty
  };
}

export type MessagingController = ReturnType<typeof useMessagingController>;
