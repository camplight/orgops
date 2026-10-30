import { parseMasterKey } from "@orgops/crypto";
import { schema, type OrgOpsDrizzleDb } from "@orgops/db";
import { resolveModelCapabilities } from "@orgops/schemas";
import { and, eq } from "drizzle-orm";

import type { AccessControl, RequestUser } from "./routes/access";
import { resolveAgentSecretsEnv } from "./routes/secrets";

export const OPENAI_REALTIME_BASE_URL = "https://api.openai.com/v1/realtime";
const DEFAULT_REALTIME_VOICE = "marin";
const DEFAULT_REALTIME_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
const MAX_SOUL_CHARS = 6000;

type RealtimeVoiceDeps = {
  orm: OrgOpsDrizzleDb;
  insertEvent: (input: any) => any;
  access: AccessControl;
  fetch?: typeof fetch;
  env?: () => Record<string, string | undefined>;
};

export type RealtimeCallRequest = {
  channelId: string;
  agentName: string;
  sessionId: string;
  roomId?: string;
  sdp: string;
};

export type RealtimeCallResult =
  | { ok: true; sdp: string; callId: string; model: string; agentName: string }
  | { ok: false; status: 400 | 403 | 404 | 409 | 502 | 503; error: string };

export type RealtimeVoice = ReturnType<typeof createRealtimeVoice>;

export function parseRealtimeCallId(location: string | null): string | null {
  if (!location) return null;
  const id = location.split("?")[0]?.split("/").filter(Boolean).pop() ?? "";
  return id.trim() || null;
}

export function createRealtimeVoice(deps: RealtimeVoiceDeps) {
  const { orm, insertEvent, access } = deps;
  const fetchImpl = deps.fetch ?? fetch;
  const readEnv = () => deps.env?.() ?? process.env;

  function resolveOpenAiKey(agentName: string, channelId: string): string | null {
    const env = readEnv();
    try {
      const masterKey = parseMasterKey(env.ORGOPS_MASTER_KEY ?? "");
      const resolved = resolveAgentSecretsEnv(orm, { agentName, channelId, masterKey });
      if (resolved.env.OPENAI_API_KEY) return resolved.env.OPENAI_API_KEY;
    } catch {
      // No usable master key; fall back to the process env.
    }
    return env.OPENAI_API_KEY?.trim() || null;
  }

  function config() {
    const env = readEnv();
    const stubbed = env.ORGOPS_LLM_STUB === "1";
    return {
      enabled: !stubbed,
      provider: "openai" as const,
      voice: env.ORGOPS_REALTIME_VOICE?.trim() || DEFAULT_REALTIME_VOICE,
    };
  }

  function resolveRealtimeModel(modelId: string) {
    const colon = modelId.indexOf(":");
    const provider = colon > 0 ? modelId.slice(0, colon).trim().toLowerCase() : "";
    const modelName = colon > 0 ? modelId.slice(colon + 1).trim() : modelId.trim();
    const row = orm
      .select({ defaults: schema.models.defaults_json })
      .from(schema.models)
      .where(eq(schema.models.id, modelId))
      .get() as { defaults: string } | undefined;
    let defaults: Record<string, unknown> = {};
    try {
      defaults = row ? (JSON.parse(row.defaults) as Record<string, unknown>) : {};
    } catch {
      defaults = {};
    }
    const capabilities = resolveModelCapabilities(provider, modelName, defaults);
    return { provider, modelName, realtime: Boolean(capabilities.realtimeAudioInput) };
  }

  function buildBaseInstructions(input: {
    agentName: string;
    soul: string;
    speaker: string;
    channelName: string;
  }) {
    const soul = input.soul.trim().slice(0, MAX_SOUL_CHARS);
    return [
      `You are ${input.agentName}, an OrgOps agent in a live channel voice room with ${input.speaker} in channel "${input.channelName}".`,
      "Speak naturally and keep replies short; the human can interrupt you at any time.",
      soul ? `Your soul:\n${soul}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  async function createCall(
    user: RequestUser | undefined,
    request: RealtimeCallRequest,
  ): Promise<RealtimeCallResult> {
    const username = user?.username;
    if (!username || username === "runner") {
      return { ok: false, status: 403, error: "Realtime voice rooms are started by humans" };
    }
    if (!config().enabled) {
      return { ok: false, status: 503, error: "Realtime voice is unavailable in LLM stub mode" };
    }
    const channel = orm
      .select({ id: schema.channels.id, name: schema.channels.name })
      .from(schema.channels)
      .where(eq(schema.channels.id, request.channelId))
      .get() as { id: string; name: string } | undefined;
    if (!channel || !access.canViewChannel(user, channel.id)) {
      return { ok: false, status: 404, error: "Channel not found" };
    }
    if (!access.canPostToChannel(user, channel.id)) {
      return { ok: false, status: 403, error: "You cannot post to this channel" };
    }
    const agent = orm
      .select({
        name: schema.agents.name,
        modelId: schema.agents.model_id,
        soul: schema.agents.soul_contents,
        desiredState: schema.agents.desired_state,
      })
      .from(schema.agents)
      .where(eq(schema.agents.name, request.agentName))
      .get() as
      | { name: string; modelId: string; soul: string; desiredState: string }
      | undefined;
    if (!agent || !access.canViewAgent(user, agent.name)) {
      return { ok: false, status: 404, error: "Agent not found" };
    }
    const subscription = orm
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
    const model = resolveRealtimeModel(agent.modelId);
    if (!model.realtime) {
      return { ok: false, status: 400, error: `${agent.modelId} is not a realtime voice model` };
    }
    if (model.provider !== "openai") {
      return {
        ok: false,
        status: 400,
        error: `Realtime calls support OpenAI realtime models; ${agent.modelId} is not supported yet`,
      };
    }
    const apiKey = resolveOpenAiKey(agent.name, channel.id);
    if (!apiKey) {
      return { ok: false, status: 503, error: "OPENAI_API_KEY is not configured for this agent" };
    }

    const session = {
      type: "realtime",
      model: model.modelName,
      instructions: buildBaseInstructions({
        agentName: agent.name,
        soul: agent.soul ?? "",
        speaker: username,
        channelName: channel.name,
      }),
      audio: {
        input: {
          transcription: { model: DEFAULT_REALTIME_TRANSCRIPTION_MODEL },
          noise_reduction: { type: "near_field" },
        },
        output: { voice: config().voice },
      },
    };
    const form = new FormData();
    form.set("sdp", request.sdp);
    form.set("session", JSON.stringify(session));
    let response: Response;
    try {
      response = await fetchImpl(`${OPENAI_REALTIME_BASE_URL}/calls`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
    } catch (error) {
      return {
        ok: false,
        status: 502,
        error: `OpenAI realtime call failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const answer = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        status: 502,
        error: `OpenAI realtime call failed (${response.status}): ${answer.slice(0, 500)}`,
      };
    }
    const callId = parseRealtimeCallId(response.headers.get("location"));
    if (!callId) {
      return { ok: false, status: 502, error: "OpenAI realtime call returned no call id" };
    }

    insertEvent({
      type: "voice.realtime.call.started",
      source: `human:${username}`,
      channelId: channel.id,
      payload: {
        targetAgentName: agent.name,
        callId,
        sessionId: request.sessionId,
        ...(request.roomId ? { roomId: request.roomId } : {}),
        provider: "openai",
        model: model.modelName,
        speakerId: username,
        startedAt: Date.now(),
        text: `${username} connected ${agent.name} to a voice room.`,
      },
    });
    return { ok: true, sdp: answer, callId, model: model.modelName, agentName: agent.name };
  }

  return { config, createCall };
}
