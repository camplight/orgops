# Catalog Package Installation Write Path (Phase 13) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (parent controller only) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Workers must not launch nested agents.

**Goal:** Let an administrator install ONE selected catalog-local SKILL package (and its resolved skill dependency closure) from an already-synced catalog into an owned installed-packages store outside the live skills root — with atomic no-replace target-name claims, never executing authored content, never fetching, never reading credentials — while persisting each installed package's origin (migration `033`) so the import preview becomes origin-aware (recorded origin + unchanged content → honest `reuse`; everything else occupied/fail-closed). Agent kinds (`native-agent`/`wrapped-agent`) fail with a fixed not-yet-installable code; secrets, agent creation, start/activation gates, publishing and mobile are Phase 14+ and out of scope.

**Architecture:** One hand-written migration `033_catalog_installed_origins.sql` plus the matching hand-edited `packages/db/src/schema.ts` table records each installed skill's full `ResolvedIdentity` origin, local path, actor and time (no approval/authority/runnable state). A new `apps/api/src/catalog-installed.ts` accessor (constructed inside `createCatalogSync` from the existing `db` dep) reads all origins and writes rows in one transaction. `createCatalogSync` gains one `installRoot: string` dep (production `<DATA_DIR>/catalog-installed`, AppConfig test seam) and a new `installCatalogPackage` method; the Phase 12 preview composition is refactored into a shared private `importBase` (sync.ts carries ZERO baseline diagnostics, so intra-file moves are position-safe) that both `previewCatalogImport` and `installCatalogPackage` use: Phase 11 `browseBase` preconditions, configured sources/synced catalogs, bounded `inspectGitPackage` supply, origin-aware installed evidence (`readLocalSkillEvidence` over the install root with recorded names nominated → `measured`; unmanaged store/live-root names and recorded-but-mismatched names → `occupied`) and origin rows as `knownReleases` (changed content under a known version fails `IDENTITY_CONFLICT`). The UNCHANGED `prepareImport` remains the single resolution/reuse/conflict authority. Includes use exclusive target-directory claims followed by staged-content promotion under `<installRoot>/<name>/` with rollback of only created paths and origin rows written last; reuse is a no-op. One admin-only `POST /api/catalogs/:catalogId/install` route (strict bounded body with `confirm: true` literal + optional `expectedRevision` guard) returns a frozen portable base64-free result. The desktop Catalogs screen gains a two-step install control inside the import-preview section with an inert result panel.

**Tech Stack:** Existing TypeScript, Hono routes, `better-sqlite3` (hand-written numbered migrations + hand-edited drizzle schema), `@orgops/schemas` primitives (unchanged), `@orgops/skills` (`prepareImport`, `readLocalSkillEvidence`, `inspectGitPackage`, `IMPORT_LIMITS`, unchanged), React admin-ui, colocated Vitest; npm only. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-09-skill-agent-catalogs-design.md` (§7 installation/execution boundary); `docs/SPEC.md` (Phase 10 sync, Phase 11 browsing, Phase 12 import-preview subsections); `docs/catalog-package-contract.md` (offline import preparation + offline local skill-root evidence); binding `.superpowers/sdd/2026-09-13-catalogs-13-installation/controller-brief.md`.

## Final-review correction (approved final fix wave)

The original ordinary temp-directory rename mechanism is superseded: Node's
rename may replace a foreign empty target. Exclusive non-recursive target
`mkdir` is the atomic no-replace name claim; staged entries are promoted only
inside that owned target. Partial inert-store visibility before origin
persistence is acceptable, with OrgOps readers failing closed as unmanaged
occupancy. Origins still persist only after complete content in one transaction.
All outstanding temps and this call's claimed targets are rolled back on caught
failure. Crash-durable filesystem+SQLite transactionality, failed cleanup and
hostile same-UID mutation remain residuals. The original briefs and raw RED logs
are historical, not updated proofs. The scoped final re-review approved all six
corrections, and fresh independent parent verification completed: 2379 Vitest
tests/65 files, 3 opscli tests, exact unchanged 488 diagnostics, byte-identical
root lint, and fresh standalone migration 033 application/idempotency on an
owned database.

## Global Constraints / Entire Identical Shared Task Prefix

Everything before `### Task 1` is the ENTIRE shared contract and must prefix every task brief byte-for-byte. The installed SDD script extracts only a task body: preserve each raw extraction, then prepend this prefix to a distinct final brief. No shared requirements occur after the task bodies.

### Authority and workflow

- Work only in `/home/slamnation/www/orgops`, existing branch `88-move-private-skills-into-a-private-repo`. Accepted planning base: `57dab97107ce7528af7aa3c3129d02c1851894b4` (Phase 12 acceptance), initially clean tracked tree/index. `D=/home/slamnation/www/orgops/.superpowers/sdd/2026-09-13-catalogs-13-installation`.
- PLANNING gate: parent reads the ENTIRE concrete plan and explicitly approves it before a plan commit or any source/test edit. Planner remains available for corrections. Planning commit contains ONLY this plan. New phase artifacts, probe attempts, task briefs and logs remain under D and unstaged. Prior phases and their evidence remain read-only.
- One sequential writer, fresh read-only task review after each task/fix, whole-phase review and independent fresh parent verification. No nested agents, worktrees, pushes, merges, remote writes, dependency/package/lock changes. Never read `.env` or `VAULT_REPO_TOKEN` in automated tests or validation. NO network anywhere in this phase: every Git operation runs against owned local fixture repositories via the existing transport double; there is no live smoke in this phase.
- Binding owner decisions: Q1 = GitHub-hosted repositories ONLY; Q2 = desktop-first (the phone-width/mobile admin shell is a separate required pre-final task and OUT OF SCOPE here). The owner's four installation recommendations are binding: (1) persist installed origins so previews honestly show reuse and install is idempotent; (2) installing writes verified content and never executes authored code; (3) secrets are references only (Phase 14); (4) admin-only, explicit confirmation, imported agents start stopped, no auto-enablement, immutable releases, conflicts block.
- This phase adds NO other new product/security policy: no agent creation (native/wrapped), no `agents`/soul/runtime writes, no secret references/bindings, no start/activation gates or requirement enforcement, no approval capability, no publishing/GitHub submission, no retained history beyond the minimal origin row, no scheduled work, no other transports, no mobile layout, no audit event type, and NO `packages/skills`/`packages/schemas` semantic change.
- Escalate a material gap through `contact_supervisor` and wait; report blocked if useful work needs new owner policy.
- Tool/runtime/extension/native-output-contract failures stop immediately with exact error, run identifier, cwd, branch/full ref, status, worktree diff and index diff. Continue only on explicit same-native-protocol recovery; never external CLI/foreground fallback. Native `structured_output` verdict is mandatory, not inferred from Markdown.
- New disk fixtures are only new owned directories under D/scratch via phase-owned TMPDIR (tests themselves use ambient `os.tmpdir()` mkdtemp so plain `npm test` still passes), cleaned in awaited finally blocks. Automated tests NEVER touch the network, a real `.env`, `VAULT_REPO_TOKEN`, the real repo `skills/` root (the local root AND the install root are ALWAYS owned injected fixture roots in tests), or production DATA_DIR. The install path spawns only the existing bounded read-only Git inspection children, executes no repository-authored content, and never opens the credential store (`getMasterKey` is never called on the preview/install path); its only writes are inside the owned install root plus the new DB rows.

### Authored-module activation boundary (MANDATORY resolution — mechanism 2 chosen)

The API composes its event-shape registry at request time in `apps/api/src/routes/events.ts` (`getEventShapes`, cache TTL `ORGOPS_EVENT_SHAPES_CACHE_TTL_MS`, default 3000 ms): on every refresh it calls `listSkills(SKILL_ROOT)` (every immediate child directory of the live skills root with a parseable `SKILL.md` whose frontmatter `name` equals the directory name) and then `loadSkillEventShapes`, which **dynamic-imports** any `event-shapes.ts`/`event-shapes.js` inside each listed skill directory (`packages/skills/src/index.ts`). `loadSkillEventShapes`/`listSkills` live in `packages/skills` and CANNOT change this phase, and there is no other API-side load path (the runner reads skills only for agents that explicitly enable them; installation never enables anything).

A naive install writing a package's `event-shapes.ts` into the live skills root would therefore make the API EXECUTE authored module code on the next cache refresh, which the approved design forbids without separate explicit activation approval. The three candidate mechanisms from the controller brief were evaluated:

1. **Omit/quarantine `event-shapes.ts` (and `event-shapes.js`) at install** — REJECTED. `inspectPackage` (unchanged) requires the local file inventory to match the manifest exactly (`INVENTORY_MISMATCH` otherwise), and reuse requires `currentDigest === manifest.digest`. An omitted file makes the measured local content permanently mismatch the recorded origin, so exactly the highest-risk packages would fail closed FOREVER and reinstall would never be idempotent — or the service would have to fabricate equivalence, which is forbidden.
2. **CHOSEN: install the COMPLETE verified package bytes into an owned installed-packages store OUTSIDE the live skills root** (production `<DATA_DIR>/catalog-installed`, sibling of `catalog-mirrors`; AppConfig test seam `catalogInstallRoot`), and promote into the live root only on an explicit Phase 14 activation approval (NOT implemented here). Bytes on disk outside `SKILL_ROOT` are inert: the API's only dynamic-import path enumerates `SKILL_ROOT` exclusively, so installed content can never be loaded. Full byte-exact content keeps the UNCHANGED `prepareImport` reuse semantics honest (`currentDigest === manifest.digest`), keeps reinstall idempotent, and the store location itself IS the not-yet-activated marker (the origin table carries no approval/authority/runnable state). Consequence: installed skills are deliberately NOT visible to `listSkills`, agent skill enabling, or prompts until Phase 14 activation.
3. **An install-time control that hides unactivated content from the API loader** — REJECTED: the loader lives in `packages/skills` (semantic change forbidden) and any in-root rename/quarantine reintroduces mechanism 1's digest mismatch.

Required proofs/records: (a) the install path never evaluates authored content (only byte writes); (b) a Task 2 test installs a package whose `event-shapes.ts` sets a global side-effect marker on evaluation and proves the marker never fires during install AND that `loadSkillEventShapes(listSkills({ path: <fixture LIVE root> }))` — the exact API load path — neither sees the installed skill nor fires the marker after installation; (c) `docs/SPEC.md` states the exact boundary and the Phase 14 activation hand-off; (d) the Phase 14 approval mechanism is NOT implemented; installed state is visibly not-yet-activated (store location + `activated: false` result field + UI copy).

### Read/map evidence and unchanged seams

Planner read full AGENTS.md, the approved design (`docs/superpowers/specs/2026-09-09-skill-agent-catalogs-design.md`, incl. §7 "Event-schema modules: never load them during discovery or staging" and the reuse/local-edit rule), `docs/SPEC.md` including the Phase 10 "Live GitHub catalog synchronization (read-only)", Phase 11 "Read-only catalog package browsing and detail" and Phase 12 "Read-only catalog import preview (Option A)" subsections, the relevant `docs/catalog-package-contract.md` sections (offline import preparation incl. "Evidence checked versus trusted assertions", offline local skill-root evidence, exact resolution and history), and all current anchors: `packages/db/src/{index,schema}.ts` (custom ordered `migrate()`, `migrations` table, drizzle table conventions incl. check constraints) and `packages/db/migrations/032_catalog_source_configuration.sql` (latest; next free number is `033`); `packages/db/src/index.test.ts` (migration smoke pattern); `packages/skills/src/index.ts` (`listSkills`/`loadSkillEventShapes`/`resolveSkillRoot` — READ-ONLY this phase); `packages/skills/src/catalogs/{import,import-types,import-evidence,resolve,source-policy,content,export,local-skill-evidence,local-skill-evidence-types,local-skill-root}.ts`; `apps/api/src/app.ts` (composition root; `SKILL_ROOT` at line ~121; `createCatalogSync` wiring at ~457–464; `/api/catalogs*` `Cache-Control: no-store` middleware at ~426; the THREE existing app.ts diagnostics sit at lines 339–341); `apps/api/src/routes/catalogs.ts` (19-entry error table, `readBody` 16384-byte bound, runner-denial guard, `ImportPreviewRequestSchema`); `apps/api/src/routes/agents.ts` (reviewed for skill-loading/agent-creation helpers — READ-ONLY, untouched); `apps/api/src/catalog-configuration.ts` (`listSources`/`listCatalogs`/`getCatalog`/`getSource`); `apps/api/src/admin-access.ts` (`canManageCatalogs`); `apps/api/src/catalog-sync/{sync,mirror,git-fetch,github-destination,fixtures.test-helper}.ts` and the `browse`/`import-preview`/`mirror`/`git-fetch` tests; `apps/api/src/catalogs.{sync,packages,import-preview}.integration.test.ts`; `apps/admin-ui/src/catalogs/{api,configuration-state}.ts` + tests, `apps/admin-ui/src/screens/CatalogsScreen.tsx` + test, `apps/admin-ui/src/hooks/useCatalogConfiguration.ts`. Neither `apps/api/src/catalog-sync/sync.ts` nor `apps/api/src/routes/catalogs.ts` carries ANY of the 486 baseline api diagnostics (verified against a fresh `tsc` run); `apps/api/src/app.ts` carries exactly 3, at lines 339–341, and every app.ts edit in this plan is either below them or line-neutral (documented in sign-off item 8).

| Path / interface | Owner | Responsibility / preflight |
|---|---|---|
| D/`parent-verify.sh`, D/`compare-lint.py` | Task 1 | Copy/adapt Phase-12 verification scripts into D only; fresh Phase-13 baseline logs FIRST (accepted 2297 Vitest/61 files + 3 opscli, 488 diagnostics) |
| `packages/db/migrations/033_catalog_installed_origins.sql` | Task 1 | New table `catalog_installed_origins`; BEGIN/COMMIT; check constraints like 032 |
| `packages/db/src/schema.ts` | Task 1 | Hand-edited `catalogInstalledOrigins` table + `schema` registration, kept in agreement with the SQL by hand; db workspace stays at 0 diagnostics |
| `packages/db/src/catalog-installed-origins.test.ts` | Task 1 | Migration applies on fresh AND pre-033 existing DB; order/idempotency; SQL↔schema.ts agreement; kind check constraint. Owned mkdtemp DBs only |
| `apps/api/src/catalog-installed.ts` | Task 1 | `createCatalogInstalled({ db })`: `list()` + `recordAll(rows)` (one transaction); redacted `{ok:false}` failures; no delete/uninstall (Phase 14+) |
| `apps/api/src/catalog-installed.test.ts` | Task 1 | Accessor roundtrip/field mapping/PK-conflict atomicity/missing-table redaction |
| `apps/api/src/catalog-sync/sync.ts` | Task 2 | Append `INSTALL_REJECTED`/`KIND_NOT_INSTALLABLE`/`INSTALL_IN_PROGRESS` to `CatalogSyncErrorCode`; `CATALOG_INSTALL_LIMITS`; install types; `CatalogSyncDeps` gains exactly `installRoot: string`; construct `createCatalogInstalled({ db })` internally; extract shared private `importBase`; rewrite `previewCatalogImport` onto it (origin-aware); add `installCatalogPackage`. File carries ZERO baseline diagnostics — intra-file moves are position-safe; NOTHING else changes (sync/browse behavior byte-identical) |
| `apps/api/src/app.ts` | Task 2 | EXACTLY: line-neutral AppConfig seam `catalogInstallRoot?: string` (fold lines 66–67 into one line, net 0 lines above the line-339 diagnostics) + ONE wiring line `installRoot:` below line 341; no other line |
| `apps/api/src/catalog-sync/browse.test.ts` | Task 2 | Add `installRoot: <owned mkdtemp fixture root>` to the harness `createCatalogSync` call (required new dep); no behavioral change to existing cases |
| `apps/api/src/catalog-sync/import-preview.test.ts` | Task 2 | BOTH `createCatalogSync` call sites (the main harness at ~line 142 AND the `badRoot` case at ~line 329) gain the required `installRoot` dep; existing cases otherwise unchanged; APPEND origin-aware preview cases (measured reuse, tampered/missing fail-closed, unmanaged store occupancy) |
| `apps/api/src/catalog-sync/install.test.ts` | Task 2 | New service-level suite: fresh install exact bytes + origin rows, idempotent reinstall, event-shapes no-execution proof, conflict matrix writes nothing, rollback legs, agent-kind fixed failure, no fetch/credential/audit, leakage, lock, limits |
| `apps/api/src/routes/catalogs.ts` | Task 2 | Append EXACTLY the three error-table entries (required the moment the union widens so the exhaustive `errors: Record<CatalogRouteErrorCode, …>` compiles without an api-lint increase); no other line in Task 2 |
| `apps/api/src/routes/catalogs.ts` | Task 3 | Append `InstallRequestSchema` (apps/api-local zod, `PositiveIntegerSchema` added to the existing `@orgops/schemas/src/catalogs/primitives` deep import) + ONE POST `/api/catalogs/:catalogId/install` route; all 19 existing error-table entries byte-identical |
| `apps/api/src/catalogs.install.integration.test.ts` | Task 3 | Full HTTP auth/validation/failure/success/leakage/no-fetch/no-events matrix through `createApp` with AppConfig seams pointed at owned fixture roots |
| `apps/admin-ui/src/catalogs/api.ts` + `api.test.ts` | Task 4 | Install types + `installCatalogPackage` + decoder + 3 classify rows + 3 copy entries |
| `apps/admin-ui/src/catalogs/configuration-state.ts` + `.test.ts` | Task 4 | NEW top-level `install: InstallPanel` snapshot field (ImportPreviewPanel itself is UNCHANGED — existing `toEqual` panel assertions must not break), `requestInstall`/`cancelInstall`/`confirmInstall`, lifecycle resets |
| `apps/admin-ui/src/hooks/useCatalogConfiguration.ts` | Task 4 | `restrictedActions` snapshot gains `install: null` and the three noop actions (keeps the restricted controller type-complete) |
| `apps/admin-ui/src/screens/CatalogsScreen.tsx` + `.test.tsx` | Task 4 | Desktop-only two-step install control + inert result inside the import-preview section; Phase 12 framing copy retained VERBATIM with one appended corrective sentence (existing `toContain` assertions must stay green); no mobile/viewport changes |
| `docs/SPEC.md`, design spec status paragraph, `docs/research/skill-agent-sharing-tasks.md` | Task 4 | New "Catalog package installation (write path)" subsection + origin-aware preview amendment + activation boundary statement; status paragraph; task list line. `docs/catalog-package-contract.md` UNCHANGED (library untouched) |
| All existing skills/schemas modules, `packages/skills/src/index.ts`, routes/agents.ts, agent-creation helpers, secrets modules | Read-only all tasks | No semantic or diagnostic-position changes; `packages/skills` and `packages/schemas` gain NOTHING |
| D/task-N-* and distinct fix/attempt paths | Respective writer | Chronology, 15 logs/exits, lint comparisons, diff/commit evidence |

No new resolver, inspector, discovery framework, credential path, fetch path, audit event type, top-level state directory other than the owned install root, scheduler, background polling, approval capability, uninstall, or mobile layout. `prepareImport` stays the single authority for resolution/reuse/conflict; this plan does NOT reimplement resolution, dependency traversal or compatibility checks.

### Exact new contract

```sql
-- packages/db/migrations/033_catalog_installed_origins.sql (Task 1)
BEGIN;

CREATE TABLE catalog_installed_origins (
  name TEXT PRIMARY KEY NOT NULL,
  catalog_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  catalog_commit TEXT NOT NULL,
  package_commit TEXT NOT NULL,
  path TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind='skill'),
  version TEXT NOT NULL,
  digest TEXT NOT NULL,
  local_path TEXT NOT NULL,
  installed_by_human_id TEXT,
  installed_at INTEGER NOT NULL
);
CREATE INDEX idx_catalog_installed_origins_catalog ON catalog_installed_origins(catalog_id, name, version);

COMMIT;
```

```ts
// packages/db/src/schema.ts (Task 1; appended BEFORE the `schema` object, registered inside it.
// Field order matches the SQL column order exactly; conventions copied from catalogSources.)
export const catalogInstalledOrigins = sqliteTable("catalog_installed_origins", {
  name: text("name").primaryKey(),
  catalog_id: text("catalog_id").notNull(),
  source_id: text("source_id").notNull(),
  catalog_commit: text("catalog_commit").notNull(),
  package_commit: text("package_commit").notNull(),
  path: text("path").notNull(),
  kind: text("kind").notNull(),
  version: text("version").notNull(),
  digest: text("digest").notNull(),
  local_path: text("local_path").notNull(),
  installed_by_human_id: text("installed_by_human_id"),
  installed_at: integer("installed_at").notNull(),
}, (table) => ({
  kindCheck: check("catalog_installed_origins_kind_check", sql`${table.kind}='skill'`),
  catalogIndex: index("idx_catalog_installed_origins_catalog").on(table.catalog_id, table.name, table.version),
}));
// export const schema = { ...existing entries unchanged..., catalogInstalledOrigins };
```

```ts
// apps/api/src/catalog-installed.ts (Task 1; NEW module beside catalog-configuration.ts)
import type { OrgOpsDb } from "@orgops/db";

// Installed-package origin records (migration 033): minimal, non-authoritative provenance.
// No approval/authority/runnable state; actor/time are recorded, never a grant. The local
// path is stored for operator reconciliation and is NEVER projected into any API result.
export type InstalledOriginRecord = {
  name: string; catalogId: string; sourceId: string; catalogCommit: string; packageCommit: string;
  path: string; kind: "skill"; version: string; digest: string; localPath: string;
  installedByHumanId: string | null; installedAt: number;
};
export type CatalogInstalledResult<T> = { ok: true; value: T } | { ok: false };
const COLUMNS = "name, catalog_id, source_id, catalog_commit, package_commit, path, kind, version, digest, local_path, installed_by_human_id, installed_at";
function mapRow(row: Record<string, unknown>): InstalledOriginRecord | null {
  if (typeof row.name !== "string" || typeof row.catalog_id !== "string" || typeof row.source_id !== "string"
    || typeof row.catalog_commit !== "string" || typeof row.package_commit !== "string" || typeof row.path !== "string"
    || row.kind !== "skill" || typeof row.version !== "string" || typeof row.digest !== "string"
    || typeof row.local_path !== "string" || !(typeof row.installed_by_human_id === "string" || row.installed_by_human_id === null)
    || typeof row.installed_at !== "number" || !Number.isSafeInteger(row.installed_at)) return null;
  return { name: row.name, catalogId: row.catalog_id, sourceId: row.source_id, catalogCommit: row.catalog_commit,
    packageCommit: row.package_commit, path: row.path, kind: "skill", version: row.version, digest: row.digest,
    localPath: row.local_path, installedByHumanId: row.installed_by_human_id, installedAt: row.installed_at };
}
export function createCatalogInstalled({ db }: { db: OrgOpsDb }): {
  list(): CatalogInstalledResult<InstalledOriginRecord[]>;
  recordAll(rows: readonly InstalledOriginRecord[]): CatalogInstalledResult<true>;
} {
  return {
    list() {
      try {
        const rows = db.prepare(`SELECT ${COLUMNS} FROM catalog_installed_origins ORDER BY name`).all() as Record<string, unknown>[];
        const value: InstalledOriginRecord[] = [];
        for (const row of rows) { const mapped = mapRow(row); if (!mapped) return { ok: false }; value.push(mapped); }
        return { ok: true, value };
      } catch { return { ok: false }; }
    },
    // One synchronous better-sqlite3 transaction: either every row lands or none does.
    recordAll(rows) {
      try {
        const insert = db.prepare(`INSERT INTO catalog_installed_origins (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        db.transaction(() => {
          for (const row of rows) insert.run(row.name, row.catalogId, row.sourceId, row.catalogCommit,
            row.packageCommit, row.path, row.kind, row.version, row.digest, row.localPath,
            row.installedByHumanId, row.installedAt);
        })();
        return { ok: true, value: true };
      } catch { return { ok: false }; }
    },
  };
}
```

```ts
// apps/api/src/catalog-sync/sync.ts (Task 2; appended types + refactored/added methods in the
// EXISTING module, which carries ZERO baseline diagnostics. New module imports:
//   import { randomUUID } from "node:crypto";
//   import { lstat, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
//   import { dirname, join } from "node:path";
//   import { createCatalogInstalled, type InstalledOriginRecord } from "../catalog-installed";
// plus `type LocalSkillEvidence` added to the EXISTING @orgops/skills import and
// `type CatalogEntry`/`type ResolvedIdentity` already present.)
export type CatalogSyncErrorCode = "INVALID_REQUEST" | "FORBIDDEN" | "NOT_FOUND" | "REMOVED"
  | "STATE_CONFLICT" | "REVISION_CONFLICT" | "DESTINATION_REJECTED" | "CREDENTIAL_UNAVAILABLE"
  | "MIRROR_INVALID" | "SYNC_IN_PROGRESS" | "SYNC_FAILED" | "STORAGE_FAILURE"
  | "EXTERNAL_LOCATION" | "INSPECTION_FAILED"
  | "PREVIEW_REJECTED"
  | "INSTALL_REJECTED" | "KIND_NOT_INSTALLABLE" | "INSTALL_IN_PROGRESS";   // ONLY these three are appended
// Fixed install bound: reject, never partially report or truncate. Reuses the preview's
// inspection bounds (CATALOG_IMPORT_PREVIEW_LIMITS) and IMPORT_LIMITS for evidence/origins.
export const CATALOG_INSTALL_LIMITS = Object.freeze({ responseJsonBytes: 4194304 } as const);
export type CatalogInstallRequest = {
  indexPath: string; name: string; version: string; target: ImportPreviewTarget;
  expectedRevision?: number; // optional optimistic guard on the catalog CONFIGURATION revision
  confirm: true;             // explicit confirmation; the route schema enforces the literal
};
export type CatalogInstallPackageView = { identity: ResolvedIdentity; action: "installed" | "reused" };
export type CatalogInstallView = {
  kind: "catalog-install"; root: ResolvedIdentity; packages: CatalogInstallPackageView[];
  recordsWritten: number;   // origin rows inserted (== packages with action "installed")
  activated: false;         // nothing is enabled, started or API-loaded; Phase 14 owns activation
};
export type CatalogInstallResult =
  | { ok: true; value: CatalogInstallView }
  | { ok: false; code: CatalogSyncErrorCode; issue?: ImportIssue }; // issue present iff INSTALL_REJECTED
// CatalogSyncDeps gains exactly:  installRoot: string;
// createCatalogSync constructs internally:  const installed = createCatalogInstalled({ db });
// createCatalogSync's return type gains exactly:
installCatalogPackage(actorHumanId: string, catalogId: string, input: CatalogInstallRequest): Promise<CatalogInstallResult>;
```

Shared composition (Task 2; the Phase 12 preview supply code MOVES here unchanged apart from the origin-aware evidence block; both `previewCatalogImport` and `installCatalogPackage` call it):

```ts
type ImportBase = {
  catalog: CatalogMetadata; commit: string; rootEntry: CatalogEntry;
  sources: ImportSource[]; catalogs: CatalogSnapshot[]; packages: SuppliedPackage[];
  installedEntries: ImportInstalledEntry[]; knownReleases: ResolvedIdentity[];
};
type ImportBaseResult = { ok: true; value: ImportBase }
  | { ok: false; code: CatalogSyncErrorCode; issue?: ImportIssue };
function originIdentity(row: InstalledOriginRecord): ResolvedIdentity {
  return { catalogId: row.catalogId, catalogCommit: row.catalogCommit, sourceId: row.sourceId,
    packageCommit: row.packageCommit, path: row.path, kind: row.kind, name: row.name,
    version: row.version, digest: row.digest };
}
// Shared verify-only composition for the import preview and the install write path: the
// Phase 11 browseBase preconditions, configured sources/synced catalogs, bounded
// inspectGitPackage supply and the origin-aware installed evidence. NOTHING is fetched, no
// credential is read or decrypted (getMasterKey is never called), and no mirror, install
// or event state is written here.
async function importBase(actorHumanId: string, catalogId: string,
  input: { indexPath: string; name: string; version: string },
  rejectedCode: "PREVIEW_REJECTED" | "INSTALL_REJECTED"): Promise<ImportBaseResult> {
  if (!canManageCatalogs({ id: actorHumanId }, { findHuman })) return { ok: false, code: "FORBIDDEN" };
  const rejected = (code: ImportIssue["code"], at: ImportIssue["at"]): ImportBaseResult =>
    ({ ok: false, code: rejectedCode, issue: { code, at } });
  const base = await browseBase(actorHumanId, catalogId, input.indexPath);
  if (!base.ok) return base;
  const rootCatalog = base.value.catalog;
  const rootEntry = base.value.index.entries.find(item => item.name === input.name && item.version === input.version);
  if (!rootEntry) return { ok: false, code: "NOT_FOUND" };
  if (rootEntry.location.type !== "catalog") return { ok: false, code: "EXTERNAL_LOCATION" };
  // Origin-aware installed evidence. Recorded origins (migration 033) nominate subtrees of
  // the OWNED install root via the EXISTING Phase 9 collector; a recorded name whose
  // complete subtree is present becomes `measured` carrying its recorded origin — the
  // UNCHANGED resolver then grants reuse ONLY when the recorded identity and the digest
  // derived from the actual local bytes both match the resolved package. A recorded name
  // whose content is absent, not a directory, or unreadable fails CLOSED as occupied —
  // reuse is never fabricated. Install-root names without a recorded origin and every LIVE
  // local skills root name remain occupied. A missing install root yields no store entries
  // and every recorded name occupied. Any collector/storage failure is ONE fixed redacted
  // STORAGE_FAILURE; names are never silently dropped (a duplicate folded name across the
  // two roots fails globally inside the unchanged import evidence validation).
  const origins = installed.list();
  if (!origins.ok) return { ok: false, code: "STORAGE_FAILURE" };
  if (origins.value.length > IMPORT_LIMITS.knownReleases) return rejected("LIMIT_EXCEEDED", "knownReleases");
  const recorded = new Map(origins.value.map(row => [row.name, row] as const));
  let store: LocalSkillEvidence | undefined;
  let storeOk = false;
  try {
    const stat = await lstat(installRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return { ok: false, code: "STORAGE_FAILURE" };
    storeOk = true;
  } catch (error) {
    if ((error as { code?: unknown })?.code !== "ENOENT") return { ok: false, code: "STORAGE_FAILURE" };
  }
  if (storeOk) {
    const storeEvidence = await readLocalSkillEvidence({ directory: installRoot, nominatedNames: [...recorded.keys()] });
    if (!storeEvidence.ok) return { ok: false, code: "STORAGE_FAILURE" };
    store = storeEvidence.value;
  }
  const installedEntries: ImportInstalledEntry[] = [];
  for (const row of origins.value) {
    const subtree = store?.subtrees.find(item => item.name === row.name);
    const namespaceEntry = store?.namespace.entries.find(item => item.name === row.name);
    if (store && subtree && namespaceEntry?.type === "directory") {
      installedEntries.push({ state: "measured", name: row.name,
        origin: originIdentity(row), content: { complete: true, entries: subtree.entries } });
    } else {
      installedEntries.push({ state: "occupied", name: row.name });
    }
  }
  for (const entry of store?.namespace.entries ?? []) {
    if (!recorded.has(entry.name)) installedEntries.push({ state: "occupied", name: entry.name });
  }
  // LIVE local skills root: Option A occupancy, EXACTLY the Phase 12 semantics.
  const evidence = await readLocalSkillEvidence({ directory: localSkillsRoot, nominatedNames: [] });
  if (!evidence.ok) return { ok: false, code: "STORAGE_FAILURE" };
  for (const entry of evidence.value.namespace.entries) installedEntries.push({ state: "occupied", name: entry.name });
  if (installedEntries.length > IMPORT_LIMITS.installedEntries) return rejected("LIMIT_EXCEEDED", "installed");
  // … sources / catalogs / packages supply: the Phase 12 previewCatalogImport code moved
  // here VERBATIM (configured source metadata; synced nonremoved catalogs at the request's
  // single indexPath; catalog-local entries inspected at the synced CURRENT commit with
  // the existing inspectGitPackage; external/non-current-pin entries omitted with the ROOT
  // failing closed EXTERNAL_LOCATION/INSPECTION_FAILED; CATALOG_IMPORT_PREVIEW_LIMITS
  // inspectedPackages/inspectedContentBytes reject with `rejected("LIMIT_EXCEEDED", …)`).
  return { ok: true, value: { catalog: rootCatalog, commit: base.value.commit, rootEntry,
    sources, catalogs, packages, installedEntries,
    knownReleases: origins.value.map(originIdentity) } };
}
```

`previewCatalogImport` (Task 2; rewritten onto `importBase`; the projection is the Phase 12 projection with EXACTLY one semantic change — `blockedLocalNames` lists OCCUPIED entries only — and `knownReleases` now carries recorded origins):

```ts
async function previewCatalogImport(actorHumanId: string, catalogId: string,
  input: CatalogImportPreviewRequest): Promise<CatalogImportPreviewResult> {
  const base = await importBase(actorHumanId, catalogId, input, "PREVIEW_REJECTED");
  if (!base.ok) return base;
  const rejected = (code: ImportIssue["code"], at: ImportIssue["at"]): CatalogImportPreviewResult =>
    ({ ok: false, code: "PREVIEW_REJECTED", issue: { code, at } });
  // The UNCHANGED pure authority: no reimplemented resolution, traversal or compatibility.
  const result = prepareImport({
    root: { catalogId: base.value.catalog.catalogId, name: input.name, version: input.version },
    sources: base.value.sources, catalogs: base.value.catalogs, packages: base.value.packages,
    target: input.target,
    installed: { complete: true, entries: base.value.installedEntries },
    knownReleases: base.value.knownReleases,
  });
  if (!result.ok) return rejected(result.issues[0]!.code, result.issues[0]!.at);
  const preview = result.value;
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
    // Occupied names only: measured/reused names are honestly NOT "blocked" (they may reuse).
    blockedLocalNames: preview.preconditions.installed.entries
      .filter(entry => entry.state === "occupied").map(entry => entry.name),
    reviewRequired: true, authority: "none",
  });
  if (!withinPreviewCeiling(view)) return rejected("LIMIT_EXCEEDED", "review");
  return { ok: true, value: view };
}
```

`installCatalogPackage` (Task 2; the ONLY writing method; `git`, `mirrorsRoot`, `gitExecutable`, `freezeView`, `browseBase`, `metadata` are EXISTING private bindings; `installed`/`installRoot` are the new bindings):

```ts
let installLock: Promise<unknown> | null = null; // one concurrent install per API process

async function installCatalogPackage(actorHumanId: string, catalogId: string,
  input: CatalogInstallRequest): Promise<CatalogInstallResult> {
  // Auth-first ordering: a denied caller always receives FORBIDDEN, never a validation oracle.
  if (!canManageCatalogs({ id: actorHumanId }, { findHuman })) return { ok: false, code: "FORBIDDEN" };
  // The lock is taken synchronously BEFORE the first await so a concurrent call in the same
  // tick deterministically observes INSTALL_IN_PROGRESS.
  if (installLock) return { ok: false, code: "INSTALL_IN_PROGRESS" };
  let release!: () => void;
  installLock = new Promise<void>(resolve => { release = () => { installLock = null; resolve(); }; });
  try {
    const base = await importBase(actorHumanId, catalogId, input, "INSTALL_REJECTED");
    if (!base.ok) return base;
    if (input.expectedRevision !== undefined && base.value.catalog.revision !== input.expectedRevision)
      return { ok: false, code: "REVISION_CONFLICT" };
    // Agent kinds are NOT installable in this phase (Phase 14): one fixed failure, never a
    // fabricated success. Dependencies are already constrained to skill kind by the resolver.
    if (base.value.rootEntry.kind !== "skill") return { ok: false, code: "KIND_NOT_INSTALLABLE" };
    const rejected = (code: ImportIssue["code"], at: ImportIssue["at"]): CatalogInstallResult =>
      ({ ok: false, code: "INSTALL_REJECTED", issue: { code, at } });
    // The UNCHANGED pure authority is the ONLY reuse/include/conflict classifier:
    // reuse  = recorded origin identity + locally measured content both match the resolved package;
    // conflict = unmanaged occupancy, mismatched origin/digest, or changed content under a
    // known version (origins supplied as knownReleases → IDENTITY_CONFLICT); any conflict
    // fails the WHOLE install here, BEFORE any write.
    const result = prepareImport({
      root: { catalogId: base.value.catalog.catalogId, name: input.name, version: input.version },
      sources: base.value.sources, catalogs: base.value.catalogs, packages: base.value.packages,
      target: input.target,
      installed: { complete: true, entries: base.value.installedEntries },
      knownReleases: base.value.knownReleases,
    });
    if (!result.ok) return rejected(result.issues[0]!.code, result.issues[0]!.at);
    const preview = result.value;
    // Fixed portable view computed and ceiling-checked BEFORE any write: reject, never
    // truncate, and never write-then-fail on the response bound. No base64, no host paths
    // (the record's localPath is NEVER projected), no repository URLs, no credentials.
    const view: CatalogInstallView = freezeView({
      kind: "catalog-install", root: preview.root,
      packages: preview.packages.map(item => ({ identity: item.identity,
        action: item.action === "reuse" ? "reused" as const : "installed" as const })),
      recordsWritten: preview.packages.filter(item => item.action === "include").length,
      activated: false,
    });
    if (Buffer.byteLength(JSON.stringify(view), "utf8") > CATALOG_INSTALL_LIMITS.responseJsonBytes)
      return rejected("LIMIT_EXCEEDED", "review");
    const includes = preview.packages.filter(item => item.action === "include");
    // Owned install root (create mode). A symlink/foreign/non-directory root is rejected;
    // NOTHING outside installRoot is ever written.
    try {
      let stat = null;
      try { stat = await lstat(installRoot); }
      catch (error) { if ((error as { code?: unknown })?.code !== "ENOENT") throw error; }
      if (stat === null) await mkdir(installRoot, { mode: 0o700 });
      else if (!stat.isDirectory() || stat.isSymbolicLink()) return { ok: false, code: "STORAGE_FAILURE" };
    } catch { return { ok: false, code: "STORAGE_FAILURE" }; }
    // Stage verified bytes, then claim the final name with exclusive mkdir (NOT
    // recursive). Ordinary directory rename can overwrite a foreign empty directory.
    // Promotion is only into our claimed directory, not an atomic whole-package rename.
    // Until origins persist, readers see unmanaged occupancy and cannot grant reuse.
    const created: string[] = [];
    const temps = new Set<string>();
    const rows: InstalledOriginRecord[] = [];
    try {
      for (const item of includes) {
        const name = item.identity.name;
        const target = join(installRoot, name);
        let existing = null;
        try { existing = await lstat(target); }
        catch (error) { if ((error as { code?: unknown })?.code !== "ENOENT") throw error; }
        if (existing !== null) throw new Error("occupied"); // advisory; mkdir below is the atomic claim
        const temp = join(installRoot, `.install-${name}-${randomUUID()}`);
        await mkdir(temp, { mode: 0o700 });
        temps.add(temp);
        // item.files is the UNCHANGED composeImportReview inventory: normalized
        // manifest plus every verified file. Authored content is NEVER evaluated.
        for (const file of item.files) {
          const full = join(temp, file.path);
          await mkdir(dirname(full), { recursive: true, mode: 0o700 });
          await writeFile(full, Buffer.from(file.base64, "base64"),
            { flag: "wx", mode: file.executable ? 0o700 : 0o600 });
        }
        await mkdir(target, { mode: 0o700 }); // EEXIST preserves even a foreign EMPTY target
        created.push(target); // cleanup owns this path only after a successful exclusive claim
        for (const entry of await readdir(temp)) await rename(join(temp, entry), join(target, entry));
        await rm(temp, { recursive: true, force: true });
        temps.delete(temp);
        rows.push({ name, catalogId: item.identity.catalogId, sourceId: item.identity.sourceId,
          catalogCommit: item.identity.catalogCommit, packageCommit: item.identity.packageCommit,
          path: item.identity.path, kind: "skill", version: item.identity.version,
          digest: item.identity.digest, localPath: target,
          installedByHumanId: actorHumanId, installedAt: Date.now() });
      }
      // Origins LAST, after complete content, in ONE transaction. Failed persistence
      // uses the same nonempty rollback as population/claim/promotion failures.
      if (rows.length > 0 && !installed.recordAll(rows).ok) throw new Error("origin storage");
    } catch {
      for (const directory of [...temps, ...created]) {
        await rm(directory, { recursive: true, force: true }).catch(() => {});
      }
      return { ok: false, code: "STORAGE_FAILURE" };
    }
    return { ok: true, value: view };
  } finally {
    release();
  }
}
```

```ts
// apps/api/src/app.ts (Task 2; EXACTLY these additive, position-preserving edits — see sign-off 8)
// (a) AppConfig, replacing the two lines 66–67 (net 0 lines above the line-339 diagnostics):
  catalogLocalSkillsRoot?: string; /** Test-only local skills root seam for the import preview; production defaults to resolveSkillRoot(PROJECT_ROOT).path. */
  catalogInstallRoot?: string; /** Test-only installed-packages root seam; production defaults to join(DATA_DIR, "catalog-installed"). */
// (b) in the existing createCatalogSync call (below line 341), ONE new line after localSkillsRoot:
    installRoot: config.catalogInstallRoot ?? join(DATA_DIR, "catalog-installed"),
```

```ts
// apps/api/src/routes/catalogs.ts (Task 2: append EXACTLY these three error-table entries,
// all 19 existing entries byte-identical)
INSTALL_REJECTED: [422, "Install rejected; the issue code identifies the fixed cause; nothing was installed or changed"],
KIND_NOT_INSTALLABLE: [422, "Only skill packages are installable; agent packages are not yet installable"],
INSTALL_IN_PROGRESS: [409, "A catalog package installation is already in progress"],

// Task 3: `PositiveIntegerSchema` is imported from `@orgops/schemas/src/catalogs/primitives`
// (added to the EXISTING deep import of `parseCatalogJson` from that same path at line 9 — it is
// NOT re-exported from `@orgops/schemas`; no packages/schemas change), and append:
const InstallRequestSchema = z.object({
  indexPath: RelativePathSchema, name: PackageNameSchema, version: VersionSchema,
  expectedRevision: PositiveIntegerSchema.optional(),
  target: z.object({
    orgopsVersion: VersionSchema, platform: z.enum(["linux", "darwin", "win32"]),
    tools: z.array(PackageNameSchema).max(64).refine(tools => new Set(tools).size === tools.length),
  }).strict(),
  confirm: z.literal(true),
}).strict();

app.post("/api/catalogs/:catalogId/install", requireAuth, requireAdmin, async c => {
  try {
    const principal = c.get("user");
    if (!principal?.id || principal.runnerScope !== undefined) return failure(c, "FORBIDDEN");
    const catalogId = c.req.param("catalogId") ?? "";
    if (!CatalogIdSchema.safeParse(catalogId).success) return failure(c, "INVALID_REQUEST");
    const body = await readBody(c);
    if (!body.ok) return failure(c, body.code);
    const parsed = InstallRequestSchema.safeParse(body.value);
    if (!parsed.success) return failure(c, "INVALID_REQUEST");
    const result = await sync.installCatalogPackage(principal.id, catalogId, parsed.data);
    if (result.ok) return c.json(result.value);
    if (result.code === "INSTALL_REJECTED" && result.issue) {
      const [status, error] = errors.INSTALL_REJECTED;
      return c.json({ error, code: "INSTALL_REJECTED", issue: { code: result.issue.code, at: result.issue.at } }, status);
    }
    return failure(c, result.code);
  } catch {
    return failure(c, "STORAGE_FAILURE");
  }
});
```

The path sits under `/api/catalogs` so the existing `Cache-Control: no-store` middleware covers it unchanged. `readBody` bounds the JSON body at 16384 bytes exactly as the sync/preview POSTs. `CatalogRouteErrorCode` already unions `CatalogSyncErrorCode`, so the three new codes type-check; the service guarantees `issue` on every `INSTALL_REJECTED`. The route error table enumerates every returned code: all 19 existing entries byte-identical plus `INSTALL_REJECTED` 422, `KIND_NOT_INSTALLABLE` 422, `INSTALL_IN_PROGRESS` 409; `INVALID_REQUEST`/`PAYLOAD_TOO_LARGE`/`FORBIDDEN`/`NOT_FOUND`/`REMOVED`/`REVISION_CONFLICT`/`STORAGE_FAILURE`/`EXTERNAL_LOCATION`/`INSPECTION_FAILED` are reachable from this route exactly as from the preview route.

UI contract (Task 4; `apps/admin-ui/src/catalogs/api.ts`):

```ts
export type CatalogInstallPackage = { identity: ImportPreviewIdentity; action: "installed" | "reused" };
export type CatalogInstallView = {   // mirrors the service's CatalogInstallView shape
  kind: "catalog-install"; root: ImportPreviewIdentity; packages: CatalogInstallPackage[];
  recordsWritten: number; activated: false;
};
// CatalogApi gains:
installCatalogPackage(id: string, input: { indexPath: string; name: string; version: string;
  expectedRevision?: number; target: ImportPreviewTarget }, signal?: AbortSignal): Promise<CatalogApiResult<CatalogInstallView>>;
// request body sent: { indexPath, name, version,
//   ...(input.expectedRevision === undefined ? {} : { expectedRevision: input.expectedRevision }),
//   target: { orgopsVersion, platform, tools }, confirm: true }
```

New fixed copy (exact; appended to the existing `copy` object):

```ts
installRejected: "The installation was rejected. Nothing was installed, activated or changed.",
kindNotInstallable: "Only skill packages can be installed. Agent packages are not yet installable.",
installBusy: "An installation is already in progress. Wait for it to finish and reload configuration.",
```

`classify` gains (BEFORE the generic 400/5xx rows, existing rows byte-identical; the INSTALL_REJECTED row mirrors the PREVIEW_REJECTED row including the guarded ` Issue: <CODE>.` suffix):

```ts
if (status === 422 && code === "INSTALL_REJECTED") {
  const issue = typeof body === "object" && body !== null && "issue" in body ? (body as { issue?: unknown }).issue : undefined;
  const issueCode = issue && typeof issue === "object" && "code" in issue ? String((issue as { code: unknown }).code) : "";
  return failure("invalid", /^[A-Z_]{1,64}$/.test(issueCode) ? `${copy.installRejected} Issue: ${issueCode}.` : copy.installRejected);
}
if (status === 422 && code === "KIND_NOT_INSTALLABLE") return failure("invalid", copy.kindNotInstallable);
if (status === 409 && code === "INSTALL_IN_PROGRESS") return failure("conflict", copy.installBusy);
```

Controller contract (Task 4; `apps/admin-ui/src/catalogs/configuration-state.ts` — `ImportPreviewPanel` is UNCHANGED; `install` is a NEW top-level snapshot field so the existing `toEqual` panel assertions stay green):

```ts
export type InstallPanel = { armed: boolean; result: CatalogInstallView | null; message: string | null } | null;
// ConfigurationSnapshot gains: install: InstallPanel (empty() initializes null).
// ConfigurationController gains:
//   requestInstall(): void;
//   cancelInstall(): void;
//   confirmInstall(): Promise<void>;
```

Lifecycle rules (exact; extend the EXISTING packages/importPreview discipline):
- `install` resets to `null` everywhere `importPreview` resets: `load()`, `select()`, `mutate()`, `authorityLost()`/`dispose()` (via `empty()`), `changeSyncIndexPath`, every `browsePackages` outcome, every `selectPackage` failure, and every sync operation publication (`publishPanel`). The EXISTING `packagesGeneration` token supersedes in-flight installs exactly as it supersedes in-flight previews.
- A `selectPackage` SUCCESS additionally seeds `install = { armed: false, result: null, message: null }` in the same publication that seeds `importPreview`.
- `changeImportPreviewTarget` additionally resets `install` to `{ armed: false, result: null, message: null }` when a panel exists (a changed target invalidates any prior install outcome/intent).
- `requestInstall`: only when `writable()` and BOTH `importPreview` and `install` panels exist and `install.armed === false`; publishes `install: { armed: true, result: null, message: null }` (arming is a fresh intent: a previous result/message is cleared).
- `cancelInstall`: only when a panel exists; publishes `install: { armed: false, result: null, message: null }`.
- `confirmInstall` shares the `previewImport` gates (`closed`, `phase !== "ready"`, `!writable()`, open editor/confirmation, missing catalog detail or mismatched sync panel, empty trimmed `indexPath`, missing `packages` panel/selection/detail or an `importPreview` panel whose `name`/`version` do not match `packages.selected`) PLUS `install?.armed !== true` → no-op; blank trimmed `orgopsVersion` → publish `install: { armed: false, result: null, message: invalidMessage }` with NO request; tools text splits on `/[\s,]+/` dropping empty segments; the request body is `{ indexPath, name, version, expectedRevision: detail.revision, target, confirm: true }`; fresh `authorize(op)` bound to `expectedUserId` BEFORE the request; an owned **"mutation"**-kind operation (an install writes: it shares the mutation latch — `load`/`select` are blocked while it runs and `cancel()` abandons it) counted in `busy`; `unauthorized`/`forbidden` route to the existing authority-loss path; no automatic retry. On success it publishes `install: { armed: false, result: value, message: null }` AND clears the now-stale `importPreview.result` (its include/reuse actions predate the install) only when the generation and the current packages panel/selection/preview panel still match; on a `conflict`-kind error it publishes `phase: "error"`, the message and `reloadRequired: true` (stale catalog revision or an in-flight install requires explicit reload, like a sync conflict); on any other failure it publishes `install: { armed: false, result: null, message }` and keeps the draft.

Screen contract (Task 4; `apps/admin-ui/src/screens/CatalogsScreen.tsx`): the install UI renders INSIDE `ImportPreviewSection` directly after the "Preview import" button block, only when `state.install` is present (the section itself already requires `packages.detail` and `state.importPreview`; never for source details, editors or confirmations; no mobile/viewport changes):
- The Phase 12 framing paragraph is retained VERBATIM with EXACTLY one appended sentence: " Recorded installations with unchanged verified content are reused; every other present local name is treated as occupied." (the existing screen test asserts the original sentence with `toContain` — it must stay green).
- Not armed: an "Install package" Button (`disabled` when `disabled` or the OrgOps version is blank) calling `actions.requestInstall()`.
- Armed: a bordered (`border-red-900`, mirroring the existing confirmation section) block with the fixed impact copy "Installs the verified files of this package and its resolved skill dependencies into local installation storage and records their origins. Nothing is started, enabled or activated; installed skills are not available to agents, no API event-shape module is loaded, and no secrets are bound. Agent packages are not yet installable." plus a "Confirm install" Button (`disabled` when `disabled`; `void actions.confirmInstall()`) and a "Cancel install" secondary Button (`actions.cancelInstall()`).
- Result: an inert block (`aria-label="Install result"`) with the framing line "Nothing was started, enabled or activated. Installed skills remain unavailable to agents until a separate activation step." and one text line per package ("installed"/"reused" + the SAME `previewIdentityText` identity rendering as the preview) and a final "Origin records written: N" line.
- `<p role="alert">` renders `install.message`.
- All strings render as React text nodes only — no `dangerouslySetInnerHTML`, no anchor construction, no base64/file content, no host paths. No start/enable/activate/secret affordance exists anywhere in the section.
- `apps/admin-ui/src/hooks/useCatalogConfiguration.ts` `restrictedActions` snapshot gains `install: null` and the controller gains `requestInstall: noop`, `cancelInstall: noop`, `confirmInstall: asyncNoop`.

### Security decisions requiring explicit parent sign-off

1. **Mechanism 2 for the authored-module boundary (see the mandatory section above).** Installed packages are written ONLY to the owned install root (`<DATA_DIR>/catalog-installed`, test-seamed), NEVER to the live skills root; the API's single dynamic-import path (`listSkills(SKILL_ROOT)` → `loadSkillEventShapes`, TTL-cached in `routes/events.ts`) cannot see them. This deliberately deviates from the controller brief's boundary sketch wording ("into the configured local skills root (`<localSkillsRoot>/<name>/`)"): that sketch is unsafe as written because the production `localSkillsRoot` IS the live root the API loads `event-shapes.ts` from, and mechanism 1 (omission) permanently breaks unchanged-`prepareImport` reuse/idempotency for exactly the risky packages (`inspectPackage` requires inventory/digest equivalence). The write set is exactly {the owned install root, the new DB rows} — no other path is written. A Task 2 test PROVES a package with a global-side-effect-marker `event-shapes.ts` installs without the marker ever firing and without the API load path (run against the fixture LIVE root) observing it.
2. **Pure read reuse, unchanged.** Neither preview nor install calls `transport.fetch`, opens `catalog_read_credentials`, calls `getMasterKey`, writes mirror state, or touches `insertEvent`/audit (the origin row records actor/time; NO new audit event type). Tests assert `calls.fetch` stays at exactly the one prior sync fetch across every preview/install call, a spying `getMasterKey` is never called, the configuration audit spy is never called, and (HTTP level) the events table count is unchanged.
3. **Origin-aware evidence, fail closed.** Recorded origin + complete present subtree → `measured`; recorded origin + absent/non-directory/unreadable content → `occupied` (a recorded-but-missing install can only be repaired by a future administrative operation, never by silently overwriting); store/live-root names without a recorded origin → `occupied`; tampered content is caught by the UNCHANGED resolver (`currentDigest`/identity mismatch → `SKILL_CONFLICT`, or the measured entry is blocked → same). Origin rows are ALSO supplied as `knownReleases`, so changed content under a known `(catalogId, sourceId, name, version)` fails `IDENTITY_CONFLICT` (immutable releases). A name present in BOTH roots (measured + occupied) fails globally inside the unchanged import validation (`IDENTITY_CONFLICT`). `installed.complete: true` thereby asserts over the install root AND the configured live local skills root only (not runner-side locations) — documented in SPEC and UI copy, not hidden.
4. **Atomic no-replace name claims, narrow rollback, no partial success.** Per include: stage all verified files with `wx` (modes `0o700`/`0o600`, dirs `0o700`) → non-recursive `mkdir` of the final name → promote staged entries inside that newly claimed directory. A foreign empty target appearing after pre-check is preserved and fails `STORAGE_FAILURE`; no ordinary directory rename replaces the final name. This is not atomic whole-directory publication. Partial content in the inert store remains unmanaged occupancy to concurrent preview until origins persist. Caught failure removes every outstanding temp and every target created by this call, preserves unmanaged siblings/targets and prior origins, records no new origins and releases the lock. Origin rows are written LAST in ONE transaction after complete content. Crash durability, cleanup I/O failures and hostile same-UID mutation remain residuals. No overwrite, merge, rename-aside or uninstall; reuse writes nothing.
5. **New fixed error envelopes (append-only).** `INSTALL_REJECTED` 422 mirrors `PREVIEW_REJECTED` (`{error, code:"INSTALL_REJECTED", issue:{code,at}}` with the UNCHANGED `ImportIssue` enums — the service guarantees `issue` on every `INSTALL_REJECTED`); `KIND_NOT_INSTALLABLE` 422 (agent-kind roots fail BEFORE `prepareImport`, never a fabricated success); `INSTALL_IN_PROGRESS` 409 (one process-wide install lock taken synchronously before the first await). All 19 existing route error-table entries stay byte-identical; no other code is added. Failure ordering is fixed: `FORBIDDEN` → `INSTALL_IN_PROGRESS` → composition failures (`INVALID_REQUEST`/`NOT_FOUND`/`REMOVED`/`EXTERNAL_LOCATION`/`INSPECTION_FAILED`/`STORAGE_FAILURE`/`INSTALL_REJECTED`) → `REVISION_CONFLICT` → `KIND_NOT_INSTALLABLE` → `INSTALL_REJECTED` (resolution/conflict/ceiling) → success.
6. **Request-supplied target + explicit confirmation, apps/api-local validation.** `target` is REQUIRED and validated exactly as the preview's (the server NEVER guesses platform/tools). `confirm: z.literal(true)` is the explicit confirmation; the UI's two-step arm/confirm always sends it. `expectedRevision` is OPTIONAL and, when present, guards the catalog CONFIGURATION revision (`REVISION_CONFLICT` 409) — the UI always sends the loaded detail's revision. NO `packages/schemas` addition (strict zod schema local to `apps/api/src/routes/catalogs.ts`, composed ONLY from existing exported primitives; `PositiveIntegerSchema` comes from the EXISTING deep import path `@orgops/schemas/src/catalogs/primitives`, which `routes/catalogs.ts` already uses for `parseCatalogJson`).
7. **AppConfig test seam + dep shape.** `catalogInstallRoot?: string` (test-only); production wiring `config.catalogInstallRoot ?? join(DATA_DIR, "catalog-installed")`. `CatalogSyncDeps` gains ONLY `installRoot: string`; `createCatalogInstalled({ db })` is constructed INSIDE `createCatalogSync` from the existing `db` dep, so app.ts needs NO new import line (import lines sit above the line-339 diagnostics; see sign-off 8). Tests seed/read origins through their OWN accessor instance on the same in-memory db (the accessor is stateless). Automated tests ALWAYS inject owned fixture roots for BOTH `catalogLocalSkillsRoot` and `installRoot` and never touch the real repo `skills/` root or production DATA_DIR.
8. **api-lint 486 / byte-identical root lint preserved by construction.** `sync.ts` and `routes/catalogs.ts` carry ZERO baseline diagnostics (verified), so appended code and intra-file moves there cannot shift any diagnostic. `app.ts` carries exactly 3 diagnostics at lines 339–341: the AppConfig seam is added LINE-NEUTRALLY (folding the existing two-line comment+field at lines 66–67 into one line and adding the new field+inline-comment line — net 0 lines above line 339, same technique Phase 12 used) and the single `installRoot:` wiring line sits at ~line 463, BELOW the diagnostics. `packages/db` (0 diagnostics) gains the table; schema.ts is appended. Any accidental position shift fails the phase comparison and stops the task.
9. **Response projections are closed and base64-free.** The install view contains exactly `kind`, `root`, `packages[]` (`identity`, `action`), `recordsWritten`, `activated: false`. NEVER: file bytes/base64, `localPath` or any host path, repository URLs, credential/ciphertext references, source/catalog configuration rows, or a full `ImportPreview`/`ImportInput` dump. The 4 MiB ceiling is computed BEFORE any write; over-ceiling rejects with `INSTALL_REJECTED` `{code:"LIMIT_EXCEEDED", at:"review"}` and writes nothing. The preview projection is the Phase 12 projection with exactly one semantic change (occupied-only `blockedLocalNames`).
10. **Install is not activation, and nothing is auto-enabled.** The origin table has no approval/authority/runnable state; installed skills are invisible to `listSkills`, agent skill enabling and prompt composition until the Phase 14 activation slice; the UI states this in fixed copy; `activated: false` is literal in the result. No secret affordance, no agent creation, no start gate exists in this phase.
11. **UI trust and discipline.** Mirrored bytes are untrusted; all identity/result strings render as escaped text; the two-step confirmation mirrors the existing destructive-action pattern; Phase 5/10/11/12 auth, race, supersession and no-retry discipline is preserved exactly; existing UI tests pass UNMODIFIED (the install state is a NEW top-level snapshot field; the Phase 12 framing copy is retained verbatim with one appended sentence; existing `toContain`/`toEqual` assertions stay green); no mobile/viewport changes.

### Validation and chronology (every task/fix)

Before editing capture task base/full ref, cwd/branch, tracked/untracked status, diff/index to unique D paths; assert expected branch/state. Task 1 baseline BEFORE ANY source/test creation: accepted 2297 Vitest tests / 61 files + 3 opscli, unchanged 488 diagnostics (API 486 + agent-runner 2; ten workspaces clean including skills/schemas). Copy/adapt Phase-12 scripts into D only:

```bash
cd /home/slamnation/www/orgops
D="$PWD/.superpowers/sdd/2026-09-13-catalogs-13-installation"
P="$PWD/.superpowers/sdd/2026-09-12-catalogs-12-import-preview"
cp "$P/parent-verify.sh" "$D/parent-verify.sh"
cp "$P/compare-lint.py" "$D/compare-lint.py"
python3 - <<'PY'
from pathlib import Path
D = Path('.superpowers/sdd/2026-09-13-catalogs-13-installation')
p = D / 'parent-verify.sh'
s = p.read_text().replace('2026-09-12-catalogs-12-import-preview', '2026-09-13-catalogs-13-installation')
p.write_text(s)
p = D / 'compare-lint.py'
s = p.read_text().replace("d=root/'.superpowers/sdd/2026-09-12-catalogs-12-import-preview'", "d=root/'.superpowers/sdd/2026-09-13-catalogs-13-installation'")
s = s.replace('2026-09-12-catalogs-11-package-browsing/parent-final-lint.json', '2026-09-12-catalogs-12-import-preview/parent-final-lint.json')
p.write_text(s)
PY
bash "$D/parent-verify.sh" task-1-baseline
python3 "$D/compare-lint.py" task-1-baseline > "$D/task-1-baseline-comparison.txt"
cmp "$P/parent-final-root-lint.txt" "$D/task-1-baseline-root-lint.txt"
```

All 12 workspaces independently: api, agent-runner, opscli, admin-ui, user-ui, db, schemas, event-bus, llm, crypto, skills, events-scenario-tests; plus root test/opscli/root lint = 15 exact unique exit labels and nonempty raw logs. Exact expected exits: test 0, opscli 0, root-lint 2, lint-api 2, lint-agent-runner 2, other 10 lint 0. Full path/line/column/code/multiline-message/multiplicity Counter comparison; reject unparsed/missing logs or wrong exits. No diagnostic-bearing source edits or position normalization. Root lint raw bytes must remain identical to the fresh Phase-13 baseline. Root lint short-circuits at API; never substitute it for all-workspace runs. Test count increases only from scoped new tests. The isolation wrapper never sources the real `.env` — automated runs source `.env.example` only:

```bash
D=/home/slamnation/www/orgops/.superpowers/sdd/2026-09-13-catalogs-13-installation
isolated() {
  (ulimit -c 0; timeout --kill-after=5s 600s env -i PATH="$PATH" \
    HOME="$D/scratch/home" TMPDIR="$D/scratch/tmp" CI=1 \
    /bin/bash --noprofile --norc -c \
    'set -a; source .env.example; set +a; export ORGOPS_LLM_STUB=1; exec "$@"' bash "$@")
}
# Targeted example (replace label/file per task):
isolated npm exec --no -- vitest run apps/api/src/catalog-sync/install.test.ts \
  > "$D/task-2-red-1.txt" 2>&1
printf '%s\n' "$?" > "$D/task-2-red-1.exit"
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
| 1 | Accepted base + parent-approved plan-only commit, clean tracked tree; full fresh baseline FIRST | migration 033 + schema.ts table/registration + `createCatalogInstalled` + db/accessor tests | `migrate()` order/idempotency; schema.ts↔SQL agreement; db/api diagnostics unchanged; no other table touched |
| 2 | Parent-reviewed Task 1 commit; full Task 1 brief/common prefix | `installRoot` dep, shared `importBase`, origin-aware `previewCatalogImport`, `installCatalogPackage`, app.ts wiring, the three error-table entries, harness dep additions (browse.test.ts:125 + BOTH import-preview.test.ts call sites ~142/~329), `install.test.ts`, appended preview cases | Phase 10/11/12 behavior byte-identical with empty origins (browse/preview tests green with harness-only dep additions); exact frozen types; no fetch/credential/events path reachable; app.ts diff EXACTLY the two-edit line-neutral change; skills/schemas untouched |
| 3 | Parent-reviewed Task 2 commit; full Task 2 brief/common prefix | `InstallRequestSchema` + POST `/api/catalogs/:catalogId/install`; `catalogs.install.integration.test.ts` | existing route tests byte-compatible; full auth matrix; leakage assertions; `calls.fetch` unchanged; events count unchanged; Cache-Control no-store asserted; `git diff TASK_BASE -- apps/api/src/app.ts` shows exactly the Task 2 wiring diff |
| 4 | Parent-reviewed Task 3 commit; full Task 3 brief/common prefix | UI api/state/hook/screen + tests; SPEC/design/tasks docs | Phase 5/10/11/12 auth/race/supersession preserved; existing UI tests pass UNMODIFIED; no mobile layout; docs carry the activation boundary, Option-A-completeness and not-yet-activated caveats |

Shared dependencies available unchanged in all tasks: `PackageNameSchema`/`VersionSchema`/`CatalogIdSchema`/`RelativePathSchema`/`CATALOG_LIMITS` and the `CatalogEntry`/`PackageManifest`/`ReviewWarning`/`ResolvedIdentity`/`DependencyPin` types from `@orgops/schemas`; `PositiveIntegerSchema` from `@orgops/schemas/src/catalogs/primitives` (the deep path `routes/catalogs.ts` already imports `parseCatalogJson` from); `prepareImport`/`readLocalSkillEvidence`/`IMPORT_LIMITS`/`readGitCatalogIndex`/`inspectGitPackage`/`computePackageDigest` (tests only)/`exportAgentPackage` (tests only) and the `CatalogSnapshot`/`SuppliedPackage`/`ImportSource`/`ImportInstalledEntry`/`ImportIssue`/`ExecutionPreview`/`LocalSkillEvidence` types from `@orgops/skills`; `listSkills`/`loadSkillEventShapes` from `@orgops/skills` (TEST-ONLY use in the no-execution proof; production catalog code never calls them); `canManageCatalogs`/`AdminHuman` from `apps/api/src/admin-access`; `createCatalogConfiguration` metadata reads; `ensureCatalogMirror` verify-only mode and `CATALOG_SYNC_CURRENT_REF` from the Phase 10 modules; `readBody`/`failure` and the runner-denial guard from `routes/catalogs.ts`; `createCatalogInstalled`/`InstalledOriginRecord` from Task 1. Review the preflight table plus `git diff --name-only TASK_BASE..HEAD` after every task.

After parent approves this entire plan: commit only the plan with `docs(catalogs): plan catalog package installation write path`; then generate the briefs with the ENTIRE identical shared prefix plus each own body via the installed SDD `task-brief` tool and verify exact bytes and taskCount:

```bash
cd /home/slamnation/www/orgops
D="$PWD/.superpowers/sdd/2026-09-13-catalogs-13-installation"
PLAN="docs/superpowers/plans/2026-09-13-catalogs-13-installation.md"
TB=/home/slamnation/.pi/agent/git/github.com/obra/superpowers/skills/subagent-driven-development/scripts/task-brief
awk '/^### Task 1([^0-9]|$)/{exit} {print}' "$PLAN" > "$D/shared-prefix.md"
for n in 1 2 3 4; do "$TB" "$PLAN" "$n" "$D/task-$n-body.md"; done
for n in 1 2 3 4; do cat "$D/shared-prefix.md" "$D/task-$n-body.md" > "$D/task-$n-brief.md"; done
python3 - <<'PY'
from pathlib import Path
import hashlib, re
root = Path('/home/slamnation/www/orgops')
D = root/'.superpowers/sdd/2026-09-13-catalogs-13-installation'
plan = (root/'docs/superpowers/plans/2026-09-13-catalogs-13-installation.md').read_text()
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
for n in (1, 2, 3, 4):
    body = (D/f'task-{n}-body.md').read_text()
    assert body == region(n), f'body {n} != plan task region'
    assert re.search(rf'^#+[ \t]+Task[ \t]+{n}([^0-9]|$)', body, re.M), f'task {n} identity missing'
    for m in (1, 2, 3, 4):
        if m != n:
            assert not re.search(rf'^#+[ \t]+Task[ \t]+{m}([^0-9]|$)', body, re.M), f'body {n} contains task {m}'
    brief = (D/f'task-{n}-brief.md').read_text()
    assert brief == prefix + body, f'brief {n} != prefix + body'
    out.append(f'task-{n}-brief.md sha256:{hashlib.sha256(brief.encode()).hexdigest()} bytes:{len(brief.encode())} body-bytes:{len(body.encode())}')
out.append(f'shared-prefix.md sha256:{hashlib.sha256(prefix.encode()).hexdigest()} bytes:{len(prefix.encode())}')
out.append('taskCount 4')
(D/'brief-hashes.txt').write_text('\n'.join(out) + '\n')
print('\n'.join(out))
PY
```

No source/test implementation during planning. Briefs, hashes, probes and logs stay under D, unstaged.

### Planning self-review (shared)

- Spec coverage: origin persistence (migration 033 + schema.ts + accessor) → Task 1; install service (composition reuse, reuse/include/conflict classification via UNCHANGED prepareImport, atomic name claims and staged promotion, rollback, origin rows last, agent-kind fixed failure) → Task 2; origin-aware preview update → Task 2; admin-only POST route with strict body + `confirm: true` + fixed errors → Task 3; desktop two-step install control + inert result → Task 4; authored-module activation boundary (mechanism 2 + no-execution proof + SPEC statement + not-yet-activated marker) → Task 2 (+ Task 4 docs); baseline/validation discipline → shared prefix + every task.
- Explicitly NOT included (per brief): native/wrapped agent creation or any `agents`/soul/runtime write, secret references/bindings, start/activation gates or requirement enforcement, the Phase 14 activation/approval mechanism itself, publishing/GitHub submission, retained history beyond the origin row, uninstall/delete, scheduled work, other transports, mobile layout, a second resolution implementation, a generic installer framework, an approval capability, a new audit event type, and any `packages/skills`/`packages/schemas` semantic change.
- Type consistency: `InstalledOriginRecord` (T1) → `originIdentity`/`importBase` (T2) → route JSON (T3) → UI `CatalogInstallView` decoder (T4); the service `CatalogInstallView` (T2) and the UI `CatalogInstallView` (T4) decode the same JSON shape; the service's `CatalogInstallResult` union (T2) never crosses the wire; `CatalogInstallRequest` (T2) is exactly the parsed output of `InstallRequestSchema` (T3) and the UI `installCatalogPackage` input plus `confirm: true` (T4); `INSTALL_REJECTED`/`KIND_NOT_INSTALLABLE`/`INSTALL_IN_PROGRESS` appear in the service union (T2), the route error table + envelope (T2 entries/T3 route) and the UI classify/copy (T4); `InstallPanel`/`requestInstall`/`cancelInstall`/`confirmInstall` (T4 state) match the screen section props (T4 screen) and the `restrictedActions` noop set (T4 hook); `ImportPreviewTarget` is reused unchanged from Phase 12.
- Placeholder scan: every code step carries exact code; bounds, codes, messages and copy are literal; the ONE deliberately prose-described region is the moved Phase 12 supply code inside `importBase` (marked "moved VERBATIM" — the source of truth is the current `previewCatalogImport` body in `sync.ts`, which the implementer moves unchanged); no TBD/TODO/"handle edge cases" steps.

### Task 1: Origin persistence — migration 033 + hand-edited schema + persistence accessor + fresh Phase-13 baseline

**Files:**
- Create (evidence): `D/parent-verify.sh`, `D/compare-lint.py` (copied/adapted from Phase 12), `D/task-1-baseline-*` logs
- Create: `packages/db/migrations/033_catalog_installed_origins.sql`
- Modify: `packages/db/src/schema.ts` (append `catalogInstalledOrigins` + register in `schema`; no other line)
- Create: `apps/api/src/catalog-installed.ts`
- Test: `packages/db/src/catalog-installed-origins.test.ts`, `apps/api/src/catalog-installed.test.ts`

**Interfaces:**
- Consumes: existing `openDb`/`migrate` (`packages/db/src/index.ts`), drizzle `sqliteTable`/`check`/`index` conventions (032 migration + `catalogSources` table as the model).
- Produces: table `catalog_installed_origins`; `schema.catalogInstalledOrigins`; `InstalledOriginRecord`, `CatalogInstalledResult<T>`, `createCatalogInstalled({ db })` with `list(): CatalogInstalledResult<InstalledOriginRecord[]>` and `recordAll(rows: readonly InstalledOriginRecord[]): CatalogInstalledResult<true>`. Task 2 consumes the accessor (constructed inside `createCatalogSync`) and the record type; Task 3 asserts persisted rows via SQL.

- [x] **Step 1: Capture TASK_BASE/state to `D/task-1-start.txt`; assert HEAD == the parent-approved plan-only commit, clean tree/index.**

- [x] **Step 2: Fresh Phase-13 baseline FIRST (before any source/test creation).** Run the shared-prefix script block: copy/adapt `parent-verify.sh`/`compare-lint.py` from Phase 12 into D, `bash "$D/parent-verify.sh" task-1-baseline`, `python3 "$D/compare-lint.py" task-1-baseline > "$D/task-1-baseline-comparison.txt"`, `cmp` the fresh root lint against Phase 12's `parent-final-root-lint.txt` (must be byte-identical: HEAD differs only by the docs-only plan commit). Record 2297 tests / 61 files + 3 opscli + 488 diagnostics in `D/task-1-report.md` notes. Any drift stops the task and is reported.

- [x] **Step 3: Write the failing migration test** `packages/db/src/catalog-installed-origins.test.ts` (owned `mkdtemp` DBs under `os.tmpdir()`, awaited cleanup; NEVER production DATA_DIR):

```ts
import { describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { openDb, migrate, schema } from "./index";

const THIS_DIR = fileURLToPath(new URL(".", import.meta.url));
const MIGRATIONS = join(THIS_DIR, "..", "migrations");
const EXPECTED_COLUMNS = [
  ["name", 1], ["catalog_id", 1], ["source_id", 1], ["catalog_commit", 1],
  ["package_commit", 1], ["path", 1], ["kind", 1], ["version", 1], ["digest", 1],
  ["local_path", 1], ["installed_by_human_id", 0], ["installed_at", 1],
] as const;

describe("migration 033 catalog_installed_origins", () => {
  it("applies cleanly on a fresh DB, in order, with SQL matching schema.ts by hand", () => {
    const dir = mkdtempSync(join(tmpdir(), "orgops-db-033-"));
    try {
      const db = openDb(join(dir, "fresh.sqlite"));
      migrate(db);
      const applied = (db.prepare("SELECT id FROM migrations ORDER BY id").all() as { id: string }[]).map(r => r.id);
      expect(applied.filter(id => id.startsWith("033_"))).toEqual(["033_catalog_installed_origins.sql"]);
      expect(applied.indexOf("033_catalog_installed_origins.sql")).toBe(applied.length - 1);
      const info = db.prepare("PRAGMA table_info(catalog_installed_origins)").all() as { name: string; notnull: number; pk: number }[];
      // Hand-agreement check: column names/order/notnull match schema.ts catalogInstalledOrigins.
      expect(info.map(c => [c.name, c.notnull])).toEqual(EXPECTED_COLUMNS.map(([name, notnull]) => [name, notnull]));
      expect(info.find(c => c.name === "name")?.pk).toBe(1);
      expect(schema.catalogInstalledOrigins).toBeDefined();
      const indexes = db.prepare("PRAGMA index_list(catalog_installed_origins)").all() as { name: string }[];
      expect(indexes.map(i => i.name)).toContain("idx_catalog_installed_origins_catalog");
      db.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("applies on an existing pre-033 DB and is idempotent", () => {
    const dir = mkdtempSync(join(tmpdir(), "orgops-db-033-"));
    try {
      const db = openDb(join(dir, "existing.sqlite"));
      db.exec("CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
      const prior = readdirSync(MIGRATIONS).filter(f => f.endsWith(".sql") && f < "033").sort();
      expect(prior.length).toBe(32);
      for (const file of prior) {
        db.exec(readFileSync(join(MIGRATIONS, file), "utf-8"));
        db.prepare("INSERT INTO migrations (id, applied_at) VALUES (?, ?)").run(file, 1);
      }
      migrate(db); // applies exactly 033
      const rows = db.prepare("SELECT id FROM migrations WHERE id LIKE '033_%'").all();
      expect(rows).toEqual([{ id: "033_catalog_installed_origins.sql" }]);
      migrate(db); // idempotent: no error, still exactly one 033 row
      expect(db.prepare("SELECT count(*) AS n FROM migrations WHERE id LIKE '033_%'").get()).toEqual({ n: 1 });
      // CHECK constraint: only skill kind is recordable.
      expect(() => db.prepare("INSERT INTO catalog_installed_origins (name, catalog_id, source_id, catalog_commit, package_commit, path, kind, version, digest, local_path, installed_at) VALUES ('x','c','s','a','b','p','native-agent','1.0.0','d','/tmp/x',1)").run()).toThrow();
      db.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
```

- [x] **Step 4: Write the failing accessor test** `apps/api/src/catalog-installed.test.ts` (in-memory db + `migrate(db)`):

```ts
import { describe, expect, it } from "vitest";
import { openDb, migrate } from "@orgops/db";
import { createCatalogInstalled, type InstalledOriginRecord } from "./catalog-installed";

const row = (name: string, at = 1): InstalledOriginRecord => ({
  name, catalogId: "ghc", sourceId: "gh", catalogCommit: "a".repeat(40), packageCommit: "b".repeat(40),
  path: `skills/${name}`, kind: "skill", version: "1.0.0", digest: `sha256:${"c".repeat(64)}`,
  localPath: `/owned/install/${name}`, installedByHumanId: "admin-id", installedAt: at,
});

describe("createCatalogInstalled", () => {
  it("lists an empty store and round-trips records with exact field mapping", () => {
    const db = openDb(":memory:"); migrate(db);
    const installed = createCatalogInstalled({ db });
    expect(installed.list()).toEqual({ ok: true, value: [] });
    expect(installed.recordAll([row("b-skill", 2), row("a-skill")])).toEqual({ ok: true, value: true });
    expect(installed.list()).toEqual({ ok: true, value: [row("a-skill"), row("b-skill", 2)] }); // ORDER BY name
    db.close();
  });
  it("recordAll is one transaction: a primary-key conflict records NOTHING", () => {
    const db = openDb(":memory:"); migrate(db);
    const installed = createCatalogInstalled({ db });
    expect(installed.recordAll([row("taken")]).ok).toBe(true);
    expect(installed.recordAll([row("new-skill"), row("taken", 9)])).toEqual({ ok: false });
    expect(installed.list()).toEqual({ ok: true, value: [row("taken")] }); // unchanged, no partial write
    db.close();
  });
  it("redacts storage failures", () => {
    const db = openDb(":memory:"); migrate(db);
    const installed = createCatalogInstalled({ db });
    db.close();
    expect(installed.list()).toEqual({ ok: false });
    expect(installed.recordAll([row("x")])).toEqual({ ok: false });
  });
});
```

- [x] **Step 5: RED.** Run `isolated npm exec --no -- vitest run packages/db/src/catalog-installed-origins.test.ts apps/api/src/catalog-installed.test.ts` → interface-only RED (module/table absent) recorded as `D/task-1-red-1.{txt,exit}` and labelled honestly.

- [x] **Step 6: GREEN.** Add `033_catalog_installed_origins.sql` (exact SQL from the shared prefix), the `schema.ts` table + registration (exact code from the shared prefix), and `apps/api/src/catalog-installed.ts` (exact code from the shared prefix). Rerun → `D/task-1-green-1.txt`. Then `packages/db/src/index.test.ts` + `packages/db/src/catalog-configuration.test.ts` unchanged-green → `D/task-1-green-2.txt`.

- [x] **Step 7: Full validation + scoped commit.**

```bash
LABEL=task-1-final-1
bash "$D/parent-verify.sh" "$LABEL"
python3 "$D/compare-lint.py" "$LABEL" > "$D/$LABEL-comparison.txt"
cmp "$D/task-1-baseline-root-lint.txt" "$D/$LABEL-root-lint.txt"
git diff --check
git add packages/db/migrations/033_catalog_installed_origins.sql packages/db/src/schema.ts \
        packages/db/src/catalog-installed-origins.test.ts \
        apps/api/src/catalog-installed.ts apps/api/src/catalog-installed.test.ts
git commit -m "feat(catalogs): persist installed package origins"
```

### Task 2: Install service + origin-aware preview + app wiring

**Files:**
- Modify: `apps/api/src/catalog-sync/sync.ts` (three appended error codes, `CATALOG_INSTALL_LIMITS`, install types, `installRoot` dep, internal `createCatalogInstalled({ db })`, shared `importBase` extraction, origin-aware `previewCatalogImport` rewrite, `installCatalogPackage`; NOTHING else changes)
- Modify: `apps/api/src/app.ts` (EXACTLY the line-neutral AppConfig seam + the one `installRoot:` wiring line; no other line)
- Modify: `apps/api/src/catalog-sync/browse.test.ts` (add the now-required `installRoot` to the harness `createCatalogSync` call; owned mkdtemp root; no behavioral change)
- Modify: `apps/api/src/catalog-sync/import-preview.test.ts` (BOTH `createCatalogSync` call sites gain the required `installRoot` dep: the main harness at ~line 142 AND the standalone `badRoot` service at ~line 329 — the `badRoot` case points `localSkillsRoot` at a nonexistent path and needs only an owned mkdtemp `installRoot`; existing cases otherwise unchanged; APPEND the origin-aware cases below)
- Modify: `apps/api/src/routes/catalogs.ts` (append EXACTLY the three error-table entries; no other line). REQUIRED here, not in Task 3: widening `CatalogSyncErrorCode` without them breaks the exhaustive `errors: Record<CatalogRouteErrorCode, …>` (new TS2739) and the api-lint-486 / root-byte-identical mandate.
- Test: `apps/api/src/catalog-sync/install.test.ts`

**Interfaces:**
- Consumes: Task 1 `createCatalogInstalled`/`InstalledOriginRecord`; existing `browseBase`/`metadata`/`parentSource`/`inspectIndex` (private, same module), `ensureCatalogMirror` verify-only mode, `CATALOG_SYNC_CURRENT_REF`, `prepareImport`, `readLocalSkillEvidence`, `IMPORT_LIMITS`, `computePackageDigest`/`exportAgentPackage`/`listSkills`/`loadSkillEventShapes` (tests only).
- Produces: `INSTALL_REJECTED`/`KIND_NOT_INSTALLABLE`/`INSTALL_IN_PROGRESS` in `CatalogSyncErrorCode`; `CATALOG_INSTALL_LIMITS`; `CatalogInstallRequest`/`CatalogInstallPackageView`/`CatalogInstallView`/`CatalogInstallResult`; `CatalogSyncDeps.installRoot: string`; `installCatalogPackage(actorHumanId, catalogId, input)`; the AppConfig seam `catalogInstallRoot?: string`; origin-aware `previewCatalogImport` (same view type). Task 3 consumes the method, the request type and the error codes; Task 4 consumes the route JSON shape.

- [x] **Step 1: Capture TASK_BASE/state to `D/task-2-start.txt`; assert HEAD == Task 1 commit, clean tree/index.**

- [x] **Step 2: Write the failing service test** `apps/api/src/catalog-sync/install.test.ts`. Harness copied from `import-preview.test.ts` (`openDb(":memory:")` + `migrate(db)`, real `createCatalogConfiguration({ db, findHuman, getMasterKey: spyGetMasterKey, appendAudit: appendAuditSpy })`, owned `mkdtemp` mirrorsRoot, owned `mkdtemp` LIVE root injected as `localSkillsRoot`, owned `mkdtemp` INSTALL root injected as `installRoot`, `createCatalogSync({ ..., localSkillsRoot, installRoot, transport })` with the fixture transport double, mutable `findHuman`). Reuse/copy the `skillPackage`/`packageFiles`/`skillPackageWithDeps` builders and the primary fixture index (root `demo-skill` 1.0.0 → `dep-skill` 1.0.0; external `external-skill` 2.0.0). A separate accessor instance `createCatalogInstalled({ db })` on the SAME db seeds/inspects origin rows. Cases:

1. **fresh install writes exact verified bytes and records origins**: create source `gh` + catalog `ghc`, `syncCatalog("owner", "ghc", { expectedRevision: 1, indexPath: fixture.indexPath })`; `installCatalogPackage("owner", "ghc", { indexPath: fixture.indexPath, name: "demo-skill", version: "1.0.0", expectedRevision: 1, target, confirm: true })` → ok; `value.kind === "catalog-install"`; `value.activated === false`; `value.recordsWritten === 2`; `value.packages` is EXACTLY dependency-first order `[{identity: dep-skill…, action: "installed"}, {identity: demo-skill…, action: "installed"}]`; deep-frozen (`Object.isFrozen` on value/packages/packages[0]). On disk under the INSTALL root: `dep-skill/` and `demo-skill/` each contain `orgops-package.json` + `SKILL.md`; `readFile(demo-skill/SKILL.md)` equals the fixture bytes; `parsePackageManifest(readFile(orgops-package.json))` succeeds and `inspectPackage(manifest, [actual SKILL.md entry])` yields `manifest.digest === root.manifest.digest` (re-derivation, since `canonicalJson`/`normalizedManifest` are not root-exported); orgops-package.json is NOT executable (`stat.mode & 0o111 === 0`). Accessor `list()` returns EXACTLY the 2 rows, each with the identity fields of the resolved package, `localPath === join(installRoot, name)`, `installedByHumanId === "owner"`, safe-integer `installedAt`. The LIVE root stays EMPTY (`readdir(localSkillsRoot)` → `[]`). `calls.fetch` has exactly the ONE sync fetch; `spyGetMasterKey` NEVER called; `appendAuditSpy` NEVER called. Leakage: `JSON.stringify(value)` contains NONE of the fixture base64, `"base64"`, the mirrorsRoot/installRoot/localRoot paths, `"github.com/org/repo"`, `"ciphertext"`, `"localPath"`.
2. **reinstall is idempotent reuse**: second identical install → ok; every `action === "reused"`; `recordsWritten === 0`; the on-disk `SKILL.md` mtimeMs is UNCHANGED (captured before); accessor still returns exactly 2 rows.
3. **authored event-shapes module is installed inertly and NEVER executed**: build a fixture skill `shape-skill` 1.0.0 whose `event-shapes.ts` content is `globalThis.__orgopsShapeExecuted = (globalThis.__orgopsShapeExecuted ?? 0) + 1; export const eventShapes = [];` with the manifest `executables` declaring `{ path: "event-shapes.ts", execution: "api-event-shapes" }` (extend the builders; `computePackageDigest` over manifest+entries as before; a SECOND entry in the index, installed as its own root). Install `shape-skill` → ok; the file exists on disk under the install root with the exact authored bytes; `globalThis.__orgopsShapeExecuted` is UNDEFINED throughout. Then run the EXACT API load path against the fixture LIVE root: `listSkills({ path: localSkillsRoot })` returns `[]` and `await loadSkillEventShapes(listSkills({ path: localSkillsRoot }))` returns `{ shapes: [], errors: [] }` with `globalThis.__orgopsShapeExecuted` STILL undefined (the installed content is outside the API's only dynamic-import surface).
4. **conflicts block and write NOTHING**: (a) `mkdir(join(installRoot, "dep-skill"))` (unmanaged store occupancy) → install `demo-skill` → `{ ok: false, code: "INSTALL_REJECTED", issue: { code: "SKILL_CONFLICT", at: "installed" } }`; the precreated directory's marker file is byte-unchanged; accessor empty; (b) `mkdir(join(localSkillsRoot, "demo-skill"))` (live-root occupancy) → same fixed shape; (c) after a successful install, tamper one byte of the installed `dep-skill/SKILL.md` → reinstall → `INSTALL_REJECTED` with `issue.code === "SKILL_CONFLICT"`; tampered bytes left untouched; rows unchanged; (d) after a successful install, re-sync the catalog from a SECOND fixture generation whose `demo-skill` SKILL.md differs (same name+version, new commit/digest; `syncCatalog` with `expectedRevision: 1` again) → install → `INSTALL_REJECTED` with `issue.code === "IDENTITY_CONFLICT"` (origins supplied as `knownReleases`: changed content under a known version); (e) mismatched origin across catalogs: fixture variant with a second source `gh2`/catalog `ghc2` (Phase 11 two-fixture transport dispatch) whose index lists `demo-skill` 1.0.0 at a different digest; install it after installing from `ghc` → `INSTALL_REJECTED` `SKILL_CONFLICT`. After EVERY conflict case: no temp dirs remain (`readdir(installRoot)` shows only expected names, none starting `.install-`), no origin row added, `calls.fetch` unchanged (fetches happen only in explicit syncs).
5. **agent-kind root fails fixed**: build a wrapped-agent package via `exportAgentPackage({ mode: "WRAPPED", wrappedConfig: { runtime: { command: "printf ok" } } }, { metadata: <PackageMetadata for "wrapped-one" 1.0.0>, dependencies: [] })` (must-unwrap; add its `proposedFiles` to the fixture repo at `agents/wrapped-one/` and its index entry with `kind: "wrapped-agent"`, the candidate snapshot digest, `location: { type: "catalog", path: "agents/wrapped-one", revision: { type: "catalog-revision" } }`) → install → `{ ok: false, code: "KIND_NOT_INSTALLABLE" }` with NO `issue`; nothing written; accessor empty.
6. **failed write rolls back ONLY created paths and records no origin**: (a) `chmod(installRoot, 0o500)` before install → `{ ok: false, code: "STORAGE_FAILURE" }`; installRoot contains nothing; accessor empty; restore `0o700` in finally; (b) pre-create `installRoot/other-skill` (unmanaged, unrelated, with a marker file), run the failing chmod install, assert `other-skill` is byte-unchanged (rollback never touches unmanaged paths); (c) close the service's db BEFORE the call → `installed.list()` fails → `STORAGE_FAILURE` before any write, installRoot untouched. **Final-review correction:** these chmod/closed-DB legs fail before any package is created and do NOT exercise nonempty rollback. The final fix adds deterministic second-package population/promotion/empty-target-race failures and a test-only SQLite trigger rejecting the second origin INSERT, with complete earlier content, prior origins and unmanaged siblings present. Assertions prove cleanup, unchanged prior origins, zero new origins, lock release and subsequent unrelated preview/install usability. No new production accessor seam is needed.
7. **lock is synchronous**: `const p1 = svc.installCatalogPackage("owner", "ghc", input); const r2 = await svc.installCatalogPackage("owner", "ghc", input);` → `r2` is `{ ok: false, code: "INSTALL_IN_PROGRESS" }`; `await p1` succeeds (or fails on its own merits) exactly once; a subsequent install proceeds (lock released in finally).
8. **expectedRevision guard**: `expectedRevision: 999` → `{ ok: false, code: "REVISION_CONFLICT" }`, nothing written; omitted → proceeds.
9. **authority recheck (auth-first)**: `findHuman` returning `{ isAdmin: false, mustChangePassword: false }`, `{ isAdmin: true, mustChangePassword: true }` and `undefined` → `FORBIDDEN`; a denied principal with an otherwise-valid request still receives `FORBIDDEN` and NOT `INSTALL_IN_PROGRESS` even while another install holds the lock.
10. **knownReleases bound**: insert 4097 origin rows directly via the accessor (loop of `recordAll` batches; distinct names) → install → `INSTALL_REJECTED` with `issue: { code: "LIMIT_EXCEEDED", at: "knownReleases" }`; nothing written.
11. **unchanged browsing/preview behavior with empty origins**: `listCatalogPackages`/`inspectCatalogPackage`/`readCatalogIndex` and an empty-origins `previewCatalogImport` on the fixture return byte-identical views to Phase 11/12 expectations (guards the refactor).

- [x] **Step 3: Append the origin-aware preview cases to `import-preview.test.ts`** (existing cases byte-unchanged apart from the harness `installRoot` dep; new cases use the SAME fixture and an accessor instance on the same db):

```ts
// Seed helper: write demo-skill's exact installed layout (orgops-package.json + SKILL.md)
// into the install root and record its origin row with the EXACT resolved identity
// (catalogId "ghc", sourceId "gh", catalogCommit/packageCommit = fixture.commit,
// path "skills/demo-skill", kind "skill", version "1.0.0", digest root.manifest.digest).
// The orgops-package.json bytes are derived by a first REAL install in a beforeAll-style
// setup (install demo-skill once via the service, keep the fixture roots, reset nothing) —
// OR by copying the bytes from that install's on-disk result; tests never hand-craft the
// normalized manifest (canonicalJson/normalizedManifest are not root-exported).
// 12. recorded origin + matching content → measured/reuse: after installing demo-skill
//     (closure installs dep-skill too), preview demo-skill → ok; BOTH packages
//     action === "reuse" and manifestBytes === "current-installed-manifest";
//     blockedLocalNames does NOT contain either installed name.
// 13. recorded origin + tampered content → fail closed: edit one byte of installed
//     demo-skill/SKILL.md → preview → PREVIEW_REJECTED { code: "SKILL_CONFLICT", at: "installed" }.
// 14. recorded origin + missing directory → fail closed: rm the installed dep-skill dir →
//     preview → PREVIEW_REJECTED SKILL_CONFLICT; the missing name is listed in
//     blockedLocalNames (occupied), never silently absent.
// 15. unmanaged store occupancy: mkdir installRoot/unrelated-store → preview of demo-skill
//     with NO origins → ok (demo-skill include) and blockedLocalNames contains
//     "unrelated-store"; then mkdir installRoot/dep-skill → preview → PREVIEW_REJECTED
//     SKILL_CONFLICT.
// 16. live-root + store dual presence: with demo-skill installed (measured), ALSO
//     mkdir localSkillsRoot/demo-skill → preview → PREVIEW_REJECTED with
//     issue.code === "IDENTITY_CONFLICT" (duplicate folded installed name), never a
//     fabricated reuse.
// Existing Phase 12 cases (1–12 there) remain green with empty origins: blockedLocalNames
// is unchanged because every supplied entry was and remains occupied.
```

- [x] **Step 4: RED.** Run `isolated npm exec --no -- vitest run apps/api/src/catalog-sync/install.test.ts apps/api/src/catalog-sync/import-preview.test.ts` → interface-only RED (`installCatalogPackage` absent; dep missing) recorded as `D/task-2-red-1.{txt,exit}` and labelled honestly; then add the minimal compiling scaffolding (dep, types, error-table entries, a stub `installCatalogPackage` returning `{ ok: false, code: "STORAGE_FAILURE" }`) and rerun → behavioral RED `D/task-2-red-2.{txt,exit}`. Preserve both.

- [x] **Step 5: GREEN.** Implement the shared-prefix contract exactly in `sync.ts` (appended codes/limits/types, `installRoot` dep, internal accessor, `importBase` extraction with the Phase 12 supply code moved VERBATIM, origin-aware evidence, rewritten `previewCatalogImport`, `installCatalogPackage`) and the two exact `app.ts` edits (line-neutral AppConfig seam; one wiring line below line 341). Rerun the targeted files → `D/task-2-green-1.txt`. Then `browse.test.ts`, `catalogs.sync.integration.test.ts`, `catalogs.packages.integration.test.ts`, `catalogs.import-preview.integration.test.ts` and the mirror/git-fetch suites → unchanged GREEN `D/task-2-green-2.txt`.

- [x] **Step 6: Full validation + scoped commit.** Assert `git diff TASK_BASE -- apps/api/src/app.ts` shows EXACTLY the two-edit line-neutral diff and `git diff --exit-code TASK_BASE -- packages/skills packages/schemas` is clean.

```bash
LABEL=task-2-final-1
bash "$D/parent-verify.sh" "$LABEL"
python3 "$D/compare-lint.py" "$LABEL" > "$D/$LABEL-comparison.txt"
cmp "$D/task-1-baseline-root-lint.txt" "$D/$LABEL-root-lint.txt"
git diff --check
git add apps/api/src/catalog-sync/sync.ts apps/api/src/app.ts \
        apps/api/src/catalog-sync/browse.test.ts apps/api/src/catalog-sync/import-preview.test.ts \
        apps/api/src/catalog-sync/install.test.ts apps/api/src/routes/catalogs.ts
git commit -m "feat(catalogs): add skill package installation service"
```

### Task 3: Admin-only install route + HTTP integration matrix

**Files:**
- Modify: `apps/api/src/routes/catalogs.ts` (`PositiveIntegerSchema` added to the EXISTING deep import at line 9, which becomes `import { parseCatalogJson, PositiveIntegerSchema } from "@orgops/schemas/src/catalogs/primitives";` — it is NOT re-exported from `@orgops/schemas`; `InstallRequestSchema`; ONE appended POST route; the three error-table entries were already appended by Task 2 so the exhaustive `errors` Record compiles without an api-lint increase)
- Test: `apps/api/src/catalogs.install.integration.test.ts`
- Verify-only: `apps/api/src/app.ts` beyond Task 2 (assert no further change; `git diff TASK_BASE -- apps/api/src/app.ts` shows EXACTLY the Task 2 two-edit diff)

**Interfaces:**
- Consumes: Task 2 `installCatalogPackage`, `CatalogInstallRequest`, the three new codes; existing `readBody`/`failure`, `requireAuth`/`requireAdmin`, `CatalogIdSchema`/`RelativePathSchema`/`PackageNameSchema`/`VersionSchema` (already imported from `@orgops/schemas`), `PositiveIntegerSchema` (from the existing `@orgops/schemas/src/catalogs/primitives` deep import), the runner-denial guard, and the AppConfig `catalogLocalSkillsRoot` + `catalogInstallRoot` seams for the test harness.
- Produces: `POST /api/catalogs/:catalogId/install` with strict body `{ indexPath, name, version, expectedRevision?, target, confirm: true }` → 200 `CatalogInstallView` JSON; fixed `{error, code}` envelopes otherwise, with `INSTALL_REJECTED` 422 additionally carrying `issue: { code, at }` (fixed enums). Task 4 consumes the response shape and the envelopes.

- [x] **Step 1: Capture TASK_BASE/state to `D/task-3-start.txt`; assert HEAD == Task 2 commit, clean tree/index.**

- [x] **Step 2: Write the failing integration test** `apps/api/src/catalogs.install.integration.test.ts`, harness copied from `catalogs.import-preview.integration.test.ts` (in-memory db, `createApp({ db, dataDir, adminUser/adminPass, runnerToken, catalogSyncTransport, catalogGitExecutable: "/usr/bin/git", catalogLocalSkillsRoot: liveRoot, catalogInstallRoot: installRoot })` where both roots are owned `mkdtemp` fixture roots — NEVER the real `skills/` root — `vi.stubEnv` master key, `fetch`/console guards, fixture repos from Task 2's builders). Cases:

```ts
const installPath = "/api/catalogs/ghc/install";
const body = { indexPath: fixture.indexPath, name: "demo-skill", version: "1.0.0",
  expectedRevision: 1, target, confirm: true };

it("installs a skill package and persists origins without fetches, credentials, events or content leakage", async () => {
  await createGh();
  await json(await request("POST", syncPath, { expectedRevision: 1, indexPath: fixture.indexPath }));
  expect(calls.fetch).toHaveLength(1);
  const before = eventsCount();
  const response = await request("POST", installPath, body);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const view = await json(response);
  expect(view.kind).toBe("catalog-install");
  expect(view.activated).toBe(false);
  expect(view.recordsWritten).toBe(2);
  expect(view.packages.map((p: { action: string }) => p.action)).toEqual(["installed", "installed"]);
  expect(view.packages.map((p: { identity: { name: string } }) => p.identity.name)).toEqual(["dep-skill", "demo-skill"]);
  const raw = JSON.stringify(view);
  expect(raw).not.toContain("base64");
  expect(raw).not.toContain(dataDir);          // no host/mirror path
  expect(raw).not.toContain(installRoot);     // localPath is never projected
  expect(raw).not.toContain(liveRoot);
  expect(raw).not.toContain("localPath");
  expect(raw).not.toContain("github.com/org/repo");
  expect(raw).not.toContain("ciphertext");
  // Origins persisted (read the DB directly — the API exposes no list route):
  const rows = db.prepare("SELECT name, kind, version, installed_by_human_id FROM catalog_installed_origins ORDER BY name").all();
  expect(rows).toEqual([{ name: "dep-skill", kind: "skill", version: "1.0.0", installed_by_human_id: /* admin id */ expect.any(String) },
                        { name: "demo-skill", kind: "skill", version: "1.0.0", installed_by_human_id: expect.any(String) }]);
  // Exact verified bytes under the install root; the live root stays empty:
  expect(readFileSync(join(installRoot, "demo-skill", "SKILL.md"), "utf8")).toBe(root.skillMd);
  expect(readdirSync(liveRoot)).toEqual([]);
  // Reinstall is idempotent reuse with no new fetch/event/row:
  const again = await json(await request("POST", installPath, body));
  expect(again.recordsWritten).toBe(0);
  expect(again.packages.every((p: { action: string }) => p.action === "reused")).toBe(true);
  expect(calls.fetch).toHaveLength(1);            // install NEVER fetches
  expect(eventsCount()).toBe(before);             // no events rows from any install call
}, 30000);

it("enforces admin authority for the install route", async () => {
  // same 6-case matrix as the Phase 10/11/12 tests: no cookie → 401 {error:"Unauthorized"};
  // ordinary human → 403; global runner token → 403; scoped runner token → 403;
  // scoped runner token + admin cookie → 403; admin with must_change_password=1 → 403.
  // calls.fetch stays empty; eventsCount unchanged; installRoot stays empty.
});

it("validates path params and body with fixed redacted codes", async () => {
  await createGh();
  await error(await request("POST", installPath, {}), "INVALID_REQUEST");                        // missing fields
  await error(await request("POST", installPath, { ...body, confirm: false }), "INVALID_REQUEST");
  await error(await request("POST", installPath, { ...body, confirm: "true" }), "INVALID_REQUEST");
  await error(await request("POST", installPath, { ...body, indexPath: "../x" }), "INVALID_REQUEST");
  await error(await request("POST", installPath, { ...body, name: "Bad Name" }), "INVALID_REQUEST");
  await error(await request("POST", installPath, { ...body, version: "1.0" }), "INVALID_REQUEST");
  await error(await request("POST", installPath, { ...body, expectedRevision: 0 }), "INVALID_REQUEST");
  await error(await request("POST", installPath, { ...body, expectedRevision: 2147483648 }), "INVALID_REQUEST");
  await error(await request("POST", installPath, { ...body, target: { ...target, platform: "plan9" } }), "INVALID_REQUEST");
  await error(await request("POST", installPath, { ...body, extra: 1 }), "INVALID_REQUEST");      // strict body
  await error(await request("POST", "/api/catalogs/unknown/install", body), "NOT_FOUND");
  // oversized body: > 16384 bytes of padding in a string field → PAYLOAD_TOO_LARGE
});

it("fails closed for unsynced, removed, external, stale-revision, agent-kind and conflicted installs", async () => {
  await createGh();
  const before = eventsCount();
  await error(await request("POST", installPath, body), "NOT_FOUND");                // never synced
  await json(await request("POST", syncPath, { expectedRevision: 1, indexPath: fixture.indexPath }));
  await error(await request("POST", installPath, { ...body, name: "ghost" }), "NOT_FOUND");
  await error(await request("POST", installPath, { ...body, expectedRevision: 999 }), "REVISION_CONFLICT");
  const external = await request("POST", installPath, { ...body, name: "external-skill", version: "2.0.0" });
  expect(await json(external, 400)).toEqual({ error: "Package content is external to this catalog; only catalog-local packages can be inspected", code: "EXTERNAL_LOCATION" });
  const agent = await request("POST", installPath, { ...body, name: "wrapped-one", version: "1.0.0" });
  expect(agent.status).toBe(422);
  expect(await agent.json()).toEqual({ error: "Only skill packages are installable; agent packages are not yet installable", code: "KIND_NOT_INSTALLABLE" });
  // Occupancy conflict: an owned live-root directory named dep-skill → 422 envelope:
  await mkdir(join(liveRoot, "dep-skill"));
  const conflict = await request("POST", installPath, body);
  expect(conflict.status).toBe(422);
  expect(await conflict.json()).toEqual({ error: "Install rejected; the issue code identifies the fixed cause; nothing was installed or changed",
    code: "INSTALL_REJECTED", issue: { code: "SKILL_CONFLICT", at: "installed" } });
  expect(readdirSync(installRoot)).toEqual([]);     // nothing written
  // removed catalog: DELETE with current revision then the route → 410 REMOVED
  expect(calls.fetch).toHaveLength(1);              // the only fetch ever was the one sync
  expect(eventsCount()).toBe(before);               // no events rows from any install call
}, 30000);
```

Every `json()` assertion also checks `Cache-Control: no-store` (existing helper behavior). Both fixture roots are created with `mkdtemp` in `beforeAll`/per-test and removed in an awaited `finally`/`afterAll`; the real repo `skills/` root is never touched (assert `catalogLocalSkillsRoot`/`catalogInstallRoot` are the fixtures in the harness setup).

- [x] **Step 3: RED** (`D/task-3-red-1.{txt,exit}`): the route 404s with the stock Hono body — behavioral RED, since the failure is the missing route, not an interface stub. Preserve the raw log.

- [x] **Step 4: Implement** the request schema and the one appended POST route exactly per the shared prefix; the three error-table entries are already present from Task 2 (verify with `grep -n "INSTALL_REJECTED\|KIND_NOT_INSTALLABLE\|INSTALL_IN_PROGRESS" apps/api/src/routes/catalogs.ts` — exactly ONE entry each). No other route changes.

- [x] **Step 5: GREEN targeted, then regression:** the new file, `catalogs.sync.integration.test.ts`, `catalogs.packages.integration.test.ts`, `catalogs.import-preview.integration.test.ts`, `catalogs.integration.test.ts`, and the Task 2 service files all green (`D/task-3-green-1.txt`, `D/task-3-green-2.txt`). Assert `git diff TASK_BASE -- apps/api/src/app.ts` shows exactly the Task 2 wiring diff and `git diff --exit-code TASK_BASE -- packages/` shows ONLY the Task 1 db changes.

- [x] **Step 6: Full validation + scoped commit.**

```bash
LABEL=task-3-final-1
bash "$D/parent-verify.sh" "$LABEL"
python3 "$D/compare-lint.py" "$LABEL" > "$D/$LABEL-comparison.txt"
cmp "$D/task-1-baseline-root-lint.txt" "$D/$LABEL-root-lint.txt"
git diff --check
git add apps/api/src/routes/catalogs.ts apps/api/src/catalogs.install.integration.test.ts
git commit -m "feat(catalogs): add admin-only package install route"
```

### Task 4: Desktop install UI + docs

**Files:**
- Modify: `apps/admin-ui/src/catalogs/api.ts` (types, 1 method, decoder, 3 classify rows, 3 copy entries), `apps/admin-ui/src/catalogs/api.test.ts`
- Modify: `apps/admin-ui/src/catalogs/configuration-state.ts` (`InstallPanel`, `install` snapshot field, `requestInstall`/`cancelInstall`/`confirmInstall`, lifecycle), `apps/admin-ui/src/catalogs/configuration-state.test.ts`
- Modify: `apps/admin-ui/src/hooks/useCatalogConfiguration.ts` (`restrictedActions` gains `install: null` and the three noop actions)
- Modify: `apps/admin-ui/src/screens/CatalogsScreen.tsx` (install controls + result inside `ImportPreviewSection`; one appended framing sentence), `apps/admin-ui/src/screens/CatalogsScreen.test.tsx`
- Docs: `docs/SPEC.md`, `docs/superpowers/specs/2026-09-09-skill-agent-catalogs-design.md` (status paragraph only), `docs/research/skill-agent-sharing-tasks.md`

**Interfaces:**
- Consumes: Task 3 route/JSON; existing `ImportPreviewPanel`, `PackagesPanel`, `packagesGeneration`, `previewImport` gates, `CatalogsView` structure.
- Produces: `CatalogInstallPackage`, `CatalogInstallView`, `CatalogApi.installCatalogPackage`; `InstallPanel`, `ConfigurationSnapshot.install`, `ConfigurationController.requestInstall`/`cancelInstall`/`confirmInstall`; the install markup contract used by the screen tests. Nothing after this task consumes new interfaces.

- [x] **Step 1: Capture TASK_BASE/state to `D/task-4-start.txt`; assert HEAD == Task 3 commit, clean tree/index.**

- [x] **Step 2: api.ts RED/GREEN.** Extend the `mappings`-style return with `installCatalogPackage` (`POST /api/catalogs/<id>/install`, body per the shared prefix including `confirm: true` and the conditional `expectedRevision`), decoding through a new `installView` decoder (built from the EXISTING `object`/`text`/`nonNegativeInt`/`list` helpers plus the EXISTING `importPreviewIdentity`; `kind === "catalog-install"`, `activated === false` and `action` `"installed" | "reused"` are enforced). Failure rows: the three new classify rows per the shared prefix; 404 → `missing` + `copy.packageMissing` (same remap as `previewCatalogImport`). Malformed-result rejections (`null`, `{}`, missing `root`, `packages` not an array, bad `action`, `activated` not `false`, `recordsWritten` negative) → `protocol`. Leakage test: a raw install body embedding extra `"credential":"syn-marker"` fields at top level and inside `root` decodes successfully and `JSON.stringify(result)` never contains `syn-marker`. RED first (method absent → type error, honest interface-only RED label), then GREEN.

- [x] **Step 3: configuration-state.ts RED/GREEN.** Implement the shared-prefix lifecycle exactly: `install: null` in `empty()`; resets at every importPreview reset site; `selectPackage` success seeds `{ armed: false, result: null, message: null }`; `changeImportPreviewTarget` resets it; `requestInstall`/`cancelInstall` arming discipline; `confirmInstall` gates + local blank-version gate + tools split + `expectedRevision: detail.revision` + fresh `authorize` + `"mutation"`-kind operation + generation/panel match before publish + success clears `importPreview.result` + conflict → `reloadRequired` + no retry. Tests (mirroring the existing importPreview tests): a successful `selectPackage` seeds both panels; `requestInstall` arms and clears a prior result/message; `cancelInstall` disarms; `confirmInstall` while unarmed is a no-op with NO api call; blank OrgOps version publishes the invalid copy into `install.message` and makes NO api call; a successful confirm publishes the result AND nulls `importPreview.result`; an indexPath change or selection switch between request and settle blocks publication; 401/403 route to authority loss; an `INSTALL_REJECTED` outcome publishes the fixed message with `result: null` and stays disarmed; a 409 conflict publishes `reloadRequired`; busy gating refuses a second concurrent confirm; no automatic retry after `network`/`protocol`; existing importPreview `toEqual` panel assertions pass UNMODIFIED (the panel shape is unchanged). RED (absent methods/field), then GREEN.

- [x] **Step 4: CatalogsScreen.tsx RED/GREEN (SSR markup tests).** Render the install UI inside `ImportPreviewSection` per the shared prefix (verbatim Phase 12 framing + the ONE appended sentence, "Install package" button disabled while `disabled` or the OrgOps version is blank, armed confirmation block with the exact impact copy, `InstallResult` block, `<p role="alert">`). Tests assert: the "Install package" button is present whenever the preview section is and disabled with a blank OrgOps version; no confirm block renders until armed; arming renders the exact impact copy and both buttons; a populated `install.result` renders the framing line, both package lines in order with `installed`/`reused` and the identity text, and the records-written line; authored markup in a name/description is escaped; no anchor/enable/start/secret affordance exists in the section markup (`expect(html).not.toContain("dangerouslySetInnerHTML")` style structural assertions as in the existing suite); the alert shows the fixed failure copy; the Phase 12 framing assertion (`toContain` of the original sentence) and ALL existing screen tests pass UNMODIFIED.

- [x] **Step 5: Docs.** `docs/SPEC.md`: (a) amend the Phase 12 "Read-only catalog import preview (Option A)" subsection with an origin-aware paragraph (recorded origins + matching install-root content become `measured`/reuse; occupied-only `blockedLocalNames`; everything else unchanged); (b) append a "Catalog package installation (write path)" subsection right after it documenting: the `catalog_installed_origins` table (migration 033) as minimal non-authoritative provenance (origin identity, local path, actor, time; NO approval/authority/runnable state); the owned install root (`<DATA_DIR>/catalog-installed`, test-seamed) as the ONLY filesystem write target — installed packages are deliberately OUTSIDE the live skills root, so the API's TTL-cached `listSkills(SKILL_ROOT)` → `loadSkillEventShapes` dynamic-import path can never load installed-but-unactivated `event-shapes` modules, and installed skills are invisible to agent skill enabling/prompts until the Phase 14 activation slice (the exact authored-module activation boundary and hand-off); the admin-only POST route with the exact strict body (`confirm: true`, optional `expectedRevision`) and success shape (`activated: false` literal); the three appended envelopes (`INSTALL_REJECTED` 422 with fixed `issue` enum, `KIND_NOT_INSTALLABLE` 422, `INSTALL_IN_PROGRESS` 409) and the fixed failure ordering; the reuse/include/conflict semantics delegated to the UNCHANGED `prepareImport` (origins double as `knownReleases`: changed content under a known version fails); exclusive target-name claims with staged-content promotion and narrow rollback (only created paths; rows last in one transaction; no overwrite/uninstall); the bounds (reuse of `CATALOG_IMPORT_PREVIEW_LIMITS`/`IMPORT_LIMITS` + the 4 MiB pre-write response ceiling); the base64-free closed projection (no `localPath`/host paths/repository URLs/credentials); the no-fetch/no-credential/no-events guarantees; and the honesty caveats (completeness covers the install root + configured live skills root only; install grants no activation/start/secret authority and no affordance exists; untrusted mirrored content; a recorded origin whose install-root content is missing or tampered stays OCCUPIED/fail-closed — there is no silent reinstall or overwrite, and repair is a future administrative operation, not part of this phase). Design spec status paragraph: append the Phase 13 sentence (installation write path implemented/reviewed/verified under mechanism 2; activation, secrets binding, agent creation, publishing UI and the mobile shell still outstanding). `skill-agent-sharing-tasks.md`: add the completed Phase 13 line. `docs/catalog-package-contract.md` stays unchanged.

- [x] **Step 6: Full validation + scoped commits.**

```bash
LABEL=task-4-final-1
bash "$D/parent-verify.sh" "$LABEL"
python3 "$D/compare-lint.py" "$LABEL" > "$D/$LABEL-comparison.txt"
cmp "$D/task-1-baseline-root-lint.txt" "$D/$LABEL-root-lint.txt"
git diff --check
git add apps/admin-ui/src/catalogs/api.ts apps/admin-ui/src/catalogs/api.test.ts \
        apps/admin-ui/src/catalogs/configuration-state.ts apps/admin-ui/src/catalogs/configuration-state.test.ts \
        apps/admin-ui/src/hooks/useCatalogConfiguration.ts \
        apps/admin-ui/src/screens/CatalogsScreen.tsx apps/admin-ui/src/screens/CatalogsScreen.test.tsx
git commit -m "feat(catalogs): add desktop catalog package install control"
git add docs/SPEC.md docs/superpowers/specs/2026-09-09-skill-agent-catalogs-design.md docs/research/skill-agent-sharing-tasks.md
git commit -m "docs(catalogs): document catalog package installation write path"
```
