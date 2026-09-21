import {
  CATALOG_LIMITS, CatalogIdSchema, SourceIdSchema, PackageNameSchema, VersionSchema,
  CommitSchema, DigestSchema, RelativePathSchema, ResolvedIdentitySchema,
  validateCatalogJson, validateCatalogIndex,
  type CatalogIndex, type CatalogEntry, type ResolvedIdentity, type DependencyPin,
  type ContractIssue, type ContractResult,
} from "@orgops/schemas";
import { inspectPackage, type PackageSnapshot } from "./content";

export type CatalogSnapshot = { catalogId: string; sourceId: string; commit: string; enabled: boolean; index: CatalogIndex };
export type SuppliedPackage = { sourceId: string; commit: string; path: string; snapshot: PackageSnapshot };
export type InstalledSkill = { name: string; identity: ResolvedIdentity | null; currentDigest: string };
export type ResolveInput = {
  roots: { catalogId: string; name: string; version: string }[];
  catalogs: readonly CatalogSnapshot[];
  packages: readonly SuppliedPackage[];
  allowedSourceIds: readonly string[];
  target: { orgopsVersion: string; platform: "linux" | "darwin" | "win32"; tools: string[] };
  installedSkills: readonly InstalledSkill[];
  knownReleases: readonly ResolvedIdentity[];
};
export type ResolvedPackage = { identity: ResolvedIdentity; snapshot: PackageSnapshot; action: "include" | "reuse" };
export type Resolution = { packages: readonly ResolvedPackage[] };
const failure = (code: ContractIssue["code"], at = "$"): ContractResult<never> => ({ ok: false, issues: [{ code, at }] });
const key = (parts: readonly string[]): string => JSON.stringify(parts);
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const logicalKey = (i: ResolvedIdentity): string => key([i.catalogId, i.sourceId, i.name, i.version]);
function contentIdentityKey(i: ResolvedIdentity): string {
  return key([i.catalogId, i.sourceId, i.name, i.version, i.kind, i.packageCommit, i.path, i.digest]);
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

/** Direct-module test seam: exact digest-covered packages cannot form finite cryptographic cycle fixtures.
 * Caller supplies canonical root/adjacency order; opaque identity IDs are never re-sorted here.
 * This is the sole production ordering/cycle/depth traversal; it is not a workspace public API. */
export function orderDependencyGraph(roots: readonly string[], dependencies: ReadonlyMap<string, readonly string[]>): ContractResult<readonly string[]> {
  if (dependencies.size > CATALOG_LIMITS.resolvedPackages) return failure("LIMIT_EXCEEDED", "packages");
  const visiting = new Set<string>();
  const heights = new Map<string, number>();
  const ordered: string[] = [];
  function visit(id: string, depth: number): ContractResult<number> {
    if (visiting.has(id)) return failure("CYCLE", "dependencies");
    if (depth > CATALOG_LIMITS.recursionDepth) return failure("LIMIT_EXCEEDED", "dependencies");
    const completed = heights.get(id);
    if (completed !== undefined) return depth + completed > CATALOG_LIMITS.recursionDepth
      ? failure("LIMIT_EXCEEDED", "dependencies") : { ok: true, value: completed };
    const edges = dependencies.get(id);
    if (!edges) return failure("MISSING_RELEASE", "dependencies");
    visiting.add(id);
    let height = 0;
    for (const child of edges) {
      const result = visit(child, depth + 1);
      if (!result.ok) return result;
      height = Math.max(height, result.value + 1);
    }
    visiting.delete(id); heights.set(id, height); ordered.push(id);
    if (ordered.length > CATALOG_LIMITS.resolvedPackages) return failure("LIMIT_EXCEEDED", "packages");
    return { ok: true, value: height };
  }
  for (const root of roots) { const result = visit(root, 0); if (!result.ok) return result; }
  return { ok: true, value: ordered };
}

const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
function fields(v: unknown, required: readonly string[], optional: readonly string[] = []): v is Record<string, unknown> {
  return record(v) && required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => required.includes(k) || optional.includes(k));
}
function strings(v: unknown): v is string[] { return Array.isArray(v) && v.every(x => typeof x === "string"); }
function uniqueStrings(v: readonly string[]): boolean { return new Set(v).size === v.length; }

// All values here have passed descriptor-based JSON validation. Preflight every encoded length
// before any schema traversal, decoding, hashing, or source/package lookup (including unused data).
function preflight(value: unknown): ContractResult<ResolveInput> {
  const json = validateCatalogJson(value, CATALOG_LIMITS.resolverJsonBytes);
  if (!json.ok) return json;
  if (!fields(value, ["roots", "catalogs", "packages", "allowedSourceIds", "target", "installedSkills", "knownReleases"])) return failure("INVALID_JSON");
  for (const [field, max] of [
    ["roots", 64], ["catalogs", CATALOG_LIMITS.suppliedCatalogs], ["packages", CATALOG_LIMITS.suppliedPackages],
    ["allowedSourceIds", 128], ["installedSkills", CATALOG_LIMITS.installedSkills], ["knownReleases", 4096],
  ] as const) {
    if (!Array.isArray(value[field])) return failure("INVALID_JSON", field);
    if (value[field].length > max) return failure("LIMIT_EXCEEDED", field);
  }
  if (!fields(value.target, ["orgopsVersion", "platform", "tools"]) || !Array.isArray(value.target.tools)) return failure("INVALID_JSON", "target");
  if (value.target.tools.length > 64) return failure("LIMIT_EXCEEDED", "target.tools");
  const packages = value.packages as unknown[];
  let total = 0;
  for (const p of packages) {
    if (!fields(p, ["sourceId", "commit", "path", "snapshot"]) || !fields(p.snapshot, ["manifest", "files", "execution", "warnings"])
      || !Array.isArray(p.snapshot.files)) return failure("INVALID_JSON", "packages");
    if (p.snapshot.files.length > CATALOG_LIMITS.contentEntries) return failure("LIMIT_EXCEEDED", "packages.snapshot.files");
    const manifestJson = validateCatalogJson(p.snapshot.manifest, CATALOG_LIMITS.manifestJsonBytes);
    if (!manifestJson.ok) return manifestJson;
    const filesJson = validateCatalogJson(p.snapshot.files, CATALOG_LIMITS.contentJsonBytes);
    if (!filesJson.ok) return filesJson;
    let packageBytes = 0;
    for (const f of p.snapshot.files) {
      if (!record(f) || typeof f.base64 !== "string") return failure("INVALID_JSON", "packages.snapshot.files");
      const size = Math.max(0, Math.floor(f.base64.length / 4) * 3 - (f.base64.endsWith("==") ? 2 : f.base64.endsWith("=") ? 1 : 0));
      if (f.base64.length > Math.ceil(CATALOG_LIMITS.fileBytes / 3) * 4 || size > CATALOG_LIMITS.fileBytes) return failure("LIMIT_EXCEEDED", "packages.snapshot.files");
      packageBytes += size; total += size;
      if (packageBytes > CATALOG_LIMITS.totalContentBytes || total > CATALOG_LIMITS.resolverContentBytes) return failure("LIMIT_EXCEEDED", "packages.snapshot.files");
    }
  }
  for (const c of value.catalogs as unknown[]) {
    if (!fields(c, ["catalogId", "sourceId", "commit", "enabled", "index"])) return failure("INVALID_JSON", "catalogs");
    const indexJson = validateCatalogJson(c.index, CATALOG_LIMITS.indexJsonBytes);
    if (!indexJson.ok) return indexJson;
    if (!fields(c.index, ["formatVersion", "entries"]) || !Array.isArray(c.index.entries)) return failure("INVALID_INDEX", "catalogs.index");
    if (c.index.entries.length > CATALOG_LIMITS.indexEntries) return failure("LIMIT_EXCEEDED", "catalogs.index.entries");
  }
  // Shape validation does not grant authority: manifests/content and indexes are inspected only
  // after their configured source policy passes. Supplied preview values never become output.
  for (const p of packages) {
    if (!record(p) || !record(p.snapshot)) return failure("INVALID_JSON", "packages");
    if (!SourceIdSchema.safeParse(p.sourceId).success || !CommitSchema.safeParse(p.commit).success) return failure("INVALID_JSON", "packages");
    if (!RelativePathSchema.safeParse(p.path).success) return failure("UNSAFE_PATH", "packages.path");
    for (const f of p.snapshot.files as unknown[]) {
      if (!fields(f, ["path", "base64", "executable", "size", "digest"]) || !RelativePathSchema.safeParse(f.path).success
        || typeof f.executable !== "boolean" || typeof f.size !== "number" || !Number.isSafeInteger(f.size) || f.size < 0
        || f.size > CATALOG_LIMITS.fileBytes || !DigestSchema.safeParse(f.digest).success) return failure("INVALID_JSON", "packages.snapshot.files");
    }
    const e = p.snapshot.execution;
    if (!fields(e, ["apiEventShapes", "runnerScripts", "wrappedCommands", "externalSources"])
      || !strings(e.apiEventShapes) || !strings(e.runnerScripts) || !Array.isArray(e.wrappedCommands) || !Array.isArray(e.externalSources)
      || !Array.isArray(p.snapshot.warnings)) return failure("INVALID_JSON", "packages.snapshot.execution");
    if (e.apiEventShapes.length > 256 || e.runnerScripts.length > 256 || e.wrappedCommands.length > 35
      || e.externalSources.length > 1) return failure("LIMIT_EXCEEDED", "packages.snapshot.execution");
    for (const c of e.wrappedCommands) if (!fields(c, ["at", "command", "args"]) || typeof c.at !== "string"
      || typeof c.command !== "string" || c.command.length < 1 || c.command.length > 16384 || !strings(c.args)
      || c.args.length > 128 || c.args.some(a => a.length > 4096)) return failure("INVALID_JSON", "packages.snapshot.execution");
    for (const s of e.externalSources) if (!fields(s, ["type", "repo"], ["ref"]) || s.type !== "github" || typeof s.repo !== "string"
      || (s.ref !== undefined && typeof s.ref !== "string")) return failure("INVALID_JSON", "packages.snapshot.execution");
    for (const w of p.snapshot.warnings) if (!fields(w, ["code", "at"]) || typeof w.at !== "string"
      || typeof w.code !== "string" || !["SENSITIVE_TEXT", "MANUAL_REVIEW_REQUIRED", "EXTERNAL_RUNTIME_NOT_PINNED"].includes(w.code)) return failure("INVALID_JSON", "packages.snapshot.warnings");
  }
  for (const c of value.catalogs as unknown[]) {
    if (!record(c) || !CatalogIdSchema.safeParse(c.catalogId).success || !SourceIdSchema.safeParse(c.sourceId).success
      || !CommitSchema.safeParse(c.commit).success || typeof c.enabled !== "boolean") return failure("INVALID_JSON", "catalogs");
  }
  for (const r of value.roots as unknown[]) if (!fields(r, ["catalogId", "name", "version"]) || !CatalogIdSchema.safeParse(r.catalogId).success
    || !PackageNameSchema.safeParse(r.name).success || !VersionSchema.safeParse(r.version).success) return failure("INVALID_JSON", "roots");
  if (!(value.roots as unknown[]).length) return failure("INVALID_JSON", "roots");
  if (!strings(value.allowedSourceIds) || !uniqueStrings(value.allowedSourceIds) || value.allowedSourceIds.some(s => !SourceIdSchema.safeParse(s).success)) return failure("INVALID_JSON", "allowedSourceIds");
  if (!VersionSchema.safeParse(value.target.orgopsVersion).success || typeof value.target.platform !== "string" || !["linux", "darwin", "win32"].includes(value.target.platform)
    || !strings(value.target.tools) || !uniqueStrings(value.target.tools) || value.target.tools.some(t => !PackageNameSchema.safeParse(t).success)) return failure("INVALID_JSON", "target");
  for (const s of value.installedSkills as unknown[]) {
    if (!fields(s, ["name", "identity", "currentDigest"]) || !PackageNameSchema.safeParse(s.name).success || !DigestSchema.safeParse(s.currentDigest).success) return failure("INVALID_JSON", "installedSkills");
    if (s.identity !== null) {
      const identity = ResolvedIdentitySchema.safeParse(s.identity);
      if (!identity.success || identity.data.kind !== "skill" || identity.data.name !== s.name) return failure("IDENTITY_CONFLICT", "installedSkills.identity");
    }
  }
  for (const i of value.knownReleases as unknown[]) if (!ResolvedIdentitySchema.safeParse(i).success) return failure("INVALID_JSON", "knownReleases");
  return { ok: true, value: value as ResolveInput };
}

function versionCompare(a: string, b: string): number {
  const left = a.split(".").map(Number), right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i]! - right[i]!;
  return 0;
}
function compatibility(snapshot: PackageSnapshot, target: ResolveInput["target"]): ContractResult<true> {
  const c = snapshot.manifest.compatibility;
  if (versionCompare(target.orgopsVersion, c.orgops.min) < 0) return failure("INCOMPATIBLE", "compatibility.orgops.min");
  if (c.orgops.maxExclusive !== undefined && versionCompare(target.orgopsVersion, c.orgops.maxExclusive) >= 0) return failure("INCOMPATIBLE", "compatibility.orgops.maxExclusive");
  if (!c.platforms.includes(target.platform)) return failure("INCOMPATIBLE", "compatibility.platforms");
  if (c.tools.some(tool => !target.tools.includes(tool))) return failure("INCOMPATIBLE", "compatibility.tools");
  return { ok: true, value: true };
}
function resolveDependencyCommit(pin: DependencyPin, declaring: ResolvedIdentity): ContractResult<string> {
  if (pin.revision.type === "exact") return { ok: true, value: pin.revision.commit };
  return pin.sourceId === declaring.sourceId ? { ok: true, value: declaring.packageCommit } : failure("UNSUPPORTED_DEPENDENCY", "dependencies.revision");
}

export function resolvePackages(input: ResolveInput): ContractResult<Resolution> {
  const checked = preflight(input);
  if (!checked.ok) return checked;
  const v = checked.value;
  const allowed = new Set(v.allowedSourceIds);
  const catalogs = new Map<string, CatalogSnapshot>();
  const supplied = new Map<string, SuppliedPackage>();
  const installed = new Map<string, InstalledSkill>();
  const known = new Map<string, string>();
  const rootKeys = new Set<string>();
  for (const c of v.catalogs) { if (catalogs.has(c.catalogId)) return failure("IDENTITY_CONFLICT", "catalogs"); catalogs.set(c.catalogId, c); }
  for (const p of v.packages) {
    const id = key([p.sourceId, p.commit, p.path]);
    if (supplied.has(id)) return failure("IDENTITY_CONFLICT", "packages"); supplied.set(id, p);
  }
  for (const s of v.installedSkills) { if (installed.has(s.name)) return failure("IDENTITY_CONFLICT", "installedSkills"); installed.set(s.name, s); }
  for (const i of v.knownReleases) {
    if (known.has(logicalKey(i))) return failure("IDENTITY_CONFLICT", "knownReleases"); known.set(logicalKey(i), contentIdentityKey(i));
  }
  for (const r of v.roots) {
    const id = key([r.catalogId, r.name, r.version]);
    if (rootKeys.has(id)) return failure("IDENTITY_CONFLICT", "roots"); rootKeys.add(id);
  }
  const indexes = new Map<string, Map<string, CatalogEntry>>();
  const nodes = new Map<string, ResolvedPackage>();
  const names = new Map<string, string>();
  const releases = new Map<string, string>();
  const queue: string[] = [];
  const graph = new Map<string, readonly string[]>();
  function select(request: ResolveInput["roots"][number], pin?: DependencyPin, declaring?: ResolvedIdentity): ContractResult<string> {
    let expectedCommit: string | undefined;
    if (pin && declaring) {
      const expanded = resolveDependencyCommit(pin, declaring);
      if (!expanded.ok) return expanded;
      expectedCommit = expanded.value;
    }
    const catalog = catalogs.get(request.catalogId);
    if (!catalog || !catalog.enabled || !allowed.has(catalog.sourceId)) return failure("SOURCE_NOT_ALLOWED", "catalogs");
    if (pin && !allowed.has(pin.sourceId)) return failure("SOURCE_NOT_ALLOWED", "dependencies.sourceId");
    let entries = indexes.get(catalog.catalogId);
    if (!entries) {
      const parsed = validateCatalogIndex(catalog.index);
      if (!parsed.ok) return parsed;
      entries = new Map();
      const locations = new Set<string>();
      for (const e of parsed.value.entries) {
        const l = e.location;
        const location = key(l.type === "source" ? [l.sourceId, l.commit, l.path]
          : [catalog.sourceId, l.revision.type === "exact" ? l.revision.commit : catalog.commit, l.path]);
        if (locations.has(location)) return failure("IDENTITY_CONFLICT", "catalogs.index.entries"); locations.add(location);
        entries.set(key([e.name, e.version]), e);
      }
      indexes.set(catalog.catalogId, entries);
    }
    const entry = entries.get(key([request.name, request.version]));
    if (!entry) return failure("MISSING_RELEASE", "catalogs.index.entries");
    const location = entry.location;
    const sourceId = location.type === "source" ? location.sourceId : catalog.sourceId;
    if (!allowed.has(sourceId)) return failure("SOURCE_NOT_ALLOWED", "catalogs.index.entries.location.sourceId");
    const packageCommit = location.type === "source" ? location.commit : location.revision.type === "exact" ? location.revision.commit : catalog.commit;
    const identity: ResolvedIdentity = { catalogId: catalog.catalogId, catalogCommit: catalog.commit, sourceId, packageCommit,
      path: location.path, kind: entry.kind, name: entry.name, version: entry.version, digest: entry.digest };
    const id = contentIdentityKey(identity), logical = logicalKey(identity);
    if (pin && (pin.sourceId !== sourceId || expectedCommit !== packageCommit || pin.digest !== entry.digest)) return failure("IDENTITY_CONFLICT", "dependencies");
    const previous = known.get(logical) ?? releases.get(logical);
    if (previous !== undefined && previous !== id) return failure("IDENTITY_CONFLICT", "identity");
    if (pin && entry.kind !== "skill") return failure("UNSUPPORTED_DEPENDENCY", "dependencies");
    if (nodes.has(id)) return { ok: true, value: id };
    if (nodes.size >= CATALOG_LIMITS.resolvedPackages) return failure("LIMIT_EXCEEDED", "packages");
    const bytes = supplied.get(key([sourceId, packageCommit, location.path]));
    if (!bytes) return failure("MISSING_RELEASE", "packages");
    const inspected = inspectPackage(bytes.snapshot.manifest, bytes.snapshot.files.map(f => ({ type: "file", path: f.path, base64: f.base64, executable: f.executable })));
    if (!inspected.ok) return inspected;
    const snapshot = inspected.value, m = snapshot.manifest;
    const claims = new Map(bytes.snapshot.files.map(f => [f.path, f]));
    if (snapshot.files.some(f => { const claim = claims.get(f.path); return !claim || claim.size !== f.size || claim.digest !== f.digest; })) return failure("INVENTORY_MISMATCH", "packages.snapshot.files");
    if (m.kind !== entry.kind || m.name !== entry.name || m.version !== entry.version || m.digest !== entry.digest) return failure("IDENTITY_CONFLICT", "packages.snapshot.manifest");
    const compatible = compatibility(snapshot, v.target);
    if (!compatible.ok) return compatible;
    let action: ResolvedPackage["action"] = "include";
    if (m.kind === "skill") {
      const other = names.get(m.name), local = installed.get(m.name);
      if (other !== undefined && other !== id) return failure("SKILL_CONFLICT", "installedSkills");
      if (local) {
        if (local.identity === null || contentIdentityKey(local.identity) !== id || local.currentDigest !== m.digest) return failure("SKILL_CONFLICT", "installedSkills");
        action = "reuse";
      }
      names.set(m.name, id);
    }
    releases.set(logical, id); nodes.set(id, { identity, snapshot, action }); queue.push(id);
    return { ok: true, value: id };
  }
  const roots: string[] = [];
  for (const r of [...v.roots].sort((a, b) => compare(a.catalogId, b.catalogId) || compare(a.name, b.name) || compare(a.version, b.version))) {
    const selected = select(r); if (!selected.ok) return selected; roots.push(selected.value);
  }
  // Iterative expansion only. Repeated immutable nodes enter this queue once, including diamonds.
  for (let next = 0; next < queue.length; next++) {
    const id = queue[next]!, node = nodes.get(id)!;
    const edges: string[] = [];
    for (const pin of [...node.snapshot.manifest.dependencies].sort((a, b) => compare(a.catalogId, b.catalogId) || compare(a.sourceId, b.sourceId) || compare(a.name, b.name))) {
      const selected = select({ catalogId: pin.catalogId, name: pin.name, version: pin.version }, pin, node.identity);
      if (!selected.ok) return selected; edges.push(selected.value);
    }
    graph.set(id, edges);
  }
  const ordered = orderDependencyGraph(roots, graph);
  if (!ordered.ok) return ordered;
  return { ok: true, value: freeze({ packages: ordered.value.map(id => nodes.get(id)!) }) };
}
