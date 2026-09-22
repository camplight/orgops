import { createHash } from "node:crypto";
import { RelativePathSchema } from "@orgops/schemas";
import type { PublicationBase, PublicationTreeEntry } from "./publication-types";
import { withGitObjectReader, type GitObjectReader, type GitInputSnapshot } from "./git-object-reader";
import {
  createGitOperation, checkGitOperation, type GitIndexInput, type GitInspectionOptions,
  type OfflineGitResult, type GitObjectInfo,
} from "./git-session";

export type GitPublicationEvidenceInput = GitIndexInput;
export type GitPublicationEvidence = {
  commit: string;
  indexPath: string;
  inventory: PublicationBase["inventory"];
  indexBase64: string | null;
};
export const OFFLINE_GIT_EVIDENCE_LIMITS = Object.freeze({
  fileBytes: 1048576,
  indexBytes: 2097152,
  decodedBytes: 8388608,
  outputJsonBytes: 8388608,
} as const);
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
type TreeItem = { path: string; oid: string; mode: "40000" | "100644" | "100755" };

async function collect(reader: GitObjectReader, snapshot: GitInputSnapshot): Promise<GitPublicationEvidence> {
  const { check, readTree, info, contents } = reader;
  const fail: GitObjectReader["fail"] = reader.fail;
  const items: TreeItem[] = [];
  async function visit(oid: string, prefix: string, depth: number): Promise<void> {
    const raw = await readTree(oid, depth);
    const siblings = new Set<string>();
    const named = raw.map(entry => {
      check();
      if (entry.name.length > 64 || entry.name.some(byte => byte > 127)) fail("UNSAFE_PATH", "entries");
      const name = entry.name.toString("ascii");
      if (name.includes("/") || !RelativePathSchema.safeParse(name).success) fail("UNSAFE_PATH", "entries");
      const path = prefix ? `${prefix}/${name}` : name;
      if (!RelativePathSchema.safeParse(path).success) fail("UNSAFE_PATH", "entries");
      const folded = name.toLowerCase();
      if (siblings.has(folded)) fail("DUPLICATE_PATH", "entries");
      siblings.add(folded);
      return { name, path, mode: entry.mode, oid: entry.oid };
    }).sort((a, b) => compare(a.name, b.name));
    for (const entry of named) {
      check();
      if (entry.mode !== "40000" && entry.mode !== "100644" && entry.mode !== "100755") fail("UNSUPPORTED_ENTRY", "entries");
      items.push({ path: entry.path, mode: entry.mode, oid: entry.oid });
      if (entry.mode === "40000") await visit(entry.oid, entry.path, depth + 1);
    }
    check();
  }
  await visit(await reader.root(snapshot.commit), "", 0);
  items.sort((a, b) => compare(a.path, b.path));
  const exact = new Map(items.map(item => [item.path, item]));
  const folded = new Map(items.map(item => [item.path.toLowerCase(), item]));
  const parts = snapshot.path.split("/");
  // Explicit ancestors mean a missing component also proves the entire suffix absent.
  for (let i = 1; i <= parts.length; i++) {
    check(); const path = parts.slice(0, i).join("/"), item = exact.get(path);
    if (folded.has(path.toLowerCase()) && !item) fail("UNSAFE_PATH", "index");
    if (item && item.mode !== (i === parts.length ? "100644" : "40000")) fail("UNSUPPORTED_ENTRY", "index");
  }
  const measured: { file: TreeItem; record: GitObjectInfo; max: number }[] = [];
  let total = 0;
  // All structural/placement and metadata checks precede ANY ordinary blob body.
  for (const file of items) {
    check(); if (file.mode === "40000") continue;
    const selected = file.path === snapshot.path;
    const max = selected ? OFFLINE_GIT_EVIDENCE_LIMITS.indexBytes : OFFLINE_GIT_EVIDENCE_LIMITS.fileBytes;
    const record = await info(file.oid, "blob");
    if (record.size > max) fail("LIMIT_EXCEEDED", selected ? "index" : "entries");
    total += record.size;
    if (total > OFFLINE_GIT_EVIDENCE_LIMITS.decodedBytes) fail("LIMIT_EXCEEDED", "entries");
    measured.push({ file, record, max });
  }
  const entries: PublicationTreeEntry[] = [];
  const evidence: GitPublicationEvidence = {
    commit: snapshot.commit, indexPath: snapshot.path,
    inventory: { complete: true, entries }, indexBase64: null,
  };
  let outputBytes = Buffer.byteLength(JSON.stringify(evidence), "utf8");
  function account(growth: number): void {
    check();
    if (outputBytes + growth > OFFLINE_GIT_EVIDENCE_LIMITS.outputJsonBytes) fail("LIMIT_EXCEEDED", "entries");
    outputBytes += growth;
  }
  function append(entry: PublicationTreeEntry): void {
    account(Buffer.byteLength(JSON.stringify(entry), "utf8") + (entries.length ? 1 : 0));
    entries.push(entry);
  }
  account(0);
  for (const item of items) if (item.mode === "40000") append({ type: "directory", path: item.path });
  for (const { file, record, max } of measured) {
    const bytes = await contents(record, max); check();
    const entry = { type: "file" as const, path: file.path, size: bytes.length,
      digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, executable: file.mode === "100755" };
    check(); append(entry);
    if (file.path === snapshot.path) {
      // Base64 is ASCII without JSON escapes: quoted string replaces the initial null.
      account(4 * Math.ceil(bytes.length / 3) + 2 - 4);
      evidence.indexBase64 = bytes.toString("base64");
    }
    check();
  }
  entries.sort((a, b) => compare(a.path, b.path));
  check();
  const actualBytes = Buffer.byteLength(JSON.stringify(evidence), "utf8");
  check();
  if (actualBytes > OFFLINE_GIT_EVIDENCE_LIMITS.outputJsonBytes) fail("LIMIT_EXCEEDED", "entries");
  if (actualBytes !== outputBytes) fail("GIT_FAILED");
  return evidence; // Pending data only: the owner still must confirm finish/disposal.
}
function freeze(value: unknown): void {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
}

/** Complete local byte/tree evidence only, never semantic index validity, history or publication authority. */
export async function readGitPublicationEvidence(
  input: GitPublicationEvidenceInput, options?: GitInspectionOptions,
): Promise<OfflineGitResult<GitPublicationEvidence>> {
  const operation = createGitOperation(options?.signal);
  const result = await withGitObjectReader(input, operation, "indexPath", collect);
  if (!result.ok) return result; // In particular, never replace unconfirmed cleanup with a later check.
  const checked = checkGitOperation(operation);
  if (!checked.ok) return checked;
  freeze(result.value);
  const final = checkGitOperation(operation);
  return final.ok ? result : final;
}
