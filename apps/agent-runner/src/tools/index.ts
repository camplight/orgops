import type { LlmTool } from "@orgops/llm";
import { createWrapExecute, toolDefToLlmTool } from "./types";
import { shellToolDefs, execute as executeShell } from "./shell";
import { fsToolDefs, execute as executeFs } from "./fs";
import { eventsToolDefs, execute as executeEvents } from "./events";
import { memoryToolDefs, execute as executeMemory } from "./memory";
import type { ExecuteContext, RunnerToolDeps } from "./types";

const allToolDefs = [
  ...shellToolDefs,
  ...fsToolDefs,
  ...eventsToolDefs,
  ...memoryToolDefs,
];

export function createRunnerTools(
  deps: RunnerToolDeps,
): Record<string, LlmTool> {
  const wrapExecute = createWrapExecute(deps);
  const duplicate = allToolDefs.find(
    (def, idx) => allToolDefs.findIndex((candidate) => candidate[0] === def[0]) !== idx,
  );
  if (duplicate) {
    throw new Error(`Duplicate tool name: ${duplicate[0]}`);
  }
  return Object.fromEntries(allToolDefs.map((def) => toolDefToLlmTool(def, wrapExecute)));
}

export async function executeTool(
  ctx: ExecuteContext,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (tool.startsWith("shell_")) return executeShell(ctx, tool, args);
  if (tool.startsWith("fs_")) return executeFs(ctx, tool, args);
  if (tool.startsWith("events_")) return executeEvents(ctx, tool, args);
  if (tool.startsWith("memory_")) return executeMemory(ctx, tool, args);
  return { error: `Unsupported tool: ${tool}` };
}

export type { ExecuteContext, RunnerToolDeps } from "./types";
export { shellToolDefs } from "./shell";
export { fsToolDefs } from "./fs";
export { eventsToolDefs } from "./events";
export { memoryToolDefs } from "./memory";
