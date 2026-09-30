import { join, posix } from "node:path";
import { loadSkillMeta } from "@orgops/skills";
import type { RepositoryConfig } from "./repository-config";

export type ChangedPath = { path: string; status: string };
export type SkillValidation =
  | { ok: true; skillNames: string[]; paths: string[] }
  | { ok: false; code: "NO_CHANGES" | "PATH_OUTSIDE_SKILLS" | "INVALID_SKILL"; message: string };

const SAFE_PATH = /^skills\/([^/]+)\/(.+)$/;

export function parsePorcelainPaths(output: string): ChangedPath[] {
  const fields = output.split("\0");
  const result: ChangedPath[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const record = fields[index];
    if (!record) continue;
    const status = record.slice(0, 2);
    const path = record.slice(3);
    if (!path) continue;
    result.push({ path, status });
    if (status.includes("R") || status.includes("C")) {
      const oldPath = fields[++index];
      if (oldPath) result.push({ path: oldPath, status: "D" });
    }
  }
  return result;
}

function safeRelativePath(path: string): boolean {
  if (!path || path.startsWith("/") || path.includes("\\") || path.includes("\0")) return false;
  const normalized = posix.normalize(path);
  return normalized === path && !path.split("/").some((part) => part === ".." || part === ".") && !path.split("/").includes(".git");
}

export function validateChangedSkills(
  config: RepositoryConfig,
  changed: string[] | ChangedPath[],
): SkillValidation {
  if (changed.length === 0) return { ok: false, code: "NO_CHANGES", message: "No skill changes found." };
  const entries: ChangedPath[] = changed.map((item) => typeof item === "string" ? { path: item, status: "M" } : item);
  const names = new Set<string>();
  const paths = new Set<string>();
  for (const entry of entries) {
    if (!safeRelativePath(entry.path)) return { ok: false, code: "PATH_OUTSIDE_SKILLS", message: "Changed path is outside skills/." };
    const match = entry.path.match(SAFE_PATH);
    if (!match || match[1] === ".git") return { ok: false, code: "PATH_OUTSIDE_SKILLS", message: "Changed path is outside skills/." };
    names.add(match[1]);
    paths.add(entry.path);
  }
  const sortedNames = [...names].sort();
  for (const name of sortedNames) {
    const skillEntries = entries.filter((entry) => entry.path.startsWith(`skills/${name}/`));
    const deletedCompleteSkill = skillEntries.length > 0 && skillEntries.every((entry) => entry.status.includes("D")) && skillEntries.some((entry) => entry.path === `skills/${name}/SKILL.md`);
    if (deletedCompleteSkill) continue;
    const meta = loadSkillMeta(join(config.skillsPath, name));
    if (!meta || meta.name !== name) {
      return { ok: false, code: "INVALID_SKILL", message: "Affected skill metadata is invalid." };
    }
  }
  return { ok: true, skillNames: sortedNames, paths: [...paths].sort() };
}
