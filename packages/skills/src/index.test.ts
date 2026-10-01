import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return { ...actual, readdirSync: vi.fn(actual.readdirSync) };
});

import * as fs from "node:fs";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  discoverSkills,
  listSkills,
  loadSkillEventShapes,
  resolveSkillRoots,
} from "./index";

describe("skills", () => {
  it("keeps the built-in root and appends normalized external roots", () => {
    const roots = resolveSkillRoots("/project", ["/private/a", "/private/b"].join(delimiter));
    expect(roots).toEqual([
      { path: resolve("/project/skills"), kind: "BUILT_IN" },
      { path: resolve("/private/a"), kind: "EXTERNAL" },
      { path: resolve("/private/b"), kind: "EXTERNAL" },
    ]);
  });

  it("rejects relative configured roots", () => {
    expect(() => resolveSkillRoots("/project", "relative/skills")).toThrow(
      /ORGOPS_SKILL_ROOTS.*absolute/,
    );
  });

  it("ignores empty and normalized duplicate configured roots", () => {
    const roots = resolveSkillRoots(
      "/project",
      ["", "/project/skills/.", " /private/a/../a ", ""].join(delimiter),
    );
    expect(roots).toEqual([
      { path: resolve("/project/skills"), kind: "BUILT_IN" },
      { path: resolve("/private/a"), kind: "EXTERNAL" },
    ]);
  });

  it("reads built-in skills", () => {
    const skillsDir = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "skills");
    const skills = listSkills({ path: skillsDir, kind: "BUILT_IN" });
    expect(skills.length).toBeGreaterThan(0);
    expect(skills.find((skill) => skill.name === "secrets")).toBeTruthy();
  });

  it("discovers valid skills across roots in deterministic order", () => {
    const builtInRoot = mkdtempSync(join(tmpdir(), "orgops-skills-built-in-"));
    const externalRoot = mkdtempSync(join(tmpdir(), "orgops-skills-external-"));
    const writeSkill = (root: string, name: string) => {
      const skillDir = join(root, name);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        ["---", `name: ${name}`, `description: ${name} skill`, "---", `# ${name}`].join("\n"),
        "utf-8",
      );
    };
    writeSkill(builtInRoot, "beta");
    writeSkill(builtInRoot, "alpha");
    writeSkill(externalRoot, "gamma");
    const originalReaddirSync = vi.mocked(fs.readdirSync).getMockImplementation()!;
    const readdirSpy = vi.spyOn(fs, "readdirSync").mockImplementation((path, options) => {
      const entries = originalReaddirSync(path, options) as unknown as Array<{ name: string; isDirectory: () => boolean }>;
      return (resolve(String(path)) === resolve(builtInRoot) ? entries.reverse() : entries) as never;
    });

    try {
      const result = discoverSkills([
        { path: builtInRoot, kind: "BUILT_IN" },
        { path: externalRoot, kind: "EXTERNAL" },
      ]);
      expect(result.skills.map(({ name }) => name)).toEqual(["alpha", "beta", "gamma"]);
      expect(result.skills.find(({ name }) => name === "gamma")?.root).toEqual({
        path: resolve(externalRoot),
        kind: "EXTERNAL",
      });
      expect(result.conflicts).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    } finally {
      readdirSpy.mockRestore();
      rmSync(builtInRoot, { recursive: true, force: true });
      rmSync(externalRoot, { recursive: true, force: true });
    }
  });

  it("excludes duplicate skill names and reports bounded sorted conflicts", () => {
    const firstRoot = mkdtempSync(join(tmpdir(), "orgops-skills-first-"));
    const secondRoot = mkdtempSync(join(tmpdir(), "orgops-skills-second-"));
    const writeSkill = (root: string) => {
      const skillDir = join(root, "shared");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        ["---", "name: shared", 'description: "Shared skill"', "---"].join("\n"),
        "utf-8",
      );
    };
    writeSkill(firstRoot);
    writeSkill(secondRoot);

    try {
      const result = discoverSkills([
        { path: secondRoot, kind: "EXTERNAL" },
        { path: firstRoot, kind: "EXTERNAL" },
      ]);
      expect(result.skills).toEqual([]);
      expect(result.conflicts).toEqual([
        {
          name: "shared",
          paths: [resolve(firstRoot, "shared"), resolve(secondRoot, "shared")].sort(),
        },
      ]);
      expect(result.conflicts[0].paths.every((path) => !path.includes("SKILL.md"))).toBe(true);
    } finally {
      rmSync(firstRoot, { recursive: true, force: true });
      rmSync(secondRoot, { recursive: true, force: true });
    }
  });

  it("keeps healthy roots when another root is missing", () => {
    const healthyRoot = mkdtempSync(join(tmpdir(), "orgops-skills-healthy-"));
    const missingRoot = resolve(healthyRoot, "missing");
    const skillDir = join(healthyRoot, "healthy");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      ["---", "name: healthy", 'description: "Healthy skill"', "---"].join("\n"),
      "utf-8",
    );

    try {
      const result = discoverSkills([
        { path: missingRoot, kind: "EXTERNAL" },
        { path: healthyRoot, kind: "EXTERNAL" },
      ]);
      expect(result.skills.map(({ name }) => name)).toEqual(["healthy"]);
      expect(result.diagnostics).toEqual([{ path: missingRoot, code: "MISSING" }]);
    } finally {
      rmSync(healthyRoot, { recursive: true, force: true });
    }
  });

  it("reports unreadable roots without exposing file contents", () => {
    const root = resolve(tmpdir(), "orgops-skills-unreadable");
    const readdirSpy = vi.spyOn(fs, "readdirSync").mockImplementation((path) => {
      if (resolve(String(path)) === root) throw new Error("secret file contents");
      return fs.readdirSync(path, { withFileTypes: true, encoding: "utf8" }) as never;
    });

    try {
      const result = discoverSkills([{ path: root, kind: "EXTERNAL" }]);
      expect(result.skills).toEqual([]);
      expect(result.diagnostics).toEqual([{ path: root, code: "UNREADABLE" }]);
      expect(JSON.stringify(result)).not.toContain("secret file contents");
    } finally {
      readdirSpy.mockRestore();
    }
  });

  it("skips a skill whose document disappears while preserving healthy skills", () => {
    const root = mkdtempSync(join(tmpdir(), "orgops-skills-race-"));
    const healthyDir = join(root, "healthy");
    const racedDir = join(root, "raced");
    mkdirSync(healthyDir, { recursive: true });
    mkdirSync(racedDir, { recursive: true });
    const document = (name: string) => `---\nname: ${name}\ndescription: ${name}\n---\n`;
    writeFileSync(join(healthyDir, "SKILL.md"), document("healthy"));
    writeFileSync(join(racedDir, "SKILL.md"), document("raced"));
    const actualReadFile = fs.readFileSync.bind(fs);
    const readSpy = vi.spyOn(fs, "readFileSync").mockImplementation((path, ...args) => {
      if (String(path).endsWith("raced/SKILL.md")) throw new Error("raced away");
      if (String(path).endsWith("healthy/SKILL.md")) return document("healthy") as any;
      return actualReadFile(path, ...(args as [any]));
    });
    try {
      const result = discoverSkills([{ path: root, kind: "EXTERNAL" }]);
      expect(result.skills.map(({ name }) => name)).toEqual(["healthy"]);
      expect(result.diagnostics).toEqual([]);
    } finally {
      readSpy.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips malformed frontmatter and symlink children", () => {
    const root = mkdtempSync(join(tmpdir(), "orgops-skills-invalid-"));
    const validDir = join(root, "valid");
    const brokenDir = join(root, "broken");
    const symlinkTarget = join(root, "symlink-target");
    const symlinkPath = join(root, "linked");
    mkdirSync(validDir, { recursive: true });
    mkdirSync(brokenDir, { recursive: true });
    mkdirSync(symlinkTarget, { recursive: true });
    writeFileSync(
      join(validDir, "SKILL.md"),
      ["---", "name: valid", 'description: "Valid skill"', "---"].join("\n"),
      "utf-8",
    );
    writeFileSync(join(brokenDir, "SKILL.md"), "---\nname: [broken\n---", "utf-8");
    writeFileSync(
      join(symlinkTarget, "SKILL.md"),
      ["---", "name: linked", 'description: "Linked skill"', "---"].join("\n"),
      "utf-8",
    );
    fs.symlinkSync(symlinkTarget, symlinkPath, "dir");

    try {
      const result = discoverSkills([{ path: root, kind: "EXTERNAL" }]);
      expect(result.skills.map(({ name }) => name)).toEqual(["valid"]);
      expect(result.conflicts).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns the compatibility list from a root descriptor", () => {
    const root = mkdtempSync(join(tmpdir(), "orgops-skills-compat-"));
    const skillDir = join(root, "compat");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      ["---", "name: compat", 'description: "Compatibility skill"', "---"].join("\n"),
      "utf-8",
    );

    try {
      expect(listSkills({ path: root, kind: "EXTERNAL" }).map(({ name }) => name)).toEqual([
        "compat",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips malformed skill frontmatter and keeps loading others", () => {
    const root = mkdtempSync(join(tmpdir(), "orgops-skills-test-"));
    const validDir = join(root, "valid");
    const brokenDir = join(root, "broken");
    mkdirSync(validDir, { recursive: true });
    mkdirSync(brokenDir, { recursive: true });

    writeFileSync(
      join(validDir, "SKILL.md"),
      [
        "---",
        "name: valid",
        'description: "Valid skill"',
        "---",
        "# Valid",
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(brokenDir, "SKILL.md"),
      [
        "---",
        "name: broken",
        "description: bad: frontmatter",
        "---",
        "# Broken",
      ].join("\n"),
      "utf-8",
    );

    try {
      const skills = listSkills({ path: root, kind: "EXTERNAL" });
      expect(skills.map((skill) => skill.name)).toEqual(["valid"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("loads skill-provided TypeScript event shapes", async () => {
    const root = mkdtempSync(join(tmpdir(), "orgops-skills-events-test-"));
    const skillDir = join(root, "bridge");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      [
        "---",
        "name: bridge",
        'description: "Bridge skill"',
        "---",
        "# Bridge",
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(skillDir, "event-shapes.ts"),
      [
        "export const eventShapes = [",
        "  {",
        '    type: "bridge.event",',
        '    description: "Bridge event",',
        "    payloadExample: { ok: true },",
        "  },",
        "];",
      ].join("\n"),
      "utf-8",
    );

    try {
      const skills = listSkills({ path: root, kind: "EXTERNAL" });
      const loaded = await loadSkillEventShapes(skills);
      expect(loaded.errors).toEqual([]);
      expect(loaded.shapes.some((shape) => shape.type === "bridge.event")).toBe(
        true,
      );
      expect(
        loaded.shapes.find((shape) => shape.type === "bridge.event")?.source,
      ).toBe("skill:bridge");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
