import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { CronExpressionParser } from "cron-parser";
import { schema, type OrgOpsDrizzleDb } from "@orgops/db";
import type { AccessControl, RequestUser } from "./access";

type SchedulesDeps = {
  orm: OrgOpsDrizzleDb;
  jsonResponse: (c: any, data: unknown, status?: number) => Response;
  access: AccessControl;
};

const scheduleInput = z.object({
  name: z.string().trim().min(1).nullable().optional(),
  channelId: z.string().trim().min(1),
  targetAgentName: z.string().trim().min(1),
  cronExpression: z.string().trim().min(1),
  timezone: z.string().trim().min(1).default("UTC"),
  text: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(["ACTIVE", "PAUSED"]).optional(),
  misfirePolicy: z.enum(["FIRE_ONCE", "SKIP", "CATCH_UP"]).optional(),
});

const schedulePatch = scheduleInput.partial().extend({
  version: z.number().int().positive().optional(),
});

function rowToApi(row: any) {
  let payload = {};
  try {
    payload = JSON.parse(row.payload_json ?? "{}");
  } catch {}
  return {
    id: row.id,
    name: row.name ?? undefined,
    channelId: row.channel_id,
    targetAgentName: row.target_agent_name,
    cronExpression: row.cron_expression,
    timezone: row.timezone,
    text: row.text,
    payload,
    status: row.status,
    misfirePolicy: row.misfire_policy,
    nextFireAt: row.next_fire_at,
    lastOccurrenceAt: row.last_occurrence_at ?? undefined,
    lastError: row.last_error ?? undefined,
    createdByType: row.created_by_type,
    createdById: row.created_by_id ?? undefined,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateCron(expression: string, timezone: string, currentDate: number) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date(currentDate));
    const parsed = CronExpressionParser.parse(expression, {
      currentDate: new Date(currentDate),
      tz: timezone,
    });
    return { ok: true as const, nextFireAt: parsed.next().getTime() };
  } catch (error) {
    return { ok: false as const, error: String(error) };
  }
}

export function registerSchedulesRoutes(app: Hono<any>, deps: SchedulesDeps) {
  const { orm, jsonResponse, access } = deps;

  function canUseTarget(user: RequestUser | undefined, channelId: string, agentName: string) {
    if (!access.canPostToChannel(user, channelId)) return false;
    if (user?.username === "runner") return access.canManageAgent(user, agentName);
    return true;
  }

  function hasMembership(channelId: string, agentName: string) {
    return Boolean(
      orm
        .select({ channelId: schema.channelSubscriptions.channel_id })
        .from(schema.channelSubscriptions)
        .innerJoin(
          schema.agents,
          eq(schema.agents.name, schema.channelSubscriptions.subscriber_id),
        )
        .where(
          and(
            eq(schema.channelSubscriptions.channel_id, channelId),
            eq(schema.channelSubscriptions.subscriber_type, "AGENT"),
            eq(schema.channelSubscriptions.subscriber_id, agentName),
          ),
        )
        .get(),
    );
  }

  app.post("/api/schedules", async (c) => {
    const parsed = scheduleInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonResponse(c, { error: "Invalid payload" }, 400);
    const user = c.get("user") as RequestUser | undefined;
    const input = parsed.data;
    if (!canUseTarget(user, input.channelId, input.targetAgentName)) {
      return jsonResponse(c, { error: "Forbidden" }, 403);
    }
    if (!hasMembership(input.channelId, input.targetAgentName)) {
      return jsonResponse(c, { error: "Target agent is not an AGENT participant in the channel" }, 400);
    }
    const timestamp = Date.now();
    const cron = validateCron(input.cronExpression, input.timezone, timestamp);
    if (!cron.ok) return jsonResponse(c, { error: `Invalid cron/timezone: ${cron.error}` }, 400);
    const row = {
      id: randomUUID(),
      name: input.name ?? null,
      channel_id: input.channelId,
      target_agent_name: input.targetAgentName,
      cron_expression: input.cronExpression,
      timezone: input.timezone,
      text: input.text,
      payload_json: JSON.stringify(input.payload ?? {}),
      status: input.status ?? "ACTIVE",
      misfire_policy: input.misfirePolicy ?? "FIRE_ONCE",
      next_fire_at: cron.nextFireAt,
      last_occurrence_at: null,
      last_error: null,
      created_by_type: user?.username === "runner" ? "AGENT" : "HUMAN",
      created_by_id:
        user?.username === "runner"
          ? user.sourceAgentName ?? user.runnerScope?.allowedAgentName ?? null
          : user?.id ?? user?.username ?? null,
      version: 1,
      created_at: timestamp,
      updated_at: timestamp,
    };
    orm.insert(schema.recurringSchedules).values(row).run();
    return jsonResponse(c, rowToApi(row), 201);
  });

  app.get("/api/schedules", (c) => {
    const user = c.get("user") as RequestUser | undefined;
    const channelId = new URL(c.req.url).searchParams.get("channelId");
    const rows = channelId
      ? orm
          .select()
          .from(schema.recurringSchedules)
          .where(eq(schema.recurringSchedules.channel_id, channelId))
          .all()
      : orm.select().from(schema.recurringSchedules).all();
    return jsonResponse(
      c,
      rows
        .filter(
          (row) =>
            access.canViewChannel(user, row.channel_id) &&
            (user?.username !== "runner" || access.canManageAgent(user, row.target_agent_name)),
        )
        .map(rowToApi),
    );
  });

  app.patch("/api/schedules/:id", async (c) => {
    const existing = orm
      .select()
      .from(schema.recurringSchedules)
      .where(eq(schema.recurringSchedules.id, c.req.param("id")))
      .get();
    if (!existing) return jsonResponse(c, { error: "Not found" }, 404);
    const parsed = schedulePatch.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonResponse(c, { error: "Invalid payload" }, 400);
    const user = c.get("user") as RequestUser | undefined;
    const input = parsed.data;
    const channelId = input.channelId ?? existing.channel_id;
    const targetAgentName = input.targetAgentName ?? existing.target_agent_name;
    if (!canUseTarget(user, existing.channel_id, existing.target_agent_name)) {
      return jsonResponse(c, { error: "Forbidden" }, 403);
    }
    if (!canUseTarget(user, channelId, targetAgentName)) {
      return jsonResponse(c, { error: "Forbidden" }, 403);
    }
    if (input.version !== undefined && input.version !== existing.version) {
      return jsonResponse(c, { error: "Schedule version conflict" }, 409);
    }
    if (!hasMembership(channelId, targetAgentName)) {
      return jsonResponse(c, { error: "Target agent is not an AGENT participant in the channel" }, 400);
    }
    const timestamp = Date.now();
    const cronExpression = input.cronExpression ?? existing.cron_expression;
    const timezone = input.timezone ?? existing.timezone;
    const cronChanged =
      input.cronExpression !== undefined ||
      input.timezone !== undefined ||
      (input.status === "ACTIVE" && existing.status !== "ACTIVE");
    let nextFireAt = existing.next_fire_at;
    if (cronChanged) {
      const cron = validateCron(cronExpression, timezone, timestamp);
      if (!cron.ok) return jsonResponse(c, { error: `Invalid cron/timezone: ${cron.error}` }, 400);
      nextFireAt = cron.nextFireAt;
    }
    orm
      .update(schema.recurringSchedules)
      .set({
        name: input.name !== undefined ? input.name : existing.name,
        channel_id: channelId,
        target_agent_name: targetAgentName,
        cron_expression: cronExpression,
        timezone,
        text: input.text ?? existing.text,
        payload_json:
          input.payload !== undefined ? JSON.stringify(input.payload) : existing.payload_json,
        status: input.status ?? existing.status,
        misfire_policy: input.misfirePolicy ?? existing.misfire_policy,
        next_fire_at: nextFireAt,
        last_error: input.status === "ACTIVE" ? null : existing.last_error,
        version: existing.version + 1,
        updated_at: timestamp,
      })
      .where(eq(schema.recurringSchedules.id, existing.id))
      .run();
    const updated = orm
      .select()
      .from(schema.recurringSchedules)
      .where(eq(schema.recurringSchedules.id, existing.id))
      .get();
    return jsonResponse(c, rowToApi(updated));
  });

  app.delete("/api/schedules/:id", (c) => {
    const existing = orm
      .select()
      .from(schema.recurringSchedules)
      .where(eq(schema.recurringSchedules.id, c.req.param("id")))
      .get();
    if (!existing) return jsonResponse(c, { error: "Not found" }, 404);
    const user = c.get("user") as RequestUser | undefined;
    if (!canUseTarget(user, existing.channel_id, existing.target_agent_name)) {
      return jsonResponse(c, { error: "Forbidden" }, 403);
    }
    orm
      .delete(schema.recurringSchedules)
      .where(eq(schema.recurringSchedules.id, existing.id))
      .run();
    return jsonResponse(c, { ok: true, id: existing.id });
  });
}
