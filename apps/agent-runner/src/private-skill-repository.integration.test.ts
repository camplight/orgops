import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  discoverSkills,
  loadSkillEventShapes,
  resolveSkillRoots,
} from "@orgops/skills";
import { resolvePrivateSkillRepositoryAccess } from "./private-skill-repository-access";
import { runRepositoryCommand } from "../../../skills/private-skill-repository/assets/manage-repository";

function writeSkill(root: string, name: string, description: string, eventType?: string) {
  const skillDir = join(root, name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    [`---`, `name: ${name}`, `description: ${description}`, `---`, `# ${name}`].join("\n"),
  );
  if (eventType) {
    writeFileSync(
      join(skillDir, "event-shapes.ts"),
      `export const eventShapes = [{ type: "${eventType}", description: "fixture event", payloadExample: { ok: true } }];\n`,
    );
  }
}

describe("private skill repository integration boundary", () => {
  it("syncs an offline checkout into discovery, access, preload, event shapes, and duplicate handling", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "orgops-private-project-"));
    const gitRoot = mkdtempSync(join(tmpdir(), "orgops-private-git-"));
    const remote = join(gitRoot, "remote.git");
    const seed = join(gitRoot, "seed");
    const checkout = join(gitRoot, "checkout");
    const builtInSkills = join(projectRoot, "skills");
    const repositorySkills = join(checkout, "skills");
    writeSkill(builtInSkills, "private-skill-repository", "Manage private skills");
    writeSkill(builtInSkills, "duplicate", "Built-in duplicate");
    execFileSync("git", ["init", "--bare", remote]);
    execFileSync("git", ["init", "-b", "main", seed]);
    execFileSync("git", ["config", "user.name", "Fixture"], { cwd: seed });
    execFileSync("git", ["config", "user.email", "fixture@example.test"], { cwd: seed });
    writeSkill(join(seed, "skills"), "private-workflow", "Private workflow", "private.workflow");
    writeSkill(join(seed, "skills"), "duplicate", "Private duplicate");
    execFileSync("git", ["add", "skills"], { cwd: seed });
    execFileSync("git", ["commit", "-m", "initial"], { cwd: seed });
    execFileSync("git", ["remote", "add", "origin", remote], { cwd: seed });
    execFileSync("git", ["push", "origin", "main"], { cwd: seed });

    const env = {
      PRIVATE_SKILLS_REPO_URL: remote,
      PRIVATE_SKILLS_REPO_PATH: checkout,
      PRIVATE_SKILLS_REPO_BRANCH: "main",
      ORGOPS_SKILL_ROOTS: repositorySkills,
    };
    try {
      const roots = resolveSkillRoots(projectRoot, repositorySkills);
      const beforeSync = discoverSkills(roots);
      expect(beforeSync.skills.map(({ name }) => name)).toEqual([
        "duplicate",
        "private-skill-repository",
      ]);
      expect(beforeSync.diagnostics).toEqual([
        { path: resolve(repositorySkills), code: "MISSING" },
      ]);

      expect(await runRepositoryCommand(["sync"], { env })).toMatchObject({
        ok: true,
        operation: "sync",
      });
      const afterSync = discoverSkills(roots);
      expect(afterSync.skills.map(({ name }) => name)).toEqual([
        "private-skill-repository",
        "private-workflow",
      ]);
      expect(afterSync.diagnostics).toEqual([]);

      const managementAccess = resolvePrivateSkillRepositoryAccess({
        selectedSkills: afterSync.skills,
        roots,
        repositoryPath: checkout,
      });
      expect(managementAccess).toEqual({ ok: true, skillsPath: resolve(repositorySkills) });
      const privateSkill = afterSync.skills.find(({ name }) => name === "private-workflow");
      expect(privateSkill).toBeDefined();
      expect(readFileSync(join(privateSkill!.path, "SKILL.md"), "utf8")).toContain(
        "name: private-workflow",
      );
      const loadedShapes = await loadSkillEventShapes([privateSkill!]);
      expect(loadedShapes.errors).toEqual([]);
      expect(loadedShapes.shapes.map(({ type }) => type)).toEqual(["private.workflow"]);

      const duplicateDiscovery = discoverSkills(roots);
      expect(duplicateDiscovery.skills.some(({ name }) => name === "duplicate")).toBe(false);
      expect(duplicateDiscovery.conflicts).toEqual([
        {
          name: "duplicate",
          paths: [
            resolve(builtInSkills, "duplicate"),
            resolve(repositorySkills, "duplicate"),
          ].sort(),
        },
      ]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(gitRoot, { recursive: true, force: true });
    }
  });
});
