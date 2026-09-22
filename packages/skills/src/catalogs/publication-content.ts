import { createHash } from "node:crypto";
import { CATALOG_LIMITS, validateCatalogJson, RelativePathSchema, DigestSchema, type PackageMetadata, } from "@orgops/schemas";
import { inspectPackage, canonicalJson, type PackageSnapshot } from "./content";
import { exportAgentPackage, exportSkillPackage, type ExportCandidate } from "./export";
import { PUBLICATION_LIMITS, type PublicationResult, type PublicationIssue, type PublicationBytes } from "./publication-types";
export const publicationFailure = (code: PublicationIssue["code"] = "INVALID_PUBLICATION_INPUT", at = "$"): PublicationResult<never> => ({ ok: false, issues: [{ code, at }] });
export const publicationCompare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
export function publicationFreeze<T>(value: T): T {
    if (value && typeof value === "object") {
        Object.values(value).forEach(publicationFreeze);
        Object.freeze(value);
    }
    return value;
}
export function publicationFields(v: unknown, required: readonly string[], optional: readonly string[] = []): v is Record<string, unknown> {
    return v !== null && typeof v === "object" && !Array.isArray(v)
        && required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => required.includes(k) || optional.includes(k));
}
// Only descriptor-checked JSON reaches this preflight. Count every occurrence, not unique blobs.
export type PublicationByteBudget = {
    files: number;
    bytes: number;
};
export function preflightPublicationBytes(value: unknown, max: number, budget: PublicationByteBudget, at: string): PublicationResult<true> {
    if (typeof value !== "string")
        return publicationFailure("INVALID_PUBLICATION_INPUT", at);
    const size = Math.max(0, Math.floor(value.length / 4) * 3 - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0));
    budget.files++;
    budget.bytes += size;
    if (value.length > Math.ceil(max / 3) * 4 || size > max || budget.files > PUBLICATION_LIMITS.aggregateFiles || budget.bytes > PUBLICATION_LIMITS.decodedBytes)
        return publicationFailure("LIMIT_EXCEEDED", at);
    return { ok: true, value: true };
}
// Direct-module core: the bounded old-index count preflight must decode without hashing.
export function decodePublicationBytes(base64: string, maxBytes: number): PublicationResult<Buffer> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > CATALOG_LIMITS.indexJsonBytes)
        return publicationFailure();
    const preflight = preflightPublicationBytes(base64, maxBytes, { files: 0, bytes: 0 }, "bytes");
    if (!preflight.ok)
        return preflight;
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))
        return publicationFailure("INVALID_PUBLICATION_INPUT", "bytes");
    const bytes = Buffer.from(base64, "base64");
    if (bytes.toString("base64") !== base64)
        return publicationFailure("INVALID_PUBLICATION_INPUT", "bytes");
    return { ok: true, value: bytes };
}
export function publicationBytes(base64: string, executable: boolean, maxBytes: number): PublicationResult<PublicationBytes> {
    if (typeof executable !== "boolean")
        return publicationFailure();
    const decoded = decodePublicationBytes(base64, maxBytes);
    if (!decoded.ok)
        return decoded;
    return { ok: true, value: publicationFreeze({ base64, executable, size: decoded.value.length, digest: `sha256:${createHash("sha256").update(decoded.value).digest("hex")}` }) };
}
export function preflightPublicationSnapshot(value: unknown, budget: PublicationByteBudget, at: string): PublicationResult<true> {
    if (!publicationFields(value, ["manifest", "files", "execution", "warnings"]) || !Array.isArray(value.files))
        return publicationFailure("INVALID_PUBLICATION_INPUT", at);
    if (value.files.length > CATALOG_LIMITS.contentEntries)
        return publicationFailure("LIMIT_EXCEEDED", at);
    let bytes = 0;
    for (const f of value.files) {
        if (!publicationFields(f, ["path", "base64", "executable", "size", "digest"]))
            return publicationFailure("INVALID_PUBLICATION_INPUT", at);
        const before = budget.bytes;
        const checked = preflightPublicationBytes(f.base64, CATALOG_LIMITS.fileBytes, budget, at);
        if (!checked.ok)
            return checked;
        bytes += budget.bytes - before;
    }
    if (bytes > CATALOG_LIMITS.totalContentBytes)
        return publicationFailure("LIMIT_EXCEEDED", at);
    return { ok: true, value: true };
}
export function preflightPublicationCandidate(value: unknown, budget: PublicationByteBudget, at: string): PublicationResult<true> {
    if (!publicationFields(value, ["snapshot", "proposedFiles"]) || !Array.isArray(value.proposedFiles))
        return publicationFailure("INVALID_PUBLICATION_INPUT", at);
    const snapshot = preflightPublicationSnapshot(value.snapshot, budget, at);
    if (!snapshot.ok)
        return snapshot;
    if (value.proposedFiles.length > CATALOG_LIMITS.contentEntries + 1)
        return publicationFailure("LIMIT_EXCEEDED", at);
    for (const f of value.proposedFiles) {
        if (!publicationFields(f, ["path", "base64", "executable"]))
            return publicationFailure("INVALID_PUBLICATION_INPUT", at);
        const checked = preflightPublicationBytes(f.base64, f.path === "orgops-package.json" ? CATALOG_LIMITS.manifestJsonBytes : CATALOG_LIMITS.fileBytes, budget, at);
        if (!checked.ok)
            return checked;
    }
    return { ok: true, value: true };
}
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === "string");
// Supplied previews are only shape-checked; regenerate their semantics from the actual manifest/bytes.
export function inspectPublicationSnapshot(value: unknown): PublicationResult<PackageSnapshot> {
    if (!publicationFields(value, ["manifest", "files", "execution", "warnings"]) || !Array.isArray(value.files))
        return publicationFailure();
    const e = value.execution;
    if (!publicationFields(e, ["apiEventShapes", "runnerScripts", "wrappedCommands", "externalSources"])
        || !strings(e.apiEventShapes) || !strings(e.runnerScripts) || !Array.isArray(e.wrappedCommands) || !Array.isArray(e.externalSources) || !Array.isArray(value.warnings))
        return publicationFailure();
    if (e.apiEventShapes.length > 256 || e.runnerScripts.length > 256 || e.wrappedCommands.length > 35 || e.externalSources.length > 1 || value.warnings.length > PUBLICATION_LIMITS.findings)
        return publicationFailure("LIMIT_EXCEEDED");
    if ([...e.apiEventShapes, ...e.runnerScripts].some(p => !RelativePathSchema.safeParse(p).success))
        return publicationFailure();
    for (const c of e.wrappedCommands)
        if (!publicationFields(c, ["at", "command", "args"]) || typeof c.at !== "string" || c.at.length > 240 || typeof c.command !== "string" || c.command.length < 1 || c.command.length > 16384 || !strings(c.args) || c.args.length > 128 || c.args.some(a => a.length > 4096))
            return publicationFailure();
    for (const s of e.externalSources)
        if (!publicationFields(s, ["type", "repo"], ["ref"]) || s.type !== "github" || typeof s.repo !== "string" || s.repo.length > 201 || (s.ref !== undefined && (typeof s.ref !== "string" || s.ref.length > 128)))
            return publicationFailure();
    for (const w of value.warnings)
        if (!publicationFields(w, ["code", "at"]) || typeof w.at !== "string" || w.at.length > 1024 || typeof w.code !== "string" || !["SENSITIVE_TEXT", "MANUAL_REVIEW_REQUIRED", "EXTERNAL_RUNTIME_NOT_PINNED"].includes(w.code))
            return publicationFailure();
    for (const f of value.files)
        if (!publicationFields(f, ["path", "base64", "executable", "size", "digest"]) || !RelativePathSchema.safeParse(f.path).success || typeof f.base64 !== "string" || typeof f.executable !== "boolean" || typeof f.size !== "number" || !Number.isSafeInteger(f.size) || f.size < 0 || f.size > CATALOG_LIMITS.fileBytes || !DigestSchema.safeParse(f.digest).success)
            return publicationFailure();
    const snapshot = value as PackageSnapshot;
    const inspected = inspectPackage(snapshot.manifest, snapshot.files.map(f => ({ type: "file", path: f.path, base64: f.base64, executable: f.executable })));
    if (!inspected.ok)
        return inspected;
    const claims = new Map(snapshot.files.map(f => [f.path, f]));
    if (inspected.value.files.some(f => { const c = claims.get(f.path); return !c || c.size !== f.size || c.digest !== f.digest; }))
        return publicationFailure("INVENTORY_MISMATCH", "snapshot.files");
    return inspected;
}
export function validatePublicationCandidate(candidate: ExportCandidate): PublicationResult<ExportCandidate> {
    const json = validateCatalogJson(candidate, PUBLICATION_LIMITS.inputJsonBytes);
    if (!json.ok)
        return json;
    const preflight = preflightPublicationCandidate(candidate, { files: 0, bytes: 0 }, "candidate");
    if (!preflight.ok)
        return preflight;
    const inspected = inspectPublicationSnapshot(candidate.snapshot);
    if (!inspected.ok)
        return inspected;
    const m = inspected.value.manifest;
    const metadata: PackageMetadata = { formatVersion: m.formatVersion, name: m.name, version: m.version, description: m.description, author: m.author, license: m.license, compatibility: m.compatibility, secrets: m.secrets };
    let regenerated: PublicationResult<ExportCandidate>;
    if (m.kind === "skill") {
        regenerated = exportSkillPackage(inspected.value.files.map(f => ({ type: "file", path: f.path, base64: f.base64, executable: f.executable })), { metadata, dependencies: m.dependencies, executables: m.executables, selectedPaths: inspected.value.files.map(f => f.path) });
    }
    else if (m.kind === "native-agent") {
        const n = m.native;
        regenerated = exportAgentPackage({ mode: n.mode, systemInstructions: n.systemInstructions, ...(n.soulContents === undefined ? {} : { soulContents: n.soulContents }), ...n.runtime, enabledSkills: m.dependencies.map(d => d.name), alwaysPreloadedSkills: n.alwaysPreloadedSkills }, { metadata, dependencies: m.dependencies, ...(n.suggestedModel === undefined ? {} : { suggestedModel: n.suggestedModel }) });
    }
    else {
        const { resourceWiring: _wiring, ...wrappedConfig } = m.wrapped;
        regenerated = exportAgentPackage({ mode: "WRAPPED", wrappedConfig }, { metadata, dependencies: m.dependencies });
    }
    if (!regenerated.ok)
        return regenerated;
    if (regenerated.value.snapshot.manifest.digest !== m.digest)
        return publicationFailure("UNSUPPORTED_EXPORT", "candidate.snapshot");
    for (const f of candidate.proposedFiles)
        if (!RelativePathSchema.safeParse(f.path).success || typeof f.executable !== "boolean")
            return publicationFailure("INVALID_PUBLICATION_INPUT", "candidate.proposedFiles");
    const ordered = [...candidate.proposedFiles].sort((a, b) => publicationCompare(a.path, b.path));
    if (canonicalJson(ordered) !== canonicalJson(regenerated.value.proposedFiles))
        return publicationFailure("UNSUPPORTED_EXPORT", "candidate.proposedFiles");
    return regenerated;
}
