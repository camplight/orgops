import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { npmCommandForHost, runChecked } from "./exec";
import { ensurePrerequisites } from "./prereqs";
import { createUserUiShortcut, openUrlInBrowser } from "./browser";
import { registerAutostartService } from "./service";
import { loadState, saveState } from "./runtime-state";

export const USER_UI_URL = "http://localhost:4190";

export type InstallOptions = {
  installDir?: string;
  repoUrl?: string;
  repoRef?: string;
  registerService?: boolean;
  createShortcut?: boolean;
};

const DEFAULT_REPO_URL = "https://github.com/camplight/orgops.git";
const DEFAULT_REPO_REF = "main";

function repoAlreadyPresent(installDir: string) {
  return existsSync(resolve(installDir, ".git")) && existsSync(resolve(installDir, "package.json"));
}

function ensureRepoReady(installDir: string, repoUrl: string, repoRef: string) {
  if (repoAlreadyPresent(installDir)) {
    runChecked("git", ["fetch", "--all", "--tags"], installDir);
    runChecked("git", ["checkout", repoRef], installDir);
    runChecked("git", ["pull", "--ff-only", "origin", repoRef], installDir);
    return;
  }
  mkdirSync(resolve(installDir, ".."), { recursive: true });
  runChecked("git", ["clone", "--depth", "1", "--branch", repoRef, repoUrl, installDir]);
}

export function runInstall(rawOptions: InstallOptions) {
  const prerequisites = ensurePrerequisites();
  if (!prerequisites.ok) {
    const detail = prerequisites.results
      .map((result) => `${result.name}: ${result.ok ? "ok" : "missing"}`)
      .join(", ");
    throw new Error(`Missing prerequisites. ${detail}. ${prerequisites.hint}`);
  }

  const installDir = resolve(rawOptions.installDir ?? "orgops");
  const repoUrl = rawOptions.repoUrl ?? DEFAULT_REPO_URL;
  const repoRef = rawOptions.repoRef ?? DEFAULT_REPO_REF;
  ensureRepoReady(installDir, repoUrl, repoRef);

  const npmCmd = npmCommandForHost();
  runChecked(npmCmd, ["ci"], installDir);
  runChecked(npmCmd, ["run", "build"], installDir);

  let serviceMessage = "";
  if (rawOptions.registerService) {
    serviceMessage = registerAutostartService(installDir);
  }

  let shortcutPath = "";
  if (rawOptions.createShortcut) {
    shortcutPath = createUserUiShortcut(USER_UI_URL);
  }

  const prior = loadState();
  saveState({
    ...prior,
    installDir,
    repoRef,
    repoUrl,
    serviceRegistered: Boolean(rawOptions.registerService),
  });

  if (rawOptions.registerService) {
    openUrlInBrowser(USER_UI_URL);
  }

  return {
    installDir,
    repoUrl,
    repoRef,
    serviceRegistered: Boolean(rawOptions.registerService),
    serviceMessage,
    shortcutPath,
    userUiUrl: USER_UI_URL,
  };
}
