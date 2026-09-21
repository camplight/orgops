import { CATALOG_LIMITS, RelativePathSchema } from "@orgops/schemas";
import type { ContentEntry } from "./content";
import {
  OFFLINE_GIT_LIMITS, type GitOperation, type GitPackageInput, type GitIndexInput,
  type OfflineGitResult, type GitObjectInfo,
} from "./git-session";
import { withGitObjectReader, type GitObjectReader, type RawGitTreeEntry } from "./git-object-reader";

export type GitPackageBytes = { manifest: Buffer; entries: ContentEntry[] };
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const manifestName = "orgops-package.json";
type InventoryFile = { path: string; oid: string; executable: boolean; manifest: boolean };
function createReader(reader: GitObjectReader) {
  const { readTree, check, info, contents } = reader;
  const fail: GitObjectReader["fail"] = reader.fail;
  async function select(rootOid: string, path: string, index: boolean): Promise<{ oid: string; depth: number }> {
    const parts = path.split("/");
    let oid = rootOid;
    for (let depth = 0; depth < parts.length; depth++) {
      const siblings = await readTree(oid, depth);
      check(); const name = parts[depth]!, exact = Buffer.from(name, "ascii");
      let selected: RawGitTreeEntry | undefined, twins = 0;
      for (const entry of siblings) {
        // Only lossless validated portable ASCII siblings can form selector case twins.
        if (entry.name.length <= 64 && !entry.name.some(byte => byte > 127)) {
          const decoded = entry.name.toString("ascii");
          if (RelativePathSchema.safeParse(decoded).success && decoded.toLowerCase() === name.toLowerCase()) twins++;
        }
        if (entry.name.equals(exact)) selected = entry;
      }
      if (twins > 1) fail("DUPLICATE_PATH", "path");
      if (!selected) fail("GIT_PATH_MISSING", "path");
      const finalIndex = index && depth === parts.length - 1;
      if (selected.mode !== (finalIndex ? "100644" : "40000")) fail("UNSUPPORTED_ENTRY", finalIndex ? "index" : "path");
      oid = selected.oid;
    }
    return { oid, depth: parts.length };
  }
  async function packageBytes(oid: string, depth: number): Promise<GitPackageBytes> {
    const inventory: InventoryFile[] = [];
    let contentCount = 0, hasManifest = false;
    async function visit(treeOid: string, prefix: string, currentDepth: number): Promise<void> {
      const raw = await readTree(treeOid, currentDepth);
      if (prefix && raw.length === 0) fail("UNSUPPORTED_ENTRY", "entries");
      check(); const siblings = new Set<string>();
      const named = raw.map(entry => {
        check();
        if (entry.name.length > 64 || entry.name.some(byte => byte > 127)) fail("UNSAFE_PATH", "entries");
        const name = entry.name.toString("ascii");
        if (!RelativePathSchema.safeParse(name).success || name.includes("/")) fail("UNSAFE_PATH", "entries");
        const folded = name.toLowerCase();
        if (siblings.has(folded)) fail("DUPLICATE_PATH", "entries");
        siblings.add(folded);
        return { ...entry, name };
      }).sort((a, b) => compare(a.name, b.name));
      for (const entry of named) {
        check(); const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (!RelativePathSchema.safeParse(path).success) fail("UNSAFE_PATH", "entries");
        const reserved = !prefix && entry.name.toLowerCase() === manifestName;
        if (reserved && (entry.name !== manifestName || entry.mode === "40000")) fail("UNSAFE_PATH", "manifest");
        if (entry.mode === "40000") { await visit(entry.oid, path, currentDepth + 1); check(); }
        else {
          if (entry.mode !== "100644" && entry.mode !== "100755" || reserved && entry.mode !== "100644") fail("UNSUPPORTED_ENTRY", reserved ? "manifest" : "entries");
          if (!reserved && ++contentCount > CATALOG_LIMITS.contentEntries || inventory.length >= OFFLINE_GIT_LIMITS.packageFiles) fail("LIMIT_EXCEEDED", "entries");
          if (reserved) hasManifest = true;
          inventory.push({ path, oid: entry.oid, executable: entry.mode === "100755", manifest: reserved });
        }
      }
    }
    await visit(oid, "", depth); check();
    if (!hasManifest) fail("GIT_PATH_MISSING", "manifest");
    inventory.sort((a, b) => compare(a.path, b.path));
    const measured: { file: InventoryFile; record: GitObjectInfo; max: number }[] = [];
    let total = 0;
    // Complete inventory and all metadata must pass before ANY manifest/content blob read.
    for (const file of inventory) {
      const record = await info(file.oid, "blob");
      const max = file.manifest ? CATALOG_LIMITS.manifestJsonBytes : CATALOG_LIMITS.fileBytes;
      if (record.size > max) fail("LIMIT_EXCEEDED", file.manifest ? "manifest" : "entries");
      if (!file.manifest) { total += record.size; if (total > CATALOG_LIMITS.totalContentBytes) fail("LIMIT_EXCEEDED", "entries"); }
      check(); measured.push({ file, record, max });
    }
    let manifest: Buffer | undefined;
    const output: ContentEntry[] = [];
    for (const { file, record, max } of measured) {
      const bytes = await contents(record, max); check();
      if (file.manifest) manifest = bytes;
      else output.push({ type: "file", path: file.path, base64: bytes.toString("base64"), executable: file.executable });
      check();
    }
    if (!manifest) fail("GIT_PATH_MISSING", "manifest");
    return { manifest, entries: output };
  }
  async function indexBytes(oid: string): Promise<Buffer> {
    const record = await info(oid, "blob");
    if (record.size > CATALOG_LIMITS.indexJsonBytes) fail("LIMIT_EXCEEDED", "index");
    return contents(record, CATALOG_LIMITS.indexJsonBytes);
  }
  return { select, packageBytes, indexBytes };
}

export function readGitPackageBytes(input: GitPackageInput, operation: GitOperation): Promise<OfflineGitResult<GitPackageBytes>> {
  return withGitObjectReader(input, operation, "path", async (raw, snapshot) => {
    const reader = createReader(raw);
    const root = await raw.root(snapshot.commit); raw.check();
    const selected = await reader.select(root, snapshot.path, false); raw.check();
    return reader.packageBytes(selected.oid, selected.depth);
  });
}
export function readGitIndexBytes(input: GitIndexInput, operation: GitOperation): Promise<OfflineGitResult<Buffer>> {
  return withGitObjectReader(input, operation, "indexPath", async (raw, snapshot) => {
    const reader = createReader(raw);
    const root = await raw.root(snapshot.commit); raw.check();
    const selected = await reader.select(root, snapshot.path, true); raw.check();
    return reader.indexBytes(selected.oid);
  });
}
