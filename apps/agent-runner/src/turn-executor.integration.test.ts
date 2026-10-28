import { beforeEach, describe, expect, it, vi } from "vitest";
import { generate, type LlmTool } from "@orgops/llm";
import { createTurnExecutor } from "./turn-executor";
import type { Agent, Event } from "./types";

vi.mock("@orgops/llm", async (importOriginal) => ({
  ...await importOriginal<typeof import("@orgops/llm")>(), generate: vi.fn(),
}));
vi.mock("models-dev-db", () => ({ getModel: vi.fn().mockRejectedValue(new Error("offline")) }));
const agent: Agent = {
  name: "tester", workspacePath: "/tmp", modelId: "openai:gpt-4o-mini",
  desiredState: "RUNNING", runtimeState: "RUNNING", memoryContextMode: "OFF", emitAuditEvents: false,
};
const trigger: Event = { id: "trigger", type: "message.created", source: "human:test", channelId: "chat", payload: { text: "question" } };
function setup() {
  const emitted: any[] = [];
  const apiFetch = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/api/channels") return Response.json([{ id: "chat", participants: [{ subscriberType: "AGENT", subscriberId: "tester" }] }]);
    if (path.startsWith("/api/events?")) return Response.json([]);
    throw new Error(`Unexpected API call ${init?.method ?? "GET"} ${path}`);
  });
  const execute = createTurnExecutor({
    projectRoot: "/tmp", skillRoots: [], llmCallTimeoutMs: 10000,
    api: { apiFetch, emitEvent: async (event) => { emitted.push(event); },
      listChannels: async () => [], getChannelRecord: async () => null,
      getChannelParticipationValidationError: async () => null,
      ensureLifecycleChannel: async () => "lifecycle", getPackageSecretsEnv: async () => ({}),
    },
  });
  return { emitted, apiFetch, run: () => execute(agent, [trigger]) };
}
async function emit(tools: Record<string, LlmTool> | undefined, text: string) {
  return tools!.events_emit!.execute!({ type: "message.created", payload: { text } });
}
beforeEach(() => { vi.mocked(generate).mockReset(); });
describe("CLASSIC response recovery", () => {
  it("discards contradictory messages on validation retry and feeds back the error", async () => {
    const ctx = setup();
    vi.mocked(generate).mockImplementationOnce(async (_model, _messages, options) => {
      expect(await emit(options?.tools, "yes")).toMatchObject({ delivery: { status: "deferred_until_turn_completion" } });
      expect(ctx.emitted.filter((e) => e.type === "message.created")).toHaveLength(0);
      return { toolCalls: [] as never[], toolResults: [] as never[], text: '{"type":"message.created","payload":"bad"}' };
    }).mockImplementationOnce(async (_model, messages, options) => {
      expect(JSON.stringify(messages)).toContain("Event validation failed");
      await emit(options?.tools, "no");
      return { toolCalls: [] as never[], toolResults: [] as never[], text: '{"type":"noop","payload":{}}' };
    });
    await ctx.run();
    expect(ctx.emitted.filter((e) => e.type === "message.created").map((e) => e.payload.text)).toEqual(["no"]);
    expect(ctx.apiFetch.mock.calls.some(([path]) => path.endsWith("/fail"))).toBe(false);
  });
  it("keeps the last attempt's answer without a generic apology", async () => {
    const ctx = setup();
    vi.mocked(generate).mockImplementation(async (_model, _messages, options) => {
      await emit(options?.tools, "answer");
      return { toolCalls: [] as never[], toolResults: [] as never[], text: '{"type":"message.created","payload":{}}' };
    });
    await ctx.run();
    expect(generate).toHaveBeenCalledTimes(3);
    expect(ctx.emitted.filter((e) => e.type === "message.created").map((e) => e.payload.text)).toEqual(["answer"]);
  });
  it("unwraps mixed prose only after strict dispatch retries are exhausted", async () => {
    const ctx = setup();
    vi.mocked(generate).mockResolvedValue({ toolCalls: [], toolResults: [], text: 'prose\n{"type":"message.created","payload":{"text":"hello"}}' });
    await ctx.run();
    expect(generate).toHaveBeenCalledTimes(3);
    expect(ctx.emitted.filter((e) => e.type === "message.created").map((e) => e.payload.text)).toEqual(["hello"]);
  });
  it("returns invalid tool payloads to the model without failing the trigger", async () => {
    const ctx = setup();
    vi.mocked(generate).mockImplementation(async (_model, _messages, options) => {
      const result = await options!.tools!.events_emit!.execute!({ type: "message.created", payload: "bad" });
      expect(result).toMatchObject({ error: expect.stringContaining("Event validation failed") });
      return { toolCalls: [] as never[], toolResults: [] as never[], text: '{"type":"message.created","payload":{"text":"recovered"}}' };
    });
    await ctx.run();
    expect(ctx.apiFetch.mock.calls.some(([path]) => path.endsWith("/fail"))).toBe(false);
    expect(ctx.emitted.filter((e) => e.type === "message.created").map((e) => e.payload.text)).toEqual(["recovered"]);
  });
  it("still reports a format failure when no answer was staged", async () => {
    const ctx = setup();
    vi.mocked(generate).mockResolvedValue({ toolCalls: [], toolResults: [], text: '{"type":"message.created","payload":{}}' });
    await ctx.run();
    expect(ctx.emitted.filter((e) => e.type === "message.created")[0].payload.text).toContain("response-format issue");
  });
  it("does not flush staged answers when generation fails", async () => {
    const ctx = setup();
    vi.mocked(generate).mockImplementation(async (_model, _messages, options) => {
      await emit(options?.tools, "unfinished");
      throw new Error("provider unavailable");
    });
    await expect(ctx.run()).rejects.toThrow("provider unavailable");
    expect(ctx.emitted.filter((e) => e.type === "message.created")).toHaveLength(0);
  });
  it("discards staged answers when late input forces another attempt", async () => {
    const ctx = setup();
    const originalFetch = ctx.apiFetch.getMockImplementation()!;
    let injected = false;
    ctx.apiFetch.mockImplementation(async (path, init) => {
      if (path.startsWith("/api/events?") && !injected) {
        injected = true;
        return Response.json([{ ...trigger, id: "late", payload: { text: "correction" } }]);
      }
      return originalFetch(path, init);
    });
    let attempt = 0;
    vi.mocked(generate).mockImplementation(async (_model, _messages, options) => {
      await emit(options?.tools, ++attempt === 1 ? "outdated" : "updated");
      return { toolCalls: [] as never[], toolResults: [] as never[], text: '{"type":"noop","payload":{}}' };
    });
    await ctx.run();
    expect(ctx.emitted.filter((e) => e.type === "message.created").map((e) => e.payload.text)).toEqual(["updated"]);
  });

});
