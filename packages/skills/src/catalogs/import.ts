import { validateImportInput } from "./import-evidence";
import { precheckPackageSources } from "./source-policy";
import { resolvePackages, type Resolution } from "./resolve";
import { createHash } from "node:crypto";
import { CATALOG_LIMITS, validateCatalogJson, type ResolvedIdentity } from "@orgops/schemas";
import { canonicalManifestBytes } from "./content";
import { IMPORT_LIMITS as L, type ImportInput, type ImportResult, type ImportPreview, type ValidatedImport,
  type ImportIssue, type ImportReviewPackage, type ImportReviewFile } from "./import-types";

const failure = (code: ImportIssue["code"], at: ImportIssue["at"] = "review"): ImportResult<never> => ({ ok: false, issues: [{ code, at }] });
const key = (i: Pick<ResolvedIdentity, "catalogId" | "sourceId" | "name" | "version">): string =>
  JSON.stringify([i.catalogId, i.sourceId, i.name, i.version]);
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

export function prepareImport(input: ImportInput): ImportResult<ImportPreview> {
  try {
    const checked = validateImportInput(input);
    if (!checked.ok) return checked;
    const v = checked.value.input;
    const policy = precheckPackageSources({ roots: [v.root], catalogs: v.catalogs, packages: v.packages, sources: v.sources });
    if (!policy.ok) return { ok: false, issues: [{ code: policy.issues[0]!.code, at: "sources" }] };
    const resolved = resolvePackages({ roots: [v.root], catalogs: v.catalogs, packages: v.packages,
      allowedSourceIds: policy.value, target: v.target, installedSkills: checked.value.installedSkills, knownReleases: v.knownReleases });
    if (!resolved.ok) {
      const code = resolved.issues[0]!.code;
      return { ok: false, issues: [{ code, at: code === "SKILL_CONFLICT" ? "installed" : code === "INCOMPATIBLE" ? "target" : "packages" }] };
    }
    return composeImportReview(checked.value, resolved.value);
  } catch { return { ok: false, issues: [{ code: "INVALID_IMPORT_INPUT", at: "$" }] }; }
}
/** Projection of already validated evidence and one successful resolution; no graph traversal. */
export function composeImportReview(checked: ValidatedImport, resolution: Resolution): ImportResult<ImportPreview> {
  const blocked = new Set(checked.blockedNames);
  for (const p of resolution.packages) if (p.identity.kind === "skill" && blocked.has(p.identity.name.toLowerCase()))
    return failure("SKILL_CONFLICT", "installed");
  const v = checked.input;
  const roots = resolution.packages.filter(p => p.identity.catalogId === v.root.catalogId
    && p.identity.name === v.root.name && p.identity.version === v.root.version);
  if (roots.length !== 1) return failure("IDENTITY_CONFLICT");
  const nodes = new Map<string, ResolvedIdentity>();
  for (const p of resolution.packages) {
    const k = key(p.identity);
    if (nodes.has(k)) return failure("IDENTITY_CONFLICT");
    nodes.set(k, p.identity);
  }
  const packages: ImportReviewPackage[] = [];
  const preview: ImportPreview = { kind: "offline-import-preview", root: roots[0]!.identity,
    preconditions: { root: v.root, sources: v.sources, catalogs: v.catalogs, target: v.target,
      installed: v.installed, knownReleases: v.knownReleases }, packages, reviewRequired: true, authority: "none" };
  // Empty array syntax is charged in its envelope. Charge each bounded piece BEFORE
  // retaining it; commas are the only additional compact JSON array punctuation.
  let jsonBytes = 0, fileCount = 0, decodedBytes = 0;
  function charge(piece: unknown, comma = false): ImportResult<true> {
    const remaining = L.outputJsonBytes - jsonBytes - (comma ? 1 : 0);
    if (remaining < 0) return failure("LIMIT_EXCEEDED");
    const valid = validateCatalogJson(piece, remaining);
    if (!valid.ok) return failure(valid.issues[0]!.code);
    jsonBytes += Buffer.byteLength(JSON.stringify(piece), "utf8") + (comma ? 1 : 0);
    return { ok: true, value: true };
  }
  const initial = charge(preview); if (!initial.ok) return initial;
  const locals = new Map(checked.installedFiles.map(p => [p.name, p.files]));
  for (const p of resolution.packages) {
    const dependencies: ResolvedIdentity[] = [];
    const files: ImportReviewFile[] = [];
    const item: ImportReviewPackage = { identity: p.identity, snapshot: p.snapshot, action: p.action,
      dependencies, files, manifestBytes: p.action === "reuse" ? "current-installed-manifest" : "normalized-package-manifest" };
    const envelope = charge(item, packages.length > 0); if (!envelope.ok) return envelope;
    for (const pin of p.snapshot.manifest.dependencies) {
      const child = nodes.get(key(pin));
      const commit = pin.revision.type === "exact" ? pin.revision.commit : p.identity.packageCommit;
      if (!child || child.kind !== "skill" || child.packageCommit !== commit || child.digest !== pin.digest
        || (pin.revision.type === "same-package-revision" && pin.sourceId !== p.identity.sourceId)) return failure("IDENTITY_CONFLICT");
      const paid = charge(child, dependencies.length > 0); if (!paid.ok) return paid;
      dependencies.push(child);
    }
    function reserveFile(size: number): ImportResult<true> {
      if (fileCount + 1 > L.outputFiles || decodedBytes + size > L.outputDecodedBytes) return failure("LIMIT_EXCEEDED");
      fileCount++; decodedBytes += size;
      return { ok: true, value: true };
    }
    function append(file: ImportReviewFile): ImportResult<true> {
      const paid = charge(file, files.length > 0); if (!paid.ok) return paid;
      files.push(file); return { ok: true, value: true };
    }
    if (p.action === "reuse") {
      const existing = locals.get(p.identity.name);
      if (p.identity.kind !== "skill" || !existing) return failure("IDENTITY_CONFLICT", "installed");
      for (const f of existing) {
        const reserved = reserveFile(f.size); if (!reserved.ok) return reserved;
        const paid = append(f); if (!paid.ok) return paid;
      }
    } else {
      // Snapshots contain semantic metadata, NOT an upstream lexical manifest blob.
      const bytes = canonicalManifestBytes(p.snapshot.manifest);
      const size = bytes.length;
      if (size > CATALOG_LIMITS.manifestJsonBytes) return failure("LIMIT_EXCEEDED");
      const reserved = reserveFile(size); if (!reserved.ok) return reserved;
      const root: ImportReviewFile = { path: "orgops-package.json", base64: bytes.toString("base64"), size,
        digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, executable: false, encoding: "utf8" };
      const paidRoot = append(root); if (!paidRoot.ok) return paidRoot;
      for (const f of p.snapshot.files) {
        const reserved = reserveFile(f.size); if (!reserved.ok) return reserved;
        let encoding: ImportReviewFile["encoding"] = "utf8";
        try { new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.from(f.base64, "base64")); }
        catch { encoding = "binary"; }
        const paid = append({ ...f, encoding }); if (!paid.ok) return paid;
      }
      files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    }
    packages.push(item);
  }
  const final = validateCatalogJson(preview, L.outputJsonBytes);
  if (!final.ok) return failure(final.issues[0]!.code);
  return { ok: true, value: freeze(structuredClone(preview)) };
}
