import { spawn, type ChildProcess } from "node:child_process";

const API_URL = process.env.ORGOPS_API_URL ?? "http://localhost:8787";
const RUNNER_TOKEN = process.env.ORGOPS_RUNNER_TOKEN ?? "dev-runner-token";

const API_START_CMD = [
  "node",
  "--env-file=.env",
  "--import",
  "tsx",
  "apps/api/src/server.ts",
];

type Agent = { name: string };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers ?? {});
  headers.set("x-orgops-runner-token", RUNNER_TOKEN);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers,
  });
}

async function isApiReachable() {
  try {
    const response = await apiFetch("/api/auth/me");
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForApiReady(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isApiReachable()) return true;
    await sleep(250);
  }
  return false;
}

async function assertOk(response: Response, action: string) {
  if (response.ok) return;
  const details = await response.text().catch(() => "");
  throw new Error(
    `${action} failed (${response.status}${details ? `): ${details}` : ")"}`,
  );
}

async function cleanupRuntime() {
  const processRes = await apiFetch("/api/processes", { method: "DELETE" });
  await assertOk(processRes, "Clearing processes");
  const processBody = await processRes.json();

  const eventsRes = await apiFetch("/api/events", { method: "DELETE" });
  await assertOk(eventsRes, "Clearing events");
  const eventsBody = await eventsRes.json();

  const agentsRes = await apiFetch("/api/agents");
  await assertOk(agentsRes, "Loading agents");
  const agents = (await agentsRes.json()) as Agent[];

  let cleanedWorkspaces = 0;
  for (const agent of agents) {
    const workspaceRes = await apiFetch(
      `/api/agents/${encodeURIComponent(agent.name)}/cleanup-workspace`,
      { method: "POST" },
    );
    await assertOk(workspaceRes, `Cleaning workspace for ${agent.name}`);
    cleanedWorkspaces += 1;
  }

  console.log(
    `[dev:all:clean] cleaned events=${eventsBody.deletedCount ?? 0}, processes=${processBody.clearedCount ?? 0}, workspaces=${cleanedWorkspaces}`,
  );
}

function spawnCommand(
  command: string,
  args: string[],
  options: { withStdin?: boolean; quiet?: boolean } = {},
) {
  let stdio: "inherit" | ["ignore", "inherit", "inherit"] | "ignore" = [
    "ignore",
    "inherit",
    "inherit",
  ];
  if (options.withStdin) {
    stdio = "inherit";
  } else if (options.quiet) {
    stdio = "ignore";
  }
  const child = spawn(command, args, {
    cwd: process.cwd(),
    stdio,
  });
  return child;
}

function waitForExit(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 0));
  });
}

async function startDevAll() {
  const child = spawnCommand("npm", ["run", "dev:all"], { withStdin: true });
  const code = await waitForExit(child);
  process.exit(code);
}

async function startDevAllWithoutApi() {
  const child = spawnCommand("npm", ["run", "dev:all:no-api"], { withStdin: true });
  const code = await waitForExit(child);
  process.exit(code);
}

async function main() {
  let tempApiProcess: ChildProcess | null = null;
  const apiWasAlreadyRunning = await isApiReachable();

  if (!apiWasAlreadyRunning) {
    tempApiProcess = spawnCommand(API_START_CMD[0], API_START_CMD.slice(1), {
      quiet: true,
    });
    const ready = await waitForApiReady();
    if (!ready) {
      tempApiProcess.kill("SIGTERM");
      throw new Error(
        `API did not become ready at ${API_URL} within timeout; cannot clean runtime state.`,
      );
    }
  }

  try {
    await cleanupRuntime();
  } finally {
    if (tempApiProcess) {
      tempApiProcess.kill("SIGTERM");
      await waitForExit(tempApiProcess);
    }
  }

  if (apiWasAlreadyRunning) {
    console.log("[dev:all:clean] API already running; starting runner+ui only.");
    await startDevAllWithoutApi();
    return;
  }

  await startDevAll();
}

main().catch((error) => {
  console.error("[dev:all:clean] failed:", error);
  process.exit(1);
});
