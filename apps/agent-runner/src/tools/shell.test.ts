import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { execute } from "./shell";
import type { ExecuteContext } from "./types";

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
