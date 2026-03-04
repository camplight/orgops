import type { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";

import type { EventBus } from "@orgops/event-bus";

type WsMessage =
  | { type: "subscribe"; topic: string }
  | { type: "unsubscribe"; topic: string }
  | { type: "ping" };

export type WsServerMessage =
  | { type: "subscribed"; topic: string }
  | { type: "event"; topic: string; data: unknown }
  | { type: "process_output"; topic: string; data: unknown }
  | { type: "agent_status"; topic: string; data: unknown }
  | { type: "error"; message: string };

type WsDeps = {
  bus: EventBus<WsServerMessage>;
};

export function registerWsRoutes(app: Hono<any>, deps: WsDeps) {
  const { bus } = deps;

  app.get(
    "/ws",
    upgradeWebSocket(() => {
      const subscriptions = new Set<string>();
      const unsubscribeByTopic = new Map<string, () => void>();
      const send = (ws: { send: (data: string) => void }, data: WsServerMessage) =>
        ws.send(JSON.stringify(data));
      return {
        onMessage: (event, ws) => {
          const message = JSON.parse(event.data.toString()) as WsMessage;
          if (message.type === "ping") {
            return send(ws, { type: "subscribed", topic: "pong" });
          }
          if (message.type === "subscribe") {
            subscriptions.add(message.topic);
            const unsubscribe = bus.subscribe(message.topic, (payload) => send(ws, payload));
            unsubscribeByTopic.set(message.topic, unsubscribe);
            return send(ws, { type: "subscribed", topic: message.topic });
          }
          if (message.type === "unsubscribe") {
            subscriptions.delete(message.topic);
            const handler = unsubscribeByTopic.get(message.topic);
            if (handler) handler();
            unsubscribeByTopic.delete(message.topic);
          }
        },
        onClose: () => {
          for (const topic of subscriptions) {
            const handler = unsubscribeByTopic.get(topic);
            if (handler) handler();
          }
          unsubscribeByTopic.clear();
        }
      };
    })
  );
}
