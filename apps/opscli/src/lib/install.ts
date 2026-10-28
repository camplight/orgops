import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isTruthyEnv } from "./env-flag";
import { runChecked } from "./exec";
import { ensureGit } from "./git";
import { checkHostTools } from "./prereqs";
import {
  createUserUiShortcut,
  createWindowsStackLauncherShortcut,
  openUrlInBrowser,
} from "./browser";
import { registerAutostartServices } from "./service";
import { loadState, saveState } from "./runtime-state";
import {
  formatComponents,
  includesComponent,
  parseComponentsArg,
  type InstallComponent,
} from "./components";
import {
  resolveRunnerBootstrap,
  writeRunnerEnvConfig,
  type RunnerBootstrapOptions,
} from "./runner-bootstrap";
import { ensureGeneratedInstallEnv } from "./env";
import { ensureManagedToolchain, envWithToolchain, npmCommandForInstall } from "./toolchain";
import { ensureSourceReady } from "./source";

export const USER_UI_URL = "http://localhost:4190";

export type InstallOptions = {
  installDir?: string;
  repoUrl?: string;
  repoRef?: string;
  components?: string;
  registerService?: boolean;
  createShortcut?: boolean;
  noGit?: boolean;
  yes?: boolean;
  openBrowser?: boolean;
} & RunnerBootstrapOptions;

const DEFAULT_REPO_URL = "https://github.com/camplight/orgops.git";
const DEFAULT_REPO_REF = "main";

function markMockInstallBuild(installDir: string) {
  writeFileSync(resolve(installDir, ".opscli-install-smoke-build.txt"), "mocked npm ci + npm run build\n", "utf-8");
}

function createMockShortcut(installDir: string) {
  const shortcutPath = resolve(installDir, "OrgOps User UI.smoke-shortcut");
  writeFileSync(shortcutPath, `${USER_UI_URL}\n`, "utf-8");
  return shortcutPath;
}

function buildSelectedComponents(installDir: string, components: InstallComponent[]) {
  const npmCmd = npmCommandForInstall(installDir);
  const env = envWithToolchain(installDir);
  if (includesComponent(components, "admin-ui")) {
    runChecked(npmCmd, ["run", "admin-ui:build"], { cwd: installDir, env });
  }
  if (includesComponent(components, "user-ui")) {
    runChecked(npmCmd, ["run", "user-ui:build"], { cwd: installDir, env });
  }
}

export async function runInstall(rawOptions: InstallOptions) {
  const installDir = resolve(rawOptions.installDir ?? "orgops");
  const repoUrl = rawOptions.repoUrl ?? DEFAULT_REPO_URL;
  const repoRef = rawOptions.repoRef ?? DEFAULT_REPO_REF;
  const components = parseComponentsArg(rawOptions.components);
  const smokeMockEnabled = isTruthyEnv(process.env.ORGOPS_OPSCLI_INSTALL_SMOKE_MOCK);
  const git = ensureGit({ required: !rawOptions.noGit });
  if (!git.ok) throw new Error(git.hint);
  const sourceMode = await ensureSourceReady({
    installDir,
    repoUrl,
    repoRef,
    noGit: Boolean(rawOptions.noGit),
  });

  if (smokeMockEnabled) {
    markMockInstallBuild(installDir);
  } else {
    const toolchain = await ensureManagedToolchain(installDir);
    const env = envWithToolchain(installDir);
    runChecked(toolchain.npmPath, ["ci"], { cwd: installDir, env });
    buildSelectedComponents(installDir, components);
  }

  const generatedEnv = ensureGeneratedInstallEnv(installDir);

  let runnerConfigApplied = false;
  if (includesComponent(components, "runner")) {
    const runnerConfig = await resolveRunnerBootstrap({ ...rawOptions, installDir });
    writeRunnerEnvConfig(installDir, runnerConfig);
    runnerConfigApplied = true;
  }

  let serviceMessage = "";
  if (rawOptions.registerService) {
    serviceMessage = smokeMockEnabled
      ? "Service registration skipped (install smoke mock mode)."
      : registerAutostartServices(installDir, components).join("; ");
  }

  let shortcutPath = "";
  if (rawOptions.createShortcut && includesComponent(components, "user-ui")) {
    if (smokeMockEnabled) {
      shortcutPath = createMockShortcut(installDir);
    } else if (process.platform === "win32") {
      shortcutPath = createWindowsStackLauncherShortcut({
        installDir,
        componentsCsv: components.join(","),
      });
    } else {
      shortcutPath = createUserUiShortcut(USER_UI_URL);
    }
  }

  const prior = loadState();
  const serviceRegistered = rawOptions.registerService
    ? true
    : Boolean(prior.serviceRegistered);
  const serviceComponents = rawOptions.registerService
    ? components
    : (Array.isArray(prior.serviceComponents) ? prior.serviceComponents : []);
  saveState({
    ...prior,
    installDir,
    repoRef,
    repoUrl,
    serviceRegistered,
    serviceComponents,
    installedComponents: components,
    sourceMode,
  });

  const shouldOpenBrowser =
    rawOptions.registerService &&
    !smokeMockEnabled &&
    rawOptions.yes !== true &&
    rawOptions.openBrowser !== false;
  if (shouldOpenBrowser) {
    openUrlInBrowser(USER_UI_URL);
  }

  return {
    installDir,
    repoUrl,
    repoRef,
    components,
    componentsSummary: formatComponents(components),
    sourceMode,
    hostTools: checkHostTools(),
    runnerConfigApplied,
    serviceRegistered,
    serviceMessage,
    shortcutPath,
    userUiUrl: USER_UI_URL,
    generatedEnv,
  };
}
