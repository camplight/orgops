import { resolve } from "node:path";
import { formatComponents, parseComponentsArg, type InstallComponent } from "./components";
import { runInstall, type InstallOptions } from "./install";
import { loadState } from "./runtime-state";
import { runUninstall } from "./uninstall";

function resolveInstallDir(inputDir?: string) {
  return resolve(inputDir ?? loadState().installDir ?? "orgops");
}

function mergeComponents(existing: InstallComponent[], added: InstallComponent[]) {
  return [...new Set([...existing, ...added])];
}

export async function addComponents(options: InstallOptions & { components: string }) {
  const installDir = resolveInstallDir(options.installDir);
  const state = loadState();
  const existing = Array.isArray(state.installedComponents) ? state.installedComponents : [];
  const added = parseComponentsArg(options.components);
  const components = mergeComponents(existing, added);
  const result = await runInstall({
    ...options,
    installDir,
    components: formatComponents(components),
    registerService: Boolean(options.registerService ?? state.serviceRegistered),
  });
  return { ...result, added };
}

export function removeComponents(options: { installDir?: string; components: string; purgeData?: boolean }) {
  return runUninstall({
    installDir: options.installDir,
    components: options.components,
    purgeData: options.purgeData,
  });
}
