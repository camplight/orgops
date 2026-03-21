import { useEffect, useRef } from "react";
import type { EventRow } from "../types";

type ProcessOutputMessage = {
  topic: string;
  data: { seq?: number; stream?: string; text?: string; ts?: number };
};

type UseWebSocketOptions = {
  authenticated: boolean;
  onAgentStatus: (agentName: string, runtimeState: string) => void;
  onEvent: (event: EventRow) => void;
  onProcessOutput: (processId: string, data: ProcessOutputMessage["data"]) => void;
  activeChannelId: string | null;
  activeProcessId: string | null;
};

export function useWebSocket({
  authenticated,
  onAgentStatus,
  onEvent,
  onProcessOutput,
  activeChannelId,
  activeProcessId
}: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const subscribedTopics = useRef<Set<string>>(new Set());
  const activeChannelTopicRef = useRef<string | null>(null);
  const activeProcessTopicRef = useRef<string | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const shouldReconnectRef = useRef(true);
  const onAgentStatusRef = useRef(onAgentStatus);
  const onEventRef = useRef(onEvent);
  const onProcessOutputRef = useRef(onProcessOutput);

  useEffect(() => {
    onAgentStatusRef.current = onAgentStatus;
  }, [onAgentStatus]);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    onProcessOutputRef.current = onProcessOutput;
  }, [onProcessOutput]);

  const subscribeTopic = (topic: string) => {
    const ws = wsRef.current;
    const isNewTopic = !subscribedTopics.current.has(topic);
    if (!isNewTopic) return;
    subscribedTopics.current.add(topic);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "subscribe", topic }));
    }
  };

  const unsubscribeTopic = (topic: string) => {
    const ws = wsRef.current;
    if (!subscribedTopics.current.has(topic)) return;
    subscribedTopics.current.delete(topic);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "unsubscribe", topic }));
    }
  };

  const ensureTopicSubscribed = (topic: string) => {
    subscribeTopic(topic);
  };

  useEffect(() => {
    if (!authenticated) return;

    shouldReconnectRef.current = true;
    const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptRef.current = 0;
        subscribedTopics.current.add("org:agentStatus");
        subscribedTopics.current.add("org:events");
        for (const topic of subscribedTopics.current) {
          ws.send(JSON.stringify({ type: "subscribe", topic }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "agent_status") {
            onAgentStatusRef.current(msg.data.agentName, msg.data.runtimeState);
          }
          if (msg.type === "event") {
            onEventRef.current(msg.data);
          }
          if (msg.type === "process_output") {
            const processId = msg.topic.split(":")[1];
            if (processId) onProcessOutputRef.current(processId, msg.data);
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onerror = () => {
        // Trigger onclose, where reconnect scheduling is centralized.
        ws.close();
      };

      ws.onclose = () => {
        if (!shouldReconnectRef.current) return;
        const delay = Math.min(5000, 400 * 2 ** reconnectAttemptRef.current);
        reconnectAttemptRef.current += 1;
        clearReconnectTimer();
        reconnectTimerRef.current = window.setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      shouldReconnectRef.current = false;
      clearReconnectTimer();
      wsRef.current?.close();
      wsRef.current = null;
      reconnectAttemptRef.current = 0;
      subscribedTopics.current.clear();
      activeChannelTopicRef.current = null;
      activeProcessTopicRef.current = null;
    };
  }, [authenticated]);

  useEffect(() => {
    const nextTopic = activeChannelId ? `channel:${activeChannelId}` : null;
    const prevTopic = activeChannelTopicRef.current;
    if (prevTopic && prevTopic !== nextTopic) {
      unsubscribeTopic(prevTopic);
    }
    if (nextTopic) {
      ensureTopicSubscribed(nextTopic);
    }
    activeChannelTopicRef.current = nextTopic;
  }, [activeChannelId]);

  useEffect(() => {
    const nextTopic = activeProcessId ? `process:${activeProcessId}` : null;
    const prevTopic = activeProcessTopicRef.current;
    if (prevTopic && prevTopic !== nextTopic) {
      unsubscribeTopic(prevTopic);
    }
    if (nextTopic) {
      ensureTopicSubscribed(nextTopic);
    }
    activeProcessTopicRef.current = nextTopic;
  }, [activeProcessId]);
}
