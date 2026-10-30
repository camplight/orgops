import { connectGeminiLiveRuntime } from "./gemini";
import { connectOpenAiCompatibleRuntime } from "./openai-compat";
import type { VoiceRuntimeConnectInput, VoiceRuntimeSession } from "./types";

export type { VoiceRuntimeConnectInput, VoiceRuntimeEvent, VoiceRuntimeSession, VoiceRuntimeTool } from "./types";
export { openaiCompatibleRealtimeUrl, openaiRealtimeVadConfig } from "./openai-compat";
export { geminiLiveUrl, geminiModelName } from "./gemini";
export { resamplePcm16 } from "./pcm";

export function normalizeVoiceProvider(provider: string) {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "gemini") return "google";
  if (normalized === "liquidai") return "liquid";
  if (normalized === "openai_compatible") return "openai-compatible";
  return normalized;
}

export function isRealtimeVoiceModel(provider: string, modelName: string) {
  const p = normalizeVoiceProvider(provider);
  const model = modelName.trim().toLowerCase();
  if (p === "openai") return /realtime/i.test(model);
  if (p === "google") return model.includes("live") || model.includes("native-audio");
  if (p === "liquid" || p === "openai-compatible") {
    return model.includes("audio") || model.includes("realtime") || model.includes("omni");
  }
  return false;
}

export function resolveVoiceRuntimeCredentials(
  provider: string,
  env: Record<string, string | undefined>,
): { apiKey: string; baseUrl?: string } | null {
  const p = normalizeVoiceProvider(provider);
  if (p === "openai") {
    const apiKey = env.OPENAI_API_KEY?.trim();
    return apiKey ? { apiKey, baseUrl: "https://api.openai.com/v1" } : null;
  }
  if (p === "google") {
    const apiKey = env.GOOGLE_API_KEY?.trim() || env.GEMINI_API_KEY?.trim();
    return apiKey ? { apiKey } : null;
  }
  if (p === "liquid") {
    const apiKey = env.LIQUID_API_KEY?.trim() || env.OPENAI_COMPATIBLE_API_KEY?.trim();
    const baseUrl = env.LIQUID_BASE_URL?.trim() || env.OPENAI_COMPATIBLE_BASE_URL?.trim() || "https://labs.liquid.ai/api/v1";
    return apiKey ? { apiKey, baseUrl } : null;
  }
  if (p === "openai-compatible") {
    const apiKey = env.OPENAI_COMPATIBLE_API_KEY?.trim() || "local";
    const baseUrl = env.OPENAI_COMPATIBLE_BASE_URL?.trim();
    return baseUrl ? { apiKey, baseUrl } : null;
  }
  return null;
}

export function connectVoiceRuntime(input: VoiceRuntimeConnectInput): VoiceRuntimeSession {
  const provider = normalizeVoiceProvider(input.provider);
  if (provider === "google") return connectGeminiLiveRuntime(input);
  if (provider === "openai" || provider === "liquid" || provider === "openai-compatible") {
    return connectOpenAiCompatibleRuntime({
      ...input,
      baseUrl:
        input.baseUrl ||
        (provider === "liquid" ? "https://labs.liquid.ai/api/v1" : "https://api.openai.com/v1"),
    });
  }
  throw new Error(`Realtime voice provider "${input.provider}" is not supported`);
}
