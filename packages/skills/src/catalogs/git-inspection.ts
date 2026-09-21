import { parsePackageManifest, parseCatalogIndex, type CatalogIndex } from "@orgops/schemas";
import { inspectPackage, type PackageSnapshot } from "./content";
import { readGitPackageBytes, readGitIndexBytes } from "./git-objects";
import {
  createGitOperation, checkGitOperation, type GitOperation, type GitInspectionOptions,
  type GitPackageInput, type GitIndexInput, type OfflineGitResult,
} from "./git-session";

function ended<T>(operation: GitOperation, result: OfflineGitResult<T>): OfflineGitResult<T> {
  const checked = checkGitOperation(operation);
  return checked.ok ? result : checked;
}
function decode(bytes: Buffer, at: "manifest" | "index", operation: GitOperation): OfflineGitResult<string> {
  const checked = checkGitOperation(operation);
  if (!checked.ok) return checked;
  try {
    // Preserve BOM: the JSON parser must reject it, not silently repair authored bytes.
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return ended(operation, { ok: true, value: text });
  } catch { return ended(operation, { ok: false, issues: [{ code: "INVALID_JSON", at }] }); }
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

/** Explicit offline I/O only; trusted storage is not source authority or publisher provenance. */
export async function inspectGitPackage(input: GitPackageInput, options?: GitInspectionOptions): Promise<OfflineGitResult<PackageSnapshot>> {
  const operation = createGitOperation(options?.signal);
  const raw = await readGitPackageBytes(input, operation);
  if (!raw.ok) return raw; // Reader has already selected the required cleanup outcome.
  const text = decode(raw.value.manifest, "manifest", operation);
  if (!text.ok) return text;
  const parsed = parsePackageManifest(text.value);
  const checked = checkGitOperation(operation);
  if (!checked.ok) return checked;
  if (!parsed.ok) return parsed;
  return ended(operation, inspectPackage(parsed.value, raw.value.entries));
}

/** Reads only the explicitly selected index. External locations remain inert claims. */
export async function readGitCatalogIndex(input: GitIndexInput, options?: GitInspectionOptions): Promise<OfflineGitResult<CatalogIndex>> {
  const operation = createGitOperation(options?.signal);
  const raw = await readGitIndexBytes(input, operation);
  if (!raw.ok) return raw;
  const text = decode(raw.value, "index", operation);
  if (!text.ok) return text;
  const parsed = parseCatalogIndex(text.value);
  const checked = checkGitOperation(operation);
  if (!checked.ok) return checked;
  if (!parsed.ok) return parsed;
  // Parsing constructs detached plain data; freezing never retains raw Buffer references.
  return ended(operation, { ok: true, value: freeze(parsed.value) });
}
