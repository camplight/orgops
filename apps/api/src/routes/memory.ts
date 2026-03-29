import type { Hono } from "hono";
import { sql } from "drizzle-orm";
import { and, desc, eq, inArray } from "drizzle-orm";
import { schema, type OrgOpsDrizzleDb } from "@orgops/db";

type MemoryDeps = {
  orm: OrgOpsDrizzleDb;
  jsonResponse: (c: any, data: unknown, status?: number) => Response;
};

type ChannelMode = "recent" | "full";
type CrossMode = "recent" | "full";

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function asInt(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
}

export function registerMemoryRoutes(app: Hono<any>, deps: MemoryDeps) {
  const { orm, jsonResponse } = deps;

  const channelTable = (mode: ChannelMode) =>
    mode === "recent" ? schema.channelMemoryRecent : schema.channelMemoryFull;
  const crossTable = (mode: CrossMode) =>
    mode === "recent" ? schema.crossChannelMemoryRecent : schema.crossChannelMemoryFull;

  async function parseBody(c: any): Promise<any | null> {
    const raw = await c.req.text();
    try {
      return raw ? JSON.parse(raw) : {};
    } catch {
      return null;
    }
  }

  function mapChannelRecord(row: any, mode: ChannelMode) {
    if (!row) return null;
    return {
      agentName: row.agent_name,
      channelId: row.channel_id,
      summaryText: row.summary_text ?? "",
      ...(mode === "recent" ? { windowStartAt: asInt(row.window_start_at, 0) } : {}),
      lastProcessedAt: asInt(row.last_processed_at, 0),
      ...(asNonEmptyString(row.last_processed_event_id)
        ? { lastProcessedEventId: row.last_processed_event_id }
        : {}),
      version: asInt(row.version, 0),
      createdAt: asInt(row.created_at, 0),
      updatedAt: asInt(row.updated_at, 0),
    };
  }

  function mapCrossRecord(row: any, mode: CrossMode) {
    if (!row) return null;
    return {
      agentName: row.agent_name,
      summaryText: row.summary_text ?? "",
      ...(mode === "recent" ? { windowStartAt: asInt(row.window_start_at, 0) } : {}),
      lastProcessedAt: asInt(row.last_processed_at, 0),
      ...(asNonEmptyString(row.last_processed_event_id)
        ? { lastProcessedEventId: row.last_processed_event_id }
        : {}),
      version: asInt(row.version, 0),
      createdAt: asInt(row.created_at, 0),
      updatedAt: asInt(row.updated_at, 0),
    };
  }

  function registerChannel(mode: ChannelMode) {
    const table = channelTable(mode);
    const path = `/api/memory/channel/${mode}`;

    app.get(path, (c) => {
      const agentName = asNonEmptyString(c.req.query("agentName"));
      if (!agentName) return jsonResponse(c, { error: "agentName is required" }, 400);
      const channelId = asNonEmptyString(c.req.query("channelId"));
      if (channelId) {
        const record = orm
          .select()
          .from(table)
          .where(and(eq(table.agent_name, agentName), eq(table.channel_id, channelId)))
          .get();
        return jsonResponse(c, { record: mapChannelRecord(record, mode) });
      }
      const channelIdsRaw = asNonEmptyString(c.req.query("channelIds"));
      const channelIds = channelIdsRaw
        ? channelIdsRaw.split(",").map((entry) => entry.trim()).filter(Boolean)
        : [];
      const records =
        channelIds.length > 0
          ? orm
              .select()
              .from(table)
              .where(and(eq(table.agent_name, agentName), inArray(table.channel_id, channelIds)))
              .orderBy(desc(table.updated_at))
              .all()
          : orm
              .select()
              .from(table)
              .where(eq(table.agent_name, agentName))
              .orderBy(desc(table.updated_at))
              .all();
      return jsonResponse(c, { records: records.map((record) => mapChannelRecord(record, mode)) });
    });

    app.put(path, async (c) => {
      const body = await parseBody(c);
      if (!body) return jsonResponse(c, { error: "Invalid JSON" }, 400);
      const agentName = asNonEmptyString(body.agentName);
      const channelId = asNonEmptyString(body.channelId);
      if (!agentName || !channelId) {
        return jsonResponse(c, { error: "agentName and channelId are required" }, 400);
      }

      const existing = orm
        .select()
        .from(table)
        .where(and(eq(table.agent_name, agentName), eq(table.channel_id, channelId)))
        .get() as any;
      const expectedVersion =
        typeof body.expectedVersion === "number" && Number.isFinite(body.expectedVersion)
          ? Math.floor(body.expectedVersion)
          : undefined;
      if (
        expectedVersion !== undefined &&
        existing &&
        asInt(existing.version, 0) !== expectedVersion
      ) {
        return jsonResponse(
          c,
          {
            error: "Version conflict",
            expectedVersion,
            actualVersion: asInt(existing.version, 0),
          },
          409,
        );
      }

      const now = Date.now();
      const patch = {
        summary_text: typeof body.summaryText === "string" ? body.summaryText : "",
        ...(mode === "recent" ? { window_start_at: asInt(body.windowStartAt, 0) } : {}),
        last_processed_at: asInt(body.lastProcessedAt, 0),
        last_processed_event_id: asNonEmptyString(body.lastProcessedEventId),
        version: asInt(existing?.version, 0) + 1,
        updated_at: now,
      };
      if (existing) {
        orm
          .update(table)
          .set(patch)
          .where(and(eq(table.agent_name, agentName), eq(table.channel_id, channelId)))
          .run();
      } else {
        orm
          .insert(table)
          .values({
            agent_name: agentName,
            channel_id: channelId,
            ...patch,
            created_at: now,
          } as any)
          .run();
      }
      const record = orm
        .select()
        .from(table)
        .where(and(eq(table.agent_name, agentName), eq(table.channel_id, channelId)))
        .get();
      return jsonResponse(c, { record: mapChannelRecord(record, mode) });
    });
  }

  function registerCross(mode: CrossMode) {
    const table = crossTable(mode);
    const path = `/api/memory/cross/${mode}`;

    app.get(path, (c) => {
      const agentName = asNonEmptyString(c.req.query("agentName"));
      if (!agentName) return jsonResponse(c, { error: "agentName is required" }, 400);
      const record = orm
        .select()
        .from(table)
        .where(eq(table.agent_name, agentName))
        .get();
      return jsonResponse(c, { record: mapCrossRecord(record, mode) });
    });

    app.put(path, async (c) => {
      const body = await parseBody(c);
      if (!body) return jsonResponse(c, { error: "Invalid JSON" }, 400);
      const agentName = asNonEmptyString(body.agentName);
      if (!agentName) return jsonResponse(c, { error: "agentName is required" }, 400);
      const existing = orm
        .select()
        .from(table)
        .where(eq(table.agent_name, agentName))
        .get() as any;
      const expectedVersion =
        typeof body.expectedVersion === "number" && Number.isFinite(body.expectedVersion)
          ? Math.floor(body.expectedVersion)
          : undefined;
      if (
        expectedVersion !== undefined &&
        existing &&
        asInt(existing.version, 0) !== expectedVersion
      ) {
        return jsonResponse(
          c,
          {
            error: "Version conflict",
            expectedVersion,
            actualVersion: asInt(existing.version, 0),
          },
          409,
        );
      }
      const now = Date.now();
      const patch = {
        summary_text: typeof body.summaryText === "string" ? body.summaryText : "",
        ...(mode === "recent" ? { window_start_at: asInt(body.windowStartAt, 0) } : {}),
        last_processed_at: asInt(body.lastProcessedAt, 0),
        last_processed_event_id: asNonEmptyString(body.lastProcessedEventId),
        version: asInt(existing?.version, 0) + 1,
        updated_at: now,
      };
      if (existing) {
        orm
          .update(table)
          .set(patch)
          .where(eq(table.agent_name, agentName))
          .run();
      } else {
        orm
          .insert(table)
          .values({
            agent_name: agentName,
            ...patch,
            created_at: now,
          } as any)
          .run();
      }
      const record = orm
        .select()
        .from(table)
        .where(eq(table.agent_name, agentName))
        .get();
      return jsonResponse(c, { record: mapCrossRecord(record, mode) });
    });
  }

  registerChannel("recent");
  registerChannel("full");
  registerCross("recent");
  registerCross("full");

  app.delete("/api/memory", (c) => {
    const countRows = {
      channelRecent:
        (orm
          .select({ count: sql<number>`count(*)` })
          .from(schema.channelMemoryRecent)
          .get() as { count: number } | undefined)?.count ?? 0,
      channelFull:
        (orm
          .select({ count: sql<number>`count(*)` })
          .from(schema.channelMemoryFull)
          .get() as { count: number } | undefined)?.count ?? 0,
      crossRecent:
        (orm
          .select({ count: sql<number>`count(*)` })
          .from(schema.crossChannelMemoryRecent)
          .get() as { count: number } | undefined)?.count ?? 0,
      crossFull:
        (orm
          .select({ count: sql<number>`count(*)` })
          .from(schema.crossChannelMemoryFull)
          .get() as { count: number } | undefined)?.count ?? 0,
    };

    orm.delete(schema.channelMemoryRecent).run();
    orm.delete(schema.channelMemoryFull).run();
    orm.delete(schema.crossChannelMemoryRecent).run();
    orm.delete(schema.crossChannelMemoryFull).run();

    return jsonResponse(c, {
      ok: true,
      clearedCount:
        countRows.channelRecent +
        countRows.channelFull +
        countRows.crossRecent +
        countRows.crossFull,
      tables: countRows,
    });
  });
}
