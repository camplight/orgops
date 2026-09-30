import { describe, expect, it } from "vitest";
import type { SkillMeta, SkillRoot } from "@orgops/skills";
import { resolve } from "node:path";
import { resolvePrivateSkillRepositoryAccess } from "./private-skill-repository-access";

const builtInRoot: SkillRoot = { path: "/project/skills", kind: "BUILT_IN" };
const externalRoot: SkillRoot = { path: "/srv/private/skills", kind: "EXTERNAL" };
const canonicalBuiltInManagementSkill: SkillMeta = {
  name: "private-skill-repository",
  description: "Manage private skills",
  path: "/project/skills/private-skill-repository",
  root: builtInRoot,
};

function skill(name: string, path: string, root: SkillRoot): SkillMeta {
  return { name, description: "test", path, root };
}

describe("resolvePrivateSkillRepositoryAccess", () => {
  it("grants only the configured external skills directory to the canonical built-in skill", () => {
    expect(
      resolvePrivateSkillRepositoryAccess({
        selectedSkills: [canonicalBuiltInManagementSkill],
        roots: [builtInRoot, externalRoot],
        repositoryPath: "/srv/private",
      }),
    ).toEqual({ ok: true, skillsPath: resolve("/srv/private/skills") });
  });

  it.each([
    {
      name: "management skill absent",
      selectedSkills: [],
      roots: [builtInRoot, externalRoot],
      repositoryPath: "/srv/private",
      reason: "MANAGEMENT_SKILL_NOT_SELECTED",
    },
    {
      name: "external skill impersonates management skill",
      selectedSkills: [
        skill("private-skill-repository", "/srv/private/skills/private-skill-repository", externalRoot),
      ],
      roots: [builtInRoot, externalRoot],
      repositoryPath: "/srv/private",
      reason: "MANAGEMENT_SKILL_NOT_CANONICAL",
    },
    {
      name: "management skill is outside the canonical built-in directory",
      selectedSkills: [
        skill(
          "private-skill-repository",
          "/project/other/private-skill-repository",
          builtInRoot,
        ),
      ],
      roots: [builtInRoot, externalRoot],
      repositoryPath: "/srv/private",
      reason: "MANAGEMENT_SKILL_NOT_CANONICAL",
    },
    {
      name: "repository path is relative",
      selectedSkills: [canonicalBuiltInManagementSkill],
      roots: [builtInRoot, externalRoot],
      repositoryPath: "private",
      reason: "REPOSITORY_PATH_NOT_ABSOLUTE",
    },
    {
      name: "repository skills directory is not configured",
      selectedSkills: [canonicalBuiltInManagementSkill],
      roots: [builtInRoot, { path: "/srv/other/skills", kind: "EXTERNAL" }],
      repositoryPath: "/srv/private",
      reason: "REPOSITORY_SKILLS_ROOT_NOT_CONFIGURED",
    },
    {
      name: "repository path is absent",
      selectedSkills: [canonicalBuiltInManagementSkill],
      roots: [builtInRoot, externalRoot],
      repositoryPath: undefined,
      reason: "REPOSITORY_PATH_NOT_CONFIGURED",
    },
    {
      name: "roots are absent",
      selectedSkills: [canonicalBuiltInManagementSkill],
      roots: [],
      repositoryPath: "/srv/private",
      reason: "BUILT_IN_ROOT_NOT_CONFIGURED",
    },
  ])("denies access when $name", ({ selectedSkills, roots, repositoryPath, reason }) => {
    expect(
      resolvePrivateSkillRepositoryAccess({
        selectedSkills,
        roots: roots as SkillRoot[],
        repositoryPath,
      }),
    ).toEqual({ ok: false, reason });
  });
});
