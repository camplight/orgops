# Administrator Catalog Configuration UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (parent only) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Workers must not launch nested agents. This plan is sequential on the existing branch, not a worktree workflow.

**Goal:** Let currently authenticated human administrators manage existing source/catalog configuration and isolated source-bound read credentials through the fourteen implemented Phase-3 APIs, without acquiring repository content.

**Architecture:** Keep the existing admin-ui navigation and visual primitives. Add a browser-only catalog API adapter, a screen-owned configuration/form controller with a small React hook, and a cohesive screen; independently test these real production seams with synthetic fetch responses. Extend the existing auth hook through a narrowly extracted, testable session lifecycle so stale auth responses cannot restore authority after logout.

**Tech Stack:** Existing React 18, ReactDOM server rendering, TypeScript, Tailwind, Vite 8 and Vitest 3. No dependency additions, DOM environment upgrades, schema runtime imports or backend changes.

**Spec:** `docs/superpowers/specs/2026-09-09-skill-agent-catalogs-design.md`, particularly sections 4, 8, 10–14; exact implemented API contract in `docs/SPEC.md` → Administrator Catalog Configuration. Binding slice/process: `.superpowers/sdd/2026-09-10-catalogs-05-configuration-ui/controller-brief.md`.

## Global Constraints

- Cwd `/home/slamnation/www/orgops`; branch `88-move-private-skills-into-a-private-repo`; initial clean HEAD `696873a3b3cf385ae1f224dffa3c7903c3d909e3`. Local scoped commits only. No worktrees, pushes, remote writes, merges, publication or nested agents.
- No real credentials, real instance state/services, existing `.env` edits, dependency/lock changes or installation. npm only. New scratch/log/report files belong only in `.superpowers/sdd/2026-09-10-catalogs-05-configuration-ui/` (called `$D` below). Never alter old-phase evidence.
- Only existing administrator source/catalog configuration APIs are in scope. No refresh/check-credential/connectivity/fetch/package browsing/install/activate/start/export/publish controls, backend API additions, role editor or source auto-registration. “Reload configuration” means GET metadata only, never repository refresh.
- “Admin-only catalog management, installation, template instantiation and publishing in v1.” This slice implements only management. “No automatic dependency source registration, version substitution, or upstream overwrite.” Preserve existing export allowlists and runner/event behavior untouched.
- “Repository read credentials and publication write credentials are separate capabilities. Read permission must never imply publication permission.” Read-only HTTPS-basic entry only; no publication token prompt. SSH configuration is inert, not a connectivity/ambient identity claim.
- Do not infer authority from usernames, browser storage, source contents or client validation. The API remains authoritative and checks persisted human capability on every request. Q1 (LAN/VPN versus public-only acquisition) stays deferred in `.superpowers/sdd/catalogs-pending-owner-decisions.md`, unchanged by this phase.
- No raw request/response/exception values in catalog errors, status messages or logs. Credentials are transient form/request values only; never in auth, reusable metadata cache, URL, storage, drafts persisted across navigation, notifications, exports, agents or unrelated Secrets screens.
- Preserve authored strings; never trim credential username/password. Spaces and multibyte values are valid, password colons valid, username colons invalid. No Buffer/polyfill in browser code. Type-only schema imports are permitted; server validation remains authoritative.
- Existing lint debt is allowed only with zero added diagnostics: API 486, runner 2; ten other workspaces clean, especially schemas/skills/admin-ui. Compare workspace/file/code/full multiline message/multiplicity, ignoring only positions and established repository-prefix canonicalization.
- A new material security/product/architecture decision needs `contact_supervisor(reason: "need_decision")` and a reply, not an implicit ruling. Routine test failures are diagnosed locally. Runtime/subagent/extension infrastructure failures hard-stop with exact error plus cwd/branch/HEAD/status/diff; no alternate agent mode.
- Parent reviews this whole plan before docs commit. Each task then gets its own writer, local commit and independent read-only review. Completion must include structured evidence; prose-only or empty artifacts are not approval.

## Source map and preflight

Read `AGENTS.md`, the binding controller brief, this shared contract, the task, and the named files before editing. The planner read all of current SPEC and the approved design, plus the current relevant source; no old plans are needed.

| Actual anchor | Finding / implication | Planned owner |
|---|---|---|
| `apps/admin-ui/src/App.tsx` (1350 lines), `types.ts` | Screen state is local; no router. Auth destructuring near line 159; AppLayout near 642; profile navigation already handles forced password change. Do not broadly refactor App. | Tasks 1, 3 |
| `hooks/useAuth.ts` | `/api/auth/me` already called, but `isAdmin` omitted; logout clears only after await and refresh races are unguarded. | Task 1 |
| `api.ts`, `config.ts` | `apiFetch` throws raw response text and loses status; do NOT reuse it for catalog requests. Use `apiUrl` with a separate redacted adapter, leave unrelated callers alone. | Task 1 |
| `hooks/useOrgOpsData.ts` | Eager unrelated fetches on authentication. Do NOT put catalog metadata/credentials here or in WebSocket data flows. | All |
| `components/layout/{Sidebar,AppLayout,PageHeader}.tsx` | Sidebar buttons and slate layout; add one gated Catalogs item adjacent to Skills/Secrets. | Task 3 |
| `screens/IntegrationKeysScreen.tsx`, `ProfileScreen.tsx`, `components/ui/*` | Reuse Card/Button/Input/Label/Select styles, not raw-error parsing, offscreen mounted secret drawers, or clickable-only table rows. | Task 3 |
| `apps/api/src/routes/catalogs.ts`, `catalog-configuration.ts` | Exact fourteen routes, strict JSON, receipt-only mutations, tombstone/revision semantics, fixed errors. Read only. | All |
| `packages/schemas/src/catalogs/configuration.ts`, `src/index.ts` | Existing request types exported; runtime credential schema uses Buffer. Type-only imports only; no new shared exports. | Task 1 |
| `App.test.tsx`, `vitest.config.ts`, installed resolution | App export test is insufficient. React/ReactDOM server/Vitest installed; jsdom, happy-dom, testing-library and react-test-renderer are not installed. | All |
| Prior `parent-final-lint.json`, `parent-final-lint-*.txt`, `compare-lint.py`, `parent-verify.sh` under Phase 4 | Baseline 1092 Vitest tests/34 files, opscli 3, diagnostics 486+2. Fresh baseline required, not a claim of newly run suites. | Task 1, final validation |

## Shared browser contracts (included verbatim in every task brief)

### File responsibilities and dependency direction

- `apps/admin-ui/src/auth-session.ts` (+ `.test.ts`): the actual auth session snapshot/request generation used by `useAuth`; no catalog data or secrets. `useAuth.ts` is a thin hook, preserves existing public fields and `refreshAuth`/`logout`, adds capability fields/functions below.
- `apps/admin-ui/src/catalogs/api.ts` (+ `api.test.ts`): browser types, allowlisted response projection, fourteen HTTP methods, fixed error union/copy. Only browser `fetch`, `apiUrl`, type-only schema imports. No import from `apps/api` and no generic backend transport changes.
- `apps/admin-ui/src/catalogs/configuration-state.ts` (+ `.test.ts`): per-mounted-screen metadata and transient editor state, all action/confirmation/revision/async lifecycles. Not a singleton, general state framework, shared API cache or persisted draft store.
- `apps/admin-ui/src/hooks/useCatalogConfiguration.ts`: subscribes to the controller; effect cleanup invalidates/aborts requests and clears forms; same factory tested directly in Node.
- `apps/admin-ui/src/screens/CatalogsScreen.tsx` (+ `.test.tsx`): thin connected wrapper and exported `CatalogsView` over controller snapshot/actions. Includes small named form components in this file; split only if necessary for readability within this same responsibility, recording exact new paths in the ledger. No extra UI library.
- Minimal integration edits: `types.ts`, `hooks/useAuth.ts`, `components/layout/{Sidebar,AppLayout}.tsx`, `App.tsx`, `screens/index.ts`, behavior tests in `App.test.tsx` and `components/layout/Sidebar.test.tsx`. No edits to unrelated screens, `useOrgOpsData`, generic `api.ts`, backend/schema implementations, lockfiles or packages.
- Task 3 updates current behavior in `docs/SPEC.md` and phase status in the approved design; no claim that future discovery/install/publish exists.

### Auth session seam

```ts
// auth-session.ts
export type AuthSnapshot = {
  authChecked: boolean; authenticated: boolean;
  username: string | null; userId: string | null;
  mustChangePassword: boolean; isAdmin: boolean;
};
export type AuthSession = {
  getSnapshot(): AuthSnapshot;
  subscribe(listener: () => void): () => void;
  refreshAuth(): Promise<AuthSnapshot | null>;
  invalidateCatalogAuthority(expectedUserId: string): void;
  logout(): Promise<void>;
  dispose(): void;
};
export function createAuthSession(fetchImpl?: typeof fetch): AuthSession;
// useAuth returns snapshot fields and the stable functions refreshAuth,
// invalidateCatalogAuthority and logout. Existing callers can ignore the result.
```

Use `apiUrl` and cookie credentials for auth fetches, no raw error retention. Parse `/auth/me` conservatively: only boolean `isAdmin === true`, authenticated valid human ID, no forced password change yields capability. Missing/malformed/nonboolean capability denies it without promoting a username (including `admin` and `runner`). Preserve profile/login behavior and existing username/id fields. Failure clears capability/auth; initial unchecked state has none. Refresh uses abort+generation and stable snapshots; a stale refresh cannot win after later refresh, logout or dispose. Only the current winning refresh returns its new `AuthSnapshot`. A superseded, invalidated or disposed refresh returns `null`, never a cached prior administrator snapshot, even when abort is ignored and the old response arrives later. Null is cancellation, not an authoritative denial: it must not overwrite newer auth state or globally revoke a newer principal. `logout` synchronously clears local auth/capability before awaiting POST; no late failure restores it. `invalidateCatalogAuthority(expectedUserId)` first compares the supplied opening principal to the live session snapshot's userId. A mismatch is a global no-op, so a delayed A denial cannot demote B before React cleanup. A match immediately sets isAdmin false and invalidates pending authority refreshes, then callers may explicitly refresh auth for current login/password state. Cleanup never reuses a disposed controller; hook must be safe under React StrictMode's setup/cleanup/setup.

Catalog screen entry and each explicit metadata load or mutation await a fresh non-null `refreshAuth` result before protected requests. Each controller is permanently bound to `expectedUserId`, the non-null user ID at creation. Before every protected request, require `authenticated && isAdmin && !mustChangePassword && userId === expectedUserId`. A winning snapshot for a different principal synchronously clears/invalidates the old controller and sends no protected request, without globally demoting the new administrator; do not wait for React props/effect cleanup. Null results send no protected request, release only their own pending latch, never replay an action or revive credentials, and do not themselves clear a newer valid auth session. Keep the currently displayed valid editor where possible during a superseded recheck, but cancel the attempted action; another explicit action requires its own fresh check. Rechecks on window focus and visible `visibilitychange` while the catalog screen is active catch demotion without navigation. The API has no role push event: document revocation visibility at the next auth check/denial, not instantaneous external role observation. Do not add polling or change unrelated screen data loading. Do not unmount a valid editor simply because a recheck is in flight; block actions while checking, clear on a denied/failed result. A catalog 401/403 immediately invalidates the controller and calls `invalidateCatalogAuthority(expectedUserId)` with its opening ID before requesting current auth; a subsequent auth success does not replay a rejected action or reopen a form. Forced password change sends App to existing Profile flow; logout to existing Login flow. Nonadmin catalog navigation is hidden; programmatic stale selection renders a restricted message/no protected loads. Server authorization is never described as provided by the UI.

### API seam and exact route/action mapping

```ts
import type {
  SourceCreate, SourceUpdate, CatalogCreate, CatalogUpdate,
  RevisionRequest, ReadCredentialSet
} from "@orgops/schemas";
// api.ts locally defines browser copies of SourceMetadata, CatalogMetadata,
// MutationReceipt exactly as listed below, not backend-imported types.
export type CatalogApiResult<T> = { ok: true; value: T } | {
  ok: false; error: CatalogUiError;
};
export type CatalogUiError = {
  kind: "unauthorized" | "forbidden" | "conflict" | "invalid" |
    "missing" | "removed" | "unavailable" | "network" | "protocol";
  message: string; // chosen solely from the fixed catalog copy table
};
export type CatalogApi = {
  listSources(signal?: AbortSignal): Promise<CatalogApiResult<SourceMetadata[]>>;
  getSource(id: string, signal?: AbortSignal): Promise<CatalogApiResult<SourceMetadata>>;
  createSource(input: SourceCreate, signal?: AbortSignal): Promise<CatalogApiResult<MutationReceipt>>;
  updateSource(id: string, input: SourceUpdate, signal?: AbortSignal): Promise<CatalogApiResult<MutationReceipt>>;
  removeSource(id: string, input: RevisionRequest, signal?: AbortSignal): Promise<CatalogApiResult<MutationReceipt>>;
  restoreSource(id: string, input: RevisionRequest, signal?: AbortSignal): Promise<CatalogApiResult<MutationReceipt>>;
  setReadCredential(id: string, input: ReadCredentialSet, signal?: AbortSignal): Promise<CatalogApiResult<MutationReceipt>>;
  revokeReadCredential(id: string, input: RevisionRequest, signal?: AbortSignal): Promise<CatalogApiResult<MutationReceipt>>;
  listCatalogs(signal?: AbortSignal): Promise<CatalogApiResult<CatalogMetadata[]>>;
  getCatalog(id: string, signal?: AbortSignal): Promise<CatalogApiResult<CatalogMetadata>>;
  createCatalog(input: CatalogCreate, signal?: AbortSignal): Promise<CatalogApiResult<MutationReceipt>>;
  updateCatalog(id: string, input: CatalogUpdate, signal?: AbortSignal): Promise<CatalogApiResult<MutationReceipt>>;
  removeCatalog(id: string, input: RevisionRequest, signal?: AbortSignal): Promise<CatalogApiResult<MutationReceipt>>;
  restoreCatalog(id: string, input: RevisionRequest, signal?: AbortSignal): Promise<CatalogApiResult<MutationReceipt>>;
};
export function createCatalogApi(fetchImpl?: typeof fetch): CatalogApi;
```

Metadata definitions: source has `sourceId`, `repository:{url,sshUser?}`, `repositoryIdentity`, `enabled`, `allowPackages`, `revision`, `removedAt:number|null`, `createdAt`, `updatedAt`, `readCredential:{state:"absent"}|{state:"configured",kind:"https-basic",ref:string}`. Catalog has `catalogId`, `sourceId`, `displayName`, `ref`, `enabled`, `effectiveEnabled`, `revision`, `removedAt:number|null`, `createdAt`, `updatedAt`. Receipt is exactly `{resource:"source"|"catalog",id:string,revision:number}`. GET lists unwrap `{sources}` and `{catalogs}`. IDs/revisions must be usable and booleans must be booleans; project expected known response fields, never spread arbitrary response properties into reusable state. Reject malformed success bodies with a fixed protocol error. This is response-shape defense, not client repository/permission authority validation.

Every API method uses `apiUrl` for its constant path, `encodeURIComponent(id)` for path segments, `credentials:"include"`, `cache:"no-store"`, caller signal; mutations add `content-type:application/json` and JSON bodies even for DELETE. Positively select exact request fields; no arbitrary init/options override for callers, no runner token, credential ref rebinding, schema evaluation, automatic retry, raw thrown error or console logging. Only the transient set-credential request contains username/password; no returned result includes them. Cancelled requests are suppressed by controller generation, not shown as a new success/error on an abandoned screen.

| # | Method/path | UI action | Body / result |
|---|---|---|---|
| 1 | GET `/api/catalog-sources` | Enter screen / Reload configuration, including tombstones | unwrap sources list |
| 2 | GET `/api/catalog-sources/:sourceId` | Open source details/editor; Reload details for fresh review | SourceMetadata |
| 3 | POST `/api/catalog-sources` | Submit New source | `{sourceId,repository,enabled,allowPackages}`; 201 receipt |
| 4 | PATCH `/api/catalog-sources/:sourceId` | Save enabled/package policy; explicit Disable source sends only enabled false | `{expectedRevision,enabled?,allowPackages?}`; >=1 setting; 200 receipt |
| 5 | DELETE `/api/catalog-sources/:sourceId` | Confirm Remove source | `{expectedRevision}`; 200 receipt |
| 6 | POST `/api/catalog-sources/:sourceId/restore` | Confirm Restore disabled source | `{expectedRevision}`; 200 receipt |
| 7 | PUT `/api/catalog-sources/:sourceId/read-credential` | Explicit Set/Replace HTTPS read credential | `{expectedRevision,kind:"https-basic",username,password}`; 200 receipt |
| 8 | DELETE `/api/catalog-sources/:sourceId/read-credential` | Confirm Revoke read credential | `{expectedRevision}`; 200 receipt |
| 9 | GET `/api/catalogs` | Enter screen / Reload configuration, including tombstones | unwrap catalogs list |
| 10 | GET `/api/catalogs/:catalogId` | Open catalog details/editor; Reload details for review | CatalogMetadata |
| 11 | POST `/api/catalogs` | Submit New catalog | `{catalogId,sourceId,displayName,ref,enabled}`; 201 receipt |
| 12 | PATCH `/api/catalogs/:catalogId` | Save display/ref/enabled; explicit Disable catalog sends only enabled false | `{expectedRevision,displayName?,ref?,enabled?}`; >=1 setting; 200 receipt |
| 13 | DELETE `/api/catalogs/:catalogId` | Confirm Remove catalog | `{expectedRevision}`; 200 receipt |
| 14 | POST `/api/catalogs/:catalogId/restore` | Confirm Restore disabled catalog | `{expectedRevision}`; 200 receipt |

No command sends immutable metadata as editable PATCH fields. Source immutable: sourceId, repository URL/sshUser, repository identity. Catalog immutable: catalogId, sourceId. Read credential ref is optional metadata display only, never an editable/request field. Selected `ref` is a branch/tag selection, not an immutable resolved commit; numeric `revision` is configuration concurrency only.

### Fixed failures and reconciliation

Ignore server `error` text and caught exception text. For 401/403 do not depend on an error envelope; global guards have different bodies. For recognized status+code pairs select local constant copy:

| Failure | Kind | Fixed actionable message / behavior |
|---|---|---|
| 401 | unauthorized | “Sign in again to manage catalog configuration.” Clear feature state/authority; recheck auth. |
| 403, including forced rotation | forbidden | “Administrator access is required. Recheck your sign-in and password status.” Same invalidation. |
| 409 (all three conflict codes or unknown body) | conflict | “Configuration changed or this identity/state is reserved. Reload configuration and review before trying again.” Disable writes until reload, discard the captured edit/confirmation. Never retry with a new revision. |
| 400 INVALID_REQUEST | invalid | “Check the configuration fields and required values.” |
| 413 PAYLOAD_TOO_LARGE | invalid | “Configuration request is too large. Reduce the entered values.” |
| 400 UNSUPPORTED_CREDENTIAL_TRANSPORT | invalid | “Managed read credentials require HTTPS. SSH credential management is not available.” |
| 404 NOT_FOUND | missing | “Configuration was not found. Reload configuration.” |
| 410 REMOVED | removed | “Configuration was removed. Reload and review restore options.” |
| 503 CREDENTIAL_STORAGE_UNAVAILABLE | unavailable | “Read credential storage is unavailable. Ask the API operator to check master key configuration.” Never ask owner/agent for a key. |
| 500 STORAGE_FAILURE / other 5xx | unavailable | “Configuration could not be saved or loaded. Reload configuration before trying again.” |
| fetch exception | network | “The request outcome could not be confirmed. Reload configuration and review before trying again.” |
| invalid JSON/success shape/unrecognized response | protocol | “The response could not be confirmed. Reload configuration before trying again.” |

For mutation network/protocol/5xx failures, do not claim rollback or success. Clear credential fields, mark `reloadRequired`, discard confirmation and keep only metadata visibly stale/read-only. Offer explicit Reload configuration (GET only), then require the human to reopen/review and submit a new action; do not silently duplicate a create even if a list reload finds no row. A receipt is confirmed configuration success only; reload lists after a success to capture source effects and credential revision. If that metadata reload fails show “Configuration saved, but current metadata could not be loaded. Reload configuration.” and block further writes; never transform a confirmed save into an invitation to automatically repeat it.

### Controller and editor seam

```ts
// configuration-state.ts imports AuthSnapshot and CatalogApi browser types.
export type Selection = { kind: "source" | "catalog"; id: string } | null;
export type SourceDraft = { sourceId: string; url: string; sshUser: string;
  enabled: boolean; allowPackages: boolean };
export type CatalogDraft = { catalogId: string; sourceId: string;
  displayName: string; ref: string; enabled: boolean };
export type CredentialDraft = { kind: "https-basic"; username: string; password: string };
export type Editor =
  | { kind: "source-create"; draft: SourceDraft }
  | { kind: "source-edit"; original: SourceMetadata; draft: SourceDraft }
  | { kind: "catalog-create"; draft: CatalogDraft }
  | { kind: "catalog-edit"; original: CatalogMetadata; draft: CatalogDraft }
  | { kind: "credential"; original: SourceMetadata; draft: CredentialDraft }
  | null;
export type ConfirmAction = "source.disable" | "source.remove" | "source.restore" |
  "credential.revoke" | "catalog.disable" | "catalog.remove" | "catalog.restore";
export type Confirmation = { action: ConfirmAction; id: string; expectedRevision: number } | null;
export type ConfigurationSnapshot = {
  phase: "idle" | "checking" | "loading" | "ready" | "error" | "forbidden";
  sources: SourceMetadata[]; catalogs: CatalogMetadata[];
  selection: Selection; detail: SourceMetadata | CatalogMetadata | null;
  editor: Editor; confirmation: Confirmation;
  busy: boolean; reloadRequired: boolean; message: string | null;
};
export type ConfigurationController = {
  getSnapshot(): ConfigurationSnapshot;
  subscribe(listener: () => void): () => void;
  load(): Promise<void>; // auth check, then both lists; explicit reload discards editors
  select(selection: Selection): Promise<void>; // auth check + detail GET
  openEditor(kind: "source-create" | "source-edit" | "catalog-create" | "catalog-edit" | "credential"): void;
  changeSource(patch: Partial<SourceDraft>): void;
  changeCatalog(patch: Partial<CatalogDraft>): void;
  changeCredential(patch: Partial<CredentialDraft>): void;
  submit(): Promise<void>;
  requestConfirmation(action: ConfirmAction): void;
  confirm(): Promise<void>;
  cancel(): void;
  authorityLost(): void;
  dispose(): void;
};
export function createCatalogConfigurationController(deps: {
  api: CatalogApi;
  expectedUserId: string;
  refreshAuth: () => Promise<AuthSnapshot | null>;
  invalidateCatalogAuthority: (expectedUserId: string) => void;
}): ConfigurationController;
export type CatalogAccess = {
  canManage: boolean; userId: string | null;
  refreshAuth: () => Promise<AuthSnapshot | null>;
  invalidateCatalogAuthority: (expectedUserId: string) => void;
};
// hooks/useCatalogConfiguration.ts
export function useCatalogConfiguration(access: CatalogAccess): {
  state: ConfigurationSnapshot; actions: ConfigurationController;
};
// screens/CatalogsScreen.tsx
export function CatalogsScreen(props: CatalogAccess): JSX.Element;
export function CatalogsView(props: {
  state: ConfigurationSnapshot; actions: ConfigurationController;
}): JSX.Element;
```

`change*` operates only on its active editor type; changing immutable fields in edit mode must be ignored/not used to construct PATCHes. `openEditor` requires a usable fresh detail for edits, a loaded nonremoved source choice for catalog create, and HTTPS/nonremoved source for credential entry. All create flags start false. Source/catalog selections start blank (no first-source auto-binding); source binding must be explicit. New source URL/SSH user fields are authored values; omit sshUser entirely for HTTPS. Clearing/switching source or editor clears old credential values before rendering another editor. Do not offer managed credential input for SSH or tombstones.

Use one global in-flight mutation latch per mounted controller, set synchronously before the first await, including auth checks. Disable duplicate submits/actions; stale detail loads cannot replace newer selection or overwrite an editor. Own AbortControllers plus session/load/selection generations; abort alone is insufficient when mocked fetch ignores it. Auth loss, opening-principal mismatch and dispose synchronously erase metadata, selected detail, drafts/credentials, confirmations and notices, increment generations and abort pending requests. `authorityLost()` is local controller invalidation only: it does not globally change auth. The 401/403 handler separately calls `invalidateCatalogAuthority(expectedUserId)` as required, and the auth session itself enforces that principal check against its live snapshot; neither principal mismatch nor a delayed old-principal denial may demote the new principal. `cancel` closes/clears editor and confirmation immediately; a pending mutation may already commit, so retain its busy latch until settled, suppress abandoned-form completion and require GET review before another mutation. No completion after navigation/disposal/authority loss may publish into the old or a newly mounted controller. After navigation, a fresh authorized screen loads actual metadata, never resumes a draft/request. Stable subscribe/getSnapshot functions and cached immutable snapshots support `useSyncExternalStore`; clear/dispose internal references, not OS/GC-secure erasure claims. Make hook setup/cleanup StrictMode-safe without reviving a disposed instance.

Credential editor is specifically transient **form state** in the screen-owned controller, not part of `sources`, `detail`, auth, error results or a global cache. Snapshot copies retain no historical drafts in the controller; never log/serialize snapshots. On submit copy credential values only into a local request argument and immediately replace form fields with empty strings before any await or validation failure. Clear on error/success, cancel/Escape, selection/editor switch, revoke intent, source remove intent, navigation/unmount, logout and authority loss. The browser/network/JS runtime can retain request bytes temporarily; do not promise memory zeroization or that `autocomplete` overrides password managers. UI password input is masked, autocomplete off/new-password as appropriate; no reveal/copy/persist-draft control.

Expected revision comes from the reviewed original detail/confirmation, captured before awaiting auth. Never substitute a list refresh's newer revision into an old edit/confirmation. Source credential changes use source revision. Display names/refs may be edited on nonremoved catalogs only if their parent source is nonremoved (disabled parent is allowed). Catalog removal still works under a removed source; catalog create/edit/restore do not. Source removal disables source/package permission and removes credentials, causing child catalog effective availability to fall without deleting their enabled settings or local installations. Source restore keeps identity but returns disabled, allowPackages false, credential absent. Catalog restore returns disabled; source permission/credential unaffected. Disable source retains credentials and allowPackages setting; neither enabled nor credential presence grants package permission. Revoke is available only for configured credentials. Actions reflect these states but still handle authoritative server rejection.

## Screen layout and acceptance states

```text
Existing sidebar: ... Skills / Catalogs [current admin only] / Secrets ...
Existing header: catalogs                         Profile / Logout
Catalog configuration (Card)
  Configuration only: no repositories fetched or credentials verified.
  [Reload configuration]   [New source]   [New catalog]
  live status / error / reload-required notice
Sources (Card/table in overflow-x-auto; mobile wrapping)
  ID button | repository + SSH login | enabled/removed | external packages | read credential
Catalogs (Card/table in overflow-x-auto)
  ID/details button | name | source | selected ref | configured enabled | effective availability
Conditional inline Details/Edit Card (not an offscreen mounted drawer)
  identity/revision/timestamps, immutable values as text
  source: settings / credential controls / disable / remove / restore
  catalog: display/ref/enabled settings / disable / remove / restore
  labelled form controls, [Save configuration] [Cancel]
  conditional confirmation region: exact impact, [Confirm ...] [Cancel]
```

Inline cards are the approved routine layout choice: use existing slate backgrounds/borders, blue primary and secondary/destructive Button styling, max-width forms, `grid`/wrap at narrow widths, no app-wide restyle. Actual `<button>` elements open details (not mouse-only rows); `<form onSubmit>` supports Enter; fieldsets/legends distinguish configuration and HTTPS read capability; wrap each input in Label or use unique htmlFor/id. Checkboxes use intrinsic width, not full-width text-input styling. Use heading hierarchy, `role="status"`/polite announcements and `role="alert"` for errors, `aria-busy`, disabled fields while pending, keyboard-reachable Cancel and Escape. Conditional form mounting prevents hidden focusable or secret-bearing panels. Focus the inline editor heading/first field on open, restore focus to the originating details/action button on close when it remains present; no modal focus trap is needed for inline cards.

Required render states: nonadmin/restricted; checking/loading; truly empty sources/catalogs; complete metadata lists including tombstones; failed list/detail load with explicit reload; source enabled vs package permission independent; source credential absent vs “Configured, not verified”; SSH unsupported explanation; catalog enabled but effectively unavailable due to disabled/removed parent; forms/create defaults; details editing immutable text; confirmation pending/cancel; in-flight disabled actions; conflict/reload-required; confirmed save with failed metadata reload. Show configuration availability, not connected/healthy/verified badges. Explain no local installations are deleted by removal. Ref labels say “Selected ref (not a resolved commit)”. Never insert raw HTML/Markdown for authored metadata.

## Validation protocol (all tasks)

Task 1 copies/adapts Phase-4 `parent-verify.sh` and `compare-lint.py` into `$D` with Phase-5 paths. Parser must compare fresh Task-1 baseline to Phase-4 `parent-final-lint.json`, later results to Task-1 baseline; write no old-phase files. Add no normalization beyond approved positions/repo-prefix handling. Preserve command exit codes and raw logs. Every workspace must actually run independently because root lint short-circuits at API failure.

Use this isolation shape for every test/build/typecheck, with separate named logs per RED/GREEN/baseline/final run:

```bash
D="$PWD/.superpowers/sdd/2026-09-10-catalogs-05-configuration-ui"
mkdir -p "$D/scratch/home" "$D/scratch/tmp"
# Replace the final npm arguments with the task's listed command, never start services.
(ulimit -c 0; timeout --kill-after=5s 600s env -i PATH="$PATH" \
  HOME="$D/scratch/home" TMPDIR="$D/scratch/tmp" CI=1 \
  /bin/bash --noprofile --norc -c \
  'set -a; source .env.example; set +a; export ORGOPS_LLM_STUB=1; exec "$@"' \
  bash npm test)
```

Named commands: `npm test`; `npm run --workspace @orgops/opscli test`; `npm run lint`; and `npm run --workspace @orgops/WORKSPACE lint` independently for `api agent-runner opscli admin-ui user-ui db schemas event-bus llm crypto skills events-scenario-tests`. Targeted Vitest uses `npm exec -- vitest run <paths>` with the installed local binary (verify resolution first; no acquisition). Build using `npm run --workspace @orgops/admin-ui build -- --config "$D/build.config.ts"` through the isolated environment above. Vite must not auto-load existing frontend/root `.env` files: create empty `$D/build-env/` and a scratch Vite config with `envDir` pointing there, absolute root `apps/admin-ui`, the same installed React plugin, and explicit `VITE_API_BASE_URL:"/api"` / `VITE_WS_BASE_URL:"/ws"` defines for any fixture build. No dev server/proxy settings are needed for a build. Verify the empty envDir and configuration before running it; no real `.env` reads or file contents printed. Document ignored `apps/admin-ui/dist` assets; no upload or tracked asset commits.

Tests must execute production functions, request mapping and state transitions, not source-string grep. Use deferred promises and mock `fetch`/Response; no endpoint or repository contacts. ReactDOM `renderToStaticMarkup` verifies actual semantic output, not browser interactions. Do not claim SSR covers effects, focus, typing, password-manager behavior or browser races. App SSR tests may mock unrelated hooks/screens to select auth/navigation states; state/auth lifecycle tests must run real controllers.

Optional parent-only browser smoke proposal, not permission to start a service (children must not start this service): serve only built static admin-ui assets on `127.0.0.1:45175` using a tiny scratch Node HTTP server, no Vite proxy, no env loading. Server returns a fixed 503 for `/api`, `/v1`, `/ws` and unknown non-asset paths; no upstream fallback. Parent's existing MCP Playwright creates a fresh context, blocks service workers/WebSockets and aborts every request except this exact loopback origin; explicit synthetic route handlers fulfill every `/api` path needed by App, unknown API requests fail closed. Before launching any parent smoke, verify the build used the empty envDir above and force `window.__ORGOPS_UI_CONFIG__={apiBaseUrl:"/api",wsBaseUrl:"/ws"}` before the app loads; both build/runtime API and WS config must be same-origin with no provider URL. No remote pages/repos. Parent records owned PID/teardown and actual interactions (admin/nonadmin, create/edit/remove/restore/revoke, 409, network ambiguity, logout/navigation pending, narrow viewport/keyboard). Parent must approve this exact setup before it runs; absent browser evidence is an explicit coverage limit, not replaced by component-export tests.

## Final task tracking (2026-09-10)

Tasks 1–3, whole-phase review, scoped correction review and parent verification are complete. Accepted source HEAD: `ba6eea48a4b2ce0913c9e60357be0b061badf326`. Task 1 includes the approved one-line login adapter; Task 2 includes the approved auth-only `recheckAuthority` extension.

- [x] Task and whole-phase independent reviews.
- [x] Fix and independently re-review both parent-verified P2s: disabled focus-origin fallback and interrupted metadata authorization.
- [x] Parent browser GREEN: real typing, focus, Cancel/Escape, navigation/unmount, logout/late response, demotion, nonadmin and forced-password handling, all fourteen route-backed actions, and explicit recovery after interrupted reads.
- [x] Separate React-development StrictMode browser run: observed listener setup/cleanup/setup and repeated interaction checks. SSR alone is not interaction evidence.
- [x] Fresh parent full-suite/typecheck/build and repository-scope verification.

Fresh parent validation: **1295 Vitest tests across 39 files**, **3 opscli tests** pass. Root lint **fails** on unchanged API486 + runner2 debt; all twelve workspaces were checked independently, ten clean. Exact baseline comparison: 488 → 488, added0/removed0. Isolated production and development-React fixture builds passed; existing build warnings are retained. Evidence: `.superpowers/sdd/2026-09-10-catalogs-05-configuration-ui/parent-acceptance.md`, `parent-final-*`, `parent-browser-*-checks.js` and `parent-strict-build.txt`. Earlier worker reports remain historical.

The browser fixtures used only synthetic APIs and owned loopback static servers, with all external/unknown requests and WebSockets blocked and no upstream. All contexts/servers were closed. Password-manager retention and memory zeroization are not claimed. The 390px shared fixed-sidebar/header layout still overflows (Catalogs586px, existing Dashboard609px); mobile acceptance/global shell redesign remain outside this slice.

This phase is only the existing administrator configuration UI: no live repository fetch/refresh, import, activation or publishing services. Q1 remains deferred.

## Implementation tasks

### Task 1: Browser catalog API and race-safe live administrator capability

**Files:** Create `apps/admin-ui/src/catalogs/api.ts`, `apps/admin-ui/src/catalogs/api.test.ts`, `apps/admin-ui/src/auth-session.ts`, `apps/admin-ui/src/auth-session.test.ts`. Modify `apps/admin-ui/src/hooks/useAuth.ts`, `apps/admin-ui/src/types.ts` (`AuthMe` only). Create scratch baseline scripts/logs/ledger under `$D`; no other production files.

**Consumes:** Current `/api/auth/me`, `apiUrl`, fourteen Phase-3 routes and the shared exact browser contracts above.

**Produces:** `AuthSnapshot`, `AuthSession`, `createAuthSession`, updated `useAuth` return; `CatalogApi`, `CatalogApiResult`, `CatalogUiError`, `SourceMetadata`, `CatalogMetadata`, `MutationReceipt`, `createCatalogApi`. Task 2 imports these exact names; preserve existing auth hook callers.

- [x] **1. Preflight and fresh baseline.** Record cwd/branch/HEAD/status and `TASK_BASE` in `$D/ledger.md`; verify clean expected branch. Adapt isolated validation/comparison scripts as specified; run full Vitest, opscli, root lint and all twelve workspace lints before edits. Record exact counts and diagnostics comparison, not only exit code. Expected prior baseline: 1092/34, opscli3, API486/runner2, other ten zero. Investigate any added diagnostic before implementation; known debt is not a stop.
- [x] **2. Write API RED tests** for all fourteen mappings (method, encoded path, JSON body, explicit false creation flags, expectedRevision on every noncreate, DELETE JSON, no unknown fields, cookie/cache/signal, list unwrap and 200/201 receipts). Use a table with one case per mapping above. Add error tests for every code/status, 401/403 non-JSON guards, unknown secret-bearing bodies/throws, malformed 2xx, no retry, and exact synthetic credential bytes:

```ts
it("keeps read credential bytes only in its explicit request", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(
    JSON.stringify({ resource: "source", id: "team", revision: 8 }), { status: 200 }));
  const api = createCatalogApi(fetchMock);
  const result = await api.setReadCredential("team", {
    expectedRevision: 7, kind: "https-basic", username: " ü ", password: " :密碼: "
  });
  const init = fetchMock.mock.calls[0]![1]!;
  expect(JSON.parse(String(init.body))).toEqual({
    expectedRevision: 7, kind: "https-basic", username: " ü ", password: " :密碼: "
  });
  expect(init).toMatchObject({ method: "PUT", credentials: "include", cache: "no-store" });
  expect(result).toEqual({ ok: true, value: { resource: "source", id: "team", revision: 8 } });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
```

- [x] **3. Write auth RED tests** for true/false/missing/nonboolean isAdmin, forced change, username independent of role, malformed/failed me, latest refresh wins, logout clearing before POST resolves, late me after logout/dispose, invalidation before recheck. Assert obsolete refresh return values are `null` (not merely that subscribers remain unchanged), with the obsolete promise settling both before and after the winner. Include account A to account B and overlapping focus/selection/mutation refreshes. Publish B's valid auth snapshot, then call invalidation with A's ID: B and any B refresh stay authoritative/uninvalidated; matching B invalidation still clears capability. Tests inspect actual subscribed snapshots, not a separate model:

```ts
it("does not restore authority from a late me response after logout", async () => {
  let finish!: (value: Response) => void;
  const late = new Promise<Response>(resolve => { finish = resolve; });
  const fetchMock = vi.fn<typeof fetch>()
    .mockReturnValueOnce(late)
    .mockResolvedValueOnce(new Response("{}"));
  const session = createAuthSession(fetchMock);
  const checking = session.refreshAuth();
  const logout = session.logout();
  expect(session.getSnapshot().isAdmin).toBe(false);
  finish(new Response(JSON.stringify({ id: "h1", username: "admin", isAdmin: true, mustChangePassword: false })));
  await logout;
  expect(await checking).toBeNull();
  expect(session.getSnapshot()).toMatchObject({ authenticated: false, isAdmin: false });
});
```

- [x] **4. Run RED:** `npm exec -- vitest run apps/admin-ui/src/catalogs/api.test.ts apps/admin-ui/src/auth-session.test.ts`. Expected missing implementation exports/failed new behavior; record legitimate assertion/import failure, not infrastructure failure.
- [x] **5. Implement minimal browser adapter** with fixed per-method body projection, expected response decoders and fixed failures. Each method builds only its approved request. Core request pattern:

```ts
// Inside the adapter's protected try/catch; classify functions use only fixed copy.
const response = await fetchImpl(apiUrl(path), {
  method, credentials: "include", cache: "no-store", signal,
  ...(body === undefined ? {} : {
    headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  })
});
// For !ok classify status and allowlisted code; never return response.error/text.
// For ok project the method's expected result fields; malformed results fail closed.
```

Do not transplant the backend implementation/schema validator. No repository normalization/security policy in the browser. Client required fields can remain form guidance; narrow byte/credential checks, if needed, use TextEncoder and explicit surrogate/control checks rather than trim/Buffer.
- [x] **6. Implement the auth session and hook adapter.** A private monotonic request generation plus AbortController governs each me request. Capture generation before await, apply only if still current/live. Store stable snapshot objects, notify subscriptions only on a real change. Invalidate/logout/dispose increment generation synchronously. `useAuth` subscribes to this real seam using React tools and tears down owned requests; mount/unmount/remount/StrictMode do not strand the hook on a disposed object. `AuthMe` gains `isAdmin?: boolean`; return exact existing fields plus capability and invalidate function. Do not add role storage or username-derived fallback.
- [x] **7. Run GREEN** targeted tests, existing `App.test.tsx`, admin-ui lint, schemas/skills lint; record results. Inspect imports/build compatibility without installing packages. `git diff --check`; confirm no lock/dependency/backend changes and no new suppression. Update ledger with raw logs and test counts.
- [x] **8. Self-review and local commit** only the six named source/test files. Stage exact paths; `git commit -m "feat(admin-ui): add catalog API and live admin capability"`; verify no staged files remain. Generate task review package using installed `review-package` script with this plan, `TASK_BASE`, HEAD and copy artifact to `$D/task-1-diff.md`. Do not claim reviewer approval.

**Independent acceptance:** Every route has behavioral request coverage, API errors cannot echo synthetic secrets, capability is live-me-derived and stale auth cannot resurrect it, unrelated auth callers typecheck. No visible catalog screen yet is intentional.

### Task 2: Screen-owned configuration/form lifecycle with safe optimistic mutations

**Files:** Create `apps/admin-ui/src/catalogs/configuration-state.ts`, `apps/admin-ui/src/catalogs/configuration-state.test.ts`, `apps/admin-ui/src/hooks/useCatalogConfiguration.ts`. Task-1 files are dependencies, not rewritten unless a proven interface defect needs escalation/correction.

**Consumes:** `CatalogApi`, browser metadata/receipt/error types, `AuthSnapshot`, stable `refreshAuth():Promise<AuthSnapshot|null>` and `invalidateCatalogAuthority(expectedUserId:string):void` from Task 1; opening `expectedUserId:string` from non-null `CatalogAccess.userId`; all shared contracts above.

**Produces:** Exact `Selection`, drafts, `Editor`, `ConfirmAction`, `Confirmation`, `ConfigurationSnapshot`, `ConfigurationController`, `CatalogAccess`, `createCatalogConfigurationController` and `useCatalogConfiguration` signatures above. Task 3 renders the snapshots and calls these methods directly; no parallel component-only mutation logic.

- [x] **1. Preflight.** Record clean branch/HEAD and Task-2 `TASK_BASE`, read actual prior review/ledger and Task-1 exported contracts. Do not rerun the full baseline or read old huge plans.
- [x] **2. Write behavioral RED tests** using the real API adapter over synthetic fetch and a valid `AuthSnapshot` callback; table-driven sources/catalogs contain enabled, disabled and removed parents/children. Helpers create fresh fixture metadata and deferred promises per test (never shared mutable credentials). Tests must cover every route through the controller, blank/default-false creation, explicit source choice, detail GET selection, immutable edit filtering, field allowlists, source and catalog disable/remove/restore semantics, unsupported SSH, credential revoke/rotation and exact source revisions.

```ts
it("synchronously clears credential form before the request settles", async () => {
  // Local test helper fixtureController loads source team revision 7 via real mocked API.
  // It returns { controller, fetchMock, finishCredential } with a deferred PUT response.
  const { controller, fetchMock, finishCredential } = await fixtureController();
  await controller.select({ kind: "source", id: "team" });
  controller.openEditor("credential");
  controller.changeCredential({ username: " ü ", password: " :密碼: " });
  const saving = controller.submit();
  expect(controller.getSnapshot().editor).toMatchObject({
    kind: "credential", draft: { username: "", password: "" }
  });
  await vi.waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true));
  const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")![1]!;
  expect(JSON.parse(String(put.body))).toMatchObject({ expectedRevision: 7, username: " ü ", password: " :密碼: " });
  finishCredential(new Response(JSON.stringify({ error: "SYNTHETIC_SECRET", code: "REVISION_CONFLICT" }), { status: 409 }));
  await saving;
  expect(controller.getSnapshot()).toMatchObject({ reloadRequired: true, editor: null });
  expect(JSON.stringify(controller.getSnapshot())).not.toContain("SYNTHETIC_SECRET");
});
```

Define `fixtureController` in this test file using synthetic GET source/list/catalog responses and `createCatalogApi(fetchMock)`, with `expectedUserId:"h1"`; auth callback returns `{authChecked:true,authenticated:true,userId:"h1",username:"operator",mustChangePassword:false,isAdmin:true}`. A PUT promise is completed by its test-owned resolver. No test helper reimplements production transition logic.
- [x] **3. Write race/failure RED tests**: no protected fetch without capability; fresh entry/mutation auth check; denied/failed check clears transient form; pending auth loses to logout/authorityLost. For each of load, detail selection, submit and confirm, hold admin A's fresh auth promise, switch to admin B, then resolve with B: no protected request is issued for A's operation, all A state clears synchronously, and `invalidateCatalogAuthority` is not called to demote B. B opens a fresh controller with blank forms and no inherited confirmation/credential. Connect real `createAuthSession` to the controller for overlapping focus/selection/mutation checks: settle superseded promises before and after the winning response, assert null cannot authorize a request, cannot change the winning snapshot, releases only its own latch and never retries the cancelled action. Cover logout/account-switch races in both orders. Specifically issue A's protected request, publish B auth, then deliver A's delayed 403 before old-controller effect disposal: A clears locally and cannot repopulate, the invalidation passes expectedUserId A, and the real auth session retains B's authority. Then test duplicate submit before first await creates one mutation; older detail/list resolves after newer selection/reload and is ignored; cancelled/disposed pending success and failure cannot notify/repopulate; focus auth loss adapter path; new controller has no prior form. Test credential clearing on success, error, cancel, switch, revoke/remove intent, authorityLost and dispose. Use secret markers in error bodies/throws and inspect all emitted snapshots/messages, excluding the intentionally live credential form/request. Check 409 never retries or updates an old draft's revision; ambiguous outcomes require GET then new intent; a confirmed receipt plus failed list reload remains a saved-but-stale notice. Under removed parent permit catalog removal but prohibit create/edit/restore. Do not reduce these to source-string assertions.
- [x] **4. Run RED:** `npm exec -- vitest run apps/admin-ui/src/catalogs/configuration-state.test.ts`; save legitimate failures.
- [x] **5. Implement controller transitions.** Create cached snapshots and subscriptions local to the factory. Use separate lifecycle/load/selection tokens and owned abort controllers; common authority check and mutation latch; build payloads from explicit draft fields and reviewed originals. Store no command history, pending credential payload in state, or generic retry queue. Core submission order:

```ts
// Concrete ordering inside submit, with command mapping by editor.kind:
// 1. Refuse if disposed, busy, reloadRequired or no editor.
// 2. Capture original revision and explicit request fields into a local variable.
// 3. Set busy synchronously; replace credential draft with empty values synchronously.
// 4. Await refreshAuth: null cancels only this attempt; a winning denial calls
//    authorityLost; a winning different userId also invalidates this controller
//    without demoting that new user. None of these paths sends a protected request.
// 5. If generation is live and fresh userId === expectedUserId with capability,
//    send exactly one API mutation with captured revision.
// 6. If still live, apply fixed result: receipt -> close editor + reload metadata;
//    conflict/ambiguous -> discard editor/confirmation, require review;
//    credential failure never restores values. No raw exception interpolations.
// 7. Release only this operation's busy latch; abandoned completions never publish.
```

`requestConfirmation` captures current detail revision and safe impact kind; `confirm` uses that captured value rather than latest lists. `cancel` and lifecycle invalidation clear form references synchronously; preserve uncertainty/busy handling for already-issued mutation. Source/catalog editors keep only mutable authored fields for PATCH. Source credential editor cannot be rebound to a different ID/ref. Default creations never silently choose a source or grant permission.
- [x] **6. Wire the real hook.** `useCatalogConfiguration` uses the controller through `useSyncExternalStore` (or equally narrow native subscription), creates it only for a capable non-null `userId`, passes that ID as `expectedUserId`, calls load on entry, synchronously masks stale snapshot when access changes, and cleans up requests/forms. Focus/visible listeners refresh current auth only, no repository I/O; null is ignored as supersession, a winning failed/denied refresh calls authorityLost, and a winning principal mismatch invalidates only the old controller. Factory ownership checks remain necessary before requests even if React has not rendered the changed user yet. Avoid unmounting valid forms on successful rechecks; reject stale callbacks. StrictMode cleanup/setup uses a fresh live controller, not reactivation of disposed data. Catalog controller 401/403 invalidation propagates the opening expectedUserId to auth immediately; the live auth session ignores a mismatched stale invalidation, while the old controller still clears. Later auth updates never resume old intent.
- [x] **7. Run GREEN:** state tests plus Task-1 API/auth tests, admin-ui lint and schemas/skills lint. Verify branch/diff scope, no added diagnostics or dependency changes; save logs. Review each lifecycle path against the controller table and route-action matrix.
- [x] **8. Commit and package:** exact three named files, `git commit -m "feat(admin-ui): manage catalog configuration lifecycles"`; ledger records test counts, HEAD and remaining browser-effect coverage limits. Confirm index empty and generate `$D/task-2-diff.md` from Task-2 base with installed review-package.

**Independent acceptance:** Production controller tests demonstrate all configuration actions, exact optimistic requests, clear-before-await credential handling, no implicit permission/binding, no stale async state resurrection and no retries. The new hook is typechecked but browser effect/focus behavior remains for Task 3 and parent smoke.

### Task 3: Accessible Catalogs screen, minimal navigation integration and truthful docs

**Files:** Create `apps/admin-ui/src/screens/CatalogsScreen.tsx`, `apps/admin-ui/src/screens/CatalogsScreen.test.tsx`, `apps/admin-ui/src/components/layout/Sidebar.test.tsx`. Modify `apps/admin-ui/src/App.tsx`, `apps/admin-ui/src/App.test.tsx`, `apps/admin-ui/src/types.ts` (Screen union), `apps/admin-ui/src/components/layout/Sidebar.tsx`, `apps/admin-ui/src/components/layout/AppLayout.tsx`, `apps/admin-ui/src/screens/index.ts`, `docs/SPEC.md`, `docs/superpowers/specs/2026-09-09-skill-agent-catalogs-design.md`. Controller/hook fixes require evidence and remain narrow; no general App/layout refactor.

**Consumes:** All exact Task-1/2 exports and shared contracts above. Screen accepts `CatalogAccess`; view accepts `{state,actions}`; no raw network/error parsing in screen. Existing Card/Button/Input/Label/Select and timestamp utility.

**Produces:** `CatalogsScreen`, `CatalogsView`; `Screen` gains `"catalogs"`; Sidebar and AppLayout gain optional `canManageCatalogs?: boolean` default false, preserving existing callers. The connected App passes current auth-derived capability, user ID and auth functions. Current SPEC documents only this configuration UI and honest testing/authority lifecycle limitations.

- [x] **1. Preflight.** Record Task-3 base/branch/status, read prior review and the actual controller/hook interfaces. Review existing layout/forms to reuse appearance without retaining unsafe offscreen credentials or raw errors.
- [x] **2. Write rendered-markup RED tests** with `react-dom/server`, rendering the actual `CatalogsView` against real controller snapshots. Use synthetic controller fixtures (same request contracts, not exported test-only state) for ready/empty/error/source/catalog/editor/confirmation states. Verify labelled controls, password masking and explicit kind, no checked default grants, immutable fields rendered as text, clear disabled/removed/effective states and configured-not-verified copy, source binding placeholder, unsupported SSH explanation, conflict Reload prompt, native buttons/forms/status regions. Check removal and restore confirmation copy explicitly. Tests assert rendered output, not implementation source.

```tsx
it("renders an accessible disabled-by-default source form", async () => {
  // Create a real controller over mock empty lists and authorized auth callback;
  // call load(), then openEditor("source-create"). No network reaches an API.
  const controller = await emptyController();
  controller.openEditor("source-create");
  const html = renderToStaticMarkup(<CatalogsView state={controller.getSnapshot()} actions={controller} />);
  expect(html).toContain("Source ID");
  expect(html).toContain("Repository URL");
  expect(html).toContain("External package permission");
  expect(html).toContain("<form");
  expect(html).toContain('type="checkbox"');
  expect(html).not.toContain('checked=""');
  expect(html).not.toContain("Refresh repository");
});
```

- [x] **3. Write navigation/auth integration RED tests**: Sidebar rendered with false/missing capability contains no Catalogs button; true capability adds one without removing existing items. App SSR with mocked auth/data/WebSocket hooks demonstrates loading/login/forced-profile and preserved ordinary authenticated navigation, username `admin` with isAdmin false has no catalog entry, renamed admin true does. For direct catalog selection tests, use a resettable React module mock delegating every hook to the real module, except the initial `useState("dashboard")` tuple's value is set to the test-selected Screen; keep its real setter. Other initial values/hooks remain untouched. This is a controlled SSR navigation fixture, not a mocked catalog access decision or new production navigation abstraction. Assert protected feature renders no screen/load path for stale nonadmin selection. Do not pretend server rendering runs effects. Real controller tests cover submission wiring; parent browser covers focus/unmount effects.
- [x] **4. Run RED:** `npm exec -- vitest run apps/admin-ui/src/screens/CatalogsScreen.test.tsx apps/admin-ui/src/components/layout/Sidebar.test.tsx apps/admin-ui/src/App.test.tsx`. Record behavioral/missing export failures.
- [x] **5. Implement the screen** using the shared textual layout. `CatalogsScreen` invokes only `useCatalogConfiguration`; `CatalogsView` renders its state and dispatches its real actions. Wire forms with semantic inputs, callbacks, and no trimming, e.g.:

```tsx
<form onSubmit={event => { event.preventDefault(); void actions.submit(); }}>
  <fieldset disabled={state.busy || state.reloadRequired}>
    <legend>HTTPS read credential</legend>
    <Label htmlFor="catalog-read-kind">Credential kind</Label>
    <Select id="catalog-read-kind" value="https-basic" disabled>
      <option value="https-basic">HTTPS basic (read-only repository access)</option>
    </Select>
    <Label htmlFor="catalog-read-username">Read username</Label>
    <Input id="catalog-read-username" autoComplete="off" value={draft.username}
      onChange={event => actions.changeCredential({ username: event.target.value })} />
    <Label htmlFor="catalog-read-password">Read password or read-only token</Label>
    <Input id="catalog-read-password" type="password" autoComplete="new-password"
      value={draft.password}
      onChange={event => actions.changeCredential({ password: event.target.value })} />
    <Button type="submit">Save read credential</Button>
  </fieldset>
  <Button type="button" variant="secondary" onClick={() => actions.cancel()}>Cancel</Button>
</form>
```

Render this only for `editor.kind === "credential"`, where `draft` is the narrowed credential draft. Include read-only privilege guidance, “Configured, not verified” and unsupported SSH copy. Inputs/forms for source/catalog similarly map exactly to `changeSource`/`changeCatalog` and default-false drafts, respecting immutable text. Use buttons to open details, `requestConfirmation`/`confirm` for dangerous operations, and shared controller error messages only. Escape invokes cancel; preserve keyboard focus and no offscreen mounted forms. Do not wrap repository URLs in automatic external-navigation links.
- [x] **6. Integrate minimally.** Add `catalogs` Screen and export; pass `canManageCatalogs` through AppLayout to Sidebar, filtering just that item. In App destructure userId/isAdmin/invalidate from existing auth hook. Gate connected render on `authenticated && !mustChangePassword && isAdmin`; preserve existing profile redirect and login flow. Pass `{canManage, userId, refreshAuth, invalidateCatalogAuthority}`. Stale selected Catalogs with no authority shows a restricted notice/no catalog controller requests (forced-password remains Profile). Keep unrelated onScreenFocus refreshes and `useOrgOpsData` unchanged. Do not put catalog fetches in its eager auth load.
- [x] **7. GREEN and coverage review.** Run all new admin-ui tests and existing App test, admin-ui lint, then full isolated Vitest, opscli, root lint and all independent workspace lints with exact baseline comparison. Run safe isolated admin-ui build after verifying Vite env isolation per protocol; document ignored assets. `git diff --check`, no dependency/lock/backend changes. Send parent exact optional browser harness proposal if interaction evidence is still required; do not start it without approval. Record SSR/pure-state versus actual browser coverage distinctly.
- [x] **8. Update current docs.** In SPEC add Configuration UI behavior next to implemented HTTP contract: entry/capability rechecks/denial clearing, revisions/uncertain outcome review, independent package permission, configuration-only/SSH/credential retention restrictions; adjust “no UI is added” and deferred UI wording specifically for this implemented slice. Approved design phase status now says existing configuration UI is implemented; package discovery/import/publishing UI remains future. Do not rewrite binding requirements or decide Q1.
- [x] **9. Self-review and commit** exact Task-3 changed files, `git commit -m "feat(admin-ui): add administrator catalog configuration screen"`; preserve ledger and logs. Check no staged files. Generate cumulative task diff `$D/task-3-diff.md` via installed review-package for independent review; report honest remaining browser/known lint limitations.

**Independent acceptance:** Current admin users can reach all fourteen existing route-backed actions through labelled keyboard controls; nonadmins/forced change/logout cannot retain catalog forms or issue new protected loads; UI reports configuration, never repository connectivity; full existing behavior remains tested with zero added lint debt. Browser interaction evidence is either parent-provided or explicitly reported as unavailable, never inferred from SSR.

## Planner self-review and execution handoff

Spec coverage is deliberately bounded: administrator configuration and credential UI portions of sections 4/8/10/11/13 map to Tasks 1–3; acquisition, discovery, export/import/activation/publishing and Q1 remain deferred, not silently implemented. Fourteen routes map to named methods, actions and tests. Every shared interface has a producer/consumer above. No production/test code is changed by this planning step.

Before committing this document, request parent self-review with path, task count 3, authority/secret/async decisions, installed-dependency coverage limit and exact optional browser fixture setup. After approval commit only this plan, then generate task briefs with installed `task-brief`, prepending this document's shared sections through `## Implementation tasks` to each extracted task so no worker needs to reread the full plan. Preserve parent approval and a consistency table in `$D/ledger.md` and final planning report. Parent owns sequential implementation/review launches and final acceptance; planner launches none.
