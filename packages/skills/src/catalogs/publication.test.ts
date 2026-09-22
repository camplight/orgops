import { describe, expect, it, vi } from "vitest";
import { composePublication } from "./publication";
import { publicationInput, publicationValue as value, promotePublication, publicationSkill,
  bytes, digest, BASE } from "./publication-fixtures";
import { PUBLICATION_LIMITS, type PublicationInput, type PublicationTreeEntry } from "./publication-types";
import { canonicalJson } from "./content";
import { exportAgentPackage } from "./export";
import { must, wrappedManifest } from "./fixtures";

describe("composePublication", () => {
  it("composes exact additions and lexical index before bytes without mutating input", () => {
    const v = publicationInput(), before = structuredClone(v);
    const r = composePublication(v);
    expect(r.ok).toBe(true); if (!r.ok) throw new Error("fixture");
    expect(r.value.changes.map(c => c.path)).toEqual([
      "catalog/index.json", "packages/echo-skill/1.0.0/SKILL.md",
      "packages/echo-skill/1.0.0/event-shapes.ts", "packages/echo-skill/1.0.0/orgops-package.json",
    ]);
    expect(r.value.changes[0]!.before!.base64).toBe(v.base.indexBase64);
    expect(r.value.releases[0]!.identity.packageRevision).toEqual({ type: "proposal" });
    expect(r.value.preconditions.requiredAbsentPaths).toEqual(["packages/echo-skill/1.0.0"]);
    expect(r.value).not.toHaveProperty("scan");
    expect(r.value).not.toHaveProperty("proposalDigest");
    expect(v).toEqual(before);
    expect(Object.isFrozen(r.value.releases[0]!.snapshot.manifest)).toBe(true);
    expect(Object.isFrozen(v)).toBe(false);
  });
  it("does not overwrite an unindexed occupied directory", () => {
    const v = publicationInput();
    v.base.inventory.entries = [...v.base.inventory.entries,
      { type: "directory", path: "packages" }, { type: "directory", path: "packages/echo-skill" },
      { type: "directory", path: "packages/echo-skill/1.0.0" }];
    expect(composePublication(v)).toEqual({ ok: false, issues: [{ code: "DESTINATION_CONFLICT", at: "selections.destinationPath" }] });
  });
});


function published(): PublicationInput {
  const v = publicationInput();
  return promotePublication(v, value(composePublication(v)));
}
function setIndex(v: PublicationInput, entries: unknown[]): void {
  const text = JSON.stringify({ formatVersion: 1, entries });
  v.base.indexBase64 = bytes(text);
  v.base.inventory.entries = v.base.inventory.entries.map(e => e.path === v.base.indexPath
    ? { type: "file", path: e.path, size: Buffer.byteLength(text), digest: digest(text), executable: false } : e);
}

describe("immutable lifecycle", () => {
  it("freezes old contextual releases, preserves their provenance and adds only the next version", () => {
    const v = published(), original = structuredClone(v.base.history.releases[0]!);
    v.selections = [{ candidate: publicationSkill("echo-skill", "2.0.0"), destinationPath: "packages/echo-skill/2.0.0", intent: "update", origin: original }];
    const r = value(composePublication(v));
    expect(r.proposedIndex.entries[0]!.location).toEqual({ type: "catalog", path: "packages/echo-skill/1.0.0", revision: { type: "exact", commit: "2".repeat(40) } });
    expect(r.proposedIndex.entries[1]!.location).toEqual({ type: "catalog", path: "packages/echo-skill/2.0.0", revision: { type: "catalog-revision" } });
    expect(r.preconditions.history.releases).toEqual([original]);
    expect(r.selections[0]!.origin).toEqual(original);
    expect(r.changes.filter(c => c.before !== null).map(c => c.path)).toEqual(["catalog/index.json"]);
    expect(r.changes.some(c => c.path.includes("/1.0.0/"))).toBe(false);
  });
  it("allows exact no-op reuse and a fully empty change set after canonical freezing", () => {
    const v = published(), r = value(composePublication(v));
    expect(r.selections[0]!.disposition).toBe("existing");
    expect(r.changes.map(c => c.path)).toEqual(["catalog/index.json"]);
    expect(r.releases[0]!.identity.packageRevision).toEqual({ type: "exact", commit: "2".repeat(40) });
    const next = promotePublication(v, r, "3".repeat(40));
    expect(value(composePublication(next)).changes).toEqual([]);
    expect(value(composePublication(next)).releases[0]!.identity.packageRevision).toEqual({ type: "exact", commit: "2".repeat(40) });
  });
  it.each(["digest", "path", "extra-file", "blocked", "empty-child", "manifest-mode", "manifest-bytes", "absent-tree", "missing-snapshot", "external"])("rejects non-equivalent same-version reuse: %s", mutation => {
    const v = published(), s = v.selections[0]!;
    if (mutation === "digest") s.candidate = publicationSkill();
    if (mutation === "path") s.destinationPath = "another-root";
    if (mutation === "missing-snapshot") v.packages = [];
    if (mutation === "absent-tree") v.base.inventory.entries = v.base.inventory.entries.filter(e => !e.path.startsWith("packages"));
    if (["extra-file", "blocked", "empty-child"].includes(mutation)) {
      const path = `${s.destinationPath}/extra`;
      const e: PublicationTreeEntry = mutation === "empty-child" ? { type: "directory", path }
        : mutation === "blocked" ? { type: "blocked", path } : { type: "file", path, size: 0, digest: digest(""), executable: false };
      v.base.inventory.entries = [...v.base.inventory.entries, e];
    }
    if (mutation.startsWith("manifest-")) v.base.inventory.entries = v.base.inventory.entries.map(e => e.type === "file" && e.path.endsWith("orgops-package.json")
      ? { ...e, ...(mutation === "manifest-mode" ? { executable: true } : { digest: digest("different bytes") }) } : e);
    if (mutation === "external") {
      const i = v.base.history.releases[0]!;
      setIndex(v, [{ kind: i.kind, name: i.name, version: i.version, digest: i.digest, location: { type: "source", sourceId: i.sourceId, commit: i.packageCommit, path: i.path } }]);
    }
    expect(composePublication(v).ok).toBe(false);
  });
  it("reserves removed releases and all historical package regions", () => {
    const v = published();
    setIndex(v, []);
    v.base.inventory.entries = v.base.inventory.entries.filter(e => !e.path.startsWith("packages"));
    v.selections[0]!.destinationPath = "absent";
    expect(composePublication(v)).toEqual({ ok: false, issues: [{ code: "IDENTITY_CONFLICT", at: "selections" }] });
    v.selections[0]!.candidate = publicationSkill("echo-skill", "2.0.0");
    v.selections[0]!.destinationPath = "packages/echo-skill/1.0.0/child";
    expect(composePublication(v)).toEqual({ ok: false, issues: [{ code: "DESTINATION_CONFLICT", at: "selections.destinationPath" }] });
  });
  it.each(["update", "new-release", "new-destination"] as const)("requires explicit new-destination for same-repository name changes: %s", intent => {
    const v = published(), origin = v.base.history.releases[0]!;
    v.selections = [{ candidate: publicationSkill("new-name"), destinationPath: "packages/new-name/1.0.0", intent, origin }];
    const r = composePublication(v);
    if (intent !== "new-destination") expect(r).toEqual({ ok: false, issues: [{ code: "ORIGIN_CONFLICT", at: "selections.origin" }] });
    else {
      expect(value(r).selections[0]!.origin).toEqual(origin);
      expect(value(r).proposedIndex.entries.map(e => e.name)).toEqual(["echo-skill", "new-name"]);
    }
  });
  it.each(["missing", "unknown", "wrong-content"])("rejects %s origin evidence", mutation => {
    const v = published();
    const origin = structuredClone(v.base.history.releases[0]!);
    if (mutation === "unknown") origin.version = "8.0.0";
    if (mutation === "wrong-content") origin.digest = digest("wrong");
    v.selections = [{ candidate: publicationSkill("echo-skill", "2.0.0"), destinationPath: "new", intent: "update", origin: mutation === "missing" ? null : origin }];
    expect(composePublication(v).ok).toBe(false);
  });
  it.each(["sourceId", "path"] as const)("rejects retained identity %s swaps", field => {
    const v = published();
    if (field === "sourceId") {
      v.sources = [...v.sources, { sourceId: "other", repository: { url: "https://example.invalid/other.git" }, enabled: true, allowPackages: true }];
      v.base.history.releases[0]![field] = "other";
    } else v.base.history.releases[0]![field] = "other";
    expect(composePublication(v).ok).toBe(false);
  });
});

describe("full inert changes", () => {
  it("creates only an explicitly absent index and records its absence", () => {
    const v = publicationInput(); v.base.indexBase64 = null; v.base.indexPath = "new-index.json"; v.base.inventory.entries = [];
    const r = value(composePublication(v));
    expect(r.preconditions.requiredAbsentPaths).toEqual(["new-index.json", "packages/echo-skill/1.0.0"]);
    expect(r.changes.every(c => c.before === null)).toBe(true);
    expect(r.changes.find(c => c.path === "new-index.json")!.after.executable).toBe(false);
  });
  it("retains binary bytes and full executable modes without lossy text repair", () => {
    const v = publicationInput();
    v.selections[0]!.candidate = publicationSkill("echo-skill", "1.0.0", [], [{ path: "data.bin", base64: "/wAB", executable: true }]);
    const r = value(composePublication(v)), c = r.changes.find(c => c.path.endsWith("data.bin"))!;
    expect(c.after.base64).toBe("/wAB"); expect(c.after.size).toBe(3); expect(c.after.executable).toBe(true);
    expect(c.review).toEqual({ before: "absent", after: "binary" });
    expect(r.changes.find(c => c.path.endsWith("orgops-package.json"))!.after.executable).toBe(false);
  });
  it("retains every wrapped command/check/argument and does not run them", () => {
    const v = publicationInput(), m = structuredClone(wrappedManifest);
    const { resourceWiring: _, ...wrappedConfig } = m.wrapped;
    wrappedConfig.setup = { command: "setup", checkCommand: "setup-check", args: ["b", "a"] };
    wrappedConfig.sidecars = [{ name: "side", command: "side", checkCommand: "side-check", args: ["2", "1"] }];
    wrappedConfig.runtime = { command: "turn", args: ["z", "x"] };
    v.selections[0]!.candidate = must(exportAgentPackage({ mode: "WRAPPED", wrappedConfig }, { metadata: {
      formatVersion: 1, name: m.name, version: m.version, description: m.description, author: m.author, license: m.license,
      compatibility: m.compatibility, secrets: m.secrets }, dependencies: [] }));
    const r = value(composePublication(v));
    expect(r.releases[0]!.snapshot.execution.wrappedCommands.map(c => [c.command, c.args])).toEqual([
      ["setup", ["b", "a"]], ["setup-check", ["b", "a"]], ["side", ["2", "1"]], ["side-check", ["2", "1"]], ["turn", ["z", "x"]],
    ]);
    const manifestFile = r.changes.find(c => c.path.endsWith("orgops-package.json"))!;
    expect(JSON.parse(Buffer.from(manifestFile.after.base64, "base64").toString()).wrapped).toEqual(r.releases[0]!.snapshot.manifest.kind === "wrapped-agent" ? r.releases[0]!.snapshot.manifest.wrapped : null);
  });
  it.each([BASE, "a".repeat(64), "0".repeat(64)])("binds the supplied base commit %s without inventing live provenance", commit => {
    const v = publicationInput(); v.base.commit = commit;
    const r = value(composePublication(v));
    expect(r.preconditions.baseCommit).toBe(commit);
    expect(r.releases[0]!.identity.packageRevision).toEqual({ type: "proposal" });
  });
  it("detaches policy, content, origins and inventory and canonicalizes input order", () => {
    const v = published(), origin = structuredClone(v.base.history.releases[0]!);
    v.selections = [{ candidate: publicationSkill("new-name"), destinationPath: "new-name", intent: "new-destination", origin },
      { candidate: publicationSkill("another-name"), destinationPath: "another-name", intent: "new-release", origin: null }];
    const before = structuredClone(v), r = value(composePublication(v));
    v.selections = [...v.selections].reverse(); v.packages = [...v.packages].reverse();
    v.base.inventory.entries = [...v.base.inventory.entries].reverse();
    expect(value(composePublication(v))).toEqual(r);
    expect(canonicalJson(r)).toBe(canonicalJson(value(composePublication(before))));
    v.base.commit = "9".repeat(40); origin.name = "changed";
    expect(r.preconditions.baseCommit).toBe("2".repeat(40));
    expect(r.selections.find(s => s.name === "new-name")!.origin!.name).toBe("echo-skill");
    expect(Object.isFrozen(r.preconditions.inventory.entries[0])).toBe(true);
    expect(Object.isFrozen(v.base.inventory.entries[0])).toBe(false);
  });
  it("rejects new evidence whose index metadata no longer matches exact bytes", () => {
    const v = publicationInput(), r = value(composePublication(v));
    v.base.commit = "3".repeat(40);
    expect(value(composePublication(v)).preconditions).not.toEqual(r.preconditions);
    v.base.indexBase64 = bytes("{}");
    expect(composePublication(v).ok).toBe(false);
  });
  it("returns a single redacted failure for runtime-invalid input", () => {
    expect(composePublication(null as unknown as PublicationInput)).toEqual({ ok: false, issues: [{ code: "INVALID_PUBLICATION_INPUT", at: "$" }] });
  });
});


describe("complete bounded output", () => {
  it.each([0, 1])("enforces the real changed-file count boundary plus %s", extra => {
    const v = publicationInput();
    v.selections = Array.from({ length: 16 }, (_, n) => ({
      candidate: publicationSkill(`skill-${n}`, "1.0.0", [], Array.from({ length: n < 15 ? 255 : 238 + extra }, (_, f) => ({ path: `f-${f}.txt`, base64: "", executable: false }))),
      destinationPath: `skill-${n}`, intent: "new-release", origin: null,
    }));
    const r = composePublication(v);
    if (extra) expect(r).toEqual({ ok: false, issues: [{ code: "LIMIT_EXCEEDED", at: "changes" }] });
    else expect(value(r).changes).toHaveLength(4096);
  });
  it("enforces the defense-in-depth output byte guard at exact bound and plus one under a reduced test-only module limit", async () => {
    const v = publicationInput(), baseline = value(composePublication(v));
    const exactBytes = baseline.changes.reduce((sum, c) => sum + (c.before?.size ?? 0) + c.after.size, 0);
    // Real inputs cannot reach the 32MiB output cap under the tighter repeated
    // input-occurrence budgets. Only outputBytes is lowered in this isolated module.
    for (const limit of [exactBytes, exactBytes - 1]) {
      vi.resetModules();
      vi.doMock("./publication-types", async importOriginal => {
        const actual = await importOriginal<typeof import("./publication-types")>();
        return { ...actual, PUBLICATION_LIMITS: Object.freeze({ ...actual.PUBLICATION_LIMITS, outputBytes: limit }) };
      });
      try {
        const { composePublication: bounded } = await import("./publication");
        const r = bounded(v);
        if (limit === exactBytes) expect(value(r)).toEqual(baseline);
        else expect(r).toEqual({ ok: false, issues: [{ code: "LIMIT_EXCEEDED", at: "changes" }] });
      } finally { vi.doUnmock("./publication-types"); vi.resetModules(); }
    }
    expect((await import("./publication-types")).PUBLICATION_LIMITS.outputBytes).toBe(33554432);
    expect(PUBLICATION_LIMITS.outputBytes).toBe(33554432);
    expect(Object.isFrozen(PUBLICATION_LIMITS)).toBe(true);
  });
  it("rejects a final index that exceeds the per-index entry count without truncation", () => {
    const v = publicationInput();
    const entries = Array.from({ length: 4096 }, (_, n) => ({ kind: "skill", name: `old-${n}`, version: "1.0.0", digest: digest("old"),
      location: { type: "catalog", path: `old-${n}`, revision: { type: "exact", commit: "8".repeat(40) } } }));
    setIndex(v, entries);
    expect(composePublication(v).ok).toBe(false);
  });
  it("checks the actual pretty-serialized final index byte size", () => {
    const v = publicationInput();
    // Compact old bytes fit 2MiB; actual canonical pretty proposal does not.
    const entries = Array.from({ length: 4095 }, (_, n) => ({ kind: "skill", name: `old-${n}-${"n".repeat(50)}`, version: "999999.999999.999999", digest: digest("old"),
      location: { type: "catalog", path: `${"a".repeat(60)}/${"b".repeat(60)}/${"c".repeat(30)}/old-${n}`, revision: { type: "exact", commit: "8".repeat(64) } } }));
    setIndex(v, entries);
    expect(Buffer.from(v.base.indexBase64!, "base64").length).toBeLessThan(2097152);
    const r = composePublication(v); expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]!.code).toBe("LIMIT_EXCEEDED");
  });
});

describe("portable proposed ancestor casing", () => {
  it("rejects case-twin implicit directories inside a selected package", () => {
    const v = publicationInput();
    v.selections[0]!.candidate = publicationSkill("echo-skill", "1.0.0", [], [
      { path: "A/x.txt", base64: "", executable: false }, { path: "a/y.txt", base64: "", executable: false },
    ]);
    expect(composePublication(v)).toEqual({ ok: false, issues: [{ code: "DESTINATION_CONFLICT", at: "selections.destinationPath" }] });
  });
  it("rejects inconsistent shared-parent spelling across distinct new roots", () => {
    const v = publicationInput();
    v.selections = [{ candidate: publicationSkill("one"), destinationPath: "Parent/one", intent: "new-release", origin: null },
      { candidate: publicationSkill("two"), destinationPath: "parent/two", intent: "new-release", origin: null }];
    expect(composePublication(v)).toEqual({ ok: false, issues: [{ code: "DESTINATION_CONFLICT", at: "selections.destinationPath" }] });
  });
  it("rejects implicit package ancestors that case-alias a newly created index ancestor", () => {
    const v = publicationInput(); v.base.indexBase64 = null; v.base.inventory.entries = [];
    v.base.indexPath = "Parent/index.json"; v.selections[0]!.destinationPath = "parent/skill";
    expect(composePublication(v)).toEqual({ ok: false, issues: [{ code: "DESTINATION_CONFLICT", at: "selections.destinationPath" }] });
  });
  it("rejects case-aliases of an existing base directory", () => {
    const v = publicationInput();
    v.base.inventory.entries = [...v.base.inventory.entries, { type: "directory", path: "Parent" }];
    v.selections[0]!.destinationPath = "parent/skill";
    expect(composePublication(v)).toEqual({ ok: false, issues: [{ code: "DESTINATION_CONFLICT", at: "selections.destinationPath" }] });
  });
  it("retains consistently cased shared directories for packages and a new index", () => {
    const v = publicationInput(); v.base.indexBase64 = null; v.base.indexPath = "Parent/index.json";
    v.base.inventory.entries = [{ type: "directory", path: "Parent" }];
    v.selections = [{ candidate: publicationSkill("one"), destinationPath: "Parent/one", intent: "new-release", origin: null },
      { candidate: publicationSkill("two"), destinationPath: "Parent/two", intent: "new-release", origin: null }];
    expect(value(composePublication(v)).changes.map(c => c.path)).toEqual([
      "Parent/index.json", "Parent/one/SKILL.md", "Parent/one/orgops-package.json", "Parent/two/SKILL.md", "Parent/two/orgops-package.json",
    ]);
  });
});

// Public integration: the scanner must cover serialized manifest bytes, not just content.
import * as publicSkills from "../index";
import { createHash } from "node:crypto";
import fs from "node:fs";
import childProcess from "node:child_process";
import http from "node:http";
import https from "node:https";
import { publicationNative, publicationPin } from "./publication-fixtures";
import type { ExportCandidate } from "./export";
import type { PublicationProposal } from "./publication-types";

function metadataOnly(m: import("@orgops/schemas").PackageMetadata): import("@orgops/schemas").PackageMetadata {
  return { formatVersion: 1, name: m.name, version: m.version, description: m.description, author: m.author,
    license: m.license, compatibility: m.compatibility, secrets: m.secrets };
}
function prepared(candidate: ExportCandidate): PublicationProposal {
  const v = publicationInput(); v.selections = [{ ...v.selections[0]!, candidate }];
  return value(publicSkills.preparePublication(v));
}
function independentCanonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(independentCanonical).join(",")}]`;
  if (v !== null && typeof v === "object") return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${independentCanonical(Reflect.get(v, k))}`).join(",")}}`;
  return JSON.stringify(v);
}
function assertFrozen(v: unknown): void {
  if (v && typeof v === "object") { expect(Object.isFrozen(v)).toBe(true); Object.values(v).forEach(assertFrozen); }
}
const signals = [
  ["ghp_" + "a".repeat(20), "TOKEN_PREFIX"],
  ["-----BEGIN PRIVATE KEY-----", "PRIVATE_KEY_HEADER"],
  ["password=synthetic-marker", "CREDENTIAL_ASSIGNMENT"],
] as const;

describe("preparePublication public API", () => {
  it("is synchronous, inert, fully detached/frozen and checksummed without invented provenance", () => {
    const v = publicationInput(), original = structuredClone(v);
    // These entrypoints perform real I/O/active discovery if called. None belongs in preparation.
    const spies = [vi.spyOn(fs, "readFileSync"), vi.spyOn(fs, "existsSync"), vi.spyOn(fs, "readdirSync"),
      vi.spyOn(childProcess, "spawn"), vi.spyOn(childProcess, "execFile"), vi.spyOn(http, "request"), vi.spyOn(https, "request"),
      vi.spyOn(publicSkills, "loadSkillMeta"), vi.spyOn(publicSkills, "loadSkillEventShapes"), vi.spyOn(publicSkills, "listSkills")];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("network called"); });
    try {
      const r = publicSkills.preparePublication(v); expect(r).not.toBeInstanceOf(Promise);
      const p = value(r); assertFrozen(p); expect(v).toEqual(original); expect(Object.isFrozen(v.base)).toBe(false);
      const { proposalDigest, ...data } = p;
      expect(proposalDigest).toBe(`sha256:${createHash("sha256").update("orgops-publication-proposal-v1\n" + independentCanonical(data)).digest("hex")}`);
      expect(p.scan).toEqual({ kind: "supplementary", version: 1, binaryFiles: [] });
      expect(p.findings).toEqual([]); expect(p.reviewRequired).toBe(true);
      for (const key of ["ready", "approved", "safe", "writeToken", "override"]) expect(p).not.toHaveProperty(key);
      expect(p.releases[0]!.identity.catalogRevision).toEqual({ type: "proposal" });
      expect(p.releases[0]!.identity.packageRevision).toEqual({ type: "proposal" });
      expect(p.releases[0]!.snapshot.execution.apiEventShapes).toEqual(["event-shapes.ts"]);
      expect(Buffer.from(p.changes.find(c => c.path.endsWith("/event-shapes.ts"))!.after.base64, "base64").toString()).toBe('throw new Error("catalog inspection executed");\n');
      expect(JSON.stringify(p)).not.toContain('"commit":"' + "0".repeat(64) + '"');
      v.base.commit = "3".repeat(40); expect(p.preconditions.baseCommit).toBe(BASE);
      spies.forEach(s => expect(s).not.toHaveBeenCalled()); expect(fetchSpy).not.toHaveBeenCalled();
    } finally { spies.forEach(s => s.mockRestore()); fetchSpy.mockRestore(); }
  });
  it.each(["CLASSIC", "RLM_REPL"] as const)("exposes full %s previews and preserves exporter exclusions", mode => {
    const m = publicationNative([], mode).snapshot.manifest;
    const candidate = must(exportAgentPackage({ mode, systemInstructions: "portable", soulContents: "soul", secret: "EXCLUDED-MARKER", modelId: "EXCLUDED-MARKER", runnerId: "EXCLUDED-MARKER", workspacePath: "EXCLUDED-MARKER" }, { metadata: metadataOnly(m), dependencies: [] }));
    const p = prepared(candidate);
    expect(p.releases[0]!.snapshot.manifest.kind).toBe("native-agent");
    expect(JSON.stringify(p)).not.toContain("EXCLUDED-MARKER");
    expect(p.changes.find(c => c.path.endsWith("orgops-package.json"))!.after.base64).toBe(candidate.proposedFiles[0]!.base64);
  });
  it.each(signals)("scans %s in skill text and full native prompt/soul/metadata bytes", (text, rule) => {
    const skill = publicationSkill("echo-skill", "1.0.0", [], [{ path: "notes.txt", base64: bytes(text), executable: false }]);
    expect(prepared(skill).findings.some(f => f.path.endsWith("/notes.txt") && f.ruleId === rule)).toBe(true);
    for (const field of ["systemInstructions", "soulContents", "author", "license", "description", "secrets"] as const) {
      const metadata = { ...metadataOnly(skill.snapshot.manifest),
        ...(field === "author" || field === "license" || field === "description" ? { [field]: text } : {}),
        ...(field === "secrets" ? { secrets: [{ name: "REQUIRED", description: text, required: true }] } : {}) };
      const candidate = must(exportAgentPackage({ mode: "CLASSIC", systemInstructions: "clean", ...(field === "systemInstructions" || field === "soulContents" ? { [field]: text } : {}) }, { metadata, dependencies: [] }));
      const p = prepared(candidate);
      expect(p.findings.some(f => f.path.endsWith("orgops-package.json") && f.ruleId === rule)).toBe(true);
      expect(JSON.stringify(p.findings)).not.toContain(text);
      expect(Buffer.from(p.changes.find(c => c.path.endsWith("orgops-package.json"))!.after.base64, "base64").toString()).toContain(text);
    }
  });
  it.each(signals)("scans %s in every wrapped command/argument seam", (text, rule) => {
    for (const field of ["setup", "setupCheck", "setupArgs", "sidecar", "sidecarCheck", "sidecarArgs", "runtime", "runtimeArgs"]) {
      const wrappedConfig = { kind: "custom", harness: "command", setup: { command: field === "setup" ? text : "echo setup", checkCommand: field === "setupCheck" ? text : "echo check", args: [field === "setupArgs" ? text : "arg"] },
        sidecars: [{ name: "helper", command: field === "sidecar" ? text : "echo side", checkCommand: field === "sidecarCheck" ? text : "echo check", args: [field === "sidecarArgs" ? text : "arg"] }],
        runtime: { command: field === "runtime" ? text : "echo turn", args: [field === "runtimeArgs" ? text : "arg"] }, session: { scope: "per-channel" } };
      const candidate = must(exportAgentPackage({ mode: "WRAPPED", wrappedConfig, systemInstructions: "EXCLUDED-MARKER" }, { metadata: metadataOnly(wrappedManifest), dependencies: [] }));
      const p = prepared(candidate);
      expect(p.findings.some(f => f.ruleId === rule)).toBe(true);
      expect(p.releases[0]!.snapshot.execution.wrappedCommands).toHaveLength(5);
      expect(JSON.stringify(p.releases[0]!.snapshot.execution)).toContain(text);
      expect(JSON.stringify(p)).not.toContain("EXCLUDED-MARKER");
    }
  });
  it("scans lexical before-index text too and retains exact bytes", () => {
    const v = publicationInput();
    const text = '{"formatVersion":1,"entries":[],"entries":[],"formatVersion":1}';
    // Valid duplicate JSON keys can contain earlier ignored authored text, which still needs review.
    const old = text.replace('"entries":[]', '"entries":"password=synthetic-before-marker"');
    v.base.indexBase64 = bytes(old);
    v.base.inventory.entries = v.base.inventory.entries.map(e => e.type === "file" ? { ...e, size: Buffer.byteLength(old), digest: digest(old) } : e);
    const p = value(publicSkills.preparePublication(v));
    expect(p.findings).toEqual([{ ruleId: "CREDENTIAL_ASSIGNMENT", severity: "warning", path: "catalog/index.json", side: "before", line: 1, column: old.indexOf("password") + 1 }]);
    expect(p.changes[0]!.before!.base64).toBe(bytes(old));
  });
  it("binds exact evidence/bytes/policy/origin to checksum, but not input ordering", () => {
    const v = publicationInput(), baseline = value(publicSkills.preparePublication(v));
    const variants = [structuredClone(v), structuredClone(v), structuredClone(v), structuredClone(v)];
    variants[0]!.base.commit = "4".repeat(40);
    variants[1]!.sources[0]!.allowPackages = true;
    variants[2]!.sources[0]!.repository = variants[2]!.base.repository = { url: "https://other.invalid/catalog.git" };
    const old = Buffer.from(v.base.indexBase64!, "base64").toString() + "\n";
    variants[3]!.base.indexBase64 = bytes(old);
    variants[3]!.base.inventory.entries = variants[3]!.base.inventory.entries.map(e => e.type === "file" ? { ...e, size: Buffer.byteLength(old), digest: digest(old) } : e);
    for (const variant of variants) expect(value(publicSkills.preparePublication(variant)).proposalDigest).not.toBe(baseline.proposalDigest);
    const origin = { catalogId: "other", catalogCommit: BASE, sourceId: "team-source", packageCommit: BASE, path: "old", kind: "skill" as const, name: "echo-skill", version: "1.0.0", digest: v.selections[0]!.candidate.snapshot.manifest.digest };
    const a = structuredClone(v); a.knownReleases = [origin];
    const b = structuredClone(a); b.selections[0]!.intent = "new-destination"; b.selections[0]!.origin = origin;
    expect(value(publicSkills.preparePublication(a)).proposalDigest).not.toBe(value(publicSkills.preparePublication(b)).proposalDigest);
    const dep = publicationSkill(); const agent = publicationNative([publicationPin(dep)]);
    const closure = publicationInput(); closure.selections = [{ ...closure.selections[0]!, candidate: dep }, { ...closure.selections[0]!, candidate: agent, destinationPath: "agents/echo" }];
    const p = value(publicSkills.preparePublication(closure)); expect(p.releases.map(r => r.identity.name)).toEqual(["echo-skill", "echo-agent"]);
    closure.selections = [...closure.selections].reverse(); closure.base.inventory.entries = [...closure.base.inventory.entries].reverse();
    expect(value(publicSkills.preparePublication(closure))).toEqual(p);
  });
  it("binds binary content, executable bits, manifest text and scan changes without rewriting temporary-looking authored strings", () => {
    const proposals = [
      prepared(publicationSkill("echo-skill", "1.0.0", [], [{ path: "blob.dat", base64: "/w==", executable: false }])),
      prepared(publicationSkill("echo-skill", "1.0.0", [], [{ path: "blob.dat", base64: "/g==", executable: false }])),
      prepared(publicationSkill("echo-skill", "1.0.0", [], [{ path: "blob.dat", base64: "/w==", executable: true }])),
      prepared(publicationNative([], "CLASSIC", "0".repeat(64))), prepared(publicationNative([], "CLASSIC", "password=x")),
    ];
    expect(new Set(proposals.map(p => p.proposalDigest)).size).toBe(5);
    expect(proposals[0]!.scan.binaryFiles).toEqual([{ path: "packages/echo-skill/1.0.0/blob.dat", side: "after" }]);
    expect(proposals[0]!.changes.find(c => c.path.endsWith("blob.dat"))!.after.base64).toBe("/w==");
    const m = proposals[3]!.releases[0]!.snapshot.manifest;
    if (m.kind !== "native-agent") throw new Error("fixture"); expect(m.native.systemInstructions).toBe("0".repeat(64));
    const v = publicationInput(); v.base.commit = "0".repeat(64);
    const p = value(publicSkills.preparePublication(v));
    expect(p.preconditions.baseCommit).toBe("0".repeat(64));
    expect(JSON.stringify(p)).not.toContain('"commit":"' + "0".repeat(63) + '1"');
  });
  it("returns one issue/no partial proposal for invalid exports and disabled base", () => {
    const v = publicationInput(); v.base.enabled = false;
    for (const input of [v, { ...publicationInput(), selections: [] }]) {
      const r = publicSkills.preparePublication(input); expect(r.ok).toBe(false);
      if (r.ok) throw new Error("fixture"); expect(r.issues).toHaveLength(1); expect(r).not.toHaveProperty("value");
    }
    const forged = publicationInput(); forged.selections[0]!.candidate.proposedFiles = [...forged.selections[0]!.candidate.proposedFiles, { path: ".env", base64: bytes("password=x"), executable: false }];
    expect(publicSkills.preparePublication(forged).ok).toBe(false);
  });
});

describe("preparePublication complete scan integration", () => {
  it.each(signals)("scans %s in the actual SKILL.md bytes", (text, rule) => {
    const v = publicationInput(), c = v.selections[0]!.candidate, m = c.snapshot.manifest;
    const content = c.snapshot.files.map(f => ({ type: "file" as const, path: f.path, executable: f.executable,
      base64: f.path === "SKILL.md" ? bytes(Buffer.from(f.base64, "base64").toString() + text + "\n") : f.base64 }));
    const candidate = must(publicSkills.exportSkillPackage(content, { metadata: metadataOnly(m),
      dependencies: [], executables: m.executables, selectedPaths: content.map(f => f.path) }));
    const p = prepared(candidate);
    expect(p.findings).toContainEqual({ ruleId: rule, severity: "warning", path: "packages/echo-skill/1.0.0/SKILL.md", side: "after", line: 7, column: 1 });
  });
  it("propagates real scan overflow without a digest or partial proposal", () => {
    const v = publicationInput();
    const text = "password=x\nghp_" + "a".repeat(20) + "\n-----BEGIN PRIVATE KEY-----";
    const extra = Array.from({ length: 230 }, (_, i) => ({ path: `f${i}.txt`, base64: bytes(text), executable: false }));
    v.selections = Array.from({ length: 6 }, (_, i) => ({ destinationPath: `packages/skill-${i}`,
      candidate: publicationSkill(`skill-${i}`, "1.0.0", [], extra), intent: "new-release", origin: null }));
    expect(publicSkills.preparePublication(v)).toEqual({ ok: false, issues: [{ code: "LIMIT_EXCEEDED", at: "findings" }] });
  });
  it("retains mandatory review on exact byte-identical no-op with no scanned changes", () => {
    let v = publicationInput();
    v = promotePublication(v, value(publicSkills.preparePublication(v)));
    // First reuse freezes the contextual old index; then even lexical bytes are unchanged.
    v = promotePublication(v, value(publicSkills.preparePublication(v)), "3".repeat(40));
    const p = value(publicSkills.preparePublication(v));
    expect(p.changes).toEqual([]); expect(p.findings).toEqual([]);
    expect(p.reviewRequired).toBe(true); expect(p.scan).toEqual({ kind: "supplementary", version: 1, binaryFiles: [] });
    expect(p.releases[0]!.identity.packageRevision).toEqual({ type: "exact", commit: "2".repeat(40) });
  });
});
