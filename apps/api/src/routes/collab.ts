import type { Hono } from "hono";
import { createHash, randomUUID } from "node:crypto";

import { schema, type OrgOpsDrizzleDb } from "@orgops/db";
import { and, asc, eq } from "drizzle-orm";

type CollabDeps = {
  orm: OrgOpsDrizzleDb;
  jsonResponse: (c: any, data: unknown, status?: number) => Response;
};

export function registerCollabRoutes(app: Hono<any>, deps: CollabDeps) {
  const { orm, jsonResponse } = deps;
  const DIRECT_CHANNEL_PARTICIPANT_TYPES = new Set(["HUMAN", "AGENT"]);
  const DIRECT_CHANNEL_KIND = {
    humanAgent: "HUMAN_AGENT_DM",
    agentAgent: "AGENT_AGENT_DM",
    group: "DIRECT_GROUP",
  } as const;

  function normalizeDirectParticipants(input: unknown) {
    if (!Array.isArray(input) || input.length < 2) return [];
    const unique = new Map<
      string,
      { subscriberType: string; subscriberId: string }
    >();
    for (const raw of input) {
      const subscriberType = String((raw as any)?.subscriberType ?? "")
        .trim()
        .toUpperCase();
      const subscriberId = String((raw as any)?.subscriberId ?? "").trim();
      if (
        !DIRECT_CHANNEL_PARTICIPANT_TYPES.has(subscriberType) ||
        !subscriberId
      )
        continue;
      unique.set(`${subscriberType}:${subscriberId}`, {
        subscriberType,
        subscriberId,
      });
    }
    return [...unique.values()].sort((left, right) =>
      `${left.subscriberType}:${left.subscriberId}`.localeCompare(
        `${right.subscriberType}:${right.subscriberId}`,
      ),
    );
  }

  function directChannelNameForParticipants(
    participants: Array<{ subscriberType: string; subscriberId: string }>,
  ) {
    const key = participants
      .map(
        (participant) =>
          `${participant.subscriberType}:${participant.subscriberId}`,
      )
      .join("|");
    const digest = createHash("sha256").update(key).digest("hex").slice(0, 12);
    return `direct-${digest}`;
  }

  function directParticipantKeyForParticipants(
    participants: Array<{ subscriberType: string; subscriberId: string }>,
  ) {
    return participants
      .map(
        (participant) =>
          `${participant.subscriberType}:${participant.subscriberId}`,
      )
      .join("|");
  }

  function inferDirectChannelKind(
    participants: Array<{ subscriberType: string; subscriberId: string }>,
  ) {
    const humanCount = participants.filter(
      (participant) => participant.subscriberType === "HUMAN",
    ).length;
    const agentCount = participants.filter(
      (participant) => participant.subscriberType === "AGENT",
    ).length;
    if (participants.length === 2 && humanCount === 1 && agentCount === 1) {
      return DIRECT_CHANNEL_KIND.humanAgent;
    }
    if (participants.length === 2 && humanCount === 0 && agentCount === 2) {
      return DIRECT_CHANNEL_KIND.agentAgent;
    }
    return DIRECT_CHANNEL_KIND.group;
  }

  function ensureDirectChannel(
    participants: Array<{ subscriberType: string; subscriberId: string }>,
    description?: string | null,
  ) {
    const directParticipantKey =
      directParticipantKeyForParticipants(participants);
    const kind = inferDirectChannelKind(participants);
    const existing = orm
      .select()
      .from(schema.channels)
      .where(eq(schema.channels.direct_participant_key, directParticipantKey))
      .get() as any;

    if (existing) {
      for (const participant of participants) {
        orm
          .insert(schema.channelSubscriptions)
          .values({
            channel_id: existing.id,
            subscriber_type: participant.subscriberType,
            subscriber_id: participant.subscriberId,
          })
          .onConflictDoNothing()
          .run();
      }
      return {
        id: existing.id,
        created: false,
        name: existing.name,
        kind: existing.kind,
      };
    }

    const id = randomUUID();
    const name = directChannelNameForParticipants(participants);
    orm
      .insert(schema.channels)
      .values({
        id,
        name,
        description: description ?? "Direct channel",
        kind,
        direct_participant_key: directParticipantKey,
        created_at: Date.now(),
      })
      .run();
    orm
      .insert(schema.channelSubscriptions)
      .values(
        participants.map((participant) => ({
          channel_id: id,
          subscriber_type: participant.subscriberType,
          subscriber_id: participant.subscriberId,
        })),
      )
      .onConflictDoNothing()
      .run();
    return { id, created: true, name, kind };
  }

  app.get("/api/teams", (c) => {
    const rows = orm.select().from(schema.teams).all() as any[];
    return jsonResponse(c, rows);
  });

  app.post("/api/teams", async (c) => {
    const body = await c.req.json();
    const id = randomUUID();
    orm
      .insert(schema.teams)
      .values({
        id,
        name: body.name,
        description: body.description ?? null,
        created_at: Date.now(),
      })
      .run();
    return jsonResponse(c, { id }, 201);
  });

  app.patch("/api/teams/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return jsonResponse(c, { error: "Name is required" }, 400);
    orm.update(schema.teams).set({ name }).where(eq(schema.teams.id, id)).run();
    return jsonResponse(c, { ok: true });
  });

  const deleteTeamHandler = (c: any) => {
    const id = c.req.param("id");
    orm
      .delete(schema.teamMemberships)
      .where(eq(schema.teamMemberships.team_id, id))
      .run();
    orm
      .delete(schema.channelSubscriptions)
      .where(
        and(
          eq(schema.channelSubscriptions.subscriber_type, "TEAM"),
          eq(schema.channelSubscriptions.subscriber_id, id),
        ),
      )
      .run();
    const existing = orm
      .select({ id: schema.teams.id })
      .from(schema.teams)
      .where(eq(schema.teams.id, id))
      .get();
    orm.delete(schema.teams).where(eq(schema.teams.id, id)).run();
    if (!existing) return jsonResponse(c, { error: "Not found" }, 404);
    return jsonResponse(c, { ok: true });
  };

  app.delete("/api/teams/:id", deleteTeamHandler);
  app.post("/api/teams/:id/delete", deleteTeamHandler);

  app.get("/api/teams/:id/members", (c) => {
    const id = c.req.param("id");
    const rows = orm
      .select({
        member_type: schema.teamMemberships.member_type,
        member_id: schema.teamMemberships.member_id,
      })
      .from(schema.teamMemberships)
      .where(eq(schema.teamMemberships.team_id, id))
      .orderBy(
        asc(schema.teamMemberships.member_type),
        asc(schema.teamMemberships.member_id),
      )
      .all() as { member_type: string; member_id: string }[];
    return jsonResponse(
      c,
      rows.map((row) => ({
        memberType: row.member_type,
        memberId: row.member_id,
      })),
    );
  });

  app.post("/api/teams/:id/members", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    orm
      .insert(schema.teamMemberships)
      .values({
        team_id: id,
        member_type: body.memberType,
        member_id: body.memberId,
      })
      .onConflictDoNothing()
      .run();
    return jsonResponse(c, { ok: true });
  });

  app.delete("/api/teams/:id/members/:memberType/:memberId", (c) => {
    const { id, memberType, memberId } = c.req.param();
    orm
      .delete(schema.teamMemberships)
      .where(
        and(
          eq(schema.teamMemberships.team_id, id),
          eq(schema.teamMemberships.member_type, memberType),
          eq(schema.teamMemberships.member_id, memberId),
        ),
      )
      .run();
    return jsonResponse(c, { ok: true });
  });

  app.get("/api/channels", (c) => {
    const rows = orm.select().from(schema.channels).all() as any[];
    const data = rows.map((channel) => {
      const participants = orm
        .select({
          subscriber_type: schema.channelSubscriptions.subscriber_type,
          subscriber_id: schema.channelSubscriptions.subscriber_id,
        })
        .from(schema.channelSubscriptions)
        .where(eq(schema.channelSubscriptions.channel_id, channel.id))
        .orderBy(
          asc(schema.channelSubscriptions.subscriber_type),
          asc(schema.channelSubscriptions.subscriber_id),
        )
        .all()
        .map((participant) => ({
          subscriberType: participant.subscriber_type,
          subscriberId: participant.subscriber_id,
        }));
      return {
        ...channel,
        kind: channel.kind ?? "GROUP",
        directParticipantKey: channel.direct_participant_key ?? undefined,
        participants,
      };
    });
    return jsonResponse(c, data);
  });

  app.post("/api/channels", async (c) => {
    const body = await c.req.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return jsonResponse(c, { error: "Name is required" }, 400);
    const id = randomUUID();
    orm
      .insert(schema.channels)
      .values({
        id,
        name,
        description: body.description ?? null,
        kind: "GROUP",
        direct_participant_key: null,
        created_at: Date.now(),
      })
      .run();
    return jsonResponse(c, { id }, 201);
  });

  app.post("/api/channels/direct", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const participants = normalizeDirectParticipants(body.participants);
    if (participants.length < 2) {
      return jsonResponse(
        c,
        { error: "At least two HUMAN/AGENT participants are required" },
        400,
      );
    }
    const user = c.get("user") as { username?: string } | undefined;
    if (user?.username && user.username !== "runner") {
      const mismatchedHuman = participants.find(
        (participant) =>
          participant.subscriberType === "HUMAN" &&
          participant.subscriberId !== user.username,
      );
      if (mismatchedHuman) {
        return jsonResponse(
          c,
          { error: "HUMAN participant must match authenticated user" },
          403,
        );
      }
    }
    const direct = ensureDirectChannel(participants, body.description);
    return jsonResponse(c, direct, direct.created ? 201 : 200);
  });

  app.post("/api/channels/direct/human-agent", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const user = c.get("user") as { username?: string } | undefined;
    const humanId = user?.username;
    const agentName =
      typeof body.agentName === "string" ? body.agentName.trim() : "";
    if (!humanId || humanId === "runner") {
      return jsonResponse(
        c,
        { error: "Authenticated human user required" },
        401,
      );
    }
    if (!agentName)
      return jsonResponse(c, { error: "agentName is required" }, 400);
    const direct = ensureDirectChannel(
      normalizeDirectParticipants([
        { subscriberType: "HUMAN", subscriberId: humanId },
        { subscriberType: "AGENT", subscriberId: agentName },
      ]),
      body.description ?? "Human-agent direct channel",
    );
    return jsonResponse(c, direct, direct.created ? 201 : 200);
  });

  app.post("/api/channels/direct/agent-agent", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const leftAgentName =
      typeof body.leftAgentName === "string" ? body.leftAgentName.trim() : "";
    const rightAgentName =
      typeof body.rightAgentName === "string" ? body.rightAgentName.trim() : "";
    if (!leftAgentName || !rightAgentName) {
      return jsonResponse(
        c,
        { error: "leftAgentName and rightAgentName are required" },
        400,
      );
    }
    if (leftAgentName === rightAgentName) {
      return jsonResponse(
        c,
        { error: "leftAgentName and rightAgentName must differ" },
        400,
      );
    }
    const direct = ensureDirectChannel(
      normalizeDirectParticipants([
        { subscriberType: "AGENT", subscriberId: leftAgentName },
        { subscriberType: "AGENT", subscriberId: rightAgentName },
      ]),
      body.description ?? "Agent-agent direct channel",
    );
    return jsonResponse(c, direct, direct.created ? 201 : 200);
  });

  app.patch("/api/channels/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    orm
      .update(schema.channels)
      .set({
        name: body.name,
        description: body.description ?? null,
      })
      .where(eq(schema.channels.id, id))
      .run();
    return jsonResponse(c, { ok: true });
  });

  const deleteChannelHandler = (c: any) => {
    const id = c.req.param("id");
    const existing = orm
      .select({ id: schema.channels.id })
      .from(schema.channels)
      .where(eq(schema.channels.id, id))
      .get();
    orm
      .delete(schema.channelSubscriptions)
      .where(eq(schema.channelSubscriptions.channel_id, id))
      .run();
    orm.delete(schema.channels).where(eq(schema.channels.id, id)).run();
    return jsonResponse(c, { ok: true, deleted: Boolean(existing) });
  };

  app.delete("/api/channels/:id", deleteChannelHandler);
  app.post("/api/channels/:id/delete", deleteChannelHandler);

  app.post("/api/channels/:id/subscribe", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    orm
      .insert(schema.channelSubscriptions)
      .values({
        channel_id: id,
        subscriber_type: body.subscriberType,
        subscriber_id: body.subscriberId,
      })
      .onConflictDoNothing()
      .run();
    return jsonResponse(c, { ok: true });
  });

  app.post("/api/channels/:id/unsubscribe", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    orm
      .delete(schema.channelSubscriptions)
      .where(
        and(
          eq(schema.channelSubscriptions.channel_id, id),
          eq(schema.channelSubscriptions.subscriber_type, body.subscriberType),
          eq(schema.channelSubscriptions.subscriber_id, body.subscriberId),
        ),
      )
      .run();
    return jsonResponse(c, { ok: true });
  });

  app.get("/api/channels/:id/participants", (c) => {
    const id = c.req.param("id");
    const rows = orm
      .select({
        subscriber_type: schema.channelSubscriptions.subscriber_type,
        subscriber_id: schema.channelSubscriptions.subscriber_id,
      })
      .from(schema.channelSubscriptions)
      .where(eq(schema.channelSubscriptions.channel_id, id))
      .orderBy(
        asc(schema.channelSubscriptions.subscriber_type),
        asc(schema.channelSubscriptions.subscriber_id),
      )
      .all() as { subscriber_type: string; subscriber_id: string }[];
    return jsonResponse(
      c,
      rows.map((row) => ({
        subscriberType: row.subscriber_type,
        subscriberId: row.subscriber_id,
      })),
    );
  });

  app.get("/api/conversations", (c) => {
    const rows = orm.select().from(schema.conversations).all() as any[];
    return jsonResponse(c, rows);
  });

  app.post("/api/conversations", async (c) => {
    const body = await c.req.json();
    const id = randomUUID();
    orm
      .insert(schema.conversations)
      .values({
        id,
        kind: body.kind,
        human_id: body.humanId,
        agent_name: body.agentName ?? null,
        channel_id: body.channelId ?? null,
        title: body.title ?? null,
        created_at: Date.now(),
      })
      .run();
    return jsonResponse(c, { id }, 201);
  });

  app.get("/api/conversations/:id/threads", (c) => {
    const id = c.req.param("id");
    const rows = orm
      .select()
      .from(schema.threads)
      .where(eq(schema.threads.conversation_id, id))
      .all() as any[];
    return jsonResponse(c, rows);
  });

  app.post("/api/conversations/:id/threads", async (c) => {
    const conversationId = c.req.param("id");
    const body = await c.req.json();
    const id = randomUUID();
    orm
      .insert(schema.threads)
      .values({
        id,
        conversation_id: conversationId,
        title: body.title ?? null,
        created_at: Date.now(),
      })
      .run();
    return jsonResponse(c, { id }, 201);
  });
}
