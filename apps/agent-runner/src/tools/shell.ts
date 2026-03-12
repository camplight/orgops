import { spawnSync } from "node:child_process";
import { z } from "zod";
import type { ExecuteContext, ToolDef } from "./types";
import { resolveAgentPath } from "./path-access";

const envSchema = z.record(z.string(), z.string()).optional();

export const shellToolDefs: ToolDef[] = [
  [
    "shell_run",
    "Run a shell command.",
    z.object({
      cmd: z.string(),
      cwd: z.string().optional(),
      env: envSchema,
    }),
  ],
];

export async function execute(
  ctx: ExecuteContext,
  args: Record<string, unknown>,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const cmd = String(args.cmd ?? "");
  const requestedCwd = String(args.cwd ?? ctx.agent.workspacePath);
  const cwd = resolveAgentPath(
    ctx.agent,
    requestedCwd,
    ctx.extraAllowedRoots ?? [],
  );
  const env = (args.env ?? {}) as Record<string, string>;
  const result = spawnSync("/bin/bash", ["-lc", cmd], {
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
