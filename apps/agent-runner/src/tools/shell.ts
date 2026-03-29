import { spawn } from "node:child_process";
import { z } from "zod";
import type { ExecuteContext, ToolDef } from "./types";
import { resolveAgentPath } from "./path-access";
import { getShellLaunch } from "./shell-launch";

const envSchema = z.record(z.string(), z.string()).optional();
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 45_000;
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;
const shellRunSchema = z.object({
  cmd: z.string().min(1),
  cwd: z.string().optional(),
  env: envSchema,
  timeoutMs: z
    .number()
    .int()
    .min(MIN_TIMEOUT_MS)
    .max(MAX_TIMEOUT_MS)
    .optional(),
});

export const shellToolDefs: ToolDef[] = [
  ["shell_run", "Run a shell command with a timeout.", shellRunSchema],
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
  const child = spawn(shell.command, shell.args, {
    cwd,
    env: { ...process.env, ...ctx.injectionEnv, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let timedOut = false;
  let bufferExceeded = false;
  const onData = (
    chunk: Buffer | string,
    targetChunks: Buffer[],
    currentBytes: number,
  ): number => {
    const normalized = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (currentBytes >= DEFAULT_MAX_BUFFER) return currentBytes;
    const remaining = DEFAULT_MAX_BUFFER - currentBytes;
    if (normalized.length <= remaining) {
      targetChunks.push(normalized);
      return currentBytes + normalized.length;
    }
    targetChunks.push(normalized.subarray(0, remaining));
    bufferExceeded = true;
    child.kill("SIGKILL");
    return DEFAULT_MAX_BUFFER;
  };
  child.stdout?.on("data", (chunk: Buffer | string) => {
    stdoutBytes = onData(chunk, stdoutChunks, stdoutBytes);
  });
  child.stderr?.on("data", (chunk: Buffer | string) => {
    stderrBytes = onData(chunk, stderrChunks, stderrBytes);
  });
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);
  const result = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    error?: Error;
  }>((resolve) => {
    let settled = false;
    const settle = (value: {
      code: number | null;
      signal: NodeJS.Signals | null;
      error?: Error;
    }) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    child.once("error", (error) => settle({ code: null, signal: null, error }));
    child.once("close", (code, signal) => settle({ code, signal }));
  });
  clearTimeout(timer);
  const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
  const stderr = Buffer.concat(stderrChunks).toString("utf-8");
  if (result.error) {
    return {
      stdout,
      stderr: [stderr, String(result.error)].filter(Boolean).join("\n"),
      exitCode: 1,
    };
  }
  if (timedOut) {
    return {
      stdout,
      stderr:
        stderr +
        `\nCommand timed out after ${timeoutMs}ms. If this is expected to run long, use proc_start.`,
      exitCode: 124,
    };
  }
  if (bufferExceeded) {
    return {
      stdout,
      stderr:
        stderr +
        `\nCommand output exceeded ${DEFAULT_MAX_BUFFER} bytes and was terminated.`,
      exitCode: 1,
    };
  }
  return {
    stdout,
    stderr,
    exitCode: result.code ?? 0,
  };
}
