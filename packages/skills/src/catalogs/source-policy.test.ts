import { expect, it } from "vitest";
import { precheckPackageSources, type SourcePolicyInput } from "./source-policy";
import { importInput, IMPORT_COMMIT } from "./import-fixtures";
function input(): SourcePolicyInput {
  const v = importInput(); return { roots: [v.root], catalogs: v.catalogs, packages: v.packages, sources: v.sources };
}
it("denies explicit source locations even when the enabled source owns the catalog", () => {
  const v = input();
  v.catalogs[0]!.index.entries.find(e => e.name === "echo-agent")!.location = {
    type: "source", sourceId: "team-source", commit: IMPORT_COMMIT, path: "packages/echo-agent",
  };
  expect(precheckPackageSources(v)).toEqual({ ok: false, issues: [{ code: "SOURCE_NOT_ALLOWED", at: "catalogs.index.entries.location.sourceId" }] });
});
it("allows same-source catalog-owned pins without external-package permission", () => {
  expect(precheckPackageSources(input())).toEqual({ ok: true, value: ["team-source"] });
});
it.each(["catalog-disabled", "catalog-missing", "source-disabled", "source-missing"])("denies %s", which => {
  const v = input();
  if (which === "catalog-disabled") v.catalogs[0]!.enabled = false;
  if (which === "catalog-missing") v.catalogs = [];
  if (which === "source-disabled") v.sources[0]!.enabled = false;
  if (which === "source-missing") v.sources = [];
  expect(precheckPackageSources(v)).toEqual({ ok: false, issues: [{ code: "SOURCE_NOT_ALLOWED", at: "catalogs" }] });
});
it.each(["entry", "bytes"])("requires reached %s evidence", which => {
  const v = input(); if (which === "entry") v.catalogs[0]!.index.entries = []; else v.packages = [];
  expect(precheckPackageSources(v)).toEqual({ ok: false, issues: [{ code: "MISSING_RELEASE", at: which === "entry" ? "catalogs.index.entries" : "packages" }] });
});
it("ignores unused denied index locations and returns only reached source IDs", () => {
  const v = input(); v.catalogs[0]!.index.entries.push({ kind: "skill", name: "unused", version: "1.0.0", digest: `sha256:${"0".repeat(64)}`,
    location: { type: "source", sourceId: "denied", commit: IMPORT_COMMIT, path: "unused" } });
  v.sources = [...v.sources, { sourceId: "denied", enabled: true, allowPackages: false }];
  expect(precheckPackageSources(v)).toEqual({ ok: true, value: ["team-source"] });
});
it("checks cross-source permission before deduping an already reached target", () => {
  const v = input();
  v.roots.unshift({ catalogId: "team", name: "echo-skill", version: "1.0.0" });
  const agent = v.packages.find(p => p.snapshot.manifest.name === "echo-agent")!;
  // Policy consumes validated metadata, not integrity assertions; digest resolution is not its job.
  agent.sourceId = "external";
  v.catalogs[0]!.index.entries.find(e => e.name === "echo-agent")!.location = { type: "source", sourceId: "external", commit: IMPORT_COMMIT, path: agent.path };
  v.sources = [...v.sources, { sourceId: "external", enabled: true, allowPackages: true }];
  expect(precheckPackageSources(v)).toEqual({ ok: false, issues: [{ code: "SOURCE_NOT_ALLOWED", at: "dependencies.sourceId" }] });
});
it("independently permits multiple enabled catalogs on one source", () => {
  const v = input();
  v.catalogs = [...v.catalogs, { ...v.catalogs[0]!, catalogId: "other" }];
  v.roots.push({ ...v.roots[0]!, catalogId: "other" });
  expect(precheckPackageSources(v)).toEqual({ ok: true, value: ["team-source"] });
});
it("denies a missing cross-source pin before looking for its catalog", () => {
  const v = input(); v.packages.find(p => p.snapshot.manifest.name === "echo-agent")!.snapshot.manifest.dependencies[0]!.sourceId = "missing";
  expect(precheckPackageSources(v)).toEqual({ ok: false, issues: [{ code: "SOURCE_NOT_ALLOWED", at: "dependencies.sourceId" }] });
});
