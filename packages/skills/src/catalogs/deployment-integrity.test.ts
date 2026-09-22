import { describe, expect, it } from "vitest";
import type { PackageManifest, ReleaseIdentity } from "@orgops/schemas";
import { resolveImmutablePackageClosure, type ImmutablePackage } from "./deployment-integrity";

const digest = `sha256:${"a".repeat(64)}`;
const commit = "a".repeat(40);
const pin = {
  catalogId: "source-a", sourceId: "source-a", name: "dependency", version: "1.0.0", digest,
  revision: { type: "exact" as const, commit },
};
const manifest = (name: string, dependencies: PackageManifest["dependencies"] = []): PackageManifest => ({
  formatVersion: 1, kind: "skill", name, version: "1.0.0", description: "fixture", author: "OrgOps", license: "MIT",
  compatibility: { orgops: { min: "0.0.1" }, platforms: ["linux"], tools: [] }, secrets: [], dependencies,
  files: [], executables: [], digest, skill: { entrypoint: "SKILL.md" },
});
const release = (packageReleaseId: string, name: string): ReleaseIdentity => ({
  packageReleaseId, authoritySourceId: "source-a", contentSourceId: "source-a", kind: "skill", name, version: "1.0.0",
  catalogCommit: commit, packageCommit: commit, packagePath: `skills/${name}`, digest,
});
const root: ImmutablePackage = { release: release("release-root", "root"), manifest: manifest("root", [pin]) };
const dependency: ImmutablePackage = { release: release("release-dependency", "dependency"), manifest: manifest("dependency") };
const malformed = { release: dependency.release, manifest: { ...dependency.manifest, name: "other" } } as ImmutablePackage;

function resolve(candidates: readonly ImmutablePackage[]) {
  return resolveImmutablePackageClosure([root.release.packageReleaseId], {
    byId: releaseId => releaseId === root.release.packageReleaseId ? root
      : releaseId === dependency.release.packageReleaseId ? dependency : undefined,
    byPin: () => candidates,
  });
}

describe("immutable package closure pin cardinality", () => {
  it("accepts one valid raw pin candidate", () => {
    expect(resolve([dependency])?.map(item => item.release.packageReleaseId)).toEqual(["release-root", "release-dependency"]);
  });

  it("rejects one malformed raw pin candidate", () => {
    expect(resolve([malformed])).toBeNull();
  });

  it("rejects a malformed and valid raw pin candidate before filtering", () => {
    expect(resolve([malformed, dependency])).toBeNull();
  });

  it("rejects two valid raw pin candidates", () => {
    expect(resolve([dependency, { ...dependency, release: release("release-dependency-duplicate", "dependency") }])).toBeNull();
  });
});
