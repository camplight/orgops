import { spawnSync } from "node:child_process";
import { z } from "zod";
import type { ExecuteContext, ToolDef } from "./types";
import { resolveAgentPath } from "./path-access";
import { getShellLaunch } from "./shell-launch";

const envSchema = z.record(z.string(), z.string()).optional();
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 300_000;
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;
const shellRunSchema = z.object({
  cmd: z.string().min(1),
  cwd: z.string().optional(),
  env: envSchema,
  timeoutMs: z.number().int().min(MIN_TIMEOUT_MS).max(MAX_TIMEOUT_MS).optional(),
});

export const shellToolDefs: ToolDef[] = [
  [
    "shell_run",
    "Run a shell command with a timeout.",
    shellRunSchema,
  ],
];

function formatZodIssues(error: z.ZodError) {
  return error.issues
    .slice(0, 6)
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export async function execute(
  ctx: ExecuteContext,
  args: Record<string, unknown>,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const parsed = shellRunSchema.safeParse(args);
  if (!parsed.success) {
    return {
      stdout: "",
      stderr: `Invalid arguments for shell_run: ${formatZodIssues(parsed.error)}`,
      exitCode: 2,
    };
  }
  const cmd = parsed.data.cmd;
  const requestedCwd = parsed.data.cwd ?? ctx.agent.workspacePath;
  const timeoutMs = parsed.data.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cwd = resolveAgentPath(
    ctx.agent,
    requestedCwd,
    ctx.extraAllowedRoots ?? [],
  );
  const env = parsed.data.env ?? {};
  const shell = getShellLaunch(cmd);
  const result = spawnSync(shell.command, shell.args, {
    cwd,
    env: { ...process.env, ...ctx.injectionEnv, ...env },
    encoding: "utf-8",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: DEFAULT_MAX_BUFFER,
  });
  const spawnError = result.error as NodeJS.ErrnoException | undefined;
  const timedOut = spawnError
    ? spawnError.code === "ETIMEDOUT" ||
      spawnError.message.includes("ETIMEDOUT")
    : false;
  if (timedOut) {
    return {
      stdout: result.stdout ?? "",
      stderr:
        (result.stderr ?? "") +
        `\nCommand timed out after ${timeoutMs}ms. If this is expected to run long, use proc_start.`,
      exitCode: 124,
    };
  }
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 0,
  };
}
