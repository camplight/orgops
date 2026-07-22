import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate, openDb } from "@orgops/db";
import { createApp } from "@orgops/api/src/app";

// Shared support for this module's acceptance tests (US-11/US-12/US-13). Not a test file
// itself — colocated alongside the *.test.ts files it supports, per this repo's convention.
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
 * human role a scenario needs (submitter or governance-team member) — this codebase does not
 * yet have a fixture for a second human with distinct team membership. Returns the session
 * cookie to attach to subsequent authenticated requests.
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
 * apiFetch shape a real HttpGovernanceRepository/GovernanceRepositoryPort adapter would use:
 * agent-runner authenticates to the API server-to-server via the runner token (the same
 * x-orgops-runner-token mechanism apps/agent-runner/src/runner.ts's real apiFetch already uses),
 * never a human browser session.
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
