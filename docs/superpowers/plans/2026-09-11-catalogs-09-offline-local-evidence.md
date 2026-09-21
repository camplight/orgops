# Offline Single-Root Local Skill Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (parent controller only) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Workers must not launch nested agents.

**Goal:** Acquire bounded neutral namespace and nominated-subtree observations from one explicitly supplied trusted, quiescent local skill root, for independent caller composition with unchanged `prepareImport`.

**Architecture:** A private catalog-specific filesystem owner validates/snapshots inputs, enumerates bounded directories, reads bounded ordinary bodies and awaits cleanup. A thin asynchronous evidence collector preflights the entire selected metadata set before bodies and returns detached frozen per-root data. Origins, relevant-host reconciliation and authority stay outside this adapter; neither active discovery nor semantic package inspection is used during acquisition.

**Tech Stack:** Existing TypeScript, Node fs/promises, fs constants, monotonic performance clock, setImmediate, Buffer, existing portable-path schema and colocated Vitest; npm only.

**Spec:** `docs/superpowers/specs/2026-09-09-skill-agent-catalogs-design.md`; `docs/SPEC.md`; current offline import section of `docs/catalog-package-contract.md`; binding `.superpowers/sdd/2026-09-11-catalogs-09-offline-local-evidence/controller-brief.md`.

## Global Constraints / Entire Identical Shared Task Prefix

Everything before `### Task 1` is the ENTIRE shared contract and must prefix every task brief byte-for-byte. The installed SDD script extracts only a task body: preserve each raw extraction, then prepend this prefix to a distinct final brief. No shared requirements occur after the task bodies.

### Authority and workflow

- Work only in `/home/slamnation/www/orgops`, existing branch `88-move-private-skills-into-a-private-repo`. Accepted planning base: `0d52fcea8e7498619a93b5ce6e88ffe79519575a`, initially clean tracked tree/index. `D=/home/slamnation/www/orgops/.superpowers/sdd/2026-09-11-catalogs-09-offline-local-evidence`.
- PLANNING gate: parent reads the ENTIRE concrete plan and explicitly approves it before a plan commit or any source/test edit. Planner remains available for corrections. Planning commit contains ONLY this plan. New phase artifacts, probe attempts, task briefs and logs remain under D and unstaged. Prior phases, assessment and pending-owner decisions remain read-only.
- One sequential writer, fresh read-only task review after each task/fix, whole-phase review and independent fresh parent verification. No nested agents, worktrees, pushes, merges, remote writes, actual installation/activation/start/publication, production roots/state/services/configuration/HOME/credentials, dependency/package/lock changes. Do not read `.env`. No API/DB/UI/runner/application changes, migrations, transports or credentials.
- No new owner product/security policy. Escalate a material gap through `contact_supervisor` and wait; report blocked if useful work needs new owner policy. Q1 private-network Git reachability and Q2 mobile shared shell remain unchanged.
- Tool/runtime/extension/native-output-contract failures stop immediately with exact error, run identifier, cwd, branch/full ref, status, worktree diff and index diff. Continue only on explicit same-native-protocol recovery; never external CLI/foreground fallback. Native `structured_output` verdict is mandatory, not inferred from Markdown.
- New disk fixtures are only new owned directories under D/scratch via phase-owned TMPDIR, cleaned in awaited finally blocks; never use configured/real skill roots. Existing Git tests retain their own fixture behavior. Production code performs read-only filesystem observations only: no writes/chmod, locking/snapshots, shell/Git/subprocess, network, DB, environment/root discovery, package manager, execution/import of authored modules, logging or activation.
- "Read-only" means no mutation calls. The OS may update access times when reading: no promise of physically immutable storage, unchanged atime, or successful restoration. Test content/name/mode/identity invariance, not atime invariance. No clock/identity/time authority fields are emitted; the monotonic clock is used only for cooperative deadlines.

### Read/map evidence and unchanged seams

Planner read full AGENTS, approved design, SPEC, assessment-structured.json and pending Q1/Q2; full current import types/validator/composer and both import tests/fixtures; Git session/object-reader/publication-evidence modules and their source-named tests/fixtures; skills root active discovery (read, never called); schema primitives/manifest; current fs type declarations for Dir/OpenDirOptions/FileHandle/read/stat/close/open/lstat. The current complete import contract is `docs/catalog-package-contract.md` from `## Offline import preparation` to EOF, including its example.

The active `listSkills` skips non-directories and invalid SKILL.md; `loadSkillEventShapes` dynamically imports modules. Neither is an occupancy oracle. `prepareImport` already parses actual root bytes, computes current content digests, rejects selected occupied/edited/blocked names and retains lexical local manifest bytes; do not duplicate any of that semantic behavior here.

| Path / interface | Owner | Responsibility / preflight |
|---|---|---|
| `packages/skills/src/catalogs/local-skill-evidence-types.ts` | Task 1; read-only thereafter | Exact public neutral types/frozen limits below; no import authority types |
| `packages/skills/src/catalogs/local-skill-root.ts` | Task 1; Task 2 only narrowly necessary collector fixes | Private single ownership path, input snapshot, issued metadata, bounded Node I/O and lifecycle |
| `packages/skills/src/catalogs/local-skill-root.test.ts` | Task 1 | Actual owned FS and private Node-boundary lifecycle doubles |
| `packages/skills/src/catalogs/local-skill-fixtures.ts` | Task 1; additive helpers Tasks 2/3 | Test-only owned scratch factory, no fixture root exports |
| `packages/skills/src/catalogs/local-skill-evidence.ts` | Task 2 | Public collector: root namespace, nominated subtrees, preflight/output accounting |
| `packages/skills/src/catalogs/local-skill-evidence.test.ts` | Task 2 | Actual root/name/bytes/completeness/budget behavior |
| `packages/skills/src/catalogs/local-skill-evidence.integration.test.ts` | Task 3 | Disk → neutral evidence → independent synthetic mapping → unchanged prepareImport; public no-effect tests |
| `packages/skills/src/index.ts` | Task 3 | Append explicit exports only; active discovery unchanged |
| `docs/catalog-package-contract.md`, `docs/SPEC.md` | Task 3 | Exact API/subset/trust/lifecycle/bounds and complete owned synthetic example |
| `import-types.ts`, `import-evidence.ts`, `import.ts`, `resolve.ts`, `content.ts`, all publication/Git/schema modules and old fixtures/tests | Read-only all tasks | Existing contract/consumer, no changed semantics or diagnostic positions |
| D/`parent-verify.sh`, D/`compare-lint.py` | Task 1 | Copy/adapt Phase8 verification locally, never change old artifacts |
| D/task-N-* and distinct fix/attempt paths | Respective writer | Chronology, 15 logs/exits, lint comparisons, diff/commit evidence |

No needless generic filesystem framework or additional resolver/semantic inspector. The private callback seam below is catalog-internal only, not exported from `@orgops/skills` and not a capability for arbitrary application callers.

### Exact public contract (Task 1 types, Task 2 implementation, Task 3 root exports)

```ts
import type { ImportLocalEntry } from "./import-types";
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

Runtime output has exactly the three value fields above. No host path (even the supplied root) is echoed. The result is bound to the explicit root by this invocation only, not a transferable root identity/token. Caller retains its own root/copy association. `nominatedNames` is the validated sorted snapshot, not an expanded discovery list. All objects/arrays in success are detached plain deeply frozen values; strings are immutable, no Buffer/handle/Stats escapes. Failure also has exactly one fixed issue, no partial value, raw exception/message/code/path/target or authored bytes.

There is no `installed`, `state:"measured"`, `origin`, source/catalog identity, currentDigest, installation actor/time, approval, runnable state or all-host certification. `namespace.complete:true` means only that this ONE root's immediate namespace was fully enumerated under the precondition. `subtrees[i].complete:true` means that nominated ordinary directory's complete representable subtree was observed, including blocked leaves; it says nothing about package validity or reusable identity.

### Input, names, nomination, absence and modes

1. Before the first await, validate/copy strict own enumerable data properties. Input exactly `{directory,nominatedNames}`; reject unknown/missing/symbol/accessor properties without invoking getters. Plain or null-prototype object only. Nomination array is dense own enumerable indexed strings with no extra properties/accessors; reject duplicates/casefold duplicates. Validate 1MiB descriptor JSON via existing `validateCatalogJson` before any clone; proxies/native allocation failure remain outside the trusted-JS-input contract. No callbacks/limits/options on the input. Options is a trusted control-plane object containing only an optional genuine AbortSignal, captured once; validate its own data descriptors/keys, reject invalid shape before I/O without getter invocation. Do not interpret `signal.reason` or log it. Snapshot input without freezing caller objects.
2. Directory must be an explicit normalized absolute POSIX path, not `/`, max4096 UTF8 bytes/characters and at most64 nonempty segments. Reject controls/NUL/C1, backslashes, lone surrogates, repeated separators, trailing separator and `.`/`..` segments, without normalizing/realpath/defaulting. Valid non-ASCII host path strings are allowed losslessly; no arbitrary raw-byte root path API. Each fully joined absolute traversed path must still fit4096 bytes BEFORE the Node call. These lexical checks do not inspect or certify host ancestors. No cwd/env/HOME/manifest/API/runner root selection.
3. Only linux/darwin with numeric `O_NOFOLLOW`, `O_NONBLOCK`, `O_DIRECTORY` constants is the conservative adapter subset. Other platforms fail `UNSUPPORTED_LOCAL_STORAGE` before I/O; no change to whole-product/package platform support. Caller must supply trusted ordinary local storage with stable ordinary file/directory semantics, byte names supported by Node, and bounded native directory-name objects (POSIX component limit255 bytes for this subset). Network/pseudo/hostile storage is not certified or auto-detected; if caller cannot establish this precondition, do not call. Root must lstat as an ordinary directory, not a link/file/special. Selected traversed descendants must share root `dev`; reject detected cross-device traversal as unsupported storage, not as an occupied success. Equal-dev mount aliases are NOT excluded/proved absent by this check. Unselected immediate entries of any type remain namespace occupancy; no mount-body traversal.
4. Enumerate immediate occupied names regardless of SKILL.md/manifest existence/validity: file, ordinary directory or bodyless `blocked` for a known link/FIFO/socket/character/block device. Ordinary immediate hardlinked files stay namespace `file` (occupancy only). Unknown/unclassifiable type or contradictory metadata is failure, not omission. Missing/unreadable root or list/stat/read error never becomes an empty namespace or absent nominee.
5. Read names via `opendir(path,{encoding:"latin1",bufferSize:1,recursive:false})` and explicit awaited `Dir.read()`, not whole `readdir` or async iteration/auto-close. Latin1 is the lossless byte-to-code-unit mapping for this private boundary, NOT authored UTF8 text interpretation. Reject any name code unit>127, slash, length>64, or failed `RelativePathSchema`; only then use ASCII strings to join paths. UTF8 non-ASCII names, invalid UTF8 names and high-bit aliases fail globally, even unrelated immediate occupancy. Never decode with lossy ascii/UTF8 replacement. Every nested path and full `name/path` must satisfy RelativePathSchema and ≤240 bytes, ≤64 components (name is component1). Reserved names, forbidden ancestors, duplicate/casefold siblings or path collisions fail globally. Root itself is not an entry; selected directory itself appears only in namespace/subtree.name, not as subtree path `.`.
6. Nominations use portable one-segment RelativePath names (uppercase allowed), max4096, empty list allowed. Match exact case. A casefold-only namespace match fails `UNSAFE_PATH` at `nominatedNames`, never descends into the alias or claims absence. Exact nominated non-directory is only namespace occupancy and has no subtree. An exact nominated ordinary directory always has one complete subtree, even if empty. No exact/casefold namespace match proves that nominee absent only in this root; the preserved nominations and full namespace explicitly bind that conclusion. Do not fabricate empty subtrees for absent/non-directory nominees. Sort nominations, namespace, subtrees by code-unit name and entries by code-unit path; enumeration order never changes successful output.
7. Selected trees include every ordinary file's exact base64 and `executable=(mode & 0o111)!==0`; preserve zero-byte, binary, BOM, malformed and lexical root-manifest bytes. Only exact subtree-relative `orgops-package.json` receives256KiB cap; aliases/nested manifests are ordinary1MiB files and remain exact names. Executable root manifest is observed, not rejected/rewritten; unchanged import decides non-reuse. No semantic parsing, regeneration, exclusions such as export-only `.env`, or SKILL.md filtering. Explicit directories include empty ones. All known special leaves and ordinary files with `nlink!==1n` are `blocked` without opening their bodies or link targets. Directories naturally have nlink>1 and are NOT blocked by the file hardlink rule. A blocked root manifest stays blocked. No `readlink`, special-body open or recursion into links/special leaves. Unknown I/O errors/oversize/unreadable ordinary files are global failures, not blocked-success substitutions.

### True filesystem/lifecycle guarantees and private types

Caller controls/trusts root and all traversed ancestors and excludes ALL concurrent writers from entry through settlement. This is offline trusted quiescent storage, analogous to the accepted Git precondition, NOT safe scanning of active mutable/hostile roots. Paths alone authorize nothing: future privileged callers must separately scope/authorize roots. Metadata checks detect known inconsistencies; they do not create an atomic snapshot, authenticate origins or prove ancestor/mount containment. The implementation is not a TOCTOU sandbox.

```ts
// local-skill-root.ts: deep-module-only types/functions, never root-exported.
import type { BigIntStats } from "node:fs";
import type { LocalSkillEvidenceInput, LocalSkillEvidenceOptions,
  LocalSkillEvidenceIssue, LocalSkillEvidenceResult } from "./local-skill-evidence-types";
export type LocalSkillRecord = Readonly<{
  path: string; // root-relative, root is ""; never a public pointer
  type: "directory" | "file" | "blocked";
  stat: BigIntStats; // private frozen scalar snapshot; no external retention
}>;
export type LocalSkillRootReader = {
  input: Readonly<{ directory: string; nominatedNames: readonly string[] }>;
  root: LocalSkillRecord;
  listDirectory(record: LocalSkillRecord, maxEntries: number): Promise<readonly LocalSkillRecord[]>;
  readFile(record: LocalSkillRecord): Promise<Buffer>;
  checkpoint(): Promise<void>;
  fail(code: LocalSkillEvidenceIssue["code"], at: LocalSkillEvidenceIssue["at"]): never;
};
export function withLocalSkillRoot<T>(
  input: LocalSkillEvidenceInput, options: LocalSkillEvidenceOptions | undefined,
  consume: (reader: LocalSkillRootReader) => Promise<T>,
): Promise<LocalSkillEvidenceResult<T>>;
```

`BigIntStats` stays private and is retained from trusted Node results (freeze the Stats and verify bigint fields, not authored data); never serialize it. Required fingerprint: `dev,ino,mode,nlink,size,mtimeNs,ctimeNs`, exact bigint equality and consistent `isFile/isDirectory/isSymbolicLink/isFIFO/isSocket/isCharacterDevice/isBlockDevice`. Ignore atime/birthtime to avoid rejecting the adapter's own read effects. Nonnegative size and required meaningful identity fields must be valid. The implementation may hold the Node Stats object privately, not rebuild an incomplete fake Stats prototype. Test doubles produce genuine Stats from owned fixtures, then override specified scalar fields/type methods explicitly for fault tests.

Private record.type describes the lstat kind: ordinary hardlinked files remain `file` records, while known special leaves are `blocked`. The collector emits hardlinked files as blocked only inside selected subtrees; immediate namespace still records their ordinary file occupancy. readFile refuses ordinary records with nlink!=1 without opening them. listDirectory accepts the root or an exact nominated directory/its descendant only; readFile accepts only a descendant of an exact nomination (at least two path components), never an immediate occupancy-only file. Records are reader-issued frozen references verified by private WeakMap/Set; forged/cross-operation/duplicate directory-enumeration or repeated file-read records fail `INVALID_LOCAL_INPUT` at `filesystem`. No cache/dedup of body/path occurrences across calls. `maxEntries` is a private positive-or-zero integer ≤4096, cannot raise public limits; root caller uses4096, selected callers use min(remaining1024,remaining8192). Bound records globally to root+4096+8192=12289. A nested call cannot return a list greater than the supplied remaining budget; inspect one additional entry solely to distinguish exact limit/EOF and fail without retaining it. Metadata/count/path limits precede body reads.

One owner in `withLocalSkillRoot` holds the terminal issue, live handles and pending result. Do not copy Git's Promise.race cancellation mechanism: uncancellable fs acquisition must remain awaited.

- Start one monotonic deadline at public entry (includes snapshot, traversal, bytes, JSON/freeze and cleanup). Validate inputs, then check abort, then deadline, then platform, then root lstat. Root lstat failure is `LOCAL_IO_FAILED` at `directory`; non-directory/link root is `UNSUPPORTED_LOCAL_STORAGE` there. Once a checked error has been selected, keep it (except cleanup override). At each check abort takes precedence over timeout when both are first noticed; on rejected I/O first check abort/deadline, otherwise select its fixed I/O failure. No event listener/timer is necessary: inspect the captured AbortSignal at checkpoints; explicit bounded macrotask yields allow scheduled aborts to run.
- Before/after every awaited non-cleanup I/O, check operation and charge the operation's call/work counter. Register every fulfilled open/opendir resource IMMEDIATELY before a post-await check can throw. Never race a pending open, return early while a close/read/list/acquisition is pending, or leave callbacks/timers/listeners/background work after settlement.
- For each directory: verify issued metadata and lstat when required; `open(path,O_RDONLY|O_NOFOLLOW|O_NONBLOCK|O_DIRECTORY)` → register FileHandle → actual handle.stat(bigint) versus recorded fingerprint/type → `opendir` → register Dir → path lstat comparison → bounded explicit reads. Validate all sibling names/collisions before descending. lstat each accepted entry to classify, never rely solely on Dirent type or read a target. At end fstat directory handle and lstat path against the original fingerprint, close Dir then FileHandle before returning its bounded sorted records. No recursive parent handles remain open during child traversal (maximum2). Node Dir exposes no documented fd/fstat/openat interface: the separately opened directory FileHandle is NOT proof of the enumerator's identity. Stable trusted paths plus path/handle postchecks are the precondition; document this exact limitation rather than claim fd-anchored traversal. Do not use undocumented Node internals, `/proc` tricks, realpath certification or a native dependency.
- For an ordinary reusable-byte candidate: re-lstat path and compare issued fingerprint, nofollow+nonblock `open` (without O_DIRECTORY), register handle; fstat and require actual ordinary file, nlink1, same device/identity/size/full mode/timestamps; only then read. Preallocated Buffer size is declared bounded size (or size+1 for a bounded probe), never readFile/stream buffering. Read at explicit positions in ≤65536-byte chunks; a returned positive short chunk or zero before the declared length is `LOCAL_EVIDENCE_CHANGED` (conservative inconsistent observation, not proof of a malicious writer). Do not spin retrying short reads. After exact declared bytes, one one-byte EOF probe at declared size MUST return0; growth fails even if still below the general cap. Reject invalid bytesRead or mismatched supplied buffer as I/O failure. Check fstat and lstat again, then await close. Zero-length file still gets the EOF probe. Never expose bytes if type/identity/size/mode/timestamp or EOF mismatches.
- All metadata traversal across ALL nominations completes before ANY ordinary body read. Reader retains fingerprints for root/all namespace/selected entries. After consumer completes (including its pending output accounting/freeze), lstat each issued record again in root/path code-unit order and compare fingerprint, without opening bodies. Final record rechecks detect known changes to namespace/selected directories/blocked leaves/unselected immediate entries too; they do not inspect unrelated subtrees or guarantee no undetectable concurrent edit. No retries or snapshot refresh.
- Use try/finally to await every owned handle's single close attempt. A fulfilled close confirms cleanup. A rejected FileHandle.close with fd==-1, or Dir.close with exact `ERR_DIR_CLOSED`, is confirmed-but-failed cleanup: select `LOCAL_IO_FAILED` at `filesystem` only if no earlier issue. Any other rejection/unconfirmed ownership yields terminal `LOCAL_CLEANUP_FAILED` at `filesystem`, overriding pending success, abort/deadline, mutation or I/O error. Continue closing any other owned handles even after the first failure. Do not retry ambiguous raw descriptor closes (descriptor reuse risk) or manufacture successful cleanup. No hard cleanup deadline: a pending close remains awaited, potentially indefinitely. On successful cleanup preserve the first error; only pending success receives final abort/deadline checks. Timeout noticed during successful close suppresses success; it never skips close. No success with unconfirmed cleanup is guaranteed, NOT guaranteed OS close/cancellation.
- Error pointers: malformed envelope/options → `$`; invalid host path/root-storage/root I/O → `directory`; invalid/duplicate nominations or nomination alias → `nominatedNames`; unsafe/duplicate immediate disk names or root list count → `namespace`; unsafe/duplicate nested paths or local entry/file/byte/output caps → `subtrees`; I/O after root lstat, invalid reader records, metadata inconsistency, work/call budgets, abort/timeout/cleanup → `filesystem`. Relative-path depth/absolute-joined-length failures use namespace/subtrees according to the observed entry. Fixed first-error selection is in execution order; successful ordering is deterministic, but multiple independent filesystem failures encountered in OS enumeration order need not pick the same issue. No authored error pointers.

### Fixed budgets and actual work order

All maxima are ceilings, not a guarantee combinations succeed, finish before deadline, fit a later ImportInput with upstream snapshots, or fit one heap copy. Public constants cannot be raised per call. Count repeated occurrences independently. Trusted per-object temporary allocations are bounded; native Node/libc/OS memory/latency is not an exact heap/wall-clock sandbox.

1. Validate input1MiB/root4096/nominees4096 and snapshot before I/O. Root namespace4096; selected complete trees1024 each/8192 combined, counting explicit dirs/blocked leaves; ordinary files8192 across selected trees; each1MiB except exact root manifest256KiB; ordinary bytes8MiB per subtree excluding only exact root manifest; all file bytes including roots32MiB. Hardlinked/special blocked leaves count as entries, not body occurrences; never preflight/charge their target bytes.
2. Enumerate full immediate namespace first; validate every immediate name/case pair and lstat all entries before nomination mapping. Resolve nominees against exact/folded namespace. For nominated directories only, depth-first metadata traversal in sorted sibling order, closing a directory before descending. At each list pass remaining subtree/aggregate entries to reader; preflight file count/sizes/per-tree/aggregate bytes before read. Special leaves remain bodyless; unrelated nonportable namespace names fail before selected bodies. Enforce both package-relative path and `name/path` before retaining/calling I/O. Root path is not itself subject to package-name syntax.
3. Build empty output envelopes and exact compact JSON byte accounting before bodies. For each selected file reserve the full serialized entry delta using metadata size: empty-base64 file entry JSON size + `4*Math.ceil(size/3)`; count commas, every key/punctuation, namespace/nominated/subtree repeated names and duplicate paths. Directories/blocked entries charge their exact compact JSON. Charge per subtree envelope with empty entries plus subsequent entry deltas before attaching data. Final output is ≤64MiB; reject overflow before reading that body and, because all sizes are knowable, complete output preflight MUST finish before the FIRST body. File buffers may be converted one-at-a-time after preflight; never clone a full Buffer graph or serialize an unbounded expanded value then check. Compare final `Buffer.byteLength(JSON.stringify(value),"utf8")` with exact tracked bytes and64MiB, then recursively freeze pending value, with before/after operation checks. Construction is already detached: no whole-output structuredClone is needed.
4. Derive call bounds rather than extrapolate only bytes: let R≤12289 records, D≤12289 opened directory occurrences including root, F≤8192 ordinary body files, E≤12288 returned directory entries. Initial/final lstat ≤2R; per directory ≤8 additional Node calls (open, fstat twice, opendir, lstat twice, close twice); explicit Dir.read calls ≤E+D plus at most1 rejected overflow yield for a failed operation; file acquisition ≤6 non-read calls (pre-lstat, open, fstat twice, post-lstat, close) and ≤17 reads (16 chunks+EOF). Conservative successful total `2*12289 + 8*12289 + (12288+12289) + 23*8192 = 335883` application-visible asynchronous Node FS calls. Global cap350000 includes close attempts, with2 slots reserved before scheduling non-cleanup work; cleanup always attempts already-owned closes even after budget failure. A rejected overflow read cannot push the derived bound beyond350000. No claim of counting/limiting individual kernel syscalls; Node may do bounded buffered work/internal Dirent lstat fallback. Do not label this a kernel I/O bound.
5. No parallel I/O/Promise.all traversal. At most one pending I/O, max2 live handles (one Dir plus its verifying FileHandle, or one body FileHandle). Directory-name buffering is1 at Node API, native internals remain platform-controlled. Metadata registry≤12289, selected-record list≤8192, namespace/nomination/subtree lists≤4096; sibling arrays≤4096 root or≤1024 selected. File temporary allocation≤1048577 bytes plus at most its bounded base64/string serialization; complete retained output64MiB, not a single-copy heap guarantee. Every absolute path≤4096 bytes, full root-relative name/path≤240 and≤64 segments, so recursion stack is bounded64; no recursive handle stack.
6. `checkpoint()` charges one work unit, checks abort/deadline and every64 units awaits one `setImmediate` then rechecks. Call it for each FS scheduling step (except mandatory close), each input nomination, each traversal/metadata/output/final-check/freeze record and each read chunk. Cap workUnits524288 and yields8192 (equality allowed). Sort at most4096 siblings/8192 entries with bounded ≤240-character comparisons; synchronous validation/base64/stringify is bounded by the above objects and only cooperatively checked before/after, not preemptible. Counter overflow yields LIMIT_EXCEEDED at filesystem; reserve closes independently. No promise that all maximum fixtures finish within10000ms. Private clock/limit doubles may isolate stronger ceilings; public no-limit-override shape is tested.

### Node API planning evidence and scope of tests

Installed runtime is Node v24.19.0. Trusted local `node_modules/@types/node/fs.d.ts` documents OpenDirOptions.encoding as BufferEncoding, bufferSize default32, recursive defaultfalse, Dir.read arbitrary order and mutation caveat, Dir.close fulfillment only after resource closure, and no public directory fd. `fs/promises.d.ts` documents numeric flags, FileHandle.stat bigint, explicit positional buffer read and fd. Do not cast unsupported `encoding:"buffer"` to silence types.

Owned bounded planning probe D/`planning-api-probe-1.mjs` (15s outer timeout, clean env, owned HOME/TMPDIR, core disabled) passed with exit0 in `planning-api-probe-1.txt/.exit`: ASCII, UTF8 é and raw ff directory names roundtrip via latin1; explicit Dir.read/close; bigint nanosecond stats; bounded positional EOF; nofollow ELOOP; ordinary directory handle; FileHandle.fd==-1 after close. It uses only its owned scratch root; cleanup awaited. It does NOT prove malicious-race containment, other platforms, close failure guarantees, hard cancellation or native heap bounds. Keep probe read-only as evidence after planning.

Actual owned disk tests prove Node acquisition/byte/mode/name behavior in the installed environment. Private Node-boundary doubles prove branch precedence/accounting/ownership sequencing, not OS guarantees. Use doubles for denied open/enumeration under elevated permissions, unknown types, cross-device metadata, replacement/short/growth/timestamp changes, hung-then-released acquisition/close and impossible-to-force cleanup errors. Do not simulate "aborted pending open was canceled": release its actual owned handle later and assert caller waits and closes it before settlement. A permanently hung OS call cannot be tested to termination; use a deferred promise released by the test, record that proof scope. No actual special-body opening to demonstrate inertness. Owned symlinks and hardlinks point only to another owned sibling fixture; FIFO/socket/device classification can use genuine owned FIFO where a test-only bounded creation helper is explicitly used, otherwise private metadata doubles (no production subprocess). Prefer an owned Unix socket fixture only if no service is started: use metadata doubles for socket/device instead. No listening services.

### Validation and chronology (every task/fix)

Before editing capture task base/full ref, cwd/branch, tracked/untracked status, diff/index to unique D paths; assert expected branch/state. Task1 baseline before ANY source/test creation: accepted1937 Vitest tests/50 files +3 opscli, unchanged488 diagnostics. Copy/adapt these scripts into D only:

```bash
cd /home/slamnation/www/orgops
D="$PWD/.superpowers/sdd/2026-09-11-catalogs-09-offline-local-evidence"
P="$PWD/.superpowers/sdd/2026-09-10-catalogs-08-offline-import-preparation"
cp "$P/parent-verify.sh" "$D/parent-verify.sh"
cp "$P/compare-lint.py" "$D/compare-lint.py"
python3 - <<'PY'
from pathlib import Path
D=Path('.superpowers/sdd/2026-09-11-catalogs-09-offline-local-evidence')
p=D/'parent-verify.sh'
s=p.read_text().replace('2026-09-10-catalogs-08-offline-import-preparation','2026-09-11-catalogs-09-offline-local-evidence')
s=s.replace(': > "$D/${LABEL}-exits.txt"', 'test ! -e "$D/${LABEL}-exits.txt" || exit 98\n: > "$D/${LABEL}-exits.txt"')
p.write_text(s)
p=D/'compare-lint.py'
s=p.read_text().replace("d=root/'.superpowers/sdd/2026-09-10-catalogs-08-offline-import-preparation'", "d=root/'.superpowers/sdd/2026-09-11-catalogs-09-offline-local-evidence'")
s=s.replace('2026-09-10-catalogs-07-offline-publication-evidence/parent-final-lint.json', '2026-09-10-catalogs-08-offline-import-preparation/parent-final-lint.json')
p.write_text(s)
PY
bash "$D/parent-verify.sh" task-1-baseline
python3 "$D/compare-lint.py" task-1-baseline > "$D/task-1-baseline-comparison.txt"
cmp "$P/parent-final-root-lint.txt" "$D/task-1-baseline-root-lint.txt"
```

All12 workspaces independently: api, agent-runner, opscli, admin-ui, user-ui, db, schemas, event-bus, llm, crypto, skills, events-scenario-tests. Plus root test/opscli/root lint =15 exact unique exit labels and nonempty raw logs. Exact expected exits: test0,opscli0,root-lint2,lint-api2,lint-agent-runner2, other10 lint0. Compare full path/line/column/code/multiline-message/multiplicity diagnostic Counters; reject unparsed/missing logs/incorrect exits. API486+runner2=488, all other workspaces including skills/schemas clean. No diagnostic-bearing source changes or position normalization. Root lint raw bytes must remain identical to fresh Phase9 baseline. Root lint short-circuits at API; never substitute it for all-workspace runs. Test count increases only from scoped new tests.

Focused TDD/example commands use the same isolation (npm executes only installed tooling, no downloads):

```bash
D=/home/slamnation/www/orgops/.superpowers/sdd/2026-09-11-catalogs-09-offline-local-evidence
isolated() {
  (ulimit -c 0; timeout --kill-after=5s 600s env -i PATH="$PATH" \
    HOME="$D/scratch/home" TMPDIR="$D/scratch/tmp" CI=1 \
    /bin/bash --noprofile --norc -c \
    'set -a; source .env.example; set +a; export ORGOPS_LLM_STUB=1; exec "$@"' bash "$@")
}
# Example Task2 target; replace label/file only for the assigned task.
isolated npm exec --no -- vitest run packages/skills/src/catalogs/local-skill-evidence.test.ts \
  > "$D/task-2-red-1.txt" 2>&1
printf '%s\n' "$?" > "$D/task-2-red-1.exit"
# Each task/fix final (use a fresh LABEL, never overwrite failures):
LABEL=task-2-final-1
bash "$D/parent-verify.sh" "$LABEL"
python3 "$D/compare-lint.py" "$LABEL" > "$D/$LABEL-comparison.txt"
cmp "$D/task-1-baseline-root-lint.txt" "$D/$LABEL-root-lint.txt"
git diff --check
git diff --cached --check
```

Record a genuine behavioral RED before implementing the behavior, GREEN after. Missing-module/export-only failure is scaffolding RED, not security proof. For Task1 first callable owner can reject all inputs with fixed failure; the positive owned-directory assertion must then fail behaviorally before acquisition is implemented. Task2 initially returning an empty neutral observation lets an actual namespace/subtree assertion fail before collection. These are transient TDD steps, not committed stubs. Task3 source already complete: public export RED is honestly labelled missing-export-only; composition/no-effect tests are supplementary unless they reveal a real behavioral bug. Preserve all failed attempts with new paths and diagnose routine fixture/assertion/type issues locally. Material behavior/contract changes need parent approval before correction.

All validation completed before each scoped conventional commit. Stage only owned task source/test/docs paths explicitly, inspect full staged diff and `git diff --cached --name-only`, no `git add .`. Task result includes full HEAD, task base/range and fix-only range, exact logs, all15 exits, tests/lint comparison and outstanding limitations. Parent owns review/next launch/final acceptance; never claim whole-phase acceptance from task pass.

### Preflight / handoff table

| Task | Required base/input | Produces | Shared files/interface checks before handoff |
|---|---|---|---|
| 1 | Accepted base + parent-approved plan-only commit, clean tracked tree; full fresh baseline first | Private owner/types/factory + source-named tests | exact public types/limits; reader callback/record signature; no root exports; scratch confinement; root/cleanup/counter evidence |
| 2 | Parent-reviewed Task1 commit; full Task1 brief/common prefix | Complete deep-module `readLocalSkillEvidence` + tests | types unchanged; reader input snapshot/cleanup wraps ALL output; no import semantics edits; complete bytes/output preflight; no missing selected leaves |
| 3 | Parent-reviewed Task2 commit; full Task2 brief/common prefix | Explicit public exports, synthetic composition/no-effect tests, exact docs | only append index exports; consumer unchanged; separately recorded origin and only-location assertion; docs use real public names/budgets; no authority/sandbox claims |

Shared dependencies available unchanged in all tasks: RelativePathSchema/validateCatalogJson from schemas, ImportLocalEntry shape from import-types, and `prepareImport`/import fixtures ONLY in composition tests. No production collector import of the skills root (avoids active-discovery coupling). Existing schemas/import/publication/Git paths stay byte-identical. Review preflight table plus `git diff --name-only TASK_BASE..HEAD` after every task.

After parent approves this entire plan: commit only plan with `docs(catalogs): plan offline local skill evidence`; then generate D/task-N-body.md using installed `/home/slamnation/.pi/agent/git/github.com/obra/superpowers/skills/subagent-driven-development/scripts/task-brief PLAN N OUT`, concatenate ENTIRE shared prefix and respective body into D/task-N-brief.md. Independently verify exact prefix bytes, complete body equality to source task region, task identity/no other task bodies and taskCount3. Save hashes/lengths/preflight results in D. No source/test implementation in planning.

### Task 1: Private bounded root reader and one awaited ownership lifecycle

**Files:** Create `packages/skills/src/catalogs/local-skill-evidence-types.ts`, `local-skill-root.ts`, `local-skill-root.test.ts`, `local-skill-fixtures.ts`; create/adapt D verification scripts/logs only. No existing source edits or root exports.

**Consumes:** Exact public and private signatures/limits and trust contract in the shared prefix; installed Node declarations/probe; read-only RelativePathSchema and validateCatalogJson.

**Produces:** Working deep `withLocalSkillRoot<T>` with issued records, root/immediate/nested bounded enumeration, bounded exact file read, terminal rechecks/cleanup; exact public type module. Task2 consumes these functions without adding I/O ownership paths.

- [x] **Step 1: Capture state and fresh baseline before source/tests.** Run the shared baseline script setup, compare against Phase8 parent-final-lint.json and byte-identical root lint. Save cwd/ref/status/diff/index and counts. Stop on unexpected baseline. Do not run existing configured services.
- [x] **Step 2: Write the test-only owned fixture factory.** It has this exact interface, uses actual Node fs for fixture construction ONLY, creates and owns exactly one new mkdtemp parent under the ambient TMPDIR and removes only that parent. It MUST remain portable: no hardcoded phase/repo path and no assertion about where TMPDIR points, so plain `npm test` outside the phase harness still passes; the shared validation harness is what sets TMPDIR beneath D/scratch. Creation errors clean up in catch; callers dispose in finally. Test-specific malicious names use raw fs calls against `fixture.root`, not the safe `file` helper.

```ts
// local-skill-fixtures.ts -- test-only
import { mkdtemp, mkdir, writeFile, chmod, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { RelativePathSchema } from "@orgops/schemas";
export type LocalSkillFixture = {
  directory: string; root: string;
  file(path: string, bytes: Uint8Array, executable?: boolean): Promise<void>;
  directoryAt(path: string): Promise<void>;
  dispose(): Promise<void>;
};
export async function createLocalSkillFixture(): Promise<LocalSkillFixture> {
  // Owned scratch only, but portable: TMPDIR is supplied by the validation harness
  // (beneath D/scratch during this phase) and by the ambient temp dir otherwise.
  // This factory creates and disposes exactly its own mkdtemp parent and never
  // touches a configured/real skill root. Do not hardcode a phase or repo path here.
  const directory = await mkdtemp(join(tmpdir(), "catalog-local-"));
  const root = join(directory, "root");
  const dispose = () => rm(directory, { recursive: true, force: true });
  const safe = (path: string) => {
    if (!RelativePathSchema.safeParse(path).success) throw new Error("Invalid fixture path");
    return join(root, path);
  };
  try {
    await mkdir(root);
    return { directory, root, dispose,
      async file(path, bytes, executable = false) {
        const target = safe(path); await mkdir(dirname(target), { recursive: true });
        await writeFile(target, bytes); await chmod(target, executable ? 0o755 : 0o644);
      },
      async directoryAt(path) { await mkdir(safe(path), { recursive: true }); },
    };
  } catch (error) { await dispose(); throw error; }
}
```

- [x] **Step 3: Write callable-seam behavioral RED tests.** Create public types and an initially fixed-failure callable private owner only as a transient TDD step. Run targeted test, preserve failure showing missing acquisition (not just missing import), then implement minimal ownership/input snapshot and reads.

```ts
import { expect, it } from "vitest";
import { createLocalSkillFixture } from "./local-skill-fixtures";
import { withLocalSkillRoot } from "./local-skill-root";
it("local-skill-root enumerates namespace and reads exact issued file bytes", async () => {
  const f = await createLocalSkillFixture();
  try {
    await f.file("sample/data.bin", Buffer.from([0,255,10]), true);
    const result = await withLocalSkillRoot({ directory:f.root, nominatedNames:["sample"] }, undefined, async r => {
      const top = await r.listDirectory(r.root,4096);
      expect(top.map(x => [x.path,x.type])).toEqual([["sample","directory"]]);
      const files = await r.listDirectory(top[0]!,1024);
      expect(files.map(x => [x.path,x.type])).toEqual([["sample/data.bin","file"]]);
      return (await r.readFile(files[0]!)).toString("base64");
    });
    expect(result).toEqual({ok:true,value:"AP8K"});
  } finally { await f.dispose(); }
});
```

Run `isolated npm exec --no -- vitest run packages/skills/src/catalogs/local-skill-root.test.ts`, save task-1-red-1.txt/.exit. Once this assertion fails behaviorally, implement types, closure state and Node calls in the exact shared work order. Core resource pattern (use it for every acquisition, not a wrapper that loses a late handle):

```ts
// Inside the owner; concrete handle variable belongs to outer finally.
await checkpoint();
fileHandle = await open(path, flags); // await even if signal/deadline changes
// Ownership is recorded by assignment before any check can throw.
await checkpoint();
const actual = await fileHandle.stat({ bigint:true });
await checkpoint();
// Compare issued fingerprint/type, read only after all checks.
// finally awaits close once; outer result selection follows cleanup/rechecks.
```

- [x] **Step 4: Add source-named boundary/lifecycle tests BEFORE their corresponding guards.** Use actual fixture handles wrapped at the Node fs/promises boundary with `vi.mock(...importOriginal)` as in Git tests; do not add public injected I/O or configurable limits. Typed fixture return values remain genuine Stats/FileHandle/Dir; intercept exact call and restore all spies before fixture dispose. Each row specifies concrete stimulus and expected fixed result or observation:

| Cases | Expected |
|---|---|
| null/missing/extra input; accessor directory or array index; sparse/symbol/extra array; options getter, invalid signal; duplicate `a/a` and `a/A` | INVALID_LOCAL_INPUT or DUPLICATE_PATH at exact owning input pointer; getter counts0 and no fs calls |
| relative root, `/`, `//`, trailing slash, `.`/`..`, NUL, lone surrogate, control,4097 bytes,65 host components | INVALID_LOCAL_INPUT directory; no fs calls |
| pre-abort; clock initially beyond deadline; mocked win32/unsupported flags | LOCAL_ABORTED/LOCAL_TIMEOUT filesystem or UNSUPPORTED_LOCAL_STORAGE directory; no fs calls |
| owned missing root, file root, symlink root to sibling owned dir | LOCAL_IO_FAILED directory for missing; UNSUPPORTED_LOCAL_STORAGE directory for others; no opendir/body calls |
| valid UTF8 host directory; raw ff/UTF8 é/high-bit c1 immediate names; `CON`, `.git`, `a.`, `a b`,65 chars | valid host path works; disk names UNSAFE_PATH namespace before any body |
| `A` and `a`; nested `A/x` and `a/y`; duplicate yielded exact name (double) | DUPLICATE_PATH namespace/subtrees, no bodies |
| caller changes directory/nomination array after invocation | owner uses captured original, caller remains mutable |
| genuine directory nlink>1; file nlink2 to owned outside sibling | directory observed; private hardlinked record remains file with nlink2, readFile refuses it without open (collector later projects blocked); targets unchanged |
| symlink to owned sibling file or directory; broken symlink; doubled FIFO/socket/device/unknown mode | known special blocked/no body open or descent; unknown mode unsupported storage; no readlink |
| actual directory/file metadata versus opened handle mismatch in dev,ino,mode,nlink,size,mtimeNs,ctimeNs,type; late final recheck mismatch | LOCAL_EVIDENCE_CHANGED filesystem; selected cross-dev baseline UNSUPPORTED_LOCAL_STORAGE filesystem |
| root/selected Dir.read rejects; lstat/open/fstat/read rejects with synthetic sensitive error; unreadable nominated ordinary | LOCAL_IO_FAILED at owning fixed pointer, never absent/blocked success, zero logged sensitive strings |
| size0,1,65536,65537,1048576; short0/positive short chunk, growth EOF, impossible bytesRead/buffer | exact data for stable valid reads; inconsistent short/growth LOCAL_EVIDENCE_CHANGED; impossible response LOCAL_IO_FAILED |
| exact root manifest262144 then262145; ordinary1048576 then1048577 | equality allowed; LIMIT_EXCEEDED subtrees before buffer/body read |
| forged/cross-operation record, enumerate/read same record twice, maxEntries -1/fraction/>4096 | INVALID_LOCAL_INPUT filesystem, no extra I/O |
| list max0 empty/nonempty, max1 one/two entries | complete empty/one allowed; +1 LIMIT_EXCEEDED namespace/subtrees; overflow name not retained |
| deferred open/opendir/read/Dir.close/FileHandle.close; abort or deadline while deferred | no early settlement; release operation, owner registers/closes late handle; no further ordinary work |
| successful close, throw after real close(fd==-1), throw without confirmed close, ERR_DIR_CLOSED, ambiguous Dir close rejection | success / LOCAL_IO_FAILED / LOCAL_CLEANUP_FAILED according to shared precedence; pending original error preserved only when cleanup confirmed |
| unconfirmed close combined with success/abort/timeout/mutation/read error | sole LOCAL_CLEANUP_FAILED filesystem; other live handle close still attempted |
| clock reaches deadline during final recheck/freeze/close; abort and timeout first noticed together | no success; abort wins first simultaneous check; prior issue otherwise retained; cleanup failure always wins |
| private reduced fsCalls/workUnits/yields with all other guards permitting equality/+1 | exact counter behavior, mandatory close reservation; no raised public limits |

Deferred-acquisition test skeleton (complete setup uses the fixture and actual Node handles, not fictitious fd state):

```ts
import * as fs from "node:fs/promises";
import { vi } from "vitest";
vi.mock("node:fs/promises", async original => ({...await original<typeof import("node:fs/promises")>()}));
it("local-skill-root awaits a late-opened owned handle after abort", async () => {
  const f = await createLocalSkillFixture(), controller = new AbortController();
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  let release!: () => void;
  let h: Awaited<ReturnType<typeof actual.open>> | undefined;
  const gate = new Promise<void>(resolve => { release=resolve; });
  const opened = vi.spyOn(fs,"open").mockImplementationOnce(async (...args) => {
    h=await actual.open(...args); await gate; return h;
  });
  let settled=false;
  try {
    const pending=withLocalSkillRoot({directory:f.root,nominatedNames:[]},{signal:controller.signal},async r => {
      await r.listDirectory(r.root,4096); return true;
    }).then(r => {settled=true;return r;});
    await vi.waitFor(() => expect(h).toBeDefined()); controller.abort();
    await new Promise<void>(resolve => setImmediate(resolve)); expect(settled).toBe(false);
    release();
    expect(await pending).toEqual({ok:false,issues:[{code:"LOCAL_ABORTED",at:"filesystem"}]});
    expect(h!.fd).toBe(-1); expect(opened).toHaveBeenCalledTimes(1);
  } finally { release(); vi.restoreAllMocks(); if(h && h.fd!==-1) await h.close(); await f.dispose(); }
});
```

- [x] **Step 5: GREEN and full verification, then scoped commit.** Run targeted owner tests after each coherent guard, preserve unique RED/GREEN attempts. Verify call traces show no parallel pending operations, ≤2 handles, every acquisition registered/closed, no post-settlement events after an extra setImmediate. Complete shared15-command validation as `task-1-final-1`, compare lint/root raw logs, inspect exact diff/index. Commit only four new colocated files with `feat(catalogs): add bounded offline local root reader`. Return head/range/evidence for fresh read-only parent task review; no Task2 edits before gate.

### Task 2: Complete neutral namespace and nominated subtree collector

**Files:** Create `packages/skills/src/catalogs/local-skill-evidence.ts`, `local-skill-evidence.test.ts`. Modify new `local-skill-root.ts`/test only for narrowly necessary reviewed collector defects; no type drift or existing consumer edits. Fixture additions only if needed for specified tests.

**Consumes:** Exact Task1 types/constants and `withLocalSkillRoot<T>`, `LocalSkillRecord`, `LocalSkillRootReader`, `createLocalSkillFixture()`.

**Produces:** Complete deep-module `readLocalSkillEvidence(input,options)` returning exactly LocalSkillEvidence; no public root export yet, no origin/caller reconciliation convenience adapter.

- [x] **Step 1: Preflight reviewed Task1 and write behavioral RED.** Capture task base/status/diff/index. Read full common prefix/Task1 interfaces/current owner. Add callable collector with empty result only as transient TDD scaffolding; then verify the following assertion genuinely fails for missing observations before traversal is implemented.

```ts
import { expect,it } from "vitest";
import { createLocalSkillFixture } from "./local-skill-fixtures";
import { readLocalSkillEvidence } from "./local-skill-evidence";
it("local-skill-evidence binds full namespace to exact nominated subtrees",async () => {
  const f=await createLocalSkillFixture();
  try {
    await f.file("unmanaged/SKILL.md",Buffer.from("invalid frontmatter"));
    await f.file("not-a-directory",Buffer.from("never read occupancy body"));
    await f.file("selected/orgops-package.json",Buffer.from([239,187,191,255,0]));
    await f.file("selected/assets/run",Buffer.from([255,0,10]),true);
    await f.directoryAt("selected/empty");
    const r=await readLocalSkillEvidence({directory:f.root,nominatedNames:["selected","missing","not-a-directory"]});
    expect(r).toEqual({ok:true,value:{
      nominatedNames:["missing","not-a-directory","selected"],
      namespace:{complete:true,entries:[{name:"not-a-directory",type:"file"},{name:"selected",type:"directory"},{name:"unmanaged",type:"directory"}]},
      subtrees:[{name:"selected",complete:true,entries:[
        {type:"directory",path:"assets"},
        {type:"file",path:"assets/run",base64:"/wAK",executable:true},
        {type:"directory",path:"empty"},
        {type:"file",path:"orgops-package.json",base64:"77u//wA=",executable:false},
      ]}],
    }});
  } finally {await f.dispose();}
});
```

Run isolated targeted file → `task-2-red-1.txt/.exit`; retain scaffolding failures separately.

- [x] **Step 2: Implement collector inside the one owning callback.** No additional fs imports/acquisition paths. Use the following algorithm and shared exact preflight accounting, not semantic inspectors:

```ts
import type { ImportLocalEntry } from "./import-types";
import { withLocalSkillRoot, type LocalSkillRecord } from "./local-skill-root";
import { OFFLINE_LOCAL_SKILL_LIMITS as L, type LocalSkillEvidenceInput,
  type LocalSkillEvidenceOptions, type LocalSkillEvidence, type LocalSkillEvidenceResult,
  type LocalSkillNamespaceEntry, type LocalSkillSubtree } from "./local-skill-evidence-types";
const compare=(a:string,b:string) => a<b ? -1 : a>b ? 1 : 0;
export function readLocalSkillEvidence(input:LocalSkillEvidenceInput,options?:LocalSkillEvidenceOptions):Promise<LocalSkillEvidenceResult<LocalSkillEvidence>> {
  return withLocalSkillRoot(input,options,async reader => {
    const namespace:LocalSkillNamespaceEntry[]=[], subtrees:LocalSkillSubtree[]=[];
    const value:LocalSkillEvidence={nominatedNames:[...reader.input.nominatedNames],namespace:{complete:true,entries:namespace},subtrees};
    let outputBytes=Buffer.byteLength(JSON.stringify(value));
    function charge(bytes:number) {
      if(outputBytes+bytes>L.outputJsonBytes) reader.fail("LIMIT_EXCEEDED","subtrees");
      outputBytes+=bytes;
    }
    charge(0);
    const top=await reader.listDirectory(reader.root,L.namespaceEntries);
    for(const record of top) {
      await reader.checkpoint();
      const item={name:record.path,type:record.type};
      charge(Buffer.byteLength(JSON.stringify(item))+(namespace.length ? 1 : 0)); namespace.push(item);
    }
    const exact=new Map(top.map(r => [r.path,r]));
    const folded=new Map(top.map(r => [r.path.toLowerCase(),r]));
    for(const name of reader.input.nominatedNames) {
      await reader.checkpoint();
      if(!exact.has(name) && folded.has(name.toLowerCase())) reader.fail("UNSAFE_PATH","nominatedNames");
    }
    let totalEntries=0,totalFiles=0,totalBytes=0;
    const bodies:{record:LocalSkillRecord;entry:Extract<ImportLocalEntry,{type:"file"}>}[]=[];
    for(const name of reader.input.nominatedNames) {
      await reader.checkpoint();
      const selected=exact.get(name); if(selected?.type!=="directory") continue;
      const entries:ImportLocalEntry[]=[], tree:LocalSkillSubtree={name,complete:true,entries};
      charge(Buffer.byteLength(JSON.stringify(tree))+(subtrees.length ? 1 : 0)); subtrees.push(tree);
      let ordinaryBytes=0,treeEntries=0;
      async function visit(directory:LocalSkillRecord):Promise<void> {
        const remaining=Math.min(L.entriesPerSubtree-treeEntries,L.localTreeEntries-totalEntries);
        const children=await reader.listDirectory(directory,remaining);
        // Reserve the entire sibling list before descent, including not-yet-visited siblings.
        treeEntries+=children.length; totalEntries+=children.length;
        if(treeEntries>L.entriesPerSubtree || totalEntries>L.localTreeEntries) reader.fail("LIMIT_EXCEEDED","subtrees");
        for(const record of children) {
          await reader.checkpoint();
          const path=record.path.slice(name.length+1);
          let entry:ImportLocalEntry;
          let base64Bytes=0;
          if(record.type==="file" && record.stat.nlink===1n) {
            const rootManifest=path==="orgops-package.json";
            const max=rootManifest ? L.manifestBytes : L.fileBytes;
            if(record.stat.size>BigInt(max)) reader.fail("LIMIT_EXCEEDED","subtrees");
            const size=Number(record.stat.size);
            totalFiles++; totalBytes+=size; if(!rootManifest) ordinaryBytes+=size;
            if(totalFiles>L.aggregateFiles || totalBytes>L.decodedBytes || ordinaryBytes>L.ordinaryBytesPerSubtree) reader.fail("LIMIT_EXCEEDED","subtrees");
            entry={type:"file",path,base64:"",executable:(record.stat.mode & 0o111n)!==0n};
            base64Bytes=4*Math.ceil(size/3);
          } else entry={type:record.type==="directory" ? "directory" : "blocked",path};
          charge(Buffer.byteLength(JSON.stringify(entry))+base64Bytes+(entries.length ? 1 : 0));
          entries.push(entry);
          if(entry.type==="file") bodies.push({record,entry});
          if(record.type==="directory") await visit(record);
        }
      }
      await visit(selected);
      entries.sort((a,b) => compare(a.path,b.path));
    }
    bodies.sort((a,b) => compare(a.record.path,b.record.path));
    for(const {record,entry} of bodies) {
      await reader.checkpoint();
      const bytes=await reader.readFile(record); entry.base64=bytes.toString("base64");
      await reader.checkpoint();
    }
    await reader.checkpoint();
    const actual=Buffer.byteLength(JSON.stringify(value));
    await reader.checkpoint();
    if(actual>L.outputJsonBytes) reader.fail("LIMIT_EXCEEDED","subtrees");
    if(actual!==outputBytes) reader.fail("LOCAL_IO_FAILED","filesystem");
    async function freeze(v:unknown):Promise<void> {
      if(v && typeof v==="object") {
        await reader.checkpoint();
        for(const child of Object.values(v)) await freeze(child);
        Object.freeze(v);
      }
    }
    await freeze(value); await reader.checkpoint(); return value;
  });
}
```

Implement this collector with the reader's shared path/issued-record invariants. Reserve every bounded sibling list immediately, before descending into any child: pending siblings count too. The private registry must not retain over8192 selected records across such lists; its independent global record cap remains mandatory. For per-record output projection use `record.path.slice(name.length+1)` (assert exact directory prefix from issued record), preserve type/file executable, never slice an authored unchecked path. For blocked records emit only `{type:"blocked",path}`. Track a map from issued file record to its precharged output position; it is bounded8192 and does not retain extra file buffers. Subtree envelopes and all entries use code-unit sorting, not localeCompare. Final freeze happens inside owning operation before final rechecks and settlement. No `prepareImport`, parseSkillDocument, loadSkillMeta, parsePackageManifest, inspectPackage or exporter calls in this module.

- [x] **Step 3: Test exact/overflow, nominations and acquisition order before adding corresponding guards.** Use actual disk for small and primary resource boundaries; sequentially create larger boundary fixtures under scratch with ≥30s Vitest per-test allowance, still public10000ms operation deadline. Use private monotonic clock double only when explicitly isolating a count/byte ceiling from real elapsed I/O; report which cases use it. Do not add public override options.

| Fixture / precise assertion | Expected |
|---|---|
| empty root/empty nominations; nominee absent; empty nominated directory; file/blocked nominee | exact namespace, nominatedNames retained, subtree only for exact ordinary directory; no invented absence entry |
| nominee `sample` with immediate `SAMPLE`; duplicate/casefold nominees | UNSAFE_PATH nominatedNames / DUPLICATE_PATH nominatedNames, zero subtree reads |
| unselected dir contains oversized/unreadable/raw-invalid child or sensitive marker file | only immediate name observed; never opendir/read descendants; still success if immediate name portable |
| unselected immediate invalid name or case twin; late selected nested invalid/case/file ancestor | global UNSAFE_PATH/DUPLICATE_PATH before any bodies, never skipped occupancy |
| raw `[ff]`, UTF8 `é`, highbit `c1`, ascii `A` | first three rejected losslessly, no ASCII alias; A portable |
| full `name/path`240 and241 bytes; component64 and65; relative depth64 and65; full absolute4096 and4097 (private metadata/input fixture where actual FS path ceiling is stronger) | equality passes applicable guard, +1 fixed UNSAFE_PATH or INVALID_LOCAL_INPUT owning pointer, no over-bound I/O |
| exact root bytes empty, BOM, invalid UTF8, malformed JSON, duplicate keys/key order/whitespace/CRLF | identical base64; collector never parses/reformats; nested/case-alias manifests ordinary data |
| file executable bits001/010/100 vs000; full mode post-read change | bool true for any exec bit; detected mode change fails filesystem; no chmod in adapter |
| empty explicit dirs, malformed/missing SKILL.md and missing root manifest | complete structural observations, no inspection/reuse decision |
| links to owned outside file/dir and hardlinked ordinary file to owned sibling | bodyless blocked leaves; no target open; complete selected tree includes block, outside bytes absent |
| namespace4096/+1, nominees4096/+1 | equality accepted absent other caps, overflow LIMIT_EXCEEDED namespace/nominatedNames before bodies |
| subtree1024/+1 ordinary/dir/blocked entries; eight subtrees×1024 and one extra ninth entry | equality allowed; LIMIT_EXCEEDED subtrees before bodies; explicit dirs/blocked count |
| ordinary1MiB/+1, exact manifest256KiB/+1;8 ordinary×1MiB plus root allowed; add separate one-byte ninth ordinary | per-object/per-subtree LIMIT_EXCEEDED subtrees; root excluded only from8MiB, not32MiB |
| aggregate8192 zero-byte file occurrences; extra occurrence where tree limit may bind first | correct aggregate charged; disclose aggregateFiles defense-in-depth when tree cap binds first, isolate with private lowered constant |
| four trees×8MiB ordinary bytes; separate one-byte root manifest in one tree |32MiB equality allowed, +1 aggregate fails before ANY body (no per-skill overflow) |
| same bytes in separate ordinary files and separate subtrees (not hardlinks) | every path occurrence read/charged, no digest or body dedup |
| complete serialized value exact bytes / one byte below via private reduced constant | equality succeeds, overflow before any body; punctuation/base64 rounding/duplicate names/paths all charged |
| final JSON accounting mismatch via private fault injection | LOCAL_IO_FAILED filesystem, no partial value; final cap failure LIMIT_EXCEEDED subtrees |
| input mutated after invocation; repeated calls after fixture disposal; reversed nomination/Dir iteration order | detached frozen sorted identical result for stable equivalent inputs; caller mutable; retained result survives disposal |

Metadata-before-bodies proof: wrap real fs.open/read calls after fixture setup, record paths/calls. Put a legal first body and an oversized or unreadable final nominated leaf. Expect LIMIT_EXCEEDED/LOCAL_IO_FAILED with no ordinary body read anywhere; directory verification opens are allowed but body read count is0. To test that unrelated bytes are never opened, put an ordinary file at root and a secret under an unselected dir, then assert neither path reaches ordinary open/read; directory/root metadata reads remain allowed. Error/log assertions search only fixed failure JSON and spies, never print actual observation data.

Add actual budget tests and exact JSON formula assertions (not an unreachable claimed natural64MiB output): with32MiB base64,8192×≤240-character paths plus4096-name overhead,64MiB is defense in depth. Use module-isolated private lowered constants for output/call/work guards and label them. Root and subtree namespace count/byte caps must also be exercised at real values. Check monotonic deadline around serialization/freeze with a clock spy; no hard-preemption claims.

- [x] **Step 4: GREEN, full verification and scoped commit.** Target both new owner and collector tests (`npm exec --no -- vitest run packages/skills/src/catalogs/local-skill-root.test.ts packages/skills/src/catalogs/local-skill-evidence.test.ts`) with isolated environment and unique logs. Run required15-command validation `task-2-final-1`, strict lint comparison and root-byte cmp. Inspect changes and ensure no old consumer/schema/Git edits. Commit explicit new collector/tests (plus any reviewed new-owner fix) with `feat(catalogs): observe complete nominated local skill trees`. Return exact range/logs for parent task review; no root exports/docs before Task3 gate.

### Task 3: Public exports, synthetic import composition and exact boundary documentation

**Files:** Modify only append exports in `packages/skills/src/index.ts`; create `packages/skills/src/catalogs/local-skill-evidence.integration.test.ts`; modify `docs/catalog-package-contract.md` and `docs/SPEC.md`. New fixture helper additions allowed only under Task1 fixture module. Existing prepareImport, input types, import tests/fixtures, schemas/Git/publication/application files stay byte-identical.

**Consumes:** `readLocalSkillEvidence`, LocalSkillEvidence types/limits; `createLocalSkillFixture`; existing `importInput`, `measuredSkill` and unchanged `prepareImport`. Existing fixtures supply synthetic bytes/origin setup independently of acquisition. No production mapping helper.

**Produces:** Named root API exports, end-to-end owned synthetic acquisition/composition regressions and complete public runnable documentation example; no production orchestration/caller merger/installation.

- [x] **Step 1: Capture Task2 reviewed base; add public export test.** Assert public function and frozen limits present, private owner/record/factory absent. Run isolated integration file RED; label missing-export-only honestly. Append these exact exports, never `export *` or move existing lines:

```ts
export { readLocalSkillEvidence } from "./catalogs/local-skill-evidence";
export {
  OFFLINE_LOCAL_SKILL_LIMITS,
  type LocalSkillEvidenceInput, type LocalSkillEvidenceOptions,
  type LocalSkillNamespaceEntry, type LocalSkillSubtree, type LocalSkillEvidence,
  type LocalSkillEvidenceIssue, type LocalSkillEvidenceResult,
} from "./catalogs/local-skill-evidence-types";
```

- [x] **Step 2: Add complete disk-to-import reuse test with independent synthetic assertions.** This test writes ONLY the owned fixture; that is fixture construction, NOT actual installation/activation. Its separately retained original identity exists before acquisition, not derived by the adapter. The only-location completeness assertion is true only by construction for this fixture. Test code:

```ts
import { expect,it } from "vitest";
import { prepareImport,readLocalSkillEvidence,type ImportInstalledEntry } from "../index";
import { createLocalSkillFixture } from "./local-skill-fixtures";
import { importInput,measuredSkill } from "./import-fixtures";
it("public local evidence composes with independently recorded fixture origin",async () => {
  const f=await createLocalSkillFixture();
  try {
    const originFixture=measuredSkill();
    if(originFixture.state!=="measured") throw new Error("Synthetic origin required");
    const retainedOrigin=structuredClone(originFixture.origin);
    let lexical="";
    for(const entry of originFixture.content.entries) {
      if(entry.type!=="file") throw new Error("Synthetic ordinary fixture expected");
      const bytes=entry.path==="orgops-package.json"
        ? Buffer.from(" \r\n"+Buffer.from(entry.base64,"base64").toString("utf8")+"\r\n")
        : Buffer.from(entry.base64,"base64");
      if(entry.path==="orgops-package.json") lexical=bytes.toString("base64");
      await f.file(`echo-skill/${entry.path}`,bytes,entry.executable);
    }
    await f.file("unmanaged/SKILL.md",Buffer.from("invalid unmanaged instructions"));
    await f.file("not-a-skill",Buffer.from("occupancy only"));
    const evidence=await readLocalSkillEvidence({directory:f.root,nominatedNames:["echo-skill"]});
    expect(evidence.ok).toBe(true); if(!evidence.ok) throw new Error("Synthetic observation failed");
    const entries:ImportInstalledEntry[]=evidence.value.namespace.entries.map(n => {
      const tree=evidence.value.subtrees.find(t => t.name===n.name);
      return n.name==="echo-skill" && n.type==="directory" && tree
        ? {state:"measured",name:n.name,origin:retainedOrigin,content:{complete:true,entries:tree.entries}}
        : {state:"occupied",name:n.name};
    });
    const input=importInput();
    input.installed={complete:true,entries}; // Fixture declares ONE relevant root, independently of adapter.
    const result=prepareImport(input);
    expect(result.ok).toBe(true); if(!result.ok) throw new Error("Synthetic preview failed");
    const skill=result.value.packages.find(p => p.identity.name==="echo-skill")!;
    expect(skill.action).toBe("reuse");
    expect(skill.manifestBytes).toBe("current-installed-manifest");
    expect(skill.files.find(p => p.path==="orgops-package.json")!.base64).toBe(lexical);
    expect(result.value.authority).toBe("none"); expect(result.value.reviewRequired).toBe(true);
    expect(Object.keys(evidence.value).sort()).toEqual(["namespace","nominatedNames","subtrees"]);
    // Throwing event-shapes.ts fixture was read as bytes, never evaluated.
  } finally {await f.dispose();}
});
```

- [x] **Step 3: Add negative composition/no-effect matrix.** Test-owned setup can mutate its fixture between separate quiescent acquisitions, never concurrently as an approved caller example. Use table-driven variants of the complete test above, preserving separately retained origins; any no-origin case maps namespace to occupied. Every case asserts unchanged pure consumer result, not new adapter semantic decisions:

| Disk/caller change | Expected prepareImport result |
|---|---|
| byte edit to SKILL.md, executable-bit change, edited/resealed metadata retaining original origin | SKILL_CONFLICT installed, no overwrite |
| root manifest missing/empty/BOM/binary/malformed/executable; extra empty dir; known blocked leaf; extra ordinary file | observation succeeds structurally, selected skill SKILL_CONFLICT installed |
| matching bytes but no independently recorded origin | explicitly map occupied; SKILL_CONFLICT installed |
| selected name ordinary file/unmanaged dir/uppercase occupied alias | occupied mapping or uninspectable measured tree; selected conflict, no silent reuse |
| unrelated unmanaged/file/malformed directory | namespace retains it; unrelated occupancy does not block otherwise valid closure |
| root only has absent selected name but required second owned root unknown | caller does NOT set all-location complete; unchanged import rejects missing/false installed.complete as INSTALLED_EVIDENCE_REQUIRED |
| two independently owned roots, same name but one copy edited or unknown origin | fixture caller maps name occupied; SKILL_CONFLICT, no general all-host merger/helper |
| matching lexical whitespace/key order/duplicate-key semantics but exact unchanged content | reuse semantic equivalence and exact acquired lexical bytes retained, no normalization |

Add public no-effect test after fixture construction: forbid/spy Node fs mutation methods (writeFile/appendFile/mkdir/rm/unlink/rename/chmod/chown/truncate and sync counterparts), subprocess methods, fetch/http/https, console logging, and active discovery (`resolveSkillRoot/listSkills/loadSkillMeta/loadSkillEventShapes`). Observe allowed `lstat/opendir/open/FileHandle.stat/read/close` flags exactly as planned. Snapshot fixture names/types/content/modes/identity before/after excluding atime; restore spies BEFORE fixture cleanup. Include authored marker-producing event module text referencing only an owned marker and `throw new Error(...)`; assert marker absent and full module bytes present in evidence, never execute it for demonstration. Failures with sensitive path/body/exception marker must have only fixed codes/pointers and no log calls. No new listening servers/network/DB effects or actual install method calls. Then put read spies around synchronous `prepareImport` to prove that step remains pure (acquisition itself is intentionally not zero-read).

Supplemental already-passing cases are labelled supplemental. If a behavioral regression is discovered, preserve its real RED, request plan approval if the fix changes shared semantics, perform narrow fix and rerun all required validation under a unique attempt label.

- [x] **Step 4: Document exactly implemented boundary, not accepted whole-phase status.** Add `## Offline local skill-root evidence` to package contract and linked SPEC subsection alongside offline import. Include all exact public types/constants above, complete absence/case/root/subtree/type/mode/manifest policies, fixed error code/pointer/precedence table, actual opened-handle checks and Node Dir identity limitation, trusted storage/ancestors/quiescence/all-location/origin responsibilities, no authority, native/heap/deadline/close limitations, exact derived call/work/budget bounds. State ordinary filesystem reads may change atime. Existing pure/import/publication/Git APIs remain unchanged. Explicitly distinguish this adapter from active discovery and explain malformed/unmanaged occupancy and matching-byte/no-origin non-reuse. No statement that phase review/acceptance is complete before parent verification.

Write a COMPLETE runnable `.mts` example in docs using only public exports, Node fixture construction and assert. Adapt the existing public synthetic import example's `exportSkillPackage`/source/catalog/package/target input construction; add owned mkdtemp root beneath explicitly supplied phase TMPDIR, write exported proposal file bytes (fixture setup only), define a separate literal synthetic retained origin BEFORE observing, then perform the exact neutral mapping in Step2. Do not import private test fixtures in docs. The example declares its owned root the only relevant location, asserts reuse and lexical manifest retention, cleans ONLY its mkdtemp root in awaited finally and prints nothing. Include an explicit no-origin occupied assertion yielding SKILL_CONFLICT. All source URLs `.invalid`, commits synthetic, no real roots, no origin inference from observed manifests. Save extracted executable example ONLY under D and execute with `isolated node --import tsx "$D/task-3-example-1.mts"`, preserve stdout/stderr/exit. No write/install/activation follows preparation except test fixture disposal. No private budget overrides in the example.

- [x] **Step 5: Verify whole task and commit scoped exports/tests/docs.** Run targeted three new suites with isolated npm, execute extracted doc example, then full15-command `task-3-final-1` validation, strict lint equality/root-byte cmp, diff/check/index scope. Verify previous consumer/schema/Git/application files byte-identical, public keys only expected additions, private factory/owner/records absent from root. Commit explicitly named files with `feat(catalogs): expose offline local skill evidence`. Return full head/range, exact test counts/logs/15 exits/example/lint and residual caller/OS limitations for parent whole-phase review and fresh independent acceptance. No push/merge/production operation.

## Execution tracking — bounded offline local-evidence phase accepted

Tasks 1–3 are implemented in `85c4deeb626a886b56c08aff9c5628e819863474`,
`ea413db6d1ceb8bf2772393ec20ad4a92f98400d` and
`5f78fb47128265da021297580d51eea1c67b4d88`; tracking commit
`7fffe62978afe4c8ba08987301e0860dbe22da72`. The parent approved the entire plan
(`de5fd61e69de27f17899c785bc024082d2e7dbae`) after applying one test-fixture
portability correction (no hardcoded phase path; portable `mkdtemp` under ambient
TMPDIR), and verified byte-identical task-brief prefixes. All three task reviews and
the whole-phase review returned structured `approved`.

Independent parent verification at `7fffe62`: **2095 Vitest tests/53 files**,
**3 opscli tests**, all fifteen exit labels exact, all twelve workspace lints with
exactly the unchanged **488** diagnostics (API486/runner2; ten clean workspaces,
including skills/schemas), byte-identical root lint, exactly the eleven expected
changed paths, no dependency/lock changes, clean whitespace and index, and the
executed public synthetic `.mts` example (exit 0, empty stdout). The checkboxes above
record task completion only; this section records the subsequent whole-phase review
and independent parent acceptance.

Known evidence limitations preserved: four Task 2 intermediate logs
(`task-2-green-2/3/4`, `task-2-skills-lint-1`) lack companion `.exit` files; their
exit status is inferable from the logs. Node file-descriptor/directory-handle
`garbage collection` close warnings appear non-deterministically in full-suite output
from Task 1's deliberate deferred-release fault doubles; close counting proves they
are not leaked handles. The joined-path >4096-byte guard is unreachable on Linux
(PATH_MAX 4095) and is proven only by a reduced-limit double; FIFO/socket/device
classification uses genuine-Stats metadata doubles; the 10s deadline is cooperative
(checkpoints only) with no hard OS-cancellation or guaranteed-close promise.

No installation, activation, start, approval capability, publication, live instance,
all-host completeness or full-design/two-instance acceptance is claimed. Q1/Q2 remain
deferred.
