import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { z } from "zod";
import type { OrgOpsDb } from "@orgops/db";
import {
  CatalogAuditEventSchema,
  HumanAdminSchema,
  PackageManifestSchema,
  PackageReleaseIdSchema,
  RelativePathSchema,
  type CatalogAuditEvent,
  type HumanAdmin,
} from "@orgops/schemas";
import {
  canonicalManifestBytes,
  computePackageDigest,
  readLocalSkillEvidence as defaultReadLocalSkillEvidence,
  type LocalSkillEvidence,
  type LocalSkillEvidenceInput,
  type LocalSkillEvidenceOptions,
  type LocalSkillEvidenceResult,
  type ContentEntry,
} from "@orgops/skills";

const ReconcileResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("RECONCILED") }).strict(),
  z.object({ status: z.literal("REJECTED"), code: z.literal("IDENTITY_CONFLICT") }).strict(),
]);
const OriginSchema = z.object({
  name: z.string().min(1).max(256), catalog_id: z.string().min(1).max(256), source_id: z.string().min(1).max(256),
  catalog_commit: z.string().min(1).max(128), package_commit: z.string().min(1).max(128), path: z.string().min(1).max(4096),
  kind: z.literal("skill"), version: z.string().min(1).max(256), digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  local_path: z.string().min(1).max(4096), installed_by_human_id: z.string().min(1).max(256).nullable(),
  installed_at: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict();
const ReleaseSchema = z.object({
  package_release_id: PackageReleaseIdSchema,
  authority_source_id: z.string().min(1).max(256), content_source_id: z.string().min(1).max(256), kind: z.literal("skill"),
  name: z.string().min(1).max(256), version: z.string().min(1).max(256), digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  catalog_commit: z.string().min(1).max(128), package_commit: z.string().min(1).max(128), package_path: RelativePathSchema,
  manifest_json: z.string().min(1),
}).strict();
const InstallationSchema = z.object({
  release_id: z.string().min(1), artifact_digest: z.string(), artifact_path: z.string(), state: z.literal("INSTALLED"),
  installed_by_human_id: z.string().min(1).max(256), installed_at: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  last_verified_at: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), revision: z.number().int().min(1).max(2147483647),
}).strict();
const LocalEntrySchema = z.union([
  z.object({ type: z.literal("directory"), path: z.string().min(1) }).strict(),
  z.object({ type: z.literal("blocked"), path: z.string().min(1) }).strict(),
  z.object({ type: z.literal("file"), path: z.string().min(1), base64: z.string(), executable: z.boolean() }).strict(),
]);
const EvidenceSchema = z.object({
  nominatedNames: z.array(z.string().min(1)).readonly(),
  namespace: z.object({ complete: z.literal(true), entries: z.array(z.object({ name: z.string().min(1), type: z.enum(["directory", "file", "blocked"]) }).strict()).readonly() }).strict(),
  subtrees: z.array(z.object({ name: z.string().min(1), complete: z.literal(true), entries: z.array(LocalEntrySchema).readonly() }).strict()).readonly(),
}).strict();
const EvidenceResultSchema = z.union([
  z.object({ ok: z.literal(true), value: EvidenceSchema }).strict(),
  z.object({ ok: z.literal(false), issues: z.array(z.object({
    code: z.enum(["INVALID_LOCAL_INPUT", "UNSUPPORTED_LOCAL_STORAGE", "UNSAFE_PATH", "DUPLICATE_PATH", "LIMIT_EXCEEDED", "LOCAL_IO_FAILED", "LOCAL_EVIDENCE_CHANGED", "LOCAL_ABORTED", "LOCAL_TIMEOUT", "LOCAL_CLEANUP_FAILED"]),
    at: z.enum(["$", "directory", "nominatedNames", "namespace", "subtrees", "filesystem"]),
  }).strict()) }).strict(),
]);

type OriginRow = z.infer<typeof OriginSchema>;
type ReleaseRow = z.infer<typeof ReleaseSchema>;
type InstallationRow = z.infer<typeof InstallationSchema>;
type ReadEvidence = (input: LocalSkillEvidenceInput, options?: LocalSkillEvidenceOptions) => Promise<LocalSkillEvidenceResult<LocalSkillEvidence>>;
type AuditWriter = (tx: OrgOpsDb, event: CatalogAuditEvent) => void;

export type LegacyOriginReconciliationDeps = Readonly<{
  db: OrgOpsDb;
  readLocalSkillEvidence?: ReadEvidence;
  writeAudit: AuditWriter;
  /** Test seam for the mandatory final transaction boundary. */
  beforeFinalTransaction?: () => Promise<void>;
}>;
export type LegacyOriginReconciliation = Readonly<{
  reconcileLegacyOrigin(originId: string, actor: HumanAdmin): Promise<z.infer<typeof ReconcileResultSchema>>;
}>;

const rejected = (): z.infer<typeof ReconcileResultSchema> => ({ status: "REJECTED", code: "IDENTITY_CONFLICT" });
const sha256 = (bytes: Uint8Array): string => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
};
const same = (left: unknown, right: unknown): boolean => canonical(left) === canonical(right);
function canonicalAbsolutePath(value: string): boolean {
  if (!value.startsWith("/") || value === "/" || value.endsWith("/") || value.includes("\\") || value.includes("//")
    || /[\u0000-\u001f\u007f-\u009f]/.test(value)) return false;
  const segments = value.slice(1).split("/");
  return segments.every(segment => segment.length > 0 && segment !== "." && segment !== "..") && resolve(value) === value;
}

function parentDirectories(paths: readonly string[]): Set<string> {
  const result = new Set<string>();
  for (const path of paths) {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index += 1) result.add(parts.slice(0, index).join("/"));
  }
  return result;
}

function expectedFiles(manifest: z.infer<typeof PackageManifestSchema>): Map<string, { size: number; digest: string; executable: boolean }> {
  return new Map(manifest.files.map(file => [file.path, file]));
}

async function exactFilesystemModes(evidenceRoot: string, artifactPath: string, evidence: z.infer<typeof EvidenceSchema>): Promise<boolean> {
  const directories = [evidenceRoot, artifactPath, ...evidence.subtrees.flatMap(subtree => subtree.entries
    .filter(entry => entry.type === "directory").map(entry => join(artifactPath, entry.path)))];
  for (const path of directories) {
    const stat = await fs.lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700) return false;
  }
  for (const entry of evidence.subtrees[0]!.entries) {
    if (entry.type !== "file") continue;
    const stat = await fs.lstat(join(artifactPath, entry.path));
    const expectedMode = entry.executable ? 0o755 : 0o644;
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o777) !== expectedMode) return false;
  }
  return true;
}

function exactEvidence(evidenceInput: unknown, origin: OriginRow, release: ReleaseRow, nominatedName: string): boolean {
  const parsedEvidence = EvidenceSchema.safeParse(evidenceInput);
  if (!parsedEvidence.success) return false;
  const evidence = parsedEvidence.data;
  if (!same(evidence.nominatedNames, [nominatedName]) || evidence.namespace.entries.length !== 1
    || evidence.namespace.entries[0]?.name !== nominatedName || evidence.namespace.entries[0]?.type !== "directory"
    || evidence.subtrees.length !== 1 || evidence.subtrees[0]?.name !== nominatedName) return false;
  const entries = evidence.subtrees[0]!.entries;
  const manifestEntry = entries.find(entry => entry.type === "file" && entry.path === "orgops-package.json");
  if (!manifestEntry || manifestEntry.type !== "file" || manifestEntry.executable) return false;
  let releaseManifestValue: unknown;
  try { releaseManifestValue = JSON.parse(release.manifest_json); } catch { return false; }
  const releaseManifest = PackageManifestSchema.safeParse(releaseManifestValue);
  if (!releaseManifest.success || releaseManifest.data.kind !== "skill" || releaseManifest.data.name !== release.name
    || releaseManifest.data.name !== origin.name || releaseManifest.data.version !== release.version || releaseManifest.data.version !== origin.version
    || releaseManifest.data.digest !== release.digest || releaseManifest.data.digest !== origin.digest) return false;
  const expectedManifestBytes = canonicalManifestBytes(releaseManifest.data);
  const expectedManifestBase64 = expectedManifestBytes.toString("base64");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:|[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)$/.test(manifestEntry.base64)
    || Buffer.from(manifestEntry.base64, "base64").toString("base64") !== manifestEntry.base64
    || manifestEntry.base64 !== expectedManifestBase64
    || Buffer.byteLength(Buffer.from(manifestEntry.base64, "base64")) !== expectedManifestBytes.length
    || sha256(Buffer.from(manifestEntry.base64, "base64")) !== sha256(expectedManifestBytes)) return false;
  let manifestValue: unknown;
  try { manifestValue = JSON.parse(Buffer.from(manifestEntry.base64, "base64").toString("utf8")); } catch { return false; }
  const manifest = PackageManifestSchema.safeParse(manifestValue);
  if (!manifest.success) return false;
  const files = expectedFiles(manifest.data);
  const contentEntries: ContentEntry[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.path)) return false;
    seen.add(entry.path);
    if (entry.type === "blocked") return false;
    if (entry.type === "directory") continue;
    if (entry.path === "orgops-package.json") {
      if (entry.executable || entry.base64 !== expectedManifestBase64) return false;
    } else {
      const expected = files.get(entry.path);
      if (!expected || !/^(?:[A-Za-z0-9+/]{4})*(?:|[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)$/.test(entry.base64)
        || Buffer.from(entry.base64, "base64").toString("base64") !== entry.base64) return false;
      const bytes = Buffer.from(entry.base64, "base64");
      if (bytes.length !== expected.size || entry.executable !== expected.executable || sha256(bytes) !== expected.digest) return false;
      contentEntries.push(entry);
    }
  }
  if (contentEntries.length !== files.size || [...files.keys()].some(path => !seen.has(path))) return false;
  const directories = parentDirectories([...files.keys()]);
  const actualDirectories = new Set(entries.filter(entry => entry.type === "directory").map(entry => entry.path));
  if (directories.size !== actualDirectories.size || [...directories].some(path => !actualDirectories.has(path))) return false;
  const computed = computePackageDigest(manifest.data, contentEntries);
  return computed.ok && computed.value === release.digest;
}

function canonicalAliases(db: OrgOpsDb, legacyId: string, kind: "catalog" | "source"): Set<string> {
  const aliases = new Set([legacyId]);
  try {
    if (kind === "catalog") {
      for (const row of db.prepare<[string], { catalog_id: string }>("SELECT catalog_id FROM catalogs_legacy_032 WHERE catalog_id=?").all(legacyId)) aliases.add(row.catalog_id);
      for (const row of db.prepare<[string], { source_id: string }>(`SELECT s.source_id
        FROM catalogs_legacy_032 c JOIN catalog_sources_legacy_032 old ON old.source_id=c.source_id
        JOIN catalog_sources s ON s.repository_identity=old.repository_identity AND s.ref=c.ref
        WHERE c.catalog_id=?`).all(legacyId)) aliases.add(row.source_id);
    } else {
      for (const row of db.prepare<[string], { catalog_id: string }>("SELECT catalog_id FROM catalogs_legacy_032 WHERE source_id=?").all(legacyId)) aliases.add(row.catalog_id);
      for (const row of db.prepare<[string], { source_id: string }>(`SELECT s.source_id
        FROM catalogs_legacy_032 c JOIN catalog_sources_legacy_032 old ON old.source_id=c.source_id
        JOIN catalog_sources s ON s.repository_identity=old.repository_identity AND s.ref=c.ref
        WHERE c.source_id=?`).all(legacyId)) aliases.add(row.source_id);
    }
  } catch { /* Fresh databases still have the direct canonical identity. */ }
  return aliases;
}

export function createLegacyOriginReconciliation({ db, readLocalSkillEvidence = defaultReadLocalSkillEvidence, writeAudit, beforeFinalTransaction }: LegacyOriginReconciliationDeps): LegacyOriginReconciliation {
  const liveAdmin = db.prepare<[string], { ok: number }>("SELECT 1 AS ok FROM humans WHERE id=? AND is_admin=1 AND must_change_password=0");
  // Migration 033 made `name` the origin primary key; the reconciliation originId is exactly that name.
  const originByName = db.prepare<[string], Record<string, unknown>>("SELECT name,catalog_id,source_id,catalog_commit,package_commit,path,kind,version,digest,local_path,installed_by_human_id,installed_at FROM catalog_installed_origins WHERE name=?");
  const releaseRows = db.prepare<[], Record<string, unknown>>("SELECT package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,manifest_json FROM catalog_package_releases");
  const installationByRelease = db.prepare<[string], Record<string, unknown>>("SELECT release_id,artifact_digest,artifact_path,state,installed_by_human_id,installed_at,last_verified_at,revision FROM catalog_installations WHERE release_id=?");

  return {
    async reconcileLegacyOrigin(originId, actor) {
      try {
        if (!z.string().min(1).max(256).safeParse(originId).success || !HumanAdminSchema.safeParse(actor).success || !liveAdmin.get(actor.id)) return rejected();
        const rawOrigin = originByName.all(originId);
        if (rawOrigin.length !== 1) return rejected();
        const originParsed = OriginSchema.safeParse(rawOrigin[0]);
        if (!originParsed.success) return rejected();
        const origin = originParsed.data;
        const rawReleases = releaseRows.all();
        const releases: ReleaseRow[] = [];
        for (const raw of rawReleases) {
          const parsed = ReleaseSchema.safeParse(raw);
          if (!parsed.success) return rejected();
          try { if (!PackageManifestSchema.safeParse(JSON.parse(parsed.data.manifest_json)).success) return rejected(); } catch { return rejected(); }
          releases.push(parsed.data);
        }
        const authorityIds = canonicalAliases(db, origin.catalog_id, "catalog");
        const contentIds = canonicalAliases(db, origin.source_id, "source");
        const matches = releases.filter(release => authorityIds.has(release.authority_source_id) && contentIds.has(release.content_source_id)
          && release.kind === origin.kind && release.name === origin.name && release.version === origin.version
          && release.digest === origin.digest && release.catalog_commit === origin.catalog_commit
          && release.package_commit === origin.package_commit && release.package_path === origin.path);
        if (matches.length !== 1) return rejected();
        const release = matches[0]!;
        const installationParsed = InstallationSchema.safeParse(installationByRelease.get(release.package_release_id));
        if (!installationParsed.success || installationParsed.data.artifact_digest !== release.digest
          || !canonicalAbsolutePath(installationParsed.data.artifact_path) || !canonicalAbsolutePath(origin.local_path)
          || installationParsed.data.artifact_path !== origin.local_path
          || origin.installed_by_human_id !== installationParsed.data.installed_by_human_id
          || origin.installed_at !== installationParsed.data.installed_at) return rejected();
        const evidenceRoot = dirname(origin.local_path);
        const nominatedName = origin.local_path.slice(evidenceRoot.length + 1);
        const expectedDigestDirectory = release.digest.slice("sha256:".length);
        if (nominatedName !== expectedDigestDirectory || join(evidenceRoot, nominatedName) !== origin.local_path) return rejected();
        const evidenceResult = await readLocalSkillEvidence({ directory: evidenceRoot, nominatedNames: [nominatedName] });
        const parsedEvidenceResult = EvidenceResultSchema.safeParse(evidenceResult);
        if (!parsedEvidenceResult.success || parsedEvidenceResult.data.ok !== true
          || !exactEvidence(parsedEvidenceResult.data.value, origin, release, nominatedName)
          || !(await exactFilesystemModes(evidenceRoot, origin.local_path, parsedEvidenceResult.data.value))) return rejected();
        if (beforeFinalTransaction) await beforeFinalTransaction();
        const releaseIdentity = { ...release };
        const installationIdentity = { ...installationParsed.data };
        const changed = origin.catalog_id !== release.authority_source_id || origin.source_id !== release.content_source_id
          || origin.catalog_commit !== release.catalog_commit || origin.package_commit !== release.package_commit || origin.path !== release.package_path
          || origin.kind !== release.kind || origin.version !== release.version || origin.digest !== release.digest;
        const event = CatalogAuditEventSchema.parse({
          type: "audit.catalog.installation.changed", source: "system", status: "DELIVERED", channelId: null,
          payload: { actorKind: "HUMAN_ADMIN", actorId: actor.id, action: "legacy-origin.reconcile", outcome: "SUCCEEDED", revision: 1,
            releaseId: release.package_release_id, digest: release.digest },
        });
        db.transaction(() => {
          if (!liveAdmin.get(actor.id)) throw new Error("identity");
          const finalOriginRaw = originByName.all(originId);
          const finalOrigin = finalOriginRaw.length === 1 ? OriginSchema.safeParse(finalOriginRaw[0]) : { success: false } as const;
          const finalReleaseRaw = releaseRows.all().filter(row => row.package_release_id === release.package_release_id);
          const finalRelease = finalReleaseRaw.length === 1 ? ReleaseSchema.safeParse(finalReleaseRaw[0]) : { success: false } as const;
          const finalInstallationRaw = installationByRelease.get(release.package_release_id);
          const finalInstallation = InstallationSchema.safeParse(finalInstallationRaw);
          if (!finalOrigin.success || !same(finalOrigin.data, origin) || !finalRelease.success || !same(finalRelease.data, releaseIdentity)
            || !finalInstallation.success || !same(finalInstallation.data, installationIdentity)
            || finalOrigin.data.installed_by_human_id !== finalInstallation.data.installed_by_human_id
            || finalOrigin.data.installed_at !== finalInstallation.data.installed_at) throw new Error("identity");
          if (changed) {
            const result = db.prepare(`UPDATE catalog_installed_origins SET catalog_id=?,source_id=?,catalog_commit=?,package_commit=?,path=?,kind=?,version=?,digest=?
              WHERE name=? AND catalog_id=? AND source_id=? AND catalog_commit=? AND package_commit=? AND path=? AND kind=? AND version=? AND digest=?
              AND local_path=? AND installed_by_human_id IS ? AND installed_at=?`).run(
              release.authority_source_id, release.content_source_id, release.catalog_commit, release.package_commit, release.package_path,
              release.kind, release.version, release.digest, origin.name, origin.catalog_id, origin.source_id, origin.catalog_commit,
              origin.package_commit, origin.path, origin.kind, origin.version, origin.digest, origin.local_path, origin.installed_by_human_id, origin.installed_at,
            );
            if (result.changes !== 1) throw new Error("identity");
            writeAudit(db, event);
          }
        }).immediate();
        return ReconcileResultSchema.parse({ status: "RECONCILED" });
      } catch {
        return rejected();
      }
    },
  };
}
