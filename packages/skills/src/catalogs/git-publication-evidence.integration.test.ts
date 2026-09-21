import { afterEach, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as promises from "node:fs/promises";
import * as crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { join } from "node:path";
import * as publicApi from "../index";
import { readGitPublicationEvidence, preparePublication, inspectGitPackage,
  type GitPublicationEvidence, type PublicationInput, type OfflineGitResult } from "../index";
import { createGitFixture } from "./git-fixtures";
import { publicationInput, publicationValue, publicationSkill } from "./publication-fixtures";

vi.mock("node:child_process", async original => {
  const actual = await original<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});
vi.mock("node:fs", async original => ({ ...await original<typeof import("node:fs")>() }));
vi.mock("node:fs/promises", async original => ({ ...await original<typeof import("node:fs/promises")>() }));
vi.mock("node:crypto", async original => ({ ...await original<typeof import("node:crypto")>() }));
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(spawn).mockReset().mockImplementation((await vi.importActual<typeof import("node:child_process")>("node:child_process")).spawn);
});
const bad = (code: string, at = "git") => ({ ok: false, issues: [{ code, at }] });
function value<T>(result: OfflineGitResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Fixture read rejected");
  return result.value;
}
function copyEvidence(input: PublicationInput, e: GitPublicationEvidence): void {
  expect(Object.keys(e).sort()).toEqual(["commit", "indexBase64", "indexPath", "inventory"]);
  input.base = { ...input.base, commit: e.commit, indexPath: e.indexPath,
    inventory: e.inventory, indexBase64: e.indexBase64 };
}
function frozen(v: unknown): void {
  if (v && typeof v === "object") {
    expect(Buffer.isBuffer(v)).toBe(false); expect(Object.isFrozen(v)).toBe(true);
    Object.values(v).forEach(frozen);
  }
}

// Catches lexical-byte normalization, incomplete inventory handoff and policy inferred from Git.
it.each(["sha1", "sha256"] as const)("composes exact %s tree bytes with independent synthetic policy", async format => {
  const f = await createGitFixture(format);
  try {
    const input = publicationInput();
    const lexical = Buffer.from('{\r\n "entries" : [], "formatVersion" : 1\r\n}\n');
    const commit = await f.commit([{ path: input.base.indexPath, bytes: lexical },
      { path: "README.md", bytes: Buffer.from("Inert unrelated file\n") }]);
    const e = value(await readGitPublicationEvidence({ repository: f.repository, commit, indexPath: input.base.indexPath }));
    copyEvidence(input, e);
    // All configuration and complete history are independent assertions about this owned fixture only.
    const proposal = publicationValue(preparePublication(input));
    expect(proposal.preconditions.inventory).toEqual(e.inventory);
    expect(proposal.preconditions.baseCommit).toBe(commit);
    expect(proposal.preconditions.oldIndex!.base64).toBe(lexical.toString("base64"));
    expect(proposal.changes.find(c => c.path === input.base.indexPath)!.before!.base64).toBe(lexical.toString("base64"));
    expect(proposal.changes.filter(c => c.path !== input.base.indexPath).every(c => c.before === null)).toBe(true);
    expect(proposal.reviewRequired).toBe(true);
    expect(preparePublication({ ...input, base: { ...input.base, enabled: false } }).ok).toBe(false);
    frozen(e); frozen(proposal);
  } finally { await f.dispose(); }
});

it.each(["sha1", "sha256"] as const)("preserves explicitly retained old %s release and adds only the next version", async format => {
  const f = await createGitFixture(format);
  try {
    const input = publicationInput(), old = publicationSkill(), path = "packages/echo-skill/1.0.0";
    const m = old.snapshot.manifest;
    const index = { formatVersion: 1, entries: [{ kind: m.kind, name: m.name, version: m.version, digest: m.digest,
      location: { type: "catalog", path, revision: { type: "catalog-revision" } } }] };
    const lexical = Buffer.from(` ${JSON.stringify(index, null, 2)}\r\n`);
    const commit = await f.commit([{ path: input.base.indexPath, bytes: lexical }, ...old.proposedFiles.map(file => ({
      path: `${path}/${file.path}`, bytes: Buffer.from(file.base64, "base64"), mode: file.executable ? "100755" as const : "100644" as const }))]);
    const e = value(await readGitPublicationEvidence({ repository: f.repository, commit, indexPath: input.base.indexPath }));
    copyEvidence(input, e);
    // This fixture independently declares its complete history; no tree/index scan constructs it.
    const origin = { catalogId: "team", catalogCommit: commit, sourceId: "team-source", packageCommit: commit,
      path, kind: m.kind, name: m.name, version: m.version, digest: m.digest };
    input.base.history = { complete: true, releases: [origin] };
    const snapshot = value(await inspectGitPackage({ repository: f.repository, commit, path }));
    expect(snapshot).toEqual(old.snapshot);
    input.packages = [{ sourceId: "team-source", commit, path, snapshot }];
    input.selections = [{ candidate: publicationSkill("echo-skill", "1.0.1"), destinationPath: "packages/echo-skill/1.0.1", intent: "update", origin }];
    const before = structuredClone(input);
    const proposal = publicationValue(preparePublication(input));
    expect(input).toEqual(before);
    expect(proposal.preconditions.inventory).toEqual(e.inventory);
    expect(proposal.preconditions.history).toEqual({ complete: true, releases: [origin] });
    expect(proposal.preconditions.sources).toEqual(input.sources);
    expect(proposal.preconditions.oldIndex!.base64).toBe(lexical.toString("base64"));
    expect(proposal.proposedIndex.entries[0]!.location).toEqual({ type: "catalog", path, revision: { type: "exact", commit } });
    expect(proposal.changes.some(c => c.path.startsWith(`${path}/`))).toBe(false);
    expect(proposal.changes.filter(c => c.path !== input.base.indexPath).every(c => c.before === null && c.path.startsWith("packages/echo-skill/1.0.1/"))).toBe(true);
    expect(proposal.releases[0]!.identity.packageRevision).toEqual({ type: "proposal" });
    expect(proposal.releases[0]!.identity).not.toHaveProperty("packageCommit");
    expect(preparePublication({ ...input, base: { ...input.base, history: { complete: true, releases: [] } } }).ok).toBe(false);
    const missingHistory = structuredClone(input), partialHistory = structuredClone(input);
    Reflect.deleteProperty(missingHistory.base, "history");
    Reflect.set(partialHistory.base.history, "complete", false);
    expect(preparePublication(missingHistory).ok).toBe(false);
    expect(preparePublication(partialHistory).ok).toBe(false);
    input.selections = [{ candidate: old, destinationPath: path, intent: "new-release", origin: null }];
    const reuse = publicationValue(preparePublication(input));
    expect(reuse.changes.map(c => c.path)).toEqual([input.base.indexPath]);
    expect(reuse.releases[0]!.identity.packageRevision).toEqual({ type: "exact", commit });
    expect(reuse.selections[0]!.disposition).toBe("existing");
    expect(preparePublication({ ...input, packages: [] }).ok).toBe(false);
  } finally { await f.dispose(); }
});

it.each(["sha1", "sha256"] as const)("proves %s absence but never launders malformed index bytes or grants dependency permissions", async format => {
  const f = await createGitFixture(format);
  try {
    const input = publicationInput();
    const commit = await f.commit([]);
    const e = value(await readGitPublicationEvidence({ repository: f.repository, commit, indexPath: input.base.indexPath }));
    expect(e.indexBase64).toBeNull(); expect(e.inventory).toEqual({ complete: true, entries: [] });
    copyEvidence(input, e);
    const proposal = publicationValue(preparePublication(input));
    expect(proposal.changes.find(c => c.path === input.base.indexPath)!.before).toBeNull();
    expect(proposal.preconditions.requiredAbsentPaths).toContain(input.base.indexPath);
    expect(preparePublication({ ...input, sources: [] }).ok).toBe(false);
    expect(preparePublication({ ...input, sources: input.sources.map(s => ({ ...s, enabled: false })) }).ok).toBe(false);
    const external = publicationSkill("other"), digest = external.snapshot.manifest.digest;
    const dependency = { catalogId: "external", sourceId: "external-source", name: "other", version: "1.0.0",
      digest, revision: { type: "exact" as const, commit } };
    const dependent = publicationSkill("echo-skill", "1.0.0", [dependency]);
    const withDependency = structuredClone(input);
    withDependency.selections = [{ ...input.selections[0]!, candidate: dependent }];
    expect(preparePublication(withDependency).ok).toBe(false);
    withDependency.sources = [...input.sources, { sourceId: "external-source", repository: { url: "https://example.invalid/external.git" }, enabled: true, allowPackages: true }];
    withDependency.catalogs = [{ catalogId: "external", sourceId: "external-source", enabled: true, commit,
      index: { formatVersion: 1, entries: [{ kind: "skill", name: "other", version: "1.0.0", digest,
        location: { type: "catalog", path: "skill", revision: { type: "catalog-revision" } } }] } }];
    withDependency.packages = [{ sourceId: "external-source", commit, path: "skill", snapshot: external.snapshot }];
    expect(preparePublication(withDependency).ok).toBe(true);
    withDependency.sources[1]!.allowPackages = false;
    expect(preparePublication(withDependency).ok).toBe(false);
    withDependency.sources[1]!.allowPackages = true;
    withDependency.catalogs[0]!.enabled = false;
    expect(preparePublication(withDependency).ok).toBe(false);
    for (const bytes of [Buffer.from([255, 0]), Buffer.from('\ufeff{"formatVersion":1,"entries":[]}'), Buffer.alloc(0), Buffer.from("{"), Buffer.from('{"formatVersion":999,"entries":[]}')]) {
      const c = await f.commit([{ path: input.base.indexPath, bytes }]);
      const evidence = value(await readGitPublicationEvidence({ repository: f.repository, commit: c, indexPath: input.base.indexPath }));
      expect(evidence.indexBase64).toBe(bytes.toString("base64"));
      copyEvidence(input, evidence);
      const rejected = preparePublication(input);
      expect(rejected.ok).toBe(false); expect(rejected).not.toHaveProperty("value");
    }
  } finally { await f.dispose(); }
});

async function diskSnapshot(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  async function visit(path: string) {
    for (const entry of await promises.readdir(join(root, path), { withFileTypes: true })) {
      const relative = path ? `${path}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { out[relative] = "directory"; await visit(relative); }
      else out[relative] = (await promises.readFile(join(root, relative))).toString("base64");
    }
  }
  await visit(""); return out;
}
it.each(["sha1", "sha256"] as const)("performs only fixed read-only %s Git commands, then prepares without I/O", async format => {
  const f = await createGitFixture(format);
  const writeSpies: { mockRestore(): void; mock: { calls: unknown[] } }[] = [];
  try {
    const input = publicationInput();
    const commit = await f.commit([
      { path: input.base.indexPath, bytes: Buffer.from('{"formatVersion":1,"entries":[]}') },
      { path: ".gitattributes", bytes: Buffer.from("* filter=lfs diff=lfs merge=lfs -text\n") },
      { path: ".gitmodules", bytes: Buffer.from('[submodule "inert"]\n path = sub\n url = https://example.invalid/private\n') },
      { path: "pointer", bytes: Buffer.from(`version https://git-lfs.github.com/spec/v1\noid sha256:${"a".repeat(64)}\nsize 99999999\n`) },
      { path: "event-shapes.ts", bytes: Buffer.from('throw new Error("must never execute");\n') },
    ]);
    const before = await diskSnapshot(f.repository.directory);
    const forbid = () => { throw new Error("Forbidden side effect"); };
    const meta = vi.spyOn(publicApi, "loadSkillMeta").mockImplementation(forbid);
    const shapes = vi.spyOn(publicApi, "loadSkillEventShapes").mockImplementation(forbid);
    writeSpies.push(vi.spyOn(promises, "writeFile").mockImplementation(forbid), vi.spyOn(promises, "mkdir").mockImplementation(forbid),
      vi.spyOn(promises, "rm").mockImplementation(forbid), vi.spyOn(promises, "rename").mockImplementation(forbid),
      vi.spyOn(fs, "writeFileSync").mockImplementation(forbid), vi.spyOn(fs, "mkdirSync").mockImplementation(forbid));
    const open = promises.open;
    vi.spyOn(promises, "open").mockImplementation((...args) => { expect(args[1]).toBe("r"); return open(...args); });
    const actual = (await vi.importActual<typeof import("node:child_process")>("node:child_process")).spawn;
    const children: ReturnType<typeof spawn>[] = [], closed: boolean[] = [], lines: string[] = [];
    vi.mocked(spawn).mockImplementation(((exe: string, args: string[], opts: Parameters<typeof spawn>[2]) => {
      expect(closed.every(Boolean)).toBe(true);
      const batch = children.length === 1;
      expect(exe).toBe(f.repository.gitExecutable);
      expect(args).toEqual(["--no-pager", "--no-replace-objects", "--no-optional-locks", `--git-dir=${f.repository.directory}`,
        "-c", "protocol.allow=never", "-c", "credential.helper=", "-c", "core.hooksPath=/dev/null", "-c", "maintenance.auto=false", "-c", "gc.auto=0",
        ...(batch ? ["cat-file", "--batch-command"] : ["rev-parse", "--is-bare-repository", "--show-object-format=storage"])]);
      expect(opts?.cwd).toBe(f.repository.directory);
      expect(opts?.env).toEqual({ PATH: "", HOME: "/dev/null", XDG_CONFIG_HOME: "/dev/null", LC_ALL: "C", LANG: "C",
        GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0",
        GIT_ALLOW_PROTOCOL: "", GIT_OPTIONAL_LOCKS: "0", GIT_ATTR_NOSYSTEM: "1" });
      const child = actual(exe, args, opts!), i = children.length;
      children.push(child); closed.push(false); child.once("close", () => { closed[i] = true; });
      if (batch) {
        const write = child.stdin!.write.bind(child.stdin!);
        vi.spyOn(child.stdin!, "write").mockImplementation((...args: Parameters<typeof write>) => {
          const line = args[0].toString(); expect(line).toMatch(new RegExp(`^(info|contents) [a-f0-9]{${format === "sha1" ? 40 : 64}}\\n$`));
          lines.push(line); return write(...args);
        });
      }
      return child;
    }) as typeof spawn);
    const e = value(await readGitPublicationEvidence({ repository: f.repository, commit, indexPath: input.base.indexPath }));
    expect(children).toHaveLength(2); expect(closed).toEqual([true, true]);
    expect(children.every(c => c.exitCode === 0)).toBe(true);
    expect(lines).toHaveLength(16); // commit + root/catalog trees + five file occurrences, two requests each
    expect(await diskSnapshot(f.repository.directory)).toEqual(before);
    copyEvidence(input, e);
    const io = [vi.spyOn(promises, "lstat").mockImplementation(forbid), vi.spyOn(promises, "open").mockImplementation(forbid),
      vi.spyOn(promises, "opendir").mockImplementation(forbid), vi.spyOn(promises, "readFile").mockImplementation(forbid),
      vi.spyOn(fs, "readFileSync").mockImplementation(forbid), vi.spyOn(fs, "readdirSync").mockImplementation(forbid),
      vi.spyOn(fs, "existsSync").mockImplementation(forbid)];
    vi.mocked(spawn).mockClear().mockImplementation(forbid);
    const result = preparePublication(input);
    expect(result).not.toBeInstanceOf(Promise); expect(result.ok).toBe(true);
    for (const spy of [...writeSpies, ...io, meta, shapes, vi.mocked(spawn)]) expect(spy.mock.calls).toHaveLength(0);
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

// Child-process doubles retain the actual session, raw reader and public evidence operation.
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
type Fault = "none" | "protocol" | "corrupt" | "finish" | "unreaped-valid" | "unreaped-protocol" | "denied-valid" | "denied-protocol" | "abort" | "timeout" | "delayed";
async function processFixture(format: "sha1" | "sha256", fault: Fault, controller: AbortController, repeat = 0, trees = false) {
  const f = await createGitFixture(format), children: FakeChild[] = [], requests: string[] = [];
  const objects = new Map<string, { type: string; bytes: Buffer }>();
  function object(type: string, bytes: Buffer) {
    const oid = crypto.createHash(format).update(`${type} ${bytes.length}\0`).update(bytes).digest("hex");
    objects.set(oid, { type, bytes }); return oid;
  }
  const entry = (mode: string, name: string, oid: string) => Buffer.concat([Buffer.from(`${mode} ${name}\0`), Buffer.from(oid, "hex")]);
  const blob = object("blob", Buffer.from("{}"));
  const repeatedTree = object("tree", Buffer.concat(Array.from({ length: 2045 }, (_, i) => entry("100644", `f${i.toString().padStart(4, "0")}`, blob))));
  const root = object("tree", trees ? Buffer.concat([entry("40000", "a", repeatedTree), entry("40000", "b", repeatedTree),
    ...Array.from({ length: repeat }, (_, i) => entry("100644", `z${i}`, blob))]) : repeat
    ? Buffer.concat(Array.from({ length: repeat }, (_, i) => entry("100644", `f${i.toString().padStart(4, "0")}`, blob)))
    : entry("100644", "index.json", blob));
  const commit = object("commit", Buffer.from(`tree ${root}\n\nInert fixture\n`));
  let release: (() => void) | undefined;
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
      requests.push(line);
      if (requests.length === 1) c.stderr.write("token=synthetic-stderr-secret /synthetic-private\n");
      if (fault.endsWith("protocol")) { c.stdout.write("malformed-token=synthetic-protocol-secret\n"); return; }
      expect(line).toMatch(new RegExp(`^(info|contents) [a-f0-9]{${format === "sha1" ? 40 : 64}}\\n$`));
      const [verb, oid] = line.trim().split(" "), o = objects.get(oid!)!;
      if (verb === "contents" && o.type === "blob") {
        if (fault === "abort") { controller.abort(); return; }
        if (fault === "timeout") { vi.spyOn(performance, "now").mockReturnValue(1e12); c.stdout.write("x"); return; }
      }
      c.stdout.write(`${oid} ${o.type} ${o.bytes.length}\n`);
      if (verb === "contents") { c.stdout.write(fault === "corrupt" && o.type === "blob" ? Buffer.from("[]") : o.bytes); c.stdout.write("\n"); }
    }, c => {
      if (!batch) { c.stdout.write(`true\n${format}\n`); c.close(0); }
      else if (fault.endsWith("valid")) controller.abort();
      else if (fault === "delayed") release = () => c.close(0);
      else c.close(fault === "finish" ? 1 : 0);
    });
    children.push(child); return child;
  }) as unknown as typeof spawn);
  return { f, commit, blob, children, requests, kill, get release() { return release; }, async dispose() {
    for (const child of children) { child.close(null, "SIGKILL"); child.removeAllListeners(); }
    kill.mockRestore(); await f.dispose();
  } };
}
it.each((["sha1", "sha256"] as const).flatMap(format =>
  (["none", "protocol", "corrupt", "finish", "unreaped-valid", "unreaped-protocol", "denied-valid", "denied-protocol", "abort", "timeout", "delayed"] as const).map(fault => ({ format, fault }))))(
  "evidence $format selects terminal $fault only after confirmed cleanup", async ({ format, fault }) => {
    const controller = new AbortController(), p = await processFixture(format, fault, controller);
    const errors = vi.spyOn(console, "error"), warnings = vi.spyOn(console, "warn");
    try {
      if (fault === "timeout") {
        const now = performance.now.bind(performance); let calls = 0;
        vi.spyOn(performance, "now").mockImplementation(() => now() + (calls++ === 0 ? -9900 : 0));
      }
      let settled = false;
      const started = Date.now();
      const pending = readGitPublicationEvidence({ repository: p.f.repository, commit: p.commit, indexPath: "index.json" }, { signal: controller.signal })
        .then(r => { settled = true; return r; });
      if (fault === "delayed") {
        await vi.waitFor(() => expect(p.release).toBeTypeOf("function"));
        expect(settled).toBe(false); expect(p.children[1]!.closed).toBe(false); p.release!();
      }
      const result = await pending;
      const incomplete = fault.startsWith("unreaped") || fault.startsWith("denied");
      if (fault === "none" || fault === "delayed") {
        const e = value(result); expect(e.indexBase64).toBe("e30="); frozen(e);
      } else {
        const code = incomplete ? "GIT_CLEANUP_FAILED" : fault === "corrupt" ? "GIT_OBJECT_INTEGRITY" : fault === "protocol" ? "GIT_PROTOCOL_ERROR"
          : fault === "finish" ? "GIT_FAILED" : fault === "abort" ? "GIT_ABORTED" : "GIT_TIMEOUT";
        expect(result).toEqual(bad(code)); expect(Date.now() - started).toBeLessThan(1500);
      }
      if (incomplete) { expect(p.children[1]!.closed).toBe(false); expect(p.kill).toHaveBeenCalledTimes(1); }
      else expect(p.children.every(c => c.closed)).toBe(true);
      expect(p.children.every(c => c.stdin.destroyed && c.stdout.destroyed && c.stderr.destroyed)).toBe(true);
      const count = p.requests.length; await new Promise(resolve => setTimeout(resolve, 5)); expect(p.requests).toHaveLength(count);
      for (const secret of [p.f.repository.directory, "synthetic-stderr-secret", "synthetic-protocol-secret", "synthetic-kill-secret", "/synthetic-private"])
        expect(JSON.stringify(result)).not.toContain(secret);
      expect(errors).not.toHaveBeenCalled(); expect(warnings).not.toHaveBeenCalled();
    } finally { await p.dispose(); }
  });

it.each([false, true].flatMap(trees => [false, true].map(extra => ({ trees, extra }))))(
  "actual session charges repeated objects at request ceiling: trees=$trees extra=$extra", async ({ trees, extra }) => {
    const controller = new AbortController();
    // root-only: 1 commit + 1 root + 4094 leaves =4096 objects;
    // repeated subtrees: 1 commit +3 trees +4090 leaves +2 root leaves =4096.
    const p = await processFixture("sha1", "none", controller, (trees ? 2 : 4094) + Number(extra), trees);
    try {
      const result = await readGitPublicationEvidence({ repository: p.f.repository, commit: p.commit, indexPath: "absent.json" });
      expect(p.requests).toHaveLength(8192);
      if (extra) expect(result).toEqual(bad("LIMIT_EXCEEDED"));
      else expect(value(result).inventory.entries).toHaveLength(4094);
      expect(p.requests.filter(line => line === `info ${p.blob}\n`)).toHaveLength((trees ? 4092 : 4094) + Number(extra));
      expect(p.children.every(c => c.closed)).toBe(true);
      expect(p.children.every(c => c.stdin.destroyed && c.stdout.destroyed && c.stderr.destroyed)).toBe(true);
    } finally { await p.dispose(); }
  });

it.each(["hash", "freeze"].flatMap(stage => ["abort", "timeout"].map(stop => ({ stage, stop }))))(
  "checks $stop during $stage through the actual session", async ({ stage, stop }) => {
    const controller = new AbortController(), p = await processFixture("sha1", "none", controller);
    try {
      let interrupted = false;
      const interrupt = () => { interrupted = true; if (stop === "abort") controller.abort(); else vi.spyOn(performance, "now").mockReturnValue(1e12); };
      if (stage === "hash") {
        const actual = crypto.createHash;
        // SHA1 Git integrity is separate; the only SHA256 here is actual file-body evidence hashing.
        vi.spyOn(crypto, "createHash").mockImplementation((...args) => { const h = actual(...args); if (args[0] === "sha256") interrupt(); return h; });
      } else {
        const actual = Object.freeze;
        vi.spyOn(Object, "freeze").mockImplementation((v: unknown) => {
          const out = actual(v);
          if (v && typeof v === "object" && "inventory" in v) { expect(p.children.every(c => c.closed)).toBe(true); interrupt(); }
          return out;
        });
      }
      expect(await readGitPublicationEvidence({ repository: p.f.repository, commit: p.commit, indexPath: "index.json" }, { signal: controller.signal }))
        .toEqual(bad(stop === "abort" ? "GIT_ABORTED" : "GIT_TIMEOUT"));
      expect(interrupted).toBe(true); expect(p.children.every(c => c.closed)).toBe(true);
    } finally { await p.dispose(); }
  });
