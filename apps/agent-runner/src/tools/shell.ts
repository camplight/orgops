import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
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
const shellStartSchema = z.object({
  cmd: z.string().min(1),
  cwd: z.string().optional(),
  env: envSchema,
});
const processRefSchema = z.object({ processId: z.string().min(1) });

export const shellToolDefs: ToolDef[] = [
  [
    "shell_run",
    "Run a shell command synchronously with timeout. This run is always recorded in the processes UI as SYNC.",
    shellRunSchema,
  ],
  [
    "shell_start",
    "Start a long-running shell command asynchronously. Use this for servers/watchers; appears in processes UI as ASYNC.",
    shellStartSchema,
  ],
  ["shell_stop", "Stop a tracked shell process by processId.", processRefSchema],
  ["shell_status", "Check whether a tracked shell process is still running.", processRefSchema],
  ["shell_tail", "Fetch recorded output rows for a tracked shell process.", processRefSchema],
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

function parseToolArgs<T>(
  tool: string,
  schema: z.ZodType<T>,
  args: Record<string, unknown>,
): { ok: true; data: T } | { ok: false; error: string } {
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: `Invalid arguments for ${tool}: ${formatZodIssues(parsed.error)}`,
    };
  }
  return { ok: true, data: parsed.data };
}

const processes = new Map<
  string,
  {
    proc: ReturnType<typeof spawn>;
    seq: number;
    finalized: Promise<void>;
  }
>();

const PROCESS_EVENT_SOURCE = "system:process-runner";
const PROCESS_SHUTDOWN_TIMEOUT_MS = 5000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFinalization(
  finalized: Promise<void>,
  timeoutMs: number,
): Promise<boolean> {
  const timeout = sleep(timeoutMs).then(() => false);
  const complete = finalized.then(() => true);
  return Promise.race([complete, timeout]);
}

async function signalAndWaitForExit(
  processId: string,
  signal: NodeJS.Signals,
  timeoutMs: number,
): Promise<boolean> {
  const entry = processes.get(processId);
  if (!entry) return true;
  if (entry.proc.exitCode !== null || entry.proc.signalCode !== null) {
    return waitForFinalization(entry.finalized, timeoutMs);
  }
  try {
    entry.proc.kill(signal);
  } catch {
    // Process may already be gone.
  }
  return waitForFinalization(entry.finalized, timeoutMs);
}

export async function stopAllRunningProcesses(
  timeoutMs = PROCESS_SHUTDOWN_TIMEOUT_MS,
): Promise<{ processCount: number; terminated: number; killed: number }> {
  const snapshot = [...processes.keys()];
  let terminated = 0;
  let killed = 0;
  for (const processId of snapshot) {
    const terminatedGracefully = await signalAndWaitForExit(
      processId,
      "SIGTERM",
      timeoutMs,
    );
    if (terminatedGracefully) {
      terminated += 1;
      continue;
    }
    const terminatedAfterKill = await signalAndWaitForExit(
      processId,
      "SIGKILL",
      timeoutMs,
    );
    if (terminatedAfterKill) {
      killed += 1;
    }
  }
  return { processCount: snapshot.length, terminated, killed };
}

async function spawnTrackedProcess(
  ctx: ExecuteContext,
  input: {
    cmd: string;
    cwd: string;
    env: Record<string, string>;
    executionMode: "SYNC" | "ASYNC";
  },
) {
  const processId = randomUUID();
  const shell = getShellLaunch(input.cmd);
  const child = spawn(shell.command, shell.args, {
    cwd: input.cwd,
    env: { ...process.env, ...ctx.injectionEnv, ...input.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let finalize = () => {};
  const finalized = new Promise<void>((resolve) => {
    finalize = resolve;
  });
  processes.set(processId, { proc: child, seq: 0, finalized });
  const registrationPromise = (async () => {
    await ctx.apiFetch("/api/processes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: processId,
        agentName: ctx.agent.name,
        channelId: ctx.channelId,
        cmd: input.cmd,
        cwd: input.cwd,
        pid: child.pid,
        state: "RUNNING",
        startedAt: Date.now(),
        executionMode: input.executionMode,
      }),
    });
    await ctx.emitAudit("audit.process.started", {
      agentName: ctx.agent.name,
      channelId: ctx.channelId,
      processId,
      cmd: input.cmd,
      executionMode: input.executionMode,
    });
    await ctx.emitEvent({
      type: "process.started",
      payload: { processId, cmd: input.cmd, executionMode: input.executionMode },
      source: PROCESS_EVENT_SOURCE,
      channelId: ctx.channelId,
    });
  })();

  const handleChunk = async (stream: "STDOUT" | "STDERR", chunk: Buffer) => {
    const entry = processes.get(processId);
    if (!entry) return;
    entry.seq += 1;
    await ctx.apiFetch(`/api/processes/${processId}/output`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: randomUUID(),
        seq: entry.seq,
        stream,
        text: chunk.toString("utf-8"),
        ts: Date.now(),
        source: PROCESS_EVENT_SOURCE,
      }),
    });
    await ctx.emitAudit("audit.process.output", {
      agentName: ctx.agent.name,
      channelId: ctx.channelId,
      processId,
      seq: entry.seq,
      stream,
    });
  };

  child.stdout?.on("data", (chunk) => void handleChunk("STDOUT", chunk));
  child.stderr?.on("data", (chunk) => void handleChunk("STDERR", chunk));
  child.on("exit", async (code, signal) => {
    const exitState = signal ? "TERMINATED" : "EXITED";
    try {
      await registrationPromise;
      await ctx.apiFetch(`/api/processes/${processId}/exit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          exitCode: code ?? null,
          state: exitState,
          endedAt: Date.now(),
          source: PROCESS_EVENT_SOURCE,
        }),
      });
      await ctx.emitAudit("audit.process.exited", {
        agentName: ctx.agent.name,
        channelId: ctx.channelId,
        processId,
        exitCode: code ?? null,
        signal: signal ?? null,
        state: exitState,
      });
    } finally {
      processes.delete(processId);
      finalize();
    }
  });

  try {
    await registrationPromise;
  } catch (error) {
    try {
      child.kill("SIGKILL");
    } catch {
      // no-op
    }
    processes.delete(processId);
    finalize();
    throw error;
  }
  return { processId, child };
}

export async function execute(
  ctx: ExecuteContext,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (tool === "shell_start") {
    const parsedResult = parseToolArgs(tool, shellStartSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const parsed = parsedResult.data;
    const requestedCwd = parsed.cwd ?? ctx.agent.workspacePath;
    const cwd = resolveAgentPath(
      ctx.agent,
      requestedCwd,
      ctx.extraAllowedRoots ?? [],
    );
    const env = parsed.env ?? {};
    const started = await spawnTrackedProcess(ctx, {
      cmd: parsed.cmd,
      cwd,
      env,
      executionMode: "ASYNC",
    });
    return { processId: started.processId, pid: started.child.pid ?? null };
  }

  if (tool === "shell_stop") {
    const parsedResult = parseToolArgs(tool, processRefSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const processId = parsedResult.data.processId;
    const entry = processes.get(processId);
    if (!entry) return { error: "Process not found" };
    try {
      entry.proc.kill("SIGTERM");
    } catch {
      // no-op
    }
    return { ok: true };
  }

  if (tool === "shell_status") {
    const parsedResult = parseToolArgs(tool, processRefSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const processId = parsedResult.data.processId;
    const entry = processes.get(processId);
    const running = Boolean(
      entry && entry.proc.exitCode === null && entry.proc.signalCode === null,
    );
    if (entry && !running) {
      processes.delete(processId);
    }
    return { running, pid: entry?.proc.pid };
  }

  if (tool === "shell_tail") {
    const parsedResult = parseToolArgs(tool, processRefSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const processId = parsedResult.data.processId;
    const res = await ctx.apiFetch(`/api/processes/${processId}/output`);
    return res.json();
  }

  if (tool !== "shell_run") {
    return { error: `Unknown shell tool: ${tool}` };
  }

  const parsedResult = parseToolArgs(tool, shellRunSchema, args);
  if (!parsedResult.ok) {
    return {
      stdout: "",
      stderr: parsedResult.error,
      exitCode: 2,
    };
  }
  const parsed = parsedResult.data;
  const requestedCwd = parsed.cwd ?? ctx.agent.workspacePath;
  const timeoutMs = parsed.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cwd = resolveAgentPath(
    ctx.agent,
    requestedCwd,
    ctx.extraAllowedRoots ?? [],
  );
  const env = parsed.env ?? {};
  const { child } = await spawnTrackedProcess(ctx, {
    cmd: parsed.cmd,
    cwd,
    env,
    executionMode: "SYNC",
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
        `\nCommand timed out after ${timeoutMs}ms. If this is expected to run long, use shell_start.`,
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
