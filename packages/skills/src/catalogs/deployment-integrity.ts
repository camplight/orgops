import { createHash } from "node:crypto";
import {
  CATALOG_LIMITS,
  PackageManifestSchema,
  ReleaseIdentitySchema,
  type ArtifactPackage,
  type PackageManifest,
  type ReleaseIdentity,
  type VerifiedArtifactEnvelope,
} from "@orgops/schemas";

export type ImmutablePackage = Readonly<{ release: ReleaseIdentity; manifest: PackageManifest }>;
export type ImmutableClosureLookup = Readonly<{
  byId(releaseId: string): ImmutablePackage | undefined;
  byPin(pin: PackageManifest["dependencies"][number]): readonly ImmutablePackage[];
}>;

const sha256 = (value: string): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;

export function computePackageSetDigest(releases: readonly ReleaseIdentity[]): string {
  return sha256(JSON.stringify(releases));
}

export function computeArtifactSemanticDigest(envelope: Pick<VerifiedArtifactEnvelope,
  "deploymentId" | "agentId" | "generation" | "packages">): string {
  return sha256(JSON.stringify({ deploymentId: envelope.deploymentId, agentId: envelope.agentId,
    generation: envelope.generation, packages: envelope.packages }));
}

export function packageNamespace(index: number, release: Pick<ReleaseIdentity, "name" | "packageReleaseId">): string {
  return `packages/${String(index).padStart(3, "0")}-${release.name}-${createHash("sha256")
    .update(release.packageReleaseId).digest("hex").slice(0, 12)}`;
}

function validPackage(value: ImmutablePackage | undefined): value is ImmutablePackage {
  if (!value) return false;
  const release = ReleaseIdentitySchema.safeParse(value.release);
  const manifest = PackageManifestSchema.safeParse(value.manifest);
  return release.success && manifest.success && release.data.kind === manifest.data.kind
    && release.data.name === manifest.data.name && release.data.version === manifest.data.version
    && release.data.digest === manifest.data.digest;
}

/** Resolves only immutable releases/manifests. Callers deliberately supply no live Source or policy state. */
export function resolveImmutablePackageClosure(rootIds: readonly string[], lookup: ImmutableClosureLookup): ArtifactPackage[] | null {
  if (rootIds.length > CATALOG_LIMITS.resolvedPackages || new Set(rootIds).size !== rootIds.length) return null;
  const ordered: Array<ImmutablePackage & { direct: boolean }> = [];
  const byId = new Map<string, ImmutablePackage & { direct: boolean }>();
  const names = new Map<string, string>();
  const visiting = new Set<string>();
  const visited = new Set<string>();
  let invalid = false;

  const visit = (releaseId: string, direct: boolean, depth: number): void => {
    if (invalid || depth > CATALOG_LIMITS.recursionDepth || visiting.has(releaseId)) { invalid = true; return; }
    const existing = byId.get(releaseId);
    if (existing) {
      if (direct) existing.direct = true;
      if (visited.has(releaseId)) return;
    }
    const candidate = existing ?? lookup.byId(releaseId);
    if (!validPackage(candidate) || candidate.release.packageReleaseId !== releaseId) { invalid = true; return; }
    const foldedName = candidate.release.name.toLowerCase();
    const namedId = names.get(foldedName);
    if (namedId !== undefined && namedId !== releaseId) { invalid = true; return; }
    let current = existing;
    if (!current) {
      if (ordered.length >= CATALOG_LIMITS.resolvedPackages) { invalid = true; return; }
      current = { ...candidate, direct };
      ordered.push(current); byId.set(releaseId, current); names.set(foldedName, releaseId);
    }
    visiting.add(releaseId);
    for (const pin of current.manifest.dependencies) {
      const matches = lookup.byPin(pin);
      if (matches.length !== 1 || !validPackage(matches[0])) { invalid = true; break; }
      const dependency = matches[0];
      const expectedCommit = pin.revision.type === "exact" ? pin.revision.commit : current.release.packageCommit;
      if (dependency.release.kind !== "skill" || dependency.release.packageCommit !== expectedCommit) { invalid = true; break; }
      visit(dependency.release.packageReleaseId, false, depth + 1);
    }
    visiting.delete(releaseId); visited.add(releaseId);
  };
  for (const rootId of rootIds) visit(rootId, true, 0);
  if (invalid) return null;
  return ordered.map((item, index) => ({ release: item.release, manifest: item.manifest,
    direct: item.direct, namespace: packageNamespace(index, item.release) }));
}
