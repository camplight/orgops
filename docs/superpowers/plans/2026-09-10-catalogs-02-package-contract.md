# Catalog package contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The parent owns dispatch and review; workers never launch agents. Work in the existing branch, not a worktree.

**Goal:** Deliver an independently usable, inert package/catalog contract library for skills, native templates and wrapped recipes.

**Architecture:** Add strict Zod contracts to `@orgops/schemas` and pure content, resolution and export functions to `@orgops/skills`. Caller-supplied repository provenance, content entries and source policy are inputs, never authority derived from publisher metadata. No API, registry, installer, filesystem adapter or runtime is introduced.

**Tech Stack:** Existing TypeScript, Zod 3, yaml, Node crypto and Vitest; npm workspaces; no dependency or lockfile changes.

**Spec:** `docs/superpowers/specs/2026-09-09-skill-agent-catalogs-design.md`; current behavior: `docs/SPEC.md` (read completely before execution).

## Execution status — parent accepted

Tasks 1–4 are implemented, locally committed and independently approved. Task 4's original P1 (serialized export manifest exceeding the parser byte budget) is fixed in `c3b187aad6cab63f5aaabcdbc5c36e08bc60ca09` and its fresh task re-review is approved. Task 1–3 approval provenance is recorded in this phase's recovery context and subsequent worker handoffs; empty Markdown review files are not approval evidence. Task-4 re-review approval was supplied as structured evidence with the final validation dispatch.

Checked steps record completed deliverables, not a claim that every added negative test separately went RED: the ledger explicitly records Task-2 assertion correction and already-passing refinement cases in Tasks 2–4. Original task logs/reports remain preserved under `.superpowers/sdd/2026-09-10-catalogs-02-package-contract/`.

- [x] Final parent-run whole-repository Vitest: 673/673 tests in 27 files; opscli: 3/3.
- [x] Individual lint for all 12 baseline workspaces: schemas/skills and eight others clean; API 486 + runner 2 existing diagnostics unchanged by workspace/file/code/full message against fresh Phase-2 baseline and Task-4 final. Root lint fails on existing API debt; it is not green.
- [x] Dependency manifests/lockfile unchanged from planning BASE; only contract source/tests and documentation in cumulative tracked scope.
- [x] Fresh whole-phase read-only review, scoped correction/re-review and parent final acceptance at implementation HEAD `db414fc1c43b0300c882e9417a5372f41f850303`.

Whole-phase review additionally found reserved `orgops-package.json` directory ancestors could collide with the generated manifest. The final correction rejects these at schema, inspection and export boundaries and validates the complete proposed path set; its independent re-review is approved. Parent inspected the shared boundaries/fix and reran tests and all workspace typechecks. Full-message diagnostic multisets remain identical against four preserved baselines (488 before/after, zero additions/removals).

Latest evidence: `parent-final-{test,opscli,root-lint,exits}.txt`, `parent-final-lint-*.txt`, `parent-compare-lint.py`, `parent-final-lint.json` and `parent-final-lint-comparison.txt` in the phase directory. Earlier worker/reviewer evidence remains preserved. No live catalog/import/publish services, disk/network adapters, activation or real-instance integration are implemented or exercised in this phase.

## Global Constraints

- Instance-configured public and private Git catalogs; no central instance registration requirement.
- Git-host-neutral format and consumption; GitHub-only in-app PR publishing.
- No automatic dependency source registration, version substitution, or upstream overwrite.
- Secret requirements are portable; secret values and live agent state are not.
- Browsing never executes downloaded package code. Activation of executable content requires explicit approval.
- Wrapped agents do not use OrgOps native prompt/skill injection or filesystem restrictions.
- No new sandbox or claim of safe execution of untrusted packages is part of v1.
- Only `/home/slamnation/www/orgops`, branch `88-move-private-skills-into-a-private-repo`; no worktrees, pushes, remote writes, merges, publication, nested agents, production credentials or real instance state/services.
- One writer followed by fresh read-only task review, TDD, local conventional commits, and whole-phase review. Diagnose routine failures; escalate materially new security/product decisions to the parent. A runtime/extension/launch infrastructure failure is a hard stop: record exact error, cwd, branch, HEAD, status and diff; no fallback agent mode.
- npm only. Do not install dependencies again or change package manifests/lockfiles. New `@orgops/schemas` and `@orgops/skills` code typechecks cleanly without suppression. Existing API (486) and runner (2) diagnostics may remain only with zero added diagnostics documented against the approved baseline.
- All fixtures are fabricated, local and isolated. Do not call discovery, `loadSkillEventShapes`, harness methods, network APIs, subprocess tools or package managers from contract code.
- Phase 1 administrator prerequisite is implemented at planning BASE `29ef4dc31dc67d36659ce8dc15f32e375624b0e7`. This phase changes no auth, DB, events, routes, UI or start behavior.

## Coverage, dependencies and file responsibilities

| Seam/task | Own files (create unless marked modify) | Consumes | Independently reviewed deliverable |
|---|---|---|---|
| 1 Strict versioned contracts | `packages/schemas/src/catalogs/{primitives,manifest,index}.ts`, `packages/schemas/src/catalogs/{manifest,index}.test.ts`, modify `packages/schemas/src/index.ts` | Zod only | Strict manifests/indexes, exact declared pins and portable recipe subset |
| 2 Inert integrity/content | `packages/skills/src/catalogs/{content,skill-document}.ts`, matching `.test.ts`, `packages/skills/src/catalogs/fixtures.ts`, modify `packages/skills/src/index.ts` | Task 1 schemas/types | Bounded detached snapshots, deterministic digest, SKILL.md validation, execution preview |
| 3 Exact dependency resolution | `packages/skills/src/catalogs/resolve.ts`, `resolve.test.ts`, modify `packages/skills/src/index.ts` | Tasks 1–2 | Policy-bound pure graph resolution, immutable identity and installed-skill conflicts |
| 4 Allowlist export/public examples | `packages/skills/src/catalogs/{export,export.test}.ts`, modify `packages/skills/src/index.ts`, `docs/catalog-package-contract.md`, `docs/examples/catalogs/{skill,native-classic,native-rlm,wrapped,index}.json`, modify `docs/SPEC.md` | Tasks 1–3 | Export candidates/selected skill packaging with full previews, examples verified by tests and documented public API |

Run tasks in order 1 → 2 → 3 → 4, never parallel writers. The shared `packages/skills/src/index.ts` only gains named exports; do not refactor its active discovery/importer. `fixtures.ts` is test support, never exported from the workspace index. Task 1 does not modify existing event/agent schemas.

| Binding design section | Phase-2 guarantee | Future adapter/phase, not implemented here |
|---|---|---|
| §3–5 identities/index/portability | All four tasks; kinds, attribution, explicit source references, detached files and fields | Source registration/fetch/refresh status, credential routing, UI discovery |
| §5–6 dependencies/local copies | Tasks 1–3; exact pins and supplied installed-content equivalence checks | Measuring installed disk content, placement, local edits and persisted origin; wrapped skill/resource wiring requires a subsequent explicitly supported adapter/format contract |
| §7 inspection/execution | Task 2; no execution and conservative capability preview | Disk traversal/archive extraction, download bounds, approval/activation, atomic placement, stopped agent creation |
| §8 secrets | Tasks 1/4; requirements only, sensitive-text warnings without safety claims | Secret binding/storage and server-side start gate |
| §9 publishing | Task 4 candidate files/digest only; same-repository index representation | GitHub authentication, PR/diff UI, prepared-operation persistence, retry reconciliation, immutable-release history storage |
| §10 auth/audit | Phase 1 remains unchanged | Catalog management routes/admin guard/audit events |
| §11/13 recovery/e2e | Pure errors have no side effects, isolated unit fixtures | Installation recovery, API/runner integration and two-instance scenario |
| §12/14 seams/non-goals | Existing workspaces only; no registry/backend/runtime | No new sandbox or transitive command reproducibility in any claim |

## Shared public contract (include with each generated task brief)

The following is normative, not optional policy guidance. Type declarations describe exact JSON fields; implement strict Zod objects recursively with no coercion, passthrough, defaults or unknown-key stripping. Required fields remain required, including empty arrays. Export inferred types with these names. Object property order has no meaning. Duplicate set members are errors, not silently deduplicated.

### Names, bounds and errors

`PackageName` and `SourceId` are strings matching `^[a-z0-9]+(?:[._-][a-z0-9]+)*$`, 1–64 ASCII characters. `CatalogId` uses the same grammar. They are configured stable source handles, not display names or publisher proofs: the instance must explicitly bind these handles to canonical repositories. A handle from an index/dependency does not register or authorize a source. No URL or credential field exists in the index. Aliasing/rebinding handles is an adapter responsibility; callers must preserve canonical repository identity and not silently remap handles.

`Version` is exactly three unsigned decimal components `MAJOR.MINOR.PATCH`, each 0–999999, no leading zero except `0`; no ranges, prerelease/build suffix, tags or coercion. `Commit` is lowercase 40- or 64-digit hexadecimal Git object ID. `Digest` is `sha256:` plus exactly 64 lowercase hexadecimal digits. Each string rejects lone UTF-16 surrogates. All numeric JSON fields are finite safe integers except model temperature (finite number).

`RelativePath` is 1–240 ASCII characters, `/`-separated, with 1–64-character segments matching `[A-Za-z0-9._-]+`. Reject empty/`.`/`..` segments, leading/trailing slash, backslash, colon, percent, spaces, control characters and segments ending in `.`. Reject case-insensitive Windows device basenames (CON, PRN, AUX, NUL, COM1–COM9, LPT1–LPT9, with or without extension), `.git`, `.orgops-data`, and `node_modules` segments. Reject case-folded duplicate paths and file/directory-prefix collisions (`a` with `a/b`). No URL decoding, Unicode normalization, separator replacement or path normalization to repair inputs. Root `orgops-package.json` (case-insensitive) is reserved for serialized manifest and cannot be a content/inventory path. Reject all links, including internal symlinks, in this portable subset. This deliberately conservative subset is not a filesystem security adapter.

Fixed exported `CATALOG_LIMITS`: manifest JSON UTF-8 262144 bytes; index JSON 2097152 bytes; content entries 256; per-file 1048576 decoded bytes; total content 8388608 decoded bytes; index entries 4096; dependencies/package 64; resolved packages 256; recursion depth 64 (root depth 0); supplied catalogs 32; supplied packages 4096; installed skills 4096; content collection JSON 12582912 bytes; export options JSON 262144 bytes; entire resolver input JSON 67108864 bytes (including base64, every manifest/index, supplied previews, envelopes and installed/known identities), plus cumulative decoded resolver content 33554432 bytes. Enforce aggregate JSON budgets before schema traversal, decoding, hashing or graph expansion; package count is not a substitute for a metadata budget. JSON input parsing APIs accept strings; the object APIs accept JSON data only, not arbitrary executable JS objects/proxies, and apply the same serialized byte/depth bounds before schema work. Maximum JSON depth 32. Serializing a cycle, BigInt, undefined, non-finite number or non-plain object fails `INVALID_JSON`. Strings/arrays must be bounded before traversing children. Every high-level function first invokes bounded JSON-only validation on all its object arguments; no field, discriminator, array member, base64 or accessor value is read beforehand. Validation examines own data-property descriptors, rejects accessors without invoking them, and rejects non-JSON types. The caller contract excludes executable JS objects/proxies; no protection from Proxy traps is promised by descriptor/prototype inspection. Do not include raw input values, command text, YAML diagnostics or credentials in errors.

```ts
export type ContractIssue = {
  code: "INVALID_JSON" | "INVALID_MANIFEST" | "INVALID_INDEX" | "LIMIT_EXCEEDED"
    | "UNSAFE_PATH" | "DUPLICATE_PATH" | "UNSUPPORTED_ENTRY" | "INVENTORY_MISMATCH"
    | "DIGEST_MISMATCH" | "INVALID_SKILL" | "EXECUTABLE_MISMATCH"
    | "SOURCE_NOT_ALLOWED" | "MISSING_RELEASE" | "IDENTITY_CONFLICT"
    | "INCOMPATIBLE" | "UNSUPPORTED_DEPENDENCY" | "CYCLE" | "SKILL_CONFLICT"
    | "UNSUPPORTED_EXPORT" | "UNSUPPORTED_WIRING";
  at: string; // fixed field/index pointer or validated package/path, never raw rejected text
};
export type ContractResult<T> = { ok: true; value: T } | { ok: false; issues: ContractIssue[] };
// Return the first deterministic error (one-element issues array); do not echo Zod/YAML errors.
export type ReviewWarning = {
  code: "SENSITIVE_TEXT" | "MANUAL_REVIEW_REQUIRED" | "EXTERNAL_RUNTIME_NOT_PINNED";
  at: string; // field/path only; no matched value or line excerpt
};
```

### Manifest and catalog JSON shapes

The strict object definitions below, together with the bounds/refinements table immediately following, are the full version-1 schemas. `?` alone means optional; nullable is never implied. Export `PackageManifestSchema`, `CatalogIndexSchema`, `DependencyPinSchema`, `ResolvedIdentitySchema`, `PortableWrappedRecipeSchema`, `RelativePathSchema`, `VersionSchema`, `DigestSchema`, `CommitSchema`, and the named types below from `@orgops/schemas`.

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

| Fields/refinement | Exact rule |
|---|---|
| Base text | description 1–4096 chars; author/license 1–256; non-whitespace strings, preserve authored text |
| Secret declarations | max 64, name `^[A-Z][A-Z0-9_]{0,63}$`, description 1–1024, unique names; reject value/reference/id/env fields |
| Compatibility | max > min when supplied; platform set max 3; tools unique max 64 |
| Files | max 256; sizes 0–1048576; aggregate ≤8388608; path rules above and unique case-folded paths; all inventory entries ordinary files |
| Executables | unique paths max 256; declared paths must exist in inventory; both API modules and executable bits need matching declarations (content cross-check Task 2) |
| Dependencies | max 64, unique `(catalogId,sourceId,name)` (different versions under same name are not allowed); references only skills, checked on resolution |
| Native | instructions/soul each max 65536 chars (instructions can be empty); positive integer tuning values ≤2147483647; omit classicMaxModelSteps for RLM_REPL; preload max 64 unique PackageName tokens, subset of dependency names |
| Suggested model | strict nonempty object; provider/modelName nonblank max 256 each; temperature 0–2; maxTokens positive integer ≤2147483647; suggestions are not bindings or permission |
| Commands | command/checkCommand 1–16384 chars; args max 128 strings each ≤4096, preserve order; timeoutMs/restartDelayMs positive integer ≤2147483647; cwd only `.` or RelativePath, additionally reject leading `.orgops-data`; no env object/values |
| Wrapped source | repo exactly `owner/repo`, ASCII `[A-Za-z0-9_.-]+` segments 1–100, neither `.` nor `..`; no URL, credentials, query, whitespace or shell metacharacters. ref optional 1–128 matching `[A-Za-z0-9][A-Za-z0-9._/-]*`, no `..`, `//`, trailing `/` or `.`, or `.lock` segment suffix. This is an external runtime hint, NOT a verified checkout pin: current harness uses `git clone --branch` and cannot promise arbitrary commit checkout |
| Wrapped subset | kind PackageName; sidecars unique names max 16; setup requires command (check-only configuration unsupported); strict harness `command` only; no transport alias or raw config passthrough; resourceWiring exactly `none`; files/executables/dependencies all empty |
| Resource wiring | Reject non-`none`, wrapped files/dependencies or native-style injection as `UNSUPPORTED_WIRING` at content/export boundary. Arbitrary resource wiring lacks a current harness contract. This is the Phase-2 supported subset, NOT a permanent exclusion of wrapped skills/resources from full sharing v1. Accept command/source/setup/sidecar/turn-only recipes, never downloaded skills portrayed as active. A subsequent adapter/format contract must explicitly define any positive wiring |
| Catalog | max 4096 entries, `(name,version)` unique regardless of kind or location; distinct releases cannot share `(location source/commit context,path)` within one index; repository directory path required (not `.`); no catalogId/source URL/credential field in publisher index |

**Pins without circular Git hashes:** an index's `location.type="catalog"` always uses the caller-supplied catalog repository (no instance-specific sourceId needed in that location). Its required `revision` is either `exact` with a literal historical package commit, or `catalog-revision` for a newly introduced release in the index's own commit. The contextual form resolves to the supplied catalog commit; it contains no hash of its own commit. External locations have an explicitly configured `sourceId` and exact commit. All outputs expand contextual revisions to literal commits; an `exact` revision never falls back. Neither form permits tags/branches for OrgOps package content.

**Release lifecycle and refresh stability:** new coherent releases may use `catalog-revision` in initial commit A. When publishing an index edit at B, the publisher must freeze every pre-existing contextual entry to `{type:"exact",commit:A}` (or its original resolved introducing commit), preserving its digest/path/kind/name/version. Only new coherent releases at B use `catalog-revision`. This is a required future publisher/hand-authoring behavior, not an implemented publisher. Consumers of B can then resolve an old release to packageCommit A with catalogCommit B; known release and installed-content equivalence remain unchanged. If an old contextual entry is left floating, its packageCommit changes and supplied known identities cause `IDENTITY_CONFLICT`; never waive changed mappings because bytes happen to match. The pure resolver cannot detect history it was not supplied. An explicit external source release likewise preserves its packageCommit while catalogCommit changes.

A dependency's `same-package-revision` resolves to its declaring package's source and commit, not necessarily its catalog's current commit, and is legal only when its sourceId equals the declaring sourceId; otherwise fail `UNSUPPORTED_DEPENDENCY`. This permits coherent same-repository releases without circular Git hashes. Dependencies of a new B package on an older frozen A skill must use `{type:"exact",commit:A}`, not `same-package-revision`. Its digest/version remain exact and covered by the parent digest.

Logical release identity is `(catalogId, sourceId, name, version)`; immutable content identity adds `packageCommit,path,digest,kind`. `catalogCommit` is separate provenance, not content equivalence: a refreshed index can advertise the same package unchanged. Refuse changed mapping of an already-known logical release using supplied known identities (Task 3). Source policy comes only from caller envelopes, not authors, source labels or the index.

### Deterministic digest and inert snapshot interfaces

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

All successful snapshots are detached recursively frozen plain data (including nested manifest/preview/warnings). Inputs are synchronous caller-supplied staging collections; the module never reads disk. `base64` uses canonical padded RFC4648 ASCII (empty allowed), decoded byte length bounded before `Buffer.from`; re-encode must equal input. No retained mutable byte buffers or references to caller objects. Inventory must match precisely: no extra/missing files, differing size/hash/executable flag. Prefix/case collisions rejected even if individual strings are safe. Manifest is a separate argument; its serialized `orgops-package.json` is not a content entry. Future disk/archive adapters must distinguish lstat kinds, never follow links, bound streaming bytes/counts, copy stable staged bytes, and re-inspect after any change. These properties are NOT secured for real disk by a typed in-memory API.

For each ordinary file, digest is `sha256:` + lowercase SHA-256 of exact decoded bytes. Root digest is SHA-256 of UTF-8 `orgops-package-v1\n` concatenated with canonical JSON of the **validated full manifest excluding only its top-level `digest`**. All other metadata, file hashes/lengths/executable flags, requirements, instructions, commands and dependencies are covered. No path/time/owner/mtime/mode besides executable boolean, credentials, source envelope or repository commit is injected into this content digest. Manifest JSON whitespace/key order is deliberately not covered; semantic metadata is. Content is covered through inventory hashes after verifying the actual bytes.

Canonical JSON: recursively sort object keys by ASCII/UTF-16 code unit order (no locale compare), emit JSON.stringify scalar spellings, no whitespace. Sort set arrays `files` and `executables` by path, `dependencies` by `(catalogId,sourceId,name)`, `secrets` by name, `compatibility.platforms/tools` and `native.alwaysPreloadedSkills` lexically. Preserve sidecar order and command args order (execution semantics). Reject duplicates before sorting. Other order differences are semantic. Do not sort or trim authored strings. No JSON reviver, default filling or unsupported values. `computePackageDigest` checks structure/content/inventory/SKILL/executables but ignores comparison to the manifest's syntactically valid digest; `inspectPackage` additionally compares it and returns `DIGEST_MISMATCH`. Tests may use a zero digest to compute a draft; zero is not a special production bypass. Both functions are inert.

SKILL.md: UTF-8 fatal decoding; frontmatter starts at byte 0 with `---` and a newline; closing `---` occupies its own line. Use `YAML.parseDocument` on frontmatter only with `uniqueKeys: true`, reject YAML errors, custom tags and any alias/anchor (walk AST without expanding aliases); no dynamic imports. Frontmatter must be a mapping, name/description nonblank strings, name equals manifest name; optional license string when present. Existing portable metadata and other frontmatter fields remain inert data; do not interpret commands/tools in YAML. A valid frontmatter-only skill is accepted; markdown body may be empty. Cross-check description and optional license against manifest (absence of frontmatter license is allowed). This new parser is separate from active `loadSkillMeta`, preserving existing runtime behavior.

Execution cross-check: root `event-shapes.ts` and `event-shapes.js` each require `api-event-shapes` declaration and are previewed as **API process execution**, even when not chmod executable. Other files with executable bit, shebang (`#!` first two bytes), or suffix `.ts,.js,.mjs,.cjs,.sh,.bash,.zsh,.py,.rb,.ps1,.cmd,.bat,.exe,.com,.wasm` (case-insensitive) require a `runner-script` declaration. Declared additional script files are allowed and disclosed; an API declaration is valid only for the two exact root filenames. Root API filename matching must be exact case; case variants reject `EXECUTABLE_MISMATCH` rather than promise API discovery. Declaration flags are previews, never authority. Unknown interpretable content can escape heuristics: every snapshot has `MANUAL_REVIEW_REQUIRED` warning.

Preview contains every setup/check command, each sidecar/check command and runtime command/args in order (field pointers `wrapped.setup.command`, `wrapped.setup.checkCommand`, `wrapped.sidecars.0.command`, etc.). Check-command previews inherit the same setup/sidecar args as their owning command: the current harness spreads the command config and replaces only command; never preview check args as empty when inherited args exist. Include source repo/ref separately and `EXTERNAL_RUNTIME_NOT_PINNED` for every wrapped recipe, even source-free recipes. Commands are arbitrary privileged host code and unpinned installers cannot be made transitively reproducible by hashing the recipe. Warnings scan authored strings and fatal-decodable UTF-8 text files for `gh[pousr]_[A-Za-z0-9]{20,}`, `github_pat_[A-Za-z0-9_]{20,}`, `sk-[A-Za-z0-9_-]{16,}`, `-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----`, and case-insensitive `(password|token|secret|api[_-]?key)\s*[:=]\s*\S+`; at most one `SENSITIVE_TEXT` warning per field/path. Binary/non-UTF8 files remain in full preview and manual review warning; no claim they were secret-scanned. Never include matching text in warnings/errors. This is supplementary review, not proof of safe publication or automatic approval.

### Resolver interfaces

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

`roots` nonempty max 64, unique `(catalogId,name,version)`; knownReleases max 4096. Source lists unique max 128; target tools unique max 64. First call bounded JSON-only validation over the entire input with the fixed 67108864-byte encoded/metadata budget and depth 32. Enforce cumulative 33554432 decoded bytes from bounded encoded lengths before schema traversal/hash work. Only after this validation read fields, build indexes or validate selected schemas. Validate each input/envelope and per-object bounds as well. Reject duplicate catalog IDs, duplicate supplied `(sourceId,commit,path)`, duplicate installed names, conflicting known identities and repeated logical release identities; never use first-wins lookup. Same identity repeated by edges is not an input duplicate: diamond dependencies dedupe normally. Validate supplied snapshots by re-running `inspectPackage` over their manifest/file entries; don't trust a forged TypeScript type or use a supplied preview as authority. Content budget also applies to all supplied packages cumulatively: max 33554432 decoded bytes, preventing 4096 × 8MB work. Policy check is before traversing a denied catalog or matching package; no partial result returned on errors.

For each root and dependency: require enabled named catalog and allowed catalog source; resolve entry location; require external package source independently in allowedSourceIds; resolve source/commit/path; find supplied exact bytes; verify manifest `(kind,name,version,digest)` agrees with entry and dependency pin, and compare immutable known release mapping. Report `SOURCE_NOT_ALLOWED` for disabled/unconfigured/denied sources, `MISSING_RELEASE` for absent entry/package, `IDENTITY_CONFLICT` for metadata/pin/remapping mismatch. Unused denied-source packages need not be inspected; structural bounds still apply. Dependency output kind must be `skill`; skill→skill and native→skill supported, wrapped dependencies always `UNSUPPORTED_WIRING`, any other relationship `UNSUPPORTED_DEPENDENCY`. Contextual revision uses declaring package commit, not necessarily the catalog commit.

Compatibility uses tuple Version comparison: min inclusive/maxExclusive exclusive, exact platform membership, and every declared tool present. Suggested model fields are descriptive and not auto-selected; local model capability/binding validation belongs to installation. Return `INCOMPATIBLE` with field pointer for the first missing condition. Unknown OrgOps versions/range syntax fail rather than assume compatibility.

Traversal: sort roots by `(catalogId,name,version)` and edges by `(catalogId,sourceId,name)` using code-unit ordering. Assemble the validated graph with bounded iterative expansion and dedupe by immutable identity (never recursively expand dependencies). Then use ONE shared production ordering helper for DFS visiting/visited, cycles, depth and dependency-first order. Visiting detection precedes completed-node dedupe; memoize completed subtree heights and check maximum root-to-leaf chain length, so a diamond's longer path cannot bypass depth 64. Enforce the package count during iterative assembly and again in the helper. No duplicate recursive cycle implementation. Return first deterministic error, no partial plan; cycles `CYCLE`. Track runtime skill names globally across full closure and all installedSkills. Distinct source/version/pin under the same skill name → `SKILL_CONFLICT`, even across catalogs. Reuse requires installed identity's content fields (including catalogId, excluding only catalogCommit) equal requested identity AND caller-measured currentDigest equals package digest. An untracked (`identity:null`) skill, edited digest or different pin conflicts. No side-by-side version, overwrite, upgrade, network/source registration, mutation or activation. Caller-measured currentDigest is an adapter assertion, not proof this module inspected installed disk.

### Export interfaces and exact allowlists

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

Accept only raw **camelCase API-shaped JSON object** (`routes/agents.ts` list/get representation); reject snake_case-only/ambiguous dual spellings `UNSUPPORTED_EXPORT`. `mode` is required and exact, never default. `raw` JSON size bound is 262144 and depth 32; do not stringify arbitrary DB graphs. Schema options strictly validate. Metadata always comes from explicit author options, never raw agent name/ID/description. Unknown raw local-state keys are ignored by positive field reads; no `...raw`, rest/spread-based omission, copied model defaults, or raw wrappedConfig passthrough. Nested selected structures are rebuilt property-by-property then parsed by strict import schema.

Native allowlist: `mode`, `systemInstructions` (required string), optional `soulContents`, tuning `llmCallTimeoutMs/classicMaxModelSteps/contextSessionGapMs/emitAuditEvents/memoryContextMode`, and `alwaysPreloadedSkills`. Nullable tuning values mean omit, never coerce. Missing preload list means `[]`. `enabledSkills` is only checked for dependency completeness (array of unique PackageName); each enabled name must have exactly one options dependency and vice versa, not auto-resolved from unpinned names. Preloads must be subset. For RLM_REPL raw export, omit dormant `classicMaxModelSteps` regardless of its JSON value; API mode switches can retain this classic-only setting. Do not mutate the source row. Strict imported RLM_REPL manifests still reject that field. No files for native exports; instructions/soul live in manifest. `suggestedModel` solely from options, not modelId or a DB model row. Omit icon, raw description, allowOutsideWorkspace, runner/model/agent IDs, names, paths, memberships, state/history/memory/events, secret references/values, Git PATs and arbitrary extensions. Preserved user-authored instructions/soul may include sensitive text: warning and full candidate preview, not a safety claim.

Wrapped export: require raw.wrappedConfig object (not serialized string); validate that it has no keys outside `kind,harness,source,setup,sidecars,runtime,session`. Reject env on any command, source.path, nonportable cwd, updateOnStart:true, unknown harness/transport/config keys or malformed selected fields rather than silently degrade behavior. Select each permitted recipe field explicitly. Normalize only current equivalent defaults: absent kind → `custom`, absent harness or `cli` → `command`, absent sidecars → `[]`, absent session/scope → `per-channel`, absent source.updateOnStart → false; preserve missing command optional fields, no fabricated timeouts. Add `resourceWiring:"none"`. Reject nonempty options dependencies, raw enabledSkills/alwaysPreloadedSkills and suggestedModel (`UNSUPPORTED_WIRING`); never imply native instructions/soul injection. Ignore raw native instructions/soul and runtime/memory tuning for wrapped mode (they are not consumed by current harness), document this in public usage. Secrets are options declarations only; an env value is never converted to a requirement automatically.

Selected skill export: validate bounds/path/kind/duplicates of the entire provided content collection, including unselected entries, before selection. Reject links/special entries even unselected (caller must provide ordinary staged candidates). selectedPaths must be nonempty, unique, safe, exist, and include exact root SKILL.md; there is no default “all files.” Reject selection of known local-state/credential paths: `.env` and `.env.*` basenames, `.agent-runner-id`, `.orgops-runner-id`, `.npmrc`, `.netrc`, `id_rsa`, `id_ed25519`, `credentials.json`, and any `.ssh`, `.aws`, `.config` segment (case-insensitive). This denylist supplements explicit selection, it is not an exhaustive secret detector. Build inventory from selected bytes, not supplied file claims; reject declarations naming unselected files. Validate portable skill metadata; selected authored text may contain sensitive information and yields review warnings. There is no directory walker, write, tar extraction or package activation.

Both exporters create manifest with syntactically valid zero digest, call computePackageDigest, set computed digest, call inspectPackage, then return the snapshot and canonical serialized manifest plus exactly selected content. proposedFiles are full byte previews, detached/frozen. Manifest serialization uses the same normalized sorted-set representation as hashing, includes root digest, emits JSON with two-space indentation and one final newline; serialized bytes aren't hashed recursively. No automatic diff against a remote destination or approval/publish result is claimed.

## Complete fixtures and executable test vectors

Fixtures below are synthetic; repository commit `1111111111111111111111111111111111111111` denotes a supplied snapshot only and is never fetched. Full JSON fixtures use real computed SHA-256 digests (see the executable digest oracle below). Implementers create these files only in Task 4; Tasks 1–3 use test helpers in the listed source test files/fixtures.ts. No fixture package contains credentials or real instance data.

### skill.json

```json
{
  "formatVersion": 1,
  "name": "echo-skill",
  "version": "1.0.0",
  "description": "Echo instructions.",
  "author": "Example Authors",
  "license": "MIT",
  "compatibility": {
    "orgops": {
      "min": "0.0.1",
      "maxExclusive": "0.1.0"
    },
    "platforms": [
      "linux",
      "darwin",
      "win32"
    ],
    "tools": [
      "node"
    ]
  },
  "secrets": [],
  "dependencies": [],
  "files": [
    {
      "path": "SKILL.md",
      "size": 102,
      "digest": "sha256:d1e1ad27fad5df70172dc3dd6595a6a2cc4192b5dcc3f52587458e564f80b7d1",
      "executable": false
    },
    {
      "path": "event-shapes.ts",
      "size": 48,
      "digest": "sha256:9c345d9d0d5348cad82dfc0b82a56508c97bda41ff299a8b0b684b18c40c3f97",
      "executable": false
    }
  ],
  "executables": [
    {
      "path": "event-shapes.ts",
      "execution": "api-event-shapes"
    }
  ],
  "kind": "skill",
  "skill": {
    "entrypoint": "SKILL.md"
  },
  "digest": "sha256:83dafd61312f34e2d3aee6630783ecf2b611a632adde9aff318d2fad39ead800"
}
```

### skill ContentEntry[] (not a distribution file)

```json
[
  {
    "type": "file",
    "path": "SKILL.md",
    "base64": "LS0tCm5hbWU6IGVjaG8tc2tpbGwKZGVzY3JpcHRpb246IEVjaG8gaW5zdHJ1Y3Rpb25zLgpsaWNlbnNlOiBNSVQKLS0tClJldHVybiBhIHNob3J0IGFja25vd2xlZGdlbWVudC4K",
    "executable": false
  },
  {
    "type": "file",
    "path": "event-shapes.ts",
    "base64": "dGhyb3cgbmV3IEVycm9yKCJjYXRhbG9nIGluc3BlY3Rpb24gZXhlY3V0ZWQiKTsK",
    "executable": false
  }
]
```

### native-classic.json

```json
{
  "formatVersion": 1,
  "name": "echo-agent",
  "version": "1.0.0",
  "description": "Native acknowledgement agent.",
  "author": "Example Authors",
  "license": "MIT",
  "compatibility": {
    "orgops": {
      "min": "0.0.1",
      "maxExclusive": "0.1.0"
    },
    "platforms": [
      "linux",
      "darwin",
      "win32"
    ],
    "tools": [
      "node"
    ]
  },
  "secrets": [],
  "dependencies": [
    {
      "catalogId": "team",
      "sourceId": "team-source",
      "name": "echo-skill",
      "version": "1.0.0",
      "revision": {
        "type": "same-package-revision"
      },
      "digest": "sha256:83dafd61312f34e2d3aee6630783ecf2b611a632adde9aff318d2fad39ead800"
    }
  ],
  "files": [],
  "executables": [],
  "kind": "native-agent",
  "native": {
    "mode": "CLASSIC",
    "systemInstructions": "Acknowledge requests.",
    "soulContents": "Be concise.",
    "runtime": {
      "llmCallTimeoutMs": 60000,
      "classicMaxModelSteps": 8,
      "contextSessionGapMs": 300000,
      "emitAuditEvents": true,
      "memoryContextMode": "OFF"
    },
    "suggestedModel": {
      "provider": "openai",
      "modelName": "gpt-4o-mini",
      "temperature": 0.2,
      "maxTokens": 1024
    },
    "alwaysPreloadedSkills": [
      "echo-skill"
    ]
  },
  "digest": "sha256:89dcf3abfc6f0942947a17fac61f9f6153d4b122f447853ed47734d2a093caa1"
}
```

### native-rlm.json

```json
{
  "formatVersion": 1,
  "name": "echo-repl",
  "version": "1.0.0",
  "description": "Native recursive acknowledgement agent.",
  "author": "Example Authors",
  "license": "MIT",
  "compatibility": {
    "orgops": {
      "min": "0.0.1",
      "maxExclusive": "0.1.0"
    },
    "platforms": [
      "linux",
      "darwin",
      "win32"
    ],
    "tools": [
      "node"
    ]
  },
  "secrets": [],
  "dependencies": [
    {
      "catalogId": "team",
      "sourceId": "team-source",
      "name": "echo-skill",
      "version": "1.0.0",
      "revision": {
        "type": "same-package-revision"
      },
      "digest": "sha256:83dafd61312f34e2d3aee6630783ecf2b611a632adde9aff318d2fad39ead800"
    }
  ],
  "files": [],
  "executables": [],
  "kind": "native-agent",
  "native": {
    "mode": "RLM_REPL",
    "systemInstructions": "Return done(\"acknowledged\").",
    "runtime": {
      "llmCallTimeoutMs": 60000,
      "memoryContextMode": "OFF"
    },
    "alwaysPreloadedSkills": [
      "echo-skill"
    ]
  },
  "digest": "sha256:48beb1f660ea3d2ba0ae061631b6ab06dce3cf820f71e18db593ea9550b43f87"
}
```

### wrapped.json

```json
{
  "formatVersion": 1,
  "name": "echo-wrapper",
  "version": "1.0.0",
  "description": "Inert command recipe example.",
  "author": "Example Authors",
  "license": "MIT",
  "compatibility": {
    "orgops": {
      "min": "0.0.1",
      "maxExclusive": "0.1.0"
    },
    "platforms": [
      "linux",
      "darwin",
      "win32"
    ],
    "tools": [
      "node"
    ]
  },
  "secrets": [],
  "dependencies": [],
  "files": [],
  "executables": [],
  "kind": "wrapped-agent",
  "wrapped": {
    "kind": "custom",
    "harness": "command",
    "setup": {
      "command": "printf setup",
      "checkCommand": "test -f ready",
      "cwd": ".",
      "timeoutMs": 60000
    },
    "sidecars": [
      {
        "name": "helper",
        "command": "node -e 'setInterval(() => {}, 1000)'",
        "cwd": ".",
        "restart": false,
        "restartDelayMs": 2000
      }
    ],
    "runtime": {
      "command": "printf",
      "args": [
        "acknowledged"
      ],
      "cwd": ".",
      "timeoutMs": 60000,
      "parse": "text"
    },
    "session": {
      "scope": "per-channel"
    },
    "resourceWiring": "none"
  },
  "digest": "sha256:19c6e488fa0f29398bb03a4bade14ab0ce8de8d899d1540ee1dd12158aae04ba"
}
```

### index.json

```json
{
  "formatVersion": 1,
  "entries": [
    {
      "kind": "skill",
      "name": "echo-skill",
      "version": "1.0.0",
      "digest": "sha256:83dafd61312f34e2d3aee6630783ecf2b611a632adde9aff318d2fad39ead800",
      "location": {
        "type": "catalog",
        "path": "packages/echo-skill",
        "revision": {
          "type": "catalog-revision"
        }
      }
    },
    {
      "kind": "native-agent",
      "name": "echo-agent",
      "version": "1.0.0",
      "digest": "sha256:89dcf3abfc6f0942947a17fac61f9f6153d4b122f447853ed47734d2a093caa1",
      "location": {
        "type": "catalog",
        "path": "packages/echo-agent",
        "revision": {
          "type": "catalog-revision"
        }
      }
    },
    {
      "kind": "native-agent",
      "name": "echo-repl",
      "version": "1.0.0",
      "digest": "sha256:48beb1f660ea3d2ba0ae061631b6ab06dce3cf820f71e18db593ea9550b43f87",
      "location": {
        "type": "catalog",
        "path": "packages/echo-repl",
        "revision": {
          "type": "catalog-revision"
        }
      }
    },
    {
      "kind": "wrapped-agent",
      "name": "echo-wrapper",
      "version": "1.0.0",
      "digest": "sha256:19c6e488fa0f29398bb03a4bade14ab0ce8de8d899d1540ee1dd12158aae04ba",
      "location": {
        "type": "catalog",
        "path": "packages/echo-wrapper",
        "revision": {
          "type": "catalog-revision"
        }
      }
    }
  ]
}
```

### External-location index test input

```json
{
  "formatVersion": 1,
  "entries": [
    {
      "kind": "skill",
      "name": "echo-skill",
      "version": "1.0.0",
      "digest": "sha256:83dafd61312f34e2d3aee6630783ecf2b611a632adde9aff318d2fad39ead800",
      "location": {
        "type": "source",
        "sourceId": "other-source",
        "commit": "2222222222222222222222222222222222222222",
        "path": "packages/echo-skill"
      }
    }
  ]
}
```

### Fixed digest oracle

The fixture constants are not placeholders: Task 2 must assert these exact results rather than only comparing two calls of the implementation. File hashes, sizes, metadata and root digests above are independently computed. The complete SKILL.md file is 102 bytes and the throwing API module is 48 bytes. It is content to inspect, never import or execute.

```ts
export const fixtureDigests = {
  "skill": "sha256:83dafd61312f34e2d3aee6630783ecf2b611a632adde9aff318d2fad39ead800",
  "classic": "sha256:89dcf3abfc6f0942947a17fac61f9f6153d4b122f447853ed47734d2a093caa1",
  "rlm": "sha256:48beb1f660ea3d2ba0ae061631b6ab06dce3cf820f71e18db593ea9550b43f87",
  "wrapped": "sha256:19c6e488fa0f29398bb03a4bade14ab0ce8de8d899d1540ee1dd12158aae04ba"
} as const;
```

### Shared test and implementation conventions

Use existing colocated Vitest patterns. `fixtures.ts` (Task 2) exports `skillManifest`, `classicManifest`, `rlmManifest`, `wrappedManifest`, `catalogIndex`, `skillEntries`, `fixtureDigests`, copied literally from the complete JSON above; annotate each manifest with its narrowed kind type (SkillManifest, NativeAgentManifest or WrappedAgentManifest), and index/content with their public types so tests never rely on unsafe casts. It also exports these helpers (test-only):

```ts
import { expect } from "vitest";
import type { ContractResult } from "@orgops/schemas";
export function must<T>(result: ContractResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`fixture rejected: ${result.issues[0]?.code}`);
  return result.value;
}
export function expectCode<T>(result: ContractResult<T>, code: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected rejection");
  expect(result.issues[0]?.code).toBe(code);
}
```

Production modules use only existing dependencies; `@orgops/skills` imports schema functions/types from `@orgops/schemas`, never imports zod directly (not its declared dependency), and never imports runner modules. Export schema-side validators for caller envelopes/options as needed **within the named public interface shapes**, not by adding new product fields. Schema object entry points must share the bounded JSON validation path used by parse functions; keep the bounded JSON utility in `primitives.ts` and export `validateCatalogJson(value: unknown, maxBytes: number): ContractResult<unknown>` for content/resolver/export reuse. The utility enforces depth, scalar validity, plain objects and cumulative byte budget before schema traversal. Callers cannot raise the fixed operation limit by choosing a higher maxBytes; public high-level functions pass their specified constant. Expose `validatePackageManifest(value: unknown): ContractResult<PackageManifest>` and `validateCatalogIndex(value: unknown): ContractResult<CatalogIndex>` as object counterparts. Map wrapper resource failures to `UNSUPPORTED_WIRING` before generic schema failure without echoing raw data.

Tests may construct syntactically valid zero-digest drafts to seal changed fixtures using computePackageDigest, then inspect. Every changed-content test that is NOT specifically testing digest mismatch must reseal the fixture. In resolver cycle tests, fake mutually recursive digest graphs are mathematically self-referential: **do not fabricate purported valid hashes for a hash cycle**. Test cycle detection on a separate internal pure graph traversal helper receiving already-resolved nodes, and also test that real supplied cyclic-looking documents fail integrity or exact-pin validation before any partial resolution. Keep that traversal helper unexported from the workspace index, export only from `resolve.ts` for source-named unit testing with a definition comment explaining this test seam; signature below in Task 3. This does not add an unchecked public resolver.

Whole-phase validation after Task 4:

```bash
npm test
npm run --workspace @orgops/opscli test
npm run --workspace @orgops/schemas lint
npm run --workspace @orgops/skills lint
# Root lint short-circuits on API debt. Capture each baseline workspace separately.
for w in api agent-runner opscli admin-ui user-ui db schemas event-bus llm crypto skills events-scenario-tests; do
  npm run --workspace "@orgops/$w" lint > ".superpowers/sdd/2026-09-10-catalogs-02-package-contract/lint-$w.txt" 2>&1
  printf '%s %s\n' "$w" "$?"
done
# No staging remains after each local commit.
git diff --check
git diff --cached --exit-code
git status --short
```

Before Task 1, the parent captures a fresh Phase-2 baseline using the commands above; it should reproduce 198 Vitest tests, 3 opscli tests and existing API/runner lint debt, with schemas/skills clean. Exact read-only Phase-1 references supplied at parent approval: `/home/slamnation/www/orgops/.superpowers/sdd/2026-09-09-catalogs-01-admin-access/approved-final-fix-lint-baseline.json` (latest prior source state), `/home/slamnation/www/orgops/.superpowers/sdd/2026-09-09-catalogs-01-admin-access/continued-lint-baseline.json` (original 488 diagnostics), and `approved-final-fix-normalize-lint.py` / `approved-final-fix-compare-lint.py` under that directory's `continued-scratch/`. These diagnostic references may be consumed read-only; do not read/write its ledger or modify any Phase-1 artifact. All fresh logs/comparisons go in this phase directory. Compare diagnostics by workspace, file, code and message, ignoring line-number drift only; a count match alone is insufficient. If new exports change union rendering, document minimal text normalization and retain raw before/after evidence, never suppress new messages. Expected minimum prior suite baseline is 198 Vitest tests plus 3 opscli tests; task tests add coverage. Do not run services, scenario e2e, actual Git fetch or provider calls. Use test report evidence for review rather than rerunning unchanged tests unnecessarily.

---

### Task 1: Strict package manifests and catalog index contracts

**Files:**
- Create `packages/schemas/src/catalogs/primitives.ts`: bounded JSON parsing/validation, names, safe paths, versions/pins, shared result/issue types and limits.
- Create `packages/schemas/src/catalogs/manifest.ts`: strict package/recipe schemas and parse/object validation functions.
- Create `packages/schemas/src/catalogs/index.ts`: strict index/resolved-identity schemas and parse/object validation functions (this is the catalog schema module, not a barrel).
- Create `packages/schemas/src/catalogs/manifest.test.ts`, `packages/schemas/src/catalogs/index.test.ts`.
- Modify `packages/schemas/src/index.ts`: named public exports for the new modules only.

**Interfaces:** Consumes Zod 3 and the shared normative contract. Produces all shared schema types, `CATALOG_LIMITS`, `validateCatalogJson`, `validatePackageManifest`, `validateCatalogIndex`, `parsePackageManifest`, `parseCatalogIndex`, and named schemas listed above. Task 2 imports these through `@orgops/schemas`; no reference to Task-2 fixture support in Task-1 tests. Schemas never execute content or call active skill discovery.

- [x] **Step 1: Write failing strict-native tests** in manifest.test.ts with this self-contained initial fixture. Extend it with the complete skill/wrapped JSON examples in the shared contract (schema validation checks structure only, not root hash correctness):

```ts
import { describe, expect, it } from "vitest";
import { PackageManifestSchema, parsePackageManifest } from "./manifest";
const native = {
  formatVersion: 1, kind: "native-agent", name: "echo-agent", version: "1.0.0",
  description: "Echo.", author: "Example Authors", license: "MIT",
  compatibility: { orgops: { min: "0.0.1" }, platforms: ["linux"], tools: [] },
  secrets: [], dependencies: [], files: [], executables: [],
  digest: `sha256:${"0".repeat(64)}`,
  native: { mode: "CLASSIC", systemInstructions: "Echo.", runtime: {}, alwaysPreloadedSkills: [] },
};
describe("PackageManifestSchema", () => {
  it("accepts both explicit native modes", () => {
    for (const mode of ["CLASSIC", "RLM_REPL"]) {
      expect(PackageManifestSchema.safeParse({ ...native, native: { ...native.native, mode } }).success).toBe(true);
    }
  });
  it.each(["modelId", "assignedRunnerId", "workspacePath", "secretValues", "desiredState"])(
    "rejects local-state field %s", (key) => {
      expect(PackageManifestSchema.safeParse({ ...native, [key]: "DO_NOT_EXPORT" }).success).toBe(false);
    },
  );
  it("rejects nested unknown fields and invalid JSON without echoing text", () => {
    expect(PackageManifestSchema.safeParse({ ...native,
      native: { ...native.native, runtime: { allowOutsideWorkspace: true } },
    }).success).toBe(false);
    expect(parsePackageManifest('{"token":"DO_NOT_EXPORT"')).toEqual({
      ok: false, issues: [{ code: "INVALID_JSON", at: "$" }],
    });
  });
});
```

- [x] **Step 2: Run red tests**, record the missing-module failure (not an infrastructure error):

```bash
npm exec --no -- vitest run packages/schemas/src/catalogs/manifest.test.ts packages/schemas/src/catalogs/index.test.ts
```

- [x] **Step 3: Implement primitives and schema composition** using strict objects, tuple version comparator and explicit refinements. Concrete implementation pattern:

```ts
import { z } from "zod";
export const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
export const CommitSchema = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
export const VersionSchema = z.string().regex(/^(?:0|[1-9][0-9]{0,5})\.(?:0|[1-9][0-9]{0,5})\.(?:0|[1-9][0-9]{0,5})$/);
const RevisionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("exact"), commit: CommitSchema }).strict(),
  z.object({ type: z.literal("same-package-revision") }).strict(),
]);
// Construct three strict kind objects from one shared shape; discriminate before
// cross-field superRefine so Zod 3 receives objects, not ZodEffects members.
```

For bounded JSON validation, walk JSON-only values using an explicit depth/count budget, examine property descriptors rather than invoking accessors, reject own accessor/nonenumerable/symbol properties and nonplain prototypes, count UTF-8 serialization bytes including punctuation/escaped keys/scalars; fail once budget exceeded, not after building an unbounded serialized copy. Strings themselves can be length-prechecked (maxChars ≤ maxBytes) before JSON.stringify; cap array length/property count by maxBytes before child traversal. Reject duplicate raw JSON object keys in string parsing? **JSON parsing uses standard JSON.parse last-key semantics; duplicate-key rejection is NOT claimed for raw JSON text**, but every parsed identity/inventory/set duplicate is rejected. Document this boundary; canonical digest covers parsed semantics, not lexical duplicates. After bounded parse, strict schemas reject unknown fields; don't reuse permissive AgentSchema.

- [x] **Step 4: Add source/path/index negative cases** with explicit table-driven tests. This initial path code belongs in index.test.ts:

```ts
import { expect, it } from "vitest";
import { RelativePathSchema } from "./primitives";
import { CatalogIndexSchema } from "./index";
it.each(["../x", "/x", "C:/x", "a\\b", "a//b", "a/./b", "a/%2e/b", "a/CON.txt", "a/.git/x", "a/node_modules/x", "a."])(
  "rejects unsafe portable path %s", path => expect(RelativePathSchema.safeParse(path).success).toBe(false),
);
it("rejects duplicate release identities and unknown source URLs", () => {
  const entry = { kind: "skill", name: "echo-skill", version: "1.0.0",
    digest: `sha256:${"0".repeat(64)}`, location: { type: "catalog", path: "packages/echo-skill", revision: { type: "catalog-revision" } } };
  expect(CatalogIndexSchema.safeParse({ formatVersion: 1, entries: [entry, entry] }).success).toBe(false);
  expect(CatalogIndexSchema.safeParse({ formatVersion: 1,
    entries: [{ ...entry, location: { type: "source", url: "https://example.invalid/repo", path: "pkg" } }],
  }).success).toBe(false);
});
```

Also assert: format 2 rejected; native mode WRAPPED rejected; prerelease/range/tag/uppercase/short commits rejected; min==max and reversed compatibility rejected; duplicate dependency/secrets/tools/preload/sidecars rejected; unknown fields in every nested object (secret.value, source.path, setup.env, runtime.env, suggestedModel.id); wrapped file/dependency/wiring failures; inventory case/prefix duplicates; same-repo location with missing revision or bare commit rejected; same-repo exact and catalog-revision forms accepted; valid external location with exact commit accepted; 262144-byte boundary vs +1, index 2097152 vs +1, depth32 vs33, cyclic object/accessor rejected without evaluation, lone surrogates rejected. Assert valid input is not mutated and result errors contain pointers/codes only.

- [x] **Step 5: Run green tests/typecheck**, correct only this task's defects, then inspect diff:

```bash
npm exec --no -- vitest run packages/schemas/src/catalogs packages/schemas/src/index.test.ts
npm run --workspace @orgops/schemas lint
git diff --check
```

- [x] **Step 6: Commit locally and hand off for fresh parent-owned task review** (spec compliance + quality); include red/green outputs and changed-file evidence. Review fixes stay within this interface or escalate to parent.

```bash
git add packages/schemas/src/catalogs packages/schemas/src/index.ts
git commit -m "feat(catalogs): define strict portable package contracts"
git diff --cached --exit-code
```

### Task 2: Bounded inert content inspection and deterministic integrity

**Files:**
- Create `packages/skills/src/catalogs/content.ts`: canonical digest, content validation, detached immutable snapshots, execution and sensitive-text preview.
- Create `packages/skills/src/catalogs/skill-document.ts`: inert YAML/frontmatter parsing only.
- Create `packages/skills/src/catalogs/content.test.ts`, `skill-document.test.ts`, `fixtures.ts` (shared fixture constants/test helpers described above).
- Modify `packages/skills/src/index.ts`: exports for ContentEntry, InspectedFile, ExecutionPreview, PackageSnapshot, computePackageDigest, inspectPackage, parseSkillDocument only; no active loader behavior changes.

**Interfaces:** Consumes Task-1 `PackageManifest`, `ContractResult`, `ReviewWarning`, `CATALOG_LIMITS`, validators and strict schemas via `@orgops/schemas`. Produces the exact shared content APIs. Task 3 revalidates untrusted snapshot inputs via inspectPackage; Task 4 uses computePackageDigest and inspectPackage to seal candidates. Only Node crypto/Buffer/TextDecoder and existing yaml are needed.

- [x] **Step 1: Write fixed-oracle and inertness tests**; create fixture constants from the complete JSON above (do not calculate expected fixture digests with production code):

```ts
import { expect, it } from "vitest";
import { computePackageDigest, inspectPackage } from "./content";
import { must, expectCode, skillManifest, skillEntries, fixtureDigests } from "./fixtures";
it("hashes exact bytes and metadata with a fixed independent oracle", () => {
  expect(must(computePackageDigest(skillManifest, skillEntries))).toBe(fixtureDigests.skill);
  expect(must(computePackageDigest(skillManifest, [...skillEntries].reverse()))).toBe(fixtureDigests.skill);
  expect(must(computePackageDigest({ ...skillManifest, author: "Other Authors" }, skillEntries)))
    .not.toBe(fixtureDigests.skill);
  expectCode(inspectPackage({ ...skillManifest, author: "Other Authors" }, skillEntries), "DIGEST_MISMATCH");
});
it("inspects a throwing event module as bytes and discloses API execution", () => {
  const snapshot = must(inspectPackage(skillManifest, skillEntries));
  expect(snapshot.execution.apiEventShapes).toEqual(["event-shapes.ts"]);
  expect(snapshot.execution.runnerScripts).toEqual([]);
  expect(snapshot.warnings).toContainEqual({ code: "MANUAL_REVIEW_REQUIRED", at: "$" });
  expect(Object.isFrozen(snapshot.manifest.files)).toBe(true);
});
it("rejects links rather than dereferencing even internal targets", () => {
  expectCode(inspectPackage(skillManifest, [
    ...skillEntries, { type: "symlink", path: "alias", target: "SKILL.md" },
  ]), "UNSUPPORTED_ENTRY");
});
```

- [x] **Step 2: Run red tests** and record missing-module failure:

```bash
npm exec --no -- vitest run packages/skills/src/catalogs/content.test.ts packages/skills/src/catalogs/skill-document.test.ts
```

- [x] **Step 3: Implement byte checks and canonical hashing** in this deterministic order: bounded JSON-only descriptor validation of manifest (262144 bytes) and entries (12582912 bytes), before reading their values; entry count/aggregate encoded-size bound; entry shape/kind/path/duplicates; canonical base64 decoded length and bytes; strict bounded manifest; exact inventory; SKILL parse; executable checks; digest comparison for inspection; deep-copy/freeze preview. Avoid Buffer allocation for oversized entries. SHA primitive and scalar/object canonicalization are concrete:

```ts
import { createHash } from "node:crypto";
function sha256(bytes: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
// Call only on JSON already bounded/validated; semantic set arrays are sorted
// on a detached manifest copy before this function. Do not sort command args.
function canonicalJson(value: null | boolean | number | string | unknown[] | Record<string, unknown>): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item as Parameters<typeof canonicalJson>[0])).join(",")}]`;
  return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${canonicalJson(value[key] as Parameters<typeof canonicalJson>[0])}`,
  ).join(",")}}`;
}
```

Use bounded validated JSON values in the real implementation so these casts cannot conceal arbitrary objects. Node Buffer decoding is permissive: regex/padding/length/re-encode validation is mandatory. Freeze recursively after constructing new objects; string content avoids mutable Uint8Array exposure. Manifest inventory provides cryptographic coverage only after actual bytes match. Do not make snapshot acceptance depend on current process.cwd, host platform, filesystem, discovery roots or any dynamic import.

- [x] **Step 4: Add SKILL/YAML tests before implementing that parser**:

```ts
import { expect, it } from "vitest";
import { parseSkillDocument } from "./skill-document";
import { expectCode } from "./fixtures";
it("accepts portable frontmatter without activating extra metadata", () => {
  expect(parseSkillDocument("---\nname: echo-skill\ndescription: Echo instructions.\nmetadata:\n  command: never-run\n---\nBody.\n", "echo-skill"))
    .toEqual({ ok: true, value: { name: "echo-skill", description: "Echo instructions." } });
});
it("accepts frontmatter-only skills", () => {
  expect(parseSkillDocument("---\nname: echo-skill\ndescription: Echo.\n---\n", "echo-skill"))
    .toEqual({ ok: true, value: { name: "echo-skill", description: "Echo." } });
});
it.each([
  "---\nname: wrong\ndescription: Echo.\n---\nBody.",
  "---\nname: echo-skill\nname: echo-skill\ndescription: Echo.\n---\nBody.",
  "---\nname: echo-skill\ndescription: &a Echo\nmetadata: *a\n---\nBody.",
  "---\nname: echo-skill\ndescription: !custom Echo\n---\nBody.",
])("rejects malformed/mismatched or executable-tag frontmatter", text => {
  expectCode(parseSkillDocument(text, "echo-skill"), "INVALID_SKILL");
});
```

Use YAML AST node inspection to reject anchors/aliases and explicit nonstandard tags before `.toJS()` (avoid alias expansion). Never call `loadSkillMeta` or `loadSkillEventShapes`. Add frontmatter-only acceptance, body/frontmatter delimiter, nonstring field, invalid UTF8 and description/license mismatch coverage. YAML is inert; tags never authorize code.

- [x] **Step 5: Add complete content adversarial matrix**, run each negative before its minimal fix: 257 entries; per-file +1; total +1; invalid/unpadded/oversized base64; file+directory prefix and case collisions; every link/special variant; missing/extra inventory; size/hash/executable mismatch; undeclared root API module (chmod false); script suffix/shebang/chmod detection; wrong API declaration; case-variant API filename; preserve arg/sidecar order while file/inventory/secret/dependency/tool orders hash identically; text/metadata/flags/args changes affect digest; root digest field changes do not affect compute but fail inspect; input mutation after inspect cannot alter snapshot; inspect never mutates input; source/commands remain exact preview data; warning scanner synthetic token string only in preview, never warning/error. Reseal altered fixture metadata when testing downstream checks. Add all four exact fixture digest assertions. No mocked active importer is needed to fake safety: the throwing module fixture must successfully inspect, and source imports must show no execution dependencies.

- [x] **Step 6: Verify green tests/typechecks and local commit**, then parent-owned fresh task review:

```bash
npm exec --no -- vitest run packages/skills/src/catalogs/content.test.ts packages/skills/src/catalogs/skill-document.test.ts packages/skills/src/index.test.ts packages/schemas/src/catalogs
npm run --workspace @orgops/schemas lint
npm run --workspace @orgops/skills lint
git diff --check
git add packages/skills/src/catalogs/content.ts packages/skills/src/catalogs/content.test.ts packages/skills/src/catalogs/skill-document.ts packages/skills/src/catalogs/skill-document.test.ts packages/skills/src/catalogs/fixtures.ts packages/skills/src/index.ts
git commit -m "feat(catalogs): inspect bounded package content without execution"
git diff --cached --exit-code
```

### Task 3: Pure exact-pinned dependency resolution

**Files:**
- Create `packages/skills/src/catalogs/resolve.ts`, `resolve.test.ts`.
- Modify `packages/skills/src/index.ts`: named resolver API/types only.

**Interfaces:** Consumes Task-1 manifests/catalogs/pins/ResolvedIdentity, Task-2 snapshot/content validation. Produces exact shared `CatalogSnapshot`, `SuppliedPackage`, `InstalledSkill`, `ResolveInput`, `ResolvedPackage`, `Resolution`, `resolvePackages`. Inputs include all source permissions and measured installed content; no disk or network adapter. Test-only direct-module helper (not a workspace public export):

```ts
export function orderDependencyGraph(
  roots: readonly string[],
  dependencies: ReadonlyMap<string, readonly string[]>,
): ContractResult<readonly string[]>;
// IDs supplied by resolved immutable identity serialization, for equality/dedupe only.
// Preserve caller-supplied root/edge order: resolver sorts roots by (catalogId,name,version)
// and dependencies by (catalogId,sourceId,name) before calling this helper.
// Returns dependency-first IDs, rejects missing node, cycles, >256 nodes or depth>64.
// resolvePackages assembles the graph with bounded iterative expansion/dedupe,
// then calls this ONE helper for DFS ordering/cycle/depth checks. No second DFS.
// Memoize completed subtree heights so a shared node reached by a longer path
// cannot bypass the 64-edge maximum dependency-chain check.
```

Using an internal traversal test seam is necessary because integrity-covered exact dependency digests cannot construct a genuine finite cryptographic cycle fixture. Real public inputs still fail closed; don't bypass validation just to test a cycle.

- [x] **Step 1: Write valid contextual-pin and source-policy tests** using this complete resolver fixture constructor in resolve.test.ts:

```ts
import { expect, it } from "vitest";
import { inspectPackage } from "./content";
import { resolvePackages, orderDependencyGraph, type ResolveInput } from "./resolve";
import { must, expectCode, skillManifest, classicManifest, skillEntries, catalogIndex } from "./fixtures";
const commit = "1111111111111111111111111111111111111111";
function input(): ResolveInput {
  return {
    roots: [{ catalogId: "team", name: "echo-agent", version: "1.0.0" }],
    catalogs: [{ catalogId: "team", sourceId: "team-source", commit, enabled: true, index: catalogIndex }],
    packages: [
      { sourceId: "team-source", commit, path: "packages/echo-skill", snapshot: must(inspectPackage(skillManifest, skillEntries)) },
      { sourceId: "team-source", commit, path: "packages/echo-agent", snapshot: must(inspectPackage(classicManifest, [])) },
    ],
    allowedSourceIds: ["team-source"],
    target: { orgopsVersion: "0.0.1", platform: "linux", tools: ["node"] },
    installedSkills: [], knownReleases: [],
  };
}
it("expands contextual pins and returns dependency-first exact provenance", () => {
  const result = must(resolvePackages(input()));
  expect(result.packages.map(p => p.identity.name)).toEqual(["echo-skill", "echo-agent"]);
  expect(result.packages[0]?.identity).toEqual({ catalogId: "team", catalogCommit: commit,
    sourceId: "team-source", packageCommit: commit, path: "packages/echo-skill",
    kind: "skill", name: "echo-skill", version: "1.0.0", digest: skillManifest.digest });
});
it("does not turn publisher source references into permission", () => {
  const value = input(); value.allowedSourceIds = [];
  expectCode(resolvePackages(value), "SOURCE_NOT_ALLOWED");
  expect(value.allowedSourceIds).toEqual([]);
});
it("keeps historical same-repository releases pinned across catalog refresh", () => {
  const value = structuredClone(input());
  const original = must(resolvePackages(value));
  value.knownReleases = original.packages.map(p => p.identity);
  const skill = original.packages[0]!;
  value.installedSkills = [{ name: skill.identity.name, identity: skill.identity, currentDigest: skill.identity.digest }];
  const refreshedCatalog = value.catalogs[0]!;
  refreshedCatalog.commit = "2222222222222222222222222222222222222222";
  for (const entry of refreshedCatalog.index.entries) {
    if (entry.location.type === "catalog") entry.location.revision = { type: "exact", commit };
  }
  const refreshed = must(resolvePackages(value));
  expect(refreshed.packages[0]?.action).toBe("reuse");
  expect(refreshed.packages[0]?.identity.packageCommit).toBe(commit);
  expect(refreshed.packages[0]?.identity.catalogCommit).toBe(refreshedCatalog.commit);
  const oldEntry = refreshedCatalog.index.entries.find(e => e.name === "echo-agent")!;
  if (oldEntry.location.type !== "catalog") throw new Error("wrong fixture location");
  oldEntry.location.revision = { type: "catalog-revision" };
  // Supply identical bytes at B to isolate changed identity, not missing bytes.
  value.packages = [...value.packages, { ...value.packages[1]!, commit: refreshedCatalog.commit }];
  expectCode(resolvePackages(value), "IDENTITY_CONFLICT");
});
it("rejects aggregate JSON before schema traversal or reading accessor values", () => {
  expectCode(resolvePackages({ ...input(), ...{ extra: "x".repeat(67108864) } }), "LIMIT_EXCEEDED");
  const value = input(); let reads = 0;
  Object.defineProperty(value, "roots", { enumerable: true, get() { reads++; return []; } });
  expectCode(resolvePackages(value), "INVALID_JSON");
  expect(reads).toBe(0);
});
it("rejects cycles and deduplicates a diamond in the actual ordering helper", () => {
  expectCode(orderDependencyGraph(["a"], new Map([["a", ["b"]], ["b", ["a"]]])), "CYCLE");
  expect(must(orderDependencyGraph(["a"], new Map([
    ["a", ["b", "c"]], ["b", ["d"]], ["c", ["d"]], ["d", []],
  ])))).toEqual(["d", "b", "c", "a"]);
});
```

- [x] **Step 2: Run red tests**:

```bash
npm exec --no -- vitest run packages/skills/src/catalogs/resolve.test.ts
```

- [x] **Step 3: Implement policy-bound map construction, pin expansion and graph ordering**. Use tuples encoded by JSON.stringify for identity keys, never ambiguous delimiter concatenation. Concrete pin expansion guidance:

```ts
function resolveDependencyCommit(pin: DependencyPin, declaring: ResolvedIdentity): ContractResult<string> {
  if (pin.revision.type === "exact") return { ok: true, value: pin.revision.commit };
  if (pin.sourceId !== declaring.sourceId) {
    return { ok: false, issues: [{ code: "UNSUPPORTED_DEPENDENCY", at: "dependencies.revision" }] };
  }
  return { ok: true, value: declaring.packageCommit };
}
function contentIdentityKey(identity: ResolvedIdentity): string {
  return JSON.stringify([identity.catalogId, identity.sourceId, identity.name,
    identity.version, identity.kind, identity.packageCommit, identity.path, identity.digest]);
}
```

Imports come from `@orgops/schemas`. Revalidate selected supplied snapshot bytes rather than trusting `.execution/.warnings`. Build bounded unique lookup maps, enforce enabled/allowed catalog and package sources, compare exact pin/entry/manifest tuples, compare known mapping, apply tuple compatibility, then build the edge graph with a bounded iterative queue and identity dedupe (no recursive graph assembly). Run the one shared ordering helper for cycle/depth/order checks; don't duplicate recursive visiting logic. Root selection by exact version only. Preserve separate catalog/package commit in output; compare content equivalence without catalogCommit. Frozen detached output, deterministic roots/edges/errors, no callbacks that can fetch or mutate stores. Installed collisions include unrelated untracked same-name skills; no reuse based only on name/version or manifest's claimed digest.

- [x] **Step 4: Add concrete mismatch/conflict tests**, including this installed-content test:

```ts
it("reuses only unmodified installed identity and refuses silent replacement", () => {
  const value = input();
  const skill = must(resolvePackages(value)).packages[0]!;
  value.installedSkills = [{ name: "echo-skill", identity: skill.identity, currentDigest: skill.identity.digest }];
  expect(must(resolvePackages(value)).packages[0]?.action).toBe("reuse");
  value.installedSkills[0]!.currentDigest = `sha256:${"f".repeat(64)}`;
  expectCode(resolvePackages(value), "SKILL_CONFLICT");
});
```

Required matrix: missing catalog, disabled catalog, denied catalog source, allowed catalog+denied external source, external allowed success preserving distinct commits; exact revision mismatch and no fallback to another version; contextual pin wrong source; missing bytes/release; forged snapshot inventory/hash/preview; entry kind/name/version/digest mismatch; known logical release repointed path/commit/digest (IDENTITY_CONFLICT), catalog A → B with old catalog-relative releases frozen to exact A, unchanged known/installed identity reused and new catalog provenance B; unfrozen contextual old release rejected; unchanged explicit external release remains stable across catalog refresh; duplicate catalogs/packages/releases/installed names; native dependency on native (UNSUPPORTED_DEPENDENCY), wrapped dependency (UNSUPPORTED_WIRING); skill→skill allowed; same runtime name across sources/versions/catalognames conflicts; missing tool/platform/min/max incompatibility; diamond public resolution once per pin; depth64 accepted/65 rejected and 256 nodes accepted/257 rejected in helper, cumulative decoded bytes and aggregate encoded/metadata JSON bounds (including 4096 large manifests rejected before schema/hash); accessor rejection without evaluating getters; longer diamond path cannot bypass depth limit; arrays shuffled produce identical ordered plan and no input mutation; real malformed cyclic-looking pins rejected without partial output. Error test assertions must use codes and safe `at` only, not secret-containing raw diagnostics.

To test native dependency on native, create a sealed native leaf and a sealed referring native with an exact digest pin to that leaf, update the supplied index coherently, then assert unsupported relationship; do not pass an intentionally wrong hash and mistake DIGEST_MISMATCH for graph coverage. To test same-name conflict, use two catalogs each with a valid sealed skill of the same name and roots referencing both, not a duplicate invalid index. The helper is tested for pathological graphs; public tests are always integrity-valid except explicit corruption cases.

- [x] **Step 5: Green validation and local commit**, then fresh parent-owned task review:

```bash
npm exec --no -- vitest run packages/skills/src/catalogs/resolve.test.ts packages/skills/src/catalogs/content.test.ts packages/schemas/src/catalogs
npm run --workspace @orgops/schemas lint
npm run --workspace @orgops/skills lint
git diff --check
git add packages/skills/src/catalogs/resolve.ts packages/skills/src/catalogs/resolve.test.ts packages/skills/src/index.ts
git commit -m "feat(catalogs): resolve exact permitted package dependencies"
git diff --cached --exit-code
```

### Task 4: Explicit portable export, selected skill packaging and public examples

**Files:**
- Create `packages/skills/src/catalogs/export.ts`, `export.test.ts`.
- Modify `packages/skills/src/index.ts`: named export functions/types only.
- Create `docs/catalog-package-contract.md`: implemented API, schemas, digest algorithm, caller staging/source contracts, warning/preview semantics, unsupported wiring and future adapter limits.
- Create `docs/examples/catalogs/skill.json`, `native-classic.json`, `native-rlm.json`, `wrapped.json`, `index.json`: exact complete fixture manifests/index above. Public contract doc contains the exact decoded SKILL.md/API module contents and an in-memory example loading them, not a disk installer.
- Modify `docs/SPEC.md`: add implemented package-contract module/API section and explicitly no catalog routes/storage/install/start/publishing behavior yet. Preserve current runner/auth behavior descriptions.

**Interfaces:** Consumes Tasks 1–3 public schemas, content snapshot/digest and resolver; produces exact `AgentExportOptions`, `SkillExportOptions`, `ExportCandidate`, exportAgentPackage, exportSkillPackage interfaces. Test fixtures and must/expectCode from Task 2; resolver for round-trip public module tests. No DB/runner imports, copied rows, services, fetch or execution.

- [x] **Step 1: Write native allowlist red tests** with fabricated API-shaped row and explicit option metadata. Use `classicManifest` narrowed by its annotated NativeAgentManifest type in fixtures.ts:

```ts
import { expect, it } from "vitest";
import { exportAgentPackage, exportSkillPackage } from "./export";
import { must, expectCode, classicManifest, skillManifest, skillEntries } from "./fixtures";
function metadata() {
  const m = classicManifest;
  return { formatVersion: m.formatVersion, name: m.name, version: m.version,
    description: m.description, author: m.author, license: m.license,
    compatibility: m.compatibility, secrets: m.secrets };
}
it("positively selects native fields, not row bindings or live state", () => {
  const result = must(exportAgentPackage({
    mode: "CLASSIC", systemInstructions: "Share this prompt.", soulContents: "Share this soul.",
    enabledSkills: ["echo-skill"], alwaysPreloadedSkills: ["echo-skill"],
    modelId: "DO_NOT_EXPORT_MODEL", assignedRunnerId: "DO_NOT_EXPORT_RUNNER",
    workspacePath: "/DO_NOT_EXPORT_WORKSPACE", soulPath: "/DO_NOT_EXPORT_SOUL",
    desiredState: "RUNNING", memory: "DO_NOT_EXPORT_MEMORY", secrets: { token: "DO_NOT_EXPORT_SECRET" },
    unknownFutureState: "DO_NOT_EXPORT_STATE", allowOutsideWorkspace: true,
  }, { metadata: metadata(), dependencies: classicManifest.dependencies }));
  const manifestText = Buffer.from(result.proposedFiles.find(f => f.path === "orgops-package.json")!.base64, "base64").toString("utf8");
  expect(manifestText).not.toContain("DO_NOT_EXPORT");
  expect(result.snapshot.manifest.kind).toBe("native-agent");
  if (result.snapshot.manifest.kind !== "native-agent") throw new Error("wrong kind");
  expect(result.snapshot.manifest.native.systemInstructions).toBe("Share this prompt.");
  expect(result.snapshot.manifest.native.soulContents).toBe("Share this soul.");
  expect(manifestText).not.toContain("allowOutsideWorkspace");
});
it("omits dormant classic tuning from an RLM export without changing the API row", () => {
  const raw = { mode: "RLM_REPL", systemInstructions: "Return done(1).", enabledSkills: [], classicMaxModelSteps: 8 };
  const before = structuredClone(raw);
  const candidate = must(exportAgentPackage(raw, { metadata: metadata(), dependencies: [] }));
  expect(candidate.snapshot.manifest.kind).toBe("native-agent");
  if (candidate.snapshot.manifest.kind !== "native-agent") throw new Error("wrong kind");
  expect(candidate.snapshot.manifest.native.mode).toBe("RLM_REPL");
  expect(candidate.snapshot.manifest.native.runtime).not.toHaveProperty("classicMaxModelSteps");
  expect(raw).toEqual(before);
});
it("does not infer exact dependency pins from enabled names", () => {
  expectCode(exportAgentPackage({ mode: "CLASSIC", systemInstructions: "Echo.", enabledSkills: ["echo-skill"] },
    { metadata: metadata(), dependencies: [] }), "UNSUPPORTED_EXPORT");
});
```

- [x] **Step 2: Run red tests**:

```bash
npm exec --no -- vitest run packages/skills/src/catalogs/export.test.ts
```

- [x] **Step 3: Implement explicit candidate construction**. Bound raw JSON/options; never spread raw row/config. Build base fields from strict metadata options and copy native/wrapped allowlists property by property; validate every selected value (no truthiness-based coercion). Recipe configuration unknown keys/env/path fail rather than dropping executable semantics. Core sealing sequence (internal function, exact public types above):

```ts
function seal(manifest: PackageManifest, entries: readonly ContentEntry[]): ContractResult<PackageSnapshot> {
  const digest = computePackageDigest(manifest, entries);
  if (!digest.ok) return digest;
  // This spread is of the already constructed strict portable manifest, never raw agent/config.
  return inspectPackage({ ...manifest, digest: digest.value }, entries);
}
```

Imports come from existing workspaces/module files. Optional copied fields are added only if valid present values; null tuning omitted. For wrapped config, separate exact-key checks from positive property reads and reconstruct each command/source/session/sidecar. Do not feed normalizedWrappedConfig or `asRecord` from the runner into portable schema: those are deliberately permissive and may contain machine paths/env. No change to the existing runner is required or allowed. Skill candidate inventory derives actual selected decoded bytes; seal against matching SKILL frontmatter/explicit executable declarations. Full proposedFiles include canonical manifest serialization and byte-identical selected content. Freeze after detached construction.

- [x] **Step 4: Add selected-file, wrapped rejection and sensitive-text tests**:

```ts
it("rejects wrapped env and unsupported resource injection", () => {
  const opts = { metadata: metadata(), dependencies: [] };
  expectCode(exportAgentPackage({ mode: "WRAPPED", wrappedConfig: {
    runtime: { command: "printf ok", env: { TOKEN: "DO_NOT_EXPORT" } },
  } }, opts), "UNSUPPORTED_EXPORT");
  expectCode(exportAgentPackage({ mode: "WRAPPED", enabledSkills: ["echo-skill"], wrappedConfig: {
    runtime: { command: "printf ok" },
  } }, opts), "UNSUPPORTED_WIRING");
});
it("packages exactly selected skill files and surfaces suspicious authored text", () => {
  const m = skillManifest;
  const opts = {
    metadata: { formatVersion: m.formatVersion, name: m.name, version: m.version,
      description: m.description, author: m.author, license: m.license,
      compatibility: m.compatibility, secrets: m.secrets },
    dependencies: [], executables: m.executables, selectedPaths: ["SKILL.md", "event-shapes.ts"],
  };
  const candidate = must(exportSkillPackage([...skillEntries,
    { type: "file", path: "notes.txt", base64: Buffer.from("private notes").toString("base64"), executable: false },
  ], opts));
  expect(candidate.proposedFiles.map(f => f.path)).toEqual(["SKILL.md", "event-shapes.ts", "orgops-package.json"]);
  expect(candidate.snapshot.manifest.digest).toBe(m.digest);
  const native = must(exportAgentPackage({ mode: "CLASSIC", enabledSkills: [],
    systemInstructions: "token=synthetic-warning-example",
  }, { metadata: metadata(), dependencies: [] }));
  expect(native.snapshot.warnings).toContainEqual({ code: "SENSITIVE_TEXT", at: "native.systemInstructions" });
  expect(JSON.stringify(native.snapshot.warnings)).not.toContain("synthetic-warning-example");
});
```

Additional matrix: CLASSIC/RLM parity, RLM dormant classic setting omission with source-row immutability, null tuning omission, model suggestion explicit options only, raw camelCase requirement and ambiguous dual spelling failure, malformed scalar/nested selected fields, unrelated local-state fields ignored not serialized, declaration `secret.value` invalid, empty/missing/duplicate/unsafe selections, selected .env/.ssh credential path rejected, unselected file absent, unselected link rejected, binary preserved with manual review, missing SKILL.md, mismatched frontmatter, executable declaration for omitted file rejected; wrapped setup/check/sidecar/turn preview includes every command+args with setup/sidecar checks inheriting owning args, source URL/PAT/path rejected, ref hint warning, cwd host/traversal rejected, alias cli normalized and raw config unknown fields rejected, wrapped ignored native soul not portrayed as injected, all returned arrays/objects detached frozen. Inspect candidates again and resolve a sealed native+skill example through exported public API with exact pinned identity.

- [x] **Step 5: Add full public examples and contract documentation**, copy exact JSON vectors from shared section. Tests read only those checked-in docs fixtures (using import.meta.url-relative file URLs), parse/inspect against fixture bytes and assert their digests match fixed oracle; schema-only docs tests are not enough. Include this public import smoke test to prove discoverability:

```ts
import { inspectPackage as publicInspect, resolvePackages as publicResolve,
  exportAgentPackage as publicExport } from "../index";
// In export.test.ts under src/catalogs, the workspace index is ../index.ts.
it("exposes inert contract functions from the existing workspace", () => {
  expect(publicInspect).toBeTypeOf("function");
  expect(publicResolve).toBeTypeOf("function");
  expect(publicExport).toBeTypeOf("function");
});
```

Document exact schema/parser/export signatures, all bounds, contextual commits and freezing historical catalog-relative pins during index edits, known-release immutability, installed-currentDigest trust contract, warning limitations, sidecar/args ordering and root digest coverage. State positively what is implemented and negatively what is not: no authenticated Git discovery, URL policy adapter, extraction, approval, activation, stopped-agent install, model/secret binding, start gate, publication or secret safety guarantee. Wrapped `source.ref` is an external-runtime hint, not an immutable package checkout. Examples are inert package format samples; the throwing event module deliberately fails if activated and is never a runnable production skill recommendation.

- [x] **Step 6: Run green focused tests and whole-phase commands** from shared validation section, compare existing lint debt with zero added diagnostics, record raw outputs in this phase's scratch directory. No installs/service startup. Update docs/SPEC.md only to reflect actual completed public APIs, not future promises.

```bash
npm exec --no -- vitest run packages/skills/src/catalogs packages/schemas/src/catalogs packages/skills/src/index.test.ts packages/schemas/src/index.test.ts
npm run --workspace @orgops/schemas lint
npm run --workspace @orgops/skills lint
git diff --check
```

- [x] **Step 7: Commit locally**, verify empty index and submit fresh parent-owned task review. Whole-phase review is a separate gate recorded in the execution status above. Every execution report must include changed files, tests added/updated, exact commands and outcomes, remaining baseline diagnostics/risks, commit HEAD and no-staged-files evidence. Task review approval is not inferred from a report filename.

```bash
git add packages/skills/src/catalogs/export.ts packages/skills/src/catalogs/export.test.ts packages/skills/src/index.ts docs/catalog-package-contract.md docs/examples/catalogs docs/SPEC.md
git commit -m "feat(catalogs): export portable packages with explicit previews"
git diff --cached --exit-code
```
