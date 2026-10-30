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
  createMistral: vi.fn(() =>
    Object.assign(
      vi.fn((modelName: string) => ({ provider: "mistral", modelName })),
      {
        transcription: vi.fn((modelName: string) => ({
          provider: "mistral-transcription",
          modelName,
        })),
      },
    ),
  ),
  experimentalTranscribe: vi.fn(async (_input: Record<string, unknown>) => ({
    text: " hello team ",
    language: "en",
    durationInSeconds: 1.5,
  })),
}));

vi.mock("ai", () => ({
  generateText: mocks.generateText,
  stepCountIs: mocks.stepCountIs,
  experimental_transcribe: mocks.experimentalTranscribe,
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: mocks.createOpenAI,
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: mocks.createAnthropic,
}));

vi.mock("@ai-sdk/mistral", () => ({
  createMistral: mocks.createMistral,
}));

import {
  generate,
  isOpenAICompletionModel,
  isOpenAIReasoningModel,
  resolveTranscriptionModelId,
  transcribe,
} from "./index";

describe("llm", () => {
  beforeEach(() => {
    mocks.generateText.mockClear();
    mocks.stepCountIs.mockClear();
    mocks.createOpenAI.mockClear();
    mocks.createAnthropic.mockClear();
    mocks.createMistral.mockClear();
    delete process.env.ORGOPS_LLM_STUB;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.MISTRAL_API_KEY;
    delete process.env.LIQUID_API_KEY;
    delete process.env.LIQUID_BASE_URL;
    delete process.env.OPENAI_COMPATIBLE_API_KEY;
    delete process.env.OPENAI_COMPATIBLE_BASE_URL;
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

  it("does not fall back to process provider keys when env is injected", async () => {
    process.env.ORGOPS_LLM_STUB = "0";
    process.env.OPENAI_API_KEY = "host-key";
    await generate(
      "openai:gpt-4o-mini",
      [{ role: "user", content: "hello" }],
      { env: {} },
    );
    expect(mocks.createOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: undefined,
      }),
    );
  });

  it("uses injected provider keys when provided", async () => {
    process.env.ORGOPS_LLM_STUB = "0";
    process.env.OPENAI_API_KEY = "host-key";
    await generate(
      "openai:gpt-4o-mini",
      [{ role: "user", content: "hello" }],
      { env: { OPENAI_API_KEY: "scoped-key" } },
    );
    expect(mocks.createOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "scoped-key",
      }),
    );
  });

  it("uses injected Mistral provider keys", async () => {
    process.env.ORGOPS_LLM_STUB = "0";
    process.env.MISTRAL_API_KEY = "host-key";
    await generate(
      "mistral:mistral-small-latest",
      [{ role: "user", content: "hello" }],
      { env: { MISTRAL_API_KEY: "scoped-key" } },
    );
    expect(mocks.createMistral).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "scoped-key",
      }),
    );
  });

  it("uses Liquid as an OpenAI-compatible provider", async () => {
    process.env.ORGOPS_LLM_STUB = "0";
    await generate(
      "liquid:lfm3",
      [{ role: "user", content: "hello" }],
      { env: { LIQUID_API_KEY: "liquid-key", LIQUID_BASE_URL: "https://liquid.example/v1" } },
    );
    expect(mocks.createOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "liquid-key",
        baseURL: "https://liquid.example/v1",
      }),
    );
  });

  it("defaults Liquid to the hosted Labs API", async () => {
    process.env.ORGOPS_LLM_STUB = "0";
    await generate(
      "liquid:lfm3",
      [{ role: "user", content: "hello" }],
      { env: { LIQUID_API_KEY: "liquid-key" } },
    );
    expect(mocks.createOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "liquid-key",
        baseURL: "https://labs.liquid.ai/api/v1",
      }),
    );
  });

  it("uses generic OpenAI-compatible provider endpoints", async () => {
    process.env.ORGOPS_LLM_STUB = "0";
    await generate(
      "openai-compatible:local-model",
      [{ role: "user", content: "hello" }],
      {
        env: {
          OPENAI_COMPATIBLE_API_KEY: "local-key",
          OPENAI_COMPATIBLE_BASE_URL: "http://127.0.0.1:8000/v1",
        },
      },
    );
    expect(mocks.createOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "local-key",
        baseURL: "http://127.0.0.1:8000/v1",
      }),
    );
  });

  it("requires a base URL for generic OpenAI-compatible provider endpoints", async () => {
    process.env.ORGOPS_LLM_STUB = "0";
    await expect(
      generate(
        "openai-compatible:local-model",
        [{ role: "user", content: "hello" }],
        { env: { OPENAI_COMPATIBLE_API_KEY: "local-key" } },
      ),
    ).rejects.toThrow("OPENAI_COMPATIBLE_BASE_URL is required");
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

  it("picks a transcription model from explicit config or available keys", () => {
    expect(resolveTranscriptionModelId({})).toBeNull();
    expect(resolveTranscriptionModelId({ ORGOPS_TRANSCRIPTION_MODEL: "off", MISTRAL_API_KEY: "k" })).toBeNull();
    expect(resolveTranscriptionModelId({ ORGOPS_TRANSCRIPTION_MODEL: "openai:whisper-1" })).toBe(
      "openai:whisper-1",
    );
    expect(resolveTranscriptionModelId({ ORGOPS_LLM_STUB: "1" })).toBe("stub:transcriber");
    expect(resolveTranscriptionModelId({ MISTRAL_API_KEY: "k", OPENAI_API_KEY: "k" })).toBe(
      "mistral:voxtral-mini-latest",
    );
    expect(resolveTranscriptionModelId({ OPENAI_API_KEY: "k" })).toBe("openai:gpt-4o-mini-transcribe");
  });

  it("transcribes audio with the provider transcription model", async () => {
    const audio = new Uint8Array([1, 2, 3]);
    const result = await transcribe("mistral:voxtral-mini-latest", { data: audio }, {
      env: { MISTRAL_API_KEY: "mistral-key" },
      language: "en",
    });
    expect(result).toEqual({ text: "hello team", language: "en", durationInSeconds: 1.5 });
    expect(mocks.createMistral).toHaveBeenCalledWith({ apiKey: "mistral-key" });
    expect(mocks.experimentalTranscribe).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { provider: "mistral-transcription", modelName: "voxtral-mini-latest" },
        audio,
        providerOptions: { mistral: { language: "en" } },
      }),
    );
  });

  it("returns a stub transcript without calling providers in stub mode", async () => {
    mocks.experimentalTranscribe.mockClear();
    const result = await transcribe("stub:transcriber", { data: new Uint8Array(32000) });
    expect(result.text).toBe("Stub transcript of 2s voice input.");
    expect(mocks.experimentalTranscribe).not.toHaveBeenCalled();
  });

  it("rejects providers without transcription support", async () => {
    await expect(
      transcribe("anthropic:claude-sonnet-4", { data: new Uint8Array([1]) }),
    ).rejects.toThrow("does not support transcription");
  });
});
