import { createHash } from "node:crypto";
import { chmod, lstat, mkdtemp, mkdir, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogAuditEvent, PackageManifest } from "@orgops/schemas";

const executionHazards = vi.hoisted(() => [] as string[]);
const installationFault = vi.hoisted(() => ({ point: "" as "" | "staging" | "mid-population" | "promotion" | "cleanup", writes: 0, attemptedCleanup: false }));
vi.mock("node:fs/promises", async original => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    mkdir: async (path: Parameters<typeof actual.mkdir>[0], options?: Parameters<typeof actual.mkdir>[1]) => {
      if (installationFault.point === "staging" && String(path).includes(".install-")) throw Object.assign(new Error("staging failed"), { code: "EIO" });
      return actual.mkdir(path, options as never);
    },
    writeFile: async (path: Parameters<typeof actual.writeFile>[0], data: Parameters<typeof actual.writeFile>[1], options?: Parameters<typeof actual.writeFile>[2]) => {
      if (String(path).includes(".install-") && installationFault.point === "mid-population" && ++installationFault.writes === 2)
        throw Object.assign(new Error("population failed"), { code: "EIO" });
      return actual.writeFile(path, data, options as never);
    },
    rename: async (from: Parameters<typeof actual.rename>[0], to: Parameters<typeof actual.rename>[1]) => {
      if (installationFault.point === "promotion" && String(from).includes(".install-")) throw Object.assign(new Error("promotion failed"), { code: "EIO" });
      return actual.rename(from, to);
    },
    rm: async (path: Parameters<typeof actual.rm>[0], options?: Parameters<typeof actual.rm>[1]) => {
      if (installationFault.point === "cleanup" && String(path).includes(".install-")) {
        installationFault.attemptedCleanup = true;
        throw Object.assign(new Error("cleanup failed"), { code: "EIO" });
      }
      return actual.rm(path, options);
    },
  };
});
vi.mock("node:child_process", async original => {
  const actual = await original<typeof import("node:child_process")>();
  return { ...actual, spawn: (..._args: unknown[]) => { executionHazards.push("subprocess"); throw new Error("subprocess forbidden"); } };
});
vi.mock("@orgops/crypto", async original => {
  const actual = await original<typeof import("@orgops/crypto")>();
  return { ...actual, parseMasterKey: (...args: Parameters<typeof actual.parseMasterKey>) => {
    executionHazards.push("master-key"); return actual.parseMasterKey(...args);
  } };
});
vi.mock("@orgops/skills", async original => {
  const actual = await original<typeof import("@orgops/skills")>();
  return { ...actual, loadSkillEventShapes: async (..._args: unknown[]) => {
    executionHazards.push("authored-event-shape-load"); return [];
  } };
});
vi.mock("../../../agent-runner/src/wrapper-harness/command", async original => {
  const actual = await original<typeof import("../../../agent-runner/src/wrapper-harness/command")>();
  return { ...actual, commandWrapperHarness: new Proxy(actual.commandWrapperHarness, {
    get(target, key, receiver) {
      if (key === "ensureReady" || key === "runTurn") return async () => {
        executionHazards.push(`wrapper-${String(key)}`); throw new Error("wrapper execution forbidden");
      };
      return Reflect.get(target, key, receiver);
    },
  }) };
});
import { computePackageDigest, inspectPackage, prepareImport, readLocalSkillEvidence, type ContentEntry, type PackageSnapshot } from "@orgops/skills";
import { adminActor, openCatalogFixture } from "./test-fixtures";
import { createPackageInstallation, type InstallationInspection } from "./installation";

const commit = "a".repeat(40);
const zeroDigest = `sha256:${"0".repeat(64)}`;
const sha256 = (bytes: Uint8Array | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function snapshot(
  kind: "skill" | "native-agent" | "wrapped-agent",
  name: string,
  mode?: "CLASSIC" | "RLM_REPL",
  dependencies: PackageManifest["dependencies"] = [],
  tools: string[] = [],
): PackageSnapshot {
  const entries: ContentEntry[] = kind === "skill" ? [{
    type: "file", path: "SKILL.md", executable: false,
    base64: Buffer.from(`---\nname: ${name}\ndescription: ${name} fixture\n---\n\nInert fixture.\n`).toString("base64"),
  }, {
    type: "file", path: "event-shapes.ts", executable: false,
    base64: Buffer.from(`(globalThis as any).__catalogExecutionCalls?.push("dynamic-import"); export default [];\n`).toString("base64"),
  }] : [];
  const files = entries.map(entry => {
    if (entry.type !== "file") throw new Error("fixture file expected");
    const bytes = Buffer.from(entry.base64, "base64");
    return { path: entry.path, size: bytes.length, digest: sha256(bytes), executable: entry.executable };
  });
  const base = {
    formatVersion: 1 as const, kind, name, version: "1.0.0", description: `${name} fixture`, author: "OrgOps", license: "MIT",
    compatibility: { orgops: { min: "0.0.1" }, platforms: ["linux" as const], tools }, secrets: [], dependencies,
    files, executables: kind === "skill" ? [{ path: "event-shapes.ts", execution: "api-event-shapes" as const }] : [], digest: zeroDigest,
  };
  const unsigned = kind === "skill" ? { ...base, kind, skill: { entrypoint: "SKILL.md" as const } }
    : kind === "native-agent" ? { ...base, kind, native: { mode: mode!, systemInstructions: "Stay inert.", runtime: {}, alwaysPreloadedSkills: dependencies.map(item => item.name) } }
    : { ...base, kind, wrapped: { kind: "fixture", harness: "command" as const, setup: { command: "never-setup" }, sidecars: [], runtime: { command: "never-runtime" }, session: { scope: "per-agent" as const }, resourceWiring: "none" as const } };
  const computed = computePackageDigest(unsigned, entries);
  if (!computed.ok) throw new Error(JSON.stringify(computed.issues));
  const inspected = inspectPackage({ ...unsigned, digest: computed.value }, entries);
  if (!inspected.ok) throw new Error(JSON.stringify(inspected.issues));
  return inspected.value;
}

type FixtureOptions = {
  installedExact?: boolean;
  occupiedName?: string;
  failInspectionFor?: string;
  failAudit?: boolean;
  revokeAdminAfterResolution?: boolean;
  failDatabase?: boolean;
  failOriginInsert?: boolean;
  gateInspection?: boolean;
  gateOccupancy?: boolean;
  failurePoint?: "staging" | "mid-population" | "promotion" | "cleanup";
  corruptInspection?: "kind" | "path" | "mode" | "digest" | "limit";
  requiredTool?: string;
};

async function installationFixture(options: FixtureOptions = {}) {
  const opened = openCatalogFixture();
  const artifactRoot = await mkdtemp(join(tmpdir(), "catalog-installation-"));
  const skill = snapshot("skill", "demo-skill", undefined, [], options.requiredTool ? [options.requiredTool] : []);
  const skillTwo = snapshot("skill", "demo-skill-two");
  const pin = { catalogId: "source-team", sourceId: "source-team", name: "demo-skill", version: "1.0.0", revision: { type: "exact" as const, commit }, digest: skill.manifest.digest };
  const pinTwo = { catalogId: "source-team", sourceId: "source-team", name: "demo-skill-two", version: "1.0.0", revision: { type: "exact" as const, commit }, digest: skillTwo.manifest.digest };
  const snapshots = new Map<string, PackageSnapshot>([
    ["release-skill", skill],
    ["release-skill-two", skillTwo],
    ["release-native-classic", snapshot("native-agent", "native-classic", "CLASSIC")],
    ["release-native-rlm", snapshot("native-agent", "native-rlm", "RLM_REPL", [pin])],
    ["release-native-closure", snapshot("native-agent", "native-closure", "RLM_REPL", [pin, pinTwo])],
    ["release-wrapped", snapshot("wrapped-agent", "wrapped")],
  ]);
  opened.db.prepare(`INSERT INTO catalog_sources
    (source_id,display_name,canonical_url,repository_identity,ref,enabled,allow_packages,revision,created_at,updated_at)
    VALUES ('source-team','Team','https://github.com/example/team',?,'main',1,0,1,1,1)`)
    .run(JSON.stringify(["github", "example", "team"]));
  for (const [id, item] of snapshots) {
    opened.db.prepare(`INSERT INTO catalog_package_releases
      (package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,
       manifest_json,execution_preview_json,warnings_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)`).run(
      id, "source-team", "source-team", item.manifest.kind, item.manifest.name, item.manifest.version, item.manifest.digest,
      commit, commit, `packages/${item.manifest.name}`, JSON.stringify(item.manifest), JSON.stringify(item.execution), JSON.stringify(item.warnings),
    );
    opened.db.prepare(`INSERT INTO catalog_release_controls
      (package_release_id,review_state,review_digest,reviewed_by_human_id,reviewed_at,revision,created_at,updated_at)
      VALUES (?,'APPROVED',?,'human-a',1,1,1,1)`).run(id, item.manifest.digest);
  }
  if (options.occupiedName) await mkdir(join(artifactRoot, options.occupiedName));

  executionHazards.length = 0;
  installationFault.point = options.failurePoint ?? "";
  installationFault.writes = 0;
  installationFault.attemptedCleanup = false;
  (globalThis as typeof globalThis & { __catalogExecutionCalls?: string[] }).__catalogExecutionCalls = executionHazards;
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    executionHazards.push("network"); throw new Error("network forbidden");
  });
  let inspectionEntries = 0;
  let announceInspection!: () => void;
  let releaseInspections!: () => void;
  const inspectionEntered = new Promise<void>(resolve => { announceInspection = resolve; });
  const inspectionsReleased = new Promise<void>(resolve => { releaseInspections = resolve; });
  let occupancyEntries = 0;
  let announceTwoOccupancies!: () => void;
  let releaseOccupancies!: () => void;
  const twoOccupanciesEntered = new Promise<void>(resolve => { announceTwoOccupancies = resolve; });
  const occupanciesReleased = new Promise<void>(resolve => { releaseOccupancies = resolve; });
  const inspectGitPackage = vi.fn(async (release: InstallationInspection) => {
    if (options.gateInspection && release.packageReleaseId === "release-skill") {
      inspectionEntries++;
      announceInspection();
      await inspectionsReleased;
    }
    if (release.packageReleaseId === options.failInspectionFor) return { ok: false as const, issues: [{ code: "GIT_FAILED" as const, at: "git" as const }] };
    const value = structuredClone(snapshots.get(release.packageReleaseId)!);
    if (release.packageReleaseId === "release-skill" && options.corruptInspection) {
      if (options.corruptInspection === "kind") (value.manifest as { kind: string }).kind = "native-agent";
      if (options.corruptInspection === "path") (value.files[0] as { path: string }).path = "../escape";
      if (options.corruptInspection === "mode") (value.files[0] as { executable: boolean }).executable = true;
      if (options.corruptInspection === "digest") (value.files[0] as { digest: string }).digest = zeroDigest;
      if (options.corruptInspection === "limit") (value.files as PackageSnapshot["files"] & unknown[]).push(...Array.from({ length: 300 }, (_, i) => ({
        path: `extra-${i}`, base64: "", executable: false, size: 0, digest: sha256("")
      })));
    }
    return { ok: true as const, value };
  });
  const prepare = vi.fn((input: Parameters<typeof prepareImport>[0]) => {
    const result = prepareImport(input);
    if (options.revokeAdminAfterResolution) opened.db.prepare("UPDATE humans SET is_admin=0 WHERE id='human-a'").run();
    return result;
  });
  const evidence = vi.fn(async (...args: Parameters<typeof readLocalSkillEvidence>) => {
    const result = await readLocalSkillEvidence(...args);
    if (options.gateOccupancy && args[0].directory === artifactRoot) {
      occupancyEntries++;
      if (occupancyEntries === 2) announceTwoOccupancies();
      await occupanciesReleased;
    }
    return result;
  });
  const audits: CatalogAuditEvent[] = [];
  if (options.failDatabase) opened.db.exec(`CREATE TRIGGER fail_catalog_installation
    BEFORE INSERT ON catalog_installations BEGIN SELECT RAISE(ABORT, 'fixture database failure'); END`);
  if (options.failOriginInsert) opened.db.exec(`CREATE TRIGGER fail_catalog_origin
    BEFORE INSERT ON catalog_installed_origins BEGIN SELECT RAISE(ABORT, 'fixture origin failure'); END`);
  const writeAudit = (tx: typeof opened.db, event: CatalogAuditEvent) => {
    expect(tx.inTransaction).toBe(true);
    if (options.failAudit) throw new Error("audit persistence failed");
    tx.prepare(`INSERT INTO events
      (id,type,payload_json,source,channel_id,parent_event_id,deliver_at,status,fail_count,last_error,idempotency_key,created_at)
      VALUES (?,?,?,?,NULL,NULL,NULL,'DELIVERED',0,NULL,NULL,?)`)
      .run(`audit-${audits.length}`, event.type, JSON.stringify(event.payload), "system", Date.now());
    audits.push(event);
  };
  const makeInstallation = () => createPackageInstallation({
    db: opened.db, inspectGitPackage, readLocalSkillEvidence: evidence, prepareImport: prepare, artifactRoot,
    writeAudit,
  });
  const installation = makeInstallation();

  if (options.installedExact) {
    const first = await installation.installExact({ packageReleaseId: "release-skill", dependencyReleaseIds: [] }, adminActor());
    expect(first).toMatchObject({ ok: true, packages: [{ action: "installed" }] });
  }

  return {
    ...opened, artifactRoot, installation, snapshots, audits, inspectGitPackage, prepare, evidence,
    createSiblingInstallation: makeInstallation,
    waitForInspection: () => inspectionEntered,
    inspectionEntries: () => inspectionEntries,
    continueInspections: releaseInspections,
    waitForTwoOccupancies: () => twoOccupanciesEntered,
    occupancyEntries: () => occupancyEntries,
    continueOccupancies: releaseOccupancies,
    executionCalls: () => [...executionHazards, ...(fetchSpy.mock.calls.length ? ["network-spy"] : [])],
    listArtifactNames: async () => (await readdir(artifactRoot)).filter(name => !name.startsWith(".install-")).sort(),
    listInstallations: () => opened.db.prepare("SELECT release_id,artifact_digest,artifact_path FROM catalog_installations ORDER BY release_id").all(),
    listOrigins: () => opened.db.prepare(`SELECT name,catalog_id,source_id,catalog_commit,package_commit,path,kind,version,digest,
      local_path,installed_by_human_id,installed_at FROM catalog_installed_origins ORDER BY name`).all(),
    mutateArtifact: async () => {
      const row = opened.db.prepare<[], { artifact_path: string }>("SELECT artifact_path FROM catalog_installations WHERE release_id='release-skill'").get()!;
      await writeFile(join(row.artifact_path, "SKILL.md"), "mutated", { flag: "w" });
    },
    dispose: async () => {
      installationFault.point = "";
      delete (globalThis as typeof globalThis & { __catalogExecutionCalls?: string[] }).__catalogExecutionCalls;
      opened.close(); await rm(artifactRoot, { recursive: true, force: true });
    },
  };
}

const fixtures: Awaited<ReturnType<typeof installationFixture>>[] = [];
afterEach(async () => {
  while (fixtures.length) await fixtures.pop()!.dispose();
  vi.restoreAllMocks();
});
async function tracked(options?: FixtureOptions) {
  const fixture = await installationFixture(options);
  fixtures.push(fixture);
  return fixture;
}

describe("PackageInstallation exact inert installation", () => {
  it("installs a package requiring the Node runtime capability", async () => {
    const fixture = await tracked({ requiredTool: "node" });
    expect(await fixture.installation.installExact({ packageReleaseId: "release-skill", dependencyReleaseIds: [] }, adminActor()))
      .toMatchObject({ ok: true, packages: [{ packageReleaseId: "release-skill", action: "installed" }], activated: false });
    expect(fixture.listOrigins()).toHaveLength(1);
  });

  it("rejects a package requiring an unsupported tool before writing files or rows", async () => {
    const fixture = await tracked({ requiredTool: "unsupported-install-tool" });
    expect(await fixture.installation.installExact({ packageReleaseId: "release-skill", dependencyReleaseIds: [] }, adminActor()))
      .toEqual({ ok: false, code: "INSPECTION_FAILED" });
    expect(await fixture.listArtifactNames()).toEqual([]);
    expect(fixture.listInstallations()).toEqual([]);
    expect(fixture.listOrigins()).toEqual([]);
  });

  it("installs SKILL, native CLASSIC, native RLM_REPL, and WRAPPED artifacts without execution", async () => {
    const fixture = await tracked();
    const commands = [
      { packageReleaseId: "release-skill", dependencyReleaseIds: [] },
      { packageReleaseId: "release-native-classic", dependencyReleaseIds: [] },
      { packageReleaseId: "release-native-rlm", dependencyReleaseIds: ["release-skill"] },
      { packageReleaseId: "release-wrapped", dependencyReleaseIds: [] },
    ];
    for (const command of commands) {
      const result = await fixture.installation.installExact(command, adminActor());
      expect(result).toMatchObject({ ok: true, activated: false });
    }
    expect(fixture.executionCalls()).toEqual([]);
    expect(fixture.inspectGitPackage).toHaveBeenCalledTimes(5);
    expect(fixture.prepare).toHaveBeenCalledTimes(4);
    expect(fixture.listOrigins()).toHaveLength(1);
    expect(fixture.db.prepare("SELECT count(*) AS n FROM agents").get()).toEqual({ n: 1 });
    expect(fixture.db.prepare("SELECT count(*) AS n FROM agent_skill_assignments").get()).toEqual({ n: 0 });
    expect(fixture.db.prepare("SELECT count(*) AS n FROM catalog_api_activations").get()).toEqual({ n: 0 });
  });

  it("rejects occupied names without overwriting or writing origins", async () => {
    const fixture = await tracked({ occupiedName: "native-rlm" });
    const marker = join(fixture.artifactRoot, "native-rlm", "owner.txt");
    await writeFile(marker, "pre-existing");
    const result = await fixture.installation.installExact({ packageReleaseId: "release-native-rlm", dependencyReleaseIds: ["release-skill"] }, adminActor());
    expect(result).toMatchObject({ ok: false, code: "STATE_CONFLICT" });
    expect(await fixture.listArtifactNames()).toEqual(["native-rlm"]);
    expect(await readFile(marker, "utf8")).toBe("pre-existing");
    expect(fixture.listOrigins()).toEqual([]);
  });

  it("remeasures every path, byte, mode, size, digest, and provenance binding before exact reuse", async () => {
    const fixture = await tracked({ installedExact: true });
    expect(await fixture.installation.installExact({ packageReleaseId: "release-skill", dependencyReleaseIds: [] }, adminActor()))
      .toMatchObject({ ok: true, packages: [{ action: "reused" }], activated: false });
    await fixture.mutateArtifact();
    expect(await fixture.installation.installExact({ packageReleaseId: "release-skill", dependencyReleaseIds: [] }, adminActor()))
      .toEqual({ ok: false, code: "INSPECTION_FAILED" });
  });

  it("fails closed when approval identity changes during awaited inspection", async () => {
    const fixture = await tracked({ gateInspection: true });
    const untouchedDirectory = join(fixture.artifactRoot, "unmanaged");
    const untouchedMarker = join(untouchedDirectory, "owner.txt");
    await mkdir(untouchedDirectory);
    await writeFile(untouchedMarker, "pre-existing");
    const artifactRootBefore = await readdir(fixture.artifactRoot);
    const expectedDigestPath = join(fixture.artifactRoot, "demo-skill",
      fixture.snapshots.get("release-skill")!.manifest.digest.slice("sha256:".length));
    const install = fixture.installation.installExact({ packageReleaseId: "release-skill", dependencyReleaseIds: [] }, adminActor());
    await fixture.waitForInspection();
    const changedReviewDigest = `sha256:${"f".repeat(64)}`;
    fixture.db.prepare(`UPDATE catalog_release_controls SET review_digest=?,reviewed_at=2,revision=2,updated_at=2
      WHERE package_release_id='release-skill'`).run(changedReviewDigest);
    fixture.continueInspections();

    expect(await install).toEqual({ ok: false, code: "RELEASE_NOT_APPROVED" });
    expect(fixture.listInstallations()).toEqual([]);
    expect(fixture.listOrigins()).toEqual([]);
    expect(fixture.audits.filter(event => event.payload.outcome === "SUCCEEDED")).toEqual([]);
    expect(fixture.db.prepare(`SELECT count(*) AS n FROM events WHERE type='audit.catalog.installation.changed'
      AND json_extract(payload_json,'$.outcome')='SUCCEEDED'`).get()).toEqual({ n: 0 });
    expect(fixture.db.prepare(`SELECT review_state,review_digest,reviewed_at,revision,updated_at
      FROM catalog_release_controls WHERE package_release_id='release-skill'`).get()).toEqual({
      review_state: "APPROVED", review_digest: changedReviewDigest, reviewed_at: 2, revision: 2, updated_at: 2,
    });
    expect(await readdir(fixture.artifactRoot)).toEqual(artifactRootBefore);
    expect((await readdir(fixture.artifactRoot)).some(name => name.startsWith(".install-"))).toBe(false);
    await expect(lstat(join(fixture.artifactRoot, "demo-skill"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(expectedDigestPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(untouchedMarker, "utf8")).toBe("pre-existing");
  });

  it("persists complete format-v1 skill origin values with the installation and audit", async () => {
    const fixture = await tracked();
    expect(await fixture.installation.installExact({ packageReleaseId: "release-skill", dependencyReleaseIds: [] }, adminActor()))
      .toMatchObject({ ok: true, packages: [{ packageReleaseId: "release-skill", action: "installed" }] });
    const installation = fixture.listInstallations()[0] as { artifact_path: string };
    expect(fixture.listOrigins()).toEqual([{
      name: "demo-skill", catalog_id: "source-team", source_id: "source-team",
      catalog_commit: commit, package_commit: commit, path: "packages/demo-skill", kind: "skill",
      version: "1.0.0", digest: fixture.snapshots.get("release-skill")!.manifest.digest,
      local_path: installation.artifact_path, installed_by_human_id: "human-a", installed_at: expect.any(Number),
    }]);
    expect(fixture.audits.filter(event => event.payload.outcome === "SUCCEEDED")).toHaveLength(1);
  });

  it.each([
    ["missing", []],
    ["duplicate", ["release-skill", "release-skill"]],
    ["extra", ["release-skill", "release-skill-two", "release-wrapped"]],
    ["reordered", ["release-skill-two", "release-skill"]],
    ["stale or mismatched", ["release-wrapped", "release-skill-two"]],
  ])("rejects a %s exact closure before claiming artifacts", async (_case, dependencyReleaseIds) => {
    const fixture = await tracked();
    const result = await fixture.installation.installExact({ packageReleaseId: "release-native-closure", dependencyReleaseIds }, adminActor());
    expect(result).toMatchObject({ ok: false });
    expect(fixture.listOrigins()).toEqual([]);
    expect(await fixture.listArtifactNames()).toEqual([]);
  });

  it.each(["kind", "path", "mode", "digest", "limit"] as const)("rejects invalid inspected package %s evidence before writing", async corruptInspection => {
    const fixture = await tracked({ corruptInspection });
    expect(await fixture.installation.installExact({ packageReleaseId: "release-skill", dependencyReleaseIds: [] }, adminActor()))
      .toEqual({ ok: false, code: "INSPECTION_FAILED" });
    expect(fixture.listOrigins()).toEqual([]);
    expect(await fixture.listArtifactNames()).toEqual([]);
  });

  it.each(["actor", "timestamp"] as const)("rejects exact reuse after origin %s drift without overwriting", async drift => {
    const fixture = await tracked({ installedExact: true });
    const installationBefore = fixture.db.prepare(`SELECT release_id,artifact_digest,artifact_path,state,
      installed_by_human_id,installed_at,last_verified_at,revision FROM catalog_installations WHERE release_id='release-skill'`).get();
    const artifactPath = (installationBefore as { artifact_path: string }).artifact_path;
    const bytesBefore = await readFile(join(artifactPath, "SKILL.md"));
    const successAuditsBefore = fixture.audits.filter(event => event.payload.outcome === "SUCCEEDED").length;
    const successAuditRowsBefore = fixture.db.prepare(`SELECT count(*) AS n FROM events
      WHERE type='audit.catalog.installation.changed' AND json_extract(payload_json,'$.outcome')='SUCCEEDED'`).get();
    if (drift === "actor") fixture.db.prepare(`UPDATE catalog_installed_origins SET installed_by_human_id='human-other'
      WHERE name='demo-skill'`).run();
    if (drift === "timestamp") fixture.db.prepare(`UPDATE catalog_installed_origins SET installed_at=installed_at+1
      WHERE name='demo-skill'`).run();

    expect(await fixture.installation.installExact({ packageReleaseId: "release-skill", dependencyReleaseIds: [] }, adminActor()))
      .toEqual({ ok: false, code: "INSPECTION_FAILED" });
    expect(fixture.db.prepare(`SELECT release_id,artifact_digest,artifact_path,state,
      installed_by_human_id,installed_at,last_verified_at,revision FROM catalog_installations WHERE release_id='release-skill'`).get())
      .toEqual(installationBefore);
    expect(await readFile(join(artifactPath, "SKILL.md"))).toEqual(bytesBefore);
    expect(fixture.audits.filter(event => event.payload.outcome === "SUCCEEDED")).toHaveLength(successAuditsBefore);
    expect(fixture.db.prepare(`SELECT count(*) AS n FROM events
      WHERE type='audit.catalog.installation.changed' AND json_extract(payload_json,'$.outcome')='SUCCEEDED'`).get())
      .toEqual(successAuditRowsBefore);
  });

  it.each(["missing", "extra", "mode", "symlink", "origin"] as const)("rejects exact reuse after %s drift", async drift => {
    const fixture = await tracked({ installedExact: true });
    const row = fixture.db.prepare<[], { artifact_path: string }>("SELECT artifact_path FROM catalog_installations WHERE release_id='release-skill'").get()!;
    const skillPath = join(row.artifact_path, "SKILL.md");
    if (drift === "missing") await unlink(skillPath);
    if (drift === "extra") await writeFile(join(row.artifact_path, "extra.txt"), "extra");
    if (drift === "mode") await chmod(skillPath, 0o755);
    if (drift === "symlink") { await unlink(skillPath); await symlink("event-shapes.ts", skillPath); }
    if (drift === "origin") fixture.db.prepare("UPDATE catalog_installed_origins SET source_id='source-other' WHERE name='demo-skill'").run();
    expect(await fixture.installation.installExact({ packageReleaseId: "release-skill", dependencyReleaseIds: [] }, adminActor()))
      .toEqual({ ok: false, code: "INSPECTION_FAILED" });
  });

  it("rechecks live administrator authority in the final immediate transaction", async () => {
    const fixture = await tracked({ revokeAdminAfterResolution: true });
    expect(await fixture.installation.installExact({ packageReleaseId: "release-skill", dependencyReleaseIds: [] }, adminActor()))
      .toEqual({ ok: false, code: "FORBIDDEN" });
    expect(fixture.listOrigins()).toEqual([]);
    expect(fixture.db.prepare("SELECT count(*) AS n FROM catalog_install_operations").get()).toEqual({ n: 0 });
    expect(await fixture.listArtifactNames()).toEqual([]);
  });

  it("requires a fresh live administrator and approved immutable release digest", async () => {
    const fixture = await tracked();
    fixture.db.prepare("UPDATE humans SET is_admin=0 WHERE id='human-a'").run();
    expect(await fixture.installation.installExact({ packageReleaseId: "release-skill", dependencyReleaseIds: [] }, adminActor()))
      .toEqual({ ok: false, code: "FORBIDDEN" });
    fixture.db.prepare("UPDATE humans SET is_admin=1").run();
    fixture.db.prepare("UPDATE catalog_release_controls SET review_state='WITHDRAWN'").run();
    expect(await fixture.installation.installExact({ packageReleaseId: "release-skill", dependencyReleaseIds: [] }, adminActor()))
      .toEqual({ ok: false, code: "RELEASE_NOT_APPROVED" });
    expect(fixture.listOrigins()).toEqual([]);
  });

  it("rolls back every installation and typed audit when audit persistence fails", async () => {
    const fixture = await tracked({ failAudit: true });
    const result = await fixture.installation.installExact({ packageReleaseId: "release-native-rlm", dependencyReleaseIds: ["release-skill"] }, adminActor());
    expect(result).toEqual({ ok: false, code: "STORAGE_FAILURE" });
    expect(fixture.listOrigins()).toEqual([]);
    expect(fixture.db.prepare("SELECT count(*) AS n FROM events WHERE type='audit.catalog.installation.changed'").get()).toEqual({ n: 0 });
    expect(await fixture.listArtifactNames()).toEqual([]);
  });

  it("fails closed on inspection during a multi-package install and cleans only its operation staging", async () => {
    const fixture = await tracked({ failInspectionFor: "release-skill" });
    await mkdir(join(fixture.artifactRoot, "unmanaged"));
    const result = await fixture.installation.installExact({ packageReleaseId: "release-native-rlm", dependencyReleaseIds: ["release-skill"] }, adminActor());
    expect(result).toEqual({ ok: false, code: "INSPECTION_FAILED" });
    expect(await fixture.listArtifactNames()).toEqual(["unmanaged"]);
    expect(fixture.listOrigins()).toEqual([]);
  });

  it.each([
    ["staging", "staging"],
    ["mid-population", "mid-population"],
    ["promotion", "promotion"],
  ] as const)("rolls back filesystem claims and database origins after a %s failure", async (_label, failurePoint) => {
    const fixture = await tracked({ failurePoint });
    await mkdir(join(fixture.artifactRoot, "unmanaged"));
    const result = await fixture.installation.installExact({ packageReleaseId: "release-native-rlm", dependencyReleaseIds: ["release-skill"] }, adminActor());
    expect(result).toEqual({ ok: false, code: "STORAGE_FAILURE" });
    expect(fixture.listOrigins()).toEqual([]);
    expect(await fixture.listArtifactNames()).toEqual(["unmanaged"]);
  });

  it("rolls back installation, origin, and success audit when format-v1 origin insertion fails", async () => {
    const fixture = await tracked({ failOriginInsert: true });
    expect(await fixture.installation.installExact({ packageReleaseId: "release-skill", dependencyReleaseIds: [] }, adminActor()))
      .toEqual({ ok: false, code: "STORAGE_FAILURE" });
    expect(fixture.listInstallations()).toEqual([]);
    expect(fixture.listOrigins()).toEqual([]);
    expect(fixture.audits.filter(event => event.payload.outcome === "SUCCEEDED")).toEqual([]);
    expect(fixture.db.prepare(`SELECT count(*) AS n FROM events WHERE type='audit.catalog.installation.changed'
      AND json_extract(payload_json,'$.outcome')='SUCCEEDED'`).get()).toEqual({ n: 0 });
    expect(await fixture.listArtifactNames()).toEqual([]);
  });

  it("rolls back all origins and claimed targets after a database transaction failure", async () => {
    const fixture = await tracked({ failDatabase: true });
    const result = await fixture.installation.installExact({ packageReleaseId: "release-native-rlm", dependencyReleaseIds: ["release-skill"] }, adminActor());
    expect(result).toEqual({ ok: false, code: "STORAGE_FAILURE" });
    expect(fixture.listOrigins()).toEqual([]);
    expect(fixture.db.prepare("SELECT state,failure_code FROM catalog_install_operations").get())
      .toEqual({ state: "FAILED", failure_code: "STORAGE_FAILURE" });
    expect(fixture.db.prepare("SELECT count(*) AS n FROM events WHERE type='audit.catalog.installation.changed'").get()).toEqual({ n: 1 });
    expect(await fixture.listArtifactNames()).toEqual([]);
  });

  it("attempts only operation-owned cleanup and fails closed when cleanup itself fails", async () => {
    const fixture = await tracked({ failurePoint: "cleanup" });
    await mkdir(join(fixture.artifactRoot, "unmanaged"));
    const result = await fixture.installation.installExact({ packageReleaseId: "release-skill", dependencyReleaseIds: [] }, adminActor());
    expect(result).toEqual({ ok: false, code: "STORAGE_FAILURE" });
    expect(installationFault.attemptedCleanup).toBe(true);
    expect((await readdir(fixture.artifactRoot)).includes("unmanaged")).toBe(true);
    expect(fixture.listOrigins()).toEqual([]);
    installationFault.point = "";
  });

  it("allows exactly one cross-instance winner without overwriting or cleaning winner and sibling content", async () => {
    const fixture = await tracked({ gateOccupancy: true });
    const untouchedDirectory = join(fixture.artifactRoot, "unmanaged");
    const untouchedMarker = join(untouchedDirectory, "owner.txt");
    await mkdir(untouchedDirectory);
    await writeFile(untouchedMarker, "pre-existing");
    const sibling = fixture.createSiblingInstallation();
    const command = { packageReleaseId: "release-skill", dependencyReleaseIds: [] };
    const first = fixture.installation.installExact(command, adminActor());
    const second = sibling.installExact(command, adminActor());
    await fixture.waitForTwoOccupancies();
    expect(fixture.occupancyEntries()).toBe(2);
    fixture.continueOccupancies();
    const outcomes = await Promise.all([first, second]);

    expect(outcomes.filter(result => result.ok)).toHaveLength(1);
    expect(outcomes.filter(result => !result.ok)).toEqual([{ ok: false, code: "STATE_CONFLICT" }]);
    expect(fixture.listInstallations()).toHaveLength(1);
    expect(fixture.listOrigins()).toHaveLength(1);
    expect(fixture.audits.filter(event => event.payload.outcome === "SUCCEEDED")).toHaveLength(1);
    expect(fixture.db.prepare(`SELECT count(*) AS n FROM events WHERE type='audit.catalog.installation.changed'
      AND json_extract(payload_json,'$.outcome')='SUCCEEDED'`).get()).toEqual({ n: 1 });
    expect(await readFile(untouchedMarker, "utf8")).toBe("pre-existing");
    const installation = fixture.listInstallations()[0] as { artifact_path: string; artifact_digest: string };
    expect((fixture.listOrigins()[0] as { local_path: string; digest: string })).toMatchObject({
      local_path: installation.artifact_path, digest: installation.artifact_digest,
    });
    const expected = fixture.snapshots.get("release-skill")!;
    for (const file of expected.files) {
      expect(await readFile(join(installation.artifact_path, file.path))).toEqual(Buffer.from(file.base64, "base64"));
      expect((await lstat(join(installation.artifact_path, file.path))).mode & 0o777).toBe(file.executable ? 0o755 : 0o644);
    }
    expect(JSON.parse(await readFile(join(installation.artifact_path, "orgops-package.json"), "utf8")))
      .toEqual(expected.manifest);
    expect((await lstat(join(installation.artifact_path, "orgops-package.json"))).mode & 0o777).toBe(0o644);
  });

  it("stores typed transaction-owned provenance and operation audit only after complete promotion", async () => {
    const fixture = await tracked();
    const result = await fixture.installation.installExact({ packageReleaseId: "release-native-rlm", dependencyReleaseIds: ["release-skill"] }, adminActor());
    expect(result).toMatchObject({ ok: true, packages: [
      { packageReleaseId: "release-native-rlm", action: "installed" },
      { packageReleaseId: "release-skill", action: "installed" },
    ], activated: false });
    expect(fixture.audits).toHaveLength(1);
    expect(fixture.audits[0]).toMatchObject({ type: "audit.catalog.installation.changed", source: "system", status: "DELIVERED", channelId: null,
      payload: { actorKind: "HUMAN_ADMIN", actorId: "human-a", action: "install", outcome: "SUCCEEDED", releaseId: "release-native-rlm" } });
    for (const row of fixture.listInstallations() as Array<{ artifact_digest: string; artifact_path: string }>) {
      expect(row.artifact_path.startsWith(fixture.artifactRoot + "/")).toBe(true);
      expect(row.artifact_path).toContain(row.artifact_digest.slice("sha256:".length));
    }
  });
});
