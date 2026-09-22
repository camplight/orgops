import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { DeploymentCommand, VerifiedArtifactEnvelope } from "@orgops/schemas";
import { exportSkillPackage } from "@orgops/skills";
import { computeArtifactSemanticDigest } from "./package-delivery";
import { createAgentRuntimeGeneration } from "./runtime-generation";

async function delivery(generation: string, deploymentId: string) {
  const exported = exportSkillPackage([{ type: "file", path: "SKILL.md", executable: false, base64: Buffer.from(`---\nname: runner-e2e\ndescription: Runner fixture.\n---\n${generation}\n`).toString("base64") }], {
    metadata: { formatVersion: 1, name: "runner-e2e", version: "1.0.0", description: "Runner fixture.", author: "OrgOps", license: "MIT",
      compatibility: { orgops: { min: "0.0.1" }, platforms: ["linux"], tools: [] }, secrets: [] }, dependencies: [], executables: [], selectedPaths: ["SKILL.md"],
  });
  if (!exported.ok) throw new Error("runner fixture export failed");
  const manifest = exported.value.snapshot.manifest;
  const release = { packageReleaseId: "release-runner-e2e", authoritySourceId: "source-runner-e2e", contentSourceId: "source-runner-e2e", kind: "skill" as const,
    name: manifest.name, version: manifest.version, catalogCommit: "a".repeat(40), packageCommit: "a".repeat(40), packagePath: "packages/runner-e2e", digest: manifest.digest };
  const packages = [{ release, manifest, direct: true, namespace: `packages/000-runner-e2e-${createHash("sha256").update(release.packageReleaseId).digest("hex").slice(0, 12)}` }];
  const artifact = { deploymentId, agentId: "agent-e2e", generation, release, manifest, dependencies: [], packages, semanticDigest: "", files: exported.value.snapshot.files.map(file => ({ packageReleaseId: release.packageReleaseId, path: file.path, mode: file.executable ? 0o755 as const : 0o644 as const, bytesBase64: file.base64 })) } as VerifiedArtifactEnvelope;
  artifact.semanticDigest = computeArtifactSemanticDigest(artifact);
  const command: DeploymentCommand = { deploymentId, agentId: "agent-e2e", agentName: "agent-e2e", assignedRunnerId: "runner-e2e", releaseId: release.packageReleaseId, desiredGeneration: generation, desiredRoots: [release], packageSetDigest: `sha256:${createHash("sha256").update(JSON.stringify([release])).digest("hex")}` };
  return { command, artifact };
}

describe("catalog runner delivery end to end", () => {
  it("stages, activates, survives reassignment/restart, and rejects artifact tampering", async () => {
    const root = await mkdtemp(join(tmpdir(), "orgops-catalog-runner-e2e-"));
    try {
      const runtime = createAgentRuntimeGeneration({ packageRoot: root });
      const first = await delivery("generation-a", "deployment-a");
      const staged = await runtime.stage(first.command, first.artifact);
      const states: string[] = ["STAGED"];
      await runtime.activateWhenIdle(staged); states.push("WAITING_FOR_IDLE", "ACTIVE");
      const lease = await runtime.captureForTurn("agent-e2e");
      expect(lease.generation.generation).toBe("generation-a"); lease.release();
      const restarted = createAgentRuntimeGeneration({ packageRoot: root });
      const restartLease = await restarted.captureForTurn("agent-e2e");
      expect(restartLease.generation.generation).toBe("generation-a"); restartLease.release();
      const reassigned = structuredClone(first.command); reassigned.agentId = "agent-other";
      const reassignmentRejected = await expect(runtime.stage(reassigned, first.artifact)).rejects.toMatchObject({ code: "INSPECTION_FAILED" }).then(() => true);
      const second = await delivery("generation-b", "deployment-b");
      const tampered = await runtime.stage(second.command, second.artifact);
      await writeFile(join(tampered.generation.skillRoot, "runner-e2e", "SKILL.md"), "tampered", { mode: 0o644 });
      const tamperRejected = await expect(runtime.activateWhenIdle(tampered)).rejects.toMatchObject({ code: "STORAGE_FAILURE" }).then(() => true);
      expect(await readFile(join(staged.generation.skillRoot, "runner-e2e", "SKILL.md"), "utf8")).toContain("generation-a");
      expect(states).toEqual(["STAGED", "WAITING_FOR_IDLE", "ACTIVE"]);
      expect(reassignmentRejected).toBe(true);
      expect(tamperRejected).toBe(true);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
