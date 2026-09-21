import { createHash } from "node:crypto";
import { CATALOG_LIMITS, validateCatalogJson, GitRepositorySchema, SourceIdSchema, CatalogIdSchema, CommitSchema, DigestSchema, RelativePathSchema, VersionSchema, PackageNameSchema, ResolvedIdentitySchema, validateCatalogIndex, type CatalogIndex, type ResolvedIdentity, } from "@orgops/schemas";
import { publicationFailure as failure, publicationFields as fields, publicationCompare as compare, publicationFreeze as freeze, preflightPublicationBytes, preflightPublicationCandidate, preflightPublicationSnapshot, inspectPublicationSnapshot, validatePublicationCandidate, decodePublicationBytes, } from "./publication-content";
import { PUBLICATION_LIMITS as L, type PublicationInput, type PublicationResult, type PublicationPreconditions, type PublicationTreeEntry } from "./publication-types";
export type ValidatedPublication = {
    input: PublicationInput;
    baseIndex: CatalogIndex;
    preconditions: PublicationPreconditions;
};
const key = (parts: readonly string[]): string => JSON.stringify(parts);
const immutable = (i: ResolvedIdentity): string => key([i.catalogId, i.sourceId, i.name, i.version, i.kind, i.packageCommit, i.path, i.digest]);
const releaseKey = (i: ResolvedIdentity): string => key([i.catalogId, i.name, i.version]);
const identityOrder = (a: ResolvedIdentity, b: ResolvedIdentity): number => compare(a.catalogId, b.catalogId) || compare(a.sourceId, b.sourceId) || compare(a.name, b.name) || compare(a.version, b.version) || compare(a.packageCommit, b.packageCommit) || compare(a.path, b.path) || compare(a.catalogCommit, b.catalogCommit);
const overlap = (a: string, b: string): boolean => { a = a.toLowerCase(); b = b.toLowerCase(); return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`); };
const ancestors = (path: string): string[] => { const parts = path.split("/"); return parts.slice(1).map((_, i) => parts.slice(0, i + 1).join("/")); };
function validate(input: PublicationInput): PublicationResult<ValidatedPublication> {
    const json = validateCatalogJson(input, L.inputJsonBytes);
    if (!json.ok)
        return json;
    const raw: unknown = input;
    if (!fields(raw, ["base", "selections", "sources", "catalogs", "packages", "knownReleases", "target"]))
        return failure();
    if (!fields(raw.base, ["catalogId", "sourceId", "repository", "enabled", "commit", "indexPath", "indexBase64", "inventory", "history"]))
        return failure("BASE_EVIDENCE_REQUIRED", "base");
    const base = raw.base;
    if (!fields(base.inventory, ["complete", "entries"]) || base.inventory.complete !== true || !Array.isArray(base.inventory.entries))
        return failure("BASE_EVIDENCE_REQUIRED", "base.inventory");
    if (!fields(base.history, ["complete", "releases"]) || base.history.complete !== true || !Array.isArray(base.history.releases))
        return failure("BASE_EVIDENCE_REQUIRED", "base.history");
    for (const [field, max] of [["selections", L.selections], ["sources", L.sources], ["catalogs", L.catalogs], ["packages", L.suppliedPackages], ["knownReleases", L.knownReleases]] as const) {
        if (!Array.isArray(raw[field]))
            return failure("INVALID_PUBLICATION_INPUT", field);
        if (raw[field].length > max)
            return failure("LIMIT_EXCEEDED", field);
    }
    if (input.selections.length === 0)
        return failure("INVALID_PUBLICATION_INPUT", "selections");
    if (base.inventory.entries.length > L.treeEntries)
        return failure("LIMIT_EXCEEDED", "base.inventory");
    if (base.history.releases.length + input.knownReleases.length > L.knownReleases)
        return failure("LIMIT_EXCEEDED", "base.history");
    const budget = { files: 0, bytes: 0 };
    if (base.indexBase64 !== null) {
        const p = preflightPublicationBytes(base.indexBase64, CATALOG_LIMITS.indexJsonBytes, budget, "base.indexBase64");
        if (!p.ok)
            return p;
    }
    for (const s of input.selections) {
        if (!fields(s, ["destinationPath", "candidate", "intent", "origin"]))
            return failure("INVALID_PUBLICATION_INPUT", "selections");
        const p = preflightPublicationCandidate(s.candidate, budget, "selections.candidate");
        if (!p.ok)
            return p;
    }
    for (const p of input.packages) {
        if (!fields(p, ["sourceId", "commit", "path", "snapshot"]))
            return failure("INVALID_PUBLICATION_INPUT", "packages");
        const checked = preflightPublicationSnapshot(p.snapshot, budget, "packages.snapshot");
        if (!checked.ok)
            return checked;
    }
    let totalEntries = 0;
    for (const c of input.catalogs) {
        if (!fields(c, ["catalogId", "sourceId", "commit", "enabled", "index"]) || !fields(c.index, ["formatVersion", "entries"]) || !Array.isArray(c.index.entries))
            return failure("INVALID_PUBLICATION_INPUT", "catalogs");
        totalEntries += c.index.entries.length;
        if (c.index.entries.length > CATALOG_LIMITS.indexEntries || totalEntries > L.totalIndexEntries)
            return failure("LIMIT_EXCEEDED", "catalogs.index");
    }
    // Only the bounded lexical old index may be decoded here: its entry count is
    // otherwise unknowable. No hash, full schema, or package work precedes this count.
    let indexBytes: Buffer | null = null;
    let indexValue: unknown = { formatVersion: 1, entries: [] };
    if (input.base.indexBase64 !== null) {
        const decoded = decodePublicationBytes(input.base.indexBase64, CATALOG_LIMITS.indexJsonBytes);
        if (!decoded.ok)
            return failure(decoded.issues[0]!.code, "base.indexBase64");
        indexBytes = decoded.value;
        try {
            indexValue = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(indexBytes));
        }
        catch {
            return failure("INVALID_INDEX", "base.indexBase64");
        }
        if (!fields(indexValue, ["formatVersion", "entries"]) || !Array.isArray(indexValue.entries))
            return failure("INVALID_INDEX", "base.indexBase64");
        if (indexValue.entries.length > CATALOG_LIMITS.indexEntries || totalEntries + indexValue.entries.length > L.totalIndexEntries)
            return failure("LIMIT_EXCEEDED", "catalogs.index");
    }
    if (!CatalogIdSchema.safeParse(base.catalogId).success || !SourceIdSchema.safeParse(base.sourceId).success || !CommitSchema.safeParse(base.commit).success || typeof base.enabled !== "boolean")
        return failure("INVALID_PUBLICATION_INPUT", "base");
    if (!RelativePathSchema.safeParse(base.indexPath).success)
        return failure("UNSAFE_PATH", "base.indexPath");
    if (base.enabled !== true)
        return failure("SOURCE_NOT_ALLOWED", "base.enabled");
    const repo = GitRepositorySchema.safeParse(base.repository);
    if (!repo.success)
        return failure("INVALID_PUBLICATION_INPUT", "base.repository");
    const repositoryKey = (r: typeof repo.data): string => JSON.stringify([r.url, r.sshUser ?? null]);
    const sourceIds = new Set<string>(), repositories = new Set<string>();
    const v = structuredClone(input);
    v.base.repository = repo.data;
    const sources = [];
    for (const s of v.sources) {
        if (!fields(s, ["sourceId", "repository", "enabled", "allowPackages"]) || !SourceIdSchema.safeParse(s.sourceId).success || typeof s.enabled !== "boolean" || typeof s.allowPackages !== "boolean")
            return failure("INVALID_PUBLICATION_INPUT", "sources");
        const r = GitRepositorySchema.safeParse(s.repository);
        if (!r.success)
            return failure("INVALID_PUBLICATION_INPUT", "sources.repository");
        if (sourceIds.has(s.sourceId) || repositories.has(repositoryKey(r.data)))
            return failure("IDENTITY_CONFLICT", "sources");
        sourceIds.add(s.sourceId);
        repositories.add(repositoryKey(r.data));
        sources.push({ ...s, repository: r.data });
    }
    v.sources = sources.sort((a, b) => compare(a.sourceId, b.sourceId));
    const owner = v.sources.find(s => s.sourceId === v.base.sourceId);
    if (!owner || !owner.enabled)
        return failure("SOURCE_NOT_ALLOWED", "base.sourceId");
    if (repositoryKey(owner.repository) !== repositoryKey(repo.data))
        return failure("BASE_CONFLICT", "base.repository");
    const catalogs = new Set([v.base.catalogId]);
    for (const c of v.catalogs) {
        if (!CatalogIdSchema.safeParse(c.catalogId).success || !SourceIdSchema.safeParse(c.sourceId).success || !CommitSchema.safeParse(c.commit).success || typeof c.enabled !== "boolean")
            return failure("INVALID_PUBLICATION_INPUT", "catalogs");
        if (catalogs.has(c.catalogId) || !sourceIds.has(c.sourceId))
            return failure("IDENTITY_CONFLICT", "catalogs");
        catalogs.add(c.catalogId);
        const parsed = validateCatalogIndex(c.index);
        if (!parsed.ok)
            return parsed;
        c.index = parsed.value;
        c.index.entries.sort((a, b) => compare(a.name, b.name) || compare(a.version, b.version));
    }
    if (!fields(v.target, ["orgopsVersion", "platform", "tools"]) || !VersionSchema.safeParse(v.target.orgopsVersion).success || !["linux", "darwin", "win32"].includes(v.target.platform) || !Array.isArray(v.target.tools) || v.target.tools.length > 64 || v.target.tools.some(t => !PackageNameSchema.safeParse(t).success) || new Set(v.target.tools).size !== v.target.tools.length)
        return failure("INVALID_PUBLICATION_INPUT", "target");
    v.target.tools.sort();
    const tree = new Map<string, PublicationTreeEntry>(), folded = new Set<string>();
    for (const e of v.base.inventory.entries) {
        if (!fields(e, e.type === "file" ? ["type", "path", "size", "digest", "executable"] : ["type", "path"]) || !["directory", "file", "blocked"].includes(e.type))
            return failure("INVALID_PUBLICATION_INPUT", "base.inventory.entries");
        if (!RelativePathSchema.safeParse(e.path).success)
            return failure("UNSAFE_PATH", "base.inventory.entries");
        if (e.type === "file" && (!Number.isSafeInteger(e.size) || e.size < 0 || !DigestSchema.safeParse(e.digest).success || typeof e.executable !== "boolean"))
            return failure("INVALID_PUBLICATION_INPUT", "base.inventory.entries");
        if (folded.has(e.path.toLowerCase()))
            return failure("BASE_CONFLICT", "base.inventory.entries");
        tree.set(e.path, e);
        folded.add(e.path.toLowerCase());
    }
    for (const e of tree.values())
        if (ancestors(e.path).some(p => tree.get(p)?.type !== "directory"))
            return failure("BASE_CONFLICT", "base.inventory.entries");
    const indexPath = v.base.indexPath, indexFile = tree.get(indexPath);
    let oldIndex: PublicationPreconditions["oldIndex"] = null;
    let baseIndex: CatalogIndex = { formatVersion: 1, entries: [] };
    if (v.base.indexBase64 === null) {
        if ([...tree.values()].some(e => e.path.toLowerCase() === indexPath.toLowerCase() || e.path.toLowerCase().startsWith(`${indexPath.toLowerCase()}/`) || (e.type !== "directory" && indexPath.toLowerCase().startsWith(`${e.path.toLowerCase()}/`))) || ancestors(indexPath).some(p => folded.has(p.toLowerCase()) && !tree.has(p)))
            return failure("BASE_CONFLICT", "base.indexBase64");
    }
    else {
        if (!indexBytes)
            return failure("BASE_EVIDENCE_REQUIRED", "base.indexBase64");
        const parsed = validateCatalogIndex(indexValue);
        if (!parsed.ok)
            return failure(parsed.issues[0]!.code, "base.indexBase64");
        const measured = { base64: v.base.indexBase64, size: indexBytes.length,
            digest: `sha256:${createHash("sha256").update(indexBytes).digest("hex")}`, executable: false };
        if (!indexFile || indexFile.type !== "file" || indexFile.executable || indexFile.size !== measured.size || indexFile.digest !== measured.digest)
            return failure("BASE_CONFLICT", "base.indexBase64");
        oldIndex = measured;
        baseIndex = parsed.value;
    }
    baseIndex.entries.sort((a, b) => compare(a.name, b.name) || compare(a.version, b.version));
    const history = new Map<string, ResolvedIdentity>();
    for (const [list, at, isBase] of [[v.base.history.releases, "base.history", true], [v.knownReleases, "knownReleases", false]] as const) {
        const seen = new Set<string>();
        for (const i of list) {
            if (!ResolvedIdentitySchema.safeParse(i).success || (i.catalogId === v.base.catalogId) !== isBase || !sourceIds.has(i.sourceId))
                return failure("INVALID_PUBLICATION_INPUT", at);
            const k = releaseKey(i), previous = history.get(k);
            if (seen.has(k) || (previous && immutable(previous) !== immutable(i)))
                return failure("IDENTITY_CONFLICT", at);
            seen.add(k);
            history.set(k, i);
        }
    }
    const preserved: ResolvedIdentity[] = [], locations = new Set<string>();
    for (const e of baseIndex.entries) {
        const l = e.location;
        const i: ResolvedIdentity = { catalogId: v.base.catalogId, catalogCommit: v.base.commit, sourceId: l.type === "source" ? l.sourceId : v.base.sourceId, packageCommit: l.type === "source" ? l.commit : l.revision.type === "exact" ? l.revision.commit : v.base.commit, path: l.path, kind: e.kind, name: e.name, version: e.version, digest: e.digest };
        if (!sourceIds.has(i.sourceId))
            return failure("IDENTITY_CONFLICT", "base.indexBase64");
        const previous = history.get(releaseKey(i));
        if (previous && immutable(previous) !== immutable(i))
            return failure("IDENTITY_CONFLICT", "base.history");
        const location = key([i.sourceId, i.packageCommit, i.path]);
        if (locations.has(location))
            return failure("IDENTITY_CONFLICT", "base.indexBase64");
        locations.add(location);
        preserved.push(i);
    }
    const regions = [...preserved, ...v.base.history.releases, ...v.knownReleases].filter(i => i.sourceId === v.base.sourceId).map(i => i.path);
    if (regions.some(p => overlap(p, indexPath)))
        return failure("DESTINATION_CONFLICT", "base.indexPath");
    const selectedPaths: string[] = [];
    for (const s of v.selections) {
        if (!RelativePathSchema.safeParse(s.destinationPath).success)
            return failure("UNSAFE_PATH", "selections.destinationPath");
        if (!["new-release", "update", "new-destination"].includes(s.intent) || (s.origin !== null && !ResolvedIdentitySchema.safeParse(s.origin).success))
            return failure("INVALID_PUBLICATION_INPUT", "selections");
        if (overlap(s.destinationPath, indexPath) || selectedPaths.some(p => overlap(p, s.destinationPath)))
            return failure("DESTINATION_CONFLICT", "selections.destinationPath");
        if (ancestors(s.destinationPath).some(p => folded.has(p.toLowerCase()) && tree.get(p)?.type !== "directory"))
            return failure("DESTINATION_CONFLICT", "selections.destinationPath");
        selectedPaths.push(s.destinationPath);
        for (const f of s.candidate.proposedFiles)
            if (!RelativePathSchema.safeParse(`${s.destinationPath}/${f.path}`).success)
                return failure("UNSAFE_PATH", "selections.destinationPath");
        const candidate = validatePublicationCandidate(s.candidate);
        if (!candidate.ok)
            return candidate;
        s.candidate = candidate.value;
        if (s.intent === "new-release") {
            if (s.origin !== null)
                return failure("ORIGIN_CONFLICT", "selections.origin");
        }
        else {
            const origin = s.origin, known = origin && history.get(releaseKey(origin));
            if (!origin || !known || immutable(known) !== immutable(origin))
                return failure("ORIGIN_CONFLICT", "selections.origin");
            const same = origin.catalogId === v.base.catalogId && origin.sourceId === v.base.sourceId && origin.name === s.candidate.snapshot.manifest.name;
            if ((s.intent === "update") !== same)
                return failure("ORIGIN_CONFLICT", "selections.origin");
        }
    }
    const packageKeys = new Set<string>();
    for (const p of v.packages) {
        if (!SourceIdSchema.safeParse(p.sourceId).success || !sourceIds.has(p.sourceId) || !CommitSchema.safeParse(p.commit).success || !RelativePathSchema.safeParse(p.path).success)
            return failure("INVALID_PUBLICATION_INPUT", "packages");
        const k = key([p.sourceId, p.commit, p.path]);
        if (packageKeys.has(k))
            return failure("IDENTITY_CONFLICT", "packages");
        packageKeys.add(k);
        const inspected = inspectPublicationSnapshot(p.snapshot);
        if (!inspected.ok)
            return inspected;
        p.snapshot = inspected.value;
    }
    v.base.inventory.entries = [...tree.values()].sort((a, b) => compare(a.path, b.path));
    v.base.history.releases = [...v.base.history.releases].sort(identityOrder);
    v.knownReleases = [...v.knownReleases].sort(identityOrder);
    v.catalogs = [...v.catalogs].sort((a, b) => compare(a.catalogId, b.catalogId));
    v.packages = [...v.packages].sort((a, b) => compare(a.sourceId, b.sourceId) || compare(a.commit, b.commit) || compare(a.path, b.path));
    v.selections = [...v.selections].sort((a, b) => compare(a.candidate.snapshot.manifest.name, b.candidate.snapshot.manifest.name) || compare(a.candidate.snapshot.manifest.version, b.candidate.snapshot.manifest.version) || compare(a.destinationPath, b.destinationPath));
    const preconditions: PublicationPreconditions = { repository: v.base.repository, sourceId: v.base.sourceId, catalogId: v.base.catalogId, catalogEnabled: true, baseCommit: v.base.commit, indexPath, oldIndex, inventory: v.base.inventory, history: v.base.history, sources: v.sources, target: v.target, dependencyCatalogs: v.catalogs, knownReleases: v.knownReleases, requiredAbsentPaths: [], preservedReleases: preserved.sort(identityOrder) };
    return { ok: true, value: freeze({ input: v, baseIndex, preconditions }) };
}
export function validatePublicationInput(input: PublicationInput): PublicationResult<ValidatedPublication> {
    try {
        return validate(input);
    }
    catch {
        return failure();
    }
}
