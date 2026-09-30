import { describe, expect, it } from "vitest";
import { createGitRunner } from "./git-process";

describe("createGitRunner", () => {
  it("invokes git with shell disabled and redacts authentication material", async () => {
    const calls: Array<{ args: string[]; options: any }> = [];
    const runner = createGitRunner({
      env: { PATH: "/bin", PRIVATE_SKILLS_GIT_TOKEN: "fixture-token", PRIVATE_SKILLS_GIT_USERNAME: "fixture-user" },
      spawnImpl: ((_: string, args: string[], options: any) => {
        calls.push({ args, options });
        const listeners: Record<string, (...args: any[]) => void> = {};
        const child: any = {
          stdout: { on: (event: string, cb: (...args: any[]) => void) => { listeners[`stdout:${event}`] = cb; } },
          stderr: { on: (event: string, cb: (...args: any[]) => void) => { listeners[`stderr:${event}`] = cb; } },
          on: (event: string, cb: (...args: any[]) => void) => { listeners[event] = cb; },
          kill: () => undefined,
        };
        queueMicrotask(() => { listeners["stdout:data"]?.(Buffer.from("fixture-token")); listeners.close?.(0, null); });
        return child;
      }) as any,
    });
    const result = await runner.run(["config", "--get", "remote.origin.url"]);
    expect(calls[0].args).not.toContain("fixture-token");
    expect(calls[0].options.shell).toBe(false);
    expect(result.stdout).toBe("[REDACTED]");
  });

  it("cleans owner-only askpass material after a spawn failure", async () => {
    const removed: string[] = [];
    let mode = 0;
    const runner = createGitRunner({
      env: { PRIVATE_SKILLS_GIT_TOKEN: "secret-token" },
      mkdtempImpl: async () => "/tmp/orgops-askpass-fixture",
      writeFileImpl: async (_path, _data, options) => { mode = options.mode; },
      chmodImpl: async (_path, value) => { mode = value; },
      rmImpl: async (path) => { removed.push(path); },
      spawnImpl: (() => { throw new Error("spawn failed"); }) as any,
    });
    const result = await runner.run(["fetch"]);
    expect(result.code).toBe("GIT_FAILED");
    expect(mode).toBe(0o700);
    expect(removed).toEqual(["/tmp/orgops-askpass-fixture"]);
  });
});
