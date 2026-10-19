import type { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import {
  CHANNEL_KINDS,
  CHANNEL_VISIBILITY,
  isChannelVisibility,
  schema,
} from "@orgops/db";
import type { AccessControl, RequestUser } from "./access";

type HumansDeps = {
  orm: any;
  jsonResponse: (c: any, data: unknown, status?: number) => Response;
  humanSchema: any;
  hashPassword: (password: string) => string;
  access: AccessControl;
};

function generateTemporaryPassword() {
  return `tmp-${Math.random().toString(36).slice(2, 8)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function registerHumansRoutes(app: Hono<any>, deps: HumansDeps) {
  const { orm, jsonResponse, humanSchema, hashPassword, access } = deps;

  function isHumanUser(user: RequestUser | undefined): user is RequestUser & {
    id: string;
    username: string;
  } {
    return Boolean(user?.id && user?.username && user.username !== "runner");
  }

  function normalizeAgentParticipants(input: unknown): string[] {
    if (!Array.isArray(input)) return [];
    const unique = new Set<string>();
    for (const raw of input) {
      if (typeof raw !== "string") continue;
      const value = raw.trim();
      if (value) unique.add(value);
    }
    return [...unique];
  }

  function agentExists(agentName: string) {
    const row = orm
      .select({ id: schema.agents.id })
      .from(schema.agents)
      .where(eq(schema.agents.name, agentName))
      .get();
    return Boolean(row);
  }

  app.get("/api/humans", (c) => {
    const rows = orm
      .select({
        id: humanSchema.id,
        username: humanSchema.username,
        must_change_password: humanSchema.must_change_password,
        created_at: humanSchema.created_at,
        updated_at: humanSchema.updated_at
      })
      .from(humanSchema)
      .orderBy(asc(humanSchema.username))
      .all() as Array<{
      id: string;
      username: string;
      must_change_password: number;
      created_at: number;
      updated_at: number;
    }>;

    return jsonResponse(
      c,
      rows.map((row) => ({
        id: row.id,
        username: row.username,
        mustChangePassword: Boolean(row.must_change_password),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    );
  });

  app.post("/api/humans/invite", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const suppliedTempPassword =
      typeof body.tempPassword === "string" ? body.tempPassword.trim() : "";
    const channelId =
      typeof body.channelId === "string" ? body.channelId.trim() : "";
    const channelName =
      typeof body.channelName === "string" ? body.channelName.trim() : "";
    const channelDescription =
      typeof body.channelDescription === "string"
        ? body.channelDescription
        : null;
    const channelVisibilityRaw =
      typeof body.channelVisibility === "string"
        ? body.channelVisibility.trim().toUpperCase()
        : "";
    const channelVisibility = isChannelVisibility(channelVisibilityRaw)
      ? channelVisibilityRaw
      : CHANNEL_VISIBILITY.PRIVATE;
    const agentParticipants = normalizeAgentParticipants(body.agentParticipants);
    if (!username) return jsonResponse(c, { error: "username is required" }, 400);
    if (channelId && channelName) {
      return jsonResponse(c, { error: "Provide channelId or channelName, not both" }, 400);
    }
    const tempPassword = suppliedTempPassword || generateTemporaryPassword();
    if (tempPassword.length < 8) {
      return jsonResponse(c, { error: "Temporary password must be at least 8 characters" }, 400);
    }

    const existing = orm
      .select({ id: humanSchema.id })
      .from(humanSchema)
      .where(eq(humanSchema.username, username))
      .get();
    if (existing) return jsonResponse(c, { error: "Username already exists" }, 409);

    const actor = c.get("user") as RequestUser | undefined;
    const shouldAttachChannel = Boolean(channelId || channelName);
    if (shouldAttachChannel && !isHumanUser(actor)) {
      return jsonResponse(c, { error: "Authenticated human user required for channel invites" }, 401);
    }

    let landingChannel:
      | { id: string; name: string; created: boolean }
      | null = null;
    if (channelId) {
      const channel = orm
        .select({ id: schema.channels.id, name: schema.channels.name })
        .from(schema.channels)
        .where(eq(schema.channels.id, channelId))
        .get() as { id: string; name: string } | undefined;
      if (!channel) return jsonResponse(c, { error: "Channel not found" }, 404);
      if (!access.canManageChannel(actor, channelId)) {
        return jsonResponse(c, { error: "Forbidden" }, 403);
      }
      landingChannel = { id: channel.id, name: channel.name, created: false };
    } else if (channelName) {
      for (const agentName of agentParticipants) {
        if (!agentExists(agentName)) {
          return jsonResponse(c, { error: `AGENT not found: ${agentName}` }, 404);
        }
        if (!access.canViewAgent(actor, agentName)) {
          return jsonResponse(c, { error: `AGENT not found: ${agentName}` }, 404);
        }
      }
      landingChannel = { id: randomUUID(), name: channelName, created: true };
    } else if (agentParticipants.length > 0) {
      return jsonResponse(
        c,
        { error: "agentParticipants require channelName for new-channel invites" },
        400,
      );
    }

    const now = Date.now();
    const id = randomUUID();
    orm.transaction((tx: any) => {
      tx.insert(humanSchema)
        .values({
          id,
          username,
          password_hash: hashPassword(tempPassword),
          must_change_password: 1,
          created_at: now,
          updated_at: now,
          invited_by_human_id: actor?.id ?? null
        })
        .run();

      if (!landingChannel) return;
      if (landingChannel.created && isHumanUser(actor)) {
        tx.insert(schema.channels)
          .values({
            id: landingChannel.id,
            name: landingChannel.name,
            description: channelDescription,
            metadata_json: null,
            visibility: channelVisibility,
            owner_human_id:
              channelVisibility === CHANNEL_VISIBILITY.PRIVATE ? actor.id : null,
            kind: CHANNEL_KINDS.GROUP,
            direct_participant_key: null,
            created_at: now,
            archived_at: null,
          })
          .run();
        tx.insert(schema.channelSubscriptions)
          .values([
            {
              channel_id: landingChannel.id,
              subscriber_type: "HUMAN",
              subscriber_id: actor.username,
            },
            ...agentParticipants.map((agentName) => ({
              channel_id: landingChannel.id,
              subscriber_type: "AGENT",
              subscriber_id: agentName,
            })),
          ])
          .onConflictDoNothing()
          .run();
      }

      tx.insert(schema.channelSubscriptions)
        .values({
          channel_id: landingChannel.id,
          subscriber_type: "HUMAN",
          subscriber_id: username,
        })
        .onConflictDoNothing()
        .run();
    });

    return jsonResponse(
      c,
      {
        id,
        username,
        mustChangePassword: true,
        temporaryPassword: tempPassword,
        channel: landingChannel
          ? {
              id: landingChannel.id,
              name: landingChannel.name,
              created: landingChannel.created,
            }
          : undefined,
      },
      201
    );
  });

  app.post("/api/humans/:id/reset-temp-password", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const suppliedTempPassword =
      typeof body.tempPassword === "string" ? body.tempPassword.trim() : "";
    const tempPassword = suppliedTempPassword || generateTemporaryPassword();
    if (tempPassword.length < 8) {
      return jsonResponse(c, { error: "Temporary password must be at least 8 characters" }, 400);
    }

    const existing = orm
      .select({
        id: humanSchema.id,
        username: humanSchema.username
      })
      .from(humanSchema)
      .where(eq(humanSchema.id, id))
      .get() as { id: string; username: string } | undefined;
    if (!existing) return jsonResponse(c, { error: "Human not found" }, 404);

    const now = Date.now();
    orm
      .update(humanSchema)
      .set({
        password_hash: hashPassword(tempPassword),
        must_change_password: 1,
        updated_at: now
      })
      .where(eq(humanSchema.id, id))
      .run();

    return jsonResponse(c, {
      id: existing.id,
      username: existing.username,
      mustChangePassword: true,
      temporaryPassword: tempPassword
    });
  });
}
