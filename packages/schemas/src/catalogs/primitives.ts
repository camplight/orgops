import { z } from "zod";

export const CATALOG_LIMITS = Object.freeze({
  manifestJsonBytes: 262144,
  indexJsonBytes: 2097152,
  contentEntries: 256,
  fileBytes: 1048576,
  totalContentBytes: 8388608,
  indexEntries: 4096,
  dependencies: 64,
  resolvedPackages: 256,
  recursionDepth: 64,
  suppliedCatalogs: 32,
  suppliedPackages: 4096,
  installedSkills: 4096,
  contentJsonBytes: 12582912,
  exportOptionsJsonBytes: 262144,
  resolverJsonBytes: 67108864,
  resolverContentBytes: 33554432,
  jsonDepth: 32,
} as const);

export type ContractIssue = {
  code: "INVALID_JSON" | "INVALID_MANIFEST" | "INVALID_INDEX" | "LIMIT_EXCEEDED"
    | "UNSAFE_PATH" | "DUPLICATE_PATH" | "UNSUPPORTED_ENTRY" | "INVENTORY_MISMATCH"
    | "DIGEST_MISMATCH" | "INVALID_SKILL" | "EXECUTABLE_MISMATCH"
    | "SOURCE_NOT_ALLOWED" | "MISSING_RELEASE" | "IDENTITY_CONFLICT"
    | "INCOMPATIBLE" | "UNSUPPORTED_DEPENDENCY" | "CYCLE" | "SKILL_CONFLICT"
    | "UNSUPPORTED_EXPORT" | "UNSUPPORTED_WIRING";
  at: string;
};
export type ContractResult<T> = { ok: true; value: T } | { ok: false; issues: ContractIssue[] };
export type ReviewWarning = {
  code: "SENSITIVE_TEXT" | "MANUAL_REVIEW_REQUIRED" | "EXTERNAL_RUNTIME_NOT_PINNED";
  at: string;
};
export function contractFailure(code: ContractIssue["code"], at = "$"): { ok: false; issues: ContractIssue[] } {
  return { ok: false, issues: [{ code, at }] };
}

const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
export const jsonString = (max: number, min = 0) => z.string().min(min).max(max).refine(value => !loneSurrogate.test(value));
export const nonblank = (max: number) => jsonString(max, 1).refine(value => value.trim().length > 0);
export const PackageNameSchema = z.string().min(1).max(64).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
export const SourceIdSchema = PackageNameSchema;
export const CatalogIdSchema = PackageNameSchema;
export type PackageName = z.infer<typeof PackageNameSchema>;
export type SourceId = z.infer<typeof SourceIdSchema>;
export type CatalogId = z.infer<typeof CatalogIdSchema>;
export const VersionSchema = z.string().regex(/^(?:0|[1-9][0-9]{0,5})\.(?:0|[1-9][0-9]{0,5})\.(?:0|[1-9][0-9]{0,5})$/);
export const CommitSchema = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
export const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
export type Version = z.infer<typeof VersionSchema>;
export type Commit = z.infer<typeof CommitSchema>;
export type Digest = z.infer<typeof DigestSchema>;

export const RelativePathSchema = z.string().min(1).max(240).refine(path => path.split("/").every(segment =>
  /^[A-Za-z0-9._-]{1,64}$/.test(segment)
  && segment !== "." && segment !== ".." && !segment.endsWith(".")
  && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)
  && !/^(?:\.git|\.orgops-data|node_modules)$/i.test(segment)
));
export type RelativePath = z.infer<typeof RelativePathSchema>;
export const ContentPathSchema = RelativePathSchema.refine(path => path.split("/")[0]!.toLowerCase() !== "orgops-package.json");
export const PackageKindSchema = z.enum(["skill", "native-agent", "wrapped-agent"]);
export const PositiveIntegerSchema = z.number().finite().int().min(1).max(2147483647);

export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const delta = left[i]! - right[i]!;
    if (delta !== 0) return delta;
  }
  return 0;
}
export function uniqueBy<T>(values: readonly T[], key: (value: T) => string): boolean {
  return new Set(values.map(key)).size === values.length;
}
export function collisionFreePaths(paths: readonly string[]): boolean {
  const seen = new Set(paths.map(path => path.toLowerCase()));
  if (seen.size !== paths.length) return false;
  for (const path of seen) {
    const segments = path.split("/");
    for (let i = 1; i < segments.length; i++) if (seen.has(segments.slice(0, i).join("/"))) return false;
  }
  return true;
}

/** JSON data only: descriptor checks do not promise protection from executable Proxy traps. */
export function validateCatalogJson(value: unknown, maxBytes: number): ContractResult<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) return contractFailure("INVALID_JSON");
  let bytes = 0;
  const ancestors = new Set<object>();
  let error: "INVALID_JSON" | "LIMIT_EXCEEDED" | undefined;
  const add = (count: number): boolean => {
    bytes += count;
    if (bytes > maxBytes) error = "LIMIT_EXCEEDED";
    return !error;
  };
  const stringBytes = (text: string): boolean => {
    if (text.length > maxBytes - bytes) { error = "LIMIT_EXCEEDED"; return false; }
    if (loneSurrogate.test(text)) { error = "INVALID_JSON"; return false; }
    return add(Buffer.byteLength(JSON.stringify(text), "utf8"));
  };
  const walk = (item: unknown, depth: number): boolean => {
    if (depth > CATALOG_LIMITS.jsonDepth) { error = "LIMIT_EXCEEDED"; return false; }
    if (item === null) return add(4);
    if (typeof item === "string") return stringBytes(item);
    if (typeof item === "boolean") return add(item ? 4 : 5);
    if (typeof item === "number" && Number.isFinite(item)) return add(JSON.stringify(item).length);
    if (typeof item !== "object" || ancestors.has(item)) { error = "INVALID_JSON"; return false; }
    const array = Array.isArray(item);
    const prototype = Object.getPrototypeOf(item);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
      error = "INVALID_JSON"; return false;
    }
    const keys = Reflect.ownKeys(item);
    if (keys.length > maxBytes) { error = "LIMIT_EXCEEDED"; return false; }
    if (keys.some(key => typeof key !== "string")) { error = "INVALID_JSON"; return false; }
    const length = array ? Object.getOwnPropertyDescriptor(item, "length")?.value as number : 0;
    if (array && length > maxBytes) { error = "LIMIT_EXCEEDED"; return false; }
    if (array && keys.length !== length + 1) { error = "INVALID_JSON"; return false; }
    if (!add(2)) return false;
    ancestors.add(item);
    const members = array ? keys.filter(key => key !== "length") : keys;
    for (let i = 0; i < members.length; i++) {
      const key = members[i] as string;
      if (array && key !== String(i)) { error = "INVALID_JSON"; return false; }
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
      if (!descriptor.enumerable || !("value" in descriptor)) { error = "INVALID_JSON"; return false; }
      if (i > 0 && !add(1)) return false;
      if (!array && (!stringBytes(key) || !add(1))) return false;
      if (!walk(descriptor.value, depth + 1)) return false;
    }
    ancestors.delete(item);
    return true;
  };
  return walk(value, 0) ? { ok: true, value } : contractFailure(error ?? "INVALID_JSON");
}

/** Standard JSON.parse last-key semantics; digests cover parsed data, not lexical duplicate keys. */
export function parseCatalogJson(json: string, maxBytes: number): ContractResult<unknown> {
  if (typeof json !== "string") return contractFailure("INVALID_JSON");
  if (json.length > maxBytes || Buffer.byteLength(json, "utf8") > maxBytes) return contractFailure("LIMIT_EXCEEDED");
  if (loneSurrogate.test(json)) return contractFailure("INVALID_JSON");
  let value: unknown;
  try { value = JSON.parse(json); } catch { return contractFailure("INVALID_JSON"); }
  return validateCatalogJson(value, maxBytes);
}
