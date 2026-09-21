import { afterEach, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as sessions from "./git-session";
import { createGitFixture, type GitFixture } from "./git-fixtures";
import { readGitPackageBytes, readGitIndexBytes } from "./git-objects";
import { skillManifest, skillEntries, catalogIndex } from "./fixtures";
import type { GitPackageInput, OfflineGitResult } from "./git-session";

vi.mock("node:child_process", async original => {
  const actual = await original<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});
vi.mock("node:fs/promises", async original => ({ ...await original<typeof import("node:fs/promises")>() }));
vi.mock("./git-session", async original => ({ ...await original<typeof import("./git-session")>() }));
afterEach(() => vi.restoreAllMocks());
const bad = (code: string, at = "git") => ({ ok: false, issues: [{ code, at }] });
function value<T>(result: OfflineGitResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`Fixture rejected: ${result.issues[0]?.code}`);
  return result.value;
}
const manifest = Buffer.from(JSON.stringify(skillManifest));
const readPackage = (fixture: GitFixture, commit: string, path = "pkg") =>
  readGitPackageBytes({ repository: fixture.repository, commit, path }, sessions.createGitOperation());
const rawEntry = (mode: string | Buffer, name: string | Buffer, oid: string) => Buffer.concat([
  Buffer.from(mode), Buffer.from(" "), Buffer.from(name), Buffer.from([0]), Buffer.from(oid, "hex"),
]);
const tree = (f: GitFixture, entries: Buffer[]) => f.object("tree", Buffer.concat(entries), true);
const commitTree = (f: GitFixture, oid: string) => f.object("commit", Buffer.from(`tree ${oid}\nauthor Fixture <fixture@example.invalid> 946684800 +0000\ncommitter Fixture <fixture@example.invalid> 946684800 +0000\n\nFixture\n`));
async function packageTree(f: GitFixture, entries: Buffer[], includeManifest = true) {
  const m = await f.object("blob", manifest);
  const pkg = await tree(f, [...entries, ...(includeManifest ? [rawEntry("100644", "orgops-package.json", m)] : [])]);
  return commitTree(f, await tree(f, [rawEntry("40000", "pkg", pkg)]));
}

it.each(["sha1", "sha256"] as const)("returns complete selected package and explicit index from installed %s Git", async format => {
  const fixture = await createGitFixture(format);
  try {
    const index = Buffer.from(JSON.stringify(catalogIndex));
    const unselected = await fixture.object("blob", Buffer.alloc(1048577));
    const commit = await fixture.commit([
      { path: "packages/echo-skill/orgops-package.json", bytes: manifest },
      ...skillEntries.flatMap(e => e.type === "file" ? [{ path: `packages/echo-skill/${e.path}`, bytes: Buffer.from(e.base64, "base64") }] : []),
      { path: "catalog/index.json", bytes: index }, { path: "unselected/large.bin", bytes: Buffer.alloc(1048577) },
    ]);
    const trace: string[] = [];
    const actualSpawn = (await vi.importActual<typeof import("node:child_process")>("node:child_process")).spawn;
    const children: ReturnType<typeof spawn>[] = [];
    vi.mocked(spawn).mockImplementation(((...args: Parameters<typeof spawn>) => {
      expect(children.every(c => c.exitCode !== null || c.signalCode !== null)).toBe(true);
      const child = actualSpawn(...args); children.push(child);
      const write = child.stdin!.write.bind(child.stdin!);
      vi.spyOn(child.stdin!, "write").mockImplementation(((chunk: string, ...rest: unknown[]) => {
        trace.push(String(chunk)); return Reflect.apply(write, child.stdin, [chunk, ...rest]);
      }) as NonNullable<typeof child.stdin>["write"]);
      return child;
    }) as typeof spawn);
    expect(await readPackage(fixture, commit, "packages/echo-skill")).toEqual({ ok: true, value: { manifest, entries: skillEntries } });
    expect(children).toHaveLength(2);
    expect(trace.join("")).not.toContain(unselected);
    expect(trace.every(line => /^(info|contents) [0-9a-f]{40}(?:[0-9a-f]{24})?\n$/.test(line))).toBe(true);
    expect(value(await readGitIndexBytes({ repository: fixture.repository, commit, indexPath: "catalog/index.json" }, sessions.createGitOperation())).equals(index)).toBe(true);
    expect(children).toHaveLength(4);
    expect(children.every(c => c.exitCode === 0)).toBe(true);
    console.log(`selected-${format}: processes=${children.length} requests=${trace.length}; unselected blob absent; all children reaped`);
  } finally { await fixture.dispose(); }
});
it.each(["HEAD", "main", "abc123", "A".repeat(40), "--all", "1".repeat(40) + "^{commit}", "1".repeat(40) + "\n"])("rejects nonliteral commit %# before fs/session access", async commit => {
  const open = vi.spyOn(sessions, "openGitObjectSession"); const stat = vi.spyOn(fs, "lstat");
  expect(await readGitPackageBytes({ repository: { directory: "/never", gitExecutable: "/usr/bin/git" }, commit, path: "pkg" }, sessions.createGitOperation())).toEqual(bad("INVALID_GIT_INPUT", "commit"));
  expect(open).not.toHaveBeenCalled(); expect(stat).not.toHaveBeenCalled();
});
it.each([".", "../secret=hidden", "/pkg", "a//b", "a\\b", "a/CON", "node_modules/x", "a ", "é", "a".repeat(241)])("rejects unsafe selector %# before fs/session access", async path => {
  const open = vi.spyOn(sessions, "openGitObjectSession"); const stat = vi.spyOn(fs, "lstat");
  const repository = { directory: "/never", gitExecutable: "/usr/bin/git" };
  expect(await readGitPackageBytes({ repository, commit: "1".repeat(40), path }, sessions.createGitOperation())).toEqual(bad("UNSAFE_PATH", "path"));
  expect(await readGitIndexBytes({ repository, commit: "1".repeat(40), indexPath: path }, sessions.createGitOperation())).toEqual(bad("UNSAFE_PATH", "path"));
  expect(open).not.toHaveBeenCalled(); expect(stat).not.toHaveBeenCalled();
});
it.each(["blob", "tree", "tag"] as const)("does not peel literal %s input OID", async type => {
  const f = await createGitFixture();
  try {
    const blob = await f.object("blob", Buffer.alloc(0));
    const oid = await f.object(type, type === "tag" ? Buffer.from(`object ${blob}\ntype blob\ntag example\ntagger Fixture <fixture@example.invalid> 946684800 +0000\n\nInert\n`) : Buffer.alloc(0));
    expect(await readPackage(f, oid)).toEqual(bad("GIT_OBJECT_TYPE"));
  } finally { await f.dispose(); }
});
it("rejects non-data envelopes and repositories without invoking accessors or opening a session", async () => {
  const input = { repository: { directory: "/never", gitExecutable: "/usr/bin/git" }, commit: "1".repeat(40), path: "pkg" };
  const getter = vi.fn(() => "secret");
  const open = vi.spyOn(sessions, "openGitObjectSession");
  for (const supplied of [null, [], {}, { ...input, extra: true }, { ...input, path: undefined },
    Object.defineProperty({ ...input }, "commit", { get: getter }),
    { ...input, repository: Object.defineProperty({ ...input.repository }, "directory", { get: getter }) },
    { ...input, repository: { ...input.repository, extra: true } },
    { ...input, repository: { ...input.repository, directory: "relative" } },
    { ...input, repository: { ...input.repository, gitExecutable: "" } }]) {
    expect((await readGitPackageBytes(supplied as GitPackageInput, sessions.createGitOperation())).ok).toBe(false);
  }
  expect(getter).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
});
it.each(["120000", "160000", "100664", "040000", "0", "100600", "777777"])("rejects raw package mode %s without normalization", async mode => {
  const f = await createGitFixture();
  try { const blob = await f.object("blob", Buffer.from("inert"));
    expect(await readPackage(f, await packageTree(f, [rawEntry(mode, "item", blob)]))).toEqual(bad("UNSUPPORTED_ENTRY", "entries"));
  } finally { await f.dispose(); }
});
it.each([".", "..", "/absolute", "a/b", "a\\b", "a ", "a\tb", "a\nb", ".git", ".orgops-data", "node_modules", "CON.txt", "a%20b", "é", "secret=hidden", "x".repeat(65), Buffer.from([255])])("rejects unsafe selected raw name %# with fixed pointer", async name => {
  const f = await createGitFixture();
  try { const blob = await f.object("blob", Buffer.alloc(0));
    expect(await readPackage(f, await packageTree(f, [rawEntry("100644", name, blob)]))).toEqual(bad("UNSAFE_PATH", "entries"));
  } finally { await f.dispose(); }
});
it.each(["duplicate", "file-tree", "case-fold", "directory-case"])("rejects %s collision before following content", async kind => {
  const f = await createGitFixture();
  try {
    const blob = await f.object("blob", Buffer.alloc(0));
    const child = await tree(f, [rawEntry("100644", "x", blob)]);
    const entries = kind === "directory-case" ? [rawEntry("40000", "A", child), rawEntry("40000", "a", child)] :
      [rawEntry("100644", "item", blob), rawEntry(kind === "file-tree" ? "40000" : "100644", kind === "case-fold" ? "ITEM" : "item", child)];
    expect(await readPackage(f, await packageTree(f, entries))).toEqual(bad("DUPLICATE_PATH", "entries"));
  } finally { await f.dispose(); }
});
it.each(["variant", "directory", "executable", "missing", "twins"])("enforces root manifest %s semantics", async kind => {
  const f = await createGitFixture();
  try {
    const blob = await f.object("blob", manifest);
    const entries = kind === "missing" ? [] : [rawEntry(kind === "directory" ? "40000" : kind === "executable" ? "100755" : "100644", kind === "variant" || kind === "twins" ? "ORGOPS-PACKAGE.JSON" : "orgops-package.json", blob)];
    expect(await readPackage(f, await packageTree(f, entries, kind === "twins"))).toEqual(bad(
      kind === "missing" ? "GIT_PATH_MISSING" : kind === "executable" ? "UNSUPPORTED_ENTRY" : kind === "twins" ? "DUPLICATE_PATH" : "UNSAFE_PATH", kind === "twins" ? "entries" : "manifest"));
  } finally { await f.dispose(); }
});
it("keeps binary, empty, executable, nested manifest, attributes and LFS/module text inert", async () => {
  const f = await createGitFixture();
  try {
    const bytes = Buffer.from([255, 0, 10]);
    const files = [".gitattributes", ".gitmodules", "assets/orgops-package.json", "binary", "empty", "script"].map(path => ({ path: `pkg/${path}`, bytes: path === "binary" ? bytes : path === "empty" ? Buffer.alloc(0) : Buffer.from("version https://git-lfs.github.com/spec/v1\nthrow new Error('never run')\n"), mode: path === "script" ? "100755" as const : "100644" as const }));
    const result = value(await readPackage(f, await f.commit([...files, { path: "pkg/orgops-package.json", bytes: manifest }])));
    expect(result.entries).toEqual(files.map(file => ({ type: "file", path: file.path.slice(4), base64: file.bytes.toString("base64"), executable: file.mode === "100755" })));
  } finally { await f.dispose(); }
});
it("rejects empty child trees but permits a manifest-only root", async () => {
  const f = await createGitFixture();
  try {
    expect(value(await readPackage(f, await packageTree(f, []))).entries).toEqual([]);
    const empty = await tree(f, []);
    expect(await readPackage(f, await packageTree(f, [rawEntry("40000", "empty", empty)]))).toEqual(bad("UNSUPPORTED_ENTRY", "entries"));
  } finally { await f.dispose(); }
});
it.each(["missing-commit", "missing-tree", "missing-blob", "tree-is-blob", "blob-is-tree", "parent-mode", "missing-path", "ancestor-twin"])("selects exact objects and distinguishes %s", async kind => {
  const f = await createGitFixture();
  try {
    const missing = "0".repeat(40), blob = await f.object("blob", manifest), empty = await tree(f, []);
    let commit: string;
    if (kind === "missing-commit") commit = missing;
    else if (kind === "missing-tree" || kind === "tree-is-blob") commit = await commitTree(f, kind === "missing-tree" ? missing : blob);
    else if (kind === "missing-blob" || kind === "blob-is-tree") commit = await packageTree(f, [rawEntry("100644", "item", kind === "missing-blob" ? missing : empty)]);
    else {
      const pkg = await tree(f, [rawEntry("100644", "orgops-package.json", blob)]);
      commit = await commitTree(f, await tree(f, [rawEntry(kind === "parent-mode" ? "040000" : "40000", kind === "missing-path" ? "other" : "pkg", pkg), ...(kind === "ancestor-twin" ? [rawEntry("40000", "PKG", pkg)] : [])]));
    }
    expect(await readPackage(f, commit)).toEqual(bad(kind.startsWith("missing-") && kind !== "missing-path" ? "GIT_OBJECT_MISSING" : kind.endsWith("is-blob") || kind.endsWith("is-tree") ? "GIT_OBJECT_TYPE" : kind === "parent-mode" ? "UNSUPPORTED_ENTRY" : kind === "ancestor-twin" ? "DUPLICATE_PATH" : "GIT_PATH_MISSING", ["parent-mode", "missing-path", "ancestor-twin"].includes(kind) ? "path" : "git"));
  } finally { await f.dispose(); }
});
it("ignores unrelated unsafe ancestor siblings, including high-bit ASCII aliases", async () => {
  const f = await createGitFixture();
  try {
    const blob = await f.object("blob", manifest), missing = "0".repeat(40);
    const pkg = await tree(f, [rawEntry("100644", "orgops-package.json", blob)]);
    const root = await tree(f, [rawEntry("120000", "../secret", missing), rawEntry("777", Buffer.from([0xf0, 0xeb, 0xe7]), missing), rawEntry("40000", "pkg", pkg)]);
    expect(value(await readPackage(f, await commitTree(f, root))).entries).toEqual([]);
    const aliasOnly = await tree(f, [rawEntry("40000", Buffer.from([0xf0, 0xeb, 0xe7]), pkg)]);
    expect(await readPackage(f, await commitTree(f, aliasOnly))).toEqual(bad("GIT_PATH_MISSING", "path"));
  } finally { await f.dispose(); }
});
it.each(["no-space", "no-nul", "short-oid", "empty-mode", "empty-name", "non-octal", "high-bit"])("rejects raw tree structure %s", async kind => {
  const f = await createGitFixture();
  try {
    const blob = await f.object("blob", manifest);
    const bytes = kind === "no-space" ? Buffer.from("100644") : kind === "no-nul" ? Buffer.from("100644 item") : kind === "short-oid" ? Buffer.from("100644 item\0x") :
      rawEntry(kind === "empty-mode" ? "" : kind === "non-octal" ? "100648" : kind === "high-bit" ? Buffer.from([0xb1, 48, 48, 54, 52, 52]) : "100644", kind === "empty-name" ? "" : "item", blob);
    expect(await readPackage(f, await commitTree(f, await f.object("tree", bytes, true)))).toEqual(bad("GIT_PROTOCOL_ERROR"));
  } finally { await f.dispose(); }
});
it.each(["100755", "120000", "40000"])("rejects final index mode %s without reading siblings", async mode => {
  const f = await createGitFixture();
  try {
    const blob = await f.object("blob", Buffer.from("index"));
    const commit = await commitTree(f, await tree(f, [rawEntry(mode, "index.json", blob), rawEntry("120000", "unrelated", "0".repeat(40))]));
    expect(await readGitIndexBytes({ repository: f.repository, commit, indexPath: "index.json" }, sessions.createGitOperation())).toEqual(bad("UNSUPPORTED_ENTRY", "index"));
  } finally { await f.dispose(); }
});
it.each([0, 1])("enforces file count 256 + %i outside manifest", async extra => {
  const f = await createGitFixture();
  try {
    const blob = await f.object("blob", Buffer.alloc(0));
    const commit = await packageTree(f, Array.from({ length: 256 + extra }, (_, i) => rawEntry("100644", `f${i}`, blob)));
    const result = await readPackage(f, commit);
    if (extra) expect(result).toEqual(bad("LIMIT_EXCEEDED", "entries")); else expect(value(result).entries).toHaveLength(256);
  } finally { await f.dispose(); }
});
it.each(["manifest", "index", "file", "total"] as const)("enforces real %s bytes at limit and +1 before content reads", async kind => {
  const f = await createGitFixture();
  try {
    for (const extra of [0, 1]) {
      const limit = kind === "manifest" ? 262144 : kind === "index" ? 2097152 : 1048576;
      const files = kind === "total" ? Array.from({ length: 8 }, (_, i) => ({ path: `pkg/f${i}`, bytes: Buffer.alloc(limit) })) : [];
      if (kind === "total" && extra) files.push({ path: "pkg/last", bytes: Buffer.alloc(1) });
      if (kind === "file") files.push({ path: "pkg/file", bytes: Buffer.alloc(limit + extra) });
      files.push({ path: kind === "index" ? "index.json" : "pkg/orgops-package.json", bytes: kind === "manifest" || kind === "index" ? Buffer.alloc(limit + extra) : manifest });
      const commit = await f.commit(files);
      const result = kind === "index" ? await readGitIndexBytes({ repository: f.repository, commit, indexPath: "index.json" }, sessions.createGitOperation()) : await readPackage(f, commit);
      if (extra) expect(result).toEqual(bad("LIMIT_EXCEEDED", kind === "manifest" ? "manifest" : kind === "index" ? "index" : "entries")); else expect(result.ok).toBe(true);
    }
  } finally { await f.dispose(); }
});

// Fake storage is only for otherwise expensive metadata graphs and reader-local lifecycle faults.
// Raw parsing/traversal is the production reader; ordinary and malicious finite trees above use Git.
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
    info: vi.fn<sessions.GitObjectSession["info"]>(async oid => {
      const object = objects.get(oid); trace.push({ command: "info", oid, type: object?.type });
      return object ? { ok: true, value: Object.freeze({ oid, type: object.type, size: object.size }) } : bad("GIT_OBJECT_MISSING") as sessions.OfflineGitResult<sessions.GitObjectInfo>;
    }),
    contents: vi.fn<sessions.GitObjectSession["contents"]>(async (record, max) => {
      trace.push({ command: "contents", oid: record.oid, type: record.type });
      expect(record.size).toBeLessThanOrEqual(max);
      return { ok: true, value: objects.get(record.oid)!.bytes };
    }),
    finish: vi.fn<sessions.GitObjectSession["finish"]>(async () => ({ ok: true, value: true })),
    dispose: vi.fn<sessions.GitObjectSession["dispose"]>(async () => ({ ok: true, value: true })),
  };
  vi.spyOn(sessions, "openGitObjectSession").mockResolvedValue({ ok: true, value: session });
  const commit = (root: string) => add("commit", Buffer.from(`tree ${root}\n\nInert\n`));
  const repository = { directory: "/memory-only", gitExecutable: "/usr/bin/git" };
  const read = (oid: string, path = "pkg", operation = sessions.createGitOperation()) => readGitPackageBytes({ repository, commit: oid, path }, operation);
  const pkg = (entries: Buffer[]) => commit(addTree([rawEntry("40000", "pkg", addTree(entries))]));
  return { objects, add, addTree, session, trace, commit, repository, read, pkg };
}
it.each(["late-size", "late-type", "repeated-total", "missing-manifest", "late-unsafe"])("never reads any package blob when %s invalidates complete inventory", async kind => {
  const m = memorySession();
  const manifestOid = m.add("blob", manifest);
  const first = m.add("blob", Buffer.from("first"), kind === "repeated-total" ? 1048576 : 5);
  const late = m.add(kind === "late-type" ? "tree" : "blob", Buffer.alloc(0), kind === "late-size" ? 1048577 : 0);
  const entries = kind === "repeated-total" ? Array.from({ length: 9 }, (_, i) => rawEntry("100644", `a${i}`, first)) :
    [rawEntry("100644", "a", first), rawEntry("100644", kind === "late-unsafe" ? "z secret=hidden" : "z", late)];
  if (kind !== "missing-manifest") entries.push(rawEntry("100644", "orgops-package.json", manifestOid));
  const result = await m.read(m.pkg(entries));
  expect(result).toEqual(bad(kind === "late-type" ? "GIT_OBJECT_TYPE" : kind === "missing-manifest" ? "GIT_PATH_MISSING" : kind === "late-unsafe" ? "UNSAFE_PATH" : "LIMIT_EXCEEDED", kind === "late-type" ? "git" : kind === "missing-manifest" ? "manifest" : "entries"));
  expect(m.trace.some(e => e.command === "contents" && e.type === "blob")).toBe(false);
  expect(m.session.finish).not.toHaveBeenCalled(); expect(m.session.dispose).toHaveBeenCalledTimes(1);
});
it("reads all blob metadata and contents in path order after deterministic depth-first trees", async () => {
  const m = memorySession(); const blob = m.add("blob", Buffer.from("x")), man = m.add("blob", manifest);
  const b = m.addTree([rawEntry("100644", "y", blob)]), a = m.addTree([rawEntry("100644", "z", blob)]);
  const commit = m.pkg([rawEntry("40000", "b", b), rawEntry("100644", "orgops-package.json", man), rawEntry("40000", "a", a)]);
  expect(value(await m.read(commit)).entries.map(e => e.path)).toEqual(["a/z", "b/y"]);
  expect(m.trace.filter(e => e.command === "contents" && [a, b].includes(e.oid)).map(e => e.oid)).toEqual([a, b]);
  const blobs = m.trace.filter(e => e.type === "blob");
  expect(blobs.map(e => [e.command, e.oid])).toEqual([["info", blob], ["info", blob], ["info", man], ["contents", blob], ["contents", blob], ["contents", man]]);
});
it.each(["prefix", "uppercase", "high-bit-prefix", "high-bit-oid", "short", "missing-lf"])("rejects commit first line %s before any tree read", async kind => {
  const m = memorySession(); const tree = "a".repeat(40);
  let bytes = Buffer.from(`tree ${tree}\n\n`);
  if (kind === "prefix") bytes = Buffer.from(`parent ${tree}\ntree ${tree}\n`);
  if (kind === "uppercase") bytes = Buffer.from(`tree ${tree.toUpperCase()}\n`);
  if (kind === "high-bit-prefix") bytes[0] = 0xf4;
  if (kind === "high-bit-oid") bytes[5] = 0xe1;
  if (kind === "short") bytes = Buffer.from("tree a\n");
  if (kind === "missing-lf") bytes = Buffer.from(`tree ${tree}`);
  expect(await m.read(m.add("commit", bytes))).toEqual(bad("GIT_PROTOCOL_ERROR"));
  expect(m.trace).toHaveLength(2);
});
it.each([0, 1])("bounds commit bytes at 262144 + %i", async extra => {
  const m = memorySession(); const man = m.add("blob", manifest), pkg = m.addTree([rawEntry("100644", "orgops-package.json", man)]), root = m.addTree([rawEntry("40000", "pkg", pkg)]);
  const commit = m.add("commit", Buffer.from(`tree ${root}\n`.padEnd(262144 + extra, "x")));
  const result = await m.read(commit);
  if (extra) { expect(result).toEqual(bad("LIMIT_EXCEEDED", "commit")); expect(m.trace).toHaveLength(1); }
  else expect(result.ok).toBe(true);
});
it.each([0, 1])("preflights a real raw tree at 262144 + %i bytes", async extra => {
  const f = await createGitFixture();
  try {
    const blob = await f.object("blob", manifest), pkg = await tree(f, [rawEntry("100644", "orgops-package.json", blob)]);
    const selected = rawEntry("40000", "pkg", pkg);
    // An enormous unrelated name is structurally counted, never decoded as selected content.
    const sibling = rawEntry("100644", Buffer.alloc(262144 + extra - selected.length - 28, 120), "0".repeat(40));
    expect(selected.length + sibling.length).toBe(262144 + extra);
    const result = await readPackage(f, await commitTree(f, await tree(f, [selected, sibling])));
    if (extra) expect(result).toEqual(bad("LIMIT_EXCEEDED", "entries")); else expect(result.ok).toBe(true);
  } finally { await f.dispose(); }
});
it.each([0, 1])("charges ancestor sibling entries at aggregate 8192 + %i", async extra => {
  const m = memorySession(), man = m.add("blob", manifest);
  const pkg = m.addTree([rawEntry("100644", "orgops-package.json", man)]);
  const middle = m.addTree([rawEntry("40000", "pkg", pkg), ...Array.from({ length: 4094 + extra }, () => rawEntry("100644", "x", "0".repeat(40)))]);
  const root = m.addTree([rawEntry("40000", "parent", middle), ...Array.from({ length: 4095 }, () => rawEntry("100644", "x", "0".repeat(40)))]);
  // 4096 root + 4095 middle + 1 package = 8192; repeated unrelated names are not selected.
  const result = await m.read(m.commit(root), "parent/pkg");
  if (extra) expect(result).toEqual(bad("LIMIT_EXCEEDED", "entries")); else expect(result.ok).toBe(true);
});
it.each([0, 1])("charges repeated tree occurrences at 2048 + %i", async extra => {
  const m = memorySession(), man = m.add("blob", manifest), blob = m.add("blob", Buffer.alloc(0));
  let chain = m.addTree([rawEntry("100644", "x", blob)]);
  // Eight occurrences per branch, repeated OIDs at distinct inventory paths count each time.
  for (let i = 1; i < 8; i++) chain = m.addTree([rawEntry("40000", "d", chain)]);
  const entries = Array.from({ length: 255 }, (_, i) => rawEntry("40000", `b${i}`, chain));
  let tail = m.addTree([rawEntry("100644", "x", blob)]);
  for (let i = 1; i < 6 + extra; i++) tail = m.addTree([rawEntry("40000", "d", tail)]);
  entries.push(rawEntry("40000", "tail", tail), rawEntry("100644", "orgops-package.json", man));
  // root + package + 255*8 + (6+extra) = 2048+extra; 256 files + manifest.
  const result = await m.read(m.pkg(entries));
  if (extra) { expect(result).toEqual(bad("LIMIT_EXCEEDED", "entries")); expect(m.trace.some(e => e.command === "contents" && e.type === "blob")).toBe(false); }
  else expect(value(result).entries).toHaveLength(256);
});
it.each([0, 1])("charges total raw tree bytes at 4194304 + %i before contents", async extra => {
  const m = memorySession(), man = m.add("blob", manifest);
  let oid = m.addTree([rawEntry("100644", "orgops-package.json", man)]);
  const packageSize = m.objects.get(oid)!.size;
  for (let i = 0; i < 16; i++) {
    const selected = rawEntry("40000", "p", oid);
    const size = i === 0 ? 262144 - packageSize + extra : 262144;
    const sibling = rawEntry("100644", Buffer.alloc(size - selected.length - 28, 120), "0".repeat(40));
    oid = m.addTree([selected, sibling]);
  }
  const result = await m.read(m.commit(oid), Array(16).fill("p").join("/"));
  if (extra) expect(result).toEqual(bad("LIMIT_EXCEEDED", "entries")); else expect(result.ok).toBe(true);
});
it("accepts independent 240-character selector and relative paths without combined revalidation", async () => {
  const f = await createGitFixture();
  try {
    const blob = await f.object("blob", Buffer.from("bytes"));
    const man = await f.object("blob", manifest);
    const relative = ["a".repeat(60), "b".repeat(60), "c".repeat(60), "d".repeat(57)].join("/");
    const selector = ["w".repeat(60), "x".repeat(60), "y".repeat(60), "z".repeat(57)].join("/");
    let child = blob;
    for (const [i, name] of relative.split("/").reverse().entries()) child = await tree(f, [rawEntry(i === 0 ? "100644" : "40000", name, child), ...(i === 3 ? [rawEntry("100644", "orgops-package.json", man)] : [])]);
    for (const name of selector.split("/").reverse()) child = await tree(f, [rawEntry("40000", name, child)]);
    const result = value(await readPackage(f, await commitTree(f, child), selector));
    expect(result.entries).toEqual([{ type: "file", path: relative, base64: "Ynl0ZXM=", executable: false }]);
  } finally { await f.dispose(); }
});
it("portable path bounds dominate total depth and reader request/stdout budgets", async () => {
  const m = memorySession(), blob = m.add("blob", Buffer.alloc(0)), man = m.add("blob", manifest);
  const path = [...Array(119).fill("p"), "pp"].join("/");
  let child = m.addTree([rawEntry("100644", "pp", blob)]);
  for (let i = 1; i < 120; i++) child = m.addTree([rawEntry("40000", "p", child), ...(i === 119 ? [rawEntry("100644", "orgops-package.json", man)] : [])]);
  for (const name of path.split("/").reverse()) child = m.addTree([rawEntry("40000", name, child)]);
  expect(value(await m.read(m.commit(child), path)).entries[0]!.path).toBe(path);
  expect(await m.read(m.commit(child), `${path}x`)).toEqual(bad("UNSAFE_PATH", "path"));
  // At most 120 selector + 120 relative components; the final blob is not a tree.
  expect(120 + 120).toBeLessThanOrEqual(sessions.OFFLINE_GIT_LIMITS.treeDepth);
  const commands = 2 * (1 + 2048 + 257);
  expect(commands).toBeLessThan(sessions.OFFLINE_GIT_LIMITS.commands);
  expect(commands * 74).toBeLessThan(sessions.OFFLINE_GIT_LIMITS.stdinBytes);
  expect(262144 + 4194304 + 262144 + 8388608 + commands * 129 + 32).toBeLessThan(sessions.OFFLINE_GIT_LIMITS.stdoutBytes);
});
it.each(["success", "path", "protocol", "finish", "throw"])("awaits disposal and overrides %s only on unconfirmed cleanup", async which => {
  for (const incomplete of [false, true]) {
    const m = memorySession(), man = m.add("blob", manifest);
    const commit = m.pkg([rawEntry("100644", "orgops-package.json", man)]);
    if (which === "protocol") vi.mocked(m.session.info).mockResolvedValueOnce(bad("GIT_PROTOCOL_ERROR") as sessions.OfflineGitResult<sessions.GitObjectInfo>);
    if (which === "finish") vi.mocked(m.session.finish).mockResolvedValue(bad("GIT_FAILED") as sessions.OfflineGitResult<true>);
    if (which === "throw") vi.mocked(m.session.info).mockRejectedValueOnce(new Error("secret=reader-local-cause"));
    let release!: () => void;
    vi.mocked(m.session.dispose).mockImplementation(async () => {
      await new Promise<void>(resolve => { release = resolve; });
      return incomplete ? bad("GIT_CLEANUP_FAILED") as sessions.OfflineGitResult<true> : { ok: true, value: true };
    });
    let settled = false;
    const pending = m.read(commit, which === "path" ? "missing" : "pkg").then(result => { settled = true; return result; });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(settled).toBe(false); release();
    const result = await pending;
    if (incomplete) expect(result).toEqual(bad("GIT_CLEANUP_FAILED"));
    else if (which === "success") expect(result.ok).toBe(true);
    else expect(result).toEqual(bad(which === "path" ? "GIT_PATH_MISSING" : which === "protocol" ? "GIT_PROTOCOL_ERROR" : "GIT_FAILED", which === "path" ? "path" : "git"));
  }
});
it.each(["abort", "timeout"])("stops further reads after %s between metadata requests", async kind => {
  const m = memorySession(), man = m.add("blob", manifest), first = m.add("blob", Buffer.alloc(0));
  const commit = m.pkg([rawEntry("100644", "a", first), rawEntry("100644", "orgops-package.json", man)]);
  const controller = new AbortController(); const operation = sessions.createGitOperation(controller.signal);
  vi.mocked(m.session.info).mockImplementation(async oid => {
    const object = m.objects.get(oid)!;
    m.trace.push({ command: "info", oid, type: object.type });
    if (oid === first) {
      if (kind === "abort") controller.abort();
      else clock.mockReturnValue(operation.deadline + 1);
    }
    return { ok: true, value: { oid, type: object.type, size: object.size } };
  });
  const { performance } = await import("node:perf_hooks");
  const clock = vi.spyOn(performance, "now");
  expect(await m.read(commit, "pkg", operation)).toEqual(bad(kind === "abort" ? "GIT_ABORTED" : "GIT_TIMEOUT"));
  expect(m.trace.at(-1)!.oid).toBe(first);
  expect(m.trace.some(e => e.command === "contents" && e.type === "blob")).toBe(false);
  expect(m.session.dispose).toHaveBeenCalledTimes(1);
});
it("snapshots input fields before the first await and ignores later caller mutation", async () => {
  const f = await createGitFixture();
  try {
    const commit = await f.commit([{ path: "pkg/orgops-package.json", bytes: manifest }]);
    const input = { repository: { ...f.repository }, commit, path: "pkg" };
    const pending = readGitPackageBytes(input, sessions.createGitOperation());
    input.path = "missing"; input.commit = "0".repeat(40); input.repository.directory = "/never";
    expect(value(await pending).entries).toEqual([]);
  } finally { await f.dispose(); }
});
it.each(["sha1", "sha256"] as const)("selects historical %s commits and ignores fixture-local replacement refs", async format => {
  const f = await createGitFixture(format);
  try {
    const oldBytes = Buffer.from("old manifest bytes"), newBytes = Buffer.from("new manifest bytes");
    const old = await f.commit([{ path: "pkg/orgops-package.json", bytes: oldBytes }]);
    const newer = await f.commit([{ path: "pkg/orgops-package.json", bytes: newBytes }]);
    const { execFile } = await import("node:child_process");
    await new Promise<void>((resolve, reject) => execFile("/usr/bin/git", [`--git-dir=${f.repository.directory}`, "update-ref", `refs/replace/${old}`, newer], {
      cwd: f.repository.directory, timeout: 5000, maxBuffer: 1024,
      env: { PATH: "", HOME: "/dev/null", XDG_CONFIG_HOME: "/dev/null", LC_ALL: "C", LANG: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_ALLOW_PROTOCOL: "", GIT_OPTIONAL_LOCKS: "0", GIT_ATTR_NOSYSTEM: "1" },
    }, error => error ? reject(error) : resolve()));
    expect(value(await readPackage(f, old)).manifest.equals(oldBytes)).toBe(true);
    expect(value(await readPackage(f, newer)).manifest.equals(newBytes)).toBe(true);
    expect(value(await readPackage(f, old)).manifest.equals(oldBytes)).toBe(true);
  } finally { await f.dispose(); }
});
it.each(["finish", "dispose"])("does not return bytes after cancellation during %s", async where => {
  const m = memorySession(), man = m.add("blob", manifest), controller = new AbortController();
  const commit = m.pkg([rawEntry("100644", "orgops-package.json", man)]);
  vi.mocked(m.session[where as "finish" | "dispose"]).mockImplementation(async () => { controller.abort(); return { ok: true, value: true }; });
  expect(await m.read(commit, "pkg", sessions.createGitOperation(controller.signal))).toEqual(bad("GIT_ABORTED"));
  expect(m.session.dispose).toHaveBeenCalledTimes(1);
});
it("rejects pre-abort and expiry without opening storage", async () => {
  const open = vi.spyOn(sessions, "openGitObjectSession"), controller = new AbortController(); controller.abort();
  const input = { repository: { directory: "/never", gitExecutable: "/usr/bin/git" }, commit: "1".repeat(40), path: "pkg" };
  expect(await readGitPackageBytes(input, sessions.createGitOperation(controller.signal))).toEqual(bad("GIT_ABORTED"));
  expect(await readGitPackageBytes(input, { deadline: -1 })).toEqual(bad("GIT_TIMEOUT"));
  expect(open).not.toHaveBeenCalled();
});
it("rejects storage/commit hash width mismatch without issuing object requests", async () => {
  const m = memorySession();
  expect(await m.read("a".repeat(64))).toEqual(bad("UNSUPPORTED_GIT_STORAGE", "repository"));
  expect(m.trace).toEqual([]); expect(m.session.dispose).toHaveBeenCalledTimes(1);
});
it.each(["sha1", "sha256"] as const)("rejects integrity-matching malformed commit first lines through installed %s Git", async format => {
  const f = await createGitFixture(format);
  try {
    const { createHash } = await import("node:crypto");
    const { deflateSync } = await import("node:zlib");
    const { join } = await import("node:path");
    const root = await tree(f, []);
    const prefixAlias = Buffer.from(`tree ${root}\n`); prefixAlias[0] = 0xf4;
    const oidAlias = Buffer.from(`tree ${root}\n`); oidAlias[5] = oidAlias[5]! | 128;
    for (const bytes of [prefixAlias, oidAlias, Buffer.from(`tree ${root}`), Buffer.from(`parent ${root}\ntree ${root}\n`)]) {
      // hash-object refuses malformed commits. Write only this fixture's loose storage,
      // with the correct object hash, so production integrity checks still run normally.
      const encoded = Buffer.concat([Buffer.from(`commit ${bytes.length}\0`), bytes]);
      const oid = createHash(format).update(encoded).digest("hex");
      const directory = join(f.repository.directory, "objects", oid.slice(0, 2));
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(join(directory, oid.slice(2)), deflateSync(encoded), { flag: "wx" });
      expect(await readPackage(f, oid)).toEqual(bad("GIT_PROTOCOL_ERROR"));
    }
  } finally { await f.dispose(); }
});
it("index selection has no package manifest reservation and never reads unsafe siblings", async () => {
  const f = await createGitFixture();
  try {
    const bytes = Buffer.from(JSON.stringify(catalogIndex)), blob = await f.object("blob", bytes);
    const root = await tree(f, [rawEntry("100644", "orgops-package.json", blob), rawEntry("160000", "unsafe", "0".repeat(40))]);
    const commit = await commitTree(f, root);
    expect(value(await readGitIndexBytes({ repository: f.repository, commit, indexPath: "orgops-package.json" }, sessions.createGitOperation())).equals(bytes)).toBe(true);
  } finally { await f.dispose(); }
});
