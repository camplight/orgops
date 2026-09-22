import { createHash } from "node:crypto";
import {
  CATALOG_LIMITS, validateCatalogJson, PackageMetadataSchema, DependencyPinSchema,
  ExecutableDeclarationSchema, NativeTemplateSchema, PortableWrappedRecipeSchema,
  PackageNameSchema, RelativePathSchema,
  type PackageMetadata, type DependencyPin, type ExecutableDeclaration, type NativeTemplate,
  type PackageManifest, type PortableWrappedRecipe, type ContractIssue, type ContractResult,
} from "@orgops/schemas";
import { computePackageDigest, inspectPackage, canonicalJson, normalizedManifest,
  type ContentEntry, type PackageSnapshot, type InspectedFile } from "./content";

export type AgentExportOptions = {
  metadata: PackageMetadata;
  dependencies: DependencyPin[];
  suggestedModel?: NativeTemplate["suggestedModel"];
};
export type SkillExportOptions = {
  metadata: PackageMetadata;
  dependencies: DependencyPin[];
  executables: ExecutableDeclaration[];
  selectedPaths: string[];
};
export type ExportCandidate = {
  snapshot: PackageSnapshot;
  proposedFiles: readonly { path: string; base64: string; executable: boolean }[];
};
const failure = (code: ContractIssue["code"] = "UNSUPPORTED_EXPORT", at = "$"): ContractResult<never> => ({ ok: false, issues: [{ code, at }] });
const zeroDigest = `sha256:${"0".repeat(64)}`;
type RecordData = Record<string, unknown>;
const record = (value: unknown): value is RecordData => value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value: RecordData, allowed: readonly string[]): boolean => Object.keys(value).every(key => allowed.includes(key));
const names = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 64
  && value.every(name => PackageNameSchema.safeParse(name).success) && new Set(value).size === value.length;
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function baseOptions(options: unknown, allowed: string[]): ContractResult<{ metadata: PackageMetadata; dependencies: DependencyPin[] }> {
  if (!record(options) || !keys(options, allowed)) return failure();
  const metadata = PackageMetadataSchema.safeParse(options.metadata);
  const dependencies = DependencyPinSchema.array().max(CATALOG_LIMITS.dependencies).safeParse(options.dependencies);
  if (!metadata.success || !dependencies.success) return failure();
  const identities = dependencies.data.map(pin => JSON.stringify([pin.catalogId, pin.sourceId, pin.name]));
  if (new Set(identities).size !== identities.length) return failure();
  return { ok: true, value: { metadata: metadata.data, dependencies: dependencies.data } };
}
function candidate(manifest: PackageManifest, entries: readonly ContentEntry[]): ContractResult<ExportCandidate> {
  const digest = computePackageDigest(manifest, entries);
  if (!digest.ok) return digest;
  const inspected = inspectPackage({ ...manifest, digest: digest.value }, entries);
  if (!inspected.ok) return inspected;
  const snapshot = inspected.value;
  const serialized = `${JSON.stringify(JSON.parse(canonicalJson(normalizedManifest(snapshot.manifest))), null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > CATALOG_LIMITS.manifestJsonBytes) return failure("LIMIT_EXCEEDED");
  const proposedFiles = snapshot.files.map(file => ({ path: file.path, base64: file.base64, executable: file.executable }));
  proposedFiles.push({ path: "orgops-package.json", base64: Buffer.from(serialized, "utf8").toString("base64"), executable: false });
  if (collision(proposedFiles.map(file => file.path))) return failure("DUPLICATE_PATH", "proposedFiles");
  proposedFiles.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { ok: true, value: freeze({ snapshot, proposedFiles }) };
}

// Reject DB spellings even alongside camelCase; unrelated future API state is ignored.
const dbSpellings = ["system_instructions", "soul_contents", "soul_path", "workspace_path", "model_id", "assigned_runner_id",
  "enabled_skills", "enabled_skills_json", "always_preloaded_skills", "always_preloaded_skills_json", "wrapped_config", "wrapped_config_json",
  "llm_call_timeout_ms", "classic_max_model_steps", "context_session_gap_ms", "emit_audit_events", "memory_context_mode",
  "allow_outside_workspace", "desired_state", "runtime_state", "last_heartbeat_at"];

// These selectors receive JSON-validated data, reject unknown recipe semantics, and
// reconstruct every supported field rather than passing raw configuration through.
function command(value: unknown, extra: readonly string[]): RecordData | undefined {
  if (!record(value) || !keys(value, ["command", "args", "cwd", "timeoutMs", ...extra])) return undefined;
  const out: RecordData = {};
  if ("command" in value) out.command = value.command;
  if ("args" in value) out.args = value.args;
  if ("cwd" in value) out.cwd = value.cwd;
  if ("timeoutMs" in value) out.timeoutMs = value.timeoutMs;
  if (extra.includes("checkCommand") && "checkCommand" in value) out.checkCommand = value.checkCommand;
  if (extra.includes("name") && "name" in value) out.name = value.name;
  if (extra.includes("restart") && "restart" in value) out.restart = value.restart;
  if (extra.includes("restartDelayMs") && "restartDelayMs" in value) out.restartDelayMs = value.restartDelayMs;
  if (extra.includes("parse") && "parse" in value) out.parse = value.parse;
  return out;
}
function wrappedRecipe(value: unknown): ContractResult<PortableWrappedRecipe> {
  if (!record(value)) return failure();
  if (["resourceWiring", "enabledSkills", "alwaysPreloadedSkills", "systemInstructions", "soulContents", "files", "dependencies", "executables"].some(key => key in value)) return failure("UNSUPPORTED_WIRING", "wrapped");
  if (!keys(value, ["kind", "harness", "source", "setup", "sidecars", "runtime", "session"])) return failure();
  const runtime = command(value.runtime, ["parse"]);
  if (!runtime) return failure();
  const out: RecordData = {
    kind: "kind" in value ? value.kind : "custom",
    harness: !("harness" in value) || value.harness === "cli" ? "command" : value.harness,
    runtime, sidecars: [], session: { scope: "per-channel" }, resourceWiring: "none",
  };
  if ("source" in value) {
    const source = value.source;
    if (!record(source) || !keys(source, ["type", "repo", "ref", "updateOnStart"])) return failure();
    const selected: RecordData = { updateOnStart: "updateOnStart" in source ? source.updateOnStart : false };
    if ("type" in source) selected.type = source.type;
    if ("repo" in source) selected.repo = source.repo;
    if ("ref" in source) selected.ref = source.ref;
    out.source = selected;
  }
  if ("setup" in value) {
    const setup = command(value.setup, ["checkCommand"]);
    if (!setup) return failure();
    out.setup = setup;
  }
  if ("sidecars" in value) {
    if (!Array.isArray(value.sidecars) || value.sidecars.length > 16) return failure();
    const sidecars = [];
    for (const item of value.sidecars) {
      const sidecar = command(item, ["name", "checkCommand", "restart", "restartDelayMs"]);
      if (!sidecar) return failure();
      sidecars.push(sidecar);
    }
    out.sidecars = sidecars;
  }
  if ("session" in value) {
    if (!record(value.session) || !keys(value.session, ["scope"])) return failure();
    out.session = { scope: "scope" in value.session ? value.session.scope : "per-channel" };
  }
  const parsed = PortableWrappedRecipeSchema.safeParse(out);
  return parsed.success ? { ok: true, value: parsed.data } : failure();
}

export function exportAgentPackage(raw: unknown, options: AgentExportOptions): ContractResult<ExportCandidate> {
  const rawJson = validateCatalogJson(raw, CATALOG_LIMITS.manifestJsonBytes);
  if (!rawJson.ok) return rawJson;
  const optionsJson = validateCatalogJson(options, CATALOG_LIMITS.exportOptionsJsonBytes);
  if (!optionsJson.ok) return optionsJson;
  const base = baseOptions(options, ["metadata", "dependencies", "suggestedModel"]);
  if (!base.ok) return base;
  if (!record(raw) || dbSpellings.some(key => key in raw)) return failure();
  const { metadata, dependencies } = base.value;
  if (raw.mode === "WRAPPED") {
    if (dependencies.length || "suggestedModel" in options
      || [raw.enabledSkills, raw.alwaysPreloadedSkills].some(value => Array.isArray(value) && value.length > 0)) return failure("UNSUPPORTED_WIRING", "wrapped");
    if (("enabledSkills" in raw && !names(raw.enabledSkills)) || ("alwaysPreloadedSkills" in raw && !names(raw.alwaysPreloadedSkills))) return failure();
    const wrapped = wrappedRecipe(raw.wrappedConfig);
    if (!wrapped.ok) return wrapped;
    return candidate({ ...metadata, dependencies, files: [], executables: [], digest: zeroDigest, kind: "wrapped-agent", wrapped: wrapped.value }, []);
  }
  if (raw.mode !== "CLASSIC" && raw.mode !== "RLM_REPL") return failure();
  const enabled = "enabledSkills" in raw ? raw.enabledSkills : [];
  if (!names(enabled) || dependencies.length !== enabled.length
    || enabled.some(name => dependencies.filter(pin => pin.name === name).length !== 1)) return failure();
  const runtime: RecordData = {};
  if (raw.llmCallTimeoutMs != null) runtime.llmCallTimeoutMs = raw.llmCallTimeoutMs;
  if (raw.mode === "CLASSIC" && raw.classicMaxModelSteps != null) runtime.classicMaxModelSteps = raw.classicMaxModelSteps;
  if (raw.contextSessionGapMs != null) runtime.contextSessionGapMs = raw.contextSessionGapMs;
  if (raw.emitAuditEvents != null) runtime.emitAuditEvents = raw.emitAuditEvents;
  if (raw.memoryContextMode != null) runtime.memoryContextMode = raw.memoryContextMode;
  const selected: RecordData = { mode: raw.mode, runtime, alwaysPreloadedSkills: "alwaysPreloadedSkills" in raw ? raw.alwaysPreloadedSkills : [] };
  if ("systemInstructions" in raw) selected.systemInstructions = raw.systemInstructions;
  if ("soulContents" in raw) selected.soulContents = raw.soulContents;
  if ("suggestedModel" in options) selected.suggestedModel = options.suggestedModel;
  const native = NativeTemplateSchema.safeParse(selected);
  if (!native.success || native.data.alwaysPreloadedSkills.some(name => !enabled.includes(name))) return failure();
  return candidate({ ...metadata, dependencies, files: [], executables: [], digest: zeroDigest, kind: "native-agent", native: native.data }, []);
}

function safePath(value: unknown): value is string {
  return RelativePathSchema.safeParse(value).success && typeof value === "string" && value.split("/")[0]!.toLowerCase() !== "orgops-package.json";
}
function collision(paths: readonly string[]): boolean {
  const folded = new Set(paths.map(path => path.toLowerCase()));
  if (folded.size !== paths.length) return true;
  for (const path of folded) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) if (folded.has(parts.slice(0, i).join("/"))) return true;
  }
  return false;
}
function localState(path: string): boolean {
  const segments = path.toLowerCase().split("/");
  const basename = segments[segments.length - 1]!;
  return basename === ".env" || basename.startsWith(".env.")
    || [".agent-runner-id", ".orgops-runner-id", ".npmrc", ".netrc", "id_rsa", "id_ed25519", "credentials.json"].includes(basename)
    || segments.some(segment => [".ssh", ".aws", ".config"].includes(segment));
}
// Validate the entire staging collection, not just the selected subset. No filesystem
// kinds or caller inventory claims are inferred from a path or supplied digest.
function stagedFiles(entries: readonly ContentEntry[]): ContractResult<InspectedFile[]> {
  if (!Array.isArray(entries)) return failure("UNSUPPORTED_ENTRY", "entries");
  if (entries.length > CATALOG_LIMITS.contentEntries) return failure("LIMIT_EXCEEDED", "entries");
  let total = 0;
  for (const entry of entries as readonly unknown[]) {
    if (!record(entry) || entry.type !== "file" || !keys(entry, ["type", "path", "base64", "executable"])
      || typeof entry.base64 !== "string" || typeof entry.executable !== "boolean") return failure("UNSUPPORTED_ENTRY", "entries");
    if (!safePath(entry.path)) return failure("UNSAFE_PATH", "entries.path");
    const size = Math.floor(entry.base64.length / 4) * 3 - (entry.base64.endsWith("==") ? 2 : entry.base64.endsWith("=") ? 1 : 0);
    if (entry.base64.length > Math.ceil(CATALOG_LIMITS.fileBytes / 3) * 4 || size > CATALOG_LIMITS.fileBytes) return failure("LIMIT_EXCEEDED", "entries");
    total += Math.max(0, size);
    if (total > CATALOG_LIMITS.totalContentBytes) return failure("LIMIT_EXCEEDED", "entries");
  }
  if (collision(entries.map(entry => entry.path))) return failure("DUPLICATE_PATH", "entries.path");
  const files: InspectedFile[] = [];
  for (const entry of entries) {
    if (entry.type !== "file") return failure("UNSUPPORTED_ENTRY", "entries");
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.base64)) return failure("UNSUPPORTED_ENTRY", "entries.base64");
    const bytes = Buffer.from(entry.base64, "base64");
    if (bytes.toString("base64") !== entry.base64) return failure("UNSUPPORTED_ENTRY", "entries.base64");
    files.push({ path: entry.path, base64: entry.base64, executable: entry.executable, size: bytes.length,
      digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}` });
  }
  return { ok: true, value: files };
}
export function exportSkillPackage(entries: readonly ContentEntry[], options: SkillExportOptions): ContractResult<ExportCandidate> {
  const contentJson = validateCatalogJson(entries, CATALOG_LIMITS.contentJsonBytes);
  if (!contentJson.ok) return contentJson;
  const optionsJson = validateCatalogJson(options, CATALOG_LIMITS.exportOptionsJsonBytes);
  if (!optionsJson.ok) return optionsJson;
  const staged = stagedFiles(entries);
  if (!staged.ok) return staged;
  const base = baseOptions(options, ["metadata", "dependencies", "executables", "selectedPaths"]);
  if (!base.ok) return base;
  const declarations = ExecutableDeclarationSchema.array().max(CATALOG_LIMITS.contentEntries).safeParse(options.executables);
  if (!declarations.success) return failure();
  const selected = options.selectedPaths;
  if (!Array.isArray(selected) || !selected.length || selected.length > CATALOG_LIMITS.contentEntries) return failure();
  if (!selected.every(safePath)) return failure("UNSAFE_PATH", "selectedPaths");
  if (collision(selected)) return failure("DUPLICATE_PATH", "selectedPaths");
  if (!selected.includes("SKILL.md") || selected.some(localState)) return failure();
  const files = staged.value.filter(file => selected.includes(file.path));
  if (files.length !== selected.length) return failure();
  const { metadata, dependencies } = base.value;
  return candidate({ ...metadata, dependencies, executables: declarations.data, digest: zeroDigest, kind: "skill", skill: { entrypoint: "SKILL.md" },
    files: files.map(file => ({ path: file.path, size: file.size, digest: file.digest, executable: file.executable })),
  }, files.map(file => ({ type: "file", path: file.path, base64: file.base64, executable: file.executable })));
}
