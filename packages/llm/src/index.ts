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
      const text = textFromContent(message.content);
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
    system: splitMessages.system,
    messages: splitMessages.messages as any,
    ...(shouldSendTemperature ? { temperature: options.temperature } : {}),
    maxOutputTokens: options.maxTokens,
    ...(options.maxSteps !== undefined
      ? ({ maxSteps: options.maxSteps } as any)
      : {}),
    tools: normalizeToolsForSdk(options.tools),
    abortSignal: options.abortSignal,
  });
  return {
    text: result.text,
    toolCalls: (result as { toolCalls?: unknown[] }).toolCalls,
    toolResults: (result as { toolResults?: unknown[] }).toolResults,
    finishReason: (result as { finishReason?: string }).finishReason,
  };
}
