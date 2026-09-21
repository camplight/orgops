import { afterEach, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as promises from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import * as schemas from "@orgops/schemas";
import type { PackageManifest, PackageMetadata, CatalogIndex } from "@orgops/schemas";
import * as publicApi from "../index";
import { inspectGitPackage, readGitCatalogIndex, inspectPackage, resolvePackages, exportAgentPackage,
  exportSkillPackage, computePackageDigest, type ContentEntry, type OfflineGitResult, type ResolveInput,
  type GitIndexInput, type PackageSnapshot } from "../index";
import { createGitFixture, type FixtureFile } from "./git-fixtures";
import { skillManifest, skillEntries, classicManifest, rlmManifest, wrappedManifest, catalogIndex, must } from "./fixtures";

vi.mock("node:child_process", async original => {
  const actual = await original<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});
vi.mock("node:fs", async original => ({ ...await original<typeof import("node:fs")>() }));
vi.mock("node:fs/promises", async original => ({ ...await original<typeof import("node:fs/promises")>() }));
vi.mock("@orgops/schemas", async original => ({ ...await original<typeof import("@orgops/schemas")>() }));
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(spawn).mockReset().mockImplementation((await vi.importActual<typeof import("node:child_process")>("node:child_process")).spawn);
});
const bad = (code: string, at = "git") => ({ ok: false, issues: [{ code, at }] });
function value<T>(result: OfflineGitResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`Fixture rejected: ${result.issues[0]?.code}`);
  return result.value;
}
function frozen(value: unknown): void {
  if (value && typeof value === "object") {
    expect(Buffer.isBuffer(value)).toBe(false);
    expect(Object.isFrozen(value)).toBe(true); Object.values(value).forEach(frozen);
  }
}
const json = (v: unknown) => Buffer.from(JSON.stringify(v));
function files(manifest: PackageManifest = skillManifest, entries: readonly ContentEntry[] = skillEntries, path = "pkg"): FixtureFile[] {
  return [{ path: `${path}/orgops-package.json`, bytes: json(manifest) }, ...entries.flatMap(e => e.type === "file"
    ? [{ path: `${path}/${e.path}`, bytes: Buffer.from(e.base64, "base64"), mode: e.executable ? "100755" as const : "100644" as const }] : [])];
}
const manifests = [skillManifest, classicManifest, rlmManifest, wrappedManifest];
const completeFiles = () => [...manifests.flatMap(m => files(m, m.kind === "skill" ? skillEntries : [], `packages/${m.name}`)),
  { path: "catalog/index.json", bytes: json(catalogIndex) }];
function resolution(commit: string, index: CatalogIndex, snapshots: PackageSnapshot[], name = "echo-agent"): ResolveInput {
  return { roots: [{ catalogId: "team", name, version: "1.0.0" }],
    catalogs: [{ catalogId: "team", sourceId: "team-source", commit, enabled: true, index }],
    packages: snapshots.map(snapshot => ({ sourceId: "team-source", commit, path: `packages/${snapshot.manifest.name}`, snapshot })),
    allowedSourceIds: ["team-source"], target: { orgopsVersion: "0.0.1", platform: "linux", tools: ["node"] }, installedSkills: [], knownReleases: [] };
}
function metadata(m: PackageMetadata): PackageMetadata {
  return { formatVersion: m.formatVersion, name: m.name, version: m.version, description: m.description,
    author: m.author, license: m.license, compatibility: structuredClone(m.compatibility), secrets: structuredClone(m.secrets) };
}
function candidate(m: PackageManifest) {
  if (m.kind === "skill") return must(exportSkillPackage([...skillEntries, { type: "file", path: "unused.txt", base64: Buffer.from("DO_NOT_EXPORT").toString("base64"), executable: false }],
    { metadata: metadata(m), dependencies: m.dependencies, executables: m.executables, selectedPaths: skillEntries.map(e => e.path) }));
  const state = { modelId: "DO_NOT_EXPORT", secrets: { token: "DO_NOT_EXPORT" }, memory: "DO_NOT_EXPORT", workspacePath: "/DO_NOT_EXPORT" };
  if (m.kind === "wrapped-agent") {
    const { resourceWiring: _wiring, ...wrappedConfig } = m.wrapped;
    return must(exportAgentPackage({ ...state, mode: "WRAPPED", wrappedConfig, soulContents: "DO_NOT_EXPORT" }, { metadata: metadata(m), dependencies: [] }));
  }
  const n = m.native;
  return must(exportAgentPackage({ ...state, mode: n.mode, systemInstructions: n.systemInstructions,
    ...(n.soulContents === undefined ? {} : { soulContents: n.soulContents }), ...n.runtime,
    enabledSkills: ["echo-skill"], alwaysPreloadedSkills: n.alwaysPreloadedSkills },
  { metadata: metadata(m), dependencies: m.dependencies, ...(n.suggestedModel ? { suggestedModel: n.suggestedModel } : {}) }));
}

it("inspects Git bytes identically without activating the throwing event module", async () => {
  const fixture = await createGitFixture();
  let snapshot: PackageSnapshot;
  try {
    const input = { repository: fixture.repository, commit: await fixture.commit(files()), path: "pkg" };
    const before = structuredClone(input);
    snapshot = value(await inspectGitPackage(input));
    expect(snapshot).toEqual(must(inspectPackage(skillManifest, skillEntries)));
    expect(snapshot.execution.apiEventShapes).toEqual(["event-shapes.ts"]);
    frozen(snapshot); expect(input).toEqual(before);
    input.path = "changed"; input.repository.directory = "/changed";
  } finally { await fixture.dispose(); }
  expect(snapshot!.files[1]!.base64).toBe("dGhyb3cgbmV3IEVycm9yKCJjYXRhbG9nIGluc3BlY3Rpb24gZXhlY3V0ZWQiKTsK");
});

it.each(["sha1", "sha256"] as const)("inspects all four kinds and resolves exact %s identities without discovery or commands from bytes", async format => {
  const f = await createGitFixture(format);
  try {
    const commit = await f.commit(completeFiles());
    const actual = (await vi.importActual<typeof import("node:child_process")>("node:child_process")).spawn;
    const children: ReturnType<typeof spawn>[] = [], commands: string[] = [];
    const meta = vi.spyOn(publicApi, "loadSkillMeta").mockImplementation(() => { throw new Error("Active discovery forbidden"); });
    const shapes = vi.spyOn(publicApi, "loadSkillEventShapes").mockImplementation(() => { throw new Error("Module activation forbidden"); });
    const disk = vi.spyOn(fs, "existsSync").mockImplementation(() => { throw new Error("Discovery disk access forbidden"); });
    vi.mocked(spawn).mockImplementation(((exe: string, args: string[], opts: Parameters<typeof spawn>[2]) => {
      expect(children.every(c => c.exitCode === 0)).toBe(true);
      expect(exe).toBe("/usr/bin/git");
      const command = args.includes("rev-parse") ? "rev-parse" : "cat-file";
      expect(args).toEqual(["--no-pager", "--no-replace-objects", "--no-optional-locks", `--git-dir=${f.repository.directory}`,
        "-c", "protocol.allow=never", "-c", "credential.helper=", "-c", "core.hooksPath=/dev/null", "-c", "maintenance.auto=false", "-c", "gc.auto=0",
        ...(command === "rev-parse" ? ["rev-parse", "--is-bare-repository", "--show-object-format=storage"] : ["cat-file", "--batch-command"])]);
      commands.push(command);
      const child = actual(exe, args, opts!); children.push(child); return child;
    }) as typeof spawn);
    const index = value(await readGitCatalogIndex({ repository: f.repository, commit, indexPath: "catalog/index.json" }));
    expect(index).toEqual(catalogIndex); frozen(index);
    const snapshots = [];
    for (const m of manifests) {
      const snapshot = value(await inspectGitPackage({ repository: f.repository, commit, path: `packages/${m.name}` }));
      expect(snapshot).toEqual(must(inspectPackage(m, m.kind === "skill" ? skillEntries : []))); frozen(snapshot); snapshots.push(snapshot);
    }
    for (const name of ["echo-agent", "echo-repl"]) {
      const input = resolution(commit, index, snapshots, name), before = structuredClone(input);
      const result = must(resolvePackages(input));
      expect(result.packages.map(p => [p.identity.name, p.identity.packageCommit, p.identity.catalogCommit])).toEqual([
        ["echo-skill", commit, commit], [name, commit, commit],
      ]);
      expect(commit).toHaveLength(format === "sha1" ? 40 : 64); expect(input).toEqual(before);
      expect(resolvePackages({ ...input, allowedSourceIds: [] })).toEqual(bad("SOURCE_NOT_ALLOWED", "catalogs"));
      expect(resolvePackages({ ...input, catalogs: [{ ...input.catalogs[0]!, enabled: false }] })).toEqual(bad("SOURCE_NOT_ALLOWED", "catalogs"));
      expect(resolvePackages({ ...input, packages: [] })).toEqual(bad("MISSING_RELEASE", "packages"));
    }
    expect(commands).toEqual(Array.from({ length: 5 }, () => ["rev-parse", "cat-file"]).flat());
    expect(children.every(c => c.exitCode === 0)).toBe(true);
    expect(meta).not.toHaveBeenCalled(); expect(shapes).not.toHaveBeenCalled(); expect(disk).not.toHaveBeenCalled();
    console.log(`public-${format}: ${commands.join(",")}; all ten children reaped; no active discovery`);
  } finally { await f.dispose(); }
});

it.each(manifests)("round trips only export proposed files for $name at a real immutable commit", async m => {
  const exported = candidate(m), before = structuredClone(exported), f = await createGitFixture();
  try {
    const commit = await f.commit(exported.proposedFiles.map(e => ({ path: `pkg/${e.path}`, bytes: Buffer.from(e.base64, "base64"), mode: e.executable ? "100755" : "100644" })));
    const result = value(await inspectGitPackage({ repository: f.repository, commit, path: "pkg" }));
    expect(result).toEqual(exported.snapshot); expect(result.manifest.digest).toBe(m.digest);
    expect(JSON.stringify(result)).not.toContain("DO_NOT_EXPORT"); expect(exported).toEqual(before); frozen(result);
  } finally { await f.dispose(); }
});

it.each(["sha1", "sha256"] as const)("keeps package A pinned while reading changed index B in %s storage", async format => {
  const f = await createGitFixture(format);
  try {
    const a = await f.commit(completeFiles());
    const snapshots = [];
    for (const m of manifests) snapshots.push(value(await inspectGitPackage({ repository: f.repository, commit: a, path: `packages/${m.name}` })));
    const oldIndex = value(await readGitCatalogIndex({ repository: f.repository, commit: a, indexPath: "catalog/index.json" }));
    const original = must(resolvePackages(resolution(a, oldIndex, snapshots)));
    const frozenIndex = structuredClone(catalogIndex);
    for (const entry of frozenIndex.entries) if (entry.location.type === "catalog") entry.location.revision = { type: "exact", commit: a };
    const b = await f.commit([{ path: "catalog/index.json", bytes: json(frozenIndex) }]);
    const index = value(await readGitCatalogIndex({ repository: f.repository, commit: b, indexPath: "catalog/index.json" }));
    const input = resolution(b, index, snapshots); input.packages = input.packages.map(p => ({ ...p, commit: a }));
    input.knownReleases = original.packages.map(p => p.identity);
    expect(must(resolvePackages(input)).packages.map(p => [p.identity.catalogCommit, p.identity.packageCommit])).toEqual([[b, a], [b, a]]);
    expect(value(await inspectGitPackage({ repository: f.repository, commit: a, path: "packages/echo-skill" }))).toEqual(snapshots[0]);
    // A new index commit still pointing old releases contextually must not silently change identity.
    const c = await f.commit([{ path: "catalog/index.json", bytes: json(catalogIndex) }, { path: "unrelated", bytes: Buffer.from("index edit") }]);
    input.catalogs = [{ ...input.catalogs[0]!, commit: c, index: value(await readGitCatalogIndex({ repository: f.repository, commit: c, indexPath: "catalog/index.json" })) }];
    expect(resolvePackages(input)).toEqual(bad("IDENTITY_CONFLICT", "identity"));
    expect(oldIndex).toEqual(catalogIndex); frozen(oldIndex);
  } finally { await f.dispose(); }
});

it("external index claims never acquire another repository or grant permission", async () => {
  const catalog = await createGitFixture(), external = await createGitFixture();
  try {
    const packageCommit = await external.commit(files(skillManifest, skillEntries, "external-skill"));
    const index: CatalogIndex = { formatVersion: 1, entries: [{ ...catalogIndex.entries[0]!, location: { type: "source", sourceId: "external", commit: packageCommit, path: "external-skill" } }] };
    const commit = await catalog.commit([{ path: "explicit.json", bytes: json(index) }]);
    vi.mocked(spawn).mockClear();
    const parsed = value(await readGitCatalogIndex({ repository: catalog.repository, commit, indexPath: "explicit.json" }));
    expect(parsed).toEqual(index);
    expect(vi.mocked(spawn).mock.calls).toHaveLength(2);
    expect(vi.mocked(spawn).mock.calls.every(([, , options]) => options?.cwd === catalog.repository.directory)).toBe(true);
    const input = resolution(commit, parsed, [], "echo-skill");
    expect(resolvePackages(input)).toEqual(bad("SOURCE_NOT_ALLOWED", "catalogs.index.entries.location.sourceId"));
    input.allowedSourceIds = ["team-source", "external"];
    expect(resolvePackages(input)).toEqual(bad("MISSING_RELEASE", "packages"));
    const snapshot = value(await inspectGitPackage({ repository: external.repository, commit: packageCommit, path: "external-skill" }));
    input.packages = [{ sourceId: "external", commit: packageCommit, path: "external-skill", snapshot }];
    expect(must(resolvePackages(input)).packages[0]!.identity).toMatchObject({ sourceId: "external", catalogCommit: commit, packageCommit });
    input.allowedSourceIds = ["team-source"];
    expect(resolvePackages(input)).toEqual(bad("SOURCE_NOT_ALLOWED", "catalogs.index.entries.location.sourceId"));
  } finally { await catalog.dispose(); await external.dispose(); }
});

it.each(["manifest", "index"] as const)("fatal-decodes %s UTF-8 and preserves BOM rather than repairing JSON", async which => {
  const f = await createGitFixture();
  try {
    for (const bytes of [Buffer.from([0xff]), Buffer.from([0xc0, 0xaf]), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), json(which === "manifest" ? wrappedManifest : catalogIndex)]), Buffer.from("{token=synthetic-private}")]) {
      const path = which === "manifest" ? "pkg/orgops-package.json" : "explicit.json";
      const commit = await f.commit([{ path, bytes }]);
      const result = which === "manifest" ? await inspectGitPackage({ repository: f.repository, commit, path: "pkg" })
        : await readGitCatalogIndex({ repository: f.repository, commit, indexPath: path });
      const invalidUtf8 = bytes[0] === 255 || bytes[0] === 192;
      expect(result).toEqual(bad("INVALID_JSON", invalidUtf8 ? which : "$"));
      expect(JSON.stringify(result)).not.toContain("synthetic-private");
    }
  } finally { await f.dispose(); }
});
it.each(["manifest", "index"] as const)("propagates existing schema failures for %s", async which => {
  const f = await createGitFixture();
  try {
    const bytes = json({ formatVersion: 999, token: "synthetic-private" });
    const commit = await f.commit([{ path: which === "manifest" ? "pkg/orgops-package.json" : "explicit.json", bytes }]);
    expect(which === "manifest" ? await inspectGitPackage({ repository: f.repository, commit, path: "pkg" })
      : await readGitCatalogIndex({ repository: f.repository, commit, indexPath: "explicit.json" }))
      .toEqual(which === "manifest" ? schemas.parsePackageManifest(bytes.toString()) : schemas.parseCatalogIndex(bytes.toString()));
  } finally { await f.dispose(); }
});
it.each(["unlisted", "missing", "bytes", "mode", "digest", "declaration", "wiring"])("does not bypass pure inspection for %s", async change => {
  const f = await createGitFixture();
  try {
    let m: PackageManifest = structuredClone(skillManifest); const entries = structuredClone(skillEntries);
    if (change === "unlisted") entries.push({ type: "file", path: "unlisted.txt", base64: "", executable: false });
    if (change === "missing") entries.pop();
    if (change === "bytes") Object.assign(entries[0]!, { base64: Buffer.from("changed").toString("base64") });
    if (change === "mode") Object.assign(entries[0]!, { executable: true });
    if (change === "digest") m.digest = `sha256:${"0".repeat(64)}`;
    if (change === "declaration") m.executables = [];
    if (change === "wiring") m = { ...structuredClone(wrappedManifest), files: m.files };
    const commit = await f.commit(files(m, entries));
    const result = await inspectGitPackage({ repository: f.repository, commit, path: "pkg" });
    expect(result).toEqual(inspectPackage(m, entries)); expect(result.ok).toBe(false);
  } finally { await f.dispose(); }
});

it("previews binary, attributes, LFS pointers and executable scripts as exact inert inventory", async () => {
  const extras: ContentEntry[] = [
    { type: "file", path: "data.bin", base64: "/wAB", executable: false },
    { type: "file", path: ".gitattributes", base64: Buffer.from("*.bin filter=lfs diff=lfs merge=lfs -text\n").toString("base64"), executable: false },
    { type: "file", path: "pointer", base64: Buffer.from(`version https://git-lfs.github.com/spec/v1\noid sha256:${"a".repeat(64)}\nsize 99999999\n`).toString("base64"), executable: false },
    { type: "file", path: "run.sh", base64: Buffer.from("#!/bin/sh\nexit 99\n").toString("base64"), executable: true },
  ];
  const entries = [...skillEntries, ...extras];
  const exported = must(exportSkillPackage(entries, { metadata: metadata(skillManifest), dependencies: [],
    executables: [...skillManifest.executables, { path: "run.sh", execution: "runner-script" }], selectedPaths: entries.map(e => e.path) }));
  const f = await createGitFixture(); let snapshot: PackageSnapshot;
  try {
    const commit = await f.commit(files(exported.snapshot.manifest, entries));
    snapshot = value(await inspectGitPackage({ repository: f.repository, commit, path: "pkg" }));
    expect(snapshot).toEqual(exported.snapshot);
    for (const e of extras) expect(snapshot.files.find(x => x.path === e.path)).toMatchObject(e.type === "file" ? { base64: e.base64, executable: e.executable } : {});
    expect(snapshot.execution.runnerScripts).toEqual(["run.sh"]); frozen(snapshot);
  } finally { await f.dispose(); }
  expect(snapshot!.files.find(x => x.path === "data.bin")!.base64).toBe("/wAB");
});
it("discloses all wrapped checks and commands without invoking them", async () => {
  const m = structuredClone(wrappedManifest); m.wrapped.setup!.args = ["setup-arg"];
  m.wrapped.sidecars[0]!.checkCommand = "check helper"; m.wrapped.sidecars[0]!.args = ["sidecar-arg"];
  m.digest = must(computePackageDigest(m, []));
  const f = await createGitFixture();
  try {
    const snapshot = value(await inspectGitPackage({ repository: f.repository, commit: await f.commit(files(m, [])), path: "pkg" }));
    expect(snapshot.execution.wrappedCommands).toEqual([
      { at: "wrapped.setup.command", command: "printf setup", args: ["setup-arg"] },
      { at: "wrapped.setup.checkCommand", command: "test -f ready", args: ["setup-arg"] },
      { at: "wrapped.sidecars.0.command", command: "node -e 'setInterval(() => {}, 1000)'", args: ["sidecar-arg"] },
      { at: "wrapped.sidecars.0.checkCommand", command: "check helper", args: ["sidecar-arg"] },
      { at: "wrapped.runtime.command", command: "printf", args: ["acknowledged"] },
    ]);
    expect(snapshot.warnings).toContainEqual({ code: "EXTERNAL_RUNTIME_NOT_PINNED", at: "wrapped" });
  } finally { await f.dispose(); }
});

it("keeps old inspection/export/resolve synchronous and I/O-free", () => {
  const forbid = () => { throw new Error("Pure API attempted I/O"); };
  const spies = [vi.mocked(spawn).mockImplementation(forbid), vi.spyOn(fs, "existsSync").mockImplementation(forbid),
    vi.spyOn(fs, "readFileSync").mockImplementation(forbid), vi.spyOn(fs, "readdirSync").mockImplementation(forbid),
    vi.spyOn(promises, "lstat").mockImplementation(forbid), vi.spyOn(promises, "open").mockImplementation(forbid),
    vi.spyOn(promises, "opendir").mockImplementation(forbid), vi.spyOn(publicApi, "loadSkillMeta").mockImplementation(forbid),
    vi.spyOn(publicApi, "loadSkillEventShapes").mockImplementation(forbid)];
  vi.mocked(spawn).mockClear();
  const snapshots = manifests.map(m => { const result = inspectPackage(m, m.kind === "skill" ? skillEntries : []); expect(result).not.toBeInstanceOf(Promise); return must(result); });
  for (const m of manifests) expect(candidate(m).snapshot.manifest.digest).toBe(m.digest);
  expect(must(resolvePackages(resolution("1".repeat(40), catalogIndex, snapshots))).packages.map(p => p.identity.name)).toEqual(["echo-skill", "echo-agent"]);
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
});
it("rejects bad envelopes and missing explicit indexPath before I/O, redacting local paths and synthetic secrets", async () => {
  const input = { repository: { directory: "/synthetic-private", gitExecutable: "/usr/bin/git" }, commit: "1".repeat(40), path: "pkg" };
  const stat = vi.spyOn(promises, "lstat"); vi.mocked(spawn).mockClear();
  const log = vi.spyOn(console, "error"); const warn = vi.spyOn(console, "warn");
  const getter = vi.fn(() => "token=synthetic-secret");
  expect(await inspectGitPackage({ ...input, commit: "token=synthetic-secret" })).toEqual(bad("INVALID_GIT_INPUT", "commit"));
  expect(await inspectGitPackage(Object.defineProperty({ ...input }, "path", { get: getter }))).toEqual(bad("INVALID_GIT_INPUT", "$"));
  expect(await inspectGitPackage({ ...input, path: "." })).toEqual(bad("UNSAFE_PATH", "path"));
  expect(await readGitCatalogIndex({ repository: input.repository, commit: input.commit } as GitIndexInput)).toEqual(bad("INVALID_GIT_INPUT", "$"));
  expect(getter).not.toHaveBeenCalled(); expect(stat).not.toHaveBeenCalled(); expect(spawn).not.toHaveBeenCalled();
  expect(log).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled();
});
it("concurrent identical calls own independent sessions and detached outputs", async () => {
  const f = await createGitFixture();
  try {
    const commit = await f.commit(completeFiles()); vi.mocked(spawn).mockClear();
    const input = { repository: f.repository, commit, path: "packages/echo-skill" };
    const results = await Promise.all([inspectGitPackage(input), inspectGitPackage(input),
      readGitCatalogIndex({ repository: f.repository, commit, indexPath: "catalog/index.json" }),
      readGitCatalogIndex({ repository: f.repository, commit, indexPath: "catalog/index.json" })]);
    expect(results[0]).toEqual(results[1]); expect(results[2]).toEqual(results[3]);
    expect(value(results[0]!)).not.toBe(value(results[1]!)); expect(value(results[2]!)).not.toBe(value(results[3]!));
    expect(spawn).toHaveBeenCalledTimes(8);
    expect(vi.mocked(spawn).mock.results.every(r => r.type === "return" && r.value.exitCode === 0)).toBe(true);
    results.forEach(r => frozen(value<PackageSnapshot | CatalogIndex>(r))); console.log("public-concurrent: four independent operations; eight reaped children");
  } finally { await f.dispose(); }
});

// Trusted process doubles exercise the real session, raw traversal and public semantic adapters.
// They never run fake executables or package-authored callbacks on the host.
type FakeChild = ReturnType<typeof fakeChild>;
function fakeChild(pid: number, command: (line: string, child: FakeChild) => void, end: (child: FakeChild) => void) {
  const emitter = new EventEmitter(), stdout = new PassThrough(), stderr = new PassThrough();
  const stdin = new Writable({
    write(chunk, _encoding, done) { done(); queueMicrotask(() => command(chunk.toString(), child)); },
    final(done) { done(); queueMicrotask(() => end(child)); },
  });
  const child = Object.assign(emitter, { pid, stdin, stdout, stderr, closed: false,
    exitCode: null as number | null, signalCode: null as NodeJS.Signals | null,
    close(code: number | null, signal: NodeJS.Signals | null = null) {
      if (child.closed) return;
      child.closed = true; child.exitCode = code; child.signalCode = signal;
      stdout.end(); stderr.end(); stdin.destroy(); stdout.destroy(); stderr.destroy(); emitter.emit("close", code, signal);
    },
  });
  queueMicrotask(() => emitter.emit("spawn")); return child;
}
type Fault = "none" | "protocol" | "finish" | "unreaped-valid" | "unreaped-protocol" | "denied-valid" | "denied-protocol" | "abort" | "timeout";
async function processFixture(which: "package" | "index", fault: Fault, controller: AbortController) {
  const f = await createGitFixture(), children: FakeChild[] = [];
  const objects = new Map<string, { type: string; bytes: Buffer }>();
  function object(type: string, bytes: Buffer) {
    const oid = createHash("sha1").update(`${type} ${bytes.length}\0`).update(bytes).digest("hex");
    objects.set(oid, { type, bytes }); return oid;
  }
  const entry = (mode: string, name: string, oid: string) => Buffer.concat([Buffer.from(`${mode} ${name}\0`), Buffer.from(oid, "hex")]);
  const blob = object("blob", json(which === "package" ? wrappedManifest : catalogIndex));
  const root = which === "package" ? object("tree", entry("40000", "pkg", object("tree", entry("100644", "orgops-package.json", blob))))
    : object("tree", entry("100644", "index.json", blob));
  const commit = object("commit", Buffer.from(`tree ${root}\n\nInert fixture\n`));
  const kill = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
    const child = children.find(c => c.pid === -pid); expect(child).toBeDefined(); expect(signal).toBe("SIGKILL");
    if (fault.startsWith("denied")) throw Object.assign(new Error("token=synthetic-kill-secret"), { code: "EPERM" });
    if (!fault.startsWith("unreaped")) queueMicrotask(() => child!.close(null, "SIGKILL"));
    return true;
  });
  vi.mocked(spawn).mockImplementation(((_exe: string, args: string[]) => {
    expect(children.every(c => c.closed)).toBe(true);
    const batch = args.includes("cat-file");
    const child = fakeChild(986000 + children.length, (line, c) => {
      c.stderr.write("token=synthetic-stderr-secret /synthetic-private\n");
      if (fault.endsWith("protocol")) { c.stdout.write("malformed-token=synthetic-protocol-secret\n"); return; }
      if (fault === "abort") { controller.abort(); return; }
      if (fault === "timeout") { vi.spyOn(performance, "now").mockReturnValue(1e12); return; }
      expect(line).toMatch(/^(info|contents) [a-f0-9]{40}\n$/);
      const [verb, oid] = line.trim().split(" "), o = objects.get(oid!)!;
      c.stdout.write(`${oid} ${o.type} ${o.bytes.length}\n`);
      if (verb === "contents") { c.stdout.write(o.bytes); c.stdout.write("\n"); }
    }, c => {
      if (!batch) { c.stdout.write("true\nsha1\n"); c.close(0); }
      else if (fault.endsWith("valid")) controller.abort();
      else c.close(fault === "finish" ? 1 : 0);
    });
    children.push(child); return child;
  }) as unknown as typeof spawn);
  return { f, commit, children, kill, async dispose() {
    for (const child of children) { child.close(null, "SIGKILL"); child.removeAllListeners(); }
    kill.mockRestore(); await f.dispose();
  } };
}
it.each((["package", "index"] as const).flatMap(which =>
  (["none", "protocol", "finish", "unreaped-valid", "unreaped-protocol", "denied-valid", "denied-protocol", "abort", "timeout"] as const).map(fault => ({ which, fault }))))(
  "$which selects terminal $fault only after bounded cleanup through real session/reader", async ({ which, fault }) => {
    const controller = new AbortController(), p = await processFixture(which, fault, controller);
    const errors = vi.spyOn(console, "error"), warnings = vi.spyOn(console, "warn");
    try {
      // For timeout the fake monotonic clock advances after a request. The real deadline timer
      // is shortened via its private clock seam, not a public caller limit override.
      if (fault === "timeout") {
        const now = performance.now.bind(performance); let calls = 0;
        vi.spyOn(performance, "now").mockImplementation(() => now() + (calls++ === 0 ? -9990 : 0));
      }
      const started = Date.now();
      const result = which === "package"
        ? await inspectGitPackage({ repository: p.f.repository, commit: p.commit, path: "pkg" }, { signal: controller.signal })
        : await readGitCatalogIndex({ repository: p.f.repository, commit: p.commit, indexPath: "index.json" }, { signal: controller.signal });
      if (fault === "none") {
        expect(result).toEqual({ ok: true, value: which === "package" ? must(inspectPackage(wrappedManifest, [])) : catalogIndex });
        frozen(value<PackageSnapshot | CatalogIndex>(result));
      } else {
        const incomplete = fault.startsWith("unreaped") || fault.startsWith("denied");
        const code = incomplete ? "GIT_CLEANUP_FAILED" : fault === "protocol" ? "GIT_PROTOCOL_ERROR"
          : fault === "finish" ? "GIT_FAILED" : fault === "abort" ? "GIT_ABORTED" : "GIT_TIMEOUT";
        expect(result).toEqual(bad(code)); expect(Date.now() - started).toBeLessThan(1500);
        for (const secret of [p.f.repository.directory, "synthetic-stderr-secret", "synthetic-protocol-secret", "synthetic-kill-secret", "/synthetic-private"])
          expect(JSON.stringify(result)).not.toContain(secret);
        if (incomplete) { expect(p.children[1]!.closed).toBe(false); expect(p.kill).toHaveBeenCalledTimes(1); }
        else expect(p.children.every(c => c.closed)).toBe(true);
      }
      expect(p.children.every(c => c.stdin.destroyed && c.stdout.destroyed && c.stderr.destroyed)).toBe(true);
      expect(errors).not.toHaveBeenCalled(); expect(warnings).not.toHaveBeenCalled();
      console.log(`public-lifecycle: ${which}/${fault}: ${result.ok ? "success after close" : result.issues[0]!.code}; local pipes closed`);
    } finally { await p.dispose(); }
  });

it.each((["package", "index"] as const).flatMap(which => ["abort", "timeout"].flatMap(interruption =>
  ["decode", "parse-success", "parse-failure", "final"].map(stage => ({ which, interruption, stage })))))(
  "$which checks $interruption at semantic $stage after Git reaping", async ({ which, interruption, stage }) => {
    const f = await createGitFixture(), controller = new AbortController();
    try {
      const commit = await f.commit([{ path: "pkg/orgops-package.json", bytes: json(wrappedManifest) }, { path: "index.json", bytes: json(catalogIndex) }]);
      const stop = () => { if (interruption === "abort") controller.abort(); else vi.spyOn(performance, "now").mockReturnValue(1e12); };
      let reapedAtInterruption = false;
      vi.mocked(spawn).mockClear();
      const interrupt = () => { reapedAtInterruption = vi.mocked(spawn).mock.results.length === 2 && vi.mocked(spawn).mock.results.every(r => r.type === "return" && r.value.exitCode === 0); stop(); };
      if (stage === "decode") {
        const decode = TextDecoder.prototype.decode;
        vi.spyOn(TextDecoder.prototype, "decode").mockImplementation(function (this: TextDecoder, ...args) { const text = decode.apply(this, args); interrupt(); return text; });
      } else if (stage.startsWith("parse")) {
        if (which === "package") {
          const parse = schemas.parsePackageManifest;
          vi.spyOn(schemas, "parsePackageManifest").mockImplementation(text => { const parsed = parse(text); interrupt(); return stage === "parse-failure" ? { ok: false, issues: [{ code: "INVALID_MANIFEST", at: "$" }] } : parsed; });
        } else {
          const parse = schemas.parseCatalogIndex;
          vi.spyOn(schemas, "parseCatalogIndex").mockImplementation(text => { const parsed = parse(text); interrupt(); return stage === "parse-failure" ? { ok: false, issues: [{ code: "INVALID_INDEX", at: "$" }] } : parsed; });
        }
      } else {
        // The last synchronous freeze belongs to the semantic result, after all Git I/O.
        const freeze = Object.freeze;
        vi.spyOn(Object, "freeze").mockImplementation((object: unknown) => {
          const out = freeze(object);
          if (object && typeof object === "object" && (which === "package" ? "execution" in object : "entries" in object)) interrupt();
          return out;
        });
      }
      const result = which === "package" ? await inspectGitPackage({ repository: f.repository, commit, path: "pkg" }, { signal: controller.signal })
        : await readGitCatalogIndex({ repository: f.repository, commit, indexPath: "index.json" }, { signal: controller.signal });
      expect(result).toEqual(bad(interruption === "abort" ? "GIT_ABORTED" : "GIT_TIMEOUT"));
      expect(reapedAtInterruption).toBe(true);
    } finally { await f.dispose(); }
  });

it.each(["unsafe-name", "symlink", "gitlink", "executable-manifest", "executable-index"])("public adapters reject selected raw %s without dropping it", async which => {
  const f = await createGitFixture();
  try {
    const entry = (mode: string, name: string, oid: string) => Buffer.concat([Buffer.from(`${mode} ${name}\0`), Buffer.from(oid, "hex")]);
    const m = await f.object("blob", json(wrappedManifest)), b = await f.object("blob", Buffer.from("inert"));
    const mode = which === "symlink" ? "120000" : which === "gitlink" ? "160000" : "100644";
    const packageTree = await f.object("tree", Buffer.concat([
      entry(which === "executable-manifest" ? "100755" : "100644", "orgops-package.json", m),
      ...(which === "executable-manifest" ? [] : [entry(mode, which === "unsafe-name" ? "../secret=synthetic" : "unlisted", b)]),
    ]), true);
    const root = await f.object("tree", which === "executable-index" ? entry("100755", "index.json", b) : entry("40000", "pkg", packageTree), true);
    const commit = await f.object("commit", Buffer.from(`tree ${root}\nauthor Fixture <fixture@example.invalid> 946684800 +0000\ncommitter Fixture <fixture@example.invalid> 946684800 +0000\n\nFixture\n`));
    expect(which === "executable-index" ? await readGitCatalogIndex({ repository: f.repository, commit, indexPath: "index.json" })
      : await inspectGitPackage({ repository: f.repository, commit, path: "pkg" }))
      .toEqual(bad(which === "unsafe-name" ? "UNSAFE_PATH" : "UNSUPPORTED_ENTRY", which === "executable-manifest" ? "manifest" : which === "executable-index" ? "index" : "entries"));
  } finally { await f.dispose(); }
});
