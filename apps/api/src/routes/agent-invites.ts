import type { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { schema, type OrgOpsDrizzleDb } from "@orgops/db";
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
  inviteBaseUrl: string;
};

function isHumanUser(user: RequestUser | undefined): user is RequestUser & {
  id: string;
  username: string;
} {
  return Boolean(user?.id && user?.username && user.username !== "runner");
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
    tokenPrefix: row.token_prefix,
    channelIds,
    maxUses: row.max_uses,
    useCount: row.use_count,
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
  const { orm, jsonResponse, access, inviteBaseUrl } = deps;

  app.get("/api/agent-invites", (c) => {
    const user = c.get("user") as RequestUser | undefined;
    if (!isHumanUser(user)) {
      return jsonResponse(c, { error: "Human authentication required" }, 403);
    }
    const rows = orm
      .select()
      .from(schema.agentInvites)
      .orderBy(desc(schema.agentInvites.created_at))
      .all() as AgentInviteRow[];
    return jsonResponse(c, rows.map((row) => toInviteApi(row, inviteBaseUrl)));
  });

  app.post("/api/agent-invites", async (c) => {
    const user = c.get("user") as RequestUser | undefined;
    if (!isHumanUser(user)) {
      return jsonResponse(c, { error: "Human authentication required" }, 403);
    }
    const body = await c.req.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const agentName = typeof body.agentName === "string" ? body.agentName.trim() : "";
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
    if (channelIds.length === 0) {
      return jsonResponse(c, { error: "channelIds must include at least one channel" }, 400);
    }
    const existingAgent = orm
      .select({
        name: schema.agents.name,
      })
      .from(schema.agents)
      .where(eq(schema.agents.name, agentName))
      .get() as { name: string } | undefined;
    if (existingAgent && !access.canManageAgent(user, agentName)) {
      return jsonResponse(c, { error: "Forbidden" }, 403);
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
    const now = Date.now();
    const id = randomUUID();
    orm
      .insert(schema.agentInvites)
      .values({
        id,
        name,
        agent_name: agentName,
        token_hash: generated.hash,
        token_prefix: generated.prefix,
        channel_ids_json: JSON.stringify(channelIds),
        wrapped_config_json: JSON.stringify(wrappedConfigParsed.value),
        max_uses: maxUses,
        use_count: 0,
        created_by_human_id: user.id,
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
    if (!isHumanUser(user)) {
      return jsonResponse(c, { error: "Human authentication required" }, 403);
    }
    const id = c.req.param("id");
    const row = orm
      .select()
      .from(schema.agentInvites)
      .where(eq(schema.agentInvites.id, id))
      .get() as AgentInviteRow | undefined;
    if (!row) return jsonResponse(c, { error: "Invite not found" }, 404);
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
    if (!isHumanUser(user)) {
      return jsonResponse(c, { error: "Human authentication required" }, 403);
    }
    const id = c.req.param("id");
    const row = orm
      .select()
      .from(schema.agentInvites)
      .where(eq(schema.agentInvites.id, id))
      .get() as AgentInviteRow | undefined;
    if (!row) return jsonResponse(c, { error: "Invite not found" }, 404);

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
          visibility: "PUBLIC",
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
      },
      runner: {
        token: generatedRunnerToken.token,
        runnerId,
      },
      channels,
      agent: {
        name: invite.agent_name,
        mode: "WRAPPED",
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
