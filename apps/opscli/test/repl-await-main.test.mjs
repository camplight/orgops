import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const AGENT_SOURCE = resolve(process.cwd(), "src/agent.ts");

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
    source.includes("synthesizeFinalAnswerFromToolResults"),
    "Agent should synthesize a final user-facing answer when model text is empty."
  );
});

