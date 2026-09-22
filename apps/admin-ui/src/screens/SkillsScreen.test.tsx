import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SkillsScreen } from "./SkillsScreen";

const digest = `sha256:${"b".repeat(64)}`;
const fixtureState = { busy: false, filters: { query: "", origin: "ALL" as const, availability: "ALL" as const }, lastGoodItems: [], agentRevision: null, items: [
  { ref: { kind: "LOCAL" as const, name: "local", localOrigin: "BUILT_IN" as const }, description: "Local skill", readiness: { state: "BLOCKED" as const, blockers: [{ code: "INSTALLATION_REQUIRED" as const }] }, provenance: "BOUNDED_HUMAN" as const },
  { ref: { kind: "CATALOG" as const, packageReleaseId: "release", name: "catalog", version: "1.0.0", digest }, description: "Catalog skill", readiness: { state: "READY" as const }, provenance: "FULL_ADMIN" as const, adminProvenance: { kind: "CATALOG" as const, authoritySourceId: "source", contentSourceId: "content", catalogCommit: "a".repeat(40), packageCommit: "b".repeat(40), packagePath: "skills/catalog", sourceReadiness: "READY" as const, reviewState: "APPROVED" as const, installationState: "INSTALLED" as const, apiActivation: { approvalState: "APPROVED" as const, runtimeState: "ACTIVE" as const }, grantCount: 2, compatibility: { orgops: { min: "1.0.0", maxExclusive: "2.0.0" }, platforms: ["linux"], tools: ["git"] }, links: { overview: "/?screen=source-library&source=source&release=release&tab=OVERVIEW", contents: "/?screen=source-library&source=source&release=release&tab=CONTENTS", security: "/?screen=source-library&source=source&release=release&tab=SECURITY" } } },
], selectedItem: null, selection: { skill: null, agentId: null }, error: null, status: "" };
const fixtureActions = { setFilters: () => {}, select: () => {}, setAgentId: async () => fixtureState, load: async () => fixtureState };

describe("SkillsScreen", () => {
  it("renders origin, readiness, blockers, and bounded empty states", () => {
    const html = renderToStaticMarkup(<SkillsScreen state={fixtureState} actions={fixtureActions} />);
    expect(html).toContain("Local");
    expect(html).toContain("Catalog");
    expect(html).toContain("Available after installation");
    expect(html).not.toContain("https://private.example");
  });

  it("renders complete admin provenance and exact Source Library release links", () => {
    const selected = fixtureState.items[1]!;
    const html = renderToStaticMarkup(<SkillsScreen state={{ ...fixtureState, selectedItem: selected, selection: { skill: selected.ref, agentId: null } }} actions={fixtureActions} />);
    for (const value of ["source", "content", "skills/catalog", "a".repeat(40), "b".repeat(40), "OrgOps 1.0.0 – 2.0.0", "Platforms: linux", "Tools: git", "APPROVED / ACTIVE", "Current grants", "2"]) expect(html).toContain(value);
    expect(html).toContain("tab=OVERVIEW");
    expect(html).toContain("tab=CONTENTS");
    expect(html).toContain("tab=SECURITY");
  });
});
