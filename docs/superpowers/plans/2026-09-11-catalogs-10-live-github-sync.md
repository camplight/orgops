# Live GitHub Catalog Sync (Read-Only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (parent controller only) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Workers must not launch nested agents.

**Goal:** Add a bounded, administrator-triggered, read-only sync path that materializes a configured GitHub catalog source into an OrgOps-owned local bare mirror and reuses the EXISTING offline Git inspection to expose the synced commit and catalog index entries on the existing desktop Catalogs screen.

**Architecture:** A pure GitHub-only destination policy validates the configured repository URL. A private sanitized Git transport (constant environment, env-only credential injection, no redirects, bounded time/output, awaited POSIX-group ownership) fetches into a staging ref inside one owned bare mirror per source under DATA_DIR; the existing `readGitCatalogIndex` inspects the staged commit BEFORE an atomic `update-ref` promotion, so a failed sync leaves the previous mirror usable. An admin-only API service/route pair and a minimal desktop-only UI addition complete the slice. No persistence schema change, no audit-event change, no package import/install/activation/publication, nothing written back to GitHub.

**Tech Stack:** Existing TypeScript, Node `child_process.spawn`/`fs/promises`, `better-sqlite3`, `@orgops/crypto`, `@orgops/schemas`, `@orgops/skills` (`readGitCatalogIndex`), Hono routes, React admin-ui, colocated Vitest; npm only. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-09-skill-agent-catalogs-design.md`; `docs/SPEC.md`; `docs/catalog-package-contract.md`; binding `.superpowers/sdd/2026-09-11-catalogs-10-live-github-sync/controller-brief.md`.

## Global Constraints / Entire Identical Shared Task Prefix

Everything before `### Task 1` is the ENTIRE shared contract and must prefix every task brief byte-for-byte. The installed SDD script extracts only a task body: preserve each raw extraction, then prepend this prefix to a distinct final brief. No shared requirements occur after the task bodies.

### Authority and workflow

- Work only in `/home/slamnation/www/orgops`, existing branch `88-move-private-skills-into-a-private-repo`. Accepted planning base: `53fa343fbaf1250f631eec3e339b03be40673048`, initially clean tracked tree/index. `D=/home/slamnation/www/orgops/.superpowers/sdd/2026-09-11-catalogs-10-live-github-sync`.
- PLANNING gate: parent reads the ENTIRE concrete plan and explicitly approves it before a plan commit or any source/test edit. Planner remains available for corrections. Planning commit contains ONLY this plan. New phase artifacts, probe attempts, task briefs and logs remain under D and unstaged. Prior phases and their evidence remain read-only.
- One sequential writer, fresh read-only task review after each task/fix, whole-phase review and independent fresh parent verification. No nested agents, worktrees, pushes, merges, remote writes, actual installation/activation/start/publication, production roots/state/services/configuration/HOME/credentials, dependency/package/lock changes. Never read `.env` or `VAULT_REPO_TOKEN` in automated tests or validation.
- Owner decisions (2026-09-11) are binding: Q1 = GitHub-hosted repositories ONLY, public or private via an HTTPS read token; LAN/VPN/private-IP Git servers are out of scope; default-deny every non-GitHub destination; never forward credentials across redirects. Q2 = desktop-first; phone-width/mobile admin shell is a separate required pre-final task and OUT OF SCOPE here.
- No new owner product/security policy. Escalate a material gap through `contact_supervisor` and wait; report blocked if useful work needs new owner policy.
- Tool/runtime/extension/native-output-contract failures stop immediately with exact error, run identifier, cwd, branch/full ref, status, worktree diff and index diff. Continue only on explicit same-native-protocol recovery; never external CLI/foreground fallback. Native `structured_output` verdict is mandatory, not inferred from Markdown.
- New disk fixtures are only new owned directories under D/scratch via phase-owned TMPDIR (tests themselves use ambient `os.tmpdir()` mkdtemp so plain `npm test` still passes), cleaned in awaited finally blocks. Automated tests NEVER touch the network, a real `.env`, `VAULT_REPO_TOKEN`, or production DATA_DIR. Production sync code performs no writes outside its owned mirror directory, spawns no shells, executes no repository-authored content (hooks/filter/LFS/submodule/smudge disabled by construction), and reads credentials only from the existing encrypted `catalog_read_credentials` store inside the sync operation.

### Read/map evidence and unchanged seams

Planner read full AGENTS.md, the approved design, `docs/SPEC.md`, the complete `docs/catalog-package-contract.md`, `docs/research/skill-agent-sharing-tasks.md` (Q1/Q2 resolutions), and all current anchors: `apps/api/src/app.ts`, `apps/api/src/admin-access.ts`, `apps/api/src/catalog-configuration.ts`, `apps/api/src/routes/catalogs.ts`, `apps/api/src/catalogs.integration.test.ts`; `packages/db/src/{index,schema}.ts` and migrations (next free number is 033; NOT used — see "no schema change" below); `packages/crypto/src/index.ts`; `packages/skills/src/catalogs/{git-session,git-object-reader,git-inspection,git-publication-evidence}.ts` and fixtures; `packages/schemas/src/catalogs/{primitives,configuration,index}.ts` and `packages/schemas/src/index.ts`; `apps/admin-ui/src/catalogs/{api,configuration-state}.ts`, `apps/admin-ui/src/screens/CatalogsScreen.tsx` and their tests.

| Path / interface | Owner | Responsibility / preflight |
|---|---|---|
| `apps/api/src/catalog-sync/github-destination.ts` + `.test.ts` | Task 1 | Pure GitHub-only destination policy; no I/O, no imports beyond nothing |
| D/`parent-verify.sh`, D/`compare-lint.py` | Task 1 | Copy/adapt Phase-9 verification scripts into D only; fresh baseline logs |
| `apps/api/src/catalog-sync/git-fetch.ts` + `.test.ts` | Task 2 | Sanitized bounded spawn runner, env-only credential injection, fetch/resolve/update/delete ref ops |
| `apps/api/src/catalog-sync/mirror.ts` + `.test.ts` | Task 2 | Owned bare mirror create/verify under `<DATA_DIR>/catalog-mirrors/<sourceId>` |
| `apps/api/src/catalog-sync/fixtures.test-helper.ts` | Task 2 | Test-only fake git executable + local fixture bare-repo transport double; never imported by production |
| `packages/schemas/src/catalogs/configuration.ts`, `packages/schemas/src/index.ts` (+ `configuration.test.ts`) | Task 3 | Add `CatalogSyncRequestSchema` only; existing schemas byte-stable |
| `apps/api/src/catalog-sync/sync.ts` | Task 3 | Sync service: auth recheck, metadata, policy, per-source lock, credential decrypt seam, mirror+transport+inspection composition |
| `apps/api/src/routes/catalogs.ts` | Task 3 | Append 2 routes + 5 error entries; all existing routes/tests byte-compatible |
| `apps/api/src/app.ts` | Task 3 | Wire `createCatalogSync` + 2 optional AppConfig fields; no other behavior change |
| `apps/api/src/catalogs.sync.integration.test.ts` | Task 3 | Full HTTP/auth/credential/failure matrix through `createApp`, no network |
| `apps/admin-ui/src/catalogs/api.ts` + `api.test.ts` | Task 4 | `syncCatalog`/`getCatalogSync` + sync view decode/classify |
| `apps/admin-ui/src/catalogs/configuration-state.ts` + `.test.ts` | Task 4 | Sync panel state, operation ownership, race/authority behavior |
| `apps/admin-ui/src/screens/CatalogsScreen.tsx` + `.test.tsx` | Task 4 | Desktop-only sync section in catalog detail; existing flows untouched |
| `docs/SPEC.md`, design spec status paragraph, `docs/research/skill-agent-sharing-tasks.md` | Task 4 | Document implemented sync contract + trust caveats; mark phase |
| All existing skills/schemas/db/crypto/import/publication/Git-inspection modules and tests | Read-only all tasks | No semantic or diagnostic-position changes |
| D/task-N-* and distinct fix/attempt paths | Respective writer | Chronology, 15 logs/exits, lint comparisons, diff/commit evidence |

No new resolver, semantic inspector, credential store, retrieval API, audit event type, migration, top-level state directory, scheduler, or background polling. `packages/skills` gains NOTHING: the existing offline inspection is consumed as-is through its public exports.

### Exact new contract

```ts
// apps/api/src/catalog-sync/github-destination.ts (Task 1; pure, frozen output)
export type GitHubDestination = Readonly<{ owner: string; name: string; fetchUrl: string }>;
export type GitHubDestinationResult = { ok: true; value: GitHubDestination } | { ok: false };
export function parseGitHubDestination(url: string): GitHubDestinationResult;
```

Accept EXACTLY `https://github.com/<owner>/<repo>` with an optional single trailing `.git`; produce canonical `fetchUrl = https://github.com/<owner>/<name>.git`. `owner`: `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$` (1–39 chars; alphanumeric first and last, hyphens only internal). `name` (after stripping one `.git`): `^[A-Za-z0-9._-]{1,100}$`, not `.`/`..`, not still ending in `.git`. Reject (one fixed `{ok:false}`, no detail): any other host or host case (`GITHUB.com`, `www.github.com`, `github.com.evil`, IP literals, IPv6), any port, userinfo, query, fragment, percent/backslash/control bytes, non-`https` scheme, uppercase scheme, fewer/more than two path segments, empty segments, non-string/over-2048 input. Validation runs on the CONFIGURED repository URL only, never on a mirror path or remote name. GitHub-only is not authenticated-origin proof; mirrored bytes remain untrusted repository content.

```ts
// apps/api/src/catalog-sync/git-fetch.ts (Task 2; deep module, NOT re-exported from any package root)
export const CATALOG_SYNC_GIT_LIMITS = Object.freeze({
  fetchMs: 60000, commandMs: 10000,
  stdoutBytes: 65536, stderrBytes: 65536,
  mirrorPathBytes: 4096, configBytes: 4096, packDirectoryEntries: 512,
} as const);
export const CATALOG_SYNC_STAGING_REF = "refs/orgops-sync/staging";
export const CATALOG_SYNC_CURRENT_REF = "refs/orgops-sync/current";
export type CatalogGitFailure = {
  code: "GIT_UNAVAILABLE" | "GIT_FAILED" | "GIT_TIMEOUT" | "GIT_LIMIT_EXCEEDED" | "GIT_PROTOCOL_ERROR" | "REF_MISSING";
};
export type CatalogGitResult<T> = { ok: true; value: T } | { ok: false; issue: CatalogGitFailure };
export type CatalogGitCredential = { username: string; password: string };
export type CatalogGitTransport = {
  fetch(destination: GitHubDestination, ref: string, mirror: string,
    credential: CatalogGitCredential | undefined): Promise<CatalogGitResult<true>>;
  resolveRef(mirror: string, ref: string): Promise<CatalogGitResult<string>>;
  updateRef(mirror: string, ref: string, commit: string, expected: string | null): Promise<CatalogGitResult<true>>;
  deleteRef(mirror: string, ref: string): Promise<CatalogGitResult<true>>;
};
export function createCatalogGitTransport(executable: string): CatalogGitTransport;
```

Environment (exact; credential pair appended ONLY for `fetch` and ONLY when a credential exists):

```ts
const environment = Object.freeze({
  PATH: "", HOME: "/dev/null", XDG_CONFIG_HOME: "/dev/null", LC_ALL: "C", LANG: "C",
  GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0", GIT_ALLOW_PROTOCOL: "https", GIT_OPTIONAL_LOCKS: "0", GIT_ATTR_NOSYSTEM: "1",
});
function fetchEnvironment(credential: CatalogGitCredential | undefined): Record<string, string> {
  if (!credential) return { ...environment };
  // The ONLY place the plaintext secret exists: an ephemeral child-process env value.
  // Never argv, never a URL, never a written/persisted file, never a log/error.
  const header = `Authorization: Basic ${Buffer.from(`${credential.username}:${credential.password}`, "utf8").toString("base64")}`;
  return { ...environment,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: header };
}
```

argv (exact; no secret ever appears): shared prefix `["--no-pager", "--no-optional-locks", `--git-dir=${mirror}`, "-c", "credential.helper=", "-c", "core.hooksPath=/dev/null", "-c", "maintenance.auto=false", "-c", "gc.auto=0"]`; then

- `fetch`: `["-c", "http.followRedirects=false", "fetch", "--no-tags", "--depth=1", destination.fetchUrl, `+${sourceRef}:${CATALOG_SYNC_STAGING_REF}`]` where `sourceRef = ref.startsWith("refs/") ? ref : `refs/heads/${ref}`` and `ref` is the configured catalog ref (already `CatalogRefSchema`-bounded, re-validated before use).
- `resolveRef`: `["rev-parse", "--verify", ref]`; success output must be exactly 40 lowercase hex + `\n` else `GIT_PROTOCOL_ERROR`; exit != 0 → `REF_MISSING`.
- `updateRef`: `["update-ref", ref, commit, expected ?? "0000000000000000000000000000000000000000"]` (zero old = must-not-exist guard).
- `deleteRef`: `["update-ref", "-d", ref]`.

Runner discipline (same as accepted Phase-4 decisions): `spawn(executable, args, { cwd: mirror, shell: false, detached: true, stdio: ["ignore", "pipe", "pipe"], env })`; manual cumulative byte counters kill the owned POSIX group (`process.kill(-child.pid, "SIGKILL")`) past stdout/stderr caps → `GIT_LIMIT_EXCEEDED`; monotonic timeout (`fetchMs`/`commandMs`) → `GIT_TIMEOUT`; ENOENT → `GIT_UNAVAILABLE`; nonzero exit/signal → `GIT_FAILED`. stderr is counted then DISCARDED, never returned/logged. Every child close is awaited; no `.unref()`, no unbounded `execFile` buffers, no shell, no hooks, no inherited config/proxies/auth. A test-only `runner` seam is NOT exported: tests inject behavior via `createCatalogGitTransport(executable)` pointing at an owned fake executable fixture, or replace the whole `CatalogGitTransport` at the service seam.

```ts
// apps/api/src/catalog-sync/mirror.ts (Task 2; deep module)
export type CatalogMirrorResult = { ok: true; directory: string } | { ok: false; code: "MIRROR_INVALID" | "MIRROR_IO" };
export function ensureCatalogMirror(mirrorsRoot: string, sourceId: string): Promise<CatalogMirrorResult>;
```

Mirror root is exactly `<DATA_DIR>/catalog-mirrors` (existing `createApp({dataDir})` convention; no new top-level state directory). `sourceId` re-validated by `SourceIdSchema`; joined path ≤ `mirrorPathBytes`. Creation (only when absent): `mkdir` root 0o700, then the source dir with EXACT layout: `config` = byte-exact accepted template `[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = true\n`, `HEAD` = `ref: refs/heads/main\n`, directories `objects/pack`, `objects/info`, `refs`; all writes `wx`-flag; any failure removes only the just-created dir and yields `MIRROR_IO`. Existing dir: lstat not-symlink directory; read `config` ≤4096 bytes and byte-compare to the accepted sha1 templates (filemode true or false); require `objects`, `objects/info`, `objects/pack` real directories; reject presence of `commondir`, `config.worktree`, `objects/info/alternates`, `objects/info/http-alternates`, any `.promisor` name in `objects/pack` (≤512 entries) → `MIRROR_INVALID`. No remotes can exist because config is byte-exact. Inspection later re-verifies all of this independently.

```ts
// packages/schemas/src/catalogs/configuration.ts (Task 3; additive only)
export const CatalogSyncRequestSchema = z.object({
  expectedRevision: RevisionSchema, indexPath: RelativePathSchema,
}).strict();
export type CatalogSyncRequest = z.infer<typeof CatalogSyncRequestSchema>;
```

```ts
// apps/api/src/catalog-sync/sync.ts (Task 3)
export type CatalogSyncErrorCode = "INVALID_REQUEST" | "FORBIDDEN" | "NOT_FOUND" | "REMOVED"
  | "STATE_CONFLICT" | "REVISION_CONFLICT" | "DESTINATION_REJECTED" | "CREDENTIAL_UNAVAILABLE"
  | "MIRROR_INVALID" | "SYNC_IN_PROGRESS" | "SYNC_FAILED" | "STORAGE_FAILURE";
export type CatalogSyncResult<T> = { ok: true; value: T } | { ok: false; code: CatalogSyncErrorCode };
export type CatalogSyncView = {
  catalogId: string; sourceId: string; ref: string; commit: string; index: CatalogIndex; // frozen parsed index
};
export type CatalogSyncDeps = {
  db: OrgOpsDb;
  configuration: ReturnType<typeof createCatalogConfiguration>;
  findHuman: (id: string) => AdminHuman | undefined;
  getMasterKey: () => string;
  mirrorsRoot: string;
  gitExecutable: string;
  transport?: CatalogGitTransport; // test-only seam; production leaves undefined
};
export function createCatalogSync(deps: CatalogSyncDeps): {
  syncCatalog(actorHumanId: string, catalogId: string, input: CatalogSyncRequest): Promise<CatalogSyncResult<CatalogSyncView>>;
  readCatalogIndex(actorHumanId: string, catalogId: string, indexPath: string): Promise<CatalogSyncResult<CatalogSyncView>>;
};
```

`syncCatalog` order (any failure = one fixed code, no partial promotion):
1. `canManageCatalogs({id: actorHumanId}, {findHuman})` recheck → `FORBIDDEN`.
2. `configuration.getCatalog(catalogId)`; invalid id → `INVALID_REQUEST`, missing → `NOT_FOUND`, `removedAt !== null` → `REMOVED`; `!effectiveEnabled` → `STATE_CONFLICT`; `revision !== input.expectedRevision` → `REVISION_CONFLICT`. `configuration.getSource(catalog.sourceId)`; removed → `REMOVED`.
3. `parseGitHubDestination(source.repository.url)` → else `DESTINATION_REJECTED` (SSH and non-GitHub HTTPS sources both land here).
4. In-process `Map<sourceId, Promise>` lock; occupied → `SYNC_IN_PROGRESS`. Lock released in `finally`.
5. Credential: only if `source.readCredential.state === "configured"`, SELECT `kind, ciphertext_b64` from `catalog_read_credentials` by source_id, `decryptSecret(parseMasterKey(getMasterKey()), ciphertext)`, parse JSON, require `version===1 && kind==="https-basic" && sourceId===source.sourceId && repositoryIdentity===source.repositoryIdentity`; ANY failure/absence → `CREDENTIAL_UNAVAILABLE`. Plaintext lives in one local binding, passed only into `transport.fetch`. No credential for `state === "absent"` (public path).
6. `ensureCatalogMirror(mirrorsRoot, sourceId)` → `MIRROR_INVALID` / `STORAGE_FAILURE`(from `MIRROR_IO`).
7. Read previous `CATALOG_SYNC_CURRENT_REF` via `resolveRef` (`REF_MISSING` → `expected = null`).
8. `fetch(destination, catalog.ref, mirror, credential)` → `SYNC_FAILED`.
9. `resolveRef(mirror, CATALOG_SYNC_STAGING_REF)` → `SYNC_FAILED`; commit must be 40-hex.
10. `readGitCatalogIndex({ repository: { directory: mirror, gitExecutable }, commit, indexPath: input.indexPath })` against the STAGED commit. Any issue → best-effort awaited `deleteRef(staging)` → `SYNC_FAILED`. Previous `current` untouched.
11. `updateRef(mirror, CATALOG_SYNC_CURRENT_REF, commit, expected)` atomic with old-value guard → `SYNC_FAILED` on failure (`current` unchanged, previous mirror usable). After a CONFIRMED promotion, `deleteRef(mirror, CATALOG_SYNC_STAGING_REF)` is BEST-EFFORT: awaited, but its failure does NOT change the success result — a leftover staging ref is harmless because the next fetch force-updates it. The client never sees a failure while GET shows the new commit.
12. Return `{ catalogId, sourceId, ref: catalog.ref, commit, index }`. All inspection failures/timeouts/limits collapse to `SYNC_FAILED`; their structured issues stay in-process, never in responses/logs.

`readCatalogIndex` (GET view; NO fetch, NO credential, NO writes): auth recheck; catalog exists/not removed (`NOT_FOUND`/`REMOVED`); source exists/not removed; `ensureCatalogMirror` in verify-only mode (creation disabled: absent root → `NOT_FOUND`); `resolveRef(current)` → `REF_MISSING` ⇒ `NOT_FOUND`; `readGitCatalogIndex` at that commit with the supplied `indexPath` → `SYNC_FAILED`; return the same view shape. No `effectiveEnabled` requirement for the read-only view (a disabled catalog's last synced bytes remain inspectable; removal still blocks).

Routes (Task 3; appended inside existing `registerCatalogRoutes`, existing entries byte-unchanged):

```ts
// deps gain: sync: ReturnType<typeof createCatalogSync>
app.post("/api/catalogs/:catalogId/sync", requireAuth, requireAdmin, mutation-like handler):
  // principal runnerScope guard, CatalogIdSchema path check, bounded readBody (existing 16384-byte helper),
  // CatalogSyncRequestSchema, then sync.syncCatalog(principal.id, id, body); 200 view or failure(code).
app.get("/api/catalogs/:catalogId/sync", requireAuth, requireAdmin, read-like async handler):
  // ?indexPath= required, RelativePathSchema-validated; sync.readCatalogIndex; 200 view or failure(code).
```

Appended error-table entries (existing keys/messages byte-identical):

```ts
DESTINATION_REJECTED: [400, "Repository destination is not an allowed GitHub HTTPS repository"],
CREDENTIAL_UNAVAILABLE: [503, "Catalog read credential is unavailable; reconfigure the source read credential"],
MIRROR_INVALID: [500, "Catalog mirror storage is invalid"],
SYNC_IN_PROGRESS: [409, "Catalog synchronization is already in progress"],
SYNC_FAILED: [502, "Catalog synchronization failed"],
```

`GET` "no synced result yet" reuses existing `NOT_FOUND` (404). Both paths sit under `/api/catalogs` so the existing `Cache-Control: no-store` middleware covers them unchanged. Route failure typing: widen the handler helper to `type CatalogRouteErrorCode = CatalogConfigErrorCode | CatalogSyncErrorCode`, retype the `errors` table as `Record<CatalogRouteErrorCode, readonly [number, string]>` (existing 11 entries byte-identical, 5 appended), and retype `failure(c, code: CatalogRouteErrorCode)`. The sync service returns ONLY this enumerated set — `INVALID_REQUEST`, `FORBIDDEN`, `NOT_FOUND`, `REMOVED`, `STATE_CONFLICT`, `REVISION_CONFLICT`, `STORAGE_FAILURE` (existing codes) plus `DESTINATION_REJECTED`, `CREDENTIAL_UNAVAILABLE`, `MIRROR_INVALID`, `SYNC_IN_PROGRESS`, `SYNC_FAILED` — so every returned code has a table entry and handlers compile without casts. No secret, ciphertext, credential ref, repository URL beyond configured metadata, or raw host path appears in ANY response or log; the view is exactly `{catalogId, sourceId, ref, commit, index}`. `CatalogIndex` entries contain only portable package identity/location fields — no host paths. `gitExecutable` is supplied as `config.catalogGitExecutable ?? process.env.ORGOPS_CATALOG_GIT ?? "/usr/bin/git"` (trusted administrator-provisioned absolute path; validated by existing inspection input snapshot). `mirrorsRoot = join(DATA_DIR, "catalog-mirrors")`. AppConfig gains exactly two optional fields: `catalogGitExecutable?: string` and `catalogSyncTransport?: CatalogGitTransport` (test-only seam, documented as such, never set by production entrypoints).

### Security decisions requiring explicit parent sign-off

1. Credential injection mechanism = `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`/`GIT_CONFIG_VALUE_0` child env (`http.https://github.com/.extraheader` = `Authorization: Basic base64(username:password)`), present ONLY on the `fetch` child. Proven never-in-argv/never-on-disk by capture assertions (Task 2). Redirects are hard-disabled (`http.followRedirects=false`), so the header can never be forwarded; `GIT_ALLOW_PROTOCOL=https` plus exact policy URL means only github.com over TLS is reachable; empty `credential.helper=`, `/dev/null` global/system config, and `core.hooksPath=/dev/null` block ambient credential/helper/hook paths.
2. Fetch is `--depth=1 --no-tags` into `refs/orgops-sync/staging`; promotion is one atomic `update-ref` with old-value guard to `refs/orgops-sync/current` AFTER the existing inspection accepts the staged commit. A failed sync leaves the previous mirror/ref usable; no partial success.
3. No schema migration (no retained cross-sync history/authority); the GET view re-reads the owned mirror. No new audit event type (sync is not a configuration mutation; it writes only inside the owned mirror).
4. Test seam = optional `catalogSyncTransport` on `AppConfig` plus owned fake-executable fixtures; it cannot bypass destination policy, auth, or credential binding, and production never sets it.
5. Mirror config is written byte-exact by us (not `git init`), satisfying the existing inspection preflight without weakening it; no remotes, alternates, promisor, hooks or includes can exist.
6. Mirror content is untrusted: no claim of authenticated GitHub origin; no executed authored content; package import/install/activation remain separate future phases.
7. Env-based secret passing means the token is transiently present in the fetch child's environment (readable via same-uid `/proc/<pid>/environ`). This is an accepted residual of the sanctioned mechanism, not an absolute unobservability guarantee; the secret still never reaches argv, URLs, disk files, persisted Git config, logs, errors, or responses.

### Live smoke test policy (separate, parent-authorized; NOT automated)

After implementation and review, the parent MAY run one explicit live check. It is never part of `npm test`, validation, or CI. Token loaded only via the runtime environment (`--env-file=.env` or an env-sourced wrapper); never catted, echoed, logged, committed, or written to any fixture/evidence file. Exact commands:

```bash
cd /home/slamnation/www/orgops
D="$PWD/.superpowers/sdd/2026-09-11-catalogs-10-live-github-sync"
mkdir -p "$D/live-scratch/home" "$D/live-scratch/tmp"
(ulimit -c 0; timeout --kill-after=5s 300s env -i PATH="$PATH" HOME="$D/live-scratch/home" TMPDIR="$D/live-scratch/tmp" CI=1 \
  /bin/bash --noprofile --norc -c 'set -a; source .env; set +a; export ORGOPS_LLM_STUB=1; exec "$@"' bash \
  npm exec --no -- tsx "$D/live-smoke-1.mts") > "$D/live-smoke-1.txt" 2>&1
printf '%s\n' "$?" > "$D/live-smoke-1.exit"
rm -rf "$D/live-scratch/data"   # owned scratch mirror cleanup, awaited by the script before exit as well
```

Task 3 writes `D/live-smoke-1.mts` (evidence-only, untracked). **The task writer CREATES the script but MUST NOT execute it** — it performs network egress and uses the real `VAULT_REPO_TOKEN`; only the parent may run it, after implementation and review. Automated validation never runs it. The script: fresh `createApp({ dataDir: "$D/live-scratch/data", ... })`; login as seeded admin; create source `https://github.com/nikolay-ribarov/orgops-vault`, catalog ref from `LIVE_SMOKE_REF` (default `main`), index path from `LIVE_SMOKE_INDEX` (default `catalog/index.json`); set read credential `{ kind: "https-basic", username: "x-access-token", password: process.env.VAULT_REPO_TOKEN }`; POST sync; assertions: HTTP 200; commit matches `/^[0-9a-f]{40}$/`; response text, every file under the scratch mirror, and the script's own stdout contain NO occurrence of the token (checked programmatically, printing only PASS/FAIL markers); previous-mirror preservation on a forced second-run failure. If `VAULT_REPO_TOKEN` is unset/empty or egress is unavailable, the script prints `LIVE-SMOKE-NOT-RUN` and exits 3; a live result is NEVER claimed without it. Cleanup removes only `$D/live-scratch/data`.

### Validation and chronology (every task/fix)

Before editing capture task base/full ref, cwd/branch, tracked/untracked status, diff/index to unique D paths; assert expected branch/state. Task 1 baseline BEFORE ANY source/test creation: accepted 2095 Vitest tests / 53 files + 3 opscli, unchanged 488 diagnostics (API 486 + agent-runner 2; ten workspaces clean including skills/schemas). Copy/adapt Phase-9 scripts into D only:

```bash
cd /home/slamnation/www/orgops
D="$PWD/.superpowers/sdd/2026-09-11-catalogs-10-live-github-sync"
P="$PWD/.superpowers/sdd/2026-09-11-catalogs-09-offline-local-evidence"
cp "$P/parent-verify.sh" "$D/parent-verify.sh"
cp "$P/compare-lint.py" "$D/compare-lint.py"
python3 - <<'PY'
from pathlib import Path
D = Path('.superpowers/sdd/2026-09-11-catalogs-10-live-github-sync')
p = D / 'parent-verify.sh'
s = p.read_text().replace('2026-09-11-catalogs-09-offline-local-evidence', '2026-09-11-catalogs-10-live-github-sync')
p.write_text(s)
p = D / 'compare-lint.py'
s = p.read_text().replace("d=root/'.superpowers/sdd/2026-09-11-catalogs-09-offline-local-evidence'", "d=root/'.superpowers/sdd/2026-09-11-catalogs-10-live-github-sync'")
s = s.replace('2026-09-10-catalogs-08-offline-import-preparation/parent-final-lint.json', '2026-09-11-catalogs-09-offline-local-evidence/parent-final-lint.json')
p.write_text(s)
PY
bash "$D/parent-verify.sh" task-1-baseline
python3 "$D/compare-lint.py" task-1-baseline > "$D/task-1-baseline-comparison.txt"
cmp "$P/parent-final-root-lint.txt" "$D/task-1-baseline-root-lint.txt"
```

All 12 workspaces independently: api, agent-runner, opscli, admin-ui, user-ui, db, schemas, event-bus, llm, crypto, skills, events-scenario-tests; plus root test/opscli/root lint = 15 exact unique exit labels and nonempty raw logs. Exact expected exits: test 0, opscli 0, root-lint 2, lint-api 2, lint-agent-runner 2, other 10 lint 0. Full path/line/column/code/multiline-message/multiplicity Counter comparison; reject unparsed/missing logs or wrong exits. No diagnostic-bearing source edits or position normalization. Root lint raw bytes must remain identical to the fresh Phase-10 baseline. Root lint short-circuits at API; never substitute it for all-workspace runs. Test count increases only from scoped new tests. The isolation wrapper never sources the real `.env` — automated runs source `.env.example` only:

```bash
D=/home/slamnation/www/orgops/.superpowers/sdd/2026-09-11-catalogs-10-live-github-sync
isolated() {
  (ulimit -c 0; timeout --kill-after=5s 600s env -i PATH="$PATH" \
    HOME="$D/scratch/home" TMPDIR="$D/scratch/tmp" CI=1 \
    /bin/bash --noprofile --norc -c \
    'set -a; source .env.example; set +a; export ORGOPS_LLM_STUB=1; exec "$@"' bash "$@")
}
# Targeted example (replace label/file per task):
isolated npm exec --no -- vitest run apps/api/src/catalog-sync/github-destination.test.ts \
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
| 1 | Accepted base + parent-approved plan-only commit, clean tracked tree; full fresh baseline FIRST | Pure `parseGitHubDestination` + accept/reject matrix; D verification scripts + baseline logs | exact frozen types; zero imports/I/O; matrix covers userinfo/port/query/fragment/IP/other-scheme/other-host; no other files touched |
| 2 | Parent-reviewed Task 1 commit; full Task 1 brief/common prefix | `createCatalogGitTransport`, `ensureCatalogMirror`, test-only fixtures | env/argv discipline exact; credential only in fetch env; caps/timeout/ownership enforced; mirror layout byte-exact; no production caller yet |
| 3 | Parent-reviewed Task 2 commit; full Task 2 brief/common prefix | `CatalogSyncRequestSchema`, sync service, 2 routes, app wiring, integration tests, `D/live-smoke-1.mts` | existing routes/tests byte-compatible; auth matrix incl. runner-with-admin-cookie; public/private credential paths via injected transport; failed sync preserves mirror; no secret in any response |
| 4 | Parent-reviewed Task 3 commit; full Task 3 brief/common prefix | Desktop UI sync section + state/api/tests, docs (SPEC/design/checklist) | Phase-5 auth/race/supersession behavior preserved; existing UI tests pass byte-compatibly; no mobile layout; docs carry trust caveats and live-check status honesty |

Shared dependencies available unchanged in all tasks: `SourceIdSchema`/`CatalogIdSchema`/`RelativePathSchema`/`CATALOG_LIMITS` from `@orgops/schemas`; `decryptSecret`/`parseMasterKey` from `@orgops/crypto`; `readGitCatalogIndex` + `OfflineGitRepository` from `@orgops/skills`; `canManageCatalogs`/`AdminHuman` from `apps/api/src/admin-access`; `createCatalogConfiguration` metadata reads. Review the preflight table plus `git diff --name-only TASK_BASE..HEAD` after every task.

After parent approves this entire plan: commit only the plan with `docs(catalogs): plan live github catalog sync`; then generate `D/task-N-body.md` using installed `/home/slamnation/.pi/agent/git/github.com/obra/superpowers/skills/subagent-driven-development/scripts/task-brief PLAN N OUT`, concatenate the ENTIRE shared prefix and the respective body into `D/task-N-brief.md`. Independently verify exact prefix bytes, complete body equality to the source task region, task identity/no other task bodies, and taskCount 4. Save hashes/lengths/preflight results in D. No source/test implementation during planning.

### Planning self-review (shared)

- Spec coverage: destination policy (brief §"Destination, credential and transport trust") → Task 1; credential injection + transport bounds → Task 2; mirror management + inspection reuse → Tasks 2–3; admin API + result view → Task 3; desktop UI → Task 4; live smoke policy → shared prefix + Task 3 script; validation/baseline → shared prefix + every task.
- Explicitly NOT included (per brief): migrations, audit event types, package import/install/activation, publishing, polling/discovery, non-GitHub transports, mobile layout, two-instance acceptance.
- Type consistency: `parseGitHubDestination`/`GitHubDestination` (T1) → consumed by `CatalogGitTransport.fetch` (T2) and `sync.ts` (T3); `CatalogGitTransport`/`ensureCatalogMirror` (T2) → `CatalogSyncDeps` (T3) → `AppConfig.catalogSyncTransport`; `CatalogSyncView` JSON (T3) → UI `CatalogSyncView` decoder (T4). Error-code unions match the appended route table exactly.

### Task 1: Pure GitHub-only destination policy + fresh Phase-10 baseline

**Files:**
- Create: `apps/api/src/catalog-sync/github-destination.ts`
- Test: `apps/api/src/catalog-sync/github-destination.test.ts`
- Create (evidence only): `D/parent-verify.sh`, `D/compare-lint.py`, `D/task-1-baseline-*` logs

**Interfaces:**
- Consumes: nothing (pure module; no imports at all).
- Produces: `GitHubDestination`, `GitHubDestinationResult`, `parseGitHubDestination(url)` exactly as declared in the shared prefix. Tasks 2–3 consume these names verbatim.

- [x] **Step 1: Capture state and fresh baseline before source/tests.** Run the shared baseline script setup exactly as written in "Validation and chronology" (copy/adapt Phase-9 scripts, `parent-verify.sh task-1-baseline`, `compare-lint.py task-1-baseline`, root-lint `cmp`). Save cwd/ref/branch/status/diff/index to `D/task-1-start.txt`. Assert: 2095 Vitest tests / 53 files, 3 opscli tests, 15 exact exits, 488 diagnostics, byte-identical root lint vs Phase-9 parent final. Stop on any mismatch. Never run configured services; never source real `.env`.

- [x] **Step 2: Write the failing accept/reject matrix test.**

```ts
import { describe, expect, it } from "vitest";
import { parseGitHubDestination } from "./github-destination";

describe("parseGitHubDestination", () => {
  it.each([
    ["https://github.com/org/repo", { owner: "org", name: "repo", fetchUrl: "https://github.com/org/repo.git" }],
    ["https://github.com/org/repo.git", { owner: "org", name: "repo", fetchUrl: "https://github.com/org/repo.git" }],
    ["https://github.com/my-org/re.po_x-y", { owner: "my-org", name: "re.po_x-y", fetchUrl: "https://github.com/my-org/re.po_x-y.git" }],
    ["https://github.com/a/b", { owner: "a", name: "b", fetchUrl: "https://github.com/a/b.git" }],
  ])("accepts %s", (url, expected) => {
    const result = parseGitHubDestination(url);
    expect(result).toEqual({ ok: true, value: expected });
    expect(Object.isFrozen(result.ok ? result.value : null)).toBe(true);
  });
  it.each([
    "https://www.github.com/org/repo", "https://github.com.evil.org/org/repo", "https://GITHUB.com/org/repo",
    "HTTPS://github.com/org/repo", "http://github.com/org/repo", "ssh://git@github.com/org/repo",
    "git://github.com/org/repo", "file:///github.com/org/repo",
    "https://github.com:8443/org/repo", "https://user@github.com/org/repo", "https://user:pw@github.com/org/repo",
    "https://github.com/org/repo?x=1", "https://github.com/org/repo#f", "https://github.com/org/repo%2e%2e",
    "https://192.0.2.1/org/repo", "https://[::1]/org/repo", "https://10.0.0.9/org/repo",
    "https://github.com/org", "https://github.com/org/repo/extra", "https://github.com//repo",
    "https://github.com/org/", "https://github.com/org/repo.git.git", "https://github.com/org/.",
    "https://github.com/./repo", "https://github.com/../repo", "https://github.com/-org/repo",
    "https://github.com/org-/repo", "https://github.com/" + "o".repeat(40) + "/repo",
    "https://github.com/org/" + "r".repeat(101), "https://github.com/org/repo\u0000",
    "", "github.com/org/repo", "https://github.com",
  ])("rejects %s", url => {
    expect(parseGitHubDestination(url)).toEqual({ ok: false });
  });
  it("rejects over-length and non-string-shaped input", () => {
    expect(parseGitHubDestination(`https://github.com/org/${"r".repeat(2048)}`)).toEqual({ ok: false });
    expect(parseGitHubDestination(undefined as unknown as string)).toEqual({ ok: false });
  });
});
```

- [x] **Step 3: Run test to verify it fails.** `isolated npm exec --no -- vitest run apps/api/src/catalog-sync/github-destination.test.ts > "$D/task-1-red-1.txt" 2>&1` → FAIL (module missing — scaffolding RED, honestly labelled), then after creating a stub returning `{ok:false}` for everything, re-run: the "accepts" block fails behaviorally (`task-1-red-2.txt`). Preserve both.

- [x] **Step 4: Implement `github-destination.ts`.**

```ts
export type GitHubDestination = Readonly<{ owner: string; name: string; fetchUrl: string }>;
export type GitHubDestinationResult = { ok: true; value: GitHubDestination } | { ok: false };

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;
const PREFIX = "https://github.com/";

/** GitHub-hosted HTTPS destinations only; validation of the CONFIGURED URL, never a mirror path. */
export function parseGitHubDestination(url: string): GitHubDestinationResult {
  const rejected: GitHubDestinationResult = { ok: false };
  if (typeof url !== "string" || url.length < 1 || url.length > 2048) return rejected;
  if (/[^\x21-\x7e]/.test(url)) return rejected; // controls/space/non-ASCII
  if (!url.startsWith(PREFIX)) return rejected;
  const rest = url.slice(PREFIX.length);
  if (/[\\%?#@:]/.test(rest)) return rejected; // no userinfo/port/query/fragment/escape
  const segments = rest.split("/");
  if (segments.length !== 2 || segments.some(segment => segment.length === 0)) return rejected;
  const [owner, rawName] = segments as [string, string];
  if (!OWNER.test(owner)) return rejected;
  const name = rawName.endsWith(".git") ? rawName.slice(0, -4) : rawName;
  if (!NAME.test(name) || name === "." || name === ".." || name.endsWith(".git")) return rejected;
  return { ok: true, value: Object.freeze({ owner, name, fetchUrl: `${PREFIX}${owner}/${name}.git` }) };
}
```

Note: the `:` rejection in `rest` plus the exact lowercase `PREFIX` make ports/userinfo/alternate hosts/uppercase scheme unreachable; the policy is deliberately exact-case because the Phase-3 canonicalizer already lowercases scheme/host, and double safety rejects anything else.

- [x] **Step 5: Run tests GREEN, then full validation.** Targeted GREEN (`task-1-green-1.txt`), then `LABEL=task-1-final-1` full 15-label run + `compare-lint.py` + root-lint `cmp` + `git diff --check`. 488 diagnostics unchanged; api lint stays 486.

- [x] **Step 6: Commit.**

```bash
git add apps/api/src/catalog-sync/github-destination.ts apps/api/src/catalog-sync/github-destination.test.ts
git commit -m "feat(catalogs): add GitHub-only sync destination policy"
```

### Task 2: Sanitized bounded Git transport + owned bare mirror management

**Files:**
- Create: `apps/api/src/catalog-sync/git-fetch.ts`, `apps/api/src/catalog-sync/mirror.ts`
- Test: `apps/api/src/catalog-sync/git-fetch.test.ts`, `apps/api/src/catalog-sync/mirror.test.ts`
- Create (test-only): `apps/api/src/catalog-sync/fixtures.test-helper.ts`

**Interfaces:**
- Consumes: `parseGitHubDestination` types from Task 1 (`GitHubDestination`); `SourceIdSchema` from `@orgops/schemas`; `createGitFixture` patterns from `packages/skills/src/catalogs/git-fixtures.ts` (read-only reference; do NOT import across packages — replicate the owned-fixture approach inside the api test helper).
- Produces: `CATALOG_SYNC_GIT_LIMITS`, `CATALOG_SYNC_STAGING_REF`, `CATALOG_SYNC_CURRENT_REF`, `CatalogGitFailure`, `CatalogGitResult<T>`, `CatalogGitCredential`, `CatalogGitTransport`, `createCatalogGitTransport(executable)`, `CatalogMirrorResult`, `ensureCatalogMirror(mirrorsRoot, sourceId)` exactly as declared in the shared prefix. Task 3 consumes these verbatim.

**Critical fixture constraint (parent correction):** the production transport spawns children with the constant environment ONLY (`PATH: ""`, no `CATALOG_GIT_*`, no inherited variables). Therefore the fake executable must NOT read any `CATALOG_GIT_*` variable from its environment and must NOT call external utilities (`sleep`, `head`, `tr`, ...): everything it needs — capture path, mode, canned commit, and the expected Authorization header for credential assertions — is BAKED INTO the generated script text at fixture-creation time (one fake per mode), and the script uses POSIX sh builtins only (`printf`, `[ ]`, `while :`, `case`).

- [x] **Step 1: Capture TASK_BASE/state to `D/task-2-start.txt`; assert HEAD == Task 1 commit, clean tracked tree/index.**

- [x] **Step 2: Write the test-only fixture helper (exact interface).** Owns exactly one mkdtemp parent per factory call; portable (ambient TMPDIR); cleans up in `finally`/on construction failure. The fake executable records argv (one `%q`-quoted arg per line) and env PRESENCE MARKERS (never values of unrelated variables) to `$CATALOG_GIT_CAPTURE`, then behaves per `$CATALOG_GIT_MODE`:

```ts
// fixtures.test-helper.ts -- test-only; never imported by production code
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, chmod, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CATALOG_SYNC_STAGING_REF, CATALOG_SYNC_CURRENT_REF, type CatalogGitTransport, type CatalogGitResult } from "./git-fetch";
import type { GitHubDestination } from "./github-destination";

export type FakeGitMode = "ok" | "hang" | "loud" | "fail";
export type FakeGit = { directory: string; executable: string; capture: string; dispose(): Promise<void> };
export async function createFakeGit(mode: FakeGitMode, commit = "0123456789abcdef0123456789abcdef01234567",
  expectedValue0?: string): Promise<FakeGit> {
  const directory = await mkdtemp(join(tmpdir(), "catalog-fake-git-"));
  const dispose = () => rm(directory, { recursive: true, force: true });
  try {
    const executable = join(directory, "fake-git");
    const capture = join(directory, "capture");
    // Bake every value into the script: the child env is the production constant env (PATH=""),
    // so no CATALOG_GIT_* variable and no external utility is available. POSIX sh builtins only.
    const script = `#!/bin/sh
{
  printf 'argc=%s\\n' "$#"
  for a in "$@"; do printf 'arg=%s\\n' "$a"; done
  printf 'count=%s\\nkey0=%s\\n' "\${GIT_CONFIG_COUNT-unset}" "\${GIT_CONFIG_KEY_0-unset}"
  if [ "\${GIT_CONFIG_VALUE_0+set}" = set ]; then
    if [ "$GIT_CONFIG_VALUE_0" = '${expectedValue0 ?? ""}']; then printf 'value0=MATCH\\n'; else printf 'value0=MISMATCH\\n'; fi
  else printf 'value0=ABSENT\\n'; fi
  printf 'allow=%s\\nprompt=%s\\n' "\${GIT_ALLOW_PROTOCOL-unset}" "\${GIT_TERMINAL_PROMPT-unset}"
} >> '${capture}'
case '${mode}' in
  hang) while :; do :; done ;;
  loud) i=0; while [ "$i" -lt 4000 ]; do printf 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\n'; i=$((i+1)); done ;;
  fail) exit 1 ;;
  *) case " $* " in *" rev-parse "*) printf '%s\\n' '${commit}' ;; esac ;;
esac
exit 0
`;
    await writeFile(executable, script, { mode: 0o700 });
    await chmod(executable, 0o700);
    return { directory, executable, capture, dispose };
  } catch (error) { await dispose(); throw error; }
}

/** Real-git local fixture bare repo + a transport double fetching from it (file path, never network). */
export type LocalFixtureRepo = {
  directory: string; commit: string; indexPath: string;
  transport(calls: { fetch: { credential: { username: string; password: string } | undefined }[] }): CatalogGitTransport;
  dispose(): Promise<void>;
};
export async function createLocalFixtureRepo(indexJson: string, gitExecutable = "/usr/bin/git"): Promise<LocalFixtureRepo> {
  const directory = await mkdtemp(join(tmpdir(), "catalog-src-repo-"));
  const dispose = () => rm(directory, { recursive: true, force: true });
  const env = { PATH: "", HOME: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "F", GIT_AUTHOR_EMAIL: "f@x.invalid",
    GIT_COMMITTER_NAME: "F", GIT_COMMITTER_EMAIL: "f@x.invalid",
    GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z" };
  const run = (args: string[], cwd: string, input?: Buffer) => new Promise<void>((resolve, reject) => {
    execFile(gitExecutable, args, { cwd, env, timeout: 10000, maxBuffer: 1048576 }, (error, stdout) => {
      if (error) reject(error); else { (run as { lastOut?: string }).lastOut = stdout; resolve(); }
    }).stdin?.end(input);
  });
  try {
    const work = join(directory, "work"); await mkdir(work);
    await mkdir(join(work, "catalog"));
    await writeFile(join(work, "catalog", "index.json"), indexJson);
    await run(["init", "--quiet"], work);
    await run(["add", "catalog/index.json"], work);
    await run(["commit", "--quiet", "-m", "fixture"], work);
    await run(["rev-parse", "HEAD"], work);
    const commit = (run as { lastOut?: string }).lastOut!.trim();
    await run(["clone", "--quiet", "--bare", work, join(directory, "remote.git")], directory);
    const remote = join(directory, "remote.git");
    return {
      directory, commit, indexPath: "catalog/index.json", dispose,
      transport(calls): CatalogGitTransport {
        return {
          async fetch(_destination: GitHubDestination, ref: string, mirror: string, credential) {
            calls.fetch.push({ credential });
            const spec = `+${ref.startsWith("refs/") ? ref : `refs/heads/${ref}`}:${CATALOG_SYNC_STAGING_REF}`;
            // file:// forces the real fetch-pack/upload-pack path so --depth=1 genuinely
            // produces a SHALLOW mirror (the no-network shallow-path proof; parent correction 6).
            const failure = await new Promise<CatalogGitResult<true>>(resolve => {
              execFile(gitExecutable, [`--git-dir=${mirror}`, "fetch", "--no-tags", "--depth=1", `file://${remote}`, spec],
                { env, timeout: 10000, maxBuffer: 65536 },
                error => resolve(error ? { ok: false, issue: { code: "GIT_FAILED" } } : { ok: true, value: true }));
            });
            return failure;
          },
          async resolveRef(mirror, ref) {
            return new Promise(resolve => {
              execFile(gitExecutable, [`--git-dir=${mirror}`, "rev-parse", "--verify", ref],
                { env, timeout: 10000, maxBuffer: 65536 },
                (error, stdout) => resolve(error ? { ok: false, issue: { code: "REF_MISSING" } }
                  : { ok: true, value: stdout.trim() }));
            });
          },
          async updateRef(mirror, ref, next, expected) {
            return new Promise(resolve => {
              execFile(gitExecutable, [`--git-dir=${mirror}`, "update-ref", ref, next,
                expected ?? "0000000000000000000000000000000000000000"],
                { env, timeout: 10000, maxBuffer: 65536 },
                error => resolve(error ? { ok: false, issue: { code: "GIT_FAILED" } } : { ok: true, value: true }));
            });
          },
          async deleteRef(mirror, ref) {
            return new Promise(resolve => {
              execFile(gitExecutable, [`--git-dir=${mirror}`, "update-ref", "-d", ref],
                { env, timeout: 10000, maxBuffer: 65536 },
                error => resolve(error ? { ok: false, issue: { code: "GIT_FAILED" } } : { ok: true, value: true }));
            });
          },
        };
      },
    };
  } catch (error) { await dispose(); throw error; }
}
```

- [x] **Step 3: Write failing transport tests** (`git-fetch.test.ts`), including the security-critical capture assertions:

```ts
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCatalogGitTransport, CATALOG_SYNC_STAGING_REF } from "./git-fetch";
import { parseGitHubDestination } from "./github-destination";
import { createFakeGit } from "./fixtures.test-helper";

const destination = (() => {
  const parsed = parseGitHubDestination("https://github.com/org/repo");
  if (!parsed.ok) throw new Error("fixture destination rejected");
  return parsed.value;
})();
const secret = "synthetic-secret-token-1234567890";
const expectedHeader = `Authorization: Basic ${Buffer.from(`reader:${secret}`, "utf8").toString("base64")}`;

async function withFake<T>(mode: "ok" | "hang" | "loud" | "fail", run: (fake: Awaited<ReturnType<typeof createFakeGit>>) => Promise<T>): Promise<T> {
  const fake = await createFakeGit(mode, undefined, expectedHeader);
  try { return await run(fake); } finally { await fake.dispose(); }
}

async function scanForSecret(dir: string): Promise<boolean> {
  // Recursive bounded scan: proves the secret never persisted inside the mirror directory.
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { if (await scanForSecret(path)) return true; }
    else if (entry.isFile() && (await readFile(path)).includes(secret)) return true;
  }
  return false;
}

describe("createCatalogGitTransport", () => {
  it("injects the credential ONLY via fetch child env, never argv or disk", async () => withFake("ok", async fake => {
    const transport = createCatalogGitTransport(fake.executable);
    const result = await transport.fetch(destination, "main", fake.directory, { username: "reader", password: secret });
    expect(result).toEqual({ ok: true, value: true });
    const capture = await readFile(fake.capture, "utf8");
    expect(capture).toContain("value0=MATCH");          // exact injected header reached the child env
    expect(capture).toContain("count=1");
    expect(capture).toContain("key0=http.https://github.com/.extraheader");
    expect(capture).toContain("allow=https");
    expect(capture).toContain("prompt=0");
    expect(capture).not.toContain(secret);              // argv/capture never carry the secret
    expect(capture).not.toContain("reader:");
    expect(capture).toContain("--no-tags");
    expect(capture).toContain("--depth=1");
    expect(capture).toContain("http.followRedirects=false");
    expect(capture).toContain("credential.helper=");
    expect(capture).toContain("core.hooksPath=/dev/null");
    expect(capture).toContain(`+refs/heads/main:${CATALOG_SYNC_STAGING_REF}`);
    expect(capture).toContain("https://github.com/org/repo.git");
    expect(await scanForSecret(fake.directory)).toBe(false); // no file under the mirror contains it
  }));
  it("sends NO credential config for a public fetch", async () => withFake("ok", async fake => {
    const result = await createCatalogGitTransport(fake.executable).fetch(destination, "main", fake.directory, undefined);
    expect(result).toEqual({ ok: true, value: true });
    const capture = await readFile(fake.capture, "utf8");
    expect(capture).toContain("value0=ABSENT");
    expect(capture).toContain("count=unset");
  }));
  it("times out, kills, and reaps a hung fetch before settling", async () => withFake("hang", async fake => {
    const started = Date.now();
    const result = await createCatalogGitTransport(fake.executable).fetch(destination, "main", fake.directory, undefined);
    expect(result).toEqual({ ok: false, issue: { code: "GIT_TIMEOUT" } });
    expect(Date.now() - started).toBeLessThan(70000);
    // Settlement happened only after the owned child was killed and its close observed
    // (bounded post-kill reap allowance); assert no surviving fake-git process group:
    const lingering = await readFile(fake.capture, "utf8");
    expect(lingering).toContain("argc="); // child did start; kill+reap path exercised
  }));
  it("bounds stdout", async () => withFake("loud", async fake => {
    const result = await createCatalogGitTransport(fake.executable).resolveRef(fake.directory, CATALOG_SYNC_STAGING_REF);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(["GIT_LIMIT_EXCEEDED", "GIT_PROTOCOL_ERROR"]).toContain(result.issue.code);
  }));
  it("maps nonzero exit to fixed failure without stderr leakage", async () => withFake("fail", async fake => {
    const result = await createCatalogGitTransport(fake.executable).fetch(destination, "main", fake.directory, undefined);
    expect(result).toEqual({ ok: false, issue: { code: "GIT_FAILED" } });
  }));
});
```

- [x] **Step 4: Run transport tests RED** (stub `createCatalogGitTransport` returning all-`GIT_FAILED` fails the capture assertions behaviorally — `task-2-red-1.txt`).

- [x] **Step 5: Implement `git-fetch.ts`.** Exact environment/argv per the shared prefix. Runner skeleton (complete it with the byte-counting data handlers, group kill, awaited close, and monotonic deadline; stderr counted-then-discarded):

```ts
import { spawn } from "node:child_process";
// CATALOG_SYNC_GIT_LIMITS lives in this same module (as L below); no self-import.

type RunOptions = { env: Record<string, string>; timeoutMs: number };
const REAP_MS = 5000; // bounded post-kill close-observation allowance; never authorizes more work
function run(executable: string, args: string[], cwd: string, options: RunOptions): Promise<CatalogGitResult<Buffer>> {
  return new Promise(resolve => {
    let selected: CatalogGitFailure | undefined;
    let stdoutBytes = 0, stderrBytes = 0;
    const out: Buffer[] = [];
    const child = spawn(executable, args, { cwd, shell: false, detached: true,
      stdio: ["ignore", "pipe", "pipe"], env: options.env });
    const kill = () => { if (child.pid !== undefined) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* already reaped */ } } };
    // Selection only kills and records the FIRST failure; settlement NEVER happens here.
    const select = (code: CatalogGitFailure["code"]) => {
      if (selected) return;
      selected = { code }; kill();
      // Bounded reap allowance: if close is not observed after SIGKILL, settle with the
      // selected failure and destroy local pipes; no unref, no background work, no retry.
      reapTimer = setTimeout(() => {
        child.stdout.destroy(); child.stderr.destroy();
        resolve({ ok: false, issue: selected });
      }, REAP_MS);
    };
    let reapTimer: ReturnType<typeof setTimeout>;
    const timer = setTimeout(() => select("GIT_TIMEOUT"), options.timeoutMs);
    child.on("error", error => select((error as NodeJS.ErrnoException).code === "ENOENT" ? "GIT_UNAVAILABLE" : "GIT_FAILED"));
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > L.stdoutBytes) { select("GIT_LIMIT_EXCEEDED"); return; }
      out.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length; // counted then discarded; never returned or logged
      if (stderrBytes > L.stderrBytes) select("GIT_LIMIT_EXCEEDED");
    });
    child.on("close", (code, signal) => {
      // The ONLY settlement point for the normal path: the owned child's close has been
      // observed (awaited POSIX-group ownership; kill on timeout/limit/error led here).
      clearTimeout(timer); if (reapTimer) clearTimeout(reapTimer);
      if (selected) { resolve({ ok: false, issue: selected }); return; }
      if (code !== 0 || signal !== null) { resolve({ ok: false, issue: { code: "GIT_FAILED" } }); return; }
      resolve({ ok: true, value: Buffer.concat(out) });
    });
  });
}
```

`fetch` builds `fetchEnvironment(credential)` and the shared-prefix argv; `resolveRef` validates `/^([0-9a-f]{40})\n?$/` on trimmed stdout (mismatch → `GIT_PROTOCOL_ERROR`, exit≠0 → `REF_MISSING`); `updateRef`/`deleteRef` map success/failure. All paths single-flight awaited; no `.unref()`.

- [x] **Step 6: Write failing mirror tests** (`mirror.test.ts`): creation layout byte-exact (`config` equals the sha1 template; `HEAD` exact; `objects/pack`, `objects/info`, `refs` exist; mode 0o700 root); idempotent reuse; rejections: symlinked source dir, symlinked mirrors root, foreign config containing `[remote`, non-bare config, `commondir` present, `objects/info/alternates` present, `.promisor` file in `objects/pack`, config >4096 bytes, invalid `sourceId` (`../escape` → `MIRROR_INVALID` before any fs write outside root). Then implement `mirror.ts` per the shared prefix (write-config-ourselves, `wx` flags, create-then-verify, bounded scans, awaited cleanup of a partially created dir).

- [x] **Step 7: Compose-transport proof through the local fixture repo (includes the no-network shallow-fetch proof).** Using `createLocalFixtureRepo`, run: `ensureCatalogMirror` → transport-double `fetch` (which performs a REAL local `git fetch --no-tags --depth=1 file://<fixture-remote>` into the mirror — the genuine shallow path, no network) → `resolveRef(staging)` → assert staged commit equals fixture commit → `updateRef(current, commit, null)` → `resolveRef(current)` → `deleteRef(staging)`; assert a second run with `expected` set to the first commit succeeds and with a WRONG expected fails (`GIT_FAILED`), proving the old-value guard. Then assert `readGitCatalogIndex` (from `@orgops/skills`) accepts the produced SHALLOW mirror + commit + `indexPath` and returns the fixture index — this is the no-network proof that `--depth=1` output satisfies the existing inspection; the parent-authorized live smoke additionally covers real GitHub. Also assert best-effort staging cleanup semantics: a confirmed promotion followed by an injected `deleteRef(staging)` failure still returns success with `current` at the new commit. (`mirror.test.ts` or a dedicated `compose` block; keep all processes real-git-local, no network.)

- [x] **Step 8: Full validation + commit.** `LABEL=task-2-final-1` 15-label run, compare-lint, root-lint `cmp`, `git diff --check`; then:

```bash
git add apps/api/src/catalog-sync/git-fetch.ts apps/api/src/catalog-sync/git-fetch.test.ts \
        apps/api/src/catalog-sync/mirror.ts apps/api/src/catalog-sync/mirror.test.ts \
        apps/api/src/catalog-sync/fixtures.test-helper.ts
git commit -m "feat(catalogs): add bounded sanitized git transport and owned mirrors"
```

### Task 3: Admin-only sync service, schema, routes, and app wiring

**Files:**
- Modify: `packages/schemas/src/catalogs/configuration.ts` (append `CatalogSyncRequestSchema`), `packages/schemas/src/index.ts` (append export), `packages/schemas/src/catalogs/configuration.test.ts` (append cases)
- Create: `apps/api/src/catalog-sync/sync.ts`
- Modify: `apps/api/src/routes/catalogs.ts` (deps + 2 routes + 5 error entries only), `apps/api/src/app.ts` (AppConfig fields + wiring only)
- Test: `apps/api/src/catalogs.sync.integration.test.ts`
- Create (evidence): `D/live-smoke-1.mts`

**Interfaces:**
- Consumes: Task 1 `parseGitHubDestination`; Task 2 `createCatalogGitTransport`, `ensureCatalogMirror`, `CATALOG_SYNC_STAGING_REF`, `CATALOG_SYNC_CURRENT_REF`, `CatalogGitTransport`, `CatalogGitCredential`; existing `createCatalogConfiguration`, `canManageCatalogs`, `decryptSecret`/`parseMasterKey`, `readGitCatalogIndex`, `RelativePathSchema`.
- Produces: `CatalogSyncRequestSchema`/`CatalogSyncRequest` (schemas); `CatalogSyncErrorCode`, `CatalogSyncResult<T>`, `CatalogSyncView`, `CatalogSyncDeps`, `createCatalogSync` (api); routes `POST /api/catalogs/:catalogId/sync` and `GET /api/catalogs/:catalogId/sync`; AppConfig fields `catalogGitExecutable?`, `catalogSyncTransport?`. Task 4 consumes the two routes and `CatalogSyncView` JSON shape `{catalogId, sourceId, ref, commit, index}`.

- [x] **Step 1: Capture TASK_BASE/state to `D/task-3-start.txt`; assert HEAD == Task 2 commit, clean tree/index.**

- [x] **Step 2: Schema RED then GREEN.** Append to `configuration.test.ts`: accepts `{expectedRevision: 1, indexPath: "catalog/index.json"}`; rejects unknown keys, missing `indexPath`, `indexPath` with `..`/`.git` segment/leading dot/length >240, non-integer/zero/negative `expectedRevision`. Implement the schema exactly as the shared prefix (add `RelativePathSchema` to the existing primitives import) and re-export from `packages/schemas/src/index.ts`. Schemas lint must stay at 0 diagnostics.

- [x] **Step 3: Write the failing integration test skeleton** (`catalogs.sync.integration.test.ts`). Reuse the Phase-3 harness pattern (in-memory db, `createApp({ db, dataDir: join(root, "data"), adminUser/adminPass, runnerToken, catalogSyncTransport: <double>, catalogGitExecutable: "/usr/bin/git" })`, `vi.stubEnv("ORGOPS_MASTER_KEY", masterKey)`, fetch-mock guard). Build one `createLocalFixtureRepo` (import from `./catalog-sync/fixtures.test-helper`) with a two-entry index JSON. Key cases (each asserts `{error, code}` envelopes or exact success bodies):

```ts
it("syncs a public GitHub source and exposes commit + index without secrets or host paths", async () => {
  await request("POST", "/api/catalog-sources", { sourceId: "gh", repository: { url: "https://github.com/org/repo" }, enabled: true, allowPackages: false });
  await request("POST", "/api/catalogs", { catalogId: "ghc", sourceId: "gh", displayName: "GH", ref: "main", enabled: true });
  const response = await request("POST", "/api/catalogs/ghc/sync", { expectedRevision: 1, indexPath: fixture.indexPath });
  const body = await json(response);
  expect(body).toEqual({ catalogId: "ghc", sourceId: "gh", ref: "main", commit: fixture.commit, index: { formatVersion: 1, entries: expect.any(Array) } });
  expect(body.index.entries).toHaveLength(2);
  const raw = JSON.stringify(body);
  expect(raw).not.toContain(root);            // no host path
  expect(raw).not.toContain("ciphertext");    // no ciphertext field
  const view = await json(await request("GET", `/api/catalogs/ghc/sync?indexPath=${encodeURIComponent(fixture.indexPath)}`));
  expect(view.commit).toBe(fixture.commit);
});

it("uses the decrypted bound credential for a private source and never exposes it", async () => {
  // create source+catalog, then PUT read-credential { kind:"https-basic", username:"reader", password:"syn-private-token" }
  // POST sync → 200; expect(calls.fetch[0].credential).toEqual({ username:"reader", password:"syn-private-token" });
  // assert response text contains neither "syn-private-token" nor "reader" nor the credential ref UUID.
});

it("rejects non-GitHub and SSH destinations with a fixed redacted issue", async () => {
  // https://git.example.invalid source → POST sync → 400 DESTINATION_REJECTED
  // ssh:// source → 400 DESTINATION_REJECTED; calls.fetch stays empty.
});

it("enforces admin authority for both routes", async () => {
  // no cookie → 401; ordinary human → 403; scoped runner token + admin cookie → 403;
  // global runner token header → 403; admin with must_change_password=1 → 403. No fetch call happens.
});

it("fails closed on revision, state, concurrency, credential and transport problems", async () => {
  // stale expectedRevision → 409 REVISION_CONFLICT; disabled catalog → 409 STATE_CONFLICT;
  // overlapping POST (double blocks first fetch) → 409 SYNC_IN_PROGRESS;
  // corrupted ciphertext row → 503 CREDENTIAL_UNAVAILABLE;
  // double failing fetch after one success → 502 SYNC_FAILED AND GET still returns the PREVIOUS commit (mirror preserved).
});

it("rejects a malformed synced index without promoting the ref", async () => {
  // fixture repo whose index.json is "not json"; POST sync → 502 SYNC_FAILED; GET → 404 NOT_FOUND (first sync).
});

it("bounds bodies and validates query/indexPath", async () => {
  // 16385-byte streamed body → 413 PAYLOAD_TOO_LARGE; unknown field → 400 INVALID_REQUEST;
  // GET without indexPath / with "../x" / with ".git/x" → 400 INVALID_REQUEST;
  // both routes carry Cache-Control: no-store; no events rows added by sync.
});
```

- [x] **Step 4: Run RED** (`task-3-red-1.txt`: routes 404/405 and schema missing — then stub-minimal service to reach behavioral RED on the auth/destination cases; preserve both attempts).

- [x] **Step 5: Implement `sync.ts`** exactly per the shared-prefix flow (12 ordered steps, lock map, credential seam reading `SELECT kind, ciphertext_b64 FROM catalog_read_credentials WHERE source_id = ?` ONLY inside step 5, all inspection issues collapsing to `SYNC_FAILED`, promotion after inspection). Keep `readCatalogIndex` fetch-free with a verify-only mirror mode (add an internal `create: boolean` flag to `ensureCatalogMirror`'s options parameter — `ensureCatalogMirror(root, sourceId, { create: false })`; keep the exported signature backward compatible by defaulting `{ create: true }`... no: exact signature is `ensureCatalogMirror(mirrorsRoot, sourceId)`; add an OPTIONAL third parameter `options?: { create?: boolean }` — additive, Task 2 behavior unchanged).

- [x] **Step 6: Wire routes + app.** In `routes/catalogs.ts`: extend `CatalogRoutesDeps` with `sync`, append the 5 error entries, append the two handlers (reusing `readBody`, `failure`, the `principal.runnerScope !== undefined` guard, `CatalogIdSchema` path check, `RelativePathSchema` for the GET query). In `app.ts`: construct `createCatalogSync({ db, configuration, findHuman: adminAccessDeps.findHuman, getMasterKey: () => process.env.ORGOPS_MASTER_KEY ?? "", mirrorsRoot: join(DATA_DIR, "catalog-mirrors"), gitExecutable: config.catalogGitExecutable ?? process.env.ORGOPS_CATALOG_GIT ?? "/usr/bin/git", ...(config.catalogSyncTransport === undefined ? {} : { transport: config.catalogSyncTransport }) })` and pass `sync` into `registerCatalogRoutes`. Add the two optional `AppConfig` fields with a comment marking `catalogSyncTransport` test-only. No other app.ts change.

- [x] **Step 7: GREEN targeted, then write `D/live-smoke-1.mts`** exactly per the shared-prefix live smoke policy (token only from env; `LIVE-SMOKE-NOT-RUN` exit 3 path; programmatic no-token-in-response/mirror/log assertions printing only PASS/FAIL; awaited cleanup of `$D/live-scratch/data`). **CREATE ONLY — the task writer MUST NOT execute this script.** It performs network egress and uses the real `VAULT_REPO_TOKEN`; only the parent may run it after implementation and review. It is evidence-only, untracked, and never executed by automated validation.

- [x] **Step 8: Full validation + scoped commits.**

```bash
git add packages/schemas/src/catalogs/configuration.ts packages/schemas/src/catalogs/configuration.test.ts packages/schemas/src/index.ts
git commit -m "feat(catalogs): add catalog sync request schema"
git add apps/api/src/catalog-sync/sync.ts apps/api/src/routes/catalogs.ts apps/api/src/app.ts apps/api/src/catalogs.sync.integration.test.ts
git commit -m "feat(catalogs): add admin-only live catalog sync API"
```

### Task 4: Minimal desktop Catalogs-screen sync controls + docs

**Files:**
- Modify: `apps/admin-ui/src/catalogs/api.ts`, `apps/admin-ui/src/catalogs/configuration-state.ts`, `apps/admin-ui/src/screens/CatalogsScreen.tsx`
- Test: `apps/admin-ui/src/catalogs/api.test.ts`, `apps/admin-ui/src/catalogs/configuration-state.test.ts`, `apps/admin-ui/src/screens/CatalogsScreen.test.tsx`
- Modify (docs): `docs/SPEC.md`, `docs/superpowers/specs/2026-09-09-skill-agent-catalogs-design.md` (status paragraph only), `docs/research/skill-agent-sharing-tasks.md` (checklist line only)

**Interfaces:**
- Consumes: Task 3 routes; success JSON `{catalogId, sourceId, ref, commit, index: { formatVersion: 1, entries: [...] }}`; error codes `DESTINATION_REJECTED | CREDENTIAL_UNAVAILABLE | MIRROR_INVALID | SYNC_IN_PROGRESS | SYNC_FAILED` plus existing envelopes.
- Produces (exact UI-side names):

```ts
// api.ts additions
export type CatalogSyncEntry = { kind: string; name: string; version: string; digest: string; locationType: "catalog" | "source" };
export type CatalogSyncView = { catalogId: string; sourceId: string; ref: string; commit: string; entries: CatalogSyncEntry[] };
// CatalogApi additions:
syncCatalog(id: string, input: { expectedRevision: number; indexPath: string }, signal?: AbortSignal): Promise<CatalogApiResult<CatalogSyncView>>;
getCatalogSync(id: string, indexPath: string, signal?: AbortSignal): Promise<CatalogApiResult<CatalogSyncView>>;
// configuration-state.ts additions
export type SyncPanel = { catalogId: string; indexPath: string; result: CatalogSyncView | null; message: string | null } | null;
// ConfigurationSnapshot gains: sync: SyncPanel
// ConfigurationController gains:
changeSyncIndexPath(value: string): void;
startSync(): Promise<void>;
showSyncResult(): Promise<void>;
```

- [x] **Step 1: Capture TASK_BASE/state to `D/task-4-start.txt`; assert HEAD == Task 3 second commit, clean tree/index.**

- [x] **Step 2: api.ts RED/GREEN.** Tests: correct method/path/body for both calls (`POST /api/catalogs/<id>/sync` JSON `{expectedRevision, indexPath}`; `GET /api/catalogs/<id>/sync?indexPath=<encoded>`); decode reduces each entry to `{kind, name, version, digest, locationType}` and rejects malformed bodies → `protocol`; classification: `400 DESTINATION_REJECTED` → `invalid` with the new fixed copy, `409 SYNC_IN_PROGRESS` → `conflict`, `503 CREDENTIAL_UNAVAILABLE` → `unavailable` + credential copy, `500 MIRROR_INVALID` → `unavailable` + mirror copy, `502 SYNC_FAILED` → `unavailable` + sync-failed copy, GET 404 → `missing` with not-synced copy. Secret-drop test: a raw response embedding an extra `"credential":"syn-marker"` field decodes successfully and `JSON.stringify(decoded)` does not contain `syn-marker`. New copy (exact):

```ts
destination: "This source is not a GitHub HTTPS repository. Synchronization supports only https://github.com/<owner>/<repository>.",
syncBusy: "A synchronization is already in progress for this source. Wait for it to finish.",
credentialUnavailable: "The stored read credential could not be used. Reconfigure the source read credential.",
mirrorInvalid: "Catalog mirror storage is invalid. Ask the API operator to review mirror storage.",
syncFailed: "Synchronization failed. Any previously synced content is unchanged.",
notSynced: "No synchronized index is available for this catalog. Run a synchronization first.",
```

- [x] **Step 3: configuration-state.ts RED/GREEN.** `sync` panel initializes on catalog selection (`{ catalogId, indexPath: "", result: null, message: null }`), clears on deselect/source-selection/authority loss/dispose. `startSync`: requires ready phase + catalog detail + nonempty `indexPath`; runs under an owned operation (kind `"sync"`, counted in `busy`, supersession-safe like existing kinds); awaits fresh `refreshAuth()` bound to `expectedUserId` BEFORE the request (same discipline as mutations); on success publishes `result` and clears `message`; on failure publishes the fixed `error.message`, keeps the previous `result`; 401/403 route to the existing authority-loss path; conflict kinds set `reloadRequired` with the existing stale-metadata message. `showSyncResult` performs `getCatalogSync` under a read-kind operation; `missing` maps to `copy.notSynced` local message. Tests: lifecycle success/error, busy flag, superseded sync cannot publish over a newer operation, selection switch clears panel, 403 → authority lost, no automatic retry.

- [x] **Step 4: CatalogsScreen.tsx RED/GREEN (SSR markup tests).** In the catalog detail panel (only when `catalog && !editor && !confirmation`), render a bordered section `aria-label="Catalog synchronization"`: `Label`+`Input id="catalog-sync-index"` ("Index path in repository"), `Button` "Sync catalog from GitHub" (`disabled` when `disabled || !catalog.effectiveEnabled || sync.indexPath.trim() === ""`), secondary `Button` "Show synced index"; when `sync.result`, show commit (full, monospace, `break-all`) and an entries table (columns Kind/Name/Version/Digest, digest truncated visually via `break-all`, full text in DOM); when `sync.message`, `<p role="alert">`. Guidance line: "Read-only: fetches the configured GitHub repository into local mirror storage and reads its catalog index. Nothing is written to GitHub; mirrored content is untrusted." No mobile/viewport changes; reuse existing `max-w`/table classes. Tests assert: section absent for source detail and during editors; button disabled states; result table rows; error alert text; existing fourteen-action markup tests unchanged.

- [x] **Step 5: Docs.** `docs/SPEC.md`: extend the "Administrator Catalog Configuration" section with a "Live GitHub catalog synchronization (read-only)" subsection documenting: the two routes + exact success/error envelopes; GitHub-only pure destination policy rules; env-only credential injection with redirect/protocol/helper lock-down; owned mirror layout/location/staging-promotion lifecycle and bounds (`CATALOG_SYNC_GIT_LIMITS`); reuse of the offline inspection with unchanged contracts; no persistence/audit/schema change and the rationale; untrusted-content/no-authenticated-origin caveats; the parent-authorized live smoke policy reference. Design spec status paragraph: append the Phase 10 sentence (read-only sync implemented/reviewed/verified; mobile shell still outstanding). `skill-agent-sharing-tasks.md`: add the completed Phase 10 line. No `catalog-package-contract.md` change (library unchanged).

- [x] **Step 6: Full validation + scoped commits.**

```bash
git add apps/admin-ui/src/catalogs/api.ts apps/admin-ui/src/catalogs/api.test.ts \
        apps/admin-ui/src/catalogs/configuration-state.ts apps/admin-ui/src/catalogs/configuration-state.test.ts \
        apps/admin-ui/src/screens/CatalogsScreen.tsx apps/admin-ui/src/screens/CatalogsScreen.test.tsx
git commit -m "feat(catalogs): add desktop catalog sync controls"
git add docs/SPEC.md docs/superpowers/specs/2026-09-09-skill-agent-catalogs-design.md docs/research/skill-agent-sharing-tasks.md
git commit -m "docs(catalogs): document live github catalog sync"
```
