import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAgentPath } from "./path-access";

const dirs: string[] = [];
const agent = (workspacePath: string, allowOutsideWorkspace = false) => ({
  name: "tester", systemInstructions: "", soulPath: "", workspacePath,
  modelId: "test", desiredState: "RUNNING" as const, runtimeState: "RUNNING" as const,
  allowOutsideWorkspace,
});

afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("resolveAgentPath realpath containment", () => {
  it("rejects an existing symlink that escapes an allowed workspace", () => {
    const root = mkdtempSync(join(tmpdir(), "orgops-path-")); dirs.push(root);
    const outside = mkdtempSync(join(tmpdir(), "orgops-outside-")); dirs.push(outside);
    writeFileSync(join(outside, "secret"), "no");
    symlinkSync(join(outside, "secret"), join(root, "link"));
    expect(() => resolveAgentPath(agent(root), "link")).toThrow(/outside allowed roots/);
  });

  it("rejects a create below a symlinked parent that escapes an allowed external root", () => {
    const root = mkdtempSync(join(tmpdir(), "orgops-path-")); dirs.push(root);
    const outside = mkdtempSync(join(tmpdir(), "orgops-outside-")); dirs.push(outside);
    symlinkSync(outside, join(root, "link"));
    const workspace = mkdtempSync(join(tmpdir(), "orgops-work-")); dirs.push(workspace);
    expect(() => resolveAgentPath(agent(workspace), join(root, "link/new"), [root])).toThrow(/outside allowed roots/);
  });

  it("keeps canonical valid workspace and external paths, including creates", () => {
    const root = mkdtempSync(join(tmpdir(), "orgops-path-")); dirs.push(root);
    const external = mkdtempSync(join(tmpdir(), "orgops-external-")); dirs.push(external);
    mkdirSync(join(external, "new-parent"));
    expect(resolveAgentPath(agent(root), "file.txt")).toBe(join(realpathSync(root), "file.txt"));
    expect(resolveAgentPath(agent(root), join(external, "new-parent/file.txt"), [external])).toBe(join(realpathSync(external), "new-parent/file.txt"));
  });

  it("allows any canonical path when allowOutsideWorkspace is enabled", () => {
    const root = mkdtempSync(join(tmpdir(), "orgops-path-")); dirs.push(root);
    const outside = mkdtempSync(join(tmpdir(), "orgops-outside-")); dirs.push(outside);
    writeFileSync(join(outside, "file"), "ok");
    expect(resolveAgentPath(agent(root, true), join(outside, "file"))).toBe(realpathSync(join(outside, "file")));
  });
});
