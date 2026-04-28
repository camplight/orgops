import { describe, expect, it } from "vitest";
import { generate, isOpenAICompletionModel } from "./index";

describe("llm", () => {
  it("detects completion-only OpenAI model ids", () => {
    expect(isOpenAICompletionModel("gpt-5.3-codex")).toBe(true);
    expect(isOpenAICompletionModel("gpt-3.5-turbo-instruct")).toBe(true);
    expect(isOpenAICompletionModel("gpt-4o-mini")).toBe(false);
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
});
