import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { openUrlInBrowser } from "./browser";
import type { InstallComponent } from "./components";
import { loadState } from "./runtime-state";
import { controlAutostartServices, getAutostartServicesStatus } from "./service";
import { envWithToolchain, npmCommandForInstall } from "./toolchain";

type ComponentStatus = {
  component: InstallComponent;
  running: boolean;
  pid: number | null;
  url?: string;
  reachable?: boolean;
  serviceRegistered?: boolean;
  serviceRunning?: boolean;
  serviceDetail?: string;
};

const COMPONENT_START_COMMAND: Record<InstallComponent, string> = {
  api: "start:api:env",
  runner: "start:runner:env",
  "admin-ui": "start:admin-ui:preview:env",
  "user-ui": "start:user-ui:preview:env",
};

const COMPONENT_URL: Partial<Record<InstallComponent, string>> = {
  api: "http://localhost:8787",
  "admin-ui": "http://localhost:4173",
  "user-ui": "http://localhost:4190",
};

function runtimeStatePath(installDir: string, component: InstallComponent) {
  const key = component.replace(/[^a-z0-9-]/gi, "_");
  return resolve(installDir, ".orgops-runtime", `${key}.json`);
}

function processIsAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function loadPid(installDir: string, component: InstallComponent): number | null {
  const file = runtimeStatePath(installDir, component);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as { pid?: number };
    if (typeof parsed.pid === "number" && processIsAlive(parsed.pid)) return parsed.pid;
    return null;
  } catch {
    return null;
  }
}

function loadStoredPid(installDir: string, component: InstallComponent): number | null {
  const file = runtimeStatePath(installDir, component);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as { pid?: number };
    return typeof parsed.pid === "number" ? parsed.pid : null;
  } catch {
    return null;
  }
}

function savePid(installDir: string, component: InstallComponent, pid: number) {
  const runtimeDir = resolve(installDir, ".orgops-runtime");
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(
    runtimeStatePath(installDir, component),
    `${JSON.stringify({ pid }, null, 2)}\n`,
    "utf-8"
  );
}

function clearPid(installDir: string, component: InstallComponent) {
  rmSync(runtimeStatePath(installDir, component), { force: true });
}

function resolveInstallDir(inputDir?: string) {
  return resolve(inputDir ?? loadState().installDir ?? "orgops");
}

function registeredServiceComponents(components: InstallComponent[]) {
  const serviceComponents = loadState().serviceComponents ?? [];
  return components.filter((component) => serviceComponents.includes(component));
}

function checkHttpUp(url: string): Promise<boolean> {
  return new Promise((resolveReady) => {
    let settled = false;
    const target = new URL(url);
    const requester = target.protocol === "https:" ? httpsRequest : httpRequest;
    const req = requester(
      target,
      {
        method: "GET",
        timeout: 1_500,
      },
      (res) => {
        if (settled) return;
        settled = true;
        resolveReady((res.statusCode ?? 500) < 500);
        res.resume();
      }
    );
    req.on("timeout", () => {
      req.destroy();
      if (!settled) {
        settled = true;
        resolveReady(false);
      }
    });
    req.on("error", () => {
      if (!settled) {
        settled = true;
        resolveReady(false);
      }
    });
    req.end();
  });
}

async function waitForComponentReady(component: InstallComponent, timeoutMs: number) {
  const url = COMPONENT_URL[component];
  if (!url) return;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await checkHttpUp(url)) return;
    await delay(500);
  }
  throw new Error(`${component} did not become ready at ${url} within ${timeoutMs}ms.`);
}

export async function startComponents(options: {
  installDir?: string;
  components: InstallComponent[];
  openBrowser?: boolean;
}) {
  const installDir = resolveInstallDir(options.installDir);
  const started: Array<{ component: InstallComponent; alreadyRunning: boolean; pid: number | null }> = [];
  const serviceComponents = registeredServiceComponents(options.components);
  if (serviceComponents.length > 0) {
    controlAutostartServices(installDir, serviceComponents, "start");
    for (const component of serviceComponents) {
      await waitForComponentReady(component, 30_000);
      started.push({ component, alreadyRunning: false, pid: null });
    }
  }
  for (const component of options.components) {
    if (serviceComponents.includes(component)) continue;
    const existingPid = loadPid(installDir, component);
    if (!existingPid) {
      const runtimeDir = resolve(installDir, ".orgops-runtime");
      mkdirSync(runtimeDir, { recursive: true });
      const logPath = resolve(runtimeDir, `${component}.log`);
      const outFd = openSync(logPath, "a");
      const errFd = openSync(logPath, "a");
      const npmCommand = npmCommandForInstall(installDir);
      if ((npmCommand.includes("/") || npmCommand.includes("\\")) && !existsSync(npmCommand)) {
        throw new Error(`npm command for ${component} is missing: ${npmCommand}`);
      }
      const child = spawn(npmCommand, ["run", COMPONENT_START_COMMAND[component]], {
        cwd: installDir,
        detached: true,
        stdio: ["ignore", outFd, errFd],
        env: envWithToolchain(installDir),
        shell: process.platform === "win32",
        windowsHide: true,
      });
      child.on("error", (error) => {
        throw new Error(`Failed to start ${component} with ${npmCommand}: ${error.message}`);
      });
      closeSync(outFd);
      closeSync(errFd);
      child.unref();
      if (typeof child.pid !== "number") {
        throw new Error(`Failed to start ${component} process.`);
      }
      savePid(installDir, component, child.pid);
      started.push({ component, alreadyRunning: false, pid: child.pid });
    } else {
      started.push({ component, alreadyRunning: true, pid: existingPid });
    }
    await waitForComponentReady(component, 30_000);
  }

  if (options.openBrowser) {
    if (options.components.includes("user-ui")) openUrlInBrowser(COMPONENT_URL["user-ui"]!);
    else if (options.components.includes("admin-ui")) openUrlInBrowser(COMPONENT_URL["admin-ui"]!);
  }
  return { installDir, started };
}

export function stopComponents(options: { installDir?: string; components: InstallComponent[] }) {
  const installDir = resolveInstallDir(options.installDir);
  const stopped: Array<{ component: InstallComponent; stopped: boolean; pid: number | null }> = [];
  const serviceComponents = registeredServiceComponents(options.components);
  if (serviceComponents.length > 0) {
    controlAutostartServices(installDir, serviceComponents, "stop");
    for (const component of serviceComponents) {
      clearPid(installDir, component);
      stopped.push({ component, stopped: true, pid: null });
    }
  }
  for (const component of options.components) {
    if (serviceComponents.includes(component)) continue;
    const pid = loadStoredPid(installDir, component);
    if (!pid) {
      stopped.push({ component, stopped: false, pid: null });
      continue;
    }
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        shell: true,
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          // Ignore already-dead process.
        }
      }
    }
    clearPid(installDir, component);
    stopped.push({ component, stopped: true, pid });
  }
  return { installDir, stopped };
}

export async function getComponentsStatus(options: {
  installDir?: string;
  components: InstallComponent[];
}) {
  const installDir = resolveInstallDir(options.installDir);
  const statuses: ComponentStatus[] = [];
  const serviceStatus = new Map(
    getAutostartServicesStatus(options.components, installDir).map((status) => [status.component, status])
  );
  for (const component of options.components) {
    const pid = loadPid(installDir, component);
    const url = COMPONENT_URL[component];
    const reachable = url ? await checkHttpUp(url) : undefined;
    const service = serviceStatus.get(component);
    statuses.push({
      component,
      running: Boolean(pid) || Boolean(reachable) || Boolean(service?.running),
      pid,
      url,
      reachable,
      serviceRegistered: service?.registered,
      serviceRunning: service?.running,
      serviceDetail: service?.detail,
    });
  }
  return { installDir, statuses };
}

