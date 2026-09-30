import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePorcelainPaths, validateChangedSkills } from "./skill-changes";
import type { RepositoryConfig } from "./repository-config";

function fixture(): RepositoryConfig {
  const root = mkdtempSync(join(tmpdir(), "orgops-skills-"));
  mkdirSync(join(root, "skills", "demo"), { recursive: true });
  writeFileSync(join(root, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: Demo\n---\n");
  return { repositoryUrl: "https://example.test/repo.git", repositoryPath: root, skillsPath: join(root, "skills"), defaultBranch: "main" };
}

describe("skill change validation", () => {
  it("validates allowed skill paths and returns sorted names", () => {
    const config = fixture();
    expect(validateChangedSkills(config, ["skills/demo/assets/run.ts", "skills/demo/SKILL.md"])).toEqual({ ok: true, skillNames: ["demo"], paths: ["skills/demo/SKILL.md", "skills/demo/assets/run.ts"] });
  });

  it.each(["/tmp/x", "skills/../outside", ".git/config", "README.md"]) ("rejects unsafe path %s", (path) => {
    const config = fixture();
    expect(validateChangedSkills(config, [path])).toMatchObject({ ok: false, code: "PATH_OUTSIDE_SKILLS" });
  });

  it("rejects a skill with missing metadata", () => {
    expect(validateChangedSkills(fixture(), ["skills/other/file.ts"])).toMatchObject({ ok: false, code: "INVALID_SKILL" });
  });

  it("parses untracked and rename records without whitespace splitting", () => {
    const parsed = parsePorcelainPaths("?? skills/demo/a file.ts\0R  skills/demo/new.ts\0skills/demo/old.ts\0");
    expect(parsed.map((entry) => entry.path)).toEqual(["skills/demo/a file.ts", "skills/demo/new.ts", "skills/demo/old.ts"]);
  });

  it("validates both paths of a rename and complete skill deletion", () => {
    const config = fixture();
    expect(validateChangedSkills(config, [
      { path: "skills/demo/new-name.ts", status: "R" },
      { path: "skills/demo/old-name.ts", status: "D" },
    ])).toMatchObject({ ok: true, skillNames: ["demo"] });
    mkdirSync(join(config.skillsPath, "gone"), { recursive: true });
    writeFileSync(join(config.skillsPath, "gone", "SKILL.md"), "---\nname: gone\ndescription: Gone\n---\n");
    unlinkSync(join(config.skillsPath, "gone", "SKILL.md"));
    expect(validateChangedSkills(config, [
      { path: "skills/gone/SKILL.md", status: "D" },
      { path: "skills/gone/assets.ts", status: "D" },
    ])).toMatchObject({ ok: true, skillNames: ["gone"] });
  });

  it("returns a fixed no changes error", () => {
    expect(validateChangedSkills(fixture(), [])).toMatchObject({ ok: false, code: "NO_CHANGES" });
  });
});
