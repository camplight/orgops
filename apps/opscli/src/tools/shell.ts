import { z } from "zod";
import { COMMAND_TIMEOUT_MS } from "../config";
import { runShell } from "../shell";
import { TaskInterruptedError } from "../types";
import { mergeShellOutput, truncateText } from "../utils";
import type { NamedTool, ToolContext } from "./types";

const shellToolSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().min(1).optional(),
});

export function createShellTool(context: ToolContext): NamedTool {
  return [
    "shell",
    {
      description:
        "Run one shell command on the host and return output. Fails on timeout or non-zero exit code.",
      inputSchema: shellToolSchema,
      execute: async (args: { command: string; cwd?: string }) => {
        const command = String(args?.command ?? "");
        const cwd = typeof args?.cwd === "string" && args.cwd.trim() ? args.cwd : undefined;
        context.reportProgress(`tool:shell start ${truncateText(command, 120).text}`);
        const result = await runShell(command, COMMAND_TIMEOUT_MS, context.abortSignal, cwd);
        context.appendLog(
          `tool shell command=${JSON.stringify(command)} cwd=${JSON.stringify(cwd ?? process.cwd())} exit=${result.exitCode} timeout=${result.timedOut} aborted=${result.aborted} durationMs=${result.durationMs}`
        );
        if (result.aborted || context.abortSignal?.aborted) throw new TaskInterruptedError();
        if (result.timedOut) {
          throw new Error(
            `Command timed out after ${COMMAND_TIMEOUT_MS}ms: ${command}\n${truncateText(
              result.stderr || result.stdout,
              2000
            ).text}`
          );
        }
        if (result.exitCode !== 0) {
          throw new Error(
            `Command failed (exit ${result.exitCode}): ${command}\n${truncateText(
              result.stderr || result.stdout,
              2000
            ).text}`
          );
        }
        context.reportProgress(`tool:shell done exit=${result.exitCode} ${result.durationMs}ms`);
        return {
          command,
          cwd: cwd ?? process.cwd(),
          output: mergeShellOutput(result.stdout, result.stderr),
          durationMs: result.durationMs,
        };
      },
    },
  ];
}
