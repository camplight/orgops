import { createHash } from "node:crypto";
import {
  CATALOG_LIMITS as C, validateCatalogJson, validateCatalogIndex, validatePackageManifest, parsePackageManifest,
  GitRepositorySchema, SourceIdSchema, CatalogIdSchema, CommitSchema, DigestSchema, RelativePathSchema,
  VersionSchema, PackageNameSchema, ResolvedIdentitySchema, type ResolvedIdentity, type ContractResult,
} from "@orgops/schemas";
import { inspectPackage } from "./content";
import { IMPORT_LIMITS as L, type ImportInput, type ImportResult, type ValidatedImport, type ImportReviewFile, type ImportIssue, type ImportLocalEntry } from "./import-types";

type At = ImportIssue["at"];
const failure = (code: ImportIssue["code"] = "INVALID_IMPORT_INPUT", at: At = "$"): ImportResult<never> => ({ ok: false, issues: [{ code, at }] });
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const key = (parts: readonly string[]): string => JSON.stringify(parts);
const identityOrder = (a: ResolvedIdentity, b: ResolvedIdentity): number => {
  for (const field of ["catalogId", "sourceId", "name", "version", "packageCommit", "path", "catalogCommit"] as const) {
    const order = compare(a[field], b[field]); if (order) return order;
  }
  return 0;
};
function fields(v: unknown, required: readonly string[], optional: readonly string[] = []): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    && required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => required.includes(k) || optional.includes(k));
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function own<T>(result: ContractResult<T>, at: At): ImportResult<T> {
  return result.ok ? result : failure(result.issues[0]!.code, at);
}
function jsonSize(value: unknown, max: number, at: At): ImportResult<number> {
  const valid = own(validateCatalogJson(value, max), at);
  return valid.ok ? { ok: true, value: Buffer.byteLength(JSON.stringify(value), "utf8") } : valid;
}
const ancestors = (path: string): string[] => {
  const parts = path.split("/"); return parts.slice(1).map((_, i) => parts.slice(0, i + 1).join("/"));
};
const decodedSize = (s: string): number => Math.floor(s.length / 4) * 3 - (s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0);
// Avoid a repeated-group regexp stack proportional to a maximum-size body.
function canonicalBase64(s: string): boolean {
  if (s.length % 4 !== 0) return false;
  const padding = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const end = s.length - padding;
  for (let i = 0; i < end; i++) if (!alphabet.includes(s[i]!)) return false;
  if (padding && (end < 2 || alphabet.indexOf(s[end - 1]!) % (padding === 2 ? 16 : 4) !== 0)) return false;
  return true;
}
function preflightBytes(value: unknown, max: number, budget: { files: number; bytes: number }, at: At): ImportResult<number> {
  if (typeof value !== "string") return failure("INVALID_IMPORT_INPUT", at);
  const size = Math.max(0, decodedSize(value));
  budget.files++; budget.bytes += size;
  if (value.length > Math.ceil(max / 3) * 4 || size > max || budget.files > L.aggregateFiles || budget.bytes > L.decodedBytes) return failure("LIMIT_EXCEEDED", at);
  if (!canonicalBase64(value)) return failure("INVALID_IMPORT_INPUT", at);
  return { ok: true, value: size };
}
function reviewCaps(s: unknown, at: At): ImportResult<true> {
  if (!fields(s, ["manifest", "files", "execution", "warnings"]) || !Array.isArray(s.files) || !Array.isArray(s.warnings)
    || !fields(s.execution, ["apiEventShapes", "runnerScripts", "wrappedCommands", "externalSources"])) return failure("INVALID_IMPORT_INPUT", at);
  const e = s.execution;
  for (const [list, max] of [[s.files, C.contentEntries], [s.warnings, L.snapshotWarnings], [e.apiEventShapes, 256], [e.runnerScripts, 256], [e.wrappedCommands, 35], [e.externalSources, 1]] as const) {
    if (!Array.isArray(list)) return failure("INVALID_IMPORT_INPUT", at);
    if (list.length > max) return failure("LIMIT_EXCEEDED", at);
  }
  const manifest = own(validateCatalogJson(s.manifest, C.manifestJsonBytes), at);
  if (!manifest.ok) return manifest;
  const content = own(validateCatalogJson(s.files, C.contentJsonBytes), at);
  if (!content.ok) return content;
  for (const list of [e.apiEventShapes, e.runnerScripts] as unknown[][]) for (const p of list) {
    if (typeof p !== "string") return failure("INVALID_IMPORT_INPUT", at);
    if (p.length > 240) return failure("LIMIT_EXCEEDED", at);
    if (!RelativePathSchema.safeParse(p).success) return failure("UNSAFE_PATH", at);
  }
  for (const c of e.wrappedCommands as unknown[]) {
    if (!fields(c, ["at", "command", "args"]) || typeof c.at !== "string" || typeof c.command !== "string" || !Array.isArray(c.args) || c.args.some(a => typeof a !== "string")) return failure("INVALID_IMPORT_INPUT", at);
    if (c.at.length > 240 || c.command.length > 16384 || c.args.length > 128 || c.args.some(a => a.length > 4096)) return failure("LIMIT_EXCEEDED", at);
    if (!c.command.length) return failure("INVALID_IMPORT_INPUT", at);
  }
  for (const source of e.externalSources as unknown[]) {
    if (!fields(source, ["type", "repo"], ["ref"]) || source.type !== "github" || typeof source.repo !== "string" || (source.ref !== undefined && typeof source.ref !== "string")) return failure("INVALID_IMPORT_INPUT", at);
    if (source.repo.length > 201 || (typeof source.ref === "string" && source.ref.length > 128)) return failure("LIMIT_EXCEEDED", at);
  }
  for (const w of s.warnings) {
    if (!fields(w, ["code", "at"]) || typeof w.at !== "string" || typeof w.code !== "string" || !["SENSITIVE_TEXT", "MANUAL_REVIEW_REQUIRED", "EXTERNAL_RUNTIME_NOT_PINNED"].includes(w.code)) return failure("INVALID_IMPORT_INPUT", at);
    if (w.at.length > 1024) return failure("LIMIT_EXCEEDED", at);
  }
  return { ok: true, value: true };
}
function paths(entries: readonly { path: string; type: string }[], name: string | undefined, explicit: boolean, at: At): ImportResult<true> {
  const tree = new Map<string, { path: string; type: string }>();
  const folded = new Map<string, string>();
  for (const e of entries) {
    if (!RelativePathSchema.safeParse(e.path).success || (name !== undefined && !RelativePathSchema.safeParse(`${name}/${e.path}`).success)) return failure("UNSAFE_PATH", at);
    if (tree.has(e.path) || (folded.has(e.path.toLowerCase()) && folded.get(e.path.toLowerCase()) !== e.path)) return failure("DUPLICATE_PATH", at);
    tree.set(e.path, e); folded.set(e.path.toLowerCase(), e.path);
  }
  for (const e of entries) for (const p of ancestors(e.path)) {
    const spelling = folded.get(p.toLowerCase());
    if ((spelling !== undefined && spelling !== p) || (tree.has(p) && tree.get(p)!.type !== "directory") || (explicit && tree.get(p)?.type !== "directory")) return failure("DUPLICATE_PATH", at);
    folded.set(p.toLowerCase(), p);
  }
  return { ok: true, value: true };
}
function decode(base64: string): Buffer {
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length !== decodedSize(base64) || bytes.toString("base64") !== base64) throw new Error("Invalid bounded bytes");
  return bytes;
}
function utf8(bytes: Uint8Array): string | undefined {
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return undefined; }
}

function validate(input: ImportInput): ImportResult<ValidatedImport> {
  const json = own(validateCatalogJson(input, L.inputJsonBytes), "$");
  if (!json.ok) return json;
  const raw: unknown = input;
  if (!fields(raw, ["root", "sources", "catalogs", "packages", "target", "installed", "knownReleases"])) {
    if (fields(raw, ["root", "sources", "catalogs", "packages", "target", "knownReleases"])) return failure("INSTALLED_EVIDENCE_REQUIRED", "installed");
    return failure();
  }
  if (!fields(raw.installed, ["complete", "entries"]) || raw.installed.complete !== true || !Array.isArray(raw.installed.entries)) return failure("INSTALLED_EVIDENCE_REQUIRED", "installed");
  for (const [field, max] of [["sources", L.sources], ["catalogs", L.catalogs], ["packages", L.suppliedPackages], ["knownReleases", L.knownReleases]] as const) {
    if (!Array.isArray(raw[field])) return failure("INVALID_IMPORT_INPUT", field);
    if (raw[field].length > max) return failure("LIMIT_EXCEEDED", field);
  }
  if (input.installed.entries.length > L.installedEntries) return failure("LIMIT_EXCEEDED", "installed");
  if (!fields(raw.target, ["orgopsVersion", "platform", "tools"]) || !Array.isArray(raw.target.tools)) return failure("INVALID_IMPORT_INPUT", "target");
  if (raw.target.tools.length > 64) return failure("LIMIT_EXCEEDED", "target");
  let indexEntries = 0, localEntries = 0;
  for (const c of input.catalogs) {
    if (!fields(c, ["catalogId", "sourceId", "commit", "enabled", "index"]) || !fields(c.index, ["formatVersion", "entries"]) || !Array.isArray(c.index.entries)) return failure("INVALID_IMPORT_INPUT", "catalogs");
    indexEntries += c.index.entries.length;
    if (c.index.entries.length > C.indexEntries || indexEntries > L.totalIndexEntries) return failure("LIMIT_EXCEEDED", "catalogs");
    const r = own(validateCatalogJson(c.index, C.indexJsonBytes), "catalogs"); if (!r.ok) return r;
  }
  for (const p of input.packages) {
    if (!fields(p, ["sourceId", "commit", "path", "snapshot"])) return failure("INVALID_IMPORT_INPUT", "packages");
    const caps = reviewCaps(p.snapshot, "packages"); if (!caps.ok) return caps;
  }
  for (const local of input.installed.entries) {
    if (!fields(local, local.state === "occupied" ? ["state", "name"] : ["state", "name", "origin", "content"]) || !["occupied", "measured"].includes(local.state)) return failure("INVALID_IMPORT_INPUT", "installed");
    if (local.state === "measured") {
      if (!fields(local.content, ["complete", "entries"]) || local.content.complete !== true || !Array.isArray(local.content.entries)) return failure("INSTALLED_EVIDENCE_REQUIRED", "installed");
      localEntries += local.content.entries.length;
      if (local.content.entries.length > L.localEntriesPerSkill || localEntries > L.localTreeEntries) return failure("LIMIT_EXCEEDED", "installed");
    }
  }
  // All externally knowable body occurrences, even unused sources and blocked locals,
  // are counted before the first decode, hash, manifest parser or inspection.
  const budget = { files: 0, bytes: 0 };
  for (const p of input.packages) {
    let bytes = 0;
    for (const f of p.snapshot.files) {
      if (!fields(f, ["path", "base64", "executable", "size", "digest"])) return failure("INVALID_IMPORT_INPUT", "packages");
      const r = preflightBytes(f.base64, C.fileBytes, budget, "packages"); if (!r.ok) return r; bytes += r.value;
    }
    if (bytes > C.totalContentBytes) return failure("LIMIT_EXCEEDED", "packages");
  }
  for (const local of input.installed.entries) if (local.state === "measured") {
    let bytes = 0;
    for (const e of local.content.entries) {
      if (!fields(e, e.type === "file" ? ["type", "path", "base64", "executable"] : ["type", "path"]) || !["file", "directory", "blocked"].includes(e.type)) return failure("INVALID_IMPORT_INPUT", "installed");
      if (e.type === "file") {
        if (typeof e.executable !== "boolean") return failure("INVALID_IMPORT_INPUT", "installed");
        const root = e.path === "orgops-package.json";
        const r = preflightBytes(e.base64, root ? C.manifestJsonBytes : C.fileBytes, budget, "installed"); if (!r.ok) return r;
        if (!root) bytes += r.value;
      }
    }
    if (bytes > C.totalContentBytes) return failure("LIMIT_EXCEEDED", "installed");
  }
  // Validate every authored manifest, including unused ones, before retaining canonical
  // collections or inspecting any package. The inspector still verifies digests/bytes.
  for (const p of [...input.packages].sort((a, b) => compare(a.sourceId, b.sourceId) || compare(a.commit, b.commit) || compare(a.path, b.path))) {
    const parsed = own(validatePackageManifest(p.snapshot.manifest), "packages"); if (!parsed.ok) return parsed;
  }
  if (!fields(input.root, ["catalogId", "name", "version"]) || !CatalogIdSchema.safeParse(input.root.catalogId).success || !PackageNameSchema.safeParse(input.root.name).success || !VersionSchema.safeParse(input.root.version).success) return failure("INVALID_IMPORT_INPUT", "root");
  if (!VersionSchema.safeParse(input.target.orgopsVersion).success || !["linux", "darwin", "win32"].includes(input.target.platform)
    || input.target.tools.some(t => !PackageNameSchema.safeParse(t).success) || new Set(input.target.tools).size !== input.target.tools.length) return failure("INVALID_IMPORT_INPUT", "target");

  const v: ImportInput = { root: input.root, sources: [], catalogs: [], packages: [], target: input.target, installed: { complete: true, entries: [] }, knownReleases: [] };
  const installedSkills: ValidatedImport["installedSkills"][number][] = [], blockedNames: string[] = [], installedFiles: ValidatedImport["installedFiles"][number][] = [];
  const result: ValidatedImport = { input: v, installedSkills, blockedNames, installedFiles };
  const initial = jsonSize(v, L.inputJsonBytes, "$"); if (!initial.ok) return initial;
  const initialPrivate = jsonSize(result, L.validatedJsonBytes, "$"); if (!initialPrivate.ok) return initialPrivate;
  let inputBytes = initial.value, validatedBytes = initialPrivate.value;
  // Exact compact JSON deltas: [] syntax is already charged, each subsequent item adds a comma.
  // Charge before cloning/retaining a regenerated piece; no whole-input clone or expanded map.
  function charge(piece: unknown, comma: boolean, inInput: boolean, at: At): ImportResult<true> {
    const punctuation = comma ? 1 : 0;
    const remaining = Math.min(L.validatedJsonBytes - validatedBytes, inInput ? L.inputJsonBytes - inputBytes : Infinity) - punctuation;
    if (remaining < 0) return failure("LIMIT_EXCEEDED", at);
    const size = jsonSize(piece, remaining, at); if (!size.ok) return size;
    validatedBytes += size.value + punctuation;
    if (inInput) inputBytes += size.value + punctuation;
    return { ok: true, value: true };
  }
  v.root = structuredClone(input.root); v.target = structuredClone(input.target); v.target.tools.sort();
  const sources: ImportInput["sources"][number][] = [], sourceIds = new Set<string>(), repositories = new Set<string>();
  for (const s of [...input.sources].sort((a, b) => compare(a.sourceId, b.sourceId))) {
    if (!fields(s, ["sourceId", "repository", "enabled", "allowPackages"]) || !SourceIdSchema.safeParse(s.sourceId).success || typeof s.enabled !== "boolean" || typeof s.allowPackages !== "boolean") return failure("INVALID_IMPORT_INPUT", "sources");
    const repository = GitRepositorySchema.safeParse(s.repository); if (!repository.success) return failure("INVALID_IMPORT_INPUT", "sources");
    const id = JSON.stringify([repository.data.url, repository.data.sshUser ?? null]);
    if (sourceIds.has(s.sourceId) || repositories.has(id)) return failure("IDENTITY_CONFLICT", "sources");
    sourceIds.add(s.sourceId); repositories.add(id);
    const item = { ...s, repository: repository.data }, paid = charge(item, sources.length > 0, true, "sources"); if (!paid.ok) return paid;
    sources.push(structuredClone(item));
  }
  v.sources = sources;
  const catalogs: ImportInput["catalogs"][number][] = [], catalogIds = new Set<string>();
  for (const c of [...input.catalogs].sort((a, b) => compare(a.catalogId, b.catalogId))) {
    if (!CatalogIdSchema.safeParse(c.catalogId).success || !SourceIdSchema.safeParse(c.sourceId).success || !CommitSchema.safeParse(c.commit).success || typeof c.enabled !== "boolean") return failure("INVALID_IMPORT_INPUT", "catalogs");
    if (catalogIds.has(c.catalogId) || !sourceIds.has(c.sourceId)) return failure("IDENTITY_CONFLICT", "catalogs");
    catalogIds.add(c.catalogId);
    const index = own(validateCatalogIndex(c.index), "catalogs"); if (!index.ok) return index;
    index.value.entries.sort((a, b) => compare(a.name, b.name) || compare(a.version, b.version));
    const item = { ...c, index: index.value }, paid = charge(item, catalogs.length > 0, true, "catalogs"); if (!paid.ok) return paid;
    catalogs.push(item);
  }
  v.catalogs = catalogs;
  const history: ResolvedIdentity[] = [], knownKeys = new Set<string>();
  for (const i of [...input.knownReleases].sort(identityOrder)) {
    if (!ResolvedIdentitySchema.safeParse(i).success) return failure("INVALID_IMPORT_INPUT", "knownReleases");
    const id = key([i.catalogId, i.sourceId, i.name, i.version]);
    if (knownKeys.has(id)) return failure("IDENTITY_CONFLICT", "knownReleases"); knownKeys.add(id);
    const paid = charge(i, history.length > 0, true, "knownReleases"); if (!paid.ok) return paid;
    history.push(structuredClone(i));
  }
  v.knownReleases = history;
  const locals: ImportInput["installed"]["entries"][number][] = [], names = new Set<string>();
  for (const local of [...input.installed.entries].sort((a, b) => compare(a.name, b.name))) {
    if (typeof local.name !== "string" || local.name.includes("/") || !RelativePathSchema.safeParse(local.name).success) return failure("UNSAFE_PATH", "installed");
    const name = local.name.toLowerCase(); if (names.has(name)) return failure("IDENTITY_CONFLICT", "installed"); names.add(name);
    if (local.state === "measured") {
      if (!PackageNameSchema.safeParse(local.name).success || !ResolvedIdentitySchema.safeParse(local.origin).success || local.origin.kind !== "skill" || local.origin.name !== local.name) return failure("INVALID_IMPORT_INPUT", "installed");
      const safe = paths(local.content.entries, local.name, true, "installed"); if (!safe.ok) return safe;
    }
    const paid = charge(local, locals.length > 0, true, "installed"); if (!paid.ok) return paid;
    const copy = structuredClone(local);
    if (copy.state === "measured") copy.content.entries = [...copy.content.entries].sort((a, b) => compare(a.path, b.path));
    locals.push(copy);
  }
  v.installed.entries = locals;
  const packages: ImportInput["packages"][number][] = [], packageKeys = new Set<string>();
  for (const p of [...input.packages].sort((a, b) => compare(a.sourceId, b.sourceId) || compare(a.commit, b.commit) || compare(a.path, b.path))) {
    if (!SourceIdSchema.safeParse(p.sourceId).success || !CommitSchema.safeParse(p.commit).success || !RelativePathSchema.safeParse(p.path).success) return failure("INVALID_IMPORT_INPUT", "packages");
    if (!sourceIds.has(p.sourceId)) return failure("IDENTITY_CONFLICT", "packages");
    const id = key([p.sourceId, p.commit, p.path]); if (packageKeys.has(id)) return failure("IDENTITY_CONFLICT", "packages"); packageKeys.add(id);
    const manifest = p.snapshot.manifest;
    for (const f of p.snapshot.files) if (typeof f.executable !== "boolean" || !Number.isSafeInteger(f.size) || f.size < 0 || f.size > C.fileBytes || !DigestSchema.safeParse(f.digest).success) return failure("INVALID_IMPORT_INPUT", "packages");
    const safe = paths([{ path: "orgops-package.json", type: "file" }, ...p.snapshot.files.map(f => ({ path: f.path, type: "file" }))], manifest.kind === "skill" ? manifest.name : undefined, false, "packages"); if (!safe.ok) return safe;
    const inspected = own(inspectPackage(manifest, p.snapshot.files.map(f => ({ type: "file", path: f.path, base64: f.base64, executable: f.executable }))), "packages"); if (!inspected.ok) return inspected;
    const caps = reviewCaps(inspected.value, "packages"); if (!caps.ok) return caps;
    const claims = new Map(p.snapshot.files.map(f => [f.path, f]));
    if (inspected.value.files.some(f => { const c = claims.get(f.path); return !c || c.size !== f.size || c.digest !== f.digest; })) return failure("INVENTORY_MISMATCH", "packages");
    const item = { sourceId: p.sourceId, commit: p.commit, path: p.path, snapshot: inspected.value };
    const paid = charge(item, packages.length > 0, true, "packages"); if (!paid.ok) return paid;
    packages.push(item);
  }
  v.packages = packages;
  function block(name: string): ImportResult<true> {
    const paid = charge(name, blockedNames.length > 0, false, "installed"); if (!paid.ok) return paid;
    blockedNames.push(name); return { ok: true, value: true };
  }
  for (const local of locals) {
    if (local.state === "occupied") { const r = block(local.name.toLowerCase()); if (!r.ok) return r; continue; }
    const root = local.content.entries.find(e => e.path === "orgops-package.json");
    const ordinary = local.content.entries.filter((e): e is Extract<ImportLocalEntry, { type: "file" }> => e.type === "file" && e.path !== "orgops-package.json");
    const requiredDirectories = new Set(ordinary.flatMap(e => ancestors(e.path)));
    if (!root || root.type !== "file" || root.executable || local.content.entries.some(e => e.type === "blocked" || (e.type === "directory" && !requiredDirectories.has(e.path)))) {
      const r = block(local.name); if (!r.ok) return r; continue;
    }
    const text = utf8(decode(root.base64));
    const parsed = text === undefined ? failure("INVALID_JSON", "installed") : own(parsePackageManifest(text), "installed");
    const inspected = parsed.ok ? own(inspectPackage(parsed.value, ordinary), "installed") : parsed;
    if (!inspected.ok && inspected.issues[0]!.code === "LIMIT_EXCEEDED") return inspected;
    if (!inspected.ok || inspected.value.manifest.kind !== "skill" || inspected.value.manifest.name !== local.name) {
      const r = block(local.name); if (!r.ok) return r; continue;
    }
    const caps = reviewCaps(inspected.value, "installed"); if (!caps.ok) return caps;
    const item = { name: local.name, identity: local.origin, currentDigest: inspected.value.manifest.digest };
    const paid = charge(item, installedSkills.length > 0, false, "installed"); if (!paid.ok) return paid;
    installedSkills.push(item);
    const files: ImportReviewFile[] = [], review = { name: local.name, files };
    const envelope = charge(review, installedFiles.length > 0, false, "installed"); if (!envelope.ok) return envelope;
    installedFiles.push(review);
    for (const e of local.content.entries) if (e.type === "file") {
      const bytes = decode(e.base64);
      const f: ImportReviewFile = { path: e.path, base64: e.base64, executable: e.executable, size: bytes.length,
        digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, encoding: utf8(bytes) === undefined ? "binary" : "utf8" };
      const paidFile = charge(f, files.length > 0, false, "installed"); if (!paidFile.ok) return paidFile;
      files.push(f);
    }
  }
  const finalInput = own(validateCatalogJson(v, L.inputJsonBytes), "$"); if (!finalInput.ok) return finalInput;
  const finalPrivate = own(validateCatalogJson(result, L.validatedJsonBytes), "$"); if (!finalPrivate.ok) return finalPrivate;
  return { ok: true, value: freeze(result) };
}
export function validateImportInput(input: ImportInput): ImportResult<ValidatedImport> {
  try { return validate(input); } catch { return failure(); }
}
