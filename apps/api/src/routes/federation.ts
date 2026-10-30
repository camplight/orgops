import type { Hono } from "hono";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { CHANNEL_KINDS, CHANNEL_VISIBILITY, schema, type OrgOpsDrizzleDb } from "@orgops/db";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { AgentTransferBundle, createAgentTransfer } from "../agent-transfer";
import type {AccessControl} from './access';
import {federationFetch,federationUrl} from '../federation-transport';

type AgentTransfer = ReturnType<typeof createAgentTransfer>;

type FederationDeps = {
  access:AccessControl;
  workspaceRoot:string;
  orm: OrgOpsDrizzleDb;
  jsonResponse: (c: any, data: unknown, status?: number) => Response;
  requireAuth: (c: any, next: any) => Response | Promise<Response>;
  insertEvent: (input: any) => any;
  eventRowToApi: (row: any) => any;
  agentTransfer: AgentTransfer;
};

const FEDERATION_ROLES = new Set(["LOCAL_HOME", "REMOTE_PROJECTION"]);
const DEFAULT_FEDERATION_SYNC_INTERVAL_MS = 15_000;
const FEDERATION_PARTICIPANT_TYPES = new Set(["AGENT", "HUMAN", "TEAM"]);
const MAX_EVENT_PAYLOAD_JSON_CHARS = 262_144;

function compactEventRowSelectFields() {
  const blobCharLength = sql<number | null>`(SELECT ${schema.eventPayloadBlobs.char_length} FROM ${schema.eventPayloadBlobs} WHERE ${schema.eventPayloadBlobs.event_id} = ${schema.events.id})`;
  const blobByteLength = sql<number | null>`(SELECT ${schema.eventPayloadBlobs.byte_length} FROM ${schema.eventPayloadBlobs} WHERE ${schema.eventPayloadBlobs.event_id} = ${schema.events.id})`;
  const blobSha256 = sql<string | null>`(SELECT ${schema.eventPayloadBlobs.sha256} FROM ${schema.eventPayloadBlobs} WHERE ${schema.eventPayloadBlobs.event_id} = ${schema.events.id})`;
  const blobStoragePath = sql<string | null>`(SELECT ${schema.eventPayloadBlobs.storage_path} FROM ${schema.eventPayloadBlobs} WHERE ${schema.eventPayloadBlobs.event_id} = ${schema.events.id})`;
  return {
    id: schema.events.id,
    type: schema.events.type,
    payload_json: sql<string | null>`CASE WHEN length(${schema.events.payload_json}) > ${MAX_EVENT_PAYLOAD_JSON_CHARS} THEN NULL ELSE ${schema.events.payload_json} END`,
    payload_json_chars: sql<number>`COALESCE(${blobCharLength}, length(${schema.events.payload_json}))`,
    payload_blob_storage_path: blobStoragePath,
    payload_blob_byte_length: blobByteLength,
    payload_blob_sha256: blobSha256,
    source: schema.events.source,
    channel_id: schema.events.channel_id,
    parent_event_id: schema.events.parent_event_id,
    deliver_at: schema.events.deliver_at,
    status: schema.events.status,
    fail_count: schema.events.fail_count,
    last_error: schema.events.last_error,
    idempotency_key: schema.events.idempotency_key,
    created_at: schema.events.created_at,
  };
}

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

function normalizeFederationParticipants(input: unknown) {
  const values = Array.isArray(input) ? input : [];
  const unique = new Map<string, { subscriberType: string; subscriberId: string }>();
  for (const value of values) {
    const item = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    const subscriberType = trimString(item.subscriberType).toUpperCase();
    const subscriberId = trimString(item.subscriberId);
    if (!FEDERATION_PARTICIPANT_TYPES.has(subscriberType) || !subscriberId) continue;
    unique.set(`${subscriberType}:${subscriberId}`, { subscriberType, subscriberId });
  }
  return [...unique.values()].sort((left, right) =>
    `${left.subscriberType}:${left.subscriberId}`.localeCompare(
      `${right.subscriberType}:${right.subscriberId}`,
    ),
  );
}

function normalizeBaseUrl(value: unknown) {
  try{return federationUrl(trimString(value),true).origin;}catch{return '';}
}

function requestOrigin(c: any) {
  const forwardedProto = trimString(c.req.header("x-forwarded-proto")).split(",")[0];
  const forwardedHost = trimString(c.req.header("x-forwarded-host")).split(",")[0];
  if (forwardedProto && forwardedHost) return `${forwardedProto}://${forwardedHost}`.replace(/\/+$/, "");
  const url = new URL(c.req.url);
  return `${url.protocol}//${url.host}`.replace(/\/+$/, "");
}

function generateFederationToken() {
  return `ofed_${randomBytes(32).toString("base64url")}`;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function timingSafeStringEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  if (leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}

function bearerToken(c: any) {
  const header = c.req.header("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function remoteEventIdempotencyKey(instanceId: string, remoteEventId: string) {
  return `federation:${instanceId}:${remoteEventId}`;
}

export function registerFederationRoutes(app: Hono<any>, deps: FederationDeps) {
  const { orm, jsonResponse, requireAuth, insertEvent, eventRowToApi, agentTransfer } = deps;
  app.use('/api/federation/*',async(c,next)=>{
    if(/^\/api\/federation\/(?:channels\/[^/]+\/(?:events|participants|subscribers)|projections\/[^/]+\/events|agents\/[^/]+\/transfer|agents\/transfer)$/.test(c.req.path))return next();
    return requireAuth(c,()=>deps.access.canManageInstance(c.get('user'))?next():jsonResponse(c,{error:'Instance owner required'},403));
  });
  function peerAllows(peer:any,key:string,value:string):boolean{
    const metadata=parseJsonRecordSafe(peer.metadata_json);
    if(key==='allowedChannelIds'&&metadata.joinChannelId===value)return true;
    return Array.isArray(metadata[key])&&(metadata[key] as unknown[]).includes(value);
  }

  function resolveFederationPeer(c: any) {
    const token = bearerToken(c);
    if (!token) return null;
    const tokenHash = hashToken(token);
    const rows = orm.select().from(schema.federationInstances).all() as any[];
    return (
      rows.find((row) => {
        const stored = typeof row.inbound_token_hash === "string" ? row.inbound_token_hash : "";
        return row.status === "ACTIVE" && stored && timingSafeStringEqual(stored, tokenHash);
      }) ?? null
    );
  }

  function requireFederationPeer(c: any): { response: Response } | { peer: any } {
    const peer = resolveFederationPeer(c);
    if (!peer) return { response: jsonResponse(c, { error: "Federation token required" }, 401) };
    orm
      .update(schema.federationInstances)
      .set({ last_seen_at: Date.now() })
      .where(eq(schema.federationInstances.id, peer.id))
      .run();
    return { peer };
  }

  async function fetchPeer(instance: any, path: string, init?: RequestInit) {
    const token = typeof instance.outbound_token === "string" ? instance.outbound_token.trim() : "";
    if (!token) throw new Error(`Federation peer "${instance.name}" has no outbound token.`);
    const baseUrl = String(instance.base_url ?? "").replace(/\/+$/, "");
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${token}`);
    if (init?.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    const response = await federationFetch(`${baseUrl}${path}`, { ...init, headers });
    if (!response.ok) {
      throw new Error(`Federation request failed: ${response.status}`);
    }
    return response;
  }

  function insertProjectedEvent(input: {
    homeInstanceId: string;
    localChannelId: string;
    remoteEventId: string;
    type: string;
    source: string;
    payload?: unknown;
    parentEventId?: string;
    deliverAt?: number;
  }) {
    const idempotencyKey = remoteEventIdempotencyKey(input.homeInstanceId, input.remoteEventId);
    const existing = orm
      .select(compactEventRowSelectFields())
      .from(schema.events)
      .where(eq(schema.events.idempotency_key, idempotencyKey))
      .get() as any;
    if (existing) return { row: existing, inserted: false };
    const row = insertEvent({
      type: input.type,
      source: input.source,
      payload: input.payload ?? {},
      channelId: input.localChannelId,
      parentEventId: input.parentEventId,
      deliverAt: input.deliverAt,
      idempotencyKey,
    });
    return { row, inserted: true };
  }

  async function syncProjectionLink(link: any) {
    const localChannelId = link.local_channel_id as string;
    const instance = orm
      .select()
      .from(schema.federationInstances)
      .where(eq(schema.federationInstances.id, link.home_instance_id ?? ""))
      .get() as any;
    if (!instance) throw new Error("Home instance not found");
    const batchLimit = 500;
    const maxBatches = 20;
    let cursor = link.sync_cursor ? Number(link.sync_cursor) : 0;
    let fetched = 0;
    let inserted = 0;
    let nextCursor = String(cursor || 0);
    const participantCount = await syncProjectionParticipants(link, instance);
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const response = await fetchPeer(
        instance,
        `/api/federation/channels/${encodeURIComponent(
          link.remote_channel_id,
        )}/events?after=${encodeURIComponent(String(cursor || 0))}&limit=${batchLimit}`,
      );
      const payload = (await response.json()) as {
        events?: Array<{
          id: string;
          type: string;
          source: string;
          payload?: unknown;
          parentEventId?: string;
          deliverAt?: number;
          createdAt?: number;
        }>;
        nextCursor?: number | null;
      };
      const events = Array.isArray(payload.events) ? payload.events : [];
      fetched += events.length;
      for (const event of events) {
        const remoteEventId = trimString(event.id);
        if (!remoteEventId) continue;
        const projected = insertProjectedEvent({
          homeInstanceId: instance.id,
          localChannelId,
          remoteEventId,
          type: event.type,
          source: event.source,
          payload: event.payload ?? {},
          parentEventId: event.parentEventId,
          deliverAt: event.deliverAt,
        });
        if (projected.inserted) inserted += 1;
      }
      const candidateCursor =
        typeof payload.nextCursor === "number" && Number.isFinite(payload.nextCursor)
          ? payload.nextCursor
          : events.length > 0
            ? Number(events[events.length - 1].createdAt ?? cursor)
            : cursor;
      if (!Number.isFinite(candidateCursor) || candidateCursor <= cursor) {
        nextCursor = String(cursor || 0);
        break;
      }
      cursor = candidateCursor;
      nextCursor = String(cursor);
      if (events.length < batchLimit) break;
    }
    orm
      .update(schema.federationChannels)
      .set({ sync_cursor: nextCursor, updated_at: Date.now() })
      .where(eq(schema.federationChannels.local_channel_id, localChannelId))
      .run();
    return { fetched, inserted, nextCursor, participantCount };
  }

  async function syncAllProjectionChannels() {
    let links: any[];
    try {
      links = orm
        .select()
        .from(schema.federationChannels)
        .where(eq(schema.federationChannels.role, "REMOTE_PROJECTION"))
        .all() as any[];
    } catch (error) {
      if (String(error).includes("no such table: federation_channels")) return;
      throw error;
    }
    for (const link of links) {
      try {
        await syncProjectionLink(link);
      } catch (error) {
        console.warn("federation.sync_failed", {
          localChannelId: link.local_channel_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const syncIntervalMs = Number(
    process.env.ORGOPS_FEDERATION_SYNC_INTERVAL_MS ?? DEFAULT_FEDERATION_SYNC_INTERVAL_MS,
  );
  if (Number.isFinite(syncIntervalMs) && syncIntervalMs > 0) {
    const timer = setInterval(() => {
      void syncAllProjectionChannels();
    }, syncIntervalMs);
    timer.unref?.();
  }

  function deletePendingJoinInvites(channelId?: string) {
    const pending = orm
      .select()
      .from(schema.federationInstances)
      .where(eq(schema.federationInstances.base_url, ""))
      .all() as any[];
    let deletedCount = 0;
    for (const invite of pending) {
      const metadata = parseJsonRecordSafe(invite.metadata_json);
      if (channelId && metadata.joinChannelId !== channelId) continue;
      orm
        .delete(schema.federationChannelSubscribers)
        .where(eq(schema.federationChannelSubscribers.instance_id, invite.id))
        .run();
      orm
        .delete(schema.federationInstances)
        .where(eq(schema.federationInstances.id, invite.id))
        .run();
      deletedCount += 1;
    }
    return deletedCount;
  }

  function deleteChannelRow(channelId: string) {
    orm
      .delete(schema.channelSubscriptions)
      .where(eq(schema.channelSubscriptions.channel_id, channelId))
      .run();
    orm
      .delete(schema.channelShareLinks)
      .where(eq(schema.channelShareLinks.channel_id, channelId))
      .run();
    orm
      .delete(schema.channelViewers)
      .where(eq(schema.channelViewers.channel_id, channelId))
      .run();
    orm.delete(schema.channels).where(eq(schema.channels.id, channelId)).run();
  }

  function getChannelParticipants(channelId: string) {
    const rows = orm
      .select({
        subscriberType: schema.channelSubscriptions.subscriber_type,
        subscriberId: schema.channelSubscriptions.subscriber_id,
      })
      .from(schema.channelSubscriptions)
      .where(eq(schema.channelSubscriptions.channel_id, channelId))
      .orderBy(
        asc(schema.channelSubscriptions.subscriber_type),
        asc(schema.channelSubscriptions.subscriber_id),
      )
      .all() as Array<{ subscriberType: string; subscriberId: string }>;
    return normalizeFederationParticipants(rows);
  }

  function updateProjectionParticipants(localChannelId: string, participants: unknown) {
    const normalized = normalizeFederationParticipants(participants);
    const channel = orm
      .select({ metadataJson: schema.channels.metadata_json })
      .from(schema.channels)
      .where(eq(schema.channels.id, localChannelId))
      .get() as { metadataJson?: string | null } | undefined;
    const metadata = parseJsonRecordSafe(channel?.metadataJson);
    const federation =
      metadata.federation && typeof metadata.federation === "object" && !Array.isArray(metadata.federation)
        ? (metadata.federation as Record<string, unknown>)
        : {};
    orm
      .update(schema.channels)
      .set({
        metadata_json: JSON.stringify({
          ...metadata,
          federation: {
            ...federation,
            participants: normalized,
          },
        }),
      })
      .where(eq(schema.channels.id, localChannelId))
      .run();
    return normalized.length;
  }

  async function syncProjectionParticipants(link: any, instance: any) {
    const response = await fetchPeer(
      instance,
      `/api/federation/channels/${encodeURIComponent(link.remote_channel_id)}/participants`,
    );
    const payload = (await response.json()) as { participants?: unknown };
    return updateProjectionParticipants(link.local_channel_id, payload.participants);
  }

  app.get("/api/federation/instances", requireAuth, (c) => {
    const rows = orm.select().from(schema.federationInstances).all() as any[];
    return jsonResponse(
      c,
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        baseUrl: row.base_url,
        inboundTokenPrefix: row.inbound_token_prefix ?? null,
        hasOutboundToken: Boolean(row.outbound_token),
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
    const outboundToken = trimString((body as Record<string, unknown>).outboundToken) || null;
    const inboundToken = generateFederationToken();
    const now = Date.now();
    const id = randomUUID();
    orm
      .insert(schema.federationInstances)
      .values({
        id,
        name,
        base_url: baseUrl,
        outbound_token: outboundToken,
        inbound_token_hash: hashToken(inboundToken),
        inbound_token_prefix: inboundToken.slice(0, 12),
        status: "ACTIVE",
        metadata_json: JSON.stringify((body as Record<string, unknown>).metadata ?? {}),
        created_at: now,
        updated_at: now,
        last_seen_at: null,
      })
      .run();
    return jsonResponse(
      c,
      {
        ok: true,
        id,
        name,
        baseUrl,
        inboundToken,
        inboundTokenPrefix: inboundToken.slice(0, 12),
        hasOutboundToken: Boolean(outboundToken),
      },
      201,
    );
  });

  app.patch("/api/federation/instances/:id", requireAuth, async (c) => {
    const id = c.req.param("id");
    const existing = orm
      .select()
      .from(schema.federationInstances)
      .where(eq(schema.federationInstances.id, id))
      .get() as any;
    if (!existing) return jsonResponse(c, { error: "Not found" }, 404);
    const body = await c.req.json().catch(() => ({}));
    const patch: Record<string, unknown> = { updated_at: Date.now() };
    const name = trimString((body as Record<string, unknown>).name);
    const baseUrl = normalizeBaseUrl((body as Record<string, unknown>).baseUrl);
    if (name) patch.name = name;
    if (baseUrl) patch.base_url = baseUrl;
    if (Object.prototype.hasOwnProperty.call(body, "outboundToken")) {
      patch.outbound_token = trimString((body as Record<string, unknown>).outboundToken) || null;
    }
    if (Object.prototype.hasOwnProperty.call(body, "metadata")) {
      patch.metadata_json = JSON.stringify((body as Record<string, unknown>).metadata ?? {});
    }
    orm
      .update(schema.federationInstances)
      .set(patch)
      .where(eq(schema.federationInstances.id, id))
      .run();
    return jsonResponse(c, { ok: true });
  });

  app.delete("/api/federation/instances/:id", requireAuth, (c) => {
    const id = c.req.param("id");
    const existing = orm
      .select({ id: schema.federationInstances.id })
      .from(schema.federationInstances)
      .where(eq(schema.federationInstances.id, id))
      .get();
    orm
      .delete(schema.federationChannelSubscribers)
      .where(eq(schema.federationChannelSubscribers.instance_id, id))
      .run();
    orm
      .delete(schema.federationChannels)
      .where(eq(schema.federationChannels.home_instance_id, id))
      .run();
    orm
      .delete(schema.federationInstances)
      .where(eq(schema.federationInstances.id, id))
      .run();
    return jsonResponse(c, { ok: true, deleted: Boolean(existing) });
  });

  app.delete("/api/federation/join-links", requireAuth, (c) => {
    const channelId = trimString(new URL(c.req.url).searchParams.get("channelId"));
    const deletedCount = deletePendingJoinInvites(channelId || undefined);
    return jsonResponse(c, { ok: true, deletedCount });
  });

  app.get("/api/federation/channels", requireAuth, (c) => {
    const links = orm.select().from(schema.federationChannels).all() as any[];
    const channels = orm.select().from(schema.channels).all() as any[];
    const subscribers = orm.select().from(schema.federationChannelSubscribers).all() as any[];
    const channelsById = new Map(channels.map((channel) => [channel.id, channel]));
    return jsonResponse(
      c,
      links.map((link) => {
        const channel = channelsById.get(link.local_channel_id);
        const linkSubscribers = subscribers.filter(
          (subscriber) => subscriber.local_channel_id === link.local_channel_id,
        );
        const lastAckAt = Math.max(
          0,
          ...linkSubscribers.map((subscriber) => Number(subscriber.last_ack_at ?? 0)),
        );
        const lastPushAt = Math.max(
          0,
          ...linkSubscribers.map((subscriber) => Number(subscriber.last_push_at ?? 0)),
        );
        const lastError = linkSubscribers.find((subscriber) => subscriber.last_error)?.last_error ?? null;
        return {
          localChannelId: link.local_channel_id,
          localChannelName: channel?.name ?? null,
          homeInstanceId: link.home_instance_id ?? null,
          remoteChannelId: link.remote_channel_id ?? null,
          role: link.role,
          syncCursor: link.sync_cursor ?? null,
          subscriberCount: linkSubscribers.length,
          lastPushAt: lastPushAt || null,
          lastAckAt: lastAckAt || null,
          lastError,
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

    let registeredWithHome = false;
    let registrationError: string | null = null;
    let participantCount: number | null = null;
    if (role === "REMOTE_PROJECTION" && homeInstanceId && remoteChannelId) {
      const instance = orm
        .select()
        .from(schema.federationInstances)
        .where(eq(schema.federationInstances.id, homeInstanceId))
        .get() as any;
      try {
        await fetchPeer(instance, `/api/federation/channels/${encodeURIComponent(remoteChannelId)}/subscribers`, {
          method: "POST",
          body: JSON.stringify({ remoteChannelId: localChannelId }),
        });
        registeredWithHome = true;
      } catch (error) {
        registrationError = error instanceof Error ? error.message : String(error);
      }
      try {
        participantCount = await syncProjectionParticipants(
          { local_channel_id: localChannelId, remote_channel_id: remoteChannelId },
          instance,
        );
      } catch {
        participantCount = null;
      }
    }

    return jsonResponse(
      c,
      {
        ok: true,
        localChannelId,
        homeInstanceId: homeInstanceId || null,
        remoteChannelId: remoteChannelId || null,
        role,
        registeredWithHome,
        registrationError,
        participantCount,
      },
      201,
    );
  });

  app.delete("/api/federation/channels/:localChannelId", requireAuth, (c) => {
    const localChannelId = c.req.param("localChannelId");
    const link = orm
      .select()
      .from(schema.federationChannels)
      .where(eq(schema.federationChannels.local_channel_id, localChannelId))
      .get() as any;
    if (!link) return jsonResponse(c, { ok: true, deleted: false });
    const deleteLocalChannel =
      new URL(c.req.url).searchParams.get("deleteLocalChannel") === "1";
    orm
      .delete(schema.federationChannelSubscribers)
      .where(eq(schema.federationChannelSubscribers.local_channel_id, localChannelId))
      .run();
    orm
      .delete(schema.federationChannels)
      .where(eq(schema.federationChannels.local_channel_id, localChannelId))
      .run();
    const pendingJoinUrlCount =
      link.role === "LOCAL_HOME" ? deletePendingJoinInvites(localChannelId) : 0;
    if (link.role === "REMOTE_PROJECTION" && deleteLocalChannel) {
      deleteChannelRow(localChannelId);
    }
    return jsonResponse(c, {
      ok: true,
      deleted: true,
      localChannelDeleted: Boolean(link.role === "REMOTE_PROJECTION" && deleteLocalChannel),
      pendingJoinUrlCount,
    });
  });

  app.post("/api/federation/channels/:channelId/subscribers", async (c) => {
    const auth = requireFederationPeer(c);
    if ("response" in auth) return auth.response;
    const localChannelId = c.req.param("channelId");
    if(!peerAllows(auth.peer,'allowedChannelIds',localChannelId))return jsonResponse(c,{error:'Channel not granted to this peer'},403);
    const channelLink = orm
      .select()
      .from(schema.federationChannels)
      .where(
        and(
          eq(schema.federationChannels.local_channel_id, localChannelId),
          eq(schema.federationChannels.role, "LOCAL_HOME"),
        ),
      )
      .get();
    if (!channelLink) return jsonResponse(c, { error: "Federated home channel not found" }, 404);
    const body = await c.req.json().catch(() => ({}));
    const remoteChannelId = trimString((body as Record<string, unknown>).remoteChannelId);
    if (!remoteChannelId) return jsonResponse(c, { error: "remoteChannelId is required" }, 400);
    const peerBaseUrl = normalizeBaseUrl((body as Record<string, unknown>).peerBaseUrl);
    const outboundToken = trimString((body as Record<string, unknown>).outboundToken);
    if (peerBaseUrl || outboundToken) {
      const patch: Record<string, unknown> = { updated_at: Date.now() };
      if (peerBaseUrl) patch.base_url = peerBaseUrl;
      if (outboundToken) patch.outbound_token = outboundToken;
      orm
        .update(schema.federationInstances)
        .set(patch)
        .where(eq(schema.federationInstances.id, auth.peer.id))
        .run();
    }
    const now = Date.now();
    const existing = orm
      .select({ id: schema.federationChannelSubscribers.id })
      .from(schema.federationChannelSubscribers)
      .where(
        and(
          eq(schema.federationChannelSubscribers.local_channel_id, localChannelId),
          eq(schema.federationChannelSubscribers.instance_id, auth.peer.id),
          eq(schema.federationChannelSubscribers.remote_channel_id, remoteChannelId),
        ),
      )
      .get() as { id: string } | undefined;
    if (existing) {
      orm
        .update(schema.federationChannelSubscribers)
        .set({ status: "ACTIVE", last_error: null, updated_at: now })
        .where(eq(schema.federationChannelSubscribers.id, existing.id))
        .run();
      return jsonResponse(c, { ok: true, id: existing.id });
    }
    const id = randomUUID();
    orm
      .insert(schema.federationChannelSubscribers)
      .values({
        id,
        local_channel_id: localChannelId,
        instance_id: auth.peer.id,
        remote_channel_id: remoteChannelId,
        status: "ACTIVE",
        last_push_at: null,
        last_ack_at: null,
        last_error: null,
        created_at: now,
        updated_at: now,
      })
      .run();
    return jsonResponse(c, { ok: true, id }, 201);
  });

  app.get("/api/federation/channels/:channelId/participants", (c) => {
    const auth = requireFederationPeer(c);
    if ("response" in auth) return auth.response;
    const channelId = c.req.param("channelId");
    if(!peerAllows(auth.peer,'allowedChannelIds',channelId))return jsonResponse(c,{error:'Channel not granted to this peer'},403);
    const channelLink = orm
      .select()
      .from(schema.federationChannels)
      .where(
        and(
          eq(schema.federationChannels.local_channel_id, channelId),
          eq(schema.federationChannels.role, "LOCAL_HOME"),
        ),
      )
      .get();
    if (!channelLink) return jsonResponse(c, { error: "Federated home channel not found" }, 404);
    return jsonResponse(c, { participants: getChannelParticipants(channelId) });
  });

  app.post("/api/federation/channels/:channelId/join-link", requireAuth, async (c) => {
    const channelId = c.req.param("channelId");
    const channel = orm
      .select({ id: schema.channels.id, name: schema.channels.name })
      .from(schema.channels)
      .where(eq(schema.channels.id, channelId))
      .get() as { id: string; name: string } | undefined;
    if (!channel) return jsonResponse(c, { error: "Channel not found" }, 404);
    const link = orm
      .select()
      .from(schema.federationChannels)
      .where(
        and(
          eq(schema.federationChannels.local_channel_id, channelId),
          eq(schema.federationChannels.role, "LOCAL_HOME"),
        ),
      )
      .get();
    if (!link) return jsonResponse(c, { error: "Channel is not a LOCAL_HOME federated channel" }, 400);
    const body = await c.req.json().catch(() => ({}));
    const now = Date.now();
    const requestedPeerName = trimString((body as Record<string, unknown>).peerName);
    let id = randomUUID();
    let inboundToken = generateFederationToken();
    let peerName = requestedPeerName || `join-${channel.name}-${id.slice(0, 8)}`;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        orm
          .insert(schema.federationInstances)
          .values({
            id,
            name: peerName,
            base_url: "",
            outbound_token: null,
            inbound_token_hash: hashToken(inboundToken),
            inbound_token_prefix: inboundToken.slice(0, 12),
            status: "ACTIVE",
            metadata_json: JSON.stringify({ joinChannelId: channelId }),
            created_at: now,
            updated_at: now,
            last_seen_at: null,
          })
          .run();
        break;
      } catch (error) {
        if (!String(error).includes("UNIQUE") || attempt === 4) throw error;
        id = randomUUID();
        inboundToken = generateFederationToken();
        peerName = `join-${channel.name}-${id.slice(0, 8)}`;
      }
    }
    const origin = requestOrigin(c);
    const joinUrl = new URL(`${origin}/federation/join`);
    joinUrl.searchParams.set("homeBaseUrl", origin);
    joinUrl.searchParams.set("channelId", channelId);
    joinUrl.searchParams.set("channelName", channel.name);
    joinUrl.searchParams.set("token", inboundToken);
    return jsonResponse(c, {
      ok: true,
      instanceId: id,
      peerName,
      channelId,
      channelName: channel.name,
      joinUrl: joinUrl.toString(),
      inboundTokenPrefix: inboundToken.slice(0, 12),
    });
  });

  app.post("/api/federation/join", requireAuth, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const joinUrlRaw = trimString((body as Record<string, unknown>).joinUrl);
    const peerBaseUrl = normalizeBaseUrl((body as Record<string, unknown>).peerBaseUrl);
    if (!joinUrlRaw) return jsonResponse(c, { error: "joinUrl is required" }, 400);
    if (!peerBaseUrl) return jsonResponse(c, { error: "peerBaseUrl is required" }, 400);
    let joinUrl: URL;
    try {
      joinUrl = new URL(joinUrlRaw);
    } catch {
      return jsonResponse(c, { error: "joinUrl must be a valid URL" }, 400);
    }
    const homeBaseUrl =
      normalizeBaseUrl(joinUrl.searchParams.get("homeBaseUrl")) ||
      `${joinUrl.protocol}//${joinUrl.host}`.replace(/\/+$/, "");
    if(!normalizeBaseUrl(homeBaseUrl))return jsonResponse(c,{error:'Invalid home origin'},400);
    const remoteChannelId = trimString(joinUrl.searchParams.get("channelId"));
    const channelName = trimString(joinUrl.searchParams.get("channelName")) || "federated-channel";
    const outboundToken = trimString(joinUrl.searchParams.get("token"));
    if (!homeBaseUrl || !remoteChannelId || !outboundToken) {
      return jsonResponse(c, { error: "joinUrl is missing homeBaseUrl, channelId, or token" }, 400);
    }
    const localInvite = orm
      .select({ id: schema.federationInstances.id })
      .from(schema.federationInstances)
      .where(eq(schema.federationInstances.inbound_token_hash, hashToken(outboundToken)))
      .get();
    if (localInvite) {
      return jsonResponse(c, { error: "Cannot join a federation URL created by this instance" }, 400);
    }
    const existingInstance = orm
      .select()
      .from(schema.federationInstances)
      .where(
        and(
          eq(schema.federationInstances.base_url, homeBaseUrl),
          eq(schema.federationInstances.outbound_token, outboundToken),
        ),
      )
      .get() as any;
    if (existingInstance) {
      const existingLink = orm
        .select()
        .from(schema.federationChannels)
        .where(
          and(
            eq(schema.federationChannels.home_instance_id, existingInstance.id),
            eq(schema.federationChannels.remote_channel_id, remoteChannelId),
            eq(schema.federationChannels.role, "REMOTE_PROJECTION"),
          ),
        )
        .get() as any;
      if (existingLink) {
        return jsonResponse(c, {
          ok: true,
          instanceId: existingInstance.id,
          localChannelId: existingLink.local_channel_id,
          registeredWithHome: false,
          registrationError: null,
          alreadyJoined: true,
        });
      }
    }
    const now = Date.now();
    const instanceId = randomUUID();
    const inboundToken = generateFederationToken();
    const instanceName =
      trimString((body as Record<string, unknown>).instanceName) ||
      `home-${new URL(homeBaseUrl).host}-${instanceId.slice(0, 8)}`;
    orm
      .insert(schema.federationInstances)
      .values({
        id: instanceId,
        name: instanceName,
        base_url: homeBaseUrl,
        outbound_token: outboundToken,
        inbound_token_hash: hashToken(inboundToken),
        inbound_token_prefix: inboundToken.slice(0, 12),
        status: "ACTIVE",
        metadata_json: JSON.stringify({ joinedFromUrl: true }),
        created_at: now,
        updated_at: now,
        last_seen_at: null,
      })
      .run();
    const localChannelId = randomUUID();
    const localName =
      trimString((body as Record<string, unknown>).localName) || `${channelName}-projection`;
    orm
      .insert(schema.channels)
      .values({
        id: localChannelId,
        name: localName,
        description: `Projection of ${channelName} from ${homeBaseUrl}`,
        metadata_json: JSON.stringify({
          federation: {
            role: "REMOTE_PROJECTION",
            homeInstanceId: instanceId,
            remoteChannelId,
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
    orm
      .insert(schema.federationChannels)
      .values({
        local_channel_id: localChannelId,
        home_instance_id: instanceId,
        remote_channel_id: remoteChannelId,
        role: "REMOTE_PROJECTION",
        sync_cursor: null,
        metadata_json: "{}",
        created_at: now,
        updated_at: now,
      })
      .run();
    let registeredWithHome = false;
    let registrationError: string | null = null;
    let participantCount: number | null = null;
    const instance = orm
      .select()
      .from(schema.federationInstances)
      .where(eq(schema.federationInstances.id, instanceId))
      .get() as any;
    try {
      await fetchPeer(instance, `/api/federation/channels/${encodeURIComponent(remoteChannelId)}/subscribers`, {
        method: "POST",
        body: JSON.stringify({
          remoteChannelId: localChannelId,
          peerBaseUrl,
          outboundToken: inboundToken,
        }),
      });
      registeredWithHome = true;
    } catch (error) {
      registrationError = error instanceof Error ? error.message : String(error);
    }
    try {
      participantCount = await syncProjectionParticipants(
        { local_channel_id: localChannelId, remote_channel_id: remoteChannelId },
        instance,
      );
    } catch {
      participantCount = null;
    }
    return jsonResponse(
      c,
      {
        ok: true,
        instanceId,
        localChannelId,
        registeredWithHome,
        registrationError,
        participantCount,
      },
      201,
    );
  });

  app.post("/api/federation/projections/:localChannelId/events", async (c) => {
    const auth = requireFederationPeer(c);
    if ("response" in auth) return auth.response;
    const localChannelId = c.req.param("localChannelId");
    const link = orm
      .select()
      .from(schema.federationChannels)
      .where(
        and(
          eq(schema.federationChannels.local_channel_id, localChannelId),
          eq(schema.federationChannels.role, "REMOTE_PROJECTION"),
          eq(schema.federationChannels.home_instance_id, auth.peer.id),
        ),
      )
      .get() as any;
    if (!link) return jsonResponse(c, { error: "Remote projection channel not found" }, 404);
    const body = await c.req.json().catch(() => ({}));
    const remoteEventId = trimString((body as Record<string, unknown>).id);
    const type = trimString((body as Record<string, unknown>).type);
    const source = trimString((body as Record<string, unknown>).source);
    if (!remoteEventId || !type || !source) {
      return jsonResponse(c, { error: "id, type, and source are required" }, 400);
    }
    let participantCount: number | null = null;
    try {
      participantCount = await syncProjectionParticipants(link, auth.peer);
    } catch {
      participantCount = null;
    }
    const projected = insertProjectedEvent({
      homeInstanceId: auth.peer.id,
      localChannelId,
      remoteEventId,
      type,
      source,
      payload: (body as Record<string, unknown>).payload ?? {},
      parentEventId: trimString((body as Record<string, unknown>).parentEventId) || undefined,
      deliverAt:
        typeof (body as Record<string, unknown>).deliverAt === "number"
          ? (body as Record<string, number>).deliverAt
          : undefined,
    });
    return jsonResponse(c, {
      ok: true,
      inserted: projected.inserted,
      participantCount,
      event: eventRowToApi(projected.row),
    });
  });

  app.get("/api/federation/channels/:channelId/events", (c) => {
    const auth = requireFederationPeer(c);
    if ("response" in auth) return auth.response;
    const channelId = c.req.param("channelId");
    if(!peerAllows(auth.peer,'allowedChannelIds',channelId))return jsonResponse(c,{error:'Channel not granted to this peer'},403);
    const channelLink = orm
      .select()
      .from(schema.federationChannels)
      .where(
        and(
          eq(schema.federationChannels.local_channel_id, channelId),
          eq(schema.federationChannels.role, "LOCAL_HOME"),
        ),
      )
      .get();
    if (!channelLink) return jsonResponse(c, { error: "Federated home channel not found" }, 404);
    const url = new URL(c.req.url);
    const after = Number(url.searchParams.get("after") ?? 0);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100), 1), 500);
    const clauses: any[] = [eq(schema.events.channel_id, channelId)];
    if (Number.isFinite(after) && after > 0) {
      clauses.push(gt(schema.events.created_at, after));
    }
    const rows = orm
      .select(compactEventRowSelectFields())
      .from(schema.events)
      .where(and(...(clauses as [any, ...any[]])))
      .orderBy(asc(schema.events.created_at))
      .limit(limit)
      .all() as any[];
    return jsonResponse(c, {
      events: rows.map((row) => eventRowToApi(row)),
      nextCursor: rows.length > 0 ? rows[rows.length - 1].created_at : after || null,
    });
  });

  app.post("/api/federation/channels/:channelId/events", async (c) => {
    const auth = requireFederationPeer(c);
    if ("response" in auth) return auth.response;
    const channelId = c.req.param("channelId");
    if(!peerAllows(auth.peer,'allowedChannelIds',channelId))return jsonResponse(c,{error:'Channel not granted to this peer'},403);
    const channel = orm
      .select({ id: schema.channels.id })
      .from(schema.channels)
      .where(eq(schema.channels.id, channelId))
      .get();
    if (!channel) return jsonResponse(c, { error: "Channel not found" }, 404);
    const body = await c.req.json().catch(() => ({}));
    const type = trimString((body as Record<string, unknown>).type);
    const source = trimString((body as Record<string, unknown>).source);
    if (!type || !source) return jsonResponse(c, { error: "type and source are required" }, 400);
    const payload = (body as Record<string, unknown>).payload ?? {};
    const identity=trimString((body as Record<string,unknown>).idempotencyKey)||trimString((body as Record<string,unknown>).originEventId);
    const idempotencyKey=identity?remoteEventIdempotencyKey(auth.peer.id,`${channelId}:${identity}`):undefined;
    if (idempotencyKey) {
      const existing = orm
        .select(compactEventRowSelectFields())
        .from(schema.events)
        .where(eq(schema.events.idempotency_key, idempotencyKey))
        .get() as any;
      if (existing) return jsonResponse(c, eventRowToApi(existing), 200);
    }
    const row = insertEvent({
      type,
      source,
      payload,
      channelId,
      parentEventId: trimString((body as Record<string, unknown>).parentEventId) || undefined,
      deliverAt:
        typeof (body as Record<string, unknown>).deliverAt === "number"
          ? (body as Record<string, number>).deliverAt
          : undefined,
      idempotencyKey,
    });
    return jsonResponse(c, eventRowToApi(row), 201);
  });

  app.post("/api/federation/channels/:localChannelId/sync", requireAuth, async (c) => {
    const localChannelId = c.req.param("localChannelId");
    const link = orm
      .select()
      .from(schema.federationChannels)
      .where(eq(schema.federationChannels.local_channel_id, localChannelId))
      .get() as any;
    if (!link || link.role !== "REMOTE_PROJECTION") {
      return jsonResponse(c, { error: "Remote projection channel not found" }, 404);
    }
    const result = await syncProjectionLink(link);
    return jsonResponse(c, { ok: true, ...result });
  });

  app.get("/api/federation/agents/:name/transfer", (c) => {
    const auth = requireFederationPeer(c);
    if ("response" in auth) return auth.response;
    if(!peerAllows(auth.peer,'allowedAgentExports',c.req.param('name')))return jsonResponse(c,{error:'Agent export not granted'},403);
    const bundle = agentTransfer.exportAgent(c.req.param("name"),{includeSecrets:false});
    if (!bundle) return jsonResponse(c, { error: "Not found" }, 404);
    return jsonResponse(c, bundle);
  });

  app.post("/api/federation/agents/transfer", async (c) => {
    const auth = requireFederationPeer(c);
    if ("response" in auth) return auth.response;
    const body = (await c.req.json().catch(() => null)) as AgentTransferBundle | null;
    if (!body || typeof body !== "object" || !body.agent) {
      return jsonResponse(c, { error: "Invalid agent transfer bundle" }, 400);
    }
    const targetName = trimString(body.agent.name);
    if (!targetName) return jsonResponse(c, { error: "name is required" }, 400);
    if(!peerAllows(auth.peer,'allowedAgentImports',targetName))return jsonResponse(c,{error:'Agent import not granted'},403);
    if(body.secrets?.length)return jsonResponse(c,{error:'Provision secrets locally after transfer'},403);
    const owner=orm.select({id:schema.humans.id}).from(schema.humans).orderBy(asc(schema.humans.created_at),asc(schema.humans.id)).limit(1).get();
    const sanitized={...body,secrets:[],agent:{...body.agent,visibility:'PRIVATE',ownerHumanId:owner?.id??null,additionalSkillRoots:[],allowOutsideWorkspace:false,allowOwnerHumanSecrets:false}};
    try {
      const imported = agentTransfer.importAgent(sanitized, {
        name: targetName,
        workspacePath: `${deps.workspaceRoot}/${randomUUID()}`,
        assignedRunnerId:null,
        desiredState:'STOPPED',
      });
      insertEvent({
        type: "agent.control.copy",
        payload: {
          sourceAgentName: trimString(body.agent.name),
          targetAgentName: targetName,
          federationInstanceId: auth.peer.id,
        },
        source: "system",
      });
      return jsonResponse(c, { ok: true, ...imported }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Agent transfer failed";
      const status = message === "Resource already exists" ? 409 : 400;
      return jsonResponse(c, { error: message }, status);
    }
  });
}
