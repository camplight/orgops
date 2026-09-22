import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentSkillsTab } from "./AgentSkillsTab";

const digest = `sha256:${"a".repeat(64)}`;
const localItem = { ref: { kind: "LOCAL" as const, name: "local-tool", localOrigin: "BUILT_IN" as const }, description: "Local tool", readiness: { state: "READY" as const }, provenance: "FULL_ADMIN" as const, adminProvenance: { kind: "LOCAL" as const } };
const catalogItem = { ref: { kind: "CATALOG" as const, packageReleaseId: "release-skill", name: "catalog-tool", version: "1.0.0", digest }, description: "Catalog tool", readiness: { state: "READY" as const }, provenance: "BOUNDED_HUMAN" as const, assignment: { desired: "DISABLED" as const, effective: "DISABLED" as const, preload: false, deployment: "STABLE" as const, revision: 3 } };

const fixture = () => ({
  agentId: "agent-1",
  agentRevision: 8,
  items: [localItem, catalogItem],
  history: [],
  localEnabled: [],
  localPreloaded: [],
  busy: false,
  onReload: vi.fn(),
  management: { execute: vi.fn(async () => ({ ref: {}, desired: "ENABLED" as const, effective: "DISABLED" as const, preload: false, deployment: "REQUESTED" as const, revision: 4, agentRevision: 9 })), history: vi.fn(async () => []) },
});

describe("AgentSkillsTab", () => {
  it("renders the unified inventory with truthful desired and effective deployment state", () => {
    const html = renderToStaticMarkup(<AgentSkillsTab {...fixture()} />);
    expect(html).toContain("Skills");
    expect(html).toContain("catalog-tool");
    expect(html).toContain("Desired");
    expect(html).toContain("Effective");
    expect(html).toContain("STABLE");
    expect(html).toContain("Add");
  });

  it("keeps catalog deployment visibly non-optimistic", () => {
    const html = renderToStaticMarkup(<AgentSkillsTab {...fixture()} />);
    expect(html).toContain("Effective: DISABLED");
    expect(html).toContain("Desired: DISABLED");
    expect(html).toContain("Preload later");
  });

  it("does not call a failed deployment waiting", () => {
    const failed = { ...catalogItem, assignment: { ...catalogItem.assignment!, desired: "ENABLED" as const, deployment: "FAILED" as const } };
    const html = renderToStaticMarkup(<AgentSkillsTab {...fixture()} items={[localItem, failed]} />);
    expect(html).toContain("Deployment failed; prior active skills remain.");
    expect(html).not.toContain("Waiting for agent to become idle");
  });
});
