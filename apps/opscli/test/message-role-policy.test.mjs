import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_PATH = resolve(process.cwd(), "src/index.ts");

test("opscli uses user role only for actual user prompt history", () => {
  const source = readFileSync(SOURCE_PATH, "utf-8");

  const userRoleMatches = source.match(/appendHistoryMessage\(memory,\s*\{\s*role:\s*"user"/g) ?? [];
  assert.equal(
    userRoleMatches.length,
    1,
    "Only user-entered prompt history should use role=user."
  );

  assert.ok(
    source.includes('appendHistoryMessage(memory, { role: "system", content: code });'),
    "Model-produced code should be recorded as system context."
  );

  assert.ok(
    source.includes('role: "system",\n        content: JSON.stringify({ type, ...payload }, null, 2),'),
    "Runtime observations should be recorded as system context."
  );

  assert.ok(
    source.includes('role: "system",\n      content: JSON.stringify(\n        {\n          type: "opscli.repl.next_input.requested"'),
    "Control messages for next-step requests should be system role."
  );
});
