import { z } from "zod";

export const ModelCapabilitiesSchema = z
  .object({
    textInput: z.boolean().optional(),
    textOutput: z.boolean().optional(),
    imageInput: z.boolean().optional(),
    audioInput: z.boolean().optional(),
    audioOutput: z.boolean().optional(),
    realtimeAudioInput: z.boolean().optional(),
    realtimeAudioOutput: z.boolean().optional(),
    multiSpeakerRealtimeAudioInput: z.boolean().optional(),
    activeSpeakerRealtimeAudioInput: z.boolean().optional(),
    toolCalling: z.boolean().optional(),
    /** Whether this model can run regular queued CLASSIC turns outside a realtime voice session. */
    classicTurns: z.boolean().optional(),
    /** How native turns return their final output: a JSON event object, or plain text posted as the reply. */
    replyContract: z.enum(["json", "plain-text"]).optional(),
    /** Overrides model metadata when sizing prompt history. */
    contextWindowTokens: z.number().int().positive().optional(),
  })
  .passthrough();

export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>;
export type ReplyContract = NonNullable<ModelCapabilities["replyContract"]>;

export function normalizeModelCapabilities(input: unknown): ModelCapabilities {
  const parsed = ModelCapabilitiesSchema.safeParse(input);
  if (!parsed.success) return {};
  return Object.fromEntries(
    Object.entries(parsed.data).filter(
      ([key, value]) =>
        typeof value === "boolean" ||
        (key === "replyContract" && typeof value === "string") ||
        (key === "contextWindowTokens" && typeof value === "number"),
    ),
  ) as ModelCapabilities;
}

export function mergeModelCapabilities(
  base: ModelCapabilities,
  override: ModelCapabilities,
): ModelCapabilities {
  return {
    ...base,
    ...override,
  };
}

export function inferModelCapabilities(providerInput: string, modelNameInput: string): ModelCapabilities {
  const provider = providerInput.trim().toLowerCase();
  const modelName = modelNameInput.trim().toLowerCase();
  const capabilities: ModelCapabilities = {
    textInput: true,
    textOutput: true,
    toolCalling: true,
  };

  if (
    modelName.includes("gpt-4o") ||
    modelName.includes("gpt-4.1") ||
    modelName.includes("gpt-5") ||
    modelName.includes("claude-3") ||
    modelName.includes("claude-4") ||
    modelName.includes("mistral") ||
    modelName.includes("pixtral") ||
    modelName.includes("gemini") ||
    (provider === "liquid" && (modelName.includes("vl") || modelName.includes("vision")))
  ) {
    capabilities.imageInput = true;
  }

  if (provider === "openai" && modelName.includes("realtime")) {
    capabilities.audioInput = true;
    capabilities.audioOutput = true;
    capabilities.realtimeAudioInput = true;
    capabilities.realtimeAudioOutput = true;
    capabilities.activeSpeakerRealtimeAudioInput = true;
    capabilities.imageInput = true;
    capabilities.replyContract = "plain-text";
    capabilities.contextWindowTokens = 32_000;
  }

  if (provider === "mistral" && modelName.includes("voxtral")) {
    capabilities.audioInput = true;
    if (modelName.includes("tts")) {
      capabilities.audioOutput = true;
      capabilities.textInput = true;
    }
    if (modelName.includes("realtime") || modelName.includes("voice-agent")) {
      capabilities.realtimeAudioInput = true;
      capabilities.realtimeAudioOutput = true;
      capabilities.activeSpeakerRealtimeAudioInput = true;
      capabilities.audioOutput = true;
    }
  }

  if (
    (provider === "google" || provider === "gemini") &&
    (modelName.includes("live") || modelName.includes("native-audio"))
  ) {
    capabilities.audioInput = true;
    capabilities.audioOutput = true;
    capabilities.realtimeAudioInput = true;
    capabilities.realtimeAudioOutput = true;
    capabilities.multiSpeakerRealtimeAudioInput = true;
    capabilities.imageInput = true;
    capabilities.replyContract = "plain-text";
    capabilities.classicTurns = false;
  }

  if (
    (provider === "liquid" || provider === "openai-compatible") &&
    (modelName.includes("audio") || modelName.includes("realtime") || modelName.includes("omni"))
  ) {
    capabilities.audioInput = true;
    capabilities.audioOutput = true;
    capabilities.realtimeAudioInput = true;
    capabilities.realtimeAudioOutput = true;
    capabilities.activeSpeakerRealtimeAudioInput = true;
    capabilities.replyContract = "plain-text";
  }

  return capabilities;
}

export function resolveReplyContract(
  modelId: string,
  capabilities?: ModelCapabilities,
): ReplyContract {
  if (capabilities?.replyContract) return capabilities.replyContract;
  const separator = modelId.indexOf(":");
  const provider = separator > 0 ? modelId.slice(0, separator) : "";
  const modelName = separator > 0 ? modelId.slice(separator + 1) : modelId;
  return inferModelCapabilities(provider, modelName).replyContract ?? "json";
}

export function resolveModelCapabilities(
  provider: string,
  modelName: string,
  defaults?: Record<string, unknown>,
): ModelCapabilities {
  return mergeModelCapabilities(
    inferModelCapabilities(provider, modelName),
    normalizeModelCapabilities(defaults?.capabilities),
  );
}
