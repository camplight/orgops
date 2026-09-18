import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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
const INSTALL_SMOKE_MOCK_ENV = "ORGOPS_OPSCLI_INSTALL_SMOKE_MOCK";

function isTruthyEnv(value: string | undefined) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function isInstallSmokeMockEnabled() {
  return isTruthyEnv(process.env[INSTALL_SMOKE_MOCK_ENV]);
}

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

function ensureRepoReadyMock(installDir: string, repoUrl: string, repoRef: string) {
  mkdirSync(installDir, { recursive: true });
  mkdirSync(resolve(installDir, ".git"), { recursive: true });
  writeFileSync(
    resolve(installDir, "package.json"),
    `${JSON.stringify({ name: "orgops-install-smoke", private: true }, null, 2)}\n`,
    "utf-8"
  );
  writeFileSync(
    resolve(installDir, ".opscli-install-smoke.json"),
    `${JSON.stringify({ repoUrl, repoRef, mocked: true }, null, 2)}\n`,
    "utf-8"
  );
}

function markMockInstallBuild(installDir: string) {
  writeFileSync(resolve(installDir, ".opscli-install-smoke-build.txt"), "mocked npm ci + npm run build\n", "utf-8");
}

function createMockShortcut(installDir: string) {
  const shortcutPath = resolve(installDir, "OrgOps User UI.smoke-shortcut");
  writeFileSync(shortcutPath, `${USER_UI_URL}\n`, "utf-8");
  return shortcutPath;
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
  const smokeMockEnabled = isInstallSmokeMockEnabled();
  if (smokeMockEnabled) ensureRepoReadyMock(installDir, repoUrl, repoRef);
  else ensureRepoReady(installDir, repoUrl, repoRef);

  if (smokeMockEnabled) {
    markMockInstallBuild(installDir);
  } else {
    const npmCmd = npmCommandForHost();
    runChecked(npmCmd, ["ci"], installDir);
    runChecked(npmCmd, ["run", "build"], installDir);
  }

  let serviceMessage = "";
  if (rawOptions.registerService) {
    serviceMessage = smokeMockEnabled
      ? "Service registration skipped (install smoke mock mode)."
      : registerAutostartService(installDir);
  }

  let shortcutPath = "";
  if (rawOptions.createShortcut) {
    shortcutPath = smokeMockEnabled ? createMockShortcut(installDir) : createUserUiShortcut(USER_UI_URL);
  }

  const prior = loadState();
  const serviceRegistered = rawOptions.registerService
    ? true
    : Boolean(prior.serviceRegistered);
  saveState({
    ...prior,
    installDir,
    repoRef,
    repoUrl,
    serviceRegistered,
  });

  if (rawOptions.registerService && !smokeMockEnabled) {
    openUrlInBrowser(USER_UI_URL);
  }

  return {
    installDir,
    repoUrl,
    repoRef,
    serviceRegistered,
    serviceMessage,
    shortcutPath,
    userUiUrl: USER_UI_URL,
  };
}
