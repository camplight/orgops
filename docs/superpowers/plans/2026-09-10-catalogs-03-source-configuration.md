# Catalog Source Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The parent owns delegation and review; workers must not launch agents.

**Goal:** Persist administrator-managed catalog/source configuration and a source-bound, API-private encrypted read-credential capability, without fetching or activating anything.

**Architecture:** Add strict configuration contracts and three SQLite tables, then a cohesive API-owned `createCatalogConfiguration` factory injected into `registerCatalogRoutes`. The factory owns immutable repository bindings, transactional mutations, credential encryption and redacted audit outcomes; routes own bounded HTTP parsing and live human-admin authorization. Existing event insertion remains the write path, with an opt-in deferred notification used only by these transactions.

**Tech Stack:** Existing TypeScript, Hono, Zod 3, better-sqlite3, Drizzle, AES-256-GCM helpers and Vitest; npm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-09-skill-agent-catalogs-design.md` (binding), `docs/SPEC.md` (current runtime), `docs/catalog-package-contract.md` (implemented inert caller contract).

## Global Constraints

- Work only in `/home/slamnation/www/orgops`, existing branch `88-move-private-skills-into-a-private-repo`. Starting HEAD `46738682890b658a779d3da657f919214ace5d78`. No worktrees, pushes, remote writes, merges, publication, real services/state or production credentials. Local scoped conventional commits are authorized.
- “Git-host-neutral format and consumption; GitHub-only in-app PR publishing.” This slice has no publication capability at all.
- “No automatic dependency source registration, version substitution, or upstream overwrite.” Configuration and permission come exclusively from an authenticated human administrator, never package/index data.
- “Browsing never executes downloaded package code. Activation of executable content requires explicit approval.” This slice adds no browsing/fetch/refresh/index snapshots, extraction, staging, installation, activation, model selection, agent creation/start behavior, runner placement, UI or repository provisioning.
- “Repository read credentials and publication write credentials are separate capabilities. Read permission must never imply publication permission.” No write credential, credential-read endpoint or agent-visible secret transport is added.
- “Display names are not security identities; retain the configured repository identity and resolved revision.” Configuration revision below is not a resolved Git commit; no resolved commit is fabricated.
- Source and catalog IDs use the existing `SourceIdSchema`/`CatalogIdSchema` grammar: 1–64 ASCII characters, `^[a-z0-9]+(?:[._-][a-z0-9]+)*$`.
- Require live human-admin checks for all management reads/mutations, deny global/scoped runners even with admin cookies, and inherit Phase-1 live password-change restrictions. Do not modify unrelated auth, administrator bootstrap/reset policy or role grants.
- npm only, no installation, dependency/lock changes, casts or suppressions hiding added diagnostics. `@orgops/skills` and `@orgops/schemas` must typecheck cleanly. Existing API486/runner2 diagnostic debt is permitted only with zero additions under the exact comparison described below.
- All new logs/reports/briefs/diffs go under `.superpowers/sdd/2026-09-10-catalogs-03-source-configuration/`; preserve prior artifacts. Tests use isolated temporary fixtures, synthetic credentials, example env, stub LLM and temporary HOME/TMPDIR. No production env files or provider/network calls.
- One writer; RED then GREEN evidence and independent parent-owned review per task. Escalate materially new security/product policy. Any actual subagent runtime/extension/launch/tooling infrastructure failure stops that workflow with exact error and cwd/branch/HEAD/status/diff; never switch agent protocols.

## Current-source findings and bounded decisions

1. Migration sequence currently ends at `031_human_admin.sql`; add exactly `032_catalog_source_configuration.sql`, with matching handwritten Drizzle tables. Do not use drizzle-kit.
2. `admin-access.ts` supplies `createRequireAdmin` and `canManageCatalogs`, with live DB authority wired in `app.ts`. `registerAuthRoutes` registers global `/api/*` middleware before feature routes; its global-runner fast path lacks a runnerScope, so new routes explicitly run `requireAuth` again before `requireAdmin` rather than trusting that fast-path principal.
3. `routes/secrets.ts` exposes secret metadata to authenticated users and package values to runners. Never store repository credentials in `secrets`, including a new scope in that table. Reuse only `parseMasterKey`/`encryptSecret` from `@orgops/crypto` and existing `ORGOPS_MASTER_KEY` provisioning.
4. Parent ruling: typed `https-basic` credentials now, containing username and password/token, both encrypted and secret. Accept attachment only to HTTPS sources. SSH configuration is inert; managed SSH credentials, ambient SSH credentials, SSH agents/forwarding and host-key policy are not implemented. This is an additive current credential subset, not a permanent full-v1 private-SSH exclusion. Cost if wrong: an additive credential-kind/API migration before another transport adapter.
5. `insertEvent` currently persists and publishes synchronously; the bus may throw from subscribers. New mutations must persist their audit in the same SQLite transaction and notify only after commit. No separate audit table/outbox or global event refactor is justified. Failed notifications do not roll back committed configuration or return a false mutation failure.
6. `app.onError` logs raw exceptions. New request/service failures must be caught at the new seam and mapped to constant messages, never delegated to this logger with input-bearing exceptions.
7. Repository identity means a conservative configured connection identity, not an authenticated host-issued repository ID. Equivalent syntactic host/default-port spellings canonicalize; no proof of equivalence is inferred across protocols, SSH logins, path case, `.git` suffixes, DNS aliases, redirects or repository transfers. Future provenance adapters must retain this identity and validate transport policy; URL syntax alone is not SSRF defense.

## Shared contracts (included verbatim in every task brief)

### Identity, syntax and lifecycle

A **source** binds a permanent local `sourceId` to one immutable canonical repository connection. A **catalog** binds a permanent `catalogId` to one source and mutable display/ref/enabled settings. A **package-source permission** (`allowPackages`) is explicit policy for external package locations, independent of a catalog's authority to supply its own index/in-repository releases. A **read credential** is an API-only record for exactly one HTTPS source, not a package secret.

`GitRepositorySchema` accepts a strict object `{url: string, sshUser?: string}`:

- URL: 1–2048 ASCII characters; only absolute `https://` or `ssh://`, with authority and nonempty repository path. Reject raw controls/space, backslash, `%`, query/fragment markers, all userinfo (even empty `@`), malformed ports, empty path segments, trailing slash, and `.`/`..` path segments **before** `URL` can normalize them. Reject opaque/SCP forms, `file:`, `http:`, `git:`, `ext::`, local paths and Git options. No arbitrary Git configuration/arguments field.
- Authority is DNS hostname, dotted IPv4, or bracketed IPv6, with optional decimal port 1–65535. DNS is ASCII labels 1–63 `[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?`, overall at most 253; no trailing dot. For IPv4 require four canonical decimal octets (0–255, no leading zeros). IPv6 uses the standard URL parser after bracket syntax validation. Do not silently normalize integer/octal/hex IPv4 or percent-encoded hosts. Reject raw non-ASCII (punycode DNS spelling is allowed).
- Repository path segments: 1–128 `[A-Za-z0-9._~-]+`, excluding `.` and `..`; path case and `.git` are preserved. This is configuration syntax, not a disk path or a fetch argument.
- `sshUser` required for SSH, 1–64 `[A-Za-z0-9_][A-Za-z0-9._-]*`; forbidden for HTTPS. SSH login is explicitly nonsecret connection identity. Do not accept SSH username hidden in URL userinfo.
- Canonicalize scheme/hostname lowercase, IPv6 via URL, strip only default port (HTTPS443/SSH22), retain every repository path byte, and serialize without trailing slash. `canonicalUrl` has no userinfo. `repositoryIdentity = JSON.stringify([canonicalUrl, sshUser ?? null])` is the unique, immutable DB key. Do not merge `.git`/non-`.git`, path case, protocol or SSH-user variants.
- The stored repository object is `{url: canonicalUrl, sshUser?}`. The server computes identity; requests cannot submit it. Multiple source IDs for the same canonical identity conflict, including tombstones. Different connection identities may name the same physical repository; the phase does not promise to detect that.

`CatalogRefSchema`: 1–128 ASCII, `[A-Za-z0-9][A-Za-z0-9._/-]*`; reject `..`, `//`, trailing `/` or `.`, components ending `.lock`, and any component beginning `.`. A branch/tag/hex-looking string is only a configured selection, never immutable provenance. No subprocess validates it.

All creation flags are explicit (no coercion/default/implicit enable). Source creation requires `sourceId, repository, enabled, allowPackages`. Catalog creation requires `catalogId, sourceId, displayName, ref, enabled`. `displayName` is 1–128 nonblank Unicode characters, no control characters or lone surrogates; preserve authored spacing and reject unknown keys.

Source ID/repository and catalog ID/source binding are immutable. PATCH schemas cannot contain them. A different URL requires a different source identity, never an in-place rewrite or credential move. Display/ref/policy edits increment optimistic `revision` but do not change identities or any future known-release records.

Removal is a tombstone: source removal sets `removedAt`, `enabled=false`, `allowPackages=false`, deletes its credential atomically; all catalogs on that source become effectively unavailable without deleting catalog rows/installations. Catalog removal sets `removedAt`, `enabled=false`. IDs and canonical identity remain reserved. Explicit restore operations reuse exactly the same identity, increment revision, clear `removedAt`, and leave enabled/policy false; source credentials remain absent. Restoring a catalog requires a nonremoved source and leaves it disabled. Restore never accepts a URL, source binding or credential. No physical deletion/rebinding endpoint.

Disabling a source retains encrypted credentials but makes future reads ineligible; no transport reads exist here. Disabling/removing a catalog cannot mutate independent package permission or delete credentials used by other catalogs on the source. Source removal is the explicit stronger operation. Catalog creation/update/restore requires nonremoved source (source may be disabled, yielding effectiveEnabled=false). Normal updates/credential mutation on tombstones return `REMOVED`; reads show tombstones for admin lifecycle inspection. Repeated delete/restore in an already-target state returns `STATE_CONFLICT`, not another event. All other valid PATCHes, even identical values, increment revision and audit once.

Every noncreate mutation includes integer `expectedRevision` (1–2147483647); compare inside the transaction. Mismatch is `REVISION_CONFLICT`. At max revision, fail `STATE_CONFLICT` rather than overflow. Source credential changes use **source** revision; source policy/removal and credential rotation cannot race through separate version counters. Catalog changes use catalog revision, with live source existence/removal checked in the same immediate transaction.

### Exact exported shapes

Create `packages/schemas/src/catalogs/configuration.ts`, exported from `packages/schemas/src/index.ts`. Runtime HTTP schemas are strict and have inferred types with the same names minus `Schema`:

```ts
SourceCreateSchema     // {sourceId, repository, enabled, allowPackages}
SourceUpdateSchema     // {expectedRevision, enabled?, allowPackages?}; at least one setting
CatalogCreateSchema    // {catalogId, sourceId, displayName, ref, enabled}
CatalogUpdateSchema    // {expectedRevision, displayName?, ref?, enabled?}; at least one setting
RevisionRequestSchema  // {expectedRevision}
ReadCredentialSetSchema // {expectedRevision, kind:"https-basic", username, password}
GitRepositorySchema    // strict input -> canonical repository object (rules above)
CatalogRefSchema
CatalogConfigurationAuditSchema
```

Username: 1–256 UTF-8 bytes, no colon, controls or lone surrogates. Password: 1–4096 UTF-8 bytes, no controls or lone surrogates. Both permit spaces, including meaningful leading/trailing spaces and all-space nonempty values; passwords also permit colons. Controls here mean U+0000–U+001F and U+007F–U+009F. Values are preserved byte-for-byte, not trimmed, normalized or interpolated. Kind fixed `https-basic`; a GitHub repository-scoped read-only PAT may be supplied in `password`. Syntax cannot verify granted provider permissions; no verified/readable status is claimed.

```ts
export type SourceMetadata = {
  sourceId: string; repository: {url: string; sshUser?: string};
  repositoryIdentity: string; enabled: boolean; allowPackages: boolean;
  revision: number; removedAt: number | null; createdAt: number; updatedAt: number;
  readCredential: {state:"absent"} | {state:"configured"; kind:"https-basic"; ref:string};
};
export type CatalogMetadata = {
  catalogId:string; sourceId:string; displayName:string; ref:string; enabled:boolean;
  effectiveEnabled:boolean; revision:number; removedAt:number|null;
  createdAt:number; updatedAt:number;
};
export type MutationReceipt = {resource:"source"|"catalog"; id:string; revision:number};
export type CatalogConfigErrorCode = "INVALID_REQUEST"|"PAYLOAD_TOO_LARGE"|"FORBIDDEN"
  |"NOT_FOUND"|"REMOVED"|"IDENTITY_CONFLICT"|"REVISION_CONFLICT"|"STATE_CONFLICT"
  |"UNSUPPORTED_CREDENTIAL_TRANSPORT"|"CREDENTIAL_STORAGE_UNAVAILABLE"|"STORAGE_FAILURE";
export type CatalogConfigResult<T> = {ok:true; value:T} | {ok:false; code:CatalogConfigErrorCode};
export type CatalogMutation =
  | {action:"source.create"; input:SourceCreate}
  | {action:"source.update"; sourceId:string; input:SourceUpdate}
  | {action:"source.remove"|"source.restore"; sourceId:string; input:RevisionRequest}
  | {action:"catalog.create"; input:CatalogCreate}
  | {action:"catalog.update"; catalogId:string; input:CatalogUpdate}
  | {action:"catalog.remove"|"catalog.restore"; catalogId:string; input:RevisionRequest}
  | {action:"read-credential.set"; sourceId:string; input:ReadCredentialSet}
  | {action:"read-credential.revoke"; sourceId:string; input:RevisionRequest};
export type CatalogConfigurationAudit = {
  actorHumanId:string; sourceId:string; catalogId?:string;
  action:CatalogMutation["action"]; revision:number;
};
```

Keep API-only metadata/result/mutation types in `apps/api/src/catalog-configuration.ts`; schema inferred request types and audit type live in schemas. Avoid duplicate definitions: infer audit type from `CatalogConfigurationAuditSchema`, reference it from the API module. Audit schema is strict, actorHumanId 1–128, IDs existing grammars, revision integer range above, action exact enum; require catalogId precisely for `catalog.*` actions and forbid it for other actions. Metadata is explicit field projection, never row spreading.

The audit event is `audit.catalog.configuration.changed`, envelope `source:"system"`, `status:"DELIVERED"`, no channel/parent/deliverAt/idempotencyKey. It records only authenticated actor ID, configured source/catalog handles, operation and new configuration revision. Do not include URL, displayName, selected ref, credential ref/kind/username/password/ciphertext, arbitrary errors or submitted JSON. No resolved Git revision/resources exist yet. No event for management reads, rejected requests or rolled-back mutations. Existing public event submission is unchanged: typed events are observability, not proof of authorization or a management command interface.

### Storage schema and private credentials

Migration `032_catalog_source_configuration.sql` creates:

```sql
CREATE TABLE catalog_sources (
  source_id TEXT PRIMARY KEY NOT NULL,
  canonical_url TEXT NOT NULL,
  ssh_user TEXT,
  repository_identity TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  allow_packages INTEGER NOT NULL CHECK(allow_packages IN (0,1)),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
  removed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK(removed_at IS NULL OR (enabled=0 AND allow_packages=0))
);
CREATE TABLE catalogs (
  catalog_id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL REFERENCES catalog_sources(source_id),
  display_name TEXT NOT NULL,
  ref TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
  removed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK(removed_at IS NULL OR enabled=0)
);
CREATE INDEX idx_catalogs_source_id ON catalogs(source_id);
CREATE TABLE catalog_read_credentials (
  source_id TEXT PRIMARY KEY NOT NULL REFERENCES catalog_sources(source_id),
  credential_ref TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind='https-basic'),
  ciphertext_b64 TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

Use `BEGIN; ... COMMIT;` within this multi-table migration as current migrator does not wrap migration files. Match SQL names, foreign keys, unique/check constraints and index in `schema.ts`, exported under `schema.catalogSources`, `schema.catalogs`, `schema.catalogReadCredentials`. No seed rows, no agent/secret data moves, no cascade deletion.

Each set generates a new random UUID ref, encrypts JSON `{version:1, kind:"https-basic", sourceId, repositoryIdentity, credentialRef, username, password}` via `encryptSecret(parseMasterKey(...), ...)`, and replaces the old row in the same transaction as the source revision/audit. Bound the plaintext before encryption (maximum 16384 UTF-8 bytes). Both username and password are encrypted; no plaintext username column. Encryption errors and missing/invalid master key become `CREDENTIAL_STORAGE_UNAVAILABLE` without exception detail; do not parse a key on app startup or ordinary metadata/config operations. An absent key must not disable unrelated application behavior or revoke/remove operations.

No externally supplied credential ref can be attached or reused. Catalogs inherit their exact source's optional read capability; no per-catalog arbitrary reference. The old ref disappears on replacement/revocation/removal, and no read/decrypt method is exported in this slice. Tests may decrypt synthetic DB fixtures with existing crypto to verify binding. A future API-private transport adapter must resolve current source/ref at use time, verify decrypted sourceId/repositoryIdentity/ref/kind match current DB metadata, enforce enabled/nonremoved state and transport policy, and never cache old refs as authorization. Presence means only stored, not decrypted/valid/connected/authorized at the host. Encryption does not promise secure deletion of old SQLite/WAL/backup bytes or protection from an API-host/root compromise.

### Transaction and notification contract

`createCatalogConfiguration` dependencies and produced interface:

```ts
export type CatalogConfigurationDeps = {
  db: OrgOpsDb;
  findHuman: (id:string) => AdminHuman | undefined;
  getMasterKey: () => string;
  appendAudit: (payload:CatalogConfigurationAudit) => (() => void);
};
export function createCatalogConfiguration(deps:CatalogConfigurationDeps): {
  listSources(): CatalogConfigResult<SourceMetadata[]>;
  getSource(sourceId:string): CatalogConfigResult<SourceMetadata>;
  listCatalogs(): CatalogConfigResult<CatalogMetadata[]>;
  getCatalog(catalogId:string): CatalogConfigResult<CatalogMetadata>;
  mutate(actorHumanId:string, command:CatalogMutation): CatalogConfigResult<MutationReceipt>;
};
```

This is API-private, not workspace/runner-exported. Metadata methods execute synchronously behind route authorization, return deterministic handle ordering and include tombstones; zero configured rows yields `[]`. All methods catch unexpected storage exceptions and return only constant codes. Validate commands at the factory seam too (internal discriminated dispatch using request schemas), never trust a TypeScript type at runtime to preserve credential/identity limits. Do not export `getMasterKey`, ciphertext or raw statements.

`mutate` first rejects `db.inTransaction === true` with `STORAGE_FAILURE`, before any mutation/audit/notification. Nested transactions are not supported: better-sqlite3 would use a savepoint whose release is not an outer commit. This rejection leaves the caller-owned outer transaction and all its data unchanged. Otherwise `mutate` uses a top-level `db.transaction(() => { ... }).immediate()`; no await, fetch, file read or bus publish inside. Recheck `canManageCatalogs({id:actorHumanId}, {findHuman})` **inside** the transaction after HTTP body parsing. Check existence/removal/revision and source-parent invariants, perform SQL, then validate and append exactly one audit. `appendAudit` persists but returns a publish closure. The transaction returns receipt plus closure; publish only after successful commit. Expected errors abort before writes or throw an internal **code-only** sentinel to roll back; a failing append/commit rolls back source/catalog/credential/event changes and returns `STORAGE_FAILURE`. Do not catch and return success from inside a half-mutated transaction. Unique canonical/handle conflicts map `IDENTITY_CONFLICT` without interpolating SQL; FK unexpected failures use `STORAGE_FAILURE`.

In `app.ts` change only `insertEvent(input: any)` to `insertEvent(input: any, options: {publish?: boolean} = {})` and gate its existing `publishEvent(row)` with `if (options.publish !== false)`. All existing single-argument callers retain their exact behavior. New injected callback:

```ts
appendAudit(payload) {
  const row = insertEvent({
    type: "audit.catalog.configuration.changed", payload,
    source: "system", status: "DELIVERED",
  }, {publish:false});
  return () => publishEvent(row);
}
```

No raw DB event insert outside `insertEvent`; no event-bus implementation changes. Append validates the fixed audit shape before calling insertEvent. If publish throws after commit, contain it and emit only the constant warning `Catalog audit notification failed`; return successful mutation receipt. Persisted audit is authoritative; WebSocket notification is best effort (missed notifications recover via existing event queries), not a durable-delivery claim. Never retry the mutation or notification implicitly. Failed append may consume a monotonic in-memory timestamp; gaps are permitted, ordering must remain strictly monotonic. Tests must demonstrate no precommit notifications, rollback absence and unchanged ordinary event receipts/order/publication.

### HTTP surface and errors

Register `apps/api/src/routes/catalogs.ts` via `registerCatalogRoutes(app, {configuration, requireAuth, requireAdmin})`, where configuration is `ReturnType<typeof createCatalogConfiguration>` and guards use Hono `MiddlewareHandler`. Follow existing Hono app composition without new `AppConfig` credential fields. Build `requireAdmin = createRequireAdmin(adminAccessDeps)` and factory dependencies in `createApp`; `getMasterKey` reads existing `process.env.ORGOPS_MASTER_KEY ?? ""` lazily. The new module may use typed Hono context variables containing `AdminPrincipal`; do not add `as any` to new route/factory code.

Before calling `registerAuthRoutes`, install the tiny cache-header middleware shown below in `createApp`; it matches only `/api/catalog-sources` and `/api/catalogs` including descendants. This order ensures early global-auth denials also have no-store without altering any auth decision or existing route headers. Factory/feature route registration stays after auth. Every feature route has `requireAuth`, then `requireAdmin`, then bounded handler. Middleware authorization precedes path/body/existence checks.

```ts
app.use("/api/*", async (c, next) => {
  if (/^\/api\/(?:catalog-sources|catalogs)(?:\/|$)/.test(c.req.path)) {
    c.header("Cache-Control", "no-store");
  }
  await next();
});
// Register existing auth routes/global auth middleware next, without changing them.
```

Do not change global auth semantics or interpret a forged `source:"agent:..."` JSON field as a user.

| Method/path | Strict body | Success |
|---|---|---|
| GET `/api/catalog-sources` | none | 200 `{sources:SourceMetadata[]}` |
| GET `/api/catalog-sources/:sourceId` | none | 200 SourceMetadata |
| POST `/api/catalog-sources` | SourceCreate | 201 MutationReceipt |
| PATCH `/api/catalog-sources/:sourceId` | SourceUpdate | 200 MutationReceipt |
| DELETE `/api/catalog-sources/:sourceId` | RevisionRequest | 200 MutationReceipt |
| POST `/api/catalog-sources/:sourceId/restore` | RevisionRequest | 200 MutationReceipt |
| PUT `/api/catalog-sources/:sourceId/read-credential` | ReadCredentialSet | 200 MutationReceipt |
| DELETE `/api/catalog-sources/:sourceId/read-credential` | RevisionRequest | 200 MutationReceipt |
| GET `/api/catalogs` | none | 200 `{catalogs:CatalogMetadata[]}` |
| GET `/api/catalogs/:catalogId` | none | 200 CatalogMetadata |
| POST `/api/catalogs` | CatalogCreate | 201 MutationReceipt |
| PATCH `/api/catalogs/:catalogId` | CatalogUpdate | 200 MutationReceipt |
| DELETE `/api/catalogs/:catalogId` | RevisionRequest | 200 MutationReceipt |
| POST `/api/catalogs/:catalogId/restore` | RevisionRequest | 200 MutationReceipt |

No refresh/check-credential/read-credential GET/import/publish routes. For mutation bodies, require content-type `application/json` (parameters allowed), stream at most 16384 actual UTF-8 bytes before `JSON.parse`, ignoring any claimed smaller Content-Length; return 413 and cancel reader when exceeded, fatal-decode UTF-8, then bounded `parseCatalogJson(text,16384)` and the strict request schema. Reject missing/invalid content-type/body/UTF-8/JSON/unknown fields using `INVALID_REQUEST`. No raw Zod issues, request values, URL parser errors, SQL or crypto exceptions enter response/log. The same bounded helper serves DELETE bodies; no revision query/header alternative.

| Error code | HTTP | Constant `error` |
|---|---:|---|
| INVALID_REQUEST | 400 | Invalid catalog configuration request |
| PAYLOAD_TOO_LARGE | 413 | Catalog configuration request too large |
| FORBIDDEN | 403 | Administrator access required |
| NOT_FOUND | 404 | Catalog configuration not found |
| REMOVED | 410 | Catalog configuration removed |
| IDENTITY_CONFLICT | 409 | Catalog configuration identity already reserved |
| REVISION_CONFLICT | 409 | Catalog configuration changed; reload metadata |
| STATE_CONFLICT | 409 | Catalog configuration operation conflicts with current state |
| UNSUPPORTED_CREDENTIAL_TRANSPORT | 400 | Managed read credentials require HTTPS |
| CREDENTIAL_STORAGE_UNAVAILABLE | 503 | Read credential storage unavailable; check API master key configuration |
| STORAGE_FAILURE | 500 | Catalog configuration operation failed |

Service/handler errors return `{error:<constant>, code:<constant>}`. Existing guards keep their existing 401/403 bodies (including global forced-password-change messages); do not retrofit codes into those guards. Valid but absent ref revocation returns STATE_CONFLICT; invalid paths fail 400 after authorization. Management responses contain credential presence/ref only, never username/password/ciphertext. All responses from the new routes set `Cache-Control: no-store`.

### Policy adapter obligations, explicitly not implemented

Catalog `effectiveEnabled = catalog.enabled && catalog.removedAt === null && source.enabled && source.removedAt === null`. Index authority permits only that configured catalog and its in-repository packages. External `location.type:"source"` and cross-source dependency package locations separately require their configured nonremoved source to be enabled **and** `allowPackages=true`, even if it also hosts a catalog. Configuration does not invoke `resolvePackages` or construct fetched snapshots.

The Phase-2 resolver uses one `allowedSourceIds` list for catalog and package checks. A future trusted adapter must independently check external-location permissions before constructing resolver inputs; blindly unioning catalog source IDs with permitted package IDs would grant too much. Never pass package-suggested URLs, credential refs or source IDs to registration. Keep known-release mappings across disable/remove/restore/ref changes and preserve separate catalog/package commits. No known-release persistence or source adapter scaffolding is added here.

Future transport review must decide/enforce DNS/IP/private-network reachability policy (including rebinding), redirects with no cross-identity credential forwarding, proxies, TLS/SSH host verification, helpers/submodules/LFS/protocol allowlists, bounded Git/download execution and provider credential privileges. Inert HTTPS/SSH configuration is neither network permission nor verified private read access. Do not ban all private-network hosts in this syntax layer or claim SSRF protection from regexes.

### Complete synthetic fixtures

Use these values verbatim (never contact `.invalid` hosts):

```ts
const sourceInput = {
  sourceId:"team-source", repository:{url:"https://git.example.invalid/team/catalog.git"},
  enabled:true, allowPackages:false,
};
const externalInput = {
  sourceId:"package-source", repository:{url:"https://forge.example.invalid/org/packages.git"},
  enabled:true, allowPackages:true,
};
const sshInput = {
  sourceId:"ssh-source", repository:{url:"ssh://git.example.invalid/team/private.git", sshUser:"git"},
  enabled:false, allowPackages:false,
};
const catalogInput = {
  catalogId:"team-catalog", sourceId:"team-source", displayName:"Team catalog",
  ref:"main", enabled:true,
};
const readInput = {
  expectedRevision:1, kind:"https-basic" as const,
  username:"synthetic-reader", password:"synthetic-read-password-1234567890",
};
const masterKey = Buffer.alloc(32, 7).toString("base64");
const secondKey = Buffer.alloc(32, 8).toString("base64");
```

URL rejection fixtures: `https://user:synthetic-read-password-1234567890@git.example.invalid/a/b`, `https://@git.example.invalid/a/b`, `https://git.example.invalid/a/b?token=synthetic-read-password-1234567890`, `https://git.example.invalid/a/b#x`, `https://git.example.invalid/a/../b`, `https://git.example.invalid/a/%2e%2e/b`, `https://git.example.invalid/a//b`, `https://git.example.invalid/a/b/`, `https://git.example.invalid:0/a/b`, `https://git.example.invalid:65536/a/b`, `https://0177.0.0.1/a/b`, `https://2130706433/a/b`, `https://git.example.invalid./a/b`, `https://git.example.invalid\\evil/a/b`, `git@git.example.invalid:a/b`, `file:///tmp/repo`, `/tmp/repo`, `ext::sh -c id`, `--upload-pack=evil`, `http://git.example.invalid/a/b`. Include a raw newline and non-ASCII hostname test. HTTPS with any sshUser rejects; SSH missing sshUser or with URL userinfo rejects. Accept synthetic IPv6 `ssh://[2001:db8::1]:2222/team/repo` with sshUser `git` and explicit canonical IPv4 `https://192.0.2.1/team/repo`; do not connect.

Canonical equality: `HTTPS://GIT.EXAMPLE.INVALID:443/team/catalog.git` equals sourceInput identity. SSH `:22` equals omitted port with same sshUser. `.git`/no suffix, path case, HTTPS/SSH and distinct sshUser produce distinct conservative identities (no equivalence assertion). Ref rejection fixtures: `-main`, `a..b`, `a//b`, `a/`, `.hidden`, `a/.hidden`, `a.lock`, `a/b.lock`, `main\n`.

### Verification commands and evidence

Task 1 captures a fresh baseline before production edits. Read-only previous reference: `.superpowers/sdd/2026-09-10-catalogs-02-package-contract/parent-final-lint.json`, `parent-final-lint-*.txt`, `parent-compare-lint.py`, `parent-verify.sh`. Prior verified totals: 673 Vitest tests/27 files, 3 opscli tests; API486 + runner2 diagnostics, ten other workspaces clean. Do not call previous scripts that write their own phase paths.

Create this phase scratch wrapper (not a tracked source file), and invoke all npm validation through it:

```bash
D="$PWD/.superpowers/sdd/2026-09-10-catalogs-03-source-configuration"
mkdir -p "$D/verify-home" "$D/verify-tmp"
cat > "$D/run-isolated.sh" <<'SH'
#!/bin/bash
set -eu
cd /home/slamnation/www/orgops
D="$PWD/.superpowers/sdd/2026-09-10-catalogs-03-source-configuration"
ulimit -c 0
exec timeout --kill-after=5s 600s env -i PATH="$PATH" HOME="$D/verify-home" TMPDIR="$D/verify-tmp" CI=1 /bin/bash --noprofile --norc -c 'set -a; source .env.example; set +a; export ORGOPS_LLM_STUB=1; exec "$@"' bash "$@"
SH
bash "$D/run-isolated.sh" npm test > "$D/task-1-baseline-test.txt" 2>&1
bash "$D/run-isolated.sh" npm run --workspace @orgops/opscli test > "$D/task-1-baseline-opscli.txt" 2>&1
# Capture exit statuses separately, including expected existing lint failures.
for w in api agent-runner opscli admin-ui user-ui db schemas event-bus llm crypto skills events-scenario-tests; do
  bash "$D/run-isolated.sh" npm run --workspace "@orgops/$w" lint > "$D/task-1-baseline-lint-$w.txt" 2>&1
  printf '%s %s\n' "$w" "$?" >> "$D/task-1-baseline-lint-exits.txt"
done
```

Adapt/copy the prior comparison parser into this phase only. Preserve exact `(workspace, repository-relative file, TS code, complete multiline message)` **multisets including multiplicity**; ignore only source positions and existing absolute repo-prefix canonicalization. Compare fresh baseline to prior reference and each final task/phase to fresh baseline; zero added diagnostics is mandatory, report removals explicitly, never union baseline with new errors. Root lint stops at API debt so all twelve workspace invocations are required. `skills` and `schemas` zero diagnostics remain a hard requirement. Targeted tests use `npm exec --no -- vitest run <paths>` through the wrapper (installed binary only).

Fresh tests must not call normal `createApp` with the real project root: make a temporary project root containing an empty `skills/` and `files/`, stub `ORGOPS_PROJECT_ROOT` to it, pass temp dataDir and `openDb(":memory:")` or temp file DB, restore env and remove only owned fixture dirs in finally/afterEach. Existing full suites use their existing synthetic fixtures; do not alter their behavior. No provider credentials survive the isolated env. Record RED/GREEN commands, exit codes/counts/raw log paths, branch/HEAD, changed paths, `git diff --check` and `git diff --cached --name-only` after commit in each task report.

## Task 1: Strict configuration contracts and persisted identity tables

**Files:**
- Create `packages/schemas/src/catalogs/configuration.ts` and `configuration.test.ts`.
- Modify `packages/schemas/src/index.ts` (exports only), `packages/schemas/src/event-shapes.ts` (new strict audit shape), and `packages/schemas/src/index.test.ts` (existing core shape tests; add new strict audit cases).
- Create `packages/db/migrations/032_catalog_source_configuration.sql`, `packages/db/src/catalog-configuration.test.ts`.
- Modify `packages/db/src/schema.ts` (three tables/checks/index and schema exports).

**Interfaces:** Consumes existing SourceIdSchema/CatalogIdSchema, bounded JSON helpers and crypto-independent schema primitives. Produces every request/audit schema/type and `schema.catalogSources/catalogs/catalogReadCredentials` exactly as Shared contracts; no API routes/factory or crypto transport yet.

- [x] **Step 1: Record clean preflight and isolated baseline.** Verify branch/HEAD/status, read AGENTS/design/current spec and named sources, create current-phase run wrapper, capture npm test/opscli/all-workspace lint with the commands in Shared contracts. Record TASK_BASE before edits; no install or dependency changes.

- [x] **Step 2: Write failing schema tests with complete fixtures.** Put the shared synthetic objects in the test module; use table-driven assertions for all URL/ref rejection fixtures and canonical equality/distinctness. Representative exact tests:

```ts
import {describe, expect, it} from "vitest";
import {SourceCreateSchema, CatalogCreateSchema, ReadCredentialSetSchema,
  GitRepositorySchema, CatalogRefSchema, CatalogConfigurationAuditSchema} from "./configuration";

describe("catalog configuration contracts", () => {
  it("canonicalizes connection spelling without accepting credentials", () => {
    expect(GitRepositorySchema.parse({url:"HTTPS://GIT.EXAMPLE.INVALID:443/team/catalog.git"}))
      .toEqual({url:"https://git.example.invalid/team/catalog.git"});
    expect(GitRepositorySchema.safeParse({url:"https://synthetic-reader:password@git.example.invalid/team/catalog.git"}).success).toBe(false);
    expect(GitRepositorySchema.safeParse({url:"ssh://git.example.invalid/team/catalog.git",sshUser:"git"}).success).toBe(true);
  });
  it("requires explicit policy and never accepts caller identity or credentials", () => {
    const source = {sourceId:"team-source",repository:{url:"https://git.example.invalid/team/catalog.git"},enabled:true,allowPackages:false};
    expect(SourceCreateSchema.parse(source)).toEqual(source);
    expect(SourceCreateSchema.safeParse({...source,repositoryIdentity:"forged"}).success).toBe(false);
    expect(SourceCreateSchema.safeParse({...source,readCredentialRef:"forged"}).success).toBe(false);
    const {allowPackages, ...incomplete} = source;
    expect(allowPackages).toBe(false);
    expect(SourceCreateSchema.safeParse(incomplete).success).toBe(false);
    expect(CatalogCreateSchema.safeParse({catalogId:"team-catalog",sourceId:"team-source",displayName:"Team",ref:"main",enabled:true}).success).toBe(true);
  });
  it("bounds typed credential bytes and prevents audit payload passthrough", () => {
    const credential = {expectedRevision:1,kind:"https-basic",username:"synthetic-reader",password:"synthetic-read-password-1234567890"};
    expect(ReadCredentialSetSchema.safeParse(credential).success).toBe(true);
    expect(ReadCredentialSetSchema.safeParse({...credential,password:"é".repeat(2049)}).success).toBe(false);
    expect(ReadCredentialSetSchema.safeParse({...credential,username:"reader:password"}).success).toBe(false);
    const audit = {actorHumanId:"human-owner",sourceId:"team-source",action:"read-credential.set",revision:2};
    expect(CatalogConfigurationAuditSchema.safeParse(audit).success).toBe(true);
    expect(CatalogConfigurationAuditSchema.safeParse({...audit,password:credential.password}).success).toBe(false);
    expect(CatalogConfigurationAuditSchema.safeParse({...audit,catalogId:"team-catalog"}).success).toBe(false);
    expect(CatalogRefSchema.safeParse("releases/v1").success).toBe(true);
  });
});
```

Add explicit unknown-field, null/coercion, missing/empty patch, revision min/max, display controls/surrogate, username colon/control/byte-bound, password control/byte-bound, preserved leading/trailing spaces and password colons, unsupported-kind and catalog audit ID coupling cases. Test standard core event validation accepts exact audit envelope and rejects credential fields, without changing existing audit shapes. Use `validateEventAgainstShapes(event, getCoreEventShapes())`, asserting `.ok` from current `packages/schemas/src/index.test.ts` patterns.

- [x] **Step 3: Write failing migration tests.** Use memory DB and a temp migration directory copying only files `< "032_catalog_source_configuration.sql"`; migrate old schema, insert a synthetic human and one existing secret, migrate full twice. Assert exactly one migration row, existing rows unchanged, three empty new tables, FK/unique/check constraints and Drizzle select projections. Exact core assertions:

```ts
import {describe, expect, it} from "vitest";
import {createDrizzleDb, migrate, openDb, schema} from "./index";

it("reserves source identity and keeps credentials outside secrets", () => {
  const db = openDb(":memory:");
  try {
    migrate(db);
    const insert = db.prepare(`INSERT INTO catalog_sources
      (source_id,canonical_url,repository_identity,enabled,allow_packages,revision,created_at,updated_at)
      VALUES (?,?,?,1,0,1,1,1)`);
    const identity = JSON.stringify(["https://git.example.invalid/team/catalog.git",null]);
    insert.run("team-source","https://git.example.invalid/team/catalog.git",identity);
    expect(() => insert.run("alias-source","https://git.example.invalid/team/catalog.git",identity)).toThrow();
    expect(() => db.prepare("UPDATE catalog_sources SET enabled=2").run()).toThrow();
    expect(() => db.prepare("UPDATE catalog_sources SET removed_at=2").run()).toThrow();
    expect(createDrizzleDb(db).select().from(schema.catalogReadCredentials).all()).toEqual([]);
    expect(db.prepare("SELECT count(*) AS count FROM secrets").get()).toEqual({count:0});
    migrate(db);
    expect(db.prepare("SELECT count(*) AS count FROM migrations WHERE id='032_catalog_source_configuration.sql'").get()).toEqual({count:1});
  } finally { db.close(); }
});
```

Also assert missing-source FK failures for both child tables, duplicate credential ref, invalid credential kind, revision bounds and catalog removed/enabled check. Import actual Drizzle schema tables rather than testing SQL alone.

- [x] **Step 4: Prove RED.** Run through isolated wrapper: `npm exec --no -- vitest run packages/schemas/src/catalogs/configuration.test.ts packages/schemas/src/index.test.ts packages/db/src/catalog-configuration.test.ts`. Record expected missing module/table failures; distinguish test-setup failures from behavioral RED.

- [x] **Step 5: Implement the bounded schema parser and migration.** Use the exact SQL above. Build strict Zod request objects by composition, infer exported types; no package-manifest changes. Parse URL through prevalidation then built-in URL only (never fetch/exec); ensure uppercase schemes are accepted before canonicalization and raw unsafe paths cannot be normalized away. Preserve unknown-key rejection with `.strict()`. Representative composition:

```ts
const RevisionSchema = z.number().int().min(1).max(2147483647);
export const SourceCreateSchema = z.object({
  sourceId:SourceIdSchema, repository:GitRepositorySchema,
  enabled:z.boolean(), allowPackages:z.boolean(),
}).strict();
export const SourceUpdateSchema = z.object({
  expectedRevision:RevisionSchema, enabled:z.boolean().optional(),
  allowPackages:z.boolean().optional(),
}).strict().refine(value => value.enabled !== undefined || value.allowPackages !== undefined);
export type SourceCreate = z.infer<typeof SourceCreateSchema>;
export type SourceUpdate = z.infer<typeof SourceUpdateSchema>;
```

Construct catalog/update/revision/credential/audit schemas from the exact fields/bounds above. Add a single core shape `{type:"audit.catalog.configuration.changed",description:"Catalog configuration mutation audit.",source:"core",payloadSchema:CatalogConfigurationAuditSchema}`. Mirror SQL constraints with Drizzle `check`, `.references`, `.unique` and existing index patterns, without editing unrelated schema definitions.

- [x] **Step 6: Prove GREEN and type compatibility.** Re-run Step 4; run complete schemas and db tests and `npm run --workspace @orgops/schemas lint`, `npm run --workspace @orgops/db lint`, `npm run --workspace @orgops/skills lint`; capture all-workspace diagnostic comparison because new exports/schema can affect dependent type inference. Zero additions, no casts/suppressions.

- [x] **Step 7: Self-review and commit.** `git diff --check`, inspect named paths only, update this phase ledger, then stage explicit Files paths and commit `feat(catalogs): define persisted source configuration contracts`. Confirm no staged files remain. Report RED/GREEN logs, baseline comparison, counts and HEAD. Parent owns task review; Task 2 begins only after that gate.

## Task 2: Transactional source lifecycle and API-private credential factory

**Files:**
- Create `apps/api/src/catalog-configuration.ts`, `apps/api/src/catalog-configuration.test.ts`.
- Modify `apps/api/src/app.ts` only for optional insertEvent deferred-publication flag at this task; route/factory wiring follows in Task 3.
- No new migration, secret-route/runner/crypto implementation changes.

**Interfaces:** Consumes Task-1 request/audit schemas and three DB tables plus existing admin/crypto helpers. Produces `createCatalogConfiguration`, its dependencies, metadata/result/mutation types and exact methods from Shared contracts. `appendAudit(payload): () => void` persists inside the caller transaction and notifies after it; Task 3 supplies the real app adapter. Unit tests supply a transactional synthetic audit adapter, not a network adapter.

- [x] **Step 1: Establish TASK_BASE and write failing lifecycle tests.** Use memory DB migrated by `migrate`, insert human `human-owner` with persisted admin/password flags and inject a prepared live human lookup. Define a local `makeFixture` in this test file, not a production fixture library:

```ts
function makeFixture() {
  const db = openDb(":memory:");
  migrate(db);
  db.prepare(`INSERT INTO humans (id,username,password_hash,is_admin,must_change_password,created_at,updated_at)
    VALUES ('human-owner','owner','not-a-login-hash',1,0,1,1)`).run();
  const findHuman = (id:string) => {
    const row = db.prepare<[string],{is_admin:number;must_change_password:number}>(
      "SELECT is_admin,must_change_password FROM humans WHERE id=?").get(id);
    return row ? {isAdmin:row.is_admin===1,mustChangePassword:row.must_change_password===1} : undefined;
  };
  const published: CatalogConfigurationAudit[] = [];
  const config = createCatalogConfiguration({db, findHuman,
    getMasterKey:() => Buffer.alloc(32,7).toString("base64"),
    appendAudit(payload) {
      expect(db.inTransaction).toBe(true);
      const checked = CatalogConfigurationAuditSchema.parse(payload);
      db.prepare(`INSERT INTO events (id,type,payload_json,source,status,created_at)
        VALUES (?,?,?,?,?,?)`).run(randomUUID(),"audit.catalog.configuration.changed",JSON.stringify(checked),"system","DELIVERED",Date.now());
      return () => { expect(db.inTransaction).toBe(false); published.push(checked); };
    },
  });
  return {db, config, findHuman, published};
}
```

The test-only insert avoids recreating app internals and establishes append semantics; production continues using insertEvent. Import request audit type/schema, `randomUUID`, DB helpers, crypto helpers and factory explicitly. Wrap each fixture in try/finally to close DB.

```ts
it("keeps index authority separate from external package policy", () => {
  const f = makeFixture();
  try {
    expect(f.config.mutate("human-owner",{action:"source.create",input:{sourceId:"team-source",repository:{url:"https://git.example.invalid/team/catalog.git"},enabled:true,allowPackages:false}}))
      .toEqual({ok:true,value:{resource:"source",id:"team-source",revision:1}});
    expect(f.config.mutate("human-owner",{action:"catalog.create",input:{catalogId:"team-catalog",sourceId:"team-source",displayName:"Team catalog",ref:"main",enabled:true}}).ok).toBe(true);
    const source = f.config.getSource("team-source");
    expect(source.ok && source.value.allowPackages).toBe(false);
    expect(f.config.mutate("human-owner",{action:"source.update",sourceId:"team-source",input:{expectedRevision:1,enabled:false}}).ok).toBe(true);
    const catalog = f.config.getCatalog("team-catalog");
    expect(catalog.ok && catalog.value.effectiveEnabled).toBe(false);
    expect(f.config.mutate("human-owner",{action:"source.update",sourceId:"team-source",input:{expectedRevision:1,enabled:true}})).toEqual({ok:false,code:"REVISION_CONFLICT"});
  } finally { f.db.close(); }
});
```

Add create/get/list empty/order; duplicate handle and canonical URL (including tombstones); forbidden in-place URL/ID/source-binding changes; source and catalog disable/remove/restore state/revision matrix; credential removal on source tombstone; restoring disabled with no credential/policy; catalog parent removed conflict; no installation/agent/secret row changes; unexpected DB failure redaction; admin missing/demoted/forced-password-change inside mutation and no state/event changes. Use two configuration factory instances on the same DB for stale revisions and a temporary file DB with two connections for serialized state checks; no async work inside a transaction.

- [x] **Step 2: Write failing credential/security and atomicity tests.** Start from source revision1, set shared readInput -> revision2, decrypt synthetic ciphertext with masterKey, assert exact version/kind/sourceId/repositoryIdentity/ref/username/password envelope, metadata contains presence/kind/ref only, `secrets` empty. Set second username `" synthetic reader é "` and password `"  synthetic:päss word  "` with expectedRevision2 -> revision3 and a different ref; decrypt and assert both exact strings including spaces/colon/multibyte bytes, with no normalization; old ref absent. Revoke -> revision4, row absent, source identity unchanged. Removing source with a credential also deletes it. Source disable retains credential but cannot be mistaken for permission. SSH set rejects before key parsing with `UNSUPPORTED_CREDENTIAL_TRANSPORT` and no writes/audit. An unknown kind, caller ref, oversized multibyte credential or unexpected nested field fails `INVALID_REQUEST`.

Missing key and throwing key getter return `CREDENTIAL_STORAGE_UNAVAILABLE`; source/catalog CRUD and revoke/remove still work. No decrypt/credential value method exists on returned interface; inspect explicit method keys. Tamper/wrong-key detection is tested only via existing `decryptSecret` on synthetic rows, not a new transport/decrypt method.

```ts
it("rolls back mutation and audit before any notification", () => {
  const f = makeFixture();
  try {
    const broken = createCatalogConfiguration({db:f.db,findHuman:f.findHuman,
      getMasterKey:() => Buffer.alloc(32,7).toString("base64"),
      appendAudit() { throw new Error("synthetic-read-password-1234567890"); },
    });
    expect(broken.mutate("human-owner",{action:"source.create",input:{sourceId:"team-source",repository:{url:"https://git.example.invalid/team/catalog.git"},enabled:true,allowPackages:false}}))
      .toEqual({ok:false,code:"STORAGE_FAILURE"});
    expect(f.config.listSources()).toEqual({ok:true,value:[]});
    expect(f.db.prepare("SELECT count(*) AS n FROM events").get()).toEqual({n:0});
    expect(f.published).toEqual([]);
  } finally { f.db.close(); }
});
```

Add a real caller-owned outer-transaction test: begin a transaction on the fixture DB, update an unrelated synthetic human timestamp, then call mutate. Assert exact `{ok:false,code:"STORAGE_FAILURE"}`, no source/credential/audit changes or publication, `db.inTransaction` still true and the caller's timestamp edit still visible. Commit the caller transaction and verify only its edit persists; rejection must not rollback, commit or release caller state.

Repeat append failure **after writing a synthetic audit row** and after credential replacement, asserting original ciphertext/ref/source revision and event count intact. Test transaction commit failure using a deferred FK violation introduced by the test audit adapter (test-only table with `DEFERRABLE INITIALLY DEFERRED`) so the closure must not run. Test a throwing publication closure: mutation and audit persist, success receipt returned, only fixed warning logged. Assert console/error spies never contain either synthetic secret or arbitrary thrown text. Test sequential audit revision/count and timestamps for ordinary app insertion in Task3, where the real adapter is available.

- [x] **Step 3: Prove RED.** Through wrapper run `npm exec --no -- vitest run apps/api/src/catalog-configuration.test.ts`; save task-2-red log. Expected missing factory or failed lifecycle assertions, not setup failures.

- [x] **Step 4: Implement one cohesive factory and narrow event option.** Implement explicit metadata SELECT projections; never select ciphertext for metadata or expose a row. Prepare parameterized SQL and map enabled flags explicitly. Use the Shared contract SQL lifecycle transitions, optimistic revisions and type-discriminated actions, with runtime schema validation before mutation.

The mutation core must follow this ordering (internal code-only aborts implement expected domain failures; no user text on them):

```ts
// All local variables here are inside mutate, never a global pending publisher.
if (db.inTransaction) return {ok:false,code:"STORAGE_FAILURE"};
const committed = db.transaction(() => {
  if (!canManageCatalogs({id:actorHumanId},{findHuman})) abort("FORBIDDEN");
  // Branch on validated command.action; check state/revision, perform its exact SQL.
  // Construct receipt and strict audit only from persisted identity + authenticated actor.
  const notify = appendAudit(audit);
  return {receipt, notify};
}).immediate();
try { committed.notify(); }
catch { console.warn("Catalog audit notification failed"); }
return {ok:true,value:committed.receipt};
```

Implement `abort` as a local function throwing a private branded code-only object/type, not a raw DB/crypto error. Its return type is `never`. Catch and map known aborts outside transaction; unexpected errors become STORAGE_FAILURE. Keep validation/key/encryption catches redacted and make mutation/append rollback all-or-nothing. A mutable externally shared pending publisher or publication inside transaction is forbidden.

For credential set, generate UUID ref and build/encrypt the exact bounded envelope from current source row and validated input. Use existing encryptSecret, not new crypto parameters, env-file reads or a vault abstraction. Explicit column INSERT/UPDATE with current timestamps; replace ciphertext/ref atomically. For ordinary metadata operations do not touch key getter.

In app.ts implement only the two-line signature/publication conditional change specified in Shared contracts. Preserve insertEvent receipt selection, event status, timestamps, return value and all existing calls.

- [x] **Step 5: Prove GREEN and regressions.** Re-run factory tests; run existing `apps/api/src/app.test.ts`, `apps/api/src/admin-access.test.ts`, `apps/api/src/admin-access.integration.test.ts`, `apps/api/src/humans-admin-reset.integration.test.ts`, schema/db tests through isolated wrapper. Run skills/schemas lint and all-workspace exact comparison; API debt cannot hide new diagnostics. No production route exists until Task3, which tests real adapter behavior.

- [x] **Step 6: Self-review and commit.** Inspect mutation branches against state/error/audit tables, search this new module for console/raw errors/secret row access, `git diff --check`, record TASK_BASE/head/logs/diff in ledger. Stage explicit three Files paths and commit `feat(catalogs): isolate transactional source credentials`. Verify empty index. Parent independent review gates Task3.

## Task 3: Administrator HTTP integration, leakage regressions and current docs

**Files:**
- Create `apps/api/src/routes/catalogs.ts`, `apps/api/src/catalogs.integration.test.ts`.
- Modify `apps/api/src/app.ts` (factory/route/admin guard wiring and deferred audit adapter only).
- Modify `apps/agent-runner/src/event-routing.test.ts` (bookkeeping regression only; no runner production changes).
- Modify `docs/SPEC.md`, `docs/catalog-package-contract.md` (implemented configuration versus still-inert library obligations).

**Interfaces:** Consumes Task-2 factory/metadata/results and Task-1 strict schemas. Produces exactly the 14 routes/status/body contracts in Shared contracts; no refresh/import/publish/credential GET. Dependencies `configuration`, `requireAuth`, `requireAdmin` injected by createApp; no direct DB import in routes.

- [x] **Step 1: Write failing isolated integration fixture and success flow.** Use `mkdtempSync`, temporary projectRoot with empty skills/files, `vi.stubEnv("ORGOPS_PROJECT_ROOT",tempRoot)`, `vi.stubEnv("ORGOPS_MASTER_KEY",masterKey)`, memory DB, explicit dataDir/adminUser/adminPass/runnerToken. Restore env and cleanup in afterEach. Use actual login/session and invite/redeem flows copied locally from `humans-admin-reset.integration.test.ts`, not fake admin middleware.

```ts
async function login(app:ReturnType<typeof createApp>["app"],username:string) {
  const response = await app.request("/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({username,password:"test-owner-password"})});
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")?.match(/orgops_session=[^;]+/)?.[0];
  if (!cookie) throw new Error("Synthetic login cookie missing");
  return cookie;
}
function request(app:ReturnType<typeof createApp>["app"],cookie:string,method:string,path:string,body?:unknown) {
  return app.request(path,{method,headers:{cookie,"content-type":"application/json"},
    ...(body === undefined ? {} : {body:JSON.stringify(body)})});
}
```

Create primary/external/SSH sources and catalog from shared fixtures; assert exact mutation receipts, GET projections, no-store, independent allowPackages, disable effectiveEnabled, mutable catalog display/ref, stable identity, conflicts and tombstone restore matrix. No network API is called. Spy `globalThis.fetch` to throw if invoked during management; synthetic `app.request` uses in-process Hono. Keep package inspection/extraction/modules entirely absent.

- [x] **Step 2: Write authorization matrix for every management route.** Table-drive all 14 method/path/body rows from Shared contracts. For each assert unauthenticated401; regular human named `admin`403; global/scoped runner403 with/without admin cookie; unknown agent-auth header without cookie401; same-cookie live demotion403; live forced-password-change403; deleted human403; real human renamed `runner` retains persisted authority after explicit route requireAuth/live guard. Use separate fixtures or re-promote only via test DB setup between cases, never production role endpoints. Separately on body-bearing mutation routes assert authenticated ordinary human with forged source/privilege body fields403 and authenticated administrator with those unknown fields400; a body/header cannot grant or downgrade a valid session. Do not require body validation on GET routes.

Snapshot all three configuration tables/events before each denied request and compare unchanged; bodies/status cannot disclose existence or secrets. Generate scoped token through real channel/invite/redeem path exactly as existing admin reset fixture, with stopped invite agent defaults, no runner process or runtime tool invocation. Also test a body reader that changes caller's persisted role after initial guard but before parsing resolves; factory in-transaction recheck returns FORBIDDEN without writes. Do not add unrelated password-reset or RBAC behavior.

- [x] **Step 3: Write request-bound and secret-nondisclosure regressions.** Cover invalid Content-Type, malformed JSON/fatal UTF-8, missing body, unknown fields, canonical URL/ref negative fixtures, unknown kind/caller reference, stale revision, huge actual chunked body with absent/lying Content-Length and multibyte limit. Denials happen before body is read. API error body exactly matches constant table, not raw Zod/SQL/URL/crypto text.

Assert `Cache-Control: no-store` on unauthorized401, forbidden403 (including global password-change early return), malformed400/413, storage503 and successful responses; unrelated route headers remain unchanged. Set/rotate/revoke HTTPS synthetic credentials; include exact whitespace/colon/multibyte round-trip values from Task2, test metadata projections and missing key503; SSH attachment400 with unchanged revision. Compare all captured response text, console messages and `org:events` notifications for absence of both username and password. Query `/api/secrets`, `/api/secrets/keys`, runner `/api/secrets/env`, and `/api/agents` using existing authorized paths; assert no new credential value/ref/ciphertext is visible on these unrelated surfaces. For `/api/secrets/env` set master key synthetic and use trusted synthetic runner; any existing ordinary synthetic package secret behaves unchanged. No runner environment code needs alteration because repository credentials are in a distinct table. Confirm no read-credential GET endpoint and no source/publisher values enter `@orgops/skills` exporters (unchanged positive allowlists remain covered by full suite).

- [x] **Step 4: Write real mutation/audit/event integration regressions.** Subscribe to returned app `bus` `org:events`; in callback assert `db.inTransaction === false` and read committed source/audit, envelope channel absent/status DELIVERED/type exact/no credential material. Assert each successful mutation yields exactly one event and zero receipts. Use SQLite test trigger on events that raises ABORT for this audit type; source create and credential replacement return STORAGE_FAILURE, all rows unchanged, no notification and no raw console output.

```sql
CREATE TRIGGER fail_catalog_audit BEFORE INSERT ON events
WHEN NEW.type='audit.catalog.configuration.changed'
BEGIN SELECT RAISE(ABORT,'synthetic-read-password-1234567890'); END;
```

Drop the test trigger and retry with same expectedRevision: succeeds once. Add a bus subscriber throwing a secret-bearing synthetic Error; HTTP still reports committed success, persisted audit survives, log is only fixed warning. Then unsubscribe and create ordinary channel message event via existing `/api/events`: receipt, response, monotonic createdAt ordering and notification behavior remain unchanged. Run full `app.test.ts` to cover default insertion semantics.

In runner event-routing test add an audit event with a channel and targetAgentName for the test agent; assert `shouldHandleEventForAgent` false for `audit.catalog.configuration.changed`. Use existing agent/event test fixture types rather than new casts. No runner production filter change.

- [x] **Step 5: Prove RED.** Through wrapper run `npm exec --no -- vitest run apps/api/src/catalogs.integration.test.ts apps/agent-runner/src/event-routing.test.ts`; record expected new route404/auth/behavior failures. Existing runner test may already pass the new audit case; the route integration must demonstrate missing behavior.

- [x] **Step 6: Implement bounded routes and composition.** Add a small private streaming JSON helper in routes/catalogs.ts (no generic HTTP framework extraction). Count Uint8Array.byteLength before accumulating and JSON parsing; cancel once limit exceeded, release reader in finally, fatal-decode, parse bounded JSON, strict schema selection. Never throw input-bearing validation results into global onError. Wrap synchronous/async route logic in redacted failure mapping; no raw diagnostic logs.

Install the exact path-checking cache-header middleware from Shared contracts in app.ts **before** `registerAuthRoutes`. Register each exact feature path with `requireAuth`, `requireAdmin` after global auth registration; do not move auth or add late-only header middleware that misses early denials. Select actor ID from authenticated principal with explicit guard, construct discriminated mutation from path/body, call factory. Reject immutable or caller-owned privilege/ref fields through schema validation. Map list wrappers and success status exactly. No request data becomes a new configuration field by spreading.

Wiring in createApp after live adminAccessDeps exists and after global auth middleware registration:

```ts
const configuration = createCatalogConfiguration({
  db, findHuman:adminAccessDeps.findHuman,
  getMasterKey:() => process.env.ORGOPS_MASTER_KEY ?? "",
  appendAudit(payload) {
    const checked = CatalogConfigurationAuditSchema.parse(payload);
    const row = insertEvent({type:"audit.catalog.configuration.changed",payload:checked,
      source:"system",status:"DELIVERED"},{publish:false});
    return () => publishEvent(row);
  },
});
registerCatalogRoutes(app, {configuration,requireAuth,
  requireAdmin:createRequireAdmin(adminAccessDeps)});
```

Use structural Hono types compatible with existing app (extend local variable type if necessary without changing runtime auth). Do not copy the existing `app as any` convention into this new call; resolve newly introduced typing rather than suppress it. The configured factory is not returned by createApp or exported to runners.

- [x] **Step 7: Update truthful current documentation.** In docs/SPEC.md add three data tables, exact route/body/status/error/state examples, live-admin middleware, encrypted https-basic private-read lifecycle, lazy master key behavior, config revision versus resolved Git commit, typed audit/atomicity and best-effort notification semantics. Replace only now-obsolete claims that there is no catalog storage/routes. Explicitly retain no refresh/fetch/connectivity validation, snapshots, transport permission, install/activation/start gate, publishing or UI; document SSH managed-read subset limitation and future transport policy, not an SSH permanent exclusion.

In docs/catalog-package-contract.md keep library no-I/O guarantees, explain configured source/catalog/allowPackages distinction and API-only configuration module without pretending resolver consumes DB. Record required future adapter precheck before shared `allowedSourceIds`, stable source identity/tombstones and unchanged known-release/provenance responsibility. Do not revise export allowlists or active loader/runner behavior. Include only `.invalid` fixtures and descriptions of secure admin entry; never source-file real credentials.

- [x] **Step 8: Prove GREEN/full acceptance.** Run Step5 and task1/task2 tests, then `npm test`, opscli workspace test, root lint plus all 12 workspace lint commands and exact baseline comparison. Save current-phase task-3-final logs/JSON. Require zero added diagnostics; skills/schemas clean. Compare dependencies/lockfile to starting HEAD unchanged, `git diff --check`, branch and explicit changed paths. Report actual tests/file counts, not estimated totals. No real service start/build/dependency install is needed.

- [x] **Step 9: Self-review and commit.** Verify all 14 routes have live guards, every mutation factory recheck, bounded handler redaction, exact credential projections, atomic audit, no new fetch/exec/import path and docs match. Stage only Files paths and commit `feat(catalogs): expose administrator source configuration`. Record HEAD/empty index, logs and residual configuration-only limitations. Parent reviews task then whole phase; final tracking may mark checked tasks only after reviews.

## Reviewed completion and final validation

All three implementation tasks completed and passed their independent task review gates. Task 1 includes the reviewed host-normalization/Unicode-bound fix (`14aa345`); Task 2 completed at `6daa52a`; Task 3 completed at `dea758b`. Review authority is the structured reviewer output supplied to subsequent dispatches, not the empty Markdown review artifacts. The current-phase scratch ledger retains RED/GREEN and per-task evidence.

Fresh final isolated validation at `dea758b`: `npm test` passed 807 tests / 31 files; opscli passed 3 tests. Root lint remains failing (exit 2) on existing debt. All twelve workspace lint runs and exact baseline comparison confirm API 486 and runner 2 diagnostics unchanged (zero added, zero removed); the other ten workspaces, including skills and schemas, are clean. Evidence: `.superpowers/sdd/2026-09-10-catalogs-03-source-configuration/phase-final-*` and `validation-report.md`.

Whole-phase read-only review is approved (reviewer run `6dae9ab2-6249-450a-b1b8-b0c47952c6cf`), with no remaining findings. Parent inspected the factory, HTTP parsing/guards and app event/cache wiring and accepted the slice at HEAD `4dd339fa1cc72c7215f5cc100920d2d0d618f01c`. Parent fresh validation: 807 Vitest tests/31 files and 3 opscli tests pass; all twelve workspace typechecks confirm unchanged API486/runner2 debt, ten clean workspaces and zero added/removed diagnostics. Evidence is `parent-final-*.txt`, `parent-final-lint.json`, `parent-verify.sh` and `compare-lint.py` in this phase's scratch directory. Root lint is not green. Dependencies/lockfiles and checkout/index were verified unchanged/clean before this tracking update.

Configuration only: no live fetch/refresh, import, publishing services, activation or connectivity verification are implemented in this phase.
