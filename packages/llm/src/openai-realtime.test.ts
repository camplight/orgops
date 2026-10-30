import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  generateWithOpenAIRealtime,
  splitRealtimeInstructions,
  toRealtimeItems,
  type RealtimeTextSocket,
} from "./openai-realtime";

function createFakeRealtime(responses: Array<Record<string, unknown>>) {
  const sent: any[] = [];
  const listeners = new Map<string, Array<(event: any) => void>>();
  let connectedUrl = "";
  let connectedHeaders: Record<string, string> = {};
  const emit = (type: string, event: any) => {
    for (const listener of listeners.get(type) ?? []) listener(event);
  };
  const serverSend = (message: Record<string, unknown>) =>
    queueMicrotask(() => emit("message", { data: JSON.stringify(message) }));
  const socket: RealtimeTextSocket = {
    send: (data) => {
      const message = JSON.parse(data);
      sent.push(message);
      if (message.type === "session.update") serverSend({ type: "session.updated" });
      if (message.type === "response.create") {
        const response = responses.shift();
        serverSend({ type: "response.done", response });
      }
    },
    close: () => emit("close", {}),
    addEventListener: (type, listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
  };
  return {
    sent,
    get url() {
      return connectedUrl;
    },
    get headers() {
      return connectedHeaders;
    },
    connect: (url: string, headers: Record<string, string>) => {
      connectedUrl = url;
      connectedHeaders = headers;
      serverSend({ type: "session.created" });
      return socket;
    },
  };
}

const toolJsonSchema = async () => ({ type: "object", properties: { path: { type: "string" } } });

describe("generateWithOpenAIRealtime", () => {
  it("runs tool calls between steps and returns the final text with usage", async () => {
    const fake = createFakeRealtime([
      {
        status: "completed",
        output: [{ type: "function_call", call_id: "call-1", name: "fs_list", arguments: '{"path":"."}' }],
        usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
      },
      {
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text: '{"type":"message.created"}' }] }],
        usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25, input_token_details: { cached_tokens: 8 } },
      },
    ]);
    const executed: unknown[] = [];
    const result = await generateWithOpenAIRealtime(
      "gpt-realtime",
      "Reply with JSON.",
      [{ role: "user", content: "list files" }],
      {
        apiKey: "sk-test",
        maxSteps: 4,
        tools: {
          fs_list: {
            description: "List files",
            inputSchema: z.object({ path: z.string() }),
            execute: async (args) => {
              executed.push(args);
              return { entries: ["a.txt"] };
            },
          },
        },
      },
      { connect: fake.connect, toolJsonSchema },
    );

    expect(fake.url).toBe("wss://api.openai.com/v1/realtime?model=gpt-realtime");
    expect(fake.headers.Authorization).toBe("Bearer sk-test");
    expect(executed).toEqual([{ path: "." }]);
    expect(result.text).toBe('{"type":"message.created"}');
    expect(result.usage).toEqual({ inputTokens: 30, outputTokens: 7, totalTokens: 37, cachedInputTokens: 8 });
    const sessionUpdate = fake.sent.find((message) => message.type === "session.update");
    expect(sessionUpdate.session).toMatchObject({
      type: "realtime",
      output_modalities: ["text"],
      instructions: "Reply with JSON.",
      tool_choice: "auto",
    });
    expect(sessionUpdate.session.tools[0]).toMatchObject({ type: "function", name: "fs_list" });
    expect(fake.sent).toContainEqual({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: "call-1", output: '{"entries":["a.txt"]}' },
    });
    expect(fake.sent.filter((message) => message.type === "response.create")).toHaveLength(2);
  });

  it("returns invalid tool arguments to the model instead of executing", async () => {
    const fake = createFakeRealtime([
      { status: "completed", output: [{ type: "function_call", call_id: "c", name: "fs_list", arguments: "{}" }] },
      { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }] },
    ]);
    let executed = false;
    await generateWithOpenAIRealtime(
      "gpt-realtime",
      undefined,
      [{ role: "user", content: "go" }],
      {
        apiKey: "sk-test",
        maxSteps: 3,
        tools: {
          fs_list: {
            inputSchema: z.object({ path: z.string() }),
            execute: async () => {
              executed = true;
            },
          },
        },
      },
      { connect: fake.connect, toolJsonSchema },
    );
    expect(executed).toBe(false);
    const output = fake.sent.find((message) => message.item?.type === "function_call_output");
    expect(output.item.output).toContain("Invalid tool arguments for fs_list");
  });

  it("stops on a call to a tool without execute and returns it", async () => {
    const fake = createFakeRealtime([
      { status: "completed", output: [{ type: "function_call", call_id: "n", name: "noop", arguments: '{"reason":"not for me"}' }] },
    ]);
    const result = await generateWithOpenAIRealtime(
      "gpt-realtime",
      undefined,
      [{ role: "user", content: "hi" }],
      { apiKey: "k", maxSteps: 4, tools: { noop: { inputSchema: z.object({ reason: z.string().optional() }) } } },
      { connect: fake.connect, toolJsonSchema },
    );
    expect(result.toolCalls).toEqual([{ toolCallId: "n", toolName: "noop", input: '{"reason":"not for me"}' }]);
    expect(result.finishReason).toBe("tool-calls");
    expect(fake.sent.filter((message) => message.type === "response.create")).toHaveLength(1);
    expect(fake.sent.some((message) => message.item?.type === "function_call_output")).toBe(false);
  });

  it("retries transient server errors", async () => {
    const fake = createFakeRealtime([
      { status: "failed", status_details: { error: { type: "server_error", message: "try again" } } },
      { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "recovered" }] }] },
    ]);
    const result = await generateWithOpenAIRealtime(
      "gpt-realtime",
      undefined,
      [{ role: "user", content: "hi" }],
      { apiKey: "k" },
      { connect: fake.connect, toolJsonSchema },
    );
    expect(result.text).toBe("recovered");
  });

  it("surfaces failed responses as errors", async () => {
    const fake = createFakeRealtime([
      { status: "failed", status_details: { error: { message: "boom" } } },
    ]);
    await expect(
      generateWithOpenAIRealtime("gpt-realtime", undefined, [{ role: "user", content: "hi" }], { apiKey: "k" }, {
        connect: fake.connect,
        toolJsonSchema,
      }),
    ).rejects.toThrow("boom");
  });
});

describe("splitRealtimeInstructions", () => {
  it("keeps only the leading system prompt as instructions and later system messages in order", () => {
    const split = splitRealtimeInstructions(
      [
        { role: "system", content: "base prompt" },
        { role: "system", content: "memory summary" },
        { role: "user", content: "hi" },
        { role: "system", content: '{"type":"tool.executed"}' },
      ],
    );
    expect(split.instructions).toBe("base prompt\n\nmemory summary");
    expect(toRealtimeItems(split.messages).map((item: any) => [item.role, item.content[0].text])).toEqual([
      ["user", "hi"],
      ["system", '{"type":"tool.executed"}'],
    ]);
  });
});

describe("toRealtimeItems", () => {
  it("maps user text and images plus assistant text", () => {
    const items = toRealtimeItems([
      {
        role: "user",
        content: [
          { type: "text", text: "look" },
          { type: "image", image: new Uint8Array([1, 2, 3]), mediaType: "image/png" },
        ],
      },
      { role: "assistant", content: "seen" },
    ]);
    expect(items).toEqual([
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "look" },
          { type: "input_image", image_url: "data:image/png;base64,AQID" },
        ],
      },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "seen" }] },
    ]);
  });
});
