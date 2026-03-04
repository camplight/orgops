import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import YAML from "yaml";

export type SkillMeta = {
  name: string;
  description: string;
  license?: string;
  metadata?: Record<string, unknown>;
  path: string;
  location: string;
};

export type SkillRoot = {
  path: string;
  location: string;
};

const FRONTMATTER_RE = /^---\s*[\r\n]+([\s\S]*?)[\r\n]+---/;
const SKILL_FILENAME = "SKILL.md";

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

export function resolveSkillRoots(options?: {
  projectRoot?: string;
  env?: Record<string, string | undefined>;
}): SkillRoot[] {
  const projectRoot = options?.projectRoot ?? process.cwd();
  const envDirs = (options?.env?.ORGOPS_SKILLS_DIRS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (envDirs.length > 0) {
    return envDirs.map((entry) => ({
      path: isAbsolute(entry) ? entry : resolve(projectRoot, entry),
      location: "env"
    }));
  }

  return [
    { path: join(projectRoot, "skills"), location: "workspace" },
    { path: join(projectRoot, ".opencode", "skills"), location: "opencode-project" },
    { path: join(projectRoot, ".claude", "skills"), location: "claude-project" },
    { path: join(projectRoot, ".agents", "skills"), location: "agents-project" },
    { path: join(homedir(), ".openclaw", "skills"), location: "openclaw-global" },
    { path: join(homedir(), ".config", "opencode", "skills"), location: "opencode-global" },
    { path: join(homedir(), ".claude", "skills"), location: "claude-global" },
    { path: join(homedir(), ".agents", "skills"), location: "agents-global" }
  ];
}

export function loadSkillMeta(skillDir: string, location: string): SkillMeta | null {
  const skillPath = join(skillDir, SKILL_FILENAME);
  if (!existsSync(skillPath)) return null;
  const content = readFileSync(skillPath, "utf-8");
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
    location
  };
}

export function listSkills(roots: SkillRoot[]): SkillMeta[] {
  const seen = new Set<string>();
  const skills: SkillMeta[] = [];
  for (const root of roots) {
    if (!existsSync(root.path)) continue;
    const entries = readdirSync(root.path, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skill = loadSkillMeta(join(root.path, entry.name), root.location);
      if (!skill || seen.has(skill.name)) continue;
      seen.add(skill.name);
      skills.push(skill);
    }
  }
  return skills;
}
