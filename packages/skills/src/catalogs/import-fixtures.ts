import type { ImportInput, ImportInstalledEntry } from "./import-types";
import { computePackageDigest, inspectPackage, type PackageSnapshot } from "./content";
import { must, skillManifest, skillEntries, classicManifest, rlmManifest, wrappedManifest, catalogIndex } from "./fixtures";
import { exportSkillPackage } from "./export";
import type { DependencyPin, PackageManifest } from "@orgops/schemas";
import type { ContentEntry } from "./content";
// Compact authored commands expand into check-command disclosures and thousands of warnings.
export function expandingSnapshot(): PackageSnapshot {
  const manifest = structuredClone(wrappedManifest);
  const command = { command: "token=synthetic", checkCommand: "token=check", args: Array(128).fill("token=synthetic-sensitive-argument") };
  manifest.wrapped.setup = { ...command };
  manifest.wrapped.sidecars = Array.from({ length: 16 }, (_, i) => ({ ...command, name: `sidecar-${i}` }));
  manifest.wrapped.runtime = { command: command.command, args: command.args };
  manifest.digest = must(computePackageDigest(manifest, []));
  return { manifest, files: [], execution: { apiEventShapes: [], runnerScripts: [], wrappedCommands: [], externalSources: [] }, warnings: [] };
}
export const IMPORT_COMMIT = "1".repeat(40);
export function importInput(name = "echo-agent"): ImportInput {
  const manifests = [skillManifest, classicManifest, rlmManifest, wrappedManifest];
  return structuredClone({
    root: { catalogId: "team", name, version: "1.0.0" },
    sources: [{ sourceId: "team-source", repository: { url: "https://example.invalid/team/catalog.git" }, enabled: true, allowPackages: false }],
    catalogs: [{ catalogId: "team", sourceId: "team-source", commit: IMPORT_COMMIT, enabled: true, index: catalogIndex }],
    packages: manifests.map(m => ({ sourceId: "team-source", commit: IMPORT_COMMIT, path: `packages/${m.name}`, snapshot: must(inspectPackage(m, m.kind === "skill" ? skillEntries : [])) })),
    target: { orgopsVersion: "0.0.1", platform: "linux" as const, tools: ["node"] },
    installed: { complete: true as const, entries: [] }, knownReleases: [],
  });
}
export function measuredSkill(): ImportInstalledEntry {
  return { state: "measured", name: skillManifest.name,
    origin: { catalogId: "team", catalogCommit: IMPORT_COMMIT, sourceId: "team-source", packageCommit: IMPORT_COMMIT,
      path: "packages/echo-skill", kind: "skill", name: skillManifest.name, version: skillManifest.version, digest: skillManifest.digest },
    content: { complete: true, entries: [
      { type: "file", path: "orgops-package.json", base64: Buffer.from(JSON.stringify(skillManifest, null, 2) + "\n").toString("base64"), executable: false },
      ...skillEntries.map(e => { if (e.type !== "file") throw new Error("Synthetic fixture kind"); return { ...e }; }),
    ] } };
}

// Fresh exporter-authored skills for exact dependency graphs; never publication fixtures.
export function importSkill(name: string, dependencies: DependencyPin[] = []): PackageSnapshot {
  const body = Buffer.from(`---\nname: ${name}\ndescription: Synthetic instructions.\n---\nInert.\n`).toString("base64");
  return must(exportSkillPackage([{ type: "file", path: "SKILL.md", base64: body, executable: false }], {
    metadata: { formatVersion: 1, name, version: "1.0.0", description: "Synthetic instructions.", author: "Test", license: "MIT",
      compatibility: { orgops: { min: "0.0.1" }, platforms: ["linux"], tools: [] }, secrets: [] },
    dependencies, executables: [], selectedPaths: ["SKILL.md"],
  })).snapshot;
}
export function importPin(snapshot: PackageSnapshot): DependencyPin {
  return { catalogId: "team", sourceId: "team-source", name: snapshot.manifest.name, version: snapshot.manifest.version,
    revision: { type: "same-package-revision" }, digest: snapshot.manifest.digest };
}
export function importWithPackages(snapshots: readonly PackageSnapshot[]): ImportInput {
  const v = importInput();
  v.catalogs[0]!.index.entries = snapshots.map(({ manifest: m }) => ({ name: m.name, kind: m.kind, version: m.version, digest: m.digest,
    location: { type: "catalog", path: `packages/${m.name}`, revision: { type: "catalog-revision" } } }));
  v.packages = snapshots.map(snapshot => ({ sourceId: "team-source", commit: IMPORT_COMMIT, path: `packages/${snapshot.manifest.name}`, snapshot: structuredClone(snapshot) }));
  const m = snapshots.at(-1)!.manifest; v.root = { catalogId: "team", name: m.name, version: m.version }; return v;
}
export function importReseal(manifest: PackageManifest, entries: readonly ContentEntry[] = []): PackageSnapshot {
  const m = structuredClone(manifest); m.digest = must(computePackageDigest(m, entries)); return must(inspectPackage(m, entries));
}
