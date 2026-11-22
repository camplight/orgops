import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { execute, stopAllRunningProcesses, stopProcessTree } from "./shell";
import type { ExecuteContext } from "./types";

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function waitFor(check: () => boolean, timeoutMs = 3000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const readPid = async (file: string) => {
  await waitFor(() => existsSync(file) && readFileSync(file, "utf8").trim().length > 0);
  return Number(readFileSync(file, "utf8").trim());
};

// A turn the test can cancel: the shell tool registers its processes through onTurnCancel.
function cancellableTurn(ctx: ExecuteContext) {
  const controller = new AbortController();
  const stops: Array<() => Promise<unknown>> = [];
  return {
    ctx: { ...ctx, abortSignal: controller.signal, onTurnCancel: (stop: () => Promise<unknown>) => void stops.push(stop) },
    cancel: async () => {
      controller.abort();
      await Promise.all(stops.map((stop) => stop()));
    },
  };
}

// Starts a parent shell that runs a sleeping child and writes the child's pid.
const parentWithChild = (pidFile: string) =>
  `sh -c 'node -e "setInterval(() => {}, 1000)" & echo $! > ${pidFile}; wait'`;

function createTestContext(workspacePath: string, injectionEnv: Record<string, string>): ExecuteContext {
  return {
    agent: {
      name: "tester",
      workspacePath,
      modelId: "openai:gpt-4o-mini",
      desiredState: "RUNNING",
      runtimeState: "RUNNING",
    },
    triggerEvent: {
      id: "evt-1",
      type: "message.created",
      payload: {},
      source: "human:admin",
      channelId: "chan-1",
    },
    channelId: "chan-1",
    injectionEnv,
    apiFetch: async () => new Response("{}", { status: 200 }),
    emitEvent: async () => {},
    emitAudit: async () => {},
  };
}

describe("shell tool", () => {
  const createdDirs: string[] = [];

  afterEach(() => {
    for (const dir of createdDirs.splice(0, createdDirs.length)) {
      rmSync(dir, { recursive: true, force: true });
    }
    delete process.env.OPENAI_API_KEY;
    delete process.env.ORGOPS_SHELL_TIMEOUT_KILL_GRACE_MS;
  });

  it.skipIf(process.platform === "win32")(
    "stops a running command and its children when the turn is cancelled",
    async () => {
      const workspace = mkdtempSync(join(tmpdir(), "orgops-shell-test-"));
      createdDirs.push(workspace);
      const turn = cancellableTurn(createTestContext(workspace, {}));
      const pidFile = join(workspace, "child.pid");
      const started = Date.now();
      const running = execute(turn.ctx, "shell_run", {
        cmd: parentWithChild(pidFile),
        cwd: workspace,
        timeoutMs: 30000,
      }) as Promise<{ exitCode: number | null; stderr: string }>;
      const childPid = await readPid(pidFile);
      await turn.cancel();
      const result = await running;
      expect(Date.now() - started).toBeLessThan(5000);
      expect(result.exitCode).toBe(130);
      expect(result.stderr).toContain("the turn was cancelled");
      await waitFor(() => !alive(childPid));
    },
  );

  it.skipIf(process.platform === "win32")(
    "stops background processes started in this turn and leaves older ones running",
    async () => {
      const workspace = mkdtempSync(join(tmpdir(), "orgops-shell-test-"));
      createdDirs.push(workspace);
      const earlier = cancellableTurn(createTestContext(workspace, {}));
      const current = cancellableTurn(createTestContext(workspace, {}));
      const older = (await execute(earlier.ctx, "shell_start", {
        cmd: 'node -e "setInterval(() => {}, 1000)"',
        cwd: workspace,
      })) as { pid: number };
      const fresh = (await execute(current.ctx, "shell_start", {
        cmd: 'node -e "setInterval(() => {}, 1000)"',
        cwd: workspace,
      })) as { pid: number };
      await current.cancel();
      await waitFor(() => !alive(fresh.pid));
      expect(alive(older.pid)).toBe(true);
      await stopAllRunningProcesses(1000);
      await waitFor(() => !alive(older.pid));
    },
  );

  it.skipIf(process.platform === "win32")("kills a process that ignores SIGTERM", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "orgops-shell-test-"));
    createdDirs.push(workspace);
    const started = (await execute(createTestContext(workspace, {}), "shell_start", {
      cmd: `node -e "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"`,
      cwd: workspace,
    })) as { processId: string; pid: number };
    // Give node a moment to install its SIGTERM handler.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const stopStarted = Date.now();
    await stopProcessTree(started.processId, 200);
    expect(Date.now() - stopStarted).toBeLessThan(1500);
    await waitFor(() => !alive(started.pid), 1000);
  });

  it.skipIf(process.platform === "win32")(
    "runner shutdown stops a background command's children",
    async () => {
      const workspace = mkdtempSync(join(tmpdir(), "orgops-shell-test-"));
      createdDirs.push(workspace);
      const pidFile = join(workspace, "child.pid");
      await execute(createTestContext(workspace, {}), "shell_start", {
        cmd: parentWithChild(pidFile),
        cwd: workspace,
      });
      const childPid = await readPid(pidFile);
      await stopAllRunningProcesses(500);
      await waitFor(() => !alive(childPid));
    },
  );

  it("does not leak host provider keys without injected secret", async () => {
    process.env.OPENAI_API_KEY = "host-key";
    const workspace = mkdtempSync(join(tmpdir(), "orgops-shell-test-"));
    createdDirs.push(workspace);
    const ctx = createTestContext(workspace, {});
    const result = (await execute(ctx, "shell_run", {
      cmd: 'node -e "process.stdout.write(process.env.OPENAI_API_KEY || \\"__missing__\\")"',
      cwd: workspace,
    })) as { stdout: string; stderr: string; exitCode: number };
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("__missing__");
  });

  it("shell_run exposes the turn's channel as ORGOPS_CHANNEL_ID", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "orgops-shell-test-"));
    createdDirs.push(workspace);
    const ctx = createTestContext(workspace, {});
    const result = (await execute(ctx, "shell_run", {
      cmd: 'node -e "process.stdout.write(process.env.ORGOPS_CHANNEL_ID || \\"__missing__\\")"',
      cwd: workspace,
    })) as { stdout: string; exitCode: number };
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("chan-1");
  });

  it("shell_run without a channel sets no ORGOPS_CHANNEL_ID", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "orgops-shell-test-"));
    createdDirs.push(workspace);
    const ctx = { ...createTestContext(workspace, {}), channelId: undefined };
    const result = (await execute(ctx, "shell_run", {
      cmd: 'node -e "process.stdout.write(process.env.ORGOPS_CHANNEL_ID || \\"__missing__\\")"',
      cwd: workspace,
    })) as { stdout: string; exitCode: number };
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("__missing__");
  });

  it("passes provider keys from injected env", async () => {
    process.env.OPENAI_API_KEY = "host-key";
    const workspace = mkdtempSync(join(tmpdir(), "orgops-shell-test-"));
    createdDirs.push(workspace);
    const ctx = createTestContext(workspace, { OPENAI_API_KEY: "agent-key" });
    const result = (await execute(ctx, "shell_run", {
      cmd: 'node -e "process.stdout.write(process.env.OPENAI_API_KEY || \\"__missing__\\")"',
      cwd: workspace,
    })) as { stdout: string; stderr: string; exitCode: number };
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("agent-key");
  });

  it("records shell_run process events as delivered so they never wake the agent again", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "orgops-shell-test-"));
    createdDirs.push(workspace);
    const ctx = createTestContext(workspace, {});
    const emitted: Array<{ type: string; status?: string }> = [];
    const posted: Array<{ path: string; status?: string }> = [];
    ctx.emitEvent = async (event) => {
      emitted.push(event as { type: string; status?: string });
    };
    ctx.apiFetch = async (path, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      posted.push({ path, status: body.status });
      return new Response("{}", { status: 200 });
    };
    await execute(ctx, "shell_run", { cmd: 'node -e "console.log(1)"', cwd: workspace });
    // The tool result already carries the output, so a restarted runner must not treat these
    // lifecycle events as new work.
    expect(emitted.find((event) => event.type === "process.started")?.status).toBe("DELIVERED");
    expect(posted.find((call) => call.path.endsWith("/output"))?.status).toBe("DELIVERED");
    expect(posted.find((call) => call.path.endsWith("/exit"))?.status).toBe("DELIVERED");

    emitted.length = 0;
    posted.length = 0;
    await execute(ctx, "shell_start", { cmd: 'node -e "console.log(1)"', cwd: workspace });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(emitted.find((event) => event.type === "process.started")?.status).toBeUndefined();
    expect(posted.find((call) => call.path.endsWith("/exit"))?.status).toBeUndefined();
  });

  it("captures a fast command that exits while process registration is pending", async () => {
    process.env.ORGOPS_SHELL_TIMEOUT_KILL_GRACE_MS = "0";
    const workspace = mkdtempSync(join(tmpdir(), "orgops-shell-test-"));
    createdDirs.push(workspace);
    const ctx = createTestContext(workspace, {});
    ctx.apiFetch = async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return new Response("{}", { status: 200 });
    };
    ctx.emitEvent = async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    };

    const result = (await execute(ctx, "shell_run", {
      cmd: 'node -e "process.stdout.write(\\"fast\\")"',
      cwd: workspace,
      timeoutMs: 1_000,
    })) as { stdout: string; stderr: string; exitCode: number };

    expect(result).toEqual({ stdout: "fast", stderr: "", exitCode: 0 });
  });
});
