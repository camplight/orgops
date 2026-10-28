import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseComponentsArg, type InstallComponent } from "./components";
import { stopComponents } from "./component-runtime";
import { loadState, saveState } from "./runtime-state";
import { unregisterAutostartServices } from "./service";

export type UninstallOptions = {
  installDir?: string;
  components?: string;
  purgeData?: boolean;
};

function resolveInstallDir(inputDir?: string) {
  return resolve(inputDir ?? loadState().installDir ?? "orgops");
}

function componentsToRemove(raw: string | undefined): InstallComponent[] {
  if (raw?.trim()) return parseComponentsArg(raw);
  const installed = loadState().installedComponents;
  return Array.isArray(installed) && installed.length > 0 ? installed : parseComponentsArg(undefined);
}

function preserveData(installDir: string) {
  const keep = [".env", ".orgops-data", "files", ".opscli-backups"];
  const preserveRoot = resolve(installDir, "..", `.orgops-preserved-${Date.now()}`);
  const preserved: string[] = [];
  mkdirSync(preserveRoot, { recursive: true });
  for (const name of keep) {
    const source = resolve(installDir, name);
    if (!existsSync(source)) continue;
    const target = resolve(preserveRoot, name);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target, { recursive: true });
    preserved.push(name);
  }
  return { preserveRoot, preserved };
}

function restoreData(installDir: string, preserveRoot: string, preserved: string[]) {
  mkdirSync(installDir, { recursive: true });
  for (const name of preserved) {
    const source = resolve(preserveRoot, name);
    if (existsSync(source)) cpSync(source, resolve(installDir, name), { recursive: true });
  }
  rmSync(preserveRoot, { recursive: true, force: true });
}

export function runUninstall(options: UninstallOptions) {
  const installDir = resolveInstallDir(options.installDir);
  const components = componentsToRemove(options.components);
  const prior = loadState();
  stopComponents({ installDir, components });
  const serviceComponents = components.filter((component) => prior.serviceComponents?.includes(component));
  const serviceMessages = unregisterAutostartServices(installDir, serviceComponents);

  const partial = Boolean(options.components?.trim());
  const remainingInstalled = partial
    ? (prior.installedComponents ?? []).filter((component) => !components.includes(component))
    : [];
  const remainingServices = (prior.serviceComponents ?? []).filter((component) => !components.includes(component));

  let preservedData = false;
  if (!partial && existsSync(installDir)) {
    if (options.purgeData) {
      rmSync(installDir, { recursive: true, force: true });
    } else {
      const preserved = preserveData(installDir);
      rmSync(installDir, { recursive: true, force: true });
      restoreData(installDir, preserved.preserveRoot, preserved.preserved);
      preservedData = preserved.preserved.length > 0;
    }
  }

  saveState({
    ...prior,
    installDir,
    installedComponents: remainingInstalled,
    serviceComponents: remainingServices,
    serviceRegistered: remainingServices.length > 0,
  });

  return {
    installDir,
    components,
    serviceMessages,
    partial,
    purgedData: Boolean(options.purgeData) && !partial,
    preservedData,
  };
}
