import { expect, it, vi, afterEach } from "vitest";
import { spawn, execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { performance } from "node:perf_hooks";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import type { OfflineGitResult, OfflineGitRepository } from "./git-session";
vi.mock("node:fs/promises", async importOriginal => ({ ...await importOriginal<typeof import("node:fs/promises")>() }));
vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});
const realSpawn = (await vi.importActual<typeof import("node:child_process")>("node:child_process")).spawn;
const spawnMock = vi.mocked(spawn);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const ok = { ok: true, value: true };
const bad = (code: string, at = "git") => ({ ok: false, issues: [{ code, at }] });
function value<T>(result: OfflineGitResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Fixture result rejected");
  return result.value;
}
const template = (format: "sha1" | "sha256", mode: boolean) => `[core]\n\trepositoryformatversion = ${format === "sha1" ? 0 : 1}\n\tfilemode = ${mode}\n\tbare = true\n` + (format === "sha256" ? "[extensions]\n\tobjectformat = sha256\n" : "");
const prefix = (directory: string) => ["--no-pager", "--no-replace-objects", "--no-optional-locks", `--git-dir=${directory}`, "-c", "protocol.allow=never", "-c", "credential.helper=", "-c", "core.hooksPath=/dev/null", "-c", "maintenance.auto=false", "-c", "gc.auto=0"];
const expectedOptions = (directory: string) => ({ cwd: directory, shell: false, detached: true, stdio: ["pipe", "pipe", "pipe"], env: {
  PATH: "", HOME: "/dev/null", XDG_CONFIG_HOME: "/dev/null", LC_ALL: "C", LANG: "C", GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_ALLOW_PROTOCOL: "",
  GIT_OPTIONAL_LOCKS: "0", GIT_ATTR_NOSYSTEM: "1",
} });
import { createGitFixture } from "./git-fixtures";
import { createGitOperation, openGitObjectSession, OFFLINE_GIT_LIMITS } from "./git-session";

it.each(["sha1", "sha256"] as const)("reads exact binary %s objects", async format => {
  const fixture = await createGitFixture(format);
  try {
    const bytes = Buffer.from([0, 255, 10, 0]);
    const oid = await fixture.object("blob", bytes);
    const opened = await openGitObjectSession(fixture.repository, createGitOperation());
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error("fixture session rejected");
    const session = opened.value;
    try {
      const info = await session.info(oid);
      expect(info).toEqual({ ok: true, value: { oid, type: "blob", size: 4 } });
      if (!info.ok) throw new Error("fixture info rejected");
      expect(await session.contents(info.value, 4)).toEqual({ ok: true, value: bytes });
      expect(await session.finish()).toEqual({ ok: true, value: true });
    } finally { expect(await session.dispose()).toEqual({ ok: true, value: true }); }
  } finally { await fixture.dispose(); }
});

it.each(["sha1", "sha256"] as const)("verifies %s commit/tree/blob/tag bodies and ignores replacement refs", async format => {
  const fixture = await createGitFixture(format);
  try {
    const blobBytes = Buffer.from("original");
    const blob = await fixture.object("blob", blobBytes);
    const replacement = await fixture.object("blob", Buffer.from("replaced"));
    // Only owned fixture refs, no real project ref changes.
    await new Promise<void>((resolve, reject) => {
      execFile("/usr/bin/git", [`--git-dir=${fixture.repository.directory}`, "update-ref", `refs/replace/${blob}`, replacement],
        { cwd: fixture.repository.directory, env: expectedOptions(fixture.repository.directory).env, timeout: 5000, maxBuffer: 1024 },
        error => error ? reject(error) : resolve());
    });
    const tree = await fixture.object("tree", Buffer.concat([Buffer.from("100644 item\0"), Buffer.from(blob, "hex")]));
    const commit = await fixture.commit([{ path: "nested/item", bytes: blobBytes }]);
    const tagBytes = Buffer.from(`object ${blob}\ntype blob\ntag example\ntagger Fixture <fixture@example.invalid> 946684800 +0000\n\nInert tag\n`);
    const tag = await fixture.object("tag", tagBytes);
    const session = value(await openGitObjectSession(fixture.repository, createGitOperation()));
    try {
      for (const [oid, type] of [[blob, "blob"], [tree, "tree"], [commit, "commit"], [tag, "tag"]]) {
        const info = value(await session.info(oid!));
        expect(info.type).toBe(type);
        const bytes = value(await session.contents(info, 262144));
        expect(createHash(format).update(`${type} ${bytes.length}\0`).update(bytes).digest("hex")).toBe(oid);
        if (type === "blob") expect(bytes).toEqual(blobBytes);
      }
      expect(await session.finish()).toEqual(ok);
      expect(await session.finish()).toEqual(ok);
      expect(await session.info(blob)).toEqual(bad("INVALID_GIT_INPUT"));
    } finally { expect(await session.dispose()).toEqual(ok); }
  } finally { await fixture.dispose(); }
});
it.each(["sha1", "sha256"] as const)("detects same-size %s loose object corruption despite echoed OID", async format => {
  const fixture = await createGitFixture(format);
  try {
    const oid = await fixture.object("blob", Buffer.from("one"));
    const filename = join(fixture.repository.directory, "objects", oid.slice(0, 2), oid.slice(2));
    await fs.unlink(filename);
    await fs.writeFile(filename, deflateSync(Buffer.from("blob 3\0two")));
    const session = value(await openGitObjectSession(fixture.repository, createGitOperation()));
    const info = value(await session.info(oid));
    expect(info).toEqual({ oid, type: "blob", size: 3 });
    expect(await session.contents(info, 3)).toEqual(bad("GIT_OBJECT_INTEGRITY"));
    expect(await session.finish()).toEqual(bad("GIT_OBJECT_INTEGRITY"));
    expect(await session.dispose()).toEqual(ok);
  } finally { await fixture.dispose(); }
});
it.each(["sha1", "sha256"] as const)("distinguishes missing literal %s objects and refuses refs/format mismatches", async format => {
  const fixture = await createGitFixture(format);
  try {
    for (const [oid, code, at] of [["0".repeat(format === "sha1" ? 40 : 64), "GIT_OBJECT_MISSING", "git"],
      ["1".repeat(format === "sha1" ? 64 : 40), "INVALID_GIT_INPUT", "commit"], ["HEAD", "INVALID_GIT_INPUT", "commit"],
      ["--all", "INVALID_GIT_INPUT", "commit"], ["a".repeat(40) + "\n", "INVALID_GIT_INPUT", "commit"]]) {
      const session = value(await openGitObjectSession(fixture.repository, createGitOperation()));
      expect(await session.info(oid!)).toEqual(bad(code!, at));
      expect(await session.dispose()).toEqual(ok);
    }
  } finally { await fixture.dispose(); }
});
it.each(["sha1", "sha256"] as const)("accepts both exact filemode templates in %s storage", async format => {
  const fixture = await createGitFixture(format);
  try {
    for (const mode of [true, false]) {
      await fs.writeFile(join(fixture.repository.directory, "config"), template(format, mode));
      const session = value(await openGitObjectSession(fixture.repository, createGitOperation()));
      expect(session.objectFormat).toBe(format);
      expect(await session.finish()).toEqual(ok);
      expect(await session.dispose()).toEqual(ok);
    }
  } finally { await fixture.dispose(); }
});
it.each(["config-include", "config-credential", "config-remote", "config-promisor", "config-comment", "config-oversized", "checkout",
  "commondir", "config.worktree", "objects/info/alternates", "objects/info/http-alternates", "promisor", "pack-overflow", "config-symlink", "objects-symlink", "info-symlink", "pack-symlink", "directory-symlink"])("rejects %s provisioning before any Git spawn", async poison => {
  const fixture = await createGitFixture();
  const directory = fixture.repository.directory;
  try {
    const base = template("sha1", true);
    const poisonConfig: Record<string, string> = {
      "config-include": `${base}[include]\n\tpath = /DO_NOT_READ\n`,
      "config-credential": `${base}[credential]\n\thelper = !DO_NOT_EXECUTE\n`,
      "config-remote": `${base}[remote "origin"]\n\turl = https://DO_NOT_CONNECT.invalid/repo\n`,
      "config-promisor": `${base}[extensions]\n\tpartialClone = origin\n`,
      "config-comment": `${base}# comment\n`, "config-oversized": "x".repeat(4097),
      checkout: base.replace("bare = true", "bare = false"),
    };
    if (poison in poisonConfig) await fs.writeFile(join(directory, "config"), poisonConfig[poison]!);
    else if (poison === "promisor") await fs.writeFile(join(directory, "objects/pack/test.promisor"), "");
    else if (poison === "pack-overflow") for (let n = 0; n < 513; n++) await fs.writeFile(join(directory, `objects/pack/p${n}`), "");
    else if (poison.endsWith("-symlink")) {
      const name = ({ "config-symlink": "config", "objects-symlink": "objects", "info-symlink": "objects/info", "pack-symlink": "objects/pack" } as Record<string, string>)[poison];
      if (name) { await fs.rename(join(directory, name), join(directory, `${name}-owned`)); await fs.symlink(`${name.split("/").at(-1)}-owned`, join(directory, name)); }
      else { await fs.symlink(".", join(directory, "alias")); fixture.repository.directory = join(directory, "alias"); }
    } else await fs.symlink("DO_NOT_FOLLOW", join(directory, poison));
    spawnMock.mockClear();
    expect(await openGitObjectSession(fixture.repository, createGitOperation())).toEqual(bad(poison === "pack-overflow" ? "LIMIT_EXCEEDED" : "UNSUPPORTED_GIT_STORAGE", "repository"));
    expect(spawnMock).not.toHaveBeenCalled();
  } finally { await fixture.dispose(); }
});
it("accepts 512 pack entries without recursively inspecting their contents", async () => {
  const fixture = await createGitFixture();
  try {
    for (let n = 0; n < 512; n++) await fs.writeFile(join(fixture.repository.directory, `objects/pack/p${n}`), "");
    const session = value(await openGitObjectSession(fixture.repository, createGitOperation()));
    expect(await session.finish()).toEqual(ok);
  } finally { await fixture.dispose(); }
});
it("validates own repository data properties before I/O without invoking accessors", async () => {
  const getter = vi.fn(() => "/DO_NOT_READ");
  for (const repository of [null, {}, { directory: "/tmp", gitExecutable: "git" }, { directory: "/tmp", gitExecutable: "/usr/bin/git", extra: 1 },
    { directory: "relative", gitExecutable: "/usr/bin/git" }, { directory: "/" + "x".repeat(4096), gitExecutable: "/usr/bin/git" },
    { directory: "/a\0b", gitExecutable: "/usr/bin/git" }, Object.defineProperty({ gitExecutable: "/usr/bin/git" }, "directory", { enumerable: true, get: getter })]) {
    spawnMock.mockClear();
    expect(await openGitObjectSession(repository as OfflineGitRepository, createGitOperation())).toEqual(bad("INVALID_GIT_INPUT", "repository"));
    expect(spawnMock).not.toHaveBeenCalled();
  }
  expect(getter).not.toHaveBeenCalled();
});
it("pre-abort rejects without spawning or touching supplied storage", async () => {
  const controller = new AbortController(); controller.abort(); spawnMock.mockClear();
  expect(await openGitObjectSession({ directory: "/DO_NOT_READ", gitExecutable: "/usr/bin/git" }, createGitOperation(controller.signal))).toEqual(bad("GIT_ABORTED"));
  expect(spawnMock).not.toHaveBeenCalled();
});
it("uses exactly two fixed children with constant env, never ambient credentials/config/trace", async () => {
  const fixture = await createGitFixture();
  try {
    const oid = await fixture.object("blob", Buffer.from("bytes"));
    for (const key of ["GIT_CONFIG_COUNT", "GIT_TRACE", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "HTTPS_PROXY", "SSH_AUTH_SOCK", "GIT_SSH_COMMAND", "LD_PRELOAD", "NODE_OPTIONS", "HOME", "PATH"]) vi.stubEnv(key, "DO_NOT_INHERIT");
    spawnMock.mockClear();
    const session = value(await openGitObjectSession(fixture.repository, createGitOperation()));
    value(await session.contents(value(await session.info(oid)), 5));
    expect(await session.finish()).toEqual(ok);
    expect(spawnMock.mock.calls).toEqual([
      ["/usr/bin/git", [...prefix(fixture.repository.directory), "rev-parse", "--is-bare-repository", "--show-object-format=storage"], expectedOptions(fixture.repository.directory)],
      ["/usr/bin/git", [...prefix(fixture.repository.directory), "cat-file", "--batch-command"], expectedOptions(fixture.repository.directory)],
    ]);
  } finally { vi.unstubAllEnvs(); await fixture.dispose(); }
});
it.each([NaN, Infinity, -1, 1.5])("rejects invalid maximum %s before contents writes", async max => {
  const fixture = await createGitFixture();
  try {
    const oid = await fixture.object("blob", Buffer.from("x"));
    const session = value(await openGitObjectSession(fixture.repository, createGitOperation()));
    const info = value(await session.info(oid));
    expect(Object.isFrozen(info)).toBe(true);
    expect(() => Object.assign(info, { oid: "0".repeat(40) })).toThrow();
    expect(await session.contents(info, max)).toEqual(bad("INVALID_GIT_INPUT"));
    expect(await session.dispose()).toEqual(ok);
  } finally { await fixture.dispose(); }
});
it("rejects forged metadata and records issued by a different session", async () => {
  const fixture = await createGitFixture();
  try {
    const oid = await fixture.object("blob", Buffer.from("x"));
    const session = value(await openGitObjectSession(fixture.repository, createGitOperation()));
    const record = value(await session.info(oid));
    expect(await session.contents({ ...record }, 1)).toEqual(bad("INVALID_GIT_INPUT"));
    expect(await session.dispose()).toEqual(ok);
    const other = value(await openGitObjectSession(fixture.repository, createGitOperation()));
    expect(await other.contents(record, 1)).toEqual(bad("INVALID_GIT_INPUT"));
    expect(await other.dispose()).toEqual(ok);
  } finally { await fixture.dispose(); }
});

// Trusted test processes instrument the actual private session, not an alternate parser.
type FakeChild = ReturnType<typeof fakeChild>;
function fakeChild(pid: number, onCommand: (line: string, child: FakeChild) => void, onEnd?: (child: FakeChild) => void) {
  const emitter = new EventEmitter();
  const stdout = new PassThrough(), stderr = new PassThrough();
  const writes: string[] = [];
  let child: ReturnType<typeof build>;
  function build() {
    const stdin = new Writable({
      write(chunk, _encoding, callback) { const line = chunk.toString(); writes.push(line); callback(); queueMicrotask(() => onCommand(line, child)); },
      final(callback) { callback(); queueMicrotask(() => onEnd ? onEnd(child) : child.close(0)); },
    });
    return Object.assign(emitter, { stdin, stdout, stderr, pid, writes, exitCode: null as number | null, signalCode: null as NodeJS.Signals | null, closed: false,
      close(code: number | null, signal: NodeJS.Signals | null = null) {
        if (child.closed) return;
        child.closed = true; child.exitCode = code; child.signalCode = signal;
        stdout.end(); stderr.end(); stdin.destroy(); stdout.destroy(); stderr.destroy();
        emitter.emit("close", code, signal);
      },
    });
  }
  child = build();
  queueMicrotask(() => emitter.emit("spawn"));
  return child;
}
async function fakeSession(options: {
  command?: (line: string, child: FakeChild) => void;
  rev?: (child: FakeChild) => void;
  end?: (child: FakeChild) => void;
  kill?: (child: FakeChild) => void;
  batchError?: string;
  signal?: AbortSignal;
  operation?: ReturnType<typeof createGitOperation>;
} = {}) {
  const fixture = await createGitFixture();
  const children: FakeChild[] = [];
  const kill = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
    const child = children.find(c => c.pid === -pid);
    expect(child).toBeDefined(); expect(signal).toBe("SIGKILL");
    if (options.kill) options.kill(child!); else queueMicrotask(() => child!.close(null, "SIGKILL"));
    return true;
  });
  spawnMock.mockImplementation(((_executable: string, args: readonly string[]) => {
    const batch = args.includes("cat-file");
    expect(children.every(c => c.closed)).toBe(true);
    const child = fakeChild(987000 + children.length, options.command ?? ((_line, c) => c.stdout.write(`${emptyOid} blob 0\n`)),
      batch ? options.end : c => {
        if (options.rev) options.rev(c);
        else { c.stdout.write("true\nsha1\n"); c.close(0); }
      });
    children.push(child);
    if (batch && options.batchError) queueMicrotask(() => { child.emit("error", Object.assign(new Error("SENSITIVE_RAW_CAUSE"), { code: options.batchError })); child.close(-2); });
    return child;
  }) as unknown as typeof spawn);
  const opened = await openGitObjectSession(fixture.repository, options.operation ?? createGitOperation(options.signal));
  return { fixture, opened, children, kill, async dispose() {
    if (opened.ok) await opened.value.dispose();
    for (const child of children) {
      if (!child.closed) child.close(null, "SIGKILL");
      child.removeAllListeners();
    }
    spawnMock.mockReset(); spawnMock.mockImplementation(realSpawn);
    kill.mockRestore(); await fixture.dispose();
  } };
}
const emptyOid = createHash("sha1").update("blob 0\0").digest("hex");
it("does not hand out a session before batch spawn failure is known", async () => {
  const fake = await fakeSession({ batchError: "ENOENT" });
  try { expect(fake.opened).toEqual(bad("GIT_UNAVAILABLE")); }
  finally { await fake.dispose(); }
});
it("parses binary bodies and headers split byte-by-byte without ASCII aliases", async () => {
  const bytes = Buffer.from([0, 255, 10, 0]);
  const oid = createHash("sha1").update("blob 4\0").update(bytes).digest("hex");
  const fake = await fakeSession({ command: (line, c) => {
    const response = Buffer.concat([Buffer.from(`${oid} blob 4\n`), ...(line.startsWith("contents") ? [bytes, Buffer.from("\n")] : [])]);
    for (const byte of response) c.stdout.write(Buffer.from([byte]));
  } });
  try {
    const session = value(fake.opened);
    expect(value(await session.contents(value(await session.info(oid)), 4))).toEqual(bytes);
    expect(await session.finish()).toEqual(ok);
    expect(fake.children.every(c => c.closed && c.stdin.destroyed && c.stdout.destroyed && c.stderr.destroyed)).toBe(true);
    expect(fake.children.every(c => c.listenerCount("close") === 0 && c.stdout.listenerCount("data") === 0)).toBe(true);
    expect(fake.kill).not.toHaveBeenCalled();
  } finally { await fake.dispose(); }
});
it.each([
  ["negative", `${emptyOid} blob -1\n`, "GIT_PROTOCOL_ERROR"], ["leading-zero", `${emptyOid} blob 00\n`, "GIT_PROTOCOL_ERROR"],
  ["overflow-size", `${emptyOid} blob 9007199254740992\n`, "GIT_PROTOCOL_ERROR"], ["fraction", `${emptyOid} blob 1.5\n`, "GIT_PROTOCOL_ERROR"],
  ["wrong-oid", `${"0".repeat(40)} blob 0\n`, "GIT_PROTOCOL_ERROR"], ["wrong-type", `${emptyOid} delta 0\n`, "GIT_PROTOCOL_ERROR"],
  ["extra-output", `${emptyOid} blob 0\nextra`, "GIT_PROTOCOL_ERROR"], ["header-overflow", "x".repeat(129), "LIMIT_EXCEEDED"],
  ["missing", `${emptyOid} missing\n`, "GIT_OBJECT_MISSING"], ["empty-header", "\n", "GIT_PROTOCOL_ERROR"],
])("rejects %s batch response and stops further writes after confirmed cleanup", async (_name, response, code) => {
  const fake = await fakeSession({ command: (_line, child) => child.stdout.write(response!) });
  try {
    const session = value(fake.opened);
    expect(await session.info(emptyOid)).toEqual(bad(code!));
    expect(await session.dispose()).toEqual(ok);
    const writes = fake.children[1]!.writes.length;
    expect((await session.info(emptyOid)).ok).toBe(false);
    expect(fake.children[1]!.writes).toHaveLength(writes);
    expect(fake.children.every(c => c.closed)).toBe(true);
    expect(fake.kill).toHaveBeenCalledTimes(1);
  } finally { await fake.dispose(); }
});
it("rejects high-bit header aliases before any ASCII conversion", async () => {
  const header = Buffer.from(`${emptyOid} blob 0\n`); header[0] = header[0]! | 128;
  const fake = await fakeSession({ command: (_line, c) => c.stdout.write(header) });
  try { expect(await value(fake.opened).info(emptyOid)).toEqual(bad("GIT_PROTOCOL_ERROR")); }
  finally { await fake.dispose(); }
});
it.each(["wrong-type", "wrong-size", "wrong-terminator", "short-body", "short-header", "failed-exit", "signal", "epipe"])("rejects %s and suppresses incomplete content", async problem => {
  const fake = await fakeSession({ command: (line, c) => {
    if (line.startsWith("info")) { c.stdout.write(`${emptyOid} blob 0\n`); return; }
    if (problem === "short-header") { c.stdout.write(emptyOid); c.close(0); }
    if (problem === "wrong-type") c.stdout.write(`${emptyOid} tree 0\n\n`);
    if (problem === "wrong-size") c.stdout.write(`${emptyOid} blob 1\nx\n`);
    if (problem === "wrong-terminator") c.stdout.write(`${emptyOid} blob 0\nx`);
    if (problem === "short-body") { c.stdout.write(`${emptyOid} blob 0\n`); c.close(0); }
    if (problem === "failed-exit") { c.stdout.write(`${emptyOid} blob 0\n\n`); c.close(1); }
    if (problem === "signal") { c.stdout.write(`${emptyOid} blob 0\n\n`); c.close(null, "SIGTERM"); }
    if (problem === "epipe") c.stdin.emit("error", Object.assign(new Error("SENSITIVE_RAW_PIPE"), { code: "EPIPE" }));
  } });
  try {
    const session = value(fake.opened); const info = value(await session.info(emptyOid));
    expect(await session.contents(info, 0)).toEqual(bad(["failed-exit", "signal", "epipe"].includes(problem) ? "GIT_FAILED" : "GIT_PROTOCOL_ERROR"));
    expect(await session.dispose()).toEqual(ok);
  } finally { await fake.dispose(); }
});
it.each(["nonzero", "signal", "format", "overflow"])("rejects rev-parse %s without starting batch", async problem => {
  const fake = await fakeSession({ rev: child => {
    child.stdout.write(problem === "format" ? "true\nsha256\n" : problem === "overflow" ? "x".repeat(33) : "true\nsha1\n");
    child.close(problem === "nonzero" ? 1 : problem === "signal" ? null : 0, problem === "signal" ? "SIGTERM" : null);
  } });
  try {
    expect(fake.opened).toEqual(bad(problem === "format" ? "UNSUPPORTED_GIT_STORAGE" : problem === "overflow" ? "LIMIT_EXCEEDED" : "GIT_FAILED", problem === "format" ? "repository" : "git"));
    expect(fake.children).toHaveLength(1);
  } finally { await fake.dispose(); }
});
it("waits for normal close before success and rejects a failed exit after valid contents", async () => {
  let end!: FakeChild;
  const fake = await fakeSession({ command: (line, c) => c.stdout.write(`${emptyOid} blob 0\n${line.startsWith("contents") ? "\n" : ""}`), end: child => { end = child; } });
  try {
    const session = value(fake.opened);
    expect(value(await session.contents(value(await session.info(emptyOid)), 0))).toEqual(Buffer.alloc(0));
    let settled = false;
    const finishing = session.finish().then(result => { settled = true; return result; });
    await new Promise(resolve => setImmediate(resolve));
    expect(settled).toBe(false); end.close(1);
    expect(await finishing).toEqual(bad("GIT_FAILED"));
    expect(await session.dispose()).toEqual(ok);
  } finally { await fake.dispose(); }
});
it.each(["rev", "batch"])("aborts during %s, kills only owned group and reaps", async where => {
  const controller = new AbortController();
  const fake = await fakeSession({ signal: controller.signal,
    rev: child => { if (where === "rev") controller.abort(); else { child.stdout.write("true\nsha1\n"); child.close(0); } },
    command: () => controller.abort(),
  });
  try {
    expect(where === "rev" ? fake.opened : await value(fake.opened).info(emptyOid)).toEqual(bad("GIT_ABORTED"));
    expect(fake.children.every(c => c.closed)).toBe(true);
    expect(fake.kill).toHaveBeenCalledTimes(1);
  } finally { await fake.dispose(); }
});
it("checks the shared deadline between children, rather than resetting it", async () => {
  const now = performance.now();
  const clock = vi.spyOn(performance, "now").mockReturnValue(now);
  const fake = await fakeSession({ operation: { deadline: now + 10000 }, rev: child => { clock.mockReturnValue(now + 9999); child.stdout.write("true\nsha1\n"); child.close(0); }, command: (_line, child) => { clock.mockReturnValue(now + 10001); child.stdout.write(`${emptyOid} blob 0\n`); } });
  try {
    const session = value(fake.opened);
    expect(await session.info(emptyOid)).toEqual(bad("GIT_TIMEOUT"));
    expect(await session.dispose()).toEqual(ok);
  } finally { await fake.dispose(); clock.mockRestore(); }
}, 15000);
it.each([false, true])("bounds cleanup when OS denies termination; prior error=%s", async prior => {
  const fake = await fakeSession({ command: (_line, c) => c.stdout.write(prior ? "bad\n" : `${emptyOid} blob 0\n`),
    end: c => c.stdin.emit("error", new Error("SENSITIVE_CLOSE")),
    kill: () => { throw Object.assign(new Error("SENSITIVE_KILL_DENIED"), { code: "EPERM" }); },
  });
  try {
    const session = value(fake.opened); const start = performance.now();
    const result = await session.info(emptyOid);
    if (prior) expect(result).toEqual(bad("GIT_CLEANUP_FAILED"));
    else { expect(result.ok).toBe(true); expect(await session.finish()).toEqual(bad("GIT_CLEANUP_FAILED")); }
    expect(performance.now() - start).toBeLessThan(1000);
    expect(await session.dispose()).toEqual(bad("GIT_CLEANUP_FAILED"));
    expect(await session.dispose()).toEqual(bad("GIT_CLEANUP_FAILED"));
    expect(fake.kill).toHaveBeenCalledTimes(1);
    expect(fake.children[1]!.stdin.destroyed).toBe(true);
  } finally { await fake.dispose(); }
});
it("preserves protocol error over kill errors when required close is confirmed", async () => {
  const fake = await fakeSession({ command: (_line, c) => c.stdout.write("invalid\n"), kill: child => {
    queueMicrotask(() => child.close(null, "SIGKILL")); throw Object.assign(new Error("SENSITIVE_SECONDARY"), { code: "EPERM" });
  } });
  try { expect(await value(fake.opened).info(emptyOid)).toEqual(bad("GIT_PROTOCOL_ERROR")); expect(await value(fake.opened).dispose()).toEqual(ok); }
  finally { await fake.dispose(); }
});
it.each([0, 1])("charges stderr cumulatively across both children at limit + %i", async extra => {
  const fake = await fakeSession({ rev: c => { c.stderr.write(Buffer.alloc(32768)); c.stdout.write("true\nsha1\n"); c.close(0); },
    command: (_line, c) => { c.stderr.write(Buffer.alloc(32768 + extra)); c.stdout.write(`${emptyOid} blob 0\n`); },
  });
  try {
    const session = value(fake.opened), result = await session.info(emptyOid);
    if (extra) expect(result).toEqual(bad("LIMIT_EXCEEDED"));
    else { expect(result.ok).toBe(true); expect(await session.finish()).toEqual(ok); }
  } finally { await fake.dispose(); }
});
it.each([0, 1])("charges stdout framing and bodies cumulatively at limit + %i", async extra => {
  // 10 rev-parse bytes + two 55-byte headers + one body terminator.
  let size = OFFLINE_GIT_LIMITS.stdoutBytes - 121;
  const bytes = Buffer.alloc(size + extra);
  size = bytes.length;
  const oid = createHash("sha1").update(`blob ${size}\0`).update(bytes).digest("hex");
  const fake = await fakeSession({ command: (line, c) => {
    c.stdout.write(`${oid} blob ${size}\n`);
    if (line.startsWith("contents")) { c.stdout.write(bytes); c.stdout.write("\n"); }
  } });
  try {
    const session = value(fake.opened); const info = value(await session.info(oid));
    const result = await session.contents(info, size);
    if (extra) { expect(result.ok).toBe(false); expect(result).toEqual(bad("LIMIT_EXCEEDED")); }
    else { expect(value(result).equals(bytes)).toBe(true); expect(await session.finish()).toEqual(ok); }
  } finally { await fake.dispose(); }
});
it("allows 8192 requests then rejects request 8193 before writing stdin", async () => {
  const fake = await fakeSession();
  try {
    const session = value(fake.opened);
    for (let i = 0; i < 8192; i++) expect((await session.info(emptyOid)).ok).toBe(true);
    expect(await session.info(emptyOid)).toEqual(bad("LIMIT_EXCEEDED"));
    expect(fake.children[1]!.writes).toHaveLength(8192);
    // stdin overflow is unreachable for literal IDs under the stricter request bound:
    // longest authorized request = "contents " + 64 hex + LF = 74 bytes.
    expect(OFFLINE_GIT_LIMITS.commands * 74).toBeLessThan(OFFLINE_GIT_LIMITS.stdinBytes);
  } finally { await fake.dispose(); }
});

it("aborts while config is opening, closes the resulting owned handle and never spawns", async () => {
  const fixture = await createGitFixture();
  const controller = new AbortController();
  const original = fs.open;
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    vi.spyOn(fs, "open").mockImplementationOnce(async (...args) => {
      handle = await original(...args); controller.abort(); return handle;
    });
    spawnMock.mockClear();
    expect(await openGitObjectSession(fixture.repository, createGitOperation(controller.signal))).toEqual(bad("GIT_ABORTED"));
    expect(handle!.fd).toBe(-1); expect(spawnMock).not.toHaveBeenCalled();
  } finally { if (handle && handle.fd !== -1) await handle.close(); await fixture.dispose(); }
});
it.each([false, true])("config close errors are redacted; actual close confirmed=%s", async confirmed => {
  const fixture = await createGitFixture();
  const original = fs.open;
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  let close: (() => Promise<void>) | undefined;
  try {
    vi.spyOn(fs, "open").mockImplementationOnce(async (...args) => {
      handle = await original(...args); close = handle.close.bind(handle);
      handle.close = async () => { if (confirmed) await close!(); throw new Error("SENSITIVE_CLOSE_ERROR"); };
      return handle;
    });
    spawnMock.mockClear();
    expect(await openGitObjectSession(fixture.repository, createGitOperation())).toEqual(bad(confirmed ? "GIT_FAILED" : "GIT_CLEANUP_FAILED"));
    expect(spawnMock).not.toHaveBeenCalled();
  } finally { if (close && handle!.fd !== -1) await close(); await fixture.dispose(); }
});
it("snapshots trusted repository fields before the first await", async () => {
  const fixture = await createGitFixture();
  try {
    const input = { ...fixture.repository };
    const pending = openGitObjectSession(input, createGitOperation());
    input.directory = "/DO_NOT_READ"; input.gitExecutable = "/DO_NOT_EXECUTE";
    const session = value(await pending); expect(await session.finish()).toEqual(ok);
  } finally { await fixture.dispose(); }
});
it("rejects unsupported platform before any metadata or process access", async () => {
  vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  spawnMock.mockClear();
  expect(await openGitObjectSession({ directory: "/DO_NOT_READ", gitExecutable: "/DO_NOT_EXECUTE" }, createGitOperation())).toEqual(bad("UNSUPPORTED_GIT_STORAGE", "repository"));
  expect(spawnMock).not.toHaveBeenCalled();
});
it.each([false, true])("a missing response reaches one work deadline and bounded cleanup; kill denied=%s", async denied => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const fake = await fakeSession({ command: () => {}, ...(denied ? { kill: () => { throw Object.assign(new Error("DENIED"), { code: "EPERM" }); } } : {}) });
  try {
    const session = value(fake.opened);
    let settled = false;
    const pending = session.info(emptyOid).then(result => { settled = true; return result; });
    await vi.advanceTimersByTimeAsync(9990); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(10);
    if (denied) { expect(settled).toBe(false); await vi.advanceTimersByTimeAsync(250); }
    expect(await pending).toEqual(bad(denied ? "GIT_CLEANUP_FAILED" : "GIT_TIMEOUT"));
    expect(vi.getTimerCount()).toBe(0);
    expect(fake.kill).toHaveBeenCalledTimes(1);
    expect(await session.dispose()).toEqual(denied ? bad("GIT_CLEANUP_FAILED") : ok);
  } finally { await fake.dispose(); vi.useRealTimers(); }
});
it.each(["info", "finish"] as const)("explicit disposal cancels pending %s after confirmed reaping", async method => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const fake = await fakeSession({ command: () => {}, end: () => {} });
  try {
    const session = value(fake.opened);
    const pending = method === "info" ? session.info(emptyOid) : session.finish();
    expect(await session.dispose()).toEqual(ok);
    expect(await pending).toEqual(bad("GIT_ABORTED"));
    expect(await session.dispose()).toEqual(ok);
    expect(vi.getTimerCount()).toBe(0);
    expect(fake.children.every(child => child.closed && child.listenerCount("close") === 0)).toBe(true);
    expect(fake.kill).toHaveBeenCalledTimes(1);
  } finally { await fake.dispose(); vi.useRealTimers(); }
});
it.each(["info", "finish"] as const)("explicit disposal settles pending %s when kill returns without close", async method => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const controller = new AbortController();
  const add = vi.spyOn(controller.signal, "addEventListener"), remove = vi.spyOn(controller.signal, "removeEventListener");
  const fake = await fakeSession({ signal: controller.signal, command: () => {}, end: () => {}, kill: () => {} });
  try {
    const session = value(fake.opened);
    let result: unknown, cleanup: unknown;
    const pending = (method === "info" ? session.info(emptyOid) : session.finish()).then(value => { result = value; });
    const disposing = session.dispose().then(value => { cleanup = value; });
    await vi.advanceTimersByTimeAsync(0);
    expect(result).toBeUndefined(); expect(cleanup).toBeUndefined();
    await vi.advanceTimersByTimeAsync(OFFLINE_GIT_LIMITS.cleanupMs);
    // Assert settlement before awaiting: a stranded waiter must fail rather than hang this test.
    expect(cleanup).toEqual(bad("GIT_CLEANUP_FAILED"));
    expect(result).toEqual(bad("GIT_CLEANUP_FAILED"));
    await Promise.all([pending, disposing]);
    expect(await session.dispose()).toEqual(bad("GIT_CLEANUP_FAILED"));
    expect(await session.finish()).toEqual(bad("GIT_CLEANUP_FAILED"));
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0]![1]);
    expect(fake.kill).toHaveBeenCalledTimes(1);
    expect(fake.children[1]!.closed).toBe(false);
    expect([fake.children[1]!.stdin, fake.children[1]!.stdout, fake.children[1]!.stderr].every(pipe => pipe.destroyed)).toBe(true);
  } finally { await fake.dispose(); vi.useRealTimers(); }
});
it("normal finish removes its timer and abort listener after reaping", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const controller = new AbortController();
  const add = vi.spyOn(controller.signal, "addEventListener"), remove = vi.spyOn(controller.signal, "removeEventListener");
  const fake = await fakeSession({ signal: controller.signal });
  try {
    const session = value(fake.opened); expect(await session.finish()).toEqual(ok);
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0]![1]);
    controller.abort(); expect(await session.finish()).toEqual(ok);
  } finally { await fake.dispose(); vi.useRealTimers(); }
});
it("size preflight refuses oversized objects before any contents request", async () => {
  const fake = await fakeSession({ command: (_line, child) => child.stdout.write(`${emptyOid} blob 1048577\n`) });
  try {
    const session = value(fake.opened);
    expect(await session.contents(value(await session.info(emptyOid)), 1048576)).toEqual(bad("LIMIT_EXCEEDED"));
    expect(fake.children[1]!.writes).toEqual([`info ${emptyOid}\n`]);
  } finally { await fake.dispose(); }
});
it("cleanup failure dominates subsequent reads as well as finish and disposal", async () => {
  const fake = await fakeSession({ command: (_line, c) => c.stdout.write("bad\n"), kill: () => { throw Object.assign(new Error("DENIED"), { code: "EPERM" }); } });
  try {
    const session = value(fake.opened);
    expect(await session.info(emptyOid)).toEqual(bad("GIT_CLEANUP_FAILED"));
    expect(await session.info(emptyOid)).toEqual(bad("GIT_CLEANUP_FAILED"));
    expect(await session.contents({ oid: emptyOid, type: "blob", size: 0 }, 0)).toEqual(bad("GIT_CLEANUP_FAILED"));
    expect(await session.finish()).toEqual(bad("GIT_CLEANUP_FAILED"));
  } finally { await fake.dispose(); }
});
it("rejects concurrent requests before writing a second command", async () => {
  const fake = await fakeSession({ command: () => {} });
  try {
    const session = value(fake.opened);
    const first = session.info(emptyOid), second = session.info(emptyOid);
    expect(await first).toEqual(bad("INVALID_GIT_INPUT"));
    expect(await second).toEqual(bad("INVALID_GIT_INPUT"));
    expect(fake.children[1]!.writes).toHaveLength(1);
  } finally { await fake.dispose(); }
});
it.each(["ENOENT", "EACCES"])("redacts synchronous spawn %s without leaving owned state", async code => {
  const fixture = await createGitFixture();
  try {
    spawnMock.mockImplementationOnce(() => { throw Object.assign(new Error("SENSITIVE_SPAWN"), { code }); });
    expect(await openGitObjectSession(fixture.repository, createGitOperation())).toEqual(bad(code === "ENOENT" ? "GIT_UNAVAILABLE" : "GIT_FAILED"));
  } finally { await fixture.dispose(); }
});
it("counts fixed preflight metadata calls and closes the bounded pack iterator", async () => {
  const fixture = await createGitFixture();
  const originalOpenDir = fs.opendir;
  let read: ReturnType<typeof vi.spyOn> | undefined, close: ReturnType<typeof vi.spyOn> | undefined;
  try {
    const stats = vi.spyOn(fs, "lstat"), opens = vi.spyOn(fs, "open");
    const dirs = vi.spyOn(fs, "opendir").mockImplementationOnce(async (...args) => {
      const dir = await originalOpenDir(...args);
      read = vi.spyOn(dir, "read"); close = vi.spyOn(dir, "close"); return dir;
    });
    const session = value(await openGitObjectSession(fixture.repository, createGitOperation()));
    expect(stats.mock.calls.map(([path]) => String(path).slice(fixture.repository.directory.length + 1))).toEqual([
      "", "objects", "objects/info", "objects/pack", "config", "commondir", "config.worktree", "objects/info/alternates", "objects/info/http-alternates", "objects/pack",
    ]);
    // Plus one handle.stat and one handle.read; neither can grow with tree/object count.
    expect(stats.mock.calls.length + opens.mock.calls.length + dirs.mock.calls.length + 2).toBeLessThanOrEqual(32);
    expect(read).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledTimes(1);
    expect(await session.finish()).toEqual(ok);
  } finally { await fixture.dispose(); }
});
it("treats stdout EOF with an outstanding request as protocol failure without waiting for exit", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const fake = await fakeSession({ command: (_line, child) => child.stdout.end() });
  try {
    const pending = value(fake.opened).info(emptyOid);
    await vi.advanceTimersByTimeAsync(10000);
    expect(await pending).toEqual(bad("GIT_PROTOCOL_ERROR"));
  } finally { await fake.dispose(); vi.useRealTimers(); }
});
it("rejects owned hook/filter/helper poison before spawn; sentinel remains inert", async () => {
  const fixture = await createGitFixture();
  const directory = fixture.repository.directory;
  try {
    const sentinel = join(directory, "sentinel"), helper = join(directory, "never-run");
    await fs.writeFile(helper, `#!/bin/sh\nprintf executed > '${sentinel}'\n`, { mode: 0o700 });
    for (const poison of [`[core]\n\thooksPath = ${helper}\n`, `[filter "evil"]\n\tsmudge = ${helper}\n`, `[credential]\n\thelper = ${helper}\n`]) {
      await fs.writeFile(join(directory, "config"), template("sha1", true) + poison);
      spawnMock.mockClear();
      expect(await openGitObjectSession(fixture.repository, createGitOperation())).toEqual(bad("UNSUPPORTED_GIT_STORAGE", "repository"));
      expect(spawnMock).not.toHaveBeenCalled();
      await expect(fs.lstat(sentinel)).rejects.toMatchObject({ code: "ENOENT" });
    }
  } finally { await fixture.dispose(); }
});
it("rejects real missing Git executable and reaps its failed spawn", async () => {
  const fixture = await createGitFixture();
  try {
    expect(await openGitObjectSession({ ...fixture.repository, gitExecutable: join(fixture.repository.directory, "missing-git") }, createGitOperation())).toEqual(bad("GIT_UNAVAILABLE"));
  } finally { await fixture.dispose(); }
});
it("disposal is an idempotent cleanup operation, never successful inspection without finish", async () => {
  const fake = await fakeSession();
  try {
    const session = value(fake.opened);
    expect(await session.dispose()).toEqual(ok);
    expect(await session.dispose()).toEqual(ok);
    expect((await session.finish()).ok).toBe(false);
    expect((await session.info(emptyOid)).ok).toBe(false);
    expect(fake.children[1]!.writes).toHaveLength(0);
    expect(fake.kill).toHaveBeenCalledTimes(1);
  } finally { await fake.dispose(); }
});
