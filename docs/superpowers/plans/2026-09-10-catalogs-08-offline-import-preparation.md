# Offline Import Preparation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (parent controller only) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Workers must not launch nested agents.

**Goal:** Produce a complete, bounded, conditional offline import review for one exact skill/native/wrapped root and its pinned skill closure, without installing, binding, approving, activating or starting anything.

**Architecture:** Validate explicitly supplied source/catalog/package evidence and independent complete local skill occupancy/current-content evidence. Reuse `resolvePackages` for the exact closure and identity/version/compatibility/conflict rules; share the existing publication metadata-only permission precheck rather than introduce another resolver. Return detached frozen review data, not an installation operation, active agent row or approval capability.

**Tech Stack:** Existing TypeScript, Node Buffer/crypto/TextDecoder, Zod catalog schemas and colocated Vitest; npm only, no dependencies.

**Spec:** `docs/superpowers/specs/2026-09-09-skill-agent-catalogs-design.md`, specifically the separable pure portions of sections 5–8 and 10–13. Read the full approved design and `docs/SPEC.md` before implementation.

## Global Constraints / Entire Common Task Contract

This entire prefix, from the document heading through the line immediately preceding `### Task 1`, MUST be present byte-for-byte before each generated task body. The installed task-brief script extracts task bodies only; generate a distinct raw body with it, then prepend this entire prefix. No later global requirements appear outside this prefix.

### Authority, branch and scope

- Binding controller: `.superpowers/sdd/2026-09-10-catalogs-08-offline-import-preparation/controller-brief.md`. `D=/home/slamnation/www/orgops/.superpowers/sdd/2026-09-10-catalogs-08-offline-import-preparation`.
- Initial planning base: branch `88-move-private-skills-into-a-private-repo`, full HEAD `db5dd4a20ec1c971510fa983b352821ab41aefae`, empty `git status --short`, empty diff and index. Work only in `/home/slamnation/www/orgops` on that existing branch.
- Parent must review this ENTIRE concrete draft and explicitly approve it BEFORE the plan-only commit or any source/test changes. Planning writes no source/tests. Planner stays alive for corrections and records approval in phase-local evidence. Only the plan document is in the planning commit; task briefs/reports are phase-local, not staged.
- One sequential writer; fresh read-only task reviews after each task/fix, then whole-phase review, then independent parent acceptance. No nested agents, worktrees, pushes, remote writes, merges, installation, publication, activation, repository acquisition, configured-instance inspection, production state/services/credentials, dependency/package/lockfile changes. Prior phase artifacts and pending-owner decisions are read-only. Q1 network reachability and Q2 mobile shell remain deferred.
- No new owner product/security policy: escalate required ambiguity to supervisor and wait. Infrastructure/tool/runtime/output-contract failure stops with exact error/run/cwd/branch/full ref/status/diff; explicit same-protocol recovery only, never CLI/foreground fallback. Native `structured_output` verdict is mandatory, not Markdown approval.
- The result is conditional on trusted caller evidence, never live authority proof. No DB/API/runner/UI changes, lifecycle events, wall clock/random IDs, credential/config/environment reads, active skill discovery, dynamic loading/evaluation of package-authored event-shape modules, shell/process/fs/network/package execution. Trusted static `@orgops/schemas` validators are expressly required.
- Future orchestration must independently remeasure live content/occupancy, enforce current live human admin and source policy, bind local name/runner/workspace/model and secret REFERENCES, verify actual API/runner placement, obtain explicit activation approval, create stopped agents, and enforce requirements at every start. This preview neither implements nor certifies the full-install/missing-secret save rule. It accepts no secret VALUES or broad DB rows and never selects a model or local binding.
- Standalone skill inclusion/reuse does not enable any existing agent. API event-module activation requires later separate explicit approval even with stopped agents. Wrapped commands/setup/checks/sidecars remain inert until future explicit start; native allowlisting does not sandbox them. Existing `resourceWiring:"none"` wrapped subset remains unchanged, not a claim of complete v1 wiring.

### Required current sources and implementation map

Planner read `AGENTS.md`, full `docs/SPEC.md`, full approved design, full `docs/catalog-package-contract.md`; `packages/skills/src/catalogs/{resolve,content,skill-document,export,publication-types,publication-base,publication-content,publication-resolve,publication-review,publication,git-publication-evidence}.ts`, their colocated tests and fixtures; schemas `catalogs/{primitives,manifest,index,configuration}.ts` and tests; both workspace root exports; existing active skill discovery in skills `src/index.ts` and actual native/schema and wrapped-harness types. Executors reread the current task seams and the binding documents. Do not call active discovery.

| File | Owner/task | Responsibility |
|---|---|---|
| `packages/skills/src/catalogs/import-types.ts` | 1 | Fixed limits, exact public input/result/review types; internal validated types |
| `packages/skills/src/catalogs/import-evidence.ts` | 1 | Strict descriptor/plain-data/count/byte validation, independent local evidence measurement and canonical snapshots |
| `packages/skills/src/catalogs/import-evidence.test.ts` | 1 | Boundary, occupancy, actual-byte, malformed-evidence regressions |
| `packages/skills/src/catalogs/import-fixtures.ts` | 1, additive helpers in 2/3 | Synthetic fixtures only, no live discovery or Git |
| `packages/skills/src/catalogs/source-policy.ts` | 2 | Extract existing reached-source metadata-only precheck with no publication context/history |
| `packages/skills/src/catalogs/source-policy.test.ts` | 2 | Independent catalog versus external/cross-source policy gates |
| `packages/skills/src/catalogs/publication-resolve.ts` | 2 | Replace existing inline policy walk with the shared helper, preserve behavior |
| `packages/skills/src/catalogs/import.ts` | 2 | Compose exact resolution and complete inert review |
| `packages/skills/src/catalogs/import.test.ts` | 2, additive coverage in 3 | Integration, deterministic complete previews, no effects |
| `packages/skills/src/index.ts` | 3 | Explicit new public exports only; discovery code untouched |
| `docs/catalog-package-contract.md`, `docs/SPEC.md` | 3 | Exact implemented pure contract, evidence caveats, executable synthetic example |

Existing `resolve.ts`, `content.ts`, `skill-document.ts`, `export.ts`, all schema contracts and all Git adapters stay unchanged. Do not extract or reuse publication candidate reconstruction: it intentionally rejects native auxiliary files and selected export credential paths; import inspection must retain the existing package-format contract, not add an export denylist or scanner policy. Use `inspectPackage`, `parsePackageManifest`, `validateCatalogJson`, `validateCatalogIndex`, `validatePackageManifest`, `normalizedManifest`/`canonicalJson` deep imports where their existing semantics agree. Do not copy hashing, YAML, pin resolution or graph ordering algorithms.

### Exact shared types and signatures

All imports below are type-only except the fixed constant. Existing referenced types are exported from `@orgops/schemas`, `./content`, `./resolve`. Only the public types identified here are exported by the skills root in Task 3. No `export *`, internal helper or test fixture root exports.

```ts
import type { GitRepository, ResolvedIdentity, ContractIssue } from "@orgops/schemas";
import type { PackageSnapshot, InspectedFile } from "./content";
import type { CatalogSnapshot, SuppliedPackage, ResolveInput, InstalledSkill, Resolution } from "./resolve";

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

// Private module types/functions; never root-export these.
export type ValidatedImport = {
  input: ImportInput; // canonical, detached, deeply frozen; supplied previews regenerated
  installedSkills: readonly InstalledSkill[]; // only actual successfully inspected local bytes
  blockedNames: readonly string[]; // folded occupied or non-equivalent/uninspectable local names
  installedFiles: readonly { name: string; files: readonly ImportReviewFile[] }[];
};
export function validateImportInput(input: ImportInput): ImportResult<ValidatedImport>;
export function composeImportReview(
  checked: ValidatedImport, resolution: Resolution,
): ImportResult<ImportPreview>;
export type PackageSourcePolicy = { sourceId: string; enabled: boolean; allowPackages: boolean };
export type SourcePolicyInput = {
  roots: ResolveInput["roots"];
  catalogs: readonly CatalogSnapshot[];
  packages: readonly SuppliedPackage[];
  sources: readonly PackageSourcePolicy[];
};
export function precheckPackageSources(input: SourcePolicyInput):
  import("@orgops/schemas").ContractResult<readonly string[]>;
```

`source-policy.ts` is a trusted validated-data direct-module seam with exactly the old publication walk semantics and fixed `CATALOG_LIMITS.resolvedPackages` bound. Its callers validate data first. It does not parse authored bytes, resolve pins, check compatibility, order graphs, manufacture provenance or infer configuration. No callbacks, extensible hooks or configurable budgets are added.

### Evidence and completeness: proof versus caller assertions

1. `sources` are explicit independent configured binding/policy assertions. Canonicalize each repository with `GitRepositorySchema`; IDs and canonical `[url,sshUser??null]` identities are unique. Catalog IDs and `(sourceId,commit,path)` package envelopes are unique. No catalog/package self-registration, implicit source union, substitution or provenance inferred from author attribution. `enabled` is caller-computed effective enabled/nonremoved state, not a raw database row. Numeric configuration revisions and refs are not commits and are not introduced by this pure contract.
2. Every supplied catalog/package source must have a supplied source binding (disabled is representable); all supplied indexes/manifests/snapshots are validated even when unused. Unused index entries need no package envelope or package permission. Retained `knownReleases` and local origins may name historical source/catalog handles not supplied for current resolution: history does not authorize access and removing a source does not erase local origins. Preserve all literal identity fields; reject duplicate logical known identities just as resolver does.
3. `installed.complete:true` asserts a complete relevant local namespace, including every occupied immediate child name in ALL API/runner skill locations relevant to this contemplated import. It is not just the selected manifests' names or `listSkills()` results (that discovery skips malformed/non-directory/unmanaged entries). A future caller must reconcile multiple locations: measured evidence is eligible only if every required copy is stable and equal; divergent/unknown/unmanaged occupancy is represented as `occupied`. The library cannot establish completeness, actual disk observation, host coverage or origin authenticity. False/missing observations are not repaired or inferred.
4. `occupied` is a fail-closed non-reuse claim, not absence or an installed object. It represents unmanaged skills, non-directory placements, divergent copies or content not independently measured. No fabricated identity, digest, actor, installation ID or timestamp is accepted/generated for it. It blocks only a selected closure skill with the same case-folded name; unrelated occupancy remains inert.
5. `measured` has independently supplied exact current bytes and executable modes of a complete local subtree, including the actual root `orgops-package.json`. Those bytes must come from a trusted stable current-content measurement, not a copy of the requested upstream snapshot. Caller supplies original recorded `origin` separately; the library validates its shape/name/kind but cannot authenticate it or disk provenance. It derives file sizes/digests from actual bytes, parses the actual local manifest and reinspects its actual content. It NEVER accepts `currentDigest` as an import input.
6. Measured origin must be a skill and have exactly matching lower-case PackageName `name`. Any well-formed but edited, malformed-manifest, absent-manifest, executable-manifest, blocked-leaf, extra-empty-directory or otherwise uninspectable measured skill becomes `blockedNames`, not a claimed digest match. Unrelated locally edited skills therefore do not unnecessarily block other roots. Strict malformed envelope/base64/path/duplicate evidence fails the whole request, rather than being treated as absence. A newly resealed valid local edit has a derived current digest different from origin; pass the derived digest to resolver, which rejects reuse when relevant.
7. Successfully inspected measured skills alone produce resolver `InstalledSkill` entries with original identity and current inspected manifest digest. After the resolver succeeds, test every resolved skill name against `blockedNames` before composing any success. The unchanged resolver decides exact pinned reuse and conflicts for measured valid skills. Case-insensitive occupied aliases also block; no side-by-side versions, overwrite, rename, merge or skill enabling occurs.
8. For a valid local manifest the format's existing semantic digest ignores lexical root manifest whitespace/key order (and uses standard JSON last-key semantics). Such lexical differences alone do not invalidate semantic equivalence. Retain the full exact local manifest bytes in `preconditions.installed` and reuse review, never replace them. Extra files/modes/metadata/content changes invalidate equivalence. This is semantic package equivalence under the existing digest contract, not byte identity of upstream lexical metadata.

### Paths, files, bounds and work order

- All input is JSON-only own enumerable data properties: reject unknown/missing fields, accessors without invoking them, sparse/extra-property arrays, cycles, symbols, functions, dates/nonplain objects, undefined, nonfinite numbers and lone surrogates. Use `validateCatalogJson(input, IMPORT_LIMITS.inputJsonBytes)` FIRST. Existing Proxy/native OOM limitations remain; this is not an executable-JS or single-copy heap sandbox. Catch unexpected normal exceptions into one fixed redacted failure; never log authored data.
- After descriptor JSON validation, preflight all top-level counts, target tools (64), each index (4096 and 2MiB) plus aggregate index entries (8192), each snapshot manifest (256KiB), content list (256 and 12MiB), execution arrays (API256/scripts256/commands35/external1) and warnings4096; each warning `at` max1024, execution path240, command `at`240, command16384, args128×4096, external repo201/ref128. Apply schema limits to all remaining authored manifest fields: instructions/soul65536 each, description4096, author/license256, secrets64 with name64/description1024, dependencies64, tools64, platforms3, preloads64, sidecars16, bounded positive integers2147483647 and finite temperature0–2. Repository URL2048/sshUser64, handles64, versions max20, commits40/64, digest71, paths240 with segments64. No coercion or default arrays.
- `installed.entries` <=4096; occupied names are one `RelativePathSchema` segment, not necessarily lowercase, <=64; measured names must additionally be `PackageNameSchema`. Reject duplicate/casefold occupancy names globally. Nonportable unrelated occupied names are outside this conservative evidence subset and fail, never disappear. Root is not an entry.
- Complete measured trees have <=1024 entries each and <=8192 entries combined, including explicit directories/blocked leaves. Validate package-relative paths, full joined `${name}/${path}` <=240, exact ancestor directory entries, duplicate/case twins, file/blocked ancestors and inconsistent implicit ancestor casing. Root manifest exact spelling only; case alias/directory/special root manifest cannot prove reuse. Empty extra directories cannot prove equivalence. Blocked leaves carry no target or body and are never followed. Nested `assets/orgops-package.json` is ordinary content.
- Before ANY decode/hash/YAML/manifest parsing, resolver call or expensive clone/map: preflight canonical encoded upper lengths and decoded size estimates for EVERY supplied snapshot file and EVERY local file occurrence (including repeated byte strings and root manifests). Count <=8192 file occurrences, <=32MiB decoded total. Each ordinary file <=1MiB, actual local root manifest <=256KiB; each snapshot content <=8MiB, each local tree ordinary content excluding root manifest <=8MiB. Snapshot root semantic manifest is separately JSON-bounded; it is not a supplied file byte occurrence. Local body strings must be canonical padded RFC4648 (empty valid). Invalid lexical base64 rejects, not lossy decode. Final decoded lengths/reencoding must agree. Counts at equality pass this stage; +1 fails before hashing/inspection even if semantic input is invalid.
- Validate source/catalog/root/target/known identities and canonical index/manifests after externally knowable counts/byte preflights. Reinspect supplied immutable snapshots with `inspectPackage` and compare each claimed file size/digest to measured values; regenerate execution/warnings, never trust their semantic assertions. All supplied snapshots, including unused ones, are checked by this narrower operation. Do not re-export packages: preserve valid native auxiliary content and unchanged wrapped subset.
- Canonical validation has its OWN fixed `IMPORT_LIMITS.validatedJsonBytes=67108864` budget for the complete private `ValidatedImport` representation, not merely the submitted input or eventual public preview. Count compact UTF8 JSON of `{input,installedSkills,blockedNames,installedFiles}` including every repeated occurrence, field/key/punctuation and regenerated snapshot execution/warnings. Separately require canonical `input` <=`inputJsonBytes` (64MiB); a bounded submitted input does not imply bounded regenerated evidence. Maintain incremental exact JSON-byte accounting for these two representations: charge unchanged validated fields/envelope syntax once; before retaining each regenerated snapshot in canonical `input`, or each derived installedSkills/blockedNames/installedFiles item in the private representation, measure that bounded piece with `validateCatalogJson`/exact bounded compact JSON accounting and reject growth beyond either applicable remaining budget. Do not first clone all supplied input or construct/map all regenerated snapshots/local review collections and only then check. Build detached canonical collections incrementally and charge before append/clone; retain no over-budget evidence and return no partial value. Finally independently run descriptor JSON checks on BOTH canonical `input` and the entire `ValidatedImport` at their respective fixed limits before the final freeze/return. Input/validated/output limits are separate ceilings, not additive permission or a single-copy heap bound.
- Apply `snapshotWarnings:4096` and ALL applicable execution/list/string/manifest/file caps to REGENERATED snapshots too, including locally inspected snapshots before deriving reuse or retaining their data. Caller-supplied `warnings:[]` or empty execution arrays do not waive actual review limits. For a well-formed local semantic/content mismatch, retain blocked-name behavior; a LIMIT_EXCEEDED during parsing/inspection/regenerated review/canonical accounting instead fails the entire operation with fixed LIMIT_EXCEEDED at installed/packages as appropriate, never downgrades overflow to an unrelated blocked name. Each `inspectPackage` call may temporarily allocate its own regenerated snapshot under preflighted per-package input/schema bounds; checking its result does NOT preempt that bounded internal allocation. Immediately check/charge each result before retaining it or performing the next inspection. Count local `installedFiles` as an additional occurrence beyond raw `input.installed` bytes, and count derived identity/digest/name data too. No warning truncation, preview omission or unbounded serialization of the whole expanded evidence is permitted.
- Independently measure local bytes/modes. For local inspection use a fatal UTF8 decoder with `ignoreBOM:true` and `parsePackageManifest` on actual root bytes, then `inspectPackage` on ordinary files excluding root manifest. For inspectable locals, verify the complete tree consists exactly of root manifest, content files and their required explicit ancestors; any extra empty directory/blocked leaf prevents reuse. Do not synthesize a current manifest/inventory from requested content to hide local edits. `parseSkillDocument` is reached only through inspection, never active discovery/YAML module execution.
- Include-package path safety uses root-manifest plus content and their implicit ancestors with shared exact casing; reject `A/x` plus `a/y`, leaf/ancestor collisions and case aliases. Each relative full file path <=240; for skills the conservative future name-relative `${manifest.name}/${file.path}` must also fit240. These are logical portable review paths, not a filesystem destination or placement authorization. Native/wrapped package storage placement is deferred; no agent directory/path/row is produced.
- Output preflight is incremental: <=8192 review `packages[].files` occurrences, <=32MiB their decoded bytes, <=64MiB complete compact UTF8 JSON of the ENTIRE output (including preconditions/current evidence, regenerated snapshots/execution/warnings and identities). Charge bounded pieces using descriptor JSON accounting before attaching/cloning/serializing them; final `validateCatalogJson` verifies the completed object. Never build an unbounded `JSON.stringify`/decode/map first. For generated root manifests compact canonical content is already bounded, but the actual pretty serialized bytes must separately fit256KiB BEFORE base64/hash. All output limits fail with no partial preview and no truncation. Some guards are defense-in-depth under tighter combined bounds: report that honestly and use private reduced-constant tests, not public budget overrides.

### Resolver bridge and complete review

- `precheckPackageSources` is the extracted existing metadata-only publication walk: every reached catalog needs enabled catalog AND enabled configured source; each explicit `location.type:"source"` needs independent enabled `allowPackages:true`, even when it equals a catalog owner; each cross-source dependency pin checks that permission BEFORE request/node dedupe. Same-source catalog-owned pins do not need allowPackages. Reached missing catalog/location/package evidence fails. Only after this check return sorted reached permitted source IDs for `resolvePackages`; no blanket union. Its queue remains bounded by max256 visited nodes ×64 dependency pins plus roots64 (16448 requests maximum), with checks before append beyond that ceiling.
- `prepareImport` calls validation, source precheck, then `resolvePackages` ONCE with `roots:[input.root]`, canonical catalogs/packages/knownReleases/target, derived inspected `installedSkills`, and helper-produced `allowedSourceIds`. It adds no temporary commits or publication proposal/history context. Root success is found by exact `(catalogId,name,version)` and all literal resolver identity fields retained.
- Post-resolver reject selected blocked local names with `SKILL_CONFLICT` at `installed`; no partial successful resolution escapes. Exact native/wrapped root is always a portable definition with `action:"include"`, never an existing agent match. Every `packages[]` item retains the resolver's dependency-first order/action, full regenerated snapshot, and explicit direct dependency identities. Construct edges by matching each already resolved child's `catalogId/sourceId/name/version` and pinned commit/digest (same-package-revision uses declaring package source/commit); assert one match. This projects existing resolution, not another graph traversal/resolver. Edge order matches canonical manifest dependency order; diamonds appear once in packages.
- Include files comprise ALL snapshot content plus a normalized nonexecutable root manifest using existing `normalizedManifest`/`canonicalJson`, two-space JSON + LF. Label `manifestBytes:"normalized-package-manifest"`: supplied `PackageSnapshot` does NOT contain source lexical root bytes, so do not claim those generated bytes are an exact upstream Git blob. Do not use publication/export allowlists that discard valid content. Reuse files are the independently measured exact existing file set including lexical root manifest, labelled `current-installed-manifest`; no replacement bytes implied. Every file has full canonical base64, derived size/SHA256/executable bit and fatal-UTF8/binary classification. Binary files are explicitly unscanned; authored byte previews may contain sensitive text and must not be logged.
- Reuse `snapshot.execution` and `snapshot.warnings` regenerated by the existing inspector for complete command/API/script disclosure and supplementary warnings. Preserve full root manifest/template and each package's own declared compatibility/secrets, no lossy global flattening or cross-package secret-name dedupe. No second scanner, finding threshold, scanner version or secret safety claim. `reviewRequired:true` even for clean/reused content; warnings neither grant nor deny later activation.
- `preconditions` retain the canonical supplied root/sources/catalogs/target/complete occupancy/raw local content/known history. `packages` carry complete resolved exact package identity and contents, including origin-preserving reuse. Sort set-like inputs by explicit code-unit tuples: sourceId; catalogId and index name/version; package sourceId/commit/path; known catalogId/sourceId/name/version/packageCommit/path/catalogCommit; occupancy name and local path; tools. Manifest sets normalize with existing helpers; command args, sidecars, authored strings and lexical local root bytes remain exact. Detach/freeze all output recursively; never freeze/mutate caller input.
- No preview checksum is added: no approved consumer needs an approval/retry token, and a checksum risks unnecessary serialization/scanner duplication. Existing package/file digests remain integrity/consistency only. `kind`, `reviewRequired` and literal `authority:"none"` make the boundary explicit; no ready/approved/installed/runnable/startable/actor/time/capability fields exist.
- Errors are exactly one `{code,at}` and no value, with constant `at` from the union above. Map helper/resolver/inspector codes to the owning constant field (`SOURCE_NOT_ALLOWED` to sources, dependency/identity/compatibility/limit to packages or target as applicable, local conflicts to installed); never forward authored paths, YAML messages, commands, URLs, rejected values or exception text. Internal code failures also redact. Deterministic precedence follows validation/work order above; within canonical collections use code-unit order.

### Validation, chronology, task handoff and commits (every task)

Record exact `TASK_BASE=$(git rev-parse HEAD)`, branch, cwd/status/index before edits; stop on unexpected state. Task1 obtains a fresh baseline BEFORE source/tests; later task/fix labels are unique and never overwrite failure artifacts. Every writer runs focused real failing assertion then minimal change then passing regression; an initial missing-module/export failure is only scaffolding RED, not security proof. Add a behavioral RED after a callable seam exists and before the tested behavior. Supplemental already-passing cases are honestly labelled supplemental. Reviewers do not edit files. Every task/fix handoff includes full task range plus fix-only range and paths to every actual RED/GREEN/final/lint artifact.

Task1 copies the prior scripts into D and changes only phase paths/baseline paths (never prior artifacts):

```bash
cd /home/slamnation/www/orgops
D="$PWD/.superpowers/sdd/2026-09-10-catalogs-08-offline-import-preparation"
P="$PWD/.superpowers/sdd/2026-09-10-catalogs-07-offline-publication-evidence"
cp "$P/parent-verify.sh" "$D/parent-verify.sh"
cp "$P/compare-lint.py" "$D/compare-lint.py"
python3 - <<'PY'
from pathlib import Path
D=Path('.superpowers/sdd/2026-09-10-catalogs-08-offline-import-preparation')
p=D/'parent-verify.sh'
p.write_text(p.read_text().replace('2026-09-10-catalogs-07-offline-publication-evidence','2026-09-10-catalogs-08-offline-import-preparation'))
p=D/'compare-lint.py'
s=p.read_text().replace("d=root/'.superpowers/sdd/2026-09-10-catalogs-07-offline-publication-evidence'", "d=root/'.superpowers/sdd/2026-09-10-catalogs-08-offline-import-preparation'")
s=s.replace('2026-09-10-catalogs-06-offline-publication-preparation/parent-final-lint.json','2026-09-10-catalogs-07-offline-publication-evidence/parent-final-lint.json')
p.write_text(s)
PY
bash "$D/parent-verify.sh" task-1-baseline
python3 "$D/compare-lint.py" task-1-baseline > "$D/task-1-baseline-comparison.txt"
cmp "$P/parent-final-root-lint.txt" "$D/task-1-baseline-root-lint.txt"
```

Expected fresh baseline:1681 Vitest tests/47 files,3 opscli; root lint exit2 and API486/runner2 diagnostics, ten other workspaces clean. Script independently runs all TWELVE workspaces (api,agent-runner,opscli,admin-ui,user-ui,db,schemas,event-bus,llm,crypto,skills,events-scenario-tests), plus root test/opscli/root lint: exact15 unique exit labels and nonempty raw logs. Full line/column/code/multiline-message/multiplicity Counter equality, no unparsed diagnostics, no new diagnostics. Diagnostic-bearing source files must stay unchanged, no position normalization. Root raw lint must compare byte-identically while unchanged.

All test invocations use this shell function (including RED/GREEN and documentation example), no `.env`, production HOME, credential inheritance or install:

```bash
D=/home/slamnation/www/orgops/.superpowers/sdd/2026-09-10-catalogs-08-offline-import-preparation
mkdir -p "$D/scratch/home" "$D/scratch/tmp"
safe() { (ulimit -c 0; timeout --kill-after=5s 600s env -i PATH="$PATH" HOME="$D/scratch/home" TMPDIR="$D/scratch/tmp" CI=1 /bin/bash --noprofile --norc -c 'set -a; source .env.example; set +a; export ORGOPS_LLM_STUB=1; exec "$@"' bash "$@"); }
```

For task N use literal matching labels in that task, preserve actual exits beside logs, then run `bash "$D/parent-verify.sh" task-N-final`, `python3 "$D/compare-lint.py" task-N-final > "$D/task-N-final-comparison.txt"`, and `cmp "$D/task-1-baseline-root-lint.txt" "$D/task-N-final-root-lint.txt"`. Routine test/type/fixture failures are diagnosed locally with distinct attempt labels; baseline/diagnostic shifts need explanation and gate approval, not discarded evidence.

Full root tests necessarily include existing owned Git fixtures; new import suites require NO Git subprocess. Never acquire/use a real repository to test import. Any permitted existing Git composition uses `createGitFixture`, fixed trusted installed Git and owned synthetic bare storage, disposal in finally, no checkout/hooks/filter/helper/package execution. All scratch/evidence stays D; `.env.example` only.

Before every local scoped implementation commit: inspect diff; `git diff --check`; ensure no dependency/lockfile files, diagnostic-bearing source files or unrelated paths changed; stage explicit task paths only, inspect `git diff --cached --name-only` and `git diff --cached --check`; commit; `git diff --cached --quiet`; record full HEAD, branch/status/diff and clean index in task report. Fresh read-only review and structured verdict are required before next writer. Task reports are D/task-N-report.md, fix/attempt/reviewer outputs have distinct paths selected by parent. Never stage D or earlier artifacts. Whole-phase review and independent parent acceptance remain mandatory after Task3; do not claim full v1/two-instance acceptance.

### Preflight producer/consumer consistency table

| Contract/seam | Producer | Consumer | Internal/cross-task check |
|---|---|---|---|
| Exact `ImportInput`, limits, error pointers | Task1 import-types | Task1 validator, Task2 composer, Task3 exports/docs | Same fields/values above in every brief; no caller currentDigest; separate submitted input/canonical input64MiB and complete private validatedJsonBytes64MiB, regenerated preview caps charged before retention |
| `ValidatedImport` incl derived installedSkills/blockedNames/installedFiles | Task1 validator | Task2 prepareImport/composeImportReview | Validated input detached/frozen; local current bytes and origins separate |
| `precheckPackageSources(SourcePolicyInput)` | Task2 extraction | Existing publication bridge and new prepareImport | Same old permission precedence; no pin graph replacement; all old publication regressions |
| `Resolution` / `ResolvedIdentity` / PackageSnapshot | Existing resolver/inspector | Task1 inspection, Task2 exact closure/review | No signatures/ceilings changed; normalized source manifest vs lexical current manifest labelled |
| `prepareImport`, `ImportPreview` | Task2 | Task3 explicit root export and executable docs example | Complete root+closure/files/requirements; no bindings/start/install authority |
| import-fixtures | Task1, narrow additions in2/3 | All new tests only | Own literals; no publication lifecycle fixture dependency or real Git |
| `docs/SPEC.md` and package contract | Task3 | Parent acceptance and future consumer | Explain actual measured evidence versus trusted completeness; no safe/runnable claim |
| Validation scripts and baseline | Task1 phase-local copy | Every task/fix/reviewer/parent | Exactly15 exits,12 lints, unchanged488 diagnostics/raw root, clean index |
| All task scopes | Task1 evidence;Task2 orchestration-free preview;Task3 public integration/docs | Parent task gates | Three independently testable commits, no placeholder-only setup task |

Self-review: approved design's pure inspection/closure/review requirements covered; runtime binding/install/start/auth/audit/remote/publishing/two-instance portions explicitly deferred, Q1/Q2 unchanged. No new security/product policy is needed for this conditional narrow operation. The conservative current-tree/name evidence limits are adapter bounds, not a new installed skill naming migration. The only existing implementation refactor is the metadata-only source policy extraction, with behavioral parity tests.

---

### Task 1: Validate independent offline import and installed-content evidence

**Files:** Create `packages/skills/src/catalogs/import-types.ts`, `import-evidence.ts`, `import-evidence.test.ts`, `import-fixtures.ts`. Copy/adapt validation scripts under D only. No public exports yet.

**Interfaces:** Consumes existing catalog JSON/schema/inspector contracts and the ENTIRE common prefix. Produces exactly `IMPORT_LIMITS`, all named Import types and `ValidatedImport`, and `validateImportInput(input:ImportInput):ImportResult<ValidatedImport>`. No callable placeholder result may remain in the commit.

- [x] **Step 1 — Record state and obtain the fresh full baseline.** Execute the common baseline commands before source/test edits. Save task base/status, actual test/lint exits and full comparison. Confirm1681/47 +3 and unchanged488. Read the current content/resolve/publication evidence boundary implementations and tests; do not call the active discovery helpers.
- [x] **Step 2 — Add a complete synthetic fixture and initial evidence test.** Fixture code belongs only in `import-fixtures.ts` and reuses existing immutable test manifests/content, not publication proposal fixtures:

```ts
import type { ImportInput, ImportInstalledEntry } from "./import-types";
import { inspectPackage } from "./content";
import { must, skillManifest, skillEntries, classicManifest, rlmManifest, wrappedManifest, catalogIndex } from "./fixtures";
export const IMPORT_COMMIT = "1".repeat(40);
export function importInput(name = "echo-agent"): ImportInput {
  const manifests = [skillManifest, classicManifest, rlmManifest, wrappedManifest];
  return structuredClone({
    root: { catalogId: "team", name, version: "1.0.0" },
    sources: [{ sourceId: "team-source", repository: { url: "https://example.invalid/team/catalog.git" }, enabled: true, allowPackages: false }],
    catalogs: [{ catalogId: "team", sourceId: "team-source", commit: IMPORT_COMMIT, enabled: true, index: catalogIndex }],
    packages: manifests.map(m => ({ sourceId: "team-source", commit: IMPORT_COMMIT, path: `packages/${m.name}`, snapshot: must(inspectPackage(m, m.kind === "skill" ? skillEntries : [])) })),
    target: { orgopsVersion: "0.0.1", platform: "linux" as const, tools: ["node"] },
    installed: { complete: true as const, entries: [] }, knownReleases: [],
  });
}
export function measuredSkill(): ImportInstalledEntry {
  return { state: "measured", name: skillManifest.name,
    origin: { catalogId: "team", catalogCommit: IMPORT_COMMIT, sourceId: "team-source", packageCommit: IMPORT_COMMIT,
      path: "packages/echo-skill", kind: "skill", name: skillManifest.name, version: skillManifest.version, digest: skillManifest.digest },
    content: { complete: true, entries: [
      { type: "file", path: "orgops-package.json", base64: Buffer.from(JSON.stringify(skillManifest, null, 2) + "\n").toString("base64"), executable: false },
      ...skillEntries.map(e => { if (e.type !== "file") throw new Error("Synthetic fixture kind"); return { ...e }; }),
    ] } };
}
```

```ts
import { expect, it } from "vitest";
import { validateImportInput } from "./import-evidence";
import { importInput, measuredSkill } from "./import-fixtures";
it("derives current digest from independently supplied local files", () => {
  const input = importInput(); input.installed.entries = [measuredSkill()];
  const before = structuredClone(input), r = validateImportInput(input);
  expect(r.ok).toBe(true); if (!r.ok) throw new Error("Synthetic evidence rejected");
  expect(r.value.installedSkills[0]!.currentDigest).toBe(input.packages[0]!.snapshot.manifest.digest);
  expect(r.value.blockedNames).toEqual([]);
  expect(input).toEqual(before); expect(Object.isFrozen(input)).toBe(false);
  expect(Object.isFrozen(r.value.input.installed.entries)).toBe(true);
});
```

- [x] **Step 3 — Run initial RED, then implement callable validation and a behavioral RED.** `safe npm test -- packages/skills/src/catalogs/import-evidence.test.ts > "$D/task-1-initial-red.txt" 2>&1; echo $? > "$D/task-1-initial-red.exit"`. Missing module is scaffolding only. Implement the strict types/envelopes and independent measurement happy path; BEFORE blocking changes, add/run this actual behavior test and preserve failure if observed:

```ts
it("does not turn edited local bytes into the requested digest", () => {
  const input = importInput(), local = measuredSkill();
  if (local.state !== "measured") throw new Error("Synthetic fixture kind");
  const file = local.content.entries.find(e => e.path === "SKILL.md");
  if (!file || file.type !== "file") throw new Error("Synthetic fixture file");
  file.base64 = Buffer.from("---\nname: echo-skill\ndescription: Echo instructions.\nlicense: MIT\n---\nLOCAL EDIT\n").toString("base64");
  input.installed.entries = [local];
  const result = validateImportInput(input);
  expect(result.ok).toBe(true); if (!result.ok) throw new Error("Synthetic envelope rejected");
  expect(result.value.installedSkills).toEqual([]);
  expect(result.value.blockedNames).toEqual(["echo-skill"]);
  expect(result.value.input.installed).toEqual(input.installed);
});
```

Run with `safe npm test -- packages/skills/src/catalogs/import-evidence.test.ts -t 'edited local bytes' > "$D/task-1-behavior-red.txt" 2>&1; echo $? > "$D/task-1-behavior-red.exit"`. If the happy-path implementation already catches this, report supplemental GREEN and choose the still-unimplemented missing-completeness/duplicate-path rule for honest behavioral RED; never remove working safety code just to force RED.

- [x] **Step 4 — Finish minimal evidence implementation in mandated work order.** Use fixed failures and remap underlying issues. The local decision core is:

```ts
// After global descriptor/count/encoded preflight and strict tree validation:
const rootFile = local.content.entries.find(e => e.path === "orgops-package.json");
// Missing/blocked/executable root, special leaves and extra empty dirs mark this name blocked.
// Fatal root decode and parsePackageManifest operate on current bytes, never requested snapshot.
const parsed = parsePackageManifest(rootText);
const inspected = parsed.ok ? inspectPackage(parsed.value, ordinaryContent) : parsed;
if (!inspected.ok && inspected.issues[0]!.code === "LIMIT_EXCEEDED") {
  return { ok: false, issues: [{ code: "LIMIT_EXCEEDED", at: "installed" }] };
}
// Successful regenerated preview caps and both cumulative canonical budgets must
// pass before retaining the snapshot, installedSkills entry or installedFiles.
if (!inspected.ok || inspected.value.manifest.kind !== "skill" || inspected.value.manifest.name !== local.name) {
  blockedNames.push(local.name.toLowerCase());
} else {
  installedSkills.push({ name: local.name, identity: local.origin, currentDigest: inspected.value.manifest.digest });
}
```

`rootText` is fatal-decoded current root file; `ordinaryContent` is the validated current non-root ordinary collection; both are built only after the common global preflight. Measure every local file with actual SHA256/size and encoding for `installedFiles`; never accept caller size/digest claims there. Blocked raw local evidence remains in preconditions. Return canonical detached frozen validated structures without mutating input.

- [x] **Step 5 — Complete table-driven evidence/security coverage.** Add executable tests built by mutating `importInput`/`measuredSkill`: missing/false installed or content completeness; forbidden `currentDigest` and secret-value/DB fields; root/nested getter count0, cyclic/nonplain/sparse/symbol/nonfinite/depth33; duplicate/casefold occupancy, uppercase occupied aliases, unsafe/unportable names; duplicate source/repository aliases, unbound catalog/package source and history preservation; path traversal/case twins/implicit ancestor spelling, absent ancestors/blocked ancestors, joined240/+1, nested manifest; root missing/executable/invalid UTF8/BOM/malformed JSON, changed content/mode/resealed metadata, extra file/empty directory/blocked leaf. Check edited unrelated names remain blocked evidence rather than global `SKILL_CONFLICT`. Check source snapshot forged size/digest fails, semantic execution/warning claims regenerate. All emitted errors use only fixed pointer union and never the synthetic marker.

For every limit in the common prefix add boundary and +1 preflight tests, reusing shared immutable strings rather than quadratic allocation. Counts/bytes should use valid equivalent-boundary fixtures where feasible; otherwise spy on crypto/inspectPackage/resolver to prove preflight wins before semantic failure, record that it is a preflight—not successful package—boundary. Large inputs use 30s individual Vitest test timeout within600s shell bound. Add `vi.spyOn(Buffer,"from")` after fixture construction to count base64 decodes, and crypto mock pattern from publication-base tests to prove none before global byte/count overflow. Add real expansion fixtures with valid wrapped manifests containing many synthetic sensitive command arguments but supplied `warnings:[]` and empty execution claims; assert regenerated warnings/commands are present and counted, never silently suppressed. Test an actual reachable cumulative canonical expansion past64MiB using repeated unique supplied package envelopes with compact authored wrapped manifests and deliberately underspecified incoming preview claims: measure serialized input remains below64MiB, while regenerated executions/warnings make the canonical private evidence overflow. Verify LIMIT_EXCEEDED/no value and no inspections after the failing append budget. Independently test canonical `input` versus full `ValidatedImport` budget guards, including repeated local raw bytes plus installedFiles data. If schema/other bounds prevent a particular natural exact/+1 boundary, use isolated private reduced `validatedJsonBytes`/`snapshotWarnings` constants and restore modules, recording that fact. In particular, demonstrate real regeneration of thousands of warnings from an empty claim; if the actual schema cannot naturally exceed4096 warnings, use a lowered private snapshotWarnings cap for the regenerated-cap rejection (not a false claim that natural4097 was reached). At reduced equal/+1 budgets use independently serialized expected canonical evidence sizes; prove failures happen before retaining/cloning that next regenerated piece. Per-inspector temporary allocation is already bounded by per-package preflight, not prevented by postinspection accounting. Final canonical input and private representation checks must each have coverage. Fixed PUBLIC preview output guards belong to Task2, not this task.

- [x] **Step 6 — GREEN, prior suites, full verification, scoped commit and review gate.**

```bash
safe npm test -- packages/skills/src/catalogs/import-evidence.test.ts packages/skills/src/catalogs/content.test.ts packages/skills/src/catalogs/skill-document.test.ts packages/skills/src/catalogs/resolve.test.ts packages/skills/src/catalogs/export.test.ts packages/schemas/src/catalogs > "$D/task-1-green.txt" 2>&1
echo $? > "$D/task-1-green.exit"
bash "$D/parent-verify.sh" task-1-final
python3 "$D/compare-lint.py" task-1-final > "$D/task-1-final-comparison.txt"
cmp "$D/task-1-baseline-root-lint.txt" "$D/task-1-final-root-lint.txt"
git diff --check
```

Expected focused/full tests exit0; skills/schema lint0 and unchanged488 overall. Inspect and commit only the four created source/test files: `feat(catalogs): validate offline import evidence`. Record full TASK_BASE/HEAD/diff, test counts/exits, residual evidence assumptions and clean index in D/task-1-report.md and structured verdict. Parent obtains a fresh read-only task review before Task2.

### Task 2: Reuse source permissions and resolver to compose complete inert import review

**Files:** Create `packages/skills/src/catalogs/source-policy.ts`, `source-policy.test.ts`, `import.ts`, `import.test.ts`; modify only the policy-walk block/imports in `publication-resolve.ts`; additive test helpers in `import-fixtures.ts` if needed. No schemas, resolver algorithm, publication identities/history or root exports changed.

**Interfaces:** Consumes `ValidatedImport`/`validateImportInput` and all exact common types/limits. Produces `precheckPackageSources(input:SourcePolicyInput):ContractResult<readonly string[]>`, `prepareImport(input:ImportInput):ImportResult<ImportPreview>` and private `composeImportReview(checked:ValidatedImport,resolution:Resolution):ImportResult<ImportPreview>`. Existing publication caller changes only to invoke the shared precheck; return type/public behavior stays identical.

- [x] **Step 1 — Record TASK_BASE and read the exact prior task review and actual implementation.** Require its fresh review structured verdict, clean branch/index and no unexplained diff. Read `resolve.ts`, `publication-resolve.ts`, their full tests and Task1 evidence producer; check types agree with this prefix.
- [x] **Step 2 — Write source-permission regression and safely extract the existing walk.** Copy the existing metadata-only policy walk into the named helper, with its unchanged fixed errors and exact edge-before-dedupe checks; remove the old copy and delegate publication to it. Do not move temporary commit/history logic. The glue is:

```ts
const policy = precheckPackageSources({ roots, catalogs, packages, sources: v.sources });
if (!policy.ok) return policy;
const resolved = resolvePackages({ roots, catalogs, packages, allowedSourceIds: policy.value,
  target: v.target, installedSkills: [], knownReleases: [...known.values()] });
```

Use a test with one root location.type source pointing at its enabled catalog-owning source with `allowPackages:false`; expect SOURCE_NOT_ALLOWED even though index permission exists. Add a same-source catalog-owned release test that succeeds with false; cross-source pin denial even if target node was already reached; disabled/missing catalog/source, absent bytes, unused denied index, shared-source enabled catalogs and missing pin permission. Spy on resolver in import tests to ensure denied policy never delegates. Extraction parity tests are supplemental if they pass immediately; do not falsely claim a fixed pre-existing publication vulnerability.

- [x] **Step 3 — Add callable composition and real include/reuse/conflict test cycle.** Initial missing-module RED is setup evidence only. Implement validation + source precheck + unchanged resolver delegation; add composition behavior incrementally with honest assertion RED/GREEN files. Core pipeline:

```ts
export function prepareImport(input: ImportInput): ImportResult<ImportPreview> {
  try {
    const checked = validateImportInput(input);
    if (!checked.ok) return checked;
    const v = checked.value.input;
    const policy = precheckPackageSources({ roots: [v.root], catalogs: v.catalogs, packages: v.packages, sources: v.sources });
    if (!policy.ok) return { ok: false, issues: [{ code: policy.issues[0]!.code, at: "sources" }] };
    const resolved = resolvePackages({ roots: [v.root], catalogs: v.catalogs, packages: v.packages,
      allowedSourceIds: policy.value, target: v.target, installedSkills: checked.value.installedSkills,
      knownReleases: v.knownReleases });
    if (!resolved.ok) {
      const code = resolved.issues[0]!.code;
      return { ok: false, issues: [{ code, at: code === "SKILL_CONFLICT" ? "installed" : code === "INCOMPATIBLE" ? "target" : "packages" }] };
    }
    return composeImportReview(checked.value, resolved.value);
  } catch { return { ok: false, issues: [{ code: "INVALID_IMPORT_INPUT", at: "$" }] }; }
}
```

```ts
import { expect, it } from "vitest";
import { prepareImport } from "./import";
import { importInput, measuredSkill } from "./import-fixtures";
it("retains dependency-first review and never authorizes activation", () => {
  const r = prepareImport(importInput());
  expect(r.ok).toBe(true); if (!r.ok) throw new Error("Synthetic preview rejected");
  expect(r.value.packages.map(p => [p.identity.name, p.action])).toEqual([["echo-skill", "include"], ["echo-agent", "include"]]);
  expect(r.value.root.name).toBe("echo-agent");
  expect(r.value.packages[1]!.dependencies).toEqual([r.value.packages[0]!.identity]);
  expect(r.value.packages[0]!.snapshot.execution.apiEventShapes).toEqual(["event-shapes.ts"]);
  expect(r.value.packages[0]!.files.map(f => f.path)).toEqual(["SKILL.md", "event-shapes.ts", "orgops-package.json"]);
  expect(r.value.authority).toBe("none"); expect(r.value.reviewRequired).toBe(true);
});
it("blocks complete occupied namespace even without an installed digest claim", () => {
  const input = importInput(); input.installed.entries = [{ state: "occupied", name: "ECHO-SKILL" }];
  expect(prepareImport(input)).toEqual({ ok: false, issues: [{ code: "SKILL_CONFLICT", at: "installed" }] });
});
it("reuses measured content without replacing lexical local manifest", () => {
  const input = importInput(), local = measuredSkill();
  if (local.state !== "measured") throw new Error("Synthetic fixture kind");
  const file = local.content.entries.find(e => e.path === "orgops-package.json");
  if (!file || file.type !== "file") throw new Error("Synthetic fixture file");
  file.base64 = Buffer.from(" \n" + Buffer.from(file.base64, "base64").toString() + "\r\n").toString("base64");
  input.installed.entries = [local];
  const r = prepareImport(input); expect(r.ok).toBe(true); if (!r.ok) throw new Error("Synthetic preview rejected");
  const skill = r.value.packages[0]!;
  expect(skill.action).toBe("reuse"); expect(skill.manifestBytes).toBe("current-installed-manifest");
  expect(skill.files.find(f => f.path === "orgops-package.json")!.base64).toBe(file.base64);
  expect(r.value.preconditions.installed.entries).toEqual([local]);
});
```

Run `safe npm test -- packages/skills/src/catalogs/import.test.ts packages/skills/src/catalogs/source-policy.test.ts > "$D/task-2-red.txt" 2>&1; echo $? > "$D/task-2-red.exit"`; record actual assertion failures versus setup failures.

- [x] **Step 4 — Implement complete projection and fixed bounds.** `composeImportReview` first rejects any resolved skill in `blockedNames`. Build a map of resolved tuple identities and project direct dependency pins to those exact existing nodes; assert root/edge uniqueness, do not recurse or resolve again. For include generate normalized root manifest plus ALL snapshot files (native auxiliary files included); for reuse select `installedFiles` by exact name. Apply portable path/case/ancestor checks from the common prefix before returning; measure generated manifest actual pretty bytes and per-file output fields. Reuse `snapshot.execution`/warnings; keep every package's full manifest/requirements. Incrementally account ALL compact JSON output, plus review file count/bytes, before retaining large output. Assemble exact common ImportPreview shape, deep detach/freeze only validated bounded data. Do not add checksums, scans, bindings or active effects.

- [x] **Step 5 — Extend actual integration negatives/limits.** Table-drive standalone skill, CLASSIC, RLM_REPL and wrapped root; complete skill-to-skill diamond/dedup (export fresh synthetic skills using existing `exportSkillPackage`, never publication fixtures); cross-source exact identity preserving separate catalog/package commits; same-package-revision wrong source fails unchanged; missing exact dep/version/bytes/pin digest/known-release remap/kind/compatibility rejection with constant safe pointers. Selected edited/extra-file/mode/empty-directory/unmanaged/wrong-origin/version cases fail; unrelated occupied/edited entries don't fail; identical upstream snapshot plus separately edited local content never reuses. Changing only refreshed catalogCommit retains old packageCommit and permits reuse with old origin. Native/wrapped origins never become an active agent.

Test full source-byte/template/declared-secret preservation including valid native auxiliary binary file, throwing API module, every wrapped setup/check/sidecar/check/turn argument (args order unchanged), unpinned external-runtime warning, UTF8/binary marking, no auto-enable/start/approval fields. Validate output input-order invariance and deep freeze/detachment; mutation of source inputs after return cannot alter review. Test include manifest generated label versus local lexical reuse label; final pretty manifest256KiB/+1, full files/count/decoded/output JSON boundaries and each implicit ancestor/case/path conflict. Use independently measured exact JSON bytes and isolated lowered module constants for unreachable output guards, and record why natural boundary is unreachable. Assert no partial `value` on all failures.

- [x] **Step 6 — GREEN, unchanged publication regression, full verification and commit gate.**

```bash
safe npm test -- packages/skills/src/catalogs/import-evidence.test.ts packages/skills/src/catalogs/import.test.ts packages/skills/src/catalogs/source-policy.test.ts packages/skills/src/catalogs/resolve.test.ts packages/skills/src/catalogs/publication-resolve.test.ts packages/skills/src/catalogs/publication.test.ts packages/skills/src/catalogs/publication-base.test.ts packages/skills/src/catalogs/publication-content.test.ts packages/skills/src/catalogs/publication-review.test.ts > "$D/task-2-green.txt" 2>&1
echo $? > "$D/task-2-green.exit"
bash "$D/parent-verify.sh" task-2-final
python3 "$D/compare-lint.py" task-2-final > "$D/task-2-final-comparison.txt"
cmp "$D/task-1-baseline-root-lint.txt" "$D/task-2-final-root-lint.txt"
git diff --check
```

Expected tests0, unchanged488 full diagnostics/root raw and clean skills/schema. Stage only this task's named files after diff/staged-scope inspection; commit `feat(catalogs): prepare conditional offline import previews`. Record TASK_BASE/HEAD, extraction parity, actual RED/GREEN chronology, complete task/fix review packages and clean index in D/task-2-report.md plus structured verdict. Fresh read-only review required before Task3.

### Task 3: Expose and document the conditional public review boundary

**Files:** Modify only `packages/skills/src/index.ts` (explicit exports), `packages/skills/src/catalogs/import.test.ts` (public/no-effect acceptance coverage), `docs/catalog-package-contract.md`, `docs/SPEC.md`. Additive fixture helpers only if required. The approved design status and previous evidence remain untouched; parent owns phase acceptance statements.

**Interfaces:** Consumes exact common `prepareImport`, IMPORT_LIMITS and named public Import types. Produces the root `@orgops/skills` API with the same signature/result and truthful executable documentation. No changes to runtime/native/wrapped schemas, authorization, placement, requirements enforcement or implementation scope.

- [x] **Step 1 — Record TASK_BASE, require Task2 fresh review, verify common producer/consumer agreement.** Read current import evidence/composition/permission helper and public root; verify no internal source-policy or validated types are exported. Check prior no-effect tests in publication as patterns, not as authority that new code is inert.
- [x] **Step 2 — Write public composition tests and record initial export RED honestly.** Add public named imports and require function/limits exposure and no private exports:

```ts
import * as publicSkills from "../index";
it("exposes only the offline import review API", () => {
  expect(publicSkills.prepareImport).toBeTypeOf("function");
  expect(Object.isFrozen(publicSkills.IMPORT_LIMITS)).toBe(true);
  for (const name of ["validateImportInput", "composeImportReview", "precheckPackageSources", "importInput", "measuredSkill"])
    expect(publicSkills).not.toHaveProperty(name);
  const r = publicSkills.prepareImport(importInput("echo-wrapper"));
  expect(r.ok).toBe(true); if (!r.ok) throw new Error("Synthetic preview rejected");
  expect(r.value.packages).toHaveLength(1); expect(r.value.authority).toBe("none");
  expect(r.value.packages[0]!.snapshot.manifest.kind).toBe("wrapped-agent");
});
```

`safe npm test -- packages/skills/src/catalogs/import.test.ts -t 'exposes only' > "$D/task-3-export-red.txt" 2>&1; echo $? > "$D/task-3-export-red.exit"`. Missing export is interface RED, not proof of a security failure. Add explicit exports:

```ts
export { prepareImport } from "./catalogs/import";
export {
  IMPORT_LIMITS, type ImportSource, type ImportLocalEntry, type ImportInstalledEntry,
  type ImportInput, type ImportIssue, type ImportResult, type ImportReviewFile,
  type ImportReviewPackage, type ImportPreview,
} from "./catalogs/import-types";
```

- [x] **Step 3 — Add public inertness/no-authority acceptance coverage.** Construct fixtures BEFORE spies; then spy/mock fs sync and promises read/write/lstat/readdir, child_process spawn/exec/execFile, fetch/http/https, active `listSkills`/`loadSkillMeta`/`loadSkillEventShapes`, Date.now/crypto.randomUUID and console methods. Test each of the four root fixture names through the real public function, assert synchronous not-Promise, exact template and complete closure review, and zero calls; restore in finally. No package-authored module is ever dynamically imported. These tests are supplemental GREEN if they immediately pass. They guard observable seams, not a claim of a sandbox against arbitrary Proxy traps.

Add public malformed input tests rejecting callbacks/bindings/secret values/approved/installed/runner/database fields. Check success has only the exact common fields, no install/start methods/capabilities, and all errors contain one fixed safe issue with no authored marker. Public integration tests require no real Git, host tooling or instance. Verify existing export/inspection/resolution signatures and behavior remain stable, with prior catalog suites plus root tests.

- [x] **Step 4 — Update both contract docs accurately and add a complete runnable tiny example.** Document exact public types/limits, policy precheck distinction, complete relevant namespace assertion versus independently inspected current bytes, measured reuse/local edit preservation, normalized incoming manifest vs lexical existing manifest, binary full review, native auxiliary files, wrapped none subset, inspector-only supplementary warnings and no checksum. Explain API event activation separately from stopped-agent/start, standalone no auto-enable, and all deferred bindings/admin/live-content/placement/requirement gates. Do not say fully installed/configured/runnable. Include this complete public-only in-memory example and run it as a phase-local `.mts` file:

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

Save exact example to D/task-3-doc-example.mts and run `safe node --import tsx "$D/task-3-doc-example.mts" > "$D/task-3-doc-example.txt" 2>&1; echo $? > "$D/task-3-doc-example.exit"`. Example intentionally produces no authored logs; record a separate successful-exit receipt rather than claiming nonempty program stdout. Full verification raw logs still must be nonempty.

- [x] **Step 5 — Finish acceptance matrix, full verification, docs/code scoped commit.**

```bash
safe npm test -- packages/skills/src/catalogs packages/schemas/src/catalogs > "$D/task-3-green.txt" 2>&1
echo $? > "$D/task-3-green.exit"
bash "$D/parent-verify.sh" task-3-final
python3 "$D/compare-lint.py" task-3-final > "$D/task-3-final-comparison.txt"
cmp "$D/task-1-baseline-root-lint.txt" "$D/task-3-final-root-lint.txt"
git diff --check
```

Expected all tests0 including separate opscli3, all12 workspace logs present, unchanged488 diagnostics/root raw. Verify changed files against task scope and dependency baseline, inspect explicit stage, commit `feat(catalogs): expose inert offline import review contract`; record full TASK_BASE/HEAD, test count/exit evidence, complete common interface/limit table, no-source-effects evidence limitations, dependency/whitespace/index checks and residual trusted-caller assumptions in D/task-3-report.md plus structured verdict. Parent launches fresh task then whole-phase read-only reviews and independent acceptance; this task does not accept itself or update full-design acceptance status.

## Execution tracking — bounded offline phase accepted

Tasks 1–3 are implemented in `4b7e850fe69ad14b1c376ddc75e86f284487fd10`,
`f2c8797519e95f326e9a0ee7c76aa0ca3b193f1e` and
`eb0f06cbec5ac263e9920d5f4120a7326e9e5af4`. Parent-supplied task review
handoffs authorized sequential work; the latest structured Task 3 verdict is approved.
Checked steps record task completion; whole-phase review and independent parent acceptance subsequently completed as recorded below.
Actual RED/GREEN chronology, fixture corrections and reduced-limit test boundaries are
preserved in phase-local `task-1-report.md`, `task-2-report.md` and `task-3-report.md`;
missing-module/export failures are not security RED evidence.

Final tracking validation: isolated Vitest 1937 tests/50 files and separate opscli
3 tests pass. Root lint and all twelve independent workspace lints retain exactly
488 existing diagnostics (API486/runner2); ten workspaces are clean. Full diagnostic
positions/messages/multiplicities match the fresh phase baseline, and raw root lint
is byte-identical. See phase-local `validation-report.md` and `phase-validation-*`
raw logs/exit receipts for current validation and the full phase review package.

- [x] Tasks 1–3 implementation and task-review handoffs complete.
- [x] Final isolated validation and tracking prepared for whole-phase review.
- [x] Fresh read-only whole-phase review with native structured verdict.
- [x] Independent parent acceptance.

Parent verified all four actual structured review approvals and inspected the complete production validator/types/composer/shared policy, its publication extraction diff, focused regression/budget/no-effect coverage and public documentation. Reviewed/tested HEAD: `91655d00e9ecc785709dbfce6d6ef3d0b931eea3`. Fresh independent parent rerun: **1937 Vitest tests/50 files**, **3 opscli tests**, all twelve workspace lints with exactly **488 unchanged diagnostics** including positions/full messages/multiplicity, ten clean workspaces and byte-identical root lint. Root lint remains exit2, not green. The parent also ran the exact public-only documented `.mts` example successfully (intentionally empty stdout, recorded exit0). Scope/whitespace/dependency checks passed; only acceptance docs changed afterward. Evidence: `.superpowers/sdd/2026-09-10-catalogs-08-offline-import-preparation/parent-acceptance.md`, `parent-final-*` and `parent-doc-example*`.

No installation, activation, start, approval capability, publication, live instance
or full-design/two-instance acceptance is claimed. Q1/Q2 remain deferred.
