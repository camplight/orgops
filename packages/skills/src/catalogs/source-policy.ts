import { CATALOG_LIMITS, type ContractIssue, type ContractResult } from "@orgops/schemas";
import type { ResolveInput, CatalogSnapshot, SuppliedPackage } from "./resolve";

export type PackageSourcePolicy = { sourceId: string; enabled: boolean; allowPackages: boolean };
export type SourcePolicyInput = {
  roots: ResolveInput["roots"];
  catalogs: readonly CatalogSnapshot[];
  packages: readonly SuppliedPackage[];
  sources: readonly PackageSourcePolicy[];
};
const key = (parts: readonly string[]): string => JSON.stringify(parts);
const failure = (code: ContractIssue["code"], at: string): ContractResult<never> => ({ ok: false, issues: [{ code, at }] });

/** Trusted validated metadata only: independent edge policy, not pin resolution or authority proof. */
export function precheckPackageSources(input: SourcePolicyInput): ContractResult<readonly string[]> {
  const { roots, catalogs, packages } = input;
  const sources = new Map(input.sources.map(s => [s.sourceId, s]));
  const catalogMap = new Map(catalogs.map(c => [c.catalogId, c]));
  const supplied = new Map(packages.map(p => [key([p.sourceId, p.commit, p.path]), p]));
  const allowed = new Set<string>();
  const externalAllowed = (sourceId: string): boolean => {
    const s = sources.get(sourceId);
    if (!s?.enabled || !s.allowPackages) return false;
    allowed.add(sourceId); return true;
  };
  // Metadata-only policy walk, not a second pin or dependency graph resolver.
  // Check every reached edge's independent permission before coalescing nodes.
  const maxRequests = CATALOG_LIMITS.resolvedPackages * 64 + 64;
  if (roots.length > maxRequests) return failure("LIMIT_EXCEEDED", "packages");
  const queue = [...roots], seen = new Set<string>();
  for (let n = 0; n < queue.length; n++) {
    const request = queue[n]!, k = key([request.catalogId, request.name, request.version]);
    if (seen.has(k)) continue;
    if (seen.size >= CATALOG_LIMITS.resolvedPackages) return failure("LIMIT_EXCEEDED", "packages");
    seen.add(k);
    const catalog = catalogMap.get(request.catalogId);
    if (!catalog?.enabled || !sources.get(catalog.sourceId)?.enabled) return failure("SOURCE_NOT_ALLOWED", "catalogs");
    allowed.add(catalog.sourceId);
    const entry = catalog.index.entries.find(e => e.name === request.name && e.version === request.version);
    if (!entry) return failure("MISSING_RELEASE", "catalogs.index.entries");
    const l = entry.location;
    if (l.type === "source" && !externalAllowed(l.sourceId)) return failure("SOURCE_NOT_ALLOWED", "catalogs.index.entries.location.sourceId");
    const sourceId = l.type === "source" ? l.sourceId : catalog.sourceId;
    const commit = l.type === "source" ? l.commit : l.revision.type === "exact" ? l.revision.commit : catalog.commit;
    const p = supplied.get(key([sourceId, commit, l.path]));
    if (!p) return failure("MISSING_RELEASE", "packages");
    for (const pin of p.snapshot.manifest.dependencies) {
      if (pin.sourceId !== sourceId && !externalAllowed(pin.sourceId)) return failure("SOURCE_NOT_ALLOWED", "dependencies.sourceId");
      if (queue.length >= maxRequests) return failure("LIMIT_EXCEEDED", "packages");
      queue.push({ catalogId: pin.catalogId, name: pin.name, version: pin.version });
    }
  }
  return { ok: true, value: [...allowed].sort() };
}
