import { cpSync, createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { get } from "node:https";
import { dirname, resolve } from "node:path";
import * as tar from "tar";
import { isTruthyEnv } from "./env-flag";
import { capture, commandAvailable, runChecked } from "./exec";

const INSTALL_SMOKE_MOCK = "ORGOPS_OPSCLI_INSTALL_SMOKE_MOCK";

function repoAlreadyPresent(installDir: string) {
  return existsSync(resolve(installDir, ".git")) && existsSync(resolve(installDir, "package.json"));
}

function hasDirtyGitTree(installDir: string) {
  const result = capture("git", ["status", "--porcelain"], { cwd: installDir });
  return result.status === 0 && Boolean(String(result.stdout ?? "").trim());
}

export function checkpointDirtyGitTree(installDir: string) {
  if (!hasDirtyGitTree(installDir)) return false;
  runChecked("git", ["add", "-A"], installDir);
  runChecked(
    "git",
    [
      "-c",
      "user.name=OrgOps OpsCLI",
      "-c",
      "user.email=opscli@orgops.local",
      "commit",
      "-m",
      "chore: opscli autosave before update",
    ],
    installDir
  );
  return true;
}

function normalizeGithubArchiveUrl(repoUrl: string, ref: string) {
  const githubMatch = repoUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (!githubMatch) return null;
  return `https://codeload.github.com/${githubMatch[1]}/${githubMatch[2]}/tar.gz/${encodeURIComponent(ref)}`;
}

function downloadFile(url: string, outputPath: string) {
  return new Promise<void>((resolveDone, reject) => {
    const request = get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        downloadFile(response.headers.location, outputPath).then(resolveDone, reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`download failed for ${url}: HTTP ${response.statusCode}`));
        response.resume();
        return;
      }
      const file = createWriteStream(outputPath);
      response.pipe(file);
      file.on("finish", () => file.close(() => resolveDone()));
      file.on("error", reject);
    });
    request.on("error", reject);
  });
}

function preserveMutablePayload(installDir: string) {
  const preservedRoot = resolve(installDir, ".opscli-preserve");
  rmSync(preservedRoot, { recursive: true, force: true });
  mkdirSync(preservedRoot, { recursive: true });
  const names = [".env", ".orgops-data", "files", ".opscli-toolchain.json", ".opscli-backups"];
  const preserved: string[] = [];
  for (const name of names) {
    const source = resolve(installDir, name);
    if (!existsSync(source)) continue;
    const target = resolve(preservedRoot, name);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target, { recursive: true });
    preserved.push(name);
  }
  return { preservedRoot, preserved };
}

function restoreMutablePayload(installDir: string, preservedRoot: string, names: string[]) {
  for (const name of names) {
    const source = resolve(preservedRoot, name);
    if (!existsSync(source)) continue;
    cpSync(source, resolve(installDir, name), { recursive: true });
  }
  rmSync(preservedRoot, { recursive: true, force: true });
}

async function downloadSourceArchive(installDir: string, repoUrl: string, repoRef: string) {
  const archiveUrl = normalizeGithubArchiveUrl(repoUrl, repoRef);
  if (!archiveUrl) {
    throw new Error("--no-git archive install currently supports GitHub https repo URLs.");
  }
  const tmpRoot = resolve(installDir, "..", ".opscli-source-downloads");
  mkdirSync(tmpRoot, { recursive: true });
  const archivePath = resolve(tmpRoot, `orgops-${repoRef.replace(/[^a-z0-9._-]+/gi, "-")}.tar.gz`);
  await downloadFile(archiveUrl, archivePath);

  const existingInstall = existsSync(installDir);
  const preserved = existingInstall ? preserveMutablePayload(installDir) : null;
  rmSync(installDir, { recursive: true, force: true });
  mkdirSync(installDir, { recursive: true });
  await tar.x({ file: archivePath, cwd: installDir, strip: 1 });
  if (preserved) restoreMutablePayload(installDir, preserved.preservedRoot, preserved.preserved);
  writeFileSync(resolve(installDir, ".opscli-source.json"), `${JSON.stringify({ repoUrl, repoRef, mode: "archive" }, null, 2)}\n`, "utf-8");
}

export type SourceMode = "git" | "archive";

export async function ensureSourceReady(options: {
  installDir: string;
  repoUrl: string;
  repoRef: string;
  noGit?: boolean;
}): Promise<SourceMode> {
  const { installDir, repoUrl, repoRef } = options;
  if (isTruthyEnv(process.env[INSTALL_SMOKE_MOCK])) {
    mkdirSync(installDir, { recursive: true });
    if (!options.noGit) mkdirSync(resolve(installDir, ".git"), { recursive: true });
    writeFileSync(resolve(installDir, "package.json"), `${JSON.stringify({ name: "orgops-install-smoke", private: true }, null, 2)}\n`, "utf-8");
    writeFileSync(resolve(installDir, ".opscli-install-smoke.json"), `${JSON.stringify({ repoUrl, repoRef, mocked: true, noGit: Boolean(options.noGit) }, null, 2)}\n`, "utf-8");
    return options.noGit ? "archive" : "git";
  }

  if (options.noGit) {
    await downloadSourceArchive(installDir, repoUrl, repoRef);
    return "archive";
  }

  if (!commandAvailable("git")) {
    throw new Error("git is required for the default install mode. Re-run with --no-git to install from a source archive instead.");
  }

  if (repoAlreadyPresent(installDir)) {
    runChecked("git", ["fetch", "--all", "--tags"], installDir);
    checkpointDirtyGitTree(installDir);
    runChecked("git", ["checkout", repoRef], installDir);
    try {
      runChecked("git", ["pull", "--rebase", "--autostash", "origin", repoRef], installDir);
    } catch (error) {
      throw new Error(`Unable to update ${installDir}. Resolve local git changes and retry. ${String(error)}`);
    }
    return "git";
  }

  mkdirSync(resolve(installDir, ".."), { recursive: true });
  runChecked("git", ["clone", "--depth", "1", "--branch", repoRef, repoUrl, installDir]);
  return "git";
}
