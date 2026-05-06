import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const AGENT_SOURCE = resolve(process.cwd(), "src/agent.ts");

test("opscli agent writes user and assistant roles to memory", () => {
  const source = readFileSync(AGENT_SOURCE, "utf-8");

  const userRoleMatches = source.match(/appendHistoryMessage\(memory,\s*\{\s*role:\s*"user"/g) ?? [];
  assert.equal(
    userRoleMatches.length,
    1,
    "Only user-entered prompt history should use role=user."
  );

  assert.ok(
    source.includes('appendHistoryMessage(memory, { role: "assistant", content: finalText });'),
    "Assistant final text should be recorded as assistant role."
  );

  assert.ok(
    source.includes("modelMessages.push(...memory.history);"),
    "Conversation history should be replayed into subsequent model calls."
  );
});
