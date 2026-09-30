import { isAbsolute, join, resolve } from "node:path";
import type { SkillMeta, SkillRoot } from "@orgops/skills";

const MANAGEMENT_SKILL_NAME = "private-skill-repository";

export type PrivateSkillRepositoryAccessReason =
  | "BUILT_IN_ROOT_NOT_CONFIGURED"
  | "MANAGEMENT_SKILL_NOT_SELECTED"
  | "MANAGEMENT_SKILL_NOT_CANONICAL"
  | "REPOSITORY_PATH_NOT_CONFIGURED"
  | "REPOSITORY_PATH_NOT_ABSOLUTE"
  | "REPOSITORY_SKILLS_ROOT_NOT_CONFIGURED";

export type PrivateSkillRepositoryAccessInput = {
  selectedSkills: SkillMeta[];
  roots: SkillRoot[];
  repositoryPath?: string;
};

export type PrivateSkillRepositoryAccessResult =
  | { ok: true; skillsPath: string }
  | { ok: false; reason: PrivateSkillRepositoryAccessReason };

export function resolvePrivateSkillRepositoryAccess(
  input: PrivateSkillRepositoryAccessInput,
): PrivateSkillRepositoryAccessResult {
  const builtInRoot = input.roots.find((root) => root.kind === "BUILT_IN");
  if (!builtInRoot) return { ok: false, reason: "BUILT_IN_ROOT_NOT_CONFIGURED" };

  const canonicalManagementPath = resolve(
    join(builtInRoot.path, MANAGEMENT_SKILL_NAME),
  );
  const managementSkill = input.selectedSkills.find(
    (skill) => skill.name === MANAGEMENT_SKILL_NAME,
  );
  if (!managementSkill) {
    return { ok: false, reason: "MANAGEMENT_SKILL_NOT_SELECTED" };
  }
  if (
    managementSkill.root.kind !== "BUILT_IN" ||
    resolve(managementSkill.root.path) !== resolve(builtInRoot.path) ||
    resolve(managementSkill.path) !== canonicalManagementPath
  ) {
    return { ok: false, reason: "MANAGEMENT_SKILL_NOT_CANONICAL" };
  }

  if (!input.repositoryPath) {
    return { ok: false, reason: "REPOSITORY_PATH_NOT_CONFIGURED" };
  }
  if (!isAbsolute(input.repositoryPath)) {
    return { ok: false, reason: "REPOSITORY_PATH_NOT_ABSOLUTE" };
  }

  const skillsPath = resolve(join(input.repositoryPath, "skills"));
  const configuredExternalRoot = input.roots.some(
    (root) => root.kind === "EXTERNAL" && resolve(root.path) === skillsPath,
  );
  if (!configuredExternalRoot) {
    return { ok: false, reason: "REPOSITORY_SKILLS_ROOT_NOT_CONFIGURED" };
  }
  return { ok: true, skillsPath };
}
