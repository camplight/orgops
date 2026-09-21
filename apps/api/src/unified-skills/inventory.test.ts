import { describe, expect, it, vi } from "vitest";
import { createUnifiedSkillInventory } from "./inventory";

const actor = { kind: "AUTHENTICATED_HUMAN" as const, id: "human-user" };

describe("UnifiedSkillInventory", () => {
  it("keeps local and catalog identity distinct and redacts bounded-human provenance", async () => {
    const inventory = await createUnifiedSkillInventory({
      listLocal: () => [{ name: "local-tool", description: "Local", localOrigin: "WORKSPACE", trustedRootKey: "/private" }],
      listCatalogSkills: () => [{ packageReleaseId: "release-skill", name: "catalog-tool", version: "1.0.0", digest: `sha256:${"a".repeat(64)}`, description: "Catalog", installed: true, release: {} as any }],
      projectLocal: item => ({ ref: { kind: "LOCAL", name: item.name, localOrigin: item.localOrigin }, description: item.description, readiness: { state: "READY" }, provenance: "BOUNDED_HUMAN" }),
      projectCatalog: item => ({ ref: { kind: "CATALOG", packageReleaseId: item.packageReleaseId, name: item.name, version: item.version, digest: item.digest }, description: item.description, version: item.version, readiness: { state: "READY" }, provenance: "BOUNDED_HUMAN" }),
      requireManageableAgent: () => ({ revision: 1 }), withReadSnapshot: <T>(read: () => T) => read(), policy: { decide: () => ({ allow: true as const }) }, evaluateCatalog: () => ({ visible: true, readiness: { state: "READY" } }), grantFor: () => ({} as any), agentFor: () => undefined,
    }).list(actor, { origin: "ALL", availability: "ALL" });
    expect(inventory).toEqual(expect.arrayContaining([
      expect.objectContaining({ ref: { kind: "LOCAL", name: "local-tool", localOrigin: "WORKSPACE" }, provenance: "BOUNDED_HUMAN" }),
      expect.objectContaining({ ref: { kind: "CATALOG", packageReleaseId: "release-skill", name: "catalog-tool", version: "1.0.0", digest: expect.stringMatching(/^sha256:/) }, provenance: "BOUNDED_HUMAN" }),
    ]));
    expect(JSON.stringify(inventory)).not.toContain("trustedRootKey");
    expect(JSON.stringify(inventory)).not.toContain("/private");
  });

  it("uses policy visibility and preserves every bounded readiness blocker", async () => {
    const blocked = { state: "BLOCKED" as const, blockers: [{ code: "SOURCE_UNAVAILABLE" as const }, { code: "INCOMPATIBLE" as const }] };
    const items = await createUnifiedSkillInventory({
      listLocal: () => [], listCatalogSkills: () => [
        { packageReleaseId: "visible", name: "visible", version: "1.0.0", digest: `sha256:${"b".repeat(64)}`, description: "Visible", release: { packageReleaseId: "visible" } as any },
        { packageReleaseId: "hidden", name: "hidden", version: "1.0.0", digest: `sha256:${"c".repeat(64)}`, description: "Hidden", release: { packageReleaseId: "hidden" } as any },
      ],
      projectLocal: () => ({}), projectCatalog: item => ({ ref: { kind: "CATALOG", packageReleaseId: item.packageReleaseId, name: item.name, version: item.version, digest: item.digest }, description: item.description, version: item.version, readiness: item.readiness, provenance: "BOUNDED_HUMAN" }),
      requireManageableAgent: () => ({ revision: 1 }), withReadSnapshot: <T>(read: () => T) => read(),
      policy: { decide: input => input.release?.packageReleaseId === "hidden" ? { allow: false, reasonCode: "NOT_FOUND" } : { allow: true } },
      evaluateCatalog: (item): import("./inventory").CatalogEvaluation => item.packageReleaseId === "visible" ? { visible: true, readiness: blocked } : { visible: true, readiness: { state: "READY" } }, grantFor: () => ({} as any), agentFor: () => undefined,
    }).list(actor, { origin: "CATALOG" });
    expect(items).toHaveLength(1);
    expect(items[0]?.readiness).toEqual(blocked);
  });

  it("omits ungranted catalog releases without revealing their identity", async () => {
    const items = await createUnifiedSkillInventory({
      listLocal: () => [], listCatalogSkills: () => [{ packageReleaseId: "revoked", name: "private", version: "1.0.0", digest: `sha256:${"d".repeat(64)}`, description: "Private", release: { packageReleaseId: "revoked" } as any }],
      projectLocal: () => ({}), projectCatalog: () => ({}), requireManageableAgent: () => ({ revision: 1 }),
      withReadSnapshot: <T>(read: () => T) => read(), policy: { decide: () => ({ allow: true as const }) }, evaluateCatalog: () => ({ visible: true, readiness: { state: "READY" as const } }), grantFor: () => undefined, agentFor: () => undefined,
    }).list(actor, { origin: "CATALOG" });
    expect(items).toEqual([]);
  });

  it("returns assignment data and agent revision from one read snapshot", async () => {
    const withReadSnapshot = vi.fn((read: () => unknown) => read());
    let revision = 7;
    const result = await createUnifiedSkillInventory({
      listLocal: () => [], listCatalogSkills: () => [],
      projectLocal: item => ({ ref: { kind: "LOCAL", name: item.name, localOrigin: "WORKSPACE" }, description: item.description, readiness: { state: "READY" }, provenance: "BOUNDED_HUMAN" }),
      projectCatalog: () => ({}), requireManageableAgent: () => ({ revision }),
      withReadSnapshot: withReadSnapshot as unknown as <T>(read: () => T) => T, policy: { decide: () => ({ allow: true as const }) }, evaluateCatalog: () => ({ visible: true, readiness: { state: "READY" as const } }), grantFor: () => undefined, agentFor: () => undefined,
    }).listForAgent(actor, "agent-1", {});
    revision = 8;
    expect(result.agentRevision).toBe(7);
    expect(withReadSnapshot).toHaveBeenCalledTimes(1);
  });

  it("is observational", async () => {
    const deps = { listLocal: () => [], listCatalogSkills: () => [], projectLocal: vi.fn(), projectCatalog: vi.fn(), requireManageableAgent: vi.fn(), withReadSnapshot: <T>(read: () => T) => read(), policy: { decide: () => ({ allow: true as const }) }, evaluateCatalog: () => ({ visible: true, readiness: { state: "READY" as const } }), grantFor: () => undefined, agentFor: () => undefined };
    await createUnifiedSkillInventory(deps).list({ kind: "HUMAN_ADMIN", id: "human-admin" }, {});
    expect(deps.requireManageableAgent).not.toHaveBeenCalled();
  });
});
