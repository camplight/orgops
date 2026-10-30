import type { GenerateOptions, GenerateResult, LlmMessage, LlmTool, LlmUsage } from "./index";

const OPENAI_REALTIME_SOCKET_URL = "wss://api.openai.com/v1/realtime";
const MAX_TOOL_OUTPUT_CHARS = 16_000;
const MAX_SERVER_ERROR_RETRIES = 2;

export type RealtimeTextSocket = {
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  addEventListener: (type: string, listener: (event: any) => void) => void;
};

export type RealtimeTextDeps = {
  connect?: (url: string, headers: Record<string, string>) => RealtimeTextSocket;
  toolJsonSchema: (tool: LlmTool) => Promise<Record<string, unknown>>;
};

type RealtimeContentPart = Record<string, unknown>;
type RealtimeItem = Record<string, unknown>;

type FunctionCall = { callId: string; name: string; arguments: string };

export function isOpenAIRealtimeModel(modelName: string) {
  return /realtime/i.test(modelName);
}

function defaultConnect(url: string, headers: Record<string, string>): RealtimeTextSocket {
  const WebSocketCtor = globalThis.WebSocket as unknown as new (
    url: string,
    init: { headers: Record<string, string> },
  ) => RealtimeTextSocket;
  return new WebSocketCtor(url, { headers });
}

function bytesToBase64(bytes: Uint8Array) {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

function imageUrlFromPart(image: unknown, mediaType: string | undefined): string | null {
  const mime = mediaType || "image/png";
  if (image instanceof URL) return image.toString();
  if (image instanceof Uint8Array) return `data:${mime};base64,${bytesToBase64(image)}`;
  if (image instanceof ArrayBuffer) return `data:${mime};base64,${bytesToBase64(new Uint8Array(image))}`;
  if (typeof image === "string" && image.trim()) {
    const value = image.trim();
    if (/^(https?:|data:)/i.test(value)) return value;
    return `data:${mime};base64,${value}`;
  }
  return null;
}

function stringify(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return String(value);
  }
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}… [truncated ${text.length - max} chars]` : text;
}

function systemText(message: LlmMessage) {
  const content = message.content as unknown;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as Array<Record<string, any>>)
    .filter((part) => part.type === "text")
    .map((part) => String(part.text ?? ""))
    .join("\n");
}

/**
 * Session instructions are capped (16,384 tokens), so only the leading system
 * prompt goes there. Later system messages (history records, retry notes)
 * stay in the conversation as system items, in order.
 */
export function splitRealtimeInstructions(
  messages: LlmMessage[],
): { instructions: string | undefined; messages: LlmMessage[] } {
  const leading: string[] = [];
  let index = 0;
  while (index < messages.length && messages[index]?.role === "system") {
    const text = systemText(messages[index]!).trim();
    if (text) leading.push(text);
    index += 1;
  }
  return {
    instructions: leading.join("\n\n") || undefined,
    messages: messages.slice(index),
  };
}

/** Converts AI SDK messages into Realtime conversation items. */
export function toRealtimeItems(messages: LlmMessage[]): RealtimeItem[] {
  const items: RealtimeItem[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      const text = systemText(message).trim();
      if (text) items.push({ type: "message", role: "system", content: [{ type: "input_text", text }] });
      continue;
    }
    const assistant = message.role === "assistant";
    const textType = assistant ? "output_text" : "input_text";
    const parts: RealtimeContentPart[] = [];
    const content = message.content as unknown;
    if (typeof content === "string") {
      if (content.trim()) parts.push({ type: textType, text: content });
    } else if (Array.isArray(content)) {
      for (const part of content as Array<Record<string, any>>) {
        if (part.type === "text") {
          if (String(part.text ?? "").trim()) parts.push({ type: textType, text: String(part.text) });
        } else if (part.type === "image" && !assistant) {
          const url = imageUrlFromPart(part.image, part.mediaType);
          if (url) parts.push({ type: "input_image", image_url: url });
        } else if (part.type === "tool-call") {
          parts.push({ type: textType, text: `[tool call ${part.toolName}] ${stringify(part.input ?? part.args)}` });
        } else if (part.type === "tool-result") {
          parts.push({
            type: textType,
            text: `[tool result ${part.toolName}] ${truncate(stringify(part.output ?? part.result), MAX_TOOL_OUTPUT_CHARS)}`,
          });
        } else if (part.type === "file") {
          parts.push({ type: textType, text: `[file ${part.filename ?? part.mediaType ?? "attachment"} omitted]` });
        }
      }
    }
    if (parts.length === 0) continue;
    items.push({ type: "message", role: assistant ? "assistant" : "user", content: parts });
  }
  return items;
}

function addUsage(total: LlmUsage, usage: any) {
  if (!usage || typeof usage !== "object") return;
  const add = (key: keyof LlmUsage, value: unknown) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    total[key] = ((total[key] as number | undefined) ?? 0) + value;
  };
  add("inputTokens", usage.input_tokens);
  add("outputTokens", usage.output_tokens);
  add("totalTokens", usage.total_tokens);
  add("cachedInputTokens", usage.input_token_details?.cached_tokens);
}

async function runTool(tool: LlmTool | undefined, name: string, rawArgs: string): Promise<unknown> {
  if (!tool?.execute) return { error: `Unknown tool: ${name}` };
  let args: unknown;
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch (error) {
    return { error: `Tool arguments are not valid JSON: ${String(error)}` };
  }
  const schema = (tool.inputSchema ?? tool.parameters) as
    | { safeParse?: (value: unknown) => { success: boolean; data?: unknown; error?: unknown } }
    | undefined;
  if (schema && typeof schema.safeParse === "function") {
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      return { error: `Invalid tool arguments for ${name}: ${stringify(parsed.error)}` };
    }
    args = parsed.data;
  }
  try {
    return await tool.execute(args);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Text-mode turn against an OpenAI realtime model over the Realtime WebSocket.
 * Realtime models are not served by chat completions, so tool-calling turns
 * are driven here: one response per step, tools executed locally between steps.
 */
export async function generateWithOpenAIRealtime(
  modelName: string,
  system: string | undefined,
  messages: LlmMessage[],
  options: GenerateOptions & { apiKey: string },
  deps: RealtimeTextDeps,
): Promise<GenerateResult> {
  if (!options.apiKey) throw new Error("OPENAI_API_KEY is required for OpenAI realtime models.");
  const tools = options.tools ?? {};
  const toolDefs = await Promise.all(
    Object.entries(tools).map(async ([name, tool]) => ({
      type: "function",
      name,
      description: tool.description ?? "",
      parameters: await deps.toolJsonSchema(tool),
    })),
  );
  const maxSteps =
    options.maxSteps !== undefined && Number.isFinite(options.maxSteps) && options.maxSteps > 0
      ? Math.floor(options.maxSteps)
      : 1;
  const connect = deps.connect ?? defaultConnect;
  const socket = connect(`${OPENAI_REALTIME_SOCKET_URL}?model=${encodeURIComponent(modelName)}`, {
    Authorization: `Bearer ${options.apiKey}`,
  });

  type Waiter = { resolve: (message: any) => void; reject: (error: Error) => void; types: Set<string> };
  let waiter: Waiter | null = null;
  let failure: Error | null = null;
  const queue: any[] = [];

  const fail = (error: Error) => {
    if (failure) return;
    failure = error;
    waiter?.reject(error);
    waiter = null;
  };
  const nextOf = (...types: string[]): Promise<any> => {
    const index = queue.findIndex((message) => types.includes(message?.type));
    if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
    if (failure) return Promise.reject(failure);
    return new Promise((resolve, reject) => {
      waiter = { resolve, reject, types: new Set(types) };
    });
  };
  const send = (message: Record<string, unknown>) => socket.send(JSON.stringify(message));

  socket.addEventListener("message", (event: { data?: unknown }) => {
    let message: any;
    try {
      message = JSON.parse(String(event.data ?? ""));
    } catch {
      return;
    }
    if (message?.type === "error") {
      fail(new Error(`OpenAI realtime error: ${message.error?.message ?? stringify(message.error)}`));
      return;
    }
    if (waiter && waiter.types.has(message?.type)) {
      const current = waiter;
      waiter = null;
      current.resolve(message);
      return;
    }
    if (message?.type === "session.created" || message?.type === "session.updated" || message?.type === "response.done") {
      queue.push(message);
    }
  });
  socket.addEventListener("error", (event: { message?: string }) => {
    fail(new Error(`OpenAI realtime socket error: ${event?.message ?? "unknown"}`));
  });
  socket.addEventListener("close", () => fail(new Error("OpenAI realtime socket closed before the turn finished.")));
  const onAbort = () => fail(new Error("OpenAI realtime turn aborted."));
  options.abortSignal?.addEventListener("abort", onAbort, { once: true });

  const usage: LlmUsage = {};
  const toolCalls: unknown[] = [];
  const toolResults: unknown[] = [];
  try {
    await nextOf("session.created");
    send({
      type: "session.update",
      session: {
        type: "realtime",
        output_modalities: ["text"],
        ...(system ? { instructions: system } : {}),
        ...(toolDefs.length > 0 ? { tools: toolDefs, tool_choice: "auto" } : {}),
        ...(options.maxTokens ? { max_output_tokens: options.maxTokens } : {}),
      },
    });
    await nextOf("session.updated");
    for (const item of toRealtimeItems(messages)) {
      send({ type: "conversation.item.create", item });
    }

    let text = "";
    let finishReason = "stop";
    for (let step = 1; step <= maxSteps; step += 1) {
      let response: any = {};
      for (let attempt = 0; attempt <= MAX_SERVER_ERROR_RETRIES; attempt += 1) {
        send({ type: "response.create" });
        const done = await nextOf("response.done");
        response = done.response ?? {};
        addUsage(usage, response.usage);
        const transient = response.status_details?.error?.type === "server_error";
        if (response.status !== "failed" || !transient || attempt === MAX_SERVER_ERROR_RETRIES) break;
      }
      if (response.status === "failed") {
        throw new Error(`OpenAI realtime response failed: ${stringify(response.status_details)}`);
      }
      const output: any[] = Array.isArray(response.output) ? response.output : [];
      text = output
        .filter((item) => item?.type === "message")
        .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
        .map((part: any) => String(part?.text ?? part?.transcript ?? ""))
        .join("")
        .trim();
      const calls: FunctionCall[] = output
        .filter((item) => item?.type === "function_call")
        .map((item) => ({
          callId: String(item.call_id ?? ""),
          name: String(item.name ?? ""),
          arguments: String(item.arguments ?? ""),
        }))
        .filter((call) => call.callId && call.name);
      if (response.status === "incomplete") finishReason = "length";
      if (calls.length === 0) break;
      // Like the AI SDK: a call to a tool without execute ends the loop and is returned to the caller.
      const terminalCalls = calls.filter((call) => tools[call.name] && !tools[call.name]?.execute);
      if (terminalCalls.length > 0) {
        for (const call of terminalCalls) {
          toolCalls.push({ toolCallId: call.callId, toolName: call.name, input: call.arguments });
        }
        finishReason = "tool-calls";
        break;
      }
      for (const call of calls) {
        const result = await runTool(tools[call.name], call.name, call.arguments);
        toolCalls.push({ toolCallId: call.callId, toolName: call.name, input: call.arguments });
        toolResults.push({ toolCallId: call.callId, toolName: call.name, output: result });
        send({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: call.callId,
            output: truncate(stringify(result), MAX_TOOL_OUTPUT_CHARS),
          },
        });
      }
      const pulled = (await options.pullMessages?.()) ?? [];
      for (const item of toRealtimeItems(pulled)) {
        send({ type: "conversation.item.create", item });
      }
      finishReason = step === maxSteps ? "tool-calls" : "stop";
    }
    return { text, toolCalls, toolResults, finishReason, usage };
  } finally {
    options.abortSignal?.removeEventListener("abort", onAbort);
    failure = failure ?? new Error("closed");
    try {
      socket.close(1000, "turn complete");
    } catch {}
  }
}
