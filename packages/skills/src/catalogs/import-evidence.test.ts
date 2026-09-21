import { expect, it } from "vitest";
import { validateImportInput } from "./import-evidence";
import { importInput, measuredSkill } from "./import-fixtures";
it("derives current digest from independently supplied local files", () => {
  const input = importInput(); input.installed.entries = [measuredSkill()];
  const before = structuredClone(input), r = validateImportInput(input);
  expect(r.ok).toBe(true); if (!r.ok) throw new Error("Synthetic evidence rejected");
  expect(r.value.installedSkills[0]!.currentDigest).toBe(input.packages[0]!.snapshot.manifest.digest);
  expect(r.value.blockedNames).toEqual([]);
  expect(input).toEqual(before); expect(Object.isFrozen(input)).toBe(false);
  expect(Object.isFrozen(r.value.input.installed.entries)).toBe(true);
});
it("does not turn edited local bytes into the requested digest", () => {
  const input = importInput(), local = measuredSkill();
  if (local.state !== "measured") throw new Error("Synthetic fixture kind");
  const file = local.content.entries.find(e => e.path === "SKILL.md");
  if (!file || file.type !== "file") throw new Error("Synthetic fixture file");
  file.base64 = Buffer.from("---\nname: echo-skill\ndescription: Echo instructions.\nlicense: MIT\n---\nLOCAL EDIT\n").toString("base64");
  input.installed.entries = [local];
  const result = validateImportInput(input);
  expect(result.ok).toBe(true); if (!result.ok) throw new Error("Synthetic envelope rejected");
  expect(result.value.installedSkills).toEqual([]);
  expect(result.value.blockedNames).toEqual(["echo-skill"]);
  const expected = structuredClone(input.installed);
  const entry = expected.entries[0]!;
  if (entry.state === "measured") entry.content.entries = [...entry.content.entries].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  expect(result.value.input.installed).toEqual(expected);
});
it("requires independent complete occupancy even when the namespace is empty", () => {
  const input = importInput(); Reflect.deleteProperty(input.installed, "complete");
  expect(validateImportInput(input)).toEqual({ ok: false, issues: [{ code: "INSTALLED_EVIDENCE_REQUIRED", at: "installed" }] });
});

import { vi, afterEach } from "vitest";
import * as content from "./content";
import * as crypto from "node:crypto";
import type { PackageManifest } from "@orgops/schemas";
import { IMPORT_LIMITS, type ImportInput, type ImportLocalEntry, type ImportIssue } from "./import-types";
import { IMPORT_COMMIT } from "./import-fixtures";
import { must, skillManifest, wrappedManifest, classicManifest } from "./fixtures";
vi.mock("node:crypto", async importOriginal => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, createHash: vi.fn(actual.createHash) };
});
afterEach(() => vi.restoreAllMocks());
function reject(input: ImportInput, code?: ImportIssue["code"], at?: ImportIssue["at"]) {
  const r = validateImportInput(input);
  expect(r.ok).toBe(false); if (r.ok) throw new Error("Synthetic rejection expected");
  expect(r.issues).toHaveLength(1);
  if (code) expect(r.issues[0]!.code).toBe(code);
  if (at) expect(r.issues[0]!.at).toBe(at);
  expect(["$", "root", "sources", "catalogs", "packages", "target", "installed", "knownReleases", "review"]).toContain(r.issues[0]!.at);
  expect(JSON.stringify(r)).not.toContain("sensitive-synthetic-marker");
}
function localInput() {
  const input = importInput(), local = measuredSkill();
  if (local.state !== "measured") throw new Error("Synthetic kind");
  input.installed.entries = [local];
  return { input, local };
}
function blocked(input: ImportInput, name = "echo-skill") {
  const r = validateImportInput(input);
  expect(r.ok).toBe(true); if (!r.ok) throw new Error("Synthetic evidence rejected");
  expect(r.value.blockedNames).toEqual([name]); expect(r.value.installedSkills).toEqual([]); expect(r.value.installedFiles).toEqual([]);
}
function fileAt(entries: readonly ImportLocalEntry[], path: string) {
  const file = entries.find(e => e.path === path);
  if (!file || file.type !== "file") throw new Error("Synthetic file"); return file;
}
function rawFile(path: string, size = 0): Extract<ImportLocalEntry, { type: "file" }> {
  return { type: "file", path, base64: Buffer.alloc(size).toString("base64"), executable: false };
}
function snapshotFile(path: string, size = 0) {
  const { type: _type, ...f } = rawFile(path, size);
  return { ...f, size, digest: `sha256:${"0".repeat(64)}` };
}
function noWork(input: ImportInput, code: ImportIssue["code"] = "LIMIT_EXCEEDED") {
  const inspect = vi.spyOn(content, "inspectPackage"), hash = vi.spyOn(crypto, "createHash"), decode = vi.spyOn(Buffer, "from");
  hash.mockClear(); inspect.mockClear();
  reject(input, code);
  expect(inspect).not.toHaveBeenCalled(); expect(hash).not.toHaveBeenCalled();
  const calls: readonly (readonly unknown[])[] = decode.mock.calls;
  expect(calls.filter(args => args[1] === "base64")).toHaveLength(0);
}
it.each(["missing-installed", "false-installed", "missing-content", "false-content"])("requires %s completeness", kind => {
  const { input, local } = localInput();
  if (kind === "missing-installed") Reflect.deleteProperty(input, "installed");
  if (kind === "false-installed") Reflect.set(input.installed, "complete", false);
  if (kind === "missing-content") Reflect.deleteProperty(local.content, "complete");
  if (kind === "false-content") Reflect.set(local.content, "complete", false);
  reject(input, "INSTALLED_EVIDENCE_REQUIRED", "installed");
});
it.each(["root", "source", "catalog", "package", "target", "occupied", "measured", "content", "local-file", "origin", "manifest", "secret"])("rejects extra sensitive %s fields", where => {
  const { input, local } = localInput();
  const places: Record<string, object> = { root: input, source: input.sources[0]!, catalog: input.catalogs[0]!, package: input.packages[0]!, target: input.target, measured: local, content: local.content, "local-file": local.content.entries[0]!, origin: local.origin, manifest: input.packages[0]!.snapshot.manifest };
  if (where === "occupied") { input.installed.entries = [{ state: "occupied", name: "other" }]; places.occupied = input.installed.entries[0]!; }
  if (where === "secret") { input.packages[0]!.snapshot.manifest.secrets = [{ name: "KEY", description: "Inert", required: true }]; places.secret = input.packages[0]!.snapshot.manifest.secrets[0]!; }
  Object.assign(places[where]!, { currentDigest: "sensitive-synthetic-marker", secretValue: "sensitive-synthetic-marker", agent_id: "synthetic" });
  reject(input);
});
it.each(["root", "nested"])("does not invoke a %s getter", where => {
  const input = importInput(); let reads = 0;
  Object.defineProperty(where === "root" ? input : input.sources[0]!, "repository", { enumerable: true, get() { reads++; return "sensitive-synthetic-marker"; } });
  reject(input, "INVALID_JSON", "$"); expect(reads).toBe(0);
});
it.each([undefined, NaN, Infinity, BigInt(1), () => 0, new Date(), Symbol("synthetic"), "\ud800"])("rejects non-JSON data %#", value => {
  const input = importInput(); Object.assign(input, { ignored: value }); reject(input, "INVALID_JSON", "$");
});
it.each(["cycle", "symbol-key", "sparse", "array-extra", "nonenumerable", "depth33"])("rejects %s descriptors", kind => {
  const input = importInput();
  if (kind === "cycle") Object.assign(input, { ignored: input });
  if (kind === "symbol-key") Reflect.set(input, Symbol("synthetic"), 1);
  if (kind === "sparse") Reflect.deleteProperty(input.packages, "0");
  if (kind === "array-extra") Reflect.set(input.packages, "extra", 1);
  if (kind === "nonenumerable") Object.defineProperty(input, "extra", { value: 1 });
  if (kind === "depth33") { let value: unknown = 0; for (let i = 0; i < 33; i++) value = { value }; Object.assign(input, { ignored: value }); }
  reject(input, kind === "depth33" ? "LIMIT_EXCEEDED" : "INVALID_JSON", "$");
});
it("retains uppercase unrelated occupancy as folded blocked evidence", () => {
  const input = importInput(); input.installed.entries = [{ state: "occupied", name: "ECHO-SKILL" }]; blocked(input);
});
it.each(["echo-skill", "ECHO-SKILL"])("rejects duplicate occupancy %s", name => {
  const { input } = localInput(); input.installed.entries = [...input.installed.entries, { state: "occupied", name }]; reject(input, "IDENTITY_CONFLICT", "installed");
});
it.each(["../escape", "a/b", "CON", ".git", "node_modules", "a.", "two words", "a".repeat(65), ""])("rejects nonportable occupied name %#", name => {
  const input = importInput(); input.installed.entries = [{ state: "occupied", name }]; reject(input, "UNSAFE_PATH", "installed");
});
it.each(["duplicate-id", "repository-alias", "unbound-catalog", "unbound-package", "duplicate-catalog", "duplicate-package", "duplicate-history"])("rejects %s evidence", kind => {
  const input = importInput();
  if (kind === "duplicate-id" || kind === "repository-alias") input.sources = [...input.sources, { ...input.sources[0]!, sourceId: kind === "repository-alias" ? "alias" : "team-source", repository: { url: "https://EXAMPLE.invalid:443/team/catalog.git" } }];
  if (kind === "unbound-catalog") input.catalogs[0]!.sourceId = "missing";
  if (kind === "unbound-package") input.packages[0]!.sourceId = "missing";
  if (kind === "duplicate-catalog") input.catalogs = [...input.catalogs, input.catalogs[0]!];
  if (kind === "duplicate-package") input.packages = [...input.packages, input.packages[0]!];
  if (kind === "duplicate-history") { const local = measuredSkill(); if (local.state !== "measured") throw new Error("fixture"); input.knownReleases = [local.origin, { ...local.origin, catalogCommit: "2".repeat(40) }]; }
  reject(input, "IDENTITY_CONFLICT");
});
it("canonicalizes source binding without granting permission or erasing historical origins", () => {
  const { input, local } = localInput(); input.sources[0]!.repository.url = "https://EXAMPLE.invalid:443/team/catalog.git";
  input.sources[0]!.enabled = false; input.catalogs[0]!.enabled = false;
  local.origin.sourceId = "removed-source"; local.origin.catalogId = "removed-catalog";
  input.knownReleases = [{ ...local.origin, name: "history" }];
  const r = validateImportInput(input); expect(r.ok).toBe(true); if (!r.ok) return;
  expect(r.value.input.sources[0]!.repository.url).toBe("https://example.invalid/team/catalog.git");
  expect(r.value.input.sources[0]!.enabled).toBe(false); expect(r.value.installedSkills[0]!.identity).toEqual(local.origin);
  expect(r.value.input.knownReleases).toEqual(input.knownReleases); expect(input.sources[0]!.repository.url).toContain("EXAMPLE");
});
it.each<ImportLocalEntry[]>([
  [{ type: "directory", path: "../escape" }], [{ type: "directory", path: "SKILL.md" }], [{ type: "directory", path: "skill.MD" }],
  [{ type: "directory", path: "missing/child" }], [{ type: "directory", path: "A" }, { type: "directory", path: "a/child" }],
  [{ type: "blocked", path: "leaf" }, { type: "directory", path: "leaf/child" }],
  [{ type: "directory", path: "SKILL.md/child" }],
])("rejects malformed complete local paths %#", (...entries) => {
  const { input, local } = localInput(); local.content.entries = [...local.content.entries, ...entries]; reject(input);
});
it.each(["missing", "executable", "utf8", "bom", "json", "case", "directory", "blocked", "mode", "extra-file", "empty-directory", "blocked-leaf", "metadata"])("blocks locally %s content without turning it into global conflict", kind => {
  const { input, local } = localInput(); const root = fileAt(local.content.entries, "orgops-package.json");
  if (kind === "missing") local.content.entries = local.content.entries.filter(e => e !== root);
  if (kind === "executable") root.executable = true;
  if (kind === "utf8") root.base64 = Buffer.from([255]).toString("base64");
  if (kind === "bom") root.base64 = Buffer.from("\ufeff" + JSON.stringify(skillManifest)).toString("base64");
  if (kind === "json") root.base64 = Buffer.from("sensitive-synthetic-marker").toString("base64");
  if (kind === "case") root.path = "ORGOPS-PACKAGE.JSON";
  if (kind === "directory" || kind === "blocked") local.content.entries = local.content.entries.map(e => e === root ? { type: kind, path: root.path } : e);
  if (kind === "mode") fileAt(local.content.entries, "SKILL.md").executable = true;
  if (kind === "extra-file") local.content.entries = [...local.content.entries, rawFile("extra")];
  if (kind === "empty-directory") local.content.entries = [...local.content.entries, { type: "directory", path: "empty" }];
  if (kind === "blocked-leaf") local.content.entries = [...local.content.entries, { type: "blocked", path: "link" }];
  if (kind === "metadata") root.base64 = Buffer.from(JSON.stringify({ ...skillManifest, author: "Local edit" })).toString("base64");
  blocked(input);
});
it("retains exact lexical local manifest bytes under semantic equivalence", () => {
  const { input, local } = localInput(), root = fileAt(local.content.entries, "orgops-package.json");
  root.base64 = Buffer.from('{"author":"ignored duplicate",' + JSON.stringify(skillManifest).slice(1) + "\r\n   ").toString("base64");
  const r = validateImportInput(input); expect(r.ok).toBe(true); if (!r.ok) return;
  expect(r.value.installedSkills[0]!.currentDigest).toBe(skillManifest.digest);
  expect(r.value.installedFiles[0]!.files.find(f => f.path === root.path)!.base64).toBe(root.base64);
});
it("derives a changed current digest for independently resealed metadata, retaining original provenance", () => {
  const { input, local } = localInput();
  const manifest = { ...structuredClone(skillManifest), author: "Local author" };
  const ordinary = local.content.entries.filter((e): e is Extract<ImportLocalEntry, { type: "file" }> => e.type === "file" && e.path !== "orgops-package.json");
  manifest.digest = must(content.computePackageDigest(manifest, ordinary));
  fileAt(local.content.entries, "orgops-package.json").base64 = Buffer.from(JSON.stringify(manifest)).toString("base64");
  const r = validateImportInput(input); expect(r.ok).toBe(true); if (!r.ok) return;
  expect(r.value.installedSkills).toEqual([{ name: "echo-skill", identity: local.origin, currentDigest: manifest.digest }]);
  expect(manifest.digest).not.toBe(local.origin.digest);
});
it.each(["YQ", "YR==", "YWJ=", "YQ==\n", "!!!!", "a==="])("rejects noncanonical local base64 %# before inspection", base64 => {
  const { input, local } = localInput(); fileAt(local.content.entries, "SKILL.md").base64 = base64;
  noWork(input, "INVALID_IMPORT_INPUT");
});
it.each(["size", "digest"])("remeasures forged unused snapshot %s", field => {
  const input = importInput(); Object.assign(input.packages[0]!.snapshot.files[0]!, field === "size" ? { size: 1 } : { digest: `sha256:${"0".repeat(64)}` }); reject(input, "INVENTORY_MISMATCH", "packages");
});
it("regenerates rather than trusting empty execution and warning assertions", () => {
  const input = importInput(); for (const p of input.packages) { p.snapshot.execution = { apiEventShapes: [], runnerScripts: [], wrappedCommands: [], externalSources: [] }; p.snapshot.warnings = []; }
  const r = validateImportInput(input); expect(r.ok).toBe(true); if (!r.ok) return;
  expect(r.value.input.packages.find(p => p.snapshot.manifest.kind === "skill")!.snapshot.execution.apiEventShapes).toEqual(["event-shapes.ts"]);
  expect(r.value.input.packages.find(p => p.snapshot.manifest.kind === "wrapped-agent")!.snapshot.execution.wrappedCommands).toHaveLength(4);
  expect(r.value.input.packages.every(p => p.snapshot.warnings.length > 0)).toBe(true);
});
it("does not apply export-only selected credential-path exclusions to valid native auxiliary bytes", () => {
  const input = importInput(); const manifest = structuredClone(classicManifest), bytes = Buffer.from([255, 0]);
  const file = { path: ".env", base64: bytes.toString("base64"), executable: false, size: 2, digest: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}` };
  manifest.files = [{ path: file.path, size: file.size, digest: file.digest, executable: false }];
  const entries = [{ type: "file" as const, path: file.path, base64: file.base64, executable: false }];
  manifest.digest = must(content.computePackageDigest(manifest, entries));
  input.packages = [{ ...input.packages[1]!, snapshot: must(content.inspectPackage(manifest, entries)) }];
  expect(validateImportInput(input).ok).toBe(true);
});
it.each(["implicit-case", "leaf-ancestor"])("rejects supplied %s path conflicts before inspection", kind => {
  const input = importInput(), p = input.packages[1]!;
  p.snapshot.files = kind === "implicit-case" ? [snapshotFile("A/x"), snapshotFile("a/y")] : [snapshotFile("a"), snapshotFile("a/x")];
  const inspect = vi.spyOn(content, "inspectPackage"); reject(input, "DUPLICATE_PATH", "packages"); expect(inspect).not.toHaveBeenCalled();
});
it("checks the joined local 240-character boundary without treating extra content as absent", () => {
  const { input, local } = localInput();
  const path = ["a".repeat(64), "b".repeat(64), "c".repeat(64), "d".repeat(34)].join("/");
  expect(`${local.name}/${path}`).toHaveLength(240);
  local.content.entries = [...local.content.entries, ...path.split("/").slice(0, -1).map((_, i, parts) => ({ type: "directory" as const, path: parts.slice(0, i + 1).join("/") })), rawFile(path)];
  blocked(input);
  fileAt(local.content.entries, path).path += "x";
  noWork(input, "UNSAFE_PATH");
});
it("retains nested manifests as ordinary content and classifies binary current files", () => {
  const { input, local } = localInput(), manifest = structuredClone(skillManifest);
  const extra = rawFile("assets/orgops-package.json"); extra.base64 = Buffer.from([255]).toString("base64");
  local.content.entries = [...local.content.entries, { type: "directory", path: "assets" }, extra];
  manifest.files.push({ path: extra.path, size: 1, executable: false, digest: `sha256:${crypto.createHash("sha256").update(Buffer.from([255])).digest("hex")}` });
  const entries = local.content.entries.filter((e): e is Extract<ImportLocalEntry, { type: "file" }> => e.type === "file" && e.path !== "orgops-package.json");
  manifest.digest = must(content.computePackageDigest(manifest, entries));
  fileAt(local.content.entries, "orgops-package.json").base64 = Buffer.from(JSON.stringify(manifest)).toString("base64");
  const r = validateImportInput(input); expect(r.ok).toBe(true); if (!r.ok) return;
  expect(r.value.installedFiles[0]!.files.find(f => f.path === extra.path)).toMatchObject({ encoding: "binary", base64: "/w==", size: 1 });
});
it.each(["sources", "catalogs", "packages", "knownReleases", "installed", "tools"] as const)("accepts %s maximum count and refuses +1 before body work", field => {
  const input = importInput();
  if (field === "sources") input.sources = Array.from({ length: 128 }, (_, i) => ({ ...input.sources[0]!, sourceId: i === 0 ? "team-source" : `source-${i}`, repository: { url: `https://example.invalid/repo-${i}` } }));
  if (field === "catalogs") input.catalogs = Array.from({ length: 32 }, (_, i) => ({ ...input.catalogs[0]!, catalogId: `catalog-${i}` }));
  if (field === "packages") input.packages = Array.from({ length: 4096 }, (_, i) => ({ ...input.packages[0]!, path: `package-${i}` }));
  if (field === "knownReleases") { const local = measuredSkill(); if (local.state !== "measured") throw new Error("fixture"); input.knownReleases = Array.from({ length: 4096 }, (_, i) => ({ ...local.origin, version: `1.0.${i}` })); }
  if (field === "installed") input.installed.entries = Array.from({ length: 4096 }, (_, i) => ({ state: "occupied", name: `occupied-${i}` }));
  if (field === "tools") input.target.tools = Array.from({ length: 64 }, (_, i) => `tool-${i}`);
  expect(validateImportInput(input).ok).toBe(true);
  if (field === "installed") input.installed.entries = [...input.installed.entries, { state: "occupied", name: "overflow" }];
  else if (field === "tools") input.target.tools.push("overflow");
  else Reflect.set(input, field, [...input[field], input[field][0]!]);
  noWork(input);
}, 30000);
it.each(["per-skill", "aggregate"])("checks %s directory/blocked tree count including empty directories", kind => {
  const input = importInput(); const count = kind === "per-skill" ? 1 : 8;
  input.installed.entries = Array.from({ length: count }, (_, i) => {
    const local = measuredSkill(); if (local.state !== "measured") throw new Error("fixture");
    local.name = `local-${i}`; local.origin.name = local.name;
    local.content.entries = Array.from({ length: 1024 }, (_, j) => ({ type: "directory", path: `empty-${j}` }));
    return local;
  });
  expect(validateImportInput(input).ok).toBe(true);
  if (kind === "per-skill") {
    const local = input.installed.entries[0]!; if (local.state !== "measured") throw new Error("fixture");
    local.content.entries = [...local.content.entries, { type: "directory", path: "overflow" }];
  } else {
    const local = measuredSkill(); if (local.state !== "measured") throw new Error("fixture");
    local.content.entries = [{ type: "blocked", path: "overflow" }]; input.installed.entries = [...input.installed.entries, local];
  }
  noWork(input);
}, 30000);
it.each(["index", "aggregate"])("checks %s index entry counts even when unused", kind => {
  const input = importInput(), c = input.catalogs[0]!, original = c.index.entries[0]!;
  c.index.entries = Array.from({ length: 4096 }, (_, i) => ({ ...original, version: `1.0.${i}`, location: { type: "catalog", path: `p-${i}`, revision: { type: "catalog-revision" } } }));
  if (kind === "aggregate") input.catalogs = [c, { ...c, catalogId: "second" }];
  expect(validateImportInput(input).ok).toBe(true);
  if (kind === "index") c.index.entries.push({ ...original });
  else input.catalogs = [...input.catalogs, { ...c, catalogId: "third", index: { formatVersion: 1, entries: [original] } }];
  noWork(input);
}, 30000);
it("counts every snapshot/local file occurrence at 8192 and refuses 8193 before hashes", () => {
  const input = importInput(); input.packages = Array.from({ length: 4096 }, (_, i) => ({ ...input.packages[0]!, path: `p-${i}` }));
  expect(validateImportInput(input).ok).toBe(true);
  const local = measuredSkill(); if (local.state !== "measured") throw new Error("fixture");
  local.content.entries = [local.content.entries[0]!]; input.installed.entries = [local]; noWork(input);
}, 30000);
it.each(["snapshot", "local-root", "local-file", "snapshot-total", "local-total", "aggregate"])("preflights actual %s bytes at equality and +1", kind => {
  const input = importInput(); input.packages = [];
  let last: { base64: string }; let size: number;
  if (kind === "local-root" || kind === "local-file" || kind === "local-total") {
    const local = measuredSkill(); if (local.state !== "measured") throw new Error("fixture");
    size = kind === "local-root" ? 262144 : 1048576;
    local.content.entries = Array.from({ length: kind === "local-total" ? 8 : 1 }, (_, i) => rawFile(kind === "local-root" ? "orgops-package.json" : `blob-${i}`, size));
    input.installed.entries = [local]; last = fileAt(local.content.entries, kind === "local-root" ? "orgops-package.json" : "blob-0");
  } else {
    const p = importInput().packages[1]!;
    size = 1048576;
    p.snapshot.files = Array.from({ length: kind === "snapshot" ? 1 : 8 }, (_, i) => snapshotFile(`blob-${i}`, size));
    input.packages = Array.from({ length: kind === "aggregate" ? 4 : 1 }, (_, i) => ({ ...p, path: `p-${i}` }));
    last = p.snapshot.files[0]!;
  }
  const equal = validateImportInput(input);
  if (!equal.ok) expect(equal.issues[0]!.code).not.toBe("LIMIT_EXCEEDED");
  // For total ceilings add a distinct one-byte occurrence, not a per-file overflow.
  if (kind === "snapshot-total" || kind === "aggregate") {
    input.packages[0]!.snapshot = { ...input.packages[0]!.snapshot, files: [...input.packages[0]!.snapshot.files, snapshotFile("extra", 1)] };
  } else if (kind === "local-total") {
    const local = input.installed.entries[0]!; if (local.state !== "measured") throw new Error("fixture"); local.content.entries = [...local.content.entries, rawFile("extra", 1)];
  } else last.base64 = Buffer.alloc(size + 1).toString("base64");
  noWork(input);
}, 30000);
it.each(["input", "index", "manifest", "content"])("checks compact %s JSON equality and +1 before semantic work", kind => {
  const input = importInput(); let object: object, max: number;
  if (kind === "input") { object = input; max = 67108864; }
  else if (kind === "index") { object = input.catalogs[0]!.index.entries[0]!; max = 2097152; }
  else if (kind === "manifest") { object = input.packages[0]!.snapshot.manifest; max = 262144; }
  else { object = input.packages[0]!.snapshot.files[0]!; max = 12582912; }
  Object.assign(object, { ignored: "" });
  const measured = kind === "content" ? input.packages[0]!.snapshot.files : kind === "index" ? input.catalogs[0]!.index : object;
  const padding = max - Buffer.byteLength(JSON.stringify(measured));
  Object.assign(object, { ignored: "x".repeat(padding) });
  const equal = validateImportInput(input); expect(equal.ok).toBe(false); if (!equal.ok) expect(equal.issues[0]!.code).not.toBe("LIMIT_EXCEEDED");
  Object.assign(object, { ignored: "x".repeat(padding + 1) }); noWork(input);
}, 30000);
it.each(["files", "warnings", "api", "scripts", "commands", "external", "warning-at", "execution-path", "command-at", "command", "args", "arg", "repo", "ref"])("checks supplied review %s equality/+1 without trusting claims", kind => {
  const input = importInput(), snapshot = input.packages[1]!.snapshot;
  let overflow: () => void;
  const e = snapshot.execution;
  if (kind === "files") { snapshot.files = Array.from({ length: 256 }, (_, i) => snapshotFile(`f-${i}`)); overflow = () => { snapshot.files = [...snapshot.files, snapshotFile("overflow")]; }; }
  else if (kind === "warnings") { snapshot.warnings = Array.from({ length: 4096 }, () => ({ code: "MANUAL_REVIEW_REQUIRED", at: "$" })); overflow = () => { snapshot.warnings = [...snapshot.warnings, snapshot.warnings[0]!]; }; }
  else if (kind === "api" || kind === "scripts") { const list = kind === "api" ? e.apiEventShapes : e.runnerScripts; list.push(...Array.from({ length: 256 }, () => "x")); overflow = () => { list.push("x"); }; }
  else if (kind === "commands") { e.wrappedCommands = Array.from({ length: 35 }, () => ({ at: "$", command: "inert", args: [] })); overflow = () => { e.wrappedCommands.push(e.wrappedCommands[0]!); }; }
  else if (kind === "external") { e.externalSources = [{ type: "github", repo: "owner/repo" }]; overflow = () => { e.externalSources.push(e.externalSources[0]!); }; }
  else if (kind === "warning-at") { snapshot.warnings = [{ code: "MANUAL_REVIEW_REQUIRED", at: "x".repeat(1024) }]; overflow = () => { snapshot.warnings[0]!.at += "x"; }; }
  else if (kind === "execution-path") { e.apiEventShapes = [["a".repeat(64), "b".repeat(64), "c".repeat(64), "d".repeat(45)].join("/")]; overflow = () => { e.apiEventShapes[0] += "x"; }; }
  else if (kind === "repo" || kind === "ref") { e.externalSources = [{ type: "github", repo: "x".repeat(201), ref: "x".repeat(128) }]; overflow = () => { if (kind === "repo") e.externalSources[0]!.repo += "x"; else e.externalSources[0]!.ref += "x"; }; }
  else {
    const c = { at: "$", command: "inert", args: [] as string[] }; e.wrappedCommands = [c];
    if (kind === "command-at") { c.at = "x".repeat(240); overflow = () => { c.at += "x"; }; }
    else if (kind === "command") { c.command = "x".repeat(16384); overflow = () => { c.command += "x"; }; }
    else if (kind === "args") { c.args = Array(128).fill(""); overflow = () => { c.args.push(""); }; }
    else { c.args = ["x".repeat(4096)]; overflow = () => { c.args[0] += "x"; }; }
  }
  const equal = validateImportInput(input); if (kind === "files") { expect(equal.ok).toBe(false); if (!equal.ok) expect(equal.issues[0]!.code).not.toBe("LIMIT_EXCEEDED"); } else expect(equal.ok).toBe(true);
  overflow(); noWork(input);
}, 30000);
import { expandingSnapshot } from "./import-fixtures";
async function reducedLimit(field: "inputJsonBytes" | "validatedJsonBytes" | "snapshotWarnings", limit: number, run: (validate: typeof validateImportInput) => void) {
  vi.resetModules();
  vi.doMock("./import-types", () => ({ IMPORT_LIMITS: { ...IMPORT_LIMITS, [field]: limit } }));
  try { const module = await import("./import-evidence"); run(module.validateImportInput); }
  finally { vi.doUnmock("./import-types"); vi.resetModules(); }
}
function expectedEmptyLocal(input: ImportInput) {
  return {
    input: {
      ...structuredClone(input),
      catalogs: [...input.catalogs].sort((a, b) => a.catalogId < b.catalogId ? -1 : 1).map(c => ({ ...c, index: { ...c.index, entries: [...c.index.entries].sort((a, b) => a.name < b.name ? -1 : 1) } })),
      packages: [...input.packages].sort((a, b) => a.path < b.path ? -1 : 1).map(p => ({ ...p, snapshot: must(content.inspectPackage(p.snapshot.manifest, p.snapshot.files.map(f => ({ type: "file", path: f.path, base64: f.base64, executable: f.executable })))) })),
    }, installedSkills: [], blockedNames: [], installedFiles: [],
  };
}
it("regenerates thousands of warnings and all 35 commands from empty claims", () => {
  const input = importInput(); input.packages = [{ ...input.packages[3]!, snapshot: expandingSnapshot() }];
  const r = validateImportInput(input); expect(r.ok).toBe(true); if (!r.ok) return;
  const s = r.value.input.packages[0]!.snapshot;
  expect(s.warnings.length).toBeGreaterThan(2300); expect(s.warnings.length).toBeLessThanOrEqual(4096);
  expect(s.execution.wrappedCommands).toHaveLength(35);
  expect(s.execution.wrappedCommands[1]!.args).toHaveLength(128);
  expect(s.warnings.every(w => !w.at.includes("synthetic-sensitive-argument"))).toBe(true);
});
it("rejects real cumulative regenerated private evidence over 64MiB despite bounded empty incoming previews", () => {
  const input = importInput(), snapshot = expandingSnapshot();
  const regenerated = must(content.inspectPackage(snapshot.manifest, []));
  const count = 220;
  input.packages = Array.from({ length: count }, (_, i) => ({ sourceId: "team-source", commit: IMPORT_COMMIT, path: `p-${String(i).padStart(3, "0")}`, snapshot }));
  const submittedSize = Buffer.byteLength(JSON.stringify(input));
  expect(submittedSize).toBeLessThan(IMPORT_LIMITS.inputJsonBytes);
  const base = Buffer.byteLength(JSON.stringify({ ...input, packages: [] }));
  const piece = Buffer.byteLength(JSON.stringify({ ...input.packages[0]!, snapshot: regenerated }));
  const overhead = Buffer.byteLength(JSON.stringify({ input: null, installedSkills: [], blockedNames: [], installedFiles: [] })) - 4;
  expect(base + overhead + count * (piece + 1) - 1).toBeGreaterThan(IMPORT_LIMITS.validatedJsonBytes);
  const firstFailingInspection = Math.floor((IMPORT_LIMITS.validatedJsonBytes - base - overhead + 1) / (piece + 1)) + 1;
  const inspect = vi.spyOn(content, "inspectPackage");
  reject(input, "LIMIT_EXCEEDED", "packages");
  expect(inspect).toHaveBeenCalledTimes(firstFailingInspection);
}, 30000);
it.each(["inputJsonBytes", "validatedJsonBytes"] as const)("independently checks canonical %s equality and +1 with private reduced limits", async field => {
  const input = importInput(); input.packages = [{ ...input.packages[3]!, snapshot: expandingSnapshot() }];
  const expected = expectedEmptyLocal(input);
  const bytes = Buffer.byteLength(JSON.stringify(field === "inputJsonBytes" ? expected.input : expected));
  expect(Buffer.byteLength(JSON.stringify(input))).toBeLessThan(bytes);
  await reducedLimit(field, bytes, validate => { expect(validate(input)).toEqual({ ok: true, value: expected }); });
  await reducedLimit(field, bytes - 1, validate => { expect(validate(input)).toEqual({ ok: false, issues: [{ code: "LIMIT_EXCEEDED", at: "packages" }] }); });
}, 30000);
it("charges repeated raw local bytes and independently derived installedFiles against the private budget", async () => {
  const { input, local } = localInput();
  const expectedBase = expectedEmptyLocal({ ...input, installed: { complete: true, entries: [] } });
  const entries = [...local.content.entries].sort((a, b) => a.path < b.path ? -1 : 1);
  const files = entries.filter((e): e is Extract<ImportLocalEntry, { type: "file" }> => e.type === "file").map(e => {
    const bytes = Buffer.from(e.base64, "base64");
    return { path: e.path, base64: e.base64, executable: e.executable, size: bytes.length, digest: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`, encoding: "utf8" };
  });
  const expected = { input: { ...expectedBase.input, installed: { complete: true, entries: [{ ...local, content: { complete: true, entries } }] } },
    installedSkills: [{ name: local.name, identity: local.origin, currentDigest: skillManifest.digest }], blockedNames: [], installedFiles: [{ name: local.name, files }] };
  const bytes = Buffer.byteLength(JSON.stringify(expected));
  expect(bytes).toBeGreaterThan(Buffer.byteLength(JSON.stringify(expected.input)));
  await reducedLimit("validatedJsonBytes", bytes, validate => { expect(validate(input)).toEqual({ ok: true, value: expected }); });
  await reducedLimit("validatedJsonBytes", bytes - 1, validate => { expect(validate(input)).toEqual({ ok: false, issues: [{ code: "LIMIT_EXCEEDED", at: "installed" }] }); });
});
it("checks regenerated warning cap using a private lowered constant, not a fictitious natural 4097 case", async () => {
  const input = importInput(); input.packages = [{ ...input.packages[3]!, snapshot: expandingSnapshot() }];
  const actual = must(content.inspectPackage(input.packages[0]!.snapshot.manifest, [])).warnings.length;
  expect(actual).toBeGreaterThan(2300); expect(actual).toBeLessThan(4096);
  await reducedLimit("snapshotWarnings", actual, validate => { expect(validate(input).ok).toBe(true); });
  await reducedLimit("snapshotWarnings", actual - 1, validate => { expect(validate(input)).toEqual({ ok: false, issues: [{ code: "LIMIT_EXCEEDED", at: "packages" }] }); });
});
it("does not downgrade a regenerated local warning limit to an unrelated blocked name", async () => {
  const { input, local } = localInput(); input.packages = [];
  const manifest = { ...structuredClone(skillManifest), author: "token=synthetic" };
  const entries = local.content.entries.filter((e): e is Extract<ImportLocalEntry, { type: "file" }> => e.type === "file" && e.path !== "orgops-package.json");
  manifest.digest = must(content.computePackageDigest(manifest, entries));
  fileAt(local.content.entries, "orgops-package.json").base64 = Buffer.from(JSON.stringify(manifest)).toString("base64");
  await reducedLimit("snapshotWarnings", 1, validate => { expect(validate(input)).toEqual({ ok: false, issues: [{ code: "LIMIT_EXCEEDED", at: "installed" }] }); });
});
it("treats local parse/inspection limits as global failures, never unrelated blocked evidence", () => {
  const { input, local } = localInput();
  local.content.entries = [...local.content.entries, ...Array.from({ length: 255 }, (_, i) => rawFile(`extra-${i}`))];
  reject(input, "LIMIT_EXCEEDED", "installed");
});
it.each(["instructions", "soul", "description", "author", "license", "secrets", "secret-name", "secret-description", "dependencies", "tools", "platforms", "preloads", "sidecars", "command", "args", "arg", "repo", "ref", "integer", "temperature"])("enforces authored manifest %s schema boundary and +1 through import", kind => {
  const input = importInput(); const wrapped = ["sidecars", "command", "args", "arg", "repo", "ref"].includes(kind);
  const manifest: PackageManifest = structuredClone(wrapped ? wrappedManifest : classicManifest);
  let overflow: () => void = () => { throw new Error("Synthetic boundary setup"); };
  if (kind === "description" || kind === "author" || kind === "license") { manifest[kind] = "x".repeat(kind === "description" ? 4096 : 256); overflow = () => { manifest[kind] += "x"; }; }
  if (kind === "secrets") { manifest.secrets = Array.from({ length: 64 }, (_, i) => ({ name: `KEY_${i}`, description: "Inert", required: true })); overflow = () => { manifest.secrets.push({ name: "OVERFLOW", description: "Inert", required: true }); }; }
  if (kind === "secret-name" || kind === "secret-description") { const s = { name: "A".repeat(64), description: "x".repeat(1024), required: true }; manifest.secrets = [s]; overflow = () => { if (kind === "secret-name") s.name += "A"; else s.description += "x"; }; }
  if (kind === "dependencies") { manifest.dependencies = Array.from({ length: 64 }, (_, i) => ({ ...classicManifest.dependencies[0]!, name: i === 0 ? "echo-skill" : `dep-${i}` })); overflow = () => { manifest.dependencies.push({ ...classicManifest.dependencies[0]!, name: "overflow" }); }; }
  if (kind === "tools") { manifest.compatibility.tools = Array.from({ length: 64 }, (_, i) => `tool-${i}`); overflow = () => { manifest.compatibility.tools.push("overflow"); }; }
  if (kind === "platforms") { overflow = () => { manifest.compatibility.platforms.push("linux"); }; }
  if (manifest.kind === "native-agent") {
    const n = manifest.native;
    if (kind === "instructions" || kind === "soul") { const field = kind === "instructions" ? "systemInstructions" : "soulContents"; n[field] = "x".repeat(65536); overflow = () => { n[field] += "x"; }; }
    if (kind === "preloads") { manifest.dependencies = Array.from({ length: 64 }, (_, i) => ({ ...classicManifest.dependencies[0]!, name: `dep-${i}` })); n.alwaysPreloadedSkills = manifest.dependencies.map(d => d.name); overflow = () => { n.alwaysPreloadedSkills.push("overflow"); }; }
    if (kind === "integer") { n.runtime.llmCallTimeoutMs = 2147483647; overflow = () => { n.runtime.llmCallTimeoutMs = 2147483648; }; }
    if (kind === "temperature") { n.suggestedModel = { temperature: 2 }; overflow = () => { n.suggestedModel!.temperature = 2.00001; }; }
  }
  if (manifest.kind === "wrapped-agent") {
    const w = manifest.wrapped;
    if (kind === "sidecars") { w.sidecars = Array.from({ length: 16 }, (_, i) => ({ name: `sidecar-${i}`, command: "inert" })); overflow = () => { w.sidecars.push({ name: "overflow", command: "inert" }); }; }
    if (kind === "command") { w.runtime.command = "x".repeat(16384); overflow = () => { w.runtime.command += "x"; }; }
    if (kind === "args") { w.runtime.args = Array(128).fill(""); overflow = () => { w.runtime.args!.push(""); }; }
    if (kind === "arg") { w.runtime.args = ["x".repeat(4096)]; overflow = () => { w.runtime.args![0] += "x"; }; }
    if (kind === "repo" || kind === "ref") { w.source = { type: "github", repo: "a".repeat(100) + "/" + "b".repeat(100), ref: "a".repeat(128), updateOnStart: false }; overflow = () => { if (kind === "repo") w.source!.repo += "x"; else w.source!.ref += "x"; }; }
  }
  manifest.digest = must(content.computePackageDigest(manifest, []));
  input.packages = [{ ...input.packages[1]!, snapshot: { manifest, files: [], execution: { apiEventShapes: [], runnerScripts: [], wrappedCommands: [], externalSources: [] }, warnings: [] } }];
  expect(validateImportInput(input).ok).toBe(true);
  overflow(); noWork(input, "INVALID_MANIFEST");
}, 30000);
it.each(["source-handle", "catalog-handle", "name", "version", "commit", "digest", "path-segment", "repository-url", "ssh-user"])("checks %s primitive boundaries without repair", kind => {
  const input = importInput(); let overflow: () => void;
  if (kind === "source-handle") { input.sources = [{ ...input.sources[0]!, sourceId: "a".repeat(64) }]; input.catalogs = []; input.packages = []; overflow = () => { input.sources[0]!.sourceId += "a"; }; }
  else if (kind === "catalog-handle") { input.root.catalogId = "a".repeat(64); overflow = () => { input.root.catalogId += "a"; }; }
  else if (kind === "name") { input.root.name = "a".repeat(64); overflow = () => { input.root.name += "a"; }; }
  else if (kind === "version") { input.root.version = "999999.999999.999999"; overflow = () => { input.root.version += "9"; }; }
  else if (kind === "commit") { input.packages[0]!.commit = "a".repeat(64); overflow = () => { input.packages[0]!.commit += "a"; }; }
  else if (kind === "digest") { const local = measuredSkill(); if (local.state !== "measured") throw new Error("fixture"); input.knownReleases = [local.origin]; overflow = () => { input.knownReleases[0]!.digest += "a"; }; }
  else if (kind === "path-segment") { input.packages[0]!.path = "a".repeat(64); overflow = () => { input.packages[0]!.path += "a"; }; }
  else if (kind === "ssh-user") { input.sources[0]!.repository = { url: "ssh://example.invalid/team/catalog.git", sshUser: "a".repeat(64) }; overflow = () => { input.sources[0]!.repository.sshUser += "a"; }; }
  else { const prefix = "https://example.invalid/"; const path = Array(15).fill("a".repeat(128)).join("/"); input.sources[0]!.repository.url = prefix + path + "/" + "b".repeat(2048 - prefix.length - path.length - 1); overflow = () => { input.sources[0]!.repository.url += "x"; }; }
  expect(validateImportInput(input).ok).toBe(true); overflow(); reject(input);
});
it("normal exceptions redact rather than returning authored inspector details", () => {
  const input = importInput(); vi.spyOn(content, "inspectPackage").mockImplementation(() => { throw new Error("sensitive-synthetic-marker"); });
  expect(validateImportInput(input)).toEqual({ ok: false, issues: [{ code: "INVALID_IMPORT_INPUT", at: "$" }] });
});
it.each(["input", "private"])("independently honors the final %s descriptor check (fault injection)", async kind => {
  const input = importInput(); input.packages = [input.packages[3]!];
  vi.resetModules(); let finalChecks = 0;
  vi.doMock("@orgops/schemas", async () => {
    const actual = await vi.importActual<typeof import("@orgops/schemas")>("@orgops/schemas");
    return { ...actual, validateCatalogJson: (value: unknown, max: number) => {
      const checked = actual.validateCatalogJson(value, max);
      if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        const candidate = kind === "input" ? record : record.input as Record<string, unknown> | undefined;
        if (candidate && Object.hasOwn(candidate, "root") && Array.isArray(candidate.packages) && candidate.packages.length === 1 && value !== input) {
          finalChecks++; expect(checked.ok).toBe(true);
          return { ok: false, issues: [{ code: "LIMIT_EXCEEDED", at: "sensitive-synthetic-marker" }] };
        }
      }
      return checked;
    } };
  });
  try {
    const module = await import("./import-evidence");
    expect(module.validateImportInput(input)).toEqual({ ok: false, issues: [{ code: "LIMIT_EXCEEDED", at: "$" }] });
    expect(finalChecks).toBe(1);
  } finally { vi.doUnmock("@orgops/schemas"); vi.resetModules(); }
});
it.each(["kind", "name", "uppercase"])("rejects invalid measured origin %s independently of contents", kind => {
  const { input, local } = localInput();
  if (kind === "kind") local.origin.kind = "native-agent";
  if (kind === "name") local.origin.name = "different";
  if (kind === "uppercase") { local.name = "ECHO-SKILL"; local.origin.name = local.name; }
  reject(input, "INVALID_IMPORT_INPUT", "installed");
});
it("returns the same detached canonical evidence for permuted set-like inputs", () => {
  const { input, local } = localInput();
  const before = structuredClone(input), first = validateImportInput(input);
  input.packages = [...input.packages].reverse(); input.catalogs[0]!.index.entries.reverse();
  local.content.entries = [...local.content.entries].reverse(); input.sources = [...input.sources].reverse();
  expect(validateImportInput(input)).toEqual(first);
  expect(first.ok).toBe(true); if (!first.ok) return;
  expect(Object.isFrozen(first.value)).toBe(true); expect(Object.isFrozen(first.value.input.packages[0]!.snapshot.manifest)).toBe(true);
  const retained = structuredClone(first.value);
  fileAt(local.content.entries, "SKILL.md").base64 = "";
  expect(first.value).toEqual(retained); expect(before.installed.entries).not.toEqual(input.installed.entries);
});
it("preflights all supplied manifest schema caps before inspecting even the first package", () => {
  const input = importInput(); input.packages[0]!.snapshot.manifest.description = "x".repeat(4097);
  noWork(input, "INVALID_MANIFEST");
});
it("rejects nonstring warning codes without JSON object coercion", () => {
  const input = importInput();
  Reflect.set(input.packages[0]!.snapshot.warnings[0]!, "code", { toString: null, valueOf: null });
  reject(input, "INVALID_IMPORT_INPUT", "packages");
});
