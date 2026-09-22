import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { UnifiedSkillPicker } from "./UnifiedSkillPicker";

const item = { ref: { kind: "LOCAL" as const, name: "local-skill", localOrigin: "BUILT_IN" as const }, description: "Local", readiness: { state: "READY" as const }, provenance: "BOUNDED_HUMAN" as const };
const catalogItem = { ref: { kind: "CATALOG" as const, packageReleaseId: "release-skill", name: "catalog-skill", version: "1.0.0", digest: "sha256:" + "a".repeat(64) }, description: "Catalog", readiness: { state: "READY" as const }, provenance: "BOUNDED_HUMAN" as const };

describe("UnifiedSkillPicker", () => {
  it("renders local and catalog refs without reconstructing config", () => {
    const html = renderToStaticMarkup(<UnifiedSkillPicker items={[item, catalogItem]} selected={null} onChange={() => {}} disabled={false} />);
    expect(html).toContain("local-skill");
    expect(html).toContain("Local");
    expect(html).toContain('aria-label="Skill"');
    expect(html).toContain("catalog-skill · Catalog");
  });

  it("renders a multi-select without rebuilding catalog refs", () => {
    const html = renderToStaticMarkup(<UnifiedSkillPicker items={[item, catalogItem]} selected={null} selectedRefs={[catalogItem.ref]} onToggle={() => {}} onChange={() => {}} disabled={false} />);
    expect(html).toContain('aria-label="Select catalog-skill"');
    expect(html).toContain('checked=""');
  });
});
