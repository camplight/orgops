import { Hono } from "hono";
import { matchedRoutes } from "hono/route";
import { createNodeWebSocket } from "@hono/node-ws";
import { existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";

import {
  createDrizzleDb,
  openDb,
  migrate,
  schema,
  type OrgOpsDb,
} from "@orgops/db";
import { EventBus } from "@orgops/event-bus";
import { decryptSecret, parseMasterKey } from "@orgops/crypto";
import {
  AuthLoginSchema,
  CatalogAssignmentAuditEventSchema,
  EventSchema,
  PackageReleaseViewSchema,
  type AuthenticatedHuman,
  type LibraryPackageDetail,
  type ManageableAgent,
  type TemplateOptions,
  type EventShapeDefinition,
  type PackageReleaseView,
  type SkillReadiness,
  type SkillRef,
  getCoreEventShapes,
  serializeEventShapes,
  validateEventAgainstShapes,
} from "@orgops/schemas";
import {
  inspectGitPackage,
  listSkills,
  loadSkillEventShapes,
  prepareImport,
  readLocalSkillEvidence,
  resolveSkillRoot,
} from "@orgops/skills";
import { canManageCatalogs, createRequireAdmin } from "./admin-access";
import { registerCatalogSourceRoutes, type LibraryPackage } from "./routes/catalog-library";
import { registerAuthRoutes } from "./routes/auth";
import { registerModelsRoutes } from "./routes/models";
import { registerAgentsRoutes } from "./routes/agents";
import { registerAgentProvisioningRoutes } from "./routes/agent-provisioning";
import { registerCollabRoutes } from "./routes/collab";
import { registerEventsRoutes } from "./routes/events";
import { registerMemoryRoutes } from "./routes/memory";
import { registerRuntimeRoutes } from "./routes/runtime";
import { registerSkillsRoutes } from "./routes/skills";
import { registerUnifiedSkillRoutes } from "./routes/unified-skills";
import { registerAgentSkillRoutes } from "./routes/agent-skills";
import { createUnifiedSkillInventory } from "./unified-skills/inventory";
import { registerSecretsRoutes } from "./routes/secrets";
import { registerWsRoutes, type WsServerMessage } from "./routes/ws";
import { registerHumansRoutes } from "./routes/humans";
import { registerRunnersRoutes } from "./routes/runners";
import { registerIntegrationKeysRoutes } from "./routes/integration-keys";
import { registerEmbedRoutes } from "./routes/embed";
import {
  findActiveRunnerTokenByToken,
  parseStringArraySafe as parseRunnerScopeChannels,
  touchRunnerTokenLastUsed,
} from "./agent-invite-auth";
import { registerAgentInviteRoutes } from "./routes/agent-invites";
import { createAccessControl } from "./routes/access";
import { createCatalogAuthority } from "./catalog-library/authority";
import { createPackageInstallation } from "./catalog-library/installation";
import { catalogGrantId, parseCanonicalCatalogGrant } from "./catalog-library/grant-identity";
import { createCatalogPolicy, type CatalogPolicyReleaseState } from "./catalog-library/policy";
import { createCatalogConsumption, projectEffectiveAgentSkills } from "./catalog-library/consumption";
import { createAgentSkillManagement, AgentSkillManagementError } from "./unified-skills/management";
import { createAgentProvisioning, createSecretReferenceResolver } from "./unified-skills/provisioning";
import { createTemplateInstantiation } from "./catalog-library/templates";
import { createSecretBindingMutation } from "./catalog-library/secret-binding";
import { createRunnerArtifactDelivery, createRunnerStartGateDelivery } from "./catalog-library/runner-delivery";
import { createRolloutCoordinator } from "./catalog-library/rollout";
import { createCatalogStartGate } from "./catalog-library/start-gate";
import { createSourceFetchAdapter } from "./catalog-library/source-fetch";
import {
  ApiExecutionError,
  createApiExecutionCoordinator,
  createAtomicEventShapeRegistry,
  loadCapturedEventShapeModule,
  verifyInstalledApiRelease,
  type VerifiedApiModule,
} from "./catalog-library/activation";
import { ensureCatalogMirror } from "./catalog-sync/mirror";
import type { CatalogAuditEvent, GrantView } from "@orgops/schemas";
import type { CatalogGitTransport } from "./catalog-sync/git-fetch";

export type AppConfig = {
  db?: OrgOpsDb; dbPath?: string; dataDir?: string; projectRoot?: string;
  adminUser?: string; adminPass?: string; runnerToken?: string; runnerApiUrl?: string;
  catalogGitExecutable?: string;
  catalogSyncTransport?: CatalogGitTransport;
  catalogLocalSkillsRoot?: string;
  catalogInstallRoot?: string;
  catalogEventShapeModuleLoader?: (module: VerifiedApiModule) => Promise<unknown>;
};

type AppEnv = {
  Variables: {
    user: { id?: string; username: string; mustChangePassword: boolean };
  };
};

function strictProjectRoot(value: string): string {
  if (!isAbsolute(value) || value !== resolve(value) || value === "/" || value.includes("\\")
    || /[\u0000-\u001f\u007f-\u009f]/.test(value)) throw new Error("projectRoot must be an absolute canonical directory");
  const canonical = realpathSync.native(value);
  if (canonical !== value || !lstatSync(value).isDirectory()) throw new Error("projectRoot must be an absolute canonical directory");
  return value;
}

export function createApp(config: AppConfig = {}) {
  const app = new Hono<AppEnv>();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
  const PROJECT_ROOT = (() => {
    if (config.projectRoot !== undefined) return strictProjectRoot(config.projectRoot);
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
  const RUNNER_API_URL =
    config.runnerApiUrl ??
    process.env.ORGOPS_RUNNER_API_URL ??
    process.env.ORGOPS_PUBLIC_API_URL ??
    `http://localhost:${process.env.PORT ?? "8787"}`;

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
        is_admin: 1,
        created_at: now,
        updated_at: now,
        invited_by_human_id: null,
      })
      .run();
  }

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
    return {
      username: "runner",
      mustChangePassword: false,
      runnerScope: {
        mode: "SCOPED" as const,
        tokenId: scoped.id,
        allowedAgentName: scoped.allowed_agent_name ?? undefined,
        allowedRunnerId: scoped.allowed_runner_id ?? undefined,
        allowedChannelIds: parseRunnerScopeChannels(scoped.allowed_channel_ids_json),
        inviteId: scoped.invite_id ?? undefined,
      },
    };
  }

  function requireAuth(c: any, next: any) {
    const fixedFeatureAuth = /^\/api\/(?:skills\/inventory|agents\/(?:provision|template-options|[^/]+\/(?:skills(?:\/|$)|start|stop|restart|reload-skills|cleanup-workspace)))/.test(c.req.path);
    const unauthorized = () => jsonResponse(c, fixedFeatureAuth ? { error: "Unauthorized", code: "UNAUTHORIZED" } : { error: "Unauthorized" }, 401);
    // Hono's router precomputes all path/method matches before middleware runs. A
    // route handler has one argument; middleware has the (c, next) pair. Letting
    // an unmatched API request continue is what preserves the framework's default
    // 404 without weakening auth on any registered endpoint.
    const hasEndpoint = matchedRoutes(c).some(route => route.handler.length < 2);
    if (!hasEndpoint) return next();
    const runnerHeaderPresent = c.req.raw.headers.has("x-orgops-runner-token");
    const runnerHeader = c.req.header("x-orgops-runner-token");
    const runnerUser = resolveRunnerUserFromToken(runnerHeader);
    if (runnerHeaderPresent) {
      if (!runnerUser) return unauthorized();
      c.set("user", runnerUser);
      return next();
    }
    const cookie = c.req.header("cookie") ?? "";
    const match = cookie.match(/orgops_session=([^;]+)/);
    if (!match) return unauthorized();
    const session = sessions.get(match[1]);
    if (!session) return unauthorized();
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

  function toSoulFilename(agentName: string) {
    return `${agentName.replace(/[^a-zA-Z0-9._-]/g, "_")}.md`;
  }

  function getDefaultSoulPath(agentName: string) {
    return join(DATA_DIR, "souls", toSoulFilename(agentName));
  }

  function resolveWorkspacePath(workspacePath: string) {
    if (!workspacePath) return workspacePath;
    return isAbsolute(workspacePath)
      ? workspacePath
      : resolve(PROJECT_ROOT, workspacePath);
  }

  function resolveContainedTemplateWorkspacePath(workspacePath: string) {
    if (!workspacePath) return "";
    try {
      const projectRoot = realpathSync.native(resolve(PROJECT_ROOT));
      const candidate = resolveWorkspacePath(workspacePath);
      let existingAncestor = candidate;
      while (true) {
        try {
          lstatSync(existingAncestor);
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") return "";
          const parent = dirname(existingAncestor);
          if (parent === existingAncestor) return "";
          existingAncestor = parent;
        }
      }
      const canonicalAncestor = realpathSync.native(existingAncestor);
      const canonicalCandidate = resolve(canonicalAncestor, relative(existingAncestor, candidate));
      const fromRoot = relative(projectRoot, canonicalCandidate);
      if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || fromRoot.startsWith(sep)) return "";
      return canonicalCandidate;
    } catch {
      return "";
    }
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

  function insertEvent(input: any, options: {publish?: boolean} = {}) {
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
    if (options.publish !== false) publishEvent(row);
    return row;
  }

  const sourceFetch = createSourceFetchAdapter({
    db,
    mirrorsRoot: join(DATA_DIR, "catalog-mirrors"),
    gitExecutable: config.catalogGitExecutable ?? process.env.ORGOPS_GIT_EXECUTABLE ?? "/usr/bin/git",
    transport: config.catalogSyncTransport,
  });
  const pendingAuditRows = new WeakMap<CatalogAuditEvent, ReturnType<typeof insertEvent>>();
  const catalogAuthority = createCatalogAuthority({
    db,
    ...sourceFetch,
    writeAudit(tx, event) {
      if (tx !== db || !tx.inTransaction) throw new Error("Catalog audit requires the active transaction");
      const row = insertEvent(event, { publish: false });
      pendingAuditRows.set(event, row);
    },
    publishAudit(event) {
      const row = pendingAuditRows.get(event);
      if (!row) throw new Error("Catalog audit was not committed");
      pendingAuditRows.delete(event);
      publishEvent(row);
    },
  });

  const catalogArtifactRoot = config.catalogInstallRoot ?? join(DATA_DIR, "catalog-artifacts");
  const packageInstallation = createPackageInstallation({
    db,
    artifactRoot: catalogArtifactRoot,
    prepareImport,
    readLocalSkillEvidence,
    async inspectGitPackage(release) {
      const mirror = await ensureCatalogMirror(join(DATA_DIR, "catalog-mirrors"), release.contentSourceId, { create: false });
      if (!mirror.ok) return { ok: false, issues: [{ code: "GIT_OBJECT_MISSING", at: "git" }] };
      return inspectGitPackage({
        repository: {
          directory: mirror.directory,
          gitExecutable: config.catalogGitExecutable ?? process.env.ORGOPS_GIT_EXECUTABLE ?? "/usr/bin/git",
        },
        commit: release.packageCommit,
        path: release.packagePath,
      });
    },
    writeAudit(tx, event) {
      if (tx !== db || !tx.inTransaction) throw new Error("Catalog audit requires the active transaction");
      insertEvent(event, { publish: false });
    },
  });

  const eventShapeRegistry = createAtomicEventShapeRegistry(getCoreEventShapes());
  const apiExecutionCoordinator = createApiExecutionCoordinator({
    db,
    registry: eventShapeRegistry,
    async loadBaseShapes() {
      const loaded = await loadSkillEventShapes(listSkills(SKILL_ROOT));
      return { shapes: [...getCoreEventShapes(), ...(loaded.shapes as EventShapeDefinition[])], loadErrors: loaded.errors };
    },
    verifyInstalledRelease: release => verifyInstalledApiRelease(release, catalogArtifactRoot),
    loadEventShapeModule: config.catalogEventShapeModuleLoader ?? loadCapturedEventShapeModule,
    writeAudit(tx, event) {
      if (tx !== db || !tx.inTransaction) throw new Error("Catalog audit requires the active transaction");
      insertEvent(event, { publish: false });
    },
    reportLoadError() {
      console.error("Catalog API event-shape registry startup reconciliation failed");
    },
  });
  const eventShapeStartup = apiExecutionCoordinator.reconcileStartup().then(() => true, () => false);
  async function requireEventShapeStartup(): Promise<void> {
    if (!await eventShapeStartup) throw new ApiExecutionError("STORAGE_FAILURE");
  }
  const apiExecution = {
    async approveApiExecution(...args: Parameters<typeof apiExecutionCoordinator.approveApiExecution>) {
      await requireEventShapeStartup();
      return apiExecutionCoordinator.approveApiExecution(...args);
    },
    async activateApiExecution(...args: Parameters<typeof apiExecutionCoordinator.activateApiExecution>) {
      await requireEventShapeStartup();
      return apiExecutionCoordinator.activateApiExecution(...args);
    },
    async deactivateApiExecution(...args: Parameters<typeof apiExecutionCoordinator.deactivateApiExecution>) {
      await requireEventShapeStartup();
      return apiExecutionCoordinator.deactivateApiExecution(...args);
    },
  };

  const access = createAccessControl({ orm });
  const catalogStartGate = createCatalogStartGate({
    db,
    projectRoot: PROJECT_ROOT,
    artifactRoot: catalogArtifactRoot,
    canManageHuman(actor, agentName) {
      const human = db.prepare<[string], { username: string; must_change_password: number }>(
        "SELECT username,must_change_password FROM humans WHERE id=?",
      ).get(actor.id);
      return Boolean(human && human.must_change_password === 0 && access.canManageAgent({
        id: actor.id, username: human.username, mustChangePassword: false,
      }, agentName));
    },
    isSecretUsable(ciphertext) {
      try { return decryptSecret(parseMasterKey(process.env.ORGOPS_MASTER_KEY ?? ""), ciphertext).length > 0; }
      catch { return false; }
    },
  });
  function readCatalogPolicyRelease(releaseId: string): CatalogPolicyReleaseState | undefined {
    const row = db.prepare<[string], {
      package_release_id: string;
      review_state: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";
      installation_state: "INSTALLED" | "QUARANTINED" | null;
      execution_preview_json: string;
      activation_approval_state: "NOT_REQUIRED" | "AWAITING_APPROVAL" | "APPROVED" | "REVOKED" | null;
      activation_runtime_state: "INACTIVE" | "ACTIVATING" | "ACTIVE" | "DEACTIVATING" | "FAILED" | null;
      activation_revision: number | null;
      activation_failure_code: "INSTALLATION_REQUIRED" | "API_ACTIVATION_REQUIRED" | "INSPECTION_FAILED" | "STORAGE_FAILURE" | null;
      authority_enabled: number;
      authority_removed: number | null;
      content_enabled: number;
      content_removed: number | null;
      content_allow_packages: number;
      same_source: number;
    }>(`SELECT r.package_release_id,c.review_state,i.state AS installation_state,r.execution_preview_json,
      a.approval_state AS activation_approval_state,a.runtime_state AS activation_runtime_state,
      a.revision AS activation_revision,a.failure_code AS activation_failure_code,
      authority.enabled AS authority_enabled,authority.removed_at AS authority_removed,
      content.enabled AS content_enabled,content.removed_at AS content_removed,content.allow_packages AS content_allow_packages,
      r.authority_source_id=r.content_source_id AS same_source
      FROM catalog_package_releases r
      JOIN catalog_release_controls c ON c.package_release_id=r.package_release_id
      JOIN catalog_sources authority ON authority.source_id=r.authority_source_id
      JOIN catalog_sources content ON content.source_id=r.content_source_id
      LEFT JOIN catalog_installations i ON i.release_id=r.package_release_id AND i.artifact_digest=r.digest
      LEFT JOIN catalog_api_activations a ON a.release_id=r.package_release_id
      WHERE r.package_release_id=?`).get(releaseId);
    if (!row) return undefined;
    try {
      const executionPreview = JSON.parse(row.execution_preview_json) as CatalogPolicyReleaseState["release"]["executionPreview"];
      const activationRequired = executionPreview.apiEventShapes.length > 0;
      return {
        release: {
          packageReleaseId: row.package_release_id,
          reviewState: row.review_state,
          installationState: row.installation_state ?? "ABSENT",
          executionPreview,
          apiActivation: row.activation_revision === null ? {
            approvalState: activationRequired ? "AWAITING_APPROVAL" : "NOT_REQUIRED",
            runtimeState: "INACTIVE",
            revision: 1,
            failureCode: null,
          } : {
            approvalState: row.activation_approval_state!, runtimeState: row.activation_runtime_state!,
            revision: row.activation_revision, failureCode: row.activation_failure_code,
          },
        },
        sourceEnabled: row.authority_enabled === 1 && row.authority_removed === null
          && row.content_enabled === 1 && row.content_removed === null,
        externalSourceAllowed: row.same_source === 1 || row.content_allow_packages === 1,
      };
    } catch {
      return undefined;
    }
  }

  const catalogPolicy = createCatalogPolicy({
    canManageAgent(actor, agent) {
      const human = db.prepare<[string], { username: string; must_change_password: number }>(
        "SELECT username,must_change_password FROM humans WHERE id=?",
      ).get(actor.id);
      return Boolean(human && access.canManageAgent({
        id: actor.id,
        username: human.username,
        mustChangePassword: human.must_change_password === 1,
      }, agent.name));
    },
    readRelease: readCatalogPolicyRelease,
    readGrant(actor, releaseId): GrantView | undefined {
      const expectedHumanGrantId = catalogGrantId(releaseId, "HUMAN", actor.id);
      const expectedOrganizationGrantId = catalogGrantId(releaseId, "ORGANIZATION");
      const rows = db.prepare<[string, string, string, string, string], {
        grant_id: string; release_id: string; subject_type: "ORGANIZATION" | "HUMAN";
        human_id: string | null; revision: number; revoked_at: number | null;
      }>(`SELECT grant_id,release_id,subject_type,human_id,revision,revoked_at FROM catalog_grants
        WHERE revoked_at IS NULL AND (
          (grant_id=? AND release_id=? AND subject_type='HUMAN' AND human_id=?) OR
          (grant_id=? AND release_id=? AND subject_type='ORGANIZATION' AND human_id IS NULL)
        )
        ORDER BY CASE subject_type WHEN 'HUMAN' THEN 0 ELSE 1 END LIMIT 2`)
        .all(expectedHumanGrantId, releaseId, actor.id, expectedOrganizationGrantId, releaseId);
      for (const row of rows) {
        const grant = parseCanonicalCatalogGrant({
          grantId: row.grant_id,
          releaseId: row.release_id,
          subject: row.subject_type === "ORGANIZATION" ? { kind: "ORGANIZATION" } : { kind: "HUMAN", humanId: row.human_id },
          revision: row.revision,
          revokedAt: row.revoked_at,
        });
        if (grant) return grant;
      }
      return undefined;
    },
  });

  let managementForConsumption: import("./unified-skills/management").AgentSkillManagement | undefined;
  const catalogConsumption = createCatalogConsumption({
    db,
    management: {
      executeLegacyCatalog(command, actor) {
        if (!managementForConsumption) throw new Error("Skill management unavailable");
        return managementForConsumption.executeLegacyCatalog(command, actor);
      },
    },
    policy: catalogPolicy,
    enqueueBoundDeployment(tx, command) {
      if (tx !== db || !tx.inTransaction) throw new Error("Catalog deployment requires the active transaction");
      tx.prepare(`INSERT INTO runner_package_deployments
        (deployment_id,rollout_id,target_agent_id,release_id,bound_runner_id,desired_generation,state,
         attempt_token,lease_expires_at,revision,failure_code,created_at,updated_at,completed_at)
        VALUES (?,NULL,?,?,?,?,'QUEUED',NULL,NULL,1,NULL,?,?,NULL)`).run(
        command.deploymentId, command.agentId, command.releaseId, command.runnerId,
        command.desiredGeneration, command.createdAt, command.createdAt,
      );
    },
    writeAudit(tx, event) {
      if (tx !== db || !tx.inTransaction) throw new Error("Catalog audit requires the active transaction");
      insertEvent(event, { publish: false });
    },
  });

  const runnerArtifactDelivery = createRunnerArtifactDelivery({
    db,
    artifactRoot: catalogArtifactRoot,
    writeAudit(tx, event) {
      if (tx !== db || !tx.inTransaction) throw new Error("Catalog audit requires the active transaction");
      insertEvent(event, { publish: false });
    },
  });
  const runnerStartGateDelivery = createRunnerStartGateDelivery(db, catalogStartGate);

  const LIBRARY_PAGE_SIZE = 100;
  const LIBRARY_RESULT_LIMIT = 100;
  type LibraryCandidateRow = {
    package_release_id: string;
    kind: "skill" | "native-agent" | "wrapped-agent";
    name: string;
    version: string;
    digest: string;
  };
  type LibraryGrantRow = {
    grant_id: string;
    release_id: string;
    subject_type: "ORGANIZATION" | "HUMAN";
    human_id: string | null;
    revision: number;
    revoked_at: number | null;
  };
  type LibraryPolicyRow = LibraryCandidateRow & {
    authority_source_id: string;
    content_source_id: string;
    catalog_commit: string;
    package_commit: string;
    package_path: string;
    manifest_json: string;
    execution_preview_json: string;
    warnings_json: string;
    review_state: PackageReleaseView["reviewState"];
    review_digest: string | null;
    reviewed_by_human_id: string | null;
    reviewed_at: number | null;
    control_revision: number;
    installation_state: "INSTALLED" | "QUARANTINED" | null;
    activation_approval_state: PackageReleaseView["apiActivation"]["approvalState"] | null;
    activation_runtime_state: PackageReleaseView["apiActivation"]["runtimeState"] | null;
    activation_failure_code: PackageReleaseView["apiActivation"]["failureCode"];
    activation_revision: number | null;
  };
  const libraryPolicySelect = `SELECT r.package_release_id,r.authority_source_id,r.content_source_id,r.kind,r.name,r.version,r.digest,
    r.catalog_commit,r.package_commit,r.package_path,r.manifest_json,r.execution_preview_json,r.warnings_json,
    c.review_state,c.review_digest,c.reviewed_by_human_id,c.reviewed_at,c.revision AS control_revision,
    i.state AS installation_state,a.approval_state AS activation_approval_state,a.runtime_state AS activation_runtime_state,
    a.failure_code AS activation_failure_code,a.revision AS activation_revision
    FROM catalog_package_releases r
    JOIN catalog_release_controls c ON c.package_release_id=r.package_release_id
    LEFT JOIN catalog_installations i ON i.release_id=r.package_release_id AND i.artifact_digest=r.digest
    LEFT JOIN catalog_api_activations a ON a.release_id=r.package_release_id`;

  function readLibraryPolicyInput(releaseId: string): PackageReleaseView | undefined {
    const row = db.prepare(`${libraryPolicySelect} WHERE r.package_release_id=?`).get(releaseId) as LibraryPolicyRow | undefined;
    if (!row) return undefined;
    try {
      const manifest = JSON.parse(row.manifest_json) as { files?: Array<{ path: string; executable: boolean; size: number; digest: string }> };
      const executionPreview = JSON.parse(row.execution_preview_json) as PackageReleaseView["executionPreview"];
      const activationRequired = executionPreview.apiEventShapes.length > 0;
      const parsed = PackageReleaseViewSchema.safeParse({
        packageReleaseId: row.package_release_id,
        authoritySourceId: row.authority_source_id,
        contentSourceId: row.content_source_id,
        kind: row.kind,
        name: row.name,
        version: row.version,
        digest: row.digest,
        catalogCommit: row.catalog_commit,
        packageCommit: row.package_commit,
        packagePath: row.package_path,
        manifest,
        executionPreview,
        warnings: JSON.parse(row.warnings_json),
        files: (manifest.files ?? []).map(file => ({
          path: file.path,
          mode: file.executable ? 0o755 : 0o644,
          size: file.size,
          digest: file.digest,
        })),
        reviewState: row.review_state,
        reviewDigest: row.review_digest,
        reviewer: row.reviewed_by_human_id === null || row.reviewed_at === null
          ? null
          : { humanId: row.reviewed_by_human_id, reviewedAt: row.reviewed_at },
        installationState: row.installation_state ?? "ABSENT",
        apiActivation: row.activation_revision === null ? {
          approvalState: activationRequired ? "AWAITING_APPROVAL" : "NOT_REQUIRED",
          runtimeState: "INACTIVE",
          revision: 1,
          failureCode: null,
        } : {
          approvalState: row.activation_approval_state,
          runtimeState: row.activation_runtime_state,
          revision: row.activation_revision,
          failureCode: row.activation_failure_code,
        },
        revision: row.control_revision,
      });
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  function libraryCandidates(
    actor: AuthenticatedHuman,
    { releaseId, offset = 0 }: { releaseId?: string; offset?: number } = {},
  ): LibraryCandidateRow[] {
    const humanClause = actor.kind === "HUMAN_ADMIN" ? "" : `AND EXISTS (
      SELECT 1 FROM catalog_grants g
      WHERE g.release_id=r.package_release_id AND g.revoked_at IS NULL
        AND (g.subject_type='ORGANIZATION' OR (g.subject_type='HUMAN' AND g.human_id=?))
    )`;
    const detailClause = releaseId === undefined ? "" : "AND r.package_release_id=?";
    const limit = releaseId === undefined ? LIBRARY_PAGE_SIZE : 1;
    const parameters = [
      ...(actor.kind === "HUMAN_ADMIN" ? [] : [actor.id]),
      ...(releaseId === undefined ? [] : [releaseId]),
      limit,
      offset,
    ];
    return db.prepare(`SELECT DISTINCT r.package_release_id,r.kind,r.name,r.version,r.digest
      FROM catalog_package_releases r
      JOIN catalog_release_controls c ON c.package_release_id=r.package_release_id AND c.review_state='APPROVED'
      JOIN catalog_installations i ON i.release_id=r.package_release_id AND i.state='INSTALLED' AND i.artifact_digest=r.digest
      WHERE 1=1 ${humanClause} ${detailClause}
      ORDER BY r.kind,r.name,r.version,r.package_release_id LIMIT ? OFFSET ?`).all(...parameters) as LibraryCandidateRow[];
  }

  function libraryDecision(actor: AuthenticatedHuman, releaseId: string) {
    const release = readLibraryPolicyInput(releaseId);
    return catalogPolicy.decide({ action: "LIBRARY_VIEW", actor, ...(release ? { release } : {}) });
  }

  function publicLibraryPackage(row: LibraryCandidateRow): LibraryPackage {
    return {
      packageReleaseId: row.package_release_id,
      kind: row.kind,
      name: row.name,
      version: row.version,
      digest: row.digest,
    };
  }

  function libraryEmptyReason(actor: AuthenticatedHuman): "NO_GRANTS" | "NOT_INSTALLED" | "NO_COMPATIBLE_RELEASES" {
    if (actor.kind === "HUMAN_ADMIN") {
      for (let offset = 0; ; offset += LIBRARY_PAGE_SIZE) {
        const releaseIds = db.prepare(`SELECT package_release_id FROM catalog_package_releases
          ORDER BY package_release_id LIMIT ? OFFSET ?`)
          .all(LIBRARY_PAGE_SIZE, offset) as Array<{ package_release_id: string }>;
        for (const { package_release_id } of releaseIds) {
          const decision = libraryDecision(actor, package_release_id);
          if (!decision.allow && decision.reasonCode === "INSTALLATION_REQUIRED") return "NOT_INSTALLED";
        }
        if (releaseIds.length < LIBRARY_PAGE_SIZE) return "NO_COMPATIBLE_RELEASES";
      }
    }

    let hasCanonicalGrant = false;
    for (let offset = 0; ; offset += LIBRARY_PAGE_SIZE) {
      const rows = db.prepare(`SELECT grant_id,release_id,subject_type,human_id,revision,revoked_at
        FROM catalog_grants WHERE revoked_at IS NULL
          AND (subject_type='ORGANIZATION' OR (subject_type='HUMAN' AND human_id=?))
        ORDER BY release_id,subject_type,COALESCE(human_id,''),grant_id LIMIT ? OFFSET ?`)
        .all(actor.id, LIBRARY_PAGE_SIZE, offset) as LibraryGrantRow[];
      for (const row of rows) {
        const grant = parseCanonicalCatalogGrant({
          grantId: row.grant_id,
          releaseId: row.release_id,
          subject: row.subject_type === "ORGANIZATION" ? { kind: "ORGANIZATION" } : { kind: "HUMAN", humanId: row.human_id },
          revision: row.revision,
          revokedAt: row.revoked_at,
        });
        if (!grant) continue;
        hasCanonicalGrant = true;
        const decision = libraryDecision(actor, grant.releaseId);
        if (!decision.allow && decision.reasonCode === "INSTALLATION_REQUIRED") return "NOT_INSTALLED";
      }
      if (rows.length < LIBRARY_PAGE_SIZE) {
        return hasCanonicalGrant ? "NO_COMPATIBLE_RELEASES" : "NO_GRANTS";
      }
    }
  }

  const catalogLibrary = {
    list(actor: AuthenticatedHuman) {
      const packages: LibraryPackage[] = [];
      for (let offset = 0; packages.length < LIBRARY_RESULT_LIMIT; offset += LIBRARY_PAGE_SIZE) {
        const rows = libraryCandidates(actor, { offset });
        for (const row of rows) {
          if (libraryDecision(actor, row.package_release_id).allow) packages.push(publicLibraryPackage(row));
          if (packages.length === LIBRARY_RESULT_LIMIT) break;
        }
        if (rows.length < LIBRARY_PAGE_SIZE) break;
      }
      return packages.length > 0 ? { packages } : { packages, emptyReason: libraryEmptyReason(actor) };
    },
    detail(actor: AuthenticatedHuman, packageReleaseId: string) {
      const row = libraryCandidates(actor, { releaseId: packageReleaseId })[0];
      return row && libraryDecision(actor, row.package_release_id).allow ? publicLibraryPackage(row) : undefined;
    },
    safeDetail(actor: AuthenticatedHuman, packageReleaseId: string): LibraryPackageDetail | undefined {
      const row = libraryCandidates(actor, { releaseId: packageReleaseId })[0];
      if (!row || !libraryDecision(actor, packageReleaseId).allow) return undefined;
      const release = readLibraryPolicyInput(packageReleaseId);
      if (!release) return undefined;
      return {
        package: publicLibraryPackage(row), description: release.manifest.description, author: release.manifest.author,
        license: release.manifest.license, compatibility: release.manifest.compatibility,
        dependencies: release.manifest.dependencies.map(dependency => ({ name: dependency.name, version: dependency.version, digest: dependency.digest })),
        secretRequirements: release.manifest.secrets,
      };
    },
    manageableAgents(actor: AuthenticatedHuman, packageReleaseId: string): ManageableAgent[] | undefined {
      const release = readLibraryPolicyInput(packageReleaseId);
      if (!release || !libraryDecision(actor, packageReleaseId).allow || release.kind !== "skill") return undefined;
      const rows = db.prepare<[], { id: string; name: string; owner_human_id: string | null; assigned_runner_id: string | null; revision: number; desired_state: "RUNNING" | "STOPPED" }>(
        "SELECT id,name,owner_human_id,assigned_runner_id,revision,desired_state FROM agents ORDER BY name,id",
      ).all();
      return rows.flatMap(row => {
        const agent = { id: row.id, name: row.name, ownerHumanId: row.owner_human_id, assignedRunnerId: row.assigned_runner_id, revision: row.revision };
        let decision;
        try { decision = catalogPolicy.decide({ action: "SKILL_ASSIGN", actor, release, agent }); } catch { return []; }
        if (!decision.allow) return [];
        const storedAssignment = db.prepare<[string, string], { desired_state: "DISABLED" | "ENABLED"; effective_state: "DISABLED" | "ENABLED"; deployment_state: "STABLE" | "REQUESTED" | "DEPLOYING" | "FAILED"; removal_requested: number; preload: number; revision: number }>(
          "SELECT desired_state,effective_state,deployment_state,removal_requested,preload,revision FROM agent_skill_assignments WHERE agent_id=? AND release_id=?",
        ).get(row.id, packageReleaseId);
        if (storedAssignment && ![0, 1].includes(storedAssignment.removal_requested)) throw new Error("corrupt assignment removal marker");
        const assignment = storedAssignment?.removal_requested === 0 ? storedAssignment : undefined;
        return [{ id: row.id, name: row.name, assignedRunnerId: row.assigned_runner_id, agentRevision: row.revision,
          assignmentRevision: assignment?.revision ?? 0, desiredState: row.desired_state, effectiveState: assignment?.effective_state ?? "DISABLED",
          deploymentState: assignment?.deployment_state ?? "STABLE", preload: assignment?.preload === 1 }];
      });
    },
    templateOptions(actor: AuthenticatedHuman, packageReleaseId: string): TemplateOptions | undefined {
      const release = readLibraryPolicyInput(packageReleaseId);
      if (!release || !libraryDecision(actor, packageReleaseId).allow || !["native-agent", "wrapped-agent"].includes(release.kind)) return undefined;
      const decision = catalogPolicy.decide({ action: "TEMPLATE_INSTANTIATE", actor, release });
      if (!decision.allow && decision.reasonCode !== "API_ACTIVATION_REQUIRED") return undefined;
      const names = new Set(release.manifest.secrets.map(requirement => requirement.name));
      const runners = db.prepare<[], { id: string }>("SELECT id FROM runner_nodes ORDER BY id").all().map(item => ({ id: item.id }));
      const models = db.prepare<[], { id: string }>("SELECT id FROM models WHERE enabled=1 ORDER BY id").all().map(item => ({ id: item.id }));
      const secretReferences = db.prepare<[string], { id: string; name: string }>("SELECT id,name FROM secrets WHERE scope_type='package' AND scope_id=? ORDER BY name,id").all(packageReleaseId)
        .filter(secret => names.has(secret.name)).map(secret => ({ id: secret.id, name: secret.name }));
      return { runners, models, secretReferences };
    },
  };

  const catalogRollout = createRolloutCoordinator({
    db,
    policy: catalogPolicy,
    readRelease: readLibraryPolicyInput,
    startGate: catalogStartGate,
    writeAudit(tx, event) {
      if (tx !== db || !tx.inTransaction) throw new Error("Catalog audit requires the active transaction");
      insertEvent(event, { publish: false });
    },
  });
  const activationCoordinator = { ...apiExecution, ...catalogRollout };

  const catalogAuditWriter = (tx: OrgOpsDb, event: import("@orgops/schemas").CatalogAuditEvent) => {
    if (tx !== db || !tx.inTransaction) throw new Error("Catalog audit requires the active transaction");
    insertEvent(event, { publish: false });
  };
  let provisioningSecretResolver: import("./unified-skills/provisioning").SecretReferenceResolver | undefined;
  try {
    provisioningSecretResolver = createSecretReferenceResolver({ db, key: parseMasterKey(process.env.ORGOPS_MASTER_KEY ?? "") });
  } catch { provisioningSecretResolver = undefined; }
  const secretBinding = createSecretBindingMutation({
    db, writeAudit: catalogAuditWriter,
    isSecretUsable(ciphertext) {
      try { return decryptSecret(parseMasterKey(process.env.ORGOPS_MASTER_KEY ?? ""), ciphertext).length > 0; }
      catch { return false; }
    },
  });

  const findAdminHuman = db.prepare<[string], {
    is_admin: number;
    must_change_password: number;
  }>("SELECT is_admin, must_change_password FROM humans WHERE id = ?");
  const adminAccessDeps = {
    findHuman: (id: string) => {
      const row = findAdminHuman.get(id);
      return row ? {
        isAdmin: row.is_admin === 1,
        mustChangePassword: row.must_change_password === 1,
      } : undefined;
    },
  };

  function inventoryGrantFor(actor: import("@orgops/schemas").InventoryActor, releaseId: string): GrantView | undefined {
    if (actor.kind === "HUMAN_ADMIN") return undefined;
    const expectedHumanGrantId = catalogGrantId(releaseId, "HUMAN", actor.id);
    const expectedOrganizationGrantId = catalogGrantId(releaseId, "ORGANIZATION");
    const row = db.prepare<[string, string, string, string, string], { grant_id: string; release_id: string; subject_type: "ORGANIZATION" | "HUMAN"; human_id: string | null; revision: number; revoked_at: number | null }>(
      "SELECT grant_id,release_id,subject_type,human_id,revision,revoked_at FROM catalog_grants WHERE revoked_at IS NULL AND ((grant_id=? AND release_id=? AND subject_type='HUMAN' AND human_id=?) OR (grant_id=? AND release_id=? AND subject_type='ORGANIZATION' AND human_id IS NULL)) ORDER BY subject_type LIMIT 1",
    ).get(expectedHumanGrantId, releaseId, actor.id, expectedOrganizationGrantId, releaseId);
    return row ? parseCanonicalCatalogGrant({ grantId: row.grant_id, releaseId: row.release_id, subject: row.subject_type === "HUMAN" ? { kind: "HUMAN", humanId: row.human_id } : { kind: "ORGANIZATION" }, revision: row.revision, revokedAt: row.revoked_at }) : undefined;
  }
  function inventoryAgentFor(agentId: string) {
    const row = db.prepare<[string], { id: string; name: string; owner_human_id: string | null; assigned_runner_id: string | null; revision: number }>("SELECT id,name,owner_human_id,assigned_runner_id,revision FROM agents WHERE id=?").get(agentId);
    return row ? { id: row.id, name: row.name, ownerHumanId: row.owner_human_id, assignedRunnerId: row.assigned_runner_id, revision: row.revision } : undefined;
  }
  const agentSkillManagement = createAgentSkillManagement({
    db,
    requireManageableAgent(tx, agentId, actor) {
      const row = tx.prepare<[string], { id: string; name: string; revision: number; assigned_runner_id: string | null; enabled_skills_json: string; always_preloaded_skills_json: string }>("SELECT id,name,revision,assigned_runner_id,enabled_skills_json,always_preloaded_skills_json FROM agents WHERE id=?").get(agentId);
      if (!row) throw new AgentSkillManagementError("FORBIDDEN");
      const human = tx.prepare<[string], { username: string; must_change_password: number }>("SELECT username,must_change_password FROM humans WHERE id=?").get(actor.id);
      if (!human || human.must_change_password !== 0 || !access.canManageAgent({ id: actor.id, username: human.username, mustChangePassword: false }, row.name)) throw new AgentSkillManagementError("FORBIDDEN");
      return row;
    },
    localSkillExists(_tx, name) { return listSkills(SKILL_ROOT).some(skill => skill.name === name); },
    localOriginForName(_tx, name) { return listSkills(SKILL_ROOT).some(skill => skill.name === name) ? "BUILT_IN" : "WORKSPACE"; },
    validateCatalog(tx, command, actor) {
      const release = readLibraryPolicyInput(command.packageReleaseId);
      if (!release || release.kind !== "skill") throw new AgentSkillManagementError("NOT_FOUND");
      const agent = inventoryAgentFor(command.agentId);
      if (!agent) throw new AgentSkillManagementError("FORBIDDEN");
      const grant = inventoryGrantFor(actor, command.packageReleaseId);
      const decision = catalogPolicy.decide({ action: "SKILL_ASSIGN", actor: actor as any, release, ...(grant ? { grant } : {}), agent });
      if (!decision.allow) throw new AgentSkillManagementError(decision.reasonCode);
      const installation = tx.prepare<[string], { state: string; artifact_digest: string | null }>("SELECT state,artifact_digest FROM catalog_installations WHERE release_id=?").get(command.packageReleaseId);
      if (release.installationState !== "INSTALLED" || installation?.state !== "INSTALLED" || installation.artifact_digest !== release.digest) throw new AgentSkillManagementError("INSTALLATION_REQUIRED");
      let legacyNames: unknown;
      try { legacyNames = JSON.parse(tx.prepare<[string], { enabled_skills_json: string }>("SELECT enabled_skills_json FROM agents WHERE id=?").get(command.agentId)?.enabled_skills_json ?? "[]"); } catch { throw new AgentSkillManagementError("STATE_CONFLICT"); }
      if (!Array.isArray(legacyNames) || legacyNames.some(name => typeof name !== "string")) throw new AgentSkillManagementError("STATE_CONFLICT");
      const collisions = tx.prepare<[string, string, string], { release_id: string; removal_requested: number }>("SELECT release_id,removal_requested FROM agent_skill_assignments WHERE agent_id=? AND local_skill_name=? AND release_id<>? ORDER BY release_id").all(command.agentId, release.manifest.name, command.packageReleaseId);
      if (collisions.some(row => ![0, 1].includes(row.removal_requested))) throw new AgentSkillManagementError("STATE_CONFLICT");
      if (collisions.some(row => row.removal_requested === 0) || legacyNames.includes(release.manifest.name)) throw new AgentSkillManagementError("STATE_CONFLICT");
      if (!agent.assignedRunnerId) throw new AgentSkillManagementError("STATE_CONFLICT");
      return { localSkillName: release.manifest.name, runnerId: agent.assignedRunnerId, exactRef: { kind: "CATALOG", packageReleaseId: release.packageReleaseId, name: release.name, version: release.version, digest: release.digest }, actorKind: actor.kind === "HUMAN_ADMIN" ? "ADMIN" : "GRANT", grantId: grant?.grantId ?? null };
    },
    enqueueCompleteGeneration(tx, agentId, generation, assignments) {
      const agent = tx.prepare<[string], { assigned_runner_id: string | null }>("SELECT assigned_runner_id FROM agents WHERE id=?").get(agentId);
      if (!agent?.assigned_runner_id) throw new AgentSkillManagementError("STATE_CONFLICT");
      const createdAt = Date.now();
      let root: { packageReleaseId: string } | undefined = assignments[0];
      if (!root) {
        const anchor = tx.prepare<[string, string], { packageReleaseId: string; removalRequested: number }>("SELECT release_id AS packageReleaseId,removal_requested AS removalRequested FROM agent_skill_assignments WHERE agent_id=? AND desired_generation=? ORDER BY assignment_id LIMIT 1").get(agentId, generation);
        if (anchor && ![0, 1].includes(anchor.removalRequested)) throw new AgentSkillManagementError("STATE_CONFLICT");
        // An exact requested tombstone is the internal anchor for an empty generation.
        root = anchor;
      }
      if (!root) return generation;
      const deploymentId = randomUUID();
      tx.prepare(`INSERT INTO runner_package_deployments
        (deployment_id,rollout_id,target_agent_id,release_id,bound_runner_id,desired_generation,state,revision,created_at,updated_at)
        VALUES (?,NULL,?,?,?,?,'QUEUED',1,?,?)`).run(deploymentId, agentId, root.packageReleaseId, agent.assigned_runner_id, generation, createdAt, createdAt);
      // Runner delivery freezes the complete participant set atomically from this generation.
      return deploymentId;
    },
    enqueueLegacyGeneration(tx, agentId, generation, assignments) {
      const agent = tx.prepare<[string], { assigned_runner_id: string | null }>("SELECT assigned_runner_id FROM agents WHERE id=?").get(agentId);
      if (!agent?.assigned_runner_id) throw new AgentSkillManagementError("STATE_CONFLICT");
      if (assignments.length === 0) return generation;
      const deploymentId = randomUUID();
      const createdAt = Date.now();
      tx.prepare(`INSERT INTO runner_package_deployments
        (deployment_id,rollout_id,target_agent_id,release_id,bound_runner_id,desired_generation,state,revision,created_at,updated_at)
        VALUES (?,NULL,?,?,?,?,'QUEUED',1,?,?)`).run(deploymentId, agentId, assignments[0]!.packageReleaseId, agent.assigned_runner_id, generation, createdAt, createdAt);
      return deploymentId;
    },
    writeAudit(tx, event) {
      if ((event as { type?: string }).type === "audit.skill.changed") {
        insertEvent(event, { publish: false });
        return;
      }
      insertEvent(CatalogAssignmentAuditEventSchema.parse(event), { publish: false });
    },
  });
  managementForConsumption = agentSkillManagement;
  const templateInstantiation = createTemplateInstantiation({
    secretReferenceResolver: provisioningSecretResolver,
    db,
    policy: catalogPolicy,
    writeAudit: catalogAuditWriter,
    resolveWorkspacePath: resolveContainedTemplateWorkspacePath,
    isWorkspaceAllowed: path => path.length > 0,
    management: agentSkillManagement,
  });
  const agentProvisioning = createAgentProvisioning({
    db,
    management: agentSkillManagement,
    secretReferenceResolver: provisioningSecretResolver,
    resolveWorkspacePath: resolveContainedTemplateWorkspacePath,
    isWorkspaceAllowed: path => path.length > 0,
    templateInstantiation,
    requireLiveHuman(tx, actor) {
      if (actor.kind !== "HUMAN_ADMIN" && actor.kind !== "AUTHENTICATED_HUMAN") throw new AgentSkillManagementError("FORBIDDEN");
      const human = tx.prepare<[string], { is_admin: number; must_change_password: number }>("SELECT is_admin,must_change_password FROM humans WHERE id=?").get(actor.id);
      if (!human || human.must_change_password !== 0 || (actor.kind === "HUMAN_ADMIN") !== (human.is_admin === 1)) throw new AgentSkillManagementError("FORBIDDEN");
    },
    resolvePortableConfig(command, actor) {
      if (command.kind !== "TEMPLATE") return {};
      const release = readLibraryPolicyInput(command.packageReleaseId);
      if (!release || (release.kind !== "native-agent" && release.kind !== "wrapped-agent")) throw new AgentSkillManagementError("NOT_FOUND");
      const grant = inventoryGrantFor(actor, command.packageReleaseId);
      const decision = catalogPolicy.decide({ action: "TEMPLATE_INSTANTIATE", actor: actor as any, release, ...(grant ? { grant } : {}) });
      if (!decision.allow || release.reviewState !== "APPROVED" || release.installationState !== "INSTALLED" || release.apiActivation.runtimeState === "FAILED") throw new AgentSkillManagementError(decision.allow ? "NOT_FOUND" : decision.reasonCode);
      const manifest = release.manifest;
      if (manifest.kind === "native-agent") return { mode: manifest.native.mode, systemInstructions: manifest.native.systemInstructions, soulContents: manifest.native.soulContents, runtime: manifest.native.runtime, requirements: manifest.secrets, digest: release.digest, skillPreloads: manifest.native.alwaysPreloadedSkills };
      if (manifest.kind === "wrapped-agent") return { mode: "WRAPPED", wrappedConfig: { ...manifest.wrapped, source: undefined }, requirements: manifest.secrets, digest: release.digest };
      throw new AgentSkillManagementError("STATE_CONFLICT");
    },
    resolveSkillRefs(command, actor) {
      const local = command.localSkills.map(skill => ({ kind: "LOCAL" as const, name: skill.name, localOrigin: listSkills(SKILL_ROOT).some(item => item.name === skill.name) ? "BUILT_IN" as const : "WORKSPACE" as const }));
      const refs: SkillRef[] = [];
      const visited = new Set<string>();
      const visiting = new Set<string>();
      const visit = (releaseId: string) => {
        if (visiting.has(releaseId)) throw new AgentSkillManagementError("IDENTITY_CONFLICT");
        if (visited.has(releaseId)) return;
        const release = readLibraryPolicyInput(releaseId);
        if (!release || release.kind !== "skill") throw new AgentSkillManagementError("NOT_FOUND");
        const grant = inventoryGrantFor(actor, releaseId);
        const decision = catalogPolicy.decide({ action: "SKILL_ASSIGN", actor: actor as any, release, ...(grant ? { grant } : {}) });
        if (!decision.allow || release.installationState !== "INSTALLED") throw new AgentSkillManagementError(decision.allow ? "INSTALLATION_REQUIRED" : decision.reasonCode);
        if (refs.length >= 64) throw new AgentSkillManagementError("INSPECTION_FAILED");
        visiting.add(releaseId);
        refs.push({ kind: "CATALOG", packageReleaseId: releaseId, name: release.name, version: release.version, digest: release.digest });
        for (const pin of release.manifest.dependencies) {
          const row = db.prepare<[string,string,string,string,string], { package_release_id: string; package_commit: string }>("SELECT package_release_id,package_commit FROM catalog_package_releases WHERE authority_source_id=? AND content_source_id=? AND name=? AND version=? AND digest=?").get(pin.catalogId,pin.sourceId,pin.name,pin.version,pin.digest);
          const expectedCommit = pin.revision.type === "exact" ? pin.revision.commit : release.packageCommit;
          if (!row || row.package_commit !== expectedCommit) throw new AgentSkillManagementError("IDENTITY_CONFLICT");
          visit(row.package_release_id);
        }
        visiting.delete(releaseId); visited.add(releaseId);
      };
      const roots = command.catalogSkills.map(skill => skill.packageReleaseId);
      if (command.kind === "TEMPLATE") {
        const root = readLibraryPolicyInput(command.packageReleaseId);
        if (!root || (root.kind !== "native-agent" && root.kind !== "wrapped-agent")) throw new AgentSkillManagementError("NOT_FOUND");
        for (const pin of root.manifest.dependencies) {
          const row = db.prepare<[string,string,string,string,string], { package_release_id: string; package_commit: string }>("SELECT package_release_id,package_commit FROM catalog_package_releases WHERE authority_source_id=? AND content_source_id=? AND name=? AND version=? AND digest=?").get(pin.catalogId,pin.sourceId,pin.name,pin.version,pin.digest);
          const expectedCommit = pin.revision.type === "exact" ? pin.revision.commit : root.packageCommit;
          if (!row || row.package_commit !== expectedCommit) throw new AgentSkillManagementError("IDENTITY_CONFLICT");
          roots.push(row.package_release_id);
        }
      }
      for (const releaseId of roots) visit(releaseId);
      return [...local, ...refs];
    },
    classifyBlockers(config, _refs, command) {
      const required = command.kind === "TEMPLATE" ? ((config.requirements as Array<{ name: string; required: boolean }> | undefined) ?? []).filter(requirement => requirement.required).map(requirement => requirement.name) : [];
      const bound = new Set(command.kind === "TEMPLATE" ? command.secretBindings.map(binding => binding.requirementName) : []);
      return { creationBlockers: [], startBlockers: required.filter(name => !bound.has(name)).map(name => ({ code: "REQUIREMENTS_UNSATISFIED", item: name })) };
    },
    recheckCreationPolicy(tx, command, actor) {
      if (command.kind === "TEMPLATE") {
        const release = readLibraryPolicyInput(command.packageReleaseId);
        const grant = inventoryGrantFor(actor, command.packageReleaseId);
        const decision = release ? catalogPolicy.decide({ action: "TEMPLATE_INSTANTIATE", actor: actor as any, release, ...(grant ? { grant } : {}) }) : { allow: false as const, reasonCode: "NOT_FOUND" as const };
        if (!release || !decision.allow || release.reviewState !== "APPROVED" || release.installationState !== "INSTALLED") throw new AgentSkillManagementError(decision.allow ? "NOT_FOUND" : decision.reasonCode);
      }
      const existing = tx.prepare<[string], { id: string }>("SELECT id FROM agents WHERE name=?").get(command.local.name);
      if (existing) throw new AgentSkillManagementError("FORBIDDEN");
      if (!tx.prepare<[string], { id: string }>("SELECT id FROM runner_nodes WHERE id=?").get(command.local.runnerId)) throw new AgentSkillManagementError("INVALID_REQUEST");
      const model = tx.prepare<[string], { id: string; enabled: number }>("SELECT id,enabled FROM models WHERE id=?").get(command.local.modelId);
      if (!model || model.enabled !== 1) throw new AgentSkillManagementError("INVALID_REQUEST");
      if (command.local.visibility === "PRIVATE" && actor.id.length === 0) throw new AgentSkillManagementError("FORBIDDEN");
    },
    writeAudit(tx, event) {
      insertEvent(event, { publish: false });
    },
    writeTemplateOriginAndRequirements(tx, agentId, command, _config, actor) {
      const release = readLibraryPolicyInput(command.packageReleaseId);
      if (!release || (release.kind !== "native-agent" && release.kind !== "wrapped-agent")) throw new AgentSkillManagementError("NOT_FOUND");
      const mode = release.manifest.kind === "wrapped-agent" ? "WRAPPED" : release.manifest.kind === "native-agent" ? release.manifest.native.mode : (() => { throw new AgentSkillManagementError("STATE_CONFLICT"); })();
      const grant = inventoryGrantFor(actor, command.packageReleaseId);
      const actorKind = actor.kind === "HUMAN_ADMIN" ? "ADMIN" : "GRANT";
      tx.prepare(`INSERT INTO agent_template_origins
        (agent_id,release_id,mode,consumed_by_kind,consumed_by_human_id,grant_id,authority_source_id,content_source_id,
         package_kind,package_name,package_version,catalog_commit,package_commit,package_path,package_digest,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(agentId, command.packageReleaseId, mode, actorKind, actor.id, grant?.grantId ?? null,
        release.authoritySourceId, release.contentSourceId, release.kind, release.name, release.version, release.catalogCommit,
        release.packageCommit, release.packagePath, release.digest, Date.now());
    },
    templateOptions: actor => {
      const templates: Array<Record<string, unknown>> = [];
      const secretReferences: Array<{ name: string; secretReferenceId: string }> = [];
      const seenSecrets = new Set<string>();
      const releaseIds = db.prepare<[], { package_release_id: string }>("SELECT package_release_id FROM catalog_package_releases WHERE kind IN ('native-agent','wrapped-agent') ORDER BY package_release_id").all();
      for (const row of releaseIds) {
        const release = readLibraryPolicyInput(row.package_release_id);
        if (!release || !libraryDecision(actor as AuthenticatedHuman, row.package_release_id).allow) continue;
        const grant = inventoryGrantFor(actor, row.package_release_id);
        const decision = catalogPolicy.decide({ action: "TEMPLATE_INSTANTIATE", actor: actor as any, release, ...(grant ? { grant } : {}) });
        if (!decision.allow) continue;
        const manifest = release.manifest;
        const nativeManifest = manifest.kind === "native-agent" ? manifest.native : undefined;
        const mode = manifest.kind === "wrapped-agent" ? "WRAPPED" : nativeManifest?.mode;
        if (!mode) continue;
        const closureRefs: Array<Record<string, unknown>> = [];
        const visited = new Set<string>();
        const visiting = new Set<string>();
        const addDependency = (pin: any, parentCommit: string) => {
          const dependency = db.prepare<[string, string, string, string, string], { package_release_id: string; name: string; version: string; digest: string; package_commit: string }>("SELECT package_release_id,name,version,digest,package_commit FROM catalog_package_releases WHERE authority_source_id=? AND content_source_id=? AND name=? AND version=? AND digest=?").get(pin.catalogId, pin.sourceId, pin.name, pin.version, pin.digest);
          const expectedCommit = pin.revision.type === "exact" ? pin.revision.commit : parentCommit;
          if (!dependency || dependency.package_commit !== expectedCommit || visiting.has(dependency.package_release_id)) throw new Error("template closure conflict");
          if (visited.has(dependency.package_release_id)) return;
          const child = readLibraryPolicyInput(dependency.package_release_id);
          if (!child || child.kind !== "skill" || child.installationState !== "INSTALLED") throw new Error("template closure unavailable");
          if (closureRefs.length >= 64) throw new Error("template closure overflow");
          visiting.add(dependency.package_release_id);
          closureRefs.push({ kind: "CATALOG", packageReleaseId: dependency.package_release_id, name: dependency.name, version: dependency.version, digest: dependency.digest });
          for (const childPin of child.manifest.dependencies) addDependency(childPin, child.packageCommit);
          visiting.delete(dependency.package_release_id); visited.add(dependency.package_release_id);
        };
        for (const pin of manifest.dependencies) addDependency(pin, release.packageCommit);
        const exactConfig = manifest.kind === "wrapped-agent"
          ? { mode, wrappedConfig: { ...manifest.wrapped, source: undefined }, dependencySkills: closureRefs }
          : { mode, systemInstructions: nativeManifest!.systemInstructions, soulContents: nativeManifest!.soulContents, runtime: nativeManifest!.runtime, skillPreloads: nativeManifest!.alwaysPreloadedSkills, dependencySkills: closureRefs };
        templates.push({ packageReleaseId: row.package_release_id, name: release.name, version: release.version, digest: release.digest,
          description: manifest.description, readiness: { state: "READY" }, mode, exactConfig, skillRefs: closureRefs,
          requirements: manifest.secrets.map(requirement => ({ name: requirement.name, required: requirement.required })) });
        if (provisioningSecretResolver) {
          const names = new Set(manifest.secrets.map(requirement => requirement.name));
          db.prepare<[string], { id: string; name: string }>("SELECT id,name FROM secrets WHERE scope_type='package' AND scope_id=? ORDER BY name,id").all(row.package_release_id).filter(secret => names.has(secret.name)).forEach(secret => {
            if (seenSecrets.has(secret.id)) return;
            seenSecrets.add(secret.id);
            try { secretReferences.push({ name: secret.name, secretReferenceId: provisioningSecretResolver!.issue(actor, secret.id) }); } catch { /* fixed bounded projection */ }
          });
        }
      }
      return {
        runners: db.prepare<[], { id: string }>("SELECT id FROM runner_nodes ORDER BY id").all().map(row => ({ id: row.id })),
        models: db.prepare<[], { id: string }>("SELECT id FROM models WHERE enabled=1 ORDER BY id").all().map(row => ({ id: row.id })),
        secretReferences, templates,
      };
    },
  });
  const unifiedSkillInventory = createUnifiedSkillInventory({
    listLocal() {
      return listSkills(SKILL_ROOT).map(skill => ({ name: skill.name, description: skill.description, localOrigin: "BUILT_IN" as const }));
    },
    projectLocal(item, actor) {
      return { ref: { kind: "LOCAL" as const, name: item.name, localOrigin: item.localOrigin ?? "WORKSPACE" as const }, description: item.description, readiness: { state: "READY" as const }, provenance: actor.kind === "HUMAN_ADMIN" ? "FULL_ADMIN" as const : "BOUNDED_HUMAN" as const, ...(actor.kind === "HUMAN_ADMIN" ? { adminProvenance: { kind: "LOCAL" as const } } : {}) };
    },
    listCatalogSkills(_actor) {
      const ids = db.prepare<[], { package_release_id: string }>("SELECT r.package_release_id FROM catalog_package_releases r WHERE r.kind='skill' ORDER BY r.name,r.version,r.package_release_id").all();
      return ids.flatMap(({ package_release_id }) => {
        const release = readLibraryPolicyInput(package_release_id);
        if (!release || release.kind !== "skill") return [];
        return [{ packageReleaseId: release.packageReleaseId, name: release.name, version: release.version, digest: release.digest,
          description: release.manifest.description, installed: release.installationState === "INSTALLED", release,
          adminProvenance: { kind: "CATALOG" as const, authoritySourceId: release.authoritySourceId, contentSourceId: release.contentSourceId,
            catalogCommit: release.catalogCommit, packageCommit: release.packageCommit, packagePath: release.packagePath,
            sourceReadiness: db.prepare<[string], { enabled: number; removed_at: number | null }>("SELECT enabled,removed_at FROM catalog_sources WHERE source_id=?").get(release.authoritySourceId)?.removed_at != null ? "REMOVED" : db.prepare<[string], { enabled: number }>("SELECT enabled FROM catalog_sources WHERE source_id=?").get(release.authoritySourceId)?.enabled === 1 ? "READY" : "UNAVAILABLE", reviewState: release.reviewState,
            installationState: release.installationState, apiActivation: { approvalState: release.apiActivation.approvalState, runtimeState: release.apiActivation.runtimeState },
            grantCount: db.prepare<[string], { count: number }>("SELECT count(*) AS count FROM catalog_grants WHERE release_id=? AND revoked_at IS NULL").get(release.packageReleaseId)?.count ?? 0,
            compatibility: release.manifest.compatibility,
            links: Object.fromEntries((["OVERVIEW", "CONTENTS", "SECURITY"] as const).map(tab => [tab.toLowerCase(), `/?screen=source-library&source=${encodeURIComponent(release.authoritySourceId)}&release=${encodeURIComponent(release.packageReleaseId)}&tab=${tab}`])) as { overview: string; contents: string; security: string } } }];
      });
    },
    projectCatalog(item, actor, agentId) {
      const assignment = agentId ? db.prepare<[string, string], { desired_state: "DISABLED" | "ENABLED"; effective_state: "DISABLED" | "ENABLED"; deployment_state: "STABLE" | "REQUESTED" | "DEPLOYING" | "FAILED"; removal_requested: number; preload: number; revision: number }>(
        "SELECT desired_state,effective_state,deployment_state,removal_requested,preload,revision FROM agent_skill_assignments WHERE agent_id=? AND release_id=?",
      ).get(agentId, item.packageReleaseId) : undefined;
      return {
        ref: { kind: "CATALOG" as const, packageReleaseId: item.packageReleaseId, name: item.name, version: item.version, digest: item.digest },
        description: item.description, version: item.version, readiness: item.readiness ?? { state: "BLOCKED" as const, blockers: [{ code: "SOURCE_UNAVAILABLE" as const }] },
        provenance: actor.kind === "HUMAN_ADMIN" ? "FULL_ADMIN" as const : "BOUNDED_HUMAN" as const,
        ...(actor.kind === "HUMAN_ADMIN" ? { adminProvenance: item.adminProvenance } : {}),
        ...(assignment && assignment.removal_requested !== 1 ? { assignment: { desired: assignment.desired_state, effective: assignment.effective_state, preload: assignment.preload === 1, deployment: assignment.deployment_state, revision: assignment.revision } } : {}),
      };
    },
    evaluateCatalog(item, actor, agentId): { visible: boolean; readiness: SkillReadiness } {
      const release = item.release;
      if (!release) return { visible: false, readiness: { state: "BLOCKED", blockers: [{ code: "SOURCE_UNAVAILABLE" }] } };
      const state = readCatalogPolicyRelease(item.packageReleaseId);
      if (!state) return { visible: false, readiness: { state: "BLOCKED", blockers: [{ code: "SOURCE_UNAVAILABLE" }] } };
      const agent = agentId ? inventoryAgentFor(agentId) : undefined;
      const grant = inventoryGrantFor(actor, item.packageReleaseId);
      const decision = catalogPolicy.decide({ action: agentId ? "SKILL_ASSIGN" : "LIBRARY_VIEW", actor: actor as any, release, ...(grant ? { grant } : {}), ...(agent ? { agent } : {}) });
      if (!decision.allow && !["INSTALLATION_REQUIRED", "API_ACTIVATION_REQUIRED"].includes(decision.reasonCode)) {
        return { visible: false, readiness: { state: "BLOCKED", blockers: [{ code: decision.reasonCode === "GRANT_REQUIRED" ? "GRANT_REQUIRED" : "SOURCE_UNAVAILABLE" }] } };
      }
      const blockers: Array<{ code: "GRANT_REQUIRED" | "INSTALLATION_REQUIRED" | "INCOMPATIBLE" | "SOURCE_UNAVAILABLE" | "RUNNER_REQUIRED" | "REQUIREMENT_MISSING" | "CONFLICT"; requirement?: string }> = [];
      if (!state.sourceEnabled || !state.externalSourceAllowed || release.reviewState !== "APPROVED") blockers.push({ code: "SOURCE_UNAVAILABLE" });
      if (release.installationState !== "INSTALLED") blockers.push({ code: "INSTALLATION_REQUIRED" });
      if (release.executionPreview.apiEventShapes.length > 0 && (release.apiActivation.approvalState !== "APPROVED" || release.apiActivation.runtimeState !== "ACTIVE")) blockers.push({ code: "REQUIREMENT_MISSING", requirement: "API_ACTIVATION" });
      if (!release.manifest.compatibility.platforms.includes(process.platform as "linux" | "darwin" | "win32")) blockers.push({ code: "INCOMPATIBLE", requirement: process.platform });
      return blockers.length > 0 ? { visible: true, readiness: { state: "BLOCKED", blockers } } : { visible: true, readiness: { state: "READY" } };
    },
    requireManageableAgent(agentId, actor) {
      const row = db.prepare<[string], { id: string; name: string; owner_human_id: string | null; assigned_runner_id: string | null; revision: number }>(
        "SELECT id,name,owner_human_id,assigned_runner_id,revision FROM agents WHERE id=?",
      ).get(agentId);
      if (!row) throw new Error("NOT_FOUND");
      const human = db.prepare<[string], { username: string; is_admin: number; must_change_password: number }>("SELECT username,is_admin,must_change_password FROM humans WHERE id=?").get(actor.id);
      if (!human || human.must_change_password !== 0 || !access.canManageAgent({ id: actor.id, username: human.username, mustChangePassword: false }, row.name)) throw new Error("NOT_FOUND");
      return { revision: row.revision };
    },
    policy: catalogPolicy,
    grantFor: inventoryGrantFor,
    agentFor: inventoryAgentFor,
    withReadSnapshot<T>(read: () => T): T {
      return db.transaction(read)();
    },
  });

  app.use("/api/*", async (c, next) => {
    if (/^\/api\/(?:catalog-sources|catalog-releases|library\/packages|runner-package-deployments)(?:\/|$)/.test(c.req.path)
      || /^\/api\/skills(?:\/|$)/.test(c.req.path)
      || /^\/api\/agents(?:$|\/[^/]+$)/.test(c.req.path)
      || /^\/api\/agents\/(?:provision|template-options)(?:\/|$)/.test(c.req.path)
      || /^\/api\/agents\/[^/]+\/(?:skills|start|start-readiness|stop|restart|reload-skills|cleanup-workspace)(?:\/|$)/.test(c.req.path)
      || /^\/api\/runners\/(?:register|[^/]+\/heartbeat|[^/]+\/package-deployments|[^/]+\/agents\/[^/]+\/start-requirements)$/.test(c.req.path)) {
      c.header("Cache-Control", "no-store");
    }
    await next();
  });

  registerCatalogSourceRoutes(app as any, {
    authority: catalogAuthority,
    installation: packageInstallation,
    apiExecution: activationCoordinator,
    rollout: catalogRollout,
    requireAuth,
    requireAdmin: createRequireAdmin(adminAccessDeps),
    resolveLibraryActor(principal) {
      if (!principal?.id || principal.runnerScope !== undefined) return undefined;
      const human = findAdminHuman.get(principal.id);
      if (!human || human.must_change_password !== 0) return undefined;
      return human.is_admin === 1
        ? { kind: "HUMAN_ADMIN", id: principal.id }
        : { kind: "AUTHENTICATED_HUMAN", id: principal.id };
    },
    library: catalogLibrary,
    provisioning: agentProvisioning,
    issueSecretReference: provisioningSecretResolver ? (actor, secretId) => provisioningSecretResolver!.issue(actor, secretId) : undefined,
    secretBinding,
    consumption: catalogConsumption,
    management: agentSkillManagement,
    resolveAgentId(name) {
      return db.prepare<[string], { id: string }>("SELECT id FROM agents WHERE name=?").get(name)?.id;
    },
  });

  registerAuthRoutes(app as any, {
    canManageCatalogs: (principal) => canManageCatalogs(principal, adminAccessDeps),
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
    canManageCatalogs: (principal) => canManageCatalogs(principal, adminAccessDeps),
    orm,
    jsonResponse,
    humanSchema: schema.humans,
    hashPassword,
  });

  registerAgentInviteRoutes(app as any, {
    orm,
    jsonResponse,
    access,
    inviteBaseUrl: RUNNER_API_URL,
  });

  registerModelsRoutes(app as any, { orm, jsonResponse, parseJson });

  registerAgentProvisioningRoutes(app as any, {
    requireAuth,
    provisioning: agentProvisioning,
    resolveActor(c) {
      const principal = c.get("user") as { id?: string; username?: string } | undefined;
      if (!principal?.id || principal.username === "runner") return undefined;
      const human = findAdminHuman.get(principal.id);
      if (!human || human.must_change_password !== 0) return undefined;
      return human.is_admin === 1 ? { kind: "HUMAN_ADMIN" as const, id: principal.id } : { kind: "AUTHENTICATED_HUMAN" as const, id: principal.id };
    },
  });

  registerAgentsRoutes(app as any, {
    orm,
    bus,
    PROJECT_ROOT,
    jsonResponse,
    parseStringArraySafe,
    getDefaultSoulPath,
    resolveWorkspacePath,
    insertEvent,
    access,
    projectEffectiveSkills(row) {
      return projectEffectiveAgentSkills(db, row);
    },
    catalogStartGate,
    updateLocalBatchInTransaction(tx, batch, actor) {
      return agentSkillManagement.updateLocalBatchInTransaction(tx, batch, actor);
    },
    resolveSkillActor(principal) {
      if (!principal?.id || principal.username === "runner") return undefined;
      const human = findAdminHuman.get(principal.id);
      if (!human || human.must_change_password !== 0) return undefined;
      return human.is_admin === 1 ? { kind: "HUMAN_ADMIN", id: principal.id } : { kind: "AUTHENTICATED_HUMAN", id: principal.id };
    },
    resolveStartActor(principal) {
      if (principal?.username === "runner") {
        const runnerId = principal.runnerScope?.allowedRunnerId;
        return runnerId ? { kind: "RUNNER" as const, runnerId } : undefined;
      }
      if (!principal?.id) return undefined;
      const human = findAdminHuman.get(principal.id);
      if (!human || human.must_change_password !== 0) return undefined;
      return human.is_admin === 1
        ? { kind: "HUMAN_ADMIN" as const, id: principal.id }
        : { kind: "AUTHENTICATED_HUMAN" as const, id: principal.id };
    },
  });

  registerCollabRoutes(app as any, { orm, jsonResponse, access });

  registerEventsRoutes(app as any, {
    orm,
    jsonResponse,
    eventRowToApi,
    insertEvent,
    publishEventRow: publishEvent,
    EventSchema,
    eventShapeProvider: {
      async getSnapshot() {
        await requireEventShapeStartup();
        return eventShapeRegistry.snapshot();
      },
    },
    validateEventAgainstShapes,
    serializeEventShapes,
    access,
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

  registerUnifiedSkillRoutes(app as any, {
    inventory: unifiedSkillInventory,
    requireAuth,
    actor(c) {
      const principal = c.get("user");
      if (!principal?.id || principal.username === "runner") throw new Error("FORBIDDEN");
      const human = findAdminHuman.get(principal.id);
      if (!human || human.must_change_password !== 0) throw new Error("FORBIDDEN");
      return human.is_admin === 1 ? { kind: "HUMAN_ADMIN", id: principal.id } : { kind: "AUTHENTICATED_HUMAN", id: principal.id };
    },
  });

  registerAgentSkillRoutes(app as any, {
    management: agentSkillManagement,
    requireAuth,
    preflight(agentId, selection, actor) { return agentSkillManagement.preflight(agentId, selection as any, actor); },
    actor(c) {
      const principal = c.get("user");
      if (!principal?.id || principal.username === "runner") throw new AgentSkillManagementError("FORBIDDEN");
      const human = findAdminHuman.get(principal.id);
      if (!human || human.must_change_password !== 0) throw new AgentSkillManagementError("FORBIDDEN");
      return human.is_admin === 1 ? { kind: "HUMAN_ADMIN", id: principal.id } : { kind: "AUTHENTICATED_HUMAN", id: principal.id };
    },
  });

  registerSkillsRoutes(app as any, { SKILL_ROOT, jsonResponse, listSkills });

  registerSecretsRoutes(app as any, {
    orm,
    jsonResponse,
    requireAuth,
    requireRunnerAuth,
    insertEvent,
    access,
  });

  registerWsRoutes(app as any, {
    bus,
    upgradeWebSocket,
    resolveRequestUser: (c: any) => {
      const runnerHeader = c.req.header("x-orgops-runner-token");
      const runnerUser = resolveRunnerUserFromToken(runnerHeader);
      if (runnerUser) return runnerUser;
      const cookie = c.req.header("cookie") ?? "";
      const match = cookie.match(/orgops_session=([^;]+)/);
      if (!match) return null;
      return sessions.get(match[1]) ?? null;
    },
    access,
  });

  registerRunnersRoutes(app as any, {
    orm,
    bus,
    jsonResponse,
    requireRunnerAuth,
    runnerToken: RUNNER_TOKEN,
    runnerApiUrl: RUNNER_API_URL,
    runnerArtifactDelivery,
    runnerStartGateDelivery,
  });

  registerIntegrationKeysRoutes(app as any, { orm, jsonResponse, access });
  registerEmbedRoutes(app as any, { orm, jsonResponse, insertEvent });

  return { app, db, bus, injectWebSocket, catalogAuthority, catalogPolicy };
}
