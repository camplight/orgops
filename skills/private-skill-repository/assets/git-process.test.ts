import { describe, expect, it } from "vitest";
import { createGitRunner } from "./git-process";

describe("createGitRunner", () => {
  it("invokes git with shell disabled and redacts authentication material", async () => {
    const calls: Array<{ args: string[]; options: any }> = [];
    const removed: string[] = [];
    const runner = createGitRunner({
      env: { PATH: "/bin", PRIVATE_SKILLS_GIT_TOKEN: "fixture-token", PRIVATE_SKILLS_GIT_USERNAME: "fixture-user" },
      mkdtempImpl: async () => "/tmp/success-askpass", writeFileImpl: async () => undefined, chmodImpl: async () => undefined,
      rmImpl: async (path) => { removed.push(path); },
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
    expect(removed).toEqual(["/tmp/success-askpass"]);
  });

  it("preserves host environment and disables terminal prompts without a token", async () => {
    let received: any;
    const runner = createGitRunner({
      env: { PATH: "/host/bin", HOST_GIT_HELPER: "available" },
      spawnImpl: ((_: string, _args: string[], options: any) => {
        expect(options.shell).toBe(false);
        received = options;
        const listeners: Record<string, (...args: any[]) => void> = {};
        const child: any = {
          stdout: { on: () => undefined }, stderr: { on: () => undefined },
          on: (event: string, cb: (...args: any[]) => void) => { listeners[event] = cb; }, kill: () => true,
        };
        queueMicrotask(() => listeners.close?.(0, null));
        return child;
      }) as any,
    });
    await runner.run(["status"]);
    expect(received.shell).toBe(false);
    expect(received.env.PATH).toBe("/host/bin");
    expect(received.env.HOST_GIT_HELPER).toBe("available");
    expect(received.env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(received.env.GIT_ASKPASS).toBeUndefined();
  });

  it("cleans owner-only askpass material after a nonzero exit", async () => {
    const removed: string[] = [];
    let script = "";
    const runner = createGitRunner({
      env: { PRIVATE_SKILLS_GIT_TOKEN: "secret-token", PRIVATE_SKILLS_GIT_USERNAME: "secret-user" },
      mkdtempImpl: async () => "/tmp/orgops-askpass-fixture",
      writeFileImpl: async (_path, data, options) => { script = data; expect(options.mode).toBe(0o700); },
      chmodImpl: async (_path, value) => expect(value).toBe(0o700),
      rmImpl: async (path) => { removed.push(path); },
      spawnImpl: ((_: string, _args: string[], options: any) => {
        expect(options.shell).toBe(false);
        const listeners: Record<string, (...args: any[]) => void> = {};
        const child: any = { stdout: { on: () => undefined }, stderr: { on: (e: string, cb: (...a: any[]) => void) => { listeners[`stderr:${e}`] = cb; } }, on: (e: string, cb: (...a: any[]) => void) => { listeners[e] = cb; }, kill: () => true };
        queueMicrotask(() => { listeners["stderr:data"]?.(Buffer.from("HTTP 403 secret-token /tmp/orgops-askpass-fixture")); listeners.close?.(1, null); });
        return child;
      }) as any,
    });
    const result = await runner.run(["fetch"]);
    expect(result.code).toBe("AUTH_FAILED");
    expect(result.stderr).not.toContain("secret-token");
    expect(result.stderr).not.toContain("secret-user");
    expect(result.stderr).not.toContain("/tmp/orgops-askpass-fixture");
    expect(script).toContain("PRIVATE_SKILLS_GIT_TOKEN");
    expect(removed).toEqual(["/tmp/orgops-askpass-fixture"]);
  });

  it("bounds a single huge output chunk and cleans up on timeout", async () => {
    const removed: string[] = [];
    let killCount = 0;
    const huge = Buffer.alloc(1024 * 1024, "x");
    const runner = createGitRunner({
      env: { PRIVATE_SKILLS_GIT_TOKEN: "token" },
      mkdtempImpl: async () => "/tmp/askpass", writeFileImpl: async () => undefined, chmodImpl: async () => undefined, rmImpl: async (path) => { removed.push(path); },
      spawnImpl: ((_: string, _args: string[], options: any) => {
        expect(options.shell).toBe(false);
        const listeners: Record<string, (...args: any[]) => void> = {};
        const child: any = { stdout: { on: (e: string, cb: (...a: any[]) => void) => { listeners[`stdout:${e}`] = cb; } }, stderr: { on: () => undefined }, on: (e: string, cb: (...a: any[]) => void) => { listeners[e] = cb; }, kill: () => { killCount += 1; return true; } };
        queueMicrotask(() => listeners["stdout:data"]?.(huge));
        return child;
      }) as any,
    });
    const result = await runner.run(["fetch"], { timeoutMs: 5 });
    expect(result.code).toBe("GIT_FAILED");
    expect(result.stdout.length).toBeLessThanOrEqual(64 * 1024);
    expect(killCount).toBeGreaterThan(0);
    expect(removed).toEqual(["/tmp/askpass"]);
  });

  it("cleans askpass material when a process times out", async () => {
    const removed: string[] = [];
    let killed = false;
    const runner = createGitRunner({
      env: { PRIVATE_SKILLS_GIT_TOKEN: "timeout-token" },
      mkdtempImpl: async () => "/tmp/timeout-askpass", writeFileImpl: async () => undefined, chmodImpl: async () => undefined,
      rmImpl: async (path) => { removed.push(path); },
      spawnImpl: ((_: string, _args: string[], options: any) => { expect(options.shell).toBe(false); return { stdout: { on: () => undefined }, stderr: { on: () => undefined }, on: () => undefined, kill: () => { killed = true; return true; } }; }) as any,
    });
    const result = await runner.run(["fetch"], { timeoutMs: 1 });
    expect(result.code).toBe("GIT_TIMEOUT");
    expect(killed).toBe(true);
    expect(removed).toEqual(["/tmp/timeout-askpass"]);
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
