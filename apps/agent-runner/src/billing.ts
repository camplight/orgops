import type { LlmUsage } from "@orgops/llm";

export function readUsageTokenCount(usage: LlmUsage | undefined, keys: string[]) {
  if (!usage) return undefined;
  for (const key of keys) {
    const value = usage[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, Math.floor(value));
    }
  }
  return undefined;
}

export function normalizeLlmUsage(usage: LlmUsage | undefined) {
  if (!usage) return null;
  const inputTokens = readUsageTokenCount(usage, [
    "inputTokens",
    "promptTokens",
    "prompt_tokens",
  ]);
  const outputTokens = readUsageTokenCount(usage, [
    "outputTokens",
    "completionTokens",
    "completion_tokens",
  ]);
  const totalTokens = readUsageTokenCount(usage, ["totalTokens", "total_tokens"]);
  const reasoningTokens = readUsageTokenCount(usage, [
    "reasoningTokens",
    "reasoning_tokens",
  ]);
  const cachedInputTokens = readUsageTokenCount(usage, [
    "cachedInputTokens",
    "cachedPromptTokens",
    "cached_input_tokens",
    "cached_prompt_tokens",
  ]);
  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined &&
    reasoningTokens === undefined &&
    cachedInputTokens === undefined
  ) {
    return null;
  }
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
  };
}

export async function recordLlmUsage(
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>,
  input: {
    channelId?: string;
    agentName?: string;
    modelId: string;
    runtime: string;
    purpose: string;
    triggerEventId?: string;
    usage: LlmUsage | undefined;
    metadata?: Record<string, unknown>;
  },
) {
  const normalized = normalizeLlmUsage(input.usage);
  if (!normalized) return;
  try {
    await apiFetch("/api/billing/usage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channelId: input.channelId,
        agentName: input.agentName,
        modelId: input.modelId,
        runtime: input.runtime,
        purpose: input.purpose,
        triggerEventId: input.triggerEventId,
        usageSource: "provider",
        ...normalized,
        metadata: input.metadata,
      }),
    });
  } catch (error) {
    console.warn("runner.llm_usage.record_failed", error);
  }
}
