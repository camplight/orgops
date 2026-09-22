import fs from "node:fs";
import fsPromises from "node:fs/promises";
import childProcess from "node:child_process";
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import * as publicSkills from "../index";
import { afterEach, expect, it, vi } from "vitest";
import { prepareImport } from "./import";
import { importInput, measuredSkill } from "./import-fixtures";
import * as resolver from "./resolve";
import { createHash } from "node:crypto";
import { IMPORT_COMMIT, importSkill, importPin, importWithPackages, importReseal } from "./import-fixtures";
import { classicManifest, wrappedManifest, must } from "./fixtures";
import { computePackageDigest, type ContentEntry } from "./content";
import { IMPORT_LIMITS, type ImportInput, type ImportResult, type ImportPreview } from "./import-types";
import { validateImportInput } from "./import-evidence";
import { canonicalJson, normalizedManifest } from "./content";
import { CATALOG_LIMITS } from "@orgops/schemas";
import { exportSkillPackage } from "./export";
afterEach(() => vi.restoreAllMocks());
it("denied policy never delegates to the resolver", () => {
  const input = importInput(); input.sources[0]!.enabled = false;
  const spy = vi.spyOn(resolver, "resolvePackages");
  expect(prepareImport(input)).toEqual({ ok: false, issues: [{ code: "SOURCE_NOT_ALLOWED", at: "sources" }] });
  expect(spy).not.toHaveBeenCalled();
});
it("retains dependency-first complete review and never authorizes activation", () => {
  const spy = vi.spyOn(resolver, "resolvePackages"), r = prepareImport(importInput());
  expect(r.ok).toBe(true); if (!r.ok) throw new Error("Synthetic preview rejected");
  expect(spy).toHaveBeenCalledTimes(1);
  expect(r.value.packages.map(p => [p.identity.name, p.action])).toEqual([["echo-skill", "include"], ["echo-agent", "include"]]);
  expect(r.value.root.name).toBe("echo-agent");
  expect(r.value.packages[1]!.dependencies).toEqual([r.value.packages[0]!.identity]);
  expect(r.value.packages[0]!.snapshot.execution.apiEventShapes).toEqual(["event-shapes.ts"]);
  expect(r.value.packages[0]!.files.map(f => f.path)).toEqual(["SKILL.md", "event-shapes.ts", "orgops-package.json"]);
  expect(r.value.authority).toBe("none"); expect(r.value.reviewRequired).toBe(true);
});
it("blocks complete occupied namespace without any installed digest claim", () => {
  const input = importInput(); input.installed.entries = [{ state: "occupied", name: "ECHO-SKILL" }];
  expect(prepareImport(input)).toEqual({ ok: false, issues: [{ code: "SKILL_CONFLICT", at: "installed" }] });
});
it("reuses measured content without replacing lexical local manifest", () => {
  const input = importInput(), local = measuredSkill();
  if (local.state !== "measured") throw new Error("Synthetic fixture kind");
  const file = local.content.entries.find(e => e.path === "orgops-package.json");
  if (!file || file.type !== "file") throw new Error("Synthetic fixture file");
  file.base64 = Buffer.from(" \n" + Buffer.from(file.base64, "base64").toString() + "\r\n").toString("base64");
  input.installed.entries = [local];
  const r = prepareImport(input); expect(r.ok).toBe(true); if (!r.ok) throw new Error("Synthetic preview rejected");
  const skill = r.value.packages[0]!;
  expect(skill.action).toBe("reuse"); expect(skill.manifestBytes).toBe("current-installed-manifest");
  expect(skill.files.find(f => f.path === "orgops-package.json")!.base64).toBe(file.base64);
  expect(r.value.preconditions.installed.entries).toEqual([{ ...local, content: { complete: true, entries: [...local.content.entries].sort((a,b) => a.path < b.path ? -1 : 1) } }]);
});

function value(r: ImportResult<ImportPreview>): ImportPreview { expect(r.ok).toBe(true); if (!r.ok) throw new Error("Synthetic failure"); return r.value; }
function rejects(v: ImportInput, code: string, at: string): void {
  expect(prepareImport(v)).toEqual({ ok: false, issues: [{ code, at }] });
}
function replaceAgent(v: ImportInput, change: (m: typeof classicManifest) => void): void {
  const m = structuredClone(classicManifest); change(m); const snapshot = importReseal(m);
  v.packages.find(p => p.snapshot.manifest.name === "echo-agent")!.snapshot = snapshot;
  v.catalogs[0]!.index.entries.find(e => e.name === "echo-agent")!.digest = snapshot.manifest.digest;
}
it.each(["echo-skill", "echo-agent", "echo-repl", "echo-wrapper"])("prepares %s as an inert exact root", name => {
  const v = importInput(name), r = value(prepareImport(v));
  expect(r.root.name).toBe(name); expect(r.packages.at(-1)!.action).toBe("include");
  expect(Object.keys(r).sort()).toEqual(["authority", "kind", "packages", "preconditions", "reviewRequired", "root"]);
  for (const p of r.packages) {
    expect(Object.keys(p).sort()).toEqual(["action", "dependencies", "files", "identity", "manifestBytes", "snapshot"]);
    expect(p.snapshot.manifest).toEqual(v.packages.find(e => e.snapshot.manifest.name === p.identity.name)!.snapshot.manifest);
    for (const f of p.files) {
      const bytes = Buffer.from(f.base64, "base64"); expect(f.size).toBe(bytes.length);
      expect(f.digest).toBe(`sha256:${createHash("sha256").update(bytes).digest("hex")}`);
    }
    expect(p.manifestBytes).toBe("normalized-package-manifest");
  }
});
it("projects exporter-authored skill diamond once, with direct edges in canonical order", () => {
  const leaf = importSkill("leaf"), left = importSkill("left", [importPin(leaf)]), right = importSkill("right", [importPin(leaf)]);
  const root = importSkill("root", [importPin(right), importPin(left)]);
  const v = importWithPackages([right, leaf, left, root]), r = value(prepareImport(v));
  expect(r.packages.map(p => p.identity.name)).toEqual(["leaf", "left", "right", "root"]);
  expect(r.packages.map(p => p.dependencies.map(d => d.name))).toEqual([[], ["leaf"], ["leaf"], ["left", "right"]]);
});
it.each(["missing-root", "missing-dep", "bytes", "version", "digest", "commit", "same-revision-source", "known", "kind", "dependency-kind", "min", "max", "platform", "tools"])("rejects %s through exact resolution with one redacted issue", which => {
  const v = importInput(); let code = "IDENTITY_CONFLICT", at = "packages";
  if (["missing-root", "missing-dep", "bytes", "version"].includes(which)) {
    code = "MISSING_RELEASE"; at = "sources";
    if (which === "missing-root") v.root.name = "absent";
    if (which === "missing-dep") v.catalogs[0]!.index.entries = v.catalogs[0]!.index.entries.filter(e => e.name !== "echo-skill");
    if (which === "bytes") v.packages = v.packages.filter(p => p.snapshot.manifest.name !== "echo-skill");
    if (which === "version") replaceAgent(v, m => { m.dependencies[0]!.version = "2.0.0"; });
  }
  if (which === "digest") replaceAgent(v, m => { m.dependencies[0]!.digest = `sha256:${"0".repeat(64)}`; });
  if (which === "commit") replaceAgent(v, m => { m.dependencies[0]!.revision = { type: "exact", commit: "2".repeat(40) }; });
  if (which === "same-revision-source") {
    v.sources = [...v.sources, { sourceId: "other", repository: { url: "https://example.invalid/other.git" }, enabled: true, allowPackages: true }];
    replaceAgent(v, m => { m.dependencies[0]!.sourceId = "other"; }); code = "UNSUPPORTED_DEPENDENCY";
  }
  if (which === "known") { const local = measuredSkill(); if (local.state !== "measured") throw new Error("fixture"); v.knownReleases = [{ ...local.origin, path: "other" }]; }
  if (which === "kind") v.catalogs[0]!.index.entries.find(e => e.name === "echo-agent")!.kind = "skill";
  if (which === "dependency-kind") {
    const native = structuredClone(classicManifest); native.dependencies = []; native.native.alwaysPreloadedSkills = [];
    const dep = importReseal(native), root = importSkill("root", [importPin(dep)]);
    Object.assign(v, importWithPackages([dep, root])); code = "UNSUPPORTED_DEPENDENCY";
  }
  if (["min", "max", "platform", "tools"].includes(which)) {
    code = "INCOMPATIBLE"; at = "target";
    if (which === "min") v.target.orgopsVersion = "0.0.0";
    if (which === "max") v.target.orgopsVersion = "0.1.0";
    if (which === "platform") replaceAgent(v, m => { m.compatibility.platforms = ["darwin"]; });
    if (which === "tools") v.target.tools = [];
  }
  rejects(v, code, at);
});
it.each(["edit", "extra", "mode", "empty-directory", "blocked", "origin", "version", "resealed"])("never reuses selected independently measured %s", which => {
  const v = importInput(), local = measuredSkill(); if (local.state !== "measured") throw new Error("fixture");
  const f = local.content.entries.find(e => e.path === "SKILL.md"); if (!f || f.type !== "file") throw new Error("fixture");
  if (which === "edit") f.base64 = Buffer.from("edited separately").toString("base64");
  if (which === "extra") local.content.entries = [...local.content.entries, { type: "file", path: "extra", base64: "", executable: false }];
  if (which === "mode") f.executable = true;
  if (which === "empty-directory") local.content.entries = [...local.content.entries, { type: "directory", path: "empty" }];
  if (which === "blocked") local.content.entries = [...local.content.entries, { type: "blocked", path: "unreadable" }];
  if (which === "origin") local.origin.sourceId = "historical";
  if (which === "version") local.origin.version = "2.0.0";
  if (which === "resealed") {
    const root = local.content.entries.find(e => e.path === "orgops-package.json"); if (!root || root.type !== "file") throw new Error("fixture");
    const m = JSON.parse(Buffer.from(root.base64, "base64").toString()); m.author = "Local edit.";
    const entries = local.content.entries.filter((e): e is Extract<ContentEntry, { type: "file" }> => e.type === "file" && e.path !== "orgops-package.json");
    m.digest = must(computePackageDigest(m, entries)); root.base64 = Buffer.from(JSON.stringify(m)).toString("base64");
  }
  v.installed.entries = [local]; rejects(v, "SKILL_CONFLICT", "installed");
});
it.each(["occupied", "edited"])("unrelated %s occupancy does not block another root", which => {
  const v = importInput(wrappedManifest.name), local = measuredSkill();
  if (which === "occupied") v.installed.entries = [{ state: "occupied", name: "ECHO-SKILL" }];
  else { if (local.state !== "measured") throw new Error("fixture"); local.content.entries = []; v.installed.entries = [local]; }
  expect(value(prepareImport(v)).packages).toHaveLength(1);
});
it("catalog refresh preserves package revision and separately retained old local origin", () => {
  const v = importInput(), local = measuredSkill(); if (local.state !== "measured") throw new Error("fixture");
  v.installed.entries = [local]; v.knownReleases = [local.origin]; v.catalogs[0]!.commit = "2".repeat(40);
  for (const e of v.catalogs[0]!.index.entries) if (e.location.type === "catalog") e.location.revision = { type: "exact", commit: IMPORT_COMMIT };
  const r = value(prepareImport(v)), skill = r.packages[0]!;
  expect(skill.action).toBe("reuse"); expect(skill.identity.catalogCommit).toBe("2".repeat(40)); expect(skill.identity.packageCommit).toBe(IMPORT_COMMIT);
  expect(r.preconditions.installed.entries[0]).toEqual({ ...local, content: { complete: true, entries: [...local.content.entries].sort((a,b) => a.path < b.path ? -1 : 1) } });
});
it("preserves external catalog/package commits and exact cross-source pins", () => {
  const leaf = importSkill("leaf"), pin = { ...importPin(leaf), sourceId: "external", revision: { type: "exact" as const, commit: "2".repeat(40) } };
  const v = importWithPackages([leaf, importSkill("root", [pin])]);
  v.sources = [...v.sources, { sourceId: "external", repository: { url: "https://example.invalid/external.git" }, enabled: true, allowPackages: true }];
  v.packages[0]!.sourceId = "external"; v.packages[0]!.commit = "2".repeat(40);
  v.catalogs[0]!.index.entries[0]!.location = { type: "source", sourceId: "external", commit: "2".repeat(40), path: "packages/leaf" };
  const r = value(prepareImport(v)); expect(r.packages[0]!.identity).toMatchObject({ catalogCommit: IMPORT_COMMIT, packageCommit: "2".repeat(40), sourceId: "external" });
  expect(r.packages[1]!.dependencies).toEqual([r.packages[0]!.identity]);
});
it("detaches and deeply freezes deterministic output without freezing caller evidence", () => {
  const v = importInput(); v.installed.entries = [measuredSkill(), { state: "occupied", name: "unrelated" }];
  const before = structuredClone(v), first = value(prepareImport(v));
  v.sources = [...v.sources].reverse(); v.catalogs = [...v.catalogs].reverse(); v.catalogs[0]!.index.entries.reverse(); v.packages = [...v.packages].reverse();
  v.installed.entries = [...v.installed.entries].reverse(); v.target.tools.reverse();
  expect(value(prepareImport(v))).toEqual(first);
  const frozen = (x: unknown): void => { if (x && typeof x === "object") { expect(Object.isFrozen(x)).toBe(true); Object.values(x).forEach(frozen); } }; frozen(first);
  expect(Object.isFrozen(v)).toBe(false); v.sources[0]!.enabled = false;
  expect(first.preconditions.sources[0]!.enabled).toBe(true); expect(before.sources[0]!.enabled).toBe(true);
});
it("retains native auxiliary binary bytes, instructions, soul and per-package requirements", () => {
  const m = structuredClone(classicManifest); m.dependencies = []; m.native.alwaysPreloadedSkills = [];
  m.native.systemInstructions = "Authored instructions"; m.native.soulContents = "Authored soul";
  m.secrets = [{ name: "API_KEY", description: "A declared requirement, not a value", required: true }];
  const bytes = Buffer.from([0xff, 0xfe, 0, 1]);
  const f = { type: "file" as const, path: "assets/data.bin", base64: bytes.toString("base64"), executable: false };
  m.files = [{ path: f.path, size: bytes.length, digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, executable: false }];
  const snapshot = importReseal(m, [f]), r = value(prepareImport(importWithPackages([snapshot]))), p = r.packages[0]!;
  expect(p.snapshot.manifest).toEqual(snapshot.manifest);
  expect(p.files.find(e => e.path === f.path)).toEqual({ ...m.files[0], base64: f.base64, encoding: "binary" });
  expect(p.files.find(e => e.path === "orgops-package.json")!.encoding).toBe("utf8");
});
it("discloses every wrapped command and ordered argument without executing anything", () => {
  const m = structuredClone(wrappedManifest);
  m.wrapped.setup = { command: "setup-inert", checkCommand: "setup-check-inert", args: ["z", "a"] };
  m.wrapped.sidecars = [{ name: "one", command: "sidecar-inert", checkCommand: "sidecar-check-inert", args: ["2", "1"] }];
  m.wrapped.runtime = { command: "turn-inert", args: ["last", "first"] };
  m.wrapped.source = { type: "github", repo: "example/inert", ref: "main", updateOnStart: false };
  const snapshot = importReseal(m), p = value(prepareImport(importWithPackages([snapshot]))).packages[0]!;
  expect(p.snapshot.manifest).toEqual(snapshot.manifest);
  expect(p.snapshot.execution.wrappedCommands.map(c => c.command).sort()).toEqual(["setup-check-inert", "setup-inert", "sidecar-check-inert", "sidecar-inert", "turn-inert"]);
  expect(p.snapshot.execution.wrappedCommands.find(c => c.command === "turn-inert")!.args).toEqual(["last", "first"]);
  expect(p.snapshot.warnings.some(w => w.code === "EXTERNAL_RUNTIME_NOT_PINNED")).toBe(true);
});
const pretty = (m: typeof classicManifest): string => JSON.stringify(JSON.parse(canonicalJson(normalizedManifest(m))), null, 2) + "\n";
it.each([0, 1])("bounds actual pretty manifest at 256KiB plus %i before base64/hash", extra => {
  const m = structuredClone(classicManifest); m.dependencies = []; m.native.alwaysPreloadedSkills = [];
  m.native.systemInstructions = '"'.repeat(65536); m.native.soulContents = "";
  const remaining = CATALOG_LIMITS.manifestJsonBytes + extra - Buffer.byteLength(pretty(m));
  m.native.soulContents = '"'.repeat(Math.floor(remaining / 2)) + (remaining % 2 ? "a" : "");
  expect(m.native.soulContents.length).toBeLessThanOrEqual(65536);
  const snapshot = importReseal(m); expect(Buffer.byteLength(pretty(snapshot.manifest as typeof m))).toBe(262144 + extra);
  const v = importWithPackages([snapshot]);
  if (extra) rejects(v, "LIMIT_EXCEEDED", "review");
  else expect(value(prepareImport(v)).packages[0]!.files[0]!.size).toBe(262144);
});
async function reducedLimit(field: "outputFiles" | "outputDecodedBytes" | "outputJsonBytes", limit: number, run: (prepare: typeof prepareImport) => void): Promise<void> {
  vi.resetModules(); vi.doMock("./import-types", async () => {
    const actual = await vi.importActual<typeof import("./import-types")>("./import-types");
    return { ...actual, IMPORT_LIMITS: Object.freeze({ ...actual.IMPORT_LIMITS, [field]: limit }) };
  });
  try { run((await import("./import")).prepareImport); }
  finally { vi.doUnmock("./import-types"); vi.resetModules(); }
}
it.each(["outputFiles", "outputDecodedBytes", "outputJsonBytes"] as const)("independently charges exact complete %s and rejects one byte/file below", async field => {
  const v = importInput(); v.installed.entries = [measuredSkill()];
  const r = value(prepareImport(v));
  const used = field === "outputFiles" ? r.packages.reduce((n,p) => n + p.files.length, 0)
    : field === "outputDecodedBytes" ? r.packages.reduce((n,p) => n + p.files.reduce((s,f) => s + Buffer.from(f.base64,"base64").length, 0), 0)
      : Buffer.byteLength(JSON.stringify(r), "utf8");
  await reducedLimit(field, used, prepare => { expect(prepare(v)).toEqual({ ok: true, value: r }); });
  await reducedLimit(field, used - 1, prepare => { expect(prepare(v)).toEqual({ ok: false, issues: [{ code: "LIMIT_EXCEEDED", at: "review" }] }); });
});
it.each(["case-ancestor", "file-ancestor", "root-alias", "joined-path"])("fails closed for include %s with no partial preview", which => {
  const v = importInput(); const p = v.packages[0]!;
  const file = p.snapshot.files[0]!;
  const paths = which === "case-ancestor" ? ["A/x", "a/y"] : which === "file-ancestor" ? ["a", "a/x"] : which === "root-alias" ? ["ORGOPS-PACKAGE.JSON"]
    : [Array(3).fill("a".repeat(64)).join("/") + "/" + "b".repeat(35)];
  p.snapshot.files = paths.map(path => ({ ...file, path }));
  const r = prepareImport(v); expect(r.ok).toBe(false); expect(r).not.toHaveProperty("value");
  if (!r.ok) expect(r.issues).toEqual([{ code: which === "joined-path" ? "UNSAFE_PATH" : "DUPLICATE_PATH", at: "packages" }]);
});
it("redacts unexpected normal exceptions", () => {
  vi.spyOn(resolver, "resolvePackages").mockImplementation(() => { throw new Error("sensitive authored marker"); });
  rejects(importInput(), "INVALID_IMPORT_INPUT", "$");
});
it.each([0, 1])("charges every generated root at actual 8192 output-file boundary plus %i", extra => {
  const leaves = Array.from({ length: 32 }, (_, i) => {
    const base = importSkill(`leaf-${i}`), m = base.manifest;
    const count = i === 31 ? 253 + extra : 255;
    const entries: ContentEntry[] = [
      ...base.files.map(f => ({ type: "file" as const, path: f.path, base64: f.base64, executable: f.executable })),
      ...Array.from({ length: count - 1 }, (_, n) => ({ type: "file" as const, path: `assets/f${n}`, base64: "", executable: false })),
    ];
    return must(exportSkillPackage(entries, { metadata: { formatVersion: 1, name: m.name, version: m.version, description: m.description,
      author: m.author, license: m.license, compatibility: m.compatibility, secrets: [] }, dependencies: [], executables: [], selectedPaths: entries.map(f => f.path) })).snapshot;
  });
  const v = importWithPackages([...leaves, importSkill("root", leaves.map(importPin))]);
  expect(v.packages.reduce((n,p) => n + p.snapshot.files.length, 0)).toBe(8159 + extra);
  if (extra) rejects(v, "LIMIT_EXCEEDED", "review");
  else expect(value(prepareImport(v)).packages.reduce((n,p) => n + p.files.length, 0)).toBe(8192);
}, 30000);
it("preserves separate same-named requirements instead of flattening packages", () => {
  const leafManifest = structuredClone(importSkill("leaf").manifest);
  leafManifest.secrets = [{ name: "TOKEN", description: "Leaf requirement", required: true }];
  const original = importSkill("leaf");
  const leaf = importReseal(leafManifest, original.files.map(f => ({ type: "file", path: f.path, base64: f.base64, executable: f.executable })));
  const rootManifest = structuredClone(classicManifest); rootManifest.dependencies = [importPin(leaf)]; rootManifest.native.alwaysPreloadedSkills = ["leaf"];
  rootManifest.secrets = [{ name: "TOKEN", description: "Root requirement", required: false }];
  const r = value(prepareImport(importWithPackages([leaf, importReseal(rootManifest)])));
  expect(r.packages.map(p => p.snapshot.manifest.secrets)).toEqual([[{ name: "TOKEN", description: "Leaf requirement", required: true }], [{ name: "TOKEN", description: "Root requirement", required: false }]]);
});
it.each([256, 257])("bounds the reached closure at %i exact exporter-authored packages", count => {
  const leaves = Array.from({ length: count - 5 }, (_, i) => importSkill(`leaf-${i}`));
  const branches = Array.from({ length: 4 }, (_, i) => importSkill(`branch-${i}`, leaves.slice(i * 64, (i + 1) * 64).map(importPin)));
  const v = importWithPackages([...leaves, ...branches, importSkill("root", branches.map(importPin))]);
  if (count === 256) expect(value(prepareImport(v)).packages).toHaveLength(256);
  else rejects(v, "LIMIT_EXCEEDED", "sources");
}, 30000);
it("rejects real output JSON expansion beyond 64MiB without a partial preview", () => {
  const body = Buffer.alloc(1048576, 0xff), base64 = body.toString("base64"), digest = `sha256:${createHash("sha256").update(body).digest("hex")}`;
  const leaves = Array.from({ length: 4 }, (_, i) => {
    const s = importSkill(`large-${i}`), m = structuredClone(s.manifest);
    const extra = Array.from({ length: 6 }, (_, n) => ({ type: "file" as const, path: `assets/f${n}`, base64, executable: false }));
    m.files.push(...extra.map(f => ({ path: f.path, size: body.length, digest, executable: false })));
    return importReseal(m, [...s.files.map(f => ({ type: "file" as const, path: f.path, base64: f.base64, executable: f.executable })), ...extra]);
  });
  const v = importWithPackages([...leaves, importSkill("root", leaves.map(importPin))]);
  expect(Buffer.byteLength(JSON.stringify(v))).toBeLessThan(IMPORT_LIMITS.inputJsonBytes);
  expect(validateImportInput(v).ok).toBe(true);
  rejects(v, "LIMIT_EXCEEDED", "review");
}, 30000);
it("generated manifest bytes retain the full normalized portable definition", () => {
  const r = value(prepareImport(importInput()));
  for (const p of r.packages) {
    const f = p.files.find(e => e.path === "orgops-package.json")!;
    const text = Buffer.from(f.base64, "base64").toString("utf8");
    expect(JSON.parse(text)).toEqual(p.snapshot.manifest);
    expect(text.endsWith("\n")).toBe(true); expect(f.executable).toBe(false);
  }
});
it("independently checks the final complete output descriptor (fault injection)", async () => {
  const v = importInput(); let checks = 0;
  vi.resetModules(); vi.doMock("@orgops/schemas", async () => {
    const actual = await vi.importActual<typeof import("@orgops/schemas")>("@orgops/schemas");
    return { ...actual, validateCatalogJson: (data: unknown, max: number) => {
      const result = actual.validateCatalogJson(data, max);
      if (data && typeof data === "object" && "kind" in data && data.kind === "offline-import-preview"
        && "packages" in data && Array.isArray(data.packages) && data.packages.length > 0) {
        expect(result.ok).toBe(true); checks++;
        return { ok: false, issues: [{ code: "LIMIT_EXCEEDED", at: "sensitive marker" }] };
      }
      return result;
    } };
  });
  try {
    const { prepareImport: prepare } = await import("./import");
    expect(prepare(v)).toEqual({ ok: false, issues: [{ code: "LIMIT_EXCEEDED", at: "review" }] }); expect(checks).toBe(1);
  } finally { vi.doUnmock("@orgops/schemas"); vi.resetModules(); }
});

it("exposes only the offline import review API", () => {
  expect(publicSkills.prepareImport).toBeTypeOf("function");
  expect(Object.isFrozen(publicSkills.IMPORT_LIMITS)).toBe(true);
  for (const name of ["validateImportInput", "composeImportReview", "precheckPackageSources", "importInput", "measuredSkill"])
    expect(publicSkills).not.toHaveProperty(name);
  const r = publicSkills.prepareImport(importInput("echo-wrapper"));
  expect(r.ok).toBe(true); if (!r.ok) throw new Error("Synthetic preview rejected");
  expect(r.value.packages).toHaveLength(1); expect(r.value.authority).toBe("none");
  expect(r.value.packages[0]!.snapshot.manifest.kind).toBe("wrapped-agent");
});

// Supplemental acceptance guards: introducing any observable host effect must fail.
it.each([
  ["echo-skill", ["echo-skill"]],
  ["echo-agent", ["echo-skill", "echo-agent"]],
  ["echo-repl", ["echo-skill", "echo-repl"]],
  ["echo-wrapper", ["echo-wrapper"]],
] as const)("public %s review is synchronous and inert", (name, closure) => {
  const input = importInput(name); // All synthetic inspection setup precedes spies.
  const forbidden = (): never => { throw new Error("Unexpected host effect"); };
  const spies = [
    ...(["readFileSync", "writeFileSync", "lstatSync", "readdirSync", "existsSync"] as const).map(k => vi.spyOn(fs, k).mockImplementation(forbidden)),
    ...(["readFile", "writeFile", "lstat", "readdir"] as const).map(k => vi.spyOn(fsPromises, k).mockImplementation(forbidden)),
    ...(["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync"] as const).map(k => vi.spyOn(childProcess, k).mockImplementation(forbidden)),
    vi.spyOn(globalThis, "fetch").mockImplementation(forbidden),
    vi.spyOn(http, "request").mockImplementation(forbidden), vi.spyOn(http, "get").mockImplementation(forbidden),
    vi.spyOn(https, "request").mockImplementation(forbidden), vi.spyOn(https, "get").mockImplementation(forbidden),
    ...(["listSkills", "loadSkillMeta", "loadSkillEventShapes"] as const).map(k => vi.spyOn(publicSkills, k).mockImplementation(forbidden)),
    vi.spyOn(Date, "now").mockImplementation(forbidden), vi.spyOn(crypto, "randomUUID").mockImplementation(forbidden),
    ...(["log", "warn", "error", "info", "debug", "trace"] as const).map(k => vi.spyOn(console, k).mockImplementation(forbidden)),
  ];
  try {
    const result = publicSkills.prepareImport(input);
    expect(result).not.toBeInstanceOf(Promise);
    const r = value(result);
    expect(Object.keys(r).sort()).toEqual(["authority", "kind", "packages", "preconditions", "reviewRequired", "root"]);
    expect(r.authority).toBe("none"); expect(r.reviewRequired).toBe(true);
    expect(r.packages.map(p => p.identity.name)).toEqual(closure);
    for (const p of r.packages) {
      const supplied = input.packages.find(e => e.snapshot.manifest.name === p.identity.name)!.snapshot;
      expect(p.snapshot.manifest).toEqual(supplied.manifest);
      expect(p.files.map(f => f.path)).toEqual([...supplied.files.map(f => f.path), "orgops-package.json"].sort());
      expect(p.snapshot.execution).toEqual(supplied.execution);
      expect(p.dependencies.map(d => d.name)).toEqual(p.snapshot.manifest.dependencies.map(d => d.name));
      expect(Object.keys(p).sort()).toEqual(["action", "dependencies", "files", "identity", "manifestBytes", "snapshot"]);
      expect(p.action).toBe("include");
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally { vi.restoreAllMocks(); }
});

it.each(["callback", "bindings", "secretValues", "approved", "installedAgent", "runner", "database", "currentDigest", "install", "start"])(
  "public input rejects unauthorized %s fields with a fixed redacted issue", field => {
    const input = { ...importInput(), [field]: field === "callback" ? () => "authored-sensitive-marker" : "authored-sensitive-marker" };
    const r = publicSkills.prepareImport(input);
    expect(r).toEqual({ ok: false, issues: [{ code: field === "callback" ? "INVALID_JSON" : "INVALID_IMPORT_INPUT", at: "$" }] });
    expect(JSON.stringify(r)).not.toContain("authored-sensitive-marker");
  },
);
it("public input rejects secret values inside portable requirements", () => {
  const input = importInput();
  Object.assign(input.packages[0]!.snapshot.manifest, { secrets: [{ name: "TOKEN", description: "Requirement", required: true, value: "authored-sensitive-marker" }] });
  expect(publicSkills.prepareImport(input)).toEqual({ ok: false, issues: [{ code: "INVALID_MANIFEST", at: "packages" }] });
});
