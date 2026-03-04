import type { Hono } from "hono";
import { schema, type OrgOpsDrizzleDb } from "@orgops/db";
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
  readdirSync: (
    path: string,
    options: { withFileTypes: true },
  ) => { name: string; isFile: () => boolean }[];
  readFileSync: (path: string, options?: any) => string | Buffer;
  EVENT_TYPES_DIR: string;
};

export function registerEventsRoutes(app: Hono<any>, deps: EventsDeps) {
  const {
    orm,
    jsonResponse,
    eventRowToApi,
    insertEvent,
    readdirSync,
    readFileSync,
    EVENT_TYPES_DIR,
  } = deps;
  const EventSchema = deps.EventSchema;

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

  app.get("/api/events", (c) => {
    const url = new URL(c.req.url);
    const params = url.searchParams;
    const channelId = params.get("channelId");
    const agentName = params.get("agentName");
    const type = params.get("type");
    const typePrefix = params.get("typePrefix");
    const source = params.get("source");
    const sourcePrefix = params.get("sourcePrefix");
    const teamId = params.get("teamId");
    const status = params.get("status");
    const after = params.get("after");
    const limit = Number(params.get("limit") ?? 100);
    const order = params.get("order");
    const descending = order === "desc";
    const all = params.get("all") === "1";
    const user = c.get("user") as { username?: string } | undefined;
    const isRunnerRequest = user?.username === "runner";

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
    if (source) {
      whereClauses.push(eq(schema.events.source, source));
    }
    if (sourcePrefix) {
      whereClauses.push(like(schema.events.source, `${sourcePrefix}%`));
    }
    if (teamId) {
      whereClauses.push(eq(schema.events.team_id, teamId));
    }
    if (status && !(agentName && isRunnerRequest)) {
      whereClauses.push(eq(schema.events.status, status));
    }

    if (agentName) {
      const now = Date.now();
      if (isRunnerRequest) {
        const receiptClauses: any[] = [
          eq(schema.eventReceipts.agent_name, agentName),
          or(
            isNull(schema.events.deliver_at),
            lte(schema.events.deliver_at, now),
          ),
        ];
        if (status) {
          receiptClauses.push(eq(schema.eventReceipts.status, status));
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
        if (source) {
          receiptClauses.push(eq(schema.events.source, source));
        }
        if (sourcePrefix) {
          receiptClauses.push(like(schema.events.source, `${sourcePrefix}%`));
        }
        if (teamId) {
          receiptClauses.push(eq(schema.events.team_id, teamId));
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
      const agentTeams = orm
        .select({ teamId: schema.teamMemberships.team_id })
        .from(schema.teamMemberships)
        .where(
          and(
            eq(schema.teamMemberships.member_type, "AGENT"),
            eq(schema.teamMemberships.member_id, agentName),
          ),
        )
        .all();
      const teamIds = agentTeams.map((row) => row.teamId);
      const visibilityClauses: any[] = [];
      if (channelIds.length > 0) {
        visibilityClauses.push(inArray(schema.events.channel_id, channelIds));
      }
      if (teamIds.length > 0) {
        visibilityClauses.push(inArray(schema.events.team_id, teamIds));
      }
      if (visibilityClauses.length === 0) {
        return jsonResponse(c, []);
      }
      const agentVisibility = or(...(visibilityClauses as [any, ...any[]]));
      if (agentVisibility) whereClauses.push(agentVisibility);
      whereClauses.push(
        or(
          isNull(schema.events.deliver_at),
          lte(schema.events.deliver_at, now),
        ) as any,
      );
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
    orm.delete(schema.events).run();
    return jsonResponse(c, { ok: true });
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

  app.get("/api/event-types", (c) => {
    const entries = readdirSync(EVENT_TYPES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => {
        const filename = entry.name;
        const fullPath = `${EVENT_TYPES_DIR}/${filename}`;
        const content = String(readFileSync(fullPath, "utf-8"));
        const titleMatch = content.match(/^#\s+(.+)$/m);
        return {
          filename,
          eventType: filename.replace(/\.md$/i, ""),
          title: titleMatch?.[1] ?? filename.replace(/\.md$/i, ""),
          content,
        };
      });
    return jsonResponse(c, entries);
  });
}
