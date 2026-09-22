import { describe, expect, it } from "vitest";
import type {
  AgentView,
  AuthenticatedPrincipal,
  GrantView,
  PackageReleaseView,
  PolicyAction,
} from "@orgops/schemas";
import { adminActor, approvedRelease, humanActor } from "./test-fixtures";
import { createCatalogPolicy, type CatalogPolicyReleaseState } from "./policy";

const ownerAgent: AgentView = {
  id: "agent-a",
  name: "agent-a",
  ownerHumanId: "human-a",
  assignedRunnerId: "runner-a",
  revision: 1,
};
const otherAgent: AgentView = { ...ownerAgent, ownerHumanId: "human-other" };

function policyFixture() {
  let currentRelease: PackageReleaseView = approvedRelease();
  let sourceEnabled = true;
  let externalSourceAllowed = true;
  let currentGrant: unknown;
  let rawReleaseState: unknown;
  let throwRelease = false;
  let throwGrant = false;
  let throwManage = false;
  const reads = { release: 0, grant: 0, manage: 0 };
  const policy = createCatalogPolicy({
    readRelease(releaseId): CatalogPolicyReleaseState | undefined {
      reads.release += 1;
      if (throwRelease) throw new Error("private release adapter detail");
      if (rawReleaseState !== undefined) return rawReleaseState as CatalogPolicyReleaseState;
      return currentRelease.packageReleaseId === releaseId
        ? {
            release: {
              packageReleaseId: currentRelease.packageReleaseId,
              reviewState: currentRelease.reviewState,
              installationState: currentRelease.installationState,
              executionPreview: currentRelease.executionPreview,
              apiActivation: currentRelease.apiActivation,
            },
            sourceEnabled,
            externalSourceAllowed,
          }
        : undefined;
    },
    readGrant(actor, releaseId) {
      reads.grant += 1;
      if (throwGrant) throw new Error("private grant adapter detail");
      if (actor.kind !== "AUTHENTICATED_HUMAN" || !currentGrant || (currentGrant as { releaseId?: unknown }).releaseId !== releaseId) return undefined;
      return currentGrant as GrantView;
    },
    canManageAgent(actor, agent) {
      reads.manage += 1;
      if (throwManage) throw new Error("private manage adapter detail");
      return (actor.kind === "HUMAN_ADMIN" || actor.kind === "AUTHENTICATED_HUMAN")
        && agent.ownerHumanId === actor.id;
    },
  });
  return {
    policy,
    reads,
    setRelease(release: PackageReleaseView) { currentRelease = release; rawReleaseState = undefined; },
    setRawReleaseState(state: unknown) { rawReleaseState = state; },
    setSource(enabled: boolean, externalAllowed = true) { sourceEnabled = enabled; externalSourceAllowed = externalAllowed; },
    setGrant(grant: unknown) { currentGrant = grant; },
    throwAdapters(adapter: "release" | "grant" | "manage") {
      if (adapter === "release") throwRelease = true;
      if (adapter === "grant") throwGrant = true;
      if (adapter === "manage") throwManage = true;
    },
  };
}

function release(overrides: Partial<PackageReleaseView> = {}): PackageReleaseView {
  return { ...approvedRelease(), ...overrides };
}
function organizationGrant(overrides: Partial<GrantView> = {}): GrantView {
  return {
    grantId: "grant-0e51a913c77077b2d58527a46efd06e1d71869dabf9c3f2a5e8f3104895a29fc",
    releaseId: "release-skill",
    subject: { kind: "ORGANIZATION" },
    revision: 1,
    revokedAt: null,
    ...overrides,
  };
}
function humanGrant(humanId = "human-a", overrides: Partial<GrantView> = {}): GrantView {
  return {
    grantId: humanId === "human-a"
      ? "grant-16d80e933bf3a187dfa06328a0ba4dc18cc149dce0de6609b84234e79d6dca84"
      : "grant-noncanonical",
    releaseId: "release-skill",
    subject: { kind: "HUMAN", humanId },
    revision: 1,
    revokedAt: null,
    ...overrides,
  };
}

const adminOnly: readonly PolicyAction[] = [
  "SOURCE_MANAGE", "RELEASE_REVIEW", "RELEASE_INSTALL", "GRANT_MANAGE", "API_EXECUTION_APPROVE",
];
const consumption: readonly PolicyAction[] = [
  "LIBRARY_VIEW", "TEMPLATE_INSTANTIATE", "SKILL_ASSIGN", "ROLLOUT_CREATE",
];

function inputFor(action: PolicyAction, actor: AuthenticatedPrincipal) {
  return {
    action,
    actor,
    ...(["SOURCE_MANAGE", "RELEASE_REVIEW"].includes(action) ? {} : { release: approvedRelease() }),
    ...(["SKILL_ASSIGN", "ROLLOUT_CREATE", "RUNNER_DEPLOY"].includes(action) ? { agent: ownerAgent } : {}),
    ...(action === "RUNNER_DEPLOY" ? { runner: { id: "runner-a" } } : {}),
  };
}

describe("CatalogPolicy central decision switch", () => {
  it("covers every action and principal without granting administrative controls to non-admins", () => {
    const fixture = policyFixture();
    fixture.setGrant(organizationGrant());
    const ordinary = humanActor();
    const runner = { kind: "RUNNER" as const, runnerId: "runner-a" };
    const agent = { kind: "AGENT" as const, agentName: "agent-a" };

    for (const action of adminOnly) {
      expect(fixture.policy.decide(inputFor(action, adminActor())), action).toEqual({ allow: true });
      for (const actor of [ordinary, runner, agent]) {
        expect(fixture.policy.decide(inputFor(action, actor)), `${action}:${actor.kind}`).toEqual({ allow: false, reasonCode: "FORBIDDEN" });
      }
    }
    for (const action of consumption) {
      expect(fixture.policy.decide(inputFor(action, adminActor())), `${action}:admin`).toEqual({ allow: true });
      expect(fixture.policy.decide(inputFor(action, ordinary)), `${action}:human`).toEqual({ allow: true });
      for (const actor of [runner, agent]) {
        expect(fixture.policy.decide(inputFor(action, actor)), `${action}:${actor.kind}`).toEqual({ allow: false, reasonCode: "FORBIDDEN" });
      }
    }
    expect(fixture.policy.decide(inputFor("RUNNER_DEPLOY", runner))).toEqual({ allow: true });
    for (const actor of [adminActor(), ordinary, agent]) {
      expect(fixture.policy.decide(inputFor("RUNNER_DEPLOY", actor)), actor.kind).toEqual({ allow: false, reasonCode: "FORBIDDEN" });
    }
    expect(fixture.policy.decide({ action: "LIBRARY_VIEW", actor: undefined as never, release: approvedRelease() }))
      .toEqual({ allow: false, reasonCode: "FORBIDDEN" });
    expect(fixture.policy.decide({ action: "LIBRARY_VIEW", actor: { kind: "HUMAN_ADMIN", id: "human-a", runnerScope: {} } as never, release: approvedRelease() }))
      .toEqual({ allow: false, reasonCode: "FORBIDDEN" });
  });

  it("does not interchange source enablement, approval, installation, grant, and API activation", () => {
    const fixture = policyFixture();
    fixture.setRelease(release({ reviewState: "PENDING", reviewDigest: null, reviewer: null, installationState: "ABSENT" }));
    expect(fixture.policy.decide({ action: "RELEASE_INSTALL", actor: adminActor(), release: approvedRelease() }))
      .toEqual({ allow: false, reasonCode: "RELEASE_NOT_APPROVED" });

    fixture.setRelease(release({ installationState: "ABSENT" }));
    fixture.setGrant(organizationGrant());
    expect(fixture.policy.decide({ action: "TEMPLATE_INSTANTIATE", actor: humanActor(), release: approvedRelease() }))
      .toEqual({ allow: false, reasonCode: "INSTALLATION_REQUIRED" });

    fixture.setRelease(approvedRelease());
    fixture.setGrant(undefined);
    expect(fixture.policy.decide({ action: "TEMPLATE_INSTANTIATE", actor: humanActor(), release: approvedRelease() }))
      .toEqual({ allow: false, reasonCode: "GRANT_REQUIRED" });

    fixture.setGrant(organizationGrant());
    fixture.setSource(false);
    expect(fixture.policy.decide({ action: "LIBRARY_VIEW", actor: humanActor(), release: approvedRelease() }))
      .toEqual({ allow: false, reasonCode: "SOURCE_NOT_ALLOWED" });
    fixture.setSource(true, false);
    expect(fixture.policy.decide({ action: "LIBRARY_VIEW", actor: humanActor(), release: approvedRelease() }))
      .toEqual({ allow: false, reasonCode: "SOURCE_NOT_ALLOWED" });

    fixture.setSource(true, true);
    fixture.setRelease(release({
      executionPreview: { ...approvedRelease().executionPreview, apiEventShapes: ["event-shapes.ts"] },
      apiActivation: { approvalState: "APPROVED", runtimeState: "INACTIVE", revision: 2, failureCode: null },
    }));
    expect(fixture.policy.decide({ action: "SKILL_ASSIGN", actor: humanActor(), release: approvedRelease(), agent: ownerAgent }))
      .toEqual({ allow: false, reasonCode: "API_ACTIVATION_REQUIRED" });
  });

  it("uses current release and grant state on every decision with deterministic failure precedence", () => {
    const fixture = policyFixture();
    fixture.setGrant(organizationGrant());
    expect(fixture.policy.decide({ action: "LIBRARY_VIEW", actor: humanActor(), release: approvedRelease() })).toEqual({ allow: true });
    fixture.setRelease(release({ reviewState: "WITHDRAWN" }));
    fixture.setGrant(organizationGrant({ revokedAt: 5, revision: 2 }));
    expect(fixture.policy.decide({ action: "LIBRARY_VIEW", actor: humanActor(), release: approvedRelease() }))
      .toEqual({ allow: false, reasonCode: "RELEASE_NOT_APPROVED" });
    fixture.setRelease(approvedRelease());
    expect(fixture.policy.decide({ action: "LIBRARY_VIEW", actor: humanActor(), release: approvedRelease() }))
      .toEqual({ allow: false, reasonCode: "GRANT_REQUIRED" });
    expect(fixture.reads.release).toBe(3);
    expect(fixture.reads.grant).toBe(2);
  });

  it("matches grants to the exact release and selected human or organization scope", () => {
    const fixture = policyFixture();
    for (const grant of [
      humanGrant("human-other"),
      humanGrant("human-a", { releaseId: "release-other" }),
      organizationGrant({ grantId: "grant-noncanonical" }),
      organizationGrant({ revokedAt: 2, revision: 2 }),
    ]) {
      fixture.setGrant(grant);
      expect(fixture.policy.decide({ action: "LIBRARY_VIEW", actor: humanActor(), release: approvedRelease() }))
        .toEqual({ allow: false, reasonCode: "GRANT_REQUIRED" });
    }
    fixture.setGrant(humanGrant("human-a"));
    expect(fixture.policy.decide({ action: "LIBRARY_VIEW", actor: humanActor(), release: approvedRelease() })).toEqual({ allow: true });
    fixture.setGrant(organizationGrant());
    expect(fixture.policy.decide({ action: "LIBRARY_VIEW", actor: humanActor("future-human"), release: approvedRelease() })).toEqual({ allow: true });
  });

  it("rejects malformed decision components and invalid adapter data without throwing", () => {
    const fixture = policyFixture();
    fixture.setGrant(organizationGrant());
    const malformedInputs: ReadonlyArray<readonly [string, unknown, string]> = [
      ["empty principal ID", { action: "SOURCE_MANAGE", actor: { kind: "HUMAN_ADMIN", id: "" } }, "FORBIDDEN"],
      ["oversized principal ID", { action: "SOURCE_MANAGE", actor: { kind: "HUMAN_ADMIN", id: "x".repeat(201) } }, "FORBIDDEN"],
      ["unknown principal", { action: "LIBRARY_VIEW", actor: { kind: "ROOT", id: "human-a" }, release: approvedRelease() }, "FORBIDDEN"],
      ["unknown action", { action: "EVERYTHING", actor: adminActor() }, "FORBIDDEN"],
      ["invalid release locator", { action: "LIBRARY_VIEW", actor: humanActor(), release: { ...approvedRelease(), packageReleaseId: "INVALID!" } }, "NOT_FOUND"],
      ["partial release view", { action: "LIBRARY_VIEW", actor: humanActor(), release: { packageReleaseId: "release-skill" } }, "NOT_FOUND"],
      ["malformed agent", { action: "SKILL_ASSIGN", actor: humanActor(), release: approvedRelease(), agent: { ...ownerAgent, revision: 0 } }, "FORBIDDEN"],
      ["malformed runner", { action: "RUNNER_DEPLOY", actor: { kind: "RUNNER", runnerId: "runner-a" }, release: approvedRelease(), agent: ownerAgent, runner: { id: "" } }, "FORBIDDEN"],
    ];
    for (const [name, input, reasonCode] of malformedInputs) {
      expect(() => fixture.policy.decide(input as never), name).not.toThrow();
      expect(fixture.policy.decide(input as never), name).toEqual({ allow: false, reasonCode });
    }

    fixture.setRawReleaseState({ release: { ...approvedRelease(), reviewState: "TRUSTED" }, sourceEnabled: true, externalSourceAllowed: true });
    expect(() => fixture.policy.decide({ action: "LIBRARY_VIEW", actor: humanActor(), release: approvedRelease() })).not.toThrow();
    expect(fixture.policy.decide({ action: "LIBRARY_VIEW", actor: humanActor(), release: approvedRelease() }))
      .toEqual({ allow: false, reasonCode: "NOT_FOUND" });

    fixture.setRelease(approvedRelease());
    fixture.setGrant({ ...organizationGrant(), subject: { kind: "HUMAN" } });
    expect(() => fixture.policy.decide({ action: "LIBRARY_VIEW", actor: humanActor(), release: approvedRelease() })).not.toThrow();
    expect(fixture.policy.decide({ action: "LIBRARY_VIEW", actor: humanActor(), release: approvedRelease() }))
      .toEqual({ allow: false, reasonCode: "GRANT_REQUIRED" });
  });

  it.each([
    ["disabled Source", { sourceEnabled: false }, "SOURCE_NOT_ALLOWED"],
    ["external permission denied", { externalSourceAllowed: false }, "SOURCE_NOT_ALLOWED"],
    ["pending review", { release: release({ reviewState: "PENDING", reviewDigest: null, reviewer: null }) }, "RELEASE_NOT_APPROVED"],
    ["absent installation", { release: release({ installationState: "ABSENT" }) }, "INSTALLATION_REQUIRED"],
    ["inactive required API", { release: release({ executionPreview: { ...approvedRelease().executionPreview, apiEventShapes: ["event-shapes.ts"] }, apiActivation: { approvalState: "APPROVED", runtimeState: "INACTIVE", revision: 2, failureCode: null } }) }, "API_ACTIVATION_REQUIRED"],
  ] as const)("checks %s before runner assignment", (_name, state, reasonCode) => {
    const fixture = policyFixture();
    if ("release" in state) fixture.setRelease(state.release);
    if ("sourceEnabled" in state) fixture.setSource(state.sourceEnabled);
    if ("externalSourceAllowed" in state) fixture.setSource(true, state.externalSourceAllowed);
    expect(fixture.policy.decide({
      action: "RUNNER_DEPLOY",
      actor: { kind: "RUNNER", runnerId: "runner-wrong" },
      release: approvedRelease(),
      agent: ownerAgent,
      runner: { id: "runner-a" },
    })).toEqual({ allow: false, reasonCode });
  });

  it("fails closed with fixed reasons when adapters throw", () => {
    const releaseFailure = policyFixture();
    releaseFailure.throwAdapters("release");
    expect(() => releaseFailure.policy.decide({ action: "LIBRARY_VIEW", actor: humanActor(), release: approvedRelease() })).not.toThrow();
    expect(releaseFailure.policy.decide({ action: "LIBRARY_VIEW", actor: humanActor(), release: approvedRelease() }))
      .toEqual({ allow: false, reasonCode: "NOT_FOUND" });

    const grantFailure = policyFixture();
    grantFailure.throwAdapters("grant");
    expect(() => grantFailure.policy.decide({ action: "LIBRARY_VIEW", actor: humanActor(), release: approvedRelease() })).not.toThrow();
    expect(grantFailure.policy.decide({ action: "LIBRARY_VIEW", actor: humanActor(), release: approvedRelease() }))
      .toEqual({ allow: false, reasonCode: "GRANT_REQUIRED" });

    const manageFailure = policyFixture();
    manageFailure.setGrant(organizationGrant());
    manageFailure.throwAdapters("manage");
    expect(() => manageFailure.policy.decide({ action: "SKILL_ASSIGN", actor: humanActor(), release: approvedRelease(), agent: ownerAgent })).not.toThrow();
    expect(manageFailure.policy.decide({ action: "SKILL_ASSIGN", actor: humanActor(), release: approvedRelease(), agent: ownerAgent }))
      .toEqual({ allow: false, reasonCode: "FORBIDDEN" });
  });

  it("checks target manageability before package and grant state for assignment actions", () => {
    const fixture = policyFixture();
    fixture.setSource(false);
    expect(fixture.policy.decide({ action: "SKILL_ASSIGN", actor: humanActor(), release: approvedRelease(), agent: otherAgent }))
      .toEqual({ allow: false, reasonCode: "FORBIDDEN" });
    expect(fixture.policy.decide({ action: "ROLLOUT_CREATE", actor: adminActor(), release: approvedRelease(), agent: otherAgent }))
      .toEqual({ allow: false, reasonCode: "FORBIDDEN" });
    expect(fixture.policy.decide({
      action: "RUNNER_DEPLOY", actor: { kind: "RUNNER", runnerId: "runner-wrong" }, release: approvedRelease(),
      agent: ownerAgent, runner: { id: "runner-a" },
    })).toEqual({ allow: false, reasonCode: "SOURCE_NOT_ALLOWED" });
  });

  it("uses only NOT_FOUND as the no-release SKILL_ASSIGN manageability sentinel", () => {
    for (const [name, actor, agent, expected, expectedManageReads] of [
      ["manageable human", humanActor(), ownerAgent, { allow: false, reasonCode: "NOT_FOUND" }, 1],
      ["manageable admin", adminActor(), ownerAgent, { allow: false, reasonCode: "NOT_FOUND" }, 1],
      ["unmanageable human", humanActor(), otherAgent, { allow: false, reasonCode: "FORBIDDEN" }, 1],
      ["unmanageable admin", adminActor("human-other"), ownerAgent, { allow: false, reasonCode: "FORBIDDEN" }, 1],
      ["malformed actor", { kind: "AUTHENTICATED_HUMAN", id: "" }, ownerAgent, { allow: false, reasonCode: "FORBIDDEN" }, 0],
      ["malformed agent", humanActor(), { ...ownerAgent, revision: 0 }, { allow: false, reasonCode: "FORBIDDEN" }, 0],
    ] as const) {
      const fixture = policyFixture();
      const decision = fixture.policy.decide({ action: "SKILL_ASSIGN", actor, agent } as never);
      expect.soft(decision, name).toEqual(expected);
      expect.soft(decision.allow, name).toBe(false);
      expect.soft(fixture.reads, name).toEqual({ release: 0, grant: 0, manage: expectedManageReads });
    }
  });

  it("requires agent manageability independently for humans and exact assignment for runners", () => {
    const fixture = policyFixture();
    fixture.setGrant(organizationGrant());
    expect(fixture.policy.decide({ action: "SKILL_ASSIGN", actor: humanActor(), release: approvedRelease(), agent: otherAgent }))
      .toEqual({ allow: false, reasonCode: "FORBIDDEN" });
    expect(fixture.policy.decide({ action: "SKILL_ASSIGN", actor: adminActor(), release: approvedRelease(), agent: otherAgent }))
      .toEqual({ allow: false, reasonCode: "FORBIDDEN" });
    expect(fixture.policy.decide({ action: "RUNNER_DEPLOY", actor: { kind: "RUNNER", runnerId: "runner-b" }, release: approvedRelease(), agent: ownerAgent, runner: { id: "runner-a" } }))
      .toEqual({ allow: false, reasonCode: "FORBIDDEN" });
    expect(fixture.policy.decide({ action: "RUNNER_DEPLOY", actor: { kind: "RUNNER", runnerId: "runner-a" }, release: approvedRelease(), agent: { ...ownerAgent, assignedRunnerId: "runner-b" }, runner: { id: "runner-a" } }))
      .toEqual({ allow: false, reasonCode: "FORBIDDEN" });
  });
});
