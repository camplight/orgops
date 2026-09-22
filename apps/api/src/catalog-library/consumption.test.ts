import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createCatalogConsumption } from "./consumption";

const actor = { kind: "HUMAN_ADMIN" as const, id: "human-a" };

describe("catalog consumption management bridge", () => {
  it("contains no direct normalized assignment or deployment mutations", () => {
    const source = readFileSync(new URL("./consumption.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/(?:INSERT|UPDATE|DELETE)\\s+(?:INTO\\s+)?(?:agent_skill_assignments|runner_package_deployments)/i);
  });
  it("delegates assignment mutations to the canonical legacy adapter", async () => {
    const executeLegacyCatalog = vi.fn().mockResolvedValue({
      ref: { kind: "CATALOG", packageReleaseId: "release-skill", assignmentId: "assignment-a", desiredGeneration: "generation-a", activeGeneration: null },
      desired: "ENABLED", effective: "DISABLED", preload: true, deployment: "REQUESTED", revision: 1, agentRevision: 1,
    });
    const db = { prepare: () => ({ get: () => undefined, all: () => [] }) } as any;
    const service = createCatalogConsumption({
      db, policy: { decide: () => ({ allow: false, reasonCode: "FORBIDDEN" }) },
      enqueueBoundDeployment: vi.fn(), writeAudit: vi.fn(), management: { executeLegacyCatalog },
    });
    await expect(service.assignSkill({ kind: "assignment.enable", agentId: "agent-a", releaseId: "release-skill", expectedAgentRevision: 1, expectedAssignmentRevision: 0, preload: true }, actor)).resolves.toMatchObject({ assignmentId: "assignment-a", desiredState: "ENABLED" });
    expect(executeLegacyCatalog).toHaveBeenCalledWith(expect.objectContaining({ kind: "CATALOG", operation: "ENABLE" }), actor);
  });
});
