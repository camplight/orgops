# Inert catalog/package contract (format version 1)

Implemented in `packages/schemas/src/catalogs/` and `packages/skills/src/catalogs/`.
The synchronous **in-memory library** remains independently usable. Explicit async
offline Git adapters additionally inspect trusted local object storage; neither is a
catalog service or installer. Active skill discovery and runner behavior are unchanged.

- `@orgops/schemas` exports strict Zod schemas, inferred types and bounded parsers.
- `@orgops/skills` exports digest/inspection, exact dependency resolution, and
  explicit portable export, `preparePublication` and `prepareImport` with complete byte reviews, plus
  `inspectGitPackage`, `readGitCatalogIndex` and `readGitPublicationEvidence` for
   offline exact-object I/O (selected semantic inspection versus complete byte/tree evidence).
- Pure inputs remain caller-supplied JSON data and staged base64 files. No function fetches,
  discovers, imports, activates or executes package content. The test event module
  below deliberately throws if activated; it is not a production skill recommendation.

There is **no** authenticated Git discovery, URL/credential-routing policy adapter,
download/extraction, general filesystem/archive traversal, approval, activation, stopped-agent installation,
model/secret binding, start gate, publishing or remote diff.
Those require subsequent reviewed adapters. No sandbox, secret-safety guarantee or
transitive command reproducibility is provided. Public/private Git consumption is
host-neutral and requires no central instance registration; future in-app PR publishing
is GitHub-only, not implemented by these candidate functions.

## Implemented API configuration boundary (separate from this library)

The API Source Library owns persisted administrator-managed sources, immutable
snapshots/releases, and encrypted HTTPS-basic read credentials. Its current routes
are `/api/catalog-sources` and `/api/catalog-releases`; the former mutable
`/api/catalogs` namespace was retired after its compatibility release and now has
framework-default 404 behavior. This format-v1 library remains independent of that
service boundary and does not create resolver snapshots.

Migration-033 skill origins are reconciled only by the API's direct, non-route
`createLegacyOriginReconciliation` service. It canonicalizes a single historical
origin only after strict live-admin checks, one exact release candidate, and a fresh
complete `readLocalSkillEvidence` measurement match. It preserves the original actor,
time, and local path; it never infers review, grants, approval, or source policy.
Identity conflicts are fixed and redacted, and a real canonicalization transition
writes one typed installation audit atomically; exact rows are idempotent without an
audit duplicate.
A supplied format-v1 source/catalog identity is inert package metadata: it does not
register a source, mutate configuration, or authorize a repository. Source bindings
and catalog/index release mappings are caller-owned authority, and changing them does
not silently change an immutable release identity. No source registration, permission
or credential binding comes from package/index metadata. For example
`https://git.example.invalid/team/catalog.git` is only inert configuration syntax,
not network authorization or verified repository provenance.

Catalog index and its in-repository releases have catalog authority. External
`location.type:"source"` and cross-source dependency locations independently need
a configured, enabled, nonremoved source with `allowPackages:true`, even when that
source hosts a catalog. Catalog disable/removal cannot revoke independent source
package permission. Source removal is stronger: disables both and removes its
credential. The resolver still accepts the existing single `allowedSourceIds`
list: a future trusted adapter **must precheck external-location permissions**
before constructing inputs. Blindly unioning enabled catalog source IDs with
package-permitted IDs would grant too much. Offline publication and import preparation now
perform this precheck against supplied evidence; a live authority/transport adapter
still does not exist.

Optional read credentials are API-private encrypted source-bound HTTPS-basic
capabilities, not agent package secrets. Both username/password are encrypted;
metadata reveals only state/kind/random ref, never values or ciphertext. Enter
credentials via secure administrator requests, never source files/chat/manifests.
Read credentials grant no publication permission and do not verify provider access.
SSH configuration is inert; managed SSH read support/host-key policy is deferred,
not permanently excluded from full v1. No resolver/export input gains a credential,
source URL, local publication setting or arbitrary passthrough. Export positive
allowlists and the in-memory no-I/O/no-execution guarantees remain unchanged.

The future transport adapter must enforce current source/ref bindings, independent
policy and DNS/IP/redirect/proxy/TLS/SSH/helper/submodule/LFS/download limits; URL
syntax alone is not SSRF defense. Future provenance persistence must retain known
release mappings across configuration disable/remove/restore/ref edits, with
separate resolved catalog and package commits. The library still only checks the
known identities and measured installed content its caller supplies.

## Public API

Synchronous inspection/export/resolution return `ContractResult<T>`; publication
preparation returns `PublicationResult<PublicationProposal>`. Neither returns partial success.
The offline adapters return `Promise<OfflineGitResult<T>>` as specified below. Errors
contain the first deterministic issue with a fixed field/index pointer or validated
path/identity, not raw rejected values, YAML diagnostics, commands or credentials.
Schemas themselves expose normal Zod APIs; use the bounded result functions below
for untrusted inputs rather than treating a bare `safeParse` as a resource boundary.

```ts
import {
  PackageManifestSchema, CatalogIndexSchema, DependencyPinSchema,
  ResolvedIdentitySchema, PortableWrappedRecipeSchema, RelativePathSchema,
  VersionSchema, DigestSchema, CommitSchema, CATALOG_LIMITS,
  parsePackageManifest, parseCatalogIndex, validatePackageManifest,
  validateCatalogIndex, validateCatalogJson,
} from "@orgops/schemas";
import {
  computePackageDigest, inspectPackage, parseSkillDocument, resolvePackages,
  exportAgentPackage, exportSkillPackage,
} from "@orgops/skills";
```

`PackageMetadataSchema`, `NativeTemplateSchema`, `PortableCommandSchema`,
`CompatibilitySchema`, `SecretRequirementSchema`, `FileInventoryEntrySchema`,
`ExecutableDeclarationSchema`, `PackageNameSchema`, `SourceIdSchema` and
`CatalogIdSchema` are also exported for typed composition. No schema coerces,
defaults, strips unknown keys or permits recursive passthrough.

### Result and parser signatures

```ts
export type ContractIssue = {
  code: "INVALID_JSON" | "INVALID_MANIFEST" | "INVALID_INDEX" | "LIMIT_EXCEEDED"
    | "UNSAFE_PATH" | "DUPLICATE_PATH" | "UNSUPPORTED_ENTRY" | "INVENTORY_MISMATCH"
    | "DIGEST_MISMATCH" | "INVALID_SKILL" | "EXECUTABLE_MISMATCH"
    | "SOURCE_NOT_ALLOWED" | "MISSING_RELEASE" | "IDENTITY_CONFLICT"
    | "INCOMPATIBLE" | "UNSUPPORTED_DEPENDENCY" | "CYCLE" | "SKILL_CONFLICT"
    | "UNSUPPORTED_EXPORT" | "UNSUPPORTED_WIRING";
  at: string;
};
export type ContractResult<T> = { ok: true; value: T } | { ok: false; issues: ContractIssue[] };
export type ReviewWarning = {
  code: "SENSITIVE_TEXT" | "MANUAL_REVIEW_REQUIRED" | "EXTERNAL_RUNTIME_NOT_PINNED";
  at: string;
};
export function parsePackageManifest(json: string): ContractResult<PackageManifest>;
export function parseCatalogIndex(json: string): ContractResult<CatalogIndex>;
export function validatePackageManifest(value: unknown): ContractResult<PackageManifest>;
export function validateCatalogIndex(value: unknown): ContractResult<CatalogIndex>;
export function validateCatalogJson(value: unknown, maxBytes: number): ContractResult<unknown>;
```

The object boundary first checks own data-property descriptors, rejects accessors
without calling them, and bounds serialized bytes/depth before field/schema/decoded
content work. JSON only: no cycles, undefined, BigInt, non-finite numbers, non-plain
objects or lone UTF-16 surrogates. Arrays/strings are bounded before child traversal.
Executable JavaScript objects/proxies are outside the caller contract; prototype and
descriptor inspection does **not** promise protection from Proxy traps. High-level
operations always choose their fixed limits; callers cannot raise them by invoking
`validateCatalogJson` separately.

## Offline exact Git inspection (explicit async I/O)

```ts
export type OfflineGitRepository = { directory: string; gitExecutable: string };
export type GitInspectionOptions = { signal?: AbortSignal };
export type GitPackageInput = { repository: OfflineGitRepository; commit: string; path: string };
export type GitIndexInput = { repository: OfflineGitRepository; commit: string; indexPath: string };
export type OfflineGitIssue = {
  code: ContractIssue["code"] | "INVALID_GIT_INPUT" | "UNSUPPORTED_GIT_STORAGE"
    | "GIT_UNAVAILABLE" | "GIT_FAILED" | "GIT_PROTOCOL_ERROR" | "GIT_OBJECT_MISSING"
    | "GIT_OBJECT_TYPE" | "GIT_OBJECT_INTEGRITY" | "GIT_PATH_MISSING" | "GIT_TIMEOUT"
    | "GIT_ABORTED" | "GIT_CLEANUP_FAILED";
  at: string;
};
export type OfflineGitResult<T> = { ok: true; value: T } | { ok: false; issues: OfflineGitIssue[] };
export function inspectGitPackage(input: GitPackageInput, options?: GitInspectionOptions):
  Promise<OfflineGitResult<PackageSnapshot>>;
export function readGitCatalogIndex(input: GitIndexInput, options?: GitInspectionOptions):
  Promise<OfflineGitResult<CatalogIndex>>;
```

These functions, the named types above and frozen `OFFLINE_GIT_LIMITS` are explicit
`@orgops/skills` exports. Session/raw-object/fixture seams are private direct modules,
not package exports. Existing inspect/digest/export/resolve remain synchronous and
I/O-free. No adapter accepts URLs, refs, credentials, source policy or callbacks.
`path` is a nonroot RelativePath directory (`.` forbidden); `indexPath` is required
RelativePath to one blob, with **no conventional/default index filename**. Commit
must be literal lowercase full SHA1 (40 hex) or SHA256 (64 hex), matching storage;
no refs, revision expressions, tag peeling, history traversal or fallback.

### Trusted provisioning, not acquisition or provenance

Both repository directory and installed Git executable are absolute trusted host
paths (at most 4096 UTF-8 bytes, no controls/NUL). They and the control/object storage
must be administrator-provisioned, stable trusted assets for the operation. Do not
pass package-authored paths, developer checkouts or `.git` indirection files. Own
data-property input envelopes reject accessors/unknown/missing fields without
calling getters and snapshot validated fields before I/O. Executable JS proxies and
options/signal remain trusted control-plane inputs, not package JSON.

Preflight requires actual directory/config/objects handles, no symlinks at checked
handles; config is an ordinary file read with a 4096-byte cap. Only these byte-exact
LF templates are accepted (tabs shown as indentation), with filemode `true` **or**
`false` and one final LF:

```ini
[core]
	repositoryformatversion = 0
	filemode = true
	bare = true
```

```ini
[core]
	repositoryformatversion = 1
	filemode = true
	bare = true
[extensions]
	objectformat = sha256
```

No comments, includes, extra config/sections/remotes/partialClone. Presence of
`commondir`, `config.worktree`, `objects/info/alternates`, `objects/info/http-alternates`
or any `.promisor` suffix in `objects/pack` rejects storage. Metadata preflight uses
at most 32 fixed filesystem calls plus 513 bounded pack-iterator yields (excluding
handle closes); it never walks all objects. Host ancestors and object-store internals
remain trusted, not recursively certified or defended against concurrent mutation.
Future acquisition must provision this narrow bare convention, not pass through a
normal clone or partial clone. No missing-object lazy acquisition is permitted.

### Selection, integrity and lifecycle

Only POSIX linux/darwin lifecycle is currently supported; other platforms fail before
spawn with UNSUPPORTED_GIT_STORAGE. This does not change portable package platform
schemas; Windows process-tree support requires a subsequent reviewed implementation.
Each operation runs at most two sequential trusted Git children: fixed `rev-parse
--is-bare-repository --show-object-format=storage`, then `cat-file --batch-command`.
Only full literal OID `info`/`contents` requests enter stdin. Shell is disabled;
children use detached POSIX groups solely for bounded shutdown, never background work.
Fixed argv disable replacements, optional locks, credentials, hooks, maintenance/gc
and protocols. A constant-only environment has empty PATH/protocol allowlist,
`/dev/null` HOME/global/system config, no inherited auth, proxies, SSH, loader, trace
or alternate-object variables. No checkout/extraction, filters/textconv, hooks,
package managers, submodule/LFS fetch, network or package code/import/activation.

Every contents response is bounded and rehashed as the exact Git object (type, size,
NUL, body); echoed OID alone is not integrity. Raw ASCII framing/modes and binary tree
names are validated without lossy aliases or mode normalization. Selected ancestry
rejects exact/case-fold twins; unrelated siblings are structurally counted but not
followed or inspected as content. Entire selected subtree is enumerated deterministically
before any package blob read. Actual type/size of every blob and aggregate content
bytes pass before reading **any** manifest/content blob, independent of manifest claims.

Only raw `40000` trees and `100644`/`100755` ordinary files are supported. Unsafe paths,
case-fold collisions, symlink/gitlink/special/noncanonical modes and empty child
directories reject, not disappear. Root `orgops-package.json` must be exactly spelled,
ordinary non-executable `100644`; root case variants/directories are unsafe. A root
containing only manifest is valid. Nested manifest basenames remain inventoried content.
Index final entry must also be `100644`, not executable. Binary, `.gitattributes`,
`.gitmodules`, LFS pointers and script bytes remain inert inventory, never dereferenced.
Fatal UTF-8 manifest/index decoding preserves BOM so JSON rejects rather than repairs
it. Existing semantic parser/inspector codes propagate unchanged. Successful index
and package snapshots are detached recursively frozen plain data retaining exact
selected byte previews, not live Buffers or source authority fields.

| `OFFLINE_GIT_LIMITS` field | Fixed per-operation limit |
|---|---:|
| operationMs | 10000 monotonic ms |
| cleanupMs | 250 post-failure/deadline observation ms |
| processes | 2 total, at most 1 live |
| commands | 8192 batch requests |
| stdinBytes | 1048576 cumulative |
| stdoutBytes | 16777216 cumulative (rev-parse separately 32) |
| stderrBytes | 65536 cumulative, never returned/logged |
| headerBytes | 128 per response line |
| commitBytes | 262144 |
| treeBytes | 262144 per occurrence |
| totalTreeBytes | 4194304 |
| treeOccurrences | 2048 (repeated OIDs count per path) |
| treeEntries | 8192 including traversed ancestor siblings |
| treeDepth | 240 components from commit root |
| packageFiles | 257: 256 content blobs plus root manifest |
| packDirectoryEntries | 512 |

CATALOG_LIMITS additionally bound manifest 262144, index 2097152, each content file
1048576 and total content 8388608 bytes (manifest excluded). Repeated blobs count
per inventory entry. Selector and package-relative paths each independently obey
RelativePath limits; their concatenation need not fit 240 characters. Metadata bounds
can reject otherwise format-valid content in wide/deep repositories: LIMIT_EXCEEDED,
never truncation. No cache or budget sharing across calls; aggregate scheduling and
concurrency policy above independent calls remain deferred.

One absolute deadline spans preflight, both children, traversal, decoding and semantic
inspection, with checks around awaits and synchronous work. Timeout/abort/protocol/
integrity/limit/I/O failure suppresses all partial results, stops requests, SIGKILLs
the owned POSIX group, drains/discards pipes and awaits close/cleanup. Normal finish
also requires zero exit and reaping before success. Completed cleanup preserves the
original failure; lifecycle-only failure after valid data yields GIT_FAILED. Inability
to confirm required cleanup within the fixed 250ms allowance returns the sole overriding
GIT_CLEANUP_FAILED, even after another failure. No raw rejected promises for expected
I/O/lifecycle errors. Exactly one issue, no partial value: I/O pointers are fixed
`$`, `repository`, `commit`, `path`, `manifest`, `index`, `entries`, `git`; semantic
issues retain existing bounded pointers. No local paths, stderr, raw exception causes
or authored secret-looking input enter failure objects/logs. Successful previews
intentionally retain selected bytes/commands and may contain sensitive text.

**Do not blindly auto-retry GIT_CLEANUP_FAILED**: OS kill denial/uninterruptible kernel
I/O may prevent reaping; operator/process supervision may be needed (not added here).
Synchronous bounded work, filesystem/kernel scheduling and Git decompression cannot
be preempted precisely: Git may consume CPU/memory before stdout. Finite byte/count/
time budgets are not a single-copy memory guarantee, OS memory sandbox or absolute
liveness guarantee. Digests detect changes; they establish neither publisher trust,
authenticated repository provenance nor safe publication/execution on a malicious host.

### Explicit caller composition example

This example receives an already provisioned trusted handle and literal full commit,
not a live URL or credential. It grants no authority: the future caller must enforce
live administrator authorization, current source/catalog binding and independent
external-package permissions **before** supplying the existing envelopes. An index
claim never acquires external objects or adds a dependency source.

```ts
import { inspectGitPackage, readGitCatalogIndex, resolvePackages,
  type OfflineGitRepository, type ResolveInput } from "@orgops/skills";

async function offlinePreview(
  repository: OfflineGitRepository,
  commit: string, // full lowercase 40/64 hex, objects already supplied locally
  authority: Pick<ResolveInput, "roots" | "allowedSourceIds" | "target" | "installedSkills" | "knownReleases"> & {
    catalogId: string; sourceId: string; enabled: boolean;
  }, // trusted future caller attestations, never inferred from repository or package bytes
) {
  const index = await readGitCatalogIndex({ repository, commit, indexPath: "catalog/index.json" });
  if (!index.ok) return index;
  const pkg = await inspectGitPackage({ repository, commit, path: "packages/echo-skill" });
  if (!pkg.ok) return pkg;
  return resolvePackages({
    roots: authority.roots, allowedSourceIds: authority.allowedSourceIds,
    target: authority.target, installedSkills: authority.installedSkills, knownReleases: authority.knownReleases,
    catalogs: [{ catalogId: authority.catalogId, sourceId: authority.sourceId,
      enabled: authority.enabled, commit, index: index.value }],
    packages: [{ sourceId: authority.sourceId, commit, path: "packages/echo-skill", snapshot: pkg.value }],
  }); // dependencies not explicitly supplied fail; no auto-fetch/enable/register
}
```

This slice does not discharge remote acquisition's live authorization, enabled/
nonremoved immutable source binding, independent allowPackages, canonical repository/
credential routing, Q1 network policy, DNS/IP/rebinding/redirect/proxy/TLS/SSH/helper/
transport limits or stable known-release persistence across lifecycle/ref changes.
No refresh status, installed disk measurement, dependency acquisition, approval,
installation/placement/activation/start, publication/write access or UI is added.

## Version-1 shapes

The following public types are inferred from strict schemas. Strings annotated in
comments use the refinements below; optional is not nullable. Empty required arrays
must be supplied. Author/license/description are attribution, not authenticated provenance.

```ts
export type Compatibility = {
  orgops: { min: string; maxExclusive?: string }; // Version; numeric tuple comparison
  platforms: ("linux" | "darwin" | "win32")[]; // nonempty set
  tools: string[]; // PackageName tokens, requirement presence, not arbitrary shell checks
};
export type SecretRequirement = { name: string; description: string; required: boolean };
export type DependencyPin = {
  catalogId: string; sourceId: string; name: string; version: string;
  revision: { type: "exact"; commit: string } | { type: "same-package-revision" };
  digest: string;
};
export type FileInventoryEntry = { path: string; size: number; digest: string; executable: boolean };
export type ExecutableDeclaration = { path: string; execution: "api-event-shapes" | "runner-script" };
export type PackageMetadata = {
  formatVersion: 1;
  name: string; version: string; description: string; author: string; license: string;
  compatibility: Compatibility; secrets: SecretRequirement[];
};
export type PackageBase = PackageMetadata & {
  dependencies: DependencyPin[];
  files: FileInventoryEntry[];
  executables: ExecutableDeclaration[];
  digest: string;
};
export type SkillManifest = PackageBase & { kind: "skill"; skill: { entrypoint: "SKILL.md" } };
export type NativeTemplate = {
  mode: "CLASSIC" | "RLM_REPL";
  systemInstructions: string; soulContents?: string;
  runtime: {
    llmCallTimeoutMs?: number; classicMaxModelSteps?: number; contextSessionGapMs?: number;
    emitAuditEvents?: boolean;
    memoryContextMode?: "PER_CHANNEL_CROSS_CHANNEL" | "FULL_CHANNEL_EVENTS" | "OFF";
  };
  suggestedModel?: { provider?: string; modelName?: string; temperature?: number; maxTokens?: number };
  alwaysPreloadedSkills: string[]; // names must be a subset of direct skill dependency names
};
export type NativeAgentManifest = PackageBase & { kind: "native-agent"; native: NativeTemplate };
export type PortableCommand = { command: string; args?: string[]; cwd?: string; timeoutMs?: number };
export type PortableWrappedRecipe = {
  kind: string; harness: "command";
  source?: { type: "github"; repo: string; ref?: string; updateOnStart: false };
  setup?: PortableCommand & { checkCommand?: string };
  sidecars: (PortableCommand & {
    name: string; checkCommand?: string; restart?: boolean; restartDelayMs?: number;
  })[];
  runtime: PortableCommand & { parse?: "text" | "json-payloads" };
  session: { scope: "per-channel" | "per-agent" };
  resourceWiring: "none";
};
export type WrappedAgentManifest = PackageBase & { kind: "wrapped-agent"; wrapped: PortableWrappedRecipe };
export type PackageManifest = SkillManifest | NativeAgentManifest | WrappedAgentManifest;
export type CatalogEntry = {
  kind: PackageManifest["kind"]; name: string; version: string; digest: string;
  location: { type: "catalog"; path: string;
    revision: { type: "exact"; commit: string } | { type: "catalog-revision" } }
    | { type: "source"; sourceId: string; commit: string; path: string };
};
export type CatalogIndex = { formatVersion: 1; entries: CatalogEntry[] };
export type ResolvedIdentity = {
  catalogId: string; catalogCommit: string; sourceId: string; packageCommit: string;
  path: string; kind: PackageManifest["kind"]; name: string; version: string; digest: string;
};
export function parsePackageManifest(json: string): ContractResult<PackageManifest>;
export function parseCatalogIndex(json: string): ContractResult<CatalogIndex>;
```

## Primitive and field rules

- PackageName, SourceId and CatalogId: 1–64 ASCII characters, exactly
  `^[a-z0-9]+(?:[._-][a-z0-9]+)*$`. Source handles must be explicitly bound to canonical
  repositories by the instance. Publisher labels neither register nor authorize them.
- Version: exactly three decimal components `MAJOR.MINOR.PATCH`, each 0–999999,
  no leading zero except `0`, no ranges/prerelease/build/tag. Comparisons are numeric
  tuples, min inclusive and maxExclusive exclusive. Commit is lowercase 40/64 hex;
  Digest is `sha256:` followed by 64 lowercase hex.
- RelativePath: 1–240 ASCII characters, slash-separated 1–64-character segments
  `[A-Za-z0-9._-]+`. No empty, `.`, `..`, trailing-dot, slash-ended, backslash, colon,
  percent, spaces or control characters. Reject case-insensitive Windows device
  basenames (CON/PRN/AUX/NUL/COM1–9/LPT1–9, including extensions), `.git`,
  `.orgops-data` and `node_modules` segments. No normalization or repair.
  Case-folded duplicate paths and file/directory-prefix collisions fail.
  Root `orgops-package.json` is reserved, case-insensitively, outside content inventory;
  it cannot be a content directory either (`orgops-package.json/notes.txt` rejects).
  Nested basenames such as `assets/orgops-package.json` remain valid.
  All links and special entries are rejected, including unselected export candidates.
- Description 1–4096, author/license 1–256 nonblank characters; preserve authored text.
  Secrets max 64 unique names `^[A-Z][A-Z0-9_]{0,63}$`, description 1–1024 nonblank,
  required boolean. No secret value, reference, ID or env fields.
- Compatibility platforms form a nonempty unique set of at most 3; tools form a
  unique set of at most 64 PackageName tokens (presence requirements, not shell checks).
- Dependencies max 64, unique `(catalogId,sourceId,name)`. Only skill dependency kinds
  are supported at resolution. Executables max 256 unique paths with inventory matches.
- Native instructions/soul max 65536 characters each (instructions may be empty).
  Positive integer tuning/maxTokens/command timeout/restart delay ≤2147483647;
  emitAuditEvents boolean. Model suggestion nonempty, provider/modelName nonblank
  ≤256 each, temperature finite 0–2. Preloads max 64 unique names, direct dependency
  subset. Strict RLM imports reject classicMaxModelSteps.
- Commands/checkCommand 1–16384 authored characters; args ≤128 strings, each ≤4096,
  preserved in order. cwd only `.` or RelativePath and cannot begin `.orgops-data`.
  No command env. Sidecars max 16 unique names, preserved in execution order;
  setup must have command (check-only unsupported).
- Wrapped source repo exactly `owner/repo`, each ASCII `[A-Za-z0-9_.-]+` segment
  1–100 and neither `.` nor `..`; not a URL/path/credential. Optional ref 1–128,
  `[A-Za-z0-9][A-Za-z0-9._/-]*`, no `..`, `//`, trailing slash/dot or `.lock` segment
  suffix. updateOnStart must be false. **ref is an external-runtime hint**, not a
  verified immutable checkout: the current harness uses `git clone --branch`.
- Catalog `(name,version)` pairs are unique across kinds/locations; distinct releases
  cannot share the same source/commit-context/path. Locations require a repository
  directory, not `.`. Index contains no catalog ID, URL or credential.

### Fixed bounds

All byte sizes below are UTF-8 serialized JSON or decoded file sizes as labeled.

| `CATALOG_LIMITS` field | Limit |
|---|---:|
| manifestJsonBytes (also raw agent export JSON) | 262144 |
| indexJsonBytes | 2097152 |
| contentEntries | 256 |
| fileBytes | 1048576 |
| totalContentBytes | 8388608 |
| indexEntries | 4096 |
| dependencies | 64 |
| resolvedPackages | 256 |
| recursionDepth (root depth 0) | 64 |
| suppliedCatalogs | 32 |
| suppliedPackages | 4096 |
| installedSkills | 4096 |
| contentJsonBytes (entire entry collection) | 12582912 |
| exportOptionsJsonBytes | 262144 |
| resolverJsonBytes (all envelopes/manifests/previews/base64) | 67108864 |
| resolverContentBytes (all supplied decoded content) | 33554432 |
| jsonDepth | 32 |

Resolver roots: 1–64 unique `(catalogId,name,version)`; knownReleases ≤4096;
allowedSourceIds unique ≤128; target tools unique ≤64. Aggregate limits apply even
to unused or denied inputs. Counts are not substitutes for byte budgets.

## Content, digest and execution preview

```ts
export type ContentEntry =
  | { type: "file"; path: string; base64: string; executable: boolean }
  | { type: "symlink"; path: string; target: string }
  | { type: "hardlink"; path: string; target: string }
  | { type: "special"; path: string; specialType: "directory" | "device" | "fifo" | "socket" };
export type InspectedFile = { path: string; base64: string; executable: boolean; size: number; digest: string };
export type ExecutionPreview = {
  apiEventShapes: string[];
  runnerScripts: string[];
  wrappedCommands: { at: string; command: string; args: string[] }[];
  externalSources: { type: "github"; repo: string; ref?: string }[];
};
export type PackageSnapshot = {
  manifest: PackageManifest;
  files: readonly InspectedFile[];
  execution: ExecutionPreview;
  warnings: readonly ReviewWarning[];
};
export function computePackageDigest(manifest: unknown, entries: readonly ContentEntry[]): ContractResult<string>;
export function inspectPackage(manifest: unknown, entries: readonly ContentEntry[]): ContractResult<PackageSnapshot>;
export function parseSkillDocument(text: string, expectedName: string): ContractResult<{
  name: string; description: string; license?: string;
}>;
```

Base64 is canonical padded RFC4648 ASCII (empty allowed). Decoded lengths are
bounded before decoding; re-encoding must match exactly. Inventory paths, lengths,
SHA-256 hashes and executable booleans must exactly match actual supplied bytes.
Successful snapshots/resolutions/export candidates are detached recursively frozen
plain data with no retained Buffer or input-object references.

File digest: SHA-256 of exact decoded bytes, formatted as Digest. Root digest:
SHA-256 of UTF-8 `orgops-package-v1\n` plus canonical JSON of the validated full
manifest **excluding only its top-level digest**. Inventory hashes cover content;
metadata, compatibility, dependencies, secrets requirements, executable flags,
instructions and every command are covered. Provenance commits/source envelopes,
timestamps, ownership and disk modes other than executable boolean are not injected.

Canonical JSON sorts all object keys by code-unit order, uses JSON.stringify scalar
spellings and no whitespace. Set arrays sort: files/executables by path; dependencies
by `(catalogId,sourceId,name)`; secrets by name; platforms/tools/preloads lexically.
Duplicates fail before sorting. Sidecar and command args order is semantic and is
**not sorted**. Authored strings are not trimmed. `computePackageDigest` validates
structure/content but ignores equality with the syntactically valid supplied digest;
`inspectPackage` additionally requires equality. A zero digest can seal a draft but
is not an import bypass. Export serializes the same normalized manifest including its
computed digest with sorted keys, two-space indentation and one final newline.
Those manifest-file bytes are not hashed recursively.

SKILL.md is fatal-decoded UTF-8, beginning with `---` and newline at byte zero,
closing delimiter on its own line. Frontmatter-only skills are valid. YAML is inert:
unique mapping keys, no errors, custom tags, aliases or anchors. Name/description are
nonblank strings matching manifest; optional license must match. Other frontmatter
remains inert data. No active `loadSkillMeta` or event-shape importer is called.

Execution previews identify exact root `event-shapes.ts/js` as **API process
execution**, even without executable bits. Case variants reject. Other files with
executable bit, leading shebang, or suffix `.ts,.js,.mjs,.cjs,.sh,.bash,.zsh,.py,.rb,
.ps1,.cmd,.bat,.exe,.com,.wasm` (case-insensitive) require runner-script declaration.
API declarations only apply to exact root API filenames. Additional declared scripts
are disclosed. Unknown interpretable files can evade this heuristic.

Wrapped preview includes setup, setup check, each sidecar and sidecar check, then
runtime commands with their args. **Check commands inherit owning setup/sidecar
args** because the harness replaces only command. External repo/ref is separate.
Every wrapped recipe warns EXTERNAL_RUNTIME_NOT_PINNED, including source-free ones.
Commands are arbitrary privileged host code; hashing a recipe cannot pin external
installers transitively. Wrapped native filesystem restrictions do not apply.

Every snapshot has MANUAL_REVIEW_REQUIRED. SENSITIVE_TEXT warns once per field/path
for authored strings and fatal-decodable UTF-8 files matching token prefixes
`gh[pousr]_` (20+ alphanumeric), `github_pat_` (20+ alphanumeric/underscore), `sk-`
(16+ alphanumeric/underscore/hyphen), private-key headers, or case-insensitive
`(password|token|secret|api[_-]?key)\s*[:=]\s*\S+`. Warnings include only pointers,
never matched snippets. Binary/non-UTF8 files retain full byte previews but are not
claimed to be secret-scanned. Warnings supplement human review, not safe-publication
certification or automatic approval. Intentionally shared prompts may contain secrets.

## Exact resolution and history

```ts
export type CatalogSnapshot = {
  catalogId: string; sourceId: string; commit: string; enabled: boolean;
  index: CatalogIndex;
};
export type SuppliedPackage = {
  sourceId: string; commit: string; path: string; snapshot: PackageSnapshot;
};
export type InstalledSkill = { name: string; identity: ResolvedIdentity | null; currentDigest: string };
export type ResolveInput = {
  roots: { catalogId: string; name: string; version: string }[];
  catalogs: readonly CatalogSnapshot[];
  packages: readonly SuppliedPackage[];
  allowedSourceIds: readonly string[];
  target: { orgopsVersion: string; platform: "linux" | "darwin" | "win32"; tools: string[] };
  installedSkills: readonly InstalledSkill[];
  knownReleases: readonly ResolvedIdentity[];
};
export type ResolvedPackage = { identity: ResolvedIdentity; snapshot: PackageSnapshot; action: "include" | "reuse" };
export type Resolution = { packages: readonly ResolvedPackage[] }; // dependencies first, roots last
export function resolvePackages(input: ResolveInput): ContractResult<Resolution>;
```

Caller envelopes supply repository identity and source permission; package authors,
catalog labels and suggested models supply no authority. Require configured enabled
catalog plus permission for its source, and independently for any external package
source. No source registration, credential forwarding, semver fallback, fetch, update
or upstream overwrite. Caller must prevent source-handle aliasing/rebinding.

`location.type="catalog"` uses the supplied catalog repository. `catalog-revision`
resolves to its supplied commit, avoiding circular Git hashes for a coherent new
release. `exact` is literal historical commit, never fallback. External locations use
configured sourceId and literal commit. All returned identities contain literal commits.

**On index edit B, freeze every existing contextual release introduced at A to
`{type:"exact",commit:A}`**, preserving name/version/kind/path/digest. Only new releases
at B use catalog-revision. Consumers can then retain packageCommit A while reporting
catalogCommit B. Leaving the old entry contextual repoints it to B; supplied known
identities cause IDENTITY_CONFLICT even if bytes match. The resolver does not edit
indexes or detect history not supplied by its caller. `preparePublication` now
constructs the frozen proposed index using explicit complete retained evidence.

Dependency `same-package-revision` refers to the declaring package source and commit,
not the current catalog commit; dependency sourceId must equal the declaring sourceId.
A new B package depending on an old frozen A skill must use exact A. Each dependency's
version/digest is exact and covered by the declaring package digest.

Logical release identity `(catalogId,sourceId,name,version)` is immutable when known;
content fields add packageCommit/path/digest/kind. catalogCommit is separate provenance.
The resolver reinspects selected supplied bytes rather than trusting snapshot previews.
It rejects duplicate envelopes/identities, missing releases, source denial, pin mismatch,
unsupported wiring/kinds, and incompatible declared numeric version/platform/tools.
This does not measure real host tool availability or model capability.

Bounded iterative graph assembly precedes one cycle/depth/order traversal with completed
subtree heights (long diamond paths cannot bypass depth limits). Roots sort by
`(catalogId,name,version)`, dependencies by `(catalogId,sourceId,name)` in code-unit
order. Result is dependencies-first, deduped by immutable identity, with no partial plan.

All installed skills and the entire closure share one runtime name namespace. Different
pins/sources/versions under one name conflict, even across catalogs. Reuse requires all
identity fields except catalogCommit to match **and caller-measured currentDigest** to
equal requested digest. Untracked or edited skills conflict; there is no side-by-side
version/overwrite/upgrade. currentDigest is a caller assertion, not proof the library
inspected installed disk. Future adapters must measure disk and preserve origin.

## Explicit export

```ts
export type AgentExportOptions = {
  metadata: PackageMetadata;
  dependencies: DependencyPin[];
  suggestedModel?: NativeTemplate["suggestedModel"];
};
export type SkillExportOptions = {
  metadata: PackageMetadata;
  dependencies: DependencyPin[];
  executables: ExecutableDeclaration[];
  selectedPaths: string[];
};
export type ExportCandidate = {
  snapshot: PackageSnapshot;
  // complete proposed files; orgops-package.json plus content, sorted by path
  proposedFiles: readonly { path: string; base64: string; executable: boolean }[];
};
export function exportAgentPackage(raw: unknown, options: AgentExportOptions): ContractResult<ExportCandidate>;
export function exportSkillPackage(entries: readonly ContentEntry[], options: SkillExportOptions): ContractResult<ExportCandidate>;
```

Agent input is camelCase API-shaped JSON (list/get `routes/agents.ts`), not a DB row.
Mode is required, exact and never defaulted. Snake-case/ambiguous dual spellings fail.
Metadata and exact pins come solely from explicit author options. Unknown local-state
keys are ignored via positive selection, never row spreading or omission-based copying.
Model/runner/agent IDs, icon, row name/description, host workspace/soul paths, memberships,
lifecycle/history/memory/events, local secrets/PATs and allowOutsideWorkspace are absent.

Native selection: mode, required systemInstructions, optional soulContents, nullable
runtime tuning (null means omit), and preloads (missing means []). enabledSkills is
checked as a unique name array, with a one-to-one match to explicit dependency pins;
names are never auto-resolved. Preloads must be a subset. SuggestedModel comes only
from options, never modelId/defaults. RLM raw export omits dormant classicMaxModelSteps
regardless of its JSON value **without mutating the source row**; strict RLM imports
still reject that field.

Wrapped selection requires an object wrappedConfig, not serialized JSON. Only
kind/harness/source/setup/sidecars/runtime/session keys are accepted. Commands and
nested structures are rebuilt explicitly and strictly validated; unknown fields,
env, local source.path, nonportable cwd, updateOnStart:true, transport or unsupported
harness fail rather than silently losing executable behavior. Only equivalent defaults
normalize: kind absent → custom; harness absent/cli → command; sidecars absent → [];
session/scope absent → per-channel; source.updateOnStart absent → false. No fabricated
timeouts. Native instructions/soul/tuning/memory are ignored in wrapped mode because
the harness does not consume them. They are **not** portrayed as injected resources.

The Phase-2 wrapped subset is resourceWiring:none, with no packaged files/executables,
dependencies, enabled/preloaded native skills or model suggestions. Unsupported wiring
fails UNSUPPORTED_WIRING. This is **not a permanent full-v1 exclusion of wrapped
resources**: a subsequent explicitly supported format/adapter must define positive
wiring before such resources can be shared. Env values never become requirements
implicitly; portable secrets are explicit options declarations only.

Skill export validates the entire provided staged collection, including unselected
entries, before selection. selectedPaths is required/nonempty/unique/safe, must exist,
and include exact root SKILL.md. There is no default-all or directory walker. Inventory
is computed from selected bytes. Executable declarations for omitted files fail.
Selected basenames `.env`, `.env.*`, `.agent-runner-id`, `.orgops-runner-id`, `.npmrc`,
`.netrc`, `id_rsa`, `id_ed25519`, `credentials.json`, and any `.ssh`, `.aws`, `.config`
segment are rejected case-insensitively. This denylist is supplementary, not exhaustive.

Both exporters seal through computePackageDigest then inspectPackage. proposedFiles
contains the complete normalized orgops-package.json and exactly selected content,
sorted by path, all byte-identical content as base64. It is a full candidate preview,
not a diff against a destination, remote operation, approval or publication result.

Future disk/archive adapters must distinguish lstat kinds without following links,
bound streaming bytes/counts, safely stage stable copies outside active discovery and
reinspect after changes. The typed memory collection does not secure actual traversal,
archive extraction, TOCTOU, placement, installed edits or activation.

## Inert complete examples

[skill.json](examples/catalogs/skill.json),
[native-classic.json](examples/catalogs/native-classic.json),
[native-rlm.json](examples/catalogs/native-rlm.json),
[wrapped.json](examples/catalogs/wrapped.json), and
[index.json](examples/catalogs/index.json) are complete manifests/index with independently
computed digest constants. Tests parse **and inspect** them using the exact bytes below.
The synthetic commit `1111111111111111111111111111111111111111` is only caller provenance;
it is never fetched. JSON files are package-format examples, not runnable installation recipes.

Exact decoded `SKILL.md` (102 UTF-8 bytes, including final newline):

```markdown
---
name: echo-skill
description: Echo instructions.
license: MIT
---
Return a short acknowledgement.
```

Exact decoded `event-shapes.ts` (48 UTF-8 bytes, including final newline; **never import**):

```ts
throw new Error("catalog inspection executed");
```

In-memory usage: `skillJson` below is the text of the linked skill.json supplied by the
caller, not a library filesystem read. These two strings exactly reproduce its bytes.

```ts
import { parsePackageManifest } from "@orgops/schemas";
import { inspectPackage, exportSkillPackage, type ContentEntry } from "@orgops/skills";

function previewSkill(skillJson: string) {
  const parsed = parsePackageManifest(skillJson);
  if (!parsed.ok) return parsed;
  const entries: ContentEntry[] = [
    { type: "file", path: "SKILL.md", executable: false,
      base64: Buffer.from("---\nname: echo-skill\ndescription: Echo instructions.\nlicense: MIT\n---\nReturn a short acknowledgement.\n").toString("base64") },
    { type: "file", path: "event-shapes.ts", executable: false,
      base64: Buffer.from('throw new Error("catalog inspection executed");\n').toString("base64") },
  ];
  const inspected = inspectPackage(parsed.value, entries);
  if (!inspected.ok) return inspected;
  const m = inspected.value.manifest;
  return exportSkillPackage(entries, {
    metadata: { formatVersion: m.formatVersion, name: m.name, version: m.version,
      description: m.description, author: m.author, license: m.license,
      compatibility: m.compatibility, secrets: m.secrets },
    dependencies: m.dependencies, executables: m.executables,
    selectedPaths: ["SKILL.md", "event-shapes.ts"],
  }); // review snapshot.warnings, snapshot.execution, and ALL proposedFiles; no writes
}
```

## Offline publication preparation

`preparePublication` is synchronous and performs no filesystem, DB, network or
process I/O, active discovery, credential retrieval or package execution. It prepares
one bounded inert package-and-index proposal against one explicitly selected exact
repository base. It does not publish, approve, activate or grant write permission.
Phase-6 task tests cover this pure subset; task/whole-phase review and fresh parent
acceptance are separate gates, not claimed by this document.

The root exports only `preparePublication`, frozen `PUBLICATION_LIMITS` and the named
Publication types below. Composition, scanning, canonical JSON and temporary resolver
context helpers remain private direct-module seams. Existing exporter, inspection
and resolver signatures/semantics are unchanged.

### Exact publication signatures

Existing GitRepository, ResolvedIdentity, CatalogIndex and ContractIssue come from
`@orgops/schemas`; ExportCandidate, PackageSnapshot, CatalogSnapshot, SuppliedPackage
and ResolveInput are the existing skills types above. No credentials/callbacks/local
paths or publisher actor fields are accepted.

```ts
export type PublicationTreeEntry = {
    type: "directory";
    path: string;
} | {
    type: "file";
    path: string;
    size: number;
    digest: string;
    executable: boolean;
} | {
    type: "blocked";
    path: string;
}; // symlink/gitlink/special; never followed or written
export type PublicationBase = {
    catalogId: string;
    sourceId: string;
    repository: GitRepository;
    enabled: boolean;
    commit: string;
    indexPath: string;
    indexBase64: string | null;
    inventory: {
        complete: true;
        entries: readonly PublicationTreeEntry[];
    };
    history: {
        complete: true;
        releases: readonly ResolvedIdentity[];
    };
};
export type PublicationSource = {
    sourceId: string;
    repository: GitRepository;
    enabled: boolean;
    allowPackages: boolean;
};
export type PublicationSelection = {
    destinationPath: string;
    candidate: ExportCandidate;
    intent: "new-release" | "update" | "new-destination";
    origin: ResolvedIdentity | null;
};
export type PublicationInput = {
    base: PublicationBase;
    selections: readonly PublicationSelection[];
    sources: readonly PublicationSource[];
    catalogs: readonly CatalogSnapshot[]; // dependency catalogs only; excludes base.catalogId
    packages: readonly SuppliedPackage[]; // existing immutable package evidence only
    knownReleases: readonly ResolvedIdentity[]; // other catalogs; excludes base.catalogId
    target: ResolveInput["target"];
};
export type PublicationIssue = {
    code: ContractIssue["code"] | "INVALID_PUBLICATION_INPUT" | "BASE_EVIDENCE_REQUIRED" | "BASE_CONFLICT" | "DESTINATION_CONFLICT" | "ORIGIN_CONFLICT";
    at: string;
};
export type PublicationResult<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    issues: PublicationIssue[];
};
export type PublicationBytes = {
    base64: string;
    size: number;
    digest: string;
    executable: boolean;
};
export type PublicationChange = {
    path: string;
    before: PublicationBytes | null;
    after: PublicationBytes;
    review: {
        before: "utf8" | "binary" | "absent";
        after: "utf8" | "binary";
    };
};
export type PublicationPreconditions = {
    repository: GitRepository;
    sourceId: string;
    catalogId: string;
    catalogEnabled: true;
    baseCommit: string;
    indexPath: string;
    oldIndex: PublicationBytes | null;
    inventory: PublicationBase["inventory"];
    history: PublicationBase["history"];
    sources: readonly PublicationSource[];
    target: ResolveInput["target"];
    dependencyCatalogs: readonly CatalogSnapshot[];
    knownReleases: readonly ResolvedIdentity[]; // other-catalog retained evidence
    requiredAbsentPaths: readonly string[]; // new package roots and absent index
    preservedReleases: readonly ResolvedIdentity[]; // all base entries expanded at base commit
};
export type PublicationRevision = {
    type: "exact";
    commit: string;
} | {
    type: "proposal";
};
export type PublicationIdentity = Omit<ResolvedIdentity, "catalogCommit" | "packageCommit"> & {
    catalogRevision: PublicationRevision;
    packageRevision: PublicationRevision;
};
export type PublicationRelease = {
    identity: PublicationIdentity;
    snapshot: PackageSnapshot;
    disposition: "new" | "existing";
};
export type PublicationFinding = {
    ruleId: "TOKEN_PREFIX" | "PRIVATE_KEY_HEADER" | "CREDENTIAL_ASSIGNMENT";
    severity: "warning";
    path: string;
    side: "before" | "after";
    line: number;
    column: number; // 1-based Unicode-code-point location of first match
};
export type PublicationProposal = {
    kind: "offline-publication-proposal";
    preconditions: PublicationPreconditions;
    selections: readonly {
        destinationPath: string;
        intent: PublicationSelection["intent"];
        origin: ResolvedIdentity | null;
        name: string;
        version: string;
        disposition: "new" | "existing";
    }[];
    proposedIndex: CatalogIndex;
    changes: readonly PublicationChange[];
    releases: readonly PublicationRelease[]; // dependency-first complete selected closure
    findings: readonly PublicationFinding[];
    reviewRequired: true;
    scan: {
        kind: "supplementary";
        version: 1;
        binaryFiles: readonly {
            path: string;
            side: "before" | "after";
        }[];
    };
    proposalDigest: string;
};
export function preparePublication(input: PublicationInput): PublicationResult<PublicationProposal>;
```

### Evidence, placement and immutable identity

Base/inventory/history completeness, enabled flags, independent source-to-repository
bindings, existing commit/path envelopes and known origins are **trusted caller
evidence**, never author self-assertions or authenticated capabilities. False
`complete:true` is outside the contract; missing/false completeness, inconsistent
index bytes/tree metadata/history or source binding fails with one redacted issue,
no partial proposal. Own-data descriptor/JSON budgets precede counts and encoded-byte
preflight, then shapes, canonical decoding, hashing and semantic work. The bounded
old-index decode/fatal UTF8/JSON syntax parse obtains otherwise unknowable entry
counts before hashing/semantic validation or candidate work. Native OOM and malicious
JS Proxies are outside the resource guarantee; this is not a sandbox.

Canonical repository identity is the existing GitRepositorySchema result serialized
as `[url, sshUser ?? null]`. Source IDs are unique; different IDs cannot alias one
canonical repository. The base source must exist, match, and be enabled; independently
base.enabled must be true before candidate/closure work. Base allowPackages need not
be true for its catalog-owned releases. Every reached external source location and
cross-source pin independently requires enabled allowPackages:true, even for a
source owning an enabled catalog. Unused denied index entries require no package evidence and gain no permission;
byte envelopes that the caller does supply still undergo bounded validation.
Supplied dependency catalogs exclude the base catalog. No new source,
permission, credential routing, ownership or version substitution is inferred.

Inventory enumerates the whole bounded repository, not a manifest files list. Paths
including joined destination file paths obey RelativePath (ASCII, <=240), with exact
explicit ancestor directories, no duplicates/case twins or file/blocked ancestors.
Blocked entries represent links/gitlinks/special files and are never followed. Empty
unrelated directories are representable but occupied. Nonportable/oversized complete
repositories fail; they are not silently represented as partial evidence.

The selected existing index is an ordinary nonexecutable file with exact byte size,
hash and mode matching inventory. Preserve exact lexical before bytes including
whitespace; decode UTF8 fatally without removing BOM. Null old bytes require proven
exact/casefold absence and no ancestor/descendant collision. New index bytes are
key-sorted, two-space JSON plus LF, and are parsed/validated on their actual serialized
bytes. No index change is emitted when byte-identical.

Every old contextual release freezes to its owning base commit, including unrelated
releases; exact/external entries remain unchanged. Historical manifests and pins are
never rewritten or required to match today's target. Complete retained history must
survive disable/remove/restore/ref changes. Logical release identities remain
immutable, even when absent from the current index; a changed digest/location/content
requires a new version. A partial current index cannot prove prior nonpublication.

New releases require explicitly selected absent, pairwise-disjoint roots outside the
selected index and **all** recorded base-owned package regions (including historical
and explicit-source locations). The index also cannot overlap those regions. Only
the selected index may replace a file. No package deletion, rename/move, overwrite of
occupied/unindexed trees or second repository/index update is supported. Exact reuse
requires the same catalog-owned destination and immutable identity, equivalent supplied
snapshot and full current subtree byte/hash/size/mode equality, with no extra blocked,
file or empty child entries. Reuse emits no package changes and retains its old exact
revision; an absent historical tree cannot be rematerialized through reuse.

`new-release` requires null origin; `update` requires recorded identical origin and
the same `(catalogId,sourceId,name)` namespace. `new-destination` requires recorded
nonnull origin in a different namespace, including explicit package-name changes.
It creates a separate release in an absent directory and leaves old identity/files
intact, asserting no ownership transfer. No monotonic-semver policy is inferred.

All selections are reinspected and re-exported through positive allowlists; supplied
proposedFiles must match exactly, not act as arbitrary patches. Native auxiliary
files and wrapped resource wiring remain excluded. Supplied execution/warning
previews are regenerated. All selected roots resolve together, installedSkills empty,
using the existing resolver's exact pins, compatibility, dependency-kind, cycles,
depth and global skill-name-conflict checks. Identical overlapping known identities
merge; conflicts fail. Dependencies must be supplied immutable releases or coherent
new releases in this same proposal. New-to-new pins are authored exact-version/digest
same-package-revision pins; new-to-old pins must already name exact old commits.
Pins/digests are never rewritten. A bounded private collision-free temporary context
bridges resolution only; returned new identity revisions say `{type:"proposal"}` and
old revisions `{type:"exact",commit}`. No fictitious published commit is introduced;
authored strings that happen to look like context commits are preserved.

### Fixed publication bounds and deterministic review

| PUBLICATION_LIMITS field | Fixed maximum |
|---|---:|
| inputJsonBytes (all repeated envelope/previews/base64) | 67108864 |
| selections (minimum 1) | 64 |
| treeEntries (directories/blocked leaves included) | 8192 |
| sources | 128 |
| catalogs (dependency catalogs; base adds one) | 31 |
| suppliedPackages | 4032 |
| knownReleases (base history + other known) | 4096 |
| totalIndexEntries (base + dependencies; final too) | 8192 |
| aggregateFiles (all candidate files/proposed files/snapshot files/old index occurrences) | 8192 |
| decodedBytes (same occurrences, including duplicates) | 33554432 |
| outputFiles (changed files) | 4096 |
| outputBytes (exact before + after occurrences) | 33554432 |
| findings | 4096 |

All CATALOG_LIMITS still apply, including actual pretty-serialized manifest/index
sizes. Unused/denied inputs count. No budget is caller-raisable, no truncated files,
previews or findings are returned. The output byte cap is defense in depth under the
current tighter combined input/manifest/index limits; widening those requires
rechecking aggregate reachability, not removing the output guard.

Inventories/changes sort by code-unit path; index entries by name/version; selections
by name/version/destinationPath; sources/catalogs/history by explicit identity tuples.
Dependencies keep resolver canonical order. Authored text, command args and sidecar
order remain unchanged. Success is detached recursively frozen plain data, with no
caller objects or Buffers retained/frozen.

Every changed before/after side exposes exact base64, size, SHA256 and executable bit.
Fatal UTF8 classification marks binary explicitly, never repairs it. Scanning starts
only after complete byte/budget validation, on full changed file bytes including
serialized prompts, soul, metadata/secret descriptions and wrapped commands/args.
Unchanged snapshots retain complete bytes and existing inspector warnings.

Fixed internal case-insensitive rules mirror inspector heuristics: TOKEN_PREFIX
(`gh[pousr]_` +20 alphanumerics, `github_pat_` +20 alphanumeric/underscore,
`sk-` +16 alphanumeric/underscore/hyphen); PRIVATE_KEY_HEADER (unqualified/RSA/EC/
OPENSSH forms); CREDENTIAL_ASSIGNMENT (`password|token|secret|api[_-]?key`, optional
whitespace, colon/equal, optional whitespace, nonspace value). At most the first
match per rule/file side; findings sort by path/side/ruleId. Locations are 1-based,
LF-delimited lines and Unicode-code-point columns in the original text. Findings
contain only the six documented fields, no values/excerpts/freeform messages.
Binary sides are explicitly listed as unscanned, sorted by path/side. Zero matches
still yields reviewRequired:true and supplementary version 1. Neither findings nor
absence of findings grants/denies later submission or claims safe publication.
There is no arbitrary regex, provider check, rewriting/redaction or scan override.
Full review artifacts intentionally may contain authored sensitive bytes: do not log
them. Redaction applies to diagnostic/scan metadata, not required review content.

`proposalDigest` is `sha256:` plus lowercase hex SHA256 of UTF8
`"orgops-publication-proposal-v1\n" + canonicalJson(proposalWithoutDigest)`.
It binds the entire normalized detached result: before/after bytes, exact base/index/
inventory/history/policy, target, origins, proposed index, full closure/execution,
findings and scan version. It is a deterministic data checksum, not authentication,
authority or approval. No ready/approved/write-token fields exist.

### Complete tiny synthetic in-memory example

This uses the echo fixture's exact SKILL.md and metadata, with an explicitly absent
index and empty complete repository/history. These synthetic assertions are useful
for tests only; do not assert emptiness about a real repository without trusted
complete evidence. Nothing is read, written, fetched or executed.

```ts
import { exportSkillPackage, preparePublication, type PublicationInput } from "@orgops/skills";

const text = "---\nname: echo-skill\ndescription: Echo instructions.\nlicense: MIT\n---\nReturn a short acknowledgement.\n";
const candidate = exportSkillPackage([
  { type: "file", path: "SKILL.md", base64: Buffer.from(text).toString("base64"), executable: false },
], {
  metadata: { formatVersion: 1, name: "echo-skill", version: "1.0.0",
    description: "Echo instructions.", author: "Example", license: "MIT",
    compatibility: { orgops: { min: "0.0.1" }, platforms: ["linux"], tools: [] }, secrets: [] },
  dependencies: [], executables: [], selectedPaths: ["SKILL.md"],
});
if (candidate.ok) {
  const repository = { url: "https://example.invalid/team/catalog.git" };
  const input: PublicationInput = {
    base: { catalogId: "team", sourceId: "team-source", repository, enabled: true,
      commit: "1111111111111111111111111111111111111111", indexPath: "catalog/index.json",
      indexBase64: null, inventory: { complete: true, entries: [] },
      history: { complete: true, releases: [] } },
    selections: [{ destinationPath: "packages/echo-skill/1.0.0", candidate: candidate.value,
      intent: "new-release", origin: null }],
    sources: [{ sourceId: "team-source", repository, enabled: true, allowPackages: false }],
    catalogs: [], packages: [], knownReleases: [],
    target: { orgopsVersion: "0.0.1", platform: "linux", tools: [] },
  };
  const result = preparePublication(input);
  // On success review ALL changes, releases/execution, preconditions and findings.
  // Result is inert, not a submission/write capability. Do not log file previews.
}
```

`readGitPublicationEvidence` supplies only bounded immutable tree/exact-index evidence
from trusted provisioned local bare storage. The older selected inspection adapters
discard lexical index bytes and do not enumerate the entire repository. Configuration/
bindings, retained history and live authority remain independently caller-owned.
A later trusted publisher must acquire those independent assertions and revalidate
base revision/index bytes/digests/modes, occupied/
absent paths, source binding/policy and live human/destination write authority before
confirmation/write. Changed evidence needs a new proposal, never implicit rebase.
Live evidence acquisition/persistence, authority revalidation, GitHub branch/PR submission,
confirmation, uncertain-result retry reconciliation, remote transport and two-instance
acceptance remain unimplemented. Q1 network policy and Q2 mobile follow-up remain
unchanged. No publication permission or new approval/override policy is supplied.

### Offline Git publication tree evidence

The explicit public `@orgops/skills` API is:

```ts
export type GitPublicationEvidenceInput = GitIndexInput;
export type GitPublicationEvidence = {
  commit: string;
  indexPath: string;
  inventory: PublicationBase["inventory"];
  indexBase64: string | null;
};
export const OFFLINE_GIT_EVIDENCE_LIMITS = Object.freeze({
  fileBytes: 1048576,
  indexBytes: 2097152,
  decodedBytes: 8388608,
  outputJsonBytes: 8388608,
} as const);
export function readGitPublicationEvidence(
  input: GitPublicationEvidenceInput, options?: GitInspectionOptions,
): Promise<OfflineGitResult<GitPublicationEvidence>>;
```

Input is exactly `{ repository: { directory, gitExecutable }, commit, indexPath }`:
trusted absolute installed Git executable and provisioned local bare storage, one
full lowercase SHA1/SHA256 commit, explicit portable index path. Own-data fields are
snapshotted before the first await; no refs/URLs, default path, callbacks, caller-raised
budgets, transport, checkout, hooks, filters, helpers, package execution or writes.
Existing fixed argv/environment, byte-exact bare configuration and POSIX linux/darwin
trusted stable host/storage requirements apply. This is not a malicious-root/TOCTOU
sandbox or a promise of exact kernel/decompression preemption.

This adapter accepts only complete bounded **ordinary-file/tree-only** repositories.
Every root-relative ASCII path (including joined ancestors) must be portable: segments
at most 64 bytes, full paths at most 240 characters, no duplicate/casefold siblings.
All directory ancestors and empty child directories are explicit occupied entries;
root itself is not an entry. Only raw `40000`, `100644`, `100755` modes are supported.
Any symlink, gitlink or other special/noncanonical mode fails, even unrelated to the
index; no target is followed or read. This conservative subset does not change
Phase-6 blocked entries or the older selected package reader's empty-child rejection.
The older `readGitCatalogIndex` remains a semantic selected-index parser, not this
exact-byte operation; selected readers retain their unrelated-sibling scope rules.

Traversal and exact/casefold index placement finish before ordinary bodies. Every
ordinary file's metadata is preflighted before any ordinary body; the selected exact
nonexecutable index alone gets 2MiB, other files 1MiB, all occurrences together 8MiB.
Size and `sha256:` digest cover actual raw file bodies, NOT Git OIDs or manifest
claims. Existing algorithm-aware Git-framed body integrity independently verifies
every commit/tree/blob. Inventory is sorted and contains file size/digest/executable
and explicit directory entries, never body previews except the selected index.
Index bytes remain exact base64 including lexical whitespace, CRLF, BOM, empty bytes
(`""`), NUL and invalid UTF8. `null` means complete traversal proved absence with no
case alias, occupied final directory, non-directory ancestor or special entry.
Successful evidence means byte/tree consistency, NOT semantic index validity:
binary/BOM/empty/malformed/invalid JSON still fails unchanged `preparePublication`.

There is no cache: repeated OIDs are reread and charged for each path occurrence.
Unchanged shared ceilings include 10000ms work deadline, 250ms cleanup observation,
two sequential children, 8192 batch requests, stdin 1048576/stdout 16777216/stderr 65536
bytes, header 128, rev-parse output 32, commit 262144, each tree 262144, total trees 4194304,
tree occurrences 2048, entries 8192, depth 240 and pack directory entries 512. Provisioning
remains at most 32 fixed filesystem calls plus 513 iterator yields. Success requires
`2 * (1 commit + tree occurrences + ordinary file occurrences)` requests: a root
with 4094 ordinary leaves reaches 8192; 4095 fails, even with identical blob OIDs.
Whole root-relative path bounds can bind before depth; counts are ceilings, not a
promise all combinations fit. Complete compact UTF8 JSON of the four-field value,
including punctuation and index base64, is bounded to 8MiB with incremental exact
accounting and a final serialization check. Stronger entry/path/index bounds make
that ceiling defense in depth; bounded allocations are not a single-copy heap bound.

No partial inventory escapes. Success is selected only after awaited finish/dispose
confirms cleanup, then nested plain values are detached/frozen with final abort/deadline
checks. `GIT_CLEANUP_FAILED` is the sole terminal issue for unconfirmed cleanup and
overrides success/abort/timeout/protocol/integrity errors; confirmed cleanup preserves
the original redacted issue. This guarantees no success with unconfirmed close, not
that OS kill/reap can never fail. No authored bytes or local paths are logged.

The four output fields contain no source/catalog IDs, bindings, enabled state, origin
authentication, retained history, approval or publication authority. No permissions,
dependency sources or `history.complete` assertions are inferred. Phase 7 implements
this bounded offline adapter and composition tests; all task/whole-phase reviews and
fresh parent verification are complete (1681 Vitest tests, 3 opscli tests; unchanged
488 baseline TypeScript diagnostics across twelve independently checked workspaces).
Live acquisition, retained-history persistence,
authority revalidation, installation, confirmation/publishing and two-instance
acceptance are not implemented by it; Q1/Q2 remain unchanged.

### Synthetic Git-to-publication composition

This executable repository-root TypeScript example uses **only owned test fixtures**.
Save it with an `.mts` extension when running with `node --import tsx` so its top-level
await uses ESM rather than the root package's default CommonJS mode.
The candidate uses the public allowlisted `exportSkillPackage`; it does not read
an instance. The explicit enabled configuration and empty complete history below are
known assertions about this newly constructed synthetic repository, NEVER a template
for fabricating live `complete:true` history. The fixture's commit writes are test
setup only; the evidence reader and pure preparation perform no writes.

```ts
import assert from "node:assert/strict";
import { readGitPublicationEvidence, preparePublication, exportSkillPackage, type PublicationInput } from "@orgops/skills";
import { createGitFixture } from "./packages/skills/src/catalogs/git-fixtures";

for (const format of ["sha1", "sha256"] as const) {
  const fixture = await createGitFixture(format);
  try {
    const lexical = Buffer.from('{\r\n "entries" : [], "formatVersion" : 1\r\n}\n');
    const indexPath = "catalog/index.json";
    const commit = await fixture.commit([{ path: indexPath, bytes: lexical },
      { path: "README.md", bytes: Buffer.from("Inert unrelated file\n") }]);
    const read = await readGitPublicationEvidence({ repository: fixture.repository, commit, indexPath });
    assert.equal(read.ok, true);
    if (!read.ok) throw new Error("Synthetic read rejected");
    const e = read.value;
    // Independent configuration; this URL is not contacted or authenticated by the reader.
    const repository = { url: "https://example.invalid/team/catalog.git" };
    const candidate = exportSkillPackage([{ type: "file", path: "SKILL.md", executable: false,
      base64: Buffer.from("---\nname: echo-skill\ndescription: Echo instructions.\nlicense: MIT\n---\nReturn a short acknowledgement.\n").toString("base64") }], {
      metadata: { formatVersion: 1, name: "echo-skill", version: "1.0.0",
        description: "Echo instructions.", author: "Example Authors", license: "MIT",
        compatibility: { orgops: { min: "0.0.1", maxExclusive: "0.1.0" }, platforms: ["linux"], tools: ["node"] }, secrets: [] },
      dependencies: [], executables: [], selectedPaths: ["SKILL.md"],
    });
    assert.equal(candidate.ok, true);
    if (!candidate.ok) throw new Error("Synthetic export rejected");
    const input: PublicationInput = {
      base: { catalogId: "team", sourceId: "team-source", repository, enabled: true,
        commit: e.commit, indexPath: e.indexPath, inventory: e.inventory, indexBase64: e.indexBase64,
        history: { complete: true, releases: [] } }, // independently known synthetic history only
      selections: [{ destinationPath: "packages/echo-skill/1.0.0", candidate: candidate.value,
        intent: "new-release", origin: null }],
      sources: [{ sourceId: "team-source", repository, enabled: true, allowPackages: false }],
      catalogs: [], packages: [], knownReleases: [],
      target: { orgopsVersion: "0.0.1", platform: "linux", tools: ["node"] },
    };
    const result = preparePublication(input);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("Synthetic preparation rejected");
    const proposal = result.value;
    assert.deepEqual(proposal.preconditions.inventory, e.inventory);
    assert.equal(proposal.preconditions.baseCommit, commit);
    assert.equal(proposal.preconditions.oldIndex!.base64, lexical.toString("base64"));
    assert.equal(proposal.changes.find(c => c.path === indexPath)!.before!.base64, lexical.toString("base64"));
    assert(proposal.changes.filter(c => c.path !== indexPath).every(c => c.before === null));
    assert.equal(proposal.reviewRequired, true);
    assert.equal(preparePublication({ ...input, base: { ...input.base, enabled: false } }).ok, false);
    // No logging bytes, approval, commit creation or submission follows.
  } finally { await fixture.dispose(); }
}
```

## Offline import preparation

`prepareImport` is a pure synchronous conditional review of one exact skill,
native CLASSIC/RLM_REPL template or supported wrapped recipe and its complete pinned
skill closure. It does not install, bind, approve, enable, activate or start anything.
There is no filesystem/process/network/DB I/O, active skill discovery, credential or
environment read, package-authored module evaluation, clock or random authority data.
This is the bounded offline portion of the approved design, not full v1 installation
or two-instance acceptance. Phase 8's task/whole-phase reviews and independent parent
verification are complete: 1937 Vitest tests/50 files, 3 opscli tests, all twelve
workspace lints with unchanged 488 baseline diagnostics, and the executed synthetic
example. Acceptance covers only this conditional offline review.

### Exact import signatures and limits

These are explicit `@orgops/skills` exports, alongside `prepareImport`. GitRepository,
ResolvedIdentity and ContractIssue are existing `@orgops/schemas` types;
PackageSnapshot, InspectedFile, CatalogSnapshot, SuppliedPackage and ResolveInput
are existing public skills types documented above. Validation, composition,
source-policy helpers, private validated types and synthetic fixtures are not root
exports. No caller-configurable budget or callback is accepted.

```ts
export const IMPORT_LIMITS = Object.freeze({
  inputJsonBytes: 67108864, validatedJsonBytes: 67108864,
  sources: 128, catalogs: 32, suppliedPackages: 4096,
  knownReleases: 4096, installedEntries: 4096, localTreeEntries: 8192,
  localEntriesPerSkill: 1024, totalIndexEntries: 8192,
  aggregateFiles: 8192, decodedBytes: 33554432,
  outputFiles: 8192, outputDecodedBytes: 33554432, outputJsonBytes: 67108864,
  snapshotWarnings: 4096,
} as const);
export type ImportSource = {
  sourceId: string; repository: GitRepository; enabled: boolean; allowPackages: boolean;
};
export type ImportLocalEntry =
  | { type: "directory"; path: string }
  | { type: "file"; path: string; base64: string; executable: boolean }
  | { type: "blocked"; path: string };
export type ImportInstalledEntry =
  | { state: "occupied"; name: string }
  | { state: "measured"; name: string; origin: ResolvedIdentity;
      content: { complete: true; entries: readonly ImportLocalEntry[] } };
export type ImportInput = {
  root: ResolveInput["roots"][number];
  sources: readonly ImportSource[];
  catalogs: readonly CatalogSnapshot[];
  packages: readonly SuppliedPackage[];
  target: ResolveInput["target"];
  installed: { complete: true; entries: readonly ImportInstalledEntry[] };
  knownReleases: readonly ResolvedIdentity[];
};
export type ImportIssue = {
  code: ContractIssue["code"] | "INVALID_IMPORT_INPUT" | "INSTALLED_EVIDENCE_REQUIRED";
  at: "$" | "root" | "sources" | "catalogs" | "packages" | "target" | "installed" | "knownReleases" | "review";
};
export type ImportResult<T> = { ok: true; value: T } | { ok: false; issues: ImportIssue[] };
export type ImportReviewFile = InspectedFile & { encoding: "utf8" | "binary" };
export type ImportReviewPackage = {
  identity: ResolvedIdentity; snapshot: PackageSnapshot; action: "include" | "reuse";
  dependencies: readonly ResolvedIdentity[];
  files: readonly ImportReviewFile[];
  manifestBytes: "normalized-package-manifest" | "current-installed-manifest";
};
export type ImportPreview = {
  kind: "offline-import-preview";
  root: ResolvedIdentity;
  preconditions: Pick<ImportInput, "root" | "sources" | "catalogs" | "target" | "installed" | "knownReleases">;
  packages: readonly ImportReviewPackage[];
  reviewRequired: true;
  authority: "none";
};

export function prepareImport(input: ImportInput): ImportResult<ImportPreview>;
```

All submitted input is strict JSON-only own enumerable data: unknown/missing keys,
accessors (without invocation), sparse/extra-property arrays, cycles, symbols,
functions, undefined, dates/nonplain objects, nonfinite numbers and lone surrogates
fail. Descriptor validation at 64MiB precedes counts and encoded-byte preflight;
no decode/hash/YAML/manifest parsing or resolver work starts before all supplied
file occurrences pass their externally knowable count and byte checks. Proxy traps
and native OOM remain outside the guarantee; this is not a single-copy heap sandbox.

All existing CATALOG_LIMITS and primitive/manifest field caps above also apply.
In particular: 64 target tools; 4096 entries/2MiB per index; 256KiB per semantic
manifest; 256 files/12MiB content JSON/8MiB decoded content per snapshot;
1MiB per ordinary file; 256KiB per actual local root manifest; 8MiB local ordinary
content excluding root manifest. Aggregate input counts include every repeated
snapshot/local file occurrence, even unused evidence. Root semantic manifests
are separately JSON-bounded, not input file occurrences. Base64 must be canonical
padded RFC4648 and measured sizes/reencoding must agree, never lossy decode.
Execution caps apply both before and after regeneration: 256 API paths, 256 scripts,
35 commands, one external source, 4096 warnings per snapshot. Warning pointers max
1024, execution paths/command pointers 240, commands 16384, args 128 × 4096,
external repo 201/ref 128. Manifest schema limits still bound all declared fields.

Submitted input, canonical input and the complete private validated representation
have separate 64MiB ceilings. The private representation additionally counts derived
installed identities/digests, blocked names and full measured review files, including
repeated raw bytes already in input. Regenerated snapshots and derived collections
are charged incrementally before retention, not built unbounded and checked later.
Regenerated local review or parsing LIMIT_EXCEEDED fails the whole request, even
for an unrelated skill; it is not downgraded to a blocked name. Each inspector may
allocate one bounded regenerated snapshot before its result is checked. Canonical
input and full private representation receive independent final descriptor checks.

The entire output, including preconditions, raw local evidence, regenerated snapshots,
execution/warnings, identities and review files, is incrementally JSON-charged to
64MiB and independently checked at completion. Review files have separate 8192-file
and 32MiB decoded ceilings, counting generated root manifests and repeated occurrences.
Actual pretty-serialized generated manifests must fit 256KiB before base64/hash.
Equality is permitted where all other guards pass; overflow returns no partial preview
or truncation. Tighter combined bounds can make individual guards defense in depth;
these independent ceilings do not promise every maximum can coexist.

### Evidence checked versus trusted assertions

- `sources` independently supplies canonical repository bindings and effective
  enabled/nonremoved policy, not raw configuration rows. IDs and canonical
  `[url,sshUser ?? null]` repository identities must be unique. Catalog IDs and
  `(sourceId,commit,path)` envelopes must be unique; every supplied catalog/package
  must bind to a supplied source. All snapshots/indexes are validated, even unused.
  Author attribution authenticates nothing. Historical local origins/known releases
  may retain absent source/catalog handles; history never grants source permission.
- The shared metadata-only publication/import precheck requires each reached catalog
  and its configured source enabled. Every explicit external `location.type:"source"`
  and cross-source dependency pin independently needs enabled `allowPackages:true`,
  even for a catalog owner, before deduplication. Same-source catalog-owned pins need
  no allowPackages. Unused denied index entries need no package evidence. Only reached
  permitted IDs go to the unchanged `resolvePackages`, called once for one root.
  This is not a second pin resolver or live access check; no implicit union,
  registration, substitution, repository acquisition or credential forwarding occurs.
- `installed.complete:true` is a trusted assertion about **every occupied immediate
  child name across ALL API/runner skill locations relevant to this import**, not
  just selected manifests or `listSkills()` results (which skip malformed/unmanaged
  entries). The library cannot prove disk observation, completeness, stable host
  coverage or recorded-origin authenticity. A future caller must reconcile copies:
  only stable equal required copies qualify as measured; divergent/unknown/unmanaged
  or non-directory occupancy is `occupied`. No fabricated identity/digest/actor/time
  is supplied for occupancy; an occupied case-folded selected skill name conflicts.
- `measured` independently supplies the complete current subtree's exact bytes and
  executable bits, including actual `orgops-package.json`, with separately recorded
  original skill identity. Never copy the requested upstream snapshot to assert
  current local state. No input `currentDigest` is accepted. Actual root bytes are
  fatally UTF8-decoded (BOM preserved), parsed and actual ordinary content reinspected;
  only successful inspection derives resolver currentDigest. Reuse needs that digest
  and the exact pinned identity to match under the existing resolver contract.
- Measured names must be matching lowercase PackageName skills. Occupied names are
  portable single RelativePath segments, at most 64 characters; duplicate/case-folded
  names fail globally. Nonportable unrelated occupancy fails this conservative evidence
  subset, not disappears. Trees require explicit exact ancestor directories, safe
  joined `name/path` ≤240, no duplicate/case twins or file/blocked ancestors. Blocked
  leaves have no body/target and are never followed. Root is not an entry.
- Well-formed edited, absent/malformed/executable root manifests, extra empty directories,
  blocked leaves or otherwise uninspectable locals block selected names, while unrelated
  local edits remain inert. Strict malformed envelope/base64/path/duplicate evidence
  fails the whole request. A valid resealed local edit derives a different current
  digest and conflicts when selected. No overwrite, rename, merge, side-by-side
  version or auto-enable occurs. Local origin is retained separately through refresh.
- Existing semantic digest equivalence ignores lexical root whitespace/key order
  (standard JSON last-key semantics), not content/mode/metadata changes. Exact local
  lexical manifest bytes remain in preconditions and reuse files. This is semantic
  package equivalence, not upstream lexical byte identity.

### Complete inert review and future gates

Packages retain dependency-first resolver order, all literal identity fields,
include/reuse decisions and exact direct dependency identities in canonical pin order.
Native/wrapped roots are always included portable definitions, never existing agent
matches. Each snapshot retains its own full compatibility and declared secret
requirements; no lossy flattening or cross-package secret-name deduplication occurs.
No model, runner, workspace, local name or secret binding is selected.

Include review contains ALL inspected content (including valid native auxiliary files),
plus a normalized sorted-key two-space JSON + LF nonexecutable root manifest labelled
`normalized-package-manifest`. Snapshots do not contain the upstream lexical root blob;
generated bytes must not be described as that blob. Reuse review instead contains the
independently measured complete existing file set, including exact lexical root bytes,
labelled `current-installed-manifest`; no replacement is implied. Include paths and
implicit ancestors must have consistent casing with no leaf/ancestor collision;
skill `name/path` must fit 240 too. These logical review paths authorize no placement.
Every file retains full base64, actual size/SHA256, executable bit and fatal UTF8/binary
classification. Binary is explicitly unscanned, not omitted or repaired.

Existing inspector execution disclosures/warnings are regenerated rather than trusted
from supplied previews. API modules, scripts, wrapped setup/check/sidecar/runtime
commands and ordered arguments remain inert complete review data. Wrapped
`resourceWiring:"none"` remains the unchanged supported subset, not full v1 wiring or
native skill/prompt injection; arbitrary external commands are not transitively pinned
or sandboxed by native allowlisting. There is no second scanner, risk threshold,
scanner-version field or preview checksum. Existing file/package digests establish
consistency only. Supplementary warnings neither grant nor deny later activation;
`reviewRequired:true` and `authority:"none"` hold even for clean/reused content.
Authored review bytes may contain sensitive text: **do not log previews**.

Set-like inputs sort by code-unit tuples (sources by ID; catalogs by ID/index name/version;
packages by source/commit/path; known releases by catalog/source/name/version/packageCommit/
path/catalogCommit; occupancy by name/local path; tools). Existing manifest normalization
sorts its sets; authored strings, command args, sidecar order and lexical local bytes
are preserved. Output is detached recursively frozen without mutating/freezing input.
Failures have exactly one fixed `{code,at}` with no value, authored pointer, exception
text, command, URL or rejected value. Error pointers are only the ImportIssue union
above; validation order determines precedence. Source-precheck errors use sources,
resolver compatibility uses target, skill conflicts use installed, other resolver
errors use packages, and composition bounds use review.

Future orchestration must independently remeasure live content/complete occupancy,
enforce current live human administrator and source policy, bind local name/runner/
workspace/model and secret REFERENCES, verify actual API/runner placement, obtain
explicit approval, create stopped agents, and enforce required bindings at **every
start**. This preview does not implement or certify the full-install/missing-secret
save rule. Standalone skill inclusion/reuse does not enable existing agents. API
skill event-module activation needs later separate explicit approval even with stopped
agents; wrapped setup/checks/sidecars/turns wait for future explicit start. No active
rows, install/start methods, approval capability, actor/time or runnable status exist.
Live evidence acquisition, browsing/import UI, installation/activation and two-instance
acceptance remain deferred; Q1 network reachability and Q2 mobile shell are unchanged.

### Complete synthetic import example

Save as `.mts` and run with the repository's installed `node --import tsx`.
This public-only example uses in-memory synthetic evidence, no Git, live instance or
network. Empty occupancy is known only for this fixture, never a live instance recipe.
It intentionally prints nothing and performs no write/approval/install/start afterward.

```ts
import assert from "node:assert/strict";
import { exportSkillPackage, prepareImport, type ImportInput } from "@orgops/skills";
const exported = exportSkillPackage([
  { type: "file", path: "SKILL.md", executable: false,
    base64: Buffer.from("---\nname: sample\ndescription: Inert sample.\n---\nRead only.\n").toString("base64") },
], {
  metadata: { formatVersion: 1, name: "sample", version: "1.0.0", description: "Inert sample.", author: "Example", license: "MIT",
    compatibility: { orgops: { min: "0.0.1" }, platforms: ["linux"], tools: [] }, secrets: [] },
  dependencies: [], executables: [], selectedPaths: ["SKILL.md"],
});
assert(exported.ok); if (!exported.ok) throw new Error("Synthetic export rejected");
const commit = "1".repeat(40), snapshot = exported.value.snapshot;
const input: ImportInput = {
  root: { catalogId: "examples", name: "sample", version: "1.0.0" },
  sources: [{ sourceId: "example-source", repository: { url: "https://example.invalid/catalog.git" }, enabled: true, allowPackages: false }],
  catalogs: [{ catalogId: "examples", sourceId: "example-source", commit, enabled: true,
    index: { formatVersion: 1, entries: [{ kind: "skill", name: "sample", version: "1.0.0", digest: snapshot.manifest.digest,
      location: { type: "catalog", path: "skills/sample", revision: { type: "catalog-revision" } } }] } }],
  packages: [{ sourceId: "example-source", commit, path: "skills/sample", snapshot }],
  target: { orgopsVersion: "0.0.1", platform: "linux", tools: [] },
  installed: { complete: true, entries: [] }, knownReleases: [],
}; // Empty occupancy is independently known ONLY for this synthetic fixture, not a live instance recipe.
const result = prepareImport(input);
assert(result.ok); if (!result.ok) throw new Error("Synthetic preview rejected");
assert.equal(result.value.kind, "offline-import-preview");
assert.equal(result.value.authority, "none");
assert.equal(result.value.reviewRequired, true);
assert.deepEqual(result.value.packages.map(p => p.action), ["include"]);
assert.deepEqual(result.value.packages[0]!.files.map(f => f.path), ["SKILL.md", "orgops-package.json"]);
// Review every file, execution disclosure and precondition. No write, approval, installation or start follows.
```

## Offline local skill-root evidence

`readLocalSkillEvidence` is an asynchronous catalog-specific read-only filesystem
adapter for exactly ONE explicitly supplied trusted, quiescent local skill root. It
enumerates that root's entire immediate namespace and observes complete subtrees only
for explicitly nominated ordinary child directories, returning deterministic detached
frozen NEUTRAL observations for independent caller composition with the unchanged
synchronous `prepareImport` above. It is not active discovery (`resolveSkillRoot`,
`listSkills`, `loadSkillMeta`, `loadSkillEventShapes` are never called), not a
semantic package inspector, not a generic filesystem/export framework, and not an
installer: no write, chmod, lock, snapshot, subprocess, network, DB, environment,
credential, package-manager or module-evaluation operation exists in production code.
There is no default or automatic root selection from cwd, env, HOME, manifests, API
settings or runner configuration. This adapter's task/whole-phase reviews and
independent parent verification are complete: 2095 Vitest tests/53 files, 3 opscli
tests, all twelve workspace lints with exactly the unchanged 488 baseline diagnostics
(API486/runner2; ten clean workspaces), byte-identical root lint, and the executed
public synthetic example. Acceptance covers only this bounded offline local-evidence
observation; no installation, activation, authority or two-instance capability is
claimed.

### Exact local evidence signatures and limits

These are explicit `@orgops/skills` exports alongside `prepareImport`. The private
ownership path, reader/record types and test fixture factory are not root exports.
No caller-configurable budget, callback or limit override is accepted.

```ts
export const OFFLINE_LOCAL_SKILL_LIMITS = Object.freeze({
  operationMs: 10000,
  rootPathBytes: 4096, hostPathDepth: 64,
  nameBytes: 64, relativePathBytes: 240, relativePathDepth: 64,
  nominatedNames: 4096, namespaceEntries: 4096,
  entriesPerSubtree: 1024, localTreeEntries: 8192,
  fileBytes: 1048576, manifestBytes: 262144,
  ordinaryBytesPerSubtree: 8388608,
  aggregateFiles: 8192, decodedBytes: 33554432,
  inputJsonBytes: 1048576, outputJsonBytes: 67108864,
  chunkBytes: 65536, concurrentHandles: 2,
  fsCalls: 350000, workUnits: 524288, yieldEvery: 64, yields: 8192,
} as const);
export type LocalSkillEvidenceInput = {
  directory: string;
  nominatedNames: readonly string[];
};
export type LocalSkillEvidenceOptions = { signal?: AbortSignal };
export type LocalSkillNamespaceEntry = {
  name: string;
  type: "directory" | "file" | "blocked";
};
export type LocalSkillSubtree = {
  name: string;
  complete: true;
  entries: readonly ImportLocalEntry[];
};
export type LocalSkillEvidence = {
  nominatedNames: readonly string[];
  namespace: { complete: true; entries: readonly LocalSkillNamespaceEntry[] };
  subtrees: readonly LocalSkillSubtree[];
};
export type LocalSkillEvidenceIssue = {
  code: "INVALID_LOCAL_INPUT" | "UNSUPPORTED_LOCAL_STORAGE" | "UNSAFE_PATH"
    | "DUPLICATE_PATH" | "LIMIT_EXCEEDED" | "LOCAL_IO_FAILED"
    | "LOCAL_EVIDENCE_CHANGED" | "LOCAL_ABORTED" | "LOCAL_TIMEOUT"
    | "LOCAL_CLEANUP_FAILED";
  at: "$" | "directory" | "nominatedNames" | "namespace" | "subtrees" | "filesystem";
};
export type LocalSkillEvidenceResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: LocalSkillEvidenceIssue[] };

export function readLocalSkillEvidence(
  input: LocalSkillEvidenceInput, options?: LocalSkillEvidenceOptions,
): Promise<LocalSkillEvidenceResult<LocalSkillEvidence>>;
```

Runtime success output has exactly the three value fields above; `nominatedNames` is
the validated sorted (code-unit) snapshot, not an expanded discovery list. All objects
and arrays in a success are detached plain deeply frozen values; strings are immutable;
no Buffer, handle or Stats object escapes. No host path — not even the supplied root —
is echoed anywhere in a result. A failure has exactly one fixed `{code,at}` issue and
no partial value, raw exception, message, code, path, link target or authored bytes.
The result is bound to the explicit root by this invocation only: there is no
transferable root identity or token, and the caller retains its own root/copy
association. There is no `installed`, `state:"measured"`, `origin`, source/catalog
identity, `currentDigest`, actor/time, approval, runnable state or all-host
certification. `namespace.complete:true` means only that THIS one root's immediate
namespace was fully enumerated under the stated precondition;
`subtrees[i].complete:true` means only that that nominated ordinary directory's
complete representable subtree was observed, including blocked leaves; neither says
anything about package validity, reusable identity, other hosts or other roots.

### Input, names, nomination, absence and modes

- Input must be exactly `{directory,nominatedNames}` as strict own enumerable data
  properties: unknown/missing/symbol/accessor properties (getters never invoked),
  nonplain or null-prototype-excepted objects, sparse or extra-property arrays and
  non-string entries fail `INVALID_LOCAL_INPUT`. The descriptor is gated at 1MiB via
  the shared JSON validator before any clone. Nominations are dense one-segment
  portable `RelativePath` names (uppercase allowed); duplicates and casefold
  duplicates fail `INVALID_LOCAL_INPUT` at `nominatedNames`; more than 4096 fail
  `LIMIT_EXCEEDED` there. Options is a trusted control-plane object containing only
  an optional genuine `AbortSignal`, captured once; an invalid shape — including an
  explicit `{signal: undefined}` — fails `INVALID_LOCAL_INPUT` at `$` before any I/O.
  `signal.reason` is never interpreted or logged.
- `directory` must be an explicit normalized absolute POSIX path, not `/`, at most
  4096 UTF8 bytes/characters and at most 64 nonempty segments. Controls, NUL, C1,
  backslashes, lone surrogates, repeated separators, trailing separators and `.`/`..`
  segments fail `INVALID_LOCAL_INPUT` at `directory` without normalization, realpath
  or defaulting. Valid non-ASCII host path strings are accepted losslessly; there is
  no raw-byte root path API. Every fully joined absolute traversed path must still
  fit 4096 bytes BEFORE the Node call (`LIMIT_EXCEEDED` at the observed entry). These
  are lexical checks only: they do not inspect or certify host ancestors.
- Only linux/darwin with numeric `O_NOFOLLOW`, `O_NONBLOCK` and `O_DIRECTORY`
  constants is the conservative adapter subset; other platforms fail
  `UNSUPPORTED_LOCAL_STORAGE` at `directory` before any I/O. This is an adapter
  subset, not a change to whole-product platform support. The root must lstat as an
  ordinary directory; a missing root is `LOCAL_IO_FAILED` at `directory`, a
  link/file/special root is `UNSUPPORTED_LOCAL_STORAGE` there. Selected traversed
  descendants must share the root device; detected cross-device traversal is
  unsupported storage, never an occupied success. Equal-device mount aliases are
  neither excluded nor proved absent by this check.
- The immediate namespace enumerates ALL occupied names regardless of SKILL.md or
  manifest existence or validity: ordinary files and directories plus bodyless
  `blocked` entries for known links, FIFOs, sockets and devices. Ordinary immediate
  hardlinked files remain namespace `file` (occupancy only). Unknown or
  unclassifiable types, unreadable roots and list/stat errors are failures, never
  omissions or an empty namespace. Names are read via
  `opendir(path,{encoding:"latin1",bufferSize:1,recursive:false})` with explicit
  awaited `Dir.read()`: any name code unit above 127, a slash, a length above 64 or
  a failed `RelativePath` validation fails globally — UTF8 non-ASCII names, invalid
  UTF8 names and high-bit aliases never decode lossily or disappear. Duplicate or
  casefold-twin immediate names fail `DUPLICATE_PATH` at `namespace`.
- Nominations match exact case only. A casefold-only namespace match is
  `UNSAFE_PATH` at `nominatedNames`: the alias is never descended into and absence is
  never claimed. An exact nominated non-directory stays occupancy-only with no
  subtree. An exact nominated ordinary directory always yields one complete subtree,
  even when empty. No exact or casefold match proves that nominee absent only in this
  root, and that conclusion is bound by the preserved nominations plus the full
  namespace in the output. Empty subtrees are never fabricated for absent or
  non-directory nominees. Successful output sorts nominations, namespace, subtrees by
  code-unit name and entries by code-unit path, so enumeration order never changes it.
- A selected subtree includes every ordinary file's exact base64 bytes and
  `executable=(mode & 0o111)!==0`, preserving zero-byte, binary, BOM, malformed and
  lexical root-manifest bytes without parsing, normalization or regeneration. Only
  the exact subtree-relative `orgops-package.json` receives the 256KiB manifest cap;
  nested or differently spelled manifests stay ordinary 1MiB files with exact names.
  An executable root manifest is observed, not rejected or rewritten; the unchanged
  import consumer decides non-reuse. Explicit directories, including empty ones, are
  included. All known special leaves and ordinary files with `nlink !== 1` are
  bodyless `blocked` entries — no `readlink`, no target or hardlink-twin opens.
  Directories naturally have `nlink>1` and are NOT blocked by the file rule. Unknown
  I/O errors, oversized or unreadable ordinary leaves are global failures, never
  blocked-success or occupancy-only substitutions. Metadata for ALL nominations
  completes before ANY ordinary body read, and the complete serialized-output
  preflight (including base64 expansion, keys, punctuation and duplicate paths)
  completes before the first body.

### Trusted storage, origins and authority boundary

The caller must control and trust the root and every traversed ancestor and exclude
ALL concurrent writers from entry through settlement. This is offline trusted
quiescent storage, analogous to the accepted offline Git inspection precondition —
NOT safe scanning of arbitrarily mutable active skill roots and NOT a hostile-host or
TOCTOU sandbox. Paths alone authorize nothing: future privileged callers must
separately scope and authorize roots. Metadata rechecks — fingerprint equality over
`dev,ino,mode,nlink,size,mtimeNs,ctimeNs` with consistent type bits, path lstat and
handle fstat comparisons before and after every use, exact-byte EOF probes and
one-byte growth checks — detect known replacement, mutation, short reads and growth
as `LOCAL_EVIDENCE_CHANGED`, a conservative inconsistent observation rather than
proof of a malicious writer. They do NOT create an atomic snapshot, authenticate
origins, prove ancestor or mount containment, or detect every concurrent change
outside the precondition. Ordinary filesystem reads may change access times; no
promise of physically immutable storage or restored atime is made, and atime is
excluded from all fingerprints.

The adapter emits only neutral per-root observations. Origins, relevant-host
reconciliation and authority stay entirely with the caller: the caller independently
retains origins and reconciles ALL relevant API/runner copies before composing
`ImportInstalledEntry` values. A matching tree without an independently retained
origin is occupied, not reusable. One root's absence or content says nothing about
another host or root. Future orchestration — not this adapter — establishes
all-location completeness and live authority; the unchanged `prepareImport` treats
`installed.complete:true` as the trusted all-location assertion it already documents
above.

### Handles, lifecycle and precedence

One private ownership path holds the terminal issue, live handles and pending
result. There is no `Promise.race` cancellation: uncancellable fs acquisition remains
awaited, at most one I/O is pending at a time, and at most two handles are live (one
`Dir` plus its verifying directory `FileHandle`, or one body `FileHandle`). Each
directory is opened with `O_RDONLY|O_NOFOLLOW|O_NONBLOCK|O_DIRECTORY`, verified by
handle fstat and path lstat against the recorded fingerprint, enumerated with bounded
explicit `Dir.read()`, re-verified (fstat and lstat) at end, then closed before
descent; no recursive parent handles remain open. Body files are opened
`O_RDONLY|O_NOFOLLOW|O_NONBLOCK` without `O_DIRECTORY`, require fstat-confirmed
ordinary type, `nlink===1` and identical identity/size/mode/timestamps, are read at
explicit positions in ≤65536-byte chunks, and must return exactly the declared bytes
followed by a one-byte EOF probe reading zero. Node's `Dir` exposes no documented
fd/fstat/openat interface: the separately opened directory `FileHandle` is NOT proof
of the enumerator's identity, so trusted stable paths plus the path/handle postchecks
above are the stated precondition — no fd-anchored traversal, undocumented Node
internals, `/proc` tricks, realpath certification or native dependency is used.

A single monotonic cooperative deadline of 10000ms starts at public entry and covers
snapshot, traversal, bytes, serialization, freeze and cleanup; it (and abort) is
checked only at explicit checkpoints between settled operations, so no hard
wall-clock limit, guaranteed OS cancellation or preempted close is promised. Abort
takes precedence over timeout when both are first noticed at a checkpoint; a rejected
I/O first checks abort/deadline, otherwise selects its fixed I/O failure; the first
selected terminal issue is kept. All owned handles are closed exactly once with
awaited try/finally cleanup: a rejected `FileHandle.close` with `fd === -1`, or
`Dir.close` with exactly `ERR_DIR_CLOSED`, is confirmed-but-failed cleanup selecting
`LOCAL_IO_FAILED` at `filesystem` only when no earlier issue exists; any other
unconfirmed close selects terminal `LOCAL_CLEANUP_FAILED` at `filesystem`,
overriding pending success, abort, deadline, mutation or I/O error. A pending close
is always awaited, with no hard cleanup deadline; other owned handles still get
their close attempts. There is no background work, listener, timer or callback after
public settlement. The private callback seam is catalog-internal only and never
exported from `@orgops/skills`.

Fixed issue pointers: malformed envelope/options → `$`; invalid host path,
root-storage form or root I/O → `directory`; invalid, duplicate or casefold
nominations, or a nomination alias → `nominatedNames`; unsafe, duplicate or
casefold immediate disk names, or root list overflow → `namespace`; unsafe,
duplicate or casefold nested paths, and local entry/file/byte/output ceilings at the
observed entry → `subtrees`; I/O after root lstat, invalid reader records,
metadata inconsistency, work/call budgets, abort, timeout and cleanup →
`filesystem`. Relative-path depth or absolute-joined-length failures use
`namespace`/`subtrees` according to the observed entry. First-error selection is in
execution order: successful ordering is deterministic, but multiple independent
filesystem failures encountered in OS enumeration order need not pick the same
issue. No authored error pointers exist.

### Fixed budgets and derived bounds

All maxima are ceilings, not guarantees that combinations fit, finish within the
deadline, fit a later `ImportInput`, or fit one heap copy. Public constants cannot be
raised per call, repeated occurrences count independently, and the output bound
includes keys, punctuation, base64 expansion and duplicate paths. Input descriptor
1MiB; root path 4096 bytes/64 segments; names 64 bytes; relative paths 240 bytes/64
components; nominations 4096; immediate namespace 4096; selected subtrees 1024
entries each and 8192 combined (directories and blocked leaves count as entries);
ordinary body files 8192 across selected trees and 32MiB decoded aggregate; each
ordinary file 1MiB except the exact root manifest at 256KiB; 8MiB ordinary bytes per
subtree excluding only the exact root manifest; complete serialized output 64MiB,
charged exactly (empty-entry JSON size plus `4*ceil(size/3)` per file, commas and
envelopes included) before the first body and verified against the final
serialization after it. Derived call bound: with at most 12289 records, 12289
directory-open occurrences, 8192 body files and 12288 returned entries, a successful
acquisition performs at most `2*12289 + 8*12289 + (12288+12289) + 23*8192 = 335883`
application-visible asynchronous Node FS calls, capped globally at 350000 with two
slots reserved before non-cleanup scheduling so cleanup closes are always attempted.
Work units are capped at 524288 with a bounded `setImmediate` yield every 64 units
(at most 8192 yields); sorting and validation are bounded by the same object sizes
and are only cooperatively checked, not preemptible. This is an application-visible
Node-call bound, not a kernel-syscall or native-memory claim: Node may perform
bounded buffered work internally, and trusted per-object temporary allocations are
bounded without pretending a single-copy heap cap.

### Complete owned synthetic acquisition example

Save as `.mts` and run with the repository's installed `node --import tsx`. It uses
only public exports plus Node fixture construction beneath the explicitly supplied
`TMPDIR`, a separately defined literal synthetic origin (never derived from observed
bytes), one owned scratch root declared by the example itself to be the only relevant
location, the exact neutral mapping from the composition tests, and the unchanged
pure `prepareImport`. All URLs are `.invalid` and commits synthetic. It intentionally
prints nothing, cleans only its own mkdtemp root in an awaited `finally`, and
performs no write, approval, installation or activation after preparation.

```ts
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  exportSkillPackage, prepareImport, readLocalSkillEvidence,
  type ImportInput, type ImportInstalledEntry,
} from "@orgops/skills";

// 1. Author an inert synthetic package exactly like the offline import example.
const exported = exportSkillPackage([
  { type: "file", path: "SKILL.md", executable: false,
    base64: Buffer.from("---\nname: sample\ndescription: Inert sample.\n---\nRead only.\n").toString("base64") },
], {
  metadata: { formatVersion: 1, name: "sample", version: "1.0.0", description: "Inert sample.", author: "Example", license: "MIT",
    compatibility: { orgops: { min: "0.0.1" }, platforms: ["linux"], tools: [] }, secrets: [] },
  dependencies: [], executables: [], selectedPaths: ["SKILL.md"],
});
assert(exported.ok); if (!exported.ok) throw new Error("Synthetic export rejected");
const commit = "1".repeat(40), snapshot = exported.value.snapshot;

// 2. Separately recorded synthetic origin, defined BEFORE any observation. It is
//    never inferred from the observed manifest bytes.
const retainedOrigin = { catalogId: "examples", catalogCommit: commit, sourceId: "example-source",
  packageCommit: commit, path: "skills/sample", kind: "skill" as const, name: "sample",
  version: "1.0.0", digest: snapshot.manifest.digest };

// 3. Owned scratch root beneath the explicitly supplied TMPDIR. Writing these bytes
//    is fixture construction only, never an actual skill-root installation.
const root = await mkdtemp(join(tmpdir(), "orgops-local-evidence-"));
try {
  await mkdir(join(root, "sample"));
  for (const file of snapshot.files) {
    const target = join(root, "sample", file.path);
    await writeFile(target, Buffer.from(file.base64, "base64"));
    await chmod(target, file.executable ? 0o755 : 0o644);
  }
  const manifest = Buffer.from(JSON.stringify(snapshot.manifest, null, 2) + "\n", "utf8");
  await writeFile(join(root, "sample", "orgops-package.json"), manifest);

  // 4. Neutral observation of exactly this one root and the one nominated subtree.
  const evidence = await readLocalSkillEvidence({ directory: root, nominatedNames: ["sample"] });
  assert(evidence.ok); if (!evidence.ok) throw new Error("Synthetic observation failed");
  assert.deepEqual(Object.keys(evidence.value).sort(), ["namespace", "nominatedNames", "subtrees"]);
  assert.deepEqual(evidence.value.subtrees.map(t => [t.name, t.complete]), [["sample", true]]);

  // 5. Caller-owned mapping into ImportInstalledEntry values. This example declares
  //    its own root the ONLY relevant location, independently of the adapter.
  const entries: ImportInstalledEntry[] = evidence.value.namespace.entries.map(n => {
    const tree = evidence.value.subtrees.find(t => t.name === n.name);
    return n.name === "sample" && n.type === "directory" && tree
      ? { state: "measured", name: n.name, origin: retainedOrigin,
          content: { complete: true, entries: tree.entries } }
      : { state: "occupied", name: n.name };
  });
  const input: ImportInput = {
    root: { catalogId: "examples", name: "sample", version: "1.0.0" },
    sources: [{ sourceId: "example-source", repository: { url: "https://example.invalid/catalog.git" }, enabled: true, allowPackages: false }],
    catalogs: [{ catalogId: "examples", sourceId: "example-source", commit, enabled: true,
      index: { formatVersion: 1, entries: [{ kind: "skill", name: "sample", version: "1.0.0", digest: snapshot.manifest.digest,
        location: { type: "catalog", path: "skills/sample", revision: { type: "catalog-revision" } } }] } }],
    packages: [{ sourceId: "example-source", commit, path: "skills/sample", snapshot }],
    target: { orgopsVersion: "0.0.1", platform: "linux", tools: [] },
    installed: { complete: true, entries }, knownReleases: [],
  };
  const result = prepareImport(input);
  assert(result.ok); if (!result.ok) throw new Error("Synthetic preview rejected");
  const skill = result.value.packages.find(p => p.identity.name === "sample")!;
  assert.equal(skill.action, "reuse");
  assert.equal(skill.manifestBytes, "current-installed-manifest");
  assert.equal(skill.files.find(f => f.path === "orgops-package.json")!.base64, manifest.toString("base64"));
  assert.equal(result.value.authority, "none");
  assert.equal(result.value.reviewRequired, true);

  // 6. Matching observed bytes WITHOUT an independently retained origin stay
  //    occupied and conflict; the adapter never infers an origin from manifests.
  const occupied: ImportInput = { ...input, installed: { complete: true,
    entries: evidence.value.namespace.entries.map(n => ({ state: "occupied" as const, name: n.name })) } };
  const conflict = prepareImport(occupied);
  assert.equal(conflict.ok, false);
  if (conflict.ok) throw new Error("unreachable");
  assert.deepEqual(conflict.issues, [{ code: "SKILL_CONFLICT", at: "installed" }]);
} finally {
  await rm(root, { recursive: true, force: true }); // ONLY the owned mkdtemp root
}
// Review every observed byte, then compose offline. No write, approval, installation or start follows.
```
