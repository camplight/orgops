import { randomUUID } from "node:crypto";
import { createDrizzleDb, migrate, openDb, schema } from "@orgops/db";
import { describe, expect, it } from "vitest";
import { createAccessControl, GOVERNANCE_MEMBER_TYPE, GOVERNANCE_TEAM_NAME } from "./access";

function createTestOrm() {
  const db = openDb(":memory:");
  migrate(db);
  return createDrizzleDb(db);
}

function addToGovernanceTeam(orm: ReturnType<typeof createTestOrm>, humanId: string): void {
  const teamId = randomUUID();
  orm
    .insert(schema.teams)
    .values({ id: teamId, name: GOVERNANCE_TEAM_NAME, description: null, created_at: Date.now() })
    .run();
  orm
    .insert(schema.teamMemberships)
    .values({ team_id: teamId, member_type: GOVERNANCE_MEMBER_TYPE, member_id: humanId })
    .run();
}

describe("canOverrideClassification", () => {
  it("authorizes the ticket's own submitter to override its classification", () => {
    const orm = createTestOrm();
    const access = createAccessControl({ orm });
    const submitterHumanId = "human-devon";

    const isAuthorized = access.canOverrideClassification(
      { id: submitterHumanId, username: "devon-park" },
      { submitterHumanId },
    );

    expect(isAuthorized).toBe(true);
  });

  it("authorizes a governance-team member who is not the submitter", () => {
    const orm = createTestOrm();
    const access = createAccessControl({ orm });
    addToGovernanceTeam(orm, "human-priya");

    const isAuthorized = access.canOverrideClassification(
      { id: "human-priya", username: "priya-nair" },
      { submitterHumanId: "human-devon" },
    );

    expect(isAuthorized).toBe(true);
  });
});
