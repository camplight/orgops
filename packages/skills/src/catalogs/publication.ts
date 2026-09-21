import { createHash } from "node:crypto";
import { reviewPublicationChanges } from "./publication-review";
import { CATALOG_LIMITS, parseCatalogIndex, validateCatalogIndex, type CatalogIndex } from "@orgops/schemas";
import { canonicalJson } from "./content";
import { validatePublicationInput } from "./publication-base";
import { publicationBytes, publicationCompare as compare, publicationFailure as failure } from "./publication-content";
import { resolvePublicationReleases } from "./publication-resolve";
import { PUBLICATION_LIMITS as L, type PublicationInput, type PublicationResult, type PublicationProposal, type PublicationBytes, type PublicationChange } from "./publication-types";

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export type PublicationComposition = Pick<PublicationProposal,
  "kind" | "preconditions" | "selections" | "proposedIndex" | "changes" | "releases" | "reviewRequired">;
const overlap = (a: string, b: string): boolean => {
  a = a.toLowerCase(); b = b.toLowerCase();
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
};
function classification(bytes: PublicationBytes): "utf8" | "binary" {
  try { new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.from(bytes.base64, "base64")); return "utf8"; }
  catch { return "binary"; }
}
function compose(input: PublicationInput): PublicationResult<PublicationComposition> {
  const checked = validatePublicationInput(input);
  if (!checked.ok) return checked;
  const validated = checked.value, v = validated.input;
  const preconditions = structuredClone(validated.preconditions);
  // The exporter checks file paths, not shared implicit directory spellings.
  // Check the combined future tree against the same portable ancestor contract
  // as the trusted base inventory, including an absent index's new ancestors.
  const tree = new Map(v.base.inventory.entries.map(e => [e.path.toLowerCase(), { path: e.path, type: e.type }]));
  const reserveFile = (path: string): boolean => {
    const parts = path.split("/");
    for (let n = 1; n <= parts.length; n++) {
      const prefix = parts.slice(0, n).join("/"), folded = prefix.toLowerCase();
      const type = n === parts.length ? "file" : "directory";
      const previous = tree.get(folded);
      if (previous && (previous.path !== prefix || previous.type !== type)) return false;
      tree.set(folded, { path: prefix, type });
    }
    return true;
  };
  if (!reserveFile(v.base.indexPath) || v.selections.some(s =>
    s.candidate.proposedFiles.some(f => !reserveFile(`${s.destinationPath}/${f.path}`))))
    return failure("DESTINATION_CONFLICT", "selections.destinationPath");
  const index: CatalogIndex = { formatVersion: 1, entries: validated.baseIndex.entries.map(e => {
    const l = e.location;
    return l.type === "catalog" && l.revision.type === "catalog-revision"
      ? { ...e, location: { ...l, revision: { type: "exact" as const, commit: v.base.commit } } }
      : structuredClone(e);
  }) };
  const changes: PublicationChange[] = [], selections: PublicationComposition["selections"][number][] = [];
  const absent: string[] = v.base.indexBase64 === null ? [v.base.indexPath] : [];
  const regions = [...preconditions.preservedReleases, ...v.base.history.releases, ...v.knownReleases]
    .filter(i => i.sourceId === v.base.sourceId).map(i => i.path);
  let outputBytes = 0;
  const add = (path: string, before: PublicationBytes | null, after: PublicationBytes): PublicationResult<true> => {
    outputBytes += (before?.size ?? 0) + after.size;
    if (changes.length >= L.outputFiles || outputBytes > L.outputBytes) return failure("LIMIT_EXCEEDED", "changes");
    changes.push({ path, before, after, review: { before: before ? classification(before) : "absent", after: classification(after) } });
    return { ok: true, value: true };
  };
  for (const s of v.selections) {
    const m = s.candidate.snapshot.manifest;
    const existing = validated.baseIndex.entries.find(e => e.name === m.name && e.version === m.version);
    const files = [];
    for (const f of s.candidate.proposedFiles) {
      const measured = publicationBytes(f.base64, f.executable,
        f.path === "orgops-package.json" ? CATALOG_LIMITS.manifestJsonBytes : CATALOG_LIMITS.fileBytes);
      if (!measured.ok) return measured;
      files.push({ path: `${s.destinationPath}/${f.path}`, bytes: measured.value });
    }
    if (existing) {
      const l = existing.location;
      const identity = preconditions.preservedReleases.find(i => i.name === m.name && i.version === m.version)!;
      if (l.type !== "catalog" || l.path !== s.destinationPath || existing.kind !== m.kind || existing.digest !== m.digest)
        return failure("IDENTITY_CONFLICT", "selections");
      const supplied = v.packages.find(p => p.sourceId === identity.sourceId && p.commit === identity.packageCommit && p.path === identity.path);
      if (!supplied) return failure("MISSING_RELEASE", "packages");
      if (canonicalJson(supplied.snapshot) !== canonicalJson(s.candidate.snapshot)) return failure("IDENTITY_CONFLICT", "selections");
      // Exact no-op requires every directory and file in the current subtree,
      // including the serialized manifest, with no extra/blocked/empty children.
      const expected = new Map<string, { type: "directory" } | { type: "file"; bytes: PublicationBytes }>();
      expected.set(s.destinationPath, { type: "directory" });
      for (const f of files) {
        expected.set(f.path, { type: "file", bytes: f.bytes });
        let path = f.path.slice(0, f.path.lastIndexOf("/"));
        while (path.length > s.destinationPath.length) { expected.set(path, { type: "directory" }); path = path.slice(0, path.lastIndexOf("/")); }
      }
      const subtree = v.base.inventory.entries.filter(e => e.path.toLowerCase() === s.destinationPath.toLowerCase() || e.path.toLowerCase().startsWith(`${s.destinationPath.toLowerCase()}/`));
      if (subtree.length !== expected.size || subtree.some(e => {
        const wanted = expected.get(e.path);
        return !wanted || wanted.type !== e.type || (e.type === "file" && wanted.type === "file" &&
          (e.size !== wanted.bytes.size || e.digest !== wanted.bytes.digest || e.executable !== wanted.bytes.executable));
      })) return failure("DESTINATION_CONFLICT", "selections.destinationPath");
    } else {
      if (v.base.history.releases.some(i => i.name === m.name && i.version === m.version)) return failure("IDENTITY_CONFLICT", "selections");
      if (regions.some(p => overlap(p, s.destinationPath)) || v.base.inventory.entries.some(e =>
        e.path.toLowerCase() === s.destinationPath.toLowerCase() || e.path.toLowerCase().startsWith(`${s.destinationPath.toLowerCase()}/`)))
        return failure("DESTINATION_CONFLICT", "selections.destinationPath");
      absent.push(s.destinationPath);
      index.entries.push({ kind: m.kind, name: m.name, version: m.version, digest: m.digest,
        location: { type: "catalog", path: s.destinationPath, revision: { type: "catalog-revision" } } });
      for (const f of files) { const added = add(f.path, null, f.bytes); if (!added.ok) return added; }
    }
    selections.push({ destinationPath: s.destinationPath, intent: s.intent, origin: s.origin,
      name: m.name, version: m.version, disposition: existing ? "existing" : "new" });
  }
  index.entries.sort((a, b) => compare(a.name, b.name) || compare(a.version, b.version));
  if (index.entries.length + v.catalogs.reduce((n, c) => n + c.index.entries.length, 0) > L.totalIndexEntries)
    return failure("LIMIT_EXCEEDED", "proposedIndex");
  const checkedIndex = validateCatalogIndex(index);
  if (!checkedIndex.ok) return checkedIndex;
  const text = JSON.stringify(JSON.parse(canonicalJson(checkedIndex.value)), null, 2) + "\n";
  const parsed = parseCatalogIndex(text);
  if (!parsed.ok) return parsed;
  const after = publicationBytes(Buffer.from(text).toString("base64"), false, CATALOG_LIMITS.indexJsonBytes);
  if (!after.ok) return after;
  if (after.value.base64 !== preconditions.oldIndex?.base64) {
    const added = add(v.base.indexPath, preconditions.oldIndex, after.value);
    if (!added.ok) return added;
  }
  const resolved = resolvePublicationReleases(validated, parsed.value);
  if (!resolved.ok) return resolved;
  preconditions.requiredAbsentPaths = absent.sort(compare);
  return { ok: true, value: freeze(structuredClone({ kind: "offline-publication-proposal" as const, preconditions,
    selections, proposedIndex: parsed.value, changes: changes.sort((a, b) => compare(a.path, b.path)),
    releases: resolved.value, reviewRequired: true as const })) };
}

/** Private, unscanned composition only. No checksum, scan or publication claim. */
export function composePublication(input: PublicationInput): PublicationResult<PublicationComposition> {
  try { return compose(input); }
  catch { return failure(); }
}

/** Conditional offline consistency only: no authority, I/O or publication capability. */
export function preparePublication(input: PublicationInput): PublicationResult<PublicationProposal> {
  try {
    const composed = composePublication(input);
    if (!composed.ok) return composed;
    // Review revalidates every exact changed side and all final file/byte budgets
    // before scan or checksum serialization. It never returns truncated findings.
    const reviewed = reviewPublicationChanges(composed.value.changes);
    if (!reviewed.ok) return reviewed;
    const data = { ...composed.value, ...reviewed.value };
    const proposalDigest = `sha256:${createHash("sha256")
      .update(`orgops-publication-proposal-v1\n${canonicalJson(data)}`).digest("hex")}`;
    return { ok: true, value: freeze({ ...data, proposalDigest }) };
  } catch { return failure(); }
}
