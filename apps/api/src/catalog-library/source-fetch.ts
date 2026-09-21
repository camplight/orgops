import { createHash } from "node:crypto";
import type { OrgOpsDb } from "@orgops/db";
import { decryptSecret, parseMasterKey } from "@orgops/crypto";
import type { CatalogEntry } from "@orgops/schemas";
import { inspectGitPackage, readGitCatalogIndex } from "@orgops/skills";
import { parseGitHubDestination } from "../catalog-sync/github-destination";
import {
  CATALOG_SYNC_CURRENT_REF,
  CATALOG_SYNC_STAGING_REF,
  createCatalogGitTransport,
  type CatalogGitCredential,
  type CatalogGitTransport,
} from "../catalog-sync/git-fetch";
import { ensureCatalogMirror } from "../catalog-sync/mirror";
import { CatalogAuthorityError, type FetchSource, type InspectIndex, type InspectRelease, type SourceFetchObservation } from "./authority";

const INDEX_PATH = "catalog/index.json";
const COMMIT = /^[0-9a-f]{40}$/;
const contextBrand = Symbol("catalog source inspection context");

type InspectionContext = {
  brand: typeof contextBrand;
  sourceId: string;
  mirrorDirectory: string;
  mirrorsRoot: string;
  gitExecutable: string;
};

type CredentialRow = {
  credential_ref: string;
  kind: string;
  ciphertext_b64: string;
  legacy_binding_source_id: string | null;
  legacy_credential_ref: string | null;
};

type SourceFetchAdapterOptions = {
  db: OrgOpsDb;
  mirrorsRoot: string;
  gitExecutable: string;
  transport?: CatalogGitTransport;
  getMasterKey?: () => string;
};

export type SourceFetchAdapter = {
  fetchSource: FetchSource;
  inspectIndex: InspectIndex;
  inspectRelease: InspectRelease;
  resolvePromotedCommit(sourceId: string, ref?: string): Promise<string | null>;
};

function authorityFailure(code: "SOURCE_UNAVAILABLE" | "SOURCE_NOT_ALLOWED" | "INSPECTION_FAILED" | "SYNC_FAILED" | "STORAGE_FAILURE"): never {
  throw new CatalogAuthorityError(code);
}

function inspectionContext(observation: SourceFetchObservation): InspectionContext {
  const value = observation.inspectionContext;
  if (!value || typeof value !== "object" || (value as { brand?: unknown }).brand !== contextBrand) authorityFailure("INSPECTION_FAILED");
  return value as InspectionContext;
}

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function createSourceFetchAdapter({
  db,
  mirrorsRoot,
  gitExecutable,
  transport,
  getMasterKey = () => process.env.ORGOPS_MASTER_KEY ?? "",
}: SourceFetchAdapterOptions): SourceFetchAdapter {
  const git = transport ?? createCatalogGitTransport(gitExecutable);

  function readCredential(source: Parameters<FetchSource>[0]): CatalogGitCredential | undefined {
    let row: CredentialRow | undefined;
    try {
      row = db.prepare<[string], CredentialRow>(`SELECT credential_ref,kind,ciphertext_b64,
        legacy_binding_source_id,legacy_credential_ref FROM catalog_source_read_credentials WHERE source_id=?`).get(source.sourceId);
    } catch { authorityFailure("STORAGE_FAILURE"); }
    if (!row) return undefined;
    if (row.kind !== "https-basic") authorityFailure("SOURCE_UNAVAILABLE");
    try {
      const value: unknown = JSON.parse(decryptSecret(parseMasterKey(getMasterKey()), row.ciphertext_b64));
      if (!value || typeof value !== "object" || Array.isArray(value)) authorityFailure("SOURCE_UNAVAILABLE");
      const credential = value as Record<string, unknown>;
      const currentBinding = credential.sourceId === source.sourceId && credential.credentialRef === row.credential_ref;
      const legacyBinding = row.legacy_binding_source_id !== null && row.legacy_credential_ref !== null
        && credential.sourceId === row.legacy_binding_source_id && credential.credentialRef === row.legacy_credential_ref;
      if (credential.version !== 1 || credential.kind !== "https-basic"
        || credential.repositoryIdentity !== source.repositoryIdentity || (!currentBinding && !legacyBinding)
        || typeof credential.username !== "string" || typeof credential.password !== "string") authorityFailure("SOURCE_UNAVAILABLE");
      return { username: credential.username, password: credential.password };
    } catch (error) {
      if (error instanceof CatalogAuthorityError) throw error;
      authorityFailure("SOURCE_UNAVAILABLE");
    }
  }

  const fetchSource: FetchSource = async source => {
    const destination = parseGitHubDestination(source.canonicalUrl);
    if (!destination.ok) authorityFailure("SOURCE_NOT_ALLOWED");
    const mirror = await ensureCatalogMirror(mirrorsRoot, source.sourceId);
    if (!mirror.ok) authorityFailure(mirror.code === "MIRROR_IO" ? "STORAGE_FAILURE" : "SOURCE_UNAVAILABLE");
    const prior = await git.resolveRef(mirror.directory, CATALOG_SYNC_CURRENT_REF);
    if (!prior.ok && prior.issue.code !== "REF_MISSING") authorityFailure("SYNC_FAILED");
    const credential = readCredential(source);
    const fetched = await git.fetch(destination.value, source.ref, mirror.directory, credential);
    if (!fetched.ok) authorityFailure("SOURCE_UNAVAILABLE");
    const staged = await git.resolveRef(mirror.directory, CATALOG_SYNC_STAGING_REF);
    if (!staged.ok || !COMMIT.test(staged.value)) authorityFailure("SYNC_FAILED");
    const exactCommit = staged.value;
    let promoted = false;
    let cleaned = false;
    return {
      commit: exactCommit,
      observedRef: source.ref,
      inspectionContext: {
        brand: contextBrand,
        sourceId: source.sourceId,
        mirrorDirectory: mirror.directory,
        mirrorsRoot,
        gitExecutable,
      } satisfies InspectionContext,
      async promote(requestedCommit: string) {
        if (requestedCommit !== exactCommit || promoted) authorityFailure("SYNC_FAILED");
        const result = await git.updateRef(mirror.directory, CATALOG_SYNC_CURRENT_REF, exactCommit, prior.ok ? prior.value : null);
        if (!result.ok) authorityFailure("SYNC_FAILED");
        promoted = true;
      },
      async cleanup() {
        if (cleaned) return;
        cleaned = true;
        const result = await git.deleteRef(mirror.directory, CATALOG_SYNC_STAGING_REF);
        if (!result.ok && result.issue.code !== "REF_MISSING") authorityFailure("SYNC_FAILED");
      },
    };
  };

  const inspectIndex: InspectIndex = async observation => {
    const context = inspectionContext(observation);
    const result = await readGitCatalogIndex({
      repository: { directory: context.mirrorDirectory, gitExecutable: context.gitExecutable },
      commit: observation.commit,
      indexPath: INDEX_PATH,
    });
    if (!result.ok) authorityFailure("INSPECTION_FAILED");
    const indexJson = JSON.stringify(result.value);
    return { index: result.value, indexJson, indexDigest: digest(indexJson) };
  };

  const inspectRelease: InspectRelease = async (observation, _entry: CatalogEntry, release) => {
    const context = inspectionContext(observation);
    let directory = context.mirrorDirectory;
    if (release.contentSourceId !== context.sourceId) {
      const external = await ensureCatalogMirror(context.mirrorsRoot, release.contentSourceId, { create: false });
      if (!external.ok) authorityFailure("SOURCE_UNAVAILABLE");
      directory = external.directory;
    }
    const result = await inspectGitPackage({
      repository: { directory, gitExecutable: context.gitExecutable },
      commit: release.packageCommit,
      path: release.packagePath,
    });
    if (!result.ok) authorityFailure("INSPECTION_FAILED");
    return result.value;
  };

  async function resolvePromotedCommit(sourceId: string, ref = CATALOG_SYNC_CURRENT_REF): Promise<string | null> {
    const mirror = await ensureCatalogMirror(mirrorsRoot, sourceId, { create: false });
    if (!mirror.ok) return null;
    const resolved = await git.resolveRef(mirror.directory, ref);
    return resolved.ok ? resolved.value : null;
  }

  return { fetchSource, inspectIndex, inspectRelease, resolvePromotedCommit };
}
