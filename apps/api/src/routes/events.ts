import type { Hono } from "hono";
import { openDb, schema, type OrgOpsDrizzleDb } from "@orgops/db";
import type { SkillMeta, SkillRoot } from "@orgops/skills";
import type { EventShapeDefinition } from "@orgops/schemas";
import { z } from "zod";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  like,
  lt,
  lte,
  not,
  or,
  sql,
} from "drizzle-orm";
import type { AccessControl, RequestUser } from "./access";

// Hard ceiling on a single event-listing response, `all=1` included. The events
// table grows unbounded (~273k rows on staging) and the API is a single thread
// over synchronous better-sqlite3: one uncapped read serializes the whole table
// and blocks every other request — during a live build that starved the runner
// AND the coder's own event posts. Dashboards wanting totals should call
// GET /api/events/stats; complete dumps go through /api/events/export.sqlite.
const MAX_EVENT_ROWS = 10_000;

type EventsDeps = {
  orm: OrgOpsDrizzleDb;
  jsonResponse: (c: any, data: unknown, status?: number) => Response;
  eventRowToApi: (row: any) => any;
  insertEvent: (input: any) => any;
  publishEventRow: (row: any) => void;
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
  access: AccessControl;
};

export function registerEventsRoutes(app: Hono<any>, deps: EventsDeps) {
  const {
    orm,
    jsonResponse,
    eventRowToApi,
    insertEvent,
    publishEventRow,
    SKILL_ROOT,
    listSkills,
    loadSkillEventShapes,
    getCoreEventShapes,
    validateEventAgainstShapes,
    serializeEventShapes,
    access,
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

  function scheduledTriggerMembershipError(
    type: string,
    channelId: string | undefined,
    payload: unknown,
  ): string | null {
    if (type !== "agent.scheduled.trigger") return null;
    if (!channelId) {
      return "agent.scheduled.trigger requires channelId.";
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return "agent.scheduled.trigger requires payload.targetAgentName.";
    }
    const targetAgentNameRaw = (payload as { targetAgentName?: unknown })
      .targetAgentName;
    const targetAgentName =
      typeof targetAgentNameRaw === "string"
        ? targetAgentNameRaw.trim()
        : "";
    if (!targetAgentName) {
      return "agent.scheduled.trigger requires payload.targetAgentName.";
    }
    const channel = orm
      .select({ id: schema.channels.id })
      .from(schema.channels)
      .where(eq(schema.channels.id, channelId))
      .get() as { id: string } | undefined;
    if (!channel) {
      return `Unknown channelId: ${channelId}`;
    }
    const subscription = orm
      .select({ subscriberId: schema.channelSubscriptions.subscriber_id })
      .from(schema.channelSubscriptions)
      .where(
        and(
          eq(schema.channelSubscriptions.channel_id, channelId),
          eq(schema.channelSubscriptions.subscriber_type, "AGENT"),
          eq(schema.channelSubscriptions.subscriber_id, targetAgentName),
        ),
      )
      .get() as { subscriberId: string } | undefined;
    if (!subscription) {
      return `agent.scheduled.trigger targetAgentName "${targetAgentName}" is not an AGENT participant in channel "${channelId}".`;
    }
    return null;
  }

  function readEventQuery(url: string) {
    const params = new URL(url).searchParams;
    const scheduled = params.get("scheduled");
    return {
      params,
      channelId: params.get("channelId"),
      agentName: params.get("agentName"),
      type: params.get("type"),
      typePrefix: params.get("typePrefix"),
      excludeTypePrefixes: params.getAll("excludeTypePrefix"),
      sourceFilter: params.get("source"),
      sourcePrefix: params.get("sourcePrefix"),
      status: params.get("status"),
      after: params.get("after"),
      before: params.get("before"),
      limit: Math.min(Number(params.get("limit") ?? 100), MAX_EVENT_ROWS),
      order: params.get("order"),
      descending: params.get("order") === "desc",
      all: params.get("all") === "1",
      scheduledOnly: scheduled === "1" || scheduled === "true",
    };
  }

  function serializeEventQueryFilters(query: ReturnType<typeof readEventQuery>) {
    return {
      channelId: query.channelId ?? undefined,
      agentName: query.agentName ?? undefined,
      type: query.type ?? undefined,
      typePrefix: query.typePrefix ?? undefined,
      excludeTypePrefixes:
        query.excludeTypePrefixes.length > 0
          ? query.excludeTypePrefixes
          : undefined,
      source: query.sourceFilter ?? undefined,
      sourcePrefix: query.sourcePrefix ?? undefined,
      status: query.status ?? undefined,
      after: query.after ?? undefined,
      before: query.before ?? undefined,
      scheduled: query.scheduledOnly ? true : undefined,
      order: query.order ?? undefined,
    };
  }

  function selectEventRows(
    query: ReturnType<typeof readEventQuery>,
    user: RequestUser | undefined,
    options: { includeAll: boolean; markRunnerDelivered: boolean },
  ): any[] {
    const {
      channelId,
      agentName,
      type,
      typePrefix,
      excludeTypePrefixes,
      sourceFilter,
      sourcePrefix,
      status,
      after,
      before,
      limit,
      descending,
      all,
      scheduledOnly,
    } = query;
    const isRunnerRequest = user?.username === "runner";
    if (channelId && !access.canViewChannel(user, channelId)) return [];
    if (agentName && !isRunnerRequest && !access.canViewAgent(user, agentName)) {
      return [];
    }
    const now = Date.now();
    // includeAll (the sqlite export) stays uncapped — it is a deliberate,
    // rare dump; the client-facing all=1 is capped at MAX_EVENT_ROWS.
    const rowCap = options.includeAll ? null : all ? MAX_EVENT_ROWS : limit;

    const whereClauses: any[] = [];

    if (channelId) {
      whereClauses.push(eq(schema.events.channel_id, channelId));
    }
    if (after) {
      whereClauses.push(gt(schema.events.created_at, Number(after)));
    }
    if (before) {
      whereClauses.push(lt(schema.events.created_at, Number(before)));
    }
    if (type) {
      whereClauses.push(eq(schema.events.type, type));
    }
    if (typePrefix) {
      whereClauses.push(like(schema.events.type, `${typePrefix}%`));
    }
    for (const excludeTypePrefix of excludeTypePrefixes) {
      whereClauses.push(not(like(schema.events.type, `${excludeTypePrefix}%`)));
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
        if (before) {
          receiptClauses.push(lt(schema.events.created_at, Number(before)));
        }
        if (type) {
          receiptClauses.push(eq(schema.events.type, type));
        }
        if (typePrefix) {
          receiptClauses.push(like(schema.events.type, `${typePrefix}%`));
        }
        for (const excludeTypePrefix of excludeTypePrefixes) {
          receiptClauses.push(not(like(schema.events.type, `${excludeTypePrefix}%`)));
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
          rowCap === null ? joinedQuery : joinedQuery.limit(rowCap)
        ).all() as Array<{
          event: any;
          receiptStatus: string;
        }>;

        if (options.markRunnerDelivered && !scheduledOnly) {
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
                const updated = orm
                  .select()
                  .from(schema.events)
                  .where(eq(schema.events.id, eventId))
                  .get() as any | undefined;
                if (updated) {
                  publishEventRow(updated);
                }
              }
            }
          }
        }

        return joinedRows.map((row) => row.event);
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
        return [];
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
    const dbQuery = orm
      .select()
      .from(schema.events)
      .where(whereExpr)
      .orderBy(
        descending
          ? desc(schema.events.created_at)
          : asc(schema.events.created_at),
      );
    const rows = (rowCap === null ? dbQuery : dbQuery.limit(rowCap)).all() as any[];
    return isRunnerRequest
      ? rows
      : rows.filter((row) =>
          !row.channel_id || access.canViewChannel(user, row.channel_id),
        );
  }

  function createEventExportSqlite(query: ReturnType<typeof readEventQuery>, rows: any[]) {
    const timestamp = new Date().toISOString();
    const filenameTimestamp = timestamp.replace(/[:.]/g, "-");
    const tmpDir = mkdtempSync(join(tmpdir(), "orgops-events-export-"));
    const dbPath = join(tmpDir, "orgops-events.sqlite");
    const exportDb = openDb(dbPath);
    try {
      exportDb.exec(`
        PRAGMA journal_mode=DELETE;
        PRAGMA synchronous=OFF;
        CREATE TABLE export_metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE events (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          source TEXT NOT NULL,
          channel_id TEXT,
          parent_event_id TEXT,
          created_at INTEGER NOT NULL,
          deliver_at INTEGER,
          status TEXT NOT NULL,
          fail_count INTEGER NOT NULL,
          last_error TEXT,
          idempotency_key TEXT,
          payload_json TEXT NOT NULL
        );
        CREATE TABLE channels (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          kind TEXT NOT NULL
        );
        CREATE TABLE event_type_counts (
          type TEXT PRIMARY KEY,
          count INTEGER NOT NULL
        );
        CREATE INDEX idx_export_events_type ON events(type);
        CREATE INDEX idx_export_events_channel_id ON events(channel_id);
        CREATE INDEX idx_export_events_created_at ON events(created_at);
      `);

      const insertEvent = exportDb.prepare(`
        INSERT INTO events (
          id,
          type,
          source,
          channel_id,
          parent_event_id,
          created_at,
          deliver_at,
          status,
          fail_count,
          last_error,
          idempotency_key,
          payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertEvents = exportDb.transaction((eventRows: any[]) => {
        for (const row of eventRows) {
          insertEvent.run(
            row.id,
            row.type,
            row.source,
            row.channel_id ?? null,
            row.parent_event_id ?? null,
            row.created_at,
            row.deliver_at ?? null,
            row.status,
            row.fail_count ?? 0,
            row.last_error ?? null,
            row.idempotency_key ?? null,
            row.payload_json,
          );
        }
      });
      insertEvents(rows);

      const channelIds = [
        ...new Set(
          rows
            .map((row) => row.channel_id)
            .filter((channelId): channelId is string => typeof channelId === "string" && channelId.length > 0),
        ),
      ];
      const channels =
        channelIds.length === 0
          ? []
          : (orm
              .select({
                id: schema.channels.id,
                name: schema.channels.name,
                kind: schema.channels.kind,
              })
              .from(schema.channels)
              .where(inArray(schema.channels.id, channelIds))
              .all() as Array<{ id: string; name: string; kind: string }>);
      const insertChannel = exportDb.prepare(
        "INSERT INTO channels (id, name, kind) VALUES (?, ?, ?)",
      );
      const insertChannels = exportDb.transaction(
        (channelRows: Array<{ id: string; name: string; kind: string }>) => {
          for (const channel of channelRows) {
            insertChannel.run(channel.id, channel.name, channel.kind);
          }
        },
      );
      insertChannels(channels);

      const typeCounts = new Map<string, number>();
      for (const row of rows) {
        typeCounts.set(row.type, (typeCounts.get(row.type) ?? 0) + 1);
      }
      const insertTypeCount = exportDb.prepare(
        "INSERT INTO event_type_counts (type, count) VALUES (?, ?)",
      );
      const insertTypeCounts = exportDb.transaction((counts: Map<string, number>) => {
        for (const [eventType, count] of counts) {
          insertTypeCount.run(eventType, count);
        }
      });
      insertTypeCounts(typeCounts);

      let earliestCreatedAt: number | null = null;
      let latestCreatedAt: number | null = null;
      for (const row of rows) {
        const createdAt = row.created_at;
        if (typeof createdAt !== "number") continue;
        if (earliestCreatedAt === null || createdAt < earliestCreatedAt) {
          earliestCreatedAt = createdAt;
        }
        if (latestCreatedAt === null || createdAt > latestCreatedAt) {
          latestCreatedAt = createdAt;
        }
      }
      const metadata: Record<string, string> = {
        schema_version: "orgops.event-export.sqlite.v1",
        exported_at: timestamp,
        source: "orgops-api",
        filters_json: JSON.stringify(serializeEventQueryFilters(query)),
        event_count: String(rows.length),
        channel_count: String(channels.length),
        event_type_count: String(typeCounts.size),
        earliest_created_at: earliestCreatedAt === null ? "" : String(earliestCreatedAt),
        latest_created_at: latestCreatedAt === null ? "" : String(latestCreatedAt),
      };
      const insertMetadata = exportDb.prepare(
        "INSERT INTO export_metadata (key, value) VALUES (?, ?)",
      );
      const insertMetadataRows = exportDb.transaction((values: Record<string, string>) => {
        for (const [key, value] of Object.entries(values)) {
          insertMetadata.run(key, value);
        }
      });
      insertMetadataRows(metadata);

      exportDb.close();
      const bytes = readFileSync(dbPath);
      return {
        bytes,
        filename: `orgops-events-${filenameTimestamp}.sqlite`,
      };
    } finally {
      if (exportDb.open) {
        exportDb.close();
      }
      rmSync(tmpDir, { recursive: true, force: true });
    }
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
    if (parsed.data.channelId && !access.canPostToChannel(user, parsed.data.channelId)) {
      return jsonResponse(c, { error: "Forbidden" }, 403);
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
    const postMembershipError = scheduledTriggerMembershipError(
      type,
      parsed.data.channelId,
      parsed.data.payload ?? {},
    );
    if (postMembershipError) {
      return jsonResponse(c, { error: postMembershipError }, 400);
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

  app.get("/api/events/export.sqlite", (c) => {
    const query = readEventQuery(c.req.url);
    const user = c.get("user") as RequestUser | undefined;
    const rows = selectEventRows(query, user, {
      includeAll: true,
      markRunnerDelivered: false,
    });
    const { bytes, filename } = createEventExportSqlite(query, rows);
    return new Response(bytes, {
      status: 200,
      headers: {
        "content-type": "application/vnd.sqlite3",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  });

  // Aggregate counters for dashboards. Replaces the `all=1` full-table dump the
  // UI used for five numbers: a GROUP BY over ~273k rows is milliseconds in
  // SQLite, the dump was an ~80 MB serialization that blocked the event loop.
  // Visibility matches the listing endpoint: events of existing channels the
  // user cannot view are excluded; channel-less and legacy-channel events count.
  app.get("/api/events/stats", (c) => {
    const user = c.get("user") as RequestUser | undefined;
    const allChannelIds = orm
      .select({ id: schema.channels.id })
      .from(schema.channels)
      .all()
      .map((row) => row.id);
    const visibleIds = new Set(access.listVisibleChannelIds(user));
    const hiddenIds = allChannelIds.filter((id) => !visibleIds.has(id));
    const grouped = orm
      .select({ status: schema.events.status, count: sql<number>`count(*)` })
      .from(schema.events)
      .where(
        hiddenIds.length > 0
          ? or(
              isNull(schema.events.channel_id),
              not(inArray(schema.events.channel_id, hiddenIds)),
            )
          : undefined,
      )
      .groupBy(schema.events.status)
      .all() as Array<{ status: string; count: number }>;
    let total = 0;
    const byStatus: Record<string, number> = {};
    for (const row of grouped) {
      byStatus[row.status] = row.count;
      total += row.count;
    }
    return jsonResponse(c, { total, byStatus });
  });

  app.get("/api/events/:id", (c) => {
    const id = c.req.param("id");
    const user = c.get("user") as RequestUser | undefined;
    const row = orm
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, id))
      .get() as any | undefined;
    if (!row) {
      return jsonResponse(c, { error: "Not found" }, 404);
    }
    if (row.channel_id && !access.canViewChannel(user, row.channel_id)) {
      return jsonResponse(c, { error: "Not found" }, 404);
    }
    return jsonResponse(c, eventRowToApi(row));
  });

  app.patch("/api/events/:id", async (c) => {
    const id = c.req.param("id");
    const user = c.get("user") as RequestUser | undefined;
    const existing = orm
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, id))
      .get() as any | undefined;
    if (!existing) {
      return jsonResponse(c, { error: "Not found" }, 404);
    }
    if (existing.channel_id && !access.canPostToChannel(user, existing.channel_id)) {
      return jsonResponse(c, { error: "Forbidden" }, 403);
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
    const patchMembershipError = scheduledTriggerMembershipError(
      nextType,
      nextChannelId ?? undefined,
      nextPayload ?? {},
    );
    if (patchMembershipError) {
      return jsonResponse(c, { error: patchMembershipError }, 400);
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
    publishEventRow(updated);
    return jsonResponse(c, eventRowToApi(updated));
  });

  app.get("/api/events", (c) => {
    const query = readEventQuery(c.req.url);
    const user = c.get("user") as RequestUser | undefined;
    const rows = selectEventRows(query, user, {
      includeAll: false,
      markRunnerDelivered: true,
    });
    return jsonResponse(c, rows.map(eventRowToApi));
  });

  app.delete("/api/events", (c) => {
    const url = new URL(c.req.url);
    const params = url.searchParams;
    const channelId = params.get("channelId");
    const type = params.get("type");
    const sourceFilter = params.get("source");
    const status = params.get("status");
    const user = c.get("user") as RequestUser | undefined;
    if (user?.username !== "runner") {
      if (channelId && !access.canPostToChannel(user, channelId)) {
        return jsonResponse(c, { error: "Forbidden" }, 403);
      }
    }

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
    const user = c.get("user") as RequestUser | undefined;
    const existing = orm
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, id))
      .get() as any | undefined;
    if (!existing) {
      return jsonResponse(c, { error: "Not found" }, 404);
    }
    if (existing.channel_id && !access.canPostToChannel(user, existing.channel_id)) {
      return jsonResponse(c, { error: "Forbidden" }, 403);
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
    const user = c.get("user") as RequestUser | undefined;
    if (!access.canPostToChannel(user, channelId)) {
      return jsonResponse(c, { error: "Forbidden" }, 403);
    }
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
    const updated = orm
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, id))
      .get() as any | undefined;
    if (updated) {
      publishEventRow(updated);
    }
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
    const updated = orm
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, id))
      .get() as any | undefined;
    if (updated) {
      publishEventRow(updated);
    }
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
