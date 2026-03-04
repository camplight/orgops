import { useEffect, useRef } from "react";
import type { EventRow } from "../types";

type ProcessOutputMessage = { topic: string; data: { text?: string } };

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
    const ws = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`
    );
    ws.onopen = () => {
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
          onAgentStatus(msg.data.agentName, msg.data.runtimeState);
        }
        if (msg.type === "event") {
          onEvent(msg.data);
        }
        if (msg.type === "process_output") {
          const processId = msg.topic.split(":")[1];
          if (processId) onProcessOutput(processId, msg.data);
        }
      } catch {
        // ignore parse errors
      }
    };
    wsRef.current = ws;
    return () => {
      ws.close();
      subscribedTopics.current.clear();
      activeChannelTopicRef.current = null;
      activeProcessTopicRef.current = null;
    };
  }, [authenticated, onAgentStatus, onEvent, onProcessOutput]);

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
