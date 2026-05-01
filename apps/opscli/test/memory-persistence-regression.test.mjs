import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_PATH = resolve(process.cwd(), "src/index.ts");

test("opscli keeps conversation memory at session scope", () => {
  const source = readFileSync(SOURCE_PATH, "utf-8");

  assert.ok(
    source.includes("memory: SessionMemory;"),
    "RlmSession should own memory so state survives across user turns."
  );

  assert.ok(
    source.includes("session.memory,"),
    "runAutonomousTask calls should pass shared session.memory."
  );

  assert.ok(
    source.includes("memory: SessionMemory,"),
    "runAutonomousTask should accept an external memory object."
  );

  assert.equal(
    source.includes('const memory: SessionMemory = { summary: "", history: [] };'),
    false,
    "runAutonomousTask must not recreate memory on each user prompt."
  );

  const sharedMemoryCallMatches = source.match(/runAutonomousTask\([\s\S]*?session\.memory,/g) ?? [];
  assert.ok(
    sharedMemoryCallMatches.length >= 2,
    "Both one-shot and interactive paths should pass session.memory."
  );
});
