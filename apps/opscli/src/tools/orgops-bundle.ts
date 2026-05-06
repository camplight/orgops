import { z } from "zod";
import { extractBundledOrgOps, loadBundledDocsText } from "../bundle";
import type { NamedTool, ToolContext } from "./types";

const extractSchema = z.object({
  force: z.boolean().optional(),
});

const docsSchema = z.object({});

export function createExtractOrgOpsTool(context: ToolContext): NamedTool {
  return [
    "extractOrgOps",
    {
      description:
        "Extract bundled OrgOps source tree into ./orgops in the current working directory.",
      inputSchema: extractSchema,
      execute: async (args: { force?: boolean }) => {
        context.reportProgress("tool:extractOrgOps");
        const result = await extractBundledOrgOps(args);
        context.appendLog(`tool extractOrgOps extractedRoot=${JSON.stringify(result.extractedRoot)}`);
        return result;
      },
    },
  ];
}

export function createGetBundledDocsTool(context: ToolContext): NamedTool {
  return [
    "getBundledDocs",
    {
      description: "Fetch bundled OrgOps docs text used by OpsCLI.",
      inputSchema: docsSchema,
      execute: () => {
        context.reportProgress("tool:getBundledDocs");
        return { docs: loadBundledDocsText() };
      },
    },
  ];
}
