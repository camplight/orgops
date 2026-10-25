import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction
} from "react";
import { wsUrl } from "../../infrastructure/http/config";
import { createWebSocketRealtimeFeed } from "../../infrastructure/websocket/websocket-realtime-feed";
import type { RealtimeFeed } from "../../ports/realtime-feed";
import { usePollingFallback } from "./use-polling-fallback";
import type { Channel, EventRow } from "../../types";
import type { SessionState } from "../../domain/identity/session-state";
import { channelVisibleToUserUi } from "../../domain/conversations/channel-rules";
import { mergeEventsChronologically } from "../../domain/messaging/event-ordering";
import { isHiddenUiActionMessage } from "../../domain/messaging/event-interpretation";
import { isTraceEvent } from "../../domain/messaging/trace-rules";

export function useRealtimeFeed(options: {
  sessionState: SessionState;
  visibleChannels: Channel[];
  activeChannelIdRef: MutableRefObject<string | null>;
  channelsRef: MutableRefObject<Channel[]>;
  usernameRef: MutableRefObject<string>;
  userIdRef: MutableRefObject<string | null>;
  viewerTeamIdsRef: MutableRefObject<Set<string>>;
  loadMessages: (channelId: string) => unknown;
  loadMessageNotifications: () => unknown;
  setEvents: Dispatch<SetStateAction<EventRow[]>>;
  setHasNewMessagesBelow: (value: boolean) => void;
  recordActiveChannelEvent: (event: EventRow, eventChannelId: string) => void;
  incrementUnreadForInactiveChannel: (event: EventRow, eventChannelId: string) => void;
  isMessagesPanelNearBottom: () => boolean;
  scrollMessagesToBottom: (behavior?: ScrollBehavior) => void;
}) {
  const {
    sessionState,
    visibleChannels,
    activeChannelIdRef,
    channelsRef,
    usernameRef,
    userIdRef,
    viewerTeamIdsRef,
    loadMessages,
    loadMessageNotifications,
    setEvents,
    setHasNewMessagesBelow,
    recordActiveChannelEvent,
    incrementUnreadForInactiveChannel,
    isMessagesPanelNearBottom,
    scrollMessagesToBottom
  } = options;
  const seenWsEventIdsRef = useRef<Set<string>>(new Set());
  const realtimeFeedRef = useRef<RealtimeFeed | null>(null);
  const [wsConnected, setWsConnected] = useState(false);

  function rememberWsEvent(eventId: string) {
    const seen = seenWsEventIdsRef.current;
    if (seen.has(eventId)) return false;
    seen.add(eventId);
    if (seen.size > 3000) {
      const first = seen.values().next();
      if (!first.done) seen.delete(first.value);
    }
    return true;
  }

  function handleIncomingRealtimeEvent(event: EventRow) {
    if (!event.id || !rememberWsEvent(event.id)) return;
    const eventChannelId = event.channelId;
    if (!eventChannelId) return;

    const currentActiveId = activeChannelIdRef.current;
    if (eventChannelId === currentActiveId && (event.type === "message.created" || isTraceEvent(event))) {
      const hiddenUiAction = isHiddenUiActionMessage(event);
      const shouldAutoScroll = isMessagesPanelNearBottom();
      if (!hiddenUiAction) {
        setEvents((current) => mergeEventsChronologically(current, [event]));
      }
      recordActiveChannelEvent(event, eventChannelId);
      if (hiddenUiAction) return;
      if (shouldAutoScroll) {
        setHasNewMessagesBelow(false);
        scrollMessagesToBottom();
      } else {
        setHasNewMessagesBelow(true);
      }
      return;
    }

    if (event.type !== "message.created") return;
    if (isHiddenUiActionMessage(event)) return;
    if (eventChannelId === currentActiveId) return;

    const channel = channelsRef.current.find((candidate) => candidate.id === eventChannelId);
    if (!channel || channel.archivedAt) return;
    if (
      !channelVisibleToUserUi(
        channel,
        userIdRef.current,
        usernameRef.current,
        viewerTeamIdsRef.current
      )
    ) {
      return;
    }
    incrementUnreadForInactiveChannel(event, eventChannelId);
  }

  useEffect(() => {
    if (sessionState !== "ready") return;
    const feed = createWebSocketRealtimeFeed({
      url: wsUrl(),
      handlers: {
        onOpen: () => {
          setWsConnected(true);
          const liveChannelId = activeChannelIdRef.current;
          if (liveChannelId) {
            void loadMessages(liveChannelId);
          }
          void loadMessageNotifications();
        },
        onClose: () => setWsConnected(false),
        onEvent: (event) => handleIncomingRealtimeEvent(event)
      }
    });
    realtimeFeedRef.current = feed;
    feed.start();

    return () => {
      feed.stop();
      realtimeFeedRef.current = null;
    };
  }, [sessionState]);

  useEffect(() => {
    if (sessionState !== "ready") return;
    const desiredTopics = new Set<string>();
    for (const channel of visibleChannels) {
      desiredTopics.add(`channel:${channel.id}`);
    }
    realtimeFeedRef.current?.setTopics(desiredTopics);
  }, [sessionState, visibleChannels]);

  usePollingFallback({
    enabled: sessionState === "ready" && !wsConnected,
    poll: () => {
      const liveChannelId = activeChannelIdRef.current;
      if (liveChannelId) void loadMessages(liveChannelId);
      void loadMessageNotifications();
    }
  });

  return { wsConnected };
}
