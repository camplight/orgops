import { describe, expect, it } from "vitest";
import {
  ActivationPlanSchema,
  CancelRolloutResultSchema,
  CatalogAuditEventSchema,
  CatalogLibraryErrorCodeSchema,
  DeploymentCommandSchema,
  RetryFailedRolloutResultSchema,
  RolloutViewSchema,
  SourceCreateSchema,
  SourcePatchSchema,
  VerifiedArtifactEnvelopeSchema,
  LibraryPackageDetailSchema,
  ManageableAgentSchema,
  TemplateOptionsSchema,
  UserTemplateInstantiationResultSchema,
} from "./source-library";

const digest = `sha256:${"a".repeat(64)}`;
const commit = "a".repeat(40);

describe("source library contracts", () => {
  it("rejects repository and ref on SourcePatch while accepting only bounded mutable fields", () => {
    expect(SourcePatchSchema.safeParse({ expectedRevision: 1, ref: "main" }).success).toBe(false);
    expect(SourcePatchSchema.safeParse({ expectedRevision: 1, enabled: false, allowPackages: true }).success).toBe(true);
  });

  it("requires complete bounded Source creation and rejects unknown fields", () => {
    const source = {
      sourceId: "source-team",
      displayName: "Team packages",
      repository: { url: "https://github.com/example/packages" },
      ref: "main",
      enabled: true,
      allowPackages: false,
    };
    expect(SourceCreateSchema.parse(source)).toEqual(source);
    expect(SourceCreateSchema.safeParse({ ...source, repositoryIdentity: "forged" }).success).toBe(false);
    expect(SourceCreateSchema.safeParse({ ...source, displayName: "x".repeat(201) }).success).toBe(false);
    expect(SourceCreateSchema.safeParse({ ...source, ref: "x".repeat(1025) }).success).toBe(false);
  });

  it("keeps the library error code set fixed", () => {
    expect(CatalogLibraryErrorCodeSchema.parse("CATALOG_RESOURCE_RETIRED")).toBe("CATALOG_RESOURCE_RETIRED");
    expect(CatalogLibraryErrorCodeSchema.safeParse("UNBOUNDED_TEXT").success).toBe(false);
  });

  it("accepts only redacted strict catalog audit events", () => {
    const event = {
      type: "audit.catalog.source.changed",
      source: "system",
      status: "DELIVERED",
      channelId: null,
      payload: {
        actorKind: "HUMAN_ADMIN",
        actorId: "human-a",
        action: "source.create",
        outcome: "SUCCEEDED",
        revision: 1,
        sourceId: "source-team",
      },
    };
    expect(CatalogAuditEventSchema.parse(event)).toEqual(event);
    expect(CatalogAuditEventSchema.safeParse({
      ...event,
      payload: { ...event.payload, credential: "secret" },
    }).success).toBe(false);
  });

  it("requires planned preload and accepts a deployment blocker without package metadata", () => {
    const target = { agentId: "agent-a", assignmentRevision: 0, runnerId: null, plannedPreload: false, blocker: { code: "DEPLOYMENT_REQUIRED" as const } };
    expect(ActivationPlanSchema.safeParse({ planDigest: digest, releaseId: "release-skill", operation: "ENABLE", targets: [target] }).success).toBe(true);
    expect(ActivationPlanSchema.safeParse({ planDigest: digest, releaseId: "release-skill", operation: "ENABLE", targets: [{ ...target, plannedPreload: 0 }] }).success).toBe(false);
    expect(ActivationPlanSchema.safeParse({ planDigest: digest, releaseId: "release-skill", operation: "ENABLE", targets: [{ ...target, blocker: { code: "DEPLOYMENT_REQUIRED", packageReleaseId: "release-skill" } }] }).success).toBe(false);
  });

  it("enforces rollout correspondence and unique result IDs", () => {
    const plan = { planDigest: digest, releaseId: "release-skill", operation: "ENABLE" as const,
      targets: [{ agentId: "agent-a", assignmentRevision: 0, runnerId: null, plannedPreload: false, blocker: null }] };
    expect(ActivationPlanSchema.parse(plan)).toEqual(plan);
    expect(ActivationPlanSchema.safeParse({ ...plan, targets: [plan.targets[0], plan.targets[0]] }).success).toBe(false);
    const rollout = { id: "rollout-a", releaseId: "release-skill", operation: "ENABLE" as const, state: "FAILED" as const,
      revision: 2, targetIds: ["agent-a"], targets: [{ agentId: "agent-a", state: "FAILED" as const, attempts: 1, reasonCode: "STORAGE_FAILURE" as const }] };
    expect(RolloutViewSchema.parse(rollout)).toEqual(rollout);
    expect(RolloutViewSchema.safeParse({ ...rollout, targetIds: ["agent-a", "agent-a"] }).success).toBe(false);
    expect(RolloutViewSchema.safeParse({ ...rollout, targetIds: ["agent-b"] }).success).toBe(false);
    expect(CancelRolloutResultSchema.safeParse({ rollout, skippedTargetIds: ["agent-b"] }).success).toBe(false);
    expect(RetryFailedRolloutResultSchema.safeParse({ rollout, targetIds: ["agent-a"], deploymentIds: [] }).success).toBe(false);
  });

  it("accepts only privacy-safe Library detail, options, agents, and template results", () => {
    const detail = {
      package: { packageReleaseId: "release-skill", kind: "skill" as const, name: "demo", version: "1.0.0", digest },
      description: "Safe description", author: "OrgOps", license: "MIT",
      compatibility: { orgops: { min: "0.0.1" }, platforms: ["linux" as const], tools: [] },
      dependencies: [{ name: "dep", version: "1.0.0", digest }],
      secretRequirements: [{ name: "API_KEY", description: "API key", required: true }],
    };
    expect(LibraryPackageDetailSchema.parse(detail)).toEqual(detail);
    expect(LibraryPackageDetailSchema.safeParse({ ...detail, source: "https://github.com/example" }).success).toBe(false);
    const agent = { id: "agent-id", name: "agent-name", assignedRunnerId: "runner-a", agentRevision: 2, assignmentRevision: 4, desiredState: "STOPPED" as const, effectiveState: "DISABLED" as const, deploymentState: "STABLE" as const, preload: false };
    expect(ManageableAgentSchema.parse(agent)).toEqual(agent);
    const options = { runners: [{ id: "runner-a" }], models: [{ id: "model-a" }], secretReferences: [{ id: "secret-a", name: "API_KEY" }] };
    expect(TemplateOptionsSchema.parse(options)).toEqual(options);
    const result = { agent: { id: "agent-id", name: "agent-name", visibility: "PRIVATE" as const, assignedRunnerId: "runner-a", modelId: "model-a", mode: "CLASSIC" as const, desiredState: "STOPPED" as const, runtimeState: "STOPPED" as const, channelIds: [] as const }, origin: { packageReleaseId: "release-native", mode: "CLASSIC" as const, actorKind: "GRANT" as const, createdAt: 1 }, requirements: [{ name: "API_KEY", state: "MISSING" as const }] };
    expect(UserTemplateInstantiationResultSchema.parse(result)).toEqual(result);
    expect(UserTemplateInstantiationResultSchema.safeParse({ ...result, agent: { ...result.agent, ownerHumanId: "human-a" } }).success).toBe(false);
  });

  it("requires an agent-bound generation and complete immutable identity in artifact envelopes", () => {
    const manifest = {
      formatVersion: 1,
      kind: "skill",
      name: "demo-skill",
      version: "1.0.0",
      description: "A deterministic fixture.",
      author: "OrgOps",
      license: "MIT",
      compatibility: { orgops: { min: "0.0.1" }, platforms: ["linux"], tools: [] },
      secrets: [],
      dependencies: [],
      files: [],
      executables: [],
      digest,
      skill: { entrypoint: "SKILL.md" },
    };
    const envelope = {
      deploymentId: "deployment-a",
      agentId: "agent-a",
      generation: "generation-a",
      release: {
        packageReleaseId: "release-skill",
        authoritySourceId: "source-team",
        contentSourceId: "source-team",
        kind: "skill",
        name: "demo-skill",
        version: "1.0.0",
        catalogCommit: commit,
        packageCommit: commit,
        packagePath: "skills/demo-skill",
        digest,
      },
      manifest,
      dependencies: [],
      packages: [{ release: {
        packageReleaseId: "release-skill",
        authoritySourceId: "source-team",
        contentSourceId: "source-team",
        kind: "skill",
        name: "demo-skill",
        version: "1.0.0",
        catalogCommit: commit,
        packageCommit: commit,
        packagePath: "skills/demo-skill",
        digest,
      }, manifest, direct: true, namespace: "packages/000-demo-skill" }],
      semanticDigest: digest,
      files: [],
    };
    expect(VerifiedArtifactEnvelopeSchema.parse(envelope)).toEqual(envelope);
    const { agentId: _agentId, ...unbound } = envelope;
    expect(VerifiedArtifactEnvelopeSchema.safeParse(unbound).success).toBe(false);
    expect(VerifiedArtifactEnvelopeSchema.safeParse({ ...envelope, sourceUrl: "https://example.invalid" }).success).toBe(false);
    const command = { deploymentId: "deployment-a", agentId: "agent-a", agentName: "agent-a", assignedRunnerId: "runner-a",
      releaseId: "release-skill", desiredGeneration: "generation-a", desiredRoots: [envelope.release], packageSetDigest: digest };
    expect(DeploymentCommandSchema.parse(command)).toEqual(command);
    const { desiredRoots: _roots, ...unboundRoots } = command;
    expect(DeploymentCommandSchema.safeParse(unboundRoots).success).toBe(false);
  });
});
