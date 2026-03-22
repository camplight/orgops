import type { Hono } from "hono";
import { schema, type OrgOpsDrizzleDb } from "@orgops/db";
import type { SkillMeta, SkillRoot } from "@orgops/skills";
import type { EventShapeDefinition } from "@orgops/schemas";
import { z } from "zod";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  like,
  lte,
  or,
  sql,
} from "drizzle-orm";

type EventsDeps = {
  orm: OrgOpsDrizzleDb;
  jsonResponse: (c: any, data: unknown, status?: number) => Response;
  eventRowToApi: (row: any) => any;
  insertEvent: (input: any) => any;
  EventSchema: {
    safeParse: (data: unknown) => { success: boolean; data?: any };
  };
  SKILL_ROOT: SkillRoot;
  listSkills: (root: SkillRoot) => SkillMeta[];
  loadSkillEventShapes: (
    skills: SkillMeta[],
  ) => Promise<{ shapes: EventShapeDefinition[]; errors: Array<{ skill: string; error: string }> }>;
  getCoreEventShapes: () => EventShapeDefinition[];
  validateEventAgainstShapes: (
    event: {
      type: string;
      payload: unknown;
      source: string;
      channelId?: string;
      parentEventId?: string;
      deliverAt?: number;
      idempotencyKey?: string;
    },
    shapes: EventShapeDefinition[],
  ) =>
    | { ok: true; matchedDefinitions: number }
    | { ok: false; type: string; matchedDefinitions: number; issues: Array<{ source: string; message: string }> };
  serializeEventShapes: (
    shapes: EventShapeDefinition[],
  ) => Array<{ type: string; description: string; source: string; payloadExample?: unknown }>;
};

export function registerEventsRoutes(app: Hono<any>, deps: EventsDeps) {
  const {
    orm,
    jsonResponse,
    eventRowToApi,
    insertEvent,
    SKILL_ROOT,
    listSkills,
    loadSkillEventShapes,
    getCoreEventShapes,
    validateEventAgainstShapes,
    serializeEventShapes,
  } = deps;
  const EventSchema = deps.EventSchema;
  const EVENT_SHAPES_CACHE_TTL_MS = Number(process.env.ORGOPS_EVENT_SHAPES_CACHE_TTL_MS ?? 3000);
  let eventShapesCache:
    | {
        expiresAt: number;
        shapes: EventShapeDefinition[];
        loadErrors: Array<{ skill: string; error: string }>;
      }
    | undefined;
  const scheduledEventUpdateSchema = z
    .object({
      type: z.string().min(1).optional(),
      payload: z.unknown().optional(),
      channelId: z.string().min(1).nullable().optional(),
      parentEventId: z.string().min(1).nullable().optional(),
      deliverAt: z.number().int().optional(),
    })
    .superRefine((value, ctx) => {
      if (
        value.type === undefined &&
        value.payload === undefined &&
        value.channelId === undefined &&
        value.parentEventId === undefined &&
        value.deliverAt === undefined
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Provide at least one field to update: type, payload, channelId, parentEventId, or deliverAt.",
        });
      }
    });

  async function getEventShapes() {
    const now = Date.now();
    if (eventShapesCache && eventShapesCache.expiresAt > now) {
      return eventShapesCache;
    }
    const availableSkills = listSkills(SKILL_ROOT);
    const loaded = await loadSkillEventShapes(availableSkills);
    eventShapesCache = {
      expiresAt: now + EVENT_SHAPES_CACHE_TTL_MS,
      shapes: [...getCoreEventShapes(), ...loaded.shapes],
      loadErrors: loaded.errors,
    };
    return eventShapesCache;
  }

  app.post("/api/events", async (c) => {
    const raw = await c.req.text();
    let body: any = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return jsonResponse(c, { error: "Invalid JSON" }, 400);
    }
    const parsed = EventSchema.safeParse(body);
    if (!parsed.success)
      return jsonResponse(c, { error: "Invalid payload" }, 400);
    if (Object.prototype.hasOwnProperty.call(body, "teamId")) {
      return jsonResponse(
        c,
        { error: "teamId is no longer supported. Use channelId." },
        400,
      );
    }

    const type = parsed.data.type ?? body?.type;
    const requestedSource = parsed.data.source ?? body?.source;
    const user = c.get("user") as { username?: string } | undefined;
    const source =
      user?.username && user.username !== "runner"
        ? `human:${user.username}`
        : requestedSource;
    if (!type || !source) {
      return jsonResponse(c, { error: "Missing type or source" }, 400);
    }
    if (type === "message.created" && !parsed.data.channelId) {
      return jsonResponse(
        c,
        { error: "message.created requires channelId" },
        400,
      );
    }

    const eventShapes = await getEventShapes();
    const validationResult = validateEventAgainstShapes(
      {
        type,
        source,
        payload: parsed.data.payload ?? {},
        channelId: parsed.data.channelId,
        parentEventId: parsed.data.parentEventId,
        deliverAt: parsed.data.deliverAt,
        idempotencyKey: parsed.data.idempotencyKey,
      },
      eventShapes.shapes,
    );
    if (!validationResult.ok) {
      return jsonResponse(
        c,
        {
          error: "Event payload validation failed",
          validation: validationResult,
        },
        400,
      );
    }

    if (parsed.data.idempotencyKey) {
      const existing = orm
        .select()
        .from(schema.events)
        .where(eq(schema.events.idempotency_key, parsed.data.idempotencyKey))
        .get() as any;
      if (existing) return jsonResponse(c, eventRowToApi(existing), 200);
    }

    const row = insertEvent({ ...parsed.data, type, source });
    return jsonResponse(c, eventRowToApi(row), 201);
  });

  app.get("/api/events/:id", (c) => {
    const id = c.req.param("id");
    const row = orm
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, id))
      .get() as any | undefined;
    if (!row) {
      return jsonResponse(c, { error: "Not found" }, 404);
    }
    return jsonResponse(c, eventRowToApi(row));
  });

  app.patch("/api/events/:id", async (c) => {
    const id = c.req.param("id");
    const existing = orm
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, id))
      .get() as any | undefined;
    if (!existing) {
      return jsonResponse(c, { error: "Not found" }, 404);
    }
    const now = Date.now();
    const isFutureScheduled =
      existing.status === "PENDING" &&
      typeof existing.deliver_at === "number" &&
      existing.deliver_at > now;
    if (!isFutureScheduled) {
      return jsonResponse(
        c,
        {
          error:
            "Only future scheduled events (status=PENDING with deliverAt in the future) can be updated.",
        },
        409,
      );
    }

    const raw = await c.req.text();
    let body: unknown = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return jsonResponse(c, { error: "Invalid JSON" }, 400);
    }
    const parsed = scheduledEventUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return jsonResponse(c, { error: "Invalid payload" }, 400);
    }
    if (parsed.data.deliverAt !== undefined && parsed.data.deliverAt <= now) {
      return jsonResponse(c, { error: "deliverAt must be a future timestamp." }, 400);
    }

    const nextType = parsed.data.type ?? existing.type;
    const nextPayload =
      parsed.data.payload !== undefined
        ? parsed.data.payload
        : (() => {
            try {
              return JSON.parse(existing.payload_json ?? "{}");
            } catch {
              return {};
            }
          })();
    const nextChannelId =
      parsed.data.channelId !== undefined
        ? parsed.data.channelId
        : (existing.channel_id ?? undefined);
    const nextParentEventId =
      parsed.data.parentEventId !== undefined
        ? parsed.data.parentEventId
        : (existing.parent_event_id ?? undefined);
    const nextDeliverAt = parsed.data.deliverAt ?? existing.deliver_at;

    const eventShapes = await getEventShapes();
    const validationResult = validateEventAgainstShapes(
      {
        type: nextType,
        source: existing.source,
        payload: nextPayload ?? {},
        channelId: nextChannelId ?? undefined,
        parentEventId: nextParentEventId ?? undefined,
        deliverAt: nextDeliverAt ?? undefined,
        idempotencyKey: existing.idempotency_key ?? undefined,
      },
      eventShapes.shapes,
    );
    if (!validationResult.ok) {
      return jsonResponse(
        c,
        {
          error: "Event payload validation failed",
          validation: validationResult,
        },
        400,
      );
    }

    orm
      .update(schema.events)
      .set({
        type: nextType,
        payload_json: JSON.stringify(nextPayload ?? {}),
        channel_id: nextChannelId ?? null,
        parent_event_id: nextParentEventId ?? null,
        deliver_at: nextDeliverAt ?? null,
      })
      .where(eq(schema.events.id, id))
      .run();

    const updated = orm
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, id))
      .get() as any | undefined;
    if (!updated) {
      return jsonResponse(c, { error: "Not found" }, 404);
    }
    return jsonResponse(c, eventRowToApi(updated));
  });

  app.get("/api/events", (c) => {
    const url = new URL(c.req.url);
    const params = url.searchParams;
    const channelId = params.get("channelId");
    const agentName = params.get("agentName");
    const type = params.get("type");
    const typePrefix = params.get("typePrefix");
    const sourceFilter = params.get("source");
    const sourcePrefix = params.get("sourcePrefix");
    const status = params.get("status");
    const scheduled = params.get("scheduled");
    const after = params.get("after");
    const limit = Number(params.get("limit") ?? 100);
    const order = params.get("order");
    const descending = order === "desc";
    const all = params.get("all") === "1";
    const scheduledOnly = scheduled === "1" || scheduled === "true";
    const user = c.get("user") as { username?: string } | undefined;
    const isRunnerRequest = user?.username === "runner";
    const now = Date.now();

    const whereClauses: any[] = [];

    if (channelId) {
      whereClauses.push(eq(schema.events.channel_id, channelId));
    }
    if (after) {
      whereClauses.push(gt(schema.events.created_at, Number(after)));
    }
    if (type) {
      whereClauses.push(eq(schema.events.type, type));
    }
    if (typePrefix) {
      whereClauses.push(like(schema.events.type, `${typePrefix}%`));
    }
    if (sourceFilter) {
      whereClauses.push(eq(schema.events.source, sourceFilter));
    }
    if (sourcePrefix) {
      whereClauses.push(like(schema.events.source, `${sourcePrefix}%`));
    }
    if (status && !(agentName && isRunnerRequest)) {
      whereClauses.push(eq(schema.events.status, status));
    }

    if (scheduledOnly && !status) {
      whereClauses.push(eq(schema.events.status, "PENDING"));
    }

    if (!isRunnerRequest && !scheduledOnly) {
      whereClauses.push(
        or(
          isNull(schema.events.deliver_at),
          lte(schema.events.deliver_at, now),
        ) as any,
      );
    }

    if (agentName) {
      if (isRunnerRequest) {
        const receiptClauses: any[] = [
          eq(schema.eventReceipts.agent_name, agentName),
        ];
        if (scheduledOnly) {
          receiptClauses.push(gt(schema.events.deliver_at, now));
        } else {
          receiptClauses.push(
            or(
              isNull(schema.events.deliver_at),
              lte(schema.events.deliver_at, now),
            ),
          );
        }
        if (status) {
          receiptClauses.push(eq(schema.eventReceipts.status, status));
        } else if (scheduledOnly) {
          receiptClauses.push(eq(schema.eventReceipts.status, "PENDING"));
        }
        if (channelId) {
          receiptClauses.push(eq(schema.events.channel_id, channelId));
        }
        if (after) {
          receiptClauses.push(gt(schema.events.created_at, Number(after)));
        }
        if (type) {
          receiptClauses.push(eq(schema.events.type, type));
        }
        if (typePrefix) {
          receiptClauses.push(like(schema.events.type, `${typePrefix}%`));
        }
        if (sourceFilter) {
          receiptClauses.push(eq(schema.events.source, sourceFilter));
        }
        if (sourcePrefix) {
          receiptClauses.push(like(schema.events.source, `${sourcePrefix}%`));
        }
        const joinedQuery = orm
          .select({
            event: schema.events,
            receiptStatus: schema.eventReceipts.status,
          })
          .from(schema.events)
          .innerJoin(
            schema.eventReceipts,
            eq(schema.events.id, schema.eventReceipts.event_id),
          )
          .where(and(...(receiptClauses as [any, ...any[]])))
          .orderBy(
            descending
              ? desc(schema.events.created_at)
              : asc(schema.events.created_at),
          );
        const joinedRows = (
          all ? joinedQuery : joinedQuery.limit(limit)
        ).all() as Array<{
          event: any;
          receiptStatus: string;
        }>;

        if (!scheduledOnly) {
          const pendingDeliveredIds = joinedRows
            .filter((row) => row.receiptStatus === "PENDING")
            .map((row) => row.event.id);
          if (pendingDeliveredIds.length > 0) {
            orm
              .update(schema.eventReceipts)
              .set({ status: "DELIVERED", delivered_at: now })
              .where(
                and(
                  eq(schema.eventReceipts.agent_name, agentName),
                  eq(schema.eventReceipts.status, "PENDING"),
                  inArray(schema.eventReceipts.event_id, pendingDeliveredIds),
                ),
              )
              .run();

            const uniqueEventIds = [...new Set(pendingDeliveredIds)];
            for (const eventId of uniqueEventIds) {
              const pendingCountRow = orm
                .select({
                  count: sql<number>`count(*)`,
                })
                .from(schema.eventReceipts)
                .where(
                  and(
                    eq(schema.eventReceipts.event_id, eventId),
                    eq(schema.eventReceipts.status, "PENDING"),
                  ),
                )
                .get() as { count: number } | undefined;
              if ((pendingCountRow?.count ?? 0) === 0) {
                orm
                  .update(schema.events)
                  .set({ status: "DELIVERED" })
                  .where(eq(schema.events.id, eventId))
                  .run();
              }
            }
          }
        }

        const data = joinedRows.map((row) => eventRowToApi(row.event));
        return jsonResponse(c, data);
      }

      const agentChannels = orm
        .select({ channelId: schema.channelSubscriptions.channel_id })
        .from(schema.channelSubscriptions)
        .where(
          and(
            eq(schema.channelSubscriptions.subscriber_type, "AGENT"),
            eq(schema.channelSubscriptions.subscriber_id, agentName),
          ),
        )
        .all();
      const channelIds = agentChannels.map((row) => row.channelId);
      const visibilityClauses: any[] = [];
      if (channelIds.length > 0) {
        visibilityClauses.push(inArray(schema.events.channel_id, channelIds));
      }
      if (visibilityClauses.length === 0) {
        return jsonResponse(c, []);
      }
      const agentVisibility = or(...(visibilityClauses as [any, ...any[]]));
      if (agentVisibility) whereClauses.push(agentVisibility);
      whereClauses.push(
        (scheduledOnly
          ? gt(schema.events.deliver_at, now)
          : or(
              isNull(schema.events.deliver_at),
              lte(schema.events.deliver_at, now),
            )) as any,
      );
    } else if (scheduledOnly) {
      whereClauses.push(gt(schema.events.deliver_at, now));
    }

    const whereExpr =
      whereClauses.length > 0
        ? and(...(whereClauses as [any, ...any[]]))
        : undefined;
    const query = orm
      .select()
      .from(schema.events)
      .where(whereExpr)
      .orderBy(
        descending
          ? desc(schema.events.created_at)
          : asc(schema.events.created_at),
      );
    const rows = (all ? query : query.limit(limit)).all() as any[];

    const data = rows.map(eventRowToApi);
    return jsonResponse(c, data);
  });

  app.delete("/api/events", (c) => {
    const url = new URL(c.req.url);
    const params = url.searchParams;
    const channelId = params.get("channelId");
    const type = params.get("type");
    const sourceFilter = params.get("source");
    const status = params.get("status");

    const whereClauses: any[] = [];
    if (channelId) {
      whereClauses.push(eq(schema.events.channel_id, channelId));
    }
    if (type) {
      whereClauses.push(eq(schema.events.type, type));
    }
    if (sourceFilter) {
      whereClauses.push(eq(schema.events.source, sourceFilter));
    }
    if (status) {
      whereClauses.push(eq(schema.events.status, status));
    }

    const whereExpr =
      whereClauses.length > 0
        ? and(...(whereClauses as [any, ...any[]]))
        : undefined;
    const deletedCount =
      whereExpr === undefined
        ? ((orm
            .select({ count: sql<number>`count(*)` })
            .from(schema.events)
            .get() as { count: number } | undefined)?.count ?? 0)
        : ((orm
            .select({ count: sql<number>`count(*)` })
            .from(schema.events)
            .where(whereExpr)
            .get() as { count: number } | undefined)?.count ?? 0);

    if (whereExpr === undefined) {
      orm.delete(schema.events).run();
    } else {
      orm.delete(schema.events).where(whereExpr).run();
    }

    const user = c.get("user") as { username?: string } | undefined;
    const auditSource =
      user?.username && user.username !== "runner"
        ? `human:${user.username}`
        : "system";
    insertEvent({
      type: "audit.events.cleared",
      source: auditSource,
      channelId: channelId ?? undefined,
      payload: {
        scope: whereExpr ? "filtered" : "all",
        deletedCount,
        filters: {
          channelId: channelId ?? undefined,
          type: type ?? undefined,
          source: sourceFilter ?? undefined,
          status: status ?? undefined,
        },
      },
    });
    return jsonResponse(c, { ok: true, deletedCount });
  });

  app.delete("/api/events/:id", (c) => {
    const id = c.req.param("id");
    const existing = orm
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, id))
      .get() as any | undefined;
    if (!existing) {
      return jsonResponse(c, { error: "Not found" }, 404);
    }
    const now = Date.now();
    const isFutureScheduled =
      existing.status === "PENDING" &&
      typeof existing.deliver_at === "number" &&
      existing.deliver_at > now;
    if (!isFutureScheduled) {
      return jsonResponse(
        c,
        {
          error:
            "Only future scheduled events (status=PENDING with deliverAt in the future) can be deleted.",
        },
        409,
      );
    }

    orm.delete(schema.eventReceipts).where(eq(schema.eventReceipts.event_id, id)).run();
    orm.delete(schema.events).where(eq(schema.events.id, id)).run();
    return jsonResponse(c, { ok: true, deleted: true, id });
  });

  app.delete("/api/channels/:channelId/messages", (c) => {
    const channelId = c.req.param("channelId");
    const whereExpr = and(
      eq(schema.events.channel_id, channelId),
      eq(schema.events.type, "message.created"),
    );
    const deletedCount =
      (orm
        .select({ count: sql<number>`count(*)` })
        .from(schema.events)
        .where(whereExpr)
        .get() as { count: number } | undefined)?.count ?? 0;

    orm.delete(schema.events).where(whereExpr).run();

    const user = c.get("user") as { username?: string } | undefined;
    const source =
      user?.username && user.username !== "runner"
        ? `human:${user.username}`
        : "system";
    insertEvent({
      type: "audit.events.cleared",
      source,
      channelId,
      payload: {
        scope: "channel_messages",
        deletedCount,
        filters: {
          channelId,
          type: "message.created",
        },
      },
    });

    return jsonResponse(c, { ok: true, channelId, deletedCount });
  });

  app.post("/api/events/:id/ack", (c) => {
    const id = c.req.param("id");
    orm
      .update(schema.events)
      .set({ status: "ACKED" })
      .where(eq(schema.events.id, id))
      .run();
    return jsonResponse(c, { ok: true });
  });

  app.post("/api/events/:id/fail", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const maxFailures = Number(process.env.ORGOPS_EVENT_MAX_FAILURES ?? 25);
    const row = orm
      .select({ failCount: schema.events.fail_count })
      .from(schema.events)
      .where(eq(schema.events.id, id))
      .get() as { failCount: number } | undefined;
    if (!row) return jsonResponse(c, { error: "Not found" }, 404);
    const nextCount = row.failCount + 1;
    const nextStatus = nextCount >= maxFailures ? "DEAD" : "FAILED";
    orm
      .update(schema.events)
      .set({
        status: nextStatus,
        fail_count: nextCount,
        last_error: body.error ?? null,
      })
      .where(eq(schema.events.id, id))
      .run();
    if (nextStatus === "DEAD") {
      insertEvent({
        type: "event.deadlettered",
        payload: { eventId: id, failCount: nextCount },
        source: "system",
      });
    }
    return jsonResponse(c, {
      ok: true,
      status: nextStatus,
      failCount: nextCount,
    });
  });

  app.get("/api/event-types", async (c) => {
    const eventShapes = await getEventShapes();
    return jsonResponse(c, {
      eventTypes: serializeEventShapes(eventShapes.shapes),
      loadErrors: eventShapes.loadErrors,
    });
  });
}
