import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";

export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: LlmMessageContent;
};

export type LlmTextPart = {
  type: "text";
  text: string;
};

export type LlmImagePart = {
  type: "image";
  image: Uint8Array | string;
  mimeType?: string;
};

export type LlmMessageContent = string | Array<LlmTextPart | LlmImagePart>;

export type GenerateOptions = {
  temperature?: number;
  maxTokens?: number;
  maxSteps?: number;
  tools?: Record<string, LlmTool>;
  abortSignal?: AbortSignal;
  /** Env vars for API keys etc.; overrides process.env when set. Used by runner to inject package secrets. */
  env?: Record<string, string | undefined>;
  /** Optional hook called between model steps to append fresh messages. */
  pullMessages?: () => Promise<LlmMessage[] | undefined>;
};

export type GenerateResult = {
  text: string;
  toolCalls?: unknown[];
  toolResults?: unknown[];
  finishReason?: string;
};

export type LlmTool = {
  description?: string;
  parameters?: unknown;
  execute?: (args: any) => Promise<unknown> | unknown;
};

export function isOpenAICompletionModel(modelName: string) {
  return /(codex|instruct)/i.test(modelName);
}

function normalizeProvider(provider: string) {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "claude") return "anthropic";
  return normalized;
}

export async function generate(
  modelId: string,
  messages: LlmMessage[],
  options: GenerateOptions = {},
) {
  const env = {
    ...process.env,
    ...(options.env ?? {}),
  };
  if (env.ORGOPS_LLM_STUB === "1") {
    return { text: "LLM stub response.", toolCalls: [], toolResults: [] };
  }

  const [rawProvider, modelName] = modelId.split(":");
  if (!rawProvider || !modelName) {
    throw new Error(`Invalid modelId format: ${modelId}. Expected "provider:model".`);
  }
  const provider = normalizeProvider(rawProvider);

  let model: any;
  if (provider === "openai") {
    const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
    const useCompletionModel = isOpenAICompletionModel(modelName);
    if (
      useCompletionModel &&
      options.tools &&
      Object.keys(options.tools).length > 0
    ) {
      throw new Error(
        `OpenAI completion model "${modelName}" does not support tools in this runtime. Use a chat model (e.g. gpt-4o-mini) when passing tools.`,
      );
    }
    model = useCompletionModel ? openai.completion(modelName) : openai.chat(modelName);
  } else if (provider === "anthropic") {
    const anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });
    model = anthropic(modelName);
  } else {
    throw new Error(`Unsupported provider: ${rawProvider}`);
  }

  const result = await generateText({
    model,
    messages: messages as any,
    temperature: options.temperature,
    maxOutputTokens: options.maxTokens,
    ...(options.maxSteps !== undefined
      ? ({ maxSteps: options.maxSteps } as any)
      : {}),
    tools: options.tools as Record<string, any> | undefined,
    abortSignal: options.abortSignal,
  });
  return {
    text: result.text,
    toolCalls: (result as { toolCalls?: unknown[] }).toolCalls,
    toolResults: (result as { toolResults?: unknown[] }).toolResults,
    finishReason: (result as { finishReason?: string }).finishReason,
  };
}
