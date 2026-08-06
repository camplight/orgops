import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createDrizzleDb, migrate, openDb, schema } from "@orgops/db";
import { createApp } from "@orgops/api/src/app";
import { GOVERNANCE_MEMBER_TYPE, GOVERNANCE_TEAM_NAME } from "@orgops/api/src/routes/access";

// Shared support for this module's acceptance tests (US-01/US-02/US-03). Not a test file
// itself — colocated alongside ticket-classification.test.ts, per this repo's convention
// (see apps/agent-runner/src/nwave-invocation/acceptance-test-support.ts and
// apps/agent-runner/src/multi-source-ingestion-governance/acceptance-test-support.ts, the two
// existing sibling copies this file mirrors).
//
// This sandbox runs npm workspaces from the repo root; apps/api/src/app.ts derives PROJECT_ROOT
// from cwd when ORGOPS_PROJECT_ROOT is unset, which misfires if an ancestor directory outside
// this repo happens to contain its own package.json. Pinning the env var to the real repo root
// keeps FILES_DIR inside the repo (writable), matching how this app runs in every other
// environment.
process.env.ORGOPS_PROJECT_ROOT ??= resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

export const TEST_RUNNER_TOKEN = "test-runner-token";

type TicketClassificationOrm = ReturnType<typeof createDrizzleDb>;

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
  return { app, db };
}

export type RealApp = ReturnType<typeof createRealApiApp>["app"];

/**
 * Logs in as the seeded admin human (the app's only human by default). Standing in for Maria
 * Santos (the primary submitter persona) unless a scenario needs to distinguish a second,
 * distinct human identity — see `createHumanFixture` below for that case.
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
 * apiFetch shape a real HttpTicketRepository adapter would use: agent-runner authenticates to
 * the API server-to-server via the runner token (the same x-orgops-runner-token mechanism
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
 * Creates a second, distinct human via the existing (already-real, not scaffolded)
 * `POST /api/humans/invite` endpoint, then logs in as them. Needed because US-03's override
 * scenarios must distinguish "the ticket's submitter", "an unauthorized bystander", and "a
 * governance-team member who is not the submitter" — three genuinely different identities the
 * single seeded admin fixture cannot represent by itself. Mirrors the invite-then-login flow a
 * real OrgOps admin would use to onboard a new human.
 */
export async function createHumanFixture(
  app: RealApp,
  adminCookie: string,
  input: { username: string },
): Promise<{ id: string; username: string; cookie: string }> {
  const inviteRes = await app.request("http://localhost/api/humans/invite", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: adminCookie },
    body: JSON.stringify({ username: input.username }),
  });
  const invited = (await inviteRes.json()) as {
    id: string;
    username: string;
    temporaryPassword: string;
  };

  const loginRes = await app.request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: invited.username, password: invited.temporaryPassword }),
  });
  const cookie = loginRes.headers.get("set-cookie") ?? "";

  // Invited humans are seeded with must_change_password=1 (humans.ts's invite handler); the real
  // API blocks every route except /api/auth/me|profile|logout until that's cleared (auth.ts's
  // password-change gate). A real client completes this immediately after first login, so this
  // fixture does too — otherwise every other driving port these acceptance tests exercise would
  // 403 for any human created this way.
  await app.request("http://localhost/api/auth/profile", {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ username: invited.username, newPassword: "fixture-password-1" }),
  });

  return { id: invited.id, username: invited.username, cookie };
}

/**
 * Grants a human real membership in the "governance" team (the same team
 * multi-source-ingestion-governance's own acceptance tests already seed for
 * `canManageTrelloIngestion` — see that module's acceptance-test-support.ts
 * `seedGovernanceTeamMembership`, generalized here to an arbitrary human id for US-03's
 * `canOverrideClassification` idiom). Not fixture theater: the membership row is real, and
 * access.ts's real query must find it for the check to pass once implemented.
 */
export function addHumanToGovernanceTeam(db: ReturnType<typeof openDb>, humanId: string): void {
  const orm: TicketClassificationOrm = createDrizzleDb(db);

  const teamRow = orm
    .select({ id: schema.teams.id, name: schema.teams.name })
    .from(schema.teams)
    .all()
    .find((team) => team.name === GOVERNANCE_TEAM_NAME);

  const governanceTeamId = teamRow?.id ?? randomUUID();
  if (!teamRow) {
    orm
      .insert(schema.teams)
      .values({
        id: governanceTeamId,
        name: GOVERNANCE_TEAM_NAME,
        description: null,
        created_at: Date.now(),
      })
      .onConflictDoNothing()
      .run();
  }

  orm
    .insert(schema.teamMemberships)
    .values({
      team_id: governanceTeamId,
      member_type: GOVERNANCE_MEMBER_TYPE,
      member_id: humanId,
    })
    .onConflictDoNothing()
    .run();
}
