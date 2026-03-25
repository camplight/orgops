import { spawn } from "node:child_process";

const modeArg = process.argv[2];
const runnerScript = modeArg === "start" ? "start" : "dev";
const apiUrlRaw = process.env.ORGOPS_API_URL ?? `http://localhost:${process.env.PORT ?? "8787"}`;
const apiUrl = apiUrlRaw.endsWith("/") ? apiUrlRaw.slice(0, -1) : apiUrlRaw;
const runnerToken = process.env.ORGOPS_RUNNER_TOKEN ?? "dev-runner-token";
const waitTimeoutMs = Number(process.env.ORGOPS_API_WAIT_TIMEOUT_MS ?? 180_000);
const pollIntervalMs = Number(process.env.ORGOPS_API_WAIT_POLL_MS ?? 500);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isApiReady() {
  try {
    const res = await fetch(`${apiUrl}/api/auth/me`, {
      headers: {
        "x-orgops-runner-token": runnerToken,
      },
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForApiReady() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < waitTimeoutMs) {
    if (await isApiReady()) {
      return true;
    }
    await sleep(pollIntervalMs);
  }
  return false;
}

async function main() {
  process.stdout.write(
    `[runner-after-api] waiting for API at ${apiUrl} before running @orgops/agent-runner ${runnerScript}\n`,
  );
  const ready = await waitForApiReady();
  if (!ready) {
    process.stderr.write(
      `[runner-after-api] API did not become ready within ${waitTimeoutMs}ms (${apiUrl})\n`,
    );
    process.exit(1);
    return;
  }
  process.stdout.write("[runner-after-api] API ready, starting runner\n");
  const child = spawn(
    "npm",
    ["run", "--workspace", "@orgops/agent-runner", runnerScript],
    {
      cwd: process.cwd(),
      stdio: "inherit",
    },
  );
  child.on("error", (error) => {
    process.stderr.write(`[runner-after-api] failed to start runner: ${String(error)}\n`);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

void main();
