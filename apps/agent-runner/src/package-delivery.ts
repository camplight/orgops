import {
  DeploymentCommandSchema,
  VerifiedArtifactEnvelopeSchema,
  type AgentRuntimeGeneration,
  type DeploymentCommand,
  type RunnerCatalogClient,
  type VerifiedArtifactEnvelope,
} from "@orgops/schemas";
import { computeArtifactSemanticDigest, computePackageSetDigest, inspectPackage, resolveImmutablePackageClosure } from "@orgops/skills";
import { RunnerApiHttpError } from "./runner/api";

export type ArtifactVerification =
  | { ok: true; value: VerifiedArtifactEnvelope }
  | { ok: false; code: "INSPECTION_FAILED" };

export { computeArtifactSemanticDigest, computePackageSetDigest } from "@orgops/skills";

export function verifyArtifact(rawCommand: unknown, rawEnvelope: unknown): ArtifactVerification {
  const commandResult = DeploymentCommandSchema.safeParse(rawCommand);
  const envelopeResult = VerifiedArtifactEnvelopeSchema.safeParse(rawEnvelope);
  if (!commandResult.success || !envelopeResult.success) return { ok: false, code: "INSPECTION_FAILED" };
  const command = commandResult.data;
  const envelope = envelopeResult.data;
  if (envelope.deploymentId !== command.deploymentId || envelope.agentId !== command.agentId
    || envelope.generation !== command.desiredGeneration || envelope.release.packageReleaseId !== command.releaseId
    || computeArtifactSemanticDigest(envelope) !== envelope.semanticDigest) {
    return { ok: false, code: "INSPECTION_FAILED" };
  }
  const packageMap = new Map(envelope.packages.map(pkg => [pkg.release.packageReleaseId, pkg]));
  if (packageMap.size !== envelope.packages.length || computePackageSetDigest(envelope.packages.map(pkg => pkg.release)) !== command.packageSetDigest)
    return { ok: false, code: "INSPECTION_FAILED" };
  const resolved = resolveImmutablePackageClosure(command.desiredRoots.map(root => root.packageReleaseId), {
    byId: releaseId => { const pkg = packageMap.get(releaseId); return pkg && { release: pkg.release, manifest: pkg.manifest }; },
    byPin: pin => envelope.packages.filter(candidate => candidate.release.authoritySourceId === pin.catalogId
      && candidate.release.contentSourceId === pin.sourceId && candidate.release.name === pin.name
      && candidate.release.version === pin.version && candidate.release.digest === pin.digest)
      .map(pkg => ({ release: pkg.release, manifest: pkg.manifest })),
  });
  if (!resolved || JSON.stringify(resolved) !== JSON.stringify(envelope.packages)
    || JSON.stringify(resolved.filter(pkg => pkg.direct).map(pkg => pkg.release)) !== JSON.stringify(command.desiredRoots)) {
    return { ok: false, code: "INSPECTION_FAILED" };
  }
  const expectedDependencies = envelope.packages.filter(pkg => pkg.release.packageReleaseId !== envelope.release.packageReleaseId)
    .map(pkg => ({ release: pkg.release, direct: pkg.direct }));
  if (JSON.stringify(expectedDependencies) !== JSON.stringify(envelope.dependencies)) return { ok: false, code: "INSPECTION_FAILED" };
  for (const pkg of envelope.packages) {
    const entries = envelope.files.filter(file => file.packageReleaseId === pkg.release.packageReleaseId)
      .map(file => ({ type: "file" as const, path: file.path, base64: file.bytesBase64, executable: file.mode === 0o755 }));
    const inspected = inspectPackage(pkg.manifest, entries);
    if (!inspected.ok || inspected.value.manifest.digest !== pkg.release.digest) return { ok: false, code: "INSPECTION_FAILED" };
  }
  return { ok: true, value: envelope };
}

export function createPackageDeploymentProcessor({ api, runtime }: {
  api: RunnerCatalogClient;
  runtime: AgentRuntimeGeneration;
}) {
  async function fixedFailure(command: DeploymentCommand, token: string, code: "INSPECTION_FAILED" | "STORAGE_FAILURE") {
    try {
      await api.reportPackageDeployment(command.deploymentId, token, {
        state: "FAILED", generation: command.desiredGeneration, failureCode: code,
      });
    } catch { /* A transport-ambiguous report remains durable and is reconciled by the next poll. */ }
  }

  async function processOne(command: DeploymentCommand): Promise<void> {
    let claim;
    try { claim = await api.claimPackageDeployment(command.deploymentId); }
    catch { return; }
    let rawArtifact: unknown;
    try { rawArtifact = await api.getPackageArtifact(command.deploymentId, claim.attemptToken); }
    catch (error) {
      if (error instanceof RunnerApiHttpError && error.status === 422 && error.code === "INSPECTION_FAILED") {
        await fixedFailure(command, claim.attemptToken, "INSPECTION_FAILED");
      }
      return;
    }
    const verified = verifyArtifact(command, rawArtifact);
    if (!verified.ok) { await fixedFailure(command, claim.attemptToken, verified.code); return; }
    let staged;
    try { staged = await runtime.stage(command, verified.value); }
    catch { await fixedFailure(command, claim.attemptToken, "STORAGE_FAILURE"); return; }
    try {
      await api.reportPackageDeployment(command.deploymentId, claim.attemptToken, { state: "STAGED", generation: command.desiredGeneration });
      await api.reportPackageDeployment(command.deploymentId, claim.attemptToken, { state: "WAITING_FOR_IDLE", generation: command.desiredGeneration });
    } catch { return; /* Never convert an ambiguous durable report into a contradictory FAILED report. */ }
    try { await runtime.activateWhenIdle(staged); }
    catch { await fixedFailure(command, claim.attemptToken, "STORAGE_FAILURE"); return; }
    try {
      await api.reportPackageDeployment(command.deploymentId, claim.attemptToken, { state: "ACTIVE", generation: command.desiredGeneration });
    } catch { /* Activation is durable locally; the ACTIVE report is reconciled without false failure. */ }
  }

  return {
    async processPackageDeployments(): Promise<void> {
      let commands: DeploymentCommand[];
      try { commands = await api.listPackageDeployments(); } catch { return; }
      for (const raw of commands) {
        const parsed = DeploymentCommandSchema.safeParse(raw);
        if (parsed.success) await processOne(parsed.data);
      }
    },
  };
}
