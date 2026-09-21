import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SourceIdSchema } from "@orgops/schemas";
import { CATALOG_SYNC_GIT_LIMITS } from "./git-fetch";

export type CatalogMirrorResult = { ok: true; directory: string } | { ok: false; code: "MIRROR_INVALID" | "MIRROR_IO" };

// The only accepted mirror configs: byte-exact templates we wrote ourselves (sha1, bare).
const CONFIG_FILEMODE_TRUE = "[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = true\n";
const CONFIG_FILEMODE_FALSE = "[core]\n\trepositoryformatversion = 0\n\tfilemode = false\n\tbare = true\n";
const ACCEPTED_CONFIGS = Object.freeze([CONFIG_FILEMODE_TRUE, CONFIG_FILEMODE_FALSE] as const);
const HEAD = "ref: refs/heads/main\n";

const errorCode = (error: unknown): unknown => error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
const invalid: CatalogMirrorResult = { ok: false, code: "MIRROR_INVALID" };
const io: CatalogMirrorResult = { ok: false, code: "MIRROR_IO" };

/** Owned bare mirror under <DATA_DIR>/catalog-mirrors/<sourceId>; no remotes, alternates,
 * promisor, hooks or includes can exist because the config is byte-exact ours.
 * options.create === false selects verify-only mode for read views: nothing is ever
 * written, and an absent root or source directory reports MIRROR_INVALID so callers
 * can treat "no mirror here" as "no synced result" without a distinct contract code. */
export async function ensureCatalogMirror(mirrorsRoot: string, sourceId: string,
  options?: { create?: boolean }): Promise<CatalogMirrorResult> {
  if (!SourceIdSchema.safeParse(sourceId).success) return invalid;
  const directory = join(mirrorsRoot, sourceId);
  if (Buffer.byteLength(directory, "utf8") > CATALOG_SYNC_GIT_LIMITS.mirrorPathBytes) return invalid;
  const create = options?.create !== false;
  let rootStat;
  try { rootStat = await lstat(mirrorsRoot); }
  catch (error) {
    if (errorCode(error) !== "ENOENT") return io;
    if (!create) return invalid;
    try { await mkdir(mirrorsRoot, { mode: 0o700 }); } catch { return io; }
  }
  if (rootStat && (!rootStat.isDirectory() || rootStat.isSymbolicLink())) return invalid;
  let sourceStat;
  try { sourceStat = await lstat(directory); }
  catch (error) {
    if (errorCode(error) !== "ENOENT") return io;
    if (!create) return invalid;
    let created = false;
    try {
      await mkdir(directory, { mode: 0o700 });
      created = true;
      await writeFile(join(directory, "config"), CONFIG_FILEMODE_TRUE, { flag: "wx", mode: 0o600 });
      await writeFile(join(directory, "HEAD"), HEAD, { flag: "wx", mode: 0o600 });
      await mkdir(join(directory, "objects", "pack"), { recursive: true, mode: 0o700 });
      await mkdir(join(directory, "objects", "info"), { recursive: true, mode: 0o700 });
      await mkdir(join(directory, "refs"), { recursive: true, mode: 0o700 });
    } catch {
      // Remove only the just-created directory; an existing foreign tree is never touched.
      if (created) { try { await rm(directory, { recursive: true, force: true }); } catch { /* best effort */ } }
      return io;
    }
    return { ok: true, directory };
  }
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) return invalid;
  return verifyExistingMirror(directory);
}

async function verifyExistingMirror(directory: string): Promise<CatalogMirrorResult> {
  try {
    const configStat = await lstat(join(directory, "config"));
    if (!configStat.isFile() || configStat.size > CATALOG_SYNC_GIT_LIMITS.configBytes) return invalid;
    const config = await readFile(join(directory, "config"));
    if (config.byteLength > CATALOG_SYNC_GIT_LIMITS.configBytes) return invalid;
    if (!ACCEPTED_CONFIGS.some(template => config.equals(Buffer.from(template, "utf8")))) return invalid;
    for (const name of ["objects", "objects/info", "objects/pack"]) {
      const stat = await lstat(join(directory, name));
      if (!stat.isDirectory() || stat.isSymbolicLink()) return invalid;
    }
    for (const name of ["commondir", "config.worktree", "objects/info/alternates", "objects/info/http-alternates"]) {
      try { await lstat(join(directory, name)); return invalid; }
      catch (error) { if (errorCode(error) !== "ENOENT") return io; }
    }
    const packEntries = await readdir(join(directory, "objects", "pack"));
    if (packEntries.length > CATALOG_SYNC_GIT_LIMITS.packDirectoryEntries) return invalid;
    if (packEntries.some(name => name.includes(".promisor"))) return invalid;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return invalid; // a required layout member is missing
    return io;
  }
  return { ok: true, directory };
}
