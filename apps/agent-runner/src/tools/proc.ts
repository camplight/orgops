import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ExecuteContext, ToolDef } from "./types";

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
  { proc: ReturnType<typeof spawn>; seq: number }
>();

export async function execute(
  ctx: ExecuteContext,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (tool === "proc_start") {
    const cmd = String(args.cmd ?? "");
    const cwd = String(args.cwd ?? ctx.agent.workspacePath);
    const env = (args.env ?? {}) as Record<string, string>;
    const processId = randomUUID();
    const child = spawn("/bin/bash", ["-lc", cmd], {
      cwd,
      env: { ...process.env, ...ctx.injectionEnv, ...env },
    });
    processes.set(processId, { proc: child, seq: 0 });
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
      source: `agent:${ctx.agent.name}`,
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
          source: `agent:${ctx.agent.name}`,
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
    child.on("exit", async (code) => {
      await ctx.apiFetch(`/api/processes/${processId}/exit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          exitCode: code ?? null,
          state: "EXITED",
          endedAt: Date.now(),
          source: `agent:${ctx.agent.name}`,
        }),
      });
      await ctx.emitAudit("audit.process.exited", {
        agentName: ctx.agent.name,
        channelId: ctx.channelId,
        processId,
        exitCode: code ?? null,
      });
      processes.delete(processId);
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
    return { running: Boolean(entry), pid: entry?.proc.pid };
  }
  if (tool === "proc_tail") {
    const processId = String(args.processId ?? "");
    const res = await ctx.apiFetch(`/api/processes/${processId}/output`);
    return res.json();
  }
  throw new Error(`Unknown proc tool: ${tool}`);
}
