import { describe, expect, it, vi } from "vitest";
import type { RequestUser } from "./access";
import {
  registerWsRoutes,
  getDeferredWsDeliveryDelayMs,
  shouldForwardWsPayload,
  type WsServerMessage,
} from "./ws";

function humanUser(): RequestUser {
  return { username: "admin", mustChangePassword: false };
}

function runnerUser(): RequestUser {
  return { username: "runner", mustChangePassword: false };
}

describe("ws scheduling visibility", () => {
  it("forwards non-event websocket payloads", () => {
    const payload: WsServerMessage = { type: "subscribed", topic: "channel:test" };
    expect(shouldForwardWsPayload(humanUser(), payload, 1000)).toBe(true);
  });

  it("forwards immediate events for humans", () => {
    const payload: WsServerMessage = {
      type: "event",
      topic: "channel:test",
      data: { id: "evt-1", type: "message.created", createdAt: 900, status: "DELIVERED" },
    };
    expect(shouldForwardWsPayload(humanUser(), payload, 1000)).toBe(true);
  });

  it("blocks future-scheduled events for humans until they are due", () => {
    const payload: WsServerMessage = {
      type: "event",
      topic: "channel:test",
      data: {
        id: "evt-2",
        type: "message.created",
        createdAt: 900,
        status: "PENDING",
        deliverAt: 2000,
      },
    };
    expect(shouldForwardWsPayload(humanUser(), payload, 1000)).toBe(false);
    expect(shouldForwardWsPayload(humanUser(), payload, 2000)).toBe(true);
  });

  it("keeps future-scheduled events visible to runner clients", () => {
    const payload: WsServerMessage = {
      type: "event",
      topic: "channel:test",
      data: {
        id: "evt-3",
        type: "agent.scheduled.trigger",
        createdAt: 900,
        status: "PENDING",
        deliverAt: 5000,
      },
    };
    expect(shouldForwardWsPayload(runnerUser(), payload, 1000)).toBe(true);
  });

  it("returns deferred delivery delay for human future scheduled events", () => {
    const payload: WsServerMessage = {
      type: "event",
      topic: "channel:test",
      data: {
        id: "evt-4",
        type: "message.created",
        createdAt: 900,
        status: "PENDING",
        deliverAt: 2250,
      },
    };
    expect(getDeferredWsDeliveryDelayMs(humanUser(), payload, 1000)).toBe(1250);
  });

  it("does not defer events that are already due", () => {
    const payload: WsServerMessage = {
      type: "event",
      topic: "channel:test",
      data: {
        id: "evt-5",
        type: "message.created",
        createdAt: 900,
        status: "PENDING",
        deliverAt: 900,
      },
    };
    expect(getDeferredWsDeliveryDelayMs(humanUser(), payload, 1000)).toBeNull();
  });
});


it("revalidates sessions before forwarding events on an existing socket", () => {
  let current: RequestUser | null = {id: "human", username: "person", mustChangePassword: false};
  let factory: any;
  let deliver: (payload: WsServerMessage) => void = () => {};
  const socket = {send: vi.fn(), close: vi.fn()};
  registerWsRoutes({get: vi.fn()} as any, {
    upgradeWebSocket: (fn: any) => { factory = fn; },
    resolveRequestUser: () => current,
    access: {canViewChannel: () => true} as any,
    bus: {subscribe: (_topic: string, handler: typeof deliver) => {deliver = handler; return () => {};}} as any,
  });
  const handlers = factory({});
  handlers.onMessage({data: JSON.stringify({type: "subscribe", topic: "channel:test"})}, socket);
  expect(socket.send).toHaveBeenCalledTimes(1);
  current = null;
  deliver({type: "event", topic: "channel:test", data: {id: "private"}});
  expect(socket.send).toHaveBeenCalledTimes(1);
  expect(socket.close).toHaveBeenCalledWith(1008, "Session expired");
  handlers.onMessage({data: JSON.stringify({type: "ping"})}, socket);
  expect(socket.send).toHaveBeenCalledTimes(1);
  handlers.onClose();
});
