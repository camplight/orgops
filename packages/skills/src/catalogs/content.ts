import { createHash } from "node:crypto";
import {
  CATALOG_LIMITS, RelativePathSchema, validateCatalogJson, validatePackageManifest,
  type ContractIssue, type ContractResult, type PackageManifest, type ReviewWarning, type PortableCommand,
} from "@orgops/schemas";
import { parseSkillDocument } from "./skill-document";

export type ContentEntry =
  | { type: "file"; path: string; base64: string; executable: boolean }
  | { type: "symlink"; path: string; target: string }
  | { type: "hardlink"; path: string; target: string }
  | { type: "special"; path: string; specialType: "directory" | "device" | "fifo" | "socket" };
export type InspectedFile = { path: string; base64: string; executable: boolean; size: number; digest: string };
export type ExecutionPreview = {
  apiEventShapes: string[];
  runnerScripts: string[];
  wrappedCommands: { at: string; command: string; args: string[] }[];
  externalSources: { type: "github"; repo: string; ref?: string }[];
};
export type PackageSnapshot = {
  manifest: PackageManifest;
  files: readonly InspectedFile[];
  execution: ExecutionPreview;
  warnings: readonly ReviewWarning[];
};
const failure = (code: ContractIssue["code"], at = "$"): ContractResult<never> => ({ ok: false, issues: [{ code, at }] });
const sha256 = (bytes: Uint8Array | string): string => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

// Internal serialization seam for the selected-file exporter. Only validated JSON enters here.
export function normalizedManifest(manifest: PackageManifest): PackageManifest {
  const copy: PackageManifest = structuredClone(manifest);
  copy.files.sort((a, b) => compare(a.path, b.path));
  copy.executables.sort((a, b) => compare(a.path, b.path));
  copy.dependencies.sort((a, b) => compare(a.catalogId, b.catalogId) || compare(a.sourceId, b.sourceId) || compare(a.name, b.name));
  copy.secrets.sort((a, b) => compare(a.name, b.name));
  copy.compatibility.platforms.sort(); copy.compatibility.tools.sort();
  if (copy.kind === "native-agent") copy.native.alwaysPreloadedSkills.sort();
  return copy;
}
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

/** The sole installer-format manifest serializer: normalized, pretty JSON with one trailing LF. */
export function canonicalManifestBytes(manifest: PackageManifest): Buffer {
  return Buffer.from(`${JSON.stringify(JSON.parse(canonicalJson(normalizedManifest(manifest))), null, 2)}\n`, "utf8");
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function text(bytes: Uint8Array): string | undefined {
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return undefined; }
}
const sensitive = /gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:password|token|secret|api[_-]?key)\s*[:=]\s*\S+/i;
function scanStrings(value: unknown, at: string, warnings: ReviewWarning[]): void {
  if (typeof value === "string") {
    if (sensitive.test(value)) warnings.push({ code: "SENSITIVE_TEXT", at });
  } else if (value && typeof value === "object") {
    for (const key of Object.keys(value).sort()) scanStrings((value as Record<string, unknown>)[key], at ? `${at}.${key}` : key, warnings);
  }
}

function checkPackage(raw: unknown, entries: readonly ContentEntry[], compareDigest: boolean): ContractResult<{ snapshot: PackageSnapshot; digest: string }> {
  const manifestJson = validateCatalogJson(raw, CATALOG_LIMITS.manifestJsonBytes);
  if (!manifestJson.ok) return manifestJson;
  const contentJson = validateCatalogJson(entries, CATALOG_LIMITS.contentJsonBytes);
  if (!contentJson.ok) return contentJson;
  if (!Array.isArray(entries)) return failure("UNSUPPORTED_ENTRY", "entries");
  if (entries.length > CATALOG_LIMITS.contentEntries) return failure("LIMIT_EXCEEDED", "entries");

  // Preflight encoded lengths across the entire collection before decoding or hashing any file.
  let total = 0;
  for (const entry of entries as readonly unknown[]) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return failure("UNSUPPORTED_ENTRY", "entries");
    const record = entry as Record<string, unknown>;
    if (typeof record.base64 === "string") {
      const length = record.base64.length;
      const size = Math.floor(length / 4) * 3 - (record.base64.endsWith("==") ? 2 : record.base64.endsWith("=") ? 1 : 0);
      if (length > Math.ceil(CATALOG_LIMITS.fileBytes / 3) * 4 || size > CATALOG_LIMITS.fileBytes) return failure("LIMIT_EXCEEDED", "entries");
      total += Math.max(0, size);
      if (total > CATALOG_LIMITS.totalContentBytes) return failure("LIMIT_EXCEEDED", "entries");
    }
  }
  const paths = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== "file" || Object.keys(entry).sort().join(",") !== "base64,executable,path,type"
      || typeof entry.base64 !== "string" || typeof entry.executable !== "boolean") return failure("UNSUPPORTED_ENTRY", "entries");
    if (!RelativePathSchema.safeParse(entry.path).success || entry.path.split("/")[0]!.toLowerCase() === "orgops-package.json") return failure("UNSAFE_PATH", "entries.path");
    const folded = entry.path.toLowerCase();
    if (paths.has(folded)) return failure("DUPLICATE_PATH", "entries.path");
    paths.add(folded);
  }
  for (const path of paths) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) if (paths.has(parts.slice(0, i).join("/"))) return failure("DUPLICATE_PATH", "entries.path");
  }
  const files: InspectedFile[] = [];
  const bytesByPath = new Map<string, Buffer>();
  for (const entry of entries) {
    if (entry.type !== "file") return failure("UNSUPPORTED_ENTRY", "entries");
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.base64)) return failure("UNSUPPORTED_ENTRY", "entries.base64");
    const bytes = Buffer.from(entry.base64, "base64");
    if (bytes.toString("base64") !== entry.base64) return failure("UNSUPPORTED_ENTRY", "entries.base64");
    bytesByPath.set(entry.path, bytes);
    files.push({ path: entry.path, base64: entry.base64, executable: entry.executable, size: bytes.length, digest: sha256(bytes) });
  }
  const parsed = validatePackageManifest(raw);
  if (!parsed.ok) return parsed;
  const manifest = normalizedManifest(parsed.value);
  files.sort((a, b) => compare(a.path, b.path));
  if (files.length !== manifest.files.length || files.some((file, i) => {
    const declared = manifest.files[i]!;
    return file.path !== declared.path || file.size !== declared.size || file.digest !== declared.digest || file.executable !== declared.executable;
  })) return failure("INVENTORY_MISMATCH", "files");
  if (manifest.kind === "skill") {
    const bytes = bytesByPath.get("SKILL.md");
    const document = bytes === undefined ? undefined : text(bytes);
    if (document === undefined) return failure("INVALID_SKILL", "SKILL.md");
    const skill = parseSkillDocument(document, manifest.name);
    if (!skill.ok) return skill;
    if (skill.value.description !== manifest.description || (skill.value.license !== undefined && skill.value.license !== manifest.license)) return failure("INVALID_SKILL", "SKILL.md");
  }
  const execution: ExecutionPreview = { apiEventShapes: [], runnerScripts: [], wrappedCommands: [], externalSources: [] };
  for (const file of files) {
    const rootApi = /^event-shapes\.(?:ts|js)$/i.test(file.path);
    const exactApi = file.path === "event-shapes.ts" || file.path === "event-shapes.js";
    const declaration = manifest.executables.find(item => item.path === file.path);
    const bytes = bytesByPath.get(file.path)!;
    const script = file.executable || (bytes[0] === 35 && bytes[1] === 33) || /\.(?:ts|js|mjs|cjs|sh|bash|zsh|py|rb|ps1|cmd|bat|exe|com|wasm)$/i.test(file.path);
    if ((rootApi && !exactApi) || (exactApi && declaration?.execution !== "api-event-shapes")
      || (!exactApi && declaration?.execution === "api-event-shapes")
      || (!exactApi && script && declaration?.execution !== "runner-script")) return failure("EXECUTABLE_MISMATCH", file.path);
    if (declaration?.execution === "api-event-shapes") execution.apiEventShapes.push(file.path);
    if (declaration?.execution === "runner-script") execution.runnerScripts.push(file.path);
  }
  const warnings: ReviewWarning[] = [{ code: "MANUAL_REVIEW_REQUIRED", at: "$" }];
  if (manifest.kind === "wrapped-agent") {
    const wrapped = manifest.wrapped;
    const command = (config: PortableCommand & { checkCommand?: string }, at: string) => {
      execution.wrappedCommands.push({ at: `${at}.command`, command: config.command, args: [...(config.args ?? [])] });
      if (config.checkCommand !== undefined) execution.wrappedCommands.push({ at: `${at}.checkCommand`, command: config.checkCommand, args: [...(config.args ?? [])] });
    };
    if (wrapped.setup) command(wrapped.setup, "wrapped.setup");
    wrapped.sidecars.forEach((sidecar, i) => command(sidecar, `wrapped.sidecars.${i}`));
    command(wrapped.runtime, "wrapped.runtime");
    if (wrapped.source) execution.externalSources.push({ type: "github", repo: wrapped.source.repo, ...(wrapped.source.ref === undefined ? {} : { ref: wrapped.source.ref }) });
    warnings.push({ code: "EXTERNAL_RUNTIME_NOT_PINNED", at: "wrapped" });
  }
  scanStrings(manifest, "", warnings);
  for (const file of files) {
    const decoded = text(bytesByPath.get(file.path)!);
    if (decoded !== undefined && sensitive.test(decoded)) warnings.push({ code: "SENSITIVE_TEXT", at: file.path });
  }
  const { digest: _digest, ...covered } = manifest;
  const digest = sha256(`orgops-package-v1\n${canonicalJson(covered)}`);
  if (compareDigest && manifest.digest !== digest) return failure("DIGEST_MISMATCH", "digest");
  return { ok: true, value: { digest, snapshot: freeze({ manifest, files, execution, warnings }) } };
}

export function computePackageDigest(manifest: unknown, entries: readonly ContentEntry[]): ContractResult<string> {
  const result = checkPackage(manifest, entries, false);
  return result.ok ? { ok: true, value: result.value.digest } : result;
}
export function inspectPackage(manifest: unknown, entries: readonly ContentEntry[]): ContractResult<PackageSnapshot> {
  const result = checkPackage(manifest, entries, true);
  return result.ok ? { ok: true, value: result.value.snapshot } : result;
}
