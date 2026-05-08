import { spawn } from "node:child_process";
import { MAX_OUTPUT_CHARS } from "./config";
import type { ShellResult } from "./types";

export async function runShell(
  command: string,
  timeoutMs: number,
  abortSignal?: AbortSignal,
  cwd?: string
): Promise<ShellResult> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: cwd ?? process.cwd(),
      env: process.env,
      shell: true,
    });
    let out = "";
    let err = "";
    let timedOut = false;
    let aborted = false;
    let settled = false;

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (abortSignal) abortSignal.removeEventListener("abort", abortHandler);
      resolve({
        exitCode,
        timedOut,
        aborted,
        stdout: out,
        stderr: err,
        durationMs: Date.now() - startedAt,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 500).unref();
    }, timeoutMs);

    const abortHandler = () => {
      aborted = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 500).unref();
    };

    if (abortSignal) {
      if (abortSignal.aborted) abortHandler();
      else abortSignal.addEventListener("abort", abortHandler, { once: true });
    }

    child.stdout.on("data", (chunk) => {
      out += String(chunk);
      if (out.length > MAX_OUTPUT_CHARS) out = out.slice(-MAX_OUTPUT_CHARS);
    });
    child.stderr.on("data", (chunk) => {
      err += String(chunk);
      if (err.length > MAX_OUTPUT_CHARS) err = err.slice(-MAX_OUTPUT_CHARS);
    });
    child.on("close", (exitCode) => finish(exitCode));
  });
}
