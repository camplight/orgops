# Offline Catalog Publication Preparation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The parent owns dispatch/review; a dispatched worker must never launch nested agents.

**Goal:** Prepare one bounded, inert, fully reviewable package-and-index proposal against one explicitly selected immutable repository base, without publishing anything.

**Architecture:** Compose the existing pure exporters, parsers, inspection and resolver. A trusted caller supplies complete bounded immutable repository inventory, exact old index bytes, retained release history and independent source policy; the library checks consistency but cannot authenticate those assertions. New releases remain contextual in the proposed index; a private collision-free temporary resolution context lets the unchanged resolver check the complete dependency closure without exposing a fictitious Git commit.

**Tech Stack:** TypeScript, existing Zod contracts, Node byte/crypto primitives, Vitest, npm workspaces; no added dependencies.

**Spec:** `docs/superpowers/specs/2026-09-09-skill-agent-catalogs-design.md`, sections 5/9 only. Read the full current `docs/SPEC.md`, `docs/catalog-package-contract.md`, repository `AGENTS.md` and Phase-6 `controller-brief.md` before execution.

## Execution status (parent accepted)

Tasks 1–3 are implemented, locally committed and task-reviewed: `dee3697`, `f4ceca0`, `47e99fd`. Task 1/2 approvals are recorded in the phase ledger at the following task preflights; Task 3 approval is supplied in the final-validation handoff. Empty review Markdown placeholders are not approval evidence.

Checked boxes record completed reviewed deliverables, not a claim that every supplemental case was observed failing first. The phase ledger preserves actual missing-module and behavioral RED logs, immediately passing supplemental tests, corrected fixture mistakes, the approved raw-index ordering clarification, ancestor collision hardening and reduced-output-budget guard test. These disclosures remain part of the execution record.

Fresh parent `parent-verify.sh parent-final` at `49466edf0b90e36f42e3b1d55fc21cca0f044a10`: Vitest **1557 tests / 44 files**, opscli **3 passed**. Root lint remains **exit 2**, not green. All 12 workspaces ran separately: API **486** and runner **2** existing diagnostics; ten others, including skills/schemas, clean. Exact baseline comparison (file, source position, TS code, full multiline message and multiplicity; repository-prefix normalization only): **488 before / 488 after, added 0 / removed 0**. Raw logs and comparison are under `.superpowers/sdd/2026-09-10-catalogs-06-offline-publication-preparation/parent-final-*`. Parent also ran the documented complete synthetic example successfully (three changed files, one release).

Only pure offline publication proposal preparation is implemented. Live repository fetch/refresh, imports, approval/activation, credential access, publishing services and two-instance publication acceptance remain outside this phase. No dependencies/lockfiles changed. Whole-phase review and fresh parent acceptance are complete; see phase-local `parent-acceptance.md`. The review's stale task-status note is corrected in the design tracking. Acceptance and passing tests confer no publishing authority.

## Global Constraints

- Work only in `/home/slamnation/www/orgops`, branch `88-move-private-skills-into-a-private-repo`; initial HEAD `3a6f8d3792af313badf1574573e60bab81a3c8c8`. No worktrees, pushes, merges, remote writes, actual publication, production state/services or credentials.
- This is an offline/pure library slice, not GitHub publishing, authenticated provenance, approval, installation, activation, API/UI, DB, runner or transport work. Production code performs no filesystem, DB, network or process I/O and executes no package code. Tests added here use in-memory synthetic data only.
- “Export from an explicit allowlist of portable fields and selected package files, not a broad database/workspace dump.” Existing export allowlists and wrapped `resourceWiring: "none"` subset remain binding.
- “No automatic dependency source registration, version substitution, or upstream overwrite.” No ownership transfer, implicit destination, permission grant, credential routing, multi-repository transaction or new approval/override policy.
- “Published release identities must not silently change their pinned contents.” A new digest/location/content requires a new version. Old contextual entries must freeze at their owning base commit, not the future index commit.
- “User-authored prompts, files and commands may still contain embedded sensitive text.” Complete file review is mandatory information; supplementary scanning is not safety certification and does not authorize or forbid later submission.
- npm only; no installation, dependency or lock changes. No suppression casts (`as any`), `ts-ignore` or unrelated lint repair. Skills/schemas and the other eight previously clean workspaces stay clean; API486/runner2 existing diagnostics are allowed only with exact zero-added comparison.
- One writer, then parent-owned fresh read-only review per task. Record TASK_BASE, commands/raw logs, local scoped commit, clean index and review diff. Infrastructure/runtime/extension/output-contract failure is a hard stop with exact error/cwd/branch/HEAD/status/diff; ordinary test errors are diagnosed locally.
- All execution artifacts go under `.superpowers/sdd/2026-09-10-catalogs-06-offline-publication-preparation/` (abbreviated `D` below); previous phases are read-only. Planner report is `D/planning-report.md`. Parent reviews this entire plan before the docs-only planning commit.

## Source map and deliberate scope decisions

Read source, not just these descriptions:

| Current seam | Reuse / constraint |
|---|---|
| `packages/schemas/src/catalogs/primitives.ts` | `validateCatalogJson`, fixed bounds, paths/identities. Existing descriptor boundary rejects getters/non-JSON; executable Proxies remain outside caller contract. |
| `packages/schemas/src/catalogs/index.ts` and `index.test.ts` | Existing index format, exact/contextual entries, duplicate name/version and location constraints. |
| `packages/schemas/src/catalogs/manifest.ts` and `manifest.test.ts` | All manifest kinds, strict pins, compatibility, supported wiring. No schema changes planned. |
| `packages/schemas/src/catalogs/configuration.ts` | Public `GitRepositorySchema`/`GitRepository` canonical configured connection identity, not transport permission. |
| `packages/skills/src/catalogs/content.ts` and `content.test.ts` | `inspectPackage`, `canonicalJson`, `normalizedManifest` direct-module helpers; digests, frozen previews, existing sensitive warnings. Do not export internal helpers at package root. |
| `packages/skills/src/catalogs/export.ts` and `export.test.ts` | Positive field/file selection; `ExportCandidate` contains full normalized manifest bytes plus content. Re-export to validate candidates instead of accepting `proposedFiles` as an arbitrary patch. |
| `packages/skills/src/catalogs/resolve.ts` and `resolve.test.ts` | `resolvePackages`, exact identities, compatibility, reinspection, dependency order/cycle/depth/name conflicts. Keep its public signatures/semantics unchanged. |
| `packages/skills/src/catalogs/git-inspection.ts`, `git-objects.ts`, `git-inspection.test.ts` | Public adapters return semantic snapshots, not exact old index bytes or complete repository inventory. No new Git reader is authorized or needed by this pure library. |
| `packages/skills/src/catalogs/fixtures.ts` | Existing tiny four-kind synthetic manifests and throwing inert event module. Reuse rather than copy large fixtures. |
| `packages/skills/src/index.ts` | Add only the final cohesive preparation API, named public data types and fixed limits in Task 3. |

**Independence limitation, not a ready claim:** Existing public Git adapters alone cannot satisfy this new input contract: they discard lexical index bytes and do not enumerate the full repository. A later trusted evidence adapter/publisher must obtain exact index bytes, complete inventory and retained history and revalidate live authority. This plan supplies no such adapter or write capability. Synthetic callers can exercise the complete useful proposal operation now. Q1 private-network/transport policy and Q2 mobile layout remain untouched; no network or UI is used. Whether scan findings block future submission is deferred to the separately approved publisher/confirmation slice, not decided here.

**Conservative placement subset:** A new release must use an explicitly supplied absent directory (typically a new version directory); do not replace an occupied or unindexed package tree, even if Git could retain old content at historical commits. Existing-release requests can be exact no-ops, with proven immutable identity and complete byte/mode-equivalent base tree. No deletion, filesystem rename/move, merge, default index filename, or overwrite of a second index/source file. An explicit new-destination package-name change creates a separate new release at an absent path and leaves old files/identity intact; it is not a filesystem rename. An existing index must be an ordinary nonexecutable file. Creating an explicitly absent selected index is supported. This bounded subset is not a permanent restriction on later publishing adapters.

## Shared contracts — copied in full to every task brief

### Input and trust model

Define these named types in `packages/skills/src/catalogs/publication-types.ts`. Import existing `GitRepository`, `ResolvedIdentity`, `CatalogIndex`, `ContractIssue`, `PackageMetadata`, `ExportCandidate`, `PackageSnapshot`, `CatalogSnapshot`, `SuppliedPackage`, `ResolveInput` rather than redefining their shapes.

```ts
export type PublicationTreeEntry =
  | { type: "directory"; path: string }
  | { type: "file"; path: string; size: number; digest: string; executable: boolean }
  | { type: "blocked"; path: string }; // symlink/gitlink/special; never followed or written
export type PublicationBase = {
  catalogId: string; sourceId: string; repository: GitRepository; enabled: boolean;
  commit: string; indexPath: string; indexBase64: string | null;
  inventory: { complete: true; entries: readonly PublicationTreeEntry[] };
  history: { complete: true; releases: readonly ResolvedIdentity[] };
};
export type PublicationSource = {
  sourceId: string; repository: GitRepository;
  enabled: boolean; allowPackages: boolean;
};
export type PublicationSelection = {
  destinationPath: string; candidate: ExportCandidate;
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
  code: ContractIssue["code"] | "INVALID_PUBLICATION_INPUT" | "BASE_EVIDENCE_REQUIRED"
    | "BASE_CONFLICT" | "DESTINATION_CONFLICT" | "ORIGIN_CONFLICT";
  at: string;
};
export type PublicationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: PublicationIssue[] };
```

`base`, inventory/history completeness, source-to-repository bindings, source/catalog enabled/permission booleans, existing package commit/path envelopes, known identities and selected origin are **trusted caller evidence**, never author self-assertions or capabilities. Check their shape/internal consistency; no cryptographic authentication is claimed. A false `complete:true` is outside the trusted evidence contract. `complete:false`, missing inventory/history/index bytes or disagreement is a failure with no proposal. An index manifest's `files` list is never repository inventory. Caller must preserve history across disable/remove/restore/ref changes; a partial current index cannot prove an old version was never published.

Repository identity uses existing canonical `GitRepositorySchema`, then `JSON.stringify([url, sshUser ?? null])`; source IDs must be unique and cannot alias one canonical repository under different IDs. Base source must exist, match base.repository, be enabled, and own the selected base catalog. Independently require explicit base.enabled === true before semantic candidate inspection or closure work; base presence never implies enabled policy. Bind this checked assertion as catalogEnabled:true in preconditions. Base source.allowPackages does not substitute for catalog enabled policy and need not be true for catalog-owned releases. Other catalog IDs are unique, enabled flags remain explicit, and their source bindings must exist. No credentials, local paths, callbacks or publisher actor fields are accepted.

Origin semantics: namespace is exactly `(catalogId,sourceId,package name)`. `new-release` requires `origin:null`. `update` requires origin present in trusted retained history with identical immutable content identity (catalogCommit can differ), the same namespace as destination, and never changes the old identity. Same version is allowed only as the exact reuse case below; changed content needs a distinct version. `new-destination` requires a nonnull recorded origin with a different namespace, including a package-name change within the same repository/catalog, and explicitly records that new destination; it asserts no ownership of the origin/destination. A rename with known origin must retain that origin and explicitly choose new-destination, not update or new-release. Validate origin against combined retained histories, including supplied other-catalog knownReleases. Do not discover origin from raw agent fields, rewrite author attribution, enforce monotonic semver upgrade, or infer permissions from origin.

### Bounds and ordering (fixed, caller cannot raise)

Export frozen `PUBLICATION_LIMITS` only at final public integration. Values:

| Field | Value / meaning |
|---|---|
| inputJsonBytes | 67108864, entire envelope including all repeated base64/previews, before schemas/decode/hash |
| selections | 64, minimum 1 |
| treeEntries | 8192, complete repository metadata including directories and blocked leaves |
| sources | 128; dependency catalogs 31 (base makes existing resolver32) |
| suppliedPackages | 4032 (plus up to64 selections respects resolver4096) |
| knownReleases | 4096 combined base history and other known releases |
| totalIndexEntries | 8192 across base + supplied dependency indexes; each still <=4096 |
| aggregateFiles | 8192 across all occurrences of candidate files, candidate proposedFiles, existing snapshot files and old index |
| decodedBytes | 33554432 across those same occurrences, including duplicated manifest/content previews and old index |
| outputFiles | 4096 changed files; no truncation |
| outputBytes | 33554432 exact before/after changed-file bytes, counting each occurrence |
| findings | 4096; overflow fails LIMIT_EXCEEDED, never returns a clean/incomplete scan |

Every existing CATALOG_LIMITS per-manifest/index/package/file/count/depth bound still applies, including final pretty-serialized manifest/index bytes. Ordinary unrelated inventory files need only safe-integer nonnegative sizes and validated SHA256 metadata; their content is not supplied/decoded. Count all input entries before lookup, including unused/denied sources. Every complete inventory path uses RelativePath (ASCII, <=240 characters); require explicit correctly cased directory entries for every nonroot ancestor, no duplicates/case twins, no file/blocked ancestors. Thus the entire bounded repository must be representable under this conservative portable metadata contract; oversized/nonportable repositories fail, never masquerade as partial evidence. Empty unrelated directories are allowed; occupied destination directories are not treated as absent. Full destination-file joined paths must also pass RelativePath, even when each component separately passes. Root package manifest reservation is enforced by existing exporters. New package roots must be pairwise disjoint (including case-folded ancestors), outside selected index and its ancestors/descendants, and outside *all* base in-repository package-root regions, including frozen historical paths and explicit `location.type:"source"` entries whose sourceId equals base.sourceId. Do not let a new file overwrite another package's source tree.

First validate own-data JSON descriptors/budget, then count/encoded-length preflight for every byte occurrence, then shape/path checks, then canonical base64 decoding/hash and semantic inspection; no large decode/hash on a failed aggregate preflight. Runtime-invalid typed inputs return one deterministic redacted issue, never a partial value or raw exception. Use fixed field/index pointers for envelope failures; existing inspector validated path pointers may propagate. Do not include rejected values, exception causes or matched secret text in diagnostics/logs. Native OOM and malicious JS Proxies are outside the resource guarantee, not a promised sandbox.


**Task1 parent-approved ordering clarification:** The raw base index has no externally knowable entry count. After own-data descriptor validation and all externally knowable count/encoded-length/aggregate-byte preflights, only its bounded canonical base64 decode, fatal UTF-8 decode and JSON syntax parse may run to obtain that count. Check base/per-index and combined totalIndexEntries immediately, before index hashing/full semantic validation and before candidate/package decoding, hashing, re-export or inspection. Reuse the one checked decoded buffer; no reviver/hooks, second unchecked decode, raised limits or speculative package work. Malformed syntax/UTF-8/shape returns one fixed redacted failure. All other ordering constraints remain unchanged.

Sort inventories and changed files by code-unit path order; index entries by `(name,version)` code-unit order; sources/catalogs/history by explicit identity tuple; selections by `(candidate name,version,destinationPath)`. Dependencies keep existing resolver's canonical order. Authored strings/args/sidecar order are preserved, not normalized. Detach and recursively freeze successful plain-data outputs. Do not mutate or freeze caller data.

### Exact base/preconditions and file proposal output

```ts
export type PublicationBytes = {
  base64: string; size: number; digest: string; executable: boolean;
};
export type PublicationChange = {
  path: string; before: PublicationBytes | null; after: PublicationBytes;
  review: { before: "utf8" | "binary" | "absent"; after: "utf8" | "binary" };
};
export type PublicationPreconditions = {
  repository: GitRepository; sourceId: string; catalogId: string; catalogEnabled: true;
  baseCommit: string; indexPath: string;
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
export type PublicationRevision = { type: "exact"; commit: string } | { type: "proposal" };
export type PublicationIdentity = Omit<ResolvedIdentity, "catalogCommit" | "packageCommit"> & {
  catalogRevision: PublicationRevision; packageRevision: PublicationRevision;
};
export type PublicationRelease = {
  identity: PublicationIdentity; snapshot: PackageSnapshot;
  disposition: "new" | "existing";
};
export type PublicationFinding = {
  ruleId: "TOKEN_PREFIX" | "PRIVATE_KEY_HEADER" | "CREDENTIAL_ASSIGNMENT";
  severity: "warning"; path: string; side: "before" | "after";
  line: number; column: number; // 1-based Unicode-code-point location of first match
};
export type PublicationProposal = {
  kind: "offline-publication-proposal";
  preconditions: PublicationPreconditions;
  selections: readonly { destinationPath: string; intent: PublicationSelection["intent"];
    origin: ResolvedIdentity | null; name: string; version: string; disposition: "new" | "existing" }[];
  proposedIndex: CatalogIndex;
  changes: readonly PublicationChange[];
  releases: readonly PublicationRelease[]; // dependency-first complete selected closure
  findings: readonly PublicationFinding[];
  reviewRequired: true;
  scan: { kind: "supplementary"; version: 1; binaryFiles: readonly { path: string; side: "before" | "after" }[] };
  proposalDigest: string;
};
export function preparePublication(input: PublicationInput): PublicationResult<PublicationProposal>;
```

Success means **conditional inert proposal consistency only**, not write readiness, approval, submission eligibility, authenticated provenance or safe publication. No `ready`, `approved`, override or write-token fields. A future publisher must revalidate exact base revision, index bytes/digests/modes, occupied/absent path conditions, history, source binding/policy and live human/destination write authority before confirmation/write. A changed base/index requires fresh evidence and a new proposal; never silently rebase or substitute a revision. The checksum binds data, not authorization.

Old index null is accepted only when the complete tree proves that exact/casefold path absent and no file/blocked ancestor or descendant collision exists. Nonnull indexBase64 must be canonical, fatal UTF8 (preserve BOM), parse with existing `parseCatalogIndex`, have exact size/hash/executable=false matching the tree's ordinary file. Missing file/bytes, a tree at indexPath, executable index, any hash/size mismatch, or supplied history contradicting any base release fails. Preserve exact lexical old bytes in `before`, including whitespace; proposed index uses canonical key-sorted two-space JSON plus final LF and passes `parseCatalogIndex` on those actual bytes. If unchanged bytes, emit no index change. The only permitted replacement is this explicitly selected index; all other changes are new ordinary package files with `before:null`. Before allowing the index replacement (or creation), reject any indexPath overlap in either ancestor direction or case-folded equality with a selected package root or any recorded base-owned package region. Regions include every base entry plus retained-history/other known identities whose sourceId equals base.sourceId, including exact historical and explicit-source locations. The special index replacement must never mutate another package's current tree. A catalog placing its selected index inside a recorded historical package region is conservatively unsupported, even if that package is not selected or its old commit is no longer current.

Expand **every** base entry to exact ResolvedIdentity at base.commit. Cross-check base entries against history by `(catalogId,name,version)` as well as full immutable identity so source relocation cannot evade a known source-scoped key. Reserve all history identities, even absent from current index: cannot reuse a removed published version as a new release. Freeze every old `catalog-revision` location to `{type:"exact",commit:base.commit}` in the proposed index. Exact historical/external locations remain unchanged. Never rewrite a historical package manifest/dependency or demand that unrelated historical releases be compatible with today's target. Validate their index/history identities without requiring unrelated historical package bytes.

Selections are reinspected/re-exported using existing functions: strict validated manifest/files become a reconstructed allowed agent row/options or selected skill entries/options, then existing exporter produces the only allowed candidate. Compare all supplied proposedFiles path/base64/executable triples to that full re-export (order-insensitive canonical sorting); reject added/missing/changed manifests, disguised `.env`/credentials, altered content or flags. Check snapshot file size/digest claims against reinspection; supplied execution/warnings never become output, regenerate them. Native/wrapped exported candidates must remain in existing exporter subset (native exports have no packaged auxiliary files; wrapped has no resource wiring). No general arbitrary staged-package publishing bypass is added.

For a selection naming an existing base release, exact reuse requires catalog-owned location at exactly destinationPath, unchanged kind/name/version/digest/package commit from expanded base/history, candidate equivalent to supplied immutable snapshot at that location/commit, and complete current base subtree metadata exactly matching re-exported file paths/hashes/sizes/modes with no extra/blocked/empty child entries. No package-file change occurs. Reject occupied but unindexed trees and external-source entries as destination reuse; never import external ownership by matching a name/digest. Reuse does not move the release to the new commit. A historical absent-current-tree release cannot be materialized by this no-op path; use a new version and absent path.

New identities append only catalog-owned `catalog-revision` entries and new file additions at explicit absent roots. Preserve known origin in selection review even for new version/new namespace. Every proposed file is exposed in full; no textual unified-diff algorithm is required: exact before/after content is the review representation. Fatal UTF8 classification never decodes binary lossily. Binary review retains exact base64 plus path, size, SHA256 and executable bit. Never truncate previews or drop findings on overflow.

`proposalDigest = sha256("orgops-publication-proposal-v1\n" + canonicalJson(proposalWithoutDigest))` over the entire detached normalized result, including exact change bytes, before bytes, preconditions/history/policy, selection origins, proposed index, complete closure/execution previews, findings, and scan version. `canonicalJson` is the existing direct-module helper. Contextual new releases keep `{type:"proposal"}` in output identities; never fabricate published provenance.

### Coherent dependencies without a new package format

Prepare the proposed index first. Resolve **all selections as roots together**, with `installedSkills:[]`, combined retained known releases and caller target. Build a unique known-identity map from base.history, expanded base entries and other knownReleases: overlapping identical immutable identities merge (catalogCommit is separate provenance), any conflicting identity rejects. Do not pass duplicate knownReleases to the existing resolver. Supply virtual package envelopes for new selections only; existing selections must use their supplied immutable package evidence, never duplicate that envelope. Existing resolver remains sole authority for exact pin matching, supported kinds, compatibility, graph order/depth/cycles and global skill-name conflicts. A proposal containing conflicting skill versions/names is rejected, not represented as a valid coherent release set.

For internal resolution only, choose the smallest nonnegative integer encoded as 64 lowercase hex that does not occur in **any commit field** of the already bounded input (base, catalogs, source locations, exact revisions, snapshots' dependency pins, origins, known/history identities). Use a Set and bounded `used.size+1` search, not an unbounded hash retry. Map the proposal's catalog commit/new supplied-package commits to this temporary context. Existing old entries have already been frozen to exact original commits. Never rewrite dependency pins or recompute candidate digests. New-to-new dependencies must already be authored as same-package-revision with exact version/digest and destination source; new-to-old dependencies must be exact old commit. New-to-old contextual pins fail even for identical bytes. Existing-to-new dependencies cannot be retroactively manufactured. New cross-catalog/cross-source proposal dependencies and a second destination repo are not supported; existing external dependencies can resolve only from explicit permitted evidence.

Before constructing the resolver's single allowedSourceIds list, perform a bounded metadata-only reachable-closure policy precheck: use validated indexes and validated manifest dependency lists to walk selected entries at their exact/contextual locations (dedupe catalog/name/version, <=256), requiring each catalog's enabled source. Each reached `location.type:"source"` independently requires that source's enabled `allowPackages:true`, **even if the same source owns an enabled catalog**. Each reached cross-source pin also requires enabled `allowPackages:true`. Do not inspect or authorize unused denied external entries merely because an unrelated old entry is preserved. Missing/malformed selection evidence yields an existing redacted missing/invalid issue; final exact pin/digest/graph decisions remain in `resolvePackages`, not a second resolver. Then construct allowedSourceIds from only these checked enabled bindings and call the unchanged resolver. Do not blindly union catalog permissions with external-package permissions.

After resolution, translate the private temporary commit to `{type:"proposal"}` **only in identity provenance**; literal existing revisions become `{type:"exact",commit}`. Mark only appended releases `new`, all dependency/reused immutable releases `existing`. Returned snapshots retain original digest-covered manifests/pins. Proposed index contains only existing exact commits plus new contextual markers, never introduced temporary provenance. Assert no introduced fake commit in structured identity/index/precondition provenance or diagnostics, including an input deliberately using the first candidate temporary commit. This is not a substring ban: user-authored prompts/files may coincidentally equal the selected temporary hex and must remain byte-identical. Collect actual commit-typed fields, not arbitrary authored strings; translate only structural identity provenance, never pins or text. The temporary bridge has no Git or authenticated-commit meaning.

### Supplementary scan and human review

Scan exact before/after changed-file bytes only after complete file/budget validation; unchanged release snapshots retain existing inspection warnings and complete bytes in the closure. Full proposed manifest-file bytes cover prompts, souls, author metadata, secrets descriptions and wrapped commands/args, not just SKILL.md. Classify fatal UTF8 and list binary sides explicitly as unscanned; UTF8 alone is not proof of benign content. No text repair, redaction or automatic rewriting.

Use fixed conservative rules mirroring current inspector heuristics: TOKEN_PREFIX (`gh[pousr]_` +20 alphanumerics; `github_pat_` +20 alphanumeric/underscore; `sk-` +16 alphanumeric/underscore/hyphen), PRIVATE_KEY_HEADER (existing RSA/EC/OPENSSH/unqualified private-key header forms), CREDENTIAL_ASSIGNMENT (case-insensitive existing password/token/secret/api-key `:` or `=` nonspace assignment pattern). Fixed severity warning. At most the first match per rule per file side, not an unbounded match list. Fixed rule order then canonical `(path,side,ruleId)` output order; location points at match start using original text with LF line boundaries and Unicode code-point columns. Regex rules are internal constants only, no package regex, dynamic callbacks or provider checks. Existing inspector warning semantics are unchanged, not duplicated as a new public scanner API.

Findings contain exactly ruleId/severity/path/side/line/column, no matched value/excerpts/freeform message. Exact file previews intentionally may contain authored sensitive bytes: only diagnostic/scan metadata is redacted, not the review artifact itself. Never log previews. `reviewRequired:true` and scan.kind/version remain present with zero matches and with binary content. No success-to-publish claim, bypass or scan-based approval grant.

## Validation protocol shared by all tasks

Read Phase5 `parent-verify.sh`, `compare-lint.py`, `parent-final-lint.json`, `parent-final-exits.txt`, `parent-final-comparison.txt`, and test/opscli logs. Task1 copies/adapts scripts into D; no previous artifact is changed. Retain isolated `env -i`, `.env.example` only, `ORGOPS_LLM_STUB=1`, owned HOME/TMPDIR, `ulimit -c 0`, `timeout --kill-after=5s 600s`; use existing npm binaries with no install. Set script artifact directory to Phase6 and use unique labels. Root lint stops at existing API errors, therefore also run **all12** workspaces individually. Add no build/browser/service obligation for this pure slice.

Baseline comparison is Phase5 parent-final; later comparisons are fresh Phase6 task-1-baseline. Counter keys include workspace/file/TS code/full multiline message/multiplicity and line/column; normalize only repo prefix. There are no planned edits to existing diagnostic-bearing API/runner files, so no source-position normalization is needed or approved here. Do not reuse old script's unconditional location omission. Parse failure, missing workspace log or unexpected command exit fails validation rather than yielding a false zero. Baseline expected: Vitest1295/39, opscli3, root lint exit2, API486/runner2 diagnostics, ten other workspaces exit0 and clean. Record actual fresh counts; no blanket claim that root lint is green.

Canonical execution setup and targeted invocation (bash variable D is shell-expanded into env):

```bash
D="$PWD/.superpowers/sdd/2026-09-10-catalogs-06-offline-publication-preparation"
mkdir -p "$D/scratch/home" "$D/scratch/tmp"
# Run each command in this wrapper; redirect to unique task-N-red/green logs.
(ulimit -c 0; timeout --kill-after=5s 600s env -i PATH="$PATH" \
  HOME="$D/scratch/home" TMPDIR="$D/scratch/tmp" CI=1 \
  /bin/bash --noprofile --norc -c \
  'set -a; source .env.example; set +a; export ORGOPS_LLM_STUB=1; exec "$@"' bash \
  npm exec --no -- vitest run packages/skills/src/catalogs/publication-base.test.ts)
```

Tasks must use owned synthetic fixture data; never inspect real local repositories/instances to obtain base evidence. Existing whole-suite tests may create their normal isolated temporary fixtures under owned TMPDIR; no services are launched by this slice. Capture expected RED then GREEN and exact commands/exit codes. Run all new publication tests plus existing catalog/schema tests after each task; run full Vitest/opscli/root/all-workspace checks after every task and final parent verification. No added diagnostic accepted even when tests pass.

### Task 1: Bounded export-candidate and immutable-base evidence validation

**Files:**
- Create `packages/skills/src/catalogs/publication-types.ts` (shared types/fixed limits above).
- Create `packages/skills/src/catalogs/publication-content.ts` and `.test.ts` (validated re-export only; bytes utility).
- Create `packages/skills/src/catalogs/publication-base.ts` and `.test.ts` (bounded complete input/evidence/precondition checks).
- Create `packages/skills/src/catalogs/publication-fixtures.ts` (synthetic helper functions below; tests only).
- Artifacts: `D/verify.sh`, `D/compare-lint.py`, `D/task-1-*`; no package root export yet.

**Interfaces:** consumes existing exports/types and the full shared contracts. Produces these direct-module helpers, not package-root exports:

```ts
// publication-content.ts; receives aggregate-preflighted JSON internally, but also
// independently checks its candidate/byte envelope so direct tests cannot bypass limits.
export function validatePublicationCandidate(candidate: ExportCandidate): PublicationResult<ExportCandidate>;
export function publicationBytes(base64: string, executable: boolean, maxBytes: number): PublicationResult<PublicationBytes>;
// publication-base.ts; validates/detaches complete input and regenerates candidates.
export type ValidatedPublication = {
  input: PublicationInput; baseIndex: CatalogIndex;
  preconditions: PublicationPreconditions;
};
export function validatePublicationInput(input: PublicationInput): PublicationResult<ValidatedPublication>;
```

`maxBytes` is an internal chosen per-file/index/manifest budget, not a public caller override. Preconditions initially have requiredAbsentPaths empty; Task2 populates them after identity/reuse classification. Task1 checks pairwise path/index collisions and complete tree consistency but leaves new-vs-reuse occupied-root decision to Task2. preservedReleases already contains every base entry's exact expansion/history cross-check. History duplicate/remapping errors reject even when entry is not selected. Validate all supplied envelopes against existing schemas/counts before returning detached input; do not introduce public unchecked brands.

- [x] Record `git rev-parse HEAD` as TASK_BASE, branch/status and clean index in `D/task-1-preflight.txt`. Copy/adapt validation scripts exactly as the protocol describes, run fresh baseline, compare against Phase5 parent-final, retain raw logs. Stop on added diagnostics.
- [x] Add tiny fixture helpers and RED tests for complete base evidence and candidate validation. The fixture file uses existing `must`, `skillEntries`, `skillManifest`; it imports only types and pure production modules:

```ts
import { createHash } from "node:crypto";
import { exportSkillPackage } from "./export";
import { must, skillEntries, skillManifest } from "./fixtures";
import type { PublicationInput } from "./publication-types";
export const BASE = "1".repeat(40);
export const bytes = (text: string) => Buffer.from(text).toString("base64");
export const digest = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
export function publicationInput(): PublicationInput {
  const m = skillManifest;
  const candidate = must(exportSkillPackage(skillEntries, {
    metadata: { formatVersion: 1, name: m.name, version: m.version,
      description: m.description, author: m.author, license: m.license,
      compatibility: structuredClone(m.compatibility), secrets: [] },
    dependencies: [], executables: structuredClone(m.executables),
    selectedPaths: ["SKILL.md", "event-shapes.ts"],
  }));
  const index = '{ "formatVersion": 1, "entries": [] }\n';
  const repository = { url: "https://example.invalid/team/catalog.git" };
  return structuredClone({
    base: { catalogId: "team", sourceId: "team-source", repository,
      enabled: true, commit: BASE, indexPath: "catalog/index.json", indexBase64: bytes(index),
      inventory: { complete: true, entries: [
        { type: "directory", path: "catalog" },
        { type: "file", path: "catalog/index.json", size: Buffer.byteLength(index),
          digest: digest(index), executable: false },
      ] }, history: { complete: true, releases: [] } },
    selections: [{ destinationPath: "packages/echo-skill/1.0.0", candidate,
      intent: "new-release", origin: null }],
    sources: [{ sourceId: "team-source", repository, enabled: true, allowPackages: false }],
    catalogs: [], packages: [], knownReleases: [],
    target: { orgopsVersion: "0.0.1", platform: "linux", tools: ["node"] },
  });
}
```

```ts
it("requires complete base inventory rather than package file claims", () => {
  const v = publicationInput();
  Object.assign(v.base.inventory, { complete: false });
  expect(validatePublicationInput(v)).toEqual({ ok: false,
    issues: [{ code: "BASE_EVIDENCE_REQUIRED", at: "base.inventory" }] });
});
it("binds exact lexical old index bytes to immutable inventory", () => {
  const v = publicationInput();
  v.base.indexBase64 = bytes('{"formatVersion":1,"entries":[]}\n');
  expect(validatePublicationInput(v)).toEqual({ ok: false,
    issues: [{ code: "BASE_CONFLICT", at: "base.indexBase64" }] });
});
it("rejects forged extra proposedFiles, even with a valid snapshot", () => {
  const c = structuredClone(publicationInput().selections[0]!.candidate);
  c.proposedFiles = [...c.proposedFiles, { path: ".env", base64: bytes("not-a-real-secret"), executable: false }];
  expect(validatePublicationCandidate(c).ok).toBe(false);
});
```

- [x] Run targeted `npm exec --no -- vitest run packages/skills/src/catalogs/publication-base.test.ts packages/skills/src/catalogs/publication-content.test.ts` in the wrapper, record RED missing-module/export failures.
- [x] Implement the two private validators in small test-driven increments: shared descriptor/count/encoded-length preflight, canonical bytes, strict candidate reinspection/re-export, repository/source identity checks, complete tree map and ancestor checks, exact index parsing/metadata match, retained-history cross-check and detached preconditions. A canonical bytes core follows this order (all failures use fixed pointers):

```ts
const encodedLimit = Math.ceil(maxBytes / 3) * 4;
const size = Math.floor(base64.length / 4) * 3
  - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
// Reject length/size overflow before Buffer.from; then canonical grammar and
// round-trip base64 equality; SHA256 over exact decoded bytes, never supplied hash.
// Re-export via exportSkillPackage or exportAgentPackage only after inspectPackage.
```

- [x] Add table-driven RED/GREEN cases: missing/false history completeness; unknown envelope fields; getter counters stay0; non-JSON/cycles/depth/oversized ignored inputs; source aliases/rebinding/disabled source; independent base.enabled=false rejects before candidate semantic inspection even when source.enabled=true/allowPackages=true; tree duplicate/casefold/prefix/missing ancestors/blocked leaf; index missing/absent/directory/executable/malformed UTF8/BOM/base64/hash/size mismatches; combined/joined path limits; package/index overlap including index nested inside a retained-history package region absent from the current index; retained removed identities and source remapping; forged snapshot digest/size/execution/warnings; malformed/reserved manifest/selected credential file/unsupported wrapped env/wiring; native auxiliary files not in export subset. Include exact-boundary and +1 cases for every new aggregate count/byte budget, proving aggregate preflight precedes semantic/decode/hash work with spies on existing pure seams.
- [x] GREEN targeted + existing catalog/schema tests. Run `bash "$D/verify.sh" task-1-final` and `python3 "$D/compare-lint.py" task-1-final`; document actual counts and zero added diagnostics. Check frozen outputs/no input mutation; never import throwing module. Save scoped review diff from TASK_BASE and `git diff --check`.
- [x] Commit only named production/test files: `git add packages/skills/src/catalogs/publication-{types,content,base,fixtures}.ts packages/skills/src/catalogs/publication-{content,base}.test.ts && git commit -m "feat(skills): validate offline publication evidence"`. Record HEAD and `git diff --cached --quiet`; artifacts stay untracked/ignored. Parent fresh task review gate before Task2.

### Task 2: Immutable index composition and coherent proposal resolution

**Files:**
- Create `packages/skills/src/catalogs/publication-resolve.ts` and `.test.ts` (private resolution bridge/policy precheck).
- Create `packages/skills/src/catalogs/publication.ts` and `.test.ts` (composition, identity/origin/no-op/placement, full change bytes/checksum core).
- Modify `packages/skills/src/catalogs/publication-fixtures.ts` only for shared history/reuse/coherent dependency test construction.
- Modify `publication-types.ts`/`publication-base.ts` only to correct actual reviewed shared-contract defects, not invent a new interface. No root exports yet.

**Interfaces:** consumes `validatePublicationInput`, `validatePublicationCandidate`, `publicationBytes`, all shared types. Produces:

```ts
// publication-resolve.ts; direct-module only.
export function resolvePublicationReleases(
  validated: ValidatedPublication, proposedIndex: CatalogIndex,
): PublicationResult<readonly PublicationRelease[]>;
// publication.ts; this is a complete unscanned composition seam for Task3,
// explicitly NOT the final public proposal type/API and never returns scan claims.
export type PublicationComposition = Pick<PublicationProposal,
  "kind" | "preconditions" | "selections" | "proposedIndex" | "changes" | "releases" | "reviewRequired">;
export function composePublication(input: PublicationInput): PublicationResult<PublicationComposition>;
```

Task2 does not expose `preparePublication` or an empty scan/placeholder checksum. Task3 completes actual scanning/checksum as one public result. Every composition failure is no-partial; internal composition is already a useful independently tested pure transformation.

- [x] Record fresh TASK_BASE/branch/status/index; read Task1 review and full shared contract. Add RED tests using `publicationInput()`:

```ts
it("composes exact package additions and a lexical before/after index", () => {
  const v = publicationInput(); const before = structuredClone(v);
  const r = composePublication(v);
  expect(r.ok).toBe(true); if (!r.ok) throw new Error("fixture");
  expect(r.value.changes.map(c => c.path)).toEqual([
    "catalog/index.json", "packages/echo-skill/1.0.0/SKILL.md",
    "packages/echo-skill/1.0.0/event-shapes.ts",
    "packages/echo-skill/1.0.0/orgops-package.json",
  ]);
  expect(r.value.changes[0]!.before!.base64).toBe(v.base.indexBase64);
  expect(r.value.releases[0]!.identity.packageRevision).toEqual({ type: "proposal" });
  expect(r.value.preconditions.requiredAbsentPaths).toEqual(["packages/echo-skill/1.0.0"]);
  expect(v).toEqual(before);
});
it("does not overwrite an unindexed occupied directory", () => {
  const v = publicationInput();
  v.base.inventory.entries = [...v.base.inventory.entries,
    { type: "directory", path: "packages" },
    { type: "directory", path: "packages/echo-skill" },
    { type: "directory", path: "packages/echo-skill/1.0.0" }];
  expect(composePublication(v)).toEqual({ ok: false,
    issues: [{ code: "DESTINATION_CONFLICT", at: "selections.destinationPath" }] });
});
```

- [x] Run wrapped targeted tests for publication/publication-resolve; retain expected RED.
- [x] Implement immutable lifecycle before dependency integration: expand/freeze every old contextual entry, compare known name/version/source/location/kind/digest and enforce removed-identity reservation; classify exact no-op or truly new absent path; enforce origin intents; append new contextual entries; serialize actual pretty bytes and parse round-trip; calculate every before/after byte record with no generic patch passthrough. Compare base subtree to candidate for reuse, including its manifest file bytes, modes and extra empty directories. Never modify old package bytes or retained pins.

```ts
const frozenEntries = baseIndex.entries.map(entry => {
  const l = entry.location;
  return l.type === "catalog" && l.revision.type === "catalog-revision"
    ? { ...entry, location: { ...l, revision: { type: "exact" as const, commit: input.base.commit } } }
    : structuredClone(entry);
});
// Append only validated new selection entries; validateCatalogIndex the final set,
// then canonicalJson -> JSON.parse -> JSON.stringify(..., null, 2) + "\n".
```

- [x] Add contextual-lifecycle RED/GREEN tests by promoting a successful synthetic composition to a new synthetic base `"2".repeat(40)` entirely in memory: retain exact index bytes/tree metadata and snapshots from the first output, add its literal resolved identities as trusted history, then propose version2 at an absent path. Assert old releases freeze to commit2 while new releases remain contextual; known original commit/path/digest never changes. Repeating same version with changed digest/path/mode/manifest bytes or external ownership rejects. Exact no-op returns no package changes (index may change only for contextual freezing/serialization). If already exact and identical serialized index, allow fully empty changes without claiming a publication occurred. Unknown/incorrect origin and namespace changes without explicit new-destination reject; origin is retained in valid review output. Test same-repository name changes with known origin: update rejects; new-destination succeeds and retains old origin/name; new-release with that nonnull origin rejects. A version-only change in the same catalog/source/name remains update.
- [x] Implement the private temporary-context bridge and **pre-resolver** source-policy closure check exactly as shared contract; existing resolver then checks content, pins, compatibility, order/cycles/conflicts. No introduced fake literal commit is retained in structured result provenance; authored text remains unchanged. Test coherent new skill+CLASSIC and new skill+RLM from exporters: author native pins with same-package-revision and actual skill digest; no resealing by composition. Test a three-level skill diamond using exporter-produced manifests and existing `orderDependencyGraph` tests for cryptographically unconstructible finite cycles; do not create a second graph implementation.
- [x] Add focused negative tests: missing release/snapshot, denied/disabled catalogs/sources, source with catalog authority but allowPackages=false for reached external location or cross-source pin, same-repo explicit-source location still needs external permission, untouched denied external historical entry does not block unrelated proposal; wrong version/digest/exact commit; new-to-old contextual failure and exact-old success; absent included-new dependency; unsupported native/wrapped dependency; compatibility min/max/platform/tool; two skill versions conflict; private sentinel candidate present in exact input commits; unchanged exact pins; authored prompt/file literally equal to chosen temporary hex remains unchanged while structured result introduces no fake provenance; stable SHA1/SHA256 base handling; immutable known history source/path swaps; reordered input identical output. Use resolver spies to show policy rejection before delegation and no new source registration.
- [x] Add full-file tests for binary `/wAB`, nonexecutable index/root manifest, all command/check/args previews, output count/byte/index-boundary overflow, exact no-delete/no-rename behavior, input detachment/freeze. Assert base change produces different preconditions and cannot satisfy old evidence metadata; preparation never reads a live base or invents a current revision.
- [x] GREEN targeted and all catalog/schema tests; full `verify.sh task-2-final`, exact multiline lint comparison; record actual counts/raw logs, `git diff --check`, scoped review diff and clean index after commit. Commit only named files with `feat(skills): compose immutable offline publication proposals`. Parent task review gate before Task3.

### Task 3: Supplementary redacted findings, final pure API and truthful documentation

**Files:**
- Create `packages/skills/src/catalogs/publication-review.ts` and `.test.ts` (bounded fixed-rule scan of full changes).
- Modify `packages/skills/src/catalogs/publication.ts` and `.test.ts` (final preparePublication + checksum/integration tests).
- Modify `packages/skills/src/index.ts` (exact public API/types/limit exports).
- Modify `docs/SPEC.md`, `docs/catalog-package-contract.md` and status paragraphs only in `docs/superpowers/specs/2026-09-09-skill-agent-catalogs-design.md` (implemented subset, remaining work; no requirements rewrite).

**Interfaces:** consumes Task2 `composePublication` and all shared types. Produces final public `preparePublication` exactly as shared contract and private helper:

```ts
export function reviewPublicationChanges(changes: readonly PublicationChange[]):
  PublicationResult<Pick<PublicationProposal, "findings" | "scan">>;
```

Root export only preparePublication, PUBLICATION_LIMITS and named public Publication types. Do not root-export composePublication, reviewPublicationChanges, validators, canonicalJson, graph helper or temporary-context implementation.

- [x] Record fresh TASK_BASE and clean-index preflight. Add RED scan tests using exact complete byte records from composition (helper itself also validates bounded input bytes/pointers so forged direct calls cannot skip its limits):

```ts
it("reports a redacted location without losing full human review bytes", () => {
  const text = "heading\npassword=synthetic-review-marker\n";
  const result = reviewPublicationChanges([{
    path: "notes.txt", before: null,
    after: { base64: bytes(text), size: Buffer.byteLength(text), digest: digest(text), executable: false },
    review: { before: "absent", after: "utf8" },
  }]);
  expect(result.ok).toBe(true); if (!result.ok) throw new Error("fixture");
  expect(result.value.findings).toEqual([{ ruleId: "CREDENTIAL_ASSIGNMENT", severity: "warning",
    path: "notes.txt", side: "after", line: 2, column: 1 }]);
  expect(JSON.stringify(result.value)).not.toContain("synthetic-review-marker");
});
```

- [x] Run wrapped targeted review/publication tests; retain RED. Implement three fixed internal rule constants, fatal UTF8 classification, first match/rule/side only, bounded Unicode location calculation and deterministic findings/binary-side ordering. Enforce 4096 finding limit fail-closed; never truncate scan output. No provider validation, arbitrary package regex, logs or change rewriting.
- [x] Add RED/GREEN tests for all fixed rules in skill text, native prompt/soul, manifest metadata, wrapped setup/check/sidecar/turn commands and args; location on non-ASCII/CRLF text, repeated matches, no excerpts/values in findings, no console logging, binary explicitly unscanned with preserved exact bytes; before-index text is scanned too. Zero matches still reviewRequired, no approval/ready/safe fields. Test first-match-per-rule determinism and max/+1 findings/input/output bounds. Findings are warning data, never a new block/override policy.
- [x] Complete the public function with no alternate paths:

```ts
export function preparePublication(input: PublicationInput): PublicationResult<PublicationProposal> {
  const composed = composePublication(input);
  if (!composed.ok) return composed;
  const reviewed = reviewPublicationChanges(composed.value.changes);
  if (!reviewed.ok) return reviewed;
  const data = { ...composed.value, ...reviewed.value };
  const proposalDigest = `sha256:${createHash("sha256")
    .update(`orgops-publication-proposal-v1\n${canonicalJson(data)}`).digest("hex")}`;
  // Freeze a detached plain-data result; all nested data already comes from detached
  // validated composition/review. No retained caller object or Buffer is allowed.
  return { ok: true, value: freeze({ ...data, proposalDigest }) };
}
```

`freeze` is a private recursive helper in publication.ts (Object.values recursion then Object.freeze), not an undefined public utility. Import createHash/canonicalJson from existing seams. Check final output count/byte limits before freezing/checksum serialization.

- [x] Add public `../index` composition tests for skill, CLASSIC, RLM_REPL, WRAPPED and dependency closure, preserving export exclusions and full previews. Assert synchronous result and spy/fail on filesystem/process/network/active discovery seams; no calls occur. A throwing event module remains bytes. Check deterministic checksum against independently constructed canonical result hash; any changed index whitespace/base commit/repository policy/origin/manifest bytes/mode/binary content/findings changes checksum, input ordering does not. Deep-freeze/detachment and no-introduced-fake-provenance assertions run on complete structured result; authored bytes coincidentally equal to temporary hex remain unchanged. All failure paths return one issue/no partial value; scan never launders invalid candidates.
- [x] Update exact API signatures, bounded complete evidence/limitations, deterministic preconditions/checksum semantics, old-context freeze/no-op/new-directory subset, source policy and origin rules, full byte review plus redacted supplementary scans in SPEC/package-contract. Include one complete tiny in-memory example from fixtures with all required fields, no Git reads or credentials. State that later evidence acquisition, authority revalidation, GitHub branch/PR, confirmation, retry reconciliation, remote transport and two-instance acceptance remain unimplemented. Status says Phase6 pure preparation implemented only after task tests; do not claim parent final acceptance before it occurs. Q1/Q2 remain unchanged.
- [x] GREEN all new+existing catalog/schema tests, full Vitest, opscli and root/all12-workspace lint through `verify.sh task-3-final` and exact comparator. Document counts/raw logs and zero added diagnostics. Run `git diff --check`; save scoped diff for fresh reviewer. Commit only named files with `feat(skills): expose reviewed offline publication preparation`. Verify clean index and return evidence to parent for task review, whole-phase review and fresh parent acceptance; no services/browser/publishing check is performed.

## Planning self-review / preflight consistency table

| Check | Result / task coverage |
|---|---|
| Scope count | Three sequential independently reviewable tasks; all code under skills/catalogs plus final explicit skills root export; schemas/API/UI/DB/runner unchanged. |
| Binding sections5/9 | Task1 allowlisted all-kind candidates/evidence; Task2 immutable coherent package+index proposals; Task3 full review/supplementary scan and truthful docs. Live publication/approval deliberately excluded. |
| Exact shared types | PublicationInput/Proposal/Result and limits defined once above; task seams have exact names/signatures. Composition is intentionally not the final scan-bearing proposal. |
| Base evidence sufficiency | Complete bounded tree + exact lexical index + complete retained history caller assertions; missing/partial evidence fails. No current public Git adapter sufficiency claim. |
| Context lifecycle | Every unchanged contextual entry frozen at base; old pins never rewritten; new contextual package release only; private temporary identity never exposed. |
| Dependency authority | Precheck reached external/cross-source permission before resolver union; unchanged resolver owns exact semantics, cycles, compatibility and conflicts. |
| Placement | Absent new roots only, exact proven reuse only; all ancestors/case/index/historical package regions checked; selected index cannot overlap any recorded base-owned package region. Explicit base.enabled independently gates preparation. |
| Human review/scan | Every changed side retains complete bytes/mode/hash, binary marked; bounded scanner first match/rule/side; no excerpts, no new approval policy. |
| Evidence/validation | Task1 fresh baseline against Phase5 logs; targeted RED/GREEN each task; all12 diagnostics include multiline/multiplicity/location comparison; zero added mandatory. |
| Deferred independent blockers | No blocker to pure library under explicit trusted-evidence contract; integration cannot claim write readiness until a later evidence/authority/publisher adapter exists. Q1/Q2 unchanged. |
| Planning edits | Plan docs only, parent gate before commit. Generate full shared-contract task briefs after approval with installed task-brief script; no nested agents. |

## Parent gate and brief generation

Before any plan commit, send parent this path, three-task scope, complete-tree/retained-history trust contract, conservative new-directory placement, temporary resolver context, exact origin/source permission handling and scan-without-approval policy. Wait for self-review/corrections. Do not ask absent owner for credentials.

After approval, commit this plan alone (`docs(catalogs): plan offline publication preparation`). Run installed `/home/slamnation/.pi/agent/git/github.com/obra/superpowers/skills/subagent-driven-development/scripts/task-brief PLAN N D/task-N-brief.md` for N=1..3. Prepend the complete plan header/shared sections through the line preceding Task1 to **each** extracted task (the installed extractor otherwise omits shared requirements); append self-review/gate notes as appropriate. Record command results and consistency table in `D/planning-report.md`, alongside exact HEAD and absolute brief paths. Verify no staged files and no production/test diff. Return structured checked acceptance evidence; parent owns subsequent delegation and reviewer launch.
