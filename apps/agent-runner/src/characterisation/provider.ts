import { http, HttpResponse } from "msw";

export const PROVIDER_ORIGIN = "http://provider.test/v1";

type ToolCallResponse = {
  id: string;
  name: string;
  arguments: unknown;
};

type ProviderUsage = {
  promptTokens: number;
  completionTokens: number;
};

type ChatCompletionOptions = {
  text?: string;
  toolCalls?: ToolCallResponse[];
  usage?: ProviderUsage;
};

type ChatCompletionRequest = {
  model: string;
  messages: Array<{ role: string; content: unknown; tool_call_id?: string }>;
  tools?: unknown[];
};

export const chatCompletion = (options: ChatCompletionOptions = {}) => {
  const { text = "", toolCalls = [], usage } = options;
  return HttpResponse.json({
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 0,
    model: "test-model",
    choices: [
      {
        index: 0,
        finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
        message: {
          role: "assistant",
          content: toolCalls.length > 0 ? null : text,
          ...(toolCalls.length > 0
            ? {
                tool_calls: toolCalls.map((call) => ({
                  id: call.id,
                  type: "function",
                  function: {
                    name: call.name,
                    arguments: JSON.stringify(call.arguments),
                  },
                })),
              }
            : {}),
        },
      },
    ],
    ...(usage
      ? {
          usage: {
            prompt_tokens: usage.promptTokens,
            completion_tokens: usage.completionTokens,
            total_tokens: usage.promptTokens + usage.completionTokens,
          },
        }
      : {}),
  });
};

type ProviderResponder = (
  request: ChatCompletionRequest,
  callIndex: number,
) => Response | Promise<Response>;

export const createFakeProvider = (responders: ProviderResponder[]) => {
  const requests: ChatCompletionRequest[] = [];
  const handler = http.post(`${PROVIDER_ORIGIN}/chat/completions`, async ({ request }) => {
    const body = (await request.json()) as ChatCompletionRequest;
    const callIndex = requests.length;
    requests.push(body);
    const responder = responders[Math.min(callIndex, responders.length - 1)];
    if (!responder) throw new Error("fake provider has no responder");
    return responder(body, callIndex);
  });
  return { handler, requests };
};

export const replyWithText = (text: string): ProviderResponder => () => chatCompletion({ text });

export const replyWithEvent = (event: {
  type: string;
  payload: unknown;
  channelId?: string;
}): ProviderResponder => replyWithText(JSON.stringify(event));
