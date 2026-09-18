import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const AGENT_SOURCE = resolve(process.cwd(), "src/lib/agent.ts");

test("opscli agent uses llm tools with bounded internal loop", () => {
  const source = readFileSync(AGENT_SOURCE, "utf-8");

  assert.ok(
    source.includes("const tools = createOpsCliTools"),
    "Agent should build tools from modular tool registry."
  );

  assert.ok(
    source.includes("const result = await generate(modelId, modelMessages, {"),
    "Agent should call generate with model messages."
  );

  assert.ok(
    source.includes("maxSteps: TOOL_LOOP_MAX_STEPS"),
    "Agent should use internal tool-loop cap from config."
  );

  assert.ok(
    source.includes('throw new Error("Model returned an empty final response.");'),
    "Agent should fail loudly when model returns empty final text."
  );
});

