import { Hono } from "hono";
import { createNodeWebSocket } from "@hono/node-ws";
import {
  existsSync,
  mkdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";

import {
  createDrizzleDb,
  openDb,
  migrate,
  schema,
  type OrgOpsDb,
} from "@orgops/db";
import { EventBus } from "@orgops/event-bus";
import {
  AuthLoginSchema,
  EventSchema,
  type EventShapeDefinition,
  getCoreEventShapes,
  serializeEventShapes,
  validateEventAgainstShapes,
} from "@orgops/schemas";
import {
  listSkills,
  loadSkillEventShapes,
  resolveSkillRoot,
} from "@orgops/skills";
import { registerAuthRoutes } from "./routes/auth";
import { registerModelsRoutes } from "./routes/models";
import { registerAgentsRoutes } from "./routes/agents";
import { registerCollabRoutes } from "./routes/collab";
import { registerEventsRoutes } from "./routes/events";
import { registerRuntimeRoutes } from "./routes/runtime";
import { registerSkillsRoutes } from "./routes/skills";
import { registerSecretsRoutes } from "./routes/secrets";
import { registerWsRoutes, type WsServerMessage } from "./routes/ws";
import { registerHumansRoutes } from "./routes/humans";

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
    user: { id?: string; username: string; mustChangePassword: boolean };
  };
};

export function createApp(config: AppConfig = {}) {
  const app = new Hono<AppEnv>();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
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
  const sessions = new Map<
    string,
    { id?: string; username: string; mustChangePassword: boolean }
  >();

  const ADMIN_USER =
    config.adminUser ?? process.env.ORGOPS_ADMIN_USER ?? "admin";
  const ADMIN_PASS =
    config.adminPass ?? process.env.ORGOPS_ADMIN_PASS ?? "admin";
  const RUNNER_TOKEN =
    config.runnerToken ?? process.env.ORGOPS_RUNNER_TOKEN ?? "dev-runner-token";

  const FILES_DIR = join(PROJECT_ROOT, "files");
  const SKILL_ROOT = resolveSkillRoot(PROJECT_ROOT);
  let lastEventCreatedAt = 0;

  mkdirSync(FILES_DIR, { recursive: true });

  function hashPassword(password: string) {
    const salt = randomBytes(16).toString("hex");
    const derived = scryptSync(password, salt, 64).toString("hex");
    return `scrypt$${salt}$${derived}`;
  }

  function verifyPassword(password: string, hashed: string) {
    const [algo, salt, storedHash] = hashed.split("$");
    if (algo !== "scrypt" || !salt || !storedHash) return false;
    const computedHash = scryptSync(password, salt, 64).toString("hex");
    const storedBytes = Buffer.from(storedHash, "hex");
    const computedBytes = Buffer.from(computedHash, "hex");
    if (storedBytes.length !== computedBytes.length) return false;
    return timingSafeEqual(storedBytes, computedBytes);
  }

  const existingAdmin = orm
    .select({ id: schema.humans.id })
    .from(schema.humans)
    .where(eq(schema.humans.username, ADMIN_USER))
    .get();
  if (!existingAdmin) {
    const now = Date.now();
    orm
      .insert(schema.humans)
      .values({
        id: randomUUID(),
        username: ADMIN_USER,
        password_hash: hashPassword(ADMIN_PASS),
        must_change_password: 0,
        created_at: now,
        updated_at: now,
        invited_by_human_id: null,
      })
      .run();
  }

  function jsonResponse(c: any, data: unknown, status = 200) {
    return c.json(data, status);
  }

  function requireAuth(c: any, next: any) {
    const runnerHeader = c.req.header("x-orgops-runner-token");
    if (RUNNER_TOKEN && runnerHeader === RUNNER_TOKEN) {
      c.set("user", { username: "runner", mustChangePassword: false });
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
    c.set("user", { username: "runner", mustChangePassword: false });
    return next();
  }

  function parseJson<T>(input: string, fallback: T): T {
    try {
      return JSON.parse(input) as T;
    } catch {
      return fallback;
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

  function eventRowToApi(row: any) {
    return {
      id: row.id,
      type: row.type,
      payload: parseJson(row.payload_json, {}),
      source: row.source,
      channelId: row.channel_id ?? undefined,
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
    orm,
    humanSchema: schema.humans,
    RUNNER_TOKEN,
    sessions,
    AuthLoginSchema,
    jsonResponse,
    requireAuth,
    hashPassword,
    verifyPassword,
  });

  registerHumansRoutes(app as any, {
    orm,
    jsonResponse,
    humanSchema: schema.humans,
    hashPassword,
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
    insertEvent,
  });

  registerCollabRoutes(app as any, { orm, jsonResponse });

  registerEventsRoutes(app as any, {
    orm,
    jsonResponse,
    eventRowToApi,
    insertEvent,
    EventSchema,
    SKILL_ROOT,
    listSkills,
    loadSkillEventShapes: async (skills) => {
      const loaded = await loadSkillEventShapes(skills);
      return {
        ...loaded,
        shapes: loaded.shapes as EventShapeDefinition[],
      };
    },
    getCoreEventShapes,
    validateEventAgainstShapes,
    serializeEventShapes,
  });

  registerRuntimeRoutes(app as any, {
    orm,
    FILES_DIR,
    jsonResponse,
    publishProcessOutput,
    insertEvent,
  });

  registerSkillsRoutes(app as any, { SKILL_ROOT, jsonResponse, listSkills });

  registerSecretsRoutes(app as any, {
    orm,
    jsonResponse,
    requireAuth,
    requireRunnerAuth,
    insertEvent,
  });

  registerWsRoutes(app as any, { bus, upgradeWebSocket });

  return { app, db, bus, injectWebSocket };
}
