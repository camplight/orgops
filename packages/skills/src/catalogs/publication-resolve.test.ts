import { exportAgentPackage, exportSkillPackage } from "./export";
import { expect, it } from "vitest";
import { validatePublicationInput } from "./publication-base";
import { resolvePublicationReleases } from "./publication-resolve";
import { publicationInput } from "./publication-fixtures";
import { publicationValue as must } from "./publication-fixtures";
import { afterEach, describe, vi } from "vitest";
import * as resolver from "./resolve";
import { composePublication } from "./publication";
import { publicationSkill, publicationNative, publicationPin, promotePublication, bytes, digest } from "./publication-fixtures";
import type { PublicationInput } from "./publication-types";
import type { DependencyPin } from "@orgops/schemas";

it("resolves a new release without exposing the private commit bridge", () => {
  const v = must(validatePublicationInput(publicationInput()));
  const m = v.input.selections[0]!.candidate.snapshot.manifest;
  const r = must(resolvePublicationReleases(v, { formatVersion: 1, entries: [{
    kind: m.kind, name: m.name, version: m.version, digest: m.digest,
    location: { type: "catalog", path: v.input.selections[0]!.destinationPath, revision: { type: "catalog-revision" } },
  }] }));
  expect(r[0]!.identity.catalogRevision).toEqual({ type: "proposal" });
  expect(r[0]!.identity.packageRevision).toEqual({ type: "proposal" });
  expect(r[0]!.disposition).toBe("new");
  expect(r[0]!.snapshot.manifest).toEqual(m);
});


afterEach(() => vi.restoreAllMocks());
function coherent(mode: "CLASSIC" | "RLM_REPL" = "CLASSIC"): PublicationInput {
  const v = publicationInput(), skill = publicationSkill();
  v.selections = [{ candidate: skill, destinationPath: "skill", intent: "new-release", origin: null },
    { candidate: publicationNative([publicationPin(skill)], mode), destinationPath: "agent", intent: "new-release", origin: null }];
  return v;
}
function external(location: "catalog" | "source" = "catalog", sameSource = false): PublicationInput {
  const v = publicationInput(), skill = publicationSkill();
  const sourceId = sameSource ? "team-source" : "external-source", commit = "4".repeat(40);
  if (!sameSource) v.sources = [...v.sources, { sourceId, repository: { url: "https://example.invalid/external.git" }, enabled: true, allowPackages: true }];
  v.catalogs = [{ catalogId: "external", sourceId, enabled: true, commit, index: { formatVersion: 1, entries: [{
    kind: "skill", name: "echo-skill", version: "1.0.0", digest: skill.snapshot.manifest.digest,
    location: location === "source" ? { type: "source", sourceId, commit, path: "skill" }
      : { type: "catalog", path: "skill", revision: { type: "catalog-revision" } },
  }] } }];
  v.packages = [{ sourceId, commit, path: "skill", snapshot: skill.snapshot }];
  v.selections = [{ candidate: publicationNative([{ ...publicationPin(skill, { type: "exact", commit }), sourceId, catalogId: "external" }]), destinationPath: "agent", intent: "new-release", origin: null }];
  return v;
}

describe("coherent resolution bridge", () => {
  it.each(["CLASSIC", "RLM_REPL"] as const)("resolves a new skill plus %s template with original digest-covered contextual pins", mode => {
    const v = coherent(mode), r = must(composePublication(v));
    expect(r.releases.map(p => p.identity.name)).toEqual(["echo-skill", "echo-agent"]);
    expect(r.releases.map(p => p.disposition)).toEqual(["new", "new"]);
    expect(r.releases.map(p => p.identity.packageRevision)).toEqual([{ type: "proposal" }, { type: "proposal" }]);
    expect(r.releases[1]!.snapshot.manifest).toEqual(v.selections[1]!.candidate.snapshot.manifest);
  });
  it("resolves an exporter-authored three-level skill diamond once in dependency-first order", () => {
    const v = publicationInput(), leaf = publicationSkill("leaf"), left = publicationSkill("left", "1.0.0", [publicationPin(leaf)]),
      right = publicationSkill("right", "1.0.0", [publicationPin(leaf)]), root = publicationSkill("root", "1.0.0", [publicationPin(right), publicationPin(left)]);
    v.selections = [root, right, leaf, left].map(candidate => ({ candidate, destinationPath: candidate.snapshot.manifest.name, intent: "new-release", origin: null }));
    expect(must(composePublication(v)).releases.map(r => r.identity.name)).toEqual(["leaf", "left", "right", "root"]);
  });
  it.each(["missing-release", "wrong-version", "wrong-digest", "wrong-commit"])("rejects %s without substitution", mutation => {
    const v = coherent(), skill = v.selections[0]!.candidate;
    const pin = publicationPin(skill);
    if (mutation === "wrong-version") pin.version = "2.0.0";
    if (mutation === "wrong-digest") pin.digest = digest("wrong");
    if (mutation === "wrong-commit") pin.revision = { type: "exact", commit: "3".repeat(40) };
    v.selections[1]!.candidate = publicationNative([pin]);
    if (mutation === "missing-release") v.selections = [v.selections[1]!];
    const r = composePublication(v); expect(r.ok).toBe(false); expect(r).not.toHaveProperty("value");
  });
  it.each(["same-package-revision", "exact"] as const)("new-to-old pin %s is not silently retargeted", type => {
    const v0 = publicationInput(), v = promotePublication(v0, must(composePublication(v0)));
    const skill = v.selections[0]!.candidate;
    const revision: DependencyPin["revision"] = type === "exact" ? { type, commit: "2".repeat(40) } : { type };
    v.selections = [{ candidate: publicationNative([publicationPin(skill, revision)]), destinationPath: "agent", intent: "new-release", origin: null }];
    const r = composePublication(v);
    if (type === "same-package-revision") expect(r).toEqual({ ok: false, issues: [{ code: "IDENTITY_CONFLICT", at: "dependencies" }] });
    else {
      const output = must(r);
      expect(output.releases[0]!.identity.packageRevision).toEqual({ type: "exact", commit: "2".repeat(40) });
      expect(output.releases[1]!.snapshot.manifest.dependencies[0]!.revision).toEqual(revision);
      expect(output.releases.map(p => p.disposition)).toEqual(["existing", "new"]);
    }
  });
  it("merges identical known/base evidence instead of passing duplicate identities to resolver", () => {
    const v0 = publicationInput(), v = promotePublication(v0, must(composePublication(v0)));
    const spy = vi.spyOn(resolver, "resolvePackages");
    expect(composePublication(v).ok).toBe(true);
    expect(spy.mock.calls[0]![0].knownReleases).toHaveLength(1);
    expect(spy.mock.calls[0]![0].packages).toHaveLength(1);
  });
  it.each(["min", "max", "platform", "tool"])("delegates %s compatibility rejection", mutation => {
    const v = coherent();
    if (mutation === "min") v.target.orgopsVersion = "0.0.0";
    if (mutation === "max") v.target.orgopsVersion = "0.1.0";
    if (mutation === "platform") {
      const s = publicationSkill(); const m = s.snapshot.manifest;
      // Re-export changed compatibility, never mutate or reseal a candidate in composition.
      const candidate = exportSkillPackage(s.snapshot.files.map(f => ({ type: "file", path: f.path, base64: f.base64, executable: f.executable })), {
        metadata: { formatVersion: 1, name: m.name, version: m.version, description: m.description, author: m.author, license: m.license,
          compatibility: { ...m.compatibility, platforms: ["darwin"] }, secrets: [] }, dependencies: [], executables: [], selectedPaths: ["SKILL.md"],
      });
      if (!candidate.ok) throw new Error("fixture");
      v.selections = [{ ...v.selections[0]!, candidate: candidate.value }];
    }
    if (mutation === "tool") v.target.tools = [];
    const r = composePublication(v); expect(r.ok).toBe(false); if (!r.ok) expect(r.issues[0]!.code).toBe("INCOMPATIBLE");
  });
  it("rejects two versions of the same skill in one closure", () => {
    const v = publicationInput();
    v.selections = ["1.0.0", "2.0.0"].map(version => ({ candidate: publicationSkill("echo-skill", version), destinationPath: `skill/${version}`, intent: "new-release", origin: null }));
    expect(composePublication(v)).toEqual({ ok: false, issues: [{ code: "SKILL_CONFLICT", at: "installedSkills" }] });
  });
  it("does not mistake an input literal sentinel for new provenance or rewrite authored text", () => {
    const v = external(), first = "0".repeat(64), second = "0".repeat(63) + "1";
    v.base.commit = first;
    const oldPin = v.selections[0]!.candidate.snapshot.manifest.dependencies[0]!;
    v.selections[0]!.candidate = publicationNative([oldPin], "CLASSIC", second);
    const spy = vi.spyOn(resolver, "resolvePackages");
    const r = must(composePublication(v));
    expect(spy.mock.calls[0]![0].catalogs[0]!.commit).toBe(second);
    expect(r.preconditions.baseCommit).toBe(first);
    expect(r.releases[0]!.identity.packageRevision).toEqual({ type: "exact", commit: "4".repeat(40) });
    expect(r.releases[1]!.snapshot.manifest.kind === "native-agent" && r.releases[1]!.snapshot.manifest.native.systemInstructions).toBe(second);
    expect(r.releases[1]!.snapshot.manifest.dependencies[0]!.revision).toEqual(oldPin.revision);
    expect(JSON.stringify(r.releases.map(p => p.identity))).not.toContain(second);
    expect(JSON.stringify(r.proposedIndex)).not.toContain(second);
    expect(JSON.stringify(r.preconditions)).not.toContain(second);
  });
  it("collects exact dependency commits, not just catalog/package envelope commits", () => {
    const v = coherent(), first = "0".repeat(64), second = "0".repeat(63) + "1";
    const pin = publicationPin(v.selections[0]!.candidate, { type: "exact", commit: first });
    v.selections[1]!.candidate = publicationNative([pin]);
    const spy = vi.spyOn(resolver, "resolvePackages");
    expect(composePublication(v).ok).toBe(false);
    expect(spy.mock.calls[0]![0].catalogs[0]!.commit).toBe(second);
  });
});

describe("independent reached-source policy", () => {
  it.each(["catalog-disabled", "source-disabled", "cross-source-denied", "external-denied", "same-source-external-denied"])("rejects %s before resolver delegation", mutation => {
    const v = external(mutation.includes("external") ? "source" : "catalog", mutation === "same-source-external-denied");
    if (mutation === "catalog-disabled") v.catalogs[0]!.enabled = false;
    if (mutation === "source-disabled") v.sources[1]!.enabled = false;
    if (["cross-source-denied", "external-denied"].includes(mutation)) v.sources[1]!.allowPackages = false;
    const before = structuredClone(v.sources), spy = vi.spyOn(resolver, "resolvePackages");
    const r = composePublication(v);
    expect(r.ok).toBe(false); if (!r.ok) expect(r.issues[0]!.code).toBe("SOURCE_NOT_ALLOWED");
    expect(spy).not.toHaveBeenCalled(); expect(v.sources).toEqual(before);
  });
  it.each(["catalog", "source"] as const)("uses explicit permitted existing %s evidence without registering sources", location => {
    const v = external(location), spy = vi.spyOn(resolver, "resolvePackages"), r = must(composePublication(v));
    expect(spy.mock.calls[0]![0].allowedSourceIds).toEqual(["external-source", "team-source"]);
    expect(r.preconditions.sources).toHaveLength(2);
    expect(r.releases[0]!.disposition).toBe("existing");
  });
  it("requires no external package permission for same-source catalog-owned dependency", () => {
    expect(composePublication(external("catalog", true)).ok).toBe(true);
  });
  it("does not authorize or demand bytes for untouched denied historical external entries", () => {
    const v = publicationInput(), text = JSON.stringify({ formatVersion: 1, entries: [{ kind: "skill", name: "unused", version: "1.0.0", digest: digest("unused"),
      location: { type: "source", sourceId: "denied", commit: "9".repeat(40), path: "unused" } }] });
    v.sources = [...v.sources, { sourceId: "denied", repository: { url: "https://example.invalid/denied.git" }, enabled: false, allowPackages: false }];
    v.base.indexBase64 = bytes(text);
    v.base.inventory.entries = v.base.inventory.entries.map(e => e.type === "file" ? { ...e, size: Buffer.byteLength(text), digest: digest(text) } : e);
    const spy = vi.spyOn(resolver, "resolvePackages"), r = must(composePublication(v));
    expect(r.proposedIndex.entries.map(e => e.name)).toEqual(["echo-skill", "unused"]);
    expect(r.releases).toHaveLength(1);
    expect(spy.mock.calls[0]![0].allowedSourceIds).toEqual(["team-source"]);
  });
  it("fails on missing external snapshot evidence", () => {
    const v = external(); v.packages = [];
    expect(composePublication(v)).toEqual({ ok: false, issues: [{ code: "MISSING_RELEASE", at: "packages" }] });
  });
});

it.each(["native-agent", "wrapped-agent"] as const)("rejects a %s dependency through unchanged resolver semantics", kind => {
  const v = coherent(), native = publicationNative([]);
  let candidate = native;
  if (kind === "wrapped-agent") {
    const r = exportAgentPackage({ mode: "WRAPPED", wrappedConfig: { runtime: { command: "inert" } } }, {
      metadata: { formatVersion: 1, name: "wrapped", version: "1.0.0", description: "Inert.", author: "Test", license: "MIT",
        compatibility: { orgops: { min: "0.0.1" }, platforms: ["linux"], tools: [] }, secrets: [] }, dependencies: [],
    });
    if (!r.ok) throw new Error("fixture"); candidate = r.value;
  }
  const root = publicationSkill("root", "1.0.0", [publicationPin(candidate)]);
  v.selections = [{ candidate, destinationPath: "dep", intent: "new-release", origin: null },
    { candidate: root, destinationPath: "root", intent: "new-release", origin: null }];
  expect(composePublication(v)).toEqual({ ok: false, issues: [{ code: "UNSUPPORTED_DEPENDENCY", at: "dependencies" }] });
});

it.each(["catalog", "catalog-exact", "source-location", "package", "history-catalog", "history-package", "origin", "known"])("excludes %s commit-typed evidence from the private temporary context", field => {
  const v = external(), first = "0".repeat(64), next = "0".repeat(63) + "1";
  const skill = publicationSkill("unused");
  const identity = { catalogId: "team", sourceId: "team-source", name: "unused", version: "1.0.0", kind: "skill" as const,
    path: "unused", digest: skill.snapshot.manifest.digest, catalogCommit: "7".repeat(40), packageCommit: "7".repeat(40) };
  if (field === "catalog") v.catalogs = [...v.catalogs, { catalogId: "unused", sourceId: "team-source", enabled: false, commit: first, index: { formatVersion: 1, entries: [] } }];
  if (["catalog-exact", "source-location"].includes(field)) v.catalogs[0]!.index.entries.push({ kind: "skill", name: "unused", version: "1.0.0", digest: identity.digest,
    location: field === "catalog-exact" ? { type: "catalog", path: "unused", revision: { type: "exact", commit: first } }
      : { type: "source", sourceId: "external-source", path: "unused", commit: first } });
  if (field === "package") v.packages = [...v.packages, { sourceId: "team-source", commit: first, path: "unused", snapshot: skill.snapshot }];
  if (field === "history-catalog") v.base.history.releases = [{ ...identity, catalogCommit: first }];
  if (field === "history-package") v.base.history.releases = [{ ...identity, packageCommit: first }];
  if (field === "known") v.knownReleases = [{ ...identity, catalogId: "external", catalogCommit: first }];
  if (field === "origin") {
    v.base.history.releases = [identity];
    v.selections[0]!.intent = "new-destination";
    v.selections[0]!.origin = { ...identity, catalogCommit: first };
  }
  const spy = vi.spyOn(resolver, "resolvePackages");
  const r = must(composePublication(v));
  expect(spy.mock.calls[0]![0].catalogs[0]!.commit).toBe(next);
  expect(JSON.stringify(r.releases.map(p => p.identity))).not.toContain(next);
  expect(JSON.stringify(r.proposedIndex)).not.toContain(next);
  expect(JSON.stringify(r.preconditions)).not.toContain(next);
});

it.each([false, true])("rejects contextual new-to-external proposal pins (same source: %s)", sameSource => {
  const v = external("catalog", sameSource), old = v.selections[0]!.candidate.snapshot.manifest.dependencies[0]!;
  v.selections[0]!.candidate = publicationNative([{ ...old, revision: { type: "same-package-revision" } }]);
  const r = composePublication(v);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.issues[0]!.code).toBe(sameSource ? "IDENTITY_CONFLICT" : "UNSUPPORTED_DEPENDENCY");
});
