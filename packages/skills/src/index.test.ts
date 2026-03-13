import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSkills, loadSkillEventShapes } from "./index";

describe("skills", () => {
  it("reads built-in skills", () => {
    const skillsDir = join(import.meta.dir, "..", "..", "..", "skills");
    const skills = listSkills({ path: skillsDir });
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
      const skills = listSkills({ path: root });
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
      const skills = listSkills({ path: root });
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
