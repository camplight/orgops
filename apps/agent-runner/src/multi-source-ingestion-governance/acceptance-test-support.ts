import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createDrizzleDb, migrate, openDb, schema } from "@orgops/db";
import { createApp } from "@orgops/api/src/app";
import { GOVERNANCE_MEMBER_TYPE, GOVERNANCE_TEAM_NAME } from "@orgops/api/src/routes/access";

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

/**
 * Grants the seeded admin human real membership in the "governance" team, so acceptance
 * scenarios that authenticate as admin genuinely exercise `canManageTrelloIngestion`'s
 * team-membership check (per this DISTILL wave's DWD-03 stand-in convention) rather than
 * relying on an unchecked/always-true authorization function. Not fixture theater: the
 * membership row is real, and access.ts's real query must find it for the check to pass.
 */
function seedGovernanceTeamMembership(db: ReturnType<typeof openDb>): void {
  const orm = createDrizzleDb(db);
  const admin = orm
    .select({ id: schema.humans.id, username: schema.humans.username })
    .from(schema.humans)
    .all()
    .find((human) => human.username === "admin");
  if (!admin) return;

  const existingTeam = orm
    .select({ id: schema.teams.id, name: schema.teams.name })
    .from(schema.teams)
    .all()
    .find((team) => team.name === GOVERNANCE_TEAM_NAME);
  const governanceTeamId = existingTeam?.id ?? randomUUID();
  if (!existingTeam) {
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

  const isAlreadyMember = orm
    .select({
      teamId: schema.teamMemberships.team_id,
      memberType: schema.teamMemberships.member_type,
      memberId: schema.teamMemberships.member_id,
    })
    .from(schema.teamMemberships)
    .all()
    .some(
      (membership) =>
        membership.teamId === governanceTeamId &&
        membership.memberType === GOVERNANCE_MEMBER_TYPE &&
        membership.memberId === admin.id,
    );
  if (!isAlreadyMember) {
    orm
      .insert(schema.teamMemberships)
      .values({
        team_id: governanceTeamId,
        member_type: GOVERNANCE_MEMBER_TYPE,
        member_id: admin.id,
      })
      .onConflictDoNothing()
      .run();
  }
}

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
  seedGovernanceTeamMembership(db);
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
