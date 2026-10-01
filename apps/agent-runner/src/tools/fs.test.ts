import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { execute } from "./fs";
import type { ExecuteContext } from "./types";

const dirs: string[] = [];
const context = (workspacePath: string): ExecuteContext => ({
  agent: { name: "tester", systemInstructions: "", soulPath: "", workspacePath, modelId: "test", desiredState: "RUNNING", runtimeState: "RUNNING" },
  triggerEvent: { id: "evt", type: "message.created", payload: {}, source: "human:test", channelId: "channel" },
  channelId: "channel", injectionEnv: {}, apiFetch: async () => new Response("{}"), emitEvent: async () => {}, emitAudit: async () => {},
});

afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("filesystem tool realpath containment", () => {
  it("does not write through a broken symlink outside the workspace", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "orgops-fs-")); dirs.push(workspace);
    const outside = mkdtempSync(join(tmpdir(), "orgops-fs-outside-")); dirs.push(outside);
    const outsideTarget = join(outside, "created");
    symlinkSync(outsideTarget, join(workspace, "broken-link"));
    await expect(execute(context(workspace), "fs_write", { path: "broken-link", content: "must not escape" })).rejects.toThrow(/outside allowed roots/);
    expect(existsSync(outsideTarget)).toBe(false);
  });

  it("does not read or write through a symlink outside the workspace", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "orgops-fs-")); dirs.push(workspace);
    const outside = mkdtempSync(join(tmpdir(), "orgops-fs-outside-")); dirs.push(outside);
    writeFileSync(join(outside, "secret"), "secret");
    symlinkSync(join(outside, "secret"), join(workspace, "link"));
    const ctx = context(workspace);
    await expect(execute(ctx, "fs_read", { path: "link" })).rejects.toThrow(/outside allowed roots/);
    await expect(execute(ctx, "fs_write", { path: "link", content: "changed" })).rejects.toThrow(/outside allowed roots/);
  });
});
