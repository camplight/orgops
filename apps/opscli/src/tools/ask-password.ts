import { z } from "zod";
import type { NamedTool, ToolContext } from "./types";

const askPasswordSchema = z.object({
  prompt: z.string().min(1).optional(),
});

export function createAskPasswordTool(context: ToolContext): NamedTool {
  return [
    "askPassword",
    {
      description:
        "Prompt the user for sensitive input (hidden, non-echo). Use only when a password/secret is required.",
      inputSchema: askPasswordSchema,
      execute: async (args: { prompt?: string }) => {
        const prompt =
          typeof args?.prompt === "string" && args.prompt.trim()
            ? args.prompt.trim()
            : "Enter password";
        context.reportProgress(`tool:askPassword ${prompt}`);
        const password = await context.requestPasswordInput(prompt);
        context.appendLog(`tool askPassword prompt=${JSON.stringify(prompt)} length=${password.length}`);
        return { password };
      },
    },
  ];
}
