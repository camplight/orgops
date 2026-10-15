import type { RealtimeFeed, RealtimeFeedHandlers } from "../../ports/realtime-feed";
import type { EventRow } from "../../types";

type WsServerEventMessage = {
  type: "event";
  topic: string;
  data: EventRow;
};

export function createWebSocketRealtimeFeed(options: {
  url: string;
  handlers: RealtimeFeedHandlers;
}): RealtimeFeed {
  const { url, handlers } = options;
  let ws: WebSocket | null = null;
  const subscribedTopics = new Set<string>();
  let reconnectTimer: number | null = null;
  let shouldReconnect = true;
  let reconnectAttempt = 0;

  const clearReconnectTimer = () => {
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const connect = () => {
    const socket = new WebSocket(url);
    ws = socket;
    socket.onopen = () => {
      reconnectAttempt = 0;
      for (const topic of subscribedTopics) {
        socket.send(JSON.stringify({ type: "subscribe", topic }));
      }
      handlers.onOpen();
    };
    socket.onmessage = (raw) => {
      try {
        const parsed = JSON.parse(String(raw.data)) as WsServerEventMessage;
        if (parsed.type === "event" && parsed.data) {
          handlers.onEvent(parsed.data);
        }
      } catch {
      }
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      handlers.onClose();
      if (!shouldReconnect) return;
      const delay = Math.min(5000, 400 * 2 ** reconnectAttempt);
      reconnectAttempt += 1;
      clearReconnectTimer();
      reconnectTimer = window.setTimeout(connect, delay);
    };
  };

  return {
    start: () => {
      shouldReconnect = true;
      connect();
    },
    stop: () => {
      shouldReconnect = false;
      clearReconnectTimer();
      ws?.close();
      ws = null;
      reconnectAttempt = 0;
      subscribedTopics.clear();
      handlers.onClose();
    },
    setTopics: (desiredTopics) => {
      for (const topic of [...subscribedTopics]) {
        if (!desiredTopics.has(topic)) {
          subscribedTopics.delete(topic);
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "unsubscribe", topic }));
          }
        }
      }
      for (const topic of desiredTopics) {
        if (!subscribedTopics.has(topic)) {
          subscribedTopics.add(topic);
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "subscribe", topic }));
          }
        }
      }
    }
  };
}
