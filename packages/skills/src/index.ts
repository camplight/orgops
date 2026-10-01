import { existsSync, readFileSync, readdirSync, type Dirent } from "node:fs";
import { basename, delimiter, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { EventShapeDefinition } from "@orgops/schemas";
import YAML from "yaml";

export type SkillRoot = {
  path: string;
  kind: "BUILT_IN" | "EXTERNAL";
};

export type SkillDocumentMeta = {
  name: string;
  description: string;
  license?: string;
  metadata?: Record<string, unknown>;
  path: string;
};

export type SkillMeta = SkillDocumentMeta & { root: SkillRoot };

export type SkillConflict = {
  name: string;
  paths: string[];
};

export type SkillRootDiagnostic = {
  path: string;
  code: "MISSING" | "UNREADABLE";
};

export type SkillDiscovery = {
  skills: SkillMeta[];
  conflicts: SkillConflict[];
  diagnostics: SkillRootDiagnostic[];
};

const FRONTMATTER_RE = /^---\s*[\r\n]+([\s\S]*?)[\r\n]+---/;
const SKILL_FILENAME = "SKILL.md";
const EVENT_SHAPES_FILENAMES = ["event-shapes.ts", "event-shapes.js"] as const;

export type SkillEventShape = EventShapeDefinition;

type SkillEventShapesModule = {
  eventShapes?: unknown;
  default?: unknown;
};

function parseMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value) return undefined;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

export function resolveSkillRoots(
  projectRoot: string,
  configuredRoots = process.env.ORGOPS_SKILL_ROOTS ?? "",
): SkillRoot[] {
  const builtIn = resolve(projectRoot, "skills");
  const seen = new Set([builtIn]);
  const roots: SkillRoot[] = [{ path: builtIn, kind: "BUILT_IN" }];
  for (const raw of configuredRoots.split(delimiter)) {
    const value = raw.trim();
    if (!value) continue;
    if (!isAbsolute(value)) {
      throw new Error("ORGOPS_SKILL_ROOTS entries must be absolute paths");
    }
    const path = resolve(value);
    if (seen.has(path)) continue;
    seen.add(path);
    roots.push({ path, kind: "EXTERNAL" });
  }
  return roots;
}

export function resolveSkillRoot(projectRoot = process.cwd()): SkillRoot {
  return resolveSkillRoots(projectRoot, "")[0];
}

export function loadSkillMeta(skillDir: string): SkillDocumentMeta | null {
  const skillPath = join(skillDir, SKILL_FILENAME);
  if (!existsSync(skillPath)) return null;
  let content: string;
  try {
    content = readFileSync(skillPath, "utf-8");
  } catch {
    return null;
  }
  const match = content.match(FRONTMATTER_RE);
  if (!match) return null;
  let meta: Record<string, unknown>;
  try {
    meta = YAML.parse(match[1]) as Record<string, unknown>;
  } catch {
    // Malformed frontmatter should not break skills loading globally.
    return null;
  }
  const name = meta?.name ? String(meta.name) : "";
  const description = meta?.description ? String(meta.description) : "";
  if (!name || !description) return null;
  if (basename(skillDir) !== name) return null;
  return {
    name,
    description,
    license: meta.license ? String(meta.license) : undefined,
    metadata: parseMetadata(meta.metadata),
    path: skillDir,
  };
}

export function discoverSkills(roots: SkillRoot[]): SkillDiscovery {
  const byName = new Map<string, SkillMeta[]>();
  const diagnostics: SkillRootDiagnostic[] = [];

  for (const root of roots) {
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(root.path, { withFileTypes: true, encoding: "utf8" });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code === "ENOENT"
        ? "MISSING"
        : "UNREADABLE";
      diagnostics.push({ path: root.path, code });
      continue;
    }

    for (const entry of entries
      .filter((candidate) => candidate.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const skill = loadSkillMeta(join(root.path, entry.name));
      if (!skill) continue;
      const discovered = { ...skill, root };
      const matches = byName.get(skill.name) ?? [];
      matches.push(discovered);
      byName.set(skill.name, matches);
    }
  }

  const skills: SkillMeta[] = [];
  const conflicts: SkillConflict[] = [];
  for (const [name, matches] of [...byName.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (matches.length > 1) {
      conflicts.push({
        name,
        paths: matches.map(({ path }) => path).sort(),
      });
      continue;
    }
    skills.push(matches[0]);
  }

  return {
    skills,
    conflicts,
    diagnostics: diagnostics.sort((left, right) =>
      left.path.localeCompare(right.path) || left.code.localeCompare(right.code),
    ),
  };
}

export function listSkills(root: SkillRoot): SkillMeta[] {
  return discoverSkills([root]).skills;
}

function parseEventShapesCandidate(
  skillName: string,
  candidate: unknown,
): SkillEventShape[] {
  if (!Array.isArray(candidate)) return [];
  const out: SkillEventShape[] = [];
  for (const entry of candidate) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type.trim() : "";
    const description =
      typeof record.description === "string" ? record.description.trim() : "";
    if (!type || !description) continue;
    out.push({
      ...record,
      type,
      description,
      source:
        typeof record.source === "string" && record.source.startsWith("skill:")
          ? (record.source as `skill:${string}`)
          : (`skill:${skillName}` as const),
    });
  }
  return out;
}

export async function loadSkillEventShapes(skills: SkillMeta[]): Promise<{
  shapes: SkillEventShape[];
  errors: Array<{ skill: string; error: string }>;
}> {
  const shapes: SkillEventShape[] = [];
  const errors: Array<{ skill: string; error: string }> = [];
  for (const skill of skills) {
    const filePath = EVENT_SHAPES_FILENAMES.map((filename) =>
      join(skill.path, filename),
    ).find((candidate) => existsSync(candidate));
    if (!filePath) continue;
    try {
      const module = (await import(pathToFileURL(filePath).href)) as SkillEventShapesModule;
      const byNamedExport = parseEventShapesCandidate(
        skill.name,
        module.eventShapes,
      );
      if (byNamedExport.length > 0) {
        shapes.push(...byNamedExport);
        continue;
      }
      const byDefaultExport = parseEventShapesCandidate(skill.name, module.default);
      if (byDefaultExport.length > 0) {
        shapes.push(...byDefaultExport);
        continue;
      }
      errors.push({
        skill: skill.name,
        error:
          "event-shapes module found but no valid shape exports (expected eventShapes/default array).",
      });
    } catch (error) {
      errors.push({ skill: skill.name, error: String(error) });
    }
  }
  return { shapes, errors };
}
