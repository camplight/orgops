import { and, eq, isNull, lte } from "drizzle-orm";
import { CronExpressionParser } from "cron-parser";
import { schema, type OrgOpsDrizzleDb } from "@orgops/db";

type SchedulerDeps = {
  orm: OrgOpsDrizzleDb;
  insertEvent: (input: any) => any;
  intervalMs?: number;
  now?: () => number;
};

export function nextCronOccurrence(
  expression: string,
  timezone: string,
  after: number,
): number {
  return CronExpressionParser.parse(expression, {
    currentDate: new Date(after),
    tz: timezone,
  }).next().getTime();
}

export function createRecurringScheduler(deps: SchedulerDeps) {
  const now = deps.now ?? Date.now;
  const graceMs = positiveInt(process.env.ORGOPS_SCHEDULE_MISFIRE_GRACE_MS, 60_000);
  const catchUpLimit = positiveInt(process.env.ORGOPS_SCHEDULE_CATCH_UP_LIMIT, 10);
  let timer: NodeJS.Timeout | null = null;
  let ticking = false;

  function materialize(schedule: any, scheduledFor: number) {
    const idempotencyKey = `schedule:${schedule.id}:${scheduledFor}`;
    const existing = deps.orm
      .select({ id: schema.events.id })
      .from(schema.events)
      .where(eq(schema.events.idempotency_key, idempotencyKey))
      .get();
    if (existing) return;
    let extraPayload: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(schedule.payload_json ?? "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        extraPayload = parsed;
      }
    } catch {}
    deps.insertEvent({
      type: "agent.scheduled.trigger",
      source: "system:scheduler",
      channelId: schedule.channel_id,
      payload: {
        ...extraPayload,
        text: schedule.text,
        targetAgentName: schedule.target_agent_name,
        scheduleId: schedule.id,
        scheduledFor,
      },
      idempotencyKey,
    });
  }

  function advancePast(schedule: any, timestamp: number) {
    let cursor = schedule.next_fire_at;
    let guard = 0;
    while (cursor <= timestamp && guard < 100_000) {
      cursor = nextCronOccurrence(schedule.cron_expression, schedule.timezone, cursor);
      guard += 1;
    }
    if (cursor <= timestamp) throw new Error("Unable to advance schedule safely");
    return cursor;
  }

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const timestamp = now();
      const due = deps.orm
        .select()
        .from(schema.recurringSchedules)
        .where(
          and(
            eq(schema.recurringSchedules.status, "ACTIVE"),
            lte(schema.recurringSchedules.next_fire_at, timestamp),
          ),
        )
        .limit(100)
        .all();
      for (const schedule of due) {
        try {
          const membership = deps.orm
            .select({ channelId: schema.channelSubscriptions.channel_id })
            .from(schema.channelSubscriptions)
            .innerJoin(
              schema.agents,
              eq(schema.agents.name, schema.channelSubscriptions.subscriber_id),
            )
            .innerJoin(
              schema.channels,
              eq(schema.channels.id, schema.channelSubscriptions.channel_id),
            )
            .where(
              and(
                eq(schema.channelSubscriptions.channel_id, schedule.channel_id),
                eq(schema.channelSubscriptions.subscriber_type, "AGENT"),
                eq(schema.channelSubscriptions.subscriber_id, schedule.target_agent_name),
                isNull(schema.channels.archived_at),
              ),
            )
            .get();
          if (!membership) {
            deps.orm
              .update(schema.recurringSchedules)
              .set({
                status: "PAUSED",
                last_error: `Target agent "${schedule.target_agent_name}" is no longer an active AGENT participant in channel "${schedule.channel_id}".`,
                version: schedule.version + 1,
                updated_at: timestamp,
              })
              .where(eq(schema.recurringSchedules.id, schedule.id))
              .run();
            continue;
          }

          const policy = schedule.misfire_policy;
          let occurrences: number[] = [];
          if (policy === "SKIP" && timestamp - schedule.next_fire_at > graceMs) {
            occurrences = [];
          } else if (policy === "CATCH_UP") {
            let cursor = schedule.next_fire_at;
            while (cursor <= timestamp && occurrences.length < catchUpLimit) {
              occurrences.push(cursor);
              cursor = nextCronOccurrence(schedule.cron_expression, schedule.timezone, cursor);
            }
          } else {
            occurrences = [schedule.next_fire_at];
          }

          for (const occurrence of occurrences) materialize(schedule, occurrence);
          const nextFireAt = advancePast(schedule, timestamp);
          deps.orm
            .update(schema.recurringSchedules)
            .set({
              next_fire_at: nextFireAt,
              last_occurrence_at:
                occurrences.length > 0
                  ? occurrences[occurrences.length - 1]
                  : schedule.last_occurrence_at,
              last_error: null,
              version: schedule.version + 1,
              updated_at: timestamp,
            })
            .where(eq(schema.recurringSchedules.id, schedule.id))
            .run();
        } catch (error) {
          deps.orm
            .update(schema.recurringSchedules)
            .set({
              last_error: String(error).slice(0, 8192),
              updated_at: timestamp,
            })
            .where(eq(schema.recurringSchedules.id, schedule.id))
            .run();
        }
      }
    } finally {
      ticking = false;
    }
  }

  function start() {
    const configuredInterval = Number(process.env.ORGOPS_SCHEDULE_TICK_INTERVAL_MS);
    const intervalMs =
      deps.intervalMs ??
      (Number.isFinite(configuredInterval)
        ? Math.floor(configuredInterval)
        : 1000);
    if (intervalMs <= 0 || timer) return;
    timer = setInterval(() => {
      void tick().catch((error) => {
        if (/database connection is not open/i.test(String(error))) {
          stop();
          return;
        }
        console.error("Recurring scheduler tick failed", error);
      });
    }, intervalMs);
    timer.unref();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { tick, start, stop };
}

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
