import { resolve } from "node:path";
import { createUiShortcut, type ShortcutTarget } from "./browser";
import { ADMIN_UI_URL } from "./admin-ui";
import type { InstallComponent } from "./components";
import { USER_UI_URL } from "./install";
import { loadState, saveState } from "./runtime-state";
import { registerAutostartServices, unregisterAutostartServices } from "./service";

function resolveInstallDir(inputDir?: string) {
  return resolve(inputDir ?? loadState().installDir ?? "orgops");
}

export function registerServiceAction(options: { installDir?: string; components: InstallComponent[] }) {
  const installDir = resolveInstallDir(options?.installDir);
  const messages = registerAutostartServices(installDir, options.components);
  const prior = loadState();
  saveState({
    ...prior,
    installDir,
    serviceRegistered: options.components.length > 0,
    serviceComponents: options.components,
  });
  return {
    installDir,
    serviceRegistered: options.components.length > 0,
    serviceComponents: options.components,
    messages,
  };
}

export function createShortcutAction(options?: { url?: string; target?: ShortcutTarget }) {
  const target = options?.target ?? "user-ui";
  const fallbackUrl = target === "admin-ui" ? ADMIN_UI_URL : USER_UI_URL;
  const url = options?.url?.trim() || fallbackUrl;
  const shortcutPath = createUiShortcut(target, url);
  return { target, url, shortcutPath };
}

export function unregisterServiceAction(options: { installDir?: string; components: InstallComponent[] }) {
  const installDir = resolveInstallDir(options?.installDir);
  const messages = unregisterAutostartServices(installDir, options.components);
  const prior = loadState();
  const remaining = (prior.serviceComponents ?? []).filter(
    (component) => !options.components.includes(component)
  );
  saveState({
    ...prior,
    installDir,
    serviceRegistered: remaining.length > 0,
    serviceComponents: remaining,
  });
  return {
    installDir,
    serviceRegistered: remaining.length > 0,
    serviceComponents: remaining,
    messages,
  };
}
