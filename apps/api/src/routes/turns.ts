import type { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import { schema, type OrgOpsDrizzleDb } from "@orgops/db";
import type { AccessControl, RequestUser } from "./access";

const TURN_LIFECYCLE_TYPES = [
  "agent.turn.started",
  "agent.turn.completed",
  "agent.turn.failed",
] as const;

type TurnDeps = {
  orm: OrgOpsDrizzleDb;
  jsonResponse: (c: any, data: unknown, status?: number) => Response;
  eventRowToApi: (row: any) => unknown;
  insertEvent: (input: any) => any;
  access: AccessControl;
};

function requestSource(user: RequestUser | undefined): string {
  if (user?.sourceAgentName) return `agent:${user.sourceAgentName}`;
  if (user?.username && user.username !== "runner") return `human:${user.username}`;
  return "system:runner";
}

function triggerEventId(row: { payload_json?: unknown }): string | null {
  try {
    const payload = JSON.parse(String(row.payload_json ?? "{}"));
    return typeof payload?.triggerEventId === "string" && payload.triggerEventId
      ? payload.triggerEventId
      : null;
  } catch {
    return null;
  }
}

export function registerTurnRoutes(app: Hono<any>, deps: TurnDeps) {
  const { orm, jsonResponse, eventRowToApi, insertEvent, access } = deps;

  // The runner asks this while a CLASSIC turn runs: has anyone asked to stop it?
  app.get("/api/agents/:name/turns/cancel", (c) => {
    const agentName = c.req.param("name").trim();
    const channelId = (c.req.query("channelId") ?? "").trim();
    const trigger = (c.req.query("triggerEventId") ?? "").trim();
    if (!agentName || !channelId || !trigger) {
      return jsonResponse(c, { error: "channelId and triggerEventId are required" }, 400);
    }
    const user = c.get("user") as RequestUser | undefined;
    if (!access.canManageAgent(user, agentName) || !access.canPostToChannel(user, channelId)) {
      return jsonResponse(c, { error: "Forbidden" }, 403);
    }
    const requests = orm
      .select({ payload_json: schema.events.payload_json })
      .from(schema.events)
      .where(
        and(
          eq(schema.events.channel_id, channelId),
          eq(schema.events.type, "agent.turn.cancel_requested"),
        ),
      )
      .orderBy(desc(schema.events.created_at))
      .limit(50)
      .all();
    const cancelRequested = requests.some((row) => {
      try {
        const payload = JSON.parse(String(row.payload_json ?? "{}"));
        return payload?.targetAgentName === agentName && payload?.triggerEventId === trigger;
      } catch {
        return false;
      }
    });
    return jsonResponse(c, { cancelRequested });
  });

  // Records a request to stop the agent's running CLASSIC turn in one channel. The runner
  // watches for it while the turn runs; the event itself never wakes an agent.
  app.post("/api/agents/:name/turns/cancel", async (c) => {
    const agentName = c.req.param("name").trim();
    let body: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse((await c.req.text()) || "{}");
      body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      body = null;
    }
    if (!body) return jsonResponse(c, { error: "Invalid JSON" }, 400);
    const channelId = typeof body.channelId === "string" ? body.channelId.trim() : "";
    if (!agentName || !channelId) return jsonResponse(c, { error: "channelId is required" }, 400);
    const user = c.get("user") as RequestUser | undefined;
    if (!access.canPostToChannel(user, channelId)) {
      return jsonResponse(c, { error: "Forbidden" }, 403);
    }
    const membership = orm
      .select({ channelId: schema.channelSubscriptions.channel_id })
      .from(schema.channelSubscriptions)
      .where(
        and(
          eq(schema.channelSubscriptions.channel_id, channelId),
          eq(schema.channelSubscriptions.subscriber_type, "AGENT"),
          eq(schema.channelSubscriptions.subscriber_id, agentName),
        ),
      )
      .get();
    if (!membership) {
      return jsonResponse(
        c,
        { error: `Agent "${agentName}" is not subscribed to channel "${channelId}"` },
        404,
      );
    }
    // The running turn is the agent's latest lifecycle event in this channel when that is a start.
    const latest = orm
      .select()
      .from(schema.events)
      .where(
        and(
          eq(schema.events.channel_id, channelId),
          eq(schema.events.source, `agent:${agentName}`),
          inArray(schema.events.type, [...TURN_LIFECYCLE_TYPES]),
        ),
      )
      .orderBy(desc(schema.events.created_at))
      .limit(1)
      .get();
    const trigger = latest?.type === "agent.turn.started" ? triggerEventId(latest) : null;
    if (!trigger) {
      return jsonResponse(c, { error: "The agent has no running turn in this channel" }, 409);
    }
    // Repeated clicks on Stop for the same turn return the first request.
    const idempotencyKey = `turn:cancel:${agentName}:${channelId}:${latest!.id}`;
    const existing = orm
      .select()
      .from(schema.events)
      .where(eq(schema.events.idempotency_key, idempotencyKey))
      .get();
    if (existing) return jsonResponse(c, eventRowToApi(existing), 202);
    const row = insertEvent({
      type: "agent.turn.cancel_requested",
      source: requestSource(user),
      channelId,
      payload: {
        targetAgentName: agentName,
        triggerEventId: trigger,
        requestedBy: requestSource(user),
      },
      idempotencyKey,
    });
    return jsonResponse(c, eventRowToApi(row), 202);
  });
}
