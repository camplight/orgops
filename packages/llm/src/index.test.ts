import { describe, expect, it } from "bun:test";
import { generate } from "./index";

describe("llm", () => {
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
});
