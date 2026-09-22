import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { DependencyPin, PackageManifest, ResolvedIdentity } from "@orgops/schemas";
import { computePackageDigest, inspectPackage, type ContentEntry, type PackageSnapshot } from "./content";
import { resolvePackages, orderDependencyGraph, type ResolveInput } from "./resolve";
import { must, expectCode, skillManifest, classicManifest, wrappedManifest, skillEntries, catalogIndex } from "./fixtures";
const commit = "1".repeat(40);
const later = "2".repeat(40);
const zero = `sha256:${"0".repeat(64)}`;
function input(): ResolveInput {
  return structuredClone({
    roots: [{ catalogId: "team", name: "echo-agent", version: "1.0.0" }],
    catalogs: [{ catalogId: "team", sourceId: "team-source", commit, enabled: true, index: catalogIndex }],
    packages: [
      { sourceId: "team-source", commit, path: "packages/echo-skill", snapshot: must(inspectPackage(skillManifest, skillEntries)) },
      { sourceId: "team-source", commit, path: "packages/echo-agent", snapshot: must(inspectPackage(classicManifest, [])) },
    ],
    allowedSourceIds: ["team-source"],
    target: { orgopsVersion: "0.0.1", platform: "linux" as const, tools: ["node"] },
    installedSkills: [], knownReleases: [],
  });
}
function seal(manifest: PackageManifest, entries: readonly ContentEntry[] = []): PackageSnapshot {
  const copy = structuredClone(manifest);
  copy.digest = must(computePackageDigest(copy, entries));
  return must(inspectPackage(copy, entries));
}
function skill(name: string, dependencies: DependencyPin[] = []): PackageSnapshot {
  const manifest = structuredClone(skillManifest);
  manifest.name = name; manifest.dependencies = dependencies; manifest.executables = [];
  const bytes = Buffer.from(`---\nname: ${name}\ndescription: Echo instructions.\n---\n`);
  manifest.files = [{ path: "SKILL.md", size: bytes.length, digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, executable: false }];
  return seal(manifest, [{ type: "file", path: "SKILL.md", base64: bytes.toString("base64"), executable: false }]);
}
function pin(snapshot: PackageSnapshot): DependencyPin {
  return { catalogId: "team", sourceId: "team-source", name: snapshot.manifest.name, version: snapshot.manifest.version,
    revision: { type: "same-package-revision" }, digest: snapshot.manifest.digest };
}
function withPackages(snapshots: PackageSnapshot[]): ResolveInput {
  const value = input();
  value.catalogs[0]!.index.entries = snapshots.map(({ manifest: m }) => ({ kind: m.kind, name: m.name, version: m.version, digest: m.digest,
    location: { type: "catalog", path: `packages/${m.name}`, revision: { type: "catalog-revision" } } }));
  value.packages = snapshots.map(snapshot => ({ sourceId: "team-source", commit, path: `packages/${snapshot.manifest.name}`, snapshot }));
  const last = snapshots.at(-1)!.manifest;
  value.roots = [{ catalogId: "team", name: last.name, version: last.version }];
  return value;
}
function replaceAgent(value: ResolveInput, change: (m: PackageManifest) => void): void {
  const m = structuredClone(value.packages[1]!.snapshot.manifest); change(m);
  const snapshot = seal(m); value.packages[1]!.snapshot = structuredClone(snapshot);
  value.catalogs[0]!.index.entries.find(e => e.name === "echo-agent")!.digest = snapshot.manifest.digest;
}
it("expands contextual pins and returns dependency-first exact provenance", () => {
  const result = must(resolvePackages(input()));
  expect(result.packages.map(p => p.identity.name)).toEqual(["echo-skill", "echo-agent"]);
  expect(result.packages[0]?.identity).toEqual({ catalogId: "team", catalogCommit: commit, sourceId: "team-source", packageCommit: commit,
    path: "packages/echo-skill", kind: "skill", name: "echo-skill", version: "1.0.0", digest: skillManifest.digest });
});
it.each(["missing", "disabled", "catalog-source", "external-source"])("denies %s without inferring permissions", which => {
  const v = input();
  if (which === "missing") v.catalogs = [];
  if (which === "disabled") v.catalogs[0]!.enabled = false;
  if (which === "catalog-source") v.allowedSourceIds = [];
  if (which === "external-source") v.catalogs[0]!.index.entries.find(e => e.name === "echo-agent")!.location = { type: "source", sourceId: "external", commit: later, path: "agent" };
  const before = structuredClone(v);
  expectCode(resolvePackages(v), "SOURCE_NOT_ALLOWED"); expect(v).toEqual(before);
});
it("external release preserves separate commits and remains stable across refresh", () => {
  const v = withPackages([skill("external-skill")]); v.allowedSourceIds = ["team-source", "external"];
  v.catalogs[0]!.index.entries[0]!.location = { type: "source", sourceId: "external", commit: later, path: "packages/external-skill" };
  v.packages[0]!.sourceId = "external"; v.packages[0]!.commit = later;
  const first = must(resolvePackages(v)).packages[0]!;
  expect(first.identity.catalogCommit).toBe(commit); expect(first.identity.packageCommit).toBe(later);
  v.knownReleases = [first.identity]; v.installedSkills = [{ name: first.identity.name, identity: first.identity, currentDigest: first.identity.digest }];
  v.catalogs[0]!.commit = "3".repeat(40);
  const refreshed = must(resolvePackages(v)).packages[0]!;
  expect(refreshed.action).toBe("reuse"); expect(refreshed.identity.packageCommit).toBe(later);
});
it("keeps historical same-repository releases pinned across catalog refresh", () => {
  const v = input(); const original = must(resolvePackages(v));
  v.knownReleases = original.packages.map(p => p.identity);
  const s = original.packages[0]!;
  v.installedSkills = [{ name: s.identity.name, identity: s.identity, currentDigest: s.identity.digest }];
  v.catalogs[0]!.commit = later;
  for (const e of v.catalogs[0]!.index.entries) if (e.location.type === "catalog") e.location.revision = { type: "exact", commit };
  const refreshed = must(resolvePackages(v));
  expect(refreshed.packages[0]!.action).toBe("reuse");
  expect(refreshed.packages[0]!.identity.packageCommit).toBe(commit);
  expect(refreshed.packages[0]!.identity.catalogCommit).toBe(later);
  const e = v.catalogs[0]!.index.entries.find(e => e.name === "echo-agent")!;
  if (e.location.type !== "catalog") throw new Error("fixture");
  e.location.revision = { type: "catalog-revision" };
  v.packages = [...v.packages, { ...v.packages[1]!, commit: later }];
  expectCode(resolvePackages(v), "IDENTITY_CONFLICT");
});
it.each(["revision", "digest", "source"])("rejects exact dependency %s mismatch", field => {
  const v = input();
  replaceAgent(v, m => { const p = m.dependencies[0]!;
    if (field === "revision") p.revision = { type: "exact", commit: later };
    if (field === "digest") p.digest = zero;
    if (field === "source") p.sourceId = "external";
  });
  expectCode(resolvePackages(v), field === "source" ? "UNSUPPORTED_DEPENDENCY" : "IDENTITY_CONFLICT");
});
it.each(["bytes", "version", "release"])("does not substitute missing %s", field => {
  const v = input();
  if (field === "bytes") v.packages = [v.packages[1]!];
  if (field === "version") v.roots[0]!.version = "1.0.1";
  if (field === "release") v.catalogs[0]!.index.entries = v.catalogs[0]!.index.entries.filter(e => e.name !== "echo-skill");
  expectCode(resolvePackages(v), "MISSING_RELEASE");
});
it.each(["kind", "name", "version", "digest"])("cross-checks index %s against inspected manifest", field => {
  const v = input(); const e = v.catalogs[0]!.index.entries.find(e => e.name === "echo-agent")!;
  if (field === "kind") e.kind = "skill";
  if (field === "name") { e.name = "renamed"; v.roots[0]!.name = "renamed"; }
  if (field === "version") { e.version = "1.0.1"; v.roots[0]!.version = "1.0.1"; }
  if (field === "digest") e.digest = zero;
  expectCode(resolvePackages(v), "IDENTITY_CONFLICT");
});
it.each(["path", "packageCommit", "digest", "kind"])("refuses known release remapping of %s", field => {
  const v = input(); const identity = structuredClone(must(resolvePackages(v)).packages[0]!.identity);
  if (field === "path") identity.path = "other";
  if (field === "packageCommit") identity.packageCommit = later;
  if (field === "digest") identity.digest = zero;
  if (field === "kind") identity.kind = "native-agent";
  v.knownReleases = [identity]; expectCode(resolvePackages(v), "IDENTITY_CONFLICT");
});
it.each(["catalogs", "packages", "roots", "knownReleases", "installedSkills"] as const)("rejects duplicate %s", field => {
  const v = input(); const identity = must(resolvePackages(v)).packages[0]!.identity;
  if (field === "catalogs") v.catalogs = [v.catalogs[0]!, v.catalogs[0]!];
  if (field === "packages") v.packages = [...v.packages, v.packages[0]!];
  if (field === "roots") v.roots.push(v.roots[0]!);
  if (field === "knownReleases") v.knownReleases = [identity, { ...identity, catalogCommit: later }];
  if (field === "installedSkills") v.installedSkills = Array.from({ length: 2 }, () => ({ name: identity.name, identity, currentDigest: identity.digest }));
  expectCode(resolvePackages(v), "IDENTITY_CONFLICT");
});
it("rejects conflicting known identities even when not selected", () => {
  const v = input(); const id = must(resolvePackages(v)).packages[0]!.identity;
  v.knownReleases = [{ ...id, name: "unused" }, { ...id, name: "unused", digest: zero }];
  expectCode(resolvePackages(v), "IDENTITY_CONFLICT");
});
it.each(["edited", "untracked", "pin", "catalog"])("blocks installed %s skill collisions", which => {
  const v = input(); const identity = structuredClone(must(resolvePackages(v)).packages[0]!.identity);
  v.installedSkills = [{ name: identity.name, identity, currentDigest: identity.digest }];
  expect(must(resolvePackages(v)).packages[0]!.action).toBe("reuse");
  if (which === "edited") v.installedSkills[0]!.currentDigest = zero;
  if (which === "untracked") v.installedSkills[0]!.identity = null;
  if (which === "pin") identity.packageCommit = later;
  if (which === "catalog") identity.catalogId = "other";
  expectCode(resolvePackages(v), "SKILL_CONFLICT");
});
it.each(["source", "version", "catalog"])("blocks global same-name skills across %s", which => {
  const a = skill("same"); const b = structuredClone(a.manifest);
  if (which === "version") b.version = "2.0.0";
  const second = seal(b, a.files.map(f => ({ type: "file", path: f.path, base64: f.base64, executable: f.executable })));
  const v = withPackages([a]);
  v.catalogs = [...v.catalogs, { catalogId: "other", sourceId: which === "source" ? "other-source" : "team-source", commit: later, enabled: true,
    index: { formatVersion: 1, entries: [{ kind: "skill", name: "same", version: second.manifest.version, digest: second.manifest.digest,
      location: { type: "catalog", path: "packages/same", revision: { type: "catalog-revision" } } }] } }];
  v.allowedSourceIds = ["team-source", "other-source"];
  v.packages = [...v.packages, { sourceId: v.catalogs[1]!.sourceId, commit: later, path: "packages/same", snapshot: second }];
  v.roots.push({ catalogId: "other", name: "same", version: second.manifest.version });
  expectCode(resolvePackages(v), "SKILL_CONFLICT");
});
it("rejects native-to-native only after valid integrity and exact pins", () => {
  const leafManifest = structuredClone(classicManifest); leafManifest.dependencies = []; leafManifest.native.alwaysPreloadedSkills = [];
  const leaf = seal(leafManifest); const parent = structuredClone(leafManifest); parent.name = "parent"; parent.dependencies = [pin(leaf)];
  expectCode(resolvePackages(withPackages([leaf, seal(parent)])), "UNSUPPORTED_DEPENDENCY");
});
it("rejects wrapped resources rather than implying native skill activation", () => {
  const v = withPackages([must(inspectPackage(wrappedManifest, []))]);
  v.packages[0]!.snapshot = structuredClone(v.packages[0]!.snapshot);
  v.packages[0]!.snapshot.manifest.dependencies = [pin(must(inspectPackage(skillManifest, skillEntries)))];
  expectCode(resolvePackages(v), "UNSUPPORTED_WIRING");
});
it("allows skill-to-skill and deduplicates an integrity-valid public diamond", () => {
  const d = skill("d"), b = skill("b", [pin(d)]), c = skill("c", [pin(d)]), a = skill("a", [pin(c), pin(b)]);
  const v = withPackages([d, c, b, a]); const before = structuredClone(v);
  const result = must(resolvePackages(v));
  expect(result.packages.map(p => p.identity.name)).toEqual(["d", "b", "c", "a"]);
  v.catalogs = [...v.catalogs].reverse(); v.packages = [...v.packages].reverse(); v.catalogs[0]!.index.entries.reverse();
  expect(must(resolvePackages(v))).toEqual(result);
  const checkFrozen = (x: unknown): void => { if (x && typeof x === "object") { expect(Object.isFrozen(x)).toBe(true); Object.values(x).forEach(checkFrozen); } };
  checkFrozen(result); expect(before.packages[0]!.snapshot.manifest.name).toBe("d");
  v.packages[0]!.sourceId = "changed"; expect(result.packages.at(-1)!.identity.sourceId).toBe("team-source");
});
it.each([
  ["tool", "compatibility.tools"], ["platform", "compatibility.platforms"], ["min", "compatibility.orgops.min"], ["max", "compatibility.orgops.maxExclusive"],
])("rejects incompatible %s with safe field pointer", (which, at) => {
  const v = input();
  if (which === "tool") v.target.tools = [];
  if (which === "platform") replaceAgent(v, m => { m.compatibility.platforms = ["darwin"]; });
  if (which === "min") v.target.orgopsVersion = "0.0.0";
  if (which === "max") v.target.orgopsVersion = "0.1.0";
  expect(resolvePackages(v)).toEqual({ ok: false, issues: [{ code: "INCOMPATIBLE", at }] });
});
it("compares versions numerically and accepts inclusive min", () => {
  const v = withPackages([skill("numeric")]); const m = structuredClone(v.packages[0]!.snapshot.manifest);
  m.compatibility.orgops = { min: "0.2.0", maxExclusive: "0.11.0" };
  const s = seal(m, v.packages[0]!.snapshot.files.map(f => ({ type: "file", path: f.path, base64: f.base64, executable: f.executable })));
  const n = withPackages([s]); n.target.orgopsVersion = "0.10.0"; must(resolvePackages(n));
  n.target.orgopsVersion = "0.2.0"; must(resolvePackages(n));
});
it.each(["inventory", "hash", "claimed-size", "claimed-digest"])("reinspects forged snapshot %s", which => {
  const v = input(); const s = v.packages[0]!.snapshot;
  if (which === "inventory") s.manifest.files[0]!.size++;
  if (which === "hash") s.manifest.digest = zero;
  if (which === "claimed-size") (s.files[0]!).size++;
  if (which === "claimed-digest") (s.files[0]!).digest = zero;
  expectCode(resolvePackages(v), which === "hash" ? "DIGEST_MISMATCH" : "INVENTORY_MISMATCH");
});
it("discards forged execution and warning claims, preserving actual API execution disclosure", () => {
  const v = input(); v.packages[0]!.snapshot.execution.apiEventShapes = []; v.packages[0]!.snapshot.warnings = [];
  const s = must(resolvePackages(v)).packages[0]!.snapshot;
  expect(s.execution.apiEventShapes).toEqual(["event-shapes.ts"]);
  expect(s.warnings).toContainEqual({ code: "MANUAL_REVIEW_REQUIRED", at: "$" });
});
it("does not inspect unused denied-source package content", () => {
  const v = input(); const unused = structuredClone(v.packages[0]!); unused.sourceId = "denied"; unused.snapshot.manifest.digest = zero;
  v.packages = [...v.packages, unused]; must(resolvePackages(v));
  v.allowedSourceIds = []; v.packages[1]!.snapshot.manifest.digest = zero;
  expectCode(resolvePackages(v), "SOURCE_NOT_ALLOWED");
});
it("rejects real cyclic-looking unsealed pins without a partial plan", () => {
  const v = input(); v.packages[0]!.snapshot.manifest.dependencies = [pin(v.packages[1]!.snapshot)];
  const r = resolvePackages(v); expectCode(r, "DIGEST_MISMATCH"); expect(r).not.toHaveProperty("value");
});
it("rejects aggregate JSON before schema traversal or reading accessor values", () => {
  expectCode(resolvePackages({ ...input(), ...{ extra: "x".repeat(67108864) } }), "LIMIT_EXCEEDED");
  const v = input(); let reads = 0;
  Object.defineProperty(v, "roots", { enumerable: true, get() { reads++; return []; } });
  expectCode(resolvePackages(v), "INVALID_JSON"); expect(reads).toBe(0);
});
it("bounds 4096 large manifests before schema work", () => {
  const v = input(); const p = structuredClone(v.packages[1]!);
  p.snapshot.manifest.description = "x".repeat(20000); // Deliberately invalid schema, aggregate limit must win.
  v.packages = Array.from({ length: 4096 }, (_, i) => ({ ...p, path: `p${i}` }));
  expectCode(resolvePackages(v), "LIMIT_EXCEEDED");
});
it("bounds cumulative decoded bytes before inspecting any package", () => {
  const v = input(); const p = structuredClone(v.packages[0]!); const base64 = Buffer.alloc(1048576).toString("base64");
  p.snapshot.files = Array.from({ length: 8 }, (_, i) => ({ path: `f${i}`, base64, executable: false, size: 1048576, digest: zero }));
  v.packages = Array.from({ length: 5 }, (_, i) => ({ ...p, path: `p${i}` }));
  expectCode(resolvePackages(v), "LIMIT_EXCEEDED");
});
it.each(["unknown", "version", "source-list", "tools", "null", "missing", "snapshot-extra", "unsafe-path"])("validates malformed resolver envelope %s", which => {
  const v = input();
  if (which === "unknown") Object.assign(v, { secret: "token=sensitive-value" });
  if (which === "version") v.target.orgopsVersion = "latest";
  if (which === "source-list") v.allowedSourceIds = ["team-source", "team-source"];
  if (which === "tools") v.target.tools = ["node", "node"];
  if (which === "null") Object.assign(v, { target: null });
  if (which === "missing") Reflect.deleteProperty(v, "knownReleases");
  if (which === "snapshot-extra") Object.assign(v.packages[0]!.snapshot, { extra: true });
  if (which === "unsafe-path") v.packages[0]!.path = "../secret";
  const r = resolvePackages(v); expect(r.ok).toBe(false); expect(JSON.stringify(r)).not.toContain("sensitive-value");
});
it.each(["roots", "catalogs", "packages", "installedSkills", "knownReleases", "allowedSourceIds", "tools"])("bounds envelope count %s", field => {
  const v = input(); const id: ResolvedIdentity = { catalogId: "team", catalogCommit: commit, sourceId: "team-source", packageCommit: commit,
    path: "packages/echo-skill", kind: "skill", name: "echo-skill", version: "1.0.0", digest: skillManifest.digest };
  if (field === "roots") v.roots = Array(65).fill(v.roots[0]);
  if (field === "catalogs") v.catalogs = Array(33).fill(v.catalogs[0]);
  if (field === "packages") v.packages = Array(4097).fill(v.packages[1]);
  if (field === "installedSkills") v.installedSkills = Array(4097).fill({ name: id.name, identity: id, currentDigest: id.digest });
  if (field === "knownReleases") v.knownReleases = Array(4097).fill(id);
  if (field === "allowedSourceIds") v.allowedSourceIds = Array(129).fill("source");
  if (field === "tools") v.target.tools = Array(65).fill("tool");
  expectCode(resolvePackages(v), "LIMIT_EXCEEDED");
});
it("rejects cycles and deduplicates a diamond in the actual ordering helper", () => {
  expectCode(orderDependencyGraph(["a"], new Map([["a", ["b"]], ["b", ["a"]]])), "CYCLE");
  expect(must(orderDependencyGraph(["a"], new Map([["a", ["b", "c"]], ["b", ["d"]], ["c", ["d"]], ["d", []]])))).toEqual(["d", "b", "c", "a"]);
});
function chain(edges: number): Map<string, readonly string[]> {
  return new Map(Array.from({ length: edges + 1 }, (_, i) => [`n${String(i).padStart(3, "0")}`, i === edges ? [] : [`n${String(i + 1).padStart(3, "0")}`]]));
}
it("allows depth 64 but not 65", () => {
  expect(must(orderDependencyGraph(["n000"], chain(64)))).toHaveLength(65);
  expectCode(orderDependencyGraph(["n000"], chain(65)), "LIMIT_EXCEEDED");
});
it("does not let a completed diamond subtree bypass longer-path depth", () => {
  const graph = chain(63); graph.set("a", ["n000", "z"]); graph.set("z", ["n000"]);
  expectCode(orderDependencyGraph(["a"], graph), "LIMIT_EXCEEDED");
});
it("allows 256 graph nodes and rejects 257, including unreachable supplied nodes", () => {
  const graph = new Map(Array.from({ length: 256 }, (_, i) => [`n${i}`, []] as [string, string[]]));
  expect(must(orderDependencyGraph([...graph.keys()], graph))).toHaveLength(256);
  graph.set("overflow", []); expectCode(orderDependencyGraph(["n0"], graph), "LIMIT_EXCEEDED");
});
it("rejects missing graph nodes and detects self-cycles", () => {
  expectCode(orderDependencyGraph(["a"], new Map([["a", ["missing"]]])), "MISSING_RELEASE");
  expectCode(orderDependencyGraph(["missing"], new Map()), "MISSING_RELEASE");
  expectCode(orderDependencyGraph(["a"], new Map([["a", ["a"]]])), "CYCLE");
});
it("orders roots by catalog/name/version, not opposing external source IDs", () => {
  const v = withPackages([skill("a"), skill("z")]);
  v.roots = [{ catalogId: "team", name: "z", version: "1.0.0" }, { catalogId: "team", name: "a", version: "1.0.0" }];
  v.allowedSourceIds = ["team-source", "a-source", "z-source"];
  for (let i = 0; i < 2; i++) {
    const sourceId = i === 0 ? "z-source" : "a-source";
    v.packages[i]!.sourceId = sourceId;
    v.catalogs[0]!.index.entries[i]!.location = { type: "source", sourceId, commit, path: v.packages[i]!.path };
  }
  const before = structuredClone(v); const result = must(resolvePackages(v));
  expect(result.packages.map(p => p.identity.name)).toEqual(["a", "z"]); expect(v).toEqual(before);
  v.roots.reverse(); v.packages = [...v.packages].reverse(); v.catalogs[0]!.index.entries.reverse(); v.allowedSourceIds = [...v.allowedSourceIds].reverse();
  expect(must(resolvePackages(v))).toEqual(result);
});
it("orders dependencies by catalog/source/name, not just skill name", () => {
  const b = skill("b"), c = skill("c");
  const bp = { ...pin(b), sourceId: "z-source", revision: { type: "exact" as const, commit } };
  const cp = { ...pin(c), sourceId: "a-source", revision: { type: "exact" as const, commit } };
  const a = skill("a", [bp, cp]); const v = withPackages([b, c, a]);
  v.allowedSourceIds = ["team-source", "a-source", "z-source"];
  for (let i = 0; i < 2; i++) {
    const sourceId = i === 0 ? "z-source" : "a-source";
    v.packages[i]!.sourceId = sourceId;
    v.catalogs[0]!.index.entries[i]!.location = { type: "source", sourceId, commit, path: v.packages[i]!.path };
  }
  const result = must(resolvePackages(v)); expect(result.packages.map(p => p.identity.name)).toEqual(["c", "b", "a"]);
  v.packages = [...v.packages].reverse(); v.catalogs[0]!.index.entries.reverse();
  v.packages[0]!.snapshot = structuredClone(v.packages[0]!.snapshot); v.packages[0]!.snapshot.manifest.dependencies.reverse();
  expect(must(resolvePackages(v))).toEqual(result);
});
it("helper preserves caller root and adjacency order rather than sorting opaque IDs", () => {
  expect(must(orderDependencyGraph(["z", "a"], new Map([["z", []], ["a", []]])))).toEqual(["z", "a"]);
  expect(must(orderDependencyGraph(["a"], new Map([["a", ["c", "b"]], ["c", ["d"]], ["b", ["d"]], ["d", []]])))).toEqual(["d", "c", "b", "a"]);
});
it.each(["platform", "warning"])("rejects JSON objects in %s without coercing them", which => {
  const v = input(); const notString = { toString: null, valueOf: null };
  if (which === "platform") Object.assign(v.target, { platform: notString });
  else v.packages[0]!.snapshot.warnings = [Object.assign({ code: "MANUAL_REVIEW_REQUIRED" as const, at: "$" }, { code: notString })] as unknown as PackageSnapshot["warnings"];
  expectCode(resolvePackages(v), "INVALID_JSON");
});
it("bounds unused denied catalog index entry counts", () => {
  const v = input(); v.catalogs = [...v.catalogs, { catalogId: "denied", sourceId: "denied", commit, enabled: false,
    index: { formatVersion: 1, entries: Array(4097).fill(catalogIndex.entries[0]) } }];
  expectCode(resolvePackages(v), "LIMIT_EXCEEDED");
});
it("accepts cumulative 32MiB at the preflight boundary without inspecting denied bytes", () => {
  const v = withPackages([must(inspectPackage(wrappedManifest, []))]);
  const p = structuredClone(input().packages[0]!); p.sourceId = "denied";
  p.snapshot.files = Array.from({ length: 8 }, (_, i) => ({ path: `f${i}`, base64: Buffer.alloc(1048576).toString("base64"), executable: false, size: 1048576, digest: zero }));
  v.packages = [...v.packages, ...Array.from({ length: 4 }, (_, i) => ({ ...p, path: `p${i}` }))];
  must(resolvePackages(v));
});
it.each([256, 257])("enforces %i-node closure during public iterative expansion", count => {
  const leaves = Array.from({ length: count - 5 }, (_, i) => skill(`leaf-${i}`));
  const branches = Array.from({ length: 4 }, (_, i) => skill(`branch-${i}`, leaves.slice(i * 64, (i + 1) * 64).map(pin)));
  const root = skill("root", branches.map(pin)); const v = withPackages([...leaves, ...branches, root]);
  const result = resolvePackages(v);
  if (count === 256) expect(must(result).packages).toHaveLength(256);
  else expectCode(result, "LIMIT_EXCEEDED");
});
