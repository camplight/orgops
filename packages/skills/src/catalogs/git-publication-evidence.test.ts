import { createHash } from "node:crypto";
import * as crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import { deflateSync } from "node:zlib";
import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as sessions from "./git-session";
import * as publicApi from "../index";
import { readGitPublicationEvidence, type GitPublicationEvidenceInput, type OfflineGitResult } from "../index";
import { createGitFixture, type GitFixture } from "./git-fixtures";

vi.mock("./git-session", async original => ({ ...await original<typeof import("./git-session")>() }));
vi.mock("node:crypto", async original => ({ ...await original<typeof import("node:crypto")>() }));
afterEach(() => vi.restoreAllMocks());
const bad = (code: sessions.OfflineGitIssue["code"], at = "git"): OfflineGitResult<never> => ({ ok: false, issues: [{ code, at }] });
function value<T>(r: OfflineGitResult<T>): T {
  expect(r.ok).toBe(true); if (!r.ok) throw new Error(`Fixture rejected: ${r.issues[0]?.code}`); return r.value;
}
const raw = (mode: string | Buffer, name: string | Buffer, oid: string) => Buffer.concat([
  Buffer.from(mode), Buffer.from(" "), Buffer.from(name), Buffer.from([0]), Buffer.from(oid, "hex"),
]);
const tree = (f: GitFixture, entries: Buffer[]) => f.object("tree", Buffer.concat(entries), true);
const commitTree = (f: GitFixture, oid: string) => f.object("commit", Buffer.from(`tree ${oid}\nauthor Fixture <fixture@example.invalid> 946684800 +0000\ncommitter Fixture <fixture@example.invalid> 946684800 +0000\n\nFixture\n`));
const read = (f: GitFixture, commit: string, indexPath = "catalog/index.json") => readGitPublicationEvidence({ repository: f.repository, commit, indexPath });
function frozen(v: unknown): void {
  if (v && typeof v === "object") {
    expect(Buffer.isBuffer(v)).toBe(false); expect(Object.isFrozen(v)).toBe(true); Object.values(v).forEach(frozen);
  }
}
// Observe the real session after fixture construction, preserving issued metadata identity and integrity.
async function traceSession() {
  const actual = (await vi.importActual<typeof sessions>("./git-session")).openGitObjectSession;
  const bodies: sessions.GitObjectInfo[] = [], infos: string[] = [];
  vi.spyOn(sessions, "openGitObjectSession").mockImplementation(async (...args) => {
    const r = await actual(...args); if (!r.ok) return r;
    const s = r.value;
    return { ok: true, value: { ...s,
      info: async oid => { infos.push(oid); return s.info(oid); },
      contents: async (record, max) => { bodies.push(record); return s.contents(record, max); },
    } };
  });
  return { bodies, infos };
}

it.each(["sha1", "sha256"] as const)("returns complete %s body evidence, not object IDs", async format => {
  const f = await createGitFixture(format);
  try {
    const index = Buffer.from('{ "formatVersion": 1, "entries": [] }\r\n'), binary = Buffer.from([0xff, 0, 10]);
    const commit = await f.commit([{ path: "catalog/index.json", bytes: index }, { path: "assets/run", bytes: binary, mode: "100755" }, { path: "README.md", bytes: Buffer.alloc(0) }]);
    const r = value(await read(f, commit));
    expect(Object.keys(r).sort()).toEqual(["commit", "indexBase64", "indexPath", "inventory"]);
    expect(r.commit).toBe(commit); expect(r.indexPath).toBe("catalog/index.json");
    expect(r.indexBase64).toBe(index.toString("base64")); expect(r.inventory.complete).toBe(true);
    expect(r.inventory.entries.map(e => e.path)).toEqual(["README.md", "assets", "assets/run", "catalog", "catalog/index.json"]);
    expect(r.inventory.entries[2]).toEqual({ type: "file", path: "assets/run", size: 3,
      digest: `sha256:${createHash("sha256").update(binary).digest("hex")}`, executable: true });
    expect(r.inventory.entries[2]).not.toHaveProperty("digest", `sha256:${createHash(format).update("blob 3\0").update(binary).digest("hex")}`);
    frozen(r);
  } finally { await f.dispose(); }
});

it.each([".", "..", "a/b", "a\\b", "CON.txt", ".git", "node_modules", "secret=hidden", "a ", "é", "x".repeat(65), Buffer.from([0xe1])])("rejects whole-tree unsafe name %# before blob bodies", async name => {
  const f = await createGitFixture();
  try {
    const blob = await f.object("blob", Buffer.from("inert"));
    const commit = await commitTree(f, await tree(f, [raw("100644", "a-safe", blob), raw("100644", name, blob)]));
    const trace = await traceSession();
    expect(await read(f, commit)).toEqual(bad("UNSAFE_PATH", "entries"));
    expect(trace.bodies.filter(b => b.type === "blob")).toEqual([]);
  } finally { await f.dispose(); }
});
it.each(["duplicate", "file-tree", "case", "directory-case"])("rejects %s sibling collision before descent", async kind => {
  const f = await createGitFixture();
  try {
    const missing = "0".repeat(40);
    const commit = await commitTree(f, await tree(f, [raw(kind === "directory-case" ? "40000" : "100644", "A", missing), raw(kind === "file-tree" || kind === "directory-case" ? "40000" : "100644", kind.includes("case") ? "a" : "A", missing)]));
    const trace = await traceSession(); expect(await read(f, commit)).toEqual(bad("DUPLICATE_PATH", "entries")); expect(trace.infos).not.toContain(missing);
  } finally { await f.dispose(); }
});
it.each(["120000", "160000", "100664", "040000", "0", "100600", "777777"])("rejects special/noncanonical %s without requesting target", async mode => {
  const f = await createGitFixture();
  try {
    const missing = "0".repeat(40);
    const commit = await commitTree(f, await tree(f, [raw(mode, "unrelated", missing)]));
    const trace = await traceSession(); expect(await read(f, commit)).toEqual(bad("UNSUPPORTED_ENTRY", "entries")); expect(trace.infos).not.toContain(missing);
  } finally { await f.dispose(); }
});
it.each(["short-oid", "trailing", "non-octal", "high-bit", "no-space", "no-nul"])("rejects malformed framing %s", async kind => {
  const f = await createGitFixture();
  try {
    const oid = "0".repeat(40), entry = raw("100644", "file", oid);
    const bytes = kind === "short-oid" ? entry.subarray(0, -1) : kind === "trailing" ? Buffer.concat([entry, Buffer.from("x")]) : kind === "no-space" ? Buffer.from("100644") : kind === "no-nul" ? Buffer.from("100644 file") : raw(kind === "non-octal" ? "100648" : Buffer.from([0xb1, 48, 48, 54, 52, 52]), "file", oid);
    expect(await read(f, await commitTree(f, await f.object("tree", bytes, true)))).toEqual(bad("GIT_PROTOCOL_ERROR"));
  } finally { await f.dispose(); }
});
it.each([240, 241])("validates full joined path length %i", async length => {
  const f = await createGitFixture();
  try {
    const parts = ["a".repeat(60), "b".repeat(60), "c".repeat(60), "d".repeat(length - 183)];
    let oid = await tree(f, []);
    for (const name of parts.reverse()) oid = await tree(f, [raw("40000", name, oid)]);
    const r = await read(f, await commitTree(f, oid));
    if (length === 241) expect(r).toEqual(bad("UNSAFE_PATH", "entries")); else expect(value(r).inventory.entries.at(-1)?.path.length).toBe(240);
  } finally { await f.dispose(); }
});
it.each(["sha1", "sha256"] as const)("includes empty %s trees and proves absent suffixes", async format => {
  const f = await createGitFixture(format);
  try {
    const empty = await tree(f, []);
    expect(value(await read(f, await commitTree(f, empty))).inventory.entries).toEqual([]);
    const commit = await commitTree(f, await tree(f, [raw("40000", "catalog", await tree(f, [raw("40000", "empty", empty)]))]));
    const r = value(await read(f, commit)); expect(r.indexBase64).toBeNull();
    expect(r.inventory.entries).toEqual([{ type: "directory", path: "catalog" }, { type: "directory", path: "catalog/empty" }]);
    expect(value(await read(f, commit, "missing/deep/index.json")).indexBase64).toBeNull();
  } finally { await f.dispose(); }
});
it.each(["case-index", "case-ancestor", "executable", "file-ancestor", "empty-directory", "directory", "special-index", "special-ancestor"])("does not misreport occupied %s as absence", async kind => {
  const f = await createGitFixture();
  try {
    const blob = await f.object("blob", Buffer.from("inert")), empty = await tree(f, []);
    const indexOid = kind === "empty-directory" ? empty : kind === "directory" ? await tree(f, [raw("100644", "child", blob)]) : blob;
    const indexMode = kind.includes("directory") ? "40000" : kind === "executable" ? "100755" : kind === "special-index" ? "120000" : "100644";
    const child = await tree(f, [raw(indexMode, kind === "case-index" ? "INDEX.json" : "index.json", indexOid)]);
    const ancestorMode = kind === "file-ancestor" ? "100644" : kind === "special-ancestor" ? "160000" : "40000";
    const commit = await commitTree(f, await tree(f, [raw(ancestorMode, kind === "case-ancestor" ? "Catalog" : "catalog", ancestorMode === "40000" ? child : blob)]));
    const trace = await traceSession();
    expect(await read(f, commit)).toEqual(bad(kind.startsWith("case") ? "UNSAFE_PATH" : "UNSUPPORTED_ENTRY", kind.startsWith("special") ? "entries" : "index"));
    expect(trace.bodies.filter(b => b.type === "blob")).toEqual([]);
  } finally { await f.dispose(); }
});
it.each([Buffer.alloc(0), Buffer.from(" \r\n"), Buffer.from('\uFEFF{"formatVersion":1,"entries":[]}'), Buffer.from([0xff, 0, 10]), Buffer.from("{broken")])("preserves exact nonsemantic index bytes %# including reserved manifest basename", async bytes => {
  const f = await createGitFixture();
  try { const commit = await f.commit([{ path: "orgops-package.json", bytes }]); expect(value(await read(f, commit, "orgops-package.json")).indexBase64).toBe(bytes.toString("base64")); }
  finally { await f.dispose(); }
});
it.each(["file", "index", "total"] as const)("enforces actual %s bytes at ceiling and +1 before any blob body", async kind => {
  const f = await createGitFixture();
  try {
    for (const extra of [0, 1]) {
      vi.restoreAllMocks();
      const files = kind === "total" ? Array.from({ length: 8 }, (_, i) => ({ path: i === 0 ? "catalog/index.json" : `f${i}`, bytes: Buffer.alloc(1048576) })) : [{ path: kind === "index" ? "catalog/index.json" : "README.md", bytes: Buffer.alloc((kind === "index" ? 2097152 : 1048576) + extra) }];
      if (kind === "total" && extra) files.push({ path: "z", bytes: Buffer.alloc(1) });
      const commit = await f.commit(files), trace = await traceSession();
      const r = await read(f, commit);
      if (extra) { expect(r).toEqual(bad("LIMIT_EXCEEDED", kind === "index" ? "index" : "entries")); expect(trace.bodies.filter(b => b.type === "blob")).toEqual([]); }
      else { expect(value(r).inventory.entries.filter(e => e.type === "file")).toHaveLength(files.length); expect(trace.bodies.filter(b => b.type === "blob")).toHaveLength(files.length); }
    }
  } finally { await f.dispose(); }
});
it.each(["missing", "wrong-type"])("preflights late unrelated %s metadata before reading any blobs", async kind => {
  const f = await createGitFixture();
  try {
    const blob = await f.object("blob", Buffer.from("inert")), other = kind === "missing" ? "0".repeat(40) : await tree(f, []);
    const commit = await commitTree(f, await tree(f, [raw("100644", "a", blob), raw("100644", "z", other)]));
    const trace = await traceSession(); expect(await read(f, commit)).toEqual(bad(kind === "missing" ? "GIT_OBJECT_MISSING" : "GIT_OBJECT_TYPE")); expect(trace.bodies.filter(b => b.type === "blob")).toEqual([]);
  } finally { await f.dispose(); }
});
it.each(["sha1", "sha256"] as const)("rehashes real %s blob/tree/commit bodies independently", async format => {
  for (const type of ["blob", "tree", "commit"] as const) {
    const f = await createGitFixture(format);
    try {
      const blobBytes = Buffer.from("one"), blob = await f.object("blob", blobBytes);
      const treeBytes = raw("100644", "file", blob), root = await f.object("tree", treeBytes, true);
      const commitBytes = Buffer.from(`tree ${root}\nauthor Fixture <fixture@example.invalid> 946684800 +0000\ncommitter Fixture <fixture@example.invalid> 946684800 +0000\n\nFixture\n`), commit = await f.object("commit", commitBytes);
      const oid = type === "blob" ? blob : type === "tree" ? root : commit;
      const changed = Buffer.from(type === "blob" ? blobBytes : type === "tree" ? treeBytes : commitBytes); changed[changed.length - 2] = changed[changed.length - 2]! ^ 1;
      const objectPath = join(f.repository.directory, "objects", oid.slice(0, 2), oid.slice(2));
      await chmod(objectPath, 0o600);
      await writeFile(objectPath, deflateSync(Buffer.concat([Buffer.from(`${type} ${changed.length}\0`), changed])));
      expect(await read(f, commit)).toEqual(bad("GIT_OBJECT_INTEGRITY"));
    } finally { await f.dispose(); }
  }
});
const input = { repository: { directory: "/never", gitExecutable: "/usr/bin/git" }, commit: "1".repeat(40), indexPath: "index.json" };
it("rejects invalid own-data inputs and pre-abort before session opening", async () => {
  const open = vi.spyOn(sessions, "openGitObjectSession"), getter = vi.fn(() => "secret");
  const supplied: unknown[] = [null, {}, { ...input, extra: true }, { ...input, indexPath: undefined }, { ...input, commit: "HEAD" }, { ...input, indexPath: "../secret" }, Object.defineProperty({ ...input }, "commit", { get: getter }), { ...input, repository: Object.defineProperty({ ...input.repository }, "directory", { get: getter }) }];
  for (const v of supplied) expect((await readGitPublicationEvidence(v as GitPublicationEvidenceInput)).ok).toBe(false);
  const controller = new AbortController(); controller.abort(); expect(await readGitPublicationEvidence(input, { signal: controller.signal })).toEqual(bad("GIT_ABORTED"));
  expect(open).not.toHaveBeenCalled(); expect(getter).not.toHaveBeenCalled();
});
it("snapshots before awaiting and returns distinct frozen detached evidence surviving fixture disposal", async () => {
  const f = await createGitFixture();
  let first, second;
  try {
    const commit = await f.commit([{ path: "index.json", bytes: Buffer.from("inert") }]);
    const supplied = { repository: { ...f.repository }, commit, indexPath: "index.json" };
    const pending = readGitPublicationEvidence(supplied);
    supplied.repository.directory = "/changed"; supplied.commit = "0".repeat(40); supplied.indexPath = "changed";
    first = value(await pending); second = value(await read(f, commit, "index.json"));
    expect(Object.isFrozen(supplied)).toBe(false); expect(Object.isFrozen(supplied.repository)).toBe(false);
  } finally { await f.dispose(); }
  expect(first).toEqual(second); expect(first).not.toBe(second); expect(first.inventory.entries).not.toBe(second.inventory.entries);
  expect(first.inventory.entries[0]).not.toBe(second.inventory.entries[0]); expect(first.indexBase64).toBe("aW5lcnQ="); frozen(first); frozen(second);
});
it("does not expose private object/process/fixture capabilities", () => {
  for (const key of ["withGitObjectReader", "createGitObjectReader", "openGitObjectSession", "createGitFixture", "readGitPackageBytes", "readGitIndexBytes"]) expect(publicApi).not.toHaveProperty(key);
});

// Expensive logical graphs only. This does not stand in for real Git integrity proof above.
function memorySession() {
  type ObjectData = { type: sessions.GitObjectInfo["type"]; bytes: Buffer; size: number };
  const objects = new Map<string, ObjectData>();
  const trace: { command: string; oid: string; type?: string }[] = [];
  const add = (type: ObjectData["type"], bytes: Buffer, size = bytes.length) => {
    const oid = (objects.size + 1).toString(16).padStart(40, "0"); objects.set(oid, { type, bytes, size }); return oid;
  };
  const addTree = (entries: Buffer[]) => add("tree", Buffer.concat(entries));
  const session: sessions.GitObjectSession = {
    objectFormat: "sha1",
    info: async oid => {
      const o = objects.get(oid); trace.push({ command: "info", oid, type: o?.type });
      return o ? { ok: true, value: Object.freeze({ oid, type: o.type, size: o.size }) } : bad("GIT_OBJECT_MISSING");
    },
    contents: async (record, max) => {
      trace.push({ command: "contents", oid: record.oid, type: record.type });
      expect(record.size).toBeLessThanOrEqual(max); return { ok: true, value: objects.get(record.oid)!.bytes };
    },
    finish: async () => ({ ok: true, value: true }), dispose: async () => ({ ok: true, value: true }),
  };
  vi.spyOn(sessions, "openGitObjectSession").mockResolvedValue({ ok: true, value: session });
  const commit = (root: string) => add("commit", Buffer.from(`tree ${root}\n\nInert\n`));
  const read = (root: string) => readGitPublicationEvidence({ ...input, commit: commit(root) });
  return { add, addTree, session, trace, read };
}
it("orders tree DFS and every repeated blob metadata/body occurrence without a package file-count limit", async () => {
  const m = memorySession(), a = m.add("blob", Buffer.from("a")), z = m.add("blob", Buffer.from("z"));
  const child = m.addTree([raw("100644", "z", z), raw("100644", "a", a)]);
  const root = m.addTree(Array.from({ length: 130 }, (_, i) => raw("40000", `d${String(i).padStart(3, "0")}`, child)).reverse());
  const r = value(await m.read(root)); expect(r.inventory.entries).toHaveLength(390);
  expect(m.trace.filter(t => t.command === "contents" && t.oid === child)).toHaveLength(130);
  const blobs = m.trace.filter(t => t.type === "blob");
  expect(blobs.map(t => t.command)).toEqual([...Array(260).fill("info"), ...Array(260).fill("contents")]);
  expect(blobs.map(t => t.oid)).toEqual(Array.from({ length: 260 }, () => [a, z]).flat());
  expect(m.trace).toHaveLength(2 * (1 + 131 + 260));
});
it.each([0, 1])("charges repeated tree occurrences at 2048 + %i", async extra => {
  const m = memorySession(); let chain = m.addTree([]);
  for (let i = 1; i < 8; i++) chain = m.addTree([raw("40000", "d", chain)]);
  const entries = Array.from({ length: 255 }, (_, i) => raw("40000", `b${i}`, chain));
  let tail = m.addTree([]);
  for (let i = 1; i < 7 + extra; i++) tail = m.addTree([raw("40000", "d", tail)]);
  entries.push(raw("40000", "tail", tail));
  const r = await m.read(m.addTree(entries));
  if (extra) expect(r).toEqual(bad("LIMIT_EXCEEDED", "entries"));
  else { expect(value(r).inventory.entries).toHaveLength(2047); expect(m.trace.filter(t => t.command === "contents" && t.type === "tree")).toHaveLength(2048); }
});
it.each([0, 1])("charges logical repeated entries at 8192 + %i", async extra => {
  const m = memorySession(), blob = m.add("blob", Buffer.alloc(0));
  const leaf = m.addTree(Array.from({ length: 4095 }, (_, i) => raw("100644", `f${i}`, blob)));
  const other = extra ? m.addTree([...Array.from({ length: 4095 }, (_, i) => raw("100644", `f${i}`, blob)), raw("100644", "extra", blob)]) : leaf;
  const r = await m.read(m.addTree([raw("40000", "a", leaf), raw("40000", "b", other)]));
  if (extra) { expect(r).toEqual(bad("LIMIT_EXCEEDED", "entries")); expect(m.trace.some(t => t.type === "blob")).toBe(false); }
  else expect(value(r).inventory.entries).toHaveLength(8192);
  // This session double deliberately has no wire budget: actual 8192 request exhaustion is separately session-tested.
});
it.each([0, 1])("preflights repeated tree byte totals at 4194304 + %i", async extra => {
  const m = memorySession();
  // Metadata-only synthetic sizes exercise the shared accounting independently of stronger entry/path constraints.
  const leaf = m.add("tree", Buffer.alloc(0), 262144);
  const rootBytes = Buffer.concat(Array.from({ length: 16 }, (_, i) => raw("40000", `d${i}`, leaf)));
  const root = m.add("tree", rootBytes, 0);
  if (extra) {
    const last = m.add("tree", Buffer.alloc(0), 1);
    const r = await m.read(m.add("tree", Buffer.concat([rootBytes, raw("40000", "z", last)]), 0));
    expect(r).toEqual(bad("LIMIT_EXCEEDED", "entries"));
    expect(m.trace.some(t => t.command === "contents" && t.oid === last)).toBe(false);
  } else expect(value(await m.read(root)).inventory.entries).toHaveLength(16);
});
it("preflights per-tree bytes before requesting the oversized tree body", async () => {
  const m = memorySession(), root = m.add("tree", Buffer.alloc(0), 262145);
  expect(await m.read(root)).toEqual(bad("LIMIT_EXCEEDED", "entries"));
  expect(m.trace.some(t => t.command === "contents" && t.type === "tree")).toBe(false);
});
it.each(["confirmed", "failed", "throw"] as const)("awaits evidence disposal and selects %s cleanup outcome", async cleanup => {
  const m = memorySession(), root = m.addTree([]), controller = new AbortController();
  let release!: () => void;
  m.session.dispose = async () => {
    await new Promise<void>(resolve => { release = resolve; });
    if (cleanup !== "confirmed") controller.abort();
    if (cleanup === "throw") throw new Error("secret=disposal");
    return cleanup === "failed" ? bad("GIT_CLEANUP_FAILED") : { ok: true, value: true };
  };
  let settled = false;
  const commit = m.add("commit", Buffer.from(`tree ${root}\n`));
  const pending = readGitPublicationEvidence({ ...input, commit }, { signal: controller.signal }).then(r => { settled = true; return r; });
  await vi.waitFor(() => expect(release).toBeTypeOf("function")); expect(settled).toBe(false);
  release(); const r = await pending;
  if (cleanup === "confirmed") frozen(value(r)); else expect(r).toEqual(bad("GIT_CLEANUP_FAILED"));
});
it.each(["hash-abort", "hash-timeout", "freeze-abort", "freeze-timeout"])("suppresses success after late %s", async kind => {
  const m = memorySession(), blob = m.add("blob", Buffer.from("x")), root = m.addTree([raw("100644", "index.json", blob)]);
  const controller = new AbortController();
  const stop = () => { if (kind.endsWith("abort")) controller.abort(); else vi.spyOn(performance, "now").mockReturnValue(1e12); };
  if (kind.startsWith("hash")) {
    const actual = (await vi.importActual<typeof crypto>("node:crypto")).createHash;
    vi.spyOn(crypto, "createHash").mockImplementation((...args) => { const hash = actual(...args); stop(); return hash; });
  } else {
    const actual = Object.freeze;
    vi.spyOn(Object, "freeze").mockImplementation((v: unknown) => {
      const result = actual(v);
      if (v && typeof v === "object" && "inventory" in v) stop();
      return result;
    });
  }
  const commit = m.add("commit", Buffer.from(`tree ${root}\n`));
  expect(await readGitPublicationEvidence({ ...input, commit }, { signal: controller.signal })).toEqual(bad(kind.endsWith("abort") ? "GIT_ABORTED" : "GIT_TIMEOUT"));
});
it("documents stronger path/request/output ceilings with conservative arithmetic", () => {
  // Shortest nonroot paths have depth <=120 under 240 ASCII characters; treeDepth240 cannot bind first.
  expect(Array(120).fill("a").join("/").length).toBe(239);
  expect(Array(121).fill("a").join("/").length).toBe(241);
  expect(2 * (1 + 1 + 4094)).toBe(8192);
  expect(2 * (1 + 1 + 4095)).toBe(8194);
  const largestEntry = { type: "file", path: "a".repeat(240), size: 2097152, digest: `sha256:${"f".repeat(64)}`, executable: false };
  expect(Buffer.byteLength(JSON.stringify(largestEntry))).toBeLessThan(512);
  expect(8192 * 512 + 4 * Math.ceil(2097152 / 3) + 1024).toBeLessThan(8388608);
  expect(8388608 + 4194304 + 262144 + 8192 * 129 + 32).toBe(13901856);
  expect(13901856).toBeLessThan(16777216);
});
it.each(["envelope", "entry", "base64", "exact", "final"])("checks serialized %s accounting with private mocked lower ceiling only", async kind => {
  const f = await createGitFixture();
  try {
    const commit = await f.commit([{ path: "index.json", bytes: Buffer.from("123456789") }]);
    const expected = value(await read(f, commit, "index.json"));
    const exact = Buffer.byteLength(JSON.stringify(expected));
    // Module initialization only: intercept its frozen constant, never add a public budget override.
    vi.resetModules();
    let privateLimits: object | undefined;
    const freeze = Object.freeze;
    vi.spyOn(Object, "freeze").mockImplementation((v: unknown) => {
      if (v && typeof v === "object" && "outputJsonBytes" in v && "indexBytes" in v) {
        privateLimits = v;
        Reflect.set(v, "outputJsonBytes", kind === "envelope" ? 1 : kind === "entry" ? 160 : kind === "base64" ? exact - 1 : exact);
        return v; // Only this test's private module constant stays mutable for final-guard fault injection.
      }
      return freeze(v);
    });
    const fresh = await import("./git-publication-evidence");
    expect(privateLimits).toBeDefined();
    if (kind === "final") {
      const stringify = JSON.stringify;
      vi.spyOn(JSON, "stringify").mockImplementation((v, replacer, space) => {
        const out = stringify(v, replacer, space);
        if (v && typeof v === "object" && "inventory" in v && "indexBase64" in v && v.indexBase64 !== null) Reflect.set(privateLimits!, "outputJsonBytes", exact - 1);
        return out;
      });
    }
    const r = await fresh.readGitPublicationEvidence({ repository: f.repository, commit, indexPath: "index.json" });
    if (kind === "exact") expect(value(r)).toEqual(expected); else expect(r).toEqual(bad("LIMIT_EXCEEDED", "entries"));
  } finally { vi.restoreAllMocks(); vi.resetModules(); await f.dispose(); }
});
