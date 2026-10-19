import type { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { CHANNEL_KINDS, CHANNEL_VISIBILITY, schema, type OrgOpsDrizzleDb } from "@orgops/db";
import { eq } from "drizzle-orm";

type FederationDeps = {
  orm: OrgOpsDrizzleDb;
  jsonResponse: (c: any, data: unknown, status?: number) => Response;
  requireAuth: (c: any, next: any) => Response | Promise<Response>;
};

const FEDERATION_ROLES = new Set(["LOCAL_HOME", "REMOTE_PROJECTION"]);

function parseJsonRecordSafe(input: string | null | undefined): Record<string, unknown> {
  if (!input) return {};
  try {
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function trimString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBaseUrl(value: unknown) {
  return trimString(value).replace(/\/+$/, "");
}

export function registerFederationRoutes(app: Hono<any>, deps: FederationDeps) {
  const { orm, jsonResponse, requireAuth } = deps;

  app.get("/api/federation/instances", requireAuth, (c) => {
    const rows = orm.select().from(schema.federationInstances).all() as any[];
    return jsonResponse(
      c,
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        baseUrl: row.base_url,
        status: row.status,
        metadata: parseJsonRecordSafe(row.metadata_json),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastSeenAt: row.last_seen_at ?? null,
      })),
    );
  });

  app.post("/api/federation/instances", requireAuth, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const name = trimString((body as Record<string, unknown>).name);
    const baseUrl = normalizeBaseUrl((body as Record<string, unknown>).baseUrl);
    if (!name) return jsonResponse(c, { error: "name is required" }, 400);
    if (!baseUrl) return jsonResponse(c, { error: "baseUrl is required" }, 400);
    const now = Date.now();
    const id = randomUUID();
    orm
      .insert(schema.federationInstances)
      .values({
        id,
        name,
        base_url: baseUrl,
        status: "ACTIVE",
        metadata_json: JSON.stringify((body as Record<string, unknown>).metadata ?? {}),
        created_at: now,
        updated_at: now,
        last_seen_at: null,
      })
      .run();
    return jsonResponse(c, { ok: true, id, name, baseUrl }, 201);
  });

  app.get("/api/federation/channels", requireAuth, (c) => {
    const links = orm.select().from(schema.federationChannels).all() as any[];
    const channels = orm.select().from(schema.channels).all() as any[];
    const channelsById = new Map(channels.map((channel) => [channel.id, channel]));
    return jsonResponse(
      c,
      links.map((link) => {
        const channel = channelsById.get(link.local_channel_id);
        return {
          localChannelId: link.local_channel_id,
          localChannelName: channel?.name ?? null,
          homeInstanceId: link.home_instance_id ?? null,
          remoteChannelId: link.remote_channel_id ?? null,
          role: link.role,
          syncCursor: link.sync_cursor ?? null,
          metadata: parseJsonRecordSafe(link.metadata_json),
          createdAt: link.created_at,
          updatedAt: link.updated_at,
        };
      }),
    );
  });

  app.post("/api/federation/channels", requireAuth, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const role = trimString((body as Record<string, unknown>).role).toUpperCase() || "REMOTE_PROJECTION";
    if (!FEDERATION_ROLES.has(role)) {
      return jsonResponse(c, { error: "role must be LOCAL_HOME or REMOTE_PROJECTION" }, 400);
    }
    const homeInstanceId = trimString((body as Record<string, unknown>).homeInstanceId);
    const remoteChannelId = trimString((body as Record<string, unknown>).remoteChannelId);
    const localChannelIdInput = trimString((body as Record<string, unknown>).localChannelId);
    let localChannelId = localChannelIdInput;
    if (role === "REMOTE_PROJECTION" && (!homeInstanceId || !remoteChannelId)) {
      return jsonResponse(
        c,
        { error: "REMOTE_PROJECTION requires homeInstanceId and remoteChannelId" },
        400,
      );
    }

    const existingInstance = homeInstanceId
      ? orm
          .select({ id: schema.federationInstances.id })
          .from(schema.federationInstances)
          .where(eq(schema.federationInstances.id, homeInstanceId))
          .get()
      : null;
    if (homeInstanceId && !existingInstance) {
      return jsonResponse(c, { error: "homeInstanceId does not reference a known instance" }, 400);
    }

    const now = Date.now();
    if (!localChannelId) {
      const localName =
        trimString((body as Record<string, unknown>).localName) ||
        `federated-${remoteChannelId || randomUUID().slice(0, 8)}`;
      localChannelId = randomUUID();
      orm
        .insert(schema.channels)
        .values({
          id: localChannelId,
          name: localName,
          description:
            trimString((body as Record<string, unknown>).description) ||
            "Federated channel projection",
          metadata_json: JSON.stringify({
            federation: {
              role,
              homeInstanceId: homeInstanceId || null,
              remoteChannelId: remoteChannelId || null,
            },
          }),
          visibility: CHANNEL_VISIBILITY.PUBLIC,
          owner_human_id: null,
          kind: CHANNEL_KINDS.GROUP,
          direct_participant_key: null,
          created_at: now,
          archived_at: null,
        })
        .run();
    } else {
      const existingChannel = orm
        .select({ id: schema.channels.id })
        .from(schema.channels)
        .where(eq(schema.channels.id, localChannelId))
        .get();
      if (!existingChannel) return jsonResponse(c, { error: "localChannelId not found" }, 404);
    }

    orm
      .insert(schema.federationChannels)
      .values({
        local_channel_id: localChannelId,
        home_instance_id: homeInstanceId || null,
        remote_channel_id: remoteChannelId || null,
        role,
        sync_cursor: null,
        metadata_json: JSON.stringify((body as Record<string, unknown>).metadata ?? {}),
        created_at: now,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: schema.federationChannels.local_channel_id,
        set: {
          home_instance_id: homeInstanceId || null,
          remote_channel_id: remoteChannelId || null,
          role,
          metadata_json: JSON.stringify((body as Record<string, unknown>).metadata ?? {}),
          updated_at: now,
        },
      })
      .run();

    return jsonResponse(
      c,
      { ok: true, localChannelId, homeInstanceId: homeInstanceId || null, remoteChannelId: remoteChannelId || null, role },
      201,
    );
  });
}
