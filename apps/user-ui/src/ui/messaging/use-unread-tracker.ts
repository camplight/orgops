import { useRef, useState, type MutableRefObject } from "react";
import { isHiddenUiActionMessage } from "../../domain/messaging/event-interpretation";
import type { MessageGateway } from "../../ports/message-gateway";
import type { Channel, EventRow } from "../../types";

type LoadMessageNotificationsOptions = {
  initialize?: boolean;
  authenticated: boolean;
  channels: Channel[];
  activeChannelIdRef: MutableRefObject<string | null>;
  messageGateway: MessageGateway;
};

export function useUnreadTracker() {
  const lastSeenByChannelRef = useRef<Record<string, number>>({});
  const lastLoadedMessageAtByChannelRef = useRef<Record<string, number>>({});
  const lastLoadedTimelineAtByChannelRef = useRef<Record<string, number>>({});
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});

  function clearUnreadForChannel(channelId: string) {
    setUnreadCounts((current) => {
      if (!current[channelId]) return current;
      const next = { ...current };
      delete next[channelId];
      return next;
    });
  }

  function recordActiveChannelEvent(event: EventRow, eventChannelId: string) {
    if (event.type === "message.created" || event.type === "agent.turn.failed") {
      const eventCreatedAt = event.createdAt ?? 0;
      if (eventCreatedAt > 0) {
        lastSeenByChannelRef.current[eventChannelId] = Math.max(
          lastSeenByChannelRef.current[eventChannelId] ?? 0,
          eventCreatedAt
        );
        lastLoadedMessageAtByChannelRef.current[eventChannelId] = Math.max(
          lastLoadedMessageAtByChannelRef.current[eventChannelId] ?? 0,
          eventCreatedAt
        );
      }
    }
    const timelineCreatedAt = event.createdAt ?? 0;
    if (timelineCreatedAt > 0) {
      lastLoadedTimelineAtByChannelRef.current[eventChannelId] = Math.max(
        lastLoadedTimelineAtByChannelRef.current[eventChannelId] ?? 0,
        timelineCreatedAt
      );
    }
    clearUnreadForChannel(eventChannelId);
  }

  function incrementUnreadForInactiveChannel(event: EventRow, eventChannelId: string) {
    const eventCreatedAt = event.createdAt ?? 0;
    if (eventCreatedAt <= (lastSeenByChannelRef.current[eventChannelId] ?? 0)) return;

    setUnreadCounts((current) => ({
      ...current,
      [eventChannelId]: (current[eventChannelId] ?? 0) + 1
    }));
  }

  function resetUnreadTracking() {
    setUnreadCounts({});
    lastSeenByChannelRef.current = {};
    lastLoadedMessageAtByChannelRef.current = {};
    lastLoadedTimelineAtByChannelRef.current = {};
  }

  async function loadMessageNotifications(options: LoadMessageNotificationsOptions) {
    const { authenticated, channels, activeChannelIdRef, messageGateway } = options;
    if (!authenticated) return;
    try {
      const nextEvents = await messageGateway.listRecentMessageEvents();
      if (options.initialize) {
        const nextSeen = { ...lastSeenByChannelRef.current };
        for (const event of nextEvents) {
          if (!event.channelId) continue;
          nextSeen[event.channelId] = Math.max(nextSeen[event.channelId] ?? 0, event.createdAt ?? 0);
        }
        lastSeenByChannelRef.current = nextSeen;
        setUnreadCounts({});
        return;
      }

      const activeId = activeChannelIdRef.current;
      const nextCounts: Record<string, number> = {};
      for (const event of nextEvents) {
        if (!event.channelId || event.channelId === activeId) continue;
        if (isHiddenUiActionMessage(event)) continue;
        const channel = channels.find((candidate) => candidate.id === event.channelId);
        if (channel?.archivedAt) continue;
        if ((event.createdAt ?? 0) > (lastSeenByChannelRef.current[event.channelId] ?? 0)) {
          nextCounts[event.channelId] = (nextCounts[event.channelId] ?? 0) + 1;
        }
      }
      setUnreadCounts(nextCounts);
    } catch {
      // Notification polling is best-effort; active channel loading reports visible errors.
    }
  }

  return {
    unreadCounts,
    lastSeenByChannelRef,
    lastLoadedMessageAtByChannelRef,
    lastLoadedTimelineAtByChannelRef,
    clearUnreadForChannel,
    recordActiveChannelEvent,
    incrementUnreadForInactiveChannel,
    resetUnreadTracking,
    loadMessageNotifications
  };
}
