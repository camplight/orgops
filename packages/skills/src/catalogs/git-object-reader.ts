import { isAbsolute } from "node:path";
import { CommitSchema, RelativePathSchema } from "@orgops/schemas";
import {
  checkGitOperation, openGitObjectSession, OFFLINE_GIT_LIMITS,
  type GitOperation, type OfflineGitRepository, type OfflineGitResult,
  type OfflineGitIssue, type GitObjectInfo, type GitObjectSession,
} from "./git-session";

export type GitInputSnapshot = { repository: OfflineGitRepository; commit: string; path: string };
export type RawGitTreeEntry = { mode: string; name: Buffer; oid: string };
export type GitObjectReader = {
  root(commit: string): Promise<string>;
  readTree(oid: string, depth: number): Promise<RawGitTreeEntry[]>;
  info(oid: string, type: GitObjectInfo["type"]): Promise<GitObjectInfo>;
  contents(record: GitObjectInfo, max: number): Promise<Buffer>;
  check(): void;
  take<T>(result: OfflineGitResult<T>): T;
  fail(code: OfflineGitIssue["code"], at?: GitReadAt): never;
  error(): OfflineGitResult<never>;
};
export type GitReadAt = "$" | "repository" | "commit" | "path" | "manifest" | "index" | "entries" | "git";
const failure = (code: OfflineGitIssue["code"], at: GitReadAt = "git"): OfflineGitResult<never> => ({ ok: false, issues: [{ code, at }] });
const success = <T>(value: T): OfflineGitResult<T> => ({ ok: true, value });

// Own enumerable data properties only. Proxies remain outside the trusted caller contract.
function fields(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return;
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some(key => typeof key !== "string" || !keys.includes(key))) return;
  const snapshot: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) return;
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}
function hostPath(value: unknown): value is string {
  return typeof value === "string" && value.length <= 4096 && Buffer.byteLength(value, "utf8") <= 4096
    && isAbsolute(value) && !/[\u0000-\u001f\u007f-\u009f]/.test(value)
    && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value);
}
function inputSnapshot(input: unknown, selector: "path" | "indexPath"): OfflineGitResult<GitInputSnapshot> {
  const data = fields(input, ["repository", "commit", selector]);
  if (!data) return failure("INVALID_GIT_INPUT", "$");
  const repository = fields(data.repository, ["directory", "gitExecutable"]);
  if (!repository || !hostPath(repository.directory) || !hostPath(repository.gitExecutable)) return failure("INVALID_GIT_INPUT", "repository");
  if (typeof data.commit !== "string" || data.commit.length > 64 || !CommitSchema.safeParse(data.commit).success) return failure("INVALID_GIT_INPUT", "commit");
  const path = data[selector];
  if (typeof path !== "string") return failure("INVALID_GIT_INPUT", "path");
  if (path.length > 240 || !RelativePathSchema.safeParse(path).success) return failure("UNSAFE_PATH", "path");
  return success({ repository: { directory: repository.directory, gitExecutable: repository.gitExecutable }, commit: data.commit, path });
}

/** One operation's traversal and accounting. No cross-call object cache, disk paths, or authored commands. */
export function createGitObjectReader(session: GitObjectSession, operation: GitOperation): GitObjectReader {
  let issue: OfflineGitResult<never> | undefined;
  const stopped = Symbol("redacted reader failure");
  function fail(code: OfflineGitIssue["code"], at: GitReadAt = "git"): never { issue ??= failure(code, at); throw stopped; }
  function take<T>(result: OfflineGitResult<T>): T {
    if (!result.ok) { issue ??= result; throw stopped; }
    return result.value;
  }
  function check(): void { take(checkGitOperation(operation)); }
  async function info(oid: string, type: GitObjectInfo["type"]): Promise<GitObjectInfo> {
    check(); const result = take(await session.info(oid)); check();
    if (result.type !== type) fail("GIT_OBJECT_TYPE");
    return result;
  }
  async function contents(record: GitObjectInfo, max: number): Promise<Buffer> {
    check(); const result = take(await session.contents(record, max)); check(); return result;
  }
  let treeBytes = 0, occurrences = 0, entries = 0;
  const oidBytes = session.objectFormat === "sha1" ? 20 : 32;
  async function readTree(oid: string, depth: number): Promise<RawGitTreeEntry[]> {
    check();
    if (depth > OFFLINE_GIT_LIMITS.treeDepth || ++occurrences > OFFLINE_GIT_LIMITS.treeOccurrences) fail("LIMIT_EXCEEDED", "entries");
    const record = await info(oid, "tree");
    if (record.size > OFFLINE_GIT_LIMITS.treeBytes || treeBytes + record.size > OFFLINE_GIT_LIMITS.totalTreeBytes) fail("LIMIT_EXCEEDED", "entries");
    treeBytes += record.size;
    const bytes = await contents(record, OFFLINE_GIT_LIMITS.treeBytes);
    check(); const out: RawGitTreeEntry[] = [];
    for (let offset = 0; offset < bytes.length;) {
      check();
      const space = bytes.indexOf(0x20, offset);
      const nul = space < 0 ? -1 : bytes.indexOf(0, space + 1);
      const oidEnd = nul + 1 + oidBytes;
      if (space <= offset || nul <= space + 1 || oidEnd > bytes.length) fail("GIT_PROTOCOL_ERROR");
      const modeBytes = bytes.subarray(offset, space);
      if (modeBytes.some(byte => byte < 0x30 || byte > 0x37)) fail("GIT_PROTOCOL_ERROR");
      if (++entries > OFFLINE_GIT_LIMITS.treeEntries) fail("LIMIT_EXCEEDED", "entries");
      out.push({ mode: modeBytes.toString("ascii"), name: bytes.subarray(space + 1, nul), oid: bytes.subarray(nul + 1, oidEnd).toString("hex") });
      offset = oidEnd;
    }
    check(); return out;
  }
  async function root(commit: string): Promise<string> {
    check();
    if (commit.length !== oidBytes * 2) fail("UNSUPPORTED_GIT_STORAGE", "repository");
    const record = await info(commit, "commit");
    if (record.size > OFFLINE_GIT_LIMITS.commitBytes) fail("LIMIT_EXCEEDED", "commit");
    const bytes = await contents(record, OFFLINE_GIT_LIMITS.commitBytes);
    const end = 5 + oidBytes * 2;
    if (bytes.length <= end || bytes[end] !== 10 || !bytes.subarray(0, 5).equals(Buffer.from("tree "))
      || bytes.subarray(5, end).some(byte => !(byte >= 48 && byte <= 57 || byte >= 97 && byte <= 102))) fail("GIT_PROTOCOL_ERROR");
    check(); return bytes.subarray(5, end).toString("ascii");
  }
  return { root, readTree, info, contents, check, take, fail, error: () => issue ?? failure("GIT_FAILED") };
}

export async function withGitObjectReader<T>(
  input: unknown, suppliedOperation: GitOperation, selector: "path" | "indexPath",
  consume: (reader: GitObjectReader, snapshot: GitInputSnapshot) => Promise<T>,
): Promise<OfflineGitResult<T>> {
  let session: GitObjectSession | undefined;
  let result: OfflineGitResult<T> = failure("GIT_FAILED");
  let reader: GitObjectReader | undefined;
  try {
    const snapshot = inputSnapshot(input, selector);
    if (!snapshot.ok) return snapshot;
    const operation = { deadline: suppliedOperation.deadline, signal: suppliedOperation.signal };
    const checked = checkGitOperation(operation);
    if (!checked.ok) return checked;
    const opened = await openGitObjectSession(snapshot.value.repository, operation);
    if (!opened.ok) return opened; // Failed opening already owns awaited cleanup.
    session = opened.value; reader = createGitObjectReader(session, operation); reader.check();
    const value = await consume(reader, snapshot.value);
    reader.check(); reader.take(await session.finish()); reader.check();
    result = success(value);
  } catch { result = reader?.error() ?? failure("GIT_FAILED"); }
  finally {
    if (session) {
      // Selection happens after disposal, never an early return that loses cleanup failure.
      try { const cleanup = await session.dispose(); if (!cleanup.ok) result = cleanup; }
      catch { result = failure("GIT_CLEANUP_FAILED"); }
    }
  }
  if (result.ok && reader) {
    try { reader.check(); } catch { result = reader.error(); }
  }
  return result;
}
