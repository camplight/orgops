import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, open, opendir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { performance } from "node:perf_hooks";
import { CommitSchema, type ContractIssue } from "@orgops/schemas";

export type OfflineGitRepository = { directory: string; gitExecutable: string };
export type GitInspectionOptions = { signal?: AbortSignal };
export type GitPackageInput = { repository: OfflineGitRepository; commit: string; path: string };
export type GitIndexInput = { repository: OfflineGitRepository; commit: string; indexPath: string };
export type OfflineGitIssue = {
  code: ContractIssue["code"] | "INVALID_GIT_INPUT" | "UNSUPPORTED_GIT_STORAGE"
    | "GIT_UNAVAILABLE" | "GIT_FAILED" | "GIT_PROTOCOL_ERROR" | "GIT_OBJECT_MISSING"
    | "GIT_OBJECT_TYPE" | "GIT_OBJECT_INTEGRITY" | "GIT_PATH_MISSING" | "GIT_TIMEOUT"
    | "GIT_ABORTED" | "GIT_CLEANUP_FAILED";
  at: string;
};
export type OfflineGitResult<T> = { ok: true; value: T } | { ok: false; issues: OfflineGitIssue[] };
export const OFFLINE_GIT_LIMITS = Object.freeze({
  operationMs: 10000, cleanupMs: 250, processes: 2, commands: 8192,
  stdinBytes: 1048576, stdoutBytes: 16777216, stderrBytes: 65536, headerBytes: 128,
  commitBytes: 262144, treeBytes: 262144, totalTreeBytes: 4194304,
  treeOccurrences: 2048, treeEntries: 8192, treeDepth: 240, packageFiles: 257,
  packDirectoryEntries: 512,
} as const);
export type GitOperation = { deadline: number; signal?: AbortSignal };
export function createGitOperation(signal?: AbortSignal): GitOperation {
  return { deadline: performance.now() + OFFLINE_GIT_LIMITS.operationMs, ...(signal ? { signal } : {}) };
}
const success = <T>(value: T): OfflineGitResult<T> => ({ ok: true, value });
const failure = (code: OfflineGitIssue["code"], at = "git"): OfflineGitResult<never> => ({ ok: false, issues: [{ code, at }] });
export function checkGitOperation(operation: GitOperation): OfflineGitResult<true> {
  if (operation.signal?.aborted) return failure("GIT_ABORTED");
  if (!Number.isFinite(operation.deadline) || performance.now() >= operation.deadline) return failure("GIT_TIMEOUT");
  return success(true);
}
export type GitObjectInfo = Readonly<{ oid: string; type: "commit" | "tree" | "blob" | "tag"; size: number }>;
export type GitObjectSession = {
  objectFormat: "sha1" | "sha256";
  info(oid: string): Promise<OfflineGitResult<GitObjectInfo>>;
  contents(info: GitObjectInfo, maxBytes: number): Promise<OfflineGitResult<Buffer>>;
  finish(): Promise<OfflineGitResult<true>>;
  dispose(): Promise<OfflineGitResult<true>>;
};

const environment = Object.freeze({
  PATH: "", HOME: "/dev/null", XDG_CONFIG_HOME: "/dev/null", LC_ALL: "C", LANG: "C",
  GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0", GIT_ALLOW_PROTOCOL: "", GIT_OPTIONAL_LOCKS: "0", GIT_ATTR_NOSYSTEM: "1",
});
function repositorySnapshot(value: unknown): OfflineGitRepository | undefined {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes("directory") || !keys.includes("gitExecutable")) return;
  const fields = keys.map(key => Object.getOwnPropertyDescriptor(value, key)!);
  if (fields.some(d => !d.enumerable || !("value" in d))) return;
  const directory: unknown = Object.getOwnPropertyDescriptor(value, "directory")!.value;
  const gitExecutable: unknown = Object.getOwnPropertyDescriptor(value, "gitExecutable")!.value;
  const path = (v: unknown): v is string => typeof v === "string" && v.length <= 4096
    && Buffer.byteLength(v, "utf8") <= 4096 && isAbsolute(v) && !/[\u0000-\u001f\u007f-\u009f]/.test(v)
    && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(v);
  if (path(directory) && path(gitExecutable)) return { directory, gitExecutable };
}
const configTemplate = (format: "sha1" | "sha256", mode: boolean) => Buffer.from(
  `[core]\n\trepositoryformatversion = ${format === "sha1" ? 0 : 1}\n\tfilemode = ${mode}\n\tbare = true\n`
  + (format === "sha256" ? "[extensions]\n\tobjectformat = sha256\n" : ""));
const errorCode = (error: unknown): unknown => error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
const interrupted = Symbol("redacted Git interruption");

/** Private catalog-specific lifecycle. Trusted stable bare storage is not provenance or a sandbox.
 * Git can allocate/decompress before stdout; timeout/output bounds are not OS memory bounds.
 * POSIX kill denial/uninterruptible I/O can prevent reaping: cleanup failure must not be auto-retried.
 */
export async function openGitObjectSession(input: OfflineGitRepository, suppliedOperation: GitOperation): Promise<OfflineGitResult<GitObjectSession>> {
  const repository = repositorySnapshot(input);
  if (!repository) return failure("INVALID_GIT_INPUT", "repository");
  const operation = { deadline: suppliedOperation.deadline, signal: suppliedOperation.signal };
  const initial = checkGitOperation(operation);
  if (!initial.ok) return initial;
  if (process.platform !== "linux" && process.platform !== "darwin") return failure("UNSUPPORTED_GIT_STORAGE", "repository");
  let issue: OfflineGitResult<never> | undefined;
  let cleanupDeadline = Infinity;
  let cleanupIncomplete = false;
  let disposed = false;
  let closing = false;
  let processCount = 0, commandCount = 0, stdinBytes = 0, stdoutBytes = 0, stderrBytes = 0;
  let active: Wire | undefined;
  let preflightDone: Promise<void> = Promise.resolve();
  let disposePromise: Promise<OfflineGitResult<true>> | undefined;
  let finishPromise: Promise<OfflineGitResult<true>> | undefined;
  const waiters = new Set<() => void>();
  const notify = () => { for (const wake of [...waiters]) wake(); };
  function fail(code: OfflineGitIssue["code"], at = "git"): void {
    if (!issue) {
      issue = failure(code, at);
      cleanupDeadline = Math.min(cleanupDeadline, Math.min(performance.now(), operation.deadline) + OFFLINE_GIT_LIMITS.cleanupMs);
      active?.kill();
      notify();
    }
  }
  function check(): void {
    if (issue) throw interrupted;
    const checked = checkGitOperation(operation);
    if (!checked.ok) { fail(checked.issues[0]!.code); throw interrupted; }
  }
  const abort = () => fail("GIT_ABORTED");
  operation.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => fail("GIT_TIMEOUT"), Math.max(0, operation.deadline - performance.now()));
  function unlisten(): void { clearTimeout(timer); operation.signal?.removeEventListener("abort", abort); }
  async function until<T>(promise: Promise<T>): Promise<T> {
    check();
    let wake!: () => void;
    const stopped = new Promise<never>((_resolve, reject) => { wake = () => { if (issue) reject(interrupted); }; waiters.add(wake); });
    try { const result = await Promise.race([promise, stopped]); check(); return result; }
    finally { waiters.delete(wake); }
  }
  async function provisioned(): Promise<"sha1" | "sha256"> {
    // Fixed metadata calls only; no recursive object walk or arbitrary config interpretation.
    async function stat(name: string, optional = false) {
      check();
      try { const result = await lstat(join(repository!.directory, name)); check(); return result; }
      catch (error) { check(); if (optional && errorCode(error) === "ENOENT") return undefined; throw error; }
    }
    try {
      for (const name of [".", "objects", "objects/info", "objects/pack"]) {
        const result = await stat(name, name === "objects/info" || name === "objects/pack");
        if (result && !result.isDirectory()) { fail("UNSUPPORTED_GIT_STORAGE", "repository"); throw interrupted; }
      }
      const config = await stat("config");
      if (!config?.isFile() || config.size > 4096) { fail("UNSUPPORTED_GIT_STORAGE", "repository"); throw interrupted; }
      check();
      const handle = await open(join(repository!.directory, "config"), "r");
      let bytes: Buffer;
      try {
        check();
        const actual = await handle.stat(); check();
        if (!actual.isFile() || actual.size > 4096) { fail("UNSUPPORTED_GIT_STORAGE", "repository"); throw interrupted; }
        const buffer = Buffer.alloc(4097);
        let length = 0;
        // At most two bounded reads: stable regular config files are at most 4096 bytes.
        const first = await handle.read(buffer, 0, 4097, 0); check(); length = first.bytesRead;
        if (length !== actual.size) { fail("UNSUPPORTED_GIT_STORAGE", "repository"); throw interrupted; }
        bytes = buffer.subarray(0, length);
      } finally {
        try { await handle.close(); }
        catch { if (handle.fd !== -1) cleanupIncomplete = true; fail("GIT_FAILED"); }
      }
      check();
      let format: "sha1" | "sha256" | undefined;
      for (const f of ["sha1", "sha256"] as const) for (const mode of [true, false]) if (bytes.equals(configTemplate(f, mode))) format = f;
      if (!format) { fail("UNSUPPORTED_GIT_STORAGE", "repository"); throw interrupted; }
      for (const name of ["commondir", "config.worktree", "objects/info/alternates", "objects/info/http-alternates"]) {
        if (await stat(name, true)) { fail("UNSUPPORTED_GIT_STORAGE", "repository"); throw interrupted; }
      }
      const pack = await stat("objects/pack", true);
      if (pack) {
        check(); const directory = await opendir(join(repository!.directory, "objects/pack"));
        try {
          for (let count = 0; ; count++) {
            check(); const entry = await directory.read(); check();
            if (!entry) break;
            if (count >= OFFLINE_GIT_LIMITS.packDirectoryEntries) { fail("LIMIT_EXCEEDED", "repository"); throw interrupted; }
            if (entry.name.endsWith(".promisor")) { fail("UNSUPPORTED_GIT_STORAGE", "repository"); throw interrupted; }
          }
        } finally {
          try { await directory.close(); }
          catch (error) { if (errorCode(error) !== "ERR_DIR_CLOSED") cleanupIncomplete = true; fail("GIT_FAILED"); }
        }
      }
      check(); return format;
    } catch (error) {
      if (!issue) fail(error === interrupted ? "GIT_FAILED" : "UNSUPPORTED_GIT_STORAGE", "repository");
      throw interrupted;
    }
  }
  type Request = {
    oid: string; expected?: GitObjectInfo; header: number[]; info?: GitObjectInfo;
    body?: Buffer; offset: number; resolve(value: GitObjectInfo | Buffer): void;
  };
  type Wire = {
    child: ChildProcessWithoutNullStreams; closed: boolean; done: Promise<void>; started: Promise<void>;
    ending: boolean; request?: Request; rev: Buffer[]; revBytes: number;
    kill(): void; end(): void; detach(): void;
  };
  const prefix = ["--no-pager", "--no-replace-objects", "--no-optional-locks", `--git-dir=${repository.directory}`,
    "-c", "protocol.allow=never", "-c", "credential.helper=", "-c", "core.hooksPath=/dev/null",
    "-c", "maintenance.auto=false", "-c", "gc.auto=0"];
  function start(batch: boolean): Wire {
    check();
    if (++processCount > OFFLINE_GIT_LIMITS.processes || (active && !active.closed)) { fail("LIMIT_EXCEEDED"); throw interrupted; }
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(repository!.gitExecutable, [...prefix, ...(batch ? ["cat-file", "--batch-command"] : ["rev-parse", "--is-bare-repository", "--show-object-format=storage"])],
        { cwd: repository!.directory, shell: false, detached: true, stdio: ["pipe", "pipe", "pipe"], env: environment });
    } catch (error) { fail(errorCode(error) === "ENOENT" ? "GIT_UNAVAILABLE" : "GIT_FAILED"); throw interrupted; }
    let resolveClose!: () => void;
    const done = new Promise<void>(resolve => { resolveClose = resolve; });
    let resolveSpawn!: () => void;
    const started = new Promise<void>(resolve => { resolveSpawn = resolve; });
    let killed = false;
    const wire: Wire = {
      child, closed: false, done, started, ending: !batch, rev: [], revBytes: 0,
      kill() {
        if (killed || wire.closed) return;
        killed = true;
        if (child.pid === undefined) return;
        try { process.kill(-child.pid, "SIGKILL"); }
        catch (error) {
          if (!(errorCode(error) === "ESRCH" && (wire.closed || child.exitCode !== null || child.signalCode !== null))) fail("GIT_FAILED");
        }
      },
      end() { wire.ending = true; try { child.stdin.end(); } catch { fail("GIT_FAILED"); } },
      detach() {
        child.removeListener("error", onError); child.removeListener("close", onClose); child.removeListener("spawn", resolveSpawn);
        child.stdout.removeListener("data", onOut); child.stdout.removeListener("end", onEof); child.stderr.removeListener("data", onErr);
        for (const pipe of [child.stdin, child.stdout, child.stderr]) pipe.removeListener("error", pipeError);
      },
    };
    active = wire;
    const pipeError = () => fail("GIT_FAILED");
    const onError = (error: Error) => fail(errorCode(error) === "ENOENT" ? "GIT_UNAVAILABLE" : "GIT_FAILED");
    function onClose(code: number | null, signal: NodeJS.Signals | null): void {
      wire.closed = true;
      if (wire.request) fail("GIT_PROTOCOL_ERROR");
      else if (code !== 0 || signal !== null || !wire.ending) fail("GIT_FAILED");
      resolveClose(); notify();
      if (disposed) wire.detach();
    }
    function onEof(): void {
      if (batch && !wire.closed && (wire.request || !wire.ending)) fail("GIT_PROTOCOL_ERROR");
    }
    function onErr(chunk: Buffer): void {
      if (issue) return;
      if (stderrBytes + chunk.length > OFFLINE_GIT_LIMITS.stderrBytes) { fail("LIMIT_EXCEEDED"); return; }
      stderrBytes += chunk.length;
    }
    function onOut(chunk: Buffer): void {
      if (issue) return;
      if (stdoutBytes + chunk.length > OFFLINE_GIT_LIMITS.stdoutBytes) { fail("LIMIT_EXCEEDED"); return; }
      stdoutBytes += chunk.length;
      if (!batch) {
        if (wire.revBytes + chunk.length > 32) { fail("LIMIT_EXCEEDED"); return; }
        wire.revBytes += chunk.length; wire.rev.push(chunk); return;
      }
      let offset = 0;
      while (offset < chunk.length && !issue) {
        const request = wire.request;
        if (!request) { fail("GIT_PROTOCOL_ERROR"); return; }
        if (!request.info) {
          const byte = chunk[offset++]!;
          if (byte !== 10) {
            if (byte > 127) { fail("GIT_PROTOCOL_ERROR"); return; }
            if (request.header.length >= OFFLINE_GIT_LIMITS.headerBytes) { fail("LIMIT_EXCEEDED"); return; }
            request.header.push(byte); continue;
          }
          // No ASCII conversion before high-bit rejection; avoid ASCII's lossy masking.
          const header = Buffer.from(request.header).toString("ascii");
          if (header === `${request.oid} missing`) { fail("GIT_OBJECT_MISSING"); return; }
          const match = /^([0-9a-f]+) (commit|tree|blob|tag) (0|[1-9][0-9]*)$/.exec(header);
          if (!match || match[1] !== request.oid || !Number.isSafeInteger(Number(match[3]))) { fail("GIT_PROTOCOL_ERROR"); return; }
          const info: GitObjectInfo = { oid: match[1], type: match[2] as GitObjectInfo["type"], size: Number(match[3]) };
          request.info = info;
          if (!request.expected) { wire.request = undefined; request.resolve(info); continue; }
          if (info.type !== request.expected.type || info.size !== request.expected.size) { fail("GIT_PROTOCOL_ERROR"); return; }
          try { check(); request.body = Buffer.alloc(info.size); } catch { fail("GIT_FAILED"); return; }
        }
        const requestBody = request.body!;
        const length = Math.min(requestBody.length - request.offset, chunk.length - offset);
        chunk.copy(requestBody, request.offset, offset, offset + length); request.offset += length; offset += length;
        if (request.offset === requestBody.length && offset < chunk.length) {
          if (chunk[offset++] !== 10) { fail("GIT_PROTOCOL_ERROR"); return; }
          try {
            check();
            const info = request.expected!;
            const oid = createHash(objectFormat).update(Buffer.from(`${info.type} ${info.size}\0`, "ascii")).update(requestBody).digest("hex");
            check();
            if (oid !== info.oid) { fail("GIT_OBJECT_INTEGRITY"); return; }
            wire.request = undefined; request.resolve(requestBody);
          } catch { fail("GIT_FAILED"); return; }
        }
      }
    }
    child.on("error", onError); child.on("close", onClose); child.once("spawn", resolveSpawn);
    child.stdout.on("data", onOut); child.stdout.on("end", onEof); child.stderr.on("data", onErr);
    for (const pipe of [child.stdin, child.stdout, child.stderr]) pipe.on("error", pipeError);
    if (!batch) wire.end();
    return wire;
  }
  async function dispose(): Promise<OfflineGitResult<true>> {
    if (disposePromise) return disposePromise;
    disposePromise = (async () => {
      closing = true;
      if (!disposed && active && !active.closed && !issue) {
        // Disposal without finish is cancellation of owned work, not successful inspection.
        fail("GIT_ABORTED");
      }
      if (!Number.isFinite(cleanupDeadline)) cleanupDeadline = Math.min(performance.now(), operation.deadline) + OFFLINE_GIT_LIMITS.cleanupMs;
      const required = Promise.all([preflightDone, active?.done]).then(() => true);
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      const bounded = new Promise<false>(resolve => { cleanupTimer = setTimeout(() => resolve(false), Math.max(0, cleanupDeadline - performance.now())); });
      const complete = await Promise.race([required, bounded]);
      clearTimeout(cleanupTimer); unlisten();
      if (!complete) {
        cleanupIncomplete = true;
        fail("GIT_CLEANUP_FAILED");
        notify();
        // Close local pipes; the OS may still deny reaping. Never claim a detached success.
        for (const pipe of active ? [active.child.stdin, active.child.stdout, active.child.stderr] : []) {
          try { pipe.destroy(); } catch { /* Redacted failed cleanup already selected. */ }
        }
      } else active?.detach();
      if (active) { active.request = undefined; active.rev = []; }
      disposed = true;
      return cleanupIncomplete ? failure("GIT_CLEANUP_FAILED") : success(true);
    })();
    return disposePromise;
  }
  async function failed<T>(): Promise<OfflineGitResult<T>> {
    const cleanup = await dispose();
    return !cleanup.ok ? cleanup : issue ?? failure("GIT_FAILED");
  }
  let objectFormat: "sha1" | "sha256" = "sha1";
  try {
    const pending = provisioned();
    preflightDone = pending.then(() => {}, () => {});
    objectFormat = await until(pending);
    const revision = start(false);
    await until(revision.done);
    const output = Buffer.concat(revision.rev);
    if (!output.equals(Buffer.from(`true\n${objectFormat}\n`))) { fail("UNSUPPORTED_GIT_STORAGE", "repository"); throw interrupted; }
    revision.detach(); check();
    const batch = start(true);
    await until(batch.started);
    const issued = new WeakMap<GitObjectInfo, GitObjectInfo>();
    let busy = false;
    async function request(oid: string, expected?: GitObjectInfo): Promise<GitObjectInfo | Buffer> {
      check();
      if (closing || disposed || batch.closed || busy) { fail("INVALID_GIT_INPUT"); throw interrupted; }
      if (typeof oid !== "string" || oid.length !== (objectFormat === "sha1" ? 40 : 64) || !CommitSchema.safeParse(oid).success) { fail("INVALID_GIT_INPUT", "commit"); throw interrupted; }
      const line = `${expected ? "contents" : "info"} ${oid}\n`;
      if (commandCount + 1 > OFFLINE_GIT_LIMITS.commands || stdinBytes + line.length > OFFLINE_GIT_LIMITS.stdinBytes) { fail("LIMIT_EXCEEDED"); throw interrupted; }
      commandCount++; stdinBytes += line.length; busy = true;
      try {
        const response = new Promise<GitObjectInfo | Buffer>(resolve => {
          batch.request = { oid, expected, header: [], offset: 0, resolve };
          try { batch.child.stdin.write(line, error => { if (error) fail("GIT_FAILED"); }); }
          catch { fail("GIT_FAILED"); }
        });
        return await until(response);
      } finally { busy = false; }
    }
    async function info(oid: string): Promise<OfflineGitResult<GitObjectInfo>> {
      if (disposed || closing) return cleanupIncomplete ? failure("GIT_CLEANUP_FAILED") : issue ?? failure("INVALID_GIT_INPUT");
      try {
        const result = await request(oid) as GitObjectInfo;
        const record = Object.freeze({ ...result });
        issued.set(record, Object.freeze({ ...record })); check();
        return success(record);
      } catch { if (!issue) fail("GIT_FAILED"); return failed(); }
    }
    async function contents(record: GitObjectInfo, maxBytes: number): Promise<OfflineGitResult<Buffer>> {
      if (disposed || closing) return cleanupIncomplete ? failure("GIT_CLEANUP_FAILED") : issue ?? failure("INVALID_GIT_INPUT");
      try {
        check();
        const snapshot = record && typeof record === "object" ? issued.get(record) : undefined;
        if (!snapshot || !Number.isSafeInteger(maxBytes) || maxBytes < 0) { fail("INVALID_GIT_INPUT"); throw interrupted; }
        if (snapshot.size > maxBytes || snapshot.size > OFFLINE_GIT_LIMITS.stdoutBytes) { fail("LIMIT_EXCEEDED"); throw interrupted; }
        const bytes = await request(snapshot.oid, snapshot) as Buffer;
        check(); return success(bytes);
      } catch { if (!issue) fail("GIT_FAILED"); return failed(); }
    }
    async function finish(): Promise<OfflineGitResult<true>> {
      if (finishPromise) return finishPromise;
      finishPromise = (async () => {
        if (disposed) return cleanupIncomplete ? failure("GIT_CLEANUP_FAILED") : issue ?? failure("INVALID_GIT_INPUT");
        try {
          check(); closing = true;
          if (busy || batch.request) { fail("GIT_PROTOCOL_ERROR"); throw interrupted; }
          batch.end(); await until(batch.done); check();
          const cleanup = await dispose();
          if (!cleanup.ok) return cleanup;
          const checked = checkGitOperation(operation);
          return issue ?? checked;
        } catch { if (!issue) fail("GIT_FAILED"); return failed<true>(); }
      })();
      return finishPromise;
    }
    check(); return success({ objectFormat, info, contents, finish, dispose });
  } catch { if (!issue) fail("GIT_FAILED"); return failed(); }
}
