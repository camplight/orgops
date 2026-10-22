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
  canViewProcess?: (user: RequestUser, id: string) => boolean;
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
  const canSubscribe = (user:RequestUser, topic:string) => {
    if(topic.startsWith('channel:'))return access.canViewChannel(user,topic.slice(8));
    if(topic.startsWith('agent:'))return access.canViewAgent(user,topic.slice(6));
    if(topic.startsWith('process:'))return deps.canViewProcess?.(user,topic.slice(8)) ?? false;
    return ['org:events','org:dashboard','org:agentStatus','pong'].includes(topic);
  };
  const canReceive = (user:RequestUser, payload:WsServerMessage) => {
    if(payload.type==='error')return true;
    if(!canSubscribe(user,payload.topic))return false;
    if(payload.type==='event'){
      const data=payload.data as {channelId?:unknown} | null;
      if(typeof data?.channelId==='string')return access.canViewChannel(user,data.channelId);
      return access.canManageInstance(user);
    }
    if(payload.type==='agent_status'){
      const data=payload.data as {agentName?:unknown} | null;
      return typeof data?.agentName==='string'&&access.canViewAgent(user,data.agentName);
    }
    return true;
  };

  app.get(
    "/ws",
    upgradeWebSocket((c: any) => {
      const user = resolveRequestUser(c);
      const subscriptions = new Set<string>();
      const unsubscribeByTopic = new Map<string, () => void>();
      const deferredSendTimers = new Map<string, ReturnType<typeof setTimeout>>();
      type Socket = { send: (data: string) => void; close?: (code: number, reason: string) => void };
      const validSession = (ws: Socket) => {
        const current = resolveRequestUser(c);
        if (user && current && current.username === user.username && current.id === user.id) return true;
        ws.close?.(1008, "Session expired");
        return false;
      };
      const send = (ws: Socket, data: WsServerMessage) => {
        if (!validSession(ws)) return;
        const current=resolveRequestUser(c)!;
        if (!canReceive(current,data)) return;
        // Refresh notifications are useful to everyone; resource metadata is not.
        const visible=data.type==='dashboard_refresh'&&!access.canManageInstance(current)
          ? {...data,data:{reason:'refresh'}} : data;
        ws.send(JSON.stringify(visible));
      };
      const clearDeferredForTopic = (topic: string) => {
        for (const [key, timer] of deferredSendTimers.entries()) {
          if (!key.startsWith(`${topic}:`)) continue;
          clearTimeout(timer);
          deferredSendTimers.delete(key);
        }
      };
      return {
        onMessage: (event: { data: string | Uint8Array }, ws: { send: (data: string) => void }) => {
          if (!user) return ws.send(JSON.stringify({type: "error", message: "Unauthorized"}));
          if (!validSession(ws)) return;
          let message:WsMessage;
          try{message=JSON.parse(event.data.toString());}catch{return send(ws,{type:'error',message:'Invalid message'});}
          if(!message||typeof message!=='object')return;
          if (message.type === "ping") {
            return send(ws, { type: "subscribed", topic: "pong" });
          }
          if (message.type === "subscribe") {
            if (typeof message.topic!=='string'||message.topic.length>256||!canSubscribe(resolveRequestUser(c)!,message.topic)) {
              return send(ws, { type: "error", message: "Forbidden topic subscription" });
            }
            if(subscriptions.has(message.topic))return send(ws,{type:'subscribed',topic:message.topic});
            subscriptions.add(message.topic);
            const unsubscribe = bus.subscribe(message.topic, (payload) => {
              if(!validSession(ws)||!canReceive(resolveRequestUser(c)!,payload))return;
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
            if(typeof message.topic!=='string')return;
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
