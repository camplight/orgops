import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { npmCommandForHost } from "./exec";
import { openUrlInBrowser } from "./browser";
import { loadState } from "./runtime-state";

export const ADMIN_UI_URL = "http://localhost:4173";

type AdminState = {
  pid: number;
};

function processIsAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stateFile(installDir: string) {
  return resolve(installDir, ".orgops-runtime", "admin-ui.json");
}

function resolveInstallDir(inputDir?: string) {
  return resolve(inputDir ?? loadState().installDir ?? "orgops");
}

function loadAdminState(installDir: string): AdminState | null {
  const file = stateFile(installDir);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as AdminState;
    if (typeof parsed.pid === "number" && processIsAlive(parsed.pid)) return parsed;
    return null;
  } catch {
    return null;
  }
}

async function waitForAdminUi(timeoutMs: number) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await checkHttpOk(ADMIN_UI_URL)) return;
    await delay(500);
  }
  throw new Error(`Admin UI did not become ready at ${ADMIN_UI_URL} within ${timeoutMs}ms.`);
}

export async function startAndOpenAdminUi(options?: { installDir?: string; openBrowser?: boolean }) {
  const installDir = resolveInstallDir(options?.installDir);
  const existing = loadAdminState(installDir);
  if (!existing) {
    const runtimeDir = resolve(installDir, ".orgops-runtime");
    mkdirSync(runtimeDir, { recursive: true });
    const logPath = resolve(runtimeDir, "admin-ui.log");
    const outFd = openSync(logPath, "a");
    const errFd = openSync(logPath, "a");
    const child = spawn(
      npmCommandForHost(),
      ["run", "start:admin-ui:preview:env"],
      {
        cwd: installDir,
        detached: true,
        stdio: ["ignore", outFd, errFd],
        env: process.env,
      }
    );
    closeSync(outFd);
    closeSync(errFd);
    child.unref();
    if (typeof child.pid !== "number") {
      throw new Error("Failed to start Admin UI process.");
    }
    writeFileSync(stateFile(installDir), `${JSON.stringify({ pid: child.pid }, null, 2)}\n`, "utf-8");
  }

  await waitForAdminUi(30_000);
  if (options?.openBrowser !== false) {
    openUrlInBrowser(ADMIN_UI_URL);
  }
  return {
    installDir,
    url: ADMIN_UI_URL,
    alreadyRunning: Boolean(existing),
  };
}

export function stopAdminUi(installDirFromArg?: string) {
  const installDir = resolveInstallDir(installDirFromArg);
  const existing = loadAdminState(installDir);
  if (!existing) {
    return {
      installDir,
      stopped: false,
      message: "Admin UI is not running via opscli runtime state.",
    };
  }

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(existing.pid), "/T", "/F"], {
      shell: true,
      stdio: "ignore",
    });
  } else {
    try {
      process.kill(existing.pid, "SIGTERM");
    } catch {
      // Ignore already-dead process.
    }
  }
  rmSync(stateFile(installDir), { force: true });
  return { installDir, stopped: true, pid: existing.pid };
}

async function isAdminUiReachable() {
  return await checkHttpOk(ADMIN_UI_URL);
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

export async function getAdminUiStatus(installDirFromArg?: string) {
  const installDir = resolveInstallDir(installDirFromArg);
  const existing = loadAdminState(installDir);
  const uiReachable = await isAdminUiReachable();
  return {
    installDir,
    running: Boolean(existing) || uiReachable,
    runtimePid: existing?.pid ?? null,
    uiReachable,
    url: ADMIN_UI_URL,
  };
}
