import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDrizzleDb, openDb, schema } from "@orgops/db";
import { and, eq } from "drizzle-orm";
import { createApp } from "./app";
import { createRecurringScheduler } from "./recurring-scheduler";
import { generateRunnerScopedToken } from "./agent-invite-auth";

const temporaryDirectories: string[] = [];

afterEach(() => {
  delete process.env.ORGOPS_EVENT_MAX_FAILURES;
  delete process.env.ORGOPS_SCHEDULE_CATCH_UP_LIMIT;
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), "orgops-reliability-"));
  temporaryDirectories.push(dataDir);
  const db = openDb(":memory:");
  const created = createApp({
    db,
    dataDir,
    adminUser: "admin",
    adminPass: "admin",
    runnerToken: "global-runner",
  });
  created.recurringScheduler.stop();
  const orm = createDrizzleDb(db);
  const login = await created.app.request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin" }),
  });
  const cookie = login.headers.get("set-cookie") ?? "";
  const now = Date.now();
  for (const name of ["agent-a", "agent-b"]) {
    orm.insert(schema.agents)
      .values({
        id: `id-${name}`,
        name,
        model_id: "openai:test",
        workspace_path: join(dataDir, name),
        created_at: now,
        updated_at: now,
      })
      .run();
  }
  orm.insert(schema.channels)
    .values({
      id: "channel-1",
      name: `channel-${now}`,
      created_at: now,
    })
    .run();
  orm.insert(schema.channelSubscriptions)
    .values(
      ["agent-a", "agent-b"].map((name) => ({
        channel_id: "channel-1",
        subscriber_type: "AGENT",
        subscriber_id: name,
      })),
    )
    .run();
  return { ...created, orm, cookie };
}

async function postMessage(app: any, cookie: string) {
  const response = await app.request("http://localhost/api/events", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      type: "message.created",
      source: "human:admin",
      channelId: "channel-1",
      payload: { text: "reliable work" },
    }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string };
}

describe("durable event receipts", () => {
  it("keeps polling non-destructive and acknowledges only the caller's receipt", async () => {
    const { app, orm, cookie } = await setup();
    const event = await postMessage(app, cookie);
    const headers = {
      "x-orgops-runner-token": "global-runner",
      "x-orgops-agent-name": "agent-a",
    };
    const first = await app.request(
      "http://localhost/api/events?agentName=agent-a&status=PENDING&channelId=channel-1",
      { headers },
    );
    const second = await app.request(
      "http://localhost/api/events?agentName=agent-a&status=PENDING&channelId=channel-1",
      { headers },
    );
    expect((await first.json()).map((row: any) => row.id)).toContain(event.id);
    expect((await second.json()).map((row: any) => row.id)).toContain(event.id);

    const ack = await app.request(`http://localhost/api/events/${event.id}/ack`, {
      method: "POST",
      headers,
    });
    expect(ack.status).toBe(200);
    const receipts = orm
      .select()
      .from(schema.eventReceipts)
      .where(eq(schema.eventReceipts.event_id, event.id))
      .all();
    expect(receipts.find((row) => row.agent_name === "agent-a")?.status).toBe("DELIVERED");
    expect(receipts.find((row) => row.agent_name === "agent-b")?.status).toBe("PENDING");
    expect(
      orm.select().from(schema.events).where(eq(schema.events.id, event.id)).get()?.status,
    ).toBe("PENDING");
  });

  it("requeues with durable backoff, then dead-letters once", async () => {
    process.env.ORGOPS_EVENT_MAX_FAILURES = "2";
    const { app, orm, cookie } = await setup();
    const event = await postMessage(app, cookie);
    const headers = {
      "content-type": "application/json",
      "x-orgops-runner-token": "global-runner",
      "x-orgops-agent-name": "agent-a",
    };
    const first = await app.request(`http://localhost/api/events/${event.id}/fail`, {
      method: "POST",
      headers,
      body: JSON.stringify({ error: "first failure" }),
    });
    expect(await first.json()).toMatchObject({ status: "PENDING", failCount: 1 });
    const receipt = orm
      .select()
      .from(schema.eventReceipts)
      .where(
        and(
          eq(schema.eventReceipts.event_id, event.id),
          eq(schema.eventReceipts.agent_name, "agent-a"),
        ),
      )
      .get();
    expect(receipt?.retry_at).toBeGreaterThan(Date.now());
    expect(receipt?.last_error).toBe("first failure");

    const duplicateDuringBackoff = await app.request(
      `http://localhost/api/events/${event.id}/fail`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ error: "duplicate during backoff" }),
      },
    );
    expect(await duplicateDuringBackoff.json()).toMatchObject({
      status: "PENDING",
      failCount: 1,
      ignored: true,
    });
    orm
      .update(schema.eventReceipts)
      .set({ retry_at: Date.now() - 1 })
      .where(
        and(
          eq(schema.eventReceipts.event_id, event.id),
          eq(schema.eventReceipts.agent_name, "agent-a"),
        ),
      )
      .run();
    const second = await app.request(`http://localhost/api/events/${event.id}/fail`, {
      method: "POST",
      headers,
      body: JSON.stringify({ error: "second failure" }),
    });
    expect(await second.json()).toMatchObject({ status: "DEAD", failCount: 2 });
    await app.request(`http://localhost/api/events/${event.id}/fail`, {
      method: "POST",
      headers,
      body: JSON.stringify({ error: "duplicate" }),
    });
    const deadletters = orm
      .select()
      .from(schema.events)
      .where(eq(schema.events.idempotency_key, `deadletter:${event.id}:agent-a`))
      .all();
    expect(deadletters).toHaveLength(1);
  });

  it("does not resurrect terminal receipts", async () => {
    process.env.ORGOPS_EVENT_MAX_FAILURES = "1";
    const { app, orm, cookie } = await setup();
    const event = await postMessage(app, cookie);
    const headers = {
      "content-type": "application/json",
      "x-orgops-runner-token": "global-runner",
      "x-orgops-agent-name": "agent-a",
    };
    const failed = await app.request(`http://localhost/api/events/${event.id}/fail`, {
      method: "POST",
      headers,
      body: JSON.stringify({ error: "terminal failure" }),
    });
    expect(await failed.json()).toMatchObject({ status: "DEAD", failCount: 1 });
    const ackDead = await app.request(`http://localhost/api/events/${event.id}/ack`, {
      method: "POST",
      headers,
    });
    expect(await ackDead.json()).toMatchObject({ status: "DEAD", failCount: 1 });

    const otherHeaders = { ...headers, "x-orgops-agent-name": "agent-b" };
    await app.request(`http://localhost/api/events/${event.id}/ack`, {
      method: "POST",
      headers: otherHeaders,
    });
    const failDelivered = await app.request(`http://localhost/api/events/${event.id}/fail`, {
      method: "POST",
      headers: otherHeaders,
      body: JSON.stringify({ error: "late duplicate failure" }),
    });
    expect(await failDelivered.json()).toMatchObject({
      status: "DELIVERED",
      failCount: 0,
    });
    const receipts = orm
      .select()
      .from(schema.eventReceipts)
      .where(eq(schema.eventReceipts.event_id, event.id))
      .all();
    expect(receipts.find((row) => row.agent_name === "agent-a")?.status).toBe("DEAD");
    expect(receipts.find((row) => row.agent_name === "agent-b")?.status).toBe("DELIVERED");
  });

  it("keeps provider credit failures recoverable beyond the dead-letter limit", async () => {
    process.env.ORGOPS_EVENT_MAX_FAILURES = "1";
    const { app, orm, cookie } = await setup();
    const event = await postMessage(app, cookie);
    const response = await app.request(
      `http://localhost/api/events/${event.id}/fail`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-orgops-runner-token": "global-runner",
          "x-orgops-agent-name": "agent-a",
        },
        body: JSON.stringify({
          error: "You have no credits remaining. Add credits to continue.",
        }),
      },
    );
    expect(await response.json()).toMatchObject({
      status: "PENDING",
      failCount: 1,
    });
    const receipt = orm
      .select()
      .from(schema.eventReceipts)
      .where(
        and(
          eq(schema.eventReceipts.event_id, event.id),
          eq(schema.eventReceipts.agent_name, "agent-a"),
        ),
      )
      .get();
    expect(receipt?.status).toBe("PENDING");
    expect(receipt?.retry_at).toBeGreaterThan(Date.now());
  });

  it("treats Anthropic credit-balance and 402 failures as recoverable", async () => {
    process.env.ORGOPS_EVENT_MAX_FAILURES = "1";
    const { app, orm, cookie } = await setup();
    for (const error of [
      "Your credit balance is too low to access the Anthropic API",
      "HTTP 402 Payment Required",
    ]) {
      const event = await postMessage(app, cookie);
      const response = await app.request(
        `http://localhost/api/events/${event.id}/fail`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-orgops-runner-token": "global-runner",
            "x-orgops-agent-name": "agent-a",
          },
          body: JSON.stringify({ error }),
        },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: "PENDING" });
      const receipt = orm
        .select()
        .from(schema.eventReceipts)
        .where(
          and(
            eq(schema.eventReceipts.event_id, event.id),
            eq(schema.eventReceipts.agent_name, "agent-a"),
          ),
        )
        .get();
      expect(receipt?.status).toBe("PENDING");
      expect(receipt?.attempt_count).toBe(1);
      expect(receipt?.retry_at).toBeGreaterThan(Date.now());
    }
  });

  it("scopes receipt mutation and targets scheduled-trigger receipts", async () => {
    const { app, orm, cookie } = await setup();
    const event = await postMessage(app, cookie);
    const generated = generateRunnerScopedToken();
    orm.insert(schema.runnerTokens)
      .values({
        id: "scoped-token",
        name: "agent-a token",
        token_hash: generated.hash,
        token_prefix: generated.prefix,
        allowed_agent_name: "agent-a",
        allowed_runner_id: "runner-a",
        allowed_channel_ids_json: JSON.stringify(["channel-1"]),
        runner_scope_mode: "SCOPED",
        created_at: Date.now(),
      })
      .run();
    const forbidden = await app.request(`http://localhost/api/events/${event.id}/ack`, {
      method: "POST",
      headers: {
        "x-orgops-runner-token": generated.token,
        "x-orgops-agent-name": "agent-b",
      },
    });
    expect(forbidden.status).toBe(403);

    const trigger = await app.request("http://localhost/api/events", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        type: "agent.scheduled.trigger",
        source: "system:scheduler",
        channelId: "channel-1",
        deliverAt: Date.now() + 1000,
        payload: { text: "targeted", targetAgentName: "agent-a" },
      }),
    });
    const triggerBody = (await trigger.json()) as { id: string };
    const triggerReceipts = orm
      .select()
      .from(schema.eventReceipts)
      .where(eq(schema.eventReceipts.event_id, triggerBody.id))
      .all();
    expect(triggerReceipts.map((row) => row.agent_name)).toEqual(["agent-a"]);
  });
});

describe("recurring schedules", () => {
  it("creates, materializes idempotently, survives duplicate ticks, and pauses invalid membership", async () => {
    const { app, orm, cookie, recurringScheduler } = await setup();
    const create = await app.request("http://localhost/api/schedules", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "heartbeat",
        channelId: "channel-1",
        targetAgentName: "agent-a",
        cronExpression: "* * * * * *",
        timezone: "UTC",
        text: "check in",
      }),
    });
    expect(create.status).toBe(201);
    const schedule = (await create.json()) as { id: string };
    const scheduledFor = Date.now() - 1000;
    orm.update(schema.recurringSchedules)
      .set({ next_fire_at: scheduledFor })
      .where(eq(schema.recurringSchedules.id, schedule.id))
      .run();
    await recurringScheduler.tick();
    const firstEvents = orm
      .select()
      .from(schema.events)
      .where(eq(schema.events.idempotency_key, `schedule:${schedule.id}:${scheduledFor}`))
      .all();
    expect(firstEvents).toHaveLength(1);

    orm.update(schema.recurringSchedules)
      .set({ next_fire_at: scheduledFor })
      .where(eq(schema.recurringSchedules.id, schedule.id))
      .run();
    await recurringScheduler.tick();
    expect(
      orm
        .select()
        .from(schema.events)
        .where(eq(schema.events.idempotency_key, `schedule:${schedule.id}:${scheduledFor}`))
        .all(),
    ).toHaveLength(1);

    orm.delete(schema.channelSubscriptions)
      .where(
        and(
          eq(schema.channelSubscriptions.channel_id, "channel-1"),
          eq(schema.channelSubscriptions.subscriber_id, "agent-a"),
        ),
      )
      .run();
    orm.update(schema.recurringSchedules)
      .set({ status: "ACTIVE", next_fire_at: Date.now() - 1 })
      .where(eq(schema.recurringSchedules.id, schedule.id))
      .run();
    await recurringScheduler.tick();
    const paused = orm
      .select()
      .from(schema.recurringSchedules)
      .where(eq(schema.recurringSchedules.id, schedule.id))
      .get();
    expect(paused?.status).toBe("PAUSED");
    expect(paused?.last_error).toContain("no longer");
  });

  it("applies SKIP grace and bounded CATCH_UP misfire policies", async () => {
    process.env.ORGOPS_SCHEDULE_CATCH_UP_LIMIT = "2";
    const { orm } = await setup();
    const timestamp = Date.now();
    for (const [id, policy] of [
      ["skip", "SKIP"],
      ["catch", "CATCH_UP"],
    ] as const) {
      orm.insert(schema.recurringSchedules)
        .values({
          id,
          channel_id: "channel-1",
          target_agent_name: "agent-a",
          cron_expression: "* * * * * *",
          timezone: "UTC",
          text: id,
          status: "ACTIVE",
          misfire_policy: policy,
          next_fire_at: timestamp - 120_000,
          created_by_type: "HUMAN",
          version: 1,
          created_at: timestamp,
          updated_at: timestamp,
        })
        .run();
    }
    const emitted: any[] = [];
    const scheduler = createRecurringScheduler({
      orm,
      insertEvent: (input) => {
        emitted.push(input);
        return input;
      },
      now: () => timestamp,
    });
    await scheduler.tick();
    expect(emitted.filter((event) => event.payload.scheduleId === "skip")).toHaveLength(0);
    expect(emitted.filter((event) => event.payload.scheduleId === "catch")).toHaveLength(2);
  });

  it("pauses schedules while their channel is archived", async () => {
    const { orm, recurringScheduler } = await setup();
    const timestamp = Date.now();
    orm.insert(schema.recurringSchedules)
      .values({
        id: "archived-channel-schedule",
        channel_id: "channel-1",
        target_agent_name: "agent-a",
        cron_expression: "* * * * * *",
        timezone: "UTC",
        text: "must not run in an archived channel",
        status: "ACTIVE",
        misfire_policy: "FIRE_ONCE",
        next_fire_at: timestamp - 1,
        created_by_type: "HUMAN",
        version: 1,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .run();
    orm.update(schema.channels)
      .set({ archived_at: timestamp })
      .where(eq(schema.channels.id, "channel-1"))
      .run();

    await recurringScheduler.tick();

    const schedule = orm
      .select()
      .from(schema.recurringSchedules)
      .where(eq(schema.recurringSchedules.id, "archived-channel-schedule"))
      .get();
    expect(schedule?.status).toBe("PAUSED");
    expect(
      orm
        .select()
        .from(schema.events)
        .where(eq(schema.events.idempotency_key, `schedule:${schedule?.id}:${timestamp - 1}`))
        .all(),
    ).toHaveLength(0);
  });

  it("requires authentication and validates cron timezone", async () => {
    const { app, cookie } = await setup();
    const unauthorized = await app.request("http://localhost/api/schedules");
    expect(unauthorized.status).toBe(401);
    const invalid = await app.request("http://localhost/api/schedules", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        channelId: "channel-1",
        targetAgentName: "agent-a",
        cronExpression: "not cron",
        timezone: "Mars/Olympus",
        text: "never",
      }),
    });
    expect(invalid.status).toBe(400);
  });

  it("requires access to both the existing and proposed schedule target", async () => {
    const { app, orm, cookie } = await setup();
    const create = await app.request("http://localhost/api/schedules", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        channelId: "channel-1",
        targetAgentName: "agent-b",
        cronExpression: "0 * * * * *",
        timezone: "UTC",
        text: "protected schedule",
      }),
    });
    const schedule = (await create.json()) as { id: string };
    const generated = generateRunnerScopedToken();
    orm.insert(schema.runnerTokens)
      .values({
        id: "schedule-scoped-token",
        name: "agent-a schedule token",
        token_hash: generated.hash,
        token_prefix: generated.prefix,
        allowed_agent_name: "agent-a",
        allowed_runner_id: "runner-a",
        allowed_channel_ids_json: JSON.stringify(["channel-1"]),
        runner_scope_mode: "SCOPED",
        created_at: Date.now(),
      })
      .run();
    const hijack = await app.request(`http://localhost/api/schedules/${schedule.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-orgops-runner-token": generated.token,
        "x-orgops-agent-name": "agent-a",
      },
      body: JSON.stringify({ targetAgentName: "agent-a" }),
    });
    expect(hijack.status).toBe(403);
  });
});
