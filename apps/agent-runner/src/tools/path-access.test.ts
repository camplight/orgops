import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveAgentPath } from "./path-access";

describe("resolveAgentPath", () => {
  it("authorizes workspace paths and legitimate non-existing targets", () => {
    const root = mkdtempSync(join(tmpdir(), "orgops-path-"));
    try {
      const agent = { workspacePath: root, allowOutsideWorkspace: false } as any;
      expect(resolveAgentPath(agent, "notes.txt")).toBe(join(root, "notes.txt"));
      expect(resolveAgentPath(agent, "new/deep/file.txt")).toBe(join(root, "new/deep/file.txt"));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("rejects symlink escapes and broken symlinks escaping the workspace", () => {
    const root = mkdtempSync(join(tmpdir(), "orgops-path-"));
    const outside = mkdtempSync(join(tmpdir(), "orgops-outside-"));
    try {
      writeFileSync(join(outside, "secret.txt"), "secret");
      symlinkSync(outside, join(root, "escape"));
      symlinkSync(join(outside, "missing.txt"), join(root, "broken"));
      const agent = { workspacePath: root, allowOutsideWorkspace: false } as any;
      expect(() => resolveAgentPath(agent, "escape/secret.txt")).toThrow();
      expect(() => resolveAgentPath(agent, "broken")).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("permits enabled skill roots and all host paths when explicitly enabled", () => {
    const root = mkdtempSync(join(tmpdir(), "orgops-path-"));
    const skill = mkdtempSync(join(tmpdir(), "orgops-skill-"));
    try {
      mkdirSync(join(skill, "assets"));
      const agent = { workspacePath: root, allowOutsideWorkspace: false } as any;
      expect(resolveAgentPath(agent, join(skill, "assets/tool"), [skill])).toBe(join(skill, "assets/tool"));
      const unrestricted = { workspacePath: root, allowOutsideWorkspace: true } as any;
      expect(resolveAgentPath(unrestricted, "/etc/hosts")).toBe("/etc/hosts");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(skill, { recursive: true, force: true });
    }
  });
});
