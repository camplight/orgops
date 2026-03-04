import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSkills } from "./index";

describe("skills", () => {
  it("reads built-in skills", () => {
    const skillsDir = join(import.meta.dir, "..", "..", "..", "skills");
    const skills = listSkills([{ path: skillsDir, location: "workspace" }]);
    expect(skills.length).toBeGreaterThan(0);
    expect(skills.find((skill) => skill.name === "secrets")).toBeTruthy();
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
      const skills = listSkills([{ path: root, location: "workspace" }]);
      expect(skills.map((skill) => skill.name)).toEqual(["valid"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
