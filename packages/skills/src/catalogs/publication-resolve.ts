import { precheckPackageSources } from "./source-policy";
import { type CatalogIndex, type ResolvedIdentity, type PackageManifest } from "@orgops/schemas";
import { resolvePackages, type CatalogSnapshot, type SuppliedPackage } from "./resolve";
import type { ValidatedPublication } from "./publication-base";
import { publicationFailure as failure, publicationFreeze as freeze } from "./publication-content";
import type { PublicationRelease, PublicationResult, PublicationRevision } from "./publication-types";

const key = (parts: readonly string[]): string => JSON.stringify(parts);
const releaseKey = (i: ResolvedIdentity): string => key([i.catalogId, i.name, i.version]);
const immutable = (i: ResolvedIdentity): string => key([i.catalogId, i.sourceId, i.name, i.version, i.kind, i.packageCommit, i.path, i.digest]);

// Only commit-typed fields participate. Authored text must never be rewritten or
// interpreted as provenance, even when it happens to equal the private context.
function temporaryCommit(v: ValidatedPublication): string {
  const used = new Set<string>([v.input.base.commit]);
  const identity = (i: ResolvedIdentity) => { used.add(i.catalogCommit); used.add(i.packageCommit); };
  const index = (i: CatalogIndex) => { for (const e of i.entries) {
    const l = e.location;
    if (l.type === "source") used.add(l.commit);
    else if (l.revision.type === "exact") used.add(l.revision.commit);
  } };
  const manifest = (m: PackageManifest) => { for (const d of m.dependencies) if (d.revision.type === "exact") used.add(d.revision.commit); };
  index(v.baseIndex);
  for (const c of v.input.catalogs) { used.add(c.commit); index(c.index); }
  for (const p of v.input.packages) { used.add(p.commit); manifest(p.snapshot.manifest); }
  for (const s of v.input.selections) { if (s.origin) identity(s.origin); manifest(s.candidate.snapshot.manifest); }
  [...v.input.base.history.releases, ...v.input.knownReleases].forEach(identity);
  for (let n = 0; n <= used.size; n++) {
    const candidate = n.toString(16).padStart(64, "0");
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("Unreachable bounded context search");
}

export function resolvePublicationReleases(
  validated: ValidatedPublication, proposedIndex: CatalogIndex,
): PublicationResult<readonly PublicationRelease[]> {
  const { input: v, preconditions } = validated;
  const context = temporaryCommit(validated);
  const catalogs: CatalogSnapshot[] = [{ catalogId: v.base.catalogId, sourceId: v.base.sourceId,
    commit: context, enabled: true, index: proposedIndex }, ...v.catalogs];
  const packages: SuppliedPackage[] = [...v.packages];
  for (const s of v.selections) {
    const m = s.candidate.snapshot.manifest;
    const entry = proposedIndex.entries.find(e => e.name === m.name && e.version === m.version);
    if (entry?.location.type === "catalog" && entry.location.revision.type === "catalog-revision")
      packages.push({ sourceId: v.base.sourceId, commit: context, path: s.destinationPath, snapshot: s.candidate.snapshot });
  }
  const known = new Map<string, ResolvedIdentity>();
  for (const i of [...v.base.history.releases, ...preconditions.preservedReleases, ...v.knownReleases]) {
    const k = releaseKey(i), previous = known.get(k);
    if (previous && immutable(previous) !== immutable(i)) return failure("IDENTITY_CONFLICT", "knownReleases");
    if (!previous) known.set(k, i);
  }
  const roots = v.selections.map(s => ({ catalogId: v.base.catalogId,
    name: s.candidate.snapshot.manifest.name, version: s.candidate.snapshot.manifest.version }));
  const policy = precheckPackageSources({ roots, catalogs, packages, sources: v.sources });
  if (!policy.ok) return policy;
  const resolved = resolvePackages({ roots, catalogs, packages, allowedSourceIds: policy.value,
    target: v.target, installedSkills: [], knownReleases: [...known.values()] });
  if (!resolved.ok) return resolved;
  const revision = (commit: string): PublicationRevision => commit === context ? { type: "proposal" } : { type: "exact", commit };
  return { ok: true, value: freeze(structuredClone(resolved.value.packages.map(p => {
    const { catalogCommit, packageCommit, ...identity } = p.identity;
    return { identity: { ...identity, catalogRevision: revision(catalogCommit), packageRevision: revision(packageCommit) },
      snapshot: p.snapshot, disposition: packageCommit === context ? "new" as const : "existing" as const };
  }))) };
}
