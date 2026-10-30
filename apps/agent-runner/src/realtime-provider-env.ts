import { isRealtimeVoiceModel } from "./voice-runtime";
import type { Agent } from "./types";

const PROVIDER_ENV_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENROUTER_API_KEY",
  "MISTRAL_API_KEY",
  "LIQUID_API_KEY",
  "LIQUID_BASE_URL",
  "OPENAI_COMPATIBLE_API_KEY",
  "OPENAI_COMPATIBLE_BASE_URL",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
] as const;

function splitModelId(modelId: string) {
  const colon = modelId.indexOf(":");
  const provider = colon > 0 ? modelId.slice(0, colon).trim().toLowerCase() : "";
  const modelName = colon > 0 ? modelId.slice(colon + 1).trim() : modelId.trim();
  return { provider, modelName };
}

export function isRealtimeAgent(agent: Pick<Agent, "modelId" | "modelCapabilities">) {
  if (agent.modelCapabilities?.realtimeAudioInput || agent.modelCapabilities?.realtimeAudioOutput) {
    return true;
  }
  const { provider, modelName } = splitModelId(agent.modelId);
  return isRealtimeVoiceModel(provider, modelName);
}

export function withHostProviderEnvFallback(
  env: Record<string, string>,
  hostEnv: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const merged = { ...env };
  for (const key of PROVIDER_ENV_KEYS) {
    if (merged[key]?.trim()) continue;
    const value = hostEnv[key]?.trim();
    if (value) merged[key] = value;
  }
  return merged;
}

export function withRealtimeHostProviderEnvFallback(
  agent: Pick<Agent, "modelId" | "modelCapabilities">,
  env: Record<string, string>,
  hostEnv: Record<string, string | undefined> = process.env,
): Record<string, string> {
  return isRealtimeAgent(agent) ? withHostProviderEnvFallback(env, hostEnv) : env;
}
