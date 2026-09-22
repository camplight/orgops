import { createHash, randomUUID } from "node:crypto";
import type { OrgOpsDb } from "@orgops/db";
import { encryptSecret, parseMasterKey } from "@orgops/crypto";
import {
  CatalogAuditEventSchema,
  DigestSchema,
  HumanAdminSchema,
  PackageReleaseIdSchema,
  PackageReleaseViewSchema,
  SourceCreateSchema,
  SourceIdSchema,
  SourcePatchSchema,
  type AuthenticatedHuman,
  type CatalogAuditEvent,
  type CatalogAuthority,
  type CatalogAuthorityCommand,
  type CatalogAuthorityQuery,
  type CatalogAuthorityQueryResult,
  type CatalogAuthorityResult,
  type CatalogEntry,
  type CatalogIndex,
  type CatalogLibraryErrorCode,
  type HumanAdmin,
  type PackageReleaseView,
  type ReviewAction,
  type SourceView,
  type SyncAttemptView,
  type SyncFailureCode,
} from "@orgops/schemas";
import type { PackageSnapshot } from "@orgops/skills";
import { parseGitHubDestination } from "../catalog-sync/github-destination";
import { catalogGrantId, parseCanonicalCatalogGrant } from "./grant-identity";

export type SourceFetchRequest = Readonly<{
  sourceId: string;
  canonicalUrl: string;
  repositoryIdentity: string;
  ref: string;
}>;

export type SourceFetchObservation = Readonly<{
  commit: string;
  observedRef: string;
  inspectionContext: unknown;
  promote(exactCommit: string): Promise<void>;
  cleanup(): Promise<void>;
}>;

export type InspectedCatalogIndex = Readonly<{
  index: CatalogIndex;
  indexJson: string;
  indexDigest: string;
}>;

export type ReleaseInspectionContext = Readonly<{
  authoritySourceId: string;
  contentSourceId: string;
  packageCommit: string;
  packagePath: string;
}>;

export type FetchSource = (source: SourceFetchRequest) => Promise<SourceFetchObservation>;
export type InspectIndex = (observation: SourceFetchObservation) => Promise<InspectedCatalogIndex>;
export type InspectRelease = (
  observation: SourceFetchObservation,
  entry: CatalogEntry,
  context: ReleaseInspectionContext,
) => Promise<PackageSnapshot>;
export type AuditWriter = (tx: OrgOpsDb, event: CatalogAuditEvent) => void;
export type AuditPublisher = (event: CatalogAuditEvent) => void;

export type CatalogAuthorityDeps = {
  db: OrgOpsDb;
  fetchSource: FetchSource;
  inspectIndex: InspectIndex;
  inspectRelease: InspectRelease;
  writeAudit: AuditWriter;
  publishAudit: AuditPublisher;
};

type SourceRow = {
  source_id: string;
  display_name: string;
  canonical_url: string;
  ssh_user: string | null;
  repository_identity: string;
  ref: string;
  enabled: number;
  allow_packages: number;
  revision: number;
  removed_at: number | null;
  current_snapshot_id: string | null;
  created_at: number;
  updated_at: number;
  has_read_credential: number;
};

type AttemptRow = {
  attempt_id: string;
  source_id: string;
  state: SyncAttemptView["state"];
  snapshot_id: string | null;
  failure_code: SyncFailureCode | null;
  revision: number;
};

type ExistingReleaseRow = {
  package_release_id: string;
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
};

type ReleaseProjectionRow = ExistingReleaseRow & {
  authority_source_id: string;
  review_state: PackageReleaseView["reviewState"];
  review_digest: string | null;
  reviewed_by_human_id: string | null;
  reviewed_at: number | null;
  control_revision: number;
  installation_state: "INSTALLED" | "QUARANTINED" | null;
  activation_approval_state: PackageReleaseView["apiActivation"]["approvalState"] | null;
  activation_runtime_state: PackageReleaseView["apiActivation"]["runtimeState"] | null;
  activation_failure_code: PackageReleaseView["apiActivation"]["failureCode"];
  activation_revision: number | null;
};

type ObservedRelease = {
  entry: CatalogEntry;
  contentSourceId: string;
  packageCommit: string;
  packagePath: string;
  manifestJson: string;
  executionJson: string;
  warningsJson: string;
};

type GrantRow = {
  grant_id: string;
  release_id: string;
  subject_type: "ORGANIZATION" | "HUMAN";
  human_id: string | null;
  revision: number;
  revoked_at: number | null;
};

const sourceSelect = `SELECT s.source_id,s.display_name,s.canonical_url,s.ssh_user,s.repository_identity,s.ref,
  s.enabled,s.allow_packages,s.revision,s.removed_at,s.current_snapshot_id,s.created_at,s.updated_at,
  EXISTS(SELECT 1 FROM catalog_source_read_credentials c WHERE c.source_id=s.source_id) AS has_read_credential
  FROM catalog_sources s`;

const ERROR_MESSAGES: Record<CatalogLibraryErrorCode, string> = {
  INVALID_REQUEST: "Invalid catalog library request",
  PAYLOAD_TOO_LARGE: "Catalog library request too large",
  FORBIDDEN: "Administrator access required",
  NOT_FOUND: "Catalog library resource not found",
  REMOVED: "Catalog library resource removed",
  REVISION_CONFLICT: "Catalog library changed; reload metadata",
  STATE_CONFLICT: "Catalog library operation conflicts with current state",
  IDENTITY_CONFLICT: "Catalog release identity already reserved",
  SOURCE_NOT_ALLOWED: "Package source is not enabled for this operation",
  SOURCE_UNAVAILABLE: "Package source is unavailable",
  RELEASE_NOT_APPROVED: "Package release is not approved",
  GRANT_REQUIRED: "A current grant is required",
  INSTALLATION_REQUIRED: "Package release is not installed",
  API_ACTIVATION_REQUIRED: "API execution approval is required",
  REQUIREMENTS_UNSATISFIED: "Agent requirements are not satisfied",
  OPERATION_IN_PROGRESS: "Catalog operation is already in progress",
  DEPLOYMENT_SUPERSEDED: "Runner deployment was superseded",
  INSPECTION_FAILED: "Package inspection failed; last-known-good content is unchanged",
  STORAGE_FAILURE: "Catalog library operation failed",
  SYNC_FAILED: "Source synchronization failed",
  CATALOG_RESOURCE_RETIRED: "Catalog resource retired; use Source Library",
};

export class CatalogAuthorityError extends Error {
  readonly code: CatalogLibraryErrorCode;
  constructor(code: CatalogLibraryErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "CatalogAuthorityError";
    this.code = code;
  }
}

function fail(code: CatalogLibraryErrorCode): never {
  throw new CatalogAuthorityError(code);
}

function sourceView(row: SourceRow): SourceView {
  return {
    sourceId: row.source_id,
    displayName: row.display_name,
    canonicalUrl: row.canonical_url,
    repositoryIdentity: row.repository_identity,
    ref: row.ref,
    enabled: row.enabled === 1,
    allowPackages: row.allow_packages === 1,
    revision: row.revision,
    removedAt: row.removed_at,
    currentSnapshotId: row.current_snapshot_id,
    hasReadCredential: row.has_read_credential === 1,
  };
}

function attemptView(row: AttemptRow): SyncAttemptView {
  return {
    attemptId: row.attempt_id,
    sourceId: row.source_id,
    state: row.state,
    snapshotId: row.snapshot_id,
    failureCode: row.failure_code,
    revision: row.revision,
  };
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function nextReviewState(current: PackageReleaseView["reviewState"], action: ReviewAction): PackageReleaseView["reviewState"] {
  if (action === "APPROVE" && current === "PENDING") return "APPROVED";
  if (action === "REJECT" && current === "PENDING") return "REJECTED";
  if (action === "WITHDRAW" && current === "APPROVED") return "WITHDRAWN";
  if (action === "REOPEN" && (current === "REJECTED" || current === "WITHDRAWN")) return "PENDING";
  fail("STATE_CONFLICT");
}

function stableId(prefix: string, fields: readonly string[]): string {
  return `${prefix}-${createHash("sha256").update(JSON.stringify(fields)).digest("hex")}`;
}

function canonicalRepository(url: string): { canonicalUrl: string; identity: string } {
  const destination = parseGitHubDestination(url);
  if (!destination.ok) fail("SOURCE_NOT_ALLOWED");
  return {
    canonicalUrl: destination.value.fetchUrl.slice(0, -4),
    identity: JSON.stringify(["github", destination.value.owner.toLowerCase(), destination.value.name.toLowerCase()]),
  };
}

function syncFailureCode(error: unknown): SyncFailureCode {
  if (error instanceof CatalogAuthorityError) {
    if (error.code === "IDENTITY_CONFLICT") return "IDENTITY_CONFLICT";
    if (error.code === "SOURCE_NOT_ALLOWED" || error.code === "FORBIDDEN") return "SOURCE_NOT_ALLOWED";
    if (error.code === "SOURCE_UNAVAILABLE") return "SOURCE_UNAVAILABLE";
    if (error.code === "INSPECTION_FAILED") return "INSPECTION_FAILED";
    if (error.code === "STORAGE_FAILURE") return "STORAGE_FAILURE";
  }
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (code === "SOURCE_UNAVAILABLE" || code === "SOURCE_NOT_ALLOWED" || code === "IDENTITY_CONFLICT"
      || code === "INSPECTION_FAILED" || code === "STORAGE_FAILURE" || code === "SYNC_FAILED") return code;
  }
  return "SYNC_FAILED";
}

function makeAudit(input: {
  type: CatalogAuditEvent["type"];
  actor: HumanAdmin;
  action: string;
  outcome: "SUCCEEDED" | "FAILED";
  revision: number;
  sourceId?: string;
  releaseId?: string;
  digest?: string;
  operationId?: string;
  failureCode?: CatalogLibraryErrorCode;
}): CatalogAuditEvent {
  return CatalogAuditEventSchema.parse({
    type: input.type,
    source: "system",
    status: "DELIVERED",
    channelId: null,
    payload: {
      actorKind: input.actor.kind,
      actorId: input.actor.id,
      action: input.action,
      outcome: input.outcome,
      revision: input.revision,
      ...(input.sourceId === undefined ? {} : { sourceId: input.sourceId }),
      ...(input.releaseId === undefined ? {} : { releaseId: input.releaseId }),
      ...(input.digest === undefined ? {} : { digest: input.digest }),
      ...(input.operationId === undefined ? {} : { operationId: input.operationId }),
      ...(input.failureCode === undefined ? {} : { failureCode: input.failureCode }),
    },
  });
}

export function createCatalogAuthority({
  db,
  fetchSource,
  inspectIndex,
  inspectRelease,
  writeAudit,
  publishAudit,
}: CatalogAuthorityDeps): CatalogAuthority {
  function assertTransactionOwner(): void {
    if (db.inTransaction) fail("STORAGE_FAILURE");
  }

  function assertAdmin(actor: HumanAdmin): void {
    if (!HumanAdminSchema.safeParse(actor).success) fail("FORBIDDEN");
    const row = db.prepare<[string], { is_admin: number; must_change_password: number }>(
      "SELECT is_admin,must_change_password FROM humans WHERE id=?",
    ).get(actor.id);
    if (!row || row.is_admin !== 1 || row.must_change_password !== 0) fail("FORBIDDEN");
  }

  function readSource(sourceId: string): SourceRow {
    const row = db.prepare<[string], SourceRow>(`${sourceSelect} WHERE s.source_id=?`).get(sourceId);
    if (!row) fail("NOT_FOUND");
    return row;
  }

  function readAttempt(attemptId: string): AttemptRow {
    const row = db.prepare<[string], AttemptRow>(`SELECT attempt_id,source_id,state,snapshot_id,failure_code,revision
      FROM catalog_sync_attempts WHERE attempt_id=?`).get(attemptId);
    if (!row) fail("STORAGE_FAILURE");
    return row;
  }

  const releaseSelect = `SELECT r.package_release_id,r.authority_source_id,r.content_source_id,r.kind,r.name,r.version,r.digest,
    r.catalog_commit,r.package_commit,r.package_path,r.manifest_json,r.execution_preview_json,r.warnings_json,
    c.review_state,c.review_digest,c.reviewed_by_human_id,c.reviewed_at,c.revision AS control_revision,
    i.state AS installation_state,a.approval_state AS activation_approval_state,a.runtime_state AS activation_runtime_state,
    a.failure_code AS activation_failure_code,a.revision AS activation_revision
    FROM catalog_package_releases r
    JOIN catalog_release_controls c ON c.package_release_id=r.package_release_id
    LEFT JOIN catalog_installations i ON i.release_id=r.package_release_id AND i.artifact_digest=r.digest
    LEFT JOIN catalog_api_activations a ON a.release_id=r.package_release_id`;

  function readReleaseRow(releaseId: string): ReleaseProjectionRow {
    const row = db.prepare<[string], ReleaseProjectionRow>(`${releaseSelect} WHERE r.package_release_id=?`).get(releaseId);
    if (row) return row;
    if (db.prepare("SELECT 1 FROM catalog_package_releases WHERE package_release_id=?").get(releaseId)) fail("STORAGE_FAILURE");
    fail("NOT_FOUND");
  }

  function releaseView(row: ReleaseProjectionRow): PackageReleaseView {
    try {
      const manifest = JSON.parse(row.manifest_json) as { files?: Array<{ path: string; executable: boolean; size: number; digest: string }> };
      const executionPreview = JSON.parse(row.execution_preview_json) as PackageReleaseView["executionPreview"];
      const activationRequired = executionPreview.apiEventShapes.length > 0;
      return PackageReleaseViewSchema.parse({
        packageReleaseId: row.package_release_id,
        authoritySourceId: row.authority_source_id,
        contentSourceId: row.content_source_id,
        kind: row.kind,
        name: row.name,
        version: row.version,
        digest: row.digest,
        catalogCommit: row.catalog_commit,
        packageCommit: row.package_commit,
        packagePath: row.package_path,
        manifest,
        executionPreview,
        warnings: JSON.parse(row.warnings_json),
        files: (manifest.files ?? []).map(file => ({
          path: file.path,
          mode: file.executable ? 0o755 : 0o644,
          size: file.size,
          digest: file.digest,
        })),
        reviewState: row.review_state,
        reviewDigest: row.review_digest,
        reviewer: row.reviewed_by_human_id === null || row.reviewed_at === null
          ? null
          : { humanId: row.reviewed_by_human_id, reviewedAt: row.reviewed_at },
        installationState: row.installation_state ?? "ABSENT",
        apiActivation: row.activation_revision === null
          ? {
              approvalState: activationRequired ? "AWAITING_APPROVAL" : "NOT_REQUIRED",
              runtimeState: "INACTIVE",
              revision: 1,
              failureCode: null,
            }
          : {
              approvalState: row.activation_approval_state,
              runtimeState: row.activation_runtime_state,
              revision: row.activation_revision,
              failureCode: row.activation_failure_code,
            },
        revision: row.control_revision,
      });
    } catch (error) {
      if (error instanceof CatalogAuthorityError) throw error;
      fail("STORAGE_FAILURE");
    }
  }

  function checkRevision(row: SourceRow, expectedRevision: number): void {
    if (row.revision !== expectedRevision) fail("REVISION_CONFLICT");
    if (row.revision >= 2147483647) fail("STATE_CONFLICT");
  }

  function grantView(row: GrantRow) {
    const grant = parseCanonicalCatalogGrant({
      grantId: row.grant_id,
      releaseId: row.release_id,
      subject: row.subject_type === "ORGANIZATION"
        ? { kind: "ORGANIZATION" as const }
        : { kind: "HUMAN" as const, humanId: row.human_id },
      revision: row.revision,
      revokedAt: row.revoked_at,
    });
    if (!grant) fail("IDENTITY_CONFLICT");
    return grant;
  }

  function readGrantRow(grantId: string): GrantRow {
    const row = db.prepare<[string], GrantRow>(`SELECT grant_id,release_id,subject_type,human_id,revision,revoked_at
      FROM catalog_grants WHERE grant_id=?`).get(grantId);
    if (!row) fail("NOT_FOUND");
    return row;
  }

  function publishCommitted(event: CatalogAuditEvent): void {
    try { publishAudit(event); } catch { /* DB commit is authoritative; publication is post-commit only. */ }
  }

  function persistSourceMutation(command: Exclude<CatalogAuthorityCommand, { kind: "source.sync" | "release.review" | "grant.organization" | "grant.human" | "grant.revoke" }>, actor: HumanAdmin): { source: SourceView; audit: CatalogAuditEvent } {
    try {
      return db.transaction(() => {
        assertAdmin(actor);
        const now = Date.now();
        let sourceId: string;
        let revision: number;
        if (command.kind === "source.create") {
          const parsed = SourceCreateSchema.safeParse(command.source);
          if (!parsed.success) fail("INVALID_REQUEST");
          const input = parsed.data;
          sourceId = input.sourceId;
          const repository = canonicalRepository(input.repository.url);
          if (db.prepare("SELECT source_id FROM catalog_sources WHERE source_id=? OR (repository_identity=? AND ref=?)")
            .get(sourceId, repository.identity, input.ref)) fail("IDENTITY_CONFLICT");
          db.prepare(`INSERT INTO catalog_sources
            (source_id,display_name,canonical_url,ssh_user,repository_identity,ref,enabled,allow_packages,revision,removed_at,current_snapshot_id,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?, ?,1,NULL,NULL,?,?)`)
            .run(sourceId, input.displayName, repository.canonicalUrl, null, repository.identity, input.ref,
              Number(input.enabled), Number(input.allowPackages), now, now);
          revision = 1;
        } else {
          if (!SourceIdSchema.safeParse(command.sourceId).success) fail("INVALID_REQUEST");
          sourceId = command.sourceId;
          const row = readSource(sourceId);
          const expectedRevision = command.kind === "source.patch" ? command.patch.expectedRevision : command.expectedRevision;
          checkRevision(row, expectedRevision);
          revision = row.revision + 1;
          if (command.kind === "source.patch") {
            const parsed = SourcePatchSchema.safeParse(command.patch);
            if (!parsed.success) fail("INVALID_REQUEST");
            if (row.removed_at !== null) fail("REMOVED");
            db.prepare(`UPDATE catalog_sources SET display_name=?,enabled=?,allow_packages=?,revision=?,updated_at=? WHERE source_id=?`)
              .run(parsed.data.displayName ?? row.display_name,
                parsed.data.enabled === undefined ? row.enabled : Number(parsed.data.enabled),
                parsed.data.allowPackages === undefined ? row.allow_packages : Number(parsed.data.allowPackages),
                revision, now, sourceId);
          } else if (command.kind === "source.remove") {
            if (row.removed_at !== null) fail("STATE_CONFLICT");
            db.prepare("DELETE FROM catalog_source_read_credentials WHERE source_id=?").run(sourceId);
            db.prepare(`UPDATE catalog_sources SET enabled=0,allow_packages=0,removed_at=?,revision=?,updated_at=? WHERE source_id=?`)
              .run(now, revision, now, sourceId);
          } else if (command.kind === "source.restore") {
            if (row.removed_at === null) fail("STATE_CONFLICT");
            db.prepare("DELETE FROM catalog_source_read_credentials WHERE source_id=?").run(sourceId);
            db.prepare(`UPDATE catalog_sources SET enabled=0,allow_packages=0,removed_at=NULL,revision=?,updated_at=? WHERE source_id=?`)
              .run(revision, now, sourceId);
          } else if (command.kind === "source.credential.put") {
            if (row.removed_at !== null) fail("REMOVED");
            if (typeof command.username !== "string" || command.username.length < 1 || command.username.length > 1024
              || typeof command.password !== "string" || command.password.length < 1 || command.password.length > 8192) fail("INVALID_REQUEST");
            const credentialRef = randomUUID();
            let ciphertext: string;
            try {
              const plaintext = JSON.stringify({ version: 1, kind: "https-basic", sourceId,
                repositoryIdentity: row.repository_identity, credentialRef,
                username: command.username, password: command.password });
              if (Buffer.byteLength(plaintext, "utf8") > 16384) fail("INVALID_REQUEST");
              ciphertext = encryptSecret(parseMasterKey(process.env.ORGOPS_MASTER_KEY ?? ""), plaintext);
            } catch (error) {
              if (error instanceof CatalogAuthorityError) throw error;
              fail("STORAGE_FAILURE");
            }
            const prior = db.prepare<[string], { revision: number }>(
              "SELECT revision FROM catalog_source_read_credentials WHERE source_id=?",
            ).get(sourceId);
            if (prior?.revision === 2147483647) fail("STATE_CONFLICT");
            db.prepare(`INSERT INTO catalog_source_read_credentials
              (source_id,credential_ref,kind,ciphertext_b64,legacy_binding_source_id,legacy_credential_ref,revision,created_at,updated_at)
              VALUES (?,?,'https-basic',?,NULL,NULL,?,?,?)
              ON CONFLICT(source_id) DO UPDATE SET credential_ref=excluded.credential_ref,
                ciphertext_b64=excluded.ciphertext_b64,legacy_binding_source_id=NULL,legacy_credential_ref=NULL,
                revision=excluded.revision,updated_at=excluded.updated_at`)
              .run(sourceId, credentialRef, ciphertext, (prior?.revision ?? 0) + 1, prior ? row.created_at : now, now);
            db.prepare("UPDATE catalog_sources SET revision=?,updated_at=? WHERE source_id=?").run(revision, now, sourceId);
          } else {
            if (row.removed_at !== null) fail("REMOVED");
            const deleted = db.prepare("DELETE FROM catalog_source_read_credentials WHERE source_id=?").run(sourceId);
            if (deleted.changes !== 1) fail("STATE_CONFLICT");
            db.prepare("UPDATE catalog_sources SET revision=?,updated_at=? WHERE source_id=?").run(revision, now, sourceId);
          }
        }
        const action = command.kind;
        const audit = makeAudit({ type: "audit.catalog.source.changed", actor, action, outcome: "SUCCEEDED", revision, sourceId });
        writeAudit(db, audit);
        return { source: sourceView(readSource(sourceId)), audit };
      }).immediate();
    } catch (error) {
      if (error instanceof CatalogAuthorityError) throw error;
      fail("STORAGE_FAILURE");
    }
  }

  function immutableReleaseMatches(row: ExistingReleaseRow, release: ObservedRelease, sourceCommit: string): boolean {
    return row.content_source_id === release.contentSourceId
      && row.kind === release.entry.kind
      && row.name === release.entry.name
      && row.version === release.entry.version
      && row.digest === release.entry.digest
      && row.catalog_commit === sourceCommit
      && row.package_commit === release.packageCommit
      && row.package_path === release.packagePath
      && row.manifest_json === release.manifestJson
      && row.execution_preview_json === release.executionJson
      && row.warnings_json === release.warningsJson;
  }

  function assertReleaseIdentities(sourceId: string, sourceCommit: string, releases: readonly ObservedRelease[]): void {
    const statement = db.prepare<[string, string, string], ExistingReleaseRow>(`SELECT package_release_id,content_source_id,kind,name,version,digest,
      catalog_commit,package_commit,package_path,manifest_json,execution_preview_json,warnings_json
      FROM catalog_package_releases WHERE authority_source_id=? AND name=? AND version=?`);
    for (const release of releases) {
      const existing = statement.get(sourceId, release.entry.name, release.entry.version);
      if (existing && !immutableReleaseMatches(existing, release, sourceCommit)) fail("IDENTITY_CONFLICT");
    }
  }

  function assertExternalSourcePermissions(sourceId: string, releases: readonly ObservedRelease[]): void {
    const externalSourceIds = new Set(releases
      .map(release => release.contentSourceId)
      .filter(contentSourceId => contentSourceId !== sourceId));
    const statement = db.prepare<[string], { enabled: number; allow_packages: number; removed_at: number | null }>(
      "SELECT enabled,allow_packages,removed_at FROM catalog_sources WHERE source_id=?",
    );
    for (const externalSourceId of externalSourceIds) {
      const source = statement.get(externalSourceId);
      if (!source || source.removed_at !== null || source.enabled !== 1 || source.allow_packages !== 1) fail("SOURCE_NOT_ALLOWED");
    }
  }

  async function inspectObservation(source: SourceRow, observation: SourceFetchObservation): Promise<{ index: InspectedCatalogIndex; releases: ObservedRelease[] }> {
    let inspected: InspectedCatalogIndex;
    try { inspected = await inspectIndex(observation); }
    catch (error) {
      if (error instanceof CatalogAuthorityError) throw error;
      fail("INSPECTION_FAILED");
    }
    if (typeof inspected.indexJson !== "string" || Buffer.byteLength(inspected.indexJson, "utf8") > 2_097_152
      || inspected.indexDigest !== sha256(inspected.indexJson)) fail("INSPECTION_FAILED");
    const releases: ObservedRelease[] = [];
    for (const entry of inspected.index.entries) {
      let contentSourceId = source.source_id;
      let packageCommit: string;
      let packagePath: string;
      if (entry.location.type === "catalog") {
        packageCommit = entry.location.revision.type === "exact" ? entry.location.revision.commit : observation.commit;
        packagePath = entry.location.path;
      } else {
        contentSourceId = entry.location.sourceId;
        packageCommit = entry.location.commit;
        packagePath = entry.location.path;
        if (contentSourceId !== source.source_id) {
          const contentSource = readSource(contentSourceId);
          if (contentSource.removed_at !== null || contentSource.enabled !== 1 || contentSource.allow_packages !== 1) fail("SOURCE_NOT_ALLOWED");
        }
      }
      let snapshot: PackageSnapshot;
      try {
        snapshot = await inspectRelease(observation, entry, {
          authoritySourceId: source.source_id,
          contentSourceId,
          packageCommit,
          packagePath,
        });
      } catch (error) {
        if (error instanceof CatalogAuthorityError) throw error;
        fail("INSPECTION_FAILED");
      }
      if (snapshot.manifest.kind !== entry.kind || snapshot.manifest.name !== entry.name
        || snapshot.manifest.version !== entry.version || snapshot.manifest.digest !== entry.digest) fail("INSPECTION_FAILED");
      releases.push({
        entry,
        contentSourceId,
        packageCommit,
        packagePath,
        manifestJson: JSON.stringify(snapshot.manifest),
        executionJson: JSON.stringify(snapshot.execution),
        warningsJson: JSON.stringify(snapshot.warnings),
      });
    }
    return { index: inspected, releases };
  }

  function finishFailedAttempt(attemptId: string, actor: HumanAdmin, code: SyncFailureCode, emitAudit: boolean): SyncAttemptView {
    try {
      const committed = db.transaction(() => {
        const now = Date.now();
        const current = readAttempt(attemptId);
        if (current.state !== "RUNNING") return { attempt: attemptView(current), audit: undefined as CatalogAuditEvent | undefined };
        db.prepare(`UPDATE catalog_sync_attempts SET state='FAILED',failure_code=?,revision=revision+1,updated_at=?,completed_at=?
          WHERE attempt_id=? AND state='RUNNING'`).run(code, now, now, attemptId);
        const attempt = attemptView(readAttempt(attemptId));
        const audit = emitAudit ? makeAudit({
          type: "audit.catalog.sync.failed", actor, action: "source.sync", outcome: "FAILED",
          revision: attempt.revision, sourceId: attempt.sourceId, operationId: attempt.attemptId,
          failureCode: code,
        }) : undefined;
        if (audit) writeAudit(db, audit);
        return { attempt, audit };
      }).immediate();
      if (committed.audit) publishCommitted(committed.audit);
      return committed.attempt;
    } catch { fail("STORAGE_FAILURE"); }
  }

  async function runSync(sourceId: string, expectedRevision: number, actor: HumanAdmin, emitAudit: boolean): Promise<{ source: SourceView; attempt: SyncAttemptView }> {
    let started: { attemptId: string; source: SourceRow };
    try {
      started = db.transaction(() => {
        assertAdmin(actor);
        if (!SourceIdSchema.safeParse(sourceId).success || !Number.isInteger(expectedRevision)) fail("INVALID_REQUEST");
        const source = readSource(sourceId);
        checkRevision(source, expectedRevision);
        if (source.removed_at !== null) fail("REMOVED");
        if (source.enabled !== 1) fail("SOURCE_NOT_ALLOWED");
        if (db.prepare("SELECT 1 FROM catalog_sync_attempts WHERE source_id=? AND state='RUNNING'").get(sourceId)) fail("OPERATION_IN_PROGRESS");
        const attemptId = randomUUID();
        const now = Date.now();
        db.prepare(`INSERT INTO catalog_sync_attempts
          (attempt_id,source_id,source_revision,state,resolved_commit,snapshot_id,failure_code,actor_human_id,revision,created_at,updated_at,completed_at)
          VALUES (?,?,?,'RUNNING',NULL,NULL,NULL,?,1,?,?,NULL)`)
          .run(attemptId, sourceId, source.revision, actor.id, now, now);
        return { attemptId, source };
      }).immediate();
    } catch (error) {
      if (error instanceof CatalogAuthorityError) throw error;
      fail("STORAGE_FAILURE");
    }

    let observation: SourceFetchObservation | undefined;
    let cleanupAttempted = false;
    try {
      observation = await fetchSource({
        sourceId: started.source.source_id,
        canonicalUrl: started.source.canonical_url,
        repositoryIdentity: started.source.repository_identity,
        ref: started.source.ref,
      });
      if (!/^[0-9a-f]{40}$/.test(observation.commit) || observation.observedRef !== started.source.ref) fail("SYNC_FAILED");
      const inspected = await inspectObservation(started.source, observation);
      assertReleaseIdentities(sourceId, observation.commit, inspected.releases);
      await observation.promote(observation.commit);
      cleanupAttempted = true;
      await observation.cleanup();

      const committed = db.transaction(() => {
        assertAdmin(actor);
        const current = readSource(sourceId);
        if (current.revision !== expectedRevision) fail("REVISION_CONFLICT");
        if (current.removed_at !== null || current.enabled !== 1) fail("SOURCE_NOT_ALLOWED");
        if (current.repository_identity !== started.source.repository_identity
          || current.canonical_url !== started.source.canonical_url || current.ref !== started.source.ref) fail("IDENTITY_CONFLICT");
        assertExternalSourcePermissions(sourceId, inspected.releases);
        assertReleaseIdentities(sourceId, observation!.commit, inspected.releases);
        const now = Date.now();
        const priorSnapshot = db.prepare<[string, string], { snapshot_id: string; index_digest: string; index_json: string }>(
          "SELECT snapshot_id,index_digest,index_json FROM catalog_snapshots WHERE source_id=? AND source_commit=?",
        ).get(sourceId, observation!.commit);
        let snapshotId: string;
        if (priorSnapshot) {
          if (priorSnapshot.index_digest !== inspected.index.indexDigest || priorSnapshot.index_json !== inspected.index.indexJson) fail("IDENTITY_CONFLICT");
          snapshotId = priorSnapshot.snapshot_id;
        } else {
          snapshotId = stableId("snapshot", [sourceId, observation!.commit, inspected.index.indexDigest]);
          db.prepare(`INSERT INTO catalog_snapshots
            (snapshot_id,source_id,source_commit,index_digest,index_json,observed_ref,attempt_id,created_at)
            VALUES (?,?,?,?,?,?,?,?)`)
            .run(snapshotId, sourceId, observation!.commit, inspected.index.indexDigest, inspected.index.indexJson,
              observation!.observedRef, started.attemptId, now);
        }
        for (const [ordinal, release] of inspected.releases.entries()) {
          let existing = db.prepare<[string, string, string], ExistingReleaseRow>(`SELECT package_release_id,content_source_id,kind,name,version,digest,
            catalog_commit,package_commit,package_path,manifest_json,execution_preview_json,warnings_json
            FROM catalog_package_releases WHERE authority_source_id=? AND name=? AND version=?`)
            .get(sourceId, release.entry.name, release.entry.version);
          if (!existing) {
            const packageReleaseId = stableId("release", [sourceId, release.entry.name, release.entry.version]);
            db.prepare(`INSERT INTO catalog_package_releases
              (package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,
               manifest_json,execution_preview_json,warnings_json,created_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
              .run(packageReleaseId, sourceId, release.contentSourceId, release.entry.kind, release.entry.name, release.entry.version,
                release.entry.digest, observation!.commit, release.packageCommit, release.packagePath,
                release.manifestJson, release.executionJson, release.warningsJson, now);
            db.prepare(`INSERT INTO catalog_release_controls
              (package_release_id,review_state,review_digest,reviewed_by_human_id,reviewed_at,revision,created_at,updated_at)
              VALUES (?,'PENDING',NULL,NULL,NULL,1,?,?)`).run(packageReleaseId, now, now);
            existing = db.prepare<[string, string, string], ExistingReleaseRow>(`SELECT package_release_id,content_source_id,kind,name,version,digest,
              catalog_commit,package_commit,package_path,manifest_json,execution_preview_json,warnings_json
              FROM catalog_package_releases WHERE authority_source_id=? AND name=? AND version=?`)
              .get(sourceId, release.entry.name, release.entry.version)!;
          }
          if (!immutableReleaseMatches(existing, release, observation!.commit)) fail("IDENTITY_CONFLICT");
          if (!priorSnapshot) db.prepare("INSERT INTO catalog_snapshot_entries (snapshot_id,package_release_id,ordinal) VALUES (?,?,?)")
            .run(snapshotId, existing.package_release_id, ordinal);
        }
        db.prepare("UPDATE catalog_sources SET current_snapshot_id=?,updated_at=? WHERE source_id=?")
          .run(snapshotId, now, sourceId);
        db.prepare(`UPDATE catalog_sync_attempts SET state='SUCCEEDED',resolved_commit=?,snapshot_id=?,failure_code=NULL,
          revision=revision+1,updated_at=?,completed_at=? WHERE attempt_id=? AND state='RUNNING'`)
          .run(observation!.commit, snapshotId, now, now, started.attemptId);
        const attempt = attemptView(readAttempt(started.attemptId));
        const audit = emitAudit ? makeAudit({
          type: "audit.catalog.sync.completed", actor, action: "source.sync", outcome: "SUCCEEDED",
          revision: attempt.revision, sourceId, operationId: attempt.attemptId,
        }) : undefined;
        if (audit) writeAudit(db, audit);
        return { attempt, source: sourceView(readSource(sourceId)), audit };
      }).immediate();
      if (committed.audit) publishCommitted(committed.audit);
      return { source: committed.source, attempt: committed.attempt };
    } catch (error) {
      if (observation && !cleanupAttempted) {
        cleanupAttempted = true;
        try { await observation.cleanup(); } catch { error = new CatalogAuthorityError("SYNC_FAILED"); }
      }
      const code = syncFailureCode(error);
      const attempt = finishFailedAttempt(started.attemptId, actor, code, emitAudit);
      return { source: sourceView(readSource(sourceId)), attempt };
    }
  }

  function persistReleaseReview(
    command: Extract<CatalogAuthorityCommand, { kind: "release.review" }>,
    actor: HumanAdmin,
  ): { result: Extract<CatalogAuthorityResult, { kind: "review" }>; audit: CatalogAuditEvent } {
    try {
      return db.transaction(() => {
        assertAdmin(actor);
        if (!PackageReleaseIdSchema.safeParse(command.releaseId).success
          || !Number.isInteger(command.expectedRevision) || command.expectedRevision < 1
          || !DigestSchema.safeParse(command.digest).success
          || !DigestSchema.safeParse(command.reviewDigest).success
          || !(["APPROVE", "REJECT", "WITHDRAW", "REOPEN"] as const).includes(command.action)) fail("INVALID_REQUEST");
        const current = readReleaseRow(command.releaseId);
        if (current.control_revision !== command.expectedRevision || current.digest !== command.digest) fail("REVISION_CONFLICT");
        if (current.control_revision >= 2147483647) fail("STATE_CONFLICT");
        if (current.review_state !== "PENDING" && current.review_digest !== command.reviewDigest) fail("REVISION_CONFLICT");
        const nextState = nextReviewState(current.review_state, command.action);
        const now = Date.now();
        const nextRevision = current.control_revision + 1;
        const reopened = nextState === "PENDING";
        const updated = db.prepare(`UPDATE catalog_release_controls
          SET review_state=?,review_digest=?,reviewed_by_human_id=?,reviewed_at=?,revision=?,updated_at=?
          WHERE package_release_id=? AND revision=?`)
          .run(nextState, reopened ? null : command.reviewDigest, reopened ? null : actor.id,
            reopened ? null : now, nextRevision, now, command.releaseId, command.expectedRevision);
        if (updated.changes !== 1) fail("REVISION_CONFLICT");
        const audit = makeAudit({
          type: "audit.catalog.release.reviewed",
          actor,
          action: command.action,
          outcome: "SUCCEEDED",
          revision: nextRevision,
          releaseId: command.releaseId,
          digest: command.digest,
        });
        writeAudit(db, audit);
        return { result: { kind: "review" as const, release: releaseView(readReleaseRow(command.releaseId)) }, audit };
      }).immediate();
    } catch (error) {
      if (error instanceof CatalogAuthorityError) throw error;
      fail("STORAGE_FAILURE");
    }
  }

  function assertGrantableRelease(releaseId: string): ReleaseProjectionRow {
    const release = readReleaseRow(releaseId);
    if (release.review_state !== "APPROVED") fail("RELEASE_NOT_APPROVED");
    const sources = db.prepare<[string, string], { authority_enabled: number; authority_removed: number | null; content_enabled: number; content_removed: number | null; content_allow_packages: number }>(`SELECT
      authority.enabled AS authority_enabled,authority.removed_at AS authority_removed,
      content.enabled AS content_enabled,content.removed_at AS content_removed,content.allow_packages AS content_allow_packages
      FROM catalog_sources authority JOIN catalog_sources content ON content.source_id=? WHERE authority.source_id=?`)
      .get(release.content_source_id, release.authority_source_id);
    if (!sources || sources.authority_enabled !== 1 || sources.authority_removed !== null
      || sources.content_enabled !== 1 || sources.content_removed !== null
      || (release.authority_source_id !== release.content_source_id && sources.content_allow_packages !== 1)) fail("SOURCE_NOT_ALLOWED");
    if (release.installation_state !== "INSTALLED") fail("INSTALLATION_REQUIRED");
    return release;
  }

  function persistGrantMutation(
    command: Extract<CatalogAuthorityCommand, { kind: "grant.organization" | "grant.human" | "grant.revoke" }>,
    actor: HumanAdmin,
  ): { result: Extract<CatalogAuthorityResult, { kind: "grant" }>; audit: CatalogAuditEvent } {
    try {
      return db.transaction(() => {
        assertAdmin(actor);
        const now = Date.now();
        let row: GrantRow;
        let action: string;
        let digest: string;
        if (command.kind === "grant.revoke") {
          if (!PackageReleaseIdSchema.safeParse(command.grantId).success
            || !Number.isInteger(command.expectedRevision) || command.expectedRevision < 1) fail("INVALID_REQUEST");
          const current = readGrantRow(command.grantId);
          const boundGrant = grantView(current);
          if (current.revision !== command.expectedRevision) fail("REVISION_CONFLICT");
          if (current.revision >= 2147483647) fail("STATE_CONFLICT");
          if (current.revoked_at !== null) fail("STATE_CONFLICT");
          const release = readReleaseRow(boundGrant.releaseId);
          if (!PackageReleaseIdSchema.safeParse(release.package_release_id).success
            || !DigestSchema.safeParse(release.digest).success) fail("IDENTITY_CONFLICT");
          const updated = db.prepare(`UPDATE catalog_grants SET revoked_at=?,revision=revision+1,updated_at=?
            WHERE grant_id=? AND revision=? AND revoked_at IS NULL`).run(now, now, current.grant_id, command.expectedRevision);
          if (updated.changes !== 1) fail("REVISION_CONFLICT");
          row = readGrantRow(current.grant_id);
          action = command.kind;
          digest = release.digest;
        } else {
          if (!PackageReleaseIdSchema.safeParse(command.releaseId).success
            || !Number.isInteger(command.expectedRevision) || command.expectedRevision < 0 || command.expectedRevision > 2147483647) fail("INVALID_REQUEST");
          const humanId = command.kind === "grant.human" ? command.humanId : undefined;
          if (humanId !== undefined) {
            if (typeof humanId !== "string" || humanId.length < 1 || humanId.length > 200) fail("INVALID_REQUEST");
            if (!db.prepare("SELECT 1 FROM humans WHERE id=?").get(humanId)) fail("NOT_FOUND");
          }
          const subjectType = command.kind === "grant.organization" ? "ORGANIZATION" as const : "HUMAN" as const;
          const grantId = catalogGrantId(command.releaseId, subjectType, humanId);
          const current = db.prepare<[string], GrantRow>(`SELECT grant_id,release_id,subject_type,human_id,revision,revoked_at
            FROM catalog_grants WHERE grant_id=?`).get(grantId);
          if (current) grantView(current);
          const tupleRows = db.prepare<[string, string, string | null], GrantRow>(`SELECT grant_id,release_id,subject_type,human_id,revision,revoked_at
            FROM catalog_grants WHERE release_id=? AND subject_type=? AND human_id IS ?`).all(command.releaseId, subjectType, humanId ?? null);
          if (tupleRows.some(candidate => !parseCanonicalCatalogGrant({
            grantId: candidate.grant_id,
            releaseId: candidate.release_id,
            subject: candidate.subject_type === "ORGANIZATION"
              ? { kind: "ORGANIZATION" }
              : { kind: "HUMAN", humanId: candidate.human_id },
            revision: candidate.revision,
            revokedAt: candidate.revoked_at,
          }))) fail("IDENTITY_CONFLICT");
          if (!current) {
            if (command.expectedRevision !== 0) fail("REVISION_CONFLICT");
          } else {
            if (current.release_id !== command.releaseId || current.subject_type !== subjectType || current.human_id !== (humanId ?? null)) fail("IDENTITY_CONFLICT");
            if (current.revision !== command.expectedRevision) fail("REVISION_CONFLICT");
            if (current.revision >= 2147483647) fail("STATE_CONFLICT");
            if (current.revoked_at === null) fail("STATE_CONFLICT");
          }
          const release = assertGrantableRelease(command.releaseId);
          if (!current) {
            db.prepare(`INSERT INTO catalog_grants
              (grant_id,release_id,subject_type,human_id,revision,revoked_at,created_by_human_id,created_at,updated_at)
              VALUES (?,?,?,?,1,NULL,?,?,?)`).run(grantId, command.releaseId, subjectType, humanId ?? null, actor.id, now, now);
          } else {
            const updated = db.prepare(`UPDATE catalog_grants SET revoked_at=NULL,revision=revision+1,updated_at=?
              WHERE grant_id=? AND revision=? AND revoked_at IS NOT NULL`).run(now, grantId, command.expectedRevision);
            if (updated.changes !== 1) fail("REVISION_CONFLICT");
          }
          row = readGrantRow(grantId);
          action = command.kind;
          digest = release.digest;
        }
        const audit = makeAudit({
          type: "audit.catalog.grant.changed", actor, action, outcome: "SUCCEEDED", revision: row.revision,
          releaseId: row.release_id, operationId: row.grant_id, digest,
        });
        writeAudit(db, audit);
        return { result: { kind: "grant" as const, grant: grantView(row) }, audit };
      }).immediate();
    } catch (error) {
      if (error instanceof CatalogAuthorityError) throw error;
      fail("STORAGE_FAILURE");
    }
  }

  async function execute(command: CatalogAuthorityCommand, actor: HumanAdmin): Promise<CatalogAuthorityResult> {
    assertTransactionOwner();
    if (!command || typeof command !== "object" || typeof command.kind !== "string") fail("INVALID_REQUEST");
    if (command.kind === "source.sync") {
      const synced = await runSync(command.sourceId, command.expectedRevision, actor, true);
      return { kind: "sync", source: synced.source, syncAttempt: synced.attempt };
    }
    if (command.kind === "release.review") {
      const committed = persistReleaseReview(command, actor);
      publishCommitted(committed.audit);
      return committed.result;
    }
    if (command.kind === "grant.organization" || command.kind === "grant.human" || command.kind === "grant.revoke") {
      const committed = persistGrantMutation(command, actor);
      publishCommitted(committed.audit);
      return committed.result;
    }
    const committed = persistSourceMutation(command, actor);
    publishCommitted(committed.audit);
    if (command.kind === "source.create") {
      const synced = await runSync(committed.source.sourceId, committed.source.revision, actor, false);
      return { kind: "source", source: synced.source, syncAttempt: synced.attempt };
    }
    return { kind: "source", source: committed.source };
  }

  async function query(queryInput: CatalogAuthorityQuery, actor: AuthenticatedHuman): Promise<CatalogAuthorityQueryResult> {
    assertTransactionOwner();
    assertAdmin(actor as HumanAdmin);
    if (!queryInput || typeof queryInput !== "object") fail("INVALID_REQUEST");
    if (queryInput.kind === "source.list") {
      return db.prepare<[], SourceRow>(`${sourceSelect} ORDER BY s.source_id`).all().map(sourceView);
    }
    if (queryInput.kind === "source.detail") {
      if (!SourceIdSchema.safeParse(queryInput.sourceId).success) fail("INVALID_REQUEST");
      return sourceView(readSource(queryInput.sourceId));
    }
    if (queryInput.kind === "source.sync-attempts") {
      readSource(queryInput.sourceId);
      return db.prepare<[string], AttemptRow>(`SELECT attempt_id,source_id,state,snapshot_id,failure_code,revision
        FROM catalog_sync_attempts WHERE source_id=? ORDER BY created_at DESC,attempt_id DESC`).all(queryInput.sourceId).map(attemptView);
    }
    if (queryInput.kind === "source.snapshots") {
      readSource(queryInput.sourceId);
      return db.prepare<[string], { snapshot_id: string; source_id: string; source_commit: string; index_digest: string; observed_ref: string; created_at: number }>(
        `SELECT snapshot_id,source_id,source_commit,index_digest,observed_ref,created_at
         FROM catalog_snapshots WHERE source_id=? ORDER BY created_at DESC,snapshot_id DESC`,
      ).all(queryInput.sourceId).map(row => ({
        snapshotId: row.snapshot_id,
        sourceId: row.source_id,
        sourceCommit: row.source_commit,
        indexDigest: row.index_digest,
        observedRef: row.observed_ref,
        createdAt: row.created_at,
      }));
    }
    if (queryInput.kind === "release.list") {
      return db.prepare<[], ReleaseProjectionRow>(`${releaseSelect} ORDER BY r.package_release_id`).all().map(releaseView);
    }
    if (queryInput.kind === "release.detail") {
      if (!PackageReleaseIdSchema.safeParse(queryInput.packageReleaseId).success) fail("INVALID_REQUEST");
      return releaseView(readReleaseRow(queryInput.packageReleaseId));
    }
    if (queryInput.kind === "release.grants") {
      if (!PackageReleaseIdSchema.safeParse(queryInput.packageReleaseId).success) fail("INVALID_REQUEST");
      readReleaseRow(queryInput.packageReleaseId);
      return db.prepare<[string], GrantRow>(`SELECT grant_id,release_id,subject_type,human_id,revision,revoked_at
        FROM catalog_grants WHERE release_id=? ORDER BY subject_type,human_id,grant_id`)
        .all(queryInput.packageReleaseId).map(grantView);
    }
    fail("STATE_CONFLICT");
  }

  return { execute, query };
}
