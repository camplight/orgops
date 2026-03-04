import { Hono } from "hono";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";

import {
  createDrizzleDb,
  openDb,
  migrate,
  schema,
  type OrgOpsDb,
} from "@orgops/db";
import { EventBus } from "@orgops/event-bus";
import { AuthLoginSchema, EventSchema } from "@orgops/schemas";
import { listSkills, resolveSkillRoots } from "@orgops/skills";
import { registerAuthRoutes } from "./routes/auth";
import { registerModelsRoutes } from "./routes/models";
import { registerAgentsRoutes } from "./routes/agents";
import { registerCollabRoutes } from "./routes/collab";
import { registerEventsRoutes } from "./routes/events";
import { registerRuntimeRoutes } from "./routes/runtime";
import { registerSkillsRoutes } from "./routes/skills";
import { registerSecretsRoutes } from "./routes/secrets";
import { registerWebhookRoutes } from "./routes/webhooks";
import { registerWsRoutes, type WsServerMessage } from "./routes/ws";

export type AppConfig = {
  db?: OrgOpsDb;
  dbPath?: string;
  dataDir?: string;
  adminUser?: string;
  adminPass?: string;
  runnerToken?: string;
};

type AppEnv = {
  Variables: {
    user: { username: string };
  };
};

export function createApp(config: AppConfig = {}) {
  const app = new Hono<AppEnv>();
  const PROJECT_ROOT = (() => {
    const envRoot = process.env.ORGOPS_PROJECT_ROOT;
    if (envRoot) return envRoot;
    const cwd = process.cwd();
    const candidate = resolve(cwd, "../..");
    return existsSync(join(candidate, "package.json")) ? candidate : cwd;
  })();
  const DATA_DIR = (() => {
    if (!config.dataDir) return join(PROJECT_ROOT, ".orgops-data");
    return config.dataDir.startsWith("/")
      ? config.dataDir
      : resolve(PROJECT_ROOT, config.dataDir);
  })();
  const dbPath = (() => {
    if (!config.dbPath) return join(DATA_DIR, "orgops.sqlite");
    if (config.dbPath === ":memory:" || config.dbPath.startsWith("/"))
      return config.dbPath;
    return resolve(PROJECT_ROOT, config.dbPath);
  })();
  const db = config.db ?? openDb(dbPath);
  migrate(db);
  const orm = createDrizzleDb(db);

  const bus = new EventBus<WsServerMessage>();
  const sessions = new Map<string, { username: string }>();

  const ADMIN_USER =
    config.adminUser ?? process.env.ORGOPS_ADMIN_USER ?? "admin";
  const ADMIN_PASS =
    config.adminPass ?? process.env.ORGOPS_ADMIN_PASS ?? "admin";
  const RUNNER_TOKEN =
    config.runnerToken ?? process.env.ORGOPS_RUNNER_TOKEN ?? "dev-runner-token";

  const FILES_DIR = join(PROJECT_ROOT, "files");
  const EVENT_TYPES_DIR = join(PROJECT_ROOT, "event-types");
  const SKILL_ROOTS = resolveSkillRoots({
    projectRoot: PROJECT_ROOT,
    env: process.env,
  });
  let lastEventCreatedAt = 0;

  mkdirSync(FILES_DIR, { recursive: true });
  mkdirSync(EVENT_TYPES_DIR, { recursive: true });

  function jsonResponse(c: any, data: unknown, status = 200) {
    return c.json(data, status);
  }

  function requireAuth(c: any, next: any) {
    const runnerHeader = c.req.header("x-orgops-runner-token");
    if (RUNNER_TOKEN && runnerHeader === RUNNER_TOKEN) {
      c.set("user", { username: "runner" });
      return next();
    }
    const cookie = c.req.header("cookie") ?? "";
    const match = cookie.match(/orgops_session=([^;]+)/);
    if (!match) return jsonResponse(c, { error: "Unauthorized" }, 401);
    const session = sessions.get(match[1]);
    if (!session) return jsonResponse(c, { error: "Unauthorized" }, 401);
    c.set("user", session);
    return next();
  }

  function requireRunnerAuth(c: any, next: any) {
    const runnerHeader = c.req.header("x-orgops-runner-token");
    if (runnerHeader !== RUNNER_TOKEN) {
      return jsonResponse(c, { error: "Runner token required" }, 401);
    }
    c.set("user", { username: "runner" });
    return next();
  }

  function parseJson<T>(input: string, fallback: T): T {
    try {
      return JSON.parse(input) as T;
    } catch {
      return fallback;
    }
  }

  function parseJsonSafe(input: string): Record<string, any> | null {
    try {
      return JSON.parse(input) as Record<string, any>;
    } catch {
      return null;
    }
  }

  function parseStringArraySafe(input: string | null | undefined): string[] {
    if (!input) return [];
    try {
      const parsed = JSON.parse(input) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item): item is string => typeof item === "string");
    } catch {
      return [];
    }
  }

  function toSoulFilename(agentName: string) {
    return `${agentName.replace(/[^a-zA-Z0-9._-]/g, "_")}.md`;
  }

  function getDefaultSoulPath(agentName: string) {
    return join(DATA_DIR, "souls", toSoulFilename(agentName));
  }

  function resolveWorkspacePath(workspacePath: string) {
    if (!workspacePath) return workspacePath;
    return workspacePath.startsWith("/")
      ? workspacePath
      : resolve(PROJECT_ROOT, workspacePath);
  }

  function loadSoulContents(path: string | null | undefined) {
    if (!path) return "";
    try {
      return readFileSync(path, "utf-8");
    } catch {
      return "";
    }
  }

  function writeSoulContents(path: string, contents: string) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents ?? "", "utf-8");
  }

  function eventRowToApi(row: any) {
    return {
      id: row.id,
      type: row.type,
      payload: parseJson(row.payload_json, {}),
      source: row.source,
      channelId: row.channel_id ?? undefined,
      teamId: row.team_id ?? undefined,
      parentEventId: row.parent_event_id ?? undefined,
      deliverAt: row.deliver_at ?? undefined,
      status: row.status,
      failCount: row.fail_count ?? 0,
      lastError: row.last_error ?? undefined,
      idempotencyKey: row.idempotency_key ?? undefined,
      createdAt: row.created_at,
    };
  }

  function publishEvent(row: any) {
    const event = eventRowToApi(row);
    const topics = new Set<string>(["org:events"]);
    if (event.channelId) {
      topics.add(`channel:${event.channelId}`);
    }
    if (event.teamId) {
      topics.add(`team:${event.teamId}`);
    }
    if (typeof event.source === "string" && event.source.startsWith("agent:")) {
      topics.add(event.source);
    }
    for (const topic of topics) {
      bus.publish(topic, {
        type: "event",
        topic,
        data: event,
      });
    }
  }

  function publishProcessOutput(processId: string, payload: any) {
    bus.publish(`process:${processId}`, {
      type: "process_output",
      topic: `process:${processId}`,
      data: payload,
    });
  }

  function insertEvent(input: any) {
    const resolveRecipientAgents = (): string[] => {
      const recipients = new Set<string>();

      const collectTeamAgents = (teamIds: string[]) => {
        if (teamIds.length === 0) return;
        const members = orm
          .select({ memberId: schema.teamMemberships.member_id })
          .from(schema.teamMemberships)
          .where(
            and(
              inArray(schema.teamMemberships.team_id, teamIds),
              eq(schema.teamMemberships.member_type, "AGENT"),
            ),
          )
          .all();
        for (const member of members) recipients.add(member.memberId);
      };

      const channelId =
        typeof input.channelId === "string" ? input.channelId : "";
      if (channelId) {
        const channelAgentSubscribers = orm
          .select({ subscriberId: schema.channelSubscriptions.subscriber_id })
          .from(schema.channelSubscriptions)
          .where(
            and(
              eq(schema.channelSubscriptions.channel_id, channelId),
              eq(schema.channelSubscriptions.subscriber_type, "AGENT"),
            ),
          )
          .all();
        for (const subscriber of channelAgentSubscribers)
          recipients.add(subscriber.subscriberId);

        const channelTeamSubscribers = orm
          .select({ subscriberId: schema.channelSubscriptions.subscriber_id })
          .from(schema.channelSubscriptions)
          .where(
            and(
              eq(schema.channelSubscriptions.channel_id, channelId),
              eq(schema.channelSubscriptions.subscriber_type, "TEAM"),
            ),
          )
          .all();
        collectTeamAgents(
          channelTeamSubscribers.map((row) => row.subscriberId),
        );
      }

      const teamId = typeof input.teamId === "string" ? input.teamId : "";
      if (teamId) {
        collectTeamAgents([teamId]);
      }
      return [...recipients];
    };

    const now = Date.now();
    const createdAt = Math.max(now, lastEventCreatedAt + 1);
    lastEventCreatedAt = createdAt;
    const id = input.id ?? randomUUID();
    const status = input.status ?? "PENDING";
    const payloadJson = JSON.stringify(input.payload ?? {});
    const row = {
      id,
      type: input.type,
      payload_json: payloadJson,
      source: input.source,
      channel_id: input.channelId ?? null,
      team_id: input.teamId ?? null,
      parent_event_id: input.parentEventId ?? null,
      deliver_at: input.deliverAt ?? null,
      status,
      fail_count: 0,
      last_error: null,
      idempotency_key: input.idempotencyKey ?? null,
      created_at: createdAt,
    };
    const recipientAgents = resolveRecipientAgents();
    if (recipientAgents.length > 0 && input.status === undefined) {
      row.status = "PENDING";
    }
    orm
      .insert(schema.events)
      .values({
        id: row.id,
        type: row.type,
        payload_json: row.payload_json,
        source: row.source,
        channel_id: row.channel_id,
        team_id: row.team_id,
        parent_event_id: row.parent_event_id,
        deliver_at: row.deliver_at,
        status: row.status,
        fail_count: row.fail_count,
        last_error: row.last_error,
        idempotency_key: row.idempotency_key,
        created_at: row.created_at,
      })
      .run();
    if (recipientAgents.length > 0) {
      orm
        .insert(schema.eventReceipts)
        .values(
          recipientAgents.map((agentName) => ({
            event_id: row.id,
            agent_name: agentName,
            status: row.status === "DELIVERED" ? "DELIVERED" : "PENDING",
            delivered_at: row.status === "DELIVERED" ? row.created_at : null,
          })),
        )
        .onConflictDoNothing()
        .run();
    }
    publishEvent(row);
    return row;
  }

  registerAuthRoutes(app as any, {
    ADMIN_USER,
    ADMIN_PASS,
    RUNNER_TOKEN,
    sessions,
    AuthLoginSchema,
    jsonResponse,
    requireAuth,
  });

  registerModelsRoutes(app as any, { orm, jsonResponse, parseJson });

  registerAgentsRoutes(app as any, {
    orm,
    bus,
    PROJECT_ROOT,
    jsonResponse,
    parseStringArraySafe,
    getDefaultSoulPath,
    resolveWorkspacePath,
    loadSoulContents,
    writeSoulContents,
    insertEvent,
  });

  registerCollabRoutes(app as any, { orm, jsonResponse });

  registerEventsRoutes(app as any, {
    orm,
    jsonResponse,
    eventRowToApi,
    insertEvent,
    EventSchema,
    readdirSync,
    readFileSync,
    EVENT_TYPES_DIR,
  });

  registerRuntimeRoutes(app as any, {
    orm,
    FILES_DIR,
    jsonResponse,
    publishProcessOutput,
    insertEvent,
  });

  registerSkillsRoutes(app as any, { SKILL_ROOTS, jsonResponse, listSkills });

  registerSecretsRoutes(app as any, {
    orm,
    jsonResponse,
    requireAuth,
    requireRunnerAuth,
    insertEvent,
  });

  registerWebhookRoutes(app as any, {
    orm,
    jsonResponse,
    parseJsonSafe,
    insertEvent,
  });

  registerWsRoutes(app as any, { bus });

  return { app, db, bus };
}
