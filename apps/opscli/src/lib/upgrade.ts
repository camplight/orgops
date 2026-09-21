import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import * as tar from "tar";
import { runInstall } from "./install";
import { loadState } from "./runtime-state";
import { parseComponentsArg, type InstallComponent } from "./components";
import { getComponentsStatus, startComponents, stopComponents } from "./component-runtime";
import type { RunnerBootstrapOptions } from "./runner-bootstrap";

export type UpgradeOptions = {
  installDir?: string;
  repoUrl?: string;
  repoRef?: string;
  components?: string;
  restart?: boolean;
} & RunnerBootstrapOptions;

function resolveInstallDir(inputDir?: string) {
  return resolve(inputDir ?? loadState().installDir ?? "orgops");
}

async function createSafetyBackup(installDir: string) {
  const backupCandidates = [".orgops-data", "files", ".env"];
  const existing = backupCandidates.filter((item) => existsSync(resolve(installDir, item)));
  if (existing.length === 0) return "";
  const backupsDir = resolve(installDir, ".opscli-backups");
  mkdirSync(backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = resolve(backupsDir, `upgrade-backup-${stamp}.tar.gz`);
  await tar.c(
    {
      gzip: true,
      cwd: installDir,
      file: backupPath,
    },
    existing
  );
  return backupPath;
}

export async function runUpgrade(rawOptions: UpgradeOptions) {
  const installDir = resolveInstallDir(rawOptions.installDir);
  if (!existsSync(resolve(installDir, ".git"))) {
    throw new Error(`No git repository found at ${installDir}. Run install first.`);
  }

  const state = loadState();
  const components = parseComponentsArg(
    rawOptions.components ??
      (Array.isArray(state.installedComponents) && state.installedComponents.length > 0
        ? state.installedComponents.join(",")
        : undefined)
  );
  const statusBefore = await getComponentsStatus({ installDir, components });
  const runningBefore = statusBefore.statuses
    .filter((status) => status.running)
    .map((status) => status.component);
  const backupPath = await createSafetyBackup(installDir);

  if (runningBefore.length > 0) {
    stopComponents({ installDir, components: runningBefore });
  }

  const installResult = await runInstall({
    installDir,
    repoUrl: rawOptions.repoUrl,
    repoRef: rawOptions.repoRef,
    components: components.join(","),
    runnerApiUrl: rawOptions.runnerApiUrl,
    runnerToken: rawOptions.runnerToken,
    runnerName: rawOptions.runnerName,
    runnerInviteUrl: rawOptions.runnerInviteUrl,
    registerService: Boolean(state.serviceRegistered),
    createShortcut: false,
  });

  const shouldRestart = rawOptions.restart !== false;
  const restartNotes: string[] = [];
  if (shouldRestart) {
    if (runningBefore.length > 0) {
      await startComponents({ installDir, components: runningBefore, openBrowser: false });
      restartNotes.push(`Restarted components: ${runningBefore.join(", ")}.`);
    } else {
      restartNotes.push("No component restart needed (none were running).");
    }
  } else {
    restartNotes.push("Skipped restart (by option).");
  }

  return {
    installDir,
    repoUrl: installResult.repoUrl,
    repoRef: installResult.repoRef,
    components,
    backupPath,
    restarted: shouldRestart,
    restartMessage: restartNotes.join(" "),
    runningBefore,
  };
}
