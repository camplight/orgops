import { generateText, stepCountIs } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { ImagePart, ModelMessage, TextPart } from "ai";

export type LlmMessage = ModelMessage;

export type LlmTextPart = TextPart;
export type LlmImagePart = ImagePart;
export type LlmToolResultOutput =
  | { type: "text"; value: string; providerOptions?: unknown }
  | { type: "json"; value: unknown; providerOptions?: unknown }
  | { type: "execution-denied"; reason?: string; providerOptions?: unknown }
  | { type: "error-text"; value: string; providerOptions?: unknown }
  | { type: "error-json"; value: unknown; providerOptions?: unknown }
  | { type: "content"; value: Array<Record<string, unknown>> };
export type LlmToolContent = Array<{
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  output: LlmToolResultOutput;
  providerOptions?: unknown;
}>;

export type LlmMessageContent = LlmMessage["content"];

export type GenerateOptions = {
  temperature?: number;
  maxTokens?: number;
  /** Maximum tool-loop steps for AI SDK generateText. */
  maxSteps?: number;
  tools?: Record<string, LlmTool>;
  abortSignal?: AbortSignal;
  /** Env vars for API keys etc.; overrides process.env when set. Used by runner to inject package secrets. */
  env?: Record<string, string | undefined>;
  /** Optional hook called between model steps to append fresh messages. */
  pullMessages?: () => Promise<LlmMessage[] | undefined>;
};

export type LlmUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  [key: string]: unknown;
};

export type GenerateResult = {
  text: string;
  toolCalls?: unknown[];
  toolResults?: unknown[];
  finishReason?: string;
  usage?: LlmUsage;
  providerMetadata?: unknown;
};

export type LlmTool = {
  description?: string;
  parameters?: unknown;
  inputSchema?: unknown;
  execute?: (args: any) => Promise<unknown> | unknown;
};

function normalizeToolsForSdk(tools?: Record<string, LlmTool>) {
  if (!tools) return undefined;
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => [
      name,
      {
        description: tool.description,
        // AI SDK v6 uses inputSchema; keep backwards compatibility with parameters.
        inputSchema: (tool as { inputSchema?: unknown }).inputSchema ?? tool.parameters,
        execute: tool.execute,
      },
    ])
  ) as Record<string, any>;
}

export function isOpenAICompletionModel(modelName: string) {
  return /(codex|instruct)/i.test(modelName);
}

export function isOpenAIReasoningModel(modelName: string) {
  const normalized = modelName.trim().toLowerCase();
  const vendorQualifiedName = normalized.includes("/")
    ? normalized.slice(normalized.lastIndexOf("/") + 1)
    : normalized;
  return (
    /^(gpt-5(\.|-|$)|o[1-9](\.|-|$))/i.test(normalized) ||
    /^(gpt-5(\.|-|$)|o[1-9](\.|-|$))/i.test(vendorQualifiedName)
  );
}

function normalizeProvider(provider: string) {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "claude") return "anthropic";
  if (normalized === "or") return "openrouter";
  return normalized;
}

function textFromContent(content: LlmMessageContent): string {
  if (typeof content === "string") return content;
  return content
    .filter((part): part is LlmTextPart => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function splitSystemMessages(messages: LlmMessage[]) {
  const systemBlocks: string[] = [];
  const nonSystemMessages: LlmMessage[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      const text = typeof message.content === "string" ? message.content : textFromContent(message.content);
      if (text) systemBlocks.push(text);
      continue;
    }
    nonSystemMessages.push(message);
  }
  return {
    system: systemBlocks.length > 0 ? systemBlocks.join("\n\n") : undefined,
    messages: nonSystemMessages,
  };
}

function buildPromptArgs(splitMessages: ReturnType<typeof splitSystemMessages>) {
  if (splitMessages.messages.length > 0) {
    return {
      system: splitMessages.system,
      messages: splitMessages.messages as any,
    };
  }
  const prompt = splitMessages.system?.trim();
  if (!prompt) {
    throw new Error("LLM generate requires at least one non-empty message.");
  }
  return { prompt };
}

function readTokenCount(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, Math.floor(value));
    }
  }
  return undefined;
}

function normalizeUsage(value: unknown): LlmUsage | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const usage: LlmUsage = { ...record };
  const inputTokens = readTokenCount(record, ["inputTokens", "promptTokens", "prompt_tokens"]);
  const outputTokens = readTokenCount(record, [
    "outputTokens",
    "completionTokens",
    "completion_tokens",
  ]);
  const totalTokens = readTokenCount(record, ["totalTokens", "total_tokens"]);
  const reasoningTokens = readTokenCount(record, ["reasoningTokens", "reasoning_tokens"]);
  const cachedInputTokens = readTokenCount(record, [
    "cachedInputTokens",
    "cachedPromptTokens",
    "cached_input_tokens",
    "cached_prompt_tokens",
  ]);
  if (inputTokens !== undefined) usage.inputTokens = inputTokens;
  if (outputTokens !== undefined) usage.outputTokens = outputTokens;
  if (totalTokens !== undefined) usage.totalTokens = totalTokens;
  if (reasoningTokens !== undefined) usage.reasoningTokens = reasoningTokens;
  if (cachedInputTokens !== undefined) usage.cachedInputTokens = cachedInputTokens;
  return usage;
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
  } else if (provider === "openrouter") {
    const openrouter = createOpenAI({
      apiKey: env.OPENROUTER_API_KEY,
      baseURL: env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
      headers: {
        ...(env.OPENROUTER_HTTP_REFERER ? { "HTTP-Referer": env.OPENROUTER_HTTP_REFERER } : {}),
        ...(env.OPENROUTER_APP_TITLE ? { "X-Title": env.OPENROUTER_APP_TITLE } : {}),
      },
    });
    model = openrouter.chat(modelName);
  } else if (provider === "anthropic") {
    const anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });
    model = anthropic(modelName);
  } else {
    throw new Error(`Unsupported provider: ${rawProvider}`);
  }

  const splitMessages = splitSystemMessages(messages);
  const shouldSendTemperature =
    options.temperature !== undefined &&
    !(
      (provider === "openai" || provider === "openrouter") &&
      isOpenAIReasoningModel(modelName)
    );

  const result = await generateText({
    model,
    ...buildPromptArgs(splitMessages),
    ...(shouldSendTemperature ? { temperature: options.temperature } : {}),
    maxOutputTokens: options.maxTokens,
    ...(options.maxSteps !== undefined && Number.isFinite(options.maxSteps) && options.maxSteps > 0
      ? { stopWhen: stepCountIs(Math.floor(options.maxSteps)) }
      : {}),
    tools: normalizeToolsForSdk(options.tools),
    abortSignal: options.abortSignal,
  });
  return {
    text: result.text,
    toolCalls: (result as { toolCalls?: unknown[] }).toolCalls,
    toolResults: (result as { toolResults?: unknown[] }).toolResults,
    finishReason: (result as { finishReason?: string }).finishReason,
    usage: normalizeUsage((result as { usage?: unknown }).usage),
    providerMetadata: (result as { providerMetadata?: unknown }).providerMetadata,
  };
}
