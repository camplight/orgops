import type { Hono } from "hono";
import { randomUUID } from "node:crypto";

import { decryptSecret, encryptSecret, parseMasterKey } from "@orgops/crypto";
import { schema, type OrgOpsDrizzleDb } from "@orgops/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { AccessControl, RequestUser } from "./access";

type SecretsDeps = {
  orm: OrgOpsDrizzleDb;
  jsonResponse: (c: any, data: unknown, status?: number) => Response;
  requireAuth: (c: any, next: any) => Response | Promise<Response | void> | void;
  requireRunnerAuth: (c: any, next: any) => Response | Promise<Response | void> | void;
  insertEvent: (input: any) => any;
  access: AccessControl;
};

const SCOPE_PUBLIC = "public";
const SCOPE_TEAM = "team";
const SCOPE_PRIVATE = "private";
const SCOPE_PACKAGE = "package";
const LEGACY_SCOPE_APP = "app";
const KNOWN_SCOPE_TYPES = new Set([
  SCOPE_PUBLIC,
  SCOPE_TEAM,
  SCOPE_PRIVATE,
  SCOPE_PACKAGE,
  LEGACY_SCOPE_APP,
]);
const SAFE_SCOPE_ID_PATTERN = /^[a-zA-Z0-9._-]+$/;
const ENV_SCOPE_TYPES = [
  SCOPE_PUBLIC,
  SCOPE_TEAM,
  SCOPE_PRIVATE,
  SCOPE_PACKAGE,
  LEGACY_SCOPE_APP,
] as const;

type SecretRow = {
  id: string;
  name: string;
  scope_type: string;
  scope_id: string | null;
  ciphertext_b64: string;
  created_at: number;
};

function isRunnerUser(user: RequestUser | undefined): boolean {
  return user?.username === "runner";
}

function isScopedRunner(user: RequestUser | undefined): boolean {
  return isRunnerUser(user) && user?.runnerScope?.mode === "SCOPED";
}

function isHumanUser(user: RequestUser | undefined): user is RequestUser & { username: string } {
  return Boolean(user?.username && user.username !== "runner");
}

function parseScopeId(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  const value = String(input).trim();
  return value ? value : null;
}

function normalizeScopeType(input: unknown): string | null {
  const normalized = String(input ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === LEGACY_SCOPE_APP) return SCOPE_PUBLIC;
  if (KNOWN_SCOPE_TYPES.has(normalized)) return normalized;
  return null;
}

function decryptRows(
  masterKey: Uint8Array,
  rows: Array<{ name: string; ciphertext_b64: string }>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const row of rows) {
    try {
      env[row.name] = decryptSecret(masterKey, row.ciphertext_b64);
    } catch {
      // Skip corrupted or wrong-key entries.
    }
  }
  return env;
}

export function registerSecretsRoutes(app: Hono<any>, deps: SecretsDeps) {
  const { orm, jsonResponse, requireAuth, requireRunnerAuth, insertEvent, access } = deps;

  function listHumanTeamIds(user: RequestUser | undefined): Set<string> {
    if (!isHumanUser(user)) return new Set();
    const rows = orm
      .select({ teamId: schema.teamMemberships.team_id })
      .from(schema.teamMemberships)
      .where(
        and(
          eq(schema.teamMemberships.member_type, "HUMAN"),
          eq(schema.teamMemberships.member_id, user.username),
        ),
      )
      .all();
    return new Set(rows.map((row) => row.teamId));
  }

  function listScopedRunnerTeamIds(user: RequestUser | undefined): Set<string> {
    if (!isScopedRunner(user)) return new Set();
    const allowedChannelIds = user.runnerScope?.allowedChannelIds ?? [];
    if (allowedChannelIds.length === 0) return new Set();
    const rows = orm
      .select({ teamId: schema.channelSubscriptions.subscriber_id })
      .from(schema.channelSubscriptions)
      .where(
        and(
          eq(schema.channelSubscriptions.subscriber_type, "TEAM"),
          inArray(schema.channelSubscriptions.channel_id, allowedChannelIds),
        ),
      )
      .all();
    return new Set(rows.map((row) => row.teamId));
  }

  function canReadSecretScope(
    user: RequestUser | undefined,
    scopeTypeRaw: string,
    scopeId: string | null,
  ): boolean {
    if (isRunnerUser(user) && user?.runnerScope?.mode === "GLOBAL") return true;
    const scopeType = normalizeScopeType(scopeTypeRaw) ?? scopeTypeRaw;
    if (isScopedRunner(user)) {
      const allowedAgent = user.runnerScope?.allowedAgentName ?? "";
      if (scopeType === SCOPE_PUBLIC || scopeType === SCOPE_PACKAGE) return true;
      if (scopeType === SCOPE_PRIVATE) return Boolean(scopeId && scopeId === allowedAgent);
      if (scopeType === SCOPE_TEAM) {
        if (!scopeId) return false;
        return listScopedRunnerTeamIds(user).has(scopeId);
      }
      return false;
    }
    if (!isHumanUser(user)) return false;
    if (scopeType === SCOPE_PUBLIC || scopeType === SCOPE_PACKAGE) return true;
    if (scopeType === SCOPE_TEAM) return Boolean(scopeId && listHumanTeamIds(user).has(scopeId));
    if (scopeType === SCOPE_PRIVATE) return Boolean(scopeId && access.canViewAgent(user, scopeId));
    return false;
  }

  function canWriteSecretScope(
    user: RequestUser | undefined,
    scopeTypeRaw: string,
    scopeId: string | null,
  ): boolean {
    if (isRunnerUser(user) && user?.runnerScope?.mode === "GLOBAL") return true;
    const scopeType = normalizeScopeType(scopeTypeRaw) ?? scopeTypeRaw;
    if (isScopedRunner(user)) {
      const allowedAgent = user.runnerScope?.allowedAgentName ?? "";
      if (scopeType === SCOPE_PRIVATE) return Boolean(scopeId && scopeId === allowedAgent);
      if (scopeType === SCOPE_TEAM) {
        if (!scopeId) return false;
        return listScopedRunnerTeamIds(user).has(scopeId);
      }
      return false;
    }
    if (!isHumanUser(user)) return false;
    if (scopeType === SCOPE_PUBLIC || scopeType === SCOPE_PACKAGE) return true;
    if (scopeType === SCOPE_TEAM) return Boolean(scopeId && listHumanTeamIds(user).has(scopeId));
    if (scopeType === SCOPE_PRIVATE) return Boolean(scopeId && access.canManageAgent(user, scopeId));
    return false;
  }

  function parseSecretInput(body: Record<string, unknown>) {
    const packageId = parseScopeId(body.package);
    const scopeTypeProvided = body.scopeType !== undefined && body.scopeType !== null;
    const explicitScopeType = normalizeScopeType(body.scopeType);
    if (scopeTypeProvided && !explicitScopeType) {
      return { ok: false as const, error: "Invalid scopeType. Use public, team, private, or package." };
    }
    const scopeType = explicitScopeType ?? (packageId ? SCOPE_PACKAGE : SCOPE_PUBLIC);
    const rawScopeId = parseScopeId(body.scopeId) ?? packageId;
    let scopeId: string | null = rawScopeId;
    if (scopeType === SCOPE_PUBLIC) {
      scopeId = null;
    } else if (!scopeId) {
      return {
        ok: false as const,
        error: "scopeId is required for private, team, and package secrets",
      };
    } else if (!SAFE_SCOPE_ID_PATTERN.test(scopeId)) {
      return { ok: false as const, error: "scopeId contains invalid characters" };
    }
    const name = String(body.key ?? body.name ?? "").trim();
    if (!name) return { ok: false as const, error: "Missing key or name" };
    return {
      ok: true as const,
      value: {
        name,
        scopeType,
        scopeId,
      },
    };
  }

  function listChannelTeamIds(channelId: string | undefined): string[] {
    if (!channelId) return [];
    const rows = orm
      .select({ teamId: schema.channelSubscriptions.subscriber_id })
      .from(schema.channelSubscriptions)
      .where(
        and(
          eq(schema.channelSubscriptions.channel_id, channelId),
          eq(schema.channelSubscriptions.subscriber_type, "TEAM"),
        ),
      )
      .all();
    return rows.map((row) => row.teamId);
  }

  app.get("/api/secrets", requireAuth, (c) => {
    const user = c.get("user") as RequestUser | undefined;
    const rows = orm
      .select({
        id: schema.secrets.id,
        name: schema.secrets.name,
        scope_type: schema.secrets.scope_type,
        scope_id: schema.secrets.scope_id,
        created_at: schema.secrets.created_at,
      })
      .from(schema.secrets)
      .all()
      .filter((row) => canReadSecretScope(user, row.scope_type, row.scope_id ?? null));
    return jsonResponse(c, rows);
  });

  app.get("/api/secrets/keys", requireAuth, (c) => {
    const packageFilter = c.req.query("package");
    const user = c.get("user") as RequestUser | undefined;
    let rows: { name: string; scope_id: string | null }[];
    if (packageFilter) {
      rows = orm
        .select({ name: schema.secrets.name, scope_id: schema.secrets.scope_id })
        .from(schema.secrets)
        .where(
          and(
            eq(schema.secrets.scope_type, SCOPE_PACKAGE),
            eq(schema.secrets.scope_id, packageFilter),
          ),
        )
        .all() as any[];
    } else {
      rows = orm
        .select({ name: schema.secrets.name, scope_id: schema.secrets.scope_id })
        .from(schema.secrets)
        .where(eq(schema.secrets.scope_type, SCOPE_PACKAGE))
        .all() as any[];
    }
    const keys = rows
      .filter((row) => canReadSecretScope(user, SCOPE_PACKAGE, row.scope_id ?? null))
      .map((row) => ({ package: row.scope_id ?? "", key: row.name }));
    return jsonResponse(c, { keys });
  });

  app.post("/api/secrets", requireAuth, async (c) => {
    const user = c.get("user") as RequestUser | undefined;
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const value = body.value;
    if (value === undefined) return jsonResponse(c, { error: "Missing value" }, 400);
    const parsedInput = parseSecretInput(body);
    if (!parsedInput.ok) return jsonResponse(c, { error: parsedInput.error }, 400);
    const { name, scopeType, scopeId } = parsedInput.value;
    if (!canWriteSecretScope(user, scopeType, scopeId)) {
      return jsonResponse(c, { error: "Forbidden" }, 403);
    }

    const masterKey = parseMasterKey(process.env.ORGOPS_MASTER_KEY ?? "");
    const ciphertext = encryptSecret(masterKey, String(value));
    const existing = orm
      .select({ id: schema.secrets.id })
      .from(schema.secrets)
      .where(
        and(
          eq(schema.secrets.name, name),
          eq(schema.secrets.scope_type, scopeType),
          scopeId === null ? isNull(schema.secrets.scope_id) : eq(schema.secrets.scope_id, scopeId),
        ),
      )
      .get() as { id: string } | undefined;
    const now = Date.now();
    if (existing) {
      orm
        .update(schema.secrets)
        .set({
          ciphertext_b64: ciphertext,
          created_at: now,
        })
        .where(eq(schema.secrets.id, existing.id))
        .run();
      insertEvent({
        type: "audit.secret.set",
        payload: { name, scopeType, scopeId, updated: true },
        source: "system",
      });
      return jsonResponse(c, { id: existing.id, ok: true }, 200);
    }

    const id = randomUUID();
    orm
      .insert(schema.secrets)
      .values({
        id,
        name,
        scope_type: scopeType,
        scope_id: scopeId,
        ciphertext_b64: ciphertext,
        created_at: now,
      })
      .run();
    insertEvent({
      type: "audit.secret.set",
      payload: { name, scopeType, scopeId, updated: false },
      source: "system",
    });
    return jsonResponse(c, { id }, 201);
  });

  app.delete("/api/secrets/:id", requireAuth, (c) => {
    const user = c.get("user") as RequestUser | undefined;
    const id = c.req.param("id");
    const existing = orm
      .select({
        id: schema.secrets.id,
        name: schema.secrets.name,
        scope_type: schema.secrets.scope_type,
        scope_id: schema.secrets.scope_id,
      })
      .from(schema.secrets)
      .where(eq(schema.secrets.id, id))
      .get() as { id: string; name: string; scope_type: string; scope_id: string | null } | undefined;
    if (!existing) return jsonResponse(c, { error: "Not found" }, 404);
    if (!canWriteSecretScope(user, existing.scope_type, existing.scope_id ?? null)) {
      return jsonResponse(c, { error: "Forbidden" }, 403);
    }
    orm.delete(schema.secrets).where(eq(schema.secrets.id, id)).run();
    insertEvent({
      type: "audit.secret.deleted",
      payload: {
        name: existing.name,
        scopeType: normalizeScopeType(existing.scope_type) ?? existing.scope_type,
        scopeId: existing.scope_id ?? null,
      },
      source: "system",
      status: "DELIVERED",
    });
    return jsonResponse(c, { ok: true });
  });

  app.delete("/api/secrets", requireAuth, async (c) => {
    const user = c.get("user") as RequestUser | undefined;
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const parsedInput = parseSecretInput(body);
    if (!parsedInput.ok) return jsonResponse(c, { error: parsedInput.error }, 400);
    const { name, scopeType, scopeId } = parsedInput.value;
    if (!canWriteSecretScope(user, scopeType, scopeId)) {
      return jsonResponse(c, { error: "Forbidden" }, 403);
    }
    const existing = orm
      .select({ id: schema.secrets.id })
      .from(schema.secrets)
      .where(
        and(
          eq(schema.secrets.name, name),
          eq(schema.secrets.scope_type, scopeType),
          scopeId === null ? isNull(schema.secrets.scope_id) : eq(schema.secrets.scope_id, scopeId),
        ),
      )
      .get();
    if (!existing) return jsonResponse(c, { error: "Not found" }, 404);

    orm
      .delete(schema.secrets)
      .where(
        and(
          eq(schema.secrets.name, name),
          eq(schema.secrets.scope_type, scopeType),
          scopeId === null ? isNull(schema.secrets.scope_id) : eq(schema.secrets.scope_id, scopeId),
        ),
      )
      .run();
    insertEvent({
      type: "audit.secret.deleted",
      payload: { name, scopeType, scopeId },
      source: "system",
      status: "DELIVERED",
    });
    return jsonResponse(c, { ok: true });
  });

  app.get("/api/secrets/env", requireRunnerAuth, async (c) => {
    const masterKey = parseMasterKey(process.env.ORGOPS_MASTER_KEY ?? "");
    const requestedByAgent = (c.req.header("x-orgops-agent-name") ?? "").trim();
    const requestedChannelId = (c.req.header("x-orgops-channel-id") ?? "").trim();
    const user = c.get("user") as RequestUser | undefined;

    if (!requestedByAgent || !SAFE_SCOPE_ID_PATTERN.test(requestedByAgent)) {
      return jsonResponse(c, { error: "x-orgops-agent-name is required" }, 400);
    }
    if (!access.canManageAgent(user, requestedByAgent)) {
      return jsonResponse(c, { error: "Forbidden" }, 403);
    }

    const channelId =
      requestedChannelId && SAFE_SCOPE_ID_PATTERN.test(requestedChannelId)
        ? requestedChannelId
        : undefined;
    if (channelId && !access.canPostToChannel(user, channelId)) {
      return jsonResponse(c, { error: "Forbidden" }, 403);
    }

    const channelTeamIds = listChannelTeamIds(channelId);
    const rows = orm
      .select({
        id: schema.secrets.id,
        name: schema.secrets.name,
        scope_type: schema.secrets.scope_type,
        scope_id: schema.secrets.scope_id,
        ciphertext_b64: schema.secrets.ciphertext_b64,
        created_at: schema.secrets.created_at,
      })
      .from(schema.secrets)
      .where(inArray(schema.secrets.scope_type, ENV_SCOPE_TYPES))
      .all() as SecretRow[];

    const packageRows = rows.filter((row) => row.scope_type === SCOPE_PACKAGE);
    const publicRows = rows.filter(
      (row) => row.scope_type === SCOPE_PUBLIC || row.scope_type === LEGACY_SCOPE_APP,
    );
    const teamRows = rows.filter(
      (row) =>
        row.scope_type === SCOPE_TEAM &&
        row.scope_id !== null &&
        channelTeamIds.includes(row.scope_id),
    );
    const privateRows = rows.filter(
      (row) => row.scope_type === SCOPE_PRIVATE && row.scope_id === requestedByAgent,
    );

    // Lowest to highest precedence; later scopes override key collisions.
    const env = {
      ...decryptRows(masterKey, packageRows),
      ...decryptRows(masterKey, publicRows),
      ...decryptRows(masterKey, teamRows),
      ...decryptRows(masterKey, privateRows),
    };

    insertEvent({
      type: "audit.secret.accessed",
      channelId,
      payload: {
        scopeType: "resolved",
        count: Object.keys(env).length,
        names: Object.keys(env).sort(),
        requestedByAgent,
        channelTeamIds,
        appliedScopeCounts: {
          package: packageRows.length,
          public: publicRows.length,
          team: teamRows.length,
          private: privateRows.length,
        },
      },
      source: `agent:${requestedByAgent}`,
      status: "DELIVERED",
    });
    return jsonResponse(c, env);
  });
}
