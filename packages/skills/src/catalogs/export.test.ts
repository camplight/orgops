import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { CATALOG_LIMITS, parsePackageManifest, parseCatalogIndex, type PackageMetadata } from "@orgops/schemas";
import { exportAgentPackage, exportSkillPackage, type AgentExportOptions } from "./export";
import { inspectPackage as publicInspect, resolvePackages as publicResolve, exportAgentPackage as publicExport } from "../index";
import { must, expectCode, classicManifest, rlmManifest, wrappedManifest, skillManifest, skillEntries, fixtureDigests } from "./fixtures";
import type { ContentEntry } from "./content";

function metadata(m: PackageMetadata = classicManifest): PackageMetadata {
  return { formatVersion: m.formatVersion, name: m.name, version: m.version, description: m.description,
    author: m.author, license: m.license, compatibility: structuredClone(m.compatibility), secrets: structuredClone(m.secrets) };
}
const opts = () => ({ metadata: metadata(), dependencies: [] });
const rawNative = () => ({ mode: "CLASSIC", systemInstructions: "Echo.", enabledSkills: [] });
const rawWrapped = () => ({ mode: "WRAPPED", wrappedConfig: { runtime: { command: "printf ok" } } });
const skillOpts = () => ({ metadata: metadata(skillManifest), dependencies: [], executables: structuredClone(skillManifest.executables), selectedPaths: ["SKILL.md", "event-shapes.ts"] });
const file = (path: string, text = "notes"): ContentEntry => ({ type: "file", path, base64: Buffer.from(text).toString("base64"), executable: false });
function expectCollisionFreeProposedFiles(files: readonly { path: string }[]): void {
  const paths = files.map(file => file.path.toLowerCase());
  expect(paths.filter(path => path === "orgops-package.json")).toHaveLength(1);
  expect(new Set(paths).size).toBe(paths.length);
  for (const path of paths) {
    expect(paths.some(other => other !== path && path.startsWith(`${other}/`))).toBe(false);
  }
}
function frozen(value: unknown): void {
  if (value && typeof value === "object") { expect(Object.isFrozen(value)).toBe(true); Object.values(value).forEach(frozen); }
}

it("rejects compact-valid manifests whose final pretty UTF-8 bytes exceed the parser limit", () => {
  const raw = { ...rawNative(), systemInstructions: "中".repeat(65536), soulContents: "" };
  const initial = must(exportAgentPackage(raw, opts()));
  const compactBytes = Buffer.byteLength(JSON.stringify(initial.snapshot.manifest), "utf8");
  raw.soulContents = "x".repeat(CATALOG_LIMITS.manifestJsonBytes - compactBytes);
  if (initial.snapshot.manifest.kind !== "native-agent") throw new Error("wrong kind");
  const compact = JSON.stringify({ ...initial.snapshot.manifest, native: {
    ...initial.snapshot.manifest.native,
    soulContents: raw.soulContents,
  } });
  expect(Buffer.byteLength(compact, "utf8")).toBe(CATALOG_LIMITS.manifestJsonBytes);
  must(parsePackageManifest(compact));
  expectCode(exportAgentPackage(raw, opts()), "LIMIT_EXCEEDED");
});
it.each([-1, 0, 1])("enforces the final serialized manifest byte boundary at offset %i", offset => {
  const raw = { ...rawNative(), systemInstructions: "中".repeat(65536), soulContents: "" };
  const initial = must(exportAgentPackage(raw, opts()));
  const initialBytes = Buffer.from(initial.proposedFiles[0]!.base64, "base64").length;
  raw.soulContents = "x".repeat(CATALOG_LIMITS.manifestJsonBytes - initialBytes + offset);
  const result = exportAgentPackage(raw, opts());
  if (offset > 0) { expectCode(result, "LIMIT_EXCEEDED"); return; }
  const candidate = must(result);
  const bytes = Buffer.from(candidate.proposedFiles[0]!.base64, "base64");
  expect(bytes.length).toBe(CATALOG_LIMITS.manifestJsonBytes + offset);
  expect(must(parsePackageManifest(bytes.toString("utf8")))).toEqual(candidate.snapshot.manifest);
});
it.each(["CLASSIC", "RLM_REPL", "WRAPPED", "skill"])("round trips actual proposed manifest bytes for %s", mode => {
  const candidate = must(mode === "skill" ? exportSkillPackage(skillEntries, skillOpts())
    : exportAgentPackage(mode === "WRAPPED" ? rawWrapped() : { ...rawNative(), mode }, opts()));
  expectCollisionFreeProposedFiles(candidate.proposedFiles);
  const text = Buffer.from(candidate.proposedFiles.find(f => f.path === "orgops-package.json")!.base64, "base64").toString("utf8");
  expect(text).toBe(`${JSON.stringify(JSON.parse(text), null, 2)}\n`);
  expect(must(parsePackageManifest(text))).toEqual(candidate.snapshot.manifest);
});

it("positively selects native content, never row bindings or live state", () => {
  const result = must(exportAgentPackage({ mode: "CLASSIC", systemInstructions: "Share this prompt.", soulContents: "Share this soul.",
    enabledSkills: ["echo-skill"], alwaysPreloadedSkills: ["echo-skill"], modelId: "DO_NOT_EXPORT_MODEL", assignedRunnerId: "DO_NOT_EXPORT_RUNNER",
    workspacePath: "/DO_NOT_EXPORT_WORKSPACE", soulPath: "/DO_NOT_EXPORT_SOUL", desiredState: "RUNNING", memory: "DO_NOT_EXPORT_MEMORY",
    secrets: { token: "DO_NOT_EXPORT_SECRET" }, unknownFutureState: "DO_NOT_EXPORT_STATE", allowOutsideWorkspace: true,
    description: "DO_NOT_EXPORT_DESCRIPTION", name: "DO_NOT_EXPORT_NAME", model: { defaults: { temperature: 1 } },
  }, { metadata: metadata(), dependencies: classicManifest.dependencies }));
  const text = Buffer.from(result.proposedFiles[0]!.base64, "base64").toString();
  expect(text).not.toContain("DO_NOT_EXPORT"); expect(text).not.toContain("allowOutsideWorkspace");
  expect(result.snapshot.manifest).toMatchObject({ name: "echo-agent", native: { systemInstructions: "Share this prompt.", soulContents: "Share this soul." } });
  expect(result.snapshot.manifest).not.toHaveProperty("native.suggestedModel");
});
it.each([classicManifest, rlmManifest])("round trips native $native.mode portable fields and explicit model suggestions", m => {
  const n = m.native;
  const result = must(exportAgentPackage({ mode: n.mode, systemInstructions: n.systemInstructions,
    ...(n.soulContents === undefined ? {} : { soulContents: n.soulContents }), ...n.runtime,
    enabledSkills: ["echo-skill"], alwaysPreloadedSkills: n.alwaysPreloadedSkills,
  }, { metadata: metadata(m), dependencies: m.dependencies, ...(n.suggestedModel ? { suggestedModel: n.suggestedModel } : {}) }));
  expect(result.snapshot.manifest.digest).toBe(m.digest);
  expect(must(publicInspect(result.snapshot.manifest, result.snapshot.files.map(f => ({ type: "file", path: f.path, base64: f.base64, executable: f.executable }))))).toEqual(result.snapshot);
});
it.each([8, null, "bad", { dormant: true }])("omits dormant classic tuning for RLM without mutation: %j", classicMaxModelSteps => {
  const raw = { mode: "RLM_REPL", systemInstructions: "Return done(1).", enabledSkills: [], classicMaxModelSteps };
  const before = structuredClone(raw);
  const candidate = must(exportAgentPackage(raw, opts()));
  expect(candidate.snapshot.manifest).not.toHaveProperty("native.runtime.classicMaxModelSteps"); expect(raw).toEqual(before);
});
it("omits null native tuning but preserves false and missing preloads", () => {
  const candidate = must(exportAgentPackage({ ...rawNative(), llmCallTimeoutMs: null, classicMaxModelSteps: null,
    contextSessionGapMs: null, memoryContextMode: null, emitAuditEvents: false }, opts()));
  expect(candidate.snapshot.manifest).toMatchObject({ native: { runtime: { emitAuditEvents: false }, alwaysPreloadedSkills: [] } });
  if (candidate.snapshot.manifest.kind !== "native-agent") throw new Error("kind");
  expect(candidate.snapshot.manifest.native.runtime).toEqual({ emitAuditEvents: false });
});
it.each([
  {}, { mode: "classic", systemInstructions: "ok" }, { mode: "CLASSIC", system_instructions: "ok" },
  { ...rawNative(), system_instructions: "ambiguous" }, { ...rawNative(), enabled_skills_json: "[]" },
  { ...rawNative(), systemInstructions: null }, { ...rawNative(), soulContents: null },
  { ...rawNative(), llmCallTimeoutMs: "60" }, { ...rawNative(), emitAuditEvents: 0 },
  { ...rawNative(), alwaysPreloadedSkills: null }, { ...rawNative(), enabledSkills: "echo-skill" },
  { ...rawNative(), enabledSkills: ["echo-skill", "echo-skill"] }, { ...rawNative(), enabledSkills: ["echo-skill"] },
  { ...rawNative(), alwaysPreloadedSkills: ["echo-skill"] }, { ...rawNative(), memoryContextMode: "UNKNOWN" },
])("rejects malformed native selection or ambiguous DB spelling %j", raw => expectCode(exportAgentPackage(raw, opts()), "UNSUPPORTED_EXPORT"));
it("requires one-to-one enabled names and dependency pins", () => {
  expectCode(exportAgentPackage(rawNative(), { metadata: metadata(), dependencies: classicManifest.dependencies }), "UNSUPPORTED_EXPORT");
  expectCode(exportAgentPackage({ ...rawNative(), enabledSkills: ["echo-skill"] }, { metadata: metadata(), dependencies: [classicManifest.dependencies[0]!, { ...classicManifest.dependencies[0]!, catalogId: "other" }] }), "UNSUPPORTED_EXPORT");
});
it.each([
  { ...opts(), surprise: true }, { ...opts(), suggestedModel: {} }, { ...opts(), suggestedModel: { modelId: "local" } },
  { ...opts(), metadata: { ...metadata(), secrets: [{ name: "TOKEN", description: "Need token", required: true, value: "DO_NOT_EXPORT" }] } },
])("strictly rejects invalid export options %j", options => expectCode(exportAgentPackage(rawNative(), options as unknown as AgentExportOptions), "UNSUPPORTED_EXPORT"));

it("normalizes only equivalent wrapped defaults, ignores unused native fields", () => {
  const result = must(exportAgentPackage({ ...rawWrapped(), soulContents: "DO_NOT_EXPORT_SOUL", systemInstructions: "DO_NOT_EXPORT_PROMPT", llmCallTimeoutMs: "ignored" }, opts()));
  expect(result.snapshot.manifest).toMatchObject({ wrapped: { kind: "custom", harness: "command", sidecars: [], session: { scope: "per-channel" }, resourceWiring: "none", runtime: { command: "printf ok" } } });
  expect(JSON.stringify(result)).not.toContain("DO_NOT_EXPORT");
  expect(result.snapshot.warnings).toContainEqual({ code: "EXTERNAL_RUNTIME_NOT_PINNED", at: "wrapped" });
});
it("preserves wrapped setup/check/sidecar/turn args and source hint without execution", () => {
  const w = wrappedManifest.wrapped;
  const raw = { mode: "WRAPPED", wrappedConfig: { kind: w.kind, harness: "cli", setup: { ...w.setup, args: ["setup-arg"] },
    sidecars: [{ ...w.sidecars[0], checkCommand: "check helper", args: ["sidecar-arg"] }], runtime: w.runtime,
    source: { type: "github", repo: "example/runtime", ref: "v1" }, session: {} } };
  const before = structuredClone(raw); const candidate = must(exportAgentPackage(raw, opts()));
  expect(candidate.snapshot.execution.wrappedCommands).toEqual([
    { at: "wrapped.setup.command", command: "printf setup", args: ["setup-arg"] },
    { at: "wrapped.setup.checkCommand", command: "test -f ready", args: ["setup-arg"] },
    { at: "wrapped.sidecars.0.command", command: "node -e 'setInterval(() => {}, 1000)'", args: ["sidecar-arg"] },
    { at: "wrapped.sidecars.0.checkCommand", command: "check helper", args: ["sidecar-arg"] },
    { at: "wrapped.runtime.command", command: "printf", args: ["acknowledged"] },
  ]);
  expect(candidate.snapshot.execution.externalSources).toEqual([{ type: "github", repo: "example/runtime", ref: "v1" }]);
  expect(raw).toEqual(before); frozen(candidate);
});
it.each([
  { runtime: { command: "ok", env: { TOKEN: "DO_NOT_EXPORT" } } },
  { runtime: { command: "ok", cwd: "/host" } }, { runtime: { command: "ok", cwd: "../host" } },
  { runtime: { command: "ok", cwd: ".orgops-data-private" } }, { runtime: { command: 5 } },
  { runtime: { command: "ok", args: "bad" } }, { runtime: { command: "ok", timeoutMs: 0 } },
  { runtime: { command: "ok" }, transport: "command" }, { runtime: { command: "ok" }, harness: "sdk" },
  { runtime: { command: "ok" }, source: { type: "github", repo: "https://example/repo" } },
  { runtime: { command: "ok" }, source: { type: "github", repo: "owner/repo", path: "local" } },
  { runtime: { command: "ok" }, source: { type: "github", repo: "owner/repo", updateOnStart: true } },
  { runtime: { command: "ok" }, setup: { checkCommand: "check" } },
  { runtime: { command: "ok" }, sidecars: null }, { runtime: { command: "ok" }, session: null },
  { runtime: { command: "ok" }, sidecars: [{ name: "side", command: "ok", env: {} }] },
  "{\"runtime\":{\"command\":\"ok\"}}",
])("rejects wrapped semantics that cannot be exported without loss %j", wrappedConfig => expectCode(exportAgentPackage({ mode: "WRAPPED", wrappedConfig }, opts()), "UNSUPPORTED_EXPORT"));
it.each([
  { ...rawWrapped(), enabledSkills: ["echo-skill"] }, { ...rawWrapped(), alwaysPreloadedSkills: ["echo-skill"] },
  { mode: "WRAPPED", wrappedConfig: { runtime: { command: "ok" }, resourceWiring: "native" } },
  { mode: "WRAPPED", wrappedConfig: { runtime: { command: "ok" }, systemInstructions: "inject" } },
])("rejects unsupported wrapped wiring %j", raw => expectCode(exportAgentPackage(raw, opts()), "UNSUPPORTED_WIRING"));
it("rejects wrapped dependencies and model suggestions", () => {
  expectCode(exportAgentPackage(rawWrapped(), { ...opts(), dependencies: classicManifest.dependencies }), "UNSUPPORTED_WIRING");
  expectCode(exportAgentPackage(rawWrapped(), { ...opts(), suggestedModel: { modelName: "example" } }), "UNSUPPORTED_WIRING");
});

it("packages exactly selected skill bytes using real inventory and oracle digest", () => {
  const result = must(exportSkillPackage([...skillEntries, file("notes.txt", "DO_NOT_EXPORT")], skillOpts()));
  expect(result.proposedFiles.map(f => f.path)).toEqual(["SKILL.md", "event-shapes.ts", "orgops-package.json"]);
  expect(result.snapshot.manifest.digest).toBe(fixtureDigests.skill); expect(JSON.stringify(result)).not.toContain("DO_NOT_EXPORT");
  expect(result.snapshot.execution.apiEventShapes).toEqual(["event-shapes.ts"]);
  const serialized = Buffer.from(result.proposedFiles[2]!.base64, "base64").toString();
  expect(serialized.endsWith("\n")).toBe(true); expect(serialized).toContain('\n  "author":');
  expect(must(parsePackageManifest(serialized))).toEqual(result.snapshot.manifest);
  frozen(result);
});
it.each(["orgops-package.json/notes.txt", "ORGOPS-PACKAGE.JSON/notes.txt"])("rejects reserved manifest ancestors in selected and unselected staging: %s", path => {
  const entries = [...skillEntries, file(path)];
  expectCode(exportSkillPackage(entries, { ...skillOpts(), selectedPaths: [...skillOpts().selectedPaths, path] }), "UNSAFE_PATH");
  expectCode(exportSkillPackage(entries, skillOpts()), "UNSAFE_PATH");
});
it.each(["orgops-package.json/notes.txt", "ORGOPS-PACKAGE.JSON/notes.txt"])("rejects reserved manifest ancestors in selection even when unstaged: %s", path => {
  expectCode(exportSkillPackage(skillEntries, { ...skillOpts(), selectedPaths: [...skillOpts().selectedPaths, path] }), "UNSAFE_PATH");
});
it.each(["assets/orgops-package.json", "assets/ORGOPS-PACKAGE.JSON", "orgops-package.json-assets/notes.txt"])("exports nonreserved content with collision-free complete proposed paths: %s", path => {
  const candidate = must(exportSkillPackage([...skillEntries, file(path)], { ...skillOpts(), selectedPaths: [...skillOpts().selectedPaths, path] }));
  expect(candidate.proposedFiles.find(entry => entry.path === path)?.base64).toBe(Buffer.from("notes").toString("base64"));
  expectCollisionFreeProposedFiles(candidate.proposedFiles);
});
it.each([[], ["SKILL.md", "SKILL.md"], ["../SKILL.md"], ["missing.txt"], ["event-shapes.ts"], ["orgops-package.json"]].map(selectedPaths => ({ selectedPaths })))("rejects incomplete/unsafe selections $selectedPaths", ({ selectedPaths }) => {
  expect(exportSkillPackage(skillEntries, { ...skillOpts(), selectedPaths }).ok).toBe(false);
});
it.each([".env", "sub/.ENV.local", ".agent-runner-id", ".orgops-runner-id", ".npmrc", ".netrc", "id_rsa", "id_ed25519", "credentials.json", "sub/.SSH/key", ".aws/key", ".config/key"]) ("rejects selected credential/state path %s", path => {
  expectCode(exportSkillPackage([...skillEntries, file(path)], { ...skillOpts(), selectedPaths: [...skillOpts().selectedPaths, path] }), "UNSUPPORTED_EXPORT");
});
it.each<ContentEntry>([
  { type: "symlink", path: "unused", target: "SKILL.md" }, { type: "hardlink", path: "unused", target: "SKILL.md" },
  { type: "special", path: "unused", specialType: "directory" }, file("../unused"), file("SKILL.MD"), file("SKILL.md/child"),
  { type: "file", path: "unused", base64: "Zh==", executable: false },
])("validates unselected entries before selection %j", entry => expect(exportSkillPackage([...skillEntries, entry], skillOpts()).ok).toBe(false));
it("rejects unselected executable declaration and mismatched skill frontmatter", () => {
  expectCode(exportSkillPackage(skillEntries, { ...skillOpts(), selectedPaths: ["SKILL.md"] }), "INVALID_MANIFEST");
  expectCode(exportSkillPackage([file("SKILL.md", "---\nname: wrong\ndescription: Echo instructions.\n---\n")], { ...skillOpts(), executables: [], selectedPaths: ["SKILL.md"] }), "INVALID_SKILL");
});
it("preserves binary bytes, warns for authored secrets without echoing matches", () => {
  const binary: ContentEntry = { type: "file", path: "data.bin", base64: "/wAB", executable: false };
  const candidate = must(exportSkillPackage([...skillEntries, binary], { ...skillOpts(), selectedPaths: [...skillOpts().selectedPaths, "data.bin"] }));
  expect(candidate.proposedFiles.find(f => f.path === "data.bin")?.base64).toBe("/wAB");
  expect(candidate.snapshot.warnings).toContainEqual({ code: "MANUAL_REVIEW_REQUIRED", at: "$" });
  const native = must(exportAgentPackage({ ...rawNative(), systemInstructions: "token=synthetic-warning-example" }, opts()));
  expect(native.snapshot.warnings).toContainEqual({ code: "SENSITIVE_TEXT", at: "native.systemInstructions" });
  expect(JSON.stringify(native.snapshot.warnings)).not.toContain("synthetic-warning-example");
});
it("detaches outputs from all inputs", () => {
  const options = opts(); const raw = { ...rawNative(), alwaysPreloadedSkills: [] };
  const result = must(exportAgentPackage(raw, options)); options.metadata.compatibility.tools.push("other"); raw.systemInstructions = "changed";
  expect(result.snapshot.manifest.compatibility.tools).toEqual(["node"]); expect(result.snapshot.manifest).toMatchObject({ native: { systemInstructions: "Echo." } }); frozen(result);
});
it("rejects accessors in either argument without executing them", () => {
  let calls = 0; const bad = Object.defineProperty({}, "mode", { enumerable: true, get() { calls++; throw new Error("DO_NOT_EXPORT"); } });
  expectCode(exportAgentPackage(bad, opts()), "INVALID_JSON");
  expectCode(exportAgentPackage(rawNative(), bad as ReturnType<typeof opts>), "INVALID_JSON");
  expectCode(exportSkillPackage([bad] as ContentEntry[], skillOpts()), "INVALID_JSON"); expect(calls).toBe(0);
});
it("bounds raw/options JSON and entire unselected content", () => {
  expectCode(exportAgentPackage({ ...rawNative(), ignored: "x".repeat(262144) }, opts()), "LIMIT_EXCEEDED");
  expectCode(exportAgentPackage(rawNative(), { ...opts(), metadata: { ...metadata(), description: "x".repeat(262144) } }), "LIMIT_EXCEEDED");
  expectCode(exportSkillPackage([...skillEntries, file("unused", "x".repeat(1048577))], skillOpts()), "LIMIT_EXCEEDED");
  expectCode(exportSkillPackage(Array.from({ length: 257 }, (_, i) => file(`file-${i}`)), skillOpts()), "LIMIT_EXCEEDED");
});
it.each(["skill", "native-classic", "native-rlm", "wrapped"]) ("inspects checked-in %s documentation bytes against independent oracle", name => {
  const manifest = must(parsePackageManifest(readFileSync(new URL(`../../../../docs/examples/catalogs/${name}.json`, import.meta.url), "utf8")));
  const snapshot = must(publicInspect(manifest, name === "skill" ? skillEntries : []));
  expect(snapshot.manifest.digest).toBe(fixtureDigests[name === "native-classic" ? "classic" : name === "native-rlm" ? "rlm" : name as "skill" | "wrapped"]);
});
it("exposes inert public APIs and resolves sealed native plus skill with literal identities", () => {
  expect(publicInspect).toBeTypeOf("function"); expect(publicResolve).toBeTypeOf("function"); expect(publicExport).toBeTypeOf("function");
  const skill = must(exportSkillPackage(skillEntries, skillOpts())).snapshot;
  const n = classicManifest.native;
  const agent = must(publicExport({ mode: n.mode, systemInstructions: n.systemInstructions, soulContents: n.soulContents, ...n.runtime,
    enabledSkills: ["echo-skill"], alwaysPreloadedSkills: n.alwaysPreloadedSkills }, { metadata: metadata(), dependencies: classicManifest.dependencies, suggestedModel: n.suggestedModel })).snapshot;
  const index = must(parseCatalogIndex(readFileSync(new URL("../../../../docs/examples/catalogs/index.json", import.meta.url), "utf8")));
  const commit = "1".repeat(40);
  const result = must(publicResolve({ roots: [{ catalogId: "team", name: "echo-agent", version: "1.0.0" }],
    catalogs: [{ catalogId: "team", sourceId: "team-source", commit, enabled: true, index }],
    packages: [{ sourceId: "team-source", commit, path: "packages/echo-skill", snapshot: skill }, { sourceId: "team-source", commit, path: "packages/echo-agent", snapshot: agent }],
    allowedSourceIds: ["team-source"], target: { orgopsVersion: "0.0.1", platform: "linux", tools: ["node"] }, installedSkills: [], knownReleases: [] }));
  expect(result.packages.map(p => [p.identity.name, p.identity.packageCommit, p.identity.catalogCommit, p.action])).toEqual([
    ["echo-skill", commit, commit, "include"], ["echo-agent", commit, commit, "include"],
  ]);
});

it("exports the complete wrapped fixture with its independent digest", () => {
  const w = wrappedManifest.wrapped;
  const result = must(exportAgentPackage({ mode: "WRAPPED", wrappedConfig: { kind: w.kind, harness: w.harness,
    setup: w.setup, sidecars: w.sidecars, runtime: w.runtime, session: w.session } }, { metadata: metadata(wrappedManifest), dependencies: [] }));
  expect(result.snapshot.manifest.digest).toBe(fixtureDigests.wrapped);
});
it("permits exact byte limits but rejects aggregate unselected decoded overflow", () => {
  const oneMiB = file("data.bin", "x".repeat(1048576));
  const result = must(exportSkillPackage([...skillEntries, oneMiB], { ...skillOpts(), selectedPaths: [...skillOpts().selectedPaths, "data.bin"] }));
  expect(result.snapshot.files.find(f => f.path === "data.bin")?.size).toBe(1048576);
  expectCode(exportSkillPackage([...skillEntries, ...Array.from({ length: 8 }, (_, i) => ({ ...oneMiB, path: `unused-${i}` }))], skillOpts()), "LIMIT_EXCEEDED");
});
it.each([null, [], 1, "options", { ...skillOpts(), selectedPaths: null }, { ...skillOpts(), unknown: true },
  { metadata: metadata(skillManifest), dependencies: [], executables: [] },
])("rejects invalid skill option envelopes %j", options => {
  expectCode(exportSkillPackage(skillEntries, options as unknown as ReturnType<typeof skillOpts>), "UNSUPPORTED_EXPORT");
});
it.each([null, 1, "entry", [], { type: "file", path: "unused", base64: "", executable: false, digest: "claim" }])("rejects invalid unselected entry envelopes %j", entry => {
  expectCode(exportSkillPackage([...skillEntries, entry] as ContentEntry[], skillOpts()), "UNSUPPORTED_ENTRY");
});
it.each([undefined, NaN, Infinity, 1n, new Date(), () => "DO_NOT_CALL"]) ("rejects non-JSON even in ignored state %s", ignored => {
  expectCode(exportAgentPackage({ ...rawNative(), ignored }, opts()), "INVALID_JSON");
});
it("rejects cyclic and too-deep input without attempting row selection", () => {
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  expectCode(exportAgentPackage(cyclic, opts()), "INVALID_JSON");
  let deep: unknown = "leaf";
  for (let i = 0; i < 34; i++) deep = { child: deep };
  expectCode(exportAgentPackage({ ...rawNative(), ignored: deep }, opts()), "LIMIT_EXCEEDED");
});
it("validates every argument as JSON before selecting any executable recipe fields", () => {
  let calls = 0;
  const options = Object.defineProperty({}, "metadata", { enumerable: true, get() { calls++; return metadata(); } });
  expectCode(exportAgentPackage({ mode: "WRAPPED", wrappedConfig: { runtime: { command: "DO_NOT_EXECUTE" } } }, options as AgentExportOptions), "INVALID_JSON");
  expectCode(exportSkillPackage(skillEntries, options as ReturnType<typeof skillOpts>), "INVALID_JSON");
  expect(calls).toBe(0);
});
it("full file previews retain sensitive selected text while warnings contain pointers only", () => {
  const entry = file("notes.txt", "password=synthetic-selected-text");
  const result = must(exportSkillPackage([...skillEntries, entry], { ...skillOpts(), selectedPaths: [...skillOpts().selectedPaths, entry.path] }));
  expect(result.snapshot.warnings).toContainEqual({ code: "SENSITIVE_TEXT", at: "notes.txt" });
  expect(JSON.stringify(result.snapshot.warnings)).not.toContain("synthetic-selected-text");
  expect(Buffer.from(result.proposedFiles.find(f => f.path === "notes.txt")!.base64, "base64").toString()).toBe("password=synthetic-selected-text");
});
