import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { expect } from "vitest";
import { openDb, type OrgOpsDb } from "@orgops/db";
import { createApp } from "../../apps/api/src/app";
import { createLocalFixtureRepo, type LocalFixtureRepo } from "../../apps/api/src/catalog-sync/fixtures.test-helper";
import { exportAgentPackage, exportSkillPackage, type ExportCandidate } from "../../packages/skills/src/catalogs/export";
import { createPackageDeploymentProcessor } from "../../apps/agent-runner/src/package-delivery";
import { createAgentRuntimeGeneration } from "../../apps/agent-runner/src/runtime-generation";
import { createRunnerApi } from "../../apps/agent-runner/src/runner/api";
import { createRunnerState } from "../../apps/agent-runner/src/runner/state";
import { CatalogAuditEventSchema, getCoreEventShapes, validateEventAgainstShapes, type CatalogIndex, type PackageManifest } from "@orgops/schemas";

const MASTER_KEY = Buffer.alloc(32, 7).toString("base64");
const EXPECTED_PRODUCTION_AUDITS = [
  "audit.catalog.source.changed", "audit.catalog.sync.completed", "audit.catalog.sync.failed", "audit.catalog.release.reviewed",
  "audit.catalog.grant.changed", "audit.catalog.installation.changed", "audit.catalog.template.instantiated",
  "audit.catalog.assignment.changed", "audit.catalog.secret_binding.changed", "audit.catalog.rollout.changed", "audit.catalog.deployment.reported",
] as const;
const json = { "content-type": "application/json" };
type Kind = "skill" | "native-classic" | "native-rlm" | "wrapped";
type InstanceName = "a" | "b";
export type PublishedRelease = { kind: Kind; releaseId: string; name: string; digest: string; manifest: PackageManifest };
export type NegativeResult = {
  case: "failed-sync-after-snapshot" | "changed-immutable-identity" | "installation-no-overwrite" | "wrong-runner-token-binding-attempt"
    | "reassignment-restart" | "local-edit-template-immutability" | "historical-independence" | "rollout-finite-retry-cancel" | "tamper-metadata-root";
  status: "FAILED"; code: string; ids: Record<string, string>; before: Record<string, unknown>; after: Record<string, unknown>;
};
export type LocalBindings = { runnerId: string; workspacePath: string; modelId: string; secretBindings: readonly { requirementName: string; secretId: string }[] };
type AgentResult = {
  id: string; name: string; ownerHumanId: string; assignedRunnerId: string; workspacePath: string; mode: "CLASSIC" | "RLM_REPL" | "WRAPPED"; desiredState: "STOPPED"; runtimeState: "STOPPED";
  channelIds: readonly []; origin: { packageReleaseId: string; mode: string; actorKind: string; createdAt: number };
  requirements: readonly { name: string; state: "SATISFIED" | "MISSING" }[]; secretBindingIds: readonly string[]; wrappedConfig: unknown;
  assignments: readonly { releaseId: string; localSkillName: string; desiredState: string; preload: boolean; revision: number; desiredGeneration: string }[];
};
type Instance = {
  app: ReturnType<typeof createApp>["app"]; db: OrgOpsDb; dir: string; dataDir: string; repo: LocalFixtureRepo; packages: ReturnType<typeof makePackages>; baseIndex: string; packageFiles: ReturnType<typeof repoFiles>;
  cookie: string; humanCookie: string; ownerId: string; humanId: string; sourceId: string; installRoot: string;
  runnerId: string; runnerToken: string; fetchCalls: { credential: { username: string; password: string } | undefined }[];
  delegatedFetchCalls: { credential: { username: string; password: string } | undefined }[];
  canaries: string[]; agents: Map<string, AgentResult>; releaseIds: Set<string>; deploymentIds: Set<string>; rolloutIds: Set<string>;
};
type Fixture = {
  preparePublishedReleases(kinds: readonly Kind[]): { skill: PublishedRelease; nativeClassic: PublishedRelease; nativeRlm: PublishedRelease; wrapped: PublishedRelease };
  syncReviewInstallGrant(release: PublishedRelease, subject: "organization", instance?: InstanceName): Promise<void>;
  createRequiredSecret(instance: InstanceName, requirementName: string): Promise<string>;
  instantiateStopped(release: PublishedRelease, bindings: LocalBindings, instance?: InstanceName): Promise<AgentResult>;
  workspacePath(instance: InstanceName, name: string): string;
  bindRequiredSecret(agent: { id: string }, requirementName: string, value: string, instance?: InstanceName): Promise<string>;
  exerciseSecretBinding(instance?: InstanceName): Promise<void>;
  activateDeployment(agent: { id: string }, instance?: InstanceName): Promise<void>;
  tamperAfterLastGood(agent: { id: string }, instance?: InstanceName): Promise<{ pointerUnchanged: boolean; activeFilesUnchanged: boolean }>;
  start(name: string, instance?: InstanceName): Promise<unknown>;
  createRollout(agent: { id: string }, instance?: InstanceName): Promise<string>;
  runNegativeMatrix(): Promise<NegativeResult[]>;
  assertIsolation(requireCompleteAudits?: boolean): Promise<void>;
  operationCounts(): Record<InstanceName, Record<string, number>>;
  leakedStrings(): string[];
  auditAgentReceiptCount(): number;
  close(): Promise<void>;
};

function metadata(name: string, version = "1.0.0", secrets: PackageManifest["secrets"] = []) {
  return { formatVersion: 1 as const, name, version, description: "Deterministic acceptance package.", author: "OrgOps", license: "MIT",
    compatibility: { orgops: { min: "0.0.1" }, platforms: ["linux" as const], tools: [] }, secrets };
}
function must(result: { ok: boolean; value?: ExportCandidate }): ExportCandidate {
  if (!result.ok || !result.value) throw new Error(`fixture package export failed: ${JSON.stringify(result)}`);
  return result.value;
}
function makePackages(sourceId: string, label: InstanceName) {
  const byteCanary = `catalog-byte-canary-${label}`;
  const skill = must(exportSkillPackage([{ type: "file", path: "SKILL.md", executable: false,
    base64: Buffer.from(`---\nname: acceptance-skill\ndescription: Deterministic acceptance package.\nlicense: MIT\n---\n${byteCanary}\n`).toString("base64") }], {
    metadata: metadata("acceptance-skill"), dependencies: [], executables: [], selectedPaths: ["SKILL.md"],
  }));
  const pin = { catalogId: sourceId, sourceId, name: "acceptance-skill", version: "1.0.0", revision: { type: "same-package-revision" as const }, digest: skill.snapshot.manifest.digest };
  const classic = must(exportAgentPackage({ mode: "CLASSIC", systemInstructions: `authored-instructions-${label}`, soulContents: `authored-soul-${label}`, enabledSkills: [] }, {
    metadata: metadata("acceptance-classic"), dependencies: [],
  }));
  const rlm = must(exportAgentPackage({ mode: "RLM_REPL", systemInstructions: `authored-rlm-${label}`, soulContents: `authored-soul-${label}`, enabledSkills: ["acceptance-skill"] }, {
    metadata: metadata("acceptance-rlm", "1.0.0", [{ name: "API_KEY", description: "Fixture key.", required: true }]), dependencies: [pin],
  }));
  const wrapped = must(exportAgentPackage({ mode: "WRAPPED", wrappedConfig: { kind: "fixture", harness: "command", runtime: { command: `fixture-runtime-${label}` } } }, {
    metadata: metadata("acceptance-wrapped"), dependencies: [],
  }));
  return { skill, classic, rlm, wrapped };
}
function indexFor(packages: ReturnType<typeof makePackages>): CatalogIndex {
  return { formatVersion: 1, entries: Object.values(packages).map(candidate => ({
    kind: candidate.snapshot.manifest.kind, name: candidate.snapshot.manifest.name, version: candidate.snapshot.manifest.version,
    digest: candidate.snapshot.manifest.digest, location: { type: "catalog" as const, path: `packages/${candidate.snapshot.manifest.name}`, revision: { type: "catalog-revision" as const } },
  })) };
}
function repoFiles(packages: ReturnType<typeof makePackages>) {
  return Object.values(packages).flatMap(candidate => candidate.proposedFiles.map(file => ({
    path: `packages/${candidate.snapshot.manifest.name}/${file.path}`, contents: Buffer.from(file.base64, "base64").toString("utf8"),
  })));
}
async function login(app: Instance["app"], username: string, password: string) {
  const response = await app.request("/api/auth/login", { method: "POST", headers: json, body: JSON.stringify({ username, password }) });
  if (response.status !== 200) throw new Error(`fixture login failed: ${response.status}`);
  return response.headers.get("set-cookie")!.match(/orgops_session=[^;]+/)![0];
}
async function request(instance: Instance, path: string, init: RequestInit = {}, cookie = instance.cookie) {
  return instance.app.request(path, { ...init, headers: { cookie, ...(init.headers ?? {}) } });
}
async function makeInstance(label: InstanceName, privateSource: boolean): Promise<Instance> {
  const dir = await mkdtemp(join(tmpdir(), `orgops-catalog-acceptance-${label}-`));
  const dataDir = join(dir, "data");
  const packages = makePackages(`source-${label}`, label);
  const baseIndex = JSON.stringify(indexFor(packages));
  const packageFiles = repoFiles(packages);
  const repo = await createLocalFixtureRepo(baseIndex, "/usr/bin/git", packageFiles);
  const db = openDb(join(dataDir, "orgops.sqlite"));
  const installRoot = join(dir, "artifacts");
  const runnerId = `runner-${label}`;
  const runnerToken = `runner-token-${label}`;
  const fetchCalls: Instance["fetchCalls"] = [];
  const delegatedFetchCalls: Instance["delegatedFetchCalls"] = [];
  const baseTransport = repo.transport({ fetch: delegatedFetchCalls });
  const expectedCredential = { username: `reader-${label}-credential-canary`, password: `credential-${label}-plaintext-canary` };
  const catalogSyncTransport = {
    ...baseTransport,
    async fetch(...args: Parameters<typeof baseTransport.fetch>) {
      const credential = args[3];
      fetchCalls.push({ credential });
      if (privateSource && (!credential || credential.username !== expectedCredential.username || credential.password !== expectedCredential.password)) {
        return { ok: false as const, issue: { code: "GIT_FAILED" as const } };
      }
      if (!privateSource && credential !== undefined) return { ok: false as const, issue: { code: "GIT_FAILED" as const } };
      return baseTransport.fetch(...args);
    },
  };
  const created = createApp({ db, projectRoot: dir, dataDir, catalogInstallRoot: installRoot, adminUser: `owner-${label}`, adminPass: `test-password-${label}`, runnerToken,
    catalogGitExecutable: "/usr/bin/git", catalogSyncTransport });
  const instanceDelegatedCount = () => delegatedFetchCalls.length;
  try {
    const cookie = await login(created.app, `owner-${label}`, `test-password-${label}`);
    const sourceId = `source-${label}`;
    const source = await created.app.request("/api/catalog-sources", { method: "POST", headers: { ...json, cookie }, body: JSON.stringify({ sourceId,
      displayName: `${label}-source-isolation-canary`, repository: { url: `https://github.com/isolation-${label}/catalog-${label}.git` }, ref: "main", enabled: true, allowPackages: true }) });
    if (source.status !== 201) throw new Error(`fixture source create failed: ${source.status}`);
    const sourceBody = await source.json() as { kind: "source"; source: { revision: number; currentSnapshotId: string | null }; syncAttempt?: { state: string; failureCode: string | null; snapshotId: string | null } };
    if (privateSource) {
      if (sourceBody.kind !== "source" || sourceBody.syncAttempt?.state !== "FAILED" || sourceBody.syncAttempt.failureCode !== "SOURCE_UNAVAILABLE"
        || sourceBody.syncAttempt.snapshotId !== null || sourceBody.source.currentSnapshotId !== null) throw new Error(`private initial sync contract mismatch: ${JSON.stringify(sourceBody)}`);
    } else if (sourceBody.syncAttempt?.state !== "SUCCEEDED" || sourceBody.source.currentSnapshotId === null) {
      throw new Error(`public initial sync contract mismatch: ${JSON.stringify(sourceBody)}`);
    }
    const sourceView = await created.app.request(`/api/catalog-sources/${sourceId}`, { headers: { cookie } });
    let revision = (await sourceView.json() as { revision: number }).revision;
    if (privateSource) {
      const missingSync = await created.app.request(`/api/catalog-sources/${sourceId}/sync`, { method: "POST", headers: { ...json, cookie }, body: JSON.stringify({ expectedRevision: revision }) });
      const missingBody = await missingSync.json() as { kind: "sync"; syncAttempt: { state: string; failureCode: string | null; snapshotId: string | null }; source: { currentSnapshotId: string | null } };
      if (missingSync.status !== 200 || missingBody.kind !== "sync" || missingBody.syncAttempt.state !== "FAILED"
        || missingBody.syncAttempt.failureCode !== "SOURCE_UNAVAILABLE" || missingBody.syncAttempt.snapshotId !== null || missingBody.source.currentSnapshotId !== null) {
        throw new Error(`private sync without credential contract mismatch: ${missingSync.status} ${JSON.stringify(missingBody)}`);
      }
      if (instanceDelegatedCount() !== 0) throw new Error("private transport delegated an absent credential");
      const wrongCredential = await created.app.request(`/api/catalog-sources/${sourceId}/read-credential`, { method: "PUT", headers: { ...json, cookie }, body: JSON.stringify({ expectedRevision: revision,
        kind: "https-basic", username: `wrong-reader-${label}`, password: `wrong-password-${label}` }) });
      if (wrongCredential.status !== 200) throw new Error(`fixture wrong credential failed: ${wrongCredential.status}`);
      revision = (await (await created.app.request(`/api/catalog-sources/${sourceId}`, { headers: { cookie } })).json() as { revision: number }).revision;
      const wrongSync = await created.app.request(`/api/catalog-sources/${sourceId}/sync`, { method: "POST", headers: { ...json, cookie }, body: JSON.stringify({ expectedRevision: revision }) });
      const wrongBody = await wrongSync.json() as { kind: "sync"; syncAttempt: { state: string; failureCode: string | null; snapshotId: string | null }; source: { currentSnapshotId: string | null } };
      if (wrongSync.status !== 200 || wrongBody.kind !== "sync" || wrongBody.syncAttempt.state !== "FAILED"
        || wrongBody.syncAttempt.failureCode !== "SOURCE_UNAVAILABLE" || wrongBody.syncAttempt.snapshotId !== null || wrongBody.source.currentSnapshotId !== null) {
        throw new Error(`private sync with wrong credential contract mismatch: ${wrongSync.status} ${JSON.stringify(wrongBody)}`);
      }
      if (instanceDelegatedCount() !== 0) throw new Error("private transport delegated a wrong credential");
      const credential = await created.app.request(`/api/catalog-sources/${sourceId}/read-credential`, { method: "PUT", headers: { ...json, cookie }, body: JSON.stringify({ expectedRevision: revision,
        kind: "https-basic", username: `reader-${label}-credential-canary`, password: `credential-${label}-plaintext-canary` }) });
      if (credential.status !== 200) throw new Error(`fixture credential failed: ${credential.status}`);
      revision = (await (await created.app.request(`/api/catalog-sources/${sourceId}`, { headers: { cookie } })).json() as { revision: number }).revision;
    }
    const sync = await created.app.request(`/api/catalog-sources/${sourceId}/sync`, { method: "POST", headers: { ...json, cookie }, body: JSON.stringify({ expectedRevision: revision }) });
    const syncBody = await sync.json() as { kind: "sync"; source: { currentSnapshotId: string | null }; syncAttempt: { state: string; failureCode: string | null; snapshotId: string | null } };
    if (sync.status !== 200 || syncBody.kind !== "sync" || syncBody.syncAttempt.state !== "SUCCEEDED"
      || syncBody.syncAttempt.failureCode !== null || syncBody.syncAttempt.snapshotId === null || syncBody.source.currentSnapshotId === null) {
      throw new Error(`fixture sync contract mismatch: ${sync.status} ${JSON.stringify(syncBody)}`);
    }
    const bootstrapCredentials = fetchCalls.map(call => call.credential);
    if (privateSource) {
      if (bootstrapCredentials.length < 4 || bootstrapCredentials[0] !== undefined || bootstrapCredentials[1] !== undefined
        || bootstrapCredentials[2]?.username !== `wrong-reader-${label}` || bootstrapCredentials[2]?.password !== `wrong-password-${label}`
        || bootstrapCredentials[3]?.username !== expectedCredential.username || bootstrapCredentials[3]?.password !== expectedCredential.password
        || instanceDelegatedCount() !== 1) {
        throw new Error(`private transport credential sequence mismatch: ${JSON.stringify({ bootstrapCredentials, delegated: delegatedFetchCalls })}`);
      }
    } else if (bootstrapCredentials.length === 0 || bootstrapCredentials.some(credential => credential !== undefined)
      || instanceDelegatedCount() !== bootstrapCredentials.length) {
      throw new Error(`public transport credential sequence mismatch: ${JSON.stringify({ bootstrapCredentials, delegated: delegatedFetchCalls })}`);
    }
    // Exclude bootstrap calls from the post-journey transport proof.
    fetchCalls.length = 0;
    const registered = await created.app.request("/api/runners/register", { method: "POST", headers: { ...json, "x-orgops-runner-token": runnerToken }, body: JSON.stringify({ existingRunnerId: runnerId, displayName: `runner-${label}-canary` }) });
    if (registered.status !== 201) throw new Error(`fixture runner registration failed: ${registered.status}`);
    db.exec(`INSERT INTO models (id,provider,model_name,enabled,defaults_json,created_at) VALUES ('model-test','fixture','fixture',1,'{}',1);`);
    const invite = await created.app.request("/api/humans/invite", { method: "POST", headers: { ...json, cookie }, body: JSON.stringify({ username: `human-${label}`, tempPassword: `temporary-${label}-password` }) });
    if (invite.status !== 201) throw new Error(`fixture human invite failed: ${invite.status}`);
    const invitedCookie = await login(created.app, `human-${label}`, `temporary-${label}-password`);
    const profile = await created.app.request("/api/auth/profile", { method: "PATCH", headers: { ...json, cookie: invitedCookie }, body: JSON.stringify({ newPassword: `human-${label}-password` }) });
    if (profile.status !== 200) throw new Error(`fixture human activation failed: ${profile.status}`);
    const humanCookie = await login(created.app, `human-${label}`, `human-${label}-password`);
    const ownerId = (db.prepare<[string], { id: string }>("SELECT id FROM humans WHERE username=?").get(`owner-${label}`))!.id;
    const humanId = (db.prepare<[string], { id: string }>("SELECT id FROM humans WHERE username=?").get(`human-${label}`))!.id;
    await mkdir(join(dir, "workspaces"), { recursive: true });
    const credentialRow = db.prepare<[], { credential_ref: string; ciphertext_b64: string }>("SELECT credential_ref,ciphertext_b64 FROM catalog_source_read_credentials").get();
    return { app: created.app, db, dir, dataDir, repo, packages, baseIndex, packageFiles, cookie, humanCookie, ownerId, humanId, sourceId, installRoot, runnerId, runnerToken, fetchCalls, delegatedFetchCalls,
      canaries: [`${label}-source-isolation-canary`, `https://github.com/isolation-${label}/catalog-${label}.git`, `credential-${label}-plaintext-canary`, `reader-${label}-credential-canary`, `wrong-reader-${label}`, `wrong-password-${label}`, `catalog-byte-canary-${label}`,
        `authored-instructions-${label}`, `authored-rlm-${label}`, `authored-soul-${label}`, `runner-${label}-canary`, ...(credentialRow ? [credentialRow.credential_ref, credentialRow.ciphertext_b64] : [])], agents: new Map(), releaseIds: new Set(), deploymentIds: new Set(), rolloutIds: new Set() };
  } catch (error) {
    db.close(); await repo.dispose(); await rm(dir, { recursive: true, force: true }); throw error;
  }
}

async function walk(root: string): Promise<Array<{ path: string; bytes: Buffer }>> {
  const result: Array<{ path: string; bytes: Buffer }> = [];
  async function visit(path: string) {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) { for (const entry of await readdir(path)) await visit(join(path, entry)); return; }
    if (stat.isFile()) result.push({ path: relative(root, path), bytes: await readFile(path) });
  }
  await visit(root); return result;
}

export async function twoInstanceFixture(callback?: (fixture: Fixture) => Promise<void>): Promise<Fixture> {
  const priorKey = process.env.ORGOPS_MASTER_KEY;
  const priorCwd = process.cwd();
  let a: Instance | undefined; let b: Instance | undefined; let closed = false;
  process.env.ORGOPS_MASTER_KEY = MASTER_KEY;
  const cleanup = async () => {
    if (closed) return; closed = true;
    a?.db.close(); b?.db.close();
    await Promise.all([a?.repo.dispose(), b?.repo.dispose(), a && rm(a.dir, { recursive: true, force: true }), b && rm(b.dir, { recursive: true, force: true })]);
    if (priorKey === undefined) delete process.env.ORGOPS_MASTER_KEY; else process.env.ORGOPS_MASTER_KEY = priorKey;
    process.chdir(priorCwd);
  };
  try {
    a = await makeInstance("a", true);
    b = await makeInstance("b", false);
    const instances = (name: InstanceName) => name === "a" ? a! : b!;
    const releases = new Map<InstanceName, Map<Kind, PublishedRelease>>([ ["a", new Map()], ["b", new Map()] ]);
    const observedLeaks: string[] = [];
    let tamperProcessCounter = 0;
    const getReleases = async (instance: Instance) => {
      const response = await request(instance, "/api/catalog-releases"); if (response.status !== 200) throw new Error("release discovery failed");
      return await response.json() as Array<{ packageReleaseId: string; kind: PackageManifest["kind"]; name: string; version: string; digest: string; manifest: PackageManifest }>;
    };
    const fixture: Fixture = {
      preparePublishedReleases(kinds) {
        if (kinds.length !== 4) throw new Error("acceptance requires all package kinds");
        const names: Record<Kind, string> = { skill: "acceptance-skill", "native-classic": "acceptance-classic", "native-rlm": "acceptance-rlm", wrapped: "acceptance-wrapped" };
        return { skill: { kind: "skill", releaseId: names.skill, name: names.skill, digest: "", manifest: {} as PackageManifest },
          nativeClassic: { kind: "native-classic", releaseId: names["native-classic"], name: names["native-classic"], digest: "", manifest: {} as PackageManifest },
          nativeRlm: { kind: "native-rlm", releaseId: names["native-rlm"], name: names["native-rlm"], digest: "", manifest: {} as PackageManifest },
          wrapped: { kind: "wrapped", releaseId: names.wrapped, name: names.wrapped, digest: "", manifest: {} as PackageManifest } };
      },
      async syncReviewInstallGrant(release, _subject, name = "a") {
        const instance = instances(name); const seen = releases.get(name)!;
        const sourceView = await request(instance, `/api/catalog-sources/${instance.sourceId}`); const sourceRevision = (await sourceView.json() as { revision: number }).revision;
        const synced = await request(instance, `/api/catalog-sources/${instance.sourceId}/sync`, { method: "POST", headers: json, body: JSON.stringify({ expectedRevision: sourceRevision }) });
        if (synced.status !== 200) throw new Error(`fixture sync failed: ${synced.status} ${await synced.text()}`);
        const rows = await getReleases(instance); const row = rows.find(candidate => candidate.name === release.name); if (!row) throw new Error(`release missing: ${release.name}`);
        const value = { ...release, releaseId: row.packageReleaseId, digest: row.digest, manifest: row.manifest }; Object.assign(release, value); if (seen.has(release.kind)) return;
        for (const dependency of value.manifest.dependencies) {
          const dependencyRow = rows.find(candidate => candidate.name === dependency.name && candidate.version === dependency.version && candidate.digest === dependency.digest);
          if (!dependencyRow) throw new Error(`dependency missing: ${dependency.name}`);
          if (![...seen.values()].some(existing => existing.releaseId === dependencyRow.packageReleaseId)) await fixture.syncReviewInstallGrant({ kind: "skill", releaseId: dependencyRow.packageReleaseId, name: dependencyRow.name, digest: dependencyRow.digest, manifest: dependencyRow.manifest }, "organization", name);
        }
        const detail = await request(instance, `/api/catalog-releases/${value.releaseId}`); if (detail.status !== 200) throw new Error("release detail failed");
        const detailBody = await detail.json() as { revision: number; digest: string; manifest: PackageManifest };
        const review = await request(instance, `/api/catalog-releases/${value.releaseId}/approve`, { method: "POST", headers: json, body: JSON.stringify({ expectedRevision: detailBody.revision, digest: detailBody.digest, reviewDigest: detailBody.digest }) });
        if (review.status !== 200) throw new Error(`review failed: ${review.status}`);
        const dependencyReleaseIds = detailBody.manifest.dependencies.map(dependency => rows.find(candidate => candidate.name === dependency.name && candidate.version === dependency.version && candidate.digest === dependency.digest)!.packageReleaseId);
        const install = await request(instance, `/api/catalog-releases/${value.releaseId}/install`, { method: "POST", headers: json, body: JSON.stringify({ dependencyReleaseIds }) });
        if (install.status !== 200) throw new Error(`install failed: ${install.status} ${await install.text()}`);
        const grant = await request(instance, `/api/catalog-releases/${value.releaseId}/grants/organization`, { method: "PUT", headers: json, body: JSON.stringify({ expectedRevision: 0 }) });
        if (grant.status !== 200) throw new Error(`grant failed: ${grant.status}`);
        seen.set(release.kind, value); instance.releaseIds.add(value.releaseId); instance.canaries.push(value.releaseId, value.digest);
      },
      async createRequiredSecret(name, requirementName) {
        const instance = instances(name); const rlm = releases.get(name)!.get("native-rlm")!;
        const response = await request(instance, "/api/secrets", { method: "POST", headers: json, body: JSON.stringify({ package: rlm.name, key: requirementName, value: `secret-value-${name}-${requirementName}` }) });
        if (response.status !== 200 && response.status !== 201) throw new Error(`secret creation failed: ${response.status}`); return (await response.json() as { id: string }).id;
      },
      async instantiateStopped(release, bindings, name = "a") {
        const instance = instances(name); const rows = await getReleases(instance); const row = rows.find(candidate => candidate.packageReleaseId === release.releaseId) ?? rows.find(candidate => candidate.name === release.name)!;
        const response = await request(instance, `/api/library/templates/${row.packageReleaseId}/instances`, { method: "POST", headers: json,
          body: JSON.stringify({ name: `agent-${release.name}-${name}-${instance.agents.size}`, visibility: "PRIVATE", runnerId: bindings.runnerId, workspacePath: bindings.workspacePath, modelId: bindings.modelId, secretBindings: bindings.secretBindings }) }, instance.humanCookie);
        if (response.status !== 201) throw new Error(`template failed: ${response.status} ${await response.text()} release=${release.releaseId} row=${row.packageReleaseId} controls=${JSON.stringify(instance.db.prepare<[string], unknown>("SELECT review_state,revision FROM catalog_release_controls WHERE package_release_id=?").get(row.packageReleaseId))}`);
        const body = await response.json() as { agent: { id: string; name: string; mode: AgentResult["mode"]; desiredState: "STOPPED"; runtimeState: "STOPPED"; channelIds: [] }; origin: AgentResult["origin"]; requirements: AgentResult["requirements"] };
        const dbAgent = instance.db.prepare<[string], { wrapped_config_json: string; owner_human_id: string; assigned_runner_id: string; workspace_path: string }>("SELECT wrapped_config_json,owner_human_id,assigned_runner_id,workspace_path FROM agents WHERE id=?").get(body.agent.id)!;
        const assignments = instance.db.prepare<[string], AgentResult["assignments"]>("SELECT release_id AS releaseId,local_skill_name AS localSkillName,desired_state AS desiredState,preload,revision,desired_generation AS desiredGeneration FROM agent_skill_assignments WHERE agent_id=? ORDER BY release_id").all(body.agent.id).map(row => ({ ...row, preload: Boolean(row.preload) }));
        const secretBindingIds = instance.db.prepare<[string], { secret_id: string }>("SELECT secret_id FROM agent_package_secret_bindings WHERE agent_id=? ORDER BY requirement_name").all(body.agent.id).map(row => row.secret_id);
        const value: AgentResult = { ...body.agent, ownerHumanId: dbAgent.owner_human_id, assignedRunnerId: dbAgent.assigned_runner_id, workspacePath: dbAgent.workspace_path, origin: body.origin, requirements: body.requirements, secretBindingIds, wrappedConfig: JSON.parse(dbAgent.wrapped_config_json), assignments };
        instance.agents.set(value.id, value); instance.canaries.push(value.id, value.name, bindings.workspacePath); await mkdir(bindings.workspacePath, { recursive: true }); await writeFile(join(bindings.workspacePath, `workspace-${name}.txt`), `workspace-canary-${name}-${value.id}`); return value;
      },
      async bindRequiredSecret(agent, requirementName, value, name = "a") {
        if (!value) throw new Error("secret value required");
        const instance = instances(name);
        const secretId = await fixture.createRequiredSecret(name, requirementName);
        const row = instance.db.prepare<[string], { revision: number }>("SELECT revision FROM agents WHERE id=?").get(agent.id);
        if (!row) throw new Error("agent missing");
        const response = await request(instance, `/api/library/agents/${encodeURIComponent(agent.id)}/requirements/${encodeURIComponent(requirementName)}/secret-binding`, {
          method: "PUT", headers: json, body: JSON.stringify({ expectedAgentRevision: row.revision, secretId }),
        }, instance.humanCookie);
        if (response.status !== 200) throw new Error(`secret binding failed: ${response.status} ${await response.text()}`);
        return secretId;
      },
      async exerciseSecretBinding(name = "b") {
        const instance = instances(name); const agent = [...instance.agents.values()].find(candidate => candidate.requirements.some(requirement => requirement.name === "API_KEY"));
        if (!agent) throw new Error("secret-binding audit fixture agent missing");
        await fixture.bindRequiredSecret(agent, "API_KEY", "audit-secret-canary", name);
      },
      async activateDeployment(agent, name = "a") {
        const instance = instances(name); const skill = releases.get(name)!.get("skill")!;
        const row = instance.db.prepare<[string], { name: string; revision: number; assigned_runner_id: string }>("SELECT name,revision,assigned_runner_id FROM agents WHERE id=?").get(agent.id)!;
        const processingRunnerId = row.assigned_runner_id;
        let assignment = instance.db.prepare<[string, string], { revision: number; preload: number }>("SELECT revision,preload FROM agent_skill_assignments WHERE agent_id=? AND release_id=?").get(agent.id, skill.releaseId);
        if (!assignment) {
          const response = await request(instance, `/api/agents/${row.name}/catalog-skills/${skill.releaseId}`, { method: "PUT", headers: json,
            body: JSON.stringify({ expectedAgentRevision: row.revision, expectedAssignmentRevision: 0, preload: false }) }, instance.humanCookie);
          if (response.status !== 200) throw new Error(`assignment failed: ${response.status} ${await response.text()}`);
          assignment = instance.db.prepare<[string, string], { revision: number; preload: number }>("SELECT revision,preload FROM agent_skill_assignments WHERE agent_id=? AND release_id=?").get(agent.id, skill.releaseId)!;
        }
        const runtimeRoot = join(instance.dir, "runner-runtime"); const fallbackRoot = join(instance.dir, "legacy-skills"); await mkdir(fallbackRoot, { recursive: true });
        const runnerState = createRunnerState(); runnerState.registeredRunnerId = processingRunnerId;
        let signalWaiting!: () => void; let waited = false; const waiting = new Promise<void>(resolve => { signalWaiting = () => { waited = true; resolve(); }; });
        const api = createRunnerApi({ apiUrl: "http://scenario.invalid", runnerToken: instance.runnerToken, heartbeatIntervalMs: 1,
          runnerIdFile: join(instance.dir, `runner-id-${processingRunnerId}`), runnerState, fetch: async (url, init) => {
            const parsed = new URL(url); const response = await instance.app.request(`${parsed.pathname}${parsed.search}`, init);
            if (parsed.pathname.endsWith("/report") && init?.body) { const body = JSON.parse(String(init.body)) as { state?: string }; if (body.state === "WAITING_FOR_IDLE") signalWaiting(); }
            return response;
          } });
        const runtime = createAgentRuntimeGeneration({ packageRoot: runtimeRoot, fallbackRoot });
        const lease = await runtime.captureForTurn(agent.id);
        try {
          const processing = createPackageDeploymentProcessor({ api, runtime }).processPackageDeployments();
          await Promise.race([waiting, processing]);
          lease.release(); await processing;
        } finally { lease.release(); }
        const deployment = instance.db.prepare<[string], { deployment_id: string; state: string }>("SELECT deployment_id,state FROM runner_package_deployments WHERE target_agent_id=? ORDER BY created_at DESC LIMIT 1").get(agent.id);
        if (!deployment || deployment.state !== "ACTIVE") throw new Error("runner deployment did not activate"); instance.deploymentIds.add(deployment.deployment_id); instance.canaries.push(deployment.deployment_id);
      },
      async tamperAfterLastGood(agent, name = "a") {
        const instance = instances(name); const skill = releases.get(name)!.get("skill")!;
        const runtimeRoot = join(instance.dir, "runner-runtime"); const fallbackRoot = join(instance.dir, "legacy-skills");
        const pointerPath = join(runtimeRoot, "agents", createHash("sha256").update(agent.id).digest("hex"), "current.json");
        type RuntimePointer = { agentId: string; deploymentId: string; generation: string; semanticDigest: string; stagedRoot: string; skillRoot: string; promptRoot: string; eventShapeRoot: string };
        const trigger = async (preload: boolean) => {
          const agentRow = instance.db.prepare<[string], { name: string; revision: number }>("SELECT name,revision FROM agents WHERE id=?").get(agent.id)!;
          const assignment = instance.db.prepare<[string, string], { revision: number; preload: number }>("SELECT revision,preload FROM agent_skill_assignments WHERE agent_id=? AND release_id=?").get(agent.id, skill.releaseId)!;
          const response = await request(instance, `/api/agents/${agentRow.name}/catalog-skills/${skill.releaseId}`, { method: "PUT", headers: json,
            body: JSON.stringify({ expectedAgentRevision: agentRow.revision, expectedAssignmentRevision: assignment.revision, preload }) }, instance.humanCookie);
          if (response.status !== 200) throw new Error(`tamper deployment trigger failed: ${response.status} ${await response.text()}`);
        };
        const process = async (mutate: (artifact: any) => any, mutateStaged?: (stagedRoot: string) => Promise<void>) => {
          const processRunnerId = instance.db.prepare<[string], { assigned_runner_id: string }>("SELECT assigned_runner_id FROM agents WHERE id=?").get(agent.id)!.assigned_runner_id;
          const runnerStateForProcess = createRunnerState(); runnerStateForProcess.registeredRunnerId = processRunnerId;
          const processApi = createRunnerApi({ apiUrl: "http://scenario.invalid", runnerToken: instance.runnerToken, heartbeatIntervalMs: 1,
            runnerIdFile: join(instance.dir, `runner-id-tamper-${++tamperProcessCounter}`), runnerState: runnerStateForProcess,
            fetch: async (url, init) => instance.app.request(`${new URL(url).pathname}${new URL(url).search}`, init) });
          const baseRuntime = createAgentRuntimeGeneration({ packageRoot: runtimeRoot, fallbackRoot });
          const runtime = { ...baseRuntime, stage: async (command: any, artifact: any) => { const staged = await baseRuntime.stage(command, mutate(artifact)); await mutateStaged?.(staged.stagedRoot); return staged; } };
          await createPackageDeploymentProcessor({ api: processApi, runtime }).processPackageDeployments();
        };
        const before = await walk(instance.dir); const beforeRuntime = before.filter(file => file.path.startsWith("runner-runtime/") && file.path !== "runner-runtime/");
        const install = instance.db.prepare<[string], { artifact_path: string }>("SELECT artifact_path FROM catalog_installations WHERE release_id=?").get(skill.releaseId)!;
        const artifactFile = join(install.artifact_path, "SKILL.md"); const original = await readFile(artifactFile);
        await trigger(true); await writeFile(artifactFile, Buffer.from("tampered-api-artifact"), { mode: 0o644 });
        try {
          await process(artifact => artifact);
          const failed = instance.db.prepare<[string], { state: string; failure_code: string | null }>("SELECT state,failure_code FROM runner_package_deployments WHERE target_agent_id=? ORDER BY created_at DESC LIMIT 1").get(agent.id);
          if (!failed || failed.state !== "FAILED" || failed.failure_code !== "INSPECTION_FAILED") throw new Error(`API tamper was not durably rejected: ${JSON.stringify(failed)}`);
          const afterApi = await walk(instance.dir); expect(afterApi.filter(file => file.path.startsWith("runner-runtime/") && file.path !== "runner-runtime/")).toEqual(beforeRuntime);
        } finally { await writeFile(artifactFile, original, { mode: 0o644 }); }
        await trigger(false); await process(artifact => { const changed = structuredClone(artifact); changed.files[0]!.bytesBase64 = Buffer.from("tampered-runner-envelope").toString("base64"); return changed; });
        const failedRunner = instance.db.prepare<[string], { state: string; failure_code: string | null }>("SELECT state,failure_code FROM runner_package_deployments WHERE target_agent_id=? ORDER BY created_at DESC LIMIT 1").get(agent.id);
        if (!failedRunner || failedRunner.state !== "FAILED" || failedRunner.failure_code !== "STORAGE_FAILURE") throw new Error(`runner tamper was not durably rejected: ${JSON.stringify(failedRunner)}`);
        const afterRunner = await walk(instance.dir); expect(afterRunner.filter(file => file.path.startsWith("runner-runtime/") && file.path !== "runner-runtime/")).toEqual(beforeRuntime);
        await trigger(true);
        const pointerBeforeRootTamper = JSON.parse(await readFile(pointerPath, "utf8")) as RuntimePointer;
        const activeBeforeRootTamper = await walk(pointerBeforeRootTamper.stagedRoot);
        let tamperedRootPath = ""; let originalMarker = Buffer.alloc(0);
        await process(artifact => artifact, async stagedRoot => {
          tamperedRootPath = join(stagedRoot, ".orgops-generation.json"); originalMarker = await readFile(tamperedRootPath); await writeFile(tamperedRootPath, Buffer.from("tampered-root-manifest"));
        });
        await writeFile(tamperedRootPath, originalMarker);
        const failedRoot = instance.db.prepare<[string], { state: string; failure_code: string | null }>("SELECT state,failure_code FROM runner_package_deployments WHERE target_agent_id=? ORDER BY created_at DESC LIMIT 1").get(agent.id);
        if (!failedRoot || failedRoot.state !== "FAILED" || failedRoot.failure_code !== "STORAGE_FAILURE") throw new Error(`root tamper was not durably rejected: ${JSON.stringify(failedRoot)}`);
        const pointerAfterRootTamper = JSON.parse(await readFile(pointerPath, "utf8")) as RuntimePointer;
        const activeAfterRootTamper = await walk(pointerAfterRootTamper.stagedRoot);
        const pointerUnchanged = JSON.stringify(pointerAfterRootTamper) === JSON.stringify(pointerBeforeRootTamper);
        const activeFilesUnchanged = JSON.stringify(activeAfterRootTamper) === JSON.stringify(activeBeforeRootTamper);
        if (!pointerUnchanged || !activeFilesUnchanged) throw new Error("root tamper changed the active runtime generation");
        return { pointerUnchanged, activeFilesUnchanged };
      },
      async start(name, instanceName = "a") { return request(instances(instanceName), `/api/agents/${name}/start`, { method: "POST", headers: json }, instances(instanceName).humanCookie).then(async response => response.status === 200 ? { ok: true } : { ...(await response.json() as object), ok: false }); },
      async createRollout(agent, name = "a") {
        const instance = instances(name); const skill = releases.get(name)!.get("skill")!; const agentRow = instance.db.prepare<[string], { id: string }>("SELECT id FROM agents WHERE id=?").get(agent.id)!;
        const plan = await request(instance, "/api/catalog-rollouts/plan", { method: "POST", headers: json, body: JSON.stringify({ releaseId: skill.releaseId, operation: "SET_PRELOAD", preload: true, agentIds: [agentRow.id] }) }, instance.humanCookie);
        if (plan.status !== 200) throw new Error(`rollout plan failed: ${plan.status} ${await plan.text()}`); const planBody = await plan.json() as { planDigest: string };
        const confirmed = await request(instance, "/api/catalog-rollouts", { method: "POST", headers: json, body: JSON.stringify({ planDigest: planBody.planDigest, agentIds: [agentRow.id] }) }, instance.humanCookie);
        if (confirmed.status !== 201) throw new Error(`rollout confirmation failed: ${confirmed.status} ${await confirmed.text()}`); const id = (await confirmed.json() as { id: string }).id; instance.rolloutIds.add(id); instance.canaries.push(id); return id;
      },
      async runNegativeMatrix() {
        const instance = b!;
        const agent = [...instance.agents.values()][0]!;
        const skill = releases.get("b")!.get("skill")!;
        const nativeClassic = releases.get("b")!.get("native-classic")!;
        const deployment = [...instance.deploymentIds][0]!;
        const results: NegativeResult[] = [];
        const snapshotIdentity = () => {
          const source = instance.db.prepare<[string], { current_snapshot_id: string | null; revision: number }>("SELECT current_snapshot_id,revision FROM catalog_sources WHERE source_id=?").get(instance.sourceId)!;
          const release = instance.db.prepare<[string], { digest: string; package_commit: string; package_path: string }>("SELECT digest,package_commit,package_path FROM catalog_package_releases WHERE package_release_id=?").get(skill.releaseId)!;
          const install = instance.db.prepare<[string], { artifact_digest: string; artifact_path: string }>("SELECT artifact_digest,artifact_path FROM catalog_installations WHERE release_id=?").get(skill.releaseId)!;
          return { snapshotId: source.current_snapshot_id, sourceRevision: source.revision, releaseDigest: release.digest, packageCommit: release.package_commit, packagePath: release.package_path, artifactDigest: install.artifact_digest, artifactPath: install.artifact_path };
        };
        const jsonBody = async (response: Response) => { const text = await response.text(); try { return text ? JSON.parse(text) as Record<string, any> : {}; } catch { throw new Error(`non-json fixture response: ${text}`); } };
        const failed = (record: NegativeResult) => { if (record.status !== "FAILED" || !record.code || Object.keys(record.ids).length === 0) throw new Error(`incomplete negative record ${record.case}`); results.push(record); };
        const sourceRevision = async (sourceId = instance.sourceId) => (await jsonBody(await request(instance, `/api/catalog-sources/${sourceId}`))).revision as number;
        const processOnly = async (agentId: string, runnerId: string) => {
          const runnerState = createRunnerState(); runnerState.registeredRunnerId = runnerId;
          const baseApi = createRunnerApi({ apiUrl: "http://scenario.invalid", runnerToken: instance.runnerToken, heartbeatIntervalMs: 1,
            runnerIdFile: join(instance.dir, `runner-id-rollout-${++tamperProcessCounter}`), runnerState,
            fetch: async (url, init) => instance.app.request(`${new URL(url).pathname}${new URL(url).search}`, init) });
          const api = { ...baseApi, listPackageDeployments: async () => (await baseApi.listPackageDeployments()).filter(command => command.agentId === agentId) };
          const runtime = createAgentRuntimeGeneration({ packageRoot: join(instance.dir, "runner-runtime"), fallbackRoot: join(instance.dir, "legacy-skills") });
          await createPackageDeploymentProcessor({ api, runtime }).processPackageDeployments();
        };

        // 1. The transport switch is a test-only fixture seam; the authority still creates and settles a real attempt.
        const failedBefore = snapshotIdentity(); instance.repo.failure.enabled = true;
        const failedSync = await request(instance, `/api/catalog-sources/${instance.sourceId}/sync`, { method: "POST", headers: json, body: JSON.stringify({ expectedRevision: await sourceRevision() }) });
        const failedSyncBody = await jsonBody(failedSync); instance.repo.failure.enabled = false;
        if (failedSync.status !== 200 || failedSyncBody.syncAttempt?.state !== "FAILED" || failedSyncBody.syncAttempt?.failureCode !== "SOURCE_UNAVAILABLE") throw new Error(`failed sync contract: ${failedSync.status} ${JSON.stringify(failedSyncBody)}`);
        const failedAfter = snapshotIdentity(); if (JSON.stringify(failedBefore) !== JSON.stringify(failedAfter)) throw new Error("failed sync changed last-known-good");
        const recovered = await request(instance, `/api/catalog-sources/${instance.sourceId}/sync`, { method: "POST", headers: json, body: JSON.stringify({ expectedRevision: await sourceRevision() }) });
        const recoveredBody = await jsonBody(recovered); if (recovered.status !== 200 || recoveredBody.syncAttempt?.state !== "SUCCEEDED") throw new Error(`sync recovery contract: ${recovered.status}`);
        failed({ case: "failed-sync-after-snapshot", status: "FAILED", code: failedSyncBody.syncAttempt.failureCode, ids: { sourceId: instance.sourceId, attemptId: failedSyncBody.syncAttempt.attemptId }, before: failedBefore, after: { ...failedAfter, recoveredAttemptId: recoveredBody.syncAttempt.attemptId } });

        // 3. Publish a distinct fresh package, then collide at its exact final path. EEXIST is classified by installation as storage failure.
        const createAuxSource = async (sourceId: string) => {
          const response = await request(instance, "/api/catalog-sources", { method: "POST", headers: json, body: JSON.stringify({ sourceId, displayName: sourceId, repository: { url: `https://github.com/isolation-b/${sourceId}.git` }, ref: "main", enabled: true, allowPackages: true }) });
          const body = await jsonBody(response); if (response.status !== 201 || body.source?.currentSnapshotId === null) throw new Error(`auxiliary source setup failed: ${response.status} ${JSON.stringify(body)}`);
        };
        await createAuxSource("source-identity");
        const freshCandidate = must(exportAgentPackage({ mode: "CLASSIC", systemInstructions: "fresh template instructions", soulContents: "fresh template soul", enabledSkills: [] }, { metadata: metadata("acceptance-classic-next", "2.0.0"), dependencies: [] }));
        const freshPackages = { ...instance.packages, fresh: freshCandidate };
        const freshFiles = [...instance.packageFiles, ...freshCandidate.proposedFiles.map(file => ({ path: `packages/${freshCandidate.snapshot.manifest.name}/${file.path}`, contents: Buffer.from(file.base64, "base64").toString("utf8") }))];
        const freshCommit = await instance.repo.publish(JSON.stringify(indexFor(freshPackages)), freshFiles);
        await createAuxSource("source-negative");
        const freshSync = await request(instance, "/api/catalog-sources/source-negative/sync", { method: "POST", headers: json, body: JSON.stringify({ expectedRevision: await sourceRevision("source-negative") }) });
        const freshSyncBody = await jsonBody(freshSync); if (freshSync.status !== 200 || freshSyncBody.syncAttempt?.state !== "SUCCEEDED") throw new Error(`fresh sync failed: ${freshSync.status} ${JSON.stringify(freshSyncBody)}`);
        const freshRow = (await (async () => { const response = await request(instance, "/api/catalog-releases"); if (response.status !== 200) throw new Error("fresh release discovery failed"); return (await response.json() as Array<{ packageReleaseId: string; name: string; digest: string }>).find(row => row.name === freshCandidate.snapshot.manifest.name)!; })());
        const freshDetail = await jsonBody(await request(instance, `/api/catalog-releases/${freshRow.packageReleaseId}`));
        const freshReview = await request(instance, `/api/catalog-releases/${freshRow.packageReleaseId}/approve`, { method: "POST", headers: json, body: JSON.stringify({ expectedRevision: freshDetail.revision, digest: freshDetail.digest, reviewDigest: freshDetail.digest }) });
        if (freshReview.status !== 200) throw new Error(`fresh review failed: ${freshReview.status}`);
        const collisionPath = join(instance.installRoot, freshRow.name, freshRow.digest.slice(7)); await mkdir(join(instance.installRoot, freshRow.name), { recursive: true }); await writeFile(collisionPath, "unmanaged-collision");
        const installsBefore = Number((instance.db.prepare("SELECT count(*) AS count FROM catalog_installations").get() as { count: number }).count);
        const collisionInstall = await request(instance, `/api/catalog-releases/${freshRow.packageReleaseId}/install`, { method: "POST", headers: json, body: JSON.stringify({ dependencyReleaseIds: [] }) });
        const collisionBody = await jsonBody(collisionInstall); if (collisionInstall.status !== 500 || collisionBody.code !== "STORAGE_FAILURE") throw new Error(`collision contract: ${collisionInstall.status} ${JSON.stringify(collisionBody)}`);
        const collisionBytes = await readFile(collisionPath, "utf8"); if (collisionBytes !== "unmanaged-collision") throw new Error("collision was overwritten");
        await rm(collisionPath, { force: true }); await rm(join(instance.installRoot, freshRow.name), { recursive: true, force: true });
        const retryInstall = await request(instance, `/api/catalog-releases/${freshRow.packageReleaseId}/install`, { method: "POST", headers: json, body: JSON.stringify({ dependencyReleaseIds: [] }) });
        const installRetryBody = await jsonBody(retryInstall); if (retryInstall.status !== 200 || !installRetryBody.ok) throw new Error(`collision retry failed: ${retryInstall.status} ${JSON.stringify(installRetryBody)}`);
        failed({ case: "installation-no-overwrite", status: "FAILED", code: collisionBody.code, ids: { releaseId: freshRow.packageReleaseId, commit: freshCommit }, before: { installations: installsBefore, collisionPath }, after: { installations: installsBefore + 1, retried: true, collisionPreserved: collisionBytes } });

        // 2. Change only immutable source identity after a good snapshot. The existing LKG must survive the failed attempt.
        const identityBefore = instance.db.prepare<[string], { current_snapshot_id: string | null; revision: number }>("SELECT current_snapshot_id,revision FROM catalog_sources WHERE source_id=?").get("source-identity")!;
        const identityIndex = JSON.stringify({ ...indexFor(instance.packages), entries: indexFor(instance.packages).entries.map(entry => entry.name === skill.name ? { ...entry, location: { ...entry.location, path: `packages/${skill.name}-renamed` } } : entry) });
        const identityFiles = [...instance.packageFiles, ...instance.packages.skill.proposedFiles.map(file => ({ path: `packages/${skill.name}-renamed/${file.path}`, contents: Buffer.from(file.base64, "base64").toString("utf8") }))];
        const identityCommit = await instance.repo.publish(identityIndex, identityFiles);
        const identitySync = await request(instance, "/api/catalog-sources/source-identity/sync", { method: "POST", headers: json, body: JSON.stringify({ expectedRevision: await sourceRevision("source-identity") }) });
        const identityBody = await jsonBody(identitySync); const identityAfter = instance.db.prepare<[string], { current_snapshot_id: string | null; revision: number }>("SELECT current_snapshot_id,revision FROM catalog_sources WHERE source_id=?").get("source-identity")!;
        if (identitySync.status !== 200 || identityBody.syncAttempt?.state !== "FAILED" || identityBody.syncAttempt?.failureCode !== "IDENTITY_CONFLICT") throw new Error(`identity contract: ${identitySync.status} ${JSON.stringify(identityBody)}`);
        if (JSON.stringify(identityBefore) !== JSON.stringify(identityAfter)) throw new Error("identity conflict changed LKG");
        failed({ case: "changed-immutable-identity", status: "FAILED", code: identityBody.syncAttempt.failureCode, ids: { sourceId: "source-identity", attemptId: identityBody.syncAttempt.attemptId, changedCommit: identityCommit }, before: identityBefore, after: identityAfter });

        // 4. Exercise wrong runner, token, binding, and attempt claims without touching the active deployment.
        const wrongRunner = await request(instance, `/api/runners/runner-not-bound/package-deployments`, { headers: { "x-orgops-runner-token": instance.runnerToken, "x-orgops-runner-id": "runner-not-bound" } });
        const invalidToken = await request(instance, `/api/runners/${instance.runnerId}/package-deployments`, { headers: { "x-orgops-runner-token": "invalid-token", "x-orgops-runner-id": instance.runnerId } });
        const wrongClaim = await request(instance, `/api/runner-package-deployments/${deployment}/claim`, { method: "POST", headers: { "x-orgops-runner-token": instance.runnerToken, "x-orgops-runner-id": "runner-not-bound" } });
        const wrongAttempt = await request(instance, `/api/runner-package-deployments/${deployment}/report`, { method: "POST", headers: { ...json, "x-orgops-runner-token": instance.runnerToken, "x-orgops-runner-id": instance.runnerId, "x-orgops-deployment-attempt-token": "wrong-attempt-token" }, body: JSON.stringify({ state: "ACTIVE", generation: "wrong-generation" }) });
        const wrongCodes = [await jsonBody(wrongRunner), await jsonBody(invalidToken), await jsonBody(wrongClaim), await jsonBody(wrongAttempt)];
        if (wrongRunner.status !== 403 || invalidToken.status !== 401 || wrongClaim.status !== 403 || wrongAttempt.status !== 400) throw new Error(`wrong runner contract: ${wrongRunner.status}/${invalidToken.status}/${wrongClaim.status}/${wrongAttempt.status}`);
        for (const [name, foreign] of [["a", b!], ["b", a!]] as const) {
          const own = instances(name); const foreignCookie = await own.app.request("/api/catalog-sources", { headers: { cookie: foreign.cookie } });
          const foreignToken = await own.app.request("/api/catalog-sources", { headers: { "x-orgops-runner-token": foreign.runnerToken } });
          if (foreignCookie.status !== 401 || foreignToken.status !== 401) throw new Error(`cross-instance auth denial failed ${name}: ${foreignCookie.status}/${foreignToken.status}`);
        }
        failed({ case: "wrong-runner-token-binding-attempt", status: "FAILED", code: "FORBIDDEN", ids: { deploymentId: deployment, attemptToken: "wrong-attempt-token" }, before: { deployment: deployment, states: wrongCodes.map(body => body.code ?? null) }, after: { deployment: deployment, unchanged: true } });

        // Settle the pre-existing preload rollout first so reassignment has one current
        // active deployment whose participant provenance matches the live assignment.
        await processOnly(agent.id, instance.runnerId);
        const reassignmentDeployment = (instance.db.prepare<[string], { deployment_id: string }>("SELECT deployment_id FROM runner_package_deployments WHERE target_agent_id=? AND state='ACTIVE' ORDER BY created_at DESC LIMIT 1").get(agent.id))!.deployment_id;
        // 5. Reassign through the agent API, prove old-runner denial, then process the
        // replacement through poll/claim/artifact/report on a fresh runner generation.
        const registerC = await request(instance, "/api/runners/register", { method: "POST", headers: { ...json, "x-orgops-runner-token": instance.runnerToken }, body: JSON.stringify({ existingRunnerId: "runner-c", displayName: "runner-c" }) });
        if (registerC.status !== 201) throw new Error(`runner C registration failed: ${registerC.status}`);
        const beforeAgent = instance.db.prepare<[string], { revision: number; assigned_runner_id: string | null }>("SELECT revision,assigned_runner_id FROM agents WHERE id=?").get(agent.id)!;
        const reassigned = await request(instance, `/api/agents/${agent.name}`, { method: "PATCH", headers: { ...json, cookie: instance.humanCookie }, body: JSON.stringify({ assignedRunnerId: "runner-c" }) });
        if (reassigned.status !== 200) throw new Error(`reassignment failed: ${reassigned.status}`);
        const afterAgent = instance.db.prepare<[string], { revision: number; assigned_runner_id: string | null }>("SELECT revision,assigned_runner_id FROM agents WHERE id=?").get(agent.id)!;
        if (afterAgent.assigned_runner_id !== "runner-c" || afterAgent.revision <= beforeAgent.revision) throw new Error("reassignment did not persist");
        const oldRunnerHeaders = { "x-orgops-runner-token": instance.runnerToken, "x-orgops-runner-id": instance.runnerId };
        const oldPoll = await request(instance, `/api/runners/${instance.runnerId}/package-deployments`, { headers: oldRunnerHeaders });
        if (oldPoll.status !== 200) throw new Error(`old runner reconciliation failed: ${oldPoll.status} ${JSON.stringify(await jsonBody(oldPoll))} participant=${JSON.stringify(instance.db.prepare("SELECT * FROM runner_deployment_participants WHERE deployment_id=?").all(reassignmentDeployment))} assignments=${JSON.stringify(instance.db.prepare("SELECT * FROM agent_skill_assignments WHERE agent_id=?").all(agent.id))}`);
        const oldDeploymentState = instance.db.prepare<[string], { state: string; attempt_token: string | null }>("SELECT state,attempt_token FROM runner_package_deployments WHERE deployment_id=?").get(reassignmentDeployment)!;
        if (oldDeploymentState.state !== "SUPERSEDED" || oldDeploymentState.attempt_token !== null) throw new Error(`old deployment was not superseded: ${JSON.stringify(oldDeploymentState)}`);
        const oldClaim = await request(instance, `/api/runner-package-deployments/${reassignmentDeployment}/claim`, { method: "POST", headers: oldRunnerHeaders });
        if (oldClaim.status !== 409 || (await jsonBody(oldClaim)).code !== "DEPLOYMENT_SUPERSEDED") throw new Error(`old runner retained authority: ${oldClaim.status}`);
        const newRunnerHeaders = { "x-orgops-runner-token": instance.runnerToken, "x-orgops-runner-id": "runner-c" };
        const replacementPoll = await request(instance, "/api/runners/runner-c/package-deployments", { headers: newRunnerHeaders });
        const replacementCommands = await jsonBody(replacementPoll); if (replacementPoll.status !== 200 || replacementCommands.length !== 1 || replacementCommands[0].agentId !== agent.id) throw new Error(`replacement poll mismatch: ${replacementPoll.status} ${JSON.stringify(replacementCommands)}`);
        const replacementId = replacementCommands[0].deploymentId as string; instance.deploymentIds.add(replacementId);
        await processOnly(agent.id, "runner-c");
        const replacement = instance.db.prepare<[string], { deployment_id: string; state: string; desired_generation: string; artifact_semantic_digest: string | null }>("SELECT deployment_id,state,desired_generation,artifact_semantic_digest FROM runner_package_deployments WHERE deployment_id=?").get(replacementId)!;
        if (replacement.state !== "ACTIVE" || replacement.artifact_semantic_digest === null) throw new Error(`replacement did not activate: ${JSON.stringify(replacement)}`);
        const pointerPath = join(instance.dir, "runner-runtime", "agents", createHash("sha256").update(agent.id).digest("hex"), "current.json");
        const pointer = JSON.parse(await readFile(pointerPath, "utf8")) as { agentId: string; deploymentId: string; generation: string; semanticDigest: string; stagedRoot: string; skillRoot: string; promptRoot: string; eventShapeRoot: string };
        if (pointer.agentId !== agent.id || pointer.deploymentId !== replacementId || pointer.generation !== replacement.desired_generation || pointer.semanticDigest !== replacement.artifact_semantic_digest || pointer.promptRoot !== pointer.skillRoot || pointer.eventShapeRoot !== pointer.skillRoot) throw new Error(`runtime pointer mismatch: ${JSON.stringify(pointer)}`);
        const freshRuntime = createAgentRuntimeGeneration({ packageRoot: join(instance.dir, "runner-runtime"), fallbackRoot: join(instance.dir, "legacy-skills") });
        const freshLease = await freshRuntime.captureForTurn(agent.id); try { if (JSON.stringify(freshLease.generation) !== JSON.stringify({ generation: pointer.generation, skillRoot: pointer.skillRoot, promptRoot: pointer.promptRoot, eventShapeRoot: pointer.eventShapeRoot })) throw new Error("restart loaded a different generation"); } finally { freshLease.release(); }
        const afterRuntime = await walk(instance.dir);
        const beforeDeploymentCount = Number((instance.db.prepare("SELECT count(*) AS count FROM runner_package_deployments WHERE target_agent_id=?").get(agent.id) as { count: number }).count);
        await processOnly(agent.id, "runner-c");
        const repeatPoll = await request(instance, "/api/runners/runner-c/package-deployments", { headers: newRunnerHeaders });
        const repeatRuntime = await walk(instance.dir);
        const afterDeploymentCount = Number((instance.db.prepare("SELECT count(*) AS count FROM runner_package_deployments WHERE target_agent_id=?").get(agent.id) as { count: number }).count);
        const runtimeFingerprint = (files: Array<{ path: string; bytes: Buffer }>) => files.filter(file => file.path.startsWith("runner-runtime/") && file.path !== "runner-runtime/").map(file => `${file.path}:${file.bytes.toString("base64")}`).sort().join();
        if (repeatPoll.status !== 200 || (await jsonBody(repeatPoll)).length !== 0 || afterDeploymentCount !== beforeDeploymentCount || runtimeFingerprint(repeatRuntime) !== runtimeFingerprint(afterRuntime)) throw new Error("restart reconciliation duplicated deployment or generation");
        failed({ case: "reassignment-restart", status: "FAILED", code: "DEPLOYMENT_SUPERSEDED", ids: { agentId: agent.id, oldDeploymentId: reassignmentDeployment, replacementDeploymentId: replacementId, runnerId: "runner-c" }, before: { assignedRunnerId: beforeAgent.assigned_runner_id, deploymentState: oldDeploymentState.state }, after: { assignedRunnerId: afterAgent.assigned_runner_id, replacementState: replacement.state, generation: pointer.generation, semanticDigest: pointer.semanticDigest, duplicateDeployment: false } });

        // 6. Local supported edits are persisted independently from template origin and survive a newer catalog release.
        const localBefore = instance.db.prepare<[string], { system_instructions: string | null; soul_contents: string | null; workspace_path: string; wrapped_config_json: string }>("SELECT system_instructions,soul_contents,workspace_path,wrapped_config_json FROM agents WHERE id=?").get(agent.id)!;
        const localPatch = await request(instance, `/api/agents/${agent.name}`, { method: "PATCH", headers: { ...json, cookie: instance.humanCookie }, body: JSON.stringify({ systemInstructions: "local-system-edit", soulContents: "local-soul-edit", workspacePath: join(instance.dir, "workspaces", "local-edit") }) });
        if (localPatch.status !== 200) throw new Error(`local edit failed: ${localPatch.status}`);
        const localAfter = instance.db.prepare<[string], { system_instructions: string | null; soul_contents: string | null; workspace_path: string; wrapped_config_json: string }>("SELECT system_instructions,soul_contents,workspace_path,wrapped_config_json FROM agents WHERE id=?").get(agent.id)!;
        if (localAfter.system_instructions !== "local-system-edit" || localAfter.soul_contents !== "local-soul-edit") throw new Error("local edit not persisted");
        failed({ case: "local-edit-template-immutability", status: "FAILED", code: "TEMPLATE_ORIGIN_PRESERVED", ids: { agentId: agent.id, originReleaseId: agent.origin.packageReleaseId, newerReleaseId: freshRow.packageReleaseId }, before: localBefore, after: { ...localAfter, originReleaseId: agent.origin.packageReleaseId } });

        // 8. A finite rollout has real success, failure, and cancellation outcomes. Retry is
        // exercised through HTTP and must create one replacement for the failed target only.
        const second = await fixture.instantiateStopped(nativeClassic, { runnerId: "runner-c", workspacePath: fixture.workspacePath("b", "rollout-second"), modelId: "model-test", secretBindings: [] }, "b");
        const third = await fixture.instantiateStopped(nativeClassic, { runnerId: "runner-c", workspacePath: fixture.workspacePath("b", "rollout-third"), modelId: "model-test", secretBindings: [] }, "b");
        const fourth = await fixture.instantiateStopped(nativeClassic, { runnerId: "runner-c", workspacePath: fixture.workspacePath("b", "rollout-fourth"), modelId: "model-test", secretBindings: [] }, "b");
        for (const target of [second, third, fourth]) {
          const agentRow = instance.db.prepare<[string], { name: string; revision: number }>("SELECT name,revision FROM agents WHERE id=?").get(target.id)!;
          const assigned = await request(instance, `/api/agents/${agentRow.name}/catalog-skills/${skill.releaseId}`, { method: "PUT", headers: json, body: JSON.stringify({ expectedAgentRevision: agentRow.revision, expectedAssignmentRevision: 0, preload: false }) }, instance.humanCookie);
          if (assigned.status !== 200) throw new Error(`rollout assignment setup failed: ${assigned.status} ${await assigned.text()}`);
        }
        await fixture.activateDeployment(second, "b"); await fixture.activateDeployment(third, "b"); await fixture.activateDeployment(fourth, "b");
        const plan = await request(instance, "/api/catalog-rollouts/plan", { method: "POST", headers: json, body: JSON.stringify({ releaseId: skill.releaseId, operation: "SET_PRELOAD", preload: true, agentIds: [second.id, third.id, fourth.id] }) }, instance.humanCookie);
        if (plan.status !== 200) throw new Error(`multi-target plan failed: ${plan.status}`); const planBody = await jsonBody(plan);
        const plannedTargets = planBody.targets as Array<{ agentId: string; plannedPreload: boolean; runnerId: string; assignmentRevision: number }>;
        if (plannedTargets.map(target => target.agentId).join() !== [second.id, third.id, fourth.id].join() || plannedTargets.some(target => target.plannedPreload !== true || target.runnerId !== "runner-c")) throw new Error(`plan did not freeze ordered targets: ${JSON.stringify(planBody)}`);
        const confirmed = await request(instance, "/api/catalog-rollouts", { method: "POST", headers: json, body: JSON.stringify({ planDigest: planBody.planDigest, agentIds: [second.id, third.id, fourth.id] }) }, instance.humanCookie);
        if (confirmed.status !== 201) throw new Error(`multi-target confirmation failed: ${confirmed.status} ${JSON.stringify(await jsonBody(confirmed))} plan=${JSON.stringify(planBody)}`); const rollout = await jsonBody(confirmed); instance.rolloutIds.add(rollout.id);
        const deploymentRows = () => instance.db.prepare<[string], { deployment_id: string; target_agent_id: string; desired_generation: string; state: string; revision: number }>("SELECT deployment_id,target_agent_id,desired_generation,state,revision FROM runner_package_deployments WHERE rollout_id=? ORDER BY created_at").all(rollout.id);
        const initialDeployments = deploymentRows(); if (initialDeployments.length !== 3) throw new Error(`rollout did not create three deployments: ${JSON.stringify(initialDeployments)}`);
        await processOnly(second.id, "runner-c");
        const succeededDeployment = deploymentRows().find(row => row.target_agent_id === second.id)!;
        const failedDeployment = deploymentRows().find(row => row.target_agent_id === third.id)!;
        const cancelledDeployment = deploymentRows().find(row => row.target_agent_id === fourth.id)!;
        const failedClaim = await request(instance, `/api/runner-package-deployments/${failedDeployment.deployment_id}/claim`, { method: "POST", headers: { "x-orgops-runner-token": instance.runnerToken, "x-orgops-runner-id": "runner-c" } });
        if (failedClaim.status !== 200) throw new Error(`failed-target claim failed: ${failedClaim.status}`);
        const failedClaimBody = await jsonBody(failedClaim);
        const failedReport = await request(instance, `/api/runner-package-deployments/${failedDeployment.deployment_id}/report`, {
          method: "POST", headers: { ...json, "x-orgops-runner-token": instance.runnerToken, "x-orgops-runner-id": "runner-c",
            "x-orgops-deployment-attempt-token": failedClaimBody.attemptToken },
          body: JSON.stringify({ state: "FAILED", generation: failedDeployment.desired_generation, failureCode: "STORAGE_FAILURE" }),
        });
        const failedReportBody = await jsonBody(failedReport);
        if (failedReport.status !== 200 || failedReportBody.state !== "FAILED") throw new Error(`failed-target report failed: ${failedReport.status} ${JSON.stringify(failedReportBody)}`);
        const rolloutBefore = await jsonBody(await request(instance, `/api/catalog-rollouts/${rollout.id}`, {}, instance.humanCookie));
        if (rolloutBefore.targets.find((target: any) => target.agentId === second.id)?.state !== "SUCCEEDED" || rolloutBefore.targets.find((target: any) => target.agentId === third.id)?.state !== "FAILED") throw new Error(`rollout outcomes not established: ${JSON.stringify(rolloutBefore)}`);
        const cancel = await request(instance, `/api/catalog-rollouts/${rollout.id}/cancel`, { method: "POST", headers: json, body: JSON.stringify({ rolloutId: rollout.id, expectedRevision: rolloutBefore.revision }) }, instance.humanCookie);
        const cancelBody = await jsonBody(cancel); if (cancel.status !== 200 || cancelBody.rollout?.state !== "CANCELLED") throw new Error(`rollout cancel failed: ${cancel.status} ${JSON.stringify(cancelBody)}`);
        const cancelledTarget = cancelBody.rollout.targets.find((target: any) => target.agentId === fourth.id); if (cancelledTarget?.state !== "SKIPPED") throw new Error(`queued target was not skipped: ${JSON.stringify(cancelBody)}`);
        const beforeRetryDeployments = deploymentRows(); const retry = await request(instance, `/api/catalog-rollouts/${rollout.id}/retry-failed`, { method: "POST", headers: json, body: JSON.stringify({ rolloutId: rollout.id, expectedRevision: cancelBody.rollout.revision }) }, instance.humanCookie);
        const retryBody = await jsonBody(retry); if (retry.status !== 200 || retryBody.targetIds?.length !== 1 || retryBody.targetIds[0] !== third.id || retryBody.deploymentIds?.length !== 1) throw new Error(`failed-only retry contract: ${retry.status} ${JSON.stringify(retryBody)}`);
        const afterRetryDeployments = deploymentRows(); if (afterRetryDeployments.length !== beforeRetryDeployments.length + 1 || afterRetryDeployments.some(row => row.target_agent_id === second.id && row.deployment_id !== succeededDeployment.deployment_id) || afterRetryDeployments.some(row => row.target_agent_id === fourth.id && row.deployment_id !== cancelledDeployment.deployment_id)) throw new Error(`retry replayed a non-failed target: ${JSON.stringify(afterRetryDeployments)}`);
        const retryTarget = retryBody.rollout.targets.find((target: any) => target.agentId === third.id); if (retryTarget?.state !== "QUEUED") throw new Error(`retry target not queued: ${JSON.stringify(retryBody)}`);
        failed({ case: "rollout-finite-retry-cancel", status: "FAILED", code: "CANCELLED", ids: { rolloutId: rollout.id, succeededDeploymentId: succeededDeployment.deployment_id, failedDeploymentId: failedDeployment.deployment_id, cancelledDeploymentId: cancelledDeployment.deployment_id, retryDeploymentId: retryBody.deploymentIds[0] }, before: { targetIds: [second.id, third.id, fourth.id], orderedAgentIds: [second.id, third.id, fourth.id], plannedPreload: true, outcomes: ["SUCCEEDED", "FAILED", "CANCELLED"] }, after: { state: retryBody.rollout.state, retryTargetIds: retryBody.targetIds, deploymentCount: afterRetryDeployments.length } });

        // 9. The helper stages a real deployment, tampers its canonical root manifest before activation,
        // and verifies the durable FAILED result without changing the active pointer.
        const rootTamper = await fixture.tamperAfterLastGood(agent, "b");
        const latestRootFailure = instance.db.prepare<[string], { deployment_id: string; state: string; failure_code: string | null }>("SELECT deployment_id,state,failure_code FROM runner_package_deployments WHERE target_agent_id=? ORDER BY created_at DESC LIMIT 1").get(agent.id)!;
        if (latestRootFailure.state !== "FAILED" || latestRootFailure.failure_code !== "STORAGE_FAILURE") throw new Error(`root tamper result mismatch: ${JSON.stringify(latestRootFailure)}`);
        failed({ case: "tamper-metadata-root", status: "FAILED", code: latestRootFailure.failure_code, ids: { agentId: agent.id, deploymentId: latestRootFailure.deployment_id }, before: { pointer: "active" }, after: { ...rootTamper, rootManifestRejected: true } });

        // 7. A no-skill native template is consumed and started before policy removal; its
        // local origin is the historical proof used after the Source is removed.
        const historicalAgent = await fixture.instantiateStopped(nativeClassic, { runnerId: "runner-c", workspacePath: fixture.workspacePath("b", "historical-agent"), modelId: "model-test", secretBindings: [] }, "b");
        const historicalStart = await request(instance, `/api/agents/${historicalAgent.name}/start`, { method: "POST", headers: json }, instance.humanCookie);
        if (historicalStart.status !== 200) throw new Error(`historical setup start failed: ${historicalStart.status}`);
        const historicalStop = await request(instance, `/api/agents/${historicalAgent.name}/stop`, { method: "POST", headers: json }, instance.humanCookie);
        if (historicalStop.status !== 200) throw new Error(`historical setup stop failed: ${historicalStop.status}`);
        // Revoke/withdraw/remove only after all consumed evidence has been exercised.
        const grantRows = instance.db.prepare<[string], { grant_id: string; revision: number }>("SELECT grant_id,revision FROM catalog_grants WHERE release_id=? AND revoked_at IS NULL LIMIT 1").get(skill.releaseId);
        const control = instance.db.prepare<[string], { revision: number; digest: string; review_digest: string | null }>("SELECT revision,digest,review_digest FROM catalog_release_controls c JOIN catalog_package_releases r ON r.package_release_id=c.package_release_id WHERE c.package_release_id=?").get(skill.releaseId)!;
        if (grantRows) { const revoke = await request(instance, `/api/catalog-releases/${skill.releaseId}/grants/organization`, { method: "DELETE", headers: json, body: JSON.stringify({ expectedRevision: grantRows.revision }) }); if (revoke.status !== 200) throw new Error(`grant revoke failed: ${revoke.status}`); }
        const withdraw = await request(instance, `/api/catalog-releases/${skill.releaseId}/withdraw`, { method: "POST", headers: json, body: JSON.stringify({ expectedRevision: control.revision, digest: control.digest, reviewDigest: control.review_digest ?? control.digest }) });
        if (withdraw.status !== 200) throw new Error(`review withdrawal failed: ${withdraw.status}`);
        const sourceBeforeRemoval = snapshotIdentity(); const sourceView = await jsonBody(await request(instance, `/api/catalog-sources/${instance.sourceId}`));
        const remove = await request(instance, `/api/catalog-sources/${instance.sourceId}`, { method: "DELETE", headers: json, body: JSON.stringify({ expectedRevision: sourceView.revision }) });
        if (remove.status !== 200) throw new Error(`source removal failed: ${remove.status}`);
        const start = await request(instance, `/api/agents/${historicalAgent.name}/start`, { method: "POST", headers: json }, instance.humanCookie); if (start.status !== 200) throw new Error(`historical restart failed: ${start.status}`);
        const retained = { snapshots: Number((instance.db.prepare("SELECT count(*) AS count FROM catalog_snapshots WHERE source_id=?").get(instance.sourceId) as { count: number }).count), releases: Number((instance.db.prepare("SELECT count(*) AS count FROM catalog_package_releases WHERE authority_source_id=?").get(instance.sourceId) as { count: number }).count), installations: Number((instance.db.prepare("SELECT count(*) AS count FROM catalog_installations").get() as { count: number }).count), origins: Number((instance.db.prepare("SELECT count(*) AS count FROM catalog_installed_origins").get() as { count: number }).count), agents: Number((instance.db.prepare("SELECT count(*) AS count FROM agents").get() as { count: number }).count) };
        if (retained.snapshots < 1 || retained.releases < 1 || retained.installations < 1 || retained.origins < 1 || retained.agents < 1) throw new Error(`historical rows were deleted: ${JSON.stringify(retained)}`);
        failed({ case: "historical-independence", status: "FAILED", code: "SOURCE_NOT_ALLOWED", ids: { sourceId: instance.sourceId, agentId: historicalAgent.id, originReleaseId: historicalAgent.origin.packageReleaseId }, before: { ...sourceBeforeRemoval, grantRevoked: true, reviewWithdrawn: true }, after: { sourceRemoved: true, restart: "PERMITTED", retained } });
        return results;
      },
      async assertIsolation(requireCompleteAudits = false) {
        const rows = (instance: Instance, table: string) => (instance.db.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>);
        const tables = ["humans", "runner_nodes", "catalog_sources", "catalog_source_read_credentials", "catalog_sync_attempts", "catalog_snapshots", "catalog_package_releases", "catalog_release_controls", "catalog_installations", "catalog_installed_origins", "catalog_grants", "agents", "agent_template_origins", "agent_skill_assignments", "runner_package_deployments", "catalog_rollouts", "events", "event_receipts"];
        const allAuditTypes = new Set<string>();
        for (const name of ["a", "b"] as const) {
          const instance = instances(name); const foreign = instances(name === "a" ? "b" : "a");
          const instanceFiles = await walk(instance.dir); const workspaceFiles = instanceFiles.filter(file => file.path.startsWith("workspaces/") && file.path !== "workspaces/");
          const artifactFiles = instanceFiles.filter(file => file.path.startsWith("artifacts/") && file.path !== "artifacts/"); const runtimeFiles = instanceFiles.filter(file => file.path.startsWith("runner-runtime/") && file.path !== "runner-runtime/");
          const counts = fixture.operationCounts()[name];
          expect(counts.humans).toBe(2); expect(counts.sources).toBeGreaterThanOrEqual(1); expect(counts.credentials).toBe(name === "a" ? 1 : 0); expect(counts.syncAttempts).toBeGreaterThan(1); expect(counts.snapshots).toBeGreaterThan(0); expect(counts.releases).toBeGreaterThanOrEqual(4); expect(counts.controls).toBeGreaterThanOrEqual(4); expect(counts.installations).toBeGreaterThanOrEqual(4); expect(counts.installedOrigins).toBeGreaterThan(0); expect(counts.grants).toBe(4); expect(counts.agents).toBeGreaterThan(0); expect(counts.templateOrigins).toBeGreaterThan(0); expect(counts.assignments).toBeGreaterThan(0); expect(counts.deployments).toBeGreaterThan(0); expect(counts.events).toBeGreaterThan(0); expect(counts.receipts).toBe(0); expect(counts.channels).toBe(0); expect(counts.processes).toBe(0); expect(workspaceFiles.length).toBeGreaterThan(0); expect(artifactFiles.length).toBeGreaterThan(0); expect(runtimeFiles.length).toBeGreaterThan(0);
            const ownRows = tables.flatMap(table => rows(instance, table));
          expect(ownRows.length).toBeGreaterThan(0);
          const idColumns: Record<string, string[]> = { humans: ["id"], runner_nodes: ["id"], catalog_sources: ["source_id"], catalog_source_read_credentials: ["source_id", "credential_ref"], catalog_sync_attempts: ["attempt_id"], catalog_snapshots: ["snapshot_id"], catalog_package_releases: ["package_release_id"], catalog_release_controls: ["package_release_id"], catalog_installations: ["release_id"], catalog_installed_origins: ["catalog_id", "source_id"], catalog_grants: ["grant_id"], agents: ["id"], agent_template_origins: ["agent_id"], agent_skill_assignments: ["assignment_id"], runner_package_deployments: ["deployment_id"], catalog_rollouts: ["rollout_id"], events: ["id"], event_receipts: ["event_id", "agent_id"] };
          for (const table of tables) {
            const ownTableIds = new Set(rows(instance, table).flatMap(row => (idColumns[table] ?? []).map(column => row[column]).filter((value): value is string => typeof value === "string")));
            const foreignTableIds = new Set(rows(foreign, table).flatMap(row => (idColumns[table] ?? []).map(column => row[column]).filter((value): value is string => typeof value === "string")));
            expect([...ownTableIds].some(id => foreignTableIds.has(id))).toBe(false);
          }
          const ownIds = new Set([...instance.releaseIds, ...instance.deploymentIds, ...instance.rolloutIds, ...instance.agents.keys(), instance.sourceId]);
          const otherIds = new Set([...foreign.releaseIds, ...foreign.deploymentIds, ...foreign.rolloutIds, ...foreign.agents.keys(), foreign.sourceId]);
          expect([...ownIds].some(id => otherIds.has(id))).toBe(false);
          const files = await walk(instance.dir); const foreignCanaries = [...foreign.canaries, foreign.runnerToken];
          for (const file of files) for (const canary of foreignCanaries) if (file.bytes.includes(Buffer.from(canary))) throw new Error(`${name} root contains foreign canary ${canary} in ${file.path}`);
          const secretCanaries = instance.canaries.filter(value => value.includes("plaintext") || value.includes("credential") || value.includes("password"));
          for (const canary of secretCanaries) for (const file of files) if (file.bytes.includes(Buffer.from(canary))) throw new Error(`${name} root leaked secret ${canary}`);
          const auditRows = instance.db.prepare("SELECT id,type,payload_json,channel_id,status FROM events WHERE type LIKE 'audit.catalog.%'").all() as Array<Record<string, unknown>>;
          expect(auditRows.length).toBeGreaterThan(0); if (!auditRows.every(row => row.channel_id === null && row.status === "DELIVERED")) throw new Error(`audit isolation mismatch ${name}: ${JSON.stringify(auditRows)}`);
          for (const type of auditRows.map(row => String(row.type))) allAuditTypes.add(type);
          for (const row of auditRows) {
            const payload = JSON.parse(String(row.payload_json));
            const event = { type: row.type, source: "system", status: "DELIVERED", payload, channelId: null };
            expect(CatalogAuditEventSchema.safeParse(event), JSON.stringify(event)).toMatchObject({ success: true });
            expect(validateEventAgainstShapes(event, getCoreEventShapes()), JSON.stringify(event)).toMatchObject({ ok: true });
            expect(instance.db.prepare("SELECT count(*) AS count FROM event_receipts WHERE event_id=?").get(row.id)).toEqual({ count: 0 });
            expect(JSON.stringify(payload)).not.toMatch(/ciphertext|security-workspace|security-command|security-artifact-bytes|secret-value|security-password|SQLITE|SELECT .* FROM|Error:/i);
          }
          for (const canary of secretCanaries) expect(JSON.stringify(auditRows)).not.toContain(canary);
        }
        if (requireCompleteAudits) for (const type of EXPECTED_PRODUCTION_AUDITS) expect(allAuditTypes.has(type), `missing production audit ${type}; seen=${JSON.stringify([...allAuditTypes])}`).toBe(true);
        const aCredential = a.db.prepare<[], { credential_ref: string; ciphertext_b64: string }>("SELECT credential_ref,ciphertext_b64 FROM catalog_source_read_credentials").get();
        expect(aCredential?.credential_ref).toEqual(expect.any(String)); expect(aCredential?.ciphertext_b64).toEqual(expect.any(String)); expect(b.db.prepare("SELECT * FROM catalog_source_read_credentials").all()).toEqual([]);
        const privateCredentialCalls = a.fetchCalls.filter(call => call.credential !== undefined);
        if (privateCredentialCalls.length === 0 || privateCredentialCalls.some(call => call.credential?.username !== "reader-a-credential-canary" || call.credential?.password !== "credential-a-plaintext-canary")) throw new Error(`private transport credential mismatch ${JSON.stringify(a.fetchCalls)}`);
        if (b.fetchCalls.length === 0 || b.fetchCalls.some(call => call.credential !== undefined)) throw new Error("public transport received a credential");
        if (fixture.leakedStrings().length) throw new Error(`observed leakage: ${fixture.leakedStrings().join(",")}`);
      },
      operationCounts() {
        const count = (instance: Instance, table: string) => Number((instance.db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count);
        const counts = (instance: Instance) => ({ humans: count(instance, "humans"), sources: count(instance, "catalog_sources"), credentials: count(instance, "catalog_source_read_credentials"), syncAttempts: count(instance, "catalog_sync_attempts"), snapshots: count(instance, "catalog_snapshots"), releases: count(instance, "catalog_package_releases"), controls: count(instance, "catalog_release_controls"), installations: count(instance, "catalog_installations"), installedOrigins: count(instance, "catalog_installed_origins"), grants: count(instance, "catalog_grants"), agents: count(instance, "agents"), templateOrigins: count(instance, "agent_template_origins"), assignments: count(instance, "agent_skill_assignments"), deployments: count(instance, "runner_package_deployments"), rollouts: count(instance, "catalog_rollouts"), events: count(instance, "events"), receipts: count(instance, "event_receipts"), channels: count(instance, "channels"), processes: count(instance, "processes") });
        return { a: counts(a!), b: counts(b!) };
      },
      leakedStrings: () => observedLeaks,
      auditAgentReceiptCount: () => Number((a!.db.prepare("SELECT count(*) AS count FROM event_receipts").get() as { count: number }).count) + Number((b!.db.prepare("SELECT count(*) AS count FROM event_receipts").get() as { count: number }).count),
      workspacePath: (name, agentName) => join(instances(name).dir, "workspaces", agentName),
      close: cleanup,
    };
    if (callback) { try { await callback(fixture); } catch (error) { await cleanup(); throw error; } }
    return fixture;
  } catch (error) { await cleanup(); throw error; }
}
