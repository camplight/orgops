import type { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  AGENT_VISIBILITY,
  type AgentVisibility,
  schema,
  type OrgOpsDrizzleDb,
} from "@orgops/db";
import type { AccessControl, RequestUser } from "./access";
import {
  findActiveInviteByToken,
  generateAgentInviteToken,
  generateRunnerScopedToken,
  parseStringArraySafe,
  type AgentInviteRow,
} from "../agent-invite-auth";

type AgentInvitesDeps = {
  orm: OrgOpsDrizzleDb;
  jsonResponse: (c: any, data: unknown, status?: number) => Response;
  access: AccessControl;
  inviteBaseUrlFallback: string;
};

function isHumanUser(user: RequestUser | undefined): user is RequestUser & {
  id: string;
  username: string;
} {
  return Boolean(user?.id && user?.username && user.username !== "runner");
}

function isRunnerUser(
  user: RequestUser | undefined,
): user is RequestUser & {
  username: "runner";
  runnerScope?: { mode?: "GLOBAL" | "SCOPED"; allowedAgentName?: string };
} {
  return user?.username === "runner";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseWrappedConfigInput(
  value: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: {} };
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { ok: true, value: parsed as Record<string, unknown> };
      }
      return { ok: false, error: "wrappedConfig must be a JSON object" };
    } catch {
      return {
        ok: false,
        error: "wrappedConfig must be valid JSON when provided as string",
      };
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return { ok: true, value: value as Record<string, unknown> };
  }
  return { ok: false, error: "wrappedConfig must be an object" };
}

function parseChannelIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeAgentVisibility(value: unknown): AgentVisibility {
  return value === AGENT_VISIBILITY.PRIVATE
    ? AGENT_VISIBILITY.PRIVATE
    : AGENT_VISIBILITY.PUBLIC;
}

function compactTimestampForName(at = Date.now()): string {
  const iso = new Date(at).toISOString();
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function defaultInviteName(agentName: string, at = Date.now()): string {
  return `${agentName}-${compactTimestampForName(at)}`;
}

function resolveInviteBaseUrl(c: any, fallback: string): string {
  const forwardedProto = c.req.header("x-forwarded-proto");
  const forwardedHost = c.req.header("x-forwarded-host");
  if (forwardedHost) {
    const host = forwardedHost.split(",")[0]?.trim();
    if (!host) return fallback.replace(/\/+$/, "");
    const proto = forwardedProto && forwardedProto.trim() ? forwardedProto.trim() : "https";
    return `${proto}://${host.replace(/\/+$/, "")}`;
  }
  try {
    const reqUrl = new URL(c.req.url);
    if (reqUrl.host) return `${reqUrl.protocol}//${reqUrl.host}`;
  } catch {
    // fall through to fallback
  }
  return fallback.replace(/\/+$/, "");
}

function resolveInviteCreator(
  user: RequestUser | undefined,
  body: Record<string, unknown>,
  access: AccessControl,
  agentName: string,
):
  | { ok: true; type: "HUMAN" | "AGENT"; id: string; humanId: string | null }
  | { ok: false; error: string; status: number } {
  if (isHumanUser(user)) {
    return {
      ok: true,
      type: "HUMAN",
      id: user.username,
      humanId: user.id,
    };
  }
  if (!isRunnerUser(user)) {
    return { ok: false, error: "Authentication required", status: 401 };
  }
  const scopedAgent = user?.runnerScope?.allowedAgentName;
  if (scopedAgent) {
    if (scopedAgent !== agentName) {
      return { ok: false, error: "Scoped runner can only create invites for its own agent", status: 403 };
    }
    return { ok: true, type: "AGENT", id: scopedAgent, humanId: null };
  }
  const explicit = typeof body.createdByAgentName === "string" ? body.createdByAgentName.trim() : "";
  if (!explicit) {
    return {
      ok: false,
      error: "createdByAgentName is required for global runner tokens",
      status: 400,
    };
  }
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(explicit)) {
    return {
      ok: false,
      error: "createdByAgentName must match ^[a-zA-Z0-9._-]{1,80}$.",
      status: 400,
    };
  }
  if (!access.canManageAgent(user, explicit)) {
    return { ok: false, error: "Forbidden creator agent", status: 403 };
  }
  return { ok: true, type: "AGENT", id: explicit, humanId: null };
}

function canManageInvite(
  user: RequestUser | undefined,
  row: AgentInviteRow,
  access: AccessControl,
): boolean {
  if (isHumanUser(user) && row.created_by_human_id && row.created_by_human_id === user.id) {
    return true;
  }
  return access.canManageAgent(user, row.agent_name);
}

function toInviteApi(
  row: AgentInviteRow,
  inviteBaseUrl: string,
  fullToken?: string,
) {
  const base = inviteBaseUrl.replace(/\/+$/, "");
  const channelIds = parseStringArraySafe(row.channel_ids_json);
  return {
    id: row.id,
    name: row.name,
    agentName: row.agent_name,
    visibility: normalizeAgentVisibility(row.agent_visibility),
    tokenPrefix: row.token_prefix,
    channelIds,
    maxUses: row.max_uses,
    useCount: row.use_count,
    createdByType: row.created_by_type === "AGENT" ? "AGENT" : "HUMAN",
    createdById: row.created_by_id ?? row.created_by_human_id ?? undefined,
    createdByHumanId: row.created_by_human_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    lastRedeemedAt: row.last_redeemed_at,
    inviteLink: fullToken
      ? `${base}/api/agent-invites/public/${encodeURIComponent(fullToken)}`
      : undefined,
  };
}

export function registerAgentInviteRoutes(app: Hono<any>, deps: AgentInvitesDeps) {
  const { orm, jsonResponse, access, inviteBaseUrlFallback } = deps;

  app.get("/api/agent-invites", (c) => {
    const user = c.get("user") as RequestUser | undefined;
    if (!isHumanUser(user) && !isRunnerUser(user)) {
      return jsonResponse(c, { error: "Authentication required" }, 403);
    }
    const inviteBaseUrl = resolveInviteBaseUrl(c, inviteBaseUrlFallback);
    const scopedAgentName =
      isRunnerUser(user) && user.runnerScope?.mode === "SCOPED"
        ? user.runnerScope.allowedAgentName
        : undefined;
    const query = orm.select().from(schema.agentInvites);
    const rows = (scopedAgentName
      ? query.where(eq(schema.agentInvites.agent_name, scopedAgentName)).orderBy(desc(schema.agentInvites.created_at)).all()
      : query.orderBy(desc(schema.agentInvites.created_at)).all()) as AgentInviteRow[];
    return jsonResponse(c, rows.map((row) => toInviteApi(row, inviteBaseUrl)));
  });

  app.post("/api/agent-invites", async (c) => {
    const user = c.get("user") as RequestUser | undefined;
    if (!isHumanUser(user) && !isRunnerUser(user)) {
      return jsonResponse(c, { error: "Authentication required" }, 403);
    }
    const inviteBaseUrl = resolveInviteBaseUrl(c, inviteBaseUrlFallback);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const now = Date.now();
    const agentName = typeof body.agentName === "string" ? body.agentName.trim() : "";
    const inputName = typeof body.name === "string" ? body.name.trim() : "";
    const name = inputName || defaultInviteName(agentName, now);
    const visibility = normalizeAgentVisibility(body.visibility);
    const channelIds = [...new Set(parseChannelIds(body.channelIds))];
    const maxUsesRaw = Number(body.maxUses ?? 1);
    const maxUses =
      Number.isFinite(maxUsesRaw) && maxUsesRaw > 0 ? Math.floor(maxUsesRaw) : 1;
    const expiresAtRaw = Number(body.expiresAt);
    const expiresAt =
      Number.isFinite(expiresAtRaw) && expiresAtRaw > Date.now()
        ? Math.floor(expiresAtRaw)
        : null;
    const wrappedConfigParsed = parseWrappedConfigInput(body.wrappedConfig);
    if (!wrappedConfigParsed.ok) {
      return jsonResponse(c, { error: wrappedConfigParsed.error }, 400);
    }
    if (!name) return jsonResponse(c, { error: "name is required" }, 400);
    if (!/^[a-zA-Z0-9._-]{1,80}$/.test(agentName)) {
      return jsonResponse(
        c,
        {
          error:
            "agentName is required and must match ^[a-zA-Z0-9._-]{1,80}$.",
        },
        400,
      );
    }
    const creator = resolveInviteCreator(user, body, access, agentName);
    if (!creator.ok) {
      return jsonResponse(c, { error: creator.error }, creator.status);
    }
    const existingAgent = orm
      .select({
        name: schema.agents.name,
      })
      .from(schema.agents)
      .where(eq(schema.agents.name, agentName))
      .get() as { name: string } | undefined;
    if (existingAgent) {
      if (!access.canManageAgent(user, agentName)) {
        return jsonResponse(c, { error: "Forbidden" }, 403);
      }
      return jsonResponse(
        c,
        { error: `Agent "${agentName}" already exists. Use a new agent name.` },
        409,
      );
    }
    const existingInviteRows = orm
      .select()
      .from(schema.agentInvites)
      .where(eq(schema.agentInvites.agent_name, agentName))
      .all() as AgentInviteRow[];
    const activeInvite = existingInviteRows.find((row) => {
      if (row.revoked_at !== null) return false;
      if (row.expires_at !== null && row.expires_at <= now) return false;
      return row.use_count < row.max_uses;
    });
    if (activeInvite) {
      return jsonResponse(
        c,
        {
          error: `An active invite already exists for agent "${agentName}". Reissue or revoke it instead.`,
          inviteId: activeInvite.id,
        },
        409,
      );
    }
    const channels = orm
      .select({ id: schema.channels.id })
      .from(schema.channels)
      .where(inArray(schema.channels.id, channelIds))
      .all() as Array<{ id: string }>;
    if (channels.length !== channelIds.length) {
      return jsonResponse(c, { error: "One or more channelIds were not found" }, 404);
    }
    for (const channelId of channelIds) {
      if (!access.canManageChannel(user, channelId)) {
        return jsonResponse(
          c,
          { error: `Forbidden channel access: ${channelId}` },
          403,
        );
      }
    }
    const generated = generateAgentInviteToken();
    const id = randomUUID();
    orm
      .insert(schema.agentInvites)
      .values({
        id,
        name,
        agent_name: agentName,
        agent_visibility: visibility,
        token_hash: generated.hash,
        token_prefix: generated.prefix,
        channel_ids_json: JSON.stringify(channelIds),
        wrapped_config_json: JSON.stringify(wrappedConfigParsed.value),
        max_uses: maxUses,
        use_count: 0,
        created_by_type: creator.type,
        created_by_id: creator.id,
        created_by_human_id: creator.humanId,
        created_at: now,
        expires_at: expiresAt,
        revoked_at: null,
        last_redeemed_at: null,
      })
      .run();
    const row = orm
      .select()
      .from(schema.agentInvites)
      .where(eq(schema.agentInvites.id, id))
      .get() as AgentInviteRow | undefined;
    if (!row) return jsonResponse(c, { error: "Failed to create invite" }, 500);
    return jsonResponse(c, toInviteApi(row, inviteBaseUrl, generated.token), 201);
  });

  app.post("/api/agent-invites/:id/revoke", (c) => {
    const user = c.get("user") as RequestUser | undefined;
    if (!isHumanUser(user) && !isRunnerUser(user)) {
      return jsonResponse(c, { error: "Authentication required" }, 403);
    }
    const inviteBaseUrl = resolveInviteBaseUrl(c, inviteBaseUrlFallback);
    const id = c.req.param("id");
    const row = orm
      .select()
      .from(schema.agentInvites)
      .where(eq(schema.agentInvites.id, id))
      .get() as AgentInviteRow | undefined;
    if (!row) return jsonResponse(c, { error: "Invite not found" }, 404);
    if (!canManageInvite(user, row, access)) {
      return jsonResponse(c, { error: "Forbidden" }, 403);
    }
    orm
      .update(schema.agentInvites)
      .set({ revoked_at: Date.now() })
      .where(eq(schema.agentInvites.id, id))
      .run();
    const updated = orm
      .select()
      .from(schema.agentInvites)
      .where(eq(schema.agentInvites.id, id))
      .get() as AgentInviteRow | undefined;
    return jsonResponse(c, toInviteApi(updated ?? row, inviteBaseUrl));
  });

  app.post("/api/agent-invites/:id/reissue", (c) => {
    const user = c.get("user") as RequestUser | undefined;
    if (!isHumanUser(user) && !isRunnerUser(user)) {
      return jsonResponse(c, { error: "Authentication required" }, 403);
    }
    const inviteBaseUrl = resolveInviteBaseUrl(c, inviteBaseUrlFallback);
    const id = c.req.param("id");
    const row = orm
      .select()
      .from(schema.agentInvites)
      .where(eq(schema.agentInvites.id, id))
      .get() as AgentInviteRow | undefined;
    if (!row) return jsonResponse(c, { error: "Invite not found" }, 404);
    if (!canManageInvite(user, row, access)) {
      return jsonResponse(c, { error: "Forbidden" }, 403);
    }

    const generated = generateAgentInviteToken();
    orm
      .update(schema.agentInvites)
      .set({
        token_hash: generated.hash,
        token_prefix: generated.prefix,
        use_count: 0,
        last_redeemed_at: null,
        revoked_at: null,
      })
      .where(eq(schema.agentInvites.id, id))
      .run();

    const updated = orm
      .select()
      .from(schema.agentInvites)
      .where(eq(schema.agentInvites.id, id))
      .get() as AgentInviteRow | undefined;
    if (!updated) return jsonResponse(c, { error: "Failed to reissue invite" }, 500);
    return jsonResponse(c, toInviteApi(updated, inviteBaseUrl, generated.token));
  });

  app.get("/api/agent-invites/public/:token", (c) => {
    const token = c.req.param("token");
    const invite = findActiveInviteByToken(orm, token);
    if (!invite) return jsonResponse(c, { error: "Invite is invalid or expired" }, 404);
    return jsonResponse(c, {
      ok: true,
      invite: {
        name: invite.name,
        agentName: invite.agent_name,
        visibility: normalizeAgentVisibility(invite.agent_visibility),
        channelIds: parseStringArraySafe(invite.channel_ids_json),
        expiresAt: invite.expires_at,
      },
      bootstrap: {
        wrappedConfigRequiredBeforeRunning: true,
        wrappedConfigPatchEndpoint: `/api/agents/${encodeURIComponent(invite.agent_name)}`,
        wrappedConfigSchema: {
          required: ["runtime.command"],
          optional: [
            "kind",
            "harness",
            "runtime.parse",
            "runtime.timeoutMs",
            "setup.*",
            "source.*",
            "sidecars[]",
            "secrets.allowedKeys",
            "secrets.deniedKeys",
            "session.scope",
          ],
        },
        memoryHint:
          "For CLIs that support sessions, keep a per-channel session map keyed by ORGOPS_WRAPPED_CHANNEL_ID.",
        docs: {
          wrappedInviteGuide:
            "https://github.com/camplight/orgops/blob/main/docs/WRAPPED_AGENT_INVITES.md",
        },
      },
      redeemEndpoint: `/api/agent-invites/public/${encodeURIComponent(token)}/redeem`,
    });
  });

  app.post("/api/agent-invites/public/:token/redeem", async (c) => {
    const token = c.req.param("token");
    const invite = findActiveInviteByToken(orm, token);
    if (!invite) return jsonResponse(c, { error: "Invite is invalid or expired" }, 404);
    const inviteBaseUrl = resolveInviteBaseUrl(c, inviteBaseUrlFallback);

    const now = Date.now();
    const channelIds = parseStringArraySafe(invite.channel_ids_json);
    const lifecycleName = `agent.lifecycle.${invite.agent_name}`;
    let lifecycleChannelId = "";
    const existingLifecycle = orm
      .select({ id: schema.channels.id })
      .from(schema.channels)
      .where(eq(schema.channels.name, lifecycleName))
      .get() as { id: string } | undefined;
    if (existingLifecycle?.id) {
      lifecycleChannelId = existingLifecycle.id;
    } else {
      lifecycleChannelId = randomUUID();
      orm
        .insert(schema.channels)
        .values({
          id: lifecycleChannelId,
          name: lifecycleName,
          description: `Lifecycle bootstrap channel for ${invite.agent_name}`,
          metadata_json: null,
          visibility: "PUBLIC",
          owner_human_id: null,
          kind: "GROUP",
          direct_participant_key: null,
          created_at: now,
          archived_at: null,
        })
        .run();
    }
    const allowedChannelIds = [...new Set([...channelIds, lifecycleChannelId])];
    const runnerId = randomUUID();
    const generatedRunnerToken = generateRunnerScopedToken();
    const runnerTokenId = randomUUID();

    orm
      .insert(schema.runnerTokens)
      .values({
        id: runnerTokenId,
        name: `invite:${invite.name}`,
        token_hash: generatedRunnerToken.hash,
        token_prefix: generatedRunnerToken.prefix,
        allowed_agent_name: invite.agent_name,
        allowed_runner_id: runnerId,
        allowed_channel_ids_json: JSON.stringify(allowedChannelIds),
        invite_id: invite.id,
        created_by_human_id: invite.created_by_human_id,
        created_at: now,
        expires_at: invite.expires_at,
        last_used_at: null,
        revoked_at: null,
      })
      .run();

    const existingAgent = orm
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.name, invite.agent_name))
      .get() as any | undefined;
    const wrappedConfig = asRecord(
      (() => {
        try {
          return JSON.parse(invite.wrapped_config_json);
        } catch {
          return {};
        }
      })(),
    );

    if (!existingAgent) {
      orm
        .insert(schema.agents)
        .values({
          id: randomUUID(),
          name: invite.agent_name,
          icon: null,
          description: `Joined via invite: ${invite.name}`,
          model_id: "wrapped:none",
          system_instructions: "",
          soul_path: `.orgops-data/souls/${invite.agent_name}.md`,
          soul_contents: "",
          workspace_path: `.orgops-data/workspaces/${invite.agent_name}`,
          allow_outside_workspace: 0,
          llm_call_timeout_ms: null,
          classic_max_model_steps: null,
          context_session_gap_ms: null,
          emit_audit_events: 1,
          memory_context_mode: "OFF",
          mode: "WRAPPED",
          visibility: normalizeAgentVisibility(invite.agent_visibility),
          owner_human_id: null,
          desired_state: "STOPPED",
          runtime_state: "STOPPED",
          assigned_runner_id: runnerId,
          last_heartbeat_at: null,
          created_at: now,
          updated_at: now,
          enabled_skills_json: "[]",
          always_preloaded_skills_json: "[]",
          wrapped_config_json: JSON.stringify(wrappedConfig),
        })
        .run();
    } else {
      orm
        .update(schema.agents)
        .set({
          mode: "WRAPPED",
          model_id: "wrapped:none",
          memory_context_mode: "OFF",
          visibility: normalizeAgentVisibility(invite.agent_visibility),
          wrapped_config_json: JSON.stringify(wrappedConfig),
          assigned_runner_id: runnerId,
          desired_state: existingAgent.desired_state ?? "STOPPED",
          updated_at: now,
        })
        .where(eq(schema.agents.name, invite.agent_name))
        .run();
    }

    for (const channelId of channelIds) {
      orm
        .insert(schema.channelSubscriptions)
        .values({
          channel_id: channelId,
          subscriber_type: "AGENT",
          subscriber_id: invite.agent_name,
        })
        .onConflictDoNothing()
        .run();
    }
    orm
      .insert(schema.channelSubscriptions)
      .values({
        channel_id: lifecycleChannelId,
        subscriber_type: "AGENT",
        subscriber_id: invite.agent_name,
      })
      .onConflictDoNothing()
      .run();

    orm
      .update(schema.agentInvites)
      .set({
        use_count: invite.use_count + 1,
        last_redeemed_at: now,
      })
      .where(
        and(
          eq(schema.agentInvites.id, invite.id),
          isNull(schema.agentInvites.revoked_at),
        ),
      )
      .run();

    const channels = channelIds.length
      ? (orm
          .select({ id: schema.channels.id, name: schema.channels.name })
          .from(schema.channels)
          .where(inArray(schema.channels.id, channelIds))
          .all() as Array<{ id: string; name: string }>)
      : [];

    return jsonResponse(c, {
      ok: true,
      invite: {
        id: invite.id,
        name: invite.name,
        agentName: invite.agent_name,
        visibility: normalizeAgentVisibility(invite.agent_visibility),
      },
      runner: {
        token: generatedRunnerToken.token,
        runnerId,
      },
      channels,
      agent: {
        name: invite.agent_name,
        mode: "WRAPPED",
        visibility: normalizeAgentVisibility(invite.agent_visibility),
        assignedRunnerId: runnerId,
      },
      endpoints: {
        apiBaseUrl: inviteBaseUrl,
        registerRunner: "/api/runners/register",
        heartbeat: `/api/runners/${encodeURIComponent(runnerId)}/heartbeat`,
        patchAgent: `/api/agents/${encodeURIComponent(invite.agent_name)}`,
      },
      bootstrap: {
        wrappedConfigRequiredBeforeRunning: true,
        wrappedConfigPatchEndpoint: `/api/agents/${encodeURIComponent(invite.agent_name)}`,
        wrappedConfigSchema: {
          required: ["runtime.command"],
          optional: [
            "kind",
            "harness",
            "runtime.parse",
            "runtime.timeoutMs",
            "setup.*",
            "source.*",
            "sidecars[]",
            "secrets.allowedKeys",
            "secrets.deniedKeys",
            "session.scope",
          ],
        },
        memoryHint:
          "For CLIs that support sessions, keep a per-channel session map keyed by ORGOPS_WRAPPED_CHANNEL_ID.",
      },
      docs: {
        setupGuideUrl:
          "https://github.com/camplight/orgops/blob/main/docs/WRAPPED_AGENT_INVITES.md",
      },
    });
  });
}
