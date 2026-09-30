import { access, mkdir, readFile, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { parseRepositoryConfig, normalizeRemoteUrl, RepositoryError, isSafeBranchName, type RepositoryConfig, type RepositoryErrorCode } from "./repository-config";
import { createGitRunner, type GitResult, type GitRunner } from "./git-process";
import { parsePorcelainPaths, validateChangedSkills } from "./skill-changes";

export type RepositoryCommandResult =
  | { ok: true; operation: string; data?: Record<string, unknown> }
  | { ok: false; operation: string; code: RepositoryErrorCode; message: string };

type CommandOptions = {
  env?: NodeJS.ProcessEnv;
  config?: RepositoryConfig;
  git?: GitRunner;
  lockMkdir?: (path: string) => Promise<void>;
  lockRm?: (path: string) => Promise<void>;
  lockRename?: (from: string, to: string) => Promise<void>;
  lockWrite?: (path: string, data: string, options: { mode: number }) => Promise<void>;
};

const safeMessages: Record<RepositoryErrorCode, string> = {
  CONFIG_INVALID: "Repository configuration is invalid.",
  ROOT_MISMATCH: "Configured repository skills root does not match.",
  BUSY: "Repository operation is already running.",
  REPOSITORY_MISMATCH: "Checkout does not match the configured repository.",
  DIRTY_WORKTREE: "Worktree must be clean.",
  DIVERGED: "Local and remote history diverged.",
  CONFLICTED: "Worktree has conflicted paths.",
  INVALID_SKILL: "Affected skill metadata is invalid.",
  PATH_OUTSIDE_SKILLS: "Changed path is outside skills/.",
  AUTH_FAILED: "Git authentication failed.",
  GIT_FAILED: "Git operation failed.",
  NO_CHANGES: "No skill changes found.",
  DIRECT_REQUIRED: "Direct publication requires --direct.",
  LOCK_OWNERSHIP: "Repository lock ownership changed.",
};

function fail(operation: string, code: RepositoryErrorCode): RepositoryCommandResult {
  return { ok: false, operation, code, message: safeMessages[code] };
}

function gitError(result: GitResult): RepositoryError {
  return new RepositoryError(result.code === "AUTH_FAILED" ? "AUTH_FAILED" : "GIT_FAILED");
}

async function run(git: GitRunner, args: string[], cwd?: string): Promise<GitResult> {
  return git.run(args, { cwd });
}

function requireGit(result: GitResult): string {
  if (!result.ok) throw gitError(result);
  return result.stdout.trim();
}

async function pathExists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function ensureCheckout(config: RepositoryConfig, git: GitRunner): Promise<void> {
  const top = await run(git, ["rev-parse", "--show-toplevel"], config.repositoryPath);
  if (!top.ok || resolve(top.stdout.trim()) !== resolve(config.repositoryPath)) throw new RepositoryError("REPOSITORY_MISMATCH");
  const remote = await run(git, ["config", "--get", "remote.origin.url"], config.repositoryPath);
  if (!remote.ok || normalizeRemoteUrl(remote.stdout) !== normalizeRemoteUrl(config.repositoryUrl)) throw new RepositoryError("REPOSITORY_MISMATCH");
}

async function worktree(config: RepositoryConfig, git: GitRunner) {
  await ensureCheckout(config, git);
  const status = await run(git, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], config.repositoryPath);
  if (!status.ok) throw gitError(status);
  const entries = parsePorcelainPaths(status.stdout);
  const conflicted = entries.some((entry) => /U/.test(entry.status) || ["DD", "AA"].includes(entry.status));
  const branch = requireGit(await run(git, ["branch", "--show-current"], config.repositoryPath));
  let ahead = 0;
  let behind = 0;
  let upstreamName: string | undefined;
  const upstream = await run(git, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], config.repositoryPath);
  if (upstream.ok) {
    upstreamName = upstream.stdout.trim();
    const counts = await run(git, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], config.repositoryPath);
    if (counts.ok) {
      const values = counts.stdout.trim().split(/\s+/).map(Number);
      ahead = Number.isFinite(values[0]) ? values[0] : 0;
      behind = Number.isFinite(values[1]) ? values[1] : 0;
    }
  }
  return { entries, branch, clean: entries.length === 0, conflicted, ahead, behind, remote: "origin", upstream: upstreamName };
}

async function acquireLock(config: RepositoryConfig, options: CommandOptions): Promise<() => Promise<void>> {
  const lock = `${config.repositoryPath}.orgops-private-skills.lock`;
  const marker = `${lock}/owner`;
  const token = randomUUID();
  const mkdirImpl = options.lockMkdir ?? ((path: string) => mkdir(path));
  const removeImpl = options.lockRm ?? ((path: string) => rmdir(path));
  const renameImpl = options.lockRename ?? ((from: string, to: string) => rename(from, to));
  const writeImpl = options.lockWrite ?? ((path: string, data: string, writeOptions: { mode: number }) => writeFile(path, data, writeOptions));
  let created = false;
  try {
    await mkdirImpl(lock);
    created = true;
    await writeImpl(marker, token, { mode: 0o600 });
  } catch (error) {
    // Once mkdir succeeds, ownership is not established until the marker write succeeds.
    // Never remove that canonical directory: it may have been replaced concurrently.
    if (created) throw new RepositoryError("LOCK_OWNERSHIP");
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new RepositoryError("BUSY");
    throw new RepositoryError("GIT_FAILED");
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    const quarantine = `${lock}.releasing-${token}`;
    try {
      // Rename is the ownership handoff: a replacement canonical lock cannot be removed by us.
      await renameImpl(lock, quarantine);
    } catch { throw new RepositoryError("LOCK_OWNERSHIP"); }
    try {
      const quarantineMarker = `${quarantine}/owner`;
      const owner = await readFile(quarantineMarker, "utf8");
      if (owner !== token) throw new RepositoryError("LOCK_OWNERSHIP");
      await unlink(quarantineMarker);
      await removeImpl(quarantine);
    } catch (error) {
      if (error instanceof RepositoryError) throw error;
      throw new RepositoryError("LOCK_OWNERSHIP");
    }
  };
}

async function requireClean(config: RepositoryConfig, git: GitRunner) {
  const state = await worktree(config, git);
  if (state.conflicted) throw new RepositoryError("CONFLICTED");
  if (!state.clean) throw new RepositoryError("DIRTY_WORKTREE");
  return state;
}

async function syncExisting(config: RepositoryConfig, git: GitRunner): Promise<void> {
  await ensureCheckout(config, git);
  const before = await requireClean(config, git);
  if (before.branch !== config.defaultBranch) {
    const switched = await run(git, ["switch", config.defaultBranch], config.repositoryPath);
    if (!switched.ok) throw new RepositoryError("DIRTY_WORKTREE");
  }
  const fetched = await run(git, ["fetch", "--prune", "origin", config.defaultBranch], config.repositoryPath);
  if (!fetched.ok) throw gitError(fetched);
  const merged = await run(git, ["merge", "--ff-only", `origin/${config.defaultBranch}`], config.repositoryPath);
  if (!merged.ok) throw new RepositoryError("DIVERGED");
}

async function cloneRepository(config: RepositoryConfig, git: GitRunner): Promise<void> {
  if (!await pathExists(dirname(config.repositoryPath))) throw new RepositoryError("GIT_FAILED");
  const result = await run(git, ["clone", "--branch", config.defaultBranch, "--single-branch", config.repositoryUrl, config.repositoryPath]);
  if (!result.ok) throw gitError(result);
}

async function synchronize(config: RepositoryConfig, git: GitRunner): Promise<void> {
  if (await pathExists(config.repositoryPath)) await syncExisting(config, git);
  else await cloneRepository(config, git);
}

async function inspectPublishRemote(config: RepositoryConfig, git: GitRunner, branch: string): Promise<void> {
  const fetched = await run(git, ["fetch", "--prune", "origin", branch], config.repositoryPath);
  if (!fetched.ok && !/couldn't find remote ref|no such ref/i.test(fetched.stderr)) throw gitError(fetched);
  const remoteRef = await run(git, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch}`], config.repositoryPath);
  if (!remoteRef.ok) return;
  const counts = await run(git, ["rev-list", "--left-right", "--count", `HEAD...origin/${branch}`], config.repositoryPath);
  if (!counts.ok) throw gitError(counts);
  const values = counts.stdout.trim().split(/\s+/).map(Number);
  const behind = Number.isFinite(values[1]) ? values[1] : 0;
  if (behind > 0) throw new RepositoryError("DIVERGED");
}

async function changed(config: RepositoryConfig, git: GitRunner) {
  const state = await worktree(config, git);
  if (state.conflicted) throw new RepositoryError("CONFLICTED");
  const validation = validateChangedSkills(config, state.entries);
  if (validation.ok === false) throw new RepositoryError(validation.code);
  return { state, validation };
}

function parseArgs(input: string[] | string): { command: string; args: string[] } {
  const tokens = Array.isArray(input) ? input : input.trim().split(/\s+/).filter(Boolean);
  return { command: tokens[0] ?? "", args: tokens.slice(1) };
}

export async function runRepositoryCommand(input: string[] | string, options: CommandOptions = {}): Promise<RepositoryCommandResult> {
  const parsed = parseArgs(input);
  const operation = parsed.command || "unknown";
  try {
    const config = options.config ?? parseRepositoryConfig(options.env ?? process.env);
    const git = options.git ?? createGitRunner({ env: options.env });
    if (operation === "status") {
      const state = await worktree(config, git);
      return { ok: true, operation, data: { branch: state.branch, remote: state.remote, upstream: state.upstream ?? null, clean: state.clean, conflicted: state.conflicted, ahead: state.ahead, behind: state.behind } };
    }
    if (!["sync", "begin", "validate", "publish"].includes(operation)) return fail(operation, "CONFIG_INVALID");
    if (operation === "sync") {
      const release = await acquireLock(config, options);
      try { await synchronize(config, git); } finally { await release(); }
      return { ok: true, operation };
    }
    if (operation === "begin") {
      const branchIndex = parsed.args.indexOf("--branch");
      const branch = branchIndex >= 0 ? parsed.args[branchIndex + 1] : "";
      if (!branch || !isSafeBranchName(branch) || branch === config.defaultBranch) return fail(operation, "CONFIG_INVALID");
      const release = await acquireLock(config, options);
      try {
        await synchronize(config, git);
        const exists = await run(git, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], config.repositoryPath);
        const switched = exists.ok
          ? await run(git, ["switch", branch], config.repositoryPath)
          : await run(git, ["switch", "-c", branch], config.repositoryPath);
        if (!switched.ok) throw gitError(switched);
      } finally { await release(); }
      return { ok: true, operation, data: { branch } };
    }
    if (operation === "validate") {
      const result = await changed(config, git);
      return { ok: true, operation, data: { skillNames: result.validation.skillNames, paths: result.validation.paths } };
    }
    const messageIndex = parsed.args.indexOf("--message");
    const message = messageIndex >= 0 ? parsed.args[messageIndex + 1] : "";
    const direct = parsed.args.includes("--direct");
    if (!message || message.length > 2000 || /[\x00-\x1f\x7f]/.test(message)) return fail(operation, "CONFIG_INVALID");
    const release = await acquireLock(config, options);
    try {
      const result = await changed(config, git);
      const branch = result.state.branch;
      if (branch === config.defaultBranch && !direct) throw new RepositoryError("DIRECT_REQUIRED");
      if (direct && branch !== config.defaultBranch) throw new RepositoryError("DIRECT_REQUIRED");
      await inspectPublishRemote(config, git, branch);
      const added = await run(git, ["add", "--", ...result.validation.paths], config.repositoryPath);
      if (!added.ok) throw gitError(added);
      const committed = await run(git, ["commit", "-m", message], config.repositoryPath);
      if (!committed.ok) throw gitError(committed);
      const pushed = await run(git, ["push", "origin", branch], config.repositoryPath);
      if (!pushed.ok) throw gitError(pushed);
      return { ok: true, operation, data: { branch, skillNames: result.validation.skillNames } };
    } finally { await release(); }
  } catch (error) {
    const code = error instanceof RepositoryError ? error.code : "GIT_FAILED";
    return fail(operation, code);
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const result = await runRepositoryCommand(argv);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1]?.endsWith("manage-repository.ts") || process.argv[1]?.endsWith("manage-repository.mjs")) void main();
