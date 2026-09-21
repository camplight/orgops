import type { Hono } from "hono";

import type { EventBus } from "@orgops/event-bus";
import type { AccessControl, RequestUser } from "./access";

type WsMessage =
  | { type: "subscribe"; topic: string }
  | { type: "unsubscribe"; topic: string }
  | { type: "ping" };

export type WsServerMessage =
  | { type: "subscribed"; topic: string }
  | { type: "event"; topic: string; data: unknown }
  | { type: "process_output"; topic: string; data: unknown }
  | { type: "agent_status"; topic: string; data: unknown }
  | { type: "dashboard_refresh"; topic: string; data: unknown }
  | { type: "error"; message: string };

type WsDeps = {
  bus: EventBus<WsServerMessage>;
  upgradeWebSocket: (createEvents: any) => any;
  resolveRequestUser: (c: any) => RequestUser | null;
  access: AccessControl;
};

export function shouldForwardWsPayload(
  user: RequestUser,
  payload: WsServerMessage,
  now = Date.now(),
): boolean {
  if (payload.type !== "event") return true;
  if (user.username === "runner") return true;
  if (!payload.data || typeof payload.data !== "object") return true;
  const deliverAt = (payload.data as { deliverAt?: unknown }).deliverAt;
  return !(typeof deliverAt === "number" && Number.isFinite(deliverAt) && deliverAt > now);
}

export function getDeferredWsDeliveryDelayMs(
  user: RequestUser,
  payload: WsServerMessage,
  now = Date.now(),
): number | null {
  if (payload.type !== "event") return null;
  if (user.username === "runner") return null;
  if (!payload.data || typeof payload.data !== "object") return null;
  const deliverAt = (payload.data as { deliverAt?: unknown }).deliverAt;
  if (typeof deliverAt !== "number" || !Number.isFinite(deliverAt)) return null;
  return deliverAt > now ? Math.max(0, Math.floor(deliverAt - now)) : null;
}

export function registerWsRoutes(app: Hono<any>, deps: WsDeps) {
  const { bus, upgradeWebSocket, resolveRequestUser, access } = deps;

  app.get(
    "/ws",
    upgradeWebSocket((c: any) => {
      const user = resolveRequestUser(c);
      const subscriptions = new Set<string>();
      const unsubscribeByTopic = new Map<string, () => void>();
      const deferredSendTimers = new Map<string, ReturnType<typeof setTimeout>>();
      const send = (ws: { send: (data: string) => void }, data: WsServerMessage) =>
        ws.send(JSON.stringify(data));
      const clearDeferredForTopic = (topic: string) => {
        for (const [key, timer] of deferredSendTimers.entries()) {
          if (!key.startsWith(`${topic}:`)) continue;
          clearTimeout(timer);
          deferredSendTimers.delete(key);
        }
      };
      return {
        onMessage: (event: { data: string | Uint8Array }, ws: { send: (data: string) => void }) => {
          if (!user) {
            return send(ws, { type: "error", message: "Unauthorized" });
          }
          const message = JSON.parse(event.data.toString()) as WsMessage;
          if (message.type === "ping") {
            return send(ws, { type: "subscribed", topic: "pong" });
          }
          if (message.type === "subscribe") {
            if (
              message.topic.startsWith("channel:") &&
              !access.canViewChannel(user, message.topic.slice("channel:".length))
            ) {
              return send(ws, { type: "error", message: "Forbidden topic subscription" });
            }
            subscriptions.add(message.topic);
            const unsubscribe = bus.subscribe(message.topic, (payload) => {
              const deferredDelayMs = getDeferredWsDeliveryDelayMs(user, payload);
              if (deferredDelayMs !== null) {
                const eventId =
                  payload.type === "event" &&
                  payload.data &&
                  typeof payload.data === "object" &&
                  typeof (payload.data as { id?: unknown }).id === "string"
                    ? (payload.data as { id: string }).id
                    : "unknown";
                const key = `${message.topic}:${eventId}`;
                if (deferredSendTimers.has(key)) return;
                const timer = setTimeout(() => {
                  deferredSendTimers.delete(key);
                  if (!subscriptions.has(message.topic)) return;
                  send(ws, payload);
                }, deferredDelayMs);
                deferredSendTimers.set(key, timer);
                return;
              }
              if (!shouldForwardWsPayload(user, payload)) return;
              send(ws, payload);
            });
            unsubscribeByTopic.set(message.topic, unsubscribe);
            return send(ws, { type: "subscribed", topic: message.topic });
          }
          if (message.type === "unsubscribe") {
            subscriptions.delete(message.topic);
            clearDeferredForTopic(message.topic);
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
          for (const timer of deferredSendTimers.values()) clearTimeout(timer);
          deferredSendTimers.clear();
          unsubscribeByTopic.clear();
        }
      };
    })
  );
}
