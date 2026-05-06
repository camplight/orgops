import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const INDEX_SOURCE = resolve(process.cwd(), "src/index.ts");
const TOOLS_SOURCE = resolve(process.cwd(), "src/tools/index.ts");

test("opscli keeps shared session memory and modular tools", () => {
  const source = readFileSync(INDEX_SOURCE, "utf-8");
  const toolsSource = readFileSync(TOOLS_SOURCE, "utf-8");

  assert.ok(
    source.includes('const memory: SessionMemory = { summary: "", history: [] };'),
    "main() should initialize one shared memory object."
  );

  const sharedMemoryCallMatches = source.match(/runAutonomousTask\([\s\S]*?memory,/g) ?? [];
  assert.ok(
    sharedMemoryCallMatches.length === 0,
    "Legacy runAutonomousTask path should be removed in modular rewrite."
  );

  assert.ok(
    source.includes("runAgentTurn({"),
    "index should delegate turns to the dedicated agent module."
  );

  assert.ok(
    toolsSource.includes("createShellTool") &&
      toolsSource.includes("createAskPasswordTool") &&
      toolsSource.includes("createExtractOrgOpsTool") &&
      toolsSource.includes("createGetBundledDocsTool") &&
      toolsSource.includes("createExitTool"),
    "tools index should compose separate tool modules."
  );
});
