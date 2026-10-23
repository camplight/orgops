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

  it("rejects paths descending through an existing regular file", () => {
    const root = mkdtempSync(join(tmpdir(), "orgops-path-"));
    try {
      writeFileSync(join(root, "file.txt"), "not a directory");
      const agent = { workspacePath: root, allowOutsideWorkspace: false } as any;
      expect(() => resolveAgentPath(agent, "file.txt/child.txt")).toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("resolves safe in-root symlinks to their canonical target", () => {
    const root = mkdtempSync(join(tmpdir(), "orgops-path-"));
    try {
      mkdirSync(join(root, "target"));
      writeFileSync(join(root, "target", "existing.txt"), "safe");
      symlinkSync("target", join(root, "link"));
      const agent = { workspacePath: root, allowOutsideWorkspace: false } as any;
      expect(resolveAgentPath(agent, "link/existing.txt")).toBe(join(root, "target/existing.txt"));
      expect(resolveAgentPath(agent, "link/new/deep/file.txt")).toBe(join(root, "target/new/deep/file.txt"));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("rejects multi-hop, broken, and cyclic symlink escapes", () => {
    const root = mkdtempSync(join(tmpdir(), "orgops-path-"));
    const outside = mkdtempSync(join(tmpdir(), "orgops-outside-"));
    try {
      writeFileSync(join(outside, "secret.txt"), "secret");
      symlinkSync(outside, join(root, "escape"));
      symlinkSync(join(outside, "missing.txt"), join(root, "broken"));
      symlinkSync("second", join(root, "first"));
      symlinkSync(outside, join(root, "second"));
      symlinkSync("cycle-b", join(root, "cycle-a"));
      symlinkSync("cycle-a", join(root, "cycle-b"));
      const agent = { workspacePath: root, allowOutsideWorkspace: false } as any;
      expect(() => resolveAgentPath(agent, "escape/secret.txt")).toThrow();
      expect(() => resolveAgentPath(agent, "broken")).toThrow();
      expect(() => resolveAgentPath(agent, "first/secret.txt")).toThrow();
      expect(() => resolveAgentPath(agent, "cycle-a/file.txt")).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("permits long ordinary paths, enabled skill roots, and all host paths when explicitly enabled", () => {
    const root = mkdtempSync(join(tmpdir(), "orgops-path-"));
    const skill = mkdtempSync(join(tmpdir(), "orgops-skill-"));
    try {
      mkdirSync(join(skill, "assets"));
      const longParts = Array.from({ length: 45 }, (_, index) => `part-${index}`);
      const longPath = join(root, ...longParts, "file.txt");
      mkdirSync(join(root, ...longParts), { recursive: true });
      const agent = { workspacePath: root, allowOutsideWorkspace: false } as any;
      expect(resolveAgentPath(agent, longPath)).toBe(longPath);
      expect(resolveAgentPath(agent, join(skill, "assets/tool"), [skill])).toBe(join(skill, "assets/tool"));
      const unrestricted = { workspacePath: root, allowOutsideWorkspace: true } as any;
      expect(resolveAgentPath(unrestricted, "/etc/hosts")).toBe("/etc/hosts");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(skill, { recursive: true, force: true });
    }
  });
});
