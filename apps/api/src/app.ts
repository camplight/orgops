import {
  registerGoogleAuthRoutes,
  type HumanSession,
} from "./routes/google-auth";
import { Hono } from "hono";
import { createNodeWebSocket } from "@hono/node-ws";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  randomBytes,
  randomUUID,
  scryptSync,
} from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { encryptSecret, parseMasterKey } from "@orgops/crypto";
import {
  createDrizzleDb,
  openDb,
  migrate,
  schema,
  type OrgOpsDb,
  type OrgOpsDrizzleDb,
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
  resolveSkillRoots,
} from "@orgops/skills";
import { registerAuthRoutes } from "./routes/auth";
import { registerModelsRoutes } from "./routes/models";
import { createAgentTransfer, type AgentTransferBundle } from "./agent-transfer";
import { registerAgentsRoutes } from "./routes/agents";
import { registerCollabRoutes } from "./routes/collab";
import { registerEventsRoutes } from "./routes/events";
import { registerMemoryRoutes } from "./routes/memory";
import { registerRuntimeRoutes } from "./routes/runtime";
import { registerSkillsRoutes } from "./routes/skills";
import { registerSecretsRoutes } from "./routes/secrets";
import { registerWsRoutes, type WsServerMessage } from "./routes/ws";
import { registerHumansRoutes } from "./routes/humans";
import { registerRunnersRoutes } from "./routes/runners";
import { registerIntegrationKeysRoutes } from "./routes/integration-keys";
import { registerEmbedRoutes } from "./routes/embed";
import { registerBillingRoutes } from "./routes/billing";
import { registerFederationRoutes } from "./routes/federation";
import { registerWorkspacePublicationRoutes } from "./routes/workspace-publications";
import {
  findActiveRunnerTokenByToken,
  parseStringArraySafe as parseRunnerScopeChannels,
  touchRunnerTokenLastUsed,
} from "./agent-invite-auth";
import { registerAgentInviteRoutes } from "./routes/agent-invites";
import { createAccessControl } from "./routes/access";
import {hashPasswordAsync,verifyPasswordAsync} from './passwords';

export type AppConfig = {
  db?: OrgOpsDb;
  dbPath?: string;
  dataDir?: string;
  adminUser?: string;
  adminPass?: string;
  /** `provider` or `provider:model`. Seeds the default `system` agent on an empty agents table. */
  systemAgentModel?: string;
  runnerToken?: string;
  runnerApiUrl?: string;
  projectRoot?: string;
};

type AppEnv = {
  Variables: {
    user: { id?: string; username: string; mustChangePassword: boolean };
  };
};

export function createApp(config: AppConfig = {}) {
  const app = new Hono<AppEnv>();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
  const PROJECT_ROOT = resolve(
    config.projectRoot ??
      process.env.ORGOPS_PROJECT_ROOT ??
      resolve(dirname(fileURLToPath(import.meta.url)), "../../.."),
  );
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
  const sessions = new Map<string, HumanSession>();

  const ADMIN_USER =
    config.adminUser ?? process.env.ORGOPS_ADMIN_USER ?? "admin";
  const ADMIN_PASS =
    config.adminPass ?? process.env.ORGOPS_ADMIN_PASS ?? "admin";
  const RUNNER_TOKEN =
    config.runnerToken ?? process.env.ORGOPS_RUNNER_TOKEN ?? "dev-runner-token";
  const RUNNER_API_URL =
    config.runnerApiUrl ??
    process.env.ORGOPS_RUNNER_API_URL ??
    process.env.ORGOPS_PUBLIC_API_URL ??
    `http://localhost:${process.env.PORT ?? "8787"}`;

  const FILES_DIR = join(PROJECT_ROOT, "files");
  const SKILL_ROOTS = resolveSkillRoots(PROJECT_ROOT);
  let lastEventCreatedAt = 0;

  mkdirSync(FILES_DIR, { recursive: true });

  function hashPassword(password: string) {
    const salt = randomBytes(16).toString("hex");
    const derived = scryptSync(password, salt, 64).toString("hex");
    return `scrypt$${salt}$${derived}`;
  }


  const existingHuman = orm
    .select({ id: schema.humans.id })
    .from(schema.humans)
    .limit(1)
    .get();
  if (!existingHuman) {
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

  seedDefaultSystemAgent(orm, DATA_DIR, config.systemAgentModel);

  function jsonResponse(c: any, data: unknown, status = 200) {
    return c.json(data, status);
  }

  function mapSqliteConstraintError(error: unknown) {
    if (!error || typeof error !== "object") return null;
    const code = (error as { code?: unknown }).code;
    const message = (error as { message?: unknown }).message;
    if (typeof code !== "string" && typeof message !== "string") return null;
    const text = `${code ?? ""} ${message ?? ""}`;
    if (!text.includes("SQLITE_CONSTRAINT")) return null;

    if (text.includes("UNIQUE")) {
      if (text.includes("channels.name")) {
        return { status: 409, body: { error: "Channel name already exists" } };
      }
      return { status: 409, body: { error: "Resource already exists" } };
    }
    if (text.includes("FOREIGNKEY")) {
      return { status: 400, body: { error: "Invalid reference in request" } };
    }
    if (text.includes("NOTNULL") || text.includes("CHECK")) {
      return { status: 400, body: { error: "Invalid request payload" } };
    }

    return { status: 400, body: { error: "Invalid request" } };
  }

  app.onError((error, c) => {
    const mapped = mapSqliteConstraintError(error);
    if (mapped) return jsonResponse(c, mapped.body, mapped.status);
    console.error(error);
    return jsonResponse(c, { error: "Internal Server Error" }, 500);
  });

  app.get("/health", (c) =>
    jsonResponse(c, {
      status: "ok",
      service: "orgops-api",
      now: Date.now(),
    }),
  );

  function resolveRunnerUserFromToken(token: string | undefined) {
    if (!token) return null;
    if (RUNNER_TOKEN && token === RUNNER_TOKEN) {
      return {
        username: "runner",
        mustChangePassword: false,
        runnerScope: { mode: "GLOBAL" as const },
      };
    }
    const scoped = findActiveRunnerTokenByToken(orm, token);
    if (!scoped) return null;
    touchRunnerTokenLastUsed(orm, scoped.id);
    const mode: "GLOBAL" | "SCOPED" =
      scoped.runner_scope_mode === "GLOBAL" ? "GLOBAL" : "SCOPED";
    return {
      username: "runner",
      mustChangePassword: false,
      runnerScope: {
        mode,
        tokenId: scoped.id,
        allowedAgentName:
          mode === "SCOPED"
            ? (scoped.allowed_agent_name ?? undefined)
            : undefined,
        allowedRunnerId:
          mode === "SCOPED"
            ? (scoped.allowed_runner_id ?? undefined)
            : undefined,
        allowedChannelIds:
          mode === "SCOPED"
            ? parseRunnerScopeChannels(scoped.allowed_channel_ids_json)
            : undefined,
        allowChannelExpansion:
          mode === "SCOPED"
            ? Boolean(scoped.allow_channel_expansion)
            : undefined,
        inviteId: scoped.invite_id ?? undefined,
      },
    };
  }

  function requireAuth(c: any, next: any) {
    const runnerHeader = c.req.header("x-orgops-runner-token");
    const runnerUser = resolveRunnerUserFromToken(runnerHeader);
    if (runnerUser) {
      c.set("user", runnerUser);
      return next();
    }
    const cookie = c.req.header("cookie") ?? "";
    const match = cookie.match(/orgops_session=([^;]+)/);
    if (!match) return jsonResponse(c, { error: "Unauthorized" }, 401);
    const session = sessions.get(match[1]);
    if (!session || (session.expiresAt && session.expiresAt <= Date.now())) {
      sessions.delete(match[1]);
      return jsonResponse(c, { error: "Unauthorized" }, 401);
    }
    c.set("user", session);
    return next();
  }

  function requireRunnerAuth(c: any, next: any) {
    const runnerHeader = c.req.header("x-orgops-runner-token");
    const runnerUser = resolveRunnerUserFromToken(runnerHeader);
    if (!runnerUser) {
      return jsonResponse(c, { error: "Runner token required" }, 401);
    }
    c.set("user", runnerUser);
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

  async function pushFederatedEvent(row: any) {
    const channelId = typeof row.channel_id === "string" ? row.channel_id : "";
    if (!channelId) return;
    let subscribers: any[];
    try {
      subscribers = orm
        .select()
        .from(schema.federationChannelSubscribers)
        .where(eq(schema.federationChannelSubscribers.local_channel_id, channelId))
        .all() as any[];
    } catch (error) {
      if (String(error).includes("no such table: federation_channel_subscribers")) return;
      throw error;
    }
    if (subscribers.length === 0) return;
    const event = eventRowToApi(row);
    for (const subscriber of subscribers) {
      const instance = orm
        .select()
        .from(schema.federationInstances)
        .where(eq(schema.federationInstances.id, subscriber.instance_id))
        .get() as any;
      const now = Date.now();
      if (!instance?.outbound_token || !instance?.base_url) {
        orm
          .update(schema.federationChannelSubscribers)
          .set({
            last_push_at: now,
            last_error: "Missing outbound federation token or base URL",
            updated_at: now,
          })
          .where(eq(schema.federationChannelSubscribers.id, subscriber.id))
          .run();
        continue;
      }
      try {
        const baseUrl = String(instance.base_url).replace(/\/+$/, "");
        const response = await fetch(
          `${baseUrl}/api/federation/projections/${encodeURIComponent(
            subscriber.remote_channel_id,
          )}/events`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${String(instance.outbound_token).trim()}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(event),
          },
        );
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`${response.status} ${text}`);
        }
        orm
          .update(schema.federationChannelSubscribers)
          .set({
            last_push_at: now,
            last_ack_at: Date.now(),
            last_error: null,
            updated_at: Date.now(),
          })
          .where(eq(schema.federationChannelSubscribers.id, subscriber.id))
          .run();
      } catch (error) {
        orm
          .update(schema.federationChannelSubscribers)
          .set({
            last_push_at: now,
            last_error: error instanceof Error ? error.message : String(error),
            updated_at: Date.now(),
          })
          .where(eq(schema.federationChannelSubscribers.id, subscriber.id))
          .run();
      }
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
    const payloadJson = JSON.stringify(input.payload ?? {});
    const row = {
      id,
      type: input.type,
      payload_json: payloadJson,
      source: input.source,
      channel_id: input.channelId ?? null,
      parent_event_id: input.parentEventId ?? null,
      deliver_at: input.deliverAt ?? null,
      status: input.status ?? "PENDING",
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
    void pushFederatedEvent(row);
    return row;
  }

  const access = createAccessControl({ orm });

  registerGoogleAuthRoutes(app as any, {
    db,
    sessions,
    hashPassword,
    requireAuth,
  });

  registerAuthRoutes(app as any, {
    isGoogleHuman: (id) =>
      Boolean(
        db.prepare("SELECT 1 FROM human_identities WHERE human_id=?").get(id),
      ),
    orm,
    humanSchema: schema.humans,
    RUNNER_TOKEN,
    sessions,
    AuthLoginSchema,
    jsonResponse,
    requireAuth,
    hashPassword:hashPasswordAsync,
    verifyPassword:verifyPasswordAsync,
  });

  registerHumansRoutes(app as any, {
    revokeSessions: (humanId) => {
      for (const [id, session] of sessions) if (session.id === humanId) sessions.delete(id);
    },
    orm,
    jsonResponse,
    humanSchema: schema.humans,
    hashPassword,
    access,
  });

  registerAgentInviteRoutes(app as any, {
    orm,
    jsonResponse,
    access,
    inviteBaseUrlFallback: RUNNER_API_URL,
  });

  registerModelsRoutes(app as any, { orm, jsonResponse, parseJson });

  const agentTransfer = createAgentTransfer({
    orm,
    skillRoots: SKILL_ROOTS,
    resolveWorkspacePath,
    parseStringArraySafe,
  });

  async function transferToPeer(instanceId: string, bundle: AgentTransferBundle) {
    const instance = orm
      .select()
      .from(schema.federationInstances)
      .where(eq(schema.federationInstances.id, instanceId))
      .get() as { base_url?: string | null; outbound_token?: string | null; name?: string } | undefined;
    if (!instance) throw new Error("Federation peer not found");
    const token = String(instance.outbound_token ?? "").trim();
    const baseUrl = String(instance.base_url ?? "").replace(/\/+$/, "");
    if (!token || !baseUrl) {
      throw new Error(`Federation peer "${instance.name ?? instanceId}" is missing a base URL or outbound token.`);
    }
    const response = await fetch(`${baseUrl}/api/federation/agents/transfer`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(bundle),
    });
    const text = await response.text();
    let parsed: any = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { error: text };
    }
    if (!response.ok) {
      throw new Error(parsed?.error || `Federation request failed: ${response.status}`);
    }
    return parsed;
  }

  registerWorkspacePublicationRoutes(app as any, {
    orm,
    DATA_DIR,
    jsonResponse,
    requireAuth,
    requireRunnerAuth,
    resolveWorkspacePath,
    access,
    hashPassword,
    verifyPassword:verifyPasswordAsync,
    insertEvent,
  });

  registerAgentsRoutes(app as any, {
    orm,
    bus,
    PROJECT_ROOT,
    jsonResponse,
    parseStringArraySafe,
    resolveWorkspacePath,
    insertEvent,
    access,
    agentTransfer,
    transferToPeer,
  });

  registerCollabRoutes(app as any, { orm, jsonResponse, access });

  registerEventsRoutes(app as any, {
    orm,
    jsonResponse,
    eventRowToApi,
    insertEvent,
    publishEventRow: publishEvent,
    EventSchema,
    SKILL_ROOTS,
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
    access,
    verifyPassword:verifyPasswordAsync,
  });

  registerMemoryRoutes(app as any, { orm, jsonResponse, access });

  registerRuntimeRoutes(app as any, {
    orm,
    FILES_DIR,
    jsonResponse,
    publishProcessOutput,
    insertEvent,
    access,
  });

  registerSkillsRoutes(app as any, { SKILL_ROOTS, jsonResponse, listSkills });

  registerSecretsRoutes(app as any, {
    orm,
    jsonResponse,
    requireAuth,
    requireRunnerAuth,
    insertEvent,
    access,
  });

  registerWsRoutes(app as any, {
    canViewProcess: (user,id) => {
      const row=orm.select().from(schema.processes).where(eq(schema.processes.id,id)).get();
      return Boolean(row&&access.canViewAgent(user,row.agent_name)&&(!row.channel_id||access.canViewChannel(user,row.channel_id)));
    },
    bus,
    upgradeWebSocket,
    resolveRequestUser: (c: any) => {
      const runnerHeader = c.req.header("x-orgops-runner-token");
      const runnerUser = resolveRunnerUserFromToken(runnerHeader);
      if (runnerUser) return runnerUser;
      const cookie = c.req.header("cookie") ?? "";
      const match = cookie.match(/orgops_session=([^;]+)/);
      if (!match) return null;
      const session = sessions.get(match[1]);
      if (!session || (session.expiresAt && session.expiresAt <= Date.now())) {
        sessions.delete(match[1]);
        return null;
      }
      return session;
    },
    access,
  });

  registerRunnersRoutes(app as any, {
    access,
    orm,
    bus,
    jsonResponse,
    requireAuth,
    requireRunnerAuth,
    runnerToken: RUNNER_TOKEN,
    runnerApiUrl: RUNNER_API_URL,
  });

  registerFederationRoutes(app as any, {
    orm,
    jsonResponse,
    requireAuth,
    insertEvent,
    eventRowToApi,
    agentTransfer,
  });

  registerIntegrationKeysRoutes(app as any, { orm, jsonResponse, access });
  registerEmbedRoutes(app as any, { orm, jsonResponse, insertEvent });
  registerBillingRoutes(app as any, {
    orm,
    jsonResponse,
    access,
    requireAuth,
    requireRunnerAuth,
  });

  return { app, db, bus, injectWebSocket };
}

const SYSTEM_AGENT_NAME = "system";

const DEFAULT_MODEL_NAME_BY_PROVIDER = {
  openai: "gpt-5.2",
  anthropic: "claude-3-5-sonnet-latest",
  openrouter: "openai/gpt-4o-mini",
} as const;

const PROVIDER_API_KEY_ENV = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
} as const;

type SystemAgentProvider = keyof typeof DEFAULT_MODEL_NAME_BY_PROVIDER;

function normalizeSystemAgentProvider(raw: string): SystemAgentProvider | null {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "openai") return "openai";
  if (normalized === "anthropic" || normalized === "claude") return "anthropic";
  if (normalized === "openrouter" || normalized === "or") return "openrouter";
  return null;
}

function resolveSystemAgentModel(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const colon = trimmed.indexOf(":");
  const provider = normalizeSystemAgentProvider(
    colon === -1 ? trimmed : trimmed.slice(0, colon),
  );
  if (!provider) return null;
  const explicitModel = colon === -1 ? "" : trimmed.slice(colon + 1).trim();
  const modelName = explicitModel || DEFAULT_MODEL_NAME_BY_PROVIDER[provider];
  if (!modelName) return null;
  return {
    provider,
    modelName,
    modelId: `${provider}:${modelName}`,
    secretName: PROVIDER_API_KEY_ENV[provider],
  };
}

function seedDefaultSystemAgent(
  orm: OrgOpsDrizzleDb,
  dataDir: string,
  configuredModel: string | undefined,
) {
  const configured = (
    configuredModel ??
    process.env.ORGOPS_SYSTEM_AGENT_MODEL ??
    ""
  ).trim();
  if (!configured) return;

  const existingAgent = orm
    .select({ id: schema.agents.id })
    .from(schema.agents)
    .limit(1)
    .get();
  if (existingAgent) return;

  const resolved = resolveSystemAgentModel(configured);
  if (!resolved) {
    console.warn(
      `ORGOPS_SYSTEM_AGENT_MODEL "${configured}" is not a supported provider or provider:model value. Skipping default system agent.`,
    );
    return;
  }

  const apiKey = (process.env[resolved.secretName] ?? "").trim();
  if (!apiKey) {
    console.warn(
      `ORGOPS_SYSTEM_AGENT_MODEL is set but ${resolved.secretName} is empty. Skipping default system agent.`,
    );
    return;
  }

  let masterKey: Buffer;
  try {
    masterKey = parseMasterKey(process.env.ORGOPS_MASTER_KEY ?? "");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Skipping default system agent: ${message}`);
    return;
  }

  const now = Date.now();
  orm.transaction((tx) => {
    const existingSecret = tx
      .select({ id: schema.secrets.id })
      .from(schema.secrets)
      .where(
        and(
          eq(schema.secrets.name, resolved.secretName),
          eq(schema.secrets.scope_type, "public"),
          isNull(schema.secrets.scope_id),
        ),
      )
      .get();
    if (!existingSecret) {
      tx.insert(schema.secrets)
        .values({
          id: randomUUID(),
          name: resolved.secretName,
          scope_type: "public",
          scope_id: null,
          ciphertext_b64: encryptSecret(masterKey, apiKey),
          created_at: now,
        })
        .run();
    }

    const existingModel = tx
      .select({ id: schema.models.id })
      .from(schema.models)
      .where(eq(schema.models.id, resolved.modelId))
      .get();
    if (!existingModel) {
      tx.insert(schema.models)
        .values({
          id: resolved.modelId,
          provider: resolved.provider,
          model_name: resolved.modelName,
          enabled: 1,
          defaults_json: "{}",
          created_at: now,
        })
        .run();
    }

    tx.insert(schema.agents)
      .values({
        id: randomUUID(),
        name: SYSTEM_AGENT_NAME,
        description: "Default system agent",
        model_id: resolved.modelId,
        soul_contents:
          "You are system, the default OrgOps agent created when this instance first started.",
        workspace_path: join(dataDir, "workspaces", "system"),
        created_at: now,
        updated_at: now,
      })
      .run();
  });
}
