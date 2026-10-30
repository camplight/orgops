import type { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import { schema, type OrgOpsDrizzleDb } from "@orgops/db";

type RequestUser = {
  username?: string;
  runnerScope?: {
    mode?: string;
    allowedRunnerId?: string;
  };
};

type Socket = {
  send: (data: string) => void;
  close?: (code: number, reason: string) => void;
};

type RunnerEventWakeup = {
  eventId: string;
  eventType: string;
  agentName: string;
  channelId?: string;
  createdAt: number;
  deliverAt?: number;
};

type RunnerSocketMessage =
  | { type: "hello"; runnerId: string }
  | { type: "pong"; now: number }
  | { type: "event.available"; runnerId: string; events: RunnerEventWakeup[] }
  | { type: "error"; message: string };

type EventRow = {
  id: string;
  type: string;
  channel_id?: string | null;
  created_at: number;
  deliver_at?: number | null;
};

type RunnerSocketDeps = {
  orm: OrgOpsDrizzleDb;
  upgradeWebSocket: (createEvents: any) => any;
  resolveRequestUser: (c: any) => RequestUser | null;
};

function scopedRunnerIdFor(user: RequestUser | null | undefined) {
  return user?.runnerScope?.mode === "SCOPED"
    ? user.runnerScope.allowedRunnerId?.trim() ?? ""
    : "";
}

function send(ws: Socket, message: RunnerSocketMessage) {
  ws.send(JSON.stringify(message));
}

export function createRunnerSocketHub(deps: RunnerSocketDeps) {
  const socketsByRunner = new Map<string, Set<Socket>>();
  const deferredTimers = new Set<ReturnType<typeof setTimeout>>();

  function addSocket(runnerId: string, ws: Socket) {
    const sockets = socketsByRunner.get(runnerId) ?? new Set<Socket>();
    sockets.add(ws);
    socketsByRunner.set(runnerId, sockets);
  }

  function removeSocket(runnerId: string, ws: Socket) {
    const sockets = socketsByRunner.get(runnerId);
    if (!sockets) return;
    sockets.delete(ws);
    if (sockets.size === 0) socketsByRunner.delete(runnerId);
  }

  function touchRunner(runnerId: string) {
    deps.orm
      .update(schema.runnerNodes)
      .set({ updated_at: Date.now(), last_seen_at: Date.now() })
      .where(eq(schema.runnerNodes.id, runnerId))
      .run();
  }

  function publish(runnerId: string, events: RunnerEventWakeup[]) {
    const sockets = socketsByRunner.get(runnerId);
    if (!sockets?.size || events.length === 0) return;
    const message: RunnerSocketMessage = { type: "event.available", runnerId, events };
    const payload = JSON.stringify(message);
    for (const ws of sockets) ws.send(payload);
  }

  function publishAtDeliveryTime(runnerId: string, events: RunnerEventWakeup[]) {
    const dueNow: RunnerEventWakeup[] = [];
    const byDeliverAt = new Map<number, RunnerEventWakeup[]>();
    const now = Date.now();
    for (const event of events) {
      if (!event.deliverAt || event.deliverAt <= now) {
        dueNow.push(event);
        continue;
      }
      const bucket = byDeliverAt.get(event.deliverAt) ?? [];
      bucket.push(event);
      byDeliverAt.set(event.deliverAt, bucket);
    }
    publish(runnerId, dueNow);
    for (const [deliverAt, bucket] of byDeliverAt) {
      const timer = setTimeout(() => {
        deferredTimers.delete(timer);
        publish(runnerId, bucket);
      }, Math.max(0, deliverAt - Date.now()));
      deferredTimers.add(timer);
    }
  }

  function registerRoutes(app: Hono<any>) {
    app.get(
      "/api/runners/:id/ws",
      deps.upgradeWebSocket((c: any) => {
        const runnerId = c.req.param("id");
        const user = deps.resolveRequestUser(c);
        const scopedRunnerId = scopedRunnerIdFor(user);
        const authorized =
          user?.username === "runner" &&
          (!scopedRunnerId || scopedRunnerId === runnerId);
        let accepted = false;
        const accept = (ws: Socket) => {
          if (accepted) return true;
          if (!authorized) {
            ws.close?.(1008, "Unauthorized runner socket");
            return false;
          }
          accepted = true;
          addSocket(runnerId, ws);
          touchRunner(runnerId);
          send(ws, { type: "hello", runnerId });
          return true;
        };

        return {
          onOpen: (_event: unknown, ws: Socket) => {
            accept(ws);
          },
          onMessage: (event: { data: string | Uint8Array }, ws: Socket) => {
            if (!accept(ws)) return;
            let message: unknown;
            try {
              message = JSON.parse(event.data.toString());
            } catch {
              return send(ws, { type: "error", message: "Invalid message" });
            }
            if (message && typeof message === "object" && (message as { type?: unknown }).type === "ping") {
              touchRunner(runnerId);
              return send(ws, { type: "pong", now: Date.now() });
            }
          },
          onClose: (_event: unknown, ws: Socket) => {
            removeSocket(runnerId, ws);
          },
        };
      }),
    );
  }

  function notifyEvent(row: EventRow, recipientAgents: string[]) {
    if (recipientAgents.length === 0) return;
    const assignments = deps.orm
      .select({
        name: schema.agents.name,
        assignedRunnerId: schema.agents.assigned_runner_id,
      })
      .from(schema.agents)
      .where(inArray(schema.agents.name, recipientAgents))
      .all() as Array<{ name: string; assignedRunnerId: string | null }>;

    const byRunner = new Map<string, RunnerEventWakeup[]>();
    for (const assignment of assignments) {
      const runnerId = assignment.assignedRunnerId?.trim();
      if (!runnerId) continue;
      const bucket = byRunner.get(runnerId) ?? [];
      bucket.push({
        eventId: row.id,
        eventType: row.type,
        agentName: assignment.name,
        channelId: row.channel_id ?? undefined,
        createdAt: row.created_at,
        deliverAt: row.deliver_at ?? undefined,
      });
      byRunner.set(runnerId, bucket);
    }

    for (const [runnerId, events] of byRunner) {
      publishAtDeliveryTime(runnerId, events);
    }
  }

  function close() {
    for (const timer of deferredTimers) clearTimeout(timer);
    deferredTimers.clear();
    socketsByRunner.clear();
  }

  return { registerRoutes, notifyEvent, close };
}
