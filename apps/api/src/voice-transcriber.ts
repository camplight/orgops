import { readFileSync } from "node:fs";
import { Buffer } from "node:buffer";

import { decryptSecret, parseMasterKey } from "@orgops/crypto";
import { schema, type OrgOpsDrizzleDb } from "@orgops/db";
import {
  resolveTranscriptionModelId,
  transcribe as defaultTranscribe,
  type TranscribeResult,
} from "@orgops/llm";
import { eq, inArray } from "drizzle-orm";

const PROVIDER_KEYS = ["OPENAI_API_KEY", "MISTRAL_API_KEY"] as const;
const TRANSCRIBE_TIMEOUT_MS = 30_000;
export const VOICE_TRANSCRIBER_SOURCE = "system:transcriber";

type ApiEvent = {
  id: string;
  type: string;
  source: string;
  channelId?: string;
  payload: unknown;
};

type VoiceChunkPayload = {
  mode?: "message" | "live";
  speakerId?: string;
  sessionId?: string;
  streamId?: string;
  chunkIndex?: number;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  attachment?: { fileId?: string; name?: string; mime?: string; size?: number };
};

type VoiceTranscriberDeps = {
  orm: OrgOpsDrizzleDb;
  insertEvent: (input: any) => any;
  transcribe?: typeof defaultTranscribe;
  env?: () => Record<string, string | undefined>;
};

export type VoiceTranscriber = ReturnType<typeof createVoiceTranscriber>;

export function createVoiceTranscriber(deps: VoiceTranscriberDeps) {
  const { orm, insertEvent } = deps;
  const transcribeAudio = deps.transcribe ?? defaultTranscribe;
  const channelQueues = new Map<string, Promise<void>>();

  function readPublicProviderSecrets(): Record<string, string> {
    const masterKeyInput = process.env.ORGOPS_MASTER_KEY ?? "";
    if (!masterKeyInput) return {};
    let masterKey: Buffer;
    try {
      masterKey = Buffer.from(parseMasterKey(masterKeyInput));
    } catch {
      return {};
    }
    const rows = orm
      .select({
        name: schema.secrets.name,
        scopeType: schema.secrets.scope_type,
        ciphertext: schema.secrets.ciphertext_b64,
      })
      .from(schema.secrets)
      .where(inArray(schema.secrets.name, [...PROVIDER_KEYS]))
      .all() as Array<{ name: string; scopeType: string; ciphertext: string }>;
    const env: Record<string, string> = {};
    for (const row of rows) {
      if (row.scopeType !== "public" && row.scopeType !== "app") continue;
      try {
        env[row.name] = decryptSecret(masterKey, row.ciphertext);
      } catch {
        // Skip secrets encrypted with another master key.
      }
    }
    return env;
  }

  function resolveEnv(): Record<string, string | undefined> {
    if (deps.env) return deps.env();
    const env: Record<string, string | undefined> = { ...process.env };
    const secrets = readPublicProviderSecrets();
    for (const key of PROVIDER_KEYS) {
      if (!env[key] && secrets[key]) env[key] = secrets[key];
    }
    return env;
  }

  function config() {
    const modelId = resolveTranscriptionModelId(resolveEnv());
    return { enabled: Boolean(modelId), modelId };
  }

  async function transcribeFile(fileId: string): Promise<TranscribeResult & { modelId: string }> {
    const env = resolveEnv();
    const modelId = resolveTranscriptionModelId(env);
    if (!modelId) {
      throw new Error(
        "Voice transcription is not configured. Set ORGOPS_TRANSCRIPTION_MODEL or add MISTRAL_API_KEY/OPENAI_API_KEY.",
      );
    }
    const row = orm
      .select({ storagePath: schema.files.storage_path })
      .from(schema.files)
      .where(eq(schema.files.id, fileId))
      .get() as { storagePath: string } | undefined;
    if (!row) throw new Error(`Audio file ${fileId} not found`);
    const data = new Uint8Array(readFileSync(row.storagePath));
    const result = await transcribeAudio(
      modelId,
      { data },
      {
        env: Object.fromEntries(PROVIDER_KEYS.map((key) => [key, env[key]])),
        abortSignal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
      },
    );
    return { ...result, modelId };
  }

  async function transcribeChunk(event: ApiEvent) {
    const payload = (event.payload ?? {}) as VoiceChunkPayload;
    const fileId = payload.attachment?.fileId;
    if (!event.channelId || !fileId) return;
    const mode = payload.mode === "live" ? "live" : "message";
    const durationMs =
      payload.durationMs ??
      (typeof payload.startedAt === "number" && typeof payload.endedAt === "number"
        ? Math.max(0, payload.endedAt - payload.startedAt)
        : undefined);
    let text = "";
    let status: "transcribed" | "empty" | "failed" = "transcribed";
    let error: string | undefined;
    let modelId: string | undefined;
    let language: string | undefined;
    try {
      const result = await transcribeFile(fileId);
      modelId = result.modelId;
      language = result.language;
      text = result.text.trim();
      if (!text) status = "empty";
    } catch (transcribeError) {
      status = "failed";
      error = transcribeError instanceof Error ? transcribeError.message : String(transcribeError);
    }
    // Silent live segments are noise; voice messages always land so the audio is never lost.
    if (status === "empty" && mode === "live") return;
    const fallbackText =
      status === "failed" ? "Voice message (transcription failed)" : "Voice message (no speech detected)";
    insertEvent({
      type: "message.created",
      source: event.source,
      channelId: event.channelId,
      parentEventId: event.id,
      idempotencyKey: `voice-transcript:${event.id}`,
      payload: {
        text: text || fallbackText,
        attachments: [
          {
            fileId,
            name: payload.attachment?.name ?? `voice-${event.id}.webm`,
            mime: payload.attachment?.mime ?? "audio/webm",
            ...(typeof payload.attachment?.size === "number" ? { size: payload.attachment.size } : {}),
            kind: "voice",
            ...(typeof durationMs === "number" ? { durationMs } : {}),
          },
        ],
        voice: {
          mode,
          status,
          chunkEventId: event.id,
          ...(payload.speakerId ? { speakerId: payload.speakerId } : {}),
          ...(payload.sessionId ? { sessionId: payload.sessionId } : {}),
          ...(typeof durationMs === "number" ? { durationMs } : {}),
          ...(modelId ? { transcribedBy: modelId } : {}),
          ...(language ? { language } : {}),
          ...(error ? { error } : {}),
        },
      },
    });
  }

  function handleEvent(event: ApiEvent) {
    if (event.type !== "voice.input.chunk" || !event.channelId) return;
    if (event.source === VOICE_TRANSCRIBER_SOURCE) return;
    const channelId = event.channelId;
    const previous = channelQueues.get(channelId) ?? Promise.resolve();
    const next = previous
      .then(() => transcribeChunk(event))
      .catch((queueError) => {
        console.error("[voice-transcriber] failed to publish transcript", queueError);
      });
    channelQueues.set(channelId, next);
    void next.finally(() => {
      if (channelQueues.get(channelId) === next) channelQueues.delete(channelId);
    });
  }

  async function idle() {
    while (channelQueues.size > 0) {
      await Promise.all([...channelQueues.values()]);
    }
  }

  return { config, transcribeFile, handleEvent, idle };
}
