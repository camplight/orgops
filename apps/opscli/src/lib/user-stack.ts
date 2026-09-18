import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { npmCommandForHost } from "./exec";
import { openUrlInBrowser } from "./browser";
import { loadState } from "./runtime-state";
import { USER_UI_URL } from "./install";

type UserStackRuntimeState = { pid: number };

function processIsAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function statePath(installDir: string) {
  return resolve(installDir, ".orgops-runtime", "user-stack.json");
}

function loadRuntimeState(installDir: string): UserStackRuntimeState | null {
  const file = statePath(installDir);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as UserStackRuntimeState;
    if (typeof parsed.pid === "number" && processIsAlive(parsed.pid)) return parsed;
  } catch {
    return null;
  }
  return null;
}

function saveRuntimeState(installDir: string, state: UserStackRuntimeState) {
  const runtimeDir = resolve(installDir, ".orgops-runtime");
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(statePath(installDir), `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}

function resolveInstallDir(inputDir?: string) {
  return resolve(inputDir ?? loadState().installDir ?? "orgops");
}

async function isUserUiReachable() {
  return await checkHttpOk(USER_UI_URL);
}

function checkHttpOk(url: string): Promise<boolean> {
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
        resolveReady((res.statusCode ?? 500) >= 200 && (res.statusCode ?? 500) < 400);
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

async function waitForUserUi(timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isUserUiReachable()) return;
    await delay(500);
  }
  throw new Error(`User UI did not become ready at ${USER_UI_URL} within ${timeoutMs}ms.`);
}

export async function startUserStack(options?: { installDir?: string; openBrowser?: boolean }) {
  const installDir = resolveInstallDir(options?.installDir);
  const existing = loadRuntimeState(installDir);
  if (!existing) {
    const runtimeDir = resolve(installDir, ".orgops-runtime");
    mkdirSync(runtimeDir, { recursive: true });
    const logPath = resolve(runtimeDir, "user-stack.log");
    const child =
      process.platform === "win32"
        ? spawn(npmCommandForHost(), ["run", "start:user-stack:env"], {
            cwd: installDir,
            detached: true,
            stdio: "ignore",
            env: process.env,
            shell: true,
          })
        : (() => {
            const outFd = openSync(logPath, "a");
            const errFd = openSync(logPath, "a");
            const spawned = spawn(npmCommandForHost(), ["run", "start:user-stack:env"], {
              cwd: installDir,
              detached: true,
              stdio: ["ignore", outFd, errFd],
              env: process.env,
            });
            closeSync(outFd);
            closeSync(errFd);
            return spawned;
          })();
    child.unref();
    if (typeof child.pid !== "number") {
      throw new Error("Failed to start user stack process.");
    }
    saveRuntimeState(installDir, { pid: child.pid });
  }
  await waitForUserUi(30_000);
  if (options?.openBrowser !== false) openUrlInBrowser(USER_UI_URL);
  return { installDir, alreadyRunning: Boolean(existing), url: USER_UI_URL };
}

export function stopUserStack(options?: { installDir?: string }) {
  const installDir = resolveInstallDir(options?.installDir);
  const state = loadRuntimeState(installDir);
  if (!state) {
    return { installDir, stopped: false, message: "User stack is not running via opscli runtime state." };
  }

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(state.pid), "/T", "/F"], {
      shell: true,
      stdio: "ignore",
    });
  } else {
    try {
      process.kill(state.pid, "SIGTERM");
    } catch {
      // Ignore already-dead process.
    }
  }
  rmSync(statePath(installDir), { force: true });
  return { installDir, stopped: true, pid: state.pid };
}

export async function getUserStackStatus(options?: { installDir?: string }) {
  const installDir = resolveInstallDir(options?.installDir);
  const runtime = loadRuntimeState(installDir);
  const uiReachable = await isUserUiReachable();
  const serviceRegistered = Boolean(loadState().serviceRegistered);
  return {
    installDir,
    running: Boolean(runtime) || uiReachable,
    runtimePid: runtime?.pid ?? null,
    uiReachable,
    userUiUrl: USER_UI_URL,
    serviceRegistered,
  };
}
