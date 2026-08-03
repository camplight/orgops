import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { openDb, migrate } from "@orgops/db";
import { createApp } from "@orgops/api/src/app";

// Shared support for this module's acceptance tests (US-04). Not a test file itself —
// colocated alongside the *.test.ts file it supports, per this repo's convention (see
// apps/agent-runner/src/multi-source-ingestion-governance/acceptance-test-support.ts, the
// established sibling-track precedent this file mirrors; not shared via cross-module import
// because .dependency-cruiser.cjs forbids cross-track imports between nwave-invocation and
// multi-source-ingestion-governance).
//
// This sandbox runs npm workspaces from the repo root; apps/api/src/app.ts derives PROJECT_ROOT
// from cwd when ORGOPS_PROJECT_ROOT is unset, which misfires if an ancestor directory outside
// this repo happens to contain its own package.json. Pinning the env var to the real repo root
// keeps FILES_DIR inside the repo (writable), matching how this app runs in every other
// environment.
process.env.ORGOPS_PROJECT_ROOT ??= resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

export const TEST_RUNNER_TOKEN = "test-runner-token";

export function createRealApiApp() {
  const db = openDb(":memory:");
  migrate(db);
  const { app } = createApp({
    db,
    dataDir: ".orgops-data-test",
    adminUser: "admin",
    adminPass: "admin",
    runnerToken: TEST_RUNNER_TOKEN,
  });
  return app;
}

export type RealApp = ReturnType<typeof createRealApiApp>;

/**
 * Logs in as the seeded admin human (the app's only human today), standing in for whichever
 * human role a scenario needs (Maria, Devon, or Carlos) — this codebase does not yet have a
 * fixture for multiple distinct humans. Returns the session cookie to attach to subsequent
 * authenticated requests.
 */
export async function loginAsAdmin(app: RealApp): Promise<string> {
  const res = await app.request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin" }),
  });
  return res.headers.get("set-cookie") ?? "";
}

/**
 * apiFetch shape a real HttpRunRepository adapter would use: agent-runner authenticates to the
 * API server-to-server via the runner token (the same x-orgops-runner-token mechanism
 * apps/agent-runner/src/runner.ts's real apiFetch already uses), never a human browser session.
 */
export function apiFetchAsRunner(app: RealApp) {
  return async (path: string, init: RequestInit = {}): Promise<Response> =>
    app.request(`http://localhost${path}`, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        "x-orgops-runner-token": TEST_RUNNER_TOKEN,
      },
    });
}

export function authedRequest(app: RealApp, cookie: string) {
  return async (path: string, init: RequestInit = {}): Promise<Response> =>
    app.request(`http://localhost${path}`, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        cookie,
      },
    });
}

/**
 * Strategy B "real local" proof adapter (see distill/wave-decisions.md DWD-01): spawns a
 * genuine, trivial, near-instantaneous local OS process — never the actual nWave CLI itself
 * (multi-hour, recursive, requires live credentials; that risk is covered separately by the
 * `@requires_external` CLI contract test) — proving the real shell_start wiring shape a
 * production ShellStart adapter would use, without the cost/recursion risk of a real nWave
 * invocation. If this real spawn were deleted, any walking skeleton depending on it could not
 * pass (Dimension 9d litmus test).
 */
export function createRealShellStart() {
  return async (input: { cmd: string; cwd: string; env?: Record<string, string> }) => {
    return new Promise<{ processId: string }>((resolvePromise, rejectPromise) => {
      const processId = randomUUID();
      const child = spawn(input.cmd, {
        cwd: input.cwd,
        shell: true,
        env: { ...process.env, ...input.env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.on("error", (error) => rejectPromise(error));
      child.on("spawn", () => resolvePromise({ processId }));
    });
  };
}

/**
 * Simulates "the underlying execution environment cannot be reached" (US-04 domain example 3 /
 * AC5): a real spawn attempt against a command that cannot exist, so the rejection is a
 * genuine OS-level spawn failure, not a hand-authored fake error.
 */
export function createFailingRealShellStart() {
  return async (_input: { cmd: string; cwd: string; env?: Record<string, string> }) => {
    return new Promise<{ processId: string }>((_resolvePromise, rejectPromise) => {
      const child = spawn("orgops-nonexistent-nwave-cli-binary-for-acceptance-tests", {
        cwd: process.cwd(),
        shell: false,
      });
      child.on("error", (error) => rejectPromise(error));
    });
  };
}
