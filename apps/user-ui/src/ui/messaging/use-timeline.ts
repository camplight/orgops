import { useRef, useState, type MutableRefObject, type RefObject } from "react";
import { mergeEventsChronologically } from "../../domain/messaging/event-ordering";
import { isHiddenUiActionMessage } from "../../domain/messaging/event-interpretation";
import { isTraceEvent } from "../../domain/messaging/trace-rules";
import type { EventRow } from "../../types";
import type { createLoadLatestTimeline } from "../../application/messaging/load-latest-timeline";
import type { createLoadOlderTimeline } from "../../application/messaging/load-older-timeline";

type LoadLatestTimeline = ReturnType<typeof createLoadLatestTimeline>;
type LoadOlderTimeline = ReturnType<typeof createLoadOlderTimeline>;

function adaptiveMessageBatchSize() {
  const connection = (
    navigator as Navigator & {
      connection?: { downlink?: number; effectiveType?: string; saveData?: boolean };
    }
  ).connection;
  if (connection?.saveData) return 12;
  const effectiveType = connection?.effectiveType ?? "";
  if (effectiveType.includes("2g")) return 10;
  if (effectiveType.includes("3g")) return 20;
  if (typeof connection?.downlink === "number") {
    if (connection.downlink >= 10) return 50;
    if (connection.downlink >= 5) return 40;
  }
  return 30;
}

export function useTimeline(options: {
  activeChannelId: string | null;
  activeChannelIdRef: MutableRefObject<string | null>;
  lastSeenByChannelRef: MutableRefObject<Record<string, number>>;
  lastLoadedMessageAtByChannelRef: MutableRefObject<Record<string, number>>;
  lastLoadedTimelineAtByChannelRef: MutableRefObject<Record<string, number>>;
  clearUnreadForChannel: (channelId: string) => void;
  messagesPanelRef: RefObject<HTMLElement | null>;
  scrollMessagesToBottom: (behavior?: ScrollBehavior) => void;
  isMessagesPanelNearBottom: () => boolean;
  setHasNewMessagesBelow: (value: boolean) => void;
  setError: (error: string | null) => void;
  loadLatestTimeline: LoadLatestTimeline;
  loadOlderTimeline: LoadOlderTimeline;
}) {
  const {
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
  } = options;
  const messageFetchSeqRef = useRef(0);
  const loadingChannelIdRef = useRef<string | null>(null);
  const forceScrollToBottomOnLoadRef = useRef(false);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);

  function newestMessageTime(channelEvents: EventRow[]) {
    return channelEvents.reduce((newest, event) => {
      if (isHiddenUiActionMessage(event)) return newest;
      if (event.type !== "message.created" && event.type !== "agent.turn.failed") return newest;
      return Math.max(newest, event.createdAt ?? 0);
    }, 0);
  }

  function newestTimelineEventTime(channelEvents: EventRow[]) {
    return channelEvents.reduce((newest, event) => {
      if (isHiddenUiActionMessage(event)) return newest;
      if (event.type !== "message.created" && !isTraceEvent(event)) return newest;
      return Math.max(newest, event.createdAt ?? 0);
    }, 0);
  }

  function markChannelSeen(channelId: string, channelEvents: EventRow[]) {
    const newestMessageAt = newestMessageTime(channelEvents);
    if (newestMessageAt > 0) {
      lastSeenByChannelRef.current[channelId] = Math.max(
        lastSeenByChannelRef.current[channelId] ?? 0,
        newestMessageAt
      );
    }
    clearUnreadForChannel(channelId);
  }

  async function loadMessages(
    channelId: string,
    options?: { scrollToBottom?: boolean; showLoading?: boolean; scrollBehavior?: ScrollBehavior }
  ) {
    const fetchSeq = messageFetchSeqRef.current + 1;
    messageFetchSeqRef.current = fetchSeq;
    const limit = adaptiveMessageBatchSize();
    if (options?.showLoading) {
      loadingChannelIdRef.current = channelId;
      setMessagesLoading(true);
    }
    try {
      const timeline = await loadLatestTimeline({
        channelId,
        limit,
        isStale: () => fetchSeq !== messageFetchSeqRef.current || channelId !== activeChannelIdRef.current
      });
      if (!timeline) {
        return;
      }
      const { nextEvents } = timeline;
      const chronologicalEvents = [...nextEvents].reverse();
      const previousNewestMessageAt = lastLoadedMessageAtByChannelRef.current[channelId] ?? 0;
      const nextNewestMessageAt = newestMessageTime(nextEvents);
      const previousNewestTimelineAt = lastLoadedTimelineAtByChannelRef.current[channelId] ?? 0;
      const nextNewestTimelineAt = newestTimelineEventTime(nextEvents);
      const hasNewTimelineEvents =
        previousNewestTimelineAt > 0 && nextNewestTimelineAt > previousNewestTimelineAt;

      setEvents((current) =>
        options?.showLoading ? chronologicalEvents : mergeEventsChronologically(current, chronologicalEvents)
      );
      if (options?.showLoading) {
        setHasOlderMessages(timeline.hasOlderMessages);
      }
      markChannelSeen(channelId, nextEvents);
      lastLoadedMessageAtByChannelRef.current[channelId] = Math.max(
        previousNewestMessageAt,
        nextNewestMessageAt
      );
      lastLoadedTimelineAtByChannelRef.current[channelId] = Math.max(
        previousNewestTimelineAt,
        nextNewestTimelineAt
      );
      if (options?.scrollToBottom) {
        forceScrollToBottomOnLoadRef.current = true;
        setHasNewMessagesBelow(false);
        scrollMessagesToBottom(options.scrollBehavior);
      }
      if (!options?.scrollToBottom && hasNewTimelineEvents && channelId === activeChannelIdRef.current) {
        if (isMessagesPanelNearBottom()) {
          setHasNewMessagesBelow(false);
          scrollMessagesToBottom();
        } else {
          setHasNewMessagesBelow(true);
        }
      }
    } catch (loadError) {
      if (fetchSeq === messageFetchSeqRef.current) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load messages");
      }
    } finally {
      if (
        loadingChannelIdRef.current === channelId &&
        fetchSeq === messageFetchSeqRef.current
      ) {
        loadingChannelIdRef.current = null;
        setMessagesLoading(false);
      }
    }
  }

  async function handleLoadOlderMessages() {
    if (!activeChannelId || events.length === 0 || loadingOlderMessages) return;
    const oldestEventAt = events[0]?.createdAt;
    if (!oldestEventAt) return;
    const channelId = activeChannelId;
    const limit = adaptiveMessageBatchSize();
    const panel = messagesPanelRef.current;
    const previousScrollHeight = panel?.scrollHeight ?? 0;

    setLoadingOlderMessages(true);
    setError(null);
    try {
      const { olderEvents, hasOlderMessages: nextHasOlderMessages } = await loadOlderTimeline({
        channelId,
        limit,
        before: oldestEventAt
      });
      if (channelId !== activeChannelIdRef.current) return;
      const chronologicalOlderEvents = [...olderEvents].reverse();
      setEvents((current) => {
        const existingIds = new Set(current.map((event) => event.id));
        return [
          ...chronologicalOlderEvents.filter((event) => !existingIds.has(event.id)),
          ...current
        ];
      });
      setHasOlderMessages(nextHasOlderMessages);
      window.requestAnimationFrame(() => {
        const currentPanel = messagesPanelRef.current;
        if (!currentPanel) return;
        currentPanel.scrollTop += currentPanel.scrollHeight - previousScrollHeight;
      });
    } catch (olderError) {
      setError(olderError instanceof Error ? olderError.message : "Unable to load previous messages");
    } finally {
      setLoadingOlderMessages(false);
    }
  }

  return {
    events,
    setEvents,
    messagesLoading,
    setMessagesLoading,
    loadingOlderMessages,
    setLoadingOlderMessages,
    hasOlderMessages,
    setHasOlderMessages,
    messageFetchSeqRef,
    loadingChannelIdRef,
    forceScrollToBottomOnLoadRef,
    loadMessages,
    handleLoadOlderMessages
  };
}
