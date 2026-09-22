import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { OrgOpsDb } from "@orgops/db";
import {
  CatalogAuditEventSchema,
  HumanAdminSchema,
  PackageManifestSchema,
  PackageReleaseIdSchema,
  RelativePathSchema,
  type CatalogAuditEvent,
  type CatalogLibraryErrorCode,
  type HumanAdmin,
  type InstallExactCommand,
  type PackageInstallation,
  type PackageManifest,
} from "@orgops/schemas";
import type {
  ImportInput,
  ImportPreview,
  ImportResult,
  LocalSkillEvidence,
  LocalSkillEvidenceInput,
  LocalSkillEvidenceOptions,
  LocalSkillEvidenceResult,
  PackageSnapshot,
} from "@orgops/skills";

export type InstallationInspection = Readonly<{
  packageReleaseId: string;
  authoritySourceId: string;
  contentSourceId: string;
  packageCommit: string;
  packagePath: string;
}>;

type InspectGitPackage = (release: InstallationInspection) => Promise<
  { ok: true; value: PackageSnapshot } | { ok: false; issues: readonly unknown[] }
>;
type ReadLocalSkillEvidence = (
  input: LocalSkillEvidenceInput,
  options?: LocalSkillEvidenceOptions,
) => Promise<LocalSkillEvidenceResult<LocalSkillEvidence>>;
type PrepareImport = (input: ImportInput) => ImportResult<ImportPreview>;
type AuditWriter = (tx: OrgOpsDb, event: CatalogAuditEvent) => void;

export type PackageInstallationDeps = Readonly<{
  db: OrgOpsDb;
  inspectGitPackage: InspectGitPackage;
  readLocalSkillEvidence: ReadLocalSkillEvidence;
  prepareImport: PrepareImport;
  artifactRoot: string;
  writeAudit: AuditWriter;
}>;

type ReleaseRow = {
  package_release_id: string;
  authority_source_id: string;
  content_source_id: string;
  kind: string;
  name: string;
  version: string;
  digest: string;
  catalog_commit: string;
  package_commit: string;
  package_path: string;
  manifest_json: string;
  execution_preview_json: string;
  warnings_json: string;
  review_state: string;
  review_digest: string | null;
  control_revision: number;
};
type SourceRow = {
  source_id: string;
  canonical_url: string;
  ssh_user: string | null;
  enabled: number;
  allow_packages: number;
};
type InstallationRow = {
  release_id: string;
  artifact_digest: string;
  artifact_path: string;
  state: "INSTALLED" | "QUARANTINED";
  installed_by_human_id: string;
  installed_at: number;
};
type SkillOriginRow = {
  name: string;
  catalog_id: string;
  source_id: string;
  catalog_commit: string;
  package_commit: string;
  path: string;
  kind: string;
  version: string;
  digest: string;
  local_path: string;
  installed_by_human_id: string | null;
  installed_at: number;
};
type CheckedRelease = {
  row: ReleaseRow;
  finalPath: string;
  action: "installed" | "reused";
  reviewFiles: ImportPreview["packages"][number]["files"];
};

type InstallFailureCode = Extract<CatalogLibraryErrorCode,
  "INVALID_REQUEST" | "FORBIDDEN" | "NOT_FOUND" | "STATE_CONFLICT" | "IDENTITY_CONFLICT" |
  "SOURCE_NOT_ALLOWED" | "SOURCE_UNAVAILABLE" | "RELEASE_NOT_APPROVED" | "OPERATION_IN_PROGRESS" |
  "INSPECTION_FAILED" | "STORAGE_FAILURE"
>;
class InstallFailure extends Error {
  constructor(readonly code: InstallFailureCode) { super(code); }
}
function fail(code: InstallFailureCode): never { throw new InstallFailure(code); }
function required<T>(value: T | undefined, code: InstallFailureCode): T {
  if (value === undefined) fail(code);
  return value;
}
const INSTALLATION_COMPATIBILITY = Object.freeze({
  orgopsVersion: "0.0.1",
  platform: (process.platform === "darwin" || process.platform === "win32" ? process.platform : "linux") as "linux" | "darwin" | "win32",
  // The API is a Node runtime; this explicit capability is not PATH discovery.
  tools: Object.freeze(["node"]),
});
const sha256 = (value: string): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
};
const missing = (error: unknown): boolean => (error as { code?: unknown })?.code === "ENOENT";
const within = (root: string, target: string): boolean => {
  const path = relative(resolve(root), resolve(target));
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !path.startsWith(sep);
};

function parseRelease(row: ReleaseRow): PackageManifest {
  let input: unknown;
  try { input = JSON.parse(row.manifest_json); } catch { fail("INSPECTION_FAILED"); }
  let manifest: PackageManifest;
  try { manifest = PackageManifestSchema.parse(input) as PackageManifest; }
  catch { fail("INSPECTION_FAILED"); }
  if (manifest.kind !== row.kind || manifest.name !== row.name
    || manifest.version !== row.version || manifest.digest !== row.digest
    || !RelativePathSchema.safeParse(row.package_path).success) fail("INSPECTION_FAILED");
  return manifest;
}

function failureCode(error: unknown): InstallFailureCode {
  return error instanceof InstallFailure ? error.code : "STORAGE_FAILURE";
}
async function ensureArtifactRoot(root: string): Promise<void> {
  let stat: Awaited<ReturnType<typeof fs.lstat>> | undefined;
  try { stat = await fs.lstat(root); } catch (error) { if (!missing(error)) throw error; }
  if (!stat) {
    await fs.mkdir(root, { mode: 0o700 });
    stat = await fs.lstat(root);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("STORAGE_FAILURE");
}

export function createPackageInstallation({
  db, inspectGitPackage, readLocalSkillEvidence, prepareImport, artifactRoot, writeAudit,
}: PackageInstallationDeps): PackageInstallation {
  let active = false;
  const releaseById = db.prepare<[string], ReleaseRow>(`SELECT r.*,c.review_state,c.review_digest,c.revision AS control_revision
    FROM catalog_package_releases r JOIN catalog_release_controls c ON c.package_release_id=r.package_release_id
    WHERE r.package_release_id=?`);
  const dependencyRelease = db.prepare<[string, string, string, string, string], ReleaseRow>(`SELECT r.*,c.review_state,c.review_digest,c.revision AS control_revision
    FROM catalog_package_releases r JOIN catalog_release_controls c ON c.package_release_id=r.package_release_id
    WHERE r.authority_source_id=? AND r.content_source_id=? AND r.name=? AND r.version=? AND r.digest=?`);
  const sourceById = db.prepare<[string], SourceRow>(`SELECT source_id,canonical_url,ssh_user,enabled,allow_packages
    FROM catalog_sources WHERE source_id=? AND removed_at IS NULL`);
  const installationById = db.prepare<[string], InstallationRow>(`SELECT release_id,artifact_digest,artifact_path,state,
    installed_by_human_id,installed_at FROM catalog_installations WHERE release_id=?`);
  const occupiedInstalledName = db.prepare<[string, string], { release_id: string }>(`SELECT i.release_id
    FROM catalog_installations i JOIN catalog_package_releases r ON r.package_release_id=i.release_id
    WHERE lower(r.name)=lower(?) AND i.release_id<>? LIMIT 1`);
  const skillOriginByName = db.prepare<[string], SkillOriginRow>(`SELECT name,catalog_id,source_id,catalog_commit,
    package_commit,path,kind,version,digest,local_path,installed_by_human_id,installed_at
    FROM catalog_installed_origins WHERE name=?`);
  const liveAdmin = db.prepare<[string], { ok: number }>(`SELECT 1 AS ok FROM humans
    WHERE id=? AND is_admin=1 AND must_change_password=0`);

  function requireAdmin(actor: HumanAdmin): void {
    if (!HumanAdminSchema.safeParse(actor).success || !liveAdmin.get(actor.id)) fail("FORBIDDEN");
  }

  function loadExactClosure(command: InstallExactCommand): { rows: ReleaseRow[]; manifests: Map<string, PackageManifest> } {
    if (!PackageReleaseIdSchema.safeParse(command.packageReleaseId).success || !Array.isArray(command.dependencyReleaseIds)
      || command.dependencyReleaseIds.length > 255 || command.dependencyReleaseIds.some(id => !PackageReleaseIdSchema.safeParse(id).success)
      || new Set(command.dependencyReleaseIds).size !== command.dependencyReleaseIds.length
      || command.dependencyReleaseIds.includes(command.packageReleaseId)) fail("INVALID_REQUEST");
    const root = required(releaseById.get(command.packageReleaseId), "NOT_FOUND");
    const manifests = new Map<string, PackageManifest>();
    const ordered: ReleaseRow[] = [];
    const visiting = new Set<string>();
    const visit = (row: ReleaseRow) => {
      if (visiting.has(row.package_release_id)) fail("IDENTITY_CONFLICT");
      if (manifests.has(row.package_release_id)) return;
      const manifest = parseRelease(row);
      manifests.set(row.package_release_id, manifest);
      ordered.push(row);
      visiting.add(row.package_release_id);
      for (const pin of manifest.dependencies) {
        const dependency = required(
          dependencyRelease.get(pin.catalogId, pin.sourceId, pin.name, pin.version, pin.digest),
          "IDENTITY_CONFLICT",
        );
        const expectedCommit = pin.revision.type === "exact" ? pin.revision.commit : row.package_commit;
        if (dependency.package_commit !== expectedCommit || dependency.kind !== "skill") fail("IDENTITY_CONFLICT");
        visit(dependency);
      }
      visiting.delete(row.package_release_id);
    };
    visit(root);
    const expected = ordered.slice(1).map(row => row.package_release_id);
    if (expected.length !== command.dependencyReleaseIds.length
      || expected.some((id, index) => id !== command.dependencyReleaseIds[index])) fail("STATE_CONFLICT");
    for (const row of ordered) if (row.review_state !== "APPROVED" || row.review_digest === null) fail("RELEASE_NOT_APPROVED");
    return { rows: ordered, manifests };
  }

  async function inspectClosure(rows: ReleaseRow[], manifests: Map<string, PackageManifest>): Promise<Map<string, PackageSnapshot>> {
    const snapshots = new Map<string, PackageSnapshot>();
    for (const row of rows) {
      const result = await inspectGitPackage({
        packageReleaseId: row.package_release_id,
        authoritySourceId: row.authority_source_id,
        contentSourceId: row.content_source_id,
        packageCommit: row.package_commit,
        packagePath: row.package_path,
      });
      const snapshot = result.ok === true ? result.value : fail("INSPECTION_FAILED");
      if (canonical(snapshot.manifest) !== canonical(manifests.get(row.package_release_id))
        || snapshot.manifest.digest !== row.digest
        || canonical(snapshot.execution) !== canonical(JSON.parse(row.execution_preview_json))
        || canonical(snapshot.warnings) !== canonical(JSON.parse(row.warnings_json))) fail("INSPECTION_FAILED");
      snapshots.set(row.package_release_id, snapshot);
    }
    return snapshots;
  }

  function resolveWithCanonicalAdapter(rows: ReleaseRow[], snapshots: Map<string, PackageSnapshot>): ImportPreview {
    const sourceIds = [...new Set(rows.flatMap(row => [row.authority_source_id, row.content_source_id]))];
    const sources = sourceIds.map(id => {
      const source = required(sourceById.get(id), "SOURCE_NOT_ALLOWED");
      if (source.enabled !== 1) fail("SOURCE_NOT_ALLOWED");
      return { sourceId: id, repository: source.ssh_user ? { url: source.canonical_url, sshUser: source.ssh_user } : { url: source.canonical_url },
        enabled: true, allowPackages: source.allow_packages === 1 };
    });
    const catalogs = [...new Map(rows.map(row => [`${row.authority_source_id}\0${row.catalog_commit}`, row])).values()].map(catalog => ({
      catalogId: catalog.authority_source_id,
      sourceId: catalog.authority_source_id,
      commit: catalog.catalog_commit,
      enabled: true,
      index: { formatVersion: 1 as const, entries: rows.filter(row => row.authority_source_id === catalog.authority_source_id && row.catalog_commit === catalog.catalog_commit).map(row => ({
        kind: row.kind as PackageManifest["kind"], name: row.name, version: row.version, digest: row.digest,
        location: row.content_source_id === row.authority_source_id
          ? { type: "catalog" as const, path: row.package_path, revision: { type: "exact" as const, commit: row.package_commit } }
          : { type: "source" as const, sourceId: row.content_source_id, commit: row.package_commit, path: row.package_path },
      })) },
    }));
    const root = rows[0]!;
    const result = prepareImport({
      root: { catalogId: root.authority_source_id, name: root.name, version: root.version },
      sources, catalogs,
      packages: rows.map(row => ({ sourceId: row.content_source_id, commit: row.package_commit, path: row.package_path, snapshot: snapshots.get(row.package_release_id)! })),
      target: {
        orgopsVersion: INSTALLATION_COMPATIBILITY.orgopsVersion,
        platform: INSTALLATION_COMPATIBILITY.platform,
        tools: [...INSTALLATION_COMPATIBILITY.tools],
      },
      installed: { complete: true, entries: [] }, knownReleases: [],
    });
    if (result.ok === false) {
      const code = result.issues[0]?.code;
      if (code === "SOURCE_NOT_ALLOWED") fail("SOURCE_NOT_ALLOWED");
      if (code === "IDENTITY_CONFLICT" || code === "MISSING_RELEASE" || code === "SKILL_CONFLICT") fail("IDENTITY_CONFLICT");
      fail("INSPECTION_FAILED");
    }
    return result.value;
  }

  async function remeasure(directory: string, expectedFiles: CheckedRelease["reviewFiles"]): Promise<void> {
    const parent = dirname(directory);
    const name = directory.slice(parent.length + 1);
    const result = await readLocalSkillEvidence({ directory: parent, nominatedNames: [name] });
    const evidence = result.ok === true ? result.value : fail("INSPECTION_FAILED");
    if (evidence.namespace.entries.length !== 1 || evidence.namespace.entries[0]?.name !== name
      || evidence.namespace.entries[0]?.type !== "directory") fail("INSPECTION_FAILED");
    const subtree = evidence.subtrees[0];
    if (!subtree || subtree.name !== name || subtree.entries.length !== expectedFiles.length) fail("INSPECTION_FAILED");
    const actual = new Map(subtree.entries.map(entry => [entry.path, entry]));
    for (const expected of expectedFiles) {
      const entry = actual.get(expected.path);
      if (!entry || entry.type !== "file" || entry.base64 !== expected.base64 || entry.executable !== expected.executable) fail("INSPECTION_FAILED");
      const stat = await fs.lstat(join(directory, expected.path));
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== expected.size
        || (stat.mode & 0o777) !== (expected.executable ? 0o755 : 0o644)) fail("INSPECTION_FAILED");
      const bytes = Buffer.from(entry.base64, "base64");
      const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      if (digest !== expected.digest || bytes.length !== expected.size) fail("INSPECTION_FAILED");
    }
  }

  function originMatches(origin: SkillOriginRow | undefined, installation: InstallationRow, row: ReleaseRow, finalPath: string): boolean {
    return origin !== undefined
      && origin.name === row.name
      && origin.catalog_id === row.authority_source_id
      && origin.source_id === row.content_source_id
      && origin.catalog_commit === row.catalog_commit
      && origin.package_commit === row.package_commit
      && origin.path === row.package_path
      && origin.kind === "skill"
      && origin.version === row.version
      && origin.digest === row.digest
      && resolve(origin.local_path) === resolve(finalPath)
      && origin.installed_by_human_id === installation.installed_by_human_id
      && origin.installed_at === installation.installed_at;
  }

  async function classify(rows: ReleaseRow[], preview: ImportPreview): Promise<CheckedRelease[]> {
    const reviewByDigest = new Map(preview.packages.map(item => [item.identity.digest, item]));
    const rootResult = await readLocalSkillEvidence({ directory: artifactRoot, nominatedNames: rows.map(row => row.name) });
    const rootEvidence = rootResult.ok === true ? rootResult.value : fail("STORAGE_FAILURE");
    const namespace = new Map(rootEvidence.namespace.entries.map(entry => [entry.name.toLowerCase(), entry]));
    const checked: CheckedRelease[] = [];
    for (const row of rows) {
      const item = required(reviewByDigest.get(row.digest), "IDENTITY_CONFLICT");
      if (item.identity.name !== row.name || item.identity.version !== row.version) fail("IDENTITY_CONFLICT");
      const finalPath = join(artifactRoot, row.name, row.digest.slice("sha256:".length));
      if (!within(artifactRoot, finalPath)) fail("INSPECTION_FAILED");
      const installed = installationById.get(row.package_release_id);
      const origin = skillOriginByName.get(row.name);
      if (installed) {
        if (installed.state !== "INSTALLED" || installed.artifact_digest !== row.digest || resolve(installed.artifact_path) !== resolve(finalPath)
          || (row.kind === "skill" ? !originMatches(origin, installed, row, finalPath) : origin !== undefined)) fail("INSPECTION_FAILED");
        await remeasure(finalPath, item.files);
        checked.push({ row, finalPath, action: "reused", reviewFiles: item.files });
        continue;
      }
      if (occupiedInstalledName.get(row.name, row.package_release_id) || origin) fail("STATE_CONFLICT");
      if (namespace.has(row.name.toLowerCase())) {
        // An unmanaged object at the exact immutable destination is storage failure;
        // a merely occupied package namespace remains the policy/state conflict.
        try { await fs.lstat(finalPath); fail("STORAGE_FAILURE"); }
        catch (error) { if (error instanceof InstallFailure) throw error; if ((error as { code?: unknown }).code !== "ENOENT") fail("STORAGE_FAILURE"); }
        fail("STATE_CONFLICT");
      }
      checked.push({ row, finalPath, action: "installed", reviewFiles: item.files });
    }
    return checked;
  }

  async function populate(stageRoot: string, releases: CheckedRelease[]): Promise<void> {
    await fs.mkdir(stageRoot, { mode: 0o700 });
    for (const release of releases.filter(item => item.action === "installed")) {
      const directory = join(stageRoot, release.row.name, release.row.digest.slice("sha256:".length));
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      for (const file of release.reviewFiles) {
        if (!RelativePathSchema.safeParse(file.path).success) fail("INSPECTION_FAILED");
        const target = join(directory, file.path);
        if (!within(directory, target)) fail("INSPECTION_FAILED");
        await fs.mkdir(dirname(target), { recursive: true, mode: 0o700 });
        const mode = file.executable ? 0o755 : 0o644;
        await fs.writeFile(target, Buffer.from(file.base64, "base64"), { flag: "wx", mode });
        await fs.chmod(target, mode);
      }
      await remeasure(directory, release.reviewFiles);
    }
  }

  async function cleanup(paths: Iterable<string>): Promise<void> {
    for (const path of paths) await fs.rm(path, { recursive: true, force: true });
  }

  function recordFailedOperation(operationId: string, command: InstallExactCommand, actor: HumanAdmin, code: InstallFailureCode): void {
    const persistable = new Set<InstallFailureCode>([
      "RELEASE_NOT_APPROVED", "SOURCE_NOT_ALLOWED", "SOURCE_UNAVAILABLE", "IDENTITY_CONFLICT", "INSPECTION_FAILED", "STORAGE_FAILURE",
    ]);
    if (!persistable.has(code) || !PackageReleaseIdSchema.safeParse(command.packageReleaseId).success || !liveAdmin.get(actor.id)) return;
    const root = releaseById.get(command.packageReleaseId);
    if (!root) return;
    const now = Date.now();
    const closureDigest = sha256(JSON.stringify([command.packageReleaseId, ...command.dependencyReleaseIds]));
    const event = CatalogAuditEventSchema.parse({
      type: "audit.catalog.installation.changed", source: "system", status: "DELIVERED", channelId: null,
      payload: { actorKind: "HUMAN_ADMIN", actorId: actor.id, action: "install", outcome: "FAILED", revision: 1,
        releaseId: root.package_release_id, operationId, digest: root.digest, failureCode: code },
    });
    db.transaction(() => {
      requireAdmin(actor);
      db.prepare(`INSERT INTO catalog_install_operations
        (operation_id,root_release_id,closure_digest,state,actor_human_id,failure_code,revision,created_at,updated_at,completed_at)
        VALUES (?,?,?,'FAILED',?,?,1,?,?,?)`).run(operationId, root.package_release_id, closureDigest, actor.id, code, now, now, now);
      writeAudit(db, event);
    }).immediate();
  }

  const installExact: PackageInstallation["installExact"] = async (command, actor) => {
    if (active) return { ok: false, code: "OPERATION_IN_PROGRESS" };
    active = true;
    const operationId = randomUUID();
    const stageRoot = join(artifactRoot, `.install-${operationId}`);
    const claimed = new Set<string>();
    try {
      requireAdmin(actor);
      const closure = loadExactClosure(command);
      await ensureArtifactRoot(artifactRoot);
      const snapshots = await inspectClosure(closure.rows, closure.manifests);
      const preview = resolveWithCanonicalAdapter(closure.rows, snapshots);
      const releases = await classify(closure.rows, preview);
      await populate(stageRoot, releases);
      for (const release of releases.filter(item => item.action === "installed")) {
        const namespace = join(artifactRoot, release.row.name);
        await fs.mkdir(namespace, { mode: 0o700 });
        claimed.add(namespace);
        await fs.rename(join(stageRoot, release.row.name, release.row.digest.slice("sha256:".length)), release.finalPath);
      }
      await cleanup([stageRoot]);
      const now = Date.now();
      const installedByHumanId = actor.id;
      const installedAt = now;
      const closureDigest = sha256(JSON.stringify(closure.rows.map(row => row.package_release_id)));
      const root = closure.rows[0]!;
      const event = CatalogAuditEventSchema.parse({
        type: "audit.catalog.installation.changed", source: "system", status: "DELIVERED", channelId: null,
        payload: { actorKind: "HUMAN_ADMIN", actorId: actor.id, action: "install", outcome: "SUCCEEDED", revision: 1,
          releaseId: root.package_release_id, operationId, digest: root.digest },
      });
      db.transaction(() => {
        requireAdmin(actor);
        for (const release of releases) {
          const current = releaseById.get(release.row.package_release_id);
          if (!current || current.review_state !== "APPROVED" || current.review_digest === null
            || current.control_revision !== release.row.control_revision
            || current.review_digest !== release.row.review_digest
            || canonical(current) !== canonical(release.row)) fail("RELEASE_NOT_APPROVED");
          if (release.action === "installed") {
            db.prepare(`INSERT INTO catalog_installations
              (release_id,artifact_digest,artifact_path,state,installed_by_human_id,installed_at,last_verified_at,revision)
              VALUES (?,?,?,'INSTALLED',?,?,?,1)`).run(
              release.row.package_release_id, release.row.digest, release.finalPath, installedByHumanId, installedAt, now,
            );
          } else {
            const persisted = installationById.get(release.row.package_release_id);
            const origin = skillOriginByName.get(release.row.name);
            if (!persisted || persisted.artifact_digest !== release.row.digest || resolve(persisted.artifact_path) !== resolve(release.finalPath)
              || (release.row.kind === "skill" ? !originMatches(origin, persisted, release.row, release.finalPath) : origin !== undefined)) fail("INSPECTION_FAILED");
            db.prepare("UPDATE catalog_installations SET last_verified_at=?,revision=revision+1 WHERE release_id=?")
              .run(now, release.row.package_release_id);
          }
        }
        for (const release of releases.filter(item => item.action === "installed" && item.row.kind === "skill")) {
          if (skillOriginByName.get(release.row.name)) fail("STATE_CONFLICT");
          db.prepare(`INSERT INTO catalog_installed_origins
            (name,catalog_id,source_id,catalog_commit,package_commit,path,kind,version,digest,local_path,installed_by_human_id,installed_at)
            VALUES (?,?,?,?,?,?,'skill',?,?,?,?,?)`).run(
            release.row.name, release.row.authority_source_id, release.row.content_source_id,
            release.row.catalog_commit, release.row.package_commit, release.row.package_path,
            release.row.version, release.row.digest, release.finalPath, installedByHumanId, installedAt,
          );
        }
        db.prepare(`INSERT INTO catalog_install_operations
          (operation_id,root_release_id,closure_digest,state,actor_human_id,failure_code,revision,created_at,updated_at,completed_at)
          VALUES (?,?,?,'INSTALLED',?,NULL,1,?,?,?)`).run(operationId, root.package_release_id, closureDigest, actor.id, now, now, now);
        writeAudit(db, event);
      }).immediate();
      claimed.clear();
      return { ok: true, packages: releases.map(release => ({ packageReleaseId: release.row.package_release_id, action: release.action })), activated: false };
    } catch (error) {
      let code: InstallFailureCode = failureCode(error);
      try { await cleanup([stageRoot, ...claimed]); } catch { code = "STORAGE_FAILURE"; }
      if ((error as { code?: unknown })?.code === "EEXIST" || (error as { code?: unknown })?.code === "ENOTEMPTY") code = "STATE_CONFLICT";
      try { recordFailedOperation(operationId, command, actor, code); } catch { /* Audit/storage failure rolls back the failed-operation transaction. */ }
      return { ok: false, code };
    } finally {
      active = false;
    }
  };

  return {
    installExact,
    inspectAvailability(packageReleaseId) {
      if (!PackageReleaseIdSchema.safeParse(packageReleaseId).success) return { installed: false, state: "ABSENT" };
      const row = installationById.get(packageReleaseId);
      return row ? { installed: row.state === "INSTALLED", state: row.state } : { installed: false, state: "ABSENT" };
    },
  };
}
