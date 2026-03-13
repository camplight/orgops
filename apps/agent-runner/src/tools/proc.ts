import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ExecuteContext, ToolDef } from "./types";
import { resolveAgentPath } from "./path-access";

const envSchema = z.record(z.string(), z.string()).optional();

export const procToolDefs: ToolDef[] = [
  [
    "proc_start",
    "Start a long-running process.",
    z.object({
      cmd: z.string(),
      cwd: z.string().optional(),
      env: envSchema,
    }),
  ],
  ["proc_stop", "Stop a process.", z.object({ processId: z.string() })],
  ["proc_status", "Check a process.", z.object({ processId: z.string() })],
  ["proc_tail", "Tail process output.", z.object({ processId: z.string() })],
];

const processes = new Map<
  string,
  {
    proc: ReturnType<typeof spawn>;
    seq: number;
    agentName: string;
    channelId?: string;
    apiFetch: ExecuteContext["apiFetch"];
    finalized: Promise<void>;
  }
>();

const PROCESS_SHUTDOWN_TIMEOUT_MS = 5000;
const PROCESS_EVENT_SOURCE = "system:process-runner";

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

export async function execute(
  ctx: ExecuteContext,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (tool === "proc_start") {
    const cmd = String(args.cmd ?? "");
    const requestedCwd = String(args.cwd ?? ctx.agent.workspacePath);
    const cwd = resolveAgentPath(
      ctx.agent,
      requestedCwd,
      ctx.extraAllowedRoots ?? [],
    );
    const env = (args.env ?? {}) as Record<string, string>;
    const processId = randomUUID();
    const child = spawn("/bin/bash", ["-lc", cmd], {
      cwd,
      env: { ...process.env, ...ctx.injectionEnv, ...env },
    });
    let finalize = () => {};
    const finalized = new Promise<void>((resolve) => {
      finalize = resolve;
    });
    processes.set(processId, {
      proc: child,
      seq: 0,
      agentName: ctx.agent.name,
      channelId: ctx.channelId,
      apiFetch: ctx.apiFetch,
      finalized,
    });
    await ctx.apiFetch("/api/processes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: processId,
        agentName: ctx.agent.name,
        channelId: ctx.channelId,
        cmd,
        cwd,
        pid: child.pid,
        state: "RUNNING",
        startedAt: Date.now(),
      }),
    });
    await ctx.emitAudit("audit.process.started", {
      agentName: ctx.agent.name,
      channelId: ctx.channelId,
      processId,
      cmd,
    });
    await ctx.emitEvent({
      type: "process.started",
      payload: { processId, cmd },
      source: PROCESS_EVENT_SOURCE,
      channelId: ctx.channelId,
    });

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
    return { processId };
  }
  if (tool === "proc_stop") {
    const processId = String(args.processId ?? "");
    const entry = processes.get(processId);
    if (!entry) return { error: "Process not found" };
    entry.proc.kill("SIGTERM");
    return { ok: true };
  }
  if (tool === "proc_status") {
    const processId = String(args.processId ?? "");
    const entry = processes.get(processId);
    const running = Boolean(
      entry &&
        entry.proc.exitCode === null &&
        entry.proc.signalCode === null,
    );
    if (entry && !running) {
      processes.delete(processId);
    }
    return { running, pid: entry?.proc.pid };
  }
  if (tool === "proc_tail") {
    const processId = String(args.processId ?? "");
    const res = await ctx.apiFetch(`/api/processes/${processId}/output`);
    return res.json();
  }
  throw new Error(`Unknown proc tool: ${tool}`);
}
