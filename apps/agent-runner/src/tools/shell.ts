import { spawnSync } from "node:child_process";
import { z } from "zod";
import type { ExecuteContext, ToolDef } from "./types";
import { resolveAgentPath } from "./path-access";
import { getShellLaunch } from "./shell-launch";

const envSchema = z.record(z.string(), z.string()).optional();
const shellRunSchema = z.object({
  cmd: z.string().min(1),
  cwd: z.string().optional(),
  env: envSchema,
});

export const shellToolDefs: ToolDef[] = [
  [
    "shell_run",
    "Run a shell command.",
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
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 0,
  };
}
