import type { LlmTool } from "@orgops/llm";
import { createAskPasswordTool } from "./ask-password";
import { createExitTool } from "./exit";
import {
  createExtractOrgOpsTool,
  createGetBundledDocsTool,
} from "./orgops-bundle";
import { createShellTool } from "./shell";
import type { ToolContext } from "./types";

export function createOpsCliTools(context: ToolContext): Record<string, LlmTool> {
  const tools = [
    createShellTool(context),
    createAskPasswordTool(context),
    createExtractOrgOpsTool(context),
    createGetBundledDocsTool(context),
    createExitTool(context),
  ];
  return Object.fromEntries(tools);
}
