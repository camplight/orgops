import type { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import { schema, type OrgOpsDrizzleDb } from "@orgops/db";
import type { AccessControl, RequestUser } from "./access";

const CONTEXT_EVENT_TYPES = [
  "agent.context.compacted",
  "agent.context.cleared",
] as const;
const MAX_SUMMARY_CHARS = 24_000;

type ContextDeps = {
  orm: OrgOpsDrizzleDb;
  jsonResponse: (c: any, data: unknown, status?: number) => Response;
  eventRowToApi: (row: any) => unknown;
  insertEvent: (input: any) => any;
  access: AccessControl;
};

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function requestSource(user: RequestUser | undefined): string {
  if (user?.sourceAgentName) return `agent:${user.sourceAgentName}`;
  if (user?.username && user.username !== "runner") return `human:${user.username}`;
  return "system:runner";
}

function parsePayload(row: any): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(row?.payload_json ?? "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function registerContextRoutes(app: Hono<any>, deps: ContextDeps) {
  const { orm, jsonResponse, eventRowToApi, insertEvent, access } = deps;

  async function parseBody(c: any): Promise<Record<string, unknown> | null> {
    try {
      const raw = await c.req.text();
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : null;
    } catch {
      return null;
    }
  }

  function existingByIdempotencyKey(idempotencyKey: string | null) {
    if (!idempotencyKey) return null;
    return orm
      .select()
      .from(schema.events)
      .where(eq(schema.events.idempotency_key, idempotencyKey))
      .get();
  }

  function latestBoundary(agentName: string, channelId: string) {
    const rows = orm
      .select()
      .from(schema.events)
      .where(
        and(
          eq(schema.events.channel_id, channelId),
          eq(schema.events.source, `agent:${agentName}`),
          inArray(schema.events.type, [...CONTEXT_EVENT_TYPES]),
        ),
      )
      .orderBy(desc(schema.events.created_at))
      .limit(1)
      .all();
    const row = rows[0];
    if (!row) return null;
    const payload = parsePayload(row);
    const compactCutoff = Number(payload.cutoffAt);
    return {
      row,
      effectiveAt:
        row.type === "agent.context.compacted" && Number.isFinite(compactCutoff)
          ? Math.floor(compactCutoff)
          : Number(row.created_at),
    };
  }

  function invalidateMemory(agentName: string, channelId: string) {
    orm
      .delete(schema.channelMemoryRecent)
      .where(
        and(
          eq(schema.channelMemoryRecent.agent_name, agentName),
          eq(schema.channelMemoryRecent.channel_id, channelId),
        ),
      )
      .run();
    orm
      .delete(schema.channelMemoryFull)
      .where(
        and(
          eq(schema.channelMemoryFull.agent_name, agentName),
          eq(schema.channelMemoryFull.channel_id, channelId),
        ),
      )
      .run();
    orm
      .delete(schema.crossChannelMemoryRecent)
      .where(eq(schema.crossChannelMemoryRecent.agent_name, agentName))
      .run();
    orm
      .delete(schema.crossChannelMemoryFull)
      .where(eq(schema.crossChannelMemoryFull.agent_name, agentName))
      .run();
  }

  function validateTarget(
    c: any,
    agentName: string,
    channelId: string,
  ): Response | null {
    const user = c.get("user") as RequestUser | undefined;
    if (!access.canManageAgent(user, agentName) || !access.canPostToChannel(user, channelId)) {
      return jsonResponse(c, { error: "Forbidden" }, 403);
    }
    const agent = orm
      .select({ name: schema.agents.name })
      .from(schema.agents)
      .where(eq(schema.agents.name, agentName))
      .get();
    if (!agent) return jsonResponse(c, { error: "Agent not found" }, 404);
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
        400,
      );
    }
    return null;
  }

  app.post("/api/agents/:name/context/compact", async (c) => {
    const agentName = c.req.param("name").trim();
    const body = await parseBody(c);
    if (!body) return jsonResponse(c, { error: "Invalid JSON" }, 400);
    const channelId = nonEmptyString(body.channelId);
    const summary = nonEmptyString(body.summary);
    const cutoffAt =
      typeof body.cutoffAt === "number" && Number.isFinite(body.cutoffAt)
        ? Math.floor(body.cutoffAt)
        : -1;
    const cutoffEventId = nonEmptyString(body.cutoffEventId);
    const reason = nonEmptyString(body.reason);
    const idempotencyKey = nonEmptyString(body.idempotencyKey);
    if (!agentName || !channelId || !summary || cutoffAt < 0 || !cutoffEventId) {
      return jsonResponse(
        c,
        {
          error:
            "channelId, non-empty summary, non-negative cutoffAt, and cutoffEventId are required",
        },
        400,
      );
    }
    if (summary.length > MAX_SUMMARY_CHARS) {
      return jsonResponse(
        c,
        { error: `summary must not exceed ${MAX_SUMMARY_CHARS} characters` },
        400,
      );
    }
    const targetError = validateTarget(c, agentName, channelId);
    if (targetError) return targetError;
    const existing = existingByIdempotencyKey(idempotencyKey);
    if (existing) return jsonResponse(c, eventRowToApi(existing), 200);

    const cutoffEvent = orm
      .select({
        id: schema.events.id,
        channelId: schema.events.channel_id,
        createdAt: schema.events.created_at,
      })
      .from(schema.events)
      .where(eq(schema.events.id, cutoffEventId))
      .get();
    if (
      !cutoffEvent ||
      cutoffEvent.channelId !== channelId ||
      Number(cutoffEvent.createdAt) !== cutoffAt
    ) {
      return jsonResponse(
        c,
        { error: "cutoffEventId must identify the cutoffAt event in the target channel" },
        400,
      );
    }
    const current = latestBoundary(agentName, channelId);
    if (current && cutoffAt < current.effectiveAt) {
      return jsonResponse(
        c,
        {
          error: "Compaction cutoff is older than the current context boundary",
          currentBoundaryAt: current.effectiveAt,
        },
        409,
      );
    }
    const user = c.get("user") as RequestUser | undefined;
    const row = insertEvent({
      type: "agent.context.compacted",
      source: `agent:${agentName}`,
      channelId,
      payload: {
        targetAgentName: agentName,
        summary,
        cutoffAt,
        cutoffEventId,
        ...(reason ? { reason } : {}),
        requestedBy: requestSource(user),
      },
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
    invalidateMemory(agentName, channelId);
    return jsonResponse(c, eventRowToApi(row), 201);
  });

  app.post("/api/agents/:name/context/clear", async (c) => {
    const agentName = c.req.param("name").trim();
    const body = await parseBody(c);
    if (!body) return jsonResponse(c, { error: "Invalid JSON" }, 400);
    const channelId = nonEmptyString(body.channelId);
    const reason = nonEmptyString(body.reason);
    const idempotencyKey = nonEmptyString(body.idempotencyKey);
    if (!agentName || !channelId) {
      return jsonResponse(c, { error: "channelId is required" }, 400);
    }
    const targetError = validateTarget(c, agentName, channelId);
    if (targetError) return targetError;
    const existing = existingByIdempotencyKey(idempotencyKey);
    if (existing) return jsonResponse(c, eventRowToApi(existing), 200);

    const user = c.get("user") as RequestUser | undefined;
    const row = insertEvent({
      type: "agent.context.cleared",
      source: `agent:${agentName}`,
      channelId,
      payload: {
        targetAgentName: agentName,
        ...(reason ? { reason } : {}),
        requestedBy: requestSource(user),
      },
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
    invalidateMemory(agentName, channelId);
    return jsonResponse(c, eventRowToApi(row), 201);
  });
}
