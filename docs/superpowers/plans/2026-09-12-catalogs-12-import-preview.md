# Read-Only Catalog Import Preview (Option A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (parent controller only) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Workers must not launch nested agents.

**Goal:** Let an administrator preview, fully read-only, what importing ONE synced catalog-local package `(name, version)` would involve, by composing the existing Phase 10/11 verify-only mirror read path, the configured source/catalog metadata, the injected local skills root under Option A occupancy (every present name `occupied`, no reuse, no origins), and the UNCHANGED pure `prepareImport` — nothing is fetched, installed, activated, persisted or written, and no credential is read.

**Architecture:** `createCatalogSync` gains one read-only method `previewCatalogImport` (same deps object plus a new injected `localSkillsRoot`) that reuses the Phase 11 `browseBase` preconditions for the root catalog, reads the local namespace with the EXISTING `readLocalSkillEvidence` (`nominatedNames: []`, every namespace entry → `{ state: "occupied", name }`), builds `sources`/`catalogs` from existing configuration (only synced catalogs supply an index), inspects catalog-local index entries with the EXISTING `inspectGitPackage` into `SuppliedPackage[]` under fixed count/byte bounds, calls the UNCHANGED `prepareImport`, and returns a bounded, detached, deeply frozen, base64-FREE projection (reject-not-truncate). One admin-only `POST /api/catalogs/:catalogId/import-preview` route is appended to `registerCatalogRoutes` with an apps/api-local zod request schema (no `packages/schemas` addition); `app.ts` gains exactly one wiring line plus a test-only AppConfig seam for the local root. The desktop Catalogs screen gains an inert import-preview section (editable target fields, "Preview import" action, inert result panel) reusing the Phase 5/10/11 auth/race/supersession discipline. No schema, audit, persistence, migration, fetch, credential, installation, activation, publication, mobile or `packages/skills`/`packages/schemas` change.

**Tech Stack:** Existing TypeScript, Hono routes, `better-sqlite3` (unchanged), `@orgops/schemas` primitives, `@orgops/skills` (`prepareImport`, `readLocalSkillEvidence`, `inspectGitPackage`, `IMPORT_LIMITS` and types, unchanged), React admin-ui, colocated Vitest; npm only. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-09-skill-agent-catalogs-design.md`; `docs/SPEC.md` (Phase 10 sync + Phase 11 browsing subsections); `docs/catalog-package-contract.md` (offline import preparation + offline local skill-root evidence); binding `.superpowers/sdd/2026-09-12-catalogs-12-import-preview/controller-brief.md`.

## Global Constraints / Entire Identical Shared Task Prefix

Everything before `### Task 1` is the ENTIRE shared contract and must prefix every task brief byte-for-byte. The installed SDD script extracts only a task body: preserve each raw extraction, then prepend this prefix to a distinct final brief. No shared requirements occur after the task bodies.

### Authority and workflow

- Work only in `/home/slamnation/www/orgops`, existing branch `88-move-private-skills-into-a-private-repo`. Accepted planning base: `9cb5f0864e84250f06c5fe0d1edaac2d990f70d8` (Phase 11 acceptance), initially clean tracked tree/index. `D=/home/slamnation/www/orgops/.superpowers/sdd/2026-09-12-catalogs-12-import-preview`.
- PLANNING gate: parent reads the ENTIRE concrete plan and explicitly approves it before a plan commit or any source/test edit. Planner remains available for corrections. Planning commit contains ONLY this plan. New phase artifacts, probe attempts, task briefs and logs remain under D and unstaged. Prior phases and their evidence remain read-only.
- One sequential writer, fresh read-only task review after each task/fix, whole-phase review and independent fresh parent verification. No nested agents, worktrees, pushes, merges, remote writes, actual installation/activation/start/publication, production roots/state/services/configuration/HOME/credentials, dependency/package/lock changes. Never read `.env` or `VAULT_REPO_TOKEN` in automated tests or validation. NO network anywhere in this phase: every Git operation runs against owned local fixture repositories via the existing transport double; there is no live smoke.
- Owner decisions remain binding: Q1 = GitHub-hosted repositories ONLY; Q2 = desktop-first (the phone-width/mobile admin shell is a separate required pre-final task and OUT OF SCOPE here). The owner chose **Option A** for this slice (2026-09-12): the preview reads the injected local skills root, treats every present name as `occupied`, claims NO reuse/origin, and adds NO persistence/migration. This phase adds NO other new product/security policy: no installed-origin persistence, no local-root selection policy, no installation/activation/start behavior, no target platform/tool policy (the server never guesses; the request supplies `target`), no new destination/transport policy, no new audit event type, no migration.
- No new owner product/security policy beyond the above. Escalate a material gap through `contact_supervisor` and wait; report blocked if useful work needs new owner policy.
- Tool/runtime/extension/native-output-contract failures stop immediately with exact error, run identifier, cwd, branch/full ref, status, worktree diff and index diff. Continue only on explicit same-native-protocol recovery; never external CLI/foreground fallback. Native `structured_output` verdict is mandatory, not inferred from Markdown.
- New disk fixtures are only new owned directories under D/scratch via phase-owned TMPDIR (tests themselves use ambient `os.tmpdir()` mkdtemp so plain `npm test` still passes), cleaned in awaited finally blocks. Automated tests NEVER touch the network, a real `.env`, `VAULT_REPO_TOKEN`, the real repo `skills/` root (the local root is ALWAYS an owned injected fixture root in tests), or production DATA_DIR. The new preview code performs NO writes (verify-only mirror mode), spawns only the existing inspection's bounded read-only Git children plus the existing local-evidence reader, executes no repository-authored content, and never opens the credential store (`getMasterKey` is never called).

### Read/map evidence and unchanged seams

Planner read full AGENTS.md, the approved design (`docs/superpowers/specs/2026-09-09-skill-agent-catalogs-design.md`), `docs/SPEC.md` including the Phase 10 "Live GitHub catalog synchronization (read-only)" and Phase 11 "Read-only catalog package browsing and detail" subsections, the relevant `docs/catalog-package-contract.md` sections (offline import preparation, offline local skill-root evidence, exact resolution), and all current anchors: `packages/skills/src/catalogs/{import-types,import,import-evidence,resolve,source-policy}.ts`, `local-skill-evidence.ts`, `local-skill-evidence-types.ts`, `local-skill-root.ts`; `packages/skills/src/index.ts` (public exports); `apps/api/src/catalog-sync/{sync,mirror,git-fetch,fixtures.test-helper}.ts` and the `browse`/`mirror`/`git-fetch` tests; `apps/api/src/catalogs.sync.integration.test.ts` and `apps/api/src/catalogs.packages.integration.test.ts`; `apps/api/src/routes/catalogs.ts`; `apps/api/src/app.ts` (composition, `SKILL_ROOT` at line ~121, `createCatalogSync` wiring at ~457, `Cache-Control: no-store` middleware at `/api/catalogs*`); `apps/api/src/catalog-configuration.ts` (`listSources`/`listCatalogs`, removal persists `enabled=0`/`allow_packages=0`); `apps/api/src/admin-access.ts` (`canManageCatalogs`); `apps/admin-ui/src/catalogs/{api,configuration-state}.ts`, `apps/admin-ui/src/screens/CatalogsScreen.tsx`, `apps/admin-ui/src/hooks/useCatalogConfiguration.ts`, and their tests.

| Path / interface | Owner | Responsibility / preflight |
|---|---|---|
| D/`parent-verify.sh`, D/`compare-lint.py` | Task 1 | Copy/adapt Phase-11 verification scripts into D only; fresh Phase-12 baseline logs FIRST |
| `apps/api/src/catalog-sync/sync.ts` | Task 1 | Append `PREVIEW_REJECTED` to `CatalogSyncErrorCode`; add `CATALOG_IMPORT_PREVIEW_LIMITS`, preview view/request/result types, `previewCatalogImport`; `CatalogSyncDeps` gains required `localSkillsRoot: string`; NOTHING else changes (browse/sync behavior byte-identical) |
| `apps/api/src/app.ts` | Task 1 | EXACTLY: AppConfig gains optional test-only `catalogLocalSkillsRoot?: string`; `createCatalogSync` call gains `localSkillsRoot: config.catalogLocalSkillsRoot ?? SKILL_ROOT.path`; no other line |
| `apps/api/src/catalog-sync/browse.test.ts` | Task 1 | Add `localSkillsRoot: <owned mkdtemp fixture root>` to the existing `createCatalogSync` harness call (required new dep); no behavioral change to existing cases |
| `apps/api/src/routes/catalogs.ts` | Task 1 | Append EXACTLY the one error-table entry `PREVIEW_REJECTED` (required here so the exhaustive `errors: Record<CatalogRouteErrorCode, …>` compiles without an api-lint increase); no other line |
| `apps/api/src/catalog-sync/import-preview.test.ts` | Task 1 | Service-level coverage: in-memory db, real `createCatalogConfiguration`, owned fixture repos + transport doubles + owned injected local roots, NO HTTP, NO network, NEVER the real `skills/` root |
| `apps/api/src/routes/catalogs.ts` | Task 2 | Append the request schema (apps/api-local zod, runtime `z` import change) + ONE POST route; existing 18 error-table entries byte-identical |
| `apps/api/src/catalogs.import-preview.integration.test.ts` | Task 2 | Full HTTP auth/validation/failure/leakage/no-fetch/no-events matrix through `createApp` with the AppConfig local-root seam pointed at an owned fixture root; no network |
| `apps/admin-ui/src/catalogs/api.ts` + `api.test.ts` | Task 3 | `previewCatalogImport` + preview decoders + 1 classify row + 1 copy entry |
| `apps/admin-ui/src/catalogs/configuration-state.ts` + `.test.ts` | Task 3 | `ImportPreviewPanel`/`ImportPreviewDraft`, `importPreview` snapshot field, `changeImportPreviewTarget`/`previewImport`, generation supersession, panel lifecycle |
| `apps/admin-ui/src/hooks/useCatalogConfiguration.ts` | Task 3 | `restrictedActions` snapshot gains `importPreview: null` and the two noop actions (keeps the restricted controller type-complete) |
| `apps/admin-ui/src/screens/CatalogsScreen.tsx` + `.test.tsx` | Task 3 | Desktop-only inert import-preview section inside the packages section; existing flows untouched |
| `docs/SPEC.md`, design spec status paragraph, `docs/research/skill-agent-sharing-tasks.md` | Task 3 | Document the implemented preview contract + trust caveats; mark phase; `docs/catalog-package-contract.md` UNCHANGED (library untouched) |
| All existing skills/schemas/db/crypto/import/publication/Git-inspection/local-evidence modules and tests | Read-only all tasks | No semantic or diagnostic-position changes; `packages/skills` and `packages/schemas` gain NOTHING |
| D/task-N-* and distinct fix/attempt paths | Respective writer | Chronology, 15 logs/exits, lint comparisons, diff/commit evidence |

No new resolver, inspector, discovery framework, credential path, fetch path, audit event type, migration, top-level state directory, scheduler, background polling, installed-origin persistence, or mobile layout. `prepareImport` stays the single authority for resolution/preview; this plan does NOT reimplement resolution, dependency traversal or compatibility checks.

### Exact new contract

```ts
// apps/api/src/catalog-sync/sync.ts (Task 1; appended to the EXISTING module)
export type CatalogSyncErrorCode = "INVALID_REQUEST" | "FORBIDDEN" | "NOT_FOUND" | "REMOVED"
  | "STATE_CONFLICT" | "REVISION_CONFLICT" | "DESTINATION_REJECTED" | "CREDENTIAL_UNAVAILABLE"
  | "MIRROR_INVALID" | "SYNC_IN_PROGRESS" | "SYNC_FAILED" | "STORAGE_FAILURE"
  | "EXTERNAL_LOCATION" | "INSPECTION_FAILED"
  | "PREVIEW_REJECTED";   // ONLY this one new code is appended
// Fixed preview bounds: reject, never partially resolve or truncate. inspectedPackages
// matches CATALOG_LIMITS.resolvedPackages; inspectedContentBytes matches
// CATALOG_LIMITS.resolverContentBytes; the 4 MiB response ceiling IS reachable in
// pathological cases by design and fails with the fixed PREVIEW_REJECTED/LIMIT_EXCEEDED.
export const CATALOG_IMPORT_PREVIEW_LIMITS = Object.freeze({
  inspectedPackages: 256, inspectedContentBytes: 33554432, responseJsonBytes: 4194304,
} as const);
export type ImportPreviewTarget = { orgopsVersion: string; platform: "linux" | "darwin" | "win32"; tools: string[] };
export type CatalogImportPreviewRequest = { indexPath: string; name: string; version: string; target: ImportPreviewTarget };
export type ImportPreviewFileView = { path: string; size: number; digest: string; executable: boolean; encoding: "utf8" | "binary" };
export type ImportPreviewPackageView = {
  identity: ResolvedIdentity; action: "include" | "reuse"; dependencies: readonly ResolvedIdentity[];
  manifestBytes: "normalized-package-manifest" | "current-installed-manifest";
  manifest: PackageManifest;                 // frozen parsed manifest (inert metadata only)
  files: ImportPreviewFileView[];            // verified review inventory WITHOUT base64 content
  execution: ExecutionPreview;               // apiEventShapes/runnerScripts/wrappedCommands/externalSources
  warnings: readonly ReviewWarning[];
};
export type CatalogImportPreviewView = {
  kind: "offline-import-preview"; root: ResolvedIdentity; target: ImportPreviewTarget;
  packages: ImportPreviewPackageView[];
  blockedLocalNames: string[];               // Option A: the occupied local namespace, sorted, bounded
  reviewRequired: true; authority: "none";
};
export type CatalogImportPreviewResult =
  | { ok: true; value: CatalogImportPreviewView }
  | { ok: false; code: CatalogSyncErrorCode; issue?: ImportIssue }; // issue present iff PREVIEW_REJECTED
// CatalogSyncDeps gains exactly:  localSkillsRoot: string;
// createCatalogSync's return type gains exactly:
previewCatalogImport(actorHumanId: string, catalogId: string, input: CatalogImportPreviewRequest):
  Promise<CatalogImportPreviewResult>;
```

New imports in `sync.ts` (all existing public exports; nothing else changes): `type ResolvedIdentity` added to the `@orgops/schemas` import; `prepareImport, readLocalSkillEvidence, IMPORT_LIMITS, type CatalogSnapshot, type SuppliedPackage, type ImportSource, type ImportInstalledEntry, type ImportIssue` added to the `@orgops/skills` import.

Exact method logic (`browseBase`, `metadata`, `parentSource`, `inspectIndex`, `ensureCatalogMirror`, `git`, `mirrorsRoot`, `gitExecutable`, `freezeView` are the EXISTING private bindings; `withinPreviewCeiling` mirrors `withinResponseCeiling` against the new limit):

```ts
function withinPreviewCeiling(view: unknown): boolean {
  return Buffer.byteLength(JSON.stringify(view), "utf8") <= CATALOG_IMPORT_PREVIEW_LIMITS.responseJsonBytes;
}

async function previewCatalogImport(actorHumanId: string, catalogId: string,
  input: CatalogImportPreviewRequest): Promise<CatalogImportPreviewResult> {
  // Auth-first ordering: a denied caller always receives FORBIDDEN, never a validation oracle.
  if (!canManageCatalogs({ id: actorHumanId }, { findHuman })) return { ok: false, code: "FORBIDDEN" };
  const rejected = (code: ImportIssue["code"], at: ImportIssue["at"]): CatalogImportPreviewResult =>
    ({ ok: false, code: "PREVIEW_REJECTED", issue: { code, at } });
  // Root catalog preconditions are EXACTLY the Phase 11 read view's: verify-only mirror,
  // resolved refs/orgops-sync/current, unchanged index inspection. No effectiveEnabled
  // requirement here; a disabled catalog fails later, inside the unchanged prepareImport
  // source policy (SOURCE_NOT_ALLOWED), never through a fabricated success.
  const base = await browseBase(actorHumanId, catalogId, input.indexPath);
  if (!base.ok) return base;
  const rootCatalog = base.value.catalog;
  const rootEntry = base.value.index.entries.find(item => item.name === input.name && item.version === input.version);
  if (!rootEntry) return { ok: false, code: "NOT_FOUND" };
  if (rootEntry.location.type !== "catalog") return { ok: false, code: "EXTERNAL_LOCATION" };
  // Option A occupancy: the INJECTED local skills root's complete immediate namespace is
  // read with the EXISTING Phase 9 collector (empty nominations — no subtree bytes, no
  // active discovery, no second filesystem framework). Every present name becomes
  // { state: "occupied" }; reuse is never claimed, no measured/origin/currentDigest entry
  // is fabricated, nothing is persisted. Any collector failure (including unsafe/blocked
  // root states) is ONE fixed redacted STORAGE_FAILURE; names are never silently dropped —
  // a nonportable name fails the collector itself, and prepareImport's own validation
  // would still fail the whole request rather than drop a name.
  const evidence = await readLocalSkillEvidence({ directory: localSkillsRoot, nominatedNames: [] });
  if (!evidence.ok) return { ok: false, code: "STORAGE_FAILURE" };
  const occupied: ImportInstalledEntry[] = evidence.value.namespace.entries.map(entry => ({ state: "occupied", name: entry.name }));
  // Configured source metadata ONLY; credentials are never read or decrypted (getMasterKey
  // is never called on this path). Removed sources keep their persisted disabled flags.
  const sourceList = configuration.listSources();
  if (!sourceList.ok) return { ok: false, code: "STORAGE_FAILURE" };
  if (sourceList.value.length > IMPORT_LIMITS.sources) return rejected("LIMIT_EXCEEDED", "sources");
  const sources: ImportSource[] = sourceList.value.map(item => ({
    sourceId: item.sourceId, repository: item.repository, enabled: item.enabled, allowPackages: item.allowPackages }));
  const catalogList = configuration.listCatalogs();
  if (!catalogList.ok) return { ok: false, code: "STORAGE_FAILURE" };
  const liveCatalogs = catalogList.value.filter(item => item.removedAt === null);
  if (liveCatalogs.length > IMPORT_LIMITS.catalogs) return rejected("LIMIT_EXCEEDED", "catalogs");
  // Only catalogs whose mirror is synced can supply an index; the request's single
  // indexPath is applied to every synced catalog's mirror (repositories share the index
  // layout convention). An absent/unreadable/failed mirror or index is OMITTED — the
  // unchanged resolver then fails closed with a fixed code if the closure needs it.
  const catalogs: CatalogSnapshot[] = [{ catalogId: rootCatalog.catalogId, sourceId: rootCatalog.sourceId,
    commit: base.value.commit, enabled: rootCatalog.enabled, index: base.value.index }];
  const mirrors = new Map<string, { directory: string; commit: string }>([
    [rootCatalog.catalogId, { directory: base.value.mirror, commit: base.value.commit }]]);
  for (const other of liveCatalogs) {
    if (other.catalogId === rootCatalog.catalogId) continue;
    const mirror = await ensureCatalogMirror(mirrorsRoot, other.sourceId, { create: false });
    if (!mirror.ok) continue;
    const current = await git.resolveRef(mirror.directory, CATALOG_SYNC_CURRENT_REF);
    if (!current.ok) continue;
    const index = await inspectIndex(mirror.directory, current.value, input.indexPath);
    if (!index.ok) continue;
    catalogs.push({ catalogId: other.catalogId, sourceId: other.sourceId, commit: current.value,
      enabled: other.enabled, index: index.value });
    mirrors.set(other.catalogId, { directory: mirror.directory, commit: current.value });
  }
  // Inspect every catalog-local entry of every supplied catalog at its synced CURRENT
  // commit with the EXISTING inspectGitPackage. External (location.type === "source")
  // entries and entries pinned to a commit the shallow mirror does not hold are omitted
  // (never fetched; resolution fails closed if the closure needs one). Non-root
  // inspection failure or digest drift is omitted; the ROOT fails closed with
  // INSPECTION_FAILED (mirror drift is a storage-integrity failure, not a preview issue).
  const packages: SuppliedPackage[] = [];
  let contentBytes = 0;
  for (const supplied of catalogs) {
    const mirror = mirrors.get(supplied.catalogId)!;
    for (const entry of supplied.index.entries) {
      if (entry.location.type !== "catalog") continue;
      const isRoot = supplied.catalogId === rootCatalog.catalogId
        && entry.name === input.name && entry.version === input.version;
      const pinned = entry.location.revision.type === "exact" ? entry.location.revision.commit : supplied.commit;
      if (pinned !== supplied.commit) {
        if (isRoot) return { ok: false, code: "INSPECTION_FAILED" };
        continue;
      }
      if (packages.length >= CATALOG_IMPORT_PREVIEW_LIMITS.inspectedPackages) return rejected("LIMIT_EXCEEDED", "packages");
      const snapshot = await inspectGitPackage({ repository: { directory: mirror.directory, gitExecutable },
        commit: supplied.commit, path: entry.location.path });
      if (!snapshot.ok || snapshot.value.manifest.digest !== entry.digest) {
        if (isRoot) return { ok: false, code: "INSPECTION_FAILED" };
        continue;
      }
      contentBytes += snapshot.value.files.reduce((sum, file) => sum + file.size, 0);
      if (contentBytes > CATALOG_IMPORT_PREVIEW_LIMITS.inspectedContentBytes) return rejected("LIMIT_EXCEEDED", "packages");
      packages.push({ sourceId: supplied.sourceId, commit: supplied.commit, path: entry.location.path, snapshot: snapshot.value });
    }
  }
  // The UNCHANGED pure authority: no reimplemented resolution, traversal or compatibility.
  const result = prepareImport({
    root: { catalogId: rootCatalog.catalogId, name: input.name, version: input.version },
    sources, catalogs, packages, target: input.target,
    installed: { complete: true, entries: occupied }, knownReleases: [],
  });
  if (!result.ok) return rejected(result.issues[0]!.code, result.issues[0]!.at);
  const preview = result.value;
  // Bounded, detached, deeply frozen, base64-FREE projection. preconditions (sources with
  // repository URLs, catalog indexes, installed entries, knownReleases) are NOT projected;
  // ImportReviewFile.base64 is NEVER exposed; no host/mirror path or credential reference.
  const view: CatalogImportPreviewView = freezeView({
    kind: "offline-import-preview",
    root: preview.root,
    target: preview.preconditions.target,
    packages: preview.packages.map(item => ({
      identity: item.identity, action: item.action, dependencies: [...item.dependencies],
      manifestBytes: item.manifestBytes, manifest: item.snapshot.manifest,
      files: item.files.map(({ path, size, digest, executable, encoding }) => ({ path, size, digest, executable, encoding })),
      execution: item.snapshot.execution, warnings: item.snapshot.warnings,
    })),
    blockedLocalNames: preview.preconditions.installed.entries.map(entry => entry.name),
    reviewRequired: true, authority: "none",
  });
  if (!withinPreviewCeiling(view)) return rejected("LIMIT_EXCEEDED", "review");
  return { ok: true, value: view };
}
```

```ts
// apps/api/src/app.ts (Task 1; EXACTLY these two additive edits, no other line)
export type AppConfig = {
  // ...existing fields unchanged...
  /** Test-only local skills root seam for the import preview; production defaults to resolveSkillRoot(PROJECT_ROOT).path. */
  catalogLocalSkillsRoot?: string;
};
// in the existing createCatalogSync call:
  const catalogSync = createCatalogSync({
    db, configuration, findHuman: adminAccessDeps.findHuman,
    getMasterKey: () => process.env.ORGOPS_MASTER_KEY ?? "",
    mirrorsRoot: join(DATA_DIR, "catalog-mirrors"),
    gitExecutable: config.catalogGitExecutable ?? process.env.ORGOPS_CATALOG_GIT ?? "/usr/bin/git",
    localSkillsRoot: config.catalogLocalSkillsRoot ?? SKILL_ROOT.path,
    ...(config.catalogSyncTransport === undefined ? {} : { transport: config.catalogSyncTransport }),
  });
```

```ts
// apps/api/src/routes/catalogs.ts (Task 1: append EXACTLY one error-table entry, all 18 existing entries byte-identical)
PREVIEW_REJECTED: [422, "Import preview rejected; the issue code identifies the fixed cause"],

// Task 2: import line changes from `import type { z } from "zod"` to `import { z } from "zod"`,
// adds PackageNameSchema/VersionSchema to the existing @orgops/schemas import, and appends:
const ImportPreviewRequestSchema = z.object({
  indexPath: RelativePathSchema, name: PackageNameSchema, version: VersionSchema,
  target: z.object({
    orgopsVersion: VersionSchema, platform: z.enum(["linux", "darwin", "win32"]),
    tools: z.array(PackageNameSchema).max(64).refine(tools => new Set(tools).size === tools.length),
  }).strict(),
}).strict();

app.post("/api/catalogs/:catalogId/import-preview", requireAuth, requireAdmin, async c => {
  try {
    const principal = c.get("user");
    if (!principal?.id || principal.runnerScope !== undefined) return failure(c, "FORBIDDEN");
    const catalogId = c.req.param("catalogId") ?? "";
    if (!CatalogIdSchema.safeParse(catalogId).success) return failure(c, "INVALID_REQUEST");
    const body = await readBody(c);
    if (!body.ok) return failure(c, body.code);
    const parsed = ImportPreviewRequestSchema.safeParse(body.value);
    if (!parsed.success) return failure(c, "INVALID_REQUEST");
    const result = await sync.previewCatalogImport(principal.id, catalogId, parsed.data);
    if (result.ok) return c.json(result.value);
    if (result.code === "PREVIEW_REJECTED" && result.issue) {
      const [status, error] = errors.PREVIEW_REJECTED;
      return c.json({ error, code: "PREVIEW_REJECTED", issue: { code: result.issue.code, at: result.issue.at } }, status);
    }
    return failure(c, result.code);
  } catch {
    return failure(c, "STORAGE_FAILURE");
  }
});
```

The path sits under `/api/catalogs` so the existing `Cache-Control: no-store` middleware covers it unchanged. `readBody` bounds the JSON body at 16384 bytes exactly as the sync POST. `CatalogRouteErrorCode` already unions `CatalogSyncErrorCode`, so `PREVIEW_REJECTED` type-checks; the service guarantees `issue` on every `PREVIEW_REJECTED` (the `result.issue` guard degrades to the fixed table envelope only on an impossible shape). The route error table enumerates every returned code: all 18 existing entries byte-identical plus `PREVIEW_REJECTED` 422; `INVALID_REQUEST`/`PAYLOAD_TOO_LARGE`/`FORBIDDEN`/`NOT_FOUND`/`REMOVED`/`STORAGE_FAILURE`/`SYNC_FAILED`/`EXTERNAL_LOCATION`/`INSPECTION_FAILED` are reachable from this route exactly as from the browsing routes.

UI contract (Task 3; `apps/admin-ui/src/catalogs/api.ts`):

```ts
export type ImportPreviewIdentity = {
  catalogId: string; catalogCommit: string; sourceId: string; packageCommit: string;
  path: string; kind: string; name: string; version: string; digest: string;
};
export type ImportPreviewTarget = { orgopsVersion: string; platform: "linux" | "darwin" | "win32"; tools: string[] };
export type CatalogImportPreviewPackage = {
  identity: ImportPreviewIdentity; action: "include" | "reuse"; dependencies: ImportPreviewIdentity[];
  manifestBytes: "normalized-package-manifest" | "current-installed-manifest";
  description: string; author: string; license: string;
  compatibility: { orgopsMin: string; orgopsMaxExclusive: string | null; platforms: string[]; tools: string[] };
  secrets: { name: string; description: string; required: boolean }[];
  files: { path: string; size: number; digest: string; executable: boolean; encoding: "utf8" | "binary" }[];
  execution: { apiEventShapes: string[]; runnerScripts: string[];
    wrappedCommands: { at: string; command: string; args: string[] }[];
    externalSources: { type: "github"; repo: string; ref?: string }[] };
  warnings: { code: string; at: string }[];
};
export type CatalogImportPreview = {
  kind: "offline-import-preview"; root: ImportPreviewIdentity; target: ImportPreviewTarget;
  packages: CatalogImportPreviewPackage[]; blockedLocalNames: string[];
  reviewRequired: true; authority: "none";
};
// CatalogApi gains:
previewCatalogImport(id: string, input: { indexPath: string; name: string; version: string; target: ImportPreviewTarget },
  signal?: AbortSignal): Promise<CatalogApiResult<CatalogImportPreview>>;
```

New fixed copy (exact; appended to the existing `copy` object):

```ts
previewRejected: "The import preview was rejected. Nothing was installed, activated or changed.",
```

`classify` gains (BEFORE the generic 400/5xx rows, existing rows byte-identical):

```ts
if (status === 422 && code === "PREVIEW_REJECTED") {
  const issue = typeof body === "object" && body !== null && "issue" in body ? (body as { issue?: unknown }).issue : undefined;
  const issueCode = issue && typeof issue === "object" && "code" in issue ? String((issue as { code: unknown }).code) : "";
  return failure("invalid", /^[A-Z_]{1,64}$/.test(issueCode) ? `${copy.previewRejected} Issue: ${issueCode}.` : copy.previewRejected);
}
```

Controller contract (Task 3; `apps/admin-ui/src/catalogs/configuration-state.ts`):

```ts
export type ImportPreviewDraft = { orgopsVersion: string; platform: "linux" | "darwin" | "win32"; tools: string }; // tools: comma-separated text
export type ImportPreviewPanel = {
  catalogId: string; indexPath: string; name: string; version: string;
  draft: ImportPreviewDraft; result: CatalogImportPreview | null; message: string | null;
} | null;
// ConfigurationSnapshot gains: importPreview: ImportPreviewPanel (empty() initializes null).
// ConfigurationController gains:
//   changeImportPreviewTarget(patch: Partial<ImportPreviewDraft>): void;
//   previewImport(): Promise<void>;
```

Lifecycle rules (exact; extend the EXISTING packages-panel discipline):
- `importPreview` resets to `null` everywhere `packages` resets: `load()`, `select()`, `mutate()`, `authorityLost()`/`dispose()` (via `empty()`), `changeSyncIndexPath`, every `browsePackages` outcome, and every `selectPackage` failure. The EXISTING `packagesGeneration` token supersedes in-flight previews exactly as it supersedes in-flight detail reads.
- A `selectPackage` SUCCESS additionally seeds `importPreview = { catalogId, indexPath, name: selection.name, version: selection.version, draft: { orgopsVersion: "", platform: "linux", tools: "" }, result: null, message: null }`. The defaults are editable text only; the API always requires explicit values and the server never guesses target platform/tools.
- `changeImportPreviewTarget` applies `patch` to `importPreview.draft` only when `writable()` and the panel exists; it clears `result`/`message` (a changed target invalidates a previous preview).
- `previewImport` shares the `selectPackage` gates: `closed`, `phase !== "ready"`, `!writable()`, open editor/confirmation, missing catalog detail or mismatched sync panel, empty trimmed `indexPath`, missing `packages` panel/selection/detail or a panel whose `name`/`version` do not match `packages.selected` → no-op; blank trimmed `orgopsVersion` → publish panel `message` with the fixed invalid copy and NO request; tools text splits on `/[\s,]+/` dropping empty segments; fresh `authorize(op)` bound to `expectedUserId` BEFORE the request; owned `read`-kind operation counted in `busy`; `unauthorized`/`forbidden` route to the existing authority-loss path; no automatic retry. On success it publishes `result` only when the generation and the current packages panel/selection still match; on failure it keeps the draft and publishes the fixed redacted `error.message` with `result: null`.

Screen contract (Task 3; `apps/admin-ui/src/screens/CatalogsScreen.tsx`): an `ImportPreviewSection` rendered inside `PackagesSection` directly after the `PackageDetail` block, only when `packages.detail` and `state.importPreview` are both present (never for source details, editors or confirmations; no mobile/viewport changes): inert framing copy ("Read-only preview of what importing this package would involve. Nothing is fetched, installed, activated, changed or executed. Local skill names are treated as occupied; no reuse is claimed."), the three target fields (OrgOps version `Input`, platform `Select` linux/darwin/win32, comma-separated tools `Input`), a "Preview import" secondary button (`disabled` when `disabled` or the OrgOps version is blank), the result panel when `importPreview.result` is present, and `<p role="alert">` for `importPreview.message`. The result panel renders: framing line "Review required before any use. Authority: none — this preview grants no installation, activation or execution right."; the root identity (kind/name/version/digest/catalog/source and the two commits, as text); one block per package (action `include`/`reuse`, name/version/digest, manifest source label, description/author/license, compatibility line, secrets table, resolved direct dependencies table of identity text, files inventory Path/Size/Digest/Executable/Encoding, the four execution-preview groups rendered only when non-empty, warnings with the SAME fixed per-code copy map as `PackageDetail`); the blocked local names as a plain comma-separated text list under the fixed label "Occupied local skill names (never reused):". All author-provided strings render as React text nodes only — no `dangerouslySetInnerHTML`, no anchor construction, no base64/file content. `apps/admin-ui/src/hooks/useCatalogConfiguration.ts` `restrictedActions` gains `importPreview: null`, `changeImportPreviewTarget: noop` and `previewImport: asyncNoop`.

### Security decisions requiring explicit parent sign-off

1. **Pure read reuse.** The preview never calls `transport.fetch`, never opens `catalog_read_credentials`, never calls `getMasterKey`, never creates or writes mirror state (verify-only mode), never touches `insertEvent`, and adds no schema/audit/persistence/migration change. Tests assert `calls.fetch` stays at exactly the one prior sync fetch across every preview call, a spying `getMasterKey` is never called, and the events table count is unchanged.
2. **Option A occupancy, exactly.** `readLocalSkillEvidence({ directory: localSkillsRoot, nominatedNames: [] })` reads ONLY the immediate namespace (no subtree bytes, no active discovery, no second filesystem framework); every namespace entry — `directory`, `file` or `blocked` — becomes `{ state: "occupied", name }`. No `measured`/origin/`currentDigest` entry is ever fabricated; `knownReleases` is always `[]` (no origin persistence exists to supply it). Consequence: `action` is always `include` and `manifestBytes` always `normalized-package-manifest` on success; a selected skill name present locally fails with `PREVIEW_REJECTED` carrying `{ code: "SKILL_CONFLICT", at: "installed" }` from the UNCHANGED `prepareImport`. The contract's `installed.complete: true` is thereby asserted over the injected local skills root ONLY (not runner-side locations) — this limitation is documented in SPEC and UI copy, not hidden.
3. **Local evidence failure is one fixed redacted outcome.** Any `readLocalSkillEvidence` failure (`INVALID_LOCAL_INPUT`/`UNSUPPORTED_LOCAL_STORAGE`/`UNSAFE_PATH`/`DUPLICATE_PATH`/`LIMIT_EXCEEDED`/`LOCAL_IO_FAILED`/`LOCAL_EVIDENCE_CHANGED`/`LOCAL_ABORTED`/`LOCAL_TIMEOUT`/`LOCAL_CLEANUP_FAILED`) maps to `STORAGE_FAILURE` 500 with no detail. A blocked/unsafe local name therefore fails the whole preview with a fixed code and is NEVER dropped (the collector itself rejects nonportable names; `prepareImport`'s own validation is the second, unchanged net).
4. **Catalogs/sources supply rule.** Sources: ALL configured source metadata (including removed sources, which persist `enabled=false`/`allowPackages=false` at removal) with real stored flags. Catalogs: every NON-removed configured catalog, but only those whose verify-only mirror exists, whose `refs/orgops-sync/current` resolves, and whose index reads at the request's single `indexPath` supply a `CatalogSnapshot` (stored `enabled` flag, resolved commit); any other catalog is OMITTED, and the unchanged resolver/precheck fails closed (`MISSING_RELEASE`/`SOURCE_NOT_ALLOWED` → `PREVIEW_REJECTED`) if the closure needs it. Reusing the request's `indexPath` for other catalogs is a layout-convention assumption, flagged here; it never fabricates a success. Configured counts above `IMPORT_LIMITS.sources`/`IMPORT_LIMITS.catalogs` reject with `PREVIEW_REJECTED`/`LIMIT_EXCEEDED` BEFORE any mirror work.
5. **Package supply rule.** Only `location.type === "catalog"` entries whose effective package commit equals their catalog's synced CURRENT commit are inspected with the EXISTING `inspectGitPackage` and supplied. External entries are never fetched and are omitted (the ROOT being external fails with the existing `EXTERNAL_LOCATION` 400). Entries with `revision.type === "exact"` pinning a commit the shallow mirror does not hold are omitted; the ROOT so pinned fails `INSPECTION_FAILED`. Non-root inspection failure or index-digest drift omits the entry (resolution fails closed if needed); ROOT inspection failure or drift fails `INSPECTION_FAILED` 502. Bounds: at most `CATALOG_IMPORT_PREVIEW_LIMITS.inspectedPackages` (256) inspections and `inspectedContentBytes` (32 MiB) aggregate declared file bytes across ALL supplied catalogs — exceeded → `PREVIEW_REJECTED` carrying `{ code: "LIMIT_EXCEEDED", at: "packages" }`; reject, never partially resolve.
6. **New fixed error envelope (append-only).** `PREVIEW_REJECTED` 422 with message "Import preview rejected; the issue code identifies the fixed cause" and body `{ error, code: "PREVIEW_REJECTED", issue: { code, at } }` where `code`/`at` are the UNCHANGED `ImportIssue` union members (fixed enums, never authored strings). All 18 existing route error-table entries stay byte-identical; no other code is added.
7. **Request-supplied target, apps/api-local validation.** `target` (`orgopsVersion`/`platform`/`tools`) is REQUIRED in the request and validated by a strict zod schema local to `apps/api/src/routes/catalogs.ts`, composed ONLY from existing exported primitive schemas (`RelativePathSchema`, `PackageNameSchema`, `VersionSchema`, `z.enum(["linux","darwin","win32"])`, max 64 unique tools). The server NEVER guesses tool availability or platform policy. NO `packages/schemas` addition is made (the brief's preferred path; no schema change is needed). UI defaults (`orgopsVersion: ""`, `platform: "linux"`, `tools: ""`) are editable text only.
8. **AppConfig test seam.** `catalogLocalSkillsRoot?: string` (test-only) is added; production wiring is `config.catalogLocalSkillsRoot ?? SKILL_ROOT.path` — the EXISTING configured skills root (`resolveSkillRoot(PROJECT_ROOT).path`), so no new local-root selection policy is created. Automated tests ALWAYS inject an owned fixture root and never read the real repo `skills/` root.
9. **Response projection is closed and base64-free.** Exactly: `kind`, `root` (ResolvedIdentity), `target`, `packages[]` (identity, action, dependencies, manifestBytes, inert manifest metadata, files WITHOUT base64 — `path/size/digest/executable/encoding` only, execution preview, warnings), `blockedLocalNames` (the occupied local namespace, deliberately shown to the administrator; bounded by `OFFLINE_LOCAL_SKILL_LIMITS.namespaceEntries` 4096 × 64 chars), `reviewRequired: true`, `authority: "none"`. NEVER: `preconditions` (sources carry repository URLs), `knownReleases`, `installed` entries, host/mirror paths, repository URLs, credential/ciphertext references, `base64`, or a full `ImportInput`/`ImportPreview` dump. Over the 4 MiB ceiling → `PREVIEW_REJECTED` `{ code: "LIMIT_EXCEEDED", at: "review" }`; reject, never truncate. Unlike Phase 11 this ceiling is reachable in pathological cases (e.g. thousands of warnings) by design; the failure is fixed and safe.
10. **Disabled catalogs preview through the unchanged authority.** Like the Phase 10/11 read views, browsing preconditions do not require `effectiveEnabled`; a disabled catalog or source fails inside the UNCHANGED `prepareImport` source policy (`SOURCE_NOT_ALLOWED` → `PREVIEW_REJECTED`), never through a server-side policy guess and never a fabricated success. Removal still blocks with `REMOVED`.
11. **UI rendering trust.** Mirrored bytes are untrusted; all manifest/preview/warning/identity strings render as escaped text, never HTML or links; the preview grants no installation, activation or execution authority and no affordance for those exists; Phase 5/10/11 auth, race, supersession and no-retry discipline is preserved exactly; existing tests stay passing unmodified.

### Validation and chronology (every task/fix)

Before editing capture task base/full ref, cwd/branch, tracked/untracked status, diff/index to unique D paths; assert expected branch/state. Task 1 baseline BEFORE ANY source/test creation: accepted 2246 Vitest tests / 59 files + 3 opscli, unchanged 488 diagnostics (API 486 + agent-runner 2; ten workspaces clean including skills/schemas). Copy/adapt Phase-11 scripts into D only:

```bash
cd /home/slamnation/www/orgops
D="$PWD/.superpowers/sdd/2026-09-12-catalogs-12-import-preview"
P="$PWD/.superpowers/sdd/2026-09-12-catalogs-11-package-browsing"
cp "$P/parent-verify.sh" "$D/parent-verify.sh"
cp "$P/compare-lint.py" "$D/compare-lint.py"
python3 - <<'PY'
from pathlib import Path
D = Path('.superpowers/sdd/2026-09-12-catalogs-12-import-preview')
p = D / 'parent-verify.sh'
s = p.read_text().replace('2026-09-12-catalogs-11-package-browsing', '2026-09-12-catalogs-12-import-preview')
p.write_text(s)
p = D / 'compare-lint.py'
s = p.read_text().replace("d=root/'.superpowers/sdd/2026-09-12-catalogs-11-package-browsing'", "d=root/'.superpowers/sdd/2026-09-12-catalogs-12-import-preview'")
s = s.replace('2026-09-11-catalogs-10-live-github-sync/parent-final-lint.json', '2026-09-12-catalogs-11-package-browsing/parent-final-lint.json')
p.write_text(s)
PY
bash "$D/parent-verify.sh" task-1-baseline
python3 "$D/compare-lint.py" task-1-baseline > "$D/task-1-baseline-comparison.txt"
cmp "$P/parent-final-root-lint.txt" "$D/task-1-baseline-root-lint.txt"
```

All 12 workspaces independently: api, agent-runner, opscli, admin-ui, user-ui, db, schemas, event-bus, llm, crypto, skills, events-scenario-tests; plus root test/opscli/root lint = 15 exact unique exit labels and nonempty raw logs. Exact expected exits: test 0, opscli 0, root-lint 2, lint-api 2, lint-agent-runner 2, other 10 lint 0. Full path/line/column/code/multiline-message/multiplicity Counter comparison; reject unparsed/missing logs or wrong exits. No diagnostic-bearing source edits or position normalization. Root lint raw bytes must remain identical to the fresh Phase-12 baseline. Root lint short-circuits at API; never substitute it for all-workspace runs. Test count increases only from scoped new tests. The isolation wrapper never sources the real `.env` — automated runs source `.env.example` only:

```bash
D=/home/slamnation/www/orgops/.superpowers/sdd/2026-09-12-catalogs-12-import-preview
isolated() {
  (ulimit -c 0; timeout --kill-after=5s 600s env -i PATH="$PATH" \
    HOME="$D/scratch/home" TMPDIR="$D/scratch/tmp" CI=1 \
    /bin/bash --noprofile --norc -c \
    'set -a; source .env.example; set +a; export ORGOPS_LLM_STUB=1; exec "$@"' bash "$@")
}
# Targeted example (replace label/file per task):
isolated npm exec --no -- vitest run apps/api/src/catalog-sync/import-preview.test.ts \
  > "$D/task-1-red-1.txt" 2>&1
printf '%s\n' "$?" > "$D/task-1-red-1.exit"
# Each task/fix final (fresh LABEL, never overwrite failures):
LABEL=task-1-final-1
bash "$D/parent-verify.sh" "$LABEL"
python3 "$D/compare-lint.py" "$LABEL" > "$D/$LABEL-comparison.txt"
cmp "$D/task-1-baseline-root-lint.txt" "$D/$LABEL-root-lint.txt"
git diff --check
git diff --cached --check
```

Record a genuine behavioral RED before implementing each behavior, GREEN after. Missing-module/export-only failure is scaffolding RED, not security proof; label interface-only RED honestly. Preserve every failed attempt under distinct D paths; diagnose routine fixture/assertion/type failures locally. Material behavior/contract changes need parent approval before correction.

All validation completed before each scoped conventional commit. Stage only owned task source/test/docs paths explicitly, inspect full staged diff and `git diff --cached --name-only`, no `git add .`. Task result includes full HEAD, task base/range and fix-only range, exact logs, all 15 exits, tests/lint comparison and outstanding limitations. Parent owns review/next launch/final acceptance; never claim whole-phase acceptance from a task pass.

### Preflight / handoff table

| Task | Required base/input | Produces | Shared files/interface checks before handoff |
|---|---|---|---|
| 1 | Accepted base + parent-approved plan-only commit, clean tracked tree; full fresh baseline FIRST | `PREVIEW_REJECTED` code, `CATALOG_IMPORT_PREVIEW_LIMITS`, preview types, `previewCatalogImport`, `localSkillsRoot` dep + app.ts wiring + AppConfig seam, `browse.test.ts` dep fix, the `PREVIEW_REJECTED` error-table entry, `import-preview.test.ts` | `syncCatalog`/`readCatalogIndex`/`listCatalogPackages`/`inspectCatalogPackage` behavior byte-identical (Phase 10/11 tests unmodified and green); exact frozen types; no fetch/credential/events path reachable; skills/schemas/db untouched |
| 2 | Parent-reviewed Task 1 commit; full Task 1 brief/common prefix | `ImportPreviewRequestSchema` + POST route; `catalogs.import-preview.integration.test.ts` | existing route tests byte-compatible; full auth matrix; leakage assertions; `calls.fetch` unchanged; events count unchanged; Cache-Control no-store asserted |
| 3 | Parent-reviewed Task 2 commit; full Task 2 brief/common prefix | UI api/state/hook/screen + tests; SPEC/design/tasks docs | Phase 5/10/11 auth/race/supersession preserved; existing UI tests pass unmodified; no mobile layout; docs carry inert/untrusted/Option-A-completeness caveats |

Shared dependencies available unchanged in all tasks: `PackageNameSchema`/`VersionSchema`/`CatalogIdSchema`/`RelativePathSchema`/`CATALOG_LIMITS` and the `CatalogEntry`/`PackageManifest`/`ReviewWarning`/`ResolvedIdentity` types from `@orgops/schemas`; `prepareImport`/`readLocalSkillEvidence`/`IMPORT_LIMITS`/`readGitCatalogIndex`/`inspectGitPackage`/`computePackageDigest` (tests only) and the `CatalogSnapshot`/`SuppliedPackage`/`ImportSource`/`ImportInstalledEntry`/`ImportIssue`/`ExecutionPreview` types from `@orgops/skills`; `canManageCatalogs`/`AdminHuman` from `apps/api/src/admin-access`; `createCatalogConfiguration` metadata reads; `ensureCatalogMirror` verify-only mode and `CATALOG_SYNC_CURRENT_REF` from the Phase 10 modules; `readBody`/`failure` and the runner-denial guard from `routes/catalogs.ts`. Review the preflight table plus `git diff --name-only TASK_BASE..HEAD` after every task.

After parent approves this entire plan: commit only the plan with `docs(catalogs): plan read-only catalog import preview`; then generate the briefs with the ENTIRE identical shared prefix plus each own body via the installed SDD `task-brief` tool and verify exact bytes and taskCount:

```bash
cd /home/slamnation/www/orgops
D="$PWD/.superpowers/sdd/2026-09-12-catalogs-12-import-preview"
PLAN="docs/superpowers/plans/2026-09-12-catalogs-12-import-preview.md"
TB=/home/slamnation/.pi/agent/git/github.com/obra/superpowers/skills/subagent-driven-development/scripts/task-brief
awk '/^### Task 1([^0-9]|$)/{exit} {print}' "$PLAN" > "$D/shared-prefix.md"
for n in 1 2 3; do "$TB" "$PLAN" "$n" "$D/task-$n-body.md"; done
for n in 1 2 3; do cat "$D/shared-prefix.md" "$D/task-$n-body.md" > "$D/task-$n-brief.md"; done
python3 - <<'PY'
from pathlib import Path
import hashlib, re
root = Path('/home/slamnation/www/orgops')
D = root/'.superpowers/sdd/2026-09-12-catalogs-12-import-preview'
plan = (root/'docs/superpowers/plans/2026-09-12-catalogs-12-import-preview.md').read_text()
prefix = (D/'shared-prefix.md').read_text()
assert plan.startswith(prefix), 'shared prefix mismatch'
lines = plan.splitlines(keepends=True)
heads = [i for i, line in enumerate(lines) if re.match(r'^#+[ \t]+Task[ \t]+[0-9]+([^0-9]|$)', line)]
def region(n):
    for i in heads:
        m = re.match(r'^#+[ \t]+Task[ \t]+([0-9]+)([^0-9]|$)', lines[i])
        if m and int(m.group(1)) == n:
            end = next((j for j in heads if j > i), len(lines))
            return ''.join(lines[i:end])
    raise AssertionError(f'task {n} missing')
out = []
for n in (1, 2, 3):
    body = (D/f'task-{n}-body.md').read_text()
    assert body == region(n), f'body {n} != plan task region'
    assert re.search(rf'^#+[ \t]+Task[ \t]+{n}([^0-9]|$)', body, re.M), f'task {n} identity missing'
    for m in (1, 2, 3):
        if m != n:
            assert not re.search(rf'^#+[ \t]+Task[ \t]+{m}([^0-9]|$)', body, re.M), f'body {n} contains task {m}'
    brief = (D/f'task-{n}-brief.md').read_text()
    assert brief == prefix + body, f'brief {n} != prefix + body'
    out.append(f'task-{n}-brief.md sha256:{hashlib.sha256(brief.encode()).hexdigest()} bytes:{len(brief.encode())} body-bytes:{len(body.encode())}')
out.append(f'shared-prefix.md sha256:{hashlib.sha256(prefix.encode()).hexdigest()} bytes:{len(prefix.encode())}')
out.append('taskCount 3')
(D/'brief-hashes.txt').write_text('\n'.join(out) + '\n')
print('\n'.join(out))
PY
```

No source/test implementation during planning. Briefs, hashes, probes and logs stay under D, unstaged.

### Planning self-review (shared)

- Spec coverage: one catalog-local root preview from the synced index (brief "Approved product boundary") → Task 1 service + Task 2 route + Task 3 UI; Option A occupancy via `readLocalSkillEvidence` with empty nominations → Task 1 (+ conflict coverage); sources/catalogs from configuration, synced mirrors only → Task 1; packages via `inspectGitPackage` with fixed bounds, external omitted → Task 1 (+ Task 2 matrix); request-supplied target → Task 2 schema + Task 3 UI fields; base64-free bounded projection with `reviewRequired`/`authority` framing → Task 1 + Task 3; admin-only POST + app wiring → Tasks 1–2; tests + docs → Tasks 1–3; baseline/validation discipline → shared prefix + every task.
- Explicitly NOT included (per brief): installed-origin persistence or history, reuse/`measured` claims, migrations, audit event types, installation/activation/start gates, local bindings, secret materialization, publishing/GitHub submission, durable preview storage, scheduled work, network/credentials, other transports, mobile layout, and any `packages/skills`/`packages/schemas` semantic change.
- Type consistency: `CatalogImportPreviewView`/`ImportPreviewPackageView` (T1) → route JSON (T2) → UI `CatalogImportPreview`/`CatalogImportPreviewPackage` decoders (T3); `ImportPreviewTarget` identical in T1 service request and T3 UI input; `CatalogImportPreviewRequest` (T1) is exactly the parsed output of `ImportPreviewRequestSchema` (T2); `PREVIEW_REJECTED` appears in the service union (T1), the route error table + envelope (T1 entry/T2 route) and the UI classify/copy (T3); `ImportPreviewPanel`/`ImportPreviewDraft`/`changeImportPreviewTarget`/`previewImport` (T3 state) match the screen section props (T3 screen) and the `restrictedActions` noop set (T3 hook).
- Placeholder scan: every code step carries exact code; bounds, codes, messages and copy are literal; no TBD/TODO/"handle edge cases" steps.

### Task 1: Read-only import preview service (Option A) + app wiring + fresh Phase-12 baseline

**Files:**
- Create (evidence): `D/parent-verify.sh`, `D/compare-lint.py` (copied/adapted from Phase 11), `D/task-1-baseline-*` logs
- Modify: `apps/api/src/catalog-sync/sync.ts` (appended preview contract + `localSkillsRoot` dep; NOTHING else changes)
- Modify: `apps/api/src/app.ts` (EXACTLY the AppConfig seam field + the one `localSkillsRoot` wiring line)
- Modify: `apps/api/src/catalog-sync/browse.test.ts` (add the now-required `localSkillsRoot` to the harness `createCatalogSync` call; owned mkdtemp root; no behavioral change)
- Modify: `apps/api/src/routes/catalogs.ts` (append EXACTLY the one error-table entry `PREVIEW_REJECTED`; no other line). REQUIRED here, not in Task 2: widening `CatalogSyncErrorCode` without it breaks the exhaustive `errors: Record<CatalogRouteErrorCode, …>` (new TS2739) and the api-lint-486 / root-byte-identical mandate.
- Test: `apps/api/src/catalog-sync/import-preview.test.ts`

**Interfaces:**
- Consumes: existing `createCatalogConfiguration`, `canManageCatalogs`, `browseBase`/`metadata`/`parentSource`/`inspectIndex` (private, same module), `ensureCatalogMirror` verify-only mode, `CATALOG_SYNC_CURRENT_REF`, `CatalogGitTransport`, `inspectGitPackage`, `prepareImport`, `readLocalSkillEvidence`, `IMPORT_LIMITS`, `computePackageDigest` (tests only), and the schemas/types listed in the shared prefix.
- Produces: `PREVIEW_REJECTED` in `CatalogSyncErrorCode`; `CATALOG_IMPORT_PREVIEW_LIMITS`; `ImportPreviewTarget`, `CatalogImportPreviewRequest`, `ImportPreviewFileView`, `ImportPreviewPackageView`, `CatalogImportPreviewView`, `CatalogImportPreviewResult`; `CatalogSyncDeps.localSkillsRoot: string`; `createCatalogSync`'s new method `previewCatalogImport(actorHumanId, catalogId, input)`; the AppConfig seam `catalogLocalSkillsRoot?: string`. Task 2 consumes the method, the request type and the error code; Task 3 consumes the route JSON shape.

- [x] **Step 1: Capture TASK_BASE/state to `D/task-1-start.txt`; assert HEAD == the parent-approved plan-only commit, clean tree/index.**

- [x] **Step 2: Fresh Phase-12 baseline FIRST (before any source/test creation).** Run the shared-prefix script block: copy/adapt `parent-verify.sh`/`compare-lint.py` from Phase 11 into D, `bash "$D/parent-verify.sh" task-1-baseline`, `python3 "$D/compare-lint.py" task-1-baseline > "$D/task-1-baseline-comparison.txt"`, `cmp` the fresh root lint against Phase 11's `parent-final-root-lint.txt` (must be byte-identical: HEAD differs only by the docs-only plan commit). Record 2246 tests / 59 files + 3 opscli + 488 diagnostics in `D/task-1-report.md` notes. Any drift stops the task and is reported.

- [x] **Step 3: Write the failing service test** `apps/api/src/catalog-sync/import-preview.test.ts`. Harness: `openDb(":memory:")`, real `createCatalogConfiguration({ db, findHuman, getMasterKey: spyGetMasterKey, appendAudit: appendAuditSpy })`, owned `mkdtemp` mirrorsRoot, owned `mkdtemp` LOCAL ROOT injected as `localSkillsRoot` (NEVER the real repo `skills/` root), `createCatalogSync({ ..., localSkillsRoot, transport })` with fixture transport doubles; mutable `findHuman` to flip authority. Reuse the Phase 11 `skillPackage`/`packageFiles` builders (copy them into this file; `computePackageDigest` from `@orgops/skills` computes each digest). A second builder adds a dependency:

```ts
function skillPackageWithDeps(name: string, version: string, dependencies: unknown[]) {
  const base = skillPackage(name, version);
  const manifest = { ...base.manifest, dependencies };
  const entries = [{ type: "file" as const, path: "SKILL.md",
    base64: Buffer.from(base.skillMd).toString("base64"), executable: false }];
  const digest = computePackageDigest(manifest, entries);
  if (!digest.ok) throw new Error("fixture package invalid");
  return { ...base, manifest: { ...manifest, digest: digest.value } };
}
```

Primary fixture index (A: root `demo-skill` 1.0.0 depending on B: `dep-skill` 1.0.0 same-package-revision; C: external `external-skill` 2.0.0):

```ts
const dep = skillPackage("dep-skill", "1.0.0");
const root = skillPackageWithDeps("demo-skill", "1.0.0", [
  { catalogId: "ghc", sourceId: "gh", name: "dep-skill", version: "1.0.0",
    revision: { type: "same-package-revision" }, digest: dep.manifest.digest },
]);
const externalDigest = `sha256:${"b".repeat(64)}`;
const indexJson = JSON.stringify({ formatVersion: 1, entries: [
  { kind: "skill", name: "demo-skill", version: "1.0.0", digest: root.manifest.digest,
    location: { type: "catalog", path: "skills/demo-skill", revision: { type: "catalog-revision" } } },
  { kind: "skill", name: "dep-skill", version: "1.0.0", digest: dep.manifest.digest,
    location: { type: "catalog", path: "skills/dep-skill", revision: { type: "catalog-revision" } } },
  { kind: "skill", name: "external-skill", version: "2.0.0", digest: externalDigest,
    location: { type: "source", sourceId: "gh", commit: "0123456789abcdef0123456789abcdef01234567", path: "skills/external-skill" } },
] });
const fixture = await createLocalFixtureRepo(indexJson, "/usr/bin/git",
  [...packageFiles(root, "skills/demo-skill"), ...packageFiles(dep, "skills/dep-skill")]);
const target = { orgopsVersion: "0.0.1", platform: "linux" as const, tools: [] as string[] };
```

Cases (each a real behavioral assertion through the service object):
1. **happy path with dependency closure**: create source `gh` (`https://github.com/org/repo`) + catalog `ghc` via `configuration.mutate`; `syncCatalog("owner", "ghc", { expectedRevision: 1, indexPath: fixture.indexPath })` succeeds; empty local root; `previewCatalogImport("owner", "ghc", { indexPath: fixture.indexPath, name: "demo-skill", version: "1.0.0", target })` → ok; `value.kind === "offline-import-preview"`; `value.reviewRequired === true`; `value.authority === "none"`; `value.root.name === "demo-skill"`; `value.packages` has EXACTLY 2 entries in dependency-first order (`dep-skill` before `demo-skill`), every `action === "include"` and every `manifestBytes === "normalized-package-manifest"` (Option A: never reuse); the root package's `dependencies` is exactly `[dep-skill identity]`; `value.blockedLocalNames` equals `[]`; `value.target` deep-equals `target`; every file entry has EXACTLY the keys `path,size,digest,executable,encoding`; deep-frozen (`Object.isFrozen` on value, packages, packages[0], files). Leakage: `JSON.stringify(value)` contains NONE of `root.base64`/`dep.base64`, `"base64"`, `"preconditions"`, `"github.com/org/repo"`, `"ciphertext"`, the mirrorsRoot path or the local root path. `calls.fetch` has exactly the ONE sync fetch (preview NEVER fetches); `spyGetMasterKey` was NEVER called; `appendAuditSpy` was NEVER called.
2. **Option A conflict — occupied, never reuse**: `mkdir(join(localRoot, "dep-skill"))` (empty directory = occupancy) → preview of `demo-skill` → `{ ok: false, code: "PREVIEW_REJECTED", issue: { code: "SKILL_CONFLICT", at: "installed" } }`; then remove it and `mkdir(join(localRoot, "demo-skill"))` → same fixed shape. A NON-matching local name (`mkdir(join(localRoot, "unrelated"))`) leaves the happy path green and `blockedLocalNames === ["unrelated"]`.
3. **external root fails closed without fetch**: preview of `external-skill` 2.0.0 → `{ ok: false, code: "EXTERNAL_LOCATION" }`; `calls.fetch` unchanged.
4. **external dependency fails fixed**: build fixture variant E — a SECOND fixture repo + second source `gh2` (`https://github.com/org/repo2`) + catalog `ghc2` with the Phase 11 two-fixture transport dispatch — whose root depends on the external entry (`sourceId: "gh"`, external pin, `digest: externalDigest`, `revision: { type: "exact", commit: "0123…" }`); preview → `PREVIEW_REJECTED` with `issue.code` one of the fixed resolver/policy codes (`SOURCE_NOT_ALLOWED` or `MISSING_RELEASE`) — assert it is `PREVIEW_REJECTED` with a fixed enum code string, `calls.fetch` unchanged. (Do not assert a specific resolver code beyond the fixed-enum membership and `at` being a fixed union member; the unchanged library owns precedence.)
5. **unknown package / unsynced / removed**: unknown name on the synced catalog → `NOT_FOUND`; never-synced catalog → `NOT_FOUND`; after `catalog.remove` → `REMOVED`.
6. **disabled catalog fails inside the unchanged authority, not a guess**: after a successful sync, `catalog.update` `enabled: false`; preview → `PREVIEW_REJECTED` with `issue.code === "SOURCE_NOT_ALLOWED"` and `issue.at === "sources"` (the unchanged precheck policy); the Phase 11 `listCatalogPackages` on the same catalog still succeeds (read-view consistency, unchanged).
7. **root digest drift / broken root**: fixture variant with a wrong index digest for the root (separate source/catalog like the Phase 11 `ghc2` pattern) → `INSPECTION_FAILED`.
8. **root pinned to a non-current commit**: variant index with the root's `location.revision = { type: "exact", commit: "<40 hex ≠ fixture.commit>" }` → `INSPECTION_FAILED` (the shallow mirror holds only the synced commit; fail closed, never fabricated).
9. **inspection count bound**: variant catalog whose index declares 257 DISTINCT catalog-local minimal packages (257 unique `skills/pkg-N` paths, fixture files generated in a loop) → `PREVIEW_REJECTED` with `issue: { code: "LIMIT_EXCEEDED", at: "packages" }`.
10. **local evidence failure is one fixed redacted outcome**: `localSkillsRoot` pointing at a nonexistent absolute path → `STORAGE_FAILURE` (never a partial/empty occupancy); a local root containing a SYMLINK entry named `demo-skill` (type `blocked` = occupancy) → preview of `demo-skill` → `PREVIEW_REJECTED` `SKILL_CONFLICT` (blocked names occupy; they are never dropped).
11. **authority recheck**: `findHuman` returning `{ isAdmin: false, mustChangePassword: false }`, `{ isAdmin: true, mustChangePassword: true }` and `undefined` → `FORBIDDEN`; a denied principal with an otherwise-valid request still receives `FORBIDDEN` (auth-first).
12. **unchanged browsing behavior**: `listCatalogPackages`/`inspectCatalogPackage`/`readCatalogIndex` on the fixture return byte-identical views to Phase 11 expectations (guards the append-only edit).

- [x] **Step 4: RED.** Run `isolated npm exec --no -- vitest run apps/api/src/catalog-sync/import-preview.test.ts` → interface-only RED (method absent on the service type) recorded as `D/task-1-red-1.{txt,exit}` and labelled honestly; then add a minimal stub (`previewCatalogImport` returning `{ ok: false, code: "STORAGE_FAILURE" }`) plus the dep/type/error-table edits needed to compile, and rerun → behavioral RED `D/task-1-red-2.{txt,exit}` (happy-path assertions fail on the wrong code). Preserve both.

- [x] **Step 5: GREEN.** Implement the shared-prefix contract exactly in `sync.ts` (appended code, types, limits, imports, `localSkillsRoot` dep, `withinPreviewCeiling`, `previewCatalogImport`) and the two exact `app.ts` edits. Rerun the targeted file → `D/task-1-green-1.txt`. Then run `apps/api/src/catalog-sync/browse.test.ts`, `apps/api/src/catalogs.sync.integration.test.ts`, `apps/api/src/catalogs.packages.integration.test.ts` and the mirror/git-fetch suites → unchanged GREEN `D/task-1-green-2.txt`.

- [x] **Step 6: Full validation + scoped commit.**

```bash
LABEL=task-1-final-1
bash "$D/parent-verify.sh" "$LABEL"
python3 "$D/compare-lint.py" "$LABEL" > "$D/$LABEL-comparison.txt"
cmp "$D/task-1-baseline-root-lint.txt" "$D/$LABEL-root-lint.txt"
git diff --check
git add apps/api/src/catalog-sync/sync.ts apps/api/src/app.ts apps/api/src/catalog-sync/browse.test.ts apps/api/src/routes/catalogs.ts apps/api/src/catalog-sync/import-preview.test.ts
git commit -m "feat(catalogs): add read-only import preview service"
```

### Task 2: Admin-only import-preview route + HTTP integration matrix

**Files:**
- Modify: `apps/api/src/routes/catalogs.ts` (runtime `z` import change, `PackageNameSchema`/`VersionSchema` added to the existing schemas import, `ImportPreviewRequestSchema`, ONE appended POST route; the `PREVIEW_REJECTED` error-table entry was already appended by Task 1 so the exhaustive `errors` Record compiles without an api-lint increase)
- Test: `apps/api/src/catalogs.import-preview.integration.test.ts`
- Verify-only: `apps/api/src/app.ts` beyond Task 1 (assert no further change; `git diff TASK_BASE -- apps/api/src/app.ts` shows EXACTLY the Task 1 two-edit diff)

**Interfaces:**
- Consumes: Task 1 `previewCatalogImport`, `CatalogImportPreviewRequest`, `PREVIEW_REJECTED`; existing `readBody`/`failure`, `requireAuth`/`requireAdmin`, `CatalogIdSchema`/`RelativePathSchema` (already imported), the runner-denial guard, and the AppConfig `catalogLocalSkillsRoot` seam for the test harness.
- Produces: `POST /api/catalogs/:catalogId/import-preview` with strict body `{ indexPath, name, version, target: { orgopsVersion, platform, tools } }` → 200 `CatalogImportPreviewView` JSON; fixed `{error, code}` envelopes otherwise, with `PREVIEW_REJECTED` 422 additionally carrying `issue: { code, at }` (fixed enums). Task 3 consumes the response shape and the envelope.

- [x] **Step 1: Capture TASK_BASE/state to `D/task-2-start.txt`; assert HEAD == Task 1 commit, clean tree/index.**

- [x] **Step 2: Write the failing integration test** `apps/api/src/catalogs.import-preview.integration.test.ts`, harness copied from `catalogs.packages.integration.test.ts` (in-memory db, `createApp({ db, dataDir, adminUser/adminPass, runnerToken, catalogSyncTransport, catalogGitExecutable: "/usr/bin/git", catalogLocalSkillsRoot: localRoot })` where `localRoot` is an owned `mkdtemp` fixture root — NEVER the real `skills/` root — `vi.stubEnv` master key, `fetch`/console guards, fixture repos from Task 1's builders). Cases:

```ts
const previewPath = "/api/catalogs/ghc/import-preview";
const body = { indexPath: fixture.indexPath, name: "demo-skill", version: "1.0.0", target };

it("previews an import without fetches, credentials, events or content bytes", async () => {
  await createGh();                                   // source gh + catalog ghc (Phase 10 harness pattern)
  await json(await request("POST", syncPath, { expectedRevision: 1, indexPath: fixture.indexPath }));
  expect(calls.fetch).toHaveLength(1);
  const before = eventsCount();
  const preview = await json(await request("POST", previewPath, body));
  expect(preview.kind).toBe("offline-import-preview");
  expect(preview.reviewRequired).toBe(true);
  expect(preview.authority).toBe("none");
  expect(preview.packages.map((p: { identity: { name: string } }) => p.identity.name)).toEqual(["dep-skill", "demo-skill"]);
  expect(preview.packages.every((p: { action: string }) => p.action === "include")).toBe(true);
  expect(preview.blockedLocalNames).toEqual([]);
  const raw = JSON.stringify(preview);
  expect(raw).not.toContain("base64");
  expect(raw).not.toContain(root.base64);
  expect(raw).not.toContain("preconditions");
  expect(raw).not.toContain("github.com/org/repo");   // no repository URL in the projection
  expect(raw).not.toContain("ciphertext");
  expect(raw).not.toContain(dataDir);                 // no host/mirror path
  expect(raw).not.toContain(localRoot);               // no local-root host path
  expect(calls.fetch).toHaveLength(1);                // preview NEVER fetches
  expect(eventsCount()).toBe(before);                 // no events rows
}, 30000);

it("enforces admin authority for the preview route", async () => {
  // same 6-case matrix as the Phase 10/11 tests: no cookie → 401 {error:"Unauthorized"};
  // ordinary human → 403; global runner token → 403; scoped runner token → 403;
  // scoped runner token + admin cookie → 403; admin with must_change_password=1 → 403.
  // calls.fetch stays empty; eventsCount unchanged.
});

it("validates path params and body with fixed redacted codes", async () => {
  await createGh();
  await error(await request("POST", previewPath, {}), "INVALID_REQUEST");                       // missing fields
  await error(await request("POST", previewPath, { ...body, indexPath: "../x" }), "INVALID_REQUEST");
  await error(await request("POST", previewPath, { ...body, name: "Bad Name" }), "INVALID_REQUEST");
  await error(await request("POST", previewPath, { ...body, version: "1.0" }), "INVALID_REQUEST");
  await error(await request("POST", previewPath, { ...body, target: { ...target, platform: "plan9" } }), "INVALID_REQUEST");
  await error(await request("POST", previewPath, { ...body, target: { ...target, tools: ["a", "a"] } }), "INVALID_REQUEST");
  await error(await request("POST", previewPath, { ...body, extra: 1 }), "INVALID_REQUEST");     // strict body
  await error(await request("POST", "/api/catalogs/unknown/import-preview", body), "NOT_FOUND");
  // oversized body: > 16384 bytes of padding in a string field → PAYLOAD_TOO_LARGE
});

it("fails closed for unsynced, removed, external, conflicted and incompatible previews", async () => {
  await createGh();
  const before = eventsCount();
  await error(await request("POST", previewPath, body), "NOT_FOUND");               // never synced
  await json(await request("POST", syncPath, { expectedRevision: 1, indexPath: fixture.indexPath }));
  await error(await request("POST", previewPath, { ...body, name: "ghost" }), "NOT_FOUND");
  const external = await request("POST", previewPath, { ...body, name: "external-skill", version: "2.0.0" });
  expect(await json(external, 400)).toEqual({ error: "Package content is external to this catalog; only catalog-local packages can be inspected", code: "EXTERNAL_LOCATION" });
  // Option A conflict: an owned local-root directory named dep-skill → 422 envelope:
  await mkdir(join(localRoot, "dep-skill"));
  const conflict = await request("POST", previewPath, body);
  expect(conflict.status).toBe(422);
  expect(await conflict.json()).toEqual({ error: "Import preview rejected; the issue code identifies the fixed cause",
    code: "PREVIEW_REJECTED", issue: { code: "SKILL_CONFLICT", at: "installed" } });
  await rm(join(localRoot, "dep-skill"), { recursive: true, force: true });
  // incompatible target (platform not declared by the fixture packages) → 422 INCOMPATIBLE:
  const incompatible = await request("POST", previewPath, { ...body, target: { ...target, platform: "darwin" } });
  expect(incompatible.status).toBe(422);
  expect((await incompatible.json()).issue.code).toBe("INCOMPATIBLE");
  // removed catalog: DELETE with current revision then the route → 410 REMOVED
  expect(calls.fetch).toHaveLength(1);                 // the only fetch ever was the one sync
  expect(eventsCount()).toBe(before);                  // no events rows from any preview call
}, 30000);
```

Every `json()` assertion also checks `Cache-Control: no-store` (existing helper behavior). The `localRoot` fixture is created with `mkdtemp` in `beforeAll`/per-test and removed in an awaited `finally`/`afterAll`; the real repo `skills/` root is never touched (assert `catalogLocalSkillsRoot` is the fixture in the harness setup).

- [x] **Step 3: RED** (`D/task-2-red-1.{txt,exit}`): the route 404s with the stock Hono body — behavioral RED, since the failure is the missing route, not an interface stub. Preserve the raw log.

- [x] **Step 4: Implement** the request schema and the one appended POST route exactly per the shared prefix; the `PREVIEW_REJECTED` error-table entry is already present from Task 1 (verify with `grep -n "PREVIEW_REJECTED" apps/api/src/routes/catalogs.ts` — exactly ONE entry). No other route changes.

- [x] **Step 5: GREEN targeted, then regression:** the new file, `catalogs.sync.integration.test.ts`, `catalogs.packages.integration.test.ts`, `catalogs.integration.test.ts`, and the Task 1 service files all green (`D/task-2-green-1.txt`, `D/task-2-green-2.txt`). Assert `git diff TASK_BASE -- apps/api/src/app.ts` shows exactly the Task 1 wiring diff and `git diff --exit-code TASK_BASE -- packages/` is clean (no package changes in this phase).

- [x] **Step 6: Full validation + scoped commit.**

```bash
LABEL=task-2-final-1
bash "$D/parent-verify.sh" "$LABEL"
python3 "$D/compare-lint.py" "$LABEL" > "$D/$LABEL-comparison.txt"
cmp "$D/task-1-baseline-root-lint.txt" "$D/$LABEL-root-lint.txt"
git diff --check
git add apps/api/src/routes/catalogs.ts apps/api/src/catalogs.import-preview.integration.test.ts
git commit -m "feat(catalogs): add admin-only import preview route"
```

### Task 3: Desktop import-preview UI + docs

**Files:**
- Modify: `apps/admin-ui/src/catalogs/api.ts` (types, 1 method, decoders, 1 classify row, 1 copy entry), `apps/admin-ui/src/catalogs/api.test.ts`
- Modify: `apps/admin-ui/src/catalogs/configuration-state.ts` (`ImportPreviewDraft`/`ImportPreviewPanel`, `importPreview` snapshot field, `changeImportPreviewTarget`/`previewImport`, lifecycle), `apps/admin-ui/src/catalogs/configuration-state.test.ts`
- Modify: `apps/admin-ui/src/hooks/useCatalogConfiguration.ts` (`restrictedActions` gains `importPreview: null`, `changeImportPreviewTarget: noop`, `previewImport: asyncNoop`)
- Modify: `apps/admin-ui/src/screens/CatalogsScreen.tsx` (`ImportPreviewSection` + result rendering), `apps/admin-ui/src/screens/CatalogsScreen.test.tsx`
- Docs: `docs/SPEC.md`, `docs/superpowers/specs/2026-09-09-skill-agent-catalogs-design.md` (status paragraph only), `docs/research/skill-agent-sharing-tasks.md`

**Interfaces:**
- Consumes: Task 2 route/JSON; existing `CatalogSyncEntry`, `PackagesPanel`, `packagesGeneration`, `runSyncOperation`-style gates, `CatalogsView` structure.
- Produces: `ImportPreviewIdentity`, `ImportPreviewTarget`, `CatalogImportPreviewPackage`, `CatalogImportPreview`, `CatalogApi.previewCatalogImport`; `ImportPreviewDraft`, `ImportPreviewPanel`, `ConfigurationSnapshot.importPreview`, `ConfigurationController.changeImportPreviewTarget`/`previewImport`; the `ImportPreviewSection` markup contract used by the screen tests. Nothing after this task consumes new interfaces.

- [x] **Step 1: Capture TASK_BASE/state to `D/task-3-start.txt`; assert HEAD == Task 2 commit, clean tree/index.**

- [x] **Step 2: api.ts RED/GREEN.** Extend the `mappings` table with the call (`POST /api/catalogs/<id>/import-preview`, body `{ indexPath, name, version, target }`, all string fields URI-component-encoded in the path), decoding through `importPreviewView` (new decoder built from the EXISTING `object`/`text`/`boolean`/`nonNegativeInt`/`stringArray`/`list` helpers plus a new `identity` decoder and a `previewPackage` decoder reusing the Phase 11 secret/dependency/file/wrapped-command/external-source/warning decoders; the file decoder gains `encoding` validated as `"utf8" | "binary"`). Failure rows: `422 PREVIEW_REJECTED` → `invalid` + `copy.previewRejected` with the guarded ` Issue: <CODE>.` suffix per the shared prefix; 404 → `missing` + `copy.packageMissing` (same remap as `getCatalogPackage`). Malformed-preview rejections (`null`, `{}`, missing `root`, `packages` not an array, identity with empty `name`, file with bad `encoding`, `blockedLocalNames` not a string array, `authority` not `"none"`) → `protocol`. Leakage test: a raw preview body embedding extra `"credential":"syn-marker"` fields at top level, inside `root` and inside a package `manifest` decodes successfully and `JSON.stringify(result)` never contains `syn-marker`. RED first (method absent → type error, honest interface-only RED label), then GREEN.

- [x] **Step 3: configuration-state.ts RED/GREEN.** Implement the shared-prefix lifecycle exactly: `importPreview: null` in `empty()`; resets at every packages-panel reset site (including both `browsePackages` outcomes and `selectPackage` failure); `selectPackage` success seeds the panel with the shared-prefix defaults; `changeImportPreviewTarget` patching + result/message invalidation; `previewImport` gates, local blank-version gate, tools split, fresh `authorize`, generation/panel match before publish, `read`-kind operation, no retry. Tests (mirroring the existing packages-panel tests): a successful `selectPackage` seeds the panel with empty editable defaults; `changeImportPreviewTarget` updates the draft and clears a prior result/message; `previewImport` with a blank OrgOps version publishes the invalid copy and makes NO api call; a successful preview publishes the result; an indexPath change or selection switch between request and settle blocks publication; 401/403 route to authority loss; a `PREVIEW_REJECTED` outcome publishes the fixed message with `result: null` and keeps the draft; busy gating refuses a second concurrent preview; no automatic retry after `network`/`protocol`. RED (absent methods/panel), then GREEN.

- [x] **Step 4: CatalogsScreen.tsx RED/GREEN (SSR markup tests).** Render `ImportPreviewSection` inside `PackagesSection` directly after the detail block per the shared prefix (framing copy, three target fields, "Preview import" button disabled while `disabled` or the OrgOps version is blank, the result panel, the `<p role="alert">` message). The result panel renders: the "Review required… Authority: none…" framing line; the root identity line; per-package blocks (action, name/version/digest, manifest source label, description/author/license, compatibility, secrets table, resolved dependencies table, files Path/Size/Digest/Executable/Encoding table, non-empty execution groups, fixed-copy warnings); and the "Occupied local skill names (never reused):" line. Tests assert: the section is absent when no package detail is selected and while an editor/confirmation is open; the button is disabled with a blank OrgOps version; a populated `importPreview.result` renders the framing line, both package blocks in order with `include` actions, the dependency identity text, the SKILL.md inventory row with encoding, and the `MANUAL_REVIEW_REQUIRED` warning copy; the blocked-names line renders occupied names as plain text; author-provided markup in a description (e.g. `<b>x</b>`) is escaped in the markup; no anchor/install/activate affordance exists in the section markup; the alert shows the fixed failure copy; existing Phase 5/10/11 screen tests pass unmodified.

- [x] **Step 5: Docs.** `docs/SPEC.md`: append a "Read-only catalog import preview (Option A)" subsection right after the Phase 11 browsing subsection documenting: the POST route with the exact strict body and success shape; the appended `PREVIEW_REJECTED` 422 envelope with the fixed `issue` enum; the composition (Phase 11 `browseBase` preconditions, Option A `readLocalSkillEvidence` namespace → `occupied`, configured sources/synced catalogs, bounded `inspectGitPackage` supply, UNCHANGED `prepareImport`); the request-supplied target policy (the server never guesses); the omitted-entry/fail-closed rules (external, non-current pins, non-root drift) and the root `EXTERNAL_LOCATION`/`INSPECTION_FAILED` failures; the fixed bounds (`CATALOG_IMPORT_PREVIEW_LIMITS` values) with reject-not-truncate; the base64-free closed projection (no preconditions, repository URLs, host/mirror/local paths, credentials/ciphertext or file bytes); the no-fetch/no-credential/no-events/no-persistence guarantees; and the honesty caveats (occupancy completeness covers the configured local skills root only; `authority: "none"`; no installation/activation/execution authority or affordance; untrusted mirrored content). Design spec status paragraph: append the Phase 12 sentence (read-only import preview implemented/reviewed/verified under Option A; installation, publishing UI and the mobile shell still outstanding). `skill-agent-sharing-tasks.md`: add the completed Phase 12 line. `docs/catalog-package-contract.md` stays unchanged.

- [x] **Step 6: Full validation + scoped commits.**

```bash
LABEL=task-3-final-1
bash "$D/parent-verify.sh" "$LABEL"
python3 "$D/compare-lint.py" "$LABEL" > "$D/$LABEL-comparison.txt"
cmp "$D/task-1-baseline-root-lint.txt" "$D/$LABEL-root-lint.txt"
git diff --check
git add apps/admin-ui/src/catalogs/api.ts apps/admin-ui/src/catalogs/api.test.ts \
        apps/admin-ui/src/catalogs/configuration-state.ts apps/admin-ui/src/catalogs/configuration-state.test.ts \
        apps/admin-ui/src/hooks/useCatalogConfiguration.ts \
        apps/admin-ui/src/screens/CatalogsScreen.tsx apps/admin-ui/src/screens/CatalogsScreen.test.tsx
git commit -m "feat(catalogs): add desktop catalog import preview"
git add docs/SPEC.md docs/superpowers/specs/2026-09-09-skill-agent-catalogs-design.md docs/research/skill-agent-sharing-tasks.md
git commit -m "docs(catalogs): document read-only catalog import preview"
```
