# Read-Only Catalog Package Browsing and Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (parent controller only) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Workers must not launch nested agents.

**Goal:** Let an administrator browse the package list of an already-synced catalog and open one catalog-local package's fully inert detail (manifest metadata, verified file inventory, execution preview, review warnings) using ONLY the existing Phase 10 verify-only mirror read path and the unchanged `readGitCatalogIndex`/`inspectGitPackage` offline inspection — nothing is fetched, installed, activated, persisted or written, and no credential is read.

**Architecture:** `createCatalogSync` gains two read-only methods (`listCatalogPackages`, `inspectCatalogPackage`) that share a new private precondition helper with the existing `readCatalogIndex` (auth recheck → catalog/source metadata → verify-only mirror → resolve `refs/orgops-sync/current` → `readGitCatalogIndex`); the detail method additionally finds the `(name, version)` index entry, rejects external (`location.type === "source"`) entries with a fixed code, runs the EXISTING `inspectGitPackage` at the same mirror commit, binds the result to the index digest, and strips file `base64` before returning frozen portable views under an explicit response ceiling. Two admin-only GET routes are appended to `registerCatalogRoutes` (no `app.ts` change: the routes' `sync` dep is typed `ReturnType<typeof createCatalogSync>`). The desktop Catalogs screen gains a catalog-detail-only packages section reusing the Phase 5/10 auth/race/supersession discipline. No schema, audit, persistence, AppConfig, fetch, credential, `prepareImport`, local-skill-root, installation, activation, publication or mobile change.

**Tech Stack:** Existing TypeScript, Hono routes, `better-sqlite3` (unchanged), `@orgops/schemas`, `@orgops/skills` (`readGitCatalogIndex`, `inspectGitPackage`, `computePackageDigest` in tests), React admin-ui, colocated Vitest; npm only. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-09-skill-agent-catalogs-design.md`; `docs/SPEC.md` (Phase 10 sync subsection); `docs/catalog-package-contract.md`; binding `.superpowers/sdd/2026-09-12-catalogs-11-package-browsing/controller-brief.md`.

## Global Constraints / Entire Identical Shared Task Prefix

Everything before `### Task 1` is the ENTIRE shared contract and must prefix every task brief byte-for-byte. The installed SDD script extracts only a task body: preserve each raw extraction, then prepend this prefix to a distinct final brief. No shared requirements occur after the task bodies.

### Authority and workflow

- Work only in `/home/slamnation/www/orgops`, existing branch `88-move-private-skills-into-a-private-repo`. Accepted planning base: `856ed5687a3ed3318ec5315bb138c342f7913d66` (Phase 10 acceptance), initially clean tracked tree/index. `D=/home/slamnation/www/orgops/.superpowers/sdd/2026-09-12-catalogs-11-package-browsing`.
- PLANNING gate: parent reads the ENTIRE concrete plan and explicitly approves it before a plan commit or any source/test edit. Planner remains available for corrections. Planning commit contains ONLY this plan. New phase artifacts, probe attempts, task briefs and logs remain under D and unstaged. Prior phases and their evidence remain read-only.
- One sequential writer, fresh read-only task review after each task/fix, whole-phase review and independent fresh parent verification. No nested agents, worktrees, pushes, merges, remote writes, actual installation/activation/start/publication, production roots/state/services/configuration/HOME/credentials, dependency/package/lock changes. Never read `.env` or `VAULT_REPO_TOKEN` in automated tests or validation. NO network anywhere in this phase: there is no live smoke (unlike Phase 10); every Git operation runs against owned local fixture repositories via the existing transport double.
- Owner decisions (2026-09-11) remain binding: Q1 = GitHub-hosted repositories ONLY; Q2 = desktop-first; the phone-width/mobile admin shell is a separate required pre-final task and OUT OF SCOPE here. This phase adds NO new product/security policy: no installed-package origin persistence, no local skill-root selection, no `prepareImport` preview, no installation/activation/start behavior, no new destination/transport policy, no new audit event type, no migration.
- No new owner product/security policy. Escalate a material gap through `contact_supervisor` and wait; report blocked if useful work needs new owner policy.
- Tool/runtime/extension/native-output-contract failures stop immediately with exact error, run identifier, cwd, branch/full ref, status, worktree diff and index diff. Continue only on explicit same-native-protocol recovery; never external CLI/foreground fallback. Native `structured_output` verdict is mandatory, not inferred from Markdown.
- New disk fixtures are only new owned directories under D/scratch via phase-owned TMPDIR (tests themselves use ambient `os.tmpdir()` mkdtemp so plain `npm test` still passes), cleaned in awaited finally blocks. Automated tests NEVER touch the network, a real `.env`, `VAULT_REPO_TOKEN`, or production DATA_DIR. The new browsing code performs NO writes at all (verify-only mirror mode), spawns only the existing inspection's bounded read-only Git children, executes no repository-authored content, and never opens the credential store.

### Read/map evidence and unchanged seams

Planner read full AGENTS.md, the approved design (`docs/superpowers/specs/2026-09-09-skill-agent-catalogs-design.md`), `docs/SPEC.md` including the Phase 10 "Live GitHub catalog synchronization (read-only)" subsection, the relevant `docs/catalog-package-contract.md` sections (offline exact Git inspection, version-1 shapes, bounds), and all current anchors: `apps/api/src/catalog-sync/{sync,mirror,git-fetch,fixtures.test-helper}.ts` and the `mirror`/`git-fetch` tests; `apps/api/src/catalogs.sync.integration.test.ts`; `apps/api/src/routes/catalogs.ts`; `apps/api/src/app.ts` (composition + `Cache-Control: no-store` middleware at `/api/catalogs*`); `apps/api/src/admin-access.ts` (`canManageCatalogs`, `createRequireAdmin`); `packages/skills/src/catalogs/{git-inspection,git-session,git-objects,content,fixtures,git-fixtures}.ts` and the `PackageSnapshot`/`ExecutionPreview`/`ReviewWarning` shapes; `packages/schemas/src/catalogs/{primitives,index,manifest,configuration}.ts` and `packages/schemas/src/index.ts`; `apps/admin-ui/src/catalogs/{api,configuration-state}.ts`, `apps/admin-ui/src/screens/CatalogsScreen.tsx`, and their tests.

| Path / interface | Owner | Responsibility / preflight |
|---|---|---|
| D/`parent-verify.sh`, D/`compare-lint.py` | Task 1 | Copy/adapt Phase-10 verification scripts into D only; fresh Phase-11 baseline logs FIRST |
| `apps/api/src/catalog-sync/fixtures.test-helper.ts` | Task 1 | Add OPTIONAL `files` param to `createLocalFixtureRepo`; existing callers byte-compatible; test-only, never imported by production |
| `apps/api/src/catalog-sync/sync.ts` | Task 1 | Add `CATALOG_BROWSE_LIMITS`, browse view types, 2 appended error codes, private `browseBase` helper, `listCatalogPackages`/`inspectCatalogPackage`; `readCatalogIndex` reimplemented over `browseBase` with byte-identical behavior |
| `apps/api/src/catalog-sync/browse.test.ts` | Task 1 | Service-level coverage: in-memory db, real `createCatalogConfiguration`, owned fixture repos + transport doubles, NO HTTP, NO network |
| `apps/api/src/routes/catalogs.ts` | Task 2 | Append 2 GET routes + 2 error-table entries; all existing routes/tests byte-compatible; deps type unchanged (`ReturnType<typeof createCatalogSync>` absorbs the new methods) |
| `apps/api/src/app.ts` | Task 2 | NO CHANGE — verify only: wiring already passes the whole `catalogSync` object; the `/api/catalogs*` no-store middleware covers the new paths |
| `apps/api/src/catalogs.packages.integration.test.ts` | Task 2 | Full HTTP auth/validation/failure/leakage matrix through `createApp`, no network |
| `apps/admin-ui/src/catalogs/api.ts` + `api.test.ts` | Task 3 | `listCatalogPackages`/`getCatalogPackage` + detail/list decoders + 2 classify rows + copy |
| `apps/admin-ui/src/catalogs/configuration-state.ts` + `.test.ts` | Task 3 | `PackagesPanel` state, `browsePackages`/`selectPackage`, generation supersession, panel lifecycle |
| `apps/admin-ui/src/screens/CatalogsScreen.tsx` + `.test.tsx` | Task 3 | Desktop-only packages section in catalog detail; existing flows untouched |
| `docs/SPEC.md`, design spec status paragraph, `docs/research/skill-agent-sharing-tasks.md` | Task 3 | Document the implemented browsing contract + trust caveats; mark phase; `docs/catalog-package-contract.md` UNCHANGED (library untouched) |
| All existing skills/schemas/db/crypto/import/publication/Git-inspection modules and tests | Read-only all tasks | No semantic or diagnostic-position changes |
| D/task-N-* and distinct fix/attempt paths | Respective writer | Chronology, 15 logs/exits, lint comparisons, diff/commit evidence |

No new resolver, semantic inspector, credential path, fetch path, retrieval of file bytes, audit event type, migration, top-level state directory, scheduler, background polling, or mobile layout. `packages/skills` and `packages/schemas` gain NOTHING: the existing offline inspection and schemas are consumed as-is through their public exports.

### Exact new contract

```ts
// apps/api/src/catalog-sync/sync.ts (Task 1; appended to the EXISTING module)
export type CatalogSyncErrorCode = "INVALID_REQUEST" | "FORBIDDEN" | "NOT_FOUND" | "REMOVED"
  | "STATE_CONFLICT" | "REVISION_CONFLICT" | "DESTINATION_REJECTED" | "CREDENTIAL_UNAVAILABLE"
  | "MIRROR_INVALID" | "SYNC_IN_PROGRESS" | "SYNC_FAILED" | "STORAGE_FAILURE"
  | "EXTERNAL_LOCATION" | "INSPECTION_FAILED";   // ONLY the two new codes are appended
export const CATALOG_BROWSE_LIMITS = Object.freeze({ responseJsonBytes: 1048576 } as const);
export type CatalogPackageListEntry = {
  kind: CatalogEntry["kind"]; name: string; version: string; digest: string;
  locationType: "catalog" | "source";
};
export type CatalogPackageListView = {
  catalogId: string; sourceId: string; ref: string; commit: string;
  packages: CatalogPackageListEntry[];
};
export type CatalogPackageFileEntry = { path: string; size: number; digest: string; executable: boolean };
export type CatalogPackageDetailView = {
  catalogId: string; sourceId: string; ref: string; commit: string;
  kind: CatalogEntry["kind"]; name: string; version: string; digest: string;
  manifest: PackageManifest;                 // frozen parsed manifest (inert metadata only)
  files: CatalogPackageFileEntry[];          // verified inventory WITHOUT base64 content
  execution: ExecutionPreview;               // apiEventShapes/runnerScripts/wrappedCommands/externalSources
  warnings: readonly ReviewWarning[];
};
// createCatalogSync's return type gains exactly:
listCatalogPackages(actorHumanId: string, catalogId: string, indexPath: string):
  Promise<CatalogSyncResult<CatalogPackageListView>>;
inspectCatalogPackage(actorHumanId: string, catalogId: string, indexPath: string,
  name: string, version: string): Promise<CatalogSyncResult<CatalogPackageDetailView>>;
```

New imports in `sync.ts` (all existing public exports; nothing else changes): `PackageNameSchema, VersionSchema, type CatalogEntry, type PackageManifest, type ReviewWarning` from `@orgops/schemas`; `inspectGitPackage, type ExecutionPreview` from `@orgops/skills`.

Shared precondition helper (extracted from the CURRENT `readCatalogIndex` body, behavior byte-identical — existing Phase 10 tests must pass unmodified):

```ts
type BrowseBase = { catalog: CatalogMetadata; source: SourceMetadata; mirror: string; commit: string; index: CatalogIndex };
// Read-only preconditions shared by every browsing view: NO fetch, NO credential, NO writes.
// No effectiveEnabled requirement — identical to the Phase 10 GET read view: a disabled
// catalog's last synced bytes remain inspectable; removal still blocks.
async function browseBase(actorHumanId: string, catalogId: string, indexPath: string): Promise<CatalogSyncResult<BrowseBase>> {
  if (!canManageCatalogs({ id: actorHumanId }, { findHuman })) return { ok: false, code: "FORBIDDEN" };
  if (!RelativePathSchema.safeParse(indexPath).success) return { ok: false, code: "INVALID_REQUEST" };
  const catalogResult = metadata(catalogId);
  if (!catalogResult.ok) return catalogResult;
  const catalog = catalogResult.value;
  if (catalog.removedAt !== null) return { ok: false, code: "REMOVED" };
  const sourceResult = parentSource(catalog.sourceId);
  if (!sourceResult.ok) return sourceResult;
  const source = sourceResult.value;
  if (source.removedAt !== null) return { ok: false, code: "REMOVED" };
  const mirror = await ensureCatalogMirror(mirrorsRoot, source.sourceId, { create: false });
  if (!mirror.ok) return { ok: false, code: mirror.code === "MIRROR_IO" ? "STORAGE_FAILURE" : "NOT_FOUND" };
  const current = await git.resolveRef(mirror.directory, CATALOG_SYNC_CURRENT_REF);
  if (!current.ok) return { ok: false, code: current.issue.code === "REF_MISSING" ? "NOT_FOUND" : SYNC_FAILED };
  const index = await inspectIndex(mirror.directory, current.value, indexPath);
  if (!index.ok) return index;
  return { ok: true, value: { catalog, source, mirror: mirror.directory, commit: current.value, index: index.value } };
}
```

`readCatalogIndex` becomes a thin wrapper (same observable behavior and code enumeration as today):

```ts
async function readCatalogIndex(actorHumanId: string, catalogId: string, indexPath: string): Promise<CatalogSyncResult<CatalogSyncView>> {
  const base = await browseBase(actorHumanId, catalogId, indexPath);
  if (!base.ok) return base;
  const { catalog, source, commit, index } = base.value;
  return { ok: true, value: { catalogId: catalog.catalogId, sourceId: source.sourceId, ref: catalog.ref, commit, index } };
}
```

New methods (exact logic; `freezeView` is a local recursive `Object.freeze` helper identical in shape to the one in `packages/skills/src/catalogs/content.ts`):

```ts
function freezeView<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freezeView); Object.freeze(value); }
  return value;
}
function withinResponseCeiling(view: unknown): boolean {
  return Buffer.byteLength(JSON.stringify(view), "utf8") <= CATALOG_BROWSE_LIMITS.responseJsonBytes;
}

async function listCatalogPackages(actorHumanId, catalogId, indexPath) {
  const base = await browseBase(actorHumanId, catalogId, indexPath);
  if (!base.ok) return base;
  const { catalog, source, commit, index } = base.value;
  const view: CatalogPackageListView = freezeView({
    catalogId: catalog.catalogId, sourceId: source.sourceId, ref: catalog.ref, commit,
    packages: index.entries.map(entry => ({ kind: entry.kind, name: entry.name, version: entry.version,
      digest: entry.digest, locationType: entry.location.type })),
  });
  // Reject rather than truncate. Analytically unreachable: CATALOG_LIMITS.indexEntries (4096)
  // × bounded fields (kind ≤13, name ≤64, version ≤20, digest 71, fixed keys) stays well
  // under 1 MiB; the ceiling is defense-in-depth, not a reachable policy decision.
  if (!withinResponseCeiling(view)) return { ok: false, code: "INSPECTION_FAILED" };
  return { ok: true, value: view };
}

async function inspectCatalogPackage(actorHumanId, catalogId, indexPath, name, version) {
  if (!canManageCatalogs({ id: actorHumanId }, { findHuman })) return { ok: false, code: "FORBIDDEN" };
  if (!RelativePathSchema.safeParse(indexPath).success) return { ok: false, code: "INVALID_REQUEST" };
  if (!PackageNameSchema.safeParse(name).success || !VersionSchema.safeParse(version).success) {
    return { ok: false, code: "INVALID_REQUEST" };
  }
  const base = await browseBase(actorHumanId, catalogId, indexPath);
  if (!base.ok) return base;
  const { catalog, source, mirror, commit, index } = base.value;
  // (name, version) is unique per index schema; external locations are inert claims, NEVER fetched.
  const entry = index.entries.find(item => item.name === name && item.version === version);
  if (!entry) return { ok: false, code: "NOT_FOUND" };
  const location = entry.location;
  if (location.type !== "catalog") return { ok: false, code: "EXTERNAL_LOCATION" };
  // Inspect at the resolved CURRENT commit (the shallow mirror holds only it). An entry with
  // location.revision.type === "exact" pinning another commit is honored by the digest binding
  // below: drift between the pinned content and the synced bytes fails closed.
  const snapshot = await inspectGitPackage({ repository: { directory: mirror, gitExecutable }, commit, path: location.path });
  if (!snapshot.ok) return { ok: false, code: "INSPECTION_FAILED" };
  if (snapshot.value.manifest.digest !== entry.digest) return { ok: false, code: "INSPECTION_FAILED" };
  const view: CatalogPackageDetailView = freezeView({
    catalogId: catalog.catalogId, sourceId: source.sourceId, ref: catalog.ref, commit,
    kind: entry.kind, name: entry.name, version: entry.version, digest: entry.digest,
    manifest: snapshot.value.manifest,
    files: snapshot.value.files.map(({ path, size, digest, executable }) => ({ path, size, digest, executable })),
    execution: snapshot.value.execution,
    warnings: snapshot.value.warnings,
  });
  // Same reject-not-truncate ceiling; analytically bounded by manifestJsonBytes (256 KiB)
  // plus contentEntries (256) inventory/preview/warning fields, all under 1 MiB.
  if (!withinResponseCeiling(view)) return { ok: false, code: "INSPECTION_FAILED" };
  return { ok: true, value: view };
}
```

Note the auth-first ordering: `inspectCatalogPackage` re-checks `canManageCatalogs` and the schema guards BEFORE `browseBase` repeats them, so a denied caller always receives `FORBIDDEN` and never a validation oracle. `CatalogMetadata`/`SourceMetadata` are already imported in `sync.ts`. The public contract never exposes the mirror path or `OfflineGitRepository`: both views contain only portable identity fields, the frozen manifest, the base64-stripped inventory, the execution preview and warnings.

```ts
// apps/api/src/routes/catalogs.ts (Task 2; appended error-table entries, existing 16 entries byte-identical)
EXTERNAL_LOCATION: [400, "Package content is external to this catalog; only catalog-local packages can be inspected"],
INSPECTION_FAILED: [502, "Package inspection failed; synced content is unchanged"],
```

Appended routes (inside the existing `registerCatalogRoutes`, reusing `failure`, the `principal.runnerScope !== undefined` guard and the existing schema imports; `CatalogRouteErrorCode` already unions `CatalogSyncErrorCode`, so the two new codes type-check without any other change). **Import clarification (parent review):** `CatalogIdSchema` and `RelativePathSchema` are ALREADY imported at the top of `routes/catalogs.ts` (lines 4–8, used by the Phase 10 GET sync route at line 163); no import-line change is required or permitted — Task 2 appends exactly the two routes and the two error-table entries and touches nothing else:

```ts
app.get("/api/catalogs/:catalogId/packages", requireAuth, requireAdmin, async c => {
  try {
    const principal = c.get("user");
    if (!principal?.id || principal.runnerScope !== undefined) return failure(c, "FORBIDDEN");
    const catalogId = c.req.param("catalogId") ?? "";
    if (!CatalogIdSchema.safeParse(catalogId).success) return failure(c, "INVALID_REQUEST");
    const indexPath = c.req.query("indexPath") ?? "";
    if (!RelativePathSchema.safeParse(indexPath).success) return failure(c, "INVALID_REQUEST");
    const result = await sync.listCatalogPackages(principal.id, catalogId, indexPath);
    return result.ok ? c.json(result.value) : failure(c, result.code);
  } catch {
    return failure(c, "STORAGE_FAILURE");
  }
});
app.get("/api/catalogs/:catalogId/packages/:name/:version", requireAuth, requireAdmin, async c => {
  try {
    const principal = c.get("user");
    if (!principal?.id || principal.runnerScope !== undefined) return failure(c, "FORBIDDEN");
    const catalogId = c.req.param("catalogId") ?? "";
    if (!CatalogIdSchema.safeParse(catalogId).success) return failure(c, "INVALID_REQUEST");
    const indexPath = c.req.query("indexPath") ?? "";
    if (!RelativePathSchema.safeParse(indexPath).success) return failure(c, "INVALID_REQUEST");
    const name = c.req.param("name") ?? "";
    const version = c.req.param("version") ?? "";
    const result = await sync.inspectCatalogPackage(principal.id, catalogId, indexPath, name, version);
    return result.ok ? c.json(result.value) : failure(c, result.code);
  } catch {
    return failure(c, "STORAGE_FAILURE");
  }
});
```

`PackageNameSchema`/`VersionSchema` are NOT re-validated in the route: the service validates them after its auth recheck (added to the existing schemas import in `sync.ts`). Both paths sit under `/api/catalogs` so the existing `Cache-Control: no-store` middleware covers them unchanged. **`apps/api/src/app.ts` is NOT modified**: `registerCatalogRoutes` already receives `sync: catalogSync` typed `ReturnType<typeof createCatalogSync>`, which absorbs the two new methods, and no new AppConfig field exists. Task 2 asserts this with a compile check plus the unchanged-behavior integration tests.

UI contract (Task 3; `apps/admin-ui/src/catalogs/api.ts`):

```ts
export type CatalogPackageListView = { catalogId: string; sourceId: string; ref: string; commit: string; packages: CatalogSyncEntry[] };
export type CatalogPackageDetail = {
  catalogId: string; sourceId: string; ref: string; commit: string;
  kind: string; name: string; version: string; digest: string;
  description: string; author: string; license: string;
  compatibility: { orgopsMin: string; orgopsMaxExclusive: string | null; platforms: string[]; tools: string[] };
  secrets: { name: string; description: string; required: boolean }[];
  dependencies: { catalogId: string; sourceId: string; name: string; version: string }[];
  files: { path: string; size: number; digest: string; executable: boolean }[];
  execution: { apiEventShapes: string[]; runnerScripts: string[];
    wrappedCommands: { at: string; command: string; args: string[] }[];
    externalSources: { type: "github"; repo: string; ref?: string }[] };
  warnings: { code: string; at: string }[];
};
// CatalogApi gains:
listCatalogPackages(id: string, indexPath: string, signal?: AbortSignal): Promise<CatalogApiResult<CatalogPackageListView>>;
getCatalogPackage(id: string, indexPath: string, name: string, version: string, signal?: AbortSignal): Promise<CatalogApiResult<CatalogPackageDetail>>;
```

New fixed copy (exact; appended to the existing `copy` object):

```ts
externalLocation: "This package's content is external to the catalog repository and cannot be inspected locally.",
inspectionFailed: "The package could not be inspected. Synced content is unchanged.",
packageMissing: "The package is not in the synced index, or no synchronized index is available. Reload and browse again.",
```

`classify` gains (BEFORE the generic 400/502 rows, existing rows byte-identical):

```ts
if (status === 400 && code === "EXTERNAL_LOCATION") return failure("invalid", copy.externalLocation);
if (status === 502 && code === "INSPECTION_FAILED") return failure("unavailable", copy.inspectionFailed);
```

404 remap: `listCatalogPackages` maps `missing` → `copy.notSynced` (same as `getCatalogSync`); `getCatalogPackage` maps `missing` → `copy.packageMissing`.

Controller contract (Task 3; `apps/admin-ui/src/catalogs/configuration-state.ts`):

```ts
export type PackageSelection = { name: string; version: string };
export type PackagesPanel = {
  catalogId: string; indexPath: string;
  list: CatalogSyncEntry[] | null;
  selected: PackageSelection | null;
  detail: CatalogPackageDetail | null;
  message: string | null;
} | null;
// ConfigurationSnapshot gains: packages: PackagesPanel (empty() initializes null).
// ConfigurationController gains: browsePackages(): Promise<void>; selectPackage(selection: PackageSelection): Promise<void>;
```

Lifecycle rules (exact; mirror the existing `sync` panel discipline):
- `packages` resets to `null` everywhere the `sync` panel resets: `load()`, `select()`, `mutate()`'s publish, `authorityLost()`/`dispose()` (via `empty()`), and `changeSyncIndexPath` (the list/detail belong to the previous index path).
- A `packagesGeneration` token (same pattern as `syncGeneration`) increments on every reset; an in-flight browse/detail whose generation lags can never publish.
- A successful `startSync`/`showSyncResult` ALSO seeds the packages list from the same result (`result.entries` has exactly the `CatalogSyncEntry` shape): `packages = { catalogId, indexPath, list: result.value.entries, selected: null, detail: null, message: null }`. A failed sync read publishes `packages: null` together with the existing sync-panel message.
- `browsePackages`/`selectPackage` share the `runSyncOperation` gates: `closed`, `phase !== "ready"`, `!writable()`, open editor/confirmation, missing catalog detail or mismatched panel, empty `indexPath` → no-op; fresh `authorize(op)` bound to `expectedUserId` BEFORE the request; `unauthorized`/`forbidden` route to the existing authority-loss path; owned `read`-kind operation counted in `busy`; no automatic retry.
- `selectPackage` publishes only when the current sync panel still matches `catalogId` + trimmed `indexPath` and the packages panel still exists; on failure it keeps the list and publishes the fixed redacted `error.message` with `detail: null`.

Screen contract (Task 3; `apps/admin-ui/src/screens/CatalogsScreen.tsx`): a `PackagesSection` rendered directly after `SyncSection` under the SAME `catalog && !editor && !confirmation` condition (never for source details, editors or confirmations; no mobile/viewport changes): guidance text, a "Browse packages" secondary button (`disabled` when `disabled || emptyPath`), the list table (Kind/Name/Version/Digest/Location) when `packages.list` is present with an "Inspect" button ONLY on `locationType === "catalog"` rows and the fixed text "External — not inspectable locally." on `source` rows, the detail block when `packages.detail` is present, and `<p role="alert">` for `packages.message`. The detail block renders: identity/commit line; metadata (kind, name, version, digest, description, author, license); compatibility (`orgopsMin`–`orgopsMaxExclusive`, platforms, tools); secrets table (Name/Description/Required); dependencies table (Catalog/Source/Name/Version); files inventory table (Path/Size/Digest/Executable); execution preview (four labelled groups); warnings list with fixed per-code copy (`MANUAL_REVIEW_REQUIRED` → "Manual review is required before any use of this package.", `SENSITIVE_TEXT` → "Possible sensitive text detected.", `EXTERNAL_RUNTIME_NOT_PINNED` → "The external runtime is not pinned to an immutable revision.", unknown codes render the code text). All author-provided strings render as React text nodes only — no `dangerouslySetInnerHTML`, no anchor construction from manifest fields (external sources are shown as plain text), and no base64/file content is ever present in the decoded value. Inert framing copy: "Read-only inspection of the last synced catalog content. Nothing is fetched, installed, activated or executed."

### Security decisions requiring explicit parent sign-off

1. **Pure read reuse.** The new methods never call `transport.fetch`, never open `catalog_read_credentials`, never create or write mirror state (verify-only mode), and add no schema/audit/persistence change. Tests assert `calls.fetch` stays empty across every browsing call and the events table is unchanged.
2. **Disabled catalogs remain browseable**, exactly matching the Phase 10 GET read view (last-synced bytes stay inspectable after disable; removal blocks with `REMOVED`). This is a consistency decision with the existing read view, not new policy; flagged here for explicit confirmation.
3. **Detail commit selection.** Inspection always runs at the resolved `refs/orgops-sync/current` commit (the shallow `--depth=1` mirror holds only it). An index entry whose `location.revision.type === "exact"` pins a different commit is honored through the digest binding (`snapshot.manifest.digest === entry.digest`, else `INSPECTION_FAILED`) instead of reading a second commit; drift fails closed.
4. **New fixed error envelopes** (append-only, existing envelopes byte-identical): `EXTERNAL_LOCATION` 400 and `INSPECTION_FAILED` 502 with the exact messages above. Unknown/unsynced package and absent/invalid mirror reuse `NOT_FOUND` 404 (indistinguishable, same as the Phase 10 read view); invalid `name`/`version`/`indexPath` reuse `INVALID_REQUEST` 400.
5. **Response ceiling.** Every success body is serialized and rejected with `INSPECTION_FAILED` when over `CATALOG_BROWSE_LIMITS.responseJsonBytes = 1048576` — reject, never truncate; analytically unreachable under `CATALOG_LIMITS` (≤4096 bounded list entries; ≤256 KiB manifest + ≤256 bounded inventory/preview/warning fields).
6. **No content bytes leave the API.** The detail view strips `base64` from every `InspectedFile`; only `path/size/digest/executable` ship. The UI never receives file contents, the mirror path, the repository URL beyond configured metadata, ciphertext or any credential reference.
7. **UI rendering trust.** Mirrored bytes are untrusted; all manifest/preview/warning strings render as escaped text, never HTML or links; browsing grants no installation, activation or execution authority, and no affordance for those exists.

### Validation and chronology (every task/fix)

Before editing capture task base/full ref, cwd/branch, tracked/untracked status, diff/index to unique D paths; assert expected branch/state. Task 1 baseline BEFORE ANY source/test creation: accepted 2197 Vitest tests / 57 files + 3 opscli, unchanged 488 diagnostics (API 486 + agent-runner 2; ten workspaces clean including skills/schemas). Copy/adapt Phase-10 scripts into D only:

```bash
cd /home/slamnation/www/orgops
D="$PWD/.superpowers/sdd/2026-09-12-catalogs-11-package-browsing"
P="$PWD/.superpowers/sdd/2026-09-11-catalogs-10-live-github-sync"
cp "$P/parent-verify.sh" "$D/parent-verify.sh"
cp "$P/compare-lint.py" "$D/compare-lint.py"
python3 - <<'PY'
from pathlib import Path
D = Path('.superpowers/sdd/2026-09-12-catalogs-11-package-browsing')
p = D / 'parent-verify.sh'
s = p.read_text().replace('2026-09-11-catalogs-10-live-github-sync', '2026-09-12-catalogs-11-package-browsing')
p.write_text(s)
p = D / 'compare-lint.py'
s = p.read_text().replace("d=root/'.superpowers/sdd/2026-09-11-catalogs-10-live-github-sync'", "d=root/'.superpowers/sdd/2026-09-12-catalogs-11-package-browsing'")
s = s.replace('2026-09-11-catalogs-09-offline-local-evidence/parent-final-lint.json', '2026-09-11-catalogs-10-live-github-sync/parent-final-lint.json')
p.write_text(s)
PY
bash "$D/parent-verify.sh" task-1-baseline
python3 "$D/compare-lint.py" task-1-baseline > "$D/task-1-baseline-comparison.txt"
cmp "$P/parent-final-root-lint.txt" "$D/task-1-baseline-root-lint.txt"
```

All 12 workspaces independently: api, agent-runner, opscli, admin-ui, user-ui, db, schemas, event-bus, llm, crypto, skills, events-scenario-tests; plus root test/opscli/root lint = 15 exact unique exit labels and nonempty raw logs. Exact expected exits: test 0, opscli 0, root-lint 2, lint-api 2, lint-agent-runner 2, other 10 lint 0. Full path/line/column/code/multiline-message/multiplicity Counter comparison; reject unparsed/missing logs or wrong exits. No diagnostic-bearing source edits or position normalization. Root lint raw bytes must remain identical to the fresh Phase-11 baseline. Root lint short-circuits at API; never substitute it for all-workspace runs. Test count increases only from scoped new tests. The isolation wrapper never sources the real `.env` — automated runs source `.env.example` only:

```bash
D=/home/slamnation/www/orgops/.superpowers/sdd/2026-09-12-catalogs-11-package-browsing
isolated() {
  (ulimit -c 0; timeout --kill-after=5s 600s env -i PATH="$PATH" \
    HOME="$D/scratch/home" TMPDIR="$D/scratch/tmp" CI=1 \
    /bin/bash --noprofile --norc -c \
    'set -a; source .env.example; set +a; export ORGOPS_LLM_STUB=1; exec "$@"' bash "$@")
}
# Targeted example (replace label/file per task):
isolated npm exec --no -- vitest run apps/api/src/catalog-sync/browse.test.ts \
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
| 1 | Accepted base + parent-approved plan-only commit, clean tracked tree; full fresh baseline FIRST | `CATALOG_BROWSE_LIMITS`, browse types, `browseBase`, `listCatalogPackages`/`inspectCatalogPackage`, fixture-helper `files` param, the 2 error-table entries in `routes/catalogs.ts`, `browse.test.ts` | `readCatalogIndex`/`syncCatalog` behavior byte-identical (Phase 10 integration tests unmodified and green); exact frozen types; no fetch/credential path reachable; skills/schemas/db untouched |
| 2 | Parent-reviewed Task 1 commit; full Task 1 brief/common prefix | 2 GET routes; `catalogs.packages.integration.test.ts`; proof `app.ts` is unmodified | existing route tests byte-compatible; full auth matrix; leakage assertions; `calls.fetch` empty for all browsing; Cache-Control no-store asserted |
| 3 | Parent-reviewed Task 2 commit; full Task 2 brief/common prefix | UI api/state/screen + tests; SPEC/design/tasks docs | Phase 5/10 auth/race/supersession preserved; existing UI tests pass unmodified; no mobile layout; docs carry inert/untrusted caveats and honesty about bounds |

Shared dependencies available unchanged in all tasks: `PackageNameSchema`/`VersionSchema`/`CatalogIdSchema`/`RelativePathSchema`/`CATALOG_LIMITS` and the `CatalogEntry`/`PackageManifest`/`ReviewWarning` types from `@orgops/schemas`; `readGitCatalogIndex`/`inspectGitPackage`/`computePackageDigest` (tests only) and the `ExecutionPreview` type from `@orgops/skills`; `canManageCatalogs`/`AdminHuman` from `apps/api/src/admin-access`; `createCatalogConfiguration` metadata reads; `ensureCatalogMirror` verify-only mode and `CATALOG_SYNC_CURRENT_REF` from the Phase 10 modules. Review the preflight table plus `git diff --name-only TASK_BASE..HEAD` after every task.

After parent approves this entire plan: commit only the plan with `docs(catalogs): plan read-only catalog package browsing`; then generate the briefs with the ENTIRE identical shared prefix plus each own body via the installed SDD `task-brief` tool and verify exact bytes and taskCount:

```bash
cd /home/slamnation/www/orgops
D="$PWD/.superpowers/sdd/2026-09-12-catalogs-11-package-browsing"
PLAN="docs/superpowers/plans/2026-09-12-catalogs-11-package-browsing.md"
TB=/home/slamnation/.pi/agent/git/github.com/obra/superpowers/skills/subagent-driven-development/scripts/task-brief
awk '/^### Task 1([^0-9]|$)/{exit} {print}' "$PLAN" > "$D/shared-prefix.md"
for n in 1 2 3; do "$TB" "$PLAN" "$n" "$D/task-$n-body.md"; done
for n in 1 2 3; do cat "$D/shared-prefix.md" "$D/task-$n-body.md" > "$D/task-$n-brief.md"; done
python3 - <<'PY'
from pathlib import Path
import hashlib, re
root = Path('/home/slamnation/www/orgops')
D = root/'.superpowers/sdd/2026-09-12-catalogs-11-package-browsing'
plan = (root/'docs/superpowers/plans/2026-09-12-catalogs-11-package-browsing.md').read_text()
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

- Spec coverage: package list from the synced index (brief "Approved product boundary") → Task 1 service + Task 2 route + Task 3 UI list; single-package inert detail → Task 1 (`inspectCatalogPackage` digest-bound, base64-stripped) + Task 2 route + Task 3 detail rendering; external locations fail closed without fetch → Task 1 `EXTERNAL_LOCATION` + Task 2 matrix; admin-only routes + auth → Task 2; Phase 5/10 UI auth/race/supersession → Task 3; tests + docs → Tasks 1–3; baseline/validation discipline → shared prefix + every task.
- Explicitly NOT included (per brief): `prepareImport`, local skill-root reads, installed-origin persistence, installation/activation/start, publishing, migrations, audit event types, fetch/credential/transport changes, mobile layout, network use, `packages/skills`/`packages/schemas` changes.
- Type consistency: `CatalogPackageListView`/`CatalogPackageDetailView` (T1) → route JSON (T2) → UI `CatalogPackageListView`/`CatalogPackageDetail` decoders (T3); `CatalogSyncEntry` (existing UI type, shape `{kind,name,version,digest,locationType}`) is exactly the UI projection of `CatalogPackageListEntry`; `EXTERNAL_LOCATION`/`INSPECTION_FAILED` appear in the service union (T1), the route error table (T2) and the UI classify/copy (T3); `PackagesPanel`/`PackageSelection`/`browsePackages`/`selectPackage` (T3 state) match the screen section props (T3 screen).

### Task 1: Read-only browsing service on the Phase 10 mirror + fresh Phase-11 baseline

**Files:**
- Create (evidence): `D/parent-verify.sh`, `D/compare-lint.py` (copied/adapted from Phase 10), `D/task-1-baseline-*` logs
- Modify: `apps/api/src/catalog-sync/fixtures.test-helper.ts` (additive optional `files` parameter only)
- Modify: `apps/api/src/catalog-sync/sync.ts` (appended browse contract + private `browseBase`; `readCatalogIndex` reimplemented over it)
- Modify: `apps/api/src/routes/catalogs.ts` (append EXACTLY the two error-table entries `EXTERNAL_LOCATION`/`INSPECTION_FAILED`; no other line). REQUIRED here, not in Task 2: widening `CatalogSyncErrorCode` without them breaks the exhaustive `errors: Record<CatalogRouteErrorCode, …>` (new TS2739) and Task 1's api-lint-486 / root-byte-identical mandate.
- Test: `apps/api/src/catalog-sync/browse.test.ts`

**Interfaces:**
- Consumes: existing `createCatalogConfiguration`, `canManageCatalogs`, `ensureCatalogMirror` verify-only mode, `CATALOG_SYNC_CURRENT_REF`, `CatalogGitTransport`, `readGitCatalogIndex`, `inspectGitPackage`, `computePackageDigest` (tests only), and the schemas/types listed in the shared prefix.
- Produces: `CATALOG_BROWSE_LIMITS`, `CatalogPackageListEntry`, `CatalogPackageListView`, `CatalogPackageFileEntry`, `CatalogPackageDetailView`, the widened `CatalogSyncErrorCode` (with `EXTERNAL_LOCATION`/`INSPECTION_FAILED`), and `createCatalogSync`'s two new methods `listCatalogPackages(actorHumanId, catalogId, indexPath)` / `inspectCatalogPackage(actorHumanId, catalogId, indexPath, name, version)`. Task 2 consumes the two methods and the two new error codes; Task 3 consumes the route JSON shapes.

- [x] **Step 1: Capture TASK_BASE/state to `D/task-1-start.txt`; assert HEAD == the parent-approved plan-only commit, clean tree/index.**

- [x] **Step 2: Fresh Phase-11 baseline FIRST (before any source/test creation).** Run the shared-prefix script block: copy/adapt `parent-verify.sh`/`compare-lint.py` from Phase 10 into D, `bash "$D/parent-verify.sh" task-1-baseline`, `python3 "$D/compare-lint.py" task-1-baseline > "$D/task-1-baseline-comparison.txt"`, `cmp` the fresh root lint against Phase 10's `parent-final-root-lint.txt` (must be byte-identical: HEAD differs only by the docs-only plan commit). Record 2197 tests / 57 files + 3 opscli + 488 diagnostics in `D/task-1-report.md` notes. Any drift stops the task and is reported.

- [x] **Step 3: Extend the test-only fixture helper (additive).** In `fixtures.test-helper.ts`:

```ts
export type FixtureRepoFile = { path: string; contents: string };
export async function createLocalFixtureRepo(indexJson: string, gitExecutable = "/usr/bin/git",
  files: readonly FixtureRepoFile[] = []): Promise<LocalFixtureRepo> {
  // ...unchanged setup...
  for (const file of files) {
    const full = join(work, file.path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, file.contents);
  }
  await run(["add", "catalog/index.json", ...files.map(file => file.path)], work);
  // ...unchanged commit/clone/transport...
}
```

Add `dirname` to the `node:path` import. Existing one/two-argument callers remain byte-compatible (default `[]`).

- [x] **Step 4: Write the failing service test** `apps/api/src/catalog-sync/browse.test.ts`. Harness: `openDb(":memory:")`, real `createCatalogConfiguration({ db, findHuman, getMasterKey: () => masterKey, appendAudit: () => () => {} })`, owned `mkdtemp` mirrorsRoot, `createCatalogSync({ ..., transport })` with fixture transport doubles; mutable `findHuman` result to flip authority. Package builder (valid skill package, digest computed with the EXISTING pure function):

```ts
import { computePackageDigest } from "@orgops/skills";
import { createHash } from "node:crypto";
const sha256 = (s: string) => `sha256:${createHash("sha256").update(s).digest("hex")}`;
function skillPackage(name: string, version: string) {
  const skillMd = `---\nname: ${name}\ndescription: Demo skill.\nlicense: MIT\n---\nReturn a short acknowledgement.\n`;
  const manifest = {
    formatVersion: 1 as const, kind: "skill" as const, name, version,
    description: "Demo skill.", author: "Fixture Authors", license: "MIT",
    compatibility: { orgops: { min: "0.0.1" }, platforms: ["linux" as const], tools: [] as string[] },
    secrets: [], dependencies: [],
    files: [{ path: "SKILL.md", size: Buffer.byteLength(skillMd), digest: sha256(skillMd), executable: false }],
    executables: [], skill: { entrypoint: "SKILL.md" as const }, digest: `sha256:${"0".repeat(64)}`,
  };
  const entries = [{ type: "file" as const, path: "SKILL.md",
    base64: Buffer.from(skillMd).toString("base64"), executable: false }];
  const digest = computePackageDigest(manifest, entries);
  if (!digest.ok) throw new Error("fixture package invalid");
  return { manifest: { ...manifest, digest: digest.value }, skillMd, base64: entries[0].base64 };
}
function packageFiles(pkg: ReturnType<typeof skillPackage>, dir: string) {
  return [{ path: `${dir}/orgops-package.json`, contents: JSON.stringify(pkg.manifest) },
          { path: `${dir}/SKILL.md`, contents: pkg.skillMd }];
}
```

Primary fixture index (entry A catalog-local, entry B external):

```ts
const pkg = skillPackage("demo-skill", "1.0.0");
const externalDigest = `sha256:${"b".repeat(64)}`;
const indexJson = JSON.stringify({ formatVersion: 1, entries: [
  { kind: "skill", name: "demo-skill", version: "1.0.0", digest: pkg.manifest.digest,
    location: { type: "catalog", path: "skills/demo-skill", revision: { type: "catalog-revision" } } },
  { kind: "skill", name: "external-skill", version: "2.0.0", digest: externalDigest,
    location: { type: "source", sourceId: "gh", commit: "0123456789abcdef0123456789abcdef01234567", path: "skills/external-skill" } },
] });
const fixture = await createLocalFixtureRepo(indexJson, "/usr/bin/git", packageFiles(pkg, "skills/demo-skill"));
```

Secondary fixture for failure cases (entry C valid package with WRONG index digest; entry D path with an invalid manifest — declared file size `CATALOG_LIMITS.fileBytes + 1`): separate `createLocalFixtureRepo` + second source `gh2` (`https://github.com/org/repo2`) + catalog `ghc2`; compose one transport that dispatches `fetch` on `destination.fetchUrl.endsWith("repo2.git")` between the two fixture transports and reuses fixture A's `resolveRef`/`updateRef`/`deleteRef` (they operate on the mirror only).

Cases (each a real behavioral assertion through the service object):
1. **list happy path**: create source `gh` (`https://github.com/org/repo`) + catalog `ghc` via `configuration.mutate`; `syncCatalog("owner", "ghc", { expectedRevision: 1, indexPath: fixture.indexPath })` succeeds; `listCatalogPackages("owner", "ghc", fixture.indexPath)` → `{ ok: true, value: { catalogId: "ghc", sourceId: "gh", ref: "main", commit: fixture.commit, packages: [ { kind: "skill", name: "demo-skill", version: "1.0.0", digest: pkg.manifest.digest, locationType: "catalog" }, { kind: "skill", name: "external-skill", version: "2.0.0", digest: externalDigest, locationType: "source" } ] } }`; `Object.isFrozen(value.packages)` and `Object.isFrozen(value.packages[0])`; `JSON.stringify(value)` contains neither `root` nor `fixture.directory` nor `"ciphertext"`; `calls.fetch` has exactly the ONE sync fetch (browsing never fetches).
2. **detail happy path**: `inspectCatalogPackage("owner", "ghc", fixture.indexPath, "demo-skill", "1.0.0")` → ok; `value.files` equals `[{ path: "SKILL.md", size: <bytes>, digest: sha256(skillMd), executable: false }]` with EXACTLY those keys; `JSON.stringify(value)` does NOT contain `pkg.base64`; `value.manifest.name === "demo-skill"`; `value.warnings` contains `{ code: "MANUAL_REVIEW_REQUIRED", at: "$" }`; `value.execution` equals `{ apiEventShapes: [], runnerScripts: [], wrappedCommands: [], externalSources: [] }`; view is frozen.
3. **external location fails closed without fetch**: `inspectCatalogPackage(..., "external-skill", "2.0.0")` → `{ ok: false, code: "EXTERNAL_LOCATION" }`; `calls.fetch` length unchanged.
4. **unknown package / invalid identity**: unknown name → `NOT_FOUND`; name `"Bad Name"` → `INVALID_REQUEST`; version `"1.0"` → `INVALID_REQUEST`; indexPath `"../x"` → `INVALID_REQUEST`.
5. **unsynced catalog**: fresh source+catalog without sync → both methods `NOT_FOUND` (absent mirror).
6. **removed catalog**: `configuration.mutate` `catalog.remove` then list → `REMOVED`.
7. **disabled catalog stays readable**: after a successful sync, `catalog.update` `enabled: false`, then `listCatalogPackages` still ok with the same commit — documents the Phase-10-consistent read decision; `syncCatalog` on it now returns `STATE_CONFLICT` (unchanged Phase 10 behavior, asserted for contrast).
8. **authority recheck**: `findHuman` returning `{ isAdmin: false, mustChangePassword: false }`, `{ isAdmin: true, mustChangePassword: true }` and `undefined` → `FORBIDDEN` for both methods; an invalid `name` with a denied principal still returns `FORBIDDEN` (auth-first, no validation oracle).
9. **digest binding**: catalog `ghc2` entry C → `INSPECTION_FAILED`.
10. **oversized/invalid package fails bounded**: entry D → `INSPECTION_FAILED` (manifest declares a file of `fileBytes + 1` bytes; rejection precedes any oversized allocation).
11. **unchanged read view**: `readCatalogIndex("owner", "ghc", fixture.indexPath)` still returns the full `{ catalogId, sourceId, ref, commit, index }` view with `index.entries` length 2 (byte-compatible Phase 10 behavior through the refactor).

- [x] **Step 5: RED.** Run `isolated npm exec --no -- vitest run apps/api/src/catalog-sync/browse.test.ts` → interface-only RED (methods absent on the service type) recorded as `D/task-1-red-1.{txt,exit}` and labelled honestly; then add a minimal stub (`listCatalogPackages`/`inspectCatalogPackage` returning `{ ok: false, code: "STORAGE_FAILURE" }`) and rerun → behavioral RED `D/task-1-red-2.{txt,exit}` (happy-path assertions fail on the wrong code). Preserve both.

- [x] **Step 6: GREEN.** Implement the shared-prefix contract exactly in `sync.ts` (browse types, `CATALOG_BROWSE_LIMITS`, appended codes, `browseBase`, `readCatalogIndex` wrapper, the two methods, `freezeView`/`withinResponseCeiling` helpers, new imports). Rerun the targeted file → `D/task-1-green-1.txt`. Then run the Phase 10 sync integration test `apps/api/src/catalogs.sync.integration.test.ts` and the mirror/git-fetch suites → unchanged GREEN `D/task-1-green-2.txt`.

- [x] **Step 7: Full validation + scoped commit.**

```bash
LABEL=task-1-final-1
bash "$D/parent-verify.sh" "$LABEL"
python3 "$D/compare-lint.py" "$LABEL" > "$D/$LABEL-comparison.txt"
cmp "$D/task-1-baseline-root-lint.txt" "$D/$LABEL-root-lint.txt"
git diff --check
git add apps/api/src/catalog-sync/fixtures.test-helper.ts apps/api/src/catalog-sync/sync.ts apps/api/src/routes/catalogs.ts apps/api/src/catalog-sync/browse.test.ts
git commit -m "feat(catalogs): add read-only package browsing service"
```

### Task 2: Admin-only browsing routes + HTTP integration matrix

**Files:**
- Modify: `apps/api/src/routes/catalogs.ts` (append 2 GET routes ONLY; the `EXTERNAL_LOCATION`/`INSPECTION_FAILED` error-table entries were already appended by Task 1 so the exhaustive `errors` Record compiles without an api-lint increase)
- Test: `apps/api/src/catalogs.packages.integration.test.ts`
- Verify-only: `apps/api/src/app.ts` (assert unmodified; `git diff --exit-code TASK_BASE -- apps/api/src/app.ts`)

**Interfaces:**
- Consumes: Task 1 `listCatalogPackages`/`inspectCatalogPackage` and `EXTERNAL_LOCATION`/`INSPECTION_FAILED`; existing `readBody`/`failure` helpers, `requireAuth`/`requireAdmin`, `CatalogIdSchema`/`RelativePathSchema` (both already imported in `routes/catalogs.ts` by the Phase 10 routes — verify at implementation time with `grep -n RelativePathSchema apps/api/src/routes/catalogs.ts`; add NO import line).
- Produces: `GET /api/catalogs/:catalogId/packages?indexPath=…` → 200 `CatalogPackageListView` JSON; `GET /api/catalogs/:catalogId/packages/:name/:version?indexPath=…` → 200 `CatalogPackageDetailView` JSON; fixed `{error, code}` envelopes otherwise. Task 3 consumes both response shapes and the error codes.

- [x] **Step 1: Capture TASK_BASE/state to `D/task-2-start.txt`; assert HEAD == Task 1 commit, clean tree/index.**

- [x] **Step 2: Write the failing integration test** `apps/api/src/catalogs.packages.integration.test.ts`, harness copied from `catalogs.sync.integration.test.ts` (in-memory db, `createApp({ db, dataDir, adminUser/adminPass, runnerToken, catalogSyncTransport, catalogGitExecutable: "/usr/bin/git" })`, `vi.stubEnv` master key, `fetch`/console guards, fixture repos from Task 1's extended helper, `errors` table extended with the two new envelopes). Cases:

```ts
const listPath = "/api/catalogs/ghc/packages";
const detailPath = "/api/catalogs/ghc/packages/demo-skill/1.0.0";
const query = `?indexPath=${encodeURIComponent(fixture.indexPath)}`;

it("lists and details synced packages without secrets, host paths or fetches", async () => {
  await createGh();                                   // source gh + catalog ghc (as in the Phase 10 harness)
  await json(await request("POST", syncPath, { expectedRevision: 1, indexPath: fixture.indexPath }));
  expect(calls.fetch).toHaveLength(1);
  const before = eventsCount();
  const list = await json(await request("GET", `${listPath}${query}`));
  expect(list).toEqual({ catalogId: "ghc", sourceId: "gh", ref: "main", commit: fixture.commit,
    packages: [
      { kind: "skill", name: "demo-skill", version: "1.0.0", digest: pkg.manifest.digest, locationType: "catalog" },
      { kind: "skill", name: "external-skill", version: "2.0.0", digest: externalDigest, locationType: "source" },
    ] });
  const detail = await json(await request("GET", `${detailPath}${query}`));
  expect(detail.files).toEqual([{ path: "SKILL.md", size: Buffer.byteLength(pkg.skillMd), digest: sha256(pkg.skillMd), executable: false }]);
  expect(detail.warnings).toContainEqual({ code: "MANUAL_REVIEW_REQUIRED", at: "$" });
  const raw = JSON.stringify({ list, detail });
  expect(raw).not.toContain(root);                    // no host/mirror path
  expect(raw).not.toContain("ciphertext");
  expect(raw).not.toContain("github.com/org/repo");   // no repository URL in browsing views
  expect(raw).not.toContain(pkg.base64);              // no file content bytes
  expect(calls.fetch).toHaveLength(1);                // browsing NEVER fetches
  expect(eventsCount()).toBe(before);                 // no events rows
}, 30000);

it("enforces admin authority for both browsing routes", async () => {
  // same 6-case matrix as the Phase 10 test: no cookie → 401 {error:"Unauthorized"};
  // ordinary human → 403; global runner token → 403; scoped runner token → 403;
  // scoped runner token + admin cookie → 403; admin with must_change_password=1 → 403
  // (envelope {error:"Administrator access required"}, no code field). calls.fetch stays empty.
});

it("validates path params and query with fixed redacted codes", async () => {
  await createGh();
  await error(await request("GET", listPath), "INVALID_REQUEST");                       // missing indexPath
  await error(await request("GET", `${listPath}?indexPath=../x`), "INVALID_REQUEST");
  await error(await request("GET", `${listPath}?indexPath=.git/x`), "INVALID_REQUEST");
  await error(await request("GET", `/api/catalogs/ghc/packages/Bad%20Name/1.0.0${query}`), "INVALID_REQUEST");
  await error(await request("GET", `/api/catalogs/ghc/packages/demo-skill/1.0${query}`), "INVALID_REQUEST");
  await error(await request("GET", `/api/catalogs/unknown/packages${query}`), "NOT_FOUND");
});

it("fails closed for unsynced, removed, unknown, external and broken packages", async () => {
  await createGh();
  await error(await request("GET", `${listPath}${query}`), "NOT_FOUND");               // never synced
  await json(await request("POST", syncPath, { expectedRevision: 1, indexPath: fixture.indexPath }));
  await error(await request("GET", `/api/catalogs/ghc/packages/ghost/1.0.0${query}`), "NOT_FOUND");
  const external = await request("GET", `/api/catalogs/ghc/packages/external-skill/2.0.0${query}`);
  expect(await json(external, 400)).toEqual({ error: "Package content is external to this catalog; only catalog-local packages can be inspected", code: "EXTERNAL_LOCATION" });
  // removed catalog: DELETE with current revision then both routes → 410 REMOVED
  // broken package on ghc2 (wrong digest / oversized declaration): → 502 { error: "Package inspection failed; synced content is unchanged", code: "INSPECTION_FAILED" }
  expect(calls.fetch).toHaveLength(1);                 // the only fetch ever was the one sync
}, 30000);

it("keeps a disabled catalog browseable, consistent with the Phase 10 read view", async () => {
  await createGh();
  await json(await request("POST", syncPath, { expectedRevision: 1, indexPath: fixture.indexPath }));
  await json(await request("PATCH", "/api/catalogs/ghc", { expectedRevision: 2, enabled: false }));
  const list = await json(await request("GET", `${listPath}${query}`));
  expect(list.commit).toBe(fixture.commit);
  await error(await request("POST", syncPath, { expectedRevision: 3, indexPath: fixture.indexPath }), "STATE_CONFLICT");
});
```

Every `json()` assertion also checks `Cache-Control: no-store` (existing helper behavior).

- [x] **Step 3: RED** (`D/task-2-red-1.{txt,exit}`): both routes 404 with the stock Hono body — behavioral RED, since the failure is the missing route, not an interface stub. Preserve the raw log.

- [x] **Step 4: Implement** the two appended GET routes only; the two error-table entries are already present from Task 1 (verify with `grep -n "EXTERNAL_LOCATION\|INSPECTION_FAILED" apps/api/src/routes/catalogs.ts`). No other line of `routes/catalogs.ts` changes; do NOT duplicate the entries.

- [x] **Step 5: GREEN targeted, then regression:** the new file, `catalogs.sync.integration.test.ts`, `catalogs.integration.test.ts`, and the Task 1 service file all green (`D/task-2-green-1.txt`, `D/task-2-green-2.txt`). Assert `git diff --exit-code TASK_BASE -- apps/api/src/app.ts packages/` is clean (no app wiring or package changes in this phase).

- [x] **Step 6: Full validation + scoped commit.**

```bash
LABEL=task-2-final-1
bash "$D/parent-verify.sh" "$LABEL"
python3 "$D/compare-lint.py" "$LABEL" > "$D/$LABEL-comparison.txt"
cmp "$D/task-1-baseline-root-lint.txt" "$D/$LABEL-root-lint.txt"
git diff --check
git add apps/api/src/routes/catalogs.ts apps/api/src/catalogs.packages.integration.test.ts
git commit -m "feat(catalogs): add admin-only package browsing routes"
```

### Task 3: Desktop packages browsing UI + docs

**Files:**
- Modify: `apps/admin-ui/src/catalogs/api.ts` (types, 2 methods, decoders, 2 classify rows, 3 copy entries), `apps/admin-ui/src/catalogs/api.test.ts`
- Modify: `apps/admin-ui/src/catalogs/configuration-state.ts` (`PackagesPanel`, `packages` snapshot field, `browsePackages`/`selectPackage`, generation/lifecycle), `apps/admin-ui/src/catalogs/configuration-state.test.ts`
- Modify: `apps/admin-ui/src/screens/CatalogsScreen.tsx` (`PackagesSection` + detail rendering), `apps/admin-ui/src/screens/CatalogsScreen.test.tsx`
- Docs: `docs/SPEC.md`, `docs/superpowers/specs/2026-09-09-skill-agent-catalogs-design.md` (status paragraph only), `docs/research/skill-agent-sharing-tasks.md`

**Interfaces:**
- Consumes: Task 2 routes/JSON; existing `CatalogSyncEntry`, `runSyncOperation` discipline, `CatalogsView` structure.
- Produces: `CatalogPackageListView`, `CatalogPackageDetail`, `CatalogApi.listCatalogPackages`/`getCatalogPackage`; `PackageSelection`, `PackagesPanel`, `ConfigurationSnapshot.packages`, `ConfigurationController.browsePackages`/`selectPackage`; the `PackagesSection` markup contract used by the screen tests. Nothing after this task consumes new interfaces.

- [x] **Step 1: Capture TASK_BASE/state to `D/task-3-start.txt`; assert HEAD == Task 2 commit, clean tree/index.**

- [x] **Step 2: api.ts RED/GREEN.** Extend the `mappings` table with both calls (`GET /api/catalogs/<id>/packages?indexPath=<encoded>` and `GET /api/catalogs/<id>/packages/<name>/<version>?indexPath=<encoded>`, URI-component-encoded segments), decoding through `packageListView`/`packageDetail`. Failure rows: `400 EXTERNAL_LOCATION` → `invalid` + `copy.externalLocation`; `502 INSPECTION_FAILED` → `unavailable` + `copy.inspectionFailed`; list 404 → `missing` + `copy.notSynced`; detail 404 → `missing` + `copy.packageMissing`. Malformed-detail rejections (`null`, `{}`, manifest not an object, `files` not an array, entry with empty `path`, `execution.wrappedCommands` not an array, warning with empty `code`) → `protocol`. Secret-drop test: a raw detail body embedding extra `"credential":"syn-marker"` fields at top level, inside `manifest` and inside `execution` decodes successfully and `JSON.stringify(result)` never contains `syn-marker`. Decoders exactly per the shared-prefix guards (`object`/`text`/`boolean`/`nonNegativeInt`/`stringArray` helpers; `nonNegativeInt` mirrors the existing `timestamp` guard shape). RED first (methods absent → type error, honest interface-only RED label), then GREEN.

- [x] **Step 3: configuration-state.ts RED/GREEN.** Implement the shared-prefix lifecycle exactly: `packages: null` in `empty()`; resets at every sync-panel reset site plus `changeSyncIndexPath`; `packagesGeneration` supersession; sync success seeding `packages.list` from `result.entries`; sync failure publishing `packages: null`; the two new methods under owned `read` operations with fresh `authorize`. Tests (mirroring the existing sync-panel tests): browse populates the list from a successful response; select loads the detail; an indexPath change between request and settle blocks publication; a selection switch clears the panel and blocks a late detail publish; 401/403 route to authority loss; a `missing` outcome publishes `copy.packageMissing` on the panel with `detail: null`; busy gating refuses a second concurrent browse; no automatic retry after `network`/`protocol`. RED (absent methods/panel), then GREEN.

- [x] **Step 4: CatalogsScreen.tsx RED/GREEN (SSR markup tests).** Render `PackagesSection` directly after `SyncSection` under the same `catalog && !editor && !confirmation` condition:

```tsx
function PackagesSection({ state, actions, disabled }: { state: ConfigurationSnapshot; actions: ConfigurationController; disabled: boolean }) {
  const sync = state.sync;
  const packages = state.packages;
  const emptyPath = (sync?.indexPath ?? "").trim() === "";
  return <section aria-label="Catalog packages" className="space-y-3 border border-slate-800 rounded p-3">
    <h3 className="font-medium">Catalog packages</h3>
    <p className="text-sm text-slate-400">Read-only inspection of the last synced catalog content. Nothing is fetched, installed, activated or executed.</p>
    <Button type="button" variant="secondary" disabled={disabled || emptyPath} onClick={() => { void actions.browsePackages(); }}>Browse packages</Button>
    {packages?.list && <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr>
      {["Kind", "Name", "Version", "Digest", "Location"].map(label => <th scope="col" className="p-2" key={label}>{label}</th>)}
    </tr></thead><tbody>{packages.list.map(entry => <tr key={`${entry.kind}:${entry.name}:${entry.version}`} className="border-t border-slate-800">
      <td className="p-2">{entry.kind}</td><td className="p-2 break-words">{entry.name}</td><td className="p-2">{entry.version}</td><td className="p-2 break-all">{entry.digest}</td>
      <td className="p-2">{entry.locationType === "catalog"
        ? <Button type="button" variant="secondary" disabled={disabled} onClick={() => { void actions.selectPackage({ name: entry.name, version: entry.version }); }}>Inspect</Button>
        : "External — not inspectable locally."}</td>
    </tr>)}</tbody></table></div>}
    {packages?.detail && <PackageDetail detail={packages.detail} />}
    {packages?.message && <p role="alert">{packages.message}</p>}
  </section>;
}
```

`PackageDetail` renders the identity/commit line, metadata `dl`, compatibility line, secrets and dependencies tables, the files inventory table (Path/Size/Digest/Executable), the four execution-preview groups (each rendered only when non-empty; wrapped commands as `command` + joined args text; external sources as `github:<repo>(@<ref>)` plain text, never a link) and the warnings list with the fixed per-code copy from the shared prefix. Tests assert: the section is absent for source details and while an editor/confirmation is open; the browse button is disabled with an empty index path; a seeded `packages.list` renders both row kinds with an "Inspect" button only on the catalog-local row; a populated `packages.detail` renders name/version/description/author/license, the SKILL.md inventory row with its digest, the empty-preview groups absent, and the `MANUAL_REVIEW_REQUIRED` warning copy; author-provided markup in a description (e.g. `<b>x</b>`) is escaped in the markup; the alert shows the fixed failure copy; existing Phase 5/10 screen tests pass unmodified.

- [x] **Step 5: Docs.** `docs/SPEC.md`: append a "Read-only catalog package browsing and detail" subsection right after the Phase 10 sync subsection documenting: the two GET routes with exact success shapes and the two appended error envelopes; reuse of the verify-only mirror + `refs/orgops-sync/current` + unchanged `readGitCatalogIndex`/`inspectGitPackage`; the current-commit + index-digest binding rule for `exact` revisions; the base64-stripped inventory; the 1 MiB reject-not-truncate response ceiling; the disabled-catalog read consistency; the no-fetch/no-credential/no-persistence guarantees; and the untrusted-content caveats (no installation/activation/execution authority). Design spec status paragraph: append the Phase 11 sentence (read-only browsing/detail implemented/reviewed/verified; mobile shell still outstanding). `skill-agent-sharing-tasks.md`: add the completed Phase 11 line. `docs/catalog-package-contract.md` stays unchanged.

- [x] **Step 6: Full validation + scoped commits.**

```bash
LABEL=task-3-final-1
bash "$D/parent-verify.sh" "$LABEL"
python3 "$D/compare-lint.py" "$LABEL" > "$D/$LABEL-comparison.txt"
cmp "$D/task-1-baseline-root-lint.txt" "$D/$LABEL-root-lint.txt"
git diff --check
git add apps/admin-ui/src/catalogs/api.ts apps/admin-ui/src/catalogs/api.test.ts \
        apps/admin-ui/src/catalogs/configuration-state.ts apps/admin-ui/src/catalogs/configuration-state.test.ts \
        apps/admin-ui/src/screens/CatalogsScreen.tsx apps/admin-ui/src/screens/CatalogsScreen.test.tsx
git commit -m "feat(catalogs): add desktop catalog package browsing"
git add docs/SPEC.md docs/superpowers/specs/2026-09-09-skill-agent-catalogs-design.md docs/research/skill-agent-sharing-tasks.md
git commit -m "docs(catalogs): document read-only catalog package browsing"
```
