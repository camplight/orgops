import * as nodeFs from "node:fs";
import type { BigIntStats, Dirent, Dir } from "node:fs";
import { lstat, open, opendir, type FileHandle } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { RelativePathSchema, validateCatalogJson } from "@orgops/schemas";
import {
  OFFLINE_LOCAL_SKILL_LIMITS,
  type LocalSkillEvidenceInput, type LocalSkillEvidenceIssue, type LocalSkillEvidenceOptions,
  type LocalSkillEvidenceResult,
} from "./local-skill-evidence-types";

// Private catalog-specific single ownership path for one trusted quiescent local
// skill root. Deep module only: never root-exported from @orgops/skills. Paths alone
// authorize nothing; the caller separately scopes/authorizes the root. Metadata
// rechecks detect known inconsistencies; they do not create an atomic snapshot,
// authenticate origins or prove ancestor/mount containment. This is not a TOCTOU
// sandbox. Node exposes no fd-anchored directory enumeration: the separately opened
// directory FileHandle is NOT proof of the enumerator's identity; trusted stable
// paths plus path/handle postchecks are the precondition.
export type LocalSkillRecord = Readonly<{
  path: string; // root-relative, root is ""; never a public pointer
  type: "directory" | "file" | "blocked";
  stat: BigIntStats; // private frozen scalar snapshot; no external retention
}>;
export type LocalSkillRootReader = {
  input: Readonly<{ directory: string; nominatedNames: readonly string[] }>;
  root: LocalSkillRecord;
  listDirectory(record: LocalSkillRecord, maxEntries: number): Promise<readonly LocalSkillRecord[]>;
  readFile(record: LocalSkillRecord): Promise<Buffer>;
  checkpoint(): Promise<void>;
  fail(code: LocalSkillEvidenceIssue["code"], at: LocalSkillEvidenceIssue["at"]): never;
};

type At = LocalSkillEvidenceIssue["at"];
type Kind = LocalSkillRecord["type"];
const stopped = Symbol("redacted local interruption");
const failure = (code: LocalSkillEvidenceIssue["code"], at: At): LocalSkillEvidenceResult<never> =>
  ({ ok: false, issues: [{ code, at }] });
const byPath = (a: LocalSkillRecord, b: LocalSkillRecord): number => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
const errorCode = (error: unknown): unknown => error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Trusted scalar snapshot check: bigint identity fields and exactly one type bit. */
function classifyStat(stat: BigIntStats): Kind | undefined {
  const fields = [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.mtimeNs, stat.ctimeNs];
  if (!fields.every(value => typeof value === "bigint")) return;
  if (stat.dev < 0n || stat.ino < 0n || stat.mode < 0n || stat.nlink < 1n || stat.size < 0n) return;
  const kinds = [stat.isFile(), stat.isDirectory(), stat.isSymbolicLink(), stat.isFIFO(),
    stat.isSocket(), stat.isCharacterDevice(), stat.isBlockDevice()];
  if (kinds.filter(Boolean).length !== 1) return;
  if (stat.isFile()) return "file";
  if (stat.isDirectory()) return "directory";
  return "blocked";
}
function sameFingerprint(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.nlink === b.nlink
    && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs
    && a.isFile() === b.isFile() && a.isDirectory() === b.isDirectory()
    && a.isSymbolicLink() === b.isSymbolicLink() && a.isFIFO() === b.isFIFO()
    && a.isSocket() === b.isSocket() && a.isCharacterDevice() === b.isCharacterDevice()
    && a.isBlockDevice() === b.isBlockDevice();
}
/** Explicit normalized absolute POSIX host path; no normalization, realpath or defaulting. */
function validDirectory(directory: unknown): directory is string {
  if (typeof directory !== "string" || directory.length === 0) return false;
  if (Buffer.byteLength(directory, "utf8") > OFFLINE_LOCAL_SKILL_LIMITS.rootPathBytes) return false;
  if (!directory.startsWith("/") || directory === "/") return false;
  if (directory.includes("\\")) return false;
  if (/[\u0000-\u001f\u007f-\u009f]/.test(directory)) return false;
  if (loneSurrogate.test(directory)) return false;
  if (directory.includes("//") || directory.endsWith("/")) return false;
  const segments = directory.slice(1).split("/");
  if (segments.length > OFFLINE_LOCAL_SKILL_LIMITS.hostPathDepth) return false;
  return segments.every(segment => segment.length > 0 && segment !== "." && segment !== "..");
}
/** Lossless latin1 byte-name boundary: any high-bit code unit is a global unsafe name. */
function validEntryName(name: string): boolean {
  if (name.length === 0 || name.length > OFFLINE_LOCAL_SKILL_LIMITS.nameBytes) return false;
  for (let i = 0; i < name.length; i++) {
    const unit = name.charCodeAt(i);
    if (unit > 127 || unit === 47) return false;
  }
  return RelativePathSchema.safeParse(name).success;
}
function validEntryPath(path: string): boolean {
  if (Buffer.byteLength(path, "utf8") > OFFLINE_LOCAL_SKILL_LIMITS.relativePathBytes) return false;
  if (path.split("/").length > OFFLINE_LOCAL_SKILL_LIMITS.relativePathDepth) return false;
  return RelativePathSchema.safeParse(path).success;
}

type Snapshot = { directory: string; nominatedNames: string[]; signal: AbortSignal | undefined };
type Envelope = { ok: true; value: Snapshot } | { ok: false; issue: LocalSkillEvidenceIssue };
/** Strict own enumerable data properties only; getters are never invoked. */
function checkEnvelope(input: unknown, options: unknown): Envelope {
  const issue = (code: LocalSkillEvidenceIssue["code"], at: At): Envelope => ({ ok: false, issue: { code, at } });
  if (input === null || typeof input !== "object" || Array.isArray(input)) return issue("INVALID_LOCAL_INPUT", "$");
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) return issue("INVALID_LOCAL_INPUT", "$");
  const keys = Reflect.ownKeys(input);
  if (keys.length !== 2 || !keys.includes("directory") || !keys.includes("nominatedNames")) return issue("INVALID_LOCAL_INPUT", "$");
  const directoryField = Object.getOwnPropertyDescriptor(input, "directory");
  if (!directoryField?.enumerable || !("value" in directoryField)) return issue("INVALID_LOCAL_INPUT", "directory");
  const listField = Object.getOwnPropertyDescriptor(input, "nominatedNames");
  if (!listField?.enumerable || !("value" in listField)) return issue("INVALID_LOCAL_INPUT", "nominatedNames");
  const directory = directoryField.value;
  if (!validDirectory(directory)) return issue("INVALID_LOCAL_INPUT", "directory");
  const list = listField.value;
  if (!Array.isArray(list) || Object.getPrototypeOf(list) !== Array.prototype) return issue("INVALID_LOCAL_INPUT", "nominatedNames");
  const own = Reflect.ownKeys(list);
  if (own.length !== list.length + 1 || own[list.length] !== "length") return issue("INVALID_LOCAL_INPUT", "nominatedNames");
  for (let i = 0; i < list.length; i++) {
    if (own[i] !== String(i)) return issue("INVALID_LOCAL_INPUT", "nominatedNames");
    const field = Object.getOwnPropertyDescriptor(list, i);
    if (!field?.enumerable || !("value" in field) || typeof field.value !== "string") return issue("INVALID_LOCAL_INPUT", "nominatedNames");
    if (field.value.includes("/") || !RelativePathSchema.safeParse(field.value).success) return issue("INVALID_LOCAL_INPUT", "nominatedNames");
  }
  if (list.length > OFFLINE_LOCAL_SKILL_LIMITS.nominatedNames) return issue("LIMIT_EXCEEDED", "nominatedNames");
  const seen = new Set<string>();
  const folded = new Set<string>();
  for (const name of list) {
    if (seen.has(name)) return issue("INVALID_LOCAL_INPUT", "nominatedNames");
    const fold = name.toLowerCase();
    if (folded.has(fold)) return issue("INVALID_LOCAL_INPUT", "nominatedNames");
    seen.add(name); folded.add(fold);
  }
  // 1MiB descriptor JSON gate via the shared validator, before any clone of the values.
  const json = validateCatalogJson(input, OFFLINE_LOCAL_SKILL_LIMITS.inputJsonBytes);
  if (!json.ok) return issue(json.issues[0]!.code === "LIMIT_EXCEEDED" ? "LIMIT_EXCEEDED" : "INVALID_LOCAL_INPUT", "$");
  let signal: AbortSignal | undefined;
  if (options !== undefined) {
    if (options === null || typeof options !== "object") return issue("INVALID_LOCAL_INPUT", "$");
    const optionsPrototype = Object.getPrototypeOf(options);
    if (optionsPrototype !== Object.prototype && optionsPrototype !== null) return issue("INVALID_LOCAL_INPUT", "$");
    const optionKeys = Reflect.ownKeys(options);
    if (optionKeys.length > 1 || (optionKeys.length === 1 && optionKeys[0] !== "signal")) return issue("INVALID_LOCAL_INPUT", "$");
    if (optionKeys.length === 1) {
      const field = Object.getOwnPropertyDescriptor(options, "signal");
      if (!field?.enumerable || !("value" in field)) return issue("INVALID_LOCAL_INPUT", "$");
      if (!(field.value instanceof AbortSignal)) return issue("INVALID_LOCAL_INPUT", "$");
      signal = field.value;
    }
  }
  return { ok: true, value: { directory, nominatedNames: [...list], signal } };
}

export function withLocalSkillRoot<T>(
  input: LocalSkillEvidenceInput, options: LocalSkillEvidenceOptions | undefined,
  consume: (reader: LocalSkillRootReader) => Promise<T>,
): Promise<LocalSkillEvidenceResult<T>> {
  return runLocalSkillRoot(input, options, consume);
}

async function runLocalSkillRoot<T>(
  suppliedInput: LocalSkillEvidenceInput, suppliedOptions: LocalSkillEvidenceOptions | undefined,
  consume: (reader: LocalSkillRootReader) => Promise<T>,
): Promise<LocalSkillEvidenceResult<T>> {
  const deadline = performance.now() + OFFLINE_LOCAL_SKILL_LIMITS.operationMs;
  const envelope = checkEnvelope(suppliedInput, suppliedOptions);
  if (!envelope.ok) return failure(envelope.issue.code, envelope.issue.at);
  const { directory, nominatedNames, signal } = envelope.value;
  const nominated = new Set<string>(nominatedNames);

  let terminal: LocalSkillEvidenceIssue | undefined;
  let cleanupFailed = false; // unconfirmed ownership: overrides every pending outcome
  // Assigned by the entry sequence before the reader is issued; read by the closures below.
  let directoryFlags!: number;
  let fileFlags!: number;
  let rootRecord!: LocalSkillRecord;
  let cleanupBroken = false; // confirmed-but-failed close: LOCAL_IO_FAILED only if no earlier issue
  let fsCalls = 0, workUnits = 0, yields = 0;
  const issued = new WeakSet<object>();
  const enumeratedDirs = new WeakSet<object>();
  const readFiles = new WeakSet<object>();
  const registry: LocalSkillRecord[] = [];
  const seenPaths = new Set<string>();

  function fail(code: LocalSkillEvidenceIssue["code"], at: At): never {
    if (!terminal) terminal = { code, at };
    throw stopped;
  }
  function checkState(): void {
    if (terminal) throw stopped;
    if (signal?.aborted) fail("LOCAL_ABORTED", "filesystem");
    if (performance.now() >= deadline) fail("LOCAL_TIMEOUT", "filesystem");
  }
  /** One work unit per scheduling step; bounded cooperative macrotask yields. */
  async function checkpoint(): Promise<void> {
    workUnits++;
    if (workUnits > OFFLINE_LOCAL_SKILL_LIMITS.workUnits) fail("LIMIT_EXCEEDED", "filesystem");
    checkState();
    if (workUnits % OFFLINE_LOCAL_SKILL_LIMITS.yieldEvery === 0) {
      yields++;
      if (yields > OFFLINE_LOCAL_SKILL_LIMITS.yields) fail("LIMIT_EXCEEDED", "filesystem");
      await new Promise<void>(resolve => setImmediate(resolve));
      checkState();
    }
  }
  /** Two close slots stay reserved for already-owned handles when scheduling work. */
  function chargeCall(): void {
    if (fsCalls + 2 > OFFLINE_LOCAL_SKILL_LIMITS.fsCalls) fail("LIMIT_EXCEEDED", "filesystem");
    fsCalls++;
  }
  function onIoError(at: At): never {
    if (signal?.aborted) fail("LOCAL_ABORTED", "filesystem");
    if (performance.now() >= deadline) fail("LOCAL_TIMEOUT", "filesystem");
    fail("LOCAL_IO_FAILED", at);
  }
  const absoluteOf = (path: string): string => path === "" ? directory : `${directory}/${path}`;
  function issueRecord(path: string, type: Kind, stat: BigIntStats, at: "namespace" | "subtrees"): LocalSkillRecord {
    if (registry.length >= OFFLINE_LOCAL_SKILL_LIMITS.namespaceEntries + OFFLINE_LOCAL_SKILL_LIMITS.localTreeEntries + 1) {
      fail("LIMIT_EXCEEDED", "filesystem");
    }
    const fold = path.toLowerCase();
    if (seenPaths.has(fold)) fail("DUPLICATE_PATH", at);
    seenPaths.add(fold);
    const record: LocalSkillRecord = Object.freeze({ path, type, stat: Object.freeze(stat) });
    issued.add(record);
    registry.push(record);
    return record;
  }
  async function statPath(absolute: string, at: At): Promise<BigIntStats> {
    await checkpoint();
    chargeCall();
    let stat: BigIntStats;
    try { stat = await lstat(absolute, { bigint: true }); }
    catch { onIoError(at); }
    await checkpoint();
    return stat;
  }
  async function closeFile(handle: FileHandle): Promise<void> {
    fsCalls++;
    try { await handle.close(); }
    catch { if (handle.fd === -1) cleanupBroken = true; else cleanupFailed = true; }
  }
  async function closeDir(dir: Dir): Promise<void> {
    fsCalls++;
    try { await dir.close(); }
    catch (error) { if (errorCode(error) === "ERR_DIR_CLOSED") cleanupBroken = true; else cleanupFailed = true; }
  }

  async function listDirectory(record: LocalSkillRecord, maxEntries: number): Promise<readonly LocalSkillRecord[]> {
    if (!issued.has(record)) fail("INVALID_LOCAL_INPUT", "filesystem");
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 0 || maxEntries > OFFLINE_LOCAL_SKILL_LIMITS.namespaceEntries) {
      fail("INVALID_LOCAL_INPUT", "filesystem");
    }
    if (record.type !== "directory") fail("INVALID_LOCAL_INPUT", "filesystem");
    if (record.path !== "") {
      if (!nominated.has(record.path.split("/")[0]!)) fail("INVALID_LOCAL_INPUT", "filesystem");
      if (record.stat.dev !== rootRecord.stat.dev) fail("UNSUPPORTED_LOCAL_STORAGE", "filesystem");
    }
    if (enumeratedDirs.has(record)) fail("INVALID_LOCAL_INPUT", "filesystem");
    enumeratedDirs.add(record);
    const nested = record.path !== "";
    const ioAt: At = nested ? "subtrees" : "directory";
    const entryAt: "namespace" | "subtrees" = nested ? "subtrees" : "namespace";
    const absolute = absoluteOf(record.path);
    await checkpoint();
    let verifyHandle: FileHandle | undefined;
    let dirHandle: Dir | undefined;
    let verifyClosed = false;
    let dirClosed = false;
    try {
      chargeCall();
      try { verifyHandle = await open(absolute, directoryFlags); }
      catch { onIoError(ioAt); }
      await checkpoint();
      chargeCall();
      let opened: BigIntStats;
      try { opened = await verifyHandle.stat({ bigint: true }); }
      catch { onIoError(ioAt); }
      await checkpoint();
      if (!sameFingerprint(opened, record.stat)) fail("LOCAL_EVIDENCE_CHANGED", "filesystem");
      chargeCall();
      try { dirHandle = await opendir(absolute, { encoding: "latin1", bufferSize: 1, recursive: false }); }
      catch { onIoError(ioAt); }
      await checkpoint();
      const listed = await statPath(absolute, ioAt);
      if (!sameFingerprint(listed, record.stat)) fail("LOCAL_EVIDENCE_CHANGED", "filesystem");
      const retained: LocalSkillRecord[] = [];
      const names = new Set<string>();
      const folded = new Set<string>();
      while (true) {
        await checkpoint();
        chargeCall();
        let entry: Dirent | null;
        try { entry = await dirHandle.read(); }
        catch { onIoError(ioAt); }
        await checkpoint();
        if (entry === null) break;
        // One additional inspected entry distinguishes exact limit from EOF; it is not retained.
        if (retained.length >= maxEntries) fail("LIMIT_EXCEEDED", entryAt);
        const name = entry.name;
        if (!validEntryName(name)) fail("UNSAFE_PATH", entryAt);
        const path = record.path === "" ? name : `${record.path}/${name}`;
        if (!validEntryPath(path)) fail("UNSAFE_PATH", entryAt);
        if (Buffer.byteLength(absoluteOf(path), "utf8") > OFFLINE_LOCAL_SKILL_LIMITS.rootPathBytes) fail("LIMIT_EXCEEDED", entryAt);
        if (names.has(name)) fail("DUPLICATE_PATH", entryAt);
        const fold = name.toLowerCase();
        if (folded.has(fold)) fail("DUPLICATE_PATH", entryAt);
        names.add(name); folded.add(fold);
        const stat = await statPath(absoluteOf(path), entryAt);
        const kind = classifyStat(stat);
        if (kind === undefined) fail("UNSUPPORTED_LOCAL_STORAGE", "filesystem");
        if (nested && stat.dev !== rootRecord.stat.dev) fail("UNSUPPORTED_LOCAL_STORAGE", "filesystem");
        retained.push(issueRecord(path, kind, stat, entryAt));
      }
      chargeCall();
      let endHandle: BigIntStats;
      try { endHandle = await verifyHandle.stat({ bigint: true }); }
      catch { onIoError(ioAt); }
      await checkpoint();
      if (!sameFingerprint(endHandle, record.stat)) fail("LOCAL_EVIDENCE_CHANGED", "filesystem");
      const endListed = await statPath(absolute, ioAt);
      if (!sameFingerprint(endListed, record.stat)) fail("LOCAL_EVIDENCE_CHANGED", "filesystem");
      await closeDir(dirHandle);
      dirClosed = true;
      await closeFile(verifyHandle);
      verifyClosed = true;
      retained.sort(byPath);
      return Object.freeze(retained);
    } finally {
      if (!dirClosed && dirHandle !== undefined) await closeDir(dirHandle);
      if (!verifyClosed && verifyHandle !== undefined) await closeFile(verifyHandle);
    }
  }

  async function readFile(record: LocalSkillRecord): Promise<Buffer> {
    if (!issued.has(record)) fail("INVALID_LOCAL_INPUT", "filesystem");
    if (readFiles.has(record)) fail("INVALID_LOCAL_INPUT", "filesystem");
    const segments = record.path.split("/");
    if (segments.length < 2) fail("INVALID_LOCAL_INPUT", "filesystem");
    if (!nominated.has(segments[0]!)) fail("INVALID_LOCAL_INPUT", "filesystem");
    // Blocked leaves and hardlinked ordinary bodies are never opened.
    if (record.type !== "file") fail("UNSUPPORTED_LOCAL_STORAGE", "subtrees");
    if (record.stat.nlink !== 1n) fail("UNSUPPORTED_LOCAL_STORAGE", "subtrees");
    readFiles.add(record);
    const rootManifest = segments.length === 2 && segments[1] === "orgops-package.json";
    const cap = rootManifest ? OFFLINE_LOCAL_SKILL_LIMITS.manifestBytes : OFFLINE_LOCAL_SKILL_LIMITS.fileBytes;
    const size = record.stat.size;
    if (size > BigInt(cap)) fail("LIMIT_EXCEEDED", "subtrees");
    const absolute = absoluteOf(record.path);
    const pre = await statPath(absolute, "subtrees");
    if (!sameFingerprint(pre, record.stat)) fail("LOCAL_EVIDENCE_CHANGED", "filesystem");
    await checkpoint();
    let handle: FileHandle | undefined;
    let handleClosed = false;
    try {
      chargeCall();
      try { handle = await open(absolute, fileFlags); }
      catch { onIoError("subtrees"); }
      await checkpoint();
      chargeCall();
      let opened: BigIntStats;
      try { opened = await handle.stat({ bigint: true }); }
      catch { onIoError("subtrees"); }
      await checkpoint();
      if (!opened.isFile() || opened.nlink !== 1n || !sameFingerprint(opened, record.stat)) {
        fail("LOCAL_EVIDENCE_CHANGED", "filesystem");
      }
      const length = Number(size);
      const buffer = Buffer.alloc(length);
      for (let position = 0; position < length; position += OFFLINE_LOCAL_SKILL_LIMITS.chunkBytes) {
        await checkpoint();
        chargeCall();
        const count = Math.min(OFFLINE_LOCAL_SKILL_LIMITS.chunkBytes, length - position);
        let chunk: { bytesRead: number; buffer: Buffer };
        try { chunk = await handle.read(buffer, position, count, position); }
        catch { onIoError("subtrees"); }
        await checkpoint();
        if (chunk.buffer !== buffer || !Number.isSafeInteger(chunk.bytesRead) || chunk.bytesRead < 0) {
          fail("LOCAL_IO_FAILED", "subtrees");
        }
        if (chunk.bytesRead === 0 || chunk.bytesRead < count) fail("LOCAL_EVIDENCE_CHANGED", "filesystem");
      }
      await checkpoint();
      chargeCall();
      const probe = Buffer.alloc(1);
      let end: { bytesRead: number; buffer: Buffer };
      try { end = await handle.read(probe, 0, 1, length); }
      catch { onIoError("subtrees"); }
      await checkpoint();
      if (end.buffer !== probe || !Number.isSafeInteger(end.bytesRead) || end.bytesRead < 0) {
        fail("LOCAL_IO_FAILED", "subtrees");
      }
      // Growth beyond the declared size fails even below the general cap.
      if (end.bytesRead !== 0) fail("LOCAL_EVIDENCE_CHANGED", "filesystem");
      chargeCall();
      let after: BigIntStats;
      try { after = await handle.stat({ bigint: true }); }
      catch { onIoError("subtrees"); }
      await checkpoint();
      if (!sameFingerprint(after, record.stat)) fail("LOCAL_EVIDENCE_CHANGED", "filesystem");
      const post = await statPath(absolute, "subtrees");
      if (!sameFingerprint(post, record.stat)) fail("LOCAL_EVIDENCE_CHANGED", "filesystem");
      await closeFile(handle);
      handleClosed = true;
      return buffer;
    } finally {
      if (!handleClosed && handle !== undefined) await closeFile(handle);
    }
  }

  // Entry order: inputs, abort, deadline, platform, root lstat. The whole acquisition
  // phase is one ownership path: any selected terminal issue is caught here, never
  // escaping as a raw exception, symbol, path or authored bytes.
  let value: T | undefined;
  try {
    await checkpoint();
    if (process.platform !== "linux" && process.platform !== "darwin") return failure("UNSUPPORTED_LOCAL_STORAGE", "directory");
    const flags = nodeFs.constants;
    if ([flags.O_NOFOLLOW, flags.O_NONBLOCK, flags.O_DIRECTORY, flags.O_RDONLY].some(value => typeof value !== "number")) {
      return failure("UNSUPPORTED_LOCAL_STORAGE", "directory");
    }
    directoryFlags = flags.O_RDONLY | flags.O_NOFOLLOW | flags.O_NONBLOCK | flags.O_DIRECTORY;
    fileFlags = flags.O_RDONLY | flags.O_NOFOLLOW | flags.O_NONBLOCK;
    const rootStat = await statPath(directory, "directory");
    if (classifyStat(rootStat) !== "directory") return failure("UNSUPPORTED_LOCAL_STORAGE", "directory");
    rootRecord = issueRecord("", "directory", rootStat, "namespace");
    for (let i = 0; i < nominatedNames.length; i++) await checkpoint();
    const reader: LocalSkillRootReader = Object.freeze({
      input: Object.freeze({ directory, nominatedNames: Object.freeze([...nominatedNames]) }),
      root: rootRecord,
      listDirectory,
      readFile,
      checkpoint,
      fail,
    });
    value = await consume(reader);
    if (!terminal) {
      // Terminal recheck of every issued record, root/path code-unit order, no body opens.
      for (const record of [...registry].sort(byPath)) {
        await checkpoint();
        const stat = await statPath(absoluteOf(record.path), "filesystem");
        if (!sameFingerprint(stat, record.stat)) fail("LOCAL_EVIDENCE_CHANGED", "filesystem");
      }
      // Only pending success receives the final abort/deadline check.
      await checkpoint();
    }
  } catch (error) {
    if (error !== stopped && !terminal) terminal = { code: "INVALID_LOCAL_INPUT", at: "filesystem" };
  }
  if (cleanupFailed) return failure("LOCAL_CLEANUP_FAILED", "filesystem");
  if (terminal) return failure(terminal.code, terminal.at);
  if (cleanupBroken) return failure("LOCAL_IO_FAILED", "filesystem");
  return { ok: true, value: value as T };
}
