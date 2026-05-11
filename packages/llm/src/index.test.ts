import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(async (_input: Record<string, unknown>) => ({
    text: "mock response",
    toolCalls: [],
    toolResults: [],
  })),
  stepCountIs: vi.fn((stepCount: number) => ({ stepCount })),
  createOpenAI: vi.fn(() => ({
    chat: vi.fn((modelName: string) => ({ provider: "openai-chat", modelName })),
    completion: vi.fn((modelName: string) => ({
      provider: "openai-completion",
      modelName,
    })),
  })),
  createAnthropic: vi.fn(() => vi.fn((modelName: string) => ({
    provider: "anthropic",
    modelName,
  }))),
}));

vi.mock("ai", () => ({
  generateText: mocks.generateText,
  stepCountIs: mocks.stepCountIs,
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: mocks.createOpenAI,
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: mocks.createAnthropic,
}));

import {
  generate,
  isOpenAICompletionModel,
  isOpenAIReasoningModel,
} from "./index";

describe("llm", () => {
  beforeEach(() => {
    mocks.generateText.mockClear();
    mocks.stepCountIs.mockClear();
    mocks.createOpenAI.mockClear();
    mocks.createAnthropic.mockClear();
    delete process.env.ORGOPS_LLM_STUB;
  });

  it("detects completion-only OpenAI model ids", () => {
    expect(isOpenAICompletionModel("gpt-5.3-codex")).toBe(true);
    expect(isOpenAICompletionModel("gpt-3.5-turbo-instruct")).toBe(true);
    expect(isOpenAICompletionModel("gpt-4o-mini")).toBe(false);
  });

  it("detects OpenAI reasoning model ids", () => {
    expect(isOpenAIReasoningModel("gpt-5.2")).toBe(true);
    expect(isOpenAIReasoningModel("o3")).toBe(true);
    expect(isOpenAIReasoningModel("openai/gpt-5")).toBe(true);
    expect(isOpenAIReasoningModel("gpt-4o-mini")).toBe(false);
  });

  it("returns stub response when configured", async () => {
    process.env.ORGOPS_LLM_STUB = "1";
    const result = await generate("openai:gpt-4o-mini", [
      { role: "user", content: "hello" },
    ]);
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.toolCalls).toEqual([]);
    expect(result.toolResults).toEqual([]);
  });

  it("falls back to process env when options.env is provided", async () => {
    process.env.ORGOPS_LLM_STUB = "1";
    const result = await generate(
      "openai:gpt-4o-mini",
      [{ role: "user", content: "hello" }],
      { env: {} },
    );
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.toolCalls).toEqual([]);
    expect(result.toolResults).toEqual([]);
  });

  it("rejects unsupported providers", async () => {
    process.env.ORGOPS_LLM_STUB = "0";
    await expect(
      generate("foo:bar", [{ role: "user", content: "hello" }]),
    ).rejects.toThrow("Unsupported provider: foo");
  });

  it("passes a system-only prompt without an empty messages array", async () => {
    process.env.ORGOPS_LLM_STUB = "0";
    await generate("openai:gpt-4o-mini", [
      { role: "system", content: "Only system guidance." },
    ]);

    expect(mocks.generateText).toHaveBeenCalledTimes(1);
    expect(mocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Only system guidance.",
      }),
    );
    const generateTextInput = mocks.generateText.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(generateTextInput).not.toHaveProperty("messages");
  });

  it("rejects empty prompts before calling the SDK", async () => {
    process.env.ORGOPS_LLM_STUB = "0";
    await expect(generate("openai:gpt-4o-mini", [])).rejects.toThrow(
      "LLM generate requires at least one non-empty message.",
    );
    expect(mocks.generateText).not.toHaveBeenCalled();
  });
});
