import { createHmac, randomUUID } from "node:crypto";
import { schema, type OrgOpsDrizzleDb } from "@orgops/db";
import { and, eq } from "drizzle-orm";

import type { AccessControl, RequestUser } from "./routes/access";

const DEFAULT_BROKER = "direct-openai-calls";
const DEFAULT_TOKEN_TTL_SECONDS = 60 * 60;

type VoiceBrokerDeps = {
  orm: OrgOpsDrizzleDb;
  access: AccessControl;
  env?: () => Record<string, string | undefined>;
};

export type VoiceBrokerJoinRequest = {
  channelId: string;
  sessionId?: string;
  kind?: "human" | "agent";
  agentName?: string;
};

export type VoiceBrokerJoinResult =
  | {
      ok: true;
      broker: "direct-openai-calls";
      mode: "client-multiplex";
      roomName: string;
      sessionId: string;
    }
  | {
      ok: true;
      broker: "livekit";
      mode: "sfu";
      url: string;
      roomName: string;
      identity: string;
      token: string;
      sessionId: string;
      expiresAt: number;
    }
  | { ok: false; status: 400 | 403 | 404 | 409 | 503; error: string };

function base64Url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function signJwt(payload: Record<string, unknown>, secret: string) {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(`${encodedHeader}.${encodedPayload}`).digest("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function readBroker(env: Record<string, string | undefined>) {
  const raw = (env.ORGOPS_VOICE_BROKER ?? DEFAULT_BROKER).trim().toLowerCase();
  if (raw === "livekit") return "livekit" as const;
  return "direct-openai-calls" as const;
}

function liveKitRoomName(channelId: string) {
  return `orgops-channel-${channelId}`;
}

export function createVoiceBroker(deps: VoiceBrokerDeps) {
  const readEnv = () => deps.env?.() ?? process.env;

  function config() {
    const env = readEnv();
    const broker = readBroker(env);
    if (broker === "livekit") {
      return {
        enabled: Boolean(env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET),
        broker,
        url: env.LIVEKIT_URL?.trim() || null,
      };
    }
    return { enabled: true, broker, url: null };
  }

  function createJoinToken(input: {
    apiKey: string;
    apiSecret: string;
    roomName: string;
    identity: string;
    name: string;
    ttlSeconds: number;
  }) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiresAt = nowSeconds + input.ttlSeconds;
    const token = signJwt(
      {
        iss: input.apiKey,
        sub: input.identity,
        name: input.name,
        nbf: nowSeconds - 10,
        exp: expiresAt,
        video: {
          room: input.roomName,
          roomJoin: true,
          canPublish: true,
          canSubscribe: true,
          canPublishData: true,
        },
      },
      input.apiSecret,
    );
    return { token, expiresAt: expiresAt * 1000 };
  }

  async function join(
    user: RequestUser | undefined,
    request: VoiceBrokerJoinRequest,
  ): Promise<VoiceBrokerJoinResult> {
    const kind = request.kind === "agent" ? "agent" : "human";
    const username = user?.username;
    if (kind === "human" && (!username || username === "runner")) {
      return { ok: false, status: 403, error: "Voice rooms are joined by humans" };
    }
    if (kind === "agent" && username !== "runner") {
      return { ok: false, status: 403, error: "Agents join voice rooms through the runner" };
    }
    const channelId = request.channelId.trim();
    if (!channelId) return { ok: false, status: 400, error: "channelId is required" };
    const channel = deps.orm
      .select({ id: schema.channels.id })
      .from(schema.channels)
      .where(eq(schema.channels.id, channelId))
      .get() as { id: string } | undefined;
    if (!channel || (kind === "human" && !deps.access.canViewChannel(user, channel.id))) {
      return { ok: false, status: 404, error: "Channel not found" };
    }
    if (kind === "human" && !deps.access.canPostToChannel(user, channel.id)) {
      return { ok: false, status: 403, error: "You cannot join voice in this channel" };
    }

    let displayName = username ?? "human";
    if (kind === "agent") {
      const agentName = request.agentName?.trim() ?? "";
      if (!agentName) return { ok: false, status: 400, error: "agentName is required" };
      const agent = deps.orm
        .select({
          name: schema.agents.name,
          desiredState: schema.agents.desired_state,
        })
        .from(schema.agents)
        .where(eq(schema.agents.name, agentName))
        .get() as { name: string; desiredState: string } | undefined;
      if (!agent) return { ok: false, status: 404, error: "Agent not found" };
      const subscription = deps.orm
        .select({ id: schema.channelSubscriptions.subscriber_id })
        .from(schema.channelSubscriptions)
        .where(
          and(
            eq(schema.channelSubscriptions.channel_id, channel.id),
            eq(schema.channelSubscriptions.subscriber_type, "AGENT"),
            eq(schema.channelSubscriptions.subscriber_id, agent.name),
          ),
        )
        .get();
      if (!subscription) {
        return { ok: false, status: 400, error: `${agent.name} is not in this channel` };
      }
      if (agent.desiredState !== "RUNNING") {
        return { ok: false, status: 409, error: `${agent.name} is stopped` };
      }
      displayName = agent.name;
    }

    const env = readEnv();
    const broker = readBroker(env);
    const sessionId = request.sessionId?.trim() || randomUUID();
    const roomName = liveKitRoomName(channel.id);
    if (broker !== "livekit") {
      return { ok: true, broker, mode: "client-multiplex", roomName, sessionId };
    }

    const url = env.LIVEKIT_URL?.trim();
    const apiKey = env.LIVEKIT_API_KEY?.trim();
    const apiSecret = env.LIVEKIT_API_SECRET?.trim();
    if (!url || !apiKey || !apiSecret) {
      return { ok: false, status: 503, error: "LiveKit voice broker is not configured" };
    }
    const ttlSeconds = Math.max(60, Number(env.LIVEKIT_TOKEN_TTL_SECONDS ?? DEFAULT_TOKEN_TTL_SECONDS) || DEFAULT_TOKEN_TTL_SECONDS);
    const identity = kind === "agent" ? `agent:${displayName}` : `human:${displayName}:${sessionId}`;
    const signed = createJoinToken({
      apiKey,
      apiSecret,
      roomName,
      identity,
      name: displayName,
      ttlSeconds,
    });
    return {
      ok: true,
      broker,
      mode: "sfu",
      url,
      roomName,
      identity,
      token: signed.token,
      sessionId,
      expiresAt: signed.expiresAt,
    };
  }

  return { config, join };
}
