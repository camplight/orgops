import { describe, expect, it } from "vitest";
import { AdminSkillProvenanceSchema, OpaqueSecretReferenceSchema, ProvisioningTemplateOptionsSchema, SkillInventoryItemSchema } from "./unified-skills";

describe("unified skills wire schemas", () => {
  it("accepts one bounded base64url opaque secret token only", () => {
    expect(OpaqueSecretReferenceSchema.safeParse("Abc_123-xyz").success).toBe(true);
    expect(OpaqueSecretReferenceSchema.safeParse("bad.token").success).toBe(false);
    expect(OpaqueSecretReferenceSchema.safeParse("bad=token").success).toBe(false);
    expect(OpaqueSecretReferenceSchema.safeParse("a".repeat(2049)).success).toBe(false);
  });

  it("requires complete template identity metadata, portable config, exact dependencies, and readiness", () => {
    const dependency = { kind: "CATALOG" as const, packageReleaseId: "release-skill", name: "skill", version: "2.0.0", digest: `sha256:${"b".repeat(64)}` };
    const template = { packageReleaseId: "release-native", name: "native-template", version: "1.0.0", digest: `sha256:${"a".repeat(64)}`, description: "A safe template", mode: "CLASSIC", exactConfig: { mode: "CLASSIC", dependencySkills: [dependency], skillPreloads: ["skill"] }, skillRefs: [dependency], requirements: [], readiness: { state: "READY" } };
    expect(ProvisioningTemplateOptionsSchema.parse({ runners: [], models: [], secretReferences: [], templates: [template] }).templates[0]).toEqual(template);
    const { name: _name, ...incomplete } = template;
    expect(ProvisioningTemplateOptionsSchema.safeParse({ runners: [], models: [], secretReferences: [], templates: [incomplete] }).success).toBe(false);
  });

  it("requires complete bounded catalog provenance while allowing only an explicit local marker", () => {
    const catalog = { kind: "CATALOG", authoritySourceId: "source-a", contentSourceId: "source-b", catalogCommit: "a".repeat(40), packageCommit: "b".repeat(40), packagePath: "skills/demo", sourceReadiness: "READY", reviewState: "APPROVED", installationState: "INSTALLED", apiActivation: { approvalState: "APPROVED", runtimeState: "ACTIVE" }, grantCount: 2, compatibility: { orgops: { min: "1.0.0", maxExclusive: "2.0.0" }, platforms: ["linux"], tools: ["git"] }, links: { overview: "/?screen=source-library&source=source-a&release=release-a&tab=OVERVIEW", contents: "/?screen=source-library&source=source-a&release=release-a&tab=CONTENTS", security: "/?screen=source-library&source=source-a&release=release-a&tab=SECURITY" } } as const;
    expect(AdminSkillProvenanceSchema.parse(catalog)).toEqual(catalog);
    expect(AdminSkillProvenanceSchema.safeParse({ ...catalog, packagePath: undefined }).success).toBe(false);
    expect(AdminSkillProvenanceSchema.parse({ kind: "LOCAL" })).toEqual({ kind: "LOCAL" });
    expect(SkillInventoryItemSchema.safeParse({ ref: { kind: "CATALOG", packageReleaseId: "release-a", name: "demo", version: "1.0.0", digest: `sha256:${"a".repeat(64)}` }, description: "demo", readiness: { state: "READY" }, provenance: "BOUNDED_HUMAN", adminProvenance: catalog }).success).toBe(false);
  });
});
