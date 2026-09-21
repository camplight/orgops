# Offline Exact Git Inspection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (controller only) or superpowers:executing-plans to implement this plan task-by-task. Workers must not launch nested agents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read one exact commit from trusted, narrowly provisioned local bare Git storage and inspect one selected package or catalog index without checkout, execution, network, credentials or activation.

**Architecture:** A private bounded Git session owns subprocess lifecycle and aggregate accounting. A private raw-object reader traverses only the selected ancestry/subtree, preserving raw tree modes and bytes; two explicitly I/O-named public adapters delegate semantic validation to the existing inert parsers/inspector. Source authorization and authenticated acquisition remain separate future responsibilities, not callbacks supplied to this module.

**Tech Stack:** Existing TypeScript, Node child_process/fs/crypto/Buffer APIs, installed Git (local planning oracle 2.43.0), Vitest, npm workspaces; no dependencies or lockfile changes.

**Spec:** `docs/superpowers/specs/2026-09-09-skill-agent-catalogs-design.md`; current contracts `docs/SPEC.md` and `docs/catalog-package-contract.md`; controller scope `.superpowers/sdd/2026-09-10-catalogs-04-offline-git-inspection/controller-brief.md`.

## Global Constraints

- Work only in `/home/slamnation/www/orgops`, branch `88-move-private-skills-into-a-private-repo`; initial implementation baseline before the docs commit is `0eaea68e9fd7ffea4eaa7f612739174099cc5f3b`.
- No worktrees, pushes, remote writes, merges, publication, nested agents, real instance state/services or production credentials. Local explicit-file commits only; finish with no staged files.
- npm only, installed dependencies only, no dependency/lockfile edits and no installation. Fixtures may write/delete only their owned temporary bare repositories/sandbox files; never change project/global Git configuration or objects/refs for tests.
- “Browsing never executes downloaded package code. Activation of executable content requires explicit approval.” No active skill discovery/import, checkout, extraction, filters, textconv, hooks, shell interpolation, package managers, submodule/LFS fetch, network or credential helpers.
- No refresh/install/publish/UI/API route/DB/credential changes; no implicit source registration, source permissions or dependency fallback. Existing export allowlists and synchronous pure APIs remain unchanged.
- “Digests detect content changes; they do not establish publisher trust or sandbox executable content.” Trusted local storage/executable are not authenticated repository provenance and are not a sandbox.
- `packages/skills` and `packages/schemas` must typecheck cleanly. Other existing debt is permitted only with zero added diagnostics by workspace/file/code/full multiline-message multiset and multiplicity (ignore positions only, preserve existing repo-prefix canonicalization).
- Controller alone owns sequential dispatch/review/follow-up. A runtime/extension/launch/tool infrastructure failure is a hard stop: report exact error, cwd/branch/HEAD/status/diff; no CLI/foreground-agent fallback. Routine source/test failures are diagnosed locally. New material security/product choices go to parent via `contact_supervisor`.

## Shared requirements (included verbatim in every generated task brief)

### Required reading and locality

Read `AGENTS.md`, the full current SPEC, binding design, contract doc and this shared section before implementation. Read current `packages/skills/src/catalogs/{content,resolve,export,fixtures}.ts`, their colocated tests, `packages/schemas/src/catalogs/{primitives,index,manifest,configuration}.ts`, and both package index exports. Do not reuse the privileged wrapper source acquisition implementation. Do not reread old phase plans/ledgers. Prior lint scripts/logs named below are read-only references.

File map / responsibility:

| File | Responsibility / owner |
|---|---|
| `packages/skills/src/catalogs/git-session.ts` | Private, catalog-specific provisioned-repository checks, fixed process protocol, budget and redacted I/O results; Task 1 |
| `packages/skills/src/catalogs/git-session.test.ts` | Protocol/lifecycle/config tests at that internal interface; Task 1 |
| `packages/skills/src/catalogs/git-fixtures.ts` | Test-only owned bare storage and binary-tree builders; never public or imported by production; Task 1, extended by Tasks 2–3 |
| `packages/skills/src/catalogs/git-objects.ts` | Exact commit/root/path traversal and complete bounded package/index bytes; Task 2 |
| `packages/skills/src/catalogs/git-objects.test.ts` | Real Git tree/type/path/resource adversarial fixtures; Task 2 |
| `packages/skills/src/catalogs/git-inspection.ts` | Two public async I/O adapters calling existing pure validators; Task 3 |
| `packages/skills/src/catalogs/git-inspection.test.ts` | Real Git → inspection → resolver/export contracts and purity regressions; Task 3 |
| `packages/skills/src/index.ts` | Explicit new public exports only; Task 3 |
| `docs/SPEC.md`, `docs/catalog-package-contract.md` | Document implemented I/O subset and truthful remaining obligations; Task 3 |

Do not edit schema code, source configuration, pure content/resolve/export implementation or package manifests absent a demonstrated necessary correction escalated to parent. New result codes stay in the skills-local I/O type, not `ContractIssue`.

### Public interface (Task 3; types originate in Task 1)

```ts
import type { ContractIssue, CatalogIndex } from "@orgops/schemas";
import type { PackageSnapshot } from "./content";

export type OfflineGitRepository = {
  directory: string;       // absolute trusted host-local provisioned bare repo handle
  gitExecutable: string;   // absolute trusted installed Git binary; never PATH lookup
};
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
export type OfflineGitResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: OfflineGitIssue[] };
export function inspectGitPackage(input: GitPackageInput, options?: GitInspectionOptions):
  Promise<OfflineGitResult<PackageSnapshot>>;
export function readGitCatalogIndex(input: GitIndexInput, options?: GitInspectionOptions):
  Promise<OfflineGitResult<CatalogIndex>>;
```

The functions accept no URL/ref/source permission/credential/catalog policy input. No sourceId/catalogId/enabled fields are invented; the future caller may explicitly wrap results in existing `CatalogSnapshot`/`SuppliedPackage`. Those envelopes remain attestations. `indexPath` is required, validated by `RelativePathSchema`; **no conventional/default index filename** is introduced. Tests use `catalog/index.json` only as an explicit example. `path` must be a nonroot directory (`.` remains forbidden).

Only the new adapters, public types above, and `OFFLINE_GIT_LIMITS` are exported from `@orgops/skills`. Session/raw-object functions are direct-module internal seams, not new package exports. Existing `inspectPackage`/export/resolve functions remain synchronous and have no added Git/local I/O.

### Trusted storage, platform and input contract

Initial offline process lifecycle supports POSIX `linux`/`darwin`; fail `UNSUPPORTED_GIT_STORAGE` before spawn on other platforms. This is an offline adapter implementation limit, not a change to portable package platform schemas or permanent exclusion of Windows. A later Windows process-tree lifecycle needs review.

The repository directory, its control/object storage and binary are administrator-provisioned trusted host assets, stable for the operation. No malicious host/root, attacker-controlled executable/config/symlink/alternates or concurrent storage mutation protection is claimed. Package trees/blobs, including names, modes, manifest strings and commit messages, are untrusted. A developer checkout or `.git` indirection file is not accepted.

Runtime preflight is intentionally narrower than arbitrary Git config parsing:

1. Before any filesystem/process work, validate own data-property input envelopes, no unknown/missing keys, no accessor calls; ordinary JS proxies/executable objects remain outside caller contract. Options/signal are trusted control-plane inputs, not JSON package data. Validate commit through existing `CommitSchema` (lowercase full 40/64 hex only), selected path through `RelativePathSchema`, trusted absolute host paths as strings ≤4096 UTF-8 bytes without NUL/control characters. Reject empty executable path and relative paths; never repair identities or paths. Snapshot the validated fields before the first await.
2. Use fixed-name `lstat` checks on directory, `config`, `objects`, `objects/info`, `objects/pack` when present. Require actual directories and an ordinary config file, no symlink at these checked handles. No full object-directory walk. Host ancestors and object-store internals remain trusted, not recursively certified.
3. Read config with a 4096-byte cap before Git startup (open/lstat/read bound, not unbounded `readFile` after an advisory stat). Accept byte-exact LF templates produced by the local probe, with `filemode` either `true` or `false`:

```ini
[core]
	repositoryformatversion = 0
	filemode = true
	bare = true
```

or:

```ini
[core]
	repositoryformatversion = 1
	filemode = true
	bare = true
[extensions]
	objectformat = sha256
```

Each ends with one LF; tab characters in the templates are actual tabs. No comments/includes/extra sections/remotes/partialClone/hooks/filter/credential config; no arbitrary config parser or rewriting the supplied repository. This strict provisioning convention is deliberate and must be documented. The future acquisition adapter must provision it, not pass a normal clone directory through.
4. Reject presence (including links) of `commondir`, `config.worktree`, `objects/info/alternates`, `objects/info/http-alternates`; enumerate only `objects/pack` using bounded `opendir` iteration (at most 512 entries, then stop/close), rejecting any `.promisor` suffix. Do not follow entries. Normal loose/packed object internals are trusted. At most 32 fixed metadata filesystem calls plus 513 pack iterator yields, excluding closing handles; no recursive disk traversal.
5. These checks exclude missing-object lazy acquisition by construction: no promisor/remote config. Installed Git 2.43.0 documentation did not establish `GIT_NO_LAZY_FETCH`; **do not rely on guessed flags/env**. Empty protocol allowlist is defense in depth, not permission to run fetch and hope it fails.

### Proven fixed Git plumbing and why raw trees

Planning evidence: `.superpowers/sdd/2026-09-10-catalogs-04-offline-git-inspection/planning-git-probe.py` and `planning-git-probe.json`. The probe runs only owned temporary bare repos, cleans them in `finally`, and confirms installed Git 2.43.0 for SHA1/SHA256, `rev-parse` output, batch missing/type/size framing, binary blob framing, replacement disabling, preservation of raw noncanonical tree mode `100664`, and same-type/same-size loose-object corruption: cat-file echoes the requested OID while returning changed bytes; recomputing the object hash detects it in both formats. Saved installed manual excerpts are `planning-git-man.txt`, `planning-git-cat-file-man.txt`, `planning-git-rev-parse-man.txt`, `planning-git-config-man.txt`.

Each operation starts **at most two** Git children, never concurrently:

```ts
const prefix = [
  "--no-pager", "--no-replace-objects", "--no-optional-locks",
  `--git-dir=${repository.directory}`,
  "-c", "protocol.allow=never", "-c", "credential.helper=",
  "-c", "core.hooksPath=/dev/null", "-c", "maintenance.auto=false", "-c", "gc.auto=0",
];
// 1: validate exact output matches the checked canonical storage template
[...prefix, "rev-parse", "--is-bare-repository", "--show-object-format=storage"];
// 2: only interactive info/contents of already validated full literal object IDs
[...prefix, "cat-file", "--batch-command"];
```

Use `spawn(repository.gitExecutable, argv, { cwd: repository.directory, shell: false, detached: true, stdio: ["pipe", "pipe", "pipe"], env })`. Never `.unref()`. `env` is constructed from constants only: `PATH:""`, `HOME:"/dev/null"`, `XDG_CONFIG_HOME:"/dev/null"`, `LC_ALL:"C"`, `LANG:"C"`, `GIT_CONFIG_NOSYSTEM:"1"`, `GIT_CONFIG_SYSTEM:"/dev/null"`, `GIT_CONFIG_GLOBAL:"/dev/null"`, `GIT_TERMINAL_PROMPT:"0"`, `GIT_ALLOW_PROTOCOL:""`, `GIT_OPTIONAL_LOCKS:"0"`, `GIT_ATTR_NOSYSTEM:"1"`. No spreading process.env, proxy/auth/SSH/LD/NODE options, config/trace/alternate Git variables or inherited stdio. Git binary is trusted; package bytes never choose command/args/env/cwd.

`rev-parse` must exit zero and yield exactly `true\nsha1\n` or `true\nsha256\n`, matching the checked config and commit length. No object-format rewriting, abbreviated IDs, revision peeling, rev expressions, refs or fallback. Git lacking the commands/storage format fails closed; current SHA256 fixture must actually run, not be silently skipped.

The installed cat-file manual documents unbuffered `--batch-command`: `info <oid>\n` returns `<oid> <type> <size>\n`; `contents <oid>\n` adds exactly `size` bytes plus one LF. Missing objects return `<oid> missing\n`. One request in flight, **no `--buffer`, `flush`, `--batch-all-objects`, `--follow-symlinks`, `--filters`, `--textconv`, mailmap or path expressions**. Request strings use validated IDs only, never authored paths. Parse Buffer framing incrementally across arbitrary chunk splits; header length ≤128, full matching OID, type in commit/tree/blob/tag, canonical nonnegative safe decimal size. Before ANY ASCII conversion, require every protocol header byte to be ASCII and valid for its field; `Buffer.toString("ascii")` masks high bits and is not validation. Missing is distinct; other/malformed responses, extra/short bodies, wrong terminator, unexpected EOF and info/contents identity/type/size disagreement are protocol failures. Never accept a maxBuffer/overflow partial buffer.

For EVERY contents response (commit/tree/blob/tag), hash the exact bounded returned bytes as a Git object, with an actual NUL separating header and body:

```ts
const measuredOid = createHash(objectFormat)
  .update(Buffer.from(`${type} ${size}\0`, "ascii"))
  .update(body)
  .digest("hex");
```

Compare lowercase hex to the requested full OID before returning/decoding/parsing bytes. Mismatch is `GIT_OBJECT_INTEGRITY` at `git`. Use immutable session-owned type/size, not caller-mutated metadata. This needs no extra process, filesystem walk or fsck and detects accidental corruption/false echoed identity; it does not authenticate a publisher or defend a malicious host. Charge the already-read bytes normally, and check deadline before/after bounded hashing.

Raw tree bytes use `<octal-mode ASCII> SP <raw-name> NUL <20/32-byte object-id>`, repeated without separators. Parsing raw bytes avoids `ls-tree` normalization of noncanonical modes and permits **preflighting tree size** before contents. Do not dump all repository objects or use recursive ls-tree. Inspect exact commit type first, bounded raw commit body second; require a first line `tree <full matching-format oid>\n` checked as raw ASCII bytes before decoding (no high-bit aliases), do not parse authors/messages as authority and do not follow parent commits. Verify referenced objects have exact required type, not Git's tag peeling behavior.

### Aggregate operation budgets and lifecycle

Fixed limits in `OFFLINE_GIT_LIMITS` (callers cannot raise them; private unit tests may use a direct-module fake clock/process seam, not public overrides):

| Field | Value / enforcement |
|---|---|
| operationMs | 10000 monotonic milliseconds shared across preflight, both processes, traversal, decoding/inspection; no per-object timer reset |
| cleanupMs | 250 fixed post-failure/deadline shutdown-observation allowance; never permits more work or success without reaping |
| processes | 2 started in total, maximum 1 live |
| commands | 8192 total batch requests; account before writing stdin |
| stdinBytes | 1048576 total across both children |
| stdoutBytes | 16777216 cumulative received bytes across both children; discard offending chunk and terminate, never retain past cap |
| stderrBytes | 65536 cumulative received bytes (never returned/logged); rev-parse and batch both included |
| headerBytes | 128 per response line; rev-parse stdout separately capped at 32 |
| commitBytes | 262144, preflight before reading raw commit |
| treeBytes | 262144 per tree, preflight before read |
| totalTreeBytes | 4194304 across all traversed tree occurrences |
| treeOccurrences | 2048; repeated object IDs under different paths count separately |
| treeEntries | 8192 total parsed entries, including ancestor siblings and empty dirs; account before allocating result entries |
| treeDepth | 240 components from commit root (consistent with ≤120 selector components plus ≤120 package-relative components) |
| packageFiles | 256 content blobs **plus one** root manifest |
| packDirectoryEntries | 512; bound metadata iteration before any Git startup |

Existing `CATALOG_LIMITS` govern manifest 262144, index 2097152, file 1048576, total content 8388608 decoded bytes, portable path 240 ASCII characters / 64 per segment. Package-relative and selector paths each independently satisfy RelativePath; the concatenated repository path is not incorrectly revalidated against 240. These additional offline metadata bounds can reject an otherwise format-valid package in a very wide/deep repository; report LIMIT_EXCEEDED, never truncate. Repeated blobs under different paths count once **per inventory entry** for byte budgets, even if metadata is reused. No cache across calls and no budget sharing with a prior operation.

Enumerate the entire selected package subtree before reading any package blob. Preflight type/size of **every** content blob and manifest and sum complete content bytes before reading any blob contents (commit/trees are separately bounded metadata). A manifest's declared sizes/list never decide which actual paths to enumerate or which sizes to trust. The manifest has its own byte allowance outside the 8MiB content cap; index operations read exactly one selected blob with its independent allowance. Total stdout includes all framing and actual payloads; explicit bounds limit Buffer/base64/string amplification to finite multiples, not a single-copy memory guarantee.

Start deadline before asynchronous preflight; check remaining time/signal before and after every await and before allocations/decoding. A single live timer covers the remaining absolute deadline, not 10s per child. Before synchronous semantic inspection, after it, and before returning success, check deadline/signal again; synchronous bounded Node work cannot be preempted mid-call and filesystem calls/kernel scheduling are not hard-real-time. Document that Git decompression may consume CPU/memory internally before output: byte caps and timeout are not an OS memory sandbox or guaranteed absolute execution/memory bound.

On first cancellation/timeout/overflow/protocol/I/O error: latch that deterministic failure, stop stdin/new commands, discard partial result, kill the POSIX process group with SIGKILL, consume/discard remaining pipe data, await close/reaping, remove timers/listeners and close owned fs handles. Ignore ESRCH only for a child/group already gone; a non-ESRCH kill error or fs/pipe close error records a redacted internal lifecycle failure (`GIT_FAILED` at `git` if no prior issue), never raw error/cause/log text. Never kill another group; no spawn after abort. On normal finish, end stdin, require expected complete responses, zero exit, close and successful required cleanup within the same deadline; an exit/cleanup error after good bytes invalidates all data. **No success before reaping and cleanup.**

All expected I/O/lifecycle failures resolve `OfflineGitResult`, never reject with raw exceptions. Existing protocol/parser/timeout/abort/integrity failure wins over secondary lifecycle errors **when required cleanup/reaping is confirmed**; otherwise a lifecycle error after valid data yields GIT_FAILED. The **sole higher-priority exception** is inability to confirm required cleanup/reaping: return `GIT_CLEANUP_FAILED` at fixed `git`, overriding the prior issue. Do not expose PID/local path/raw cause or append secondary issues.

`finish()` waits for required cleanup and returns the selected terminal result; no successful finish without confirmed cleanup/reaping. `dispose(): Promise<OfflineGitResult<true>>` is idempotent and nonthrowing: it reports successful cleanup as `{ok:true,value:true}` even after a failed read, or GIT_CLEANUP_FAILED if required cleanup cannot be confirmed. After successful finish it is a successful no-op. Raw-reader final result must be chosen **only after** awaited disposal (no early `return` inside try/finally that discards disposal status): cleanup-incomplete failure takes precedence; completed cleanup preserves original read/protocol/semantic error. Catch/redact expected reader-local fs errors before selection. Failed opening also cleans up and applies the same cleanup-precedence rule before returning, with no session handed out.

The normal SIGKILL/close path must reap with no leaked processes/handles/timers. Tests must prove this, including cleanup error following an existing failure and cleanup error after otherwise-valid data. If the OS itself denies termination or never delivers close, do not retry indefinitely or claim cleanup/success. Bound shutdown observation to 250ms after the operation deadline or first failure (whichever comes first); this is a fixed `cleanupMs:250` allowance outside the 10000ms work deadline, not a reset per process. Return GIT_CLEANUP_FAILED at `git` if required cleanup/reaping still cannot be confirmed; otherwise retain the original issue (or GIT_FAILED for a lifecycle-only failure). Suppress all partial content, close local pipes/fs handles and clear timers. The impossibility of guaranteeing child reaping under OS termination denial/uninterruptible kernel I/O must be documented; this exceptional failed-cleanup limitation is not a successful detached/background mode, and no new work starts. Callers must **not blindly auto-retry GIT_CLEANUP_FAILED**; operator/process supervision may be needed. Future caller/operator handling is deferred, not a background supervisor or automatic retry added by this slice. Do not promise a sandbox/absolute OS liveness guarantee. No per-object children or persistent sessions.

### Private interfaces between tasks

```ts
// git-session.ts: catalog-specific internals; not exported from package index.
export type GitOperation = { deadline: number; signal?: AbortSignal };
export function createGitOperation(signal?: AbortSignal): GitOperation;
export function checkGitOperation(operation: GitOperation): OfflineGitResult<true>;
export type GitObjectInfo = Readonly<{ oid: string; type: "commit" | "tree" | "blob" | "tag"; size: number }>;
export type GitObjectSession = {
  objectFormat: "sha1" | "sha256";
  info(oid: string): Promise<OfflineGitResult<GitObjectInfo>>;
  contents(info: GitObjectInfo, maxBytes: number): Promise<OfflineGitResult<Buffer>>;
  finish(): Promise<OfflineGitResult<true>>;
  dispose(): Promise<OfflineGitResult<true>>;
};
export function openGitObjectSession(repository: OfflineGitRepository, operation: GitOperation):
  Promise<OfflineGitResult<GitObjectSession>>;

// git-objects.ts
import type { ContentEntry } from "./content";
export type GitPackageBytes = { manifest: Buffer; entries: ContentEntry[] };
export function readGitPackageBytes(input: GitPackageInput, operation: GitOperation):
  Promise<OfflineGitResult<GitPackageBytes>>;
export function readGitIndexBytes(input: GitIndexInput, operation: GitOperation):
  Promise<OfflineGitResult<Buffer>>;
```

`info` returns a frozen record and retains a private immutable snapshot keyed by that exact issued record. `contents` accepts only a record issued by that live session and uses the private snapshot for every argv/framing/size/hash decision; a WeakSet alone is insufficient because identity does not prove field immutability. Reject forged or mismatching fields/records and non-safe-integer/negative maxBytes before any writes. Bound issued records by command count, compare response identity/type/size to the snapshot and recompute Git OID for every body before exposing it. No arbitrary publisher callbacks or subprocess injection parameter in public APIs. Direct-module tests may mock Node spawn/clock to instrument actual production code; real-Git tests use the same functions without mocks. Low-level calls validate their own relevant invariants even without Task 3. Raw reader validates the complete input before opening the session, validates commit length against objectFormat, owns finally/finish and does not return bytes if finish fails. It selects the final result after awaited disposal and propagates GIT_CLEANUP_FAILED over any earlier issue. Pure errors must also trigger disposal.

### Tree selection, inventory and deterministic errors

- Parse every traversed tree structurally and charge every entry; never decode unbounded names or partially parse an oversized tree. Raw names are length-bounded by tree bytes before conversion. For selected ancestry, compare selector component Buffer bytes exactly and reject any case-fold twin formed only from validated lossless ASCII bytes; high-bit/non-ASCII sibling names must never alias an ASCII selector via lossy decoding. Reject high-bit mode bytes before conversion and require raw mode bytes to be octal ASCII (then exact mode whitelist for selected entries). For selected ancestry, reject any case-fold twin of that component; unrelated siblings are structurally counted but their modes/paths/content are not selected, validated as package content, followed or read. Duplicate exact selected names fail. The selected ancestry entry must have exact raw mode `40000` and actual tree type.
- Within the selected package subtree validate every component/full package-relative path with existing RelativePath rules. Accept only exact raw `40000` tree and `100644`/`100755` ordinary blob modes with matching object types. Reject `120000` symlink, `160000` gitlink, zero/unknown/noncanonical modes such as `100664` or `040000`, malformed/truncated trees, duplicate and case-fold sibling names, and case-fold file/directory-prefix collisions. Validate ancestor directories even when no manifest inventory lists them. Reject empty child trees as UNSUPPORTED_ENTRY rather than silently dropping unrepresentable empty directories; root containing only manifest is valid.
- Require exactly spelled root `orgops-package.json` ordinary non-executable `100644` blob. Any root case variant or root directory of that name fails UNSAFE_PATH; multiple case-fold copies fail DUPLICATE_PATH. Missing root manifest fails GIT_PATH_MISSING at `manifest`. A `100755` manifest fails UNSUPPORTED_ENTRY, not silently discarded mode semantics. Nested `assets/orgops-package.json` remains ordinary content and must be inventoried.
- Index ancestry uses the same exact tree selection. The final index entry must be exact ordinary non-executable `100644` blob. Its tree siblings/package content are not read. A `100755` index is UNSUPPORTED_ENTRY. Index path has no package-root manifest reservation; RelativePath is the applicable rule.
- Collect all content files, not `manifest.files` alone; set `executable` precisely from raw `100755`. Binary blobs remain exact bytes and canonical base64. LFS pointer text and `.gitattributes` are inert bytes, not dereferenced; `.gitmodules` is inert if selected, but any gitlink is rejected. No authored config or script is opened on disk or executed.
- Perform traversal deterministically depth-first in validated ASCII code-unit name order; perform blob metadata preflight and reads sorted by package-relative path (manifest included). Apply limits before returning other content validation when a bound is encountered. Structural parse errors (including high-bit/non-octal mode/header bytes) use GIT_PROTOCOL_ERROR; mismatching recomputed object OID uses GIT_OBJECT_INTEGRITY; unsafe authored paths use UNSAFE_PATH; collision uses DUPLICATE_PATH; disallowed modes/empty dirs use UNSUPPORTED_ENTRY; wrong actual object type uses GIT_OBJECT_TYPE; missing object/path uses distinct corresponding code. Malformed selector/envelope/commit is INVALID_GIT_INPUT except unsafe selector path is UNSAFE_PATH. Unsupported config/storage/format/platform uses UNSUPPORTED_GIT_STORAGE; missing executable uses GIT_UNAVAILABLE; other spawn/nonzero/signal failures use GIT_FAILED. Time/abort/limit failures retain their own codes after confirmed cleanup; GIT_CLEANUP_FAILED is the sole overriding operational issue when required cleanup/reaping cannot be confirmed.
- Return exactly one issue and no partial value. I/O issue `at` is one of `$`, `repository`, `commit`, `path`, `manifest`, `index`, `entries`, `git` (fixed literals); never append raw path/header/stderr/command/exception. Existing bounded semantic parser/inspector issues are propagated unchanged (their fixed pointers or validated portable content paths are already the pure contract). No raw stderr, local path, manifest/blob bytes, credential-shaped strings or exception causes in errors/logs. Successful previews intentionally retain all selected file bytes and authored commands; do not mistake intentional preview content for an error leak.

### Fixture and validation contracts

All fixture roots use `mkdtemp` beneath the phase-owned TMPDIR and register cleanup immediately. Setup uses trusted `/usr/bin/git` on this host and isolated env, `init --bare --object-format=sha1|sha256`, `hash-object -w --stdin` for blobs, `mktree -z` for canonical trees, `commit-tree` with explicit synthetic identities/dates. Use `hash-object --literally -t tree -w --stdin` **only in owned malformed-tree fixtures**, raw binary builders for dangerous names/modes and dangling references, and fixture-local `update-ref` solely to test replacement rejection/ref nonselection. Never branch/checkout/worktree. Throwing module/script bytes are never imported or run. Fake process fixtures are trusted test code, never package-sourced executable callbacks. Sentinel hooks/config/helpers are confined to owned temp files, never make actual network requests or access real secrets.

`git-fixtures.ts` exports only to tests:

```ts
export type FixtureFile = { path: string; bytes: Buffer; mode?: "100644" | "100755" };
export type GitFixture = {
  repository: OfflineGitRepository;
  commit(files: readonly FixtureFile[]): Promise<string>;
  object(type: "blob" | "tree" | "commit" | "tag", bytes: Buffer, literally?: boolean): Promise<string>;
  dispose(): Promise<void>;
};
export function createGitFixture(format?: "sha1" | "sha256"): Promise<GitFixture>;
```

`commit` constructs canonical directory trees bottom-up from explicit safe fixture file paths (no disk checkout), permits sequential independent exact commits for historical tests, and never mutates a real ref. Tests requiring malformed trees use `object`. Helpers may use fixed bounded fixture execFile with small maxBuffer/time limits because fixture byte inputs are test-owned; this does not replace the production streaming reader. Additional test helper functions may remain private to a test file.

Validation uses `.env.example` only, `env -i`, owned HOME/TMPDIR, `ORGOPS_LLM_STUB=1`, no provider keys/.env, no services. Adapt/copy the previous phase's `parent-verify.sh` and `compare-lint.py` into this phase scratch, preserving old files. Change phase root and comparison baseline to previous `catalogs-03.../parent-final-lint.json` for fresh Task-1 baseline; compare all later labels to this phase's fresh baseline. Run each of all twelve workspace lints independently; root lint short-circuits and is insufficient evidence. Preserve exact multiline diagnostics and multiplicity. Expected prior baseline: 807 Vitest tests/31 files, opscli 3, API 486 and runner 2 diagnostics; ten other workspaces clean. If fresh results differ, diagnose/report before implementation; never bless new debt or suppress diagnostics.

Concrete isolated command wrapper (set once per worker; do not source production .env):

```bash
D="$PWD/.superpowers/sdd/2026-09-10-catalogs-04-offline-git-inspection"
mkdir -p "$D/task-N-scratch/home" "$D/task-N-scratch/tmp"
# Replace N with the literal task number in that worker's shell.
run_checked() {
  env -i PATH="$PATH" HOME="$D/task-N-scratch/home" TMPDIR="$D/task-N-scratch/tmp" CI=1 \
    /bin/bash --noprofile --norc -c \
    'set -a; source .env.example; set +a; export ORGOPS_LLM_STUB=1; exec "$@"' bash "$@"
}
run_checked npm exec --no -- vitest run packages/skills/src/catalogs/git-session.test.ts
run_checked npm run --workspace @orgops/skills lint
run_checked npm run --workspace @orgops/schemas lint
```

Use installed npm exec only (`--no` prevents installing absent tools). Save every command/exit/log and exact changed-files/status/diff to this phase under unique task/round labels. Each task runs relevant tests and both clean lints plus all-workspace diagnostic comparison; Task 1 captures fresh full baseline, Task 3 performs full suite/opscli/whole lint comparison again. Do not claim root lint is green. Reviewer gate is required after each task and for the whole phase; parent does final acceptance.

### Future obligations explicitly not discharged here

Remote acquisition must separately enforce live administrator authority, enabled/nonremoved immutable source binding, allowPackages for external locations independently from catalog authority, canonical repository/credential binding, current credential routing, Q1 network policy, DNS/IP/redirect/proxy/TLS/SSH/helper/transport limits, aggregate scheduling/concurrency and stable known-release persistence across lifecycle/ref changes. It must supply immutable full local objects and the provisioned bare config; no partial clone. The offline reader grants no fetch permission, refresh status, package dependency closure or installed content measurement. Resolver still checks only supplied authority/history/currentDigest attestations. No automatic registration, external URL lookup, implicit enabling, credential retrieval, installation/placement/activation/start, publishing/write access or UI. No safe-publication/sandbox/provenance guarantee from successful inspection.

---

### Task 1: Bounded provisioned Git object session

**Files:** Create `packages/skills/src/catalogs/git-session.ts`, `git-session.test.ts`, `git-fixtures.ts`. Phase-only validation scripts/logs: `.superpowers/sdd/2026-09-10-catalogs-04-offline-git-inspection/task-1-*`, `compare-lint.py`. No public exports or schema changes.

**Interfaces:** Produces every type/limit and `createGitOperation`, `checkGitOperation`, `openGitObjectSession`, `GitObjectSession` from the shared private contract, and test-only `createGitFixture`. Consumes existing Commit/RelativePath primitives only as needed, installed Git and Node APIs. Task 2 will call `info`, then `contents` on issued records, then `finish`, with unconditional `dispose`.

- [x] **Step 1: Capture immutable preflight and fresh validation baseline.** Save pwd/branch/HEAD/status/no-staged-files and expected docs-only preceding commit. Copy/adapt the two prior validation scripts as specified in shared validation; run full test, opscli, root lint and all twelve workspace lints, compare fresh diagnostic multiset to prior parent-final JSON. Record pass counts and known failures before any production edits. Stop for unexpected added debt, not for documented identical root-lint failure.
- [x] **Step 2: Add real-Git failing session tests and test-only owned fixture builder.** Start with binary SHA1/SHA256 info/contents, no refs, and explicit finish/dispose. The helper creates only owned bare repos with exact accepted config, computes blobs/trees/commits using fixed local commands and has immediate cleanup even on setup failure. This representative test must fail because the new session module is absent, not because of fixture/config mistakes:

```ts
import { expect, it } from "vitest";
import { createGitFixture } from "./git-fixtures";
import { createGitOperation, openGitObjectSession } from "./git-session";
it.each(["sha1", "sha256"] as const)("reads exact binary %s objects", async format => {
  const fixture = await createGitFixture(format);
  try {
    const bytes = Buffer.from([0, 255, 10, 0]);
    const oid = await fixture.object("blob", bytes);
    const opened = await openGitObjectSession(fixture.repository, createGitOperation());
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error("fixture session rejected");
    const session = opened.value;
    try {
      const info = await session.info(oid);
      expect(info).toEqual({ ok: true, value: { oid, type: "blob", size: 4 } });
      if (!info.ok) throw new Error("fixture info rejected");
      expect(await session.contents(info.value, 4)).toEqual({ ok: true, value: bytes });
      expect(await session.finish()).toEqual({ ok: true, value: true });
    } finally { expect(await session.dispose()).toEqual({ ok: true, value: true }); }
  } finally { await fixture.dispose(); }
});
```

Do not use existing `must` for new I/O unions (its ContractResult codes are narrower); do not change the pure fixtures helper. Add real fixtures for missing OID, tag/blob/tree info truth, disabled replacement ref and mismatching format. In each hash format, rewrite only an owned loose object's compressed body under an existing OID with different bytes of the same type/size (Node zlib, fixed fixture path derived from its validated OID; unlink/recreate only that owned loose fixture file because Git marks it read-only); cat-file still echoes the old OID, but contents must fail GIT_OBJECT_INTEGRITY. Positive tests must recompute both-format commit/tree/blob identities without extra processes. Assert exact argv/clean env through a Node spawn spy that delegates to real spawn; no forbidden command attempted, not just absence of a sentinel.
- [x] **Step 3: Run targeted red.** `run_checked npm exec --no -- vitest run packages/skills/src/catalogs/git-session.test.ts`; save failure and diagnose fixture-only defects before implementing. No dependency install if resolution fails.
- [x] **Step 4: Implement the session module narrowly.** Implement shared types, fixed constants, monotonic operation checks, exact config preflight and metadata caps; create the one-shot rev-parse child followed by the serial batch child. Use the documented `info`/`contents` protocol, internal issued-record tracking and literal-OID validation. Reuse one private process lifecycle implementation only inside this module, not a generic public process framework. The core cap pattern is:

```ts
// Before retaining a received chunk (shared counters across both children):
if (receivedStdout + chunk.length > OFFLINE_GIT_LIMITS.stdoutBytes) {
  failOnce({ code: "LIMIT_EXCEEDED", at: "git" });
  return; // failOnce stops writes, kills owned group and discards subsequent data
}
receivedStdout += chunk.length;
```

`failOnce` is a private implementation closure tied to the owning child/operation; implement it with the full cleanup/close contract, not a placeholder. Frozen issued records plus private immutable snapshots, size/maxBytes/session-origin checks precede `contents` writes; ASCII header validation precedes conversion, and Git-object hash verification precedes exposing every contents body. Successful `finish` requires exact framing, clean exit and close; store a terminal result so finish/dispose are idempotent and no methods spawn/reopen after termination.
- [x] **Step 5: Add process/resource/config failure tests at the actual internal interface.** Mock Node spawn with instrumented event/stream fakes (no injected public command callbacks), and use controlled test timers to cover: pre-abort/no spawn; abort during config/preflight, rev-parse and batch; timeout across both children versus reset; stdout at/+1, stderr at/+1 across processes; header overflow; request count/stdin at/+1; byte-by-byte split headers/body/NUL/newlines; missing response, invalid size, negative/overflow/leading-zero size, wrong OID/type/terminator, truncated body, unsolicited extra output, stdin EPIPE, spawn ENOENT/nonzero/signal, valid payload followed by failed exit, and forged/modified info (mutations of frozen fields fail without changing the session-owned metadata), invalid maxBytes or calls after finish. Include high-bit header bytes that would decode to valid ASCII via `toString("ascii")`, and lifecycle kill/close failure both after a latched protocol error and after otherwise-valid bytes: no raw thrown cleanup error, no success before close/cleanup, fixed cleanup deadline, first error retained after confirmed cleanup. Assert zero leaked timers/listeners/handles and reaped children on normal termination, no subsequent writes/spawn, exactly owned process-group kill, success settles only after close/cleanup, normal timeout/abort retains GIT_TIMEOUT/GIT_ABORTED after actual close. Separately simulate permanent OS kill denial/no-close and prove bounded GIT_CLEANUP_FAILED at git overrides any earlier error under the explicit shutdown limitation, not success, raw rejection or indefinite retry; repeated disposal returns the same cleanup status. Test all four accepted config templates and reject ordinary checkout, directory symlink, oversized config, include/credential/remote/promisor config, commondir/alternates, .promisor marker and 513th pack entry before spawn. Instrument forbidden helpers/hooks/filter traces using owned sentinel configuration; poison configs must fail before any Git child, while ambient config/SSH/proxy/PATH/trace poison is absent in the delegated real child's environment. Never let these tests attempt actual network or run package scripts.
- [x] **Step 6: Run green and lint debt comparison.** Run git-session tests, existing package/schema catalog suites, skills/schema lints and all twelve-workspace diagnostic comparison under unique `task-1-final-*` logs. Confirm fixed session remains private and no dependencies/lockfile/export/config API edits. Inspect `git diff --check`, exact diff, fixture cleanup and no staged leftovers.
- [x] **Step 7: Commit explicit task files locally.** `git add packages/skills/src/catalogs/git-session.ts packages/skills/src/catalogs/git-session.test.ts packages/skills/src/catalogs/git-fixtures.ts && git commit -m "feat(skills): bound offline Git object sessions"`. Verify index empty. Report changed-files/tests/commands/results/residual risks/HEAD to controller for required fresh review; no nested dispatch.

### Task 2: Exact raw commit/tree selection and complete package byte inventory

**Files:** Create `packages/skills/src/catalogs/git-objects.ts`, `git-objects.test.ts`; extend `git-fixtures.ts` only when necessary for shared fixture construction. Do not change public exports, pure inspector/resolver or schema contracts.

**Interfaces:** Consumes Task 1 `createGitOperation`, `checkGitOperation`, `openGitObjectSession` and exact shared types/limits. Produces `GitPackageBytes`, `readGitPackageBytes(input, operation)` and `readGitIndexBytes(input, operation)` exactly as shared. Inputs validate before opening a session; output is internal Buffer/ContentEntry data only, not a claimed validated package or authority envelope. Task 3 supplies one deadline, invokes these functions and performs pure semantic validation.

- [x] **Step 1: Read reviewed Task-1 code and add failing exact package/index integration tests.** Use the existing complete inert manifests/bytes. Add this representative test and explicit index test (same commit, `catalog/index.json`, index bytes equal JSON.stringify(catalogIndex)); both must exercise installed Git:

```ts
import { expect, it } from "vitest";
import { createGitFixture } from "./git-fixtures";
import { readGitPackageBytes } from "./git-objects";
import { createGitOperation } from "./git-session";
import { skillManifest, skillEntries } from "./fixtures";
it("returns every selected file and only the root manifest separately", async () => {
  const fixture = await createGitFixture();
  try {
    const manifest = Buffer.from(JSON.stringify(skillManifest));
    const files = skillEntries.flatMap(e => e.type === "file" ? [{
      path: `packages/echo-skill/${e.path}`, bytes: Buffer.from(e.base64, "base64"),
    }] : []);
    const commit = await fixture.commit([
      { path: "packages/echo-skill/orgops-package.json", bytes: manifest }, ...files,
      { path: "unselected/large.bin", bytes: Buffer.alloc(1048577) },
    ]);
    const result = await readGitPackageBytes({ repository: fixture.repository,
      commit, path: "packages/echo-skill" }, createGitOperation());
    expect(result).toEqual({ ok: true, value: { manifest, entries: skillEntries } });
  } finally { await fixture.dispose(); }
});
```

Entries sort by path; fixture order above already follows ASCII order. Assert spawn/batch request trace never includes the unselected blob OID. Add invalid commit (`HEAD`, branch, short/uppercase, option, tag expression) and unsafe selector tests with no Git/fs calls; literal full tag/tree/blob input OIDs must fail GIT_OBJECT_TYPE, not peel.
- [x] **Step 2: Run targeted red.** `run_checked npm exec --no -- vitest run packages/skills/src/catalogs/git-objects.test.ts`; preserve module-missing failures, not fixture bugs.
- [x] **Step 3: Implement raw tree parsing and exact ancestry traversal.** Read bounded commit info/content, derive its first-line tree, and visit the requested selector one component at a time by raw tree name. Decode OID bytes with the declared object format, not hardcoded SHA1 offsets. Parse metadata incrementally with bounds before adding nodes. Buffer operations must follow this concrete shape:

```ts
const space = bytes.indexOf(0x20, offset);
const nul = space < 0 ? -1 : bytes.indexOf(0, space + 1);
// Reject missing separators, empty mode/name or insufficient OID bytes before slicing.
const oidEnd = nul + 1 + (format === "sha1" ? 20 : 32);
const modeBytes = bytes.subarray(offset, space);
// Before conversion, reject any byte outside raw octal ASCII 0x30..0x37.
const mode = modeBytes.toString("ascii");
const nameBytes = bytes.subarray(space + 1, nul);
const oid = bytes.subarray(nul + 1, oidEnd).toString("hex");
// After validated bounds/structure, account entry, apply selection/path/mode rules,
// advance offset to oidEnd. Never decode arbitrary names through lossy UTF-8.
```

Implement explicit checks described by comments before those slices; the code snippet is an algorithm shape, not permission to use unchecked indices. For selected package trees reject non-ASCII names before string conversion, apply RelativePathSchema to component/full relative path, exact modes, case-fold collision/prefix rules and empty child tree rule. Use deterministic iterative DFS or bounded recursion with operation depth checked; count repeated tree occurrences and all parsed metadata. Ignore unrelated ancestor sibling content without following it.
- [x] **Step 4: Implement metadata-first inventory and result lifecycle.** Complete selected subtree enumeration first; preflight all manifest/content info, enforce actual types, file counts, per-file sizes, total content and tree budgets **before any blob content read**. Use path-sorted metadata/contents requests, map only 100755 to executable true, keep manifest separate, encode canonical base64 after receipt. Index reads only its exact selected 100644 blob. Check operation before/after awaits/allocations, and finish/close before returning bytes; await result-bearing dispose in finally on every branch and choose final result only afterward, with GIT_CLEANUP_FAILED overriding an earlier result if cleanup/reaping cannot be confirmed. No early try/finally return may discard cleanup status and no active-content side effects are permitted.
- [x] **Step 5: Add raw malicious-tree and exact budget tests.** Real owned Git fixtures include SHA256 trees, binary/empty blobs, two commits with changed bytes, replacement refs ignored, missing commit/tree/blob, wrong object type including tag, malformed commit first line, raw tree truncation, high-bit mode bytes and ancestor names that would otherwise alias ASCII selectors, duplicate names, file/tree same name, `A/x` versus `a/y`, forbidden segments/absolute/traversal/space/tab/newline/non-ASCII/invalid UTF-8 names, symlink/gitlink/unknown/100664/040000 modes, unsafe parent selector mode, root manifest variant/directory/executable/missing, nested manifest valid and empty child tree rejection. Include a valid package under 240-char selector with 240-char relative content path to catch false combined-length rejection. Unrelated unsafe sibling mode/name is not package inventory and is not followed; a case-fold twin of the selected ancestor must fail. Use actual raw-object builders so Git does not sanitize fixtures for you.

Add at-limit/+1 tests for 256 content + manifest versus 257 content, manifest 262144, index 2097152, file 1048576 and total 8388608; metadata treeBytes/totalTreeBytes/treeEntries/treeOccurrences/depth and session aggregate request/output budgets. Where another invariant dominates (for example 8192 full-OID requests cannot exhaust the 1MiB stdin cap, or valid selector/relative paths already bound total depth), assert that dominance or test the private accounting seam; do not loosen public limits or fabricate an unreachable public success case. Test repeated same blob in nine 1MiB paths rejects cumulative size before any blob reads. For huge metadata graphs use a direct-module mocked Git session tracing real reader requests, alongside real finite owned-Git examples; never replace all raw parsing tests with mocks. Assert no contents request for **any** package blob when a later blob metadata entry exceeds size/type budget, no partial value, and no further reads after abort. Retain redacted fixed pointers even for secret-looking invalid paths/stderr.
- [x] **Step 6: Run green, shared regressions and lint comparison.** Run git-objects + git-session tests, existing package/schema catalog tests, skills/schema clean lints and all-workspace diagnostic comparison. Save test traces proving only two processes/selected objects per operation, not a recursive repository dump. Run `git diff --check`, review exact file scope and clean fixture/index state.
- [x] **Step 7: Commit explicit task files locally.** `git add packages/skills/src/catalogs/git-objects.ts packages/skills/src/catalogs/git-objects.test.ts` plus `git-fixtures.ts` only if changed; `git commit -m "feat(skills): read exact bounded Git package trees"`. Confirm no staged files and return required evidence to controller for fresh review.

### Task 3: Public inert Git inspection adapters and cross-contract verification

**Files:** Create `packages/skills/src/catalogs/git-inspection.ts`, `git-inspection.test.ts`; modify only explicit exports in `packages/skills/src/index.ts` and implemented-contract sections in `docs/SPEC.md`, `docs/catalog-package-contract.md`; fixture extensions only if needed. No API/runner/schema/config/export implementation changes.

**Interfaces:** Consumes Task 2 raw readers and Task 1 operation/types. Produces exact `inspectGitPackage` and `readGitCatalogIndex` public signatures and explicit named type/limit exports from shared public contract. Package success is existing detached deeply frozen `PackageSnapshot`; index success must similarly freeze the detached parsed `CatalogIndex`. No `CatalogSnapshot`/`SuppliedPackage` authority fields are manufactured.

- [x] **Step 1: Add failing public real-Git inspection test.** Import through `../index` as external callers do, use real bare fixtures, inspect throwing module bytes and compare to the existing pure snapshot. This fails because the public function is absent:

```ts
import { expect, it } from "vitest";
import { inspectGitPackage, readGitCatalogIndex, inspectPackage, resolvePackages } from "../index";
import { createGitFixture } from "./git-fixtures";
import { skillManifest, skillEntries, must } from "./fixtures";
it("inspects Git bytes identically without activating the event module", async () => {
  const fixture = await createGitFixture();
  try {
    const commit = await fixture.commit([
      { path: "pkg/orgops-package.json", bytes: Buffer.from(JSON.stringify(skillManifest)) },
      ...skillEntries.flatMap(e => e.type === "file" ? [{ path: `pkg/${e.path}`,
        bytes: Buffer.from(e.base64, "base64") }] : []),
    ]);
    const result = await inspectGitPackage({ repository: fixture.repository, commit, path: "pkg" });
    expect(result).toEqual({ ok: true, value: must(inspectPackage(skillManifest, skillEntries)) });
    if (!result.ok) throw new Error("fixture inspection rejected");
    expect(result.value.execution.apiEventShapes).toEqual(["event-shapes.ts"]);
    expect(Object.isFrozen(result.value.manifest)).toBe(true);
  } finally { await fixture.dispose(); }
});
```

Use readGitCatalogIndex/resolvePackages imports in subsequent cross-contract tests; otherwise omit unused imports. Add invalid UTF-8 manifest/index, invalid JSON/schema, unlisted safe file and missing/changed declared file/mode tests; their error codes must be the existing pure parser/inspector codes, not a new success path.
- [x] **Step 2: Run targeted red.** `run_checked npm exec --no -- vitest run packages/skills/src/catalogs/git-inspection.test.ts`; save evidence that public integration is absent.
- [x] **Step 3: Implement minimal async adapters and explicit exports.** Create one operation at entry, pass it through the raw reader, decode manifest/index with fatal UTF-8 and `ignoreBOM:true` (preserve BOM so JSON parser rejects it rather than silently rewriting). Invalid UTF-8 returns INVALID_JSON at manifest/index. The package composition is:

```ts
const operation = createGitOperation(options?.signal);
const raw = await readGitPackageBytes(input, operation);
if (!raw.ok) return raw;
// Check operation; fatal-decode raw.value.manifest, returning redacted INVALID_JSON on failure.
const parsed = parsePackageManifest(manifestText);
if (!parsed.ok) return parsed;
const inspected = inspectPackage(parsed.value, raw.value.entries);
const ended = checkGitOperation(operation);
return ended.ok ? inspected : ended;
```

Implement the stated pre-decode/pre-inspection checks as well; on parser rejection check the deadline/abort before deciding terminal semantic outcome. Index composes `readGitIndexBytes`, fatal decoder, `parseCatalogIndex`, detached recursive freeze and final operation check. Do not write files or run any command in the adapters; all approved I/O stays below. Expose functions/types/limits by named exports; do not `export *` private session/fixture/raw-reader functions.
- [x] **Step 4: Prove cross-contract behavior with real immutable Git commits.** At SHA1 and SHA256 commits containing all four complete fixture kinds and explicit index, inspect every package and compare exact pure snapshots/digests/files/execution previews. Feed caller-constructed existing envelopes to `resolvePackages` for CLASSIC+skill and RLM+skill; verify dependency order/full commit identities, enabled/allowed-source denial unchanged and no auto-supplied source. For wrapped package show all setup/check/sidecar/runtime commands and warnings without invocation, native resources remain unsupported. Change index at commit B, freezing old releases to exact A; reader returns B index and A bytes, resolver reports catalogCommit B/packageCommit A, while leaving contextual old entries repointed to B fails known-release identity. An external location remains an inert source ID/commit/path claim; reading the index never opens/acquires another repo. Caller must explicitly provide the external fixture for any resolution, and denial remains pure SOURCE_NOT_ALLOWED.

Round-trip existing export candidates by writing their explicit `proposedFiles` into a fixture commit, then inspectGitPackage; test skill, CLASSIC, RLM and wrapped digests identical, no selected-state/export passthrough. Inspect malformed/unlisted/unsafe Git content without dropping it before inspectPackage, and test binary file previews are exact. Deep-freeze every index/snapshot nested object and assert no input mutation. Returned snapshots survive fixture disposal and are not backed by retained mutable Buffer references.

Instrument Node process/active-discovery imports in the tests to assert the only child commands are fixed rev-parse/cat-file and no loadSkillMeta/loadSkillEventShapes/dynamic package import occurs. `.gitattributes`/LFS pointer/script bytes may be included as inert inventoried content (with correct executable declarations); do not execute them. Run old pure inspection/export/resolve against a spy that forbids spawn and repo filesystem calls, showing those functions remain I/O-free. Assert synthetic secret-looking bad input/stderr/local directory paths never appear in failure objects/logs (successful selected bytes are intentionally previewed). Add abort between Git completion and semantic return, finish failure with valid bytes, and both public adapters propagating GIT_CLEANUP_FAILED from bounded kill-denial/unreaped session disposal (including an earlier protocol error and otherwise-valid data), never returning success or a raw rejected promise. Normal timeout/abort with actual close keeps its original code. Test identical concurrent calls each owning separate bounded sessions; document higher-level concurrency scheduling as deferred.
- [x] **Step 5: Update only implemented docs.** Replace broad “no filesystem adapter” language with precise distinction: pure functions unchanged, new explicitly async offline adapter exists, trusted provisioned bare storage/config and absolute binary handle, explicit indexPath, exact SHA1/SHA256, POSIX lifecycle subset, all fixed budgets and error union, metadata/empty-directory/manifest/index mode policy, no network/helper/code execution, no authenticated provenance or memory sandbox. Preserve every future source authorization, transport/Q1, credential, refresh/history persistence, installation/start/publishing/UI obligation. Include a complete example consuming caller-supplied trusted `repository`, literal full commit and explicit indexPath/package path, then wrapping into existing envelopes only under future caller authority; no live URL/credentials or implicit permission example.
- [x] **Step 6: Whole-slice validation and scope review.** Run all new/old package/schema catalog tests, full `npm test`, opscli tests, root lint plus all twelve workspace lints and exact baseline multiset comparison under `task-3-final-*` logs. Skills/schema clean is mandatory. Count all new tests; record exact changed-files, command exits, zero added diagnostic proof, raw process traces/sentinel cleanup and `git diff --check`. Confirm no dependency/lock/schema/config/API/runner edits, no real state/services and no staged files. Parent/reviewer independently repeat acceptance after this task.
- [x] **Step 7: Commit explicit task files locally.** `git add packages/skills/src/catalogs/git-inspection.ts packages/skills/src/catalogs/git-inspection.test.ts packages/skills/src/index.ts docs/SPEC.md docs/catalog-package-contract.md` (fixture file only if changed); `git commit -m "feat(skills): inspect local Git catalogs without activation"`. Confirm index empty; return HEAD/tests/lint comparison/residual risks for required whole-phase review. Do not claim remote discovery/refresh/install/publication is implemented.

## Planning acceptance and self-review checklist

- [x] Parent approved these three task boundaries, strict canonical bare config, POSIX subset, exact raw-tree mode policy, nonexecutable manifest/index, empty-directory rejection, explicit indexPath, API signatures and aggregate budgets before docs commit. Parent-requested hardenings: recompute all Git object OIDs, freeze/private-snapshot issued metadata, validate raw ASCII before conversion, and resolve redacted terminal cleanup failures without success before reaping. Parent's final ruling adds private result-bearing disposal and GIT_CLEANUP_FAILED as the sole higher-priority exception to first-failure-wins; no blind retries and future operator handling required. Shutdown OS-denial limitation is explicit.
- [x] No scope extension to network/credentials/source policy/runtime activation; no production/test files edited during planning.
- [x] Shared interface names/types/limits copied verbatim into every task brief; no unresolved placeholders or undeclared cross-task functions.
- [x] Real local Git evidence stored; SHA256, raw noncanonical mode behavior and both-format corrupted-body hash detection actually demonstrated. Full automated implementation validation remains task work, not claimed complete by the planner.
- [x] After approval commit only this plan; generate all three full task briefs with installed `task-brief` script, prepend plan shared requirements/global constraints to each, and record path/HEAD/task/interface consistency in `planning-report.md` under this phase scratch.

## Reviewed implementation completion and final validation

All three implementation tasks are complete. Historical task ledgers and RED/GREEN evidence live in `.superpowers/sdd/2026-09-10-catalogs-04-offline-git-inspection/`:

- Task 1: `9fb27c7`, corrected by `bd6a545` after review; `task-1-ledger.md` records the bounded-disposal fix and four regression cases. Task 2 ledger records approval of the corrected Task 1.
- Task 2: `740d993`; `task-2-ledger.md` records exact-tree reader completion and 124 tests. Task 3 ledger records Task 2 reviewer approval.
- Task 3: `b969d14`; `task-3-ledger.md` records adapters/docs completion and 65 tests. The supplied final Task 3 reviewer verdict approves this task with no findings; this is not whole-phase acceptance.
- Planning brief generation and shared-interface consistency are evidenced by `planning-report.md` and `planning-preflight.json`. Checked steps above record completed work, not new execution of historical RED steps.

Final isolated rerun: `recovery-1-verify.sh` and `recovery-1-final-*` logs record catalogs 831/10 files, full Vitest 1092/34 files, opscli 3, and ten clean workspace lints including skills/schemas. Root lint remains failing (exit 2): API 486 and runner 2 existing diagnostics. The unchanged `compare-lint.py` against `task-1-baseline-lint.json` reports 488 before/after, added 0/removed 0, retaining workspace/file/code/full multiline-message multiplicity and ignoring only positions/existing repository-prefix canonicalization. No dependency or lockfile changes.

This phase implements only an offline trusted-local-Git reader: no live fetch/refresh, credential access, import or publishing services. Storage/executable trust is not authenticated provenance or a sandbox; POSIX cleanup denial may require operator supervision, with no blind retry of GIT_CLEANUP_FAILED. Transport/source authority/history persistence, concurrency scheduling and activation remain deferred. Whole-phase independent review is approved (run `076e5b53-0936-43a9-bfc3-e726b3ad2686`), with no remaining findings. Parent read the current session, raw reader and public adapters and accepted the slice at reviewed HEAD `4a0f91d87c2ad69244a94f57f5507eb679eca35c`. Fresh parent verification: 1092 Vitest tests/34 files and 3 opscli tests pass; all twelve workspace lints retain API486/runner2 debt and ten clean workspaces, with zero added/removed full-message diagnostics. Root lint remains failing on known debt. Evidence: this phase's `parent-final-*`, `parent-final-lint.json`, `parent-verify.sh` and `compare-lint.py`. Dependencies/lockfiles and clean checkout/index were verified before this docs-only acceptance update.
