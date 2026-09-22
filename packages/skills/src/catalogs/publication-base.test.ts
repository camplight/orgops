import { describe, it, expect } from "vitest";
import { validatePublicationInput } from "./publication-base";
import { publicationInput, bytes } from "./publication-fixtures";
describe("validatePublicationInput", () => {
    it("requires complete base inventory rather than package file claims", () => {
        const v = publicationInput();
        Object.assign(v.base.inventory, { complete: false });
        expect(validatePublicationInput(v)).toEqual({ ok: false, issues: [{ code: "BASE_EVIDENCE_REQUIRED", at: "base.inventory" }] });
    });
    it("binds exact lexical old index bytes to immutable inventory", () => {
        const v = publicationInput();
        v.base.indexBase64 = bytes('{"formatVersion":1,"entries":[]}\n');
        expect(validatePublicationInput(v)).toEqual({ ok: false, issues: [{ code: "BASE_CONFLICT", at: "base.indexBase64" }] });
    });
    it("detaches and freezes validated base preconditions without freezing input", () => {
        const v = publicationInput(), before = structuredClone(v), r = validatePublicationInput(v);
        expect(r.ok).toBe(true);
        if (!r.ok)
            return;
        expect(r.value.preconditions.oldIndex?.base64).toBe(v.base.indexBase64);
        expect(r.value.preconditions.catalogEnabled).toBe(true);
        expect(r.value.preconditions.requiredAbsentPaths).toEqual([]);
        expect(r.value.baseIndex).toEqual({ formatVersion: 1, entries: [] });
        expect(Object.isFrozen(r.value.input.base.inventory.entries)).toBe(true);
        expect(v).toEqual(before);
        expect(Object.isFrozen(v)).toBe(false);
    });
});
import { vi } from "vitest";
import * as content from "./content";
import { BASE, digest } from "./publication-fixtures";
import type { PublicationInput, PublicationTreeEntry } from "./publication-types";
import type { CatalogIndex, ResolvedIdentity } from "@orgops/schemas";
function oldRelease(v: PublicationInput): ResolvedIdentity { const m = v.selections[0]!.candidate.snapshot.manifest; return { catalogId: "team", catalogCommit: BASE, sourceId: "team-source", packageCommit: BASE, path: "old/package", kind: m.kind, name: m.name, version: m.version, digest: m.digest }; }
function setIndex(v: PublicationInput, text: string) { v.base.indexBase64 = bytes(text); v.base.inventory.entries = [{ type: "directory", path: "catalog" }, { type: "file", path: "catalog/index.json", size: Buffer.byteLength(text), digest: digest(text), executable: false }]; }
function baseWithRelease(): PublicationInput { const v = publicationInput(), i = oldRelease(v); const index: CatalogIndex = { formatVersion: 1, entries: [{ kind: i.kind, name: i.name, version: i.version, digest: i.digest, location: { type: "catalog", path: i.path, revision: { type: "catalog-revision" } } }] }; setIndex(v, JSON.stringify(index)); v.base.history.releases = [i]; return v; }
function reject(v: PublicationInput, code?: string) { const r = validatePublicationInput(v); expect(r.ok).toBe(false); if (r.ok)
    return; expect(r.issues).toHaveLength(1); if (code)
    expect(r.issues[0]!.code).toBe(code); expect(JSON.stringify(r)).not.toContain("sensitive-synthetic-marker"); }
it.each(["history", "inventory"] as const)("requires missing %s completeness", field => { const v = publicationInput(); Reflect.deleteProperty(v.base[field], "complete"); expect(validatePublicationInput(v)).toEqual({ ok: false, issues: [{ code: "BASE_EVIDENCE_REQUIRED", at: `base.${field}` }] }); });
it("requires retained history completeness even for an empty current index", () => { const v = publicationInput(); Object.assign(v.base.history, { complete: false }); reject(v, "BASE_EVIDENCE_REQUIRED"); });
it.each(["root", "base", "inventory", "history", "source", "selection", "target", "tree"])("rejects unknown %s envelope fields", where => { const v = publicationInput(); const target = where === "root" ? v : where === "base" ? v.base : where === "inventory" ? v.base.inventory : where === "history" ? v.base.history : where === "source" ? v.sources[0]! : where === "selection" ? v.selections[0]! : where === "target" ? v.target : v.base.inventory.entries[0]!; Object.assign(target, { credential: "sensitive-synthetic-marker" }); reject(v); });
it("does not invoke nested getters", () => { const v = publicationInput(); let reads = 0; Object.defineProperty(v.sources[0], "repository", { enumerable: true, get() { reads++; return "sensitive-synthetic-marker"; } }); reject(v); expect(reads).toBe(0); });
it.each([undefined, NaN, Infinity, BigInt(1), () => 0, new Date(), Symbol("synthetic")])("rejects ignored non-JSON values %s", value => { const v = publicationInput(); Object.assign(v, { ignored: value }); reject(v, "INVALID_JSON"); });
it("rejects cyclic ignored objects", () => { const v = publicationInput(); Object.assign(v, { ignored: v }); reject(v, "INVALID_JSON"); });
it("rejects excessively deep ignored objects", () => { const v = publicationInput(); let x: unknown = 0; for (let i = 0; i < 33; i++)
    x = { x }; Object.assign(v, { ignored: x }); reject(v, "LIMIT_EXCEEDED"); });
it("independently gates a disabled base before semantic inspection", () => { const v = publicationInput(); v.base.enabled = false; v.sources[0]!.allowPackages = true; Object.assign(v.selections[0]!.candidate.snapshot.manifest, { digest: `sha256:${"0".repeat(64)}` }); const spy = vi.spyOn(content, "inspectPackage"); try {
    expect(validatePublicationInput(v)).toEqual({ ok: false, issues: [{ code: "SOURCE_NOT_ALLOWED", at: "base.enabled" }] });
    expect(spy).not.toHaveBeenCalled();
}
finally {
    vi.restoreAllMocks();
} });
it.each(["disabled", "missing", "rebound", "alias", "duplicate"])("rejects %s source policy evidence", kind => { const v = publicationInput(); if (kind === "disabled")
    v.sources[0]!.enabled = false;
else if (kind === "missing")
    v.sources = [];
else if (kind === "rebound")
    v.sources[0]!.repository = { url: "https://other.invalid/catalog.git" };
else
    v.sources = [...v.sources, { ...v.sources[0]!, sourceId: kind === "alias" ? "alias" : "team-source" }]; reject(v); });
it("canonicalizes repository identity without mutating the caller", () => { const v = publicationInput(); v.base.repository.url = "https://EXAMPLE.invalid:443/team/catalog.git"; const r = validatePublicationInput(v); expect(r.ok).toBe(true); if (!r.ok)
    return; expect(r.value.preconditions.repository.url).toBe("https://example.invalid/team/catalog.git"); expect(v.base.repository.url).toContain("EXAMPLE"); });
it.each<PublicationTreeEntry[]>([
    [{ type: "directory", path: "catalog" }], [{ type: "directory", path: "Catalog" }],
    [{ type: "file", path: "leaf", size: 0, digest: digest(""), executable: false }, { type: "directory", path: "leaf/child" }],
    [{ type: "blocked", path: "blocked" }, { type: "directory", path: "blocked/child" }],
    [{ type: "directory", path: "missing/child" }], [{ type: "directory", path: "CATALOG/child" }],
    [{ type: "directory", path: "../escape" }], [{ type: "file", path: "bad", size: -1, digest: digest(""), executable: false }],
])("rejects inconsistent complete tree %#", (...entries) => { const v = publicationInput(); v.base.inventory.entries = [...v.base.inventory.entries, ...entries]; reject(v); });
it("allows unrelated blocked leaves, empty directories and large metadata-only files", () => { const v = publicationInput(); v.base.inventory.entries = [...v.base.inventory.entries, { type: "blocked", path: "link" }, { type: "directory", path: "empty" }, { type: "file", path: "large", size: Number.MAX_SAFE_INTEGER, digest: digest(""), executable: true }]; expect(validatePublicationInput(v).ok).toBe(true); });
it.each(["missing-file", "missing-bytes", "directory", "executable", "hash", "size", "utf8", "bom", "base64"])("rejects %s selected index evidence", kind => { const v = publicationInput(); if (kind === "missing-file")
    v.base.inventory.entries = [];
else if (kind === "missing-bytes")
    Reflect.deleteProperty(v.base, "indexBase64");
else if (kind === "directory")
    v.base.inventory.entries = [{ type: "directory", path: "catalog" }, { type: "directory", path: "catalog/index.json" }];
else if (kind === "executable" || kind === "hash" || kind === "size")
    Object.assign(v.base.inventory.entries[1]!, kind === "executable" ? { executable: true } : kind === "hash" ? { digest: digest("different") } : { size: 1 });
else if (kind === "base64")
    v.base.indexBase64 = "YQ";
else {
    const text = kind === "bom" ? '\uFEFF{"formatVersion":1,"entries":[]}' : "invalid";
    setIndex(v, text);
    if (kind === "utf8") {
        const b = Buffer.from([255]);
        v.base.indexBase64 = b.toString("base64");
        Object.assign(v.base.inventory.entries[1]!, { size: 1, digest: `sha256:${requireHash(b)}` });
    }
} reject(v); });
import { createHash } from "node:crypto";
function requireHash(b: Buffer): string { return createHash("sha256").update(b).digest("hex"); }
it("accepts an explicitly absent selected index", () => { const v = publicationInput(); v.base.indexBase64 = null; v.base.inventory.entries = []; const r = validatePublicationInput(v); expect(r.ok).toBe(true); if (!r.ok)
    return; expect(r.value.preconditions.oldIndex).toBeNull(); });
it.each<PublicationTreeEntry[]>([[{ type: "blocked", path: "catalog" }], [{ type: "directory", path: "CATALOG" }], [{ type: "directory", path: "catalog" }, { type: "directory", path: "catalog/index.json" }], [{ type: "directory", path: "catalog" }, { type: "file", path: "catalog/INDEX.json", size: 0, digest: digest(""), executable: false }]])("rejects absent-index collision %#", (...entries) => { const v = publicationInput(); v.base.indexBase64 = null; v.base.inventory.entries = entries; reject(v, "BASE_CONFLICT"); });
it.each(["catalog", "CATALOG/index.json", "catalog/index.json/child"])("rejects selected root/index overlap %s", path => { const v = publicationInput(); v.selections[0]!.destinationPath = path; reject(v, "DESTINATION_CONFLICT"); });
it.each(["packages/echo-skill/1.0.0/child", "PACKAGES/echo-skill/1.0.0", "packages"])("rejects pairwise selected overlap %s", path => { const v = publicationInput(); v.selections = [...v.selections, { ...v.selections[0]!, destinationPath: path }]; reject(v, "DESTINATION_CONFLICT"); });
it("rejects joined destination-file path overflow", () => { const v = publicationInput(); v.selections[0]!.destinationPath = ["a".repeat(60), "b".repeat(60), "c".repeat(60), "d".repeat(40)].join("/"); reject(v, "UNSAFE_PATH"); });
it("expands every old contextual release at the exact owning base without requiring historical bytes", () => { const v = baseWithRelease(); const r = validatePublicationInput(v); expect(r.ok).toBe(true); if (!r.ok)
    return; expect(r.value.preconditions.preservedReleases).toEqual([oldRelease(v)]); expect(r.value.input.packages).toEqual([]); });
it.each(["digest", "sourceId", "path", "packageCommit", "kind"])("rejects historical %s remapping", field => { const v = baseWithRelease(); v.sources = [...v.sources, { sourceId: "other", repository: { url: "https://other.invalid/catalog.git" }, enabled: false, allowPackages: false }]; Object.assign(v.base.history.releases[0]!, { [field]: field === "digest" ? digest("different") : field === "sourceId" ? "other" : field === "path" ? "different/path" : field === "kind" ? "native-agent" : "2".repeat(40) }); reject(v, "IDENTITY_CONFLICT"); });
it("retains removed identities and rejects duplicate history even when unselected", () => { const v = publicationInput(), i = oldRelease(v); v.base.history.releases = [i]; expect(validatePublicationInput(v).ok).toBe(true); v.base.history.releases = [i, { ...i, catalogCommit: "2".repeat(40) }]; reject(v, "IDENTITY_CONFLICT"); });
it.each(["base", "other"])("rejects index nested in a %s retained package region absent from index", kind => { const v = publicationInput(), i = { ...oldRelease(v), path: "catalog" }; if (kind === "base")
    v.base.history.releases = [i];
else
    v.knownReleases = [{ ...i, catalogId: "other" }]; reject(v, "DESTINATION_CONFLICT"); });
it("rejects index overlap with explicit-source base-owned package region", () => { const v = publicationInput(), i = oldRelease(v); setIndex(v, JSON.stringify({ formatVersion: 1, entries: [{ kind: i.kind, name: i.name, version: i.version, digest: i.digest, location: { type: "source", sourceId: "team-source", commit: BASE, path: "catalog" } }] })); reject(v, "DESTINATION_CONFLICT"); });
it.each(["new-release-origin", "missing-origin", "unknown-origin", "rename-update", "same-new-destination"])("rejects %s origin claim", kind => { const v = publicationInput(), i = oldRelease(v); v.base.history.releases = [i]; const s = v.selections[0]!; s.origin = i; s.intent = "update"; if (kind === "new-release-origin")
    s.intent = "new-release";
else if (kind === "missing-origin")
    s.origin = null;
else if (kind === "unknown-origin")
    v.base.history.releases = [];
else if (kind === "rename-update")
    s.origin = { ...i, name: "other" };
else
    s.intent = "new-destination"; reject(v, "ORIGIN_CONFLICT"); });
it("preserves recorded origin across catalog provenance revisions", () => { const v = publicationInput(), i = oldRelease(v); v.base.history.releases = [i]; v.selections[0]!.intent = "update"; v.selections[0]!.origin = { ...i, catalogCommit: "2".repeat(40) }; expect(validatePublicationInput(v).ok).toBe(true); });
it.each(["catalog", "package", "known", "target"])("rejects malformed unused %s envelopes", field => { const v = publicationInput(); if (field === "catalog")
    v.catalogs = [{ catalogId: "other", sourceId: "team-source", enabled: false, commit: BASE, index: { formatVersion: 1, entries: [] } }];
else if (field === "package")
    v.packages = [{ sourceId: "team-source", commit: BASE, path: "old", snapshot: structuredClone(v.selections[0]!.candidate.snapshot) }];
else if (field === "known")
    v.knownReleases = [{ ...oldRelease(v), catalogId: "other" }]; const envelope = field === "catalog" ? v.catalogs[0]! : field === "package" ? v.packages[0]! : field === "known" ? v.knownReleases[0]! : v.target; Object.assign(envelope, { ignored: "sensitive-synthetic-marker" }); reject(v); });
it.each(["selections", "sources", "catalogs", "packages", "history", "tree"] as const)("accepts the %s count boundary and rejects +1 before semantic inspection", field => {
    const v = publicationInput(), candidate = v.selections[0]!.candidate;
    const max = field === "selections" ? 64 : field === "sources" ? 128 : field === "catalogs" ? 31 : field === "packages" ? 4032 : field === "history" ? 4096 : 8192;
    if (field === "selections")
        v.selections = Array.from({ length: max }, (_, i) => ({ candidate, destinationPath: `new-${i}`, intent: "new-release", origin: null }));
    else if (field === "sources")
        v.sources = [...v.sources, ...Array.from({ length: max - 1 }, (_, i) => ({ sourceId: `other-${i}`, repository: { url: `https://example.invalid/repo-${i}.git` }, enabled: false, allowPackages: false }))];
    else if (field === "catalogs")
        v.catalogs = Array.from({ length: max }, (_, i) => ({ catalogId: `catalog-${i}`, sourceId: "team-source", commit: BASE, enabled: false, index: { formatVersion: 1, entries: [] } }));
    else if (field === "packages")
        v.packages = Array.from({ length: max }, (_, i) => ({ sourceId: "team-source", commit: BASE, path: `package-${i}`, snapshot: candidate.snapshot }));
    else if (field === "history")
        v.base.history.releases = Array.from({ length: max }, (_, i) => ({ ...oldRelease(v), version: `1.0.${i}` }));
    else
        v.base.inventory.entries = [...v.base.inventory.entries, ...Array.from({ length: max - 2 }, (_, i) => ({ type: "directory" as const, path: `empty-${i}` }))];
    expect(validatePublicationInput(v).ok).toBe(true);
    if (field === "history")
        v.knownReleases = [{ ...oldRelease(v), catalogId: "other" }];
    else if (field === "tree")
        v.base.inventory.entries = [...v.base.inventory.entries, { type: "directory", path: "overflow" }];
    else if (field === "selections")
        v.selections = [...v.selections, v.selections[0]!];
    else if (field === "sources")
        v.sources = [...v.sources, v.sources[0]!];
    else if (field === "catalogs")
        v.catalogs = [...v.catalogs, v.catalogs[0]!];
    else
        v.packages = [...v.packages, v.packages[0]!];
    const inspect = vi.spyOn(content, "inspectPackage");
    try {
        reject(v, "LIMIT_EXCEEDED");
        expect(inspect).not.toHaveBeenCalled();
    }
    finally {
        vi.restoreAllMocks();
    }
}, 30000);
it("counts all dependency and base index entries together including unused entries", () => {
    const v = publicationInput(), i = oldRelease(v);
    function index(count: number): CatalogIndex { return { formatVersion: 1, entries: Array.from({ length: count }, (_, n) => ({ kind: i.kind, name: i.name, version: `1.0.${n}`, digest: i.digest, location: { type: "catalog", path: `old-${n}`, revision: { type: "exact", commit: BASE } } })) }; }
    setIndex(v, JSON.stringify(index(4096)));
    v.catalogs = [{ catalogId: "other", sourceId: "team-source", enabled: false, commit: BASE, index: index(4096) }];
    expect(validatePublicationInput(v).ok).toBe(true);
    v.catalogs = [...v.catalogs, { catalogId: "more", sourceId: "team-source", enabled: false, commit: BASE, index: index(1) }];
    const inspect = vi.spyOn(content, "inspectPackage");
    try {
        reject(v, "LIMIT_EXCEEDED");
        expect(inspect).not.toHaveBeenCalled();
    }
    finally {
        vi.restoreAllMocks();
    }
}, 30000);
it("counts repeated snapshot and proposed files plus old index before semantic work", () => {
    const v = publicationInput(), c = v.selections[0]!.candidate;
    // One candidate contributes 2 snapshot + 3 proposed files, old index contributes 1.
    // 4032 supplied snapshots contribute 8064; 61 more two-file selections reach 8192.
    v.packages = Array.from({ length: 4032 }, (_, i) => ({ sourceId: "team-source", commit: BASE, path: `p-${i}`, snapshot: c.snapshot }));
    // Fill remaining 122 occurrences using extra files in existing snapshot envelopes.
    const p = structuredClone(v.packages[0]!);
    p.snapshot.files = [...p.snapshot.files, ...Array.from({ length: 122 }, (_, i) => ({ ...c.snapshot.files[0]!, path: `extra-${i}` }))];
    v.packages = [p, ...v.packages.slice(1)];
    const inspect = vi.spyOn(content, "inspectPackage");
    try {
        const equal = validatePublicationInput(v);
        expect(equal.ok).toBe(false);
        if (equal.ok)
            return;
        expect(equal.issues[0]!.code).not.toBe("LIMIT_EXCEEDED");
        expect(inspect).toHaveBeenCalled();
        inspect.mockClear();
        p.snapshot.files = [...p.snapshot.files, { ...c.snapshot.files[0]!, path: "overflow" }];
        reject(v, "LIMIT_EXCEEDED");
        expect(inspect).not.toHaveBeenCalled();
    }
    finally {
        vi.restoreAllMocks();
    }
}, 30000);
it("checks aggregate decoded-byte boundary and +1 before decoding any supplied bytes", () => {
    const v = publicationInput(), c = v.selections[0]!.candidate;
    const existing = Buffer.from(v.base.indexBase64!, "base64").length + c.snapshot.files.reduce((n, f) => n + Buffer.from(f.base64, "base64").length, 0) + c.proposedFiles.reduce((n, f) => n + Buffer.from(f.base64, "base64").length, 0);
    let left = 33554432 - existing;
    const snapshots = [];
    for (let p = 0; left > 0; p++) {
        const snapshot = structuredClone(c.snapshot);
        const files = [];
        for (let f = 0; f < 8 && left > 0; f++) {
            const size = Math.min(1048576, left);
            left -= size;
            files.push({ path: `blob-${f}`, base64: Buffer.alloc(size).toString("base64"), size, digest: digest(""), executable: false });
        }
        snapshot.files = files;
        snapshots.push({ sourceId: "team-source", commit: BASE, path: `blob-package-${p}`, snapshot });
    }
    v.packages = snapshots;
    const inspect = vi.spyOn(content, "inspectPackage");
    try {
        const equal = validatePublicationInput(v);
        expect(equal.ok).toBe(false);
        if (equal.ok)
            return;
        expect(equal.issues[0]!.code).not.toBe("LIMIT_EXCEEDED");
        expect(inspect).toHaveBeenCalled();
        inspect.mockClear();
        const last = snapshots.at(-1)!.snapshot.files.at(-1)!;
        last.base64 = Buffer.alloc(last.size + 1).toString("base64");
        reject(v, "LIMIT_EXCEEDED");
        expect(inspect).not.toHaveBeenCalled();
    }
    finally {
        vi.restoreAllMocks();
    }
}, 30000);
it("enforces entire JSON bytes including otherwise ignored input at exact boundary and +1", () => {
    const v = publicationInput();
    Object.assign(v, { ignored: "" });
    const size = Buffer.byteLength(JSON.stringify(v));
    Object.assign(v, { ignored: "x".repeat(67108864 - size) });
    const inspect = vi.spyOn(content, "inspectPackage");
    try {
        reject(v, "INVALID_PUBLICATION_INPUT");
        Object.assign(v, { ignored: "x".repeat(67108864 - size + 1) });
        reject(v, "LIMIT_EXCEEDED");
        expect(inspect).not.toHaveBeenCalled();
    }
    finally {
        vi.restoreAllMocks();
    }
}, 30000);
import * as crypto from "node:crypto";
vi.mock("node:crypto", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:crypto")>();
    return { ...actual, createHash: vi.fn(actual.createHash) };
});
it("counts lexical base index entries before hashing or candidate/package decoding", () => {
    const v = publicationInput(), i = oldRelease(v);
    const entries = Array.from({ length: 4096 }, (_, n) => ({ kind: i.kind, name: i.name, version: `1.0.${n}`, digest: i.digest, location: { type: "catalog" as const, path: `old-${n}`, revision: { type: "exact" as const, commit: BASE } } }));
    setIndex(v, JSON.stringify({ formatVersion: 1, entries }));
    v.catalogs = [{ catalogId: "other", sourceId: "team-source", commit: BASE, enabled: false, index: { formatVersion: 1, entries } }, { catalogId: "more", sourceId: "team-source", commit: BASE, enabled: false, index: { formatVersion: 1, entries: entries.slice(0, 1) } }];
    const hash = vi.spyOn(crypto, "createHash"), inspect = vi.spyOn(content, "inspectPackage"), decode = vi.spyOn(Buffer, "from");
    try {
        reject(v, "LIMIT_EXCEEDED");
        expect(hash).not.toHaveBeenCalled();
        expect(inspect).not.toHaveBeenCalled();
        const calls: readonly (readonly unknown[])[] = decode.mock.calls;
        expect(calls.filter(args => args[1] === "base64")).toHaveLength(1);
    }
    finally {
        vi.restoreAllMocks();
    }
});
