import { resolve } from "node:path";
import { createUiShortcut, type ShortcutTarget } from "./browser";
import { ADMIN_UI_URL } from "./admin-ui";
import { USER_UI_URL } from "./install";
import { loadState, saveState } from "./runtime-state";
import { registerAutostartService, unregisterAutostartService } from "./service";

function resolveInstallDir(inputDir?: string) {
  return resolve(inputDir ?? loadState().installDir ?? "orgops");
}

export function registerServiceAction(options?: { installDir?: string }) {
  const installDir = resolveInstallDir(options?.installDir);
  const message = registerAutostartService(installDir);
  const prior = loadState();
  saveState({
    ...prior,
    installDir,
    serviceRegistered: true,
  });
  return { installDir, serviceRegistered: true, message };
}

export function createShortcutAction(options?: { url?: string; target?: ShortcutTarget }) {
  const target = options?.target ?? "user-ui";
  const fallbackUrl = target === "admin-ui" ? ADMIN_UI_URL : USER_UI_URL;
  const url = options?.url?.trim() || fallbackUrl;
  const shortcutPath = createUiShortcut(target, url);
  return { target, url, shortcutPath };
}

export function unregisterServiceAction(options?: { installDir?: string }) {
  const installDir = resolveInstallDir(options?.installDir);
  const message = unregisterAutostartService(installDir);
  const prior = loadState();
  saveState({
    ...prior,
    installDir,
    serviceRegistered: false,
  });
  return { installDir, serviceRegistered: false, message };
}
