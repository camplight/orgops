import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type GenerateOptions = {
  temperature?: number;
  maxTokens?: number;
  maxSteps?: number;
  tools?: Record<string, LlmTool>;
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

  const [provider, modelName] = modelId.split(":");
  if (provider !== "openai") {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
  const result = await generateText({
    model: openai(modelName),
    messages,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    maxSteps: options.maxSteps,
    tools: options.tools as Record<string, any> | undefined,
  });
  return {
    text: result.text,
    toolCalls: (result as { toolCalls?: unknown[] }).toolCalls,
    toolResults: (result as { toolResults?: unknown[] }).toolResults,
    finishReason: (result as { finishReason?: string }).finishReason,
  };
}
