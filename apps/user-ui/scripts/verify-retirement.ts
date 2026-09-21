import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const FORBIDDEN_RETIREMENT_MARKERS = [
  "LibraryScreen",
  "createUserLibraryApi",
  "createUserLibraryController",
  "./library/api",
  "./library/state",
  "/api/library/",
  "library-management",
  "library-app-shell",
  "library-sidebar",
  "library-nav",
  "library-screen",
  "library-dialog",
  "library-package",
  "library-local-activity",
  "Create stopped agent",
  "Reload library",
  "Granted package library",
  "Assign skill",
  "Create from template",
  "Skill assignment",
  "Plan rollout",
  "Confirm rollout",
  "Refresh rollout status",
  "Retry eligible targets",
  "Cancel rollout",
  "Local package activity",
  "Rollout history",
  "Stopped template wizard",
  "Immutable release confirmation"
];
const ASSET_EXTENSIONS = new Set([".css", ".html", ".js", ".mjs"]);

type RetirementVerificationResult = { sourceFiles: number; assetFiles: number };

async function filesUnder(root: string, base = root): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = resolve(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`symbolic link is not allowed: ${relative(base, path)}`);
    if (entry.isDirectory()) files.push(...await filesUnder(path, base));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function markerIn(text: string): string | undefined {
  const lowered = text.toLowerCase();
  return FORBIDDEN_RETIREMENT_MARKERS.find((marker) => lowered.includes(marker.toLowerCase()));
}

function manifestPath(raw: unknown, field: string, distRoot: string): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.includes("\\") || raw.includes("%") || raw.startsWith("/") || /^[A-Za-z]:/.test(raw)) {
    throw new Error(`invalid manifest ${field} path`);
  }
  const segments = raw.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new Error(`manifest ${field} path traversal: ${raw}`);
  }
  const normalized = posix.normalize(raw);
  if (normalized !== raw) throw new Error(`invalid manifest ${field} path: ${raw}`);
  const candidate = resolve(distRoot, ...segments);
  const escaped = relative(distRoot, candidate);
  if (escaped === ".." || escaped.startsWith(`..${sep}`) || escaped.includes(`${sep}${sep}`)) {
    throw new Error(`manifest ${field} path escapes dist root: ${raw}`);
  }
  return normalized;
}

async function assertRealPathInside(distRoot: string, raw: string, field: string) {
  const candidate = resolve(distRoot, ...raw.split("/"));
  try {
    const realRoot = await realpath(distRoot);
    const realCandidate = await realpath(candidate);
    const escaped = relative(realRoot, realCandidate);
    if (escaped === ".." || escaped.startsWith(`..${sep}`)) throw new Error(`manifest ${field} path escapes dist root: ${raw}`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("escapes dist root")) throw error;
    // Missing assets are reported after graph validation with a fixed message.
  }
}

async function manifestAssets(value: unknown, distRoot: string): Promise<Set<string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid Vite manifest object");
  const entries = value as Record<string, unknown>;
  const reachable = new Set<string>();
  const validated = new Map<string, Record<string, unknown>>();
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const cycleVisited = new Set<string>();
  const cycleVisiting = new Set<string>();
  const validateEntry = async (key: string) => {
    const cached = validated.get(key);
    if (cached) return cached;
    const entry = entries[key];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`invalid manifest entry ${key}`);
    const record = entry as Record<string, unknown>;
    const file = manifestPath(record.file, `${key}.file`, distRoot);
    await assertRealPathInside(distRoot, file, `${key}.file`);
    for (const field of ["css", "assets"] as const) {
      const values = record[field];
      if (values === undefined) continue;
      if (!Array.isArray(values) || values.some((item) => typeof item !== "string") || new Set(values).size !== values.length) {
        throw new Error(`invalid or duplicate manifest ${key}.${field}`);
      }
      for (const item of values) {
        const path = manifestPath(item, `${key}.${field}`, distRoot);
        await assertRealPathInside(distRoot, path, `${key}.${field}`);
      }
    }
    for (const field of ["imports", "dynamicImports"] as const) {
      const values = record[field];
      if (values === undefined) continue;
      if (!Array.isArray(values) || values.some((item) => typeof item !== "string") || new Set(values).size !== values.length) {
        throw new Error(`invalid or duplicate manifest ${key}.${field}`);
      }
      for (const item of values) {
        const ref = manifestPath(item, `${key}.${field}`, distRoot);
        if (!(ref in entries)) throw new Error(`manifest ${field} references missing entry ${ref}`);
      }
    }
    validated.set(key, record);
    return record;
  };
  const visit = async (key: string) => {
    if (visiting.has(key)) throw new Error(`manifest import cycle at ${key}`);
    if (visited.has(key)) return;
    const record = await validateEntry(key);
    visiting.add(key);
    const file = manifestPath(record.file, `${key}.file`, distRoot);
    reachable.add(file);
    for (const field of ["css", "assets"] as const) {
      const values = record[field];
      if (Array.isArray(values)) for (const item of values) reachable.add(manifestPath(item, `${key}.${field}`, distRoot));
    }
    for (const field of ["imports", "dynamicImports"] as const) {
      const values = record[field];
      if (Array.isArray(values)) for (const item of values) await visit(manifestPath(item, `${key}.${field}`, distRoot));
    }
    visiting.delete(key);
    visited.add(key);
  };
  for (const key of Object.keys(entries)) await validateEntry(key);
  const detectCycles = async (key: string): Promise<void> => {
    if (cycleVisiting.has(key)) throw new Error(`manifest import cycle at ${key}`);
    if (cycleVisited.has(key)) return;
    const record = await validateEntry(key);
    cycleVisiting.add(key);
    for (const field of ["imports", "dynamicImports"] as const) {
      const values = record[field];
      if (Array.isArray(values)) for (const item of values) await detectCycles(manifestPath(item, `${key}.${field}`, distRoot));
    }
    cycleVisiting.delete(key);
    cycleVisited.add(key);
  };
  for (const key of Object.keys(entries)) await detectCycles(key);
  const roots = Object.entries(entries).filter(([, entry]) => entry && typeof entry === "object" && (entry as Record<string, unknown>).isEntry === true);
  if (roots.length === 0) throw new Error("manifest has no entry");
  for (const [key] of roots) await visit(key);
  if (visited.size !== Object.keys(entries).length) {
    const orphan = Object.keys(entries).find((key) => !visited.has(key));
    throw new Error(`unreachable manifest entry: ${orphan ?? "unknown"}`);
  }
  return reachable;
}

export async function verifyRetirement(root: string): Promise<RetirementVerificationResult> {
  const sourceRoot = resolve(root, "src");
  const distRoot = resolve(root, "dist");
  const sourceFiles = (await filesUnder(sourceRoot)).filter((path) => !path.endsWith(".snap"));
  const distInventory = await filesUnder(distRoot);
  for (const path of sourceFiles) {
    const marker = markerIn(await readFile(path, "utf8"));
    if (marker) throw new Error(`forbidden source marker ${marker} in ${relative(root, path)}`);
  }

  const manifestPath = resolve(distRoot, ".vite", "manifest.json");
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    throw new Error(`missing or invalid Vite manifest at ${relative(root, manifestPath)}`);
  }
  const reachable = await manifestAssets(manifest, distRoot);
  const distFiles = distInventory.filter((path) => ASSET_EXTENSIONS.has(resolve(path).slice(resolve(path).lastIndexOf(".")).toLowerCase()));
  const namedDistFiles = distFiles.map((path) => ({ path, name: relative(distRoot, path).split(sep).join("/") }));
  const assetFiles = namedDistFiles.filter(({ name }) => name !== "index.html");
  for (const { path, name } of namedDistFiles) {
    const marker = markerIn(await readFile(path, "utf8"));
    if (marker) throw new Error(`forbidden dist marker ${marker} in ${name}`);
    if (name !== "index.html" && !reachable.has(name)) throw new Error(`unreferenced dist asset ${name}`);
  }
  for (const name of reachable) {
    const path = resolve(distRoot, name);
    try {
      if (!(await stat(path)).isFile()) throw new Error();
    } catch {
      throw new Error(`manifest references missing asset ${name}`);
    }
  }
  return { sourceFiles: sourceFiles.length, assetFiles: assetFiles.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  verifyRetirement(root)
    .then((result) => console.log(`User-ui retirement verified: ${result.sourceFiles} source files, ${result.assetFiles} assets.`))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
