# Offline Git Publication Tree Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The parent owns dispatch and review; dispatched workers must not launch nested agents.

**Goal:** Read one supplied exact commit from trusted provisioned local bare storage into complete bounded Phase-6 repository inventory and exact selected old-index bytes or confirmed absence, without creating policy, history or publication authority.

**Architecture:** Extract only the existing private raw-reader/session-lifecycle seam, leaving subprocess and object-integrity implementation untouched. A new async public evidence reader traverses the entire portable tree and hashes every ordinary file body; the unchanged pure `preparePublication` consumes this neutral evidence only when a caller independently supplies trusted configuration/history. No acquisition or writer is introduced.

**Tech Stack:** TypeScript, Node Buffer/crypto, existing Zod schemas, installed Git, Vitest, npm workspaces; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-09-skill-agent-catalogs-design.md` sections 5/7/9; full `docs/SPEC.md`; `docs/catalog-package-contract.md`; repository `AGENTS.md`; `.superpowers/sdd/2026-09-10-catalogs-07-offline-publication-evidence/controller-brief.md`.

## Planning gate / execution status

Parent reviewed the full draft against the current raw-reader/ownership skeleton and approved the three-task plan before the docs-only commit. Two requested clarifications are incorporated: detached values are checked after fixture disposal, not new reads from deleted storage; evidence success is byte/tree consistency, never semantic index or publication validity. The strict ordinary-tree-only subset is approved as a conservative adapter limit, not a Phase-6 format change. Planning made no implementation or test changes. All three execution tasks are implemented and task-reviewed. Whole-phase review and independent fresh parent verification are complete; the bounded offline slice is accepted. See the parent acceptance evidence below.

## Task completion and final validation evidence

Evidence directory: `.superpowers/sdd/2026-09-10-catalogs-07-offline-publication-evidence/`. Historical task reports and ledger retain initial failures and corrected attempts; checked steps do not claim additional behavioral RED where supplemental tests passed immediately.

| Task | Reviewed implementation HEAD | Evidence |
|------|----------------------------------------------|----------|
| 1 — private raw reader seam | `34c38d5557f2a66f72dcd19987b594220cd7f360` | `task-1-report.md`, `task-1-final-2-*`; Task 1 approval supplied to Task 2 dispatch and recorded in its report/ledger |
| 2 — bounded neutral evidence | `510b8c0168e35fb18462d02e7b793e5a2af5e431` | `task-2-report.md`, `task-2-final-*`; Task 2 approval supplied to Task 3 dispatch and recorded in its report/ledger |
| 3 — composition and contracts | `9addb43867785244edc33a9f8775b11ea8dbaa9d` | `task-3-report.md`, `task-3-final-2-*`; approved structured Task 3 review supplied to final-validation dispatch |

Fresh final-validation worker run at Task 3 HEAD: `phase-validation-*` records **1681 tests / 47 Vitest files**, **3 opscli tests**, and all twelve independent workspace lints. Root lint remains **exit 2**: API **486** and runner **2** existing diagnostics; ten workspaces including skills/schemas are clean. `phase-validation-comparison.txt` verifies full location/code/multiline-message/multiplicity equality against the fresh Task 1 baseline (**added 0, removed 0**); the root lint raw log is also byte-identical to baseline. No new tests or production edits in this tracking pass.

Whole-phase structured review approved HEAD `121d29f7ca5fb6f0dd19b1a81ac89bf39d84432c` with one stale documentation-status note, corrected by the parent acceptance update. The parent inspected production traversal/input/lifecycle seams and tests, reran the full suites and all twelve independent workspace lints: **1681 Vitest tests / 47 files**, **3 opscli tests**, exactly **488 unchanged diagnostics** including line/column/full multiline messages/multiplicity (ten clean workspaces). Root lint remains exit2 and its raw log is byte-identical to the baseline. Both documented SHA1/SHA256 synthetic examples passed as `.mts`; the initial `.ts` CommonJS/top-level-await mismatch is preserved in the parent evidence, not hidden as a clean first attempt. Evidence: `.superpowers/sdd/2026-09-10-catalogs-07-offline-publication-evidence/parent-acceptance.md`, `parent-final-*`, `parent-doc-example*`. No runtime/test changes followed verification, only acceptance documentation.

Scope remains bounded offline publication-tree evidence only: no live repository acquisition, historical evidence persistence, imports, approval/activation, credential access or publishing services. Q1/Q2 remain deferred.

## Global Constraints

- Work only in `/home/slamnation/www/orgops`, branch `88-move-private-skills-into-a-private-repo`; initial HEAD `5f962c95a033848ed4ff09e072f0a4e73fa7eb1c`. No worktrees, pushes, merges, remote writes, publication, real instance state/services or production credentials.
- This slice allows bounded read-only Git I/O only against trusted administrator-provisioned local bare storage and a trusted absolute installed Git executable. No URLs/refs/transport, checkout/extraction, hooks/filters/textconv/helpers, package execution, dependency installation, credential routing, source discovery, DB/API/UI/runner changes, approval or Git writes in production code.
- “Export from an explicit allowlist of portable fields and selected package files, not a broad database/workspace dump.” Existing export allowlists, wrapped `resourceWiring: "none"`, index/package readers and pure publication contracts remain unchanged.
- “No automatic dependency source registration, version substitution, or upstream overwrite.” Tree evidence cannot authenticate origin, prove historical release completeness, enable a source/catalog or grant publication permission.
- npm only; no installation, dependency/lock changes, suppression casts, `ts-ignore`, or unrelated lint fixes. Skills/schemas and eight other clean workspaces remain clean. Existing API486/runner2 debt requires exact zero-added diagnostics, not just matching counts.
- One writer at a time, sequential independently reviewed tasks, scoped local conventional commits. The parent owns fresh review gates and final verification. No nested agents. Infrastructure/runtime/extension/launch/output-contract failures are hard stops with exact error and cwd/branch/HEAD/status/diff; routine test failures are diagnosed locally.
- All new execution evidence belongs in `.superpowers/sdd/2026-09-10-catalogs-07-offline-publication-evidence/` (`D` below). Previous phases and `.superpowers/sdd/catalogs-pending-owner-decisions.md` remain read-only. Q1 transport/private-network and Q2 shared-shell phone layout stay deferred; do not ask the absent owner for credentials.
- Planning changes only this plan. Parent self-review of the FULL plan via `contact_supervisor` is mandatory before its docs-only commit. Complete task briefs include this entire shared header/contract. Implementation starts only after parent dispatch.

## Source map / file responsibilities

Read the actual sources before edits, including their colocated tests:

| Existing source | Binding seam |
|---|---|
| `packages/skills/src/catalogs/git-session.ts` / `.test.ts` | `createGitOperation`, `checkGitOperation`, `openGitObjectSession`, immutable issued metadata, algorithm-aware Git body rehash, fixed process/env/provisioning, finish/dispose precedence. No production changes planned. |
| `packages/skills/src/catalogs/git-objects.ts` / `.test.ts` | Own-data input snapshot; `createReader` root/raw-tree/info/contents accounting; selected package/index policy; current `read` cleanup result selection. Extract only common machinery, preserve selected policy. |
| `packages/skills/src/catalogs/git-inspection.ts` / `.test.ts` | Semantic public wrappers, fatal UTF8/BOM behavior, final deadline/freeze checks; existing private process doubles cover actual session-to-public cleanup. |
| `packages/skills/src/catalogs/git-fixtures.ts`, `fixtures.ts` | Owned synthetic SHA1/SHA256 bare fixtures, `object`/`commit`/`dispose`, ordinary fixture files, inert throwing event module. Raw malformed trees can be built with `object("tree", bytes, true)`; no real repositories. |
| `packages/skills/src/catalogs/publication-types.ts` | Reuse `PublicationTreeEntry` and `PublicationBase["inventory"]`, not a new incompatible inventory. No production changes planned. |
| `packages/skills/src/catalogs/publication-base.ts` | Explicit exact ancestors, complete inventory, selected-index exact/casefold placement/absence and actual lexical byte hash checks. Remains pure and unchanged. |
| `packages/skills/src/catalogs/publication-content.ts`, `content.ts` | Raw SHA256 versus Git-object digest, detached plain snapshots, positive re-export; do not introduce Git calls here. |
| `packages/skills/src/catalogs/publication-fixtures.ts`, `publication*.test.ts` | Explicit synthetic caller configuration/history, candidates, preconditions and immutable release behavior. |
| `packages/skills/src/index.ts` | Explicit named evidence API/types/limits only; never wildcard-export a private reader/session/fixture. |
| `packages/schemas/src/catalogs/primitives.ts` | `RelativePathSchema`, `CommitSchema`, `CATALOG_LIMITS`; unchanged. |

New units: `git-object-reader.ts` owns extracted private input/raw-object/accounting/lifecycle machinery; `git-object-reader.test.ts` tests that seam. `git-publication-evidence.ts` owns complete-tree policy and public neutral output; `git-publication-evidence.test.ts` covers traversal/API and `git-publication-evidence.integration.test.ts` covers real-Git-to-pure-publication and terminal lifecycle. No generic Git filesystem, plugin registry or new protocol.

## Shared contracts — copy everything before Task 1 into every task brief

### Public API (Task 2)

Define in `packages/skills/src/catalogs/git-publication-evidence.ts`, explicitly re-export at the skills root:

```ts
import type { PublicationBase } from "./publication-types";
import type { GitIndexInput, GitInspectionOptions, OfflineGitResult } from "./git-session";

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
  input: GitPublicationEvidenceInput,
  options?: GitInspectionOptions,
): Promise<OfflineGitResult<GitPublicationEvidence>>;
```

The input is exactly `{repository:{directory,gitExecutable},commit,indexPath}`: existing descriptor-safe input snapshot, no extra fields, no default path, no callbacks or caller-raised budgets. Input fields snapshot before first await. Options/signal remain trusted control inputs, executable proxies remain outside the contract. Output has exactly the four fields above, no repository path, source/catalog ID, enabled state, repository URL, history, origin, approval, provenance authentication or publication status. All evidence-reader success wording means byte/tree evidence consistency and completed lifecycle, NOT semantic catalog-index validity or a valid publication proposal. Malformed/BOM/binary index bytes can yield successful evidence and must fail unchanged Phase-6 preparation. `inventory.complete:true` is selected only after complete successful bounded traversal/hash work and confirmed cleanup, never for an unfinished result.

Phase-6 `PublicationTreeEntry` permits blocked entries but this adapter intentionally supports the stricter **ordinary-file/tree-only bounded subset**. It emits directory/file entries only. This is an explicit supported-subset choice, not a new package-format exclusion or change to Phase-6 blocked entries. Repositories containing any symlink/gitlink/special leaf fail, even unrelated to the index. No attempt to retrieve a symlink body/target or gitlink commit is needed. This conservative policy keeps complete object integrity truthful and avoids adding opaque unverified leaf evidence. Broader blocked-leaf support requires its own reviewed policy, not an implementer inference.

### Exact private seam (Task 1)

Move existing implementations, not their semantics, from `git-objects.ts` into `git-object-reader.ts`:

```ts
import type {
  GitObjectInfo, GitOperation, GitObjectSession, OfflineGitIssue,
  OfflineGitRepository, OfflineGitResult,
} from "./git-session";

export type GitReadAt = "$" | "repository" | "commit" | "path" |
  "manifest" | "index" | "entries" | "git";
export type GitInputSnapshot = {
  repository: OfflineGitRepository; commit: string; path: string;
}; // validated indexPath maps to private path, retaining existing validation pointers
export type RawGitTreeEntry = { mode: string; name: Buffer; oid: string };
export type GitObjectReader = {
  root(commit: string): Promise<string>;
  readTree(oid: string, depth: number): Promise<RawGitTreeEntry[]>;
  info(oid: string, type: GitObjectInfo["type"]): Promise<GitObjectInfo>;
  contents(record: GitObjectInfo, max: number): Promise<Buffer>;
  check(): void;
  take<T>(result: OfflineGitResult<T>): T;
  fail(code: OfflineGitIssue["code"], at?: GitReadAt): never;
  error(): OfflineGitResult<never>;
};
export function createGitObjectReader(
  session: GitObjectSession, operation: GitOperation,
): GitObjectReader;
export function withGitObjectReader<T>(
  input: unknown, operation: GitOperation, selector: "path" | "indexPath",
  consume: (reader: GitObjectReader, snapshot: GitInputSnapshot) => Promise<T>,
): Promise<OfflineGitResult<T>>;
```

`fields`, `hostPath`, `inputSnapshot`, `failure`/`success` remain private to the new module. Move the stopped-symbol/first-error handling, info/contents checks, `root` and `readTree` exactly. Raw parsing remains structural; selected or complete-tree policy validates names/modes separately. No path normalization, caches, process controls or policy callbacks reach the public API. The internal callback only sequences trusted library code in an already-owned fixed session; it accepts no authored command or executable.

`withGitObjectReader` is the existing `read` ownership skeleton parameterized only by selector and trusted consumer; remove its old `T extends GitPackageBytes | Buffer` restriction. Its consumer result is pending data, not public success. Await `session.finish()` and `session.dispose()`, with original redacted error preserved except unconfirmed cleanup overriding everything as sole `GIT_CLEANUP_FAILED`. Never early-return successful bytes from try/finally. Opening failure already owns cleanup. Unexpected exceptions are `GIT_FAILED`, thrown disposal is `GIT_CLEANUP_FAILED`. Perform the final operation check only on success so cleanup failure cannot be replaced by abort/timeout.

`git-objects.ts` retains `GitPackageBytes`, `select`, `packageBytes`, `indexBytes` policy and the two private byte-reader exports. Its local `createReader(reader: GitObjectReader)` can destructure the common methods and return its existing policy methods, avoiding a broad policy rewrite. Package empty-child rejection, manifest reservation, ignored unrelated unsafe siblings, selected ancestry twins and independent selector/package-relative path budgets MUST remain identical. Do not expose `createReader` at package root.

### Complete traversal, exact mode/absence and integrity policy

1. Validate/snapshot all public input before I/O; start one operation before validation. Resolve only the full lowercase SHA1/SHA256 commit matching provisioned storage through existing `root`. No parents/refs/replacements/tag peeling/history scanning.
2. Traverse root tree at depth 0. For each occurrence, use extracted `readTree`; validate raw name bytes as lossless ASCII before conversion (<=64 bytes), one safe segment with no slash, then the FULL root-relative joined path through `RelativePathSchema` (<=240 characters). No selected-subtree independent concatenation exemption here. Sort validated siblings by code-unit name, reject exact/casefold sibling duplicates before descending. Full paths and exact explicit directory ancestors are recorded; root itself is not a `.` entry. With slash-free segments and checked siblings, duplicate/file-directory-prefix collisions cannot be hidden by flattened names. Empty root is valid; every empty child tree becomes an explicit occupied directory.
3. Accept raw modes only `40000` (actual tree), `100644` or `100755` (actual blob). Reject `120000`, `160000`, all other octal modes and noncanonical forms (`040000`, `100664`, etc.) as `UNSUPPORTED_ENTRY` without reading referenced special objects. Malformed nonoctal/high-bit framing remains `GIT_PROTOCOL_ERROR`. No special mode is silently dropped or rendered ordinary. A selected special path or special ancestor therefore cannot become absence.
4. Finish structural traversal and selected-index placement before reading ANY ordinary-file bodies. For index path and each ancestor, a casefold-existing component must exist in exact spelling; every existing ancestor must be a directory. At final selected path, only exact `100644` is accepted. Directory/executable/non-directory ancestor: `UNSUPPORTED_ENTRY` at `index`. Case-only final or ancestor alias: `UNSAFE_PATH` at `index`. Exact/casefold duplicate inventory anywhere: `DUPLICATE_PATH` at `entries`. Missing index (including missing suffix ancestors) is allowed ONLY after full traversal proves no exact/casefold final/descendant collision and no non-directory or case-alias ancestor. A final empty directory is occupied, not absent. No package manifest basename reservation applies to this reader.
5. Sort complete inventory by code-unit path. Request actual blob metadata for every ordinary file in that order, enforce all per-file/aggregate byte bounds before ANY blob contents. The explicit selected index uses indexBytes (2MiB); every other ordinary file, even another index-like JSON file or package manifest, uses fileBytes (1MiB). All ordinary files, selected index included, count toward decodedBytes (8MiB), counting every path occurrence, including repeated OIDs. Late unsafe/missing/wrong-type/oversized unrelated files reject; none can be skipped while claiming completeness.
6. Read each measured ordinary blob body via existing `session.contents` through the reader; that verifies Git object hash `(type + space + size + NUL + body)` with the storage algorithm. Separately compute `sha256:` + SHA256(actual raw body), actual byte length and executable bit for Phase-6 inventory. A Git SHA256 OID is NOT a raw file SHA256. Never trust a manifest, claimed size alone or OID as file digest. Every tree/commit contents also passes existing Git integrity checks. Malformed/missing object identity/type/body yields existing fixed errors. Keep only one transient ordinary-file Buffer at a time beyond existing session buffers; retain only the selected index's canonical base64, not other body previews.
7. Preserve selected index bytes exactly including whitespace, LF/CRLF, BOM, NUL and invalid UTF8. Do NOT call `parseCatalogIndex`, `TextDecoder`, scan or parse/reserialize the index in this evidence reader. Empty ordinary index yields `""`, distinct from `null`. Malformed index evidence can be valid byte evidence; unchanged Phase-6 semantic validation must reject it, never launder it into success.
8. No cache, even within a call: repeated tree OIDs are re-read and charged per path occurrence; repeated ordinary blob OIDs get metadata/body/hash work per path. Traversal/metadata/output counts, decoded bytes, requests, stdout and deadline all count logical repeated work. Concurrency remains independent calls, not a shared budget/scheduler.
9. Build fresh plain data, then await finish/dispose before choosing success. Freeze every returned nested object/array after cleanup with operation checks before/after freezing; no Buffer/session/raw name or input object retained or frozen. A wrapper receiving an error must return it immediately, especially `GIT_CLEANUP_FAILED`, before final semantic/check work. Do not log index bytes or authored text on success or failure.

### Fixed ceilings and redacted lifecycle behavior

All `OFFLINE_GIT_LIMITS` remain unchanged: 10000ms shared monotonic deadline, 250ms cleanup observation (not extra work time); two total sequential children; 8192 batch requests; cumulative stdin1048576/stdout16777216/stderr65536; rev-parse output additionally <=32; header128; commit262144; per-tree262144, totalTree4194304, treeOccurrences2048, treeEntries8192, treeDepth240; packDirectoryEntries512. Existing preflight max32 fixed filesystem calls +513 iterator yields and byte-exact bare config templates remain binding. No weakening to fit larger repositories.

New decodedBytes8MiB counts every ordinary file occurrence, including old index. Check totals from actual metadata before any ordinary contents; hash/bytes checks bracketed by operation checks. New outputJsonBytes8MiB counts the complete compact UTF8 `JSON.stringify` representation of the FOUR-field evidence value including paths, metadata, punctuation and index base64. Before appending serialized-size-accounted entries/base64, maintain a bounded exact total (initial empty envelope size + serialized entry sizes + commas + base64 string growth relative to initial null). Confirm actual final serialized size before freezing/return; no truncated output. All paths are portable ASCII and base64 has no escapes. This output ceiling is defense in depth: 8192 entries each <512 serialized bytes plus <=2796204 index-base64 characters plus <1024 envelope bytes fits <8MiB, so a natural +1 output case is unreachable under stronger bounds. Test the arithmetic and final guard with a private mocked lower limit only; never add a public limit override.

Counts are ceilings, not a promise every combination is admitted. No cache means requests equal `2 * (1 commit + tree occurrences + ordinary file occurrences)` on successful reads. At root-only, 4094 ordinary leaves plus commit/root reach8192 requests (raw-tree size permitting); 4095 fails. Empty directories also cost two requests each. Maximum stdout at new logical byte/tree/commit/request bounds is conservatively <=8388608 +4194304 +262144 +8192*129 +32 =13901856, below16777216. The existing wire cap remains enforced anyway. Whole-repository RelativePath constraints dominate depth; do not increase path length or relax mode/empty-package rules. Finite decoded/serialized allocations are not a single-copy heap bound.

Expected failures use one `OfflineGitIssue`, no partial value. Existing fixed pointers `$`, `repository`, `commit`, `path`, `manifest`, `index`, `entries`, `git` only. New evidence limits use `entries`, selected-index size uses `index`, wire limits use existing `git`. Raw object errors retain `git`. No new error codes are needed. `GIT_CLEANUP_FAILED` overrides prior success, abort, timeout, protocol, integrity and ordinary exceptions; confirmed cleanup preserves the original error. No blind retry or promise that OS kill/reap always succeeds. POSIX linux/darwin only; trusted stable host/storage/executable, no malicious-root/TOCTOU sandbox, no exact synchronous/kernel/decompression preemption guarantee.

### Validation protocol shared by all tasks

Preflight every writer: read controller/spec/shared contract and previous accepted report; record `pwd`, branch, TASK_BASE=`git rev-parse HEAD`, `git status --short`, `git diff --stat`, `git diff --cached --name-only`. Unexpected staged/unrelated edits block scoped committing. Do not stage pre-existing files.

Task 1 copies/adapts Phase6 `parent-verify.sh` and `compare-lint.py` into D. Change their phase directory; compare the fresh Task1 baseline to Phase6 `parent-final-lint.json` rather than Phase5, subsequent task/final results to this phase's Task1 baseline. Preserve full source location, TS code, full multiline message and multiplicity; normalize repository prefix only. Strengthen exit validation to reject duplicate/missing labels, missing/empty raw logs, unparsed TS diagnostics and unexpected exits. Require Counter equality (added0/removed0), API486/runner2 and ten clean independently run workspaces. Root lint is expected exit2, not green. `test`/`opscli` must exit0. Never rewrite prior-phase evidence.

The runner uses env-i, `.env.example` only, ORGOPS_LLM_STUB=1, phase-owned HOME/TMPDIR, CI=1, ulimit core0, timeout600s with kill-after5s. Existing local npm/Node/Git tool PATH only; do not source `.env` or preserve provider keys/NODE_OPTIONS. Use this equivalent bounded targeted shell function (define once per task process):

```bash
cd /home/slamnation/www/orgops
D="$PWD/.superpowers/sdd/2026-09-10-catalogs-07-offline-publication-evidence"
mkdir -p "$D/scratch/home" "$D/scratch/tmp"
run_targeted() {
  local label="$1"; shift
  (ulimit -c 0; timeout --kill-after=5s 600s env -i PATH="$PATH" \
    HOME="$D/scratch/home" TMPDIR="$D/scratch/tmp" CI=1 \
    /bin/bash --noprofile --norc -c \
    'set -a; source .env.example; set +a; export ORGOPS_LLM_STUB=1; exec "$@"' \
    bash npm exec --no -- vitest run "$@") > "$D/$label.txt" 2>&1
  local rc=$?; printf '%s\n' "$rc" > "$D/$label.exit"; return "$rc"
}
```

No npm installation: `npm exec --no` must resolve committed-repo installed tooling, not acquire anything. Test fixture Git writes are allowed ONLY inside `createGitFixture`-owned synthetic bare storage. All malformed object construction and replacement-ref tests are test-only; dispose fixtures in finally. Instrument production read intervals after fixture construction so fixture writes cannot be confused with production writes. Never run authored modules/scripts or start services.

For every task: record actual targeted RED (behavior/import failure, not a type error incorrectly called security evidence), GREEN and targeted old suites; `bash "$D/parent-verify.sh" task-N-final`, then `python3 "$D/compare-lint.py" task-N-final > "$D/task-N-final-comparison.txt"`. Full Vitest, opscli and all12 individual lints run per task, plus root lint. Phase6 baseline reference is1557 Vitest tests/44 files, opscli3. Fresh Task1 baseline required before edits, not a claim these historical runs are current. Preserve unique attempt labels and raw logs; disclose immediately passing supplemental cases. Run `git diff --check`; record TASK_BASE..HEAD diff, scope and clean index after scoped commit. Parent obtains fresh read-only task review before next writer; full-phase reviewer and independent fresh parent verification remain required at end.

## Preflight consistency table

| Contract | Current source / planner decision | Task responsibility |
|---|---|---|
| Branch/HEAD/index | Initial5f962c95a033848ed4ff09e072f0a4e73fa7eb1c; exact branch, clean status/index inspected | All tasks recheck |
| Existing lifecycle | `git-objects.read` awaits finish/dispose with override, `git-session` owns all processes | Task1 exact seam extraction; Tasks2/3 exercise same machinery |
| Public neutral API | `GitPublicationEvidenceInput = GitIndexInput`; four-field `GitPublicationEvidence` | Task2 creates/exports, Task3 imports public root |
| Inventory | Existing `PublicationBase["inventory"]`, directories/files sorted, complete full tree only | Task2 traversal, Task3 exact preconditions |
| Special/empty rules | Reject all special modes; allow explicit empty tree dirs only here, not existing package reader | Tasks1/2 preservation + negatives |
| Index bytes/absence | Explicit RelativePath; exact100644 or proven casefold-safe absence; no semantic parse | Task2 bytes/placement, Task3 malformed handoff |
| Limits | Existing ceilings unchanged, new8MiB decoded/output; no cache; logical occurrence charging | Tasks1/2 accounting; Task3 independent bound/lifecycle regression |
| Policy/history | Caller-owned, independently explicit synthetic assertions only; no construction by reader | Task3 composition and denial tests |
| Lint evidence | Fresh Task1 baseline vs Phase6 parent-final, then exact comparisons including continuation lines/counts | All tasks + parent final |
| Docs and review | This is offline bounded evidence only, not transport/history/publishing/two-instance completion | Task3 docs, parent approval before plan commit |

---

### Task 1: Extract and preserve the private raw-object reader ownership seam

**Files:**
- Create `packages/skills/src/catalogs/git-object-reader.ts` and `git-object-reader.test.ts`.
- Modify `packages/skills/src/catalogs/git-objects.ts` only for extraction/delegation.
- Preserve/re-run `git-session.test.ts`, `git-objects.test.ts`, `git-inspection.test.ts`; add preservation assertions in `git-objects.test.ts` only if needed, not new production behavior.
- Create phase-local adapted validation scripts and raw evidence, untracked under D.

**Interfaces:** Consumes unchanged `GitObjectSession`, `GitOperation`, exact input/storage/result contracts. Produces the exact `GitObjectReader`, `GitInputSnapshot`, `RawGitTreeEntry`, `GitReadAt`, `createGitObjectReader`, `withGitObjectReader` private direct-module seam above. Existing byte/public readers remain API-identical.

- [x] **Step 1 — record preflight and fresh baseline.** Copy/adapt scripts exactly as shared validation specifies; run `bash "$D/parent-verify.sh" task-1-baseline` and `python3 "$D/compare-lint.py" task-1-baseline > "$D/task-1-baseline-comparison.txt"`. Stop if exits/log parsing/comparison fail. Record current1557/44 and3 only if actually observed; record actual totals otherwise and diagnose changes before source edits.
- [x] **Step 2 — write a failing real-Git private-seam test.** New test imports missing seam; fixture intentionally has arbitrary raw bytes (no semantic index parse) and each hash algorithm. Concrete seed:

```ts
import { expect, it } from "vitest";
import { createGitFixture } from "./git-fixtures";
import { createGitOperation } from "./git-session";
import { withGitObjectReader } from "./git-object-reader";

it.each(["sha1", "sha256"] as const)("shared reader owns exact %s root and cleanup", async format => {
  const f = await createGitFixture(format);
  try {
    const bytes = Buffer.from([0xff, 0, 10]);
    const commit = await f.commit([{ path: "index.json", bytes }]);
    const result = await withGitObjectReader(
      { repository: f.repository, commit, indexPath: "index.json" },
      createGitOperation(), "indexPath", async (r, s) => {
        const entries = await r.readTree(await r.root(s.commit), 0);
        expect(entries).toHaveLength(1);
        expect(entries[0]!.name.equals(Buffer.from("index.json"))).toBe(true);
        return (await r.contents(await r.info(entries[0]!.oid, "blob"), 3)).toString("base64");
      });
    expect(result).toEqual({ ok: true, value: bytes.toString("base64") });
  } finally { await f.dispose(); }
});
```

- [x] **Step 3 — capture RED.** `run_targeted task-1-reader-red packages/skills/src/catalogs/git-object-reader.test.ts`; expected missing module/export before extraction. Record that this is seam-availability RED, not newly discovered behavioral weakness.
- [x] **Step 4 — extract input/raw reader without policy.** Move exact helper bodies listed in shared seam. Return only the declared raw-reader methods. Do not alter `git-session.ts`, raw frame rules, budget increments, error pointers or private trust contracts.
- [x] **Step 5 — extract ownership and reconnect selected policies.** Existing `read` becomes generic `withGitObjectReader`; selected `createReader` retains select/package/index methods and takes the new common reader. Delegate existing entrypoints with this pattern, preserving original traversal order:

```ts
return withGitObjectReader(input, operation, "indexPath", async (raw, snapshot) => {
  const reader = createReader(raw);
  const root = await raw.root(snapshot.commit); raw.check();
  const selected = await reader.select(root, snapshot.path, true); raw.check();
  return reader.indexBytes(selected.oid);
});
```

For `readGitPackageBytes`, use selector`path`, `select(..., false)` and `packageBytes(selected.oid, selected.depth)`. Existing policy calls still check around work; with-wrapper checks around consumer, finish and disposal.
- [x] **Step 6 — prove terminal cleanup remains owned.** Add direct-wrapper tests using `vi.spyOn`/mocked `openGitObjectSession` as existing `git-objects.test.ts` does. For consumer success, reader.fail protocol, unexpected consumer throw and finish failure: delayed dispose prevents settlement; dispose failure/throw returns sole cleanup error. Confirmed cleanup preserves original; pre-abort/invalid envelope never opens session. Use this exact expected shape, not exception text:

```ts
expect(result).toEqual({ ok: false, issues: [{ code: "GIT_CLEANUP_FAILED", at: "git" }] });
expect(dispose).toHaveBeenCalledTimes(1);
```

Capture behavioral RED before each change if extraction revealed a regression; otherwise report preservation cases passing immediately. Existing awaited-disposal, cancellation-during-finish/dispose and caller-mutation tests must continue passing unchanged.
- [x] **Step 7 — targeted GREEN and preservation.** `run_targeted task-1-reader-green packages/skills/src/catalogs/git-object-reader.test.ts packages/skills/src/catalogs/git-session.test.ts packages/skills/src/catalogs/git-objects.test.ts packages/skills/src/catalogs/git-inspection.test.ts packages/skills/src/catalogs/publication.test.ts`. Confirm empty selected package children still fail, unrelated unsafe siblings remain ignored in old readers and independent path limits are unchanged.
- [x] **Step 8 — full validation and scoped commit.** Run shared full protocol as task-1-final, exact lint comparison and diff checks; inspect only planned files. Stage new core/test and changed selected reader (plus its tests only if changed), commit `refactor(skills): share bounded offline Git object reader`; record TASK_BASE/HEAD, exact staged scope before commit and empty index after. No root export/docs runtime claims yet. Parent review required before Task2.

### Task 2: Implement the complete bounded neutral evidence reader

**Files:**
- Create `packages/skills/src/catalogs/git-publication-evidence.ts`, `git-publication-evidence.test.ts`.
- Modify `packages/skills/src/index.ts` only to explicitly export the new operation, its two named types and frozen limits.
- Read/re-run Task1 raw seam and Phase6 inventory tests; no changes to `publication-base.ts`, package/index reader semantics, schemas or session budgets.

**Interfaces:** Consumes Task1 `withGitObjectReader`, `GitObjectReader`, existing `GitIndexInput` and `PublicationTreeEntry`/`PublicationBase["inventory"]`. Produces the exact public API in shared contract; Task3 must import it from `../index`, not a private byte API.

- [x] **Step 1 — task preflight.** Verify Task1 reviewed commit and clean scope, record TASK_BASE. Use its validation scripts/fresh baseline; no new install or alternate fixture runtime.
- [x] **Step 2 — write exact complete-tree RED.** Add a public-root test with both object algorithms, selected lexical index, nested binary executable file, unrelated ordinary file and derived SHA256. Seed:

```ts
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { createGitFixture } from "./git-fixtures";
import { readGitPublicationEvidence } from "../index";

it.each(["sha1", "sha256"] as const)("returns complete %s body evidence, not object IDs", async format => {
  const f = await createGitFixture(format);
  try {
    const index = Buffer.from('{ "formatVersion": 1, "entries": [] }\r\n');
    const binary = Buffer.from([0xff, 0, 10]);
    const commit = await f.commit([
      { path: "catalog/index.json", bytes: index },
      { path: "assets/run", bytes: binary, mode: "100755" },
      { path: "README.md", bytes: Buffer.alloc(0) },
    ]);
    const r = await readGitPublicationEvidence({ repository: f.repository, commit, indexPath: "catalog/index.json" });
    expect(r.ok).toBe(true); if (!r.ok) throw new Error("Fixture evidence rejected");
    expect(Object.keys(r.value).sort()).toEqual(["commit", "indexBase64", "indexPath", "inventory"]);
    expect(r.value.indexBase64).toBe(index.toString("base64"));
    expect(r.value.inventory.complete).toBe(true);
    expect(r.value.inventory.entries.map(e => e.path)).toEqual([
      "README.md", "assets", "assets/run", "catalog", "catalog/index.json",
    ]);
    expect(r.value.inventory.entries[2]).toEqual({ type: "file", path: "assets/run", size: 3,
      digest: `sha256:${createHash("sha256").update(binary).digest("hex")}`, executable: true });
    const oid = createHash(format).update("blob 3\0").update(binary).digest("hex");
    expect(r.value.inventory.entries[2]).not.toHaveProperty("digest", `sha256:${oid}`);
  } finally { await f.dispose(); }
});
```

- [x] **Step 3 — capture RED.** `run_targeted task-2-evidence-red packages/skills/src/catalogs/git-publication-evidence.test.ts`; expected missing public export before implementation.
- [x] **Step 4 — implement complete structural traversal.** In the new module use `withGitObjectReader(input, operation, "indexPath", ...)`. Implement deterministic DFS with per-sibling ASCII/RelativePath/casefold checks; emit explicit directories before recursing (including empties); collect ordinary `{path,oid,executable}` metadata candidates. All modes outside40000/100644/100755 fail. Use `reader.fail`/`reader.take`, never throw authored diagnostics. No additional subprocess or filesystem imports.
- [x] **Step 5 — implement index placement and all-metadata preflight.** Use exact-path map plus folded-path map of completed traversal. Check final/ancestor placement exactly as shared policy, derive null only from proven absence. Sort all file candidates; request actual blob metadata, apply selected2MiB/other1MiB and total8MiB before any ordinary body read. Retain issued `GitObjectInfo` records (do not clone them: session WeakMap identity is required). No package count257 limitation is incorrectly applied to full repository evidence.
- [x] **Step 6 — implement actual body hashes and immutable output.** Measure every file body and hash raw SHA256; retain only selected base64. Core file construction:

```ts
const bytes = await reader.contents(record, max); reader.check();
const entry = { type: "file" as const, path: file.path, size: bytes.length,
  digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  executable: file.executable };
reader.check();
if (file.path === snapshot.path) indexBase64 = bytes.toString("base64");
```

Account exact compact output bytes as shared contract states and independently assert final serialized size. Return sorted fresh plain evidence to wrapper; wrapper owns cleanup. Public function creates one operation, awaits with-wrapper, immediately returns errors, then checks/freeze/checks success. Recursive freeze never touches Buffers or caller inputs. Explicit root exports only:

```ts
export { readGitPublicationEvidence, OFFLINE_GIT_EVIDENCE_LIMITS,
  type GitPublicationEvidenceInput, type GitPublicationEvidence,
} from "./catalogs/git-publication-evidence";
```

- [x] **Step 7 — add real raw-tree path/mode/absence regressions.** Parameterize both algorithms for representative cases, SHA1 for full matrix. Build raw entries as `Buffer.concat([Buffer.from(mode + " "), nameBytes, Buffer.from([0]), Buffer.from(oid,"hex")])`; `f.object("tree", bytes, true)` and an ordinary commit body with that tree. Matrices:
  - exact duplicate, file/tree collision, A/a, ancestor casing, high-bit alias, UTF8 name, slash/backslash/dot/device/forbidden segment, full joined241-character path;
  - malformed mode octal/high-bit, short OID/trailing framing, unknown/noncanonical modes, selected/unrelated symlink/gitlink rejection without target object requests;
  - empty root and nested empty directories included; existing package reader still rejects empty package child;
  - index absent with missing whole ancestor, absent below exact existing dir, case-only index/ancestor, executable final, ordinary/blocked ancestor, directory final (empty/nonempty);
  - index at `orgops-package.json` allowed here; empty bytes `""` vs null; whitespace/BOM/binary invalid JSON preserved exactly, without parse/scan calls.
  Exact duplicate/path errors use fixed entries/index pointers above. Every failure must be `ok:false` with no value. Instrument session body calls to show structural/index placement failure performs zero blob contents; special refs are never requested. Capture separate behavioral RED where production paths are absent, not by weakening existing contracts.
- [x] **Step 8 — add byte/count/integrity regressions.** Real owned repositories: other file1MiB and+1; selected index2MiB and+1; exactly8MiB ordinary occurrences (including index) and+1; repeated same blob across paths counts each time; oversized unrelated README rejects complete output; same-size corrupted blob/commit/tree loose bodies produce integrity failure for SHA1/SHA256. Metadata wrong type/missing objects fail before all body reads; corruption fails during body read with no partial output. Use existing trusted in-memory session-double pattern only for expensive logical tree/count graphs, with the real extracted traversal; repeat subtrees at different paths to exercise per-occurrence raw treeBytes/count/entry ceilings. Request8192/8193 remains actual session tested; add evidence-facing fake-process test in Task3 for reader-to-session exhaustion. Check output/depth arithmetic for unreachable natural +1 conditions; test reduced private output guard honestly, not as natural production reachability. Never mock successful hash integrity as proof of actual Git body correctness.
- [x] **Step 9 — exercise input snapshots and cleanup before public success.** Reject missing/extra fields, invalid refs, unsafe index paths and getters before fs/spawn; mutate caller after first await without changing snapshot. Recursively assert frozen output and no Buffers; perform two reads while the fixture exists and assert their returned trees are distinct objects, then dispose the fixture and verify both detached evidence values remain valid. Do not attempt a successful new read from deleted storage. Delayed dispose with valid evidence prevents settlement, failed dispose gives cleanup error, pre-abort performs no I/O; late abort/timeout in hash/freeze must suppress success. Assert private reader/session/fixture exports are absent from public root.
- [x] **Step 10 — GREEN/full reviewable commit.** `run_targeted task-2-evidence-green packages/skills/src/catalogs/git-publication-evidence.test.ts packages/skills/src/catalogs/git-object-reader.test.ts packages/skills/src/catalogs/git-session.test.ts packages/skills/src/catalogs/git-objects.test.ts packages/skills/src/catalogs/git-inspection.test.ts packages/skills/src/catalogs/publication-base.test.ts`. Run shared full task-2-final validation, exact lint comparison/diff checks. Commit only this task's module/test/root exports: `feat(skills): read bounded offline publication tree evidence`. Record clean index/TASK_BASE/HEAD; parent review before Task3.

### Task 3: Prove public Git-to-publication composition and document the bounded subset

**Files:**
- Create `packages/skills/src/catalogs/git-publication-evidence.integration.test.ts`.
- Modify `git-publication-evidence.test.ts` only for remaining evidence API/lifecycle regressions; narrowly correct new reader if a test exposes a bug, record RED/GREEN.
- Modify `docs/SPEC.md`, `docs/catalog-package-contract.md`, `docs/superpowers/specs/2026-09-09-skill-agent-catalogs-design.md` only to describe implemented offline subset and truthful acceptance status.
- Existing pure publication/source/export/session production modules remain unchanged; no new docs example file/runner required.

**Interfaces:** Consumes public `readGitPublicationEvidence` and `GitPublicationEvidence`, existing public `preparePublication`, `inspectGitPackage`, `exportSkillPackage`, `PublicationInput`; fixture-only `publicationInput`/`publicationSkill` and `createGitFixture`. Produces executable synthetic composition/security/lifecycle proof plus current docs, not a publisher.

- [x] **Step 1 — preflight Task2 reviewed HEAD.** Record scope/TASK_BASE and review artifact; reuse shared isolated validation scripts and fresh Task1 baseline.
- [x] **Step 2 — write real SHA1/SHA256 composition proof.** Use existing explicit synthetic `publicationInput()` authority/history only in tests. Build lexical index bytes and ordinary package files with fixture commit; call public evidence API and explicitly copy ONLY four fields into the base. Concrete complete empty-index seed:

```ts
import { expect, it } from "vitest";
import { readGitPublicationEvidence, preparePublication } from "../index";
import { createGitFixture } from "./git-fixtures";
import { publicationInput, publicationValue } from "./publication-fixtures";

it.each(["sha1", "sha256"] as const)("composes exact %s tree bytes with independent synthetic policy", async format => {
  const f = await createGitFixture(format);
  try {
    const input = publicationInput();
    const lexical = Buffer.from('{\r\n "entries" : [], "formatVersion" : 1\r\n}\n');
    const commit = await f.commit([{ path: input.base.indexPath, bytes: lexical },
      { path: "README.md", bytes: Buffer.from("Inert unrelated file\n") }]);
    const read = await readGitPublicationEvidence({ repository: f.repository, commit, indexPath: input.base.indexPath });
    expect(read.ok).toBe(true); if (!read.ok) throw new Error("Fixture read rejected");
    const e = read.value;
    input.base = { ...input.base, commit: e.commit, indexPath: e.indexPath,
      inventory: e.inventory, indexBase64: e.indexBase64 };
    // catalog/source IDs, enabled state, repository URL and complete synthetic history
    // remain the explicitly supplied fixture assertions, NEVER derived from e.
    const proposal = publicationValue(preparePublication(input));
    expect(proposal.preconditions.inventory).toEqual(e.inventory);
    expect(proposal.preconditions.baseCommit).toBe(commit);
    expect(proposal.preconditions.oldIndex!.base64).toBe(lexical.toString("base64"));
    const indexChange = proposal.changes.find(c => c.path === input.base.indexPath)!;
    expect(indexChange.before!.base64).toBe(lexical.toString("base64"));
    expect(proposal.changes.filter(c => c.path !== input.base.indexPath).every(c => c.before === null)).toBe(true);
    expect(proposal.reviewRequired).toBe(true);
    expect(preparePublication({ ...input, base: { ...input.base, enabled: false } }).ok).toBe(false);
  } finally { await f.dispose(); }
});
```

Run before any corrections and save `task-3-composition-initial`; if already green, explicitly report new integration coverage rather than fabricated RED.
- [x] **Step 3 — extend coherent portable package/history composition.** Export old`echo-skill/1.0.0` with `publicationSkill`, store its proposed files at`packages/echo-skill/1.0.0` and an exact lexical contextual index at the same synthetic commit A. Supply caller-owned synthetic history with immutable identity pinned to A and obtain old snapshot using public `inspectGitPackage` at A. Select `publicationSkill("echo-skill","1.0.1")` with `intent:"update"` and old origin, absent new version directory. Assert unchanged old inventory, old contextual index frozen at A, preconditions exact old bytes/history/source policy, all new version file befores null, new identity revision`proposal`, no Git commit fabrication. Independently repeat exact old release reuse with its immutable supplied snapshot: no package changes. Never construct complete history by scanning only the tree/index; the fixture explicitly declares known synthetic history.
- [x] **Step 4 — test absence and semantic rejection, not laundering.** Both formats: empty root gives indexBase64 null and preparation creates index with before null and requiredAbsentPaths containing explicit index path. Binary `[255,0]`, BOM-prefixed otherwise valid JSON, empty bytes, malformed JSON and structurally invalid index all return exact successful neutral byte evidence but unchanged preparation returns failure with no proposal. Case aliases/special/occupied index fail at acquisition, not null. Nonportable unrelated content or oversized whole tree never yields evidence. Missing/partial history remains Phase6 rejection; denied source/catalog policy and external dependency permissions still fail rather than being supplied by reader. Assert sources/catalogs/history are absent in evidence keys.
- [x] **Step 5 — prove production reads only.** Spy on real spawn after fixture construction: exactly fixed rev-parse then cat-file argv/env in fixture cwd, literal info/contents OID stdin only, both real children closed before public result. Fixture bytes include `.gitattributes`, `.gitmodules`, LFS pointer and inert event module; assert no active `loadSkillMeta`/`loadSkillEventShapes`, no write filesystem primitives, no other spawned commands. Snapshot fixture files/refs before/after calls (test-only read instrumentation) to prove no mutation. Calling pure `preparePublication` after evidence acquisition causes no new fs/spawn calls. Never execute throwing event module as a way to prove inertness.
- [x] **Step 6 — add terminal public lifecycle matrix through actual session/raw reader.** Adapt private `fakeChild`/`processFixture` pattern from existing `git-inspection.test.ts` inside this new test file; use real algorithm-matching commit/tree/blob bodies, only child-process doubles (not fake executable scripts). Test valid+closed, malformed frame, corrupt body, late nonzero finish, abort/timeout during contents/hash/freeze, denied/unreaped kill after valid bytes and after protocol failure, and request exhaustion from repeated ordinary/tree objects. Every finite fault stops requests and confirms close before returning its redacted issue; unconfirmed close returns sole cleanup failure within existing observation behavior, even with original valid data. Assert no settlement until delayed dispose/close, local pipes closed, no console stderr/secret/raw path leakage. Locally close fake children in finally without claiming real OS reaping. Existing lower-level wire ceilings cover exact8192/8193; evidence-facing process fixture must actually hit existing request ceiling with portable repeat objects and no caller-raised budgets.
- [x] **Step 7 — document exact current API and limitations.** In SPEC and contract add the exact public signature, fields, all fixed evidence limits, strict-special unsupported subset, full root-relative paths/empty dirs, SHA256 actual bodies vs Git OIDs, exact lexical index vs semantic parsing, casefold absence, request/occurrence constraints and confirmed cleanup guarantee. Replace statements saying NO Git adapters can supply complete tree/exact bytes with: this new reader supplies only bounded immutable tree/index evidence; configuration/bindings, retained history, live authority remain independently caller-owned. Include a complete synthetic composition example equivalent to Step2 with explicit caller configuration/history, never a fabricated live`complete:true`. Keep old readers' selected scope/semantic/empty-package behavior described separately. Design status may say implemented/tests run but pending task/whole-phase/fresh parent acceptance until those actually occur. No claims of live acquisition, persisted history, installation, publishing, mobile or two-instance completion; Q1/Q2 unchanged.
- [x] **Step 8 — targeted and full final task validation.** `run_targeted task-3-evidence-green packages/skills/src/catalogs/git-publication-evidence.test.ts packages/skills/src/catalogs/git-publication-evidence.integration.test.ts packages/skills/src/catalogs/git-object-reader.test.ts packages/skills/src/catalogs/git-session.test.ts packages/skills/src/catalogs/git-objects.test.ts packages/skills/src/catalogs/git-inspection.test.ts packages/skills/src/catalogs/publication.test.ts`; also run all catalogs tests with `run_targeted task-3-catalogs-green packages/skills/src/catalogs packages/schemas/src/catalogs`. Run shared full task-3-final validation and exact lint comparison; inspect docs signatures against implementation and rerun documented example via an isolated phase-local test/tsx fixture using no services. Save unique reports and raw exits.
- [x] **Step 9 — scoped commit and review evidence.** `git diff --check`; stage only planned test/new-reader correction/docs paths after inspecting exact diff. Commit `test(skills): verify offline publication evidence composition` (includes matching contract docs). Record TASK_BASE/HEAD/full diff/clean index, tests added, commands/results and residual bounded-subset risks. Parent performs fresh task review, full-phase review and independent full verification before declaring acceptance. No writer bypasses these gates or claims publication readiness.
