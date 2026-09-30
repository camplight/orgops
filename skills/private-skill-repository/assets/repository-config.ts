import { delimiter, isAbsolute, resolve } from "node:path";

export type RepositoryConfig = {
  repositoryUrl: string;
  repositoryPath: string;
  skillsPath: string;
  defaultBranch: string;
};

export type RepositoryErrorCode =
  | "CONFIG_INVALID"
  | "ROOT_MISMATCH"
  | "BUSY"
  | "REPOSITORY_MISMATCH"
  | "DIRTY_WORKTREE"
  | "DIVERGED"
  | "CONFLICTED"
  | "INVALID_SKILL"
  | "PATH_OUTSIDE_SKILLS"
  | "AUTH_FAILED"
  | "GIT_FAILED"
  | "NO_CHANGES"
  | "DIRECT_REQUIRED"
  | "LOCK_OWNERSHIP";

export class RepositoryError extends Error {
  readonly code: RepositoryErrorCode;
  constructor(code: RepositoryErrorCode, message = code) {
    super(message);
    this.name = "RepositoryError";
    this.code = code;
  }
}

type Environment = Record<string, string | undefined>;

function required(env: Environment, name: string): string {
  const value = env[name];
  if (!value || !value.trim()) throw new RepositoryError("CONFIG_INVALID");
  return value.trim();
}

function validBranch(branch: string): boolean {
  return branch.length > 0 &&
    !branch.startsWith("-") &&
    !branch.endsWith("/") &&
    !branch.endsWith(".") &&
    !branch.split("/").some((part) => part.endsWith(".lock")) &&
    !/[\s\\\x00-\x1f\x7f]/.test(branch) &&
    !branch.includes("..") &&
    !branch.includes("@{") &&
    branch !== "@" &&
    !/[~^:?*\[\]]/.test(branch) &&
    !branch.split("/").some((part) => part.length === 0 || part.startsWith(".") || part.endsWith("."));
}

function validUrl(raw: string): boolean {
  if (/^[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+:[^\s]+$/.test(raw)) return true;
  if (isAbsolute(raw)) return !/[\x00-\x20\x7f]/.test(raw);
  try {
    const parsed = new URL(raw);
    return (parsed.protocol === "https:" || parsed.protocol === "http:" || parsed.protocol === "ssh:" || parsed.protocol === "file:") &&
      !parsed.username && !parsed.password && !/[\x00-\x20\x7f]/.test(raw);
  } catch {
    return false;
  }
}

export function parseRepositoryConfig(env: Environment): RepositoryConfig {
  const repositoryUrl = required(env, "PRIVATE_SKILLS_REPO_URL");
  const configuredPath = required(env, "PRIVATE_SKILLS_REPO_PATH");
  const defaultBranch = required(env, "PRIVATE_SKILLS_REPO_BRANCH");
  const roots = required(env, "ORGOPS_SKILL_ROOTS");
  if (!validUrl(repositoryUrl) || !isAbsolute(configuredPath) || !validBranch(defaultBranch)) {
    throw new RepositoryError("CONFIG_INVALID");
  }
  const repositoryPath = resolve(configuredPath);
  const skillsPath = resolve(repositoryPath, "skills");
  const configuredRoots = roots.split(delimiter).map((entry) => entry.trim()).filter(Boolean);
  if (!configuredRoots.some((entry) => isAbsolute(entry) && resolve(entry) === skillsPath)) {
    throw new RepositoryError("ROOT_MISMATCH");
  }
  return { repositoryUrl, repositoryPath, skillsPath, defaultBranch };
}

export function isSafeBranchName(branch: string): boolean {
  return validBranch(branch);
}

export function normalizeRemoteUrl(raw: string): string {
  const value = raw.trim();
  try {
    const parsed = new URL(value);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return value.replace(/\/$/, "");
  }
}
