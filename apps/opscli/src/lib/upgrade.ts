import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import * as tar from "tar";
import { getAdminUiStatus, startAndOpenAdminUi, stopAdminUi } from "./admin-ui";
import { runInstall } from "./install";
import { loadState } from "./runtime-state";
import { registerAutostartService, stopAutostartService } from "./service";
import { getUserStackStatus, startUserStack, stopUserStack } from "./user-stack";

export type UpgradeOptions = {
  installDir?: string;
  repoUrl?: string;
  repoRef?: string;
  restart?: boolean;
};

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

  const userStatusBefore = await getUserStackStatus({ installDir });
  const adminStatusBefore = await getAdminUiStatus(installDir);
  const serviceRegistered = Boolean(loadState().serviceRegistered);
  const backupPath = await createSafetyBackup(installDir);

  if (!serviceRegistered && userStatusBefore.running && !userStatusBefore.runtimePid) {
    throw new Error(
      "User stack appears to be running but is not managed by opscli PID state. Stop it manually, then rerun upgrade."
    );
  }
  if (adminStatusBefore.running && !adminStatusBefore.runtimePid) {
    throw new Error(
      "Admin UI appears to be running but is not managed by opscli PID state. Stop it manually, then rerun upgrade."
    );
  }

  if (serviceRegistered) {
    stopAutostartService(installDir);
  } else if (userStatusBefore.runtimePid) {
    stopUserStack({ installDir });
  }
  if (adminStatusBefore.runtimePid) {
    stopAdminUi(installDir);
  }

  const installResult = runInstall({
    installDir,
    repoUrl: rawOptions.repoUrl,
    repoRef: rawOptions.repoRef,
    registerService: false,
    createShortcut: false,
  });

  const shouldRestart = rawOptions.restart !== false;
  const restartNotes: string[] = [];
  if (shouldRestart) {
    if (serviceRegistered) {
      restartNotes.push(registerAutostartService(installDir));
    } else if (userStatusBefore.running) {
      await startUserStack({ installDir, openBrowser: false });
      restartNotes.push("Restarted user stack.");
    } else {
      restartNotes.push("No user stack restart needed (was not running).");
    }

    if (adminStatusBefore.running) {
      await startAndOpenAdminUi({ installDir, openBrowser: false });
      restartNotes.push("Restarted Admin UI.");
    }
  } else {
    restartNotes.push("Skipped restart (by option).");
  }

  return {
    installDir,
    repoUrl: installResult.repoUrl,
    repoRef: installResult.repoRef,
    backupPath,
    restarted: shouldRestart,
    restartMessage: restartNotes.join(" "),
    userWasRunning: userStatusBefore.running,
    adminWasRunning: adminStatusBefore.running,
  };
}
