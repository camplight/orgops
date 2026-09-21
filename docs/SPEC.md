# OrgOps Implementation Spec (Current)

## Goal

OrgOps is a Node.js multi-host system where humans and agents collaborate through an event bus persisted in SQLite. Agents can execute shell/filesystem/process tools, emit typed events, and stream process output to API/WebSocket clients.

This document describes the current implementation in this repository.

## Stack

- Runtime: Node.js (monorepo, npm workspaces)
- API: Hono + `@hono/node-ws`
- DB: SQLite + Drizzle ORM
- Realtime: WebSocket topic pub/sub via in-process event bus
- UI: React apps for admin and lightweight user workflows
- LLM wrapper: `@orgops/llm` (`generate()` abstraction)
- Schemas/validation: Zod-based event shapes in `@orgops/schemas`

## Monorepo Layout

```text
apps/
  api/            Hono HTTP + WS server
  agent-runner/   Agent polling loop + tool/runtime execution
  opscli/         Host bootstrap/maintenance CLI (deterministic commands + optional chat)
  admin-ui/       React + Tailwind admin UI
  user-ui/        Lightweight user UI
packages/
  crypto/         Secret encryption/decryption helpers
  db/             Drizzle schema + SQLite migrations
  event-bus/      In-process pub/sub
  llm/            Provider/model wrapper
  schemas/        Event schema registry + validators
  skills/         Skill discovery and loading
skills/           Built-in skills (SKILL.md, optional event-shapes.ts)
files/            Uploaded file storage
.orgops-data/     Runtime DB/workspaces/soul files
```

## Core Data Model

### Agents

Stored in `agents`:

- identity/config: `id`, `name`, `icon`, `description`, `model_id`
- prompting/runtime config: `system_instructions`, `soul_path`, `soul_contents`
- workspace/safety: `workspace_path`, `allow_outside_workspace`
- per-agent runtime tuning: `llm_call_timeout_ms`, `classic_max_model_steps`, `context_session_gap_ms`, `emit_audit_events`, `memory_context_mode`
- mode/state: `mode` (`CLASSIC` | `RLM_REPL` | `WRAPPED`), `desired_state`, `runtime_state`, `last_heartbeat_at`
- host assignment: `assigned_runner_id` (nullable; when set, only matching runner executes the agent)
- skills: `enabled_skills_json`, `always_preloaded_skills_json`
- bounded configuration concurrency: `revision` (`1..2147483647`), incremented by assignment-relevant configuration changes but not heartbeat-only updates
- wrapped runtime config: `wrapped_config_json` (JSON object; used only by `WRAPPED` mode)

`WRAPPED` agents are orgops-owned lifecycle records whose turns are delegated to an external runtime. They do not use orgops memory summaries, prompt composition, skills, model calls, or `allow_outside_workspace` for turn handling. The wrapped runtime owns its own session/memory/tool state and filesystem policy. The normal `soul_path` / `soul_contents` fields may still be stored on the agent row for humans, opscli, and native management agents; the wrapper runner does not automatically inject them. The creator of the wrapped agent should translate those native fields into the selected harness configuration/setup/runtime behavior when that harness needs a soul file or prompt seed.

Example wrapped config:

```json
{
  "kind": "openclaw",
  "harness": "command",
  "source": {
    "type": "github",
    "repo": "openclaw/openclaw",
    "ref": "main",
    "updateOnStart": false
  },
  "setup": {
    "checkCommand": "test -d node_modules",
    "command": "npm install && npx openclaw setup && npx openclaw models set openai/gpt-4o-mini",
    "timeoutMs": 600000
  },
  "sidecars": [
    {
      "name": "gateway",
      "command": "npx openclaw gateway --force",
      "restart": true,
      "restartDelayMs": 2000,
      "timeoutMs": 0
    }
  ],
  "runtime": {
    "command": "npx openclaw agent --agent main --session-id \"$ORGOPS_WRAPPED_SESSION_ID\" --message \"$ORGOPS_WRAPPED_MESSAGE\" --json",
    "parse": "json-payloads",
    "timeoutMs": 600000
  },
  "secrets": {
    "allowedKeys": ["OPENAI_*", "TAVILY_API_KEY"],
    "deniedKeys": ["TAVILY_*"]
  },
  "session": {
    "scope": "per-channel"
  }
}
```

Supported recipe fields:

- `kind`: human/discovery label such as `openclaw`, `codex`, or `custom`.
- `harness`: implementation boundary used by the runner. Default is `command`; `cli` is accepted as an alias for `command`.
- `source`: optional checkout source. `type: "github"` with `repo` clones into the agent workspace under `wrapped-sources/`; `path` can point to an existing local source checkout.
- `setup.checkCommand`: optional command; exit code `0` skips setup.
- `setup.command`: optional idempotent setup/install command.
- `sidecars`: optional long-running commands started before turns, such as the OpenClaw Gateway.
- `runtime.command`: required command for handling a turn.
- `runtime.parse`: `json-payloads` extracts OpenClaw-style `payloads[].text`; `text` returns stdout; omitted tries JSON payloads and falls back to text.
- `secrets.allowedKeys`: optional env-key allowlist (exact keys or `*` wildcard patterns) applied to wrapped secret injection.
- `secrets.deniedKeys`: optional env-key denylist (exact keys or `*` wildcard patterns) applied after allowlist.
- `session.scope`: `per-channel` (default) or `per-agent`.

OpenClaw is an optional wrapped runtime and is not installed as an OrgOps dependency. A recipe must install it in the agent workspace during `setup` or provide an OpenClaw source checkout. OpenClaw recipes should configure the target agent's default model during setup rather than relying on OpenClaw package defaults. Runtime `--model` overrides are subject to the target agent's model allowlist and may be rejected unless setup has added that model first.

**Breaking-change migration:** existing OpenClaw wrapped agents that relied on OrgOps' root installation must update their stored `wrappedConfig` before upgrading. Add an explicit setup in the same directory used by the sidecar and runtime commands:

```json
{
  "setup": {
    "checkCommand": "test -x node_modules/.bin/openclaw",
    "command": "npm install --no-save openclaw@<version>",
    "cwd": ".orgops-data/workspaces/<agent-name>/wrapper",
    "timeoutMs": 600000
  }
}
```

Replace `<version>` with the OpenClaw version the agent should run. Agents whose recipes already install OpenClaw locally or use an OpenClaw source checkout do not require migration.

Commands run with the agent workspace/source directory as cwd unless overridden and receive environment variables:

- `ORGOPS_PROJECT_ROOT`
- `ORGOPS_WRAPPED_AGENT_NAME`
- `ORGOPS_WRAPPED_KIND`
- `ORGOPS_WRAPPED_WORKSPACE_PATH`
- `ORGOPS_WRAPPED_CHANNEL_ID` (turn commands)
- `ORGOPS_WRAPPED_SESSION_ID` (turn commands)
- `ORGOPS_WRAPPED_MESSAGE` (turn commands)
- `ORGOPS_WRAPPED_TRIGGER_EVENT_ID` (turn commands)
- `ORGOPS_WRAPPED_SOURCE_DIR` (when a source checkout is configured)

Resolved runtime secrets are injected into setup and turn command environments using precedence `private > team > public > package(legacy)`.

Wrapper harness implementation:

- Runner orchestration lives in `apps/agent-runner/src/wrapped-runtime.ts`.
- Harness contracts live in `apps/agent-runner/src/wrapper-harness/types.ts`.
- Built-in harness registration lives in `apps/agent-runner/src/wrapper-harness/registry.ts`.
- The default command recipe implementation lives in `apps/agent-runner/src/wrapper-harness/command.ts`.

Harnesses implement:

- `canHandle(config)`: decide whether a normalized `wrappedConfig` belongs to this harness.
- `ensureReady({ ctx, agent, config })`: detect/install/setup/start lifecycle prerequisites.
- `runTurn({ ctx, agent, config, events, triggerEvent, channelId, message, sessionId })`: send a turn to the external runtime and return normalized output.

Future SDK, HTTP, WebSocket, daemon, or MCP runtimes should add harness modules rather than expanding `wrapped-runtime.ts`. The command harness remains the portable fallback for repo-generated wrappers and simple CLI agents.

### Runner Nodes

Stored in `runner_nodes`:

- identity: `id`, `display_name`
- host metadata: `hostname`, `platform`, `arch`, `version`, `metadata_json`
- lifecycle: `created_at`, `updated_at`, `last_seen_at`

Runner IDs are stable across restarts by persisting local `.agent-runner-id`.

### Collaboration

- `humans`: login users, password hash, `must_change_password`, persisted `is_admin` (non-null 0/1, default 0), inviter metadata
- `teams`, `team_memberships`
- `channels`: includes `kind`, optional `metadata_json`, optional `direct_participant_key`
- `channel_subscriptions`: channel participants/subscribers (`AGENT`, `HUMAN`, `TEAM`)
- `channel_viewers`: read-only channel shares (`AGENT`, `HUMAN`)
- `channel_share_links`: tokenized invite links that let an authenticated human self-claim read-only access
- `conversations`, `threads`

### Events and Delivery

- `events`: append-only event log (`type`, `payload_json`, `source`, `channel_id`, `deliver_at`, `status`, failure counters, idempotency key)
- `event_receipts`: per-agent delivery state (`PENDING`/`DELIVERED`) used by runner polling

### Memory Summaries

- `channel_memory_recent`, `channel_memory_full`
- `cross_channel_memory_recent`, `cross_channel_memory_full`

### Processes / Files / Secrets / Models

- `processes` (includes `execution_mode` and process state fields), `process_output`
- `files`
- `secrets`
- `models`

### Agent Invites / Runner Tokens

- `agent_invites`: wrapped-agent bootstrap invites (hashed token, optional scoped channel set, invite-time agent visibility, creator metadata for human/agent callers, optional wrapped config, expiry, usage count)
- `runner_tokens`: hashed runner credentials, including invite-scoped tokens bound to a single `agent_name` and `runner_id`

## Inert Catalog Package Contract

`@orgops/schemas` exports strict version-1 package manifests and catalog indexes,
exact dependency/identity and portable wrapped-recipe schemas, bounded JSON/object
parsers and `CATALOG_LIMITS`. `@orgops/skills` exports `parseSkillDocument`,
`computePackageDigest`, `inspectPackage`, `resolvePackages`, `exportAgentPackage`
and `exportSkillPackage`, with their named input/result types. See
[`catalog-package-contract.md`](catalog-package-contract.md) for exact signatures,
bounds, serialization, source/caller contracts and inspected complete examples.

These synchronous functions consume caller-supplied JSON and staged base64 entries
only. Inspection validates portable paths, ordinary-file inventory, inert SKILL.md
frontmatter and declared executable content without importing event-shape modules.
SHA-256 covers canonical semantic manifests and actual content inventory. Detached,
recursively frozen snapshots expose full file bytes, API/runner execution previews,
all wrapped commands/args and supplementary sensitive-text/manual-review warnings.
Warnings do not certify safe publication or execution.

Resolution checks explicitly permitted/enabled supplied catalog and package sources,
exact version/commit/digest identity, declared compatibility, bounded dependency
ordering/cycles and global skill-name conflicts. Known release mappings cannot
silently change. Reuse requires matching pinned identity and caller-measured current
content digest; the library does not inspect installed disk. Contextual catalog
releases avoid circular Git hashes; subsequent index edits must freeze historical
entries to their original exact package commits while retaining current catalog
commit provenance.

Agent export positively selects camelCase API fields and explicit author options,
not DB rows or live state. Native CLASSIC/RLM templates retain intended instructions,
soul, portable tuning, explicit model suggestions and exact skill pins; RLM exports
omit dormant classic tuning without mutating the source. Selected skill packaging
has no default-all, rejects links and known selected local-state/credential paths,
and returns a full proposed-file preview including normalized `orgops-package.json`.
Wrapped export supports command-only `resourceWiring: "none"` recipes: no native
resource injection, packaged files/dependencies or model suggestions. Native prompt,
soul and tuning are ignored for wrapped export because the harness does not consume
them. This is the Phase-2 subset, not a permanent full-v1 exclusion of wrapped
resources; positive wiring requires a subsequent explicit adapter/format contract.
Wrapped source refs and arbitrary commands are not transitively pinned or sandboxed.

### Offline import preparation (conditional review only)

`@orgops/skills` explicitly exports synchronous
`prepareImport(input: ImportInput): ImportResult<ImportPreview>`, frozen
`IMPORT_LIMITS` and the named public Import types. See the
[exact types, limits and runnable synthetic example](catalog-package-contract.md#offline-import-preparation).
Private validation/composition/source-policy helpers and fixtures are not root exports.
Existing inspection/export/resolution and active discovery APIs remain unchanged.

A trusted caller supplies one exact root, independent canonical source bindings and
effective policy, immutable catalog/package snapshots, target, retained known releases
and complete relevant local skill namespace evidence. The shared metadata-only
publication/import precheck distinguishes catalog trust from independent external-location
and cross-source-pin allowPackages permission before deduplication; only then does the
unchanged exact resolver run once. No source union, registration or fetching is inferred.

`installed.complete:true` asserts every occupied immediate child across all relevant
API/runner skill locations, not `listSkills()` results. Stable equal required copies
may be independently measured; unmanaged/non-directory/divergent/unknown occupancy
must be occupied. The library checks supplied bytes, not actual disk completeness,
stability, host coverage or origin authenticity. Measured local trees include exact
current root manifest bytes and executable modes plus separately recorded origin;
no caller currentDigest is accepted. Actual manifest parsing/content reinspection
produces the current digest used for exact pinned reuse. Selected occupied/edited/
uninspectable names conflict without overwrite; unrelated local edits stay inert.
Strict malformed evidence or any limit overflow rejects the whole request. Semantic
manifest whitespace/key-order equivalence preserves exact lexical local bytes.

The detached frozen preview retains complete dependency-first include/reuse packages,
exact direct edges/identities, each full portable template and separate requirements,
all bytes/modes and regenerated inspector execution/warnings. Includes label their
generated normalized root manifest `normalized-package-manifest`, not an upstream
lexical blob; reuse labels exact local bytes `current-installed-manifest`. Valid native
auxiliary content is retained. Binary remains full base64 and explicitly unscanned;
wrapped resourceWiring:none stays the existing inert subset, not full v1 wiring.
Warnings supplement review, not a scanner safety/approval policy; no preview checksum
is added. `reviewRequired:true`, `authority:"none"` never confer a capability.

Descriptor JSON validation and all occurrence/count/encoded-byte preflights precede
expensive content work. Submitted/canonical input, full private validated representation
(including duplicated local review bytes) and final output have separate 64MiB JSON
ceilings, incrementally charged before retention and independently finally checked.
All input file occurrences total at most 8192/32MiB; output review files independently
at most 8192/32MiB, including generated roots. Existing per-file/manifest/schema caps
and regenerated warning/execution caps apply. Bounds fail with one fixed redacted
issue and no partial output/truncation. These are not a Proxy/native-OOM or single-copy
heap sandbox. Sensitive authored review content must not be logged.

No filesystem/process/network/DB/configuration/credential reads or writes, clock/random
authority, package module evaluation, binding, approval, installation or activation
occurs. Standalone skill review never enables existing agents. Future orchestration
must remeasure live content/occupancy, enforce live human admin/source policy, bind
local name/runner/workspace/model and secret REFERENCES, verify API/runner placement,
obtain explicit activation approval, create stopped agents and enforce requirements
at every start. API event-module activation requires separate approval even with
stopped agents; wrapped commands/setup/checks/sidecars wait for explicit start and
are not sandboxed by native allowlisting. The full-install/missing-secret save rule
is neither implemented nor certified here. Live acquisition, import UI, installation,
two-instance acceptance and Q1/Q2 remain deferred. Phase 8's task/whole-phase reviews
and independent parent verification are complete: 1937 Vitest tests/50 files,
3 opscli tests, and all twelve workspace lints with exactly the unchanged 488 baseline
diagnostics (API486/runner2; ten clean workspaces). Only this offline slice is accepted.

### Offline local skill-root evidence

`@orgops/skills` explicitly exports asynchronous
`readLocalSkillEvidence(input: LocalSkillEvidenceInput, options?:
LocalSkillEvidenceOptions): Promise<LocalSkillEvidenceResult<LocalSkillEvidence>>`,
frozen `OFFLINE_LOCAL_SKILL_LIMITS` and the named public Local types. The complete
exact types/limits, fixed issue pointers, budgets and runnable owned synthetic
acquisition example are in the
[offline contract](catalog-package-contract.md#offline-local-skill-root-evidence).
The private ownership path, reader/record types and test fixture factory are not root
exports; existing discovery, inspection, export, resolution, publication, Git and
import APIs remain unchanged.

The adapter observes exactly ONE explicitly supplied trusted, quiescent local skill
root: it enumerates that root's entire immediate occupied namespace (ordinary files,
unmanaged or malformed directories, links and special entries as bodyless blocked
occupancy; no SKILL.md filtering and no active discovery) and reads complete
subtrees only for explicitly nominated ordinary child directories, preserving exact
bytes and executable bits, lexical root-manifest bytes included. Nominations match
exact case; casefold aliases are unsafe, and absence of a nominee is bound to this
one root only by the preserved nominations and full namespace. Output is detached,
recursively frozen and neutral: no origin, source/catalog identity, digest, actor,
time, approval, runnable, installed or all-host authority fields exist. Origins,
relevant-host reconciliation and all-location completeness stay with the caller; a
matching tree without an independently retained origin is occupied, and the caller
composes `ImportInstalledEntry` values for the unchanged synchronous `prepareImport`.

The caller must control the root and traversed ancestors and exclude all concurrent
writers: this is offline trusted quiescent storage, not a TOCTOU sandbox or mutable
active-root scan. Metadata rechecks (fingerprints, path/handle postchecks, exact-byte
EOF and growth probes) detect known changes but create no atomic snapshot and prove
no ancestor or mount containment; ordinary reads may change atime. One private
ownership path bounds work cooperatively (10000ms deadline, checkpoints only — no
hard wall-clock or OS-cancellation promise), keeps at most two live handles, never
races pending acquisition, awaits every close, and treats unconfirmed closes as
terminal cleanup failure overriding any pending outcome. Fixed ceilings cover path,
name, count, byte, depth, output, call (350000), work and yield budgets; all maxima
are ceilings, not combination guarantees, and no native heap or kernel-syscall
sandbox is claimed. Failures are one fixed redacted `{code,at}` with no host path or
authored bytes. No write, chmod, lock, snapshot, subprocess, network, DB,
configuration, credential or module evaluation occurs in production code.

Phase 9's task/whole-phase reviews and independent parent verification are complete:
2095 Vitest tests/53 files, 3 opscli tests, all twelve workspace lints with exactly
the unchanged 488 baseline diagnostics (API486/runner2; ten clean workspaces),
byte-identical root lint, and the executed public synthetic `.mts` example. Only this
bounded offline local-evidence adapter is accepted; live acquisition, installation,
activation and two-instance acceptance remain deferred.

### Offline publication preparation (pure, not publishing)

`@orgops/skills` exports synchronous
`preparePublication(input: PublicationInput): PublicationResult<PublicationProposal>`,
its named Publication types and frozen `PUBLICATION_LIMITS`. The complete signatures,
limits and tiny in-memory example are in
[the publication contract](catalog-package-contract.md#offline-publication-preparation).
This is the Phase-6 pure subset of publication preparation; task tests cover it,
while task/whole-phase review and fresh parent acceptance remain separate gates.

A trusted caller supplies one explicitly enabled catalog/base repository at an exact
commit, selected index path and exact lexical old bytes (or proven absence), complete
bounded repository inventory and retained release history, independent source policy,
allowlisted export candidates, explicit destinations/intents/origins, immutable
package/dependency evidence and target. The library checks internal consistency,
not authentication or live authority. `readGitPublicationEvidence` supplies bounded
complete tree and exact lexical index evidence only; configuration/bindings, retained
history and live authority remain independently caller-owned. The older selected
package/index inspection adapters do not supply this complete evidence contract.
Missing/partial evidence fails, never becomes an absence assertion.

Preparation re-exports all candidates through existing allowlists, freezes every old
contextual release at its owning base commit and resolves all selections together
through the unchanged exact-pin resolver. Reached external locations/cross-source
pins independently require enabled allowPackages policy, even for catalog owners.
New releases use absent directories only; exact immutable reuse requires matching
supplied bytes and complete current subtree/modes. No replacement of package trees,
deletion or rename is emitted. Only the explicit ordinary nonexecutable index may
be replaced. Changed content needs a new version; recorded origins are retained for
updates, and different namespaces require explicit new-destination intent. No source
registration, permission inference, ownership transfer or dependency substitution.

The detached recursively frozen result exposes exact before/after bytes, size,
SHA256 and executable bit for every changed file, proposed index, dependency-first
complete snapshots, preserved identities and exact revalidation preconditions.
New identity provenance says proposal, not a fictitious Git commit; old identities
remain exact. The deterministic domain-separated SHA256 proposalDigest binds the
entire result except itself, including lexical before bytes, policy/history, origins,
execution previews and supplementary findings. It is not authorization.

Full human review remains required with zero findings. Fixed supplementary token,
private-key-header and credential-assignment rules report at most one warning per
rule/file side, with path/side and 1-based Unicode-code-point locations, no excerpts
or matched values. Fatal UTF8 binary sides remain exact base64 and explicitly
unscanned; no lossy repair or automatic redaction. Bounds fail without partial output
or truncated scans. Review artifacts intentionally may contain sensitive authored
bytes and must not be logged. Findings neither grant nor deny future submission.

There is no filesystem/DB/network/process I/O, credential retrieval, package execution,
approval, activation or publishing in this operation. A future publisher must acquire
complete evidence and revalidate base/index/modes, occupied/absent paths, retained
history, current source bindings/policy and live human/destination write authority.
Changed evidence requires a fresh proposal, never automatic rebase. Live evidence
acquisition/persistence, confirmation, GitHub branch/PR submission, uncertain-result retry
reconciliation, remote transport and two-instance acceptance remain unimplemented.
Q1 transport policy and Q2 shared-shell mobile follow-up are unchanged.

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

A complete owned synthetic composition example is in
[the evidence contract](catalog-package-contract.md#synthetic-git-to-publication-composition).

### Offline exact Git inspection adapters

`@orgops/skills` now additionally exports async `inspectGitPackage` and
`readGitCatalogIndex`, their named OfflineGit input/result types and fixed
`OFFLINE_GIT_LIMITS`. They perform explicitly local I/O against a trusted absolute
installed Git binary and stable administrator-provisioned bare object storage, not
source acquisition. Exact lowercase full SHA1/SHA256 commits only; package `path`
is a nonroot directory, and `indexPath` is required with no default filename.
Own data-property inputs are validated/snapshotted before I/O. Index and package
successes are detached recursively frozen data; no authority fields are manufactured.
The existing synchronous pure functions and export allowlists remain unchanged.

The [offline contract](catalog-package-contract.md#offline-exact-git-inspection-explicit-async-io)
specifies the public signatures/error union, strict byte-exact bare config templates,
fixed bounded metadata preflight, all budgets and complete caller composition example.
No ordinary clone/developer checkout/indirection, extra config, alternates or promisor
storage is accepted. Only POSIX linux/darwin process lifecycle is initially supported,
without changing portable package platform schemas. Two sequential fixed rev-parse/
cat-file children use constant isolated environment and literal OID requests; no
network, credentials/helpers, checkout/extraction, filters, package code or active
skill discovery. Every contents response is rehashed against its exact Git identity.

Complete selected-subtree metadata and blob sizes pass before any package blob read.
Unsafe/colliding paths, noncanonical modes, symlinks/gitlinks and empty child trees
reject. Root manifest and explicit index must be ordinary non-executable 100644
blobs; content executable bits and all binary/script/LFS/attribute bytes are retained
inertly. Fatal UTF-8 preserves BOM for JSON rejection. Existing semantic errors pass
through, while offline failures use fixed redacted pointers and no partial values.

One 10000ms monotonic operation budget includes semantic inspection; the additional
250ms cleanup observation allowance never authorizes more work. Failures kill owned
POSIX groups and await reaping; even valid bytes cannot succeed after finish failure.
Unconfirmed cleanup overrides other errors as GIT_CLEANUP_FAILED: do not blindly
auto-retry; operator/process supervision may be needed. Git decompression and kernel
or synchronous work are not precisely preemptible; bounds are not an OS memory sandbox,
absolute liveness guarantee, authenticated provenance or protection from malicious
host assets. Each concurrent call owns its own budget; higher-level scheduling remains
future work. The read-only live GitHub synchronization slice below discharges
bounded fetch transport, Q1 destination policy and read-credential handling for
catalog indexes only; remote authority revalidation, retained cross-sync history,
installed-content measurement, installation/activation/start, publishing and
discovery/import/publishing UI obligations remain undischarged; the existing
configuration UI is described next.

## Source Library schema cutover and Catalog compatibility

Migration 034 replaces the split migration-032 Catalog configuration model with the
canonical Source Library schema. It creates the 17 canonical Source, credential,
sync/snapshot/release, review/grant/install/activation, assignment/rollout, and
runner-deployment tables declared in `packages/db/src/schema.ts`. Mutable rows use
revisions constrained to `1..2147483647`; booleans, states, failure/reason codes,
and authorization provenance are database-checked. Bounded JSON columns are checked
for valid JSON and byte size. Partial uniqueness prevents concurrent Source syncs,
duplicate live grants, and multiple live deployments for one agent.

The migration renames migration-032 `catalog_sources`, `catalogs`, and
`catalog_read_credentials` to `catalog_sources_legacy_032`,
`catalogs_legacy_032`, and `catalog_read_credentials_legacy_032`. It retains those
archives and every migration-033 `catalog_installed_origins` row. Only joined
Catalog rows are backfilled. Canonical repository identity is unique together with
ref, so Catalogs sharing one legacy Source at distinct refs become separate Sources.
Exact duplicate repository-plus-ref Catalogs deterministically coalesce under the
lexicographically smallest Catalog ID; every original Catalog row and installed
origin remains in its archive for Task 17 reconciliation. Source-only rows remain
archived because migration 034 does not invent a ref. Credential ciphertext is
copied byte-for-byte once per resulting Source to
`catalog_source_read_credentials`; `legacy_binding_source_id` and
`legacy_credential_ref` preserve the old envelope binding for later compatible
reads. Migration performs no credential decryption, master-key access, filesystem,
network, Git, or random work.

The old configuration and sync services are no longer constructed by the app.
The former `/api/catalogs` compatibility response (HTTP 410 with
`CATALOG_RESOURCE_RETIRED`) was a completed one-release migration window. Its shim
and mutable Catalog proxy are now removed; the root and every descendant use the
framework-default, principal-independent HTTP 404 with no retirement body or
special cache handling. Migration 034 retains no mutable Catalog proxy.

### Source authority and synchronization

The API composition root constructs one `CatalogAuthority` over the canonical tables.
It owns Source create/patch/remove/restore, Source-scoped read-credential replacement
and revocation, optimistic revisions, sync attempts, immutable snapshots/releases,
and Source metadata queries. Repository identity and selected ref never mutate;
removal reserves them, deletes the read credential, disables the Source and clears
external-package permission. Restoration keeps the identity reserved and returns the
Source disabled without a credential or package permission. Metadata results expose
only `hasReadCredential`; they never select or return ciphertext, plaintext, or a
credential reference.

Every control mutation and its channel-less typed audit row are written by one short
immediate SQLite transaction. The audit writer must run inside that transaction; a
write failure rolls back the control mutation. WebSocket publication occurs only
after commit and does not create agent receipts. A live human administrator check is
performed inside each mutation transaction, rather than trusting session-cached
administrator state.

A Source sync persists a unique `RUNNING` attempt before doing Git work. Fetch,
offline index/package inspection, exact-ref promotion, and staging cleanup all run
without an open SQLite transaction. Acquisition is restricted to the configured
GitHub HTTPS Source, its Source-bound encrypted read credential, and the fixed
`catalog/index.json`; inspection uses the existing bounded offline Git readers and
never evaluates package modules or runs authored commands. Before promotion and
again in the final immediate transaction, the authority compares every known
`(authoritySourceId,name,version)` release and rejects any changed immutable content
or provenance. The final transaction rechecks current administrator authority,
Source revision, and repository/ref binding, then inserts or reuses the exact
snapshot/releases, creates pending review controls, advances `current_snapshot_id`,
finishes the attempt, and writes its audit. Publication follows commit.

Fetch, inspection, identity, promotion, final-transaction, or cleanup failure completes
the attempt with a fixed redacted failure code and never changes the current snapshot.
Previously persisted snapshots, releases, review state, installations, activations,
and agent state remain intact. Credential plaintext exists only while decrypting the
selected Source credential for the sanitized Git fetch environment; it is not passed
to inspectors, audits, results, runners, URLs, arguments, mirror configuration, or
logs.

All Source routes authenticate first and then perform a fresh persisted-human
administrator check. Ordinary humans, global and invite-scoped runners (including a
runner request that also carries an administrator cookie) receive 403; anonymous
requests receive 401. Reads and mutations are both administrator-only. Every response,
including authentication, validation, authority, and not-found responses, carries
`Cache-Control: no-store`.

| Method | Route | Strict body | Success |
|---|---|---|---|
| `GET` | `/api/catalog-sources` | none | Source metadata list |
| `POST` | `/api/catalog-sources` | `{sourceId,displayName,repository,ref,enabled,allowPackages}` | `201`, Source plus immediate sync-attempt result |
| `GET` | `/api/catalog-sources/:sourceId` | none | Source metadata |
| `PATCH` | `/api/catalog-sources/:sourceId` | `{expectedRevision,displayName?,enabled?,allowPackages?}` | updated Source |
| `DELETE` | `/api/catalog-sources/:sourceId` | `{expectedRevision}` | removed Source |
| `POST` | `/api/catalog-sources/:sourceId/restore` | `{expectedRevision}` | restored, disabled Source |
| `PUT` | `/api/catalog-sources/:sourceId/read-credential` | `{expectedRevision,kind:"https-basic",username,password}` | Source metadata only |
| `DELETE` | `/api/catalog-sources/:sourceId/read-credential` | `{expectedRevision}` | Source metadata only |
| `POST` | `/api/catalog-sources/:sourceId/sync` | `{expectedRevision}` | Source plus completed attempt |
| `GET` | `/api/catalog-sources/:sourceId/sync-attempts` | none | redacted attempt list |
| `GET` | `/api/catalog-sources/:sourceId/snapshots` | none | immutable snapshot metadata list |

### Immutable release discovery and review

A successful sync creates exactly one `catalog_release_controls` row for each newly
discovered immutable release. Its initial state is `PENDING`, revision 1, with no
review digest or reviewer. Re-observing the same immutable release reuses that row.
Pending and other hidden release metadata is available only through the administrator
release routes; it is never added to a regular-human library projection by discovery.

Release review is a separate control from installation and API execution approval.
The complete state machine is `PENDING -> APPROVED|REJECTED`,
`APPROVED -> WITHDRAWN`, and `REJECTED|WITHDRAWN -> PENDING` through explicit
reopen. Every command carries the current control revision, exact immutable release
digest, and a SHA-256 review digest. Approval or rejection records the submitted
review digest. Withdrawal and reopen must echo the currently recorded review digest;
reopen clears the digest and reviewer as the release returns to pending. A stale
revision, release-digest mismatch, or current review-digest mismatch is
`REVISION_CONFLICT`; a disallowed transition is `STATE_CONFLICT`.

Review mutation and `audit.catalog.release.reviewed` insertion share one immediate
transaction with a fresh live-human administrator check. Audit publication occurs
only after commit. Review never writes an installation, changes API activation,
executes package content, or mutates release/snapshot provenance.

### Exact inert package installation

`PackageInstallation.installExact` accepts one canonical release ID plus the exact,
ordered transitive dependency release IDs. Every release must still be approved and
must retain its reviewed immutable identity. The installer reuses the unchanged
format-v1 Git inspection, local evidence, and import-resolution adapters to verify
kind, native mode, package path, file/mode/size limits, semantic digest, source policy,
closure identity/order, and local namespace occupancy before claiming output.

All package kinds are installed inertly: SKILL, native `CLASSIC`, native `RLM_REPL`,
and `WRAPPED`. Installation never loads authored event-shape modules, runs native or
wrapped setup/runtime commands, starts a process, accesses a Source credential or the
master key, creates an agent, assigns a skill, changes API activation, or changes a
runner generation. The success result therefore always includes `activated:false`.
Release approval alone remains neither installation nor execution authority.

New content is populated with exclusive file creation in an operation-owned staging
directory under the API artifact root, completely remeasured, and promoted without
replacement into `<artifact-root>/<package-name>/<sha256>`. Existing exact installs
are reusable only when the installation provenance binding and every current
path/byte/mode/size/digest still match; missing/extra files, links, special entries,
mode drift, origin drift, or mutation fail closed. Cleanup removes only staging and
namespace targets claimed by the failing operation and never pre-existing or
concurrently claimed content.

All installation rows, migration-033 format-v1 skill origins, the completed operation
row, and the typed `audit.catalog.installation.changed` event are written last in one
immediate transaction after a fresh live-human administrator check and exact equality
of the captured approval revision and review digest. Skill origins map format-v1
`catalogId` to the authority Source and `sourceId` to the content Source, retaining
both commits, package path, name, version, digest, local artifact binding, actor, and
time. Native and wrapped packages have canonical installation rows but do not invent
rows in the skill-only format-v1 origin table. Reuse requires the complete applicable
origin binding, including exact equality of its original actor/time with the canonical
installation row, as well as filesystem remeasurement; it is not rebound to the
requesting administrator. Audit or
transaction failure rolls back every success-path database write and removes this
operation's newly claimed filesystem targets. A post-validation failure is recorded
separately as a typed `FAILED` operation and failed audit when that final failure
transaction can itself commit; audit/storage failure rolls that record back rather than
fabricating history. Filesystem/SQLite crash windows can leave reconcilable orphan staging or
claimed content, but never justify overwrite or a false installed result.

`PackageReleaseView` contains the immutable authority/content Source IDs, kind, name,
version, release digest, catalog/package commits and package path; the canonical
manifest; execution preview (API event-shape modules, runner scripts, wrapped
commands, and external sources); warnings; file path/mode/size/digest inventory;
review state/digest/reviewer/revision; installation state; and API activation
approval/runtime/revision/failure state. It never includes file bytes, artifact host
paths, credentials, secrets, repository authorization, or executable content.

| Method | Route | Strict body | Success |
|---|---|---|---|
| `GET` | `/api/catalog-releases` | none | complete administrator release list |
| `GET` | `/api/catalog-releases/:packageReleaseId` | none | complete immutable release detail |
| `POST` | `/api/catalog-releases/:packageReleaseId/approve` | `{expectedRevision,digest,reviewDigest}` | approved release detail |
| `POST` | `/api/catalog-releases/:packageReleaseId/reject` | `{expectedRevision,digest,reviewDigest}` | rejected release detail |
| `POST` | `/api/catalog-releases/:packageReleaseId/withdraw` | `{expectedRevision,digest,reviewDigest}` | withdrawn release detail |
| `POST` | `/api/catalog-releases/:packageReleaseId/reopen` | `{expectedRevision,digest,reviewDigest}` | pending release detail |
| `POST` | `/api/catalog-releases/:packageReleaseId/install` | `{dependencyReleaseIds}` | exact package actions plus `activated:false` |

Release reads and actions use the same `requireAuth` then fresh `requireAdmin`
ordering as Source routes. Ordinary humans, global runners, scoped runners, and
anonymous callers cannot browse, review, or install releases. Every release response
carries `Cache-Control: no-store`.

### Explicit API event-shape approval and activation

Release review, inert installation, API execution approval, and runtime activation are
four separate authorities. Discovery, sync, review, installation, library/template
consumption, assignment, and runner deployment never import catalog event-shape code
or change API validation. A release without declared API event-shape executables is
`NOT_REQUIRED/INACTIVE`; approve and activate reject it with `STATE_CONFLICT` without
loading code. A release with such executables begins logically as
`AWAITING_APPROVAL/INACTIVE`. Approval persists the exact command/release digest in
`approved_digest`, binds the expected activation revision, writes `APPROVED`, and does
not import code. Migration 039 binds a valid legacy approval to its immutable release
digest only when its approver is a bounded ID, its approval time is a nonnegative safe
integer, and its runtime/failure fields are exact. Any malformed legacy approval is
made safely `REVOKED/INACTIVE` with approval and failure fields cleared. Database
checks require the complete approval triple and require `APPROVED` for `ACTIVATING`,
`ACTIVE`, and `DEACTIVATING`.

Activation requires current enabled Source permission, `APPROVED` release review,
`APPROVED` API execution, and an exact `INSTALLED` digest. An immediate transaction,
with a fresh live-human administrator check, writes the guarded `ACTIVATING` revision.
The API then completely remeasures canonical artifact/install roots and inventory,
rejecting symlink components, hard links, special entries, case-fold collisions, and
mode/size/digest drift. Declared files are opened no-follow, fstat/read once and
rechecked on the same handle. The verifier returns immutable base64 captures with
release/path/digest identity; production evaluates only those captured bytes, never a
pathname. TypeScript is deterministically transformed to CommonJS after syntax-tree
inspection. The only permitted module specifier is the exact static import `zod`,
resolved through a recursive capability membrane to the host's trusted copy. Relative,
absolute, URL, host-module, dynamic imports, re-exports, import-equals, authored
`require`, computed access, dangerous constructor/prototype access, and host globals
are rejected before evaluation. The transformed CommonJS runs with a timeout in a new
null-prototype `node:vm` context whose string/Wasm code generation is disabled and
whose only host capabilities are controlled export objects and the exact-`zod`
synthetic require. Source/output size and export-count bounds apply. This VM is defense
in depth for explicitly approved privileged code, not a perfect same-process hostile
code sandbox; the enforced contract is that no host capability or undeclared import
graph is exposed. The module cache key includes release ID, release digest, declared
path, and captured file digest.

Imported definitions are strictly bounded and normalized to
`source=skill:<immutable-package-name>`; authored source claims cannot spoof it. Every
definition is rebuilt from own data descriptors and examples are bounded
cloned/frozen. Catalog schemas must be actual membrane-unwrapped trusted Zod schemas.
Activation accepts only the documented JSON-Schema-faithful subset: strings with
length bounds, bounded/integer numbers, booleans, null, JSON literals/enums,
objects (including strict/passthrough policy and schema catchalls), arrays, optional and
nullable values, unions/discriminated unions, records, tuples, intersections, and
any/unknown/never. Default strip-mode objects, coercion, effects, refinements,
transforms, defaults, lazy schemas,
and other unsupported Zod definitions fail activation. Accepted schemas are converted
to bounded deep-frozen JSON Schema and compiled once by the trusted validator; live
snapshots retain only a frozen defensive `safeParse` adapter, never authored closures
or schema internals. Validator exceptions become deterministic validation failures,
and the route-level validator also catches these failures. Core and legacy trusted Zod
schemas retain their existing behavior and duplicate fingerprints. Core, current
legacy local-skill, all previously `ACTIVE` catalog definitions, and the target are
composed in deterministic release order.
Event types are unique except for the immutable, schema-fingerprinted compatibility
pairs for the three pre-existing core/Slack duplicates; new local or catalog code
cannot claim that exception. Count and serialized-size bounds apply before an atomic
registry swap.

The synchronous registry swap returns a compare-and-swap rollback. A load, validation,
or swap failure leaves the old snapshot and atomically records `FAILED` plus a redacted
failure audit when storage is available. If final `ACTIVE` persistence or its audit
fails, the registry is synchronously rolled back first; a separate guarded transaction
records `FAILED`, or the row remains truthfully `ACTIVATING` if storage is still
unavailable. The database can therefore never report `ACTIVE` while the old snapshot
is installed. There is no automatic retry.

Deactivation uses membership identity rather than activation eligibility. A fresh
administrator may remove the exact `APPROVED/ACTIVE` row after Source disable/removal,
review withdrawal/rejection, installation deletion/quarantine/drift, or credential
loss; target code is neither re-imported nor remeasured. Remaining active packages are
still verified. The protocol is `ACTIVE -> DEACTIVATING`, compose without the target,
reversible swap, then `INACTIVE` and audit. Any compose, validation, swap, final-state,
or audit failure restores the old snapshot and, in one guarded transaction, restores
`ACTIVE` with its approved digest, clears failure state, and writes exactly one failed
deactivation audit. A retry uses that new revision. If restoration/audit storage also
fails, the guarded row remains `DEACTIVATING` and the old registry remains installed.
Activation/deactivation changes only future validation. Already persisted events are
unchanged; agents, assignments, runner scripts, wrapped commands, and processes are
not started or mutated.

At startup, the API first composes core and current legacy definitions, then reconciles
persisted `APPROVED/ACTIVE` releases individually. `ACTIVATING`, `DEACTIVATING`, and
`FAILED` rows are excluded and never auto-activated. An exact package verification or
import failure guards only that implicated row to `FAILED` with one audit; healthy
`ACTIVE` packages remain active and enter the final candidate. Cross-package conflicts,
base composition failure, and final registry-swap failure are global: unrelated rows
are not destructively relabeled, no partial candidate is served, and the registry stays
at its prior safe snapshot. Concurrent revision/state/digest changes defeat startup
failure transitions. Event creation, scheduled-event update, and `/api/event-types`
await reconciliation and fail fixed while a global failure is unresolved. Successful
activation/deactivation is visible immediately, with no TTL.

Explicitly approved module top-level code is privileged and can have irreversible host
effects. Registry rollback and deactivation prevent only future event validation; they
cannot unload a module or undo those effects. No Source credential, secret, or
master-key material is supplied to a module.

| Method | Route | Strict body | Success |
|---|---|---|---|
| `POST` | `/api/catalog-releases/:packageReleaseId/api-execution/approve` | `{expectedRevision,digest}` | `APPROVED/INACTIVE` activation state |
| `POST` | `/api/catalog-releases/:packageReleaseId/api-execution/activate` | `{expectedRevision}` | `APPROVED/ACTIVE` activation state |
| `POST` | `/api/catalog-releases/:packageReleaseId/api-execution/deactivate` | `{expectedRevision}` | `APPROVED/INACTIVE` activation state |

These routes accept no query string and require `application/json`, strict canonical
fields, fatal UTF-8 decoding, and an actual streamed body no larger than 16 KiB. They
run `requireAuth` then fresh `requireAdmin`; runner headers are authoritative, so an
admin cookie cannot elevate a global or scoped runner. Ordinary humans, agents,
runners, and anonymous callers are denied. Every success and error is `no-store` and
uses fixed catalog error envelopes without module paths, URLs, bytes, or exception
text. Each durable approval, final success, or failure outcome writes exactly one
channel-less `DELIVERED` `audit.catalog.api_activation.changed` event in the same
transaction as the state transition, with only actor, action, outcome, release,
digest, revision, and optional fixed failure code; it creates no receipt. Intermediate
`ACTIVATING`/`DEACTIVATING` writes are not audited.

Finite rollouts use the exact routes `/api/catalog-rollouts/plan`, `/api/catalog-rollouts`,
`/api/catalog-rollouts/:rolloutId`, `/api/catalog-rollouts/:rolloutId/cancel`, and
`/api/catalog-rollouts/:rolloutId/retry-failed`. A plan freezes the ordered explicit agent
IDs, captured runner (which may be null), assignment revision, explicit digest-bound
`plannedPreload`, complete bounded blocker data, and an exact prior-assignment provenance
snapshot (including the absent-assignment case). Migration 042 adds the non-null planned
preload target column and derives it deterministically during upgrade. Its SHA-256 digest is
computed from canonical `{releaseId,operation,preload?,agentIds,targets}`; `preload` exists
only for `SET_PRELOAD`. Confirmation requires the same actor, digest, and
ordered IDs, then immediately rechecks live actor, package/grant policy, manageability, runner,
assignment, collision, and deployment state inside one immediate transaction before writes.
Rollouts transition `DRAFT` to `QUEUED`/`RUNNING` and finish `SUCCEEDED`, `PARTIAL`, `FAILED`,
or `CANCELLED`. Cancellation skips only queued/unclaimed targets; claimed work may finish
without undoing success, while queued work restores its exact prior assignment/provenance or
deletes the exact rollout-created assignment. Retry is one immediate, all-or-nothing guarded
mutation for the persisted failed-target set only (cancelled/skipped targets are never replayed): it strictly validates the captured assignment,
failed deployment, immutable participants, snapshots, provenance, collision, grant, policy, and
runner state before writing, and uses only the persisted planned preload. It never replays success.
Target rows retain the frozen participant list while reassignment supersedes a deployment. Assignment reads strictly validate the removal marker. A removal tombstone is absent from rollout planning, collision, confirmation, cancellation, retry, and reassignment candidate semantics; rollout commands cannot resurrect it, while the runner may retain an exact requested tombstone only as the internal participant anchor for its empty removal generation. Corrupt markers fail closed. A replacement carries rollout provenance only when the rollout and target are genuinely live; reassignment of a terminal rollout creates a standalone deployment and leaves terminal rollout/target rows unchanged. Every durable plan, confirmation,
cancellation, retry, and actual aggregate transition emits one channel-less
`audit.catalog.rollout.changed` event in the same transaction, with no receipts.

### Central catalog authorization and grants

`CatalogPolicy.decide` is the single catalog authorization switch. It reads current
release and effective-grant state for every decision; there is no authorization cache
and route handlers do not reproduce its rules. Source authority, external-package
permission, release approval, exact inert installation, current grant, API activation,
agent manageability, and runner assignment remain independent checks. Failures use the
most specific fixed code in this order after principal authorization: current Source
permission, release approval, installation, required API activation, grant, then agent
manageability. A stale caller-supplied release or grant cannot authorize an action.

| Principal | Administrative actions | Library/template consumption | Skill assignment/rollout | Runner deployment |
|---|---|---|---|---|
| fresh live human administrator | allowed; install requires approval, grant/API controls also require exact installation | allowed without grant after current-state checks | allowed without grant only for manageable agents | denied |
| ordinary human owning/managing target | denied | requires current exact human or organization grant | requires the same grant and current agent manageability | denied |
| ordinary human not managing target | denied | requires current exact human or organization grant | denied even with a grant | denied |
| runner assigned to exact target | denied | denied | denied | allowed only for its exact runner/agent binding after package checks |
| other runner, agent, anonymous, or malformed principal | denied | denied | denied | denied |

For a structurally valid runner principal, `RUNNER_DEPLOY` evaluates current package
state in the same Source, approval, installation, and API-activation order before it
evaluates exact runner/agent assignment. Malformed decision components and malformed
adapter results never authorize or escape as exceptions; each fails with a fixed code.

An organization grant is one `ORGANIZATION` row for an exact release and covers every
current and future authenticated human; it is never expanded into copied human rows.
A human grant names one existing selected human. V1 has no team or future-agent grant.
Stable grant identity binds release and subject forever, and both directions are
validated: the canonical ID must name its exact tuple and the exact tuple must not exist
under another ID. Creation starts at revision 1 from expected revision 0; revocation
increments the revision and leaves a tombstone; replacement reactivates only that same
tombstoned identity with its current revision. Creation/replacement fails closed for
stale revisions, identity mismatch, non-approved/withdrawn releases, missing or
quarantined/non-exact installations, and removed/disabled required Sources.

Revocation deliberately does not rerun creation eligibility. A canonical existing grant
may be tombstoned after review withdrawal/rejection, Source disable/removal, or
installation removal/quarantine/digest drift. It still freshly validates administrator
authority, canonical grant release/subject identity, the immutable release ID/digest,
and the grant revision before mutation.

Grant mutation and `audit.catalog.grant.changed` insertion share one immediate
transaction with a fresh live-human administrator recheck. Audit publication is
post-commit only; audit failure rolls back the grant change. Grant reads return only
ID, release ID, subject, revision, and revoked time. They never return release digest,
artifact/path, Source credential, secret, or repository data. Withdrawal, Source
removal, or grant revocation blocks future consumption but never deletes, stops,
reconfigures, or removes provenance from existing local agents or assignments.

| Method | Route | Strict body | Success |
|---|---|---|---|
| `GET` | `/api/catalog-releases/:packageReleaseId/grants` | none | current and tombstoned grant metadata |
| `PUT` | `/api/catalog-releases/:packageReleaseId/grants/organization` | `{expectedRevision}` | created/replaced organization grant |
| `DELETE` | `/api/catalog-releases/:packageReleaseId/grants/organization` | `{expectedRevision}` | revoked organization grant tombstone |
| `PUT` | `/api/catalog-releases/:packageReleaseId/grants/humans/:humanId` | `{expectedRevision}` | created/replaced selected-human grant |
| `DELETE` | `/api/catalog-releases/:packageReleaseId/grants/humans/:humanId` | `{expectedRevision}` | revoked selected-human grant tombstone |

All five grant routes require `requireAuth` followed by fresh `requireAdmin`; global
runners, scoped runners, ordinary humans, and anonymous callers are denied before body
reading. Protected responses are `no-store`. Mutation bodies use the shared actual-
stream 16 KiB strict UTF-8 JSON reader, canonical release IDs, server-derived actors,
and fixed redacted error envelopes.

### Grant-filtered user library

`GET /api/library/packages`, `GET /api/library/packages/:packageReleaseId`, and
`POST /api/library/templates/:packageReleaseId/instances` form the user-library route
surface in this slice. All authenticate first and then derive a fresh
live human actor exclusively from the session and current `humans` row. Administrators
and ordinary humans are accepted; agents, global or scoped runners, pseudo-users,
stale/deleted humans, and other malformed principals receive 403, while anonymous
callers receive 401. Query parameters are not accepted. Caller-supplied headers cannot
select a human. Every success and error response is `Cache-Control: no-store`.

Every candidate is authorized through the central `CatalogPolicy` using that
server-derived actor and current database state. Ordinary humans require a current
canonical exact-human or organization grant. One organization row covers current and
future humans without copied rows, and organization/human overlap does not duplicate a
release. Administrators bypass only the grant requirement. All callers still require a
currently approved release, enabled required Sources and external-source permission,
an exact `INSTALLED` row whose artifact digest matches the immutable release digest,
and required API activation. Revocation, withdrawal/rejection, Source disablement,
uninstall/quarantine/digest drift, or non-canonical grant identity takes effect on the
next read.

The list is deterministically ordered by kind, name, version, and canonical release ID,
with at most 100 results. Candidate and empty-state queries read deterministic pages of
at most 100 rows and continue until 100 policy-authorized results are collected, the
reason is determined, or the relevant rows are exhausted; there is no global raw-row
cutoff before policy. The SQLite reads and policy decisions are synchronous, with no
`await` or other interleaving between pages, so the scan is complete for the current
request state while every individual database result remains bounded. Each package
contains only `packageReleaseId`, `kind`, `name`, `version`, and `digest`; detail wraps
the same projection as `{package}` and reads only its named candidate. Source/repository/
ref and credential state, review comments/digests/reviewer, install paths/origins,
manifests, files/bytes, execution commands, warnings, activation internals, grants, and
hidden-row counts are never selected into the public projection.

An empty list includes exactly one bounded reason ID. For an ordinary human,
`NO_GRANTS` means there is no current canonical exact-human or organization grant;
`NOT_INSTALLED` means at least one canonically granted release passes the earlier
Source and review checks but the authoritative policy decision is
`INSTALLATION_REQUIRED`; otherwise the reason is `NO_COMPATIBLE_RELEASES`.
Administrators ignore grants and therefore never receive `NO_GRANTS`: they receive
`NOT_INSTALLED` iff some current release passes the earlier Source and review checks
and policy denies it with `INSTALLATION_REQUIRED`, and receive
`NO_COMPATIBLE_RELEASES` otherwise. In particular, Source-disabled, rejected, or
installed-but-API-inactive releases do not cause `NOT_INSTALLED`, following central
policy precedence. These reasons expose no release identifiers or metadata. Detail is
non-enumerable: malformed, missing, ungranted, withdrawn/rejected, uninstalled,
quarantined, Source-disabled, digest-drifted, and corrupt-grant release IDs all return
the same fixed `404 NOT_FOUND` envelope.

| Method | Route | Success |
|---|---|---|
| `GET` | `/api/library/packages` | `{packages}` plus a bounded `emptyReason` only when empty |
| `GET` | `/api/library/packages/:packageReleaseId` | `{package}` with the bounded public projection |
| `POST` | `/api/library/templates/:packageReleaseId/instances` | `{agent,origin,requirements}` for a new stopped independent agent |
| `PUT` | `/api/library/agents/:agentId/requirements/:requirementName/secret-binding` | `{agentId,requirementName,revision,state}` redacted binding result |

### Stopped package-template instantiation

Template creation accepts only strict `{name,visibility,runnerId,workspacePath,modelId,
secretBindings}` JSON. Binding entries are `{requirementName,secretId}` and duplicate or
unknown requirements are rejected. Query strings, owner selection, lifecycle/state,
mode, grant, channel, path/command, secret-value, and other fields are forbidden. The
actual stream is fatal UTF-8 decoded and capped at 16 KiB. Presence of the runner-token
header is authoritative: valid global/scoped runner credentials resolve as runners, while
invalid or empty runner credentials return the standard `401` and never fall through to a
human cookie. The owner is
always the fresh live session human, including administrators; deleted or must-reset
sessions fail before creation. The same actor and role are rechecked inside the immediate
creation transaction.

Only reviewed `native-agent` templates in `CLASSIC` or `RLM_REPL` mode and reviewed
`wrapped-agent` templates are supported. The central `TEMPLATE_INSTANTIATE` policy
rechecks current Source permission, approval, exact digest-bound installation, required
API activation, and—for ordinary humans—the canonical current grant. Administrators
bypass only the grant. Existing names return a non-enumerating denial and are never
mutated. The selected runner must exist. The workspace is canonicalized through its
existing path or nearest existing ancestor and must remain inside the canonical configured
project root; symlink escapes and filesystem resolution errors fail closed, while contained
nonexistent leaf components are accepted without creating them. The selected model must be
enabled (`wrapped:none` is also valid for a wrapped template). Supplied secret IDs must name
existing references authorized by the
current secret policy. Only IDs are persisted; values never enter the agent, origin,
audit, requirements, or response. Missing bindings are saved as `MISSING` requirements
and do not auto-start the agent. A stopped agent owner or fresh live administrator may
later bind one required template secret with the strict body
`{expectedAgentRevision,secretId}`. The route validates every strict immutable origin/release/manifest identity field and required package-scoped secret, decryptability, ownership/policy, and agent revision transactionally; corruption returns a fixed privacy-safe conflict and never resolves a caller-supplied requirement against raw metadata. It does not re-evaluate the historical grant, Source, or review.
It increments the agent revision, returns no secret identifier or value, writes a channel-less
`audit.catalog.secret_binding.changed` audit, and creates no receipt. Non-stopped agents,
wrong revisions, non-owners, runners, and agents are denied with fixed errors.

Creation positively selects reviewed portable data. Native instances copy mode,
instructions, soul contents, supported runtime tuning, and exact skill-pin metadata.
Wrapped instances copy the supported reviewed portable recipe but omit its repository/
ref source hint. No DB identity, install/artifact path, credential, local secret value,
channel/event/memory history, lifecycle state, setup output, source warning, or
unreviewed command is copied. Package skill pins are resolved through the complete
canonical exact dependency closure. Every dependency edge is traversed for cycle detection;
completed shared DAG nodes are emitted once. Cycles are rejected, depth is bounded by
`CATALOG_LIMITS.recursionDepth` (root depth zero), and unique resolved packages are bounded
by `CATALOG_LIMITS.resolvedPackages`. Every pin must be an approved exact installed skill
with matching digest/current Source/API state. Pins become only normalized assignments
with desired `ENABLED`, effective `DISABLED`, deployment `REQUESTED`, exact release and
digest-derived generation, provenance, and reviewed preload; legacy skill JSON arrays
remain empty.

The agent row (`desiredState=STOPPED`, `runtimeState=STOPPED`), immutable origin (including
the exact canonical grant for ordinary-human consumption, or null grant provenance for an
administrator),
normalized assignments, supplied secret references, and exactly one channel-less
`DELIVERED` `audit.catalog.template.instantiated` event commit in one immediate
transaction. Constraint, adapter, or audit failure rolls all of them back and creates no
receipts. No channel is created and no provider/model call, runner delivery, wrapper
setup/runtime, shell, filesystem write, event delivery, or memory operation occurs.
Even fully satisfied requirements leave the instance stopped. This creation-time workspace
check does not claim to eliminate filesystem TOCTOU: the later start gate must canonicalize
and revalidate containment again after any post-creation filesystem changes. The response
contains only bounded agent identity/local selections, immutable origin release/mode/actor marker,
and fixed requirement names/states; it excludes secret IDs/values, hidden package data,
host paths, commands, URLs, and review details.

### Unified atomic provisioning

`POST /api/agents/provision` accepts only the strict flat `ProvisionAgentSchema` body, including a UUID `idempotencyKey`. The server hashes a canonical request with transport noise and the key excluded, then records a bounded redacted receipt in `agent_provision_operations` in the same immediate transaction as the agent. A retry by the same actor and key returns the stored receipt when the digest matches and returns `STATE_CONFLICT` when it differs; failed transactions leave no operation record. The route translates it once into nested `AgentCreation`; opaque secret handles remain opaque
through translation and are never resolved at route time. Handles are actor-, purpose-,
nonce-, and ten-minute-expiry-bound AEAD base64url tokens capped at 2048 bytes; punctuation is rejected by the route schema before resolution. Preflight checks
all selected local/catalog skills and requirements before writes. Creation blockers fail;
missing requirements are persisted as stopped readiness blockers. The immediate creation
transaction rechecks the live actor, name, runner/model/workspace policy, grants, release
state, and handles, inserts the agent with empty local skill/preload arrays, then calls the Task 2 transaction-scoped management seam exactly once
for the complete local/catalog command set so local selections have one writer. Binding re-resolves each handle immediately
before its internal secret row write; expiry, visibility, ownership, or decryptability
failure rolls back the complete agent, assignment, deployment, binding, and audit write.

Any catalog selection forces both desired and runtime state to `STOPPED`; provisioning
creates no channel, receipt, turn, process, wrapper setup, model call, or runtime event.
Blank local-only creation retains the generic local contract. Template options expose strict root name/version/package-release/digest/description/readiness metadata, bounded runner/model choices, opaque secret selectors, server-derived portable config, exact dependency refs, and exact preloads;
raw release/source/owner/secret storage details are excluded. `GET /api/agents/:name/start-readiness` is a human-only privacy-safe owner/admin dry-run of the same central start gate used by explicit Start; every runner principal is rejected before manageability and gate evaluation, including an assigned exactly scoped runner. It returns only bounded blocker codes/requirement names and whether deployment remains queued, is no-store, and never returns Source or secret identifiers. The admin Create Agent drawer
uses an immutable review snapshot, exact root template identity/configuration, exact local/catalog refs with explicit preload state, and
focus-managed dialog semantics; browsing or cancelling never creates a row. Post-create readiness requests carry an abort signal and are generation-, principal-, and receipt-agent-owned: refresh, replacement receipts, principal changes, close, and unmount invalidate prior work, late responses are ignored, and Start is shown only for the current owned ready response. The compatibility template
route delegates through this seam when configured, while generic `POST /api/agents` remains
local-only. Protected provisioning endpoints use no-store, authenticate before body
parsing, reject query/body ambiguity, and apply the fatal UTF-8 16 KiB reader. Migration 045 rebuilds actor-scoped provisioning receipts inside `BEGIN IMMEDIATE`/`COMMIT` while foreign keys are temporarily disabled; the migration runner rolls back any active failed transaction and restores `foreign_keys=ON` before rethrowing, so an interrupted copy leaves the original table/data recoverable and the migration unrecorded.

Source, release review/install, grant, and API-activation administration routes remain
administrator-only. Rollout mutations and reads require a fresh live human; runner and
agent principals are denied. Administrators may roll out only to agents they manage, while
ordinary humans additionally require an exact current grant for every target.

### Normalized catalog skill assignment

`PUT` and `DELETE /api/agents/:name/catalog-skills/:packageReleaseId` are the only
normalized skill-assignment HTTP commands. Both accept strict
`{expectedAgentRevision,expectedAssignmentRevision,preload}` JSON, reject query strings,
use fatal UTF-8 decoding and the actual-stream 16 KiB limit, and return `Cache-Control:
no-store`. The path release ID is canonical and the owner/actor is always derived from a
fresh live human session. Runners, agents, pseudo-users, stale humans, and anonymous
callers cannot assign skills. A human administrator bypasses only the grant requirement;
administrators and ordinary humans must currently manage the target agent, and ordinary
humans also require the exact current canonical human or organization grant.

`CatalogConsumption.assignSkill` is the sole command seam. In one `BEGIN IMMEDIATE`
transaction it rereads the live actor and target. The central policy decides target
manageability before package or grant state, and consumption applies that decision before
checking the expected agent/assignment revisions, runner assignment, collisions, or other
target-local state. Missing and unmanageable private targets therefore return the same
fixed forbidden response without writes. It then checks current Source permission, release
approval, exact installed digest, required API activation, and grant.
Only canonical `skill` roots may be assigned. The assignment pins the exact release,
digest identity, local skill name, actor kind/human, and exact selected grant ID (or null
for administrator provenance). Later Source changes or grant revocation block new commands
but do not rewrite or disable existing effective assignments or their provenance.

An absent assignment requires expected assignment revision `0`; an existing row requires
its exact bounded revision. The agent's bounded configuration revision is compared in the
same transaction and is not incremented by assignment-only changes. Migration 036
backfills all existing agents to revision `1`; assignment-relevant owner/visibility,
runner, workspace/model/mode, legacy skill-array, and wrapped/config mutations advance it
with a guarded database-side increment. Concurrent successful configuration updates receive
distinct revisions; overflow changes nothing. Runner deregistration checks all affected
agents and atomically advances/unassigns them with runner deletion, while invite reassignment
uses the same guarded increment in its redemption transaction. Heartbeat/runtime reporting
does not advance the revision. Migration 036 also adds `effective_preload`,
backfilling stable rows from their prior preload and leaving pending rows non-effective.

Every accepted enable, disable, preload change, or retry receives one immutable bounded
desired generation. It changes only desired state/preload and deployment state
`REQUESTED`; effective state, effective preload, and active generation remain unchanged.
The same transaction durably inserts one deployment bound to the agent's current runner
and generation and writes exactly one channel-less `DELIVERED`
`audit.catalog.assignment.changed` event with no receipt. Missing runners, live deployment
conflicts, revision overflow, local-name collisions, malformed rows, enqueue failures, and
audit failures fail closed; adapter/audit failures roll back assignment, deployment, and
audit together. A matching verified runner `ACTIVE` report is the only transition that
copies desired state/preload to effective state/preload, advances the shared active
generation, and returns participating assignments to `STABLE`; `FAILED` retains the prior
effective projection.

### Runner package delivery and runtime generations

Runner delivery exposes five `requireRunnerAuth` routes: `GET
/api/runners/:runnerId/package-deployments`, `GET
/api/runners/:runnerId/agents/:agentName/start-requirements`, `POST
/api/runner-package-deployments/:deploymentId/claim`, `GET
/api/runner-package-deployments/:deploymentId/artifact`, and `POST
/api/runner-package-deployments/:deploymentId/report`. All reject query strings and return
`Cache-Control: no-store`. Claim has no body. Report is strict fatal-UTF-8 JSON bounded by
the actual 16 KiB stream. The explicit registered runner is carried by the poll path and by
`x-orgops-runner-id` on deployment routes; the 256-bit base64url attempt token is carried
only by `x-orgops-deployment-attempt-token`. Scoped credentials must match both their
runner and agent binding. Human cookies, anonymous callers, invalid runner headers, wrong
runners, and stale agent assignments never confer delivery access. The start-requirements
route also rejects bodies and binds the URL runner and agent to the current registered runner
assignment; it returns only the strict bounded start result described below.

### Package-aware lifecycle start gate

`CatalogStartGate.validateCatalogStart` and `setDesiredAgentState` are the central catalog
lifecycle authorization and desired-state writer seam. Every explicit start, restart,
reload-skills transition, and PATCH `desiredState` transition uses that seam. Start and restart
success atomically set desired `RUNNING` and runtime `STARTING`; stop is always available to a
freshly authorized current actor and atomically sets both states to `STOPPED`. Catalog template
instances and invite-created agents remain `STOPPED`. Standard creation retains its existing
behavior only for agents with neither a template origin nor normalized assignments. A failed
gate returns `409 REQUIREMENTS_UNSATISFIED` with a deduplicated, sorted, maximum-64 reason list
and does not change desired/runtime state or publish a control event. PATCH configuration is
applied before the gate, but lifecycle fields remain unchanged when the gate fails.

Authorization precedes prerequisite detail. Humans must be fresh non-reset sessions and must
currently manage the target (administrator/public manageability or private ownership). Runner
validation requires an explicit registered runner ID and exact current agent assignment; scoped
tokens additionally require their exact runner/agent bounds. Missing, private-unmanageable, or
wrong-runner targets return the same fixed `403 {error:"Forbidden",code:"FORBIDDEN"}` without
prerequisite detail, including scoped runner/agent mismatches, missing agents, stale assignments,
and unregistered global runners. Missing or invalid authentication retains the runner-auth `401`.
Actor identity is derived only from the session/token and URL, never request JSON or query
parameters. Lifecycle and runner start-requirements responses are `Cache-Control: no-store`.

An agent is catalog-derived when it has a strict template origin, any strict normalized
assignment, or both. Ordinary agents pass unchanged. The gate strict-parses all agent, origin,
release, manifest, installation, API activation, secret binding, assignment, deployment, and
participant evidence. Malformed/throwing storage seams fail closed with a redacted bounded
`REQUIREMENTS_UNSATISFIED` result. Validation plus a `RUNNING` write executes in one immediate
transaction and guards the update count.

Template origins copy the complete immutable release identity (both Source IDs, kind, name,
version, both commits, path, and digest). Migration 038 upgrades an origin only when every old
field still matches its release and the native/wrapped kind, origin mode, agent mode, and native
manifest mode are coherent; unverifiable rows roll the migration back. New instances persist the
complete identity atomically. Start compares every copied field and the manifest identity exactly.

The deterministic reasons are `INSTALLATION_REQUIRED` for absent, digest/path/provenance-drifted
exact local content; `QUARANTINED`; `API_ACTIVATION_REQUIRED` for required API event-shape code
without APPROVED/ACTIVE activation; `SECRET_BINDING_MISSING` (only release ID and requirement
name, never secret ID/value); `RUNNER_BINDING_MISSING`; `MODEL_BINDING_MISSING` (with the
`WRAPPED` `wrapped:none` exception); `WORKSPACE_BINDING_MISSING`; `WRAPPED_WIRING_MISSING`; and
`DEPLOYMENT_REQUIRED`. The deployment reason covers non-stable/incoherent assignments, missing
or mixed active generations, and absence, ambiguity, or mismatch of the one exact ACTIVE deployment,
current runner, complete immutable desired-root identities, recomputed ordered dependency closure
and package-set digest, recomputed artifact semantic digest, or complete frozen participant set.
Dependency-pin cardinality is checked before candidate parsing, so a malformed duplicate cannot be
filtered into an apparently unique match. Participant validation binds every frozen
identity/projection/history field to the exact ACTIVE APPLY (+2 revision) or stable CARRY (+1
revision) transition; failed carries block start. Every referenced prior active generation must
also have exactly one strict ACTIVE deployment and complete matching participant projection whose
roots, immutable closure, package-set digest, and artifact semantic digest recompute exactly. This
last-known-good proof is intentionally non-recursive: the prior deployment's own frozen effective
content is verified directly without consulting older Source, grant, or review policy. Required
secrets need exactly one current binding whose secret name equals the requirement, whose scope is
exactly `package` and immutable package name, and whose ciphertext decrypts under the current
master key to nonempty plaintext. Stable desired-disabled packages need no installation unless
still effectively enabled as a carry prerequisite.

Start deliberately does **not** recheck the historical consumption grant, current Source
enabled/removed/credential/allowPackages state, current release review state/review digest, or
remote Source availability. Revocation, Source removal/disablement, release
withdrawal/rejection, and credential deletion block new consumption but do not invalidate an
existing local agent. Exact immutable release identity, installed bytes, quarantine, required
API activation, secrets, runner/model/workspace/wrapped wiring, and verified deployment remain
live start prerequisites.

Before any new bootstrap or re-bootstrap, including after runner or explicit restart, the runner
strict-parses the same API result before workspace creation, runtime `RUNNING` patch, startup
event, wrapped setup/sidecar/runtime command, or provider activity. Catalog workspaces receive a
host-local canonical, symlink-aware containment check against the runner project root; wrapped
portable configuration and built-in harness support are inspected without execution. API and
local reasons are combined and only fixed codes are logged. Denial creates no workspace,
process, startup event, or state mutation. Already bootstrapped/running agents are not repeatedly
gated and are not silently stopped when historical policy or a prerequisite later degrades;
the next explicit restart or process/runner bootstrap is gated. The API ACTIVE report and frozen
participants are authoritative for deployment readiness. The current runner-generation pointer
is verified by the package activation/turn lease seam before catalog turn use; start validation
does not claim an additional pointer-verification interface.

Poll is ordered and capped at 32 commands. Every command includes deployment, agent ID and
name, assigned runner, triggering release, immutable desired generation, the exact ordered
root release identities, and the digest of the complete ordered package identity set. Before
a deployment is exposed, reconciliation freezes exactly one
`runner_deployment_participants` row per assignment. Each row records assignment/release/local
name, its assignment revision, prior effective projection and generation, and whether it
applies a requested target (`APPLY_DESIRED`) or carries effective content
(`CARRY_EFFECTIVE`). Stable siblings carry their effective projection. Failed siblings carry
their last-known-good effective content without retrying or replacing failed desired metadata.

Before every operation reconciliation supersedes a live deployment whose bound runner no
longer matches the current agent assignment. Applying rows already marked `DEPLOYING` are
reset to `REQUESTED` with guarded revisions; carry rows retain `STABLE` or `FAILED`. An
assigned agent receives exactly one replacement with a new generation and freshly frozen
participants; an unassigned agent receives none. This also applies when the newest carry-only
replacement was itself superseded while queued, claimed, staged, or waiting, so each subsequent
assignment receives exactly one fresh carry generation. Reassignment after `ACTIVE` provisions
the complete current effective generation on the new runner. Reassignment back creates another
new generation rather than reusing an old-runner directory. A failed replacement is not
automatically retried, and an active replacement on the current runner terminates reconciliation.
Template-created `REQUESTED` pins coalesce into one generation.

Claim performs `QUEUED -> CLAIMED`, creates a cryptographically random attempt token, and
sets a bounded lease. Repeating the same claim while its lease is live returns the same token
and expiry. An expired in-progress lease is reissued for restaging. The token remains on
terminal rows so an identical report replay can return its existing receipt without another
revision, audit, rollout change, or effective-state mutation.

Artifact construction uses only the frozen effective-enabled roots and recursively resolves
their exact pinned skill closures. A disabled triggering release remains top-level identity
evidence but is not a package and is not staged unless reachable from an enabled root.
`direct:true` exactly identifies command-bound roots. Each package has a deterministic
`packages/<three-digit-ordinal>-<package-name>-<release-id-hash>` transport namespace, exact
immutable release identity, canonical manifest, and package-relative files associated by
release ID. Before reading content, the API preflights the global package/file/declared-byte
limits. It canonicalizes the configured installation root and every traversed directory,
rejects symlinked/non-directory/outside-root components and canonical mismatches, opens files
with no-follow where supported, requires a regular single-link file, reads that handle once,
and compares its identity and metadata again after reading. It rechecks directories before
and after traversal. This is the strongest portable Node opened-handle design; without an
`openat`-style capability API it does not claim perfect same-UID resistance to replacement
of directory entries between operations.

The API verifies exact `0644|0755` modes, inventory, canonical manifest, and semantic digest.
Before asynchronous reads it snapshots the complete deployment, runner/agent binding, immutable
participants, desired roots/package set, triggering release, dependency closure, and current
Source/review/install/API policy identities. After reading it re-resolves and exact-compares all
of that authority in one immediate transaction, including the live lease and assignment. The
first envelope semantic digest is persisted with one guarded revision increment; an idempotent
fetch accepts only the same digest and still repeats every live check without another increment.
Concurrent reassignment, supersession, revision/state/token/lease, participant, root, release,
or installation drift returns no artifact and pins no digest. It rejects drift, links,
special files, path/case collisions, ambiguous identities, missing/extra files, cycles,
policy/approval/install/API-activation failures, more than 256 packages or aggregate ordinary
files, files over 1 MiB, manifests over 256 KiB, or more than 8 MiB decoded content. Envelopes exclude
Source URLs/refs and credentials, host paths, grants, secret values/references, setup output,
review warnings, attempt tokens, logs, and commands beyond canonical reviewed manifest
fields.

The runner strict-parses and independently re-inspects every package with the shared package
inspector before filesystem writes. From the command roots it derives exact direct/transitive
closure, package order, namespaces, and package-set digest; added roots, omitted dependencies,
namespace substitutions, disabled-trigger smuggling, malformed limits, or digest changes fail
closed. It checks command/deployment/agent/generation/release bindings, canonical base64,
inventory, modes, paths, bytes, and semantic digest. It never imports event modules or runs
scripts, providers, wrapped setup, or wrapped runtime.

Verified bytes stage exclusively below a canonical, non-symlink
`ORGOPS_RUNNER_PACKAGE_ROOT` (default `.orgops-data/runner-packages`) in hashed agent and
generation directories. Existing components, final roots, markers, files, and pointers are
checked for containment and symlinks; marker/files are opened no-follow, required to be
regular and single-link, and identity-checked after reading. Package skill roots are ordinary
deterministic `skills/<name>` directories. The complete marker binds deployment, generation,
package-set digest, envelope semantic digest, and exact file inventory/modes/digests. A
same-generation retry is reusable only when all marker and file evidence matches; it is never
merged or overwritten. Activation repeats complete verification. Failures remove only their
exclusive operation-owned temporary directory and retain prior generations and unmanaged
occupants.

Each agent has an atomic `current.json` runtime-generation pointer and an in-memory async
ownership gate keyed by immutable agent ID. Pointer selection/loading plus lease increment is
serialized with activation. Immediately before removing each nonempty queue batch, the channel
loop freezes a clone of the current agent configuration and channel identity. It captures exactly
one lease with that snapshot's immutable agent ID before any batch/turn work, and uses the same
snapshot for processing and error reporting even if a later enqueue replaces the worker's agent
object. The frozen generation is passed through the mode-independent dispatch boundary. CLASSIC
and RLM_REPL consume its prompt, event-shape, and skill roots; WRAPPED remains protected by the
same channel lease while its external runtime continues to own its own configuration. The lease
remains held through all model steps, same-channel late-event reconciliation, fallback output,
failures, and the best-effort batch error handler, and releases idempotently in `finally` even when
error reporting rejects. Concurrent channels therefore count against one agent-wide gate while
other agents remain independent.

Activation takes ownership before checking leases, blocks new captures, waits without polling
until every existing channel or fallback lease releases, re-verifies the staged marker and
files, atomically renames the new pointer, and then releases waiters. Captures arriving during
that interval resume against the new generation; they cannot indefinitely extend the old one.
A failed verification or pointer write retains the previous pointer and still releases the
gate. Staged-object authenticity is held in a `WeakMap`; each agent strongly retains at most its
current pending and active bindings. A newly completed stage supersedes the prior pending token,
a successful swap promotes that pending token and supersedes the prior active token, and no
activation enumerates historical tokens. Restart reloads and fully validates the pointer, marker,
measurements, and package-root containment; staging that exact pointer can establish the bounded
active binding. Corrupt, foreign, linked, unmanaged, forged, cloned, stale, cross-agent, and
superseded staged bindings fail closed. Exact active-token retries remain idempotent only after
another complete filesystem verification. The generation path is runner-independent, while every
reassignment receives a new generation identity.

Agents without a pointer capture a bounded frozen `legacy-fallback` generation rooted at the
configured local `SKILL_ROOT`; such a lease also blocks the first catalog activation. After
activation, a turn deterministically combines enabled package skills from that lease with
enabled built-in/local skills. Package metadata and tool roots come from `skillRoot`, preload
markdown from `promptRoot`, and runner-side event-shape modules only from `eventShapeRoot`;
all three package inventories must name the same identities. Enabled package/local name
collisions and divergent generation-root inventories fail closed. Disabled skills and prior
package-generation paths are omitted from the prompt, event shapes, skill index, and tool
allowlist. No global root is mutated and no staged tree is changed in place.

An optional pointer-change callback runs once, only after a successful durable non-duplicate
swap, with the exact agent ID and generation. Pointer state, token promotion, and the activation
result commit while gate-owned; the ownership gate is then released before the callback is
invoked. The callback is a deterministic nonblocking observer: activation does not await its
promise, and synchronous throws or asynchronous rejection are best-effort. A pending callback
therefore cannot block captures, a reentrant callback can capture/stage/activate, and callback
failure neither rolls back the durable pointer nor changes activation success. Package-aware
lifecycle start validation remains the Task 12 boundary and is not added by runtime-generation
capture.

After each successful heartbeat and before listing agents, the runner sequentially processes
the bounded deployment list. Its successful order is list, claim, artifact, verify/stage,
report `STAGED`, report `WAITING_FOR_IDLE`, activate, and report `ACTIVE`; waiting is reported
before the idle await. The installed root `orgops-package.json` is an envelope metadata file,
not a manifest inventory file: artifact delivery verifies its exact canonical bytes from the
stored strict manifest, regular non-executable `0644` mode, size, inode/device/mtime stability,
and single-link ownership, then omits it from envelope content. Every other extra remains
rejected; package digest and semantic digest coverage are unchanged. Inspection failures report `FAILED/INSPECTION_FAILED`; local staging
or activation failures report `FAILED/STORAGE_FAILURE`. Ambiguous transport/report outcomes
are left for idempotent reconciliation and are not converted to contradictory failures. One
deployment failure does not stop later commands.

Reports enforce `CLAIMED -> STAGED -> WAITING_FOR_IDLE -> ACTIVE`, with `FAILED` exits from
in-progress states. `STAGED` marks only applying participants `DEPLOYING` and a rollout target
`STAGING`; waiting projects `WAITING_FOR_IDLE`. `ACTIVE` uses one immediate transaction to
mark deployment active, validate and mark the rollout target succeeded, copy frozen targets
for applying rows, and advance one common active generation for every participant. Stable
carry rows align desired and active generation while retaining their effective projection.
Failed carry rows preserve `FAILED` and all desired/effective metadata but advance the active
runtime pointer generation containing their last-known-good bytes. The transaction appends
one channel-less delivered `audit.catalog.deployment.reported` event with no receipts.
`FAILED` changes only applying rows to failed and preserves every effective/preload/active
projection. Exact duplicate reports require equal state, generation, token, and failure code;
otherwise replay fails closed. Rollout rows are runtime-parsed, must exist in the expected
state, and use guarded bounded revisions in report and supersession paths. Wrong
token/runner/agent/generation, participant drift, backward/skipped states, malformed
cross-field row invariants, missing/wrong rollout state, affected-row mismatch, and revision
overflow fail closed and roll back assignment, deployment, rollout, and audit atomically.

Authenticated runner agent list and detail reads pass through one deep effective-skill
projection after access filtering. It validates every normalized row before deciding
whether it is effective: bounded identities/generations/revisions, states, booleans,
provenance, unique normalized local names, and state/generation/preload consistency must
all hold. In particular, effective enabled rows require an active generation and stable
rows must exactly match desired state, generation, and preload. Valid requested disables
and failed replacements retain the prior effective names/generation. The projection then
combines deterministic legacy enabled/preloaded names with only effective normalized
assignments and uses `effective_preload`; requested enables remain absent. Any malformed or
ambiguous visible projection returns the same fixed `STATE_CONFLICT` from list and detail,
while corrupt inaccessible rows remain hidden. Human agent reads continue to show the
legacy local-skill fields and do not expose catalog provenance or deployment internals.

Mutation bodies must be `application/json`, valid UTF-8, strict (unknown fields are
rejected), and no more than 16 KiB as counted while reading the actual stream. Source
IDs use the canonical Source ID parser. Sync accepts no caller-selected index path and
always reads `catalog/index.json`. Actors come only from the authenticated human
session. Source and snapshot responses expose `hasReadCredential`, never plaintext,
ciphertext, credential references, or repository credentials. Source projections also expose the
bounded canonical repository URL separately from the internal `repositoryIdentity`; administrator
Source Library clients render the canonical URL and never render the serialized identity tuple.
Exact package installation reuses the same compatibility authority as `prepareImport`. The API
installation target has an explicit immutable capability set: its current Node runtime provides
`node`, while no arbitrary PATH tools are inferred or trusted from a package manifest. Platform
and OrgOps-version checks remain enforced, and any other required tool fails closed as
`INSPECTION_FAILED` before files or rows are written.

Catalog domain failures use a fixed `{error,code}` envelope. Authentication guard
bodies remain the existing un-coded envelopes.

| HTTP | Codes | Fixed message |
|---|---|---|
| `400` | `INVALID_REQUEST` | `Invalid catalog library request` |
| `413` | `PAYLOAD_TOO_LARGE` | `Catalog library request too large` |
| `403` | `FORBIDDEN` | `Administrator access required` |
| `404` | `NOT_FOUND` | `Catalog library resource not found` |
| `409` | `REMOVED` | `Catalog library resource removed` |
| `409` | `REVISION_CONFLICT` | `Catalog library changed; reload metadata` |
| `409` | `STATE_CONFLICT` | `Catalog library operation conflicts with current state` |
| `409` | `IDENTITY_CONFLICT` | `Catalog release identity already reserved` |
| `403` | `SOURCE_NOT_ALLOWED` | `Package source is not enabled for this operation` |
| `503` | `SOURCE_UNAVAILABLE` | `Package source is unavailable` |
| `409` | `RELEASE_NOT_APPROVED` | `Package release is not approved` |
| `403` | `GRANT_REQUIRED` | `A current grant is required` |
| `409` | `INSTALLATION_REQUIRED` | `Package release is not installed` |
| `409` | `API_ACTIVATION_REQUIRED` | `API execution approval is required` |
| `409` | `REQUIREMENTS_UNSATISFIED` | `Agent requirements are not satisfied` |
| `409` | `OPERATION_IN_PROGRESS` | `Catalog operation is already in progress` |
| `409` | `DEPLOYMENT_SUPERSEDED` | `Runner deployment was superseded` |
| `422` | `INSPECTION_FAILED` | `Package inspection failed; last-known-good content is unchanged` |
| `500` | `STORAGE_FAILURE` | `Catalog library operation failed` |
| `502` | `SYNC_FAILED` | `Source synchronization failed` |

Unexpected authority failures are translated to the fixed `STORAGE_FAILURE` response;
raw exception, SQL, filesystem, Git, URL, and credential details are never returned.

### Retired migration-032 Catalog behavior (historical)

The following describes the compatibility modules retained until their scheduled
removal; these modules are not registered or constructed after migration 034.
Migration 032 originally added:

| Table | Stored fields / constraints |
|---|---|
| `catalog_sources` | `source_id` primary key; `canonical_url`, optional `ssh_user`, unique `repository_identity`; explicit `enabled`, `allow_packages`; `revision`, `removed_at`, `created_at`, `updated_at` |
| `catalogs` | `catalog_id` primary key; immutable `source_id` foreign key (indexed); `display_name`, `ref`, `enabled`; `revision`, `removed_at`, `created_at`, `updated_at` |
| `catalog_read_credentials` | one row per `source_id` foreign key; unique random `credential_ref`, `kind='https-basic'`, `ciphertext_b64`, `created_at`, `updated_at` |

Boolean columns are checked 0/1. Revisions are integers 1–2147483647. Removed
sources must have enabled/package permission false; removed catalogs are disabled.
Credentials are never stored in the existing agent-visible `secrets` table.

### Retired Catalog implementation notes

Migration-032 Catalog configuration, Git sync, package browsing, import preview,
and installation behavior is historical only. The old mutable API modules and
retirement shim have been removed after import-graph proof; migration-032 archives
and migration-033 `catalog_installed_origins` remain for export and reconciliation.
The canonical administrator-only Source Library routes own the supported namespaces
and query only canonical tables. No mutable proxy or synthesized Catalog model exists
at runtime.

The former `/api/catalogs` configuration, sync, package, preview, and installation
endpoint patterns do **not** retain their old authentication, request, success, or
error behavior. Every HTTP method at `/api/catalogs` or any descendant now receives
the framework-default unauthenticated 404; the historical 410 compatibility window
is complete, with no retirement JSON, cache handling, or wildcard shim.

Migration-033 local skill origins have a direct, non-route exact reconciliation seam;
`originId` is the immutable `name` primary key. It requires strict live human-admin
checks at start and in the final immediate transaction, exactly one canonical release
candidate, exact origin/installation actor and timestamp equality (including NULL
semantics), and a fresh complete local evidence measurement rooted at
`dirname(artifact_path)` with the digest directory nominated. Manifest bytes and
non-executable mode, every content entry, file/directory modes, symlink/hardlink
absence, and inventory are checked. It preserves historical actor/time/local path,
writes only exact canonical identity normalization with a guarded update/audit, and
never fabricates review, grant, approval, or source-policy authority. Exact rows are
idempotent without duplicate audit; source removal retains snapshots, installations,
assignments, agents, grants, and origins.

## Event Contract

Envelope fields used by API/runner:

- required: `type`, `payload`, `source`
- contextual: `channelId`, `parentEventId`
- scheduling: `deliverAt`
- dedupe: `idempotencyKey`

Validation uses the process-wide atomic snapshot composed from:

- core definitions: `packages/schemas/src/event-shapes.ts`
- optional legacy local definitions: `skills/*/event-shapes.ts`
- explicitly approved and `ACTIVE` catalog definitions from exact immutable installs

`POST /api/events`, scheduled-event `PATCH`, and `GET /api/event-types` use that same
snapshot. Registry swaps are immediate and all-or-nothing; there is no route-private
cache or validation TTL.

## Auth and Access

### Human Auth

- Session-cookie login: `POST /api/auth/login`
- Profile/password update: `PATCH /api/auth/profile`
- Logout/me endpoints supported
- Invited humans must rotate temporary password before accessing most API routes
- The global API guard consults Hono's precomputed path/method matches and lets genuinely unmatched API requests reach the framework-default 404 before authentication. Registered endpoints remain protected, including invalid runner-header precedence over cookies.

### Administrator capability and upgrade bootstrap

`GET /api/auth/me` returns `id`, `username`, `mustChangePassword` and boolean
`isAdmin`. `isAdmin` reports current catalog-management capability: an authenticated
human must have persisted `is_admin = 1` and `must_change_password = 0`.
The API reads the human row by ID on every capability check; this decision does
not trust session-cached password requirements or cache administrator authority.
Existing session fields remain unchanged. Demotion takes effect on
the next check without logging in again. Renaming a human does not change authority.
Runner credentials never confer this capability, even alongside a human cookie.
The `createRequireAdmin` guard protects the catalog configuration routes above.
No role-management endpoint is added.

`POST /api/humans/:id/reset-temp-password` checks the target's current persisted
role. If the target is an administrator, the caller must pass the same live human
administrator capability check before credentials are changed or a temporary
password is returned. Regular humans, demoted administrators, administrators with
a current password-change requirement, and global/scoped runners (even with an
administrator cookie) are denied with 403. Resetting an administrator preserves
`is_admin` and requires password rotation before administrator capability returns.
This is an approved exception to preserving unrelated authentication semantics:
non-admin-target reset policy and normal self-profile password changes are unchanged.

Only the initially seeded human on a fresh database is designated administrator.
On upgrade, all existing humans default to non-admin, including users named
`admin`; startup does not promote existing humans. An operator must explicitly
promote an intended human by ID using offline maintenance:

```text
Stop the API before maintenance. Back up the instance SQLite database using
SQLite's backup mechanism. Open the configured instance database, not an assumed
relative path. Confirm the intended human ID and username:
  SELECT id, username, is_admin FROM humans;
Within a transaction, promote exactly that ID with a bound parameter:
  BEGIN IMMEDIATE;
  UPDATE humans SET is_admin = 1 WHERE id = :selected_human_id;
  SELECT changes();
Commit only if exactly one row changed and re-reading it confirms the intended
identity; otherwise roll back. Restart the API. Verify /api/auth/me for that
human. Do not promote all users or infer authority from a matching username.
```

For demotion, follow the same stopped-API, backup, bound-ID transaction and
identity-verification procedure with `is_admin = 0`. Preserve a known administrator
when administrator access is needed. A designated human who must update their
password has `isAdmin: false` until that requirement is cleared.

For an administrator who cannot log in, another accessible human administrator
can perform the temporary-password reset; the target then logs in and rotates it
through `/api/auth/profile`. If no administrator is accessible but an operator
controls another human's login, use the offline, backed-up, ID-verified promotion
procedure above for that human first. If no human login is accessible, offline
operator credential recovery is required; this phase provides no online recovery
or role-management endpoint. Changing seed environment credentials does not reset
an existing account.

### Channel Visibility Rules

- `PUBLIC` channels are visible to all authenticated humans.
- `PRIVATE` channels are visible to:
  - the owner (`channels.owner_human_id`)
  - explicitly subscribed humans (`channel_subscriptions` with `subscriber_type=HUMAN`)
  - humans who belong to a subscribed team (`channel_subscriptions` with `subscriber_type=TEAM` + `team_memberships`)
  - explicitly shared human viewers (`channel_viewers` with `viewer_type=HUMAN`)
- `channel_viewers` grants read-only visibility. Shared viewers can read channel metadata/messages but cannot post events or mutate channel participants/settings.
- `channel_share_links` are claim tokens. Visiting a link and calling the claim endpoint adds the authenticated human to `channel_viewers`.

### Runner Auth

- Trusted runner token header: `x-orgops-runner-token`. Its presence is authoritative for shared authentication: an invalid or empty value returns `401` and cannot fall through to a human session cookie.
- Runner-only endpoint for secret env injection: `GET /api/secrets/env`
- Runner secret env requests must include `x-orgops-agent-name`; optional `x-orgops-channel-id` enables team-scope resolution for that channel context.
- Invite redemption can mint runner tokens in either mode:
  - `SCOPED` (default): restricted to one agent and one runner ID, and by default restricted to invite-approved channels.
  - `GLOBAL`: behaves like a normal unrestricted runner token (full runner access).
- `POST /api/agent-invites` accepts authenticated humans and runner-authenticated agents.
- Scoped invites can later be promoted to global mode with `POST /api/agent-invites/:id/promote-global`; this updates the invite and any non-revoked redeemed runner tokens from that invite.

### Tool Filesystem Access

Runner tools resolve paths through an allowlist:

- default: agent workspace root only
- if `allowOutsideWorkspace=true`: full host root allowed
- extra allowed roots: enabled skill directories

This applies to native OrgOps tools only. `WRAPPED` agents do not use OrgOps tool filesystem access; their external runtime enforces its own filesystem policy.

## Realtime (WebSocket)

Endpoint: `GET /ws`

Client messages:

```json
{ "type": "subscribe", "topic": "channel:..." }
{ "type": "unsubscribe", "topic": "channel:..." }
{ "type": "ping" }
```

Server messages:

```json
{ "type": "subscribed", "topic": "..." }
{ "type": "event", "topic": "...", "data": { "...": "..." } }
{ "type": "process_output", "topic": "process:...", "data": { "...": "..." } }
{ "type": "agent_status", "topic": "org:agentStatus", "data": { "...": "..." } }
{ "type": "dashboard_refresh", "topic": "org:dashboard", "data": { "...": "..." } }
{ "type": "error", "message": "..." }
```

For non-runner websocket clients, `event` messages with future `deliverAt` are deferred and delivered when due (`deliverAt <= now`) to match non-runner `GET /api/events` visibility while preserving realtime pacing for scheduled events. Runner-authenticated websocket clients still receive future scheduled events immediately.

Published topics include:

- `org:events`
- `channel:<channelId>`
- `process:<processId>`
- `org:agentStatus`
- `org:dashboard`
- `agent:<name>`-style source topics for agent-sourced events

## HTTP API Surface

### Auth / Humans

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `PATCH /api/auth/profile`
- `GET /api/humans`
- `POST /api/humans/invite`
- `POST /api/humans/:id/reset-temp-password`
- wrapped-agent invites:
  - `GET /api/agent-invites`
  - `POST /api/agent-invites`
  - `POST /api/agent-invites/:id/revoke`
  - `POST /api/agent-invites/:id/reissue` (rotates token; old link invalid)
  - `POST /api/agent-invites/:id/promote-global` (switches scoped invite/tokens to global mode)
  - `GET /api/agent-invites/public/:token` (public)
  - `POST /api/agent-invites/public/:token/redeem` (public)
  - `channelIds` is optional on create (invite may grant lifecycle-only bootstrap access)
  - create payload supports `visibility` (`PUBLIC`/`PRIVATE`) applied to the wrapped agent at redeem time
  - create payload supports `runnerScopeMode` (`SCOPED` default, or `GLOBAL`)
  - invite list/create responses include creator metadata (`createdByType`, `createdById`)
  - invite links are resolved from request origin (`x-forwarded-*` or request URL), not hardcoded localhost
  - public invite/redeem responses include bootstrap hints (`wrappedConfigSchema`, patch endpoint, and session-memory guidance)

### Embed / v1 (integration API keys)

- `GET /v1/me` (Bearer integration key)
- `POST /v1/conversations`
- `GET /v1/conversations/:id`
- `POST /v1/chat/completions` (`conversation` required; waits for the agent reply)
  - accepts text-only user messages and mixed content arrays (for example `text` + `image_url`)
  - supports optional top-level `attachments` array (`[{ fileId, ... }]`)
  - attachment references are normalized from `messages[].content` or `attachments`, then persisted on the emitted `message.created` payload as `payload.attachments[]` with file metadata
- Admin key management: `GET/POST /api/integration-keys`, `POST /api/integration-keys/:id/revoke`
- Integrator prompt: copy from admin UI → API keys

### Models

- `GET /api/models`
- `POST /api/models`
- `PATCH /api/models/:id`

### Agents

- `GET /api/agents`
- `POST /api/agents`
- `GET /api/agents/:name`
- `PATCH /api/agents/:name`
  - changing an agent's `name` via patch is currently rejected (rename unsupported)
- supports `assignedRunnerId` on create/update/read
- supports `wrappedConfig` JSON object/string on create/update/read
- supports `GET /api/agents?assignedRunnerId=<runnerId>` filtering
- supports `GET /api/agents?assignedRunnerId=<runnerId>&includeUnassigned=1`
- `POST /api/agents/:name/:action` where action is one of:
  - `start`, `stop`, `restart`, `reload-skills`, `cleanup-workspace`
- debug endpoint:
  - `GET /api/agents/:name/debug/system-prompt`
- workspace browser endpoints:
  - `GET /api/agents/:name/workspace`
  - `GET /api/agents/:name/workspace/file`
  - `GET /api/agents/:name/workspace/download`

### Teams / Channels / Conversations

- teams:
  - `GET /api/teams`, `POST /api/teams`, `PATCH /api/teams/:id`, `DELETE /api/teams/:id`
  - `POST /api/teams/:id/delete` (compat)
  - `GET /api/teams/me` (returns current authenticated human's teams)
  - membership: list/add/remove endpoints
- channels:
  - CRUD/list/clear: `GET/POST/PATCH/DELETE /api/channels...`
  - `GET /api/channels` includes `participants[]`, `shares[]`, plus per-request booleans `canPost` and `canManage`
  - `PATCH /api/channels/:id` supports `name`, `description`, `metadata`, and `visibility` (`PUBLIC`/`PRIVATE`)
  - participant management via subscribe/unsubscribe endpoints (`AGENT`, `HUMAN`, `TEAM`)
  - read-only share management:
    - `GET /api/channels/:id/shares`
    - `POST /api/channels/:id/share` (`viewerType`: `AGENT`/`HUMAN`)
    - `POST /api/channels/:id/unshare`
  - tokenized share-link flow:
    - `POST /api/channels/:id/share-link` (creates a claim token)
    - `POST /api/channel-share-links/:token/claim` (authenticated human claims viewer access)
  - direct channel creation:
    - `POST /api/channels/direct`
    - `POST /api/channels/direct/human-agent`
    - `POST /api/channels/direct/agent-agent`
- conversations/threads:
  - `GET /api/conversations`, `POST /api/conversations`
  - `GET /api/conversations/:id/threads`, `POST /api/conversations/:id/threads`

### Events

- `POST /api/events`
- `GET /api/events`
  - query supports filters (`channelId`, `type`, `source`, `status`, `after`, `before`, `limit`, `order`)
  - `scheduled=1` returns future pending scheduled events
  - `scheduled=1&includeConsumed=1` returns scheduled history (both future and consumed)
- `GET /api/events/:id`
- `PATCH /api/events/:id` (future scheduled `PENDING` events only)
- `POST /api/events/:id/ack`
- `POST /api/events/:id/fail`
- `DELETE /api/events` (filtered or all clear)
- `DELETE /api/events/:id` (future scheduled `PENDING` events only)
- `DELETE /api/channels/:channelId/messages`
- `GET /api/event-types`

### Memory

- channel memory:
  - `GET /api/memory/channel/recent`
  - `PUT /api/memory/channel/recent`
  - `GET /api/memory/channel/full`
  - `PUT /api/memory/channel/full`
- cross-channel memory:
  - `GET /api/memory/cross/recent`
  - `PUT /api/memory/cross/recent`
  - `GET /api/memory/cross/full`
  - `PUT /api/memory/cross/full`
- maintenance:
  - `DELETE /api/memory`

### Runtime/Processes/Files

- files: upload/get/meta
- processes:
  - list/create/delete single/delete bulk
  - append output, mark exit, read output stream tail

### Secrets / Skills

- secrets:
  - `GET /api/secrets`
  - `GET /api/secrets/keys`
  - `POST /api/secrets`
  - `DELETE /api/secrets/:id`
  - `DELETE /api/secrets` (by key/scope tuple)
  - `GET /api/secrets/env` (runner auth only)
  - scope types: `public`, `team`, `private` (`package` remains supported as legacy compatibility scope)
  - env resolution precedence: `private > team > public > package(legacy)`
- skills:
  - `GET /api/skills` (authenticated legacy local-only compatibility shape)
  - `GET /api/skills/inventory` (authenticated, strict `agentId?`, `q?`, `origin=ALL|LOCAL|CATALOG`, and `availability=ALL|INSTALLED|AVAILABLE` query)
  - `GET /api/agents/:agentId/skills` and `GET /api/agents/:agentId/skills/history` (authenticated, deep manageability authorization)
  - `PATCH /api/agents/:agentId/skills` (canonical local/catalog batch command)
  - `POST /api/agents/:agentId/skills/preflight` (bounded selection preflight)
  - `GET /api/agents/template-options` and `POST /api/agents/provision` (strict metadata/readiness template options and atomic provisioning)
  - `GET /api/agents/:name/start-readiness` (privacy-safe owner/admin central start-gate dry-run)
  - `POST /api/agents/:name/:action` for `start`, `stop`, `restart`, `reload-skills`, and `cleanup-workspace`
  - `PUT|DELETE /api/agents/:name/catalog-skills/:packageReleaseId` (legacy normalized catalog adapter)

Unified skill inventory reads combine trusted local skill evidence with approved catalog `kind=skill` releases. Catalog releases are identified by exact package release ID, version, and digest; an approved visible release that is not installed is projected as `AVAILABLE` and blocked by `INSTALLATION_REQUIRED`. Ordinary human projections are bounded and reject all administrator provenance, source, host, and secret fields. The strict administrator catalog provenance includes authority/content Source IDs, catalog/package commits, package path, Source readiness, review/install and API activation states, current grant count, bounded compatibility, and exact Overview/Contents/Security links for the Source/release; local provenance is only the explicit local marker. Inventory reads are observational and do not install, activate, assign, deploy, create agents, or start processes. Canonical inventory, skill, and provisioning adapters share one exhaustive fixed mapper: `REMOVED=409`, `SOURCE_UNAVAILABLE=503`, `INSPECTION_FAILED=422`, `SYNC_FAILED=502`, with every other domain code retaining its documented status and fixed message. Routes reject unknown query keys and set `Cache-Control: no-store` before authentication. The legacy route remains local-only and its response shape is unchanged.

Source Library compatibility reads are `GET /api/library/packages`, `GET /api/library/packages/:packageReleaseId`, `GET /api/library/packages/:packageReleaseId/manageable-agents`, and `GET /api/library/packages/:packageReleaseId/template-options`; template instantiation is `POST /api/library/templates/:packageReleaseId/instances`, secret binding is `PUT /api/library/agents/:agentId/requirements/:requirementName/secret-binding`, and normalized catalog adapters remain under `/api/agents/:name/catalog-skills/:packageReleaseId`. These routes preserve strict actor projections and no-store behavior; retired `/api/catalogs` paths are ordinary principal-independent `404` responses.

### Runners

- `GET /api/runners`
- `GET /api/runners/setup-config` (authenticated human users)
- `POST /api/runners/invites` (authenticated human users; creates scoped runner bootstrap invite)
- `GET /api/runners/invites/:token` (public invite bootstrap payload for opscli)
- `POST /api/runners/register` (runner auth; register/re-register)
- `PATCH /api/runners/:id` (authenticated human users; rename runner display name)
- `POST /api/runners/:id/heartbeat` (runner auth)
- `GET /api/runners/:runnerId/package-deployments` (runner auth)
- `POST /api/runner-package-deployments/:deploymentId/claim` (runner auth)
- `GET /api/runner-package-deployments/:deploymentId/artifact` (runner auth + attempt-token header)
- `POST /api/runner-package-deployments/:deploymentId/report` (runner auth + attempt-token header)
- `DELETE /api/runners/:id` (also unassigns pinned agents from deleted runner)
- scoped runner tokens must register/heartbeat and deliver only the runner/agent IDs bound into their scope

## Agent Runner Behavior

Runner loop:

1. Register runner identity at API on startup and persist stable runner ID locally.
2. Heartbeat, then process the bounded package-deployment queue sequentially.
3. Poll agents from API only after package processing.
4. Select only agents assigned to this runner ID.
5. For each `desired_state=RUNNING` agent:
   - ensure workspace exists
   - heartbeat runtime state to API
   - emit one-time lifecycle bootstrap event (`agent.lifecycle.started`) for native modes, or run wrapped lifecycle setup for `WRAPPED`
5. Pull pending events with per-agent receipt semantics.
6. Filter control/audit/self-authored/agent-authored events.
7. Group remaining pending events by channel and process each channel as a single handling batch.
8. Execute by agent mode:
   - `CLASSIC`: call LLM, enforce JSON event output with retries, validate and emit.
   - `RLM_REPL`: run recursive REPL loop in child process with explicit `done(result)`.
   - `WRAPPED`: skip orgops memory/prompt/skills/model calls and run the configured external runtime recipe.
9. For native modes, build context from system prompt + bounded channel history + skills + soul, plus a synthetic merged-trigger message when a batch contains multiple events.
10. For native modes, run model generation in step mode (single-step/attempt calls) and poll pending events for the same `(agent, channel)` between attempts; newly arrived events are merged into subsequent attempt context.
11. On handler failure, call `/api/events/:id/fail` for each event in the failed channel batch.

Wrapped lifecycle:

1. When a `WRAPPED` agent first reaches `desired_state=RUNNING`, the runner resolves its `wrappedConfig` and selects a wrapper harness.
2. The selected harness owns setup. For the built-in `command` harness, `source.type="github"` clones the repo into the agent workspace if missing.
3. For the built-in `command` harness, `setup.checkCommand` exits `0` to skip setup; otherwise `setup.command` runs when provided.
4. Wrapper lifecycle emits `wrapper.lifecycle.started`, `wrapper.setup.started`, `wrapper.setup.skipped`, `wrapper.setup.completed`, or `wrapper.setup.failed`.
5. On each turn, the runner builds normalized `message` and `sessionId`, then calls the selected harness `runTurn`.
6. Harness output is normalized into `message.created` from `agent:<name>`.
7. Wrapper turn events (`wrapper.turn.started/completed/failed`) are bookkeeping and never wake agents.

Shutdown behavior:

- stops RLM children
- terminates tracked long-running processes

## Runner Tooling

Current tool families exposed to models:

- `shell_run` (timeout enforced; default 45s; accepts `timeoutMs`; force-kills on timeout)
- `fs_read`, `fs_write`, `fs_list`, `fs_stat`, `fs_mkdir`, `fs_rm`, `fs_move`
- `shell_start`, `shell_stop`, `shell_status`, `shell_tail`
- event/navigation helpers:
  - `events_emit`
  - `events_channel_messages`, `events_search`
  - `events_channel_create`, `events_channel_update`, `events_channel_delete`
  - `events_channel_participants`, `events_channel_participant_add`, `events_channel_participant_remove`
  - `events_channels_list`, `events_event_types`, `events_scheduled_create`, `events_schedule_self`
- agent management helpers:
  - `agents_search`, `agents_create`

Audit events are emitted around tool/process operations and RLM execution.

## OpsCLI Behavior

`apps/opscli` is a standalone host bootstrap/maintenance CLI with deterministic commands and an optional chat loop.

- deterministic commands:
  - `install` (prereq checks + clone/pull repo + `npm ci` + component-scoped build/config)
  - `upgrade` (safety backup + component-scoped stop/update + optional restart)
  - `doctor` (host prerequisite check)
  - `start` / `stop` / `status` for selected components (`api`, `runner`, `user-ui`, `admin-ui`)
  - `admin open` / `admin stop` / `admin status` convenience wrappers for `admin-ui`
  - install/upgrade support runner bootstrap via:
    - explicit `--runner-api-url` + `--runner-token` (+ optional `--runner-name`)
    - invite bootstrap URL from `GET /api/runners/invites/:token`
- optional `chat` command:
  - plain tool-calling loop (`shell`, `askPassword`, `getBundledDocs`, `exitOpscli`)
  - rolling summarization + context-capped history
  - prompts for provider API keys only in chat mode
- release build embeds docs/build metadata for chat context (not a full source snapshot)
- auto-start registration is OS-specific:
  - macOS LaunchAgent
  - Linux systemd user service
  - Windows Scheduled Task

Security note: wrapped `source`, `setup.command`, and `runtime.command` are host code execution. Native orgops agents and opscli should treat GitHub-derived wrapper recipes as privileged changes and should prefer explicit user approval or trusted repo allowlists before enabling them on shared hosts.

## Delivery and Failure Semantics

- at-least-once delivery model
- per-agent delivery tracking through `event_receipts`
- idempotency supported with `idempotencyKey`
- scheduled delivery via `deliverAt`
- failure escalation via `/api/events/:id/fail` until dead-letter (`event.deadlettered`) at configured threshold

## Environment Variables (Implemented)

- `PORT`
- `ORGOPS_API_URL`
- `ORGOPS_RUNNER_TOKEN`
- `ORGOPS_RUNNER_ID_FILE`
- `ORGOPS_RUNNER_NAME`
- `ORGOPS_ADMIN_USER`, `ORGOPS_ADMIN_PASS`
- `ORGOPS_MASTER_KEY`
- `ORGOPS_COOKIE_SECURE`
- `ORGOPS_EVENT_MAX_FAILURES`
- `ORGOPS_EVENT_SHAPES_CACHE_TTL_MS`
- `ORGOPS_RUNNER_ONLINE_THRESHOLD_MS`
- `ORGOPS_PROJECT_ROOT`
- `ORGOPS_LLM_STUB`
- `ORGOPS_LLM_CALL_TIMEOUT_MS`
- `ORGOPS_HISTORY_MAX_EVENTS`, `ORGOPS_HISTORY_MAX_CHARS`
- `ORGOPS_CHANNEL_RECENT_MEMORY_INTERVAL_MS`
- `ORGOPS_CHANNEL_FULL_MEMORY_INTERVAL_MS`
- `ORGOPS_CROSS_RECENT_MEMORY_INTERVAL_MS`
- `ORGOPS_CROSS_FULL_MEMORY_INTERVAL_MS`
- `ORGOPS_AGENT_INTENT_TIMEOUT_MS`
- `ORGOPS_AGENT_INTENT_MAX_TIMEOUTS`
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`
  - for native/wrapped runtime execution with injected env, provider keys are loaded from resolved secrets and do not fall back to host process env
- `OPENROUTER_BASE_URL`, `OPENROUTER_HTTP_REFERER`, `OPENROUTER_APP_TITLE`
- `ORGOPS_GIT_BASH_PATH`
- `ORGOPS_SHELL_PATH`, `ORGOPS_SHELL_ARGS`
- `ORGOPS_SHELL_TIMEOUT_KILL_GRACE_MS`
- Admin UI build/runtime config:
  - `VITE_API_BASE_URL`
  - `VITE_WS_BASE_URL`
  - optional runtime override: `window.__ORGOPS_UI_CONFIG__ = { apiBaseUrl, wsBaseUrl }`
- User UI build/runtime config:
  - `VITE_API_BASE_URL`
  - `VITE_WS_BASE_URL`
  - optional runtime override: `window.__ORGOPS_USER_UI_CONFIG__ = { apiBaseUrl, wsBaseUrl }`
- RLM controls:
  - `ORGOPS_RLM_MAX_STEPS`
  - `ORGOPS_RLM_MAX_OUTPUT_CHARS`
  - `ORGOPS_RLM_MAX_INPUT_CHARS`
  - `ORGOPS_RLM_PROMPT_PREVIEW_MAX_CHARS`
  - `ORGOPS_RLM_EVAL_TIMEOUT_MS`
  - `ORGOPS_RLM_MAX_SUBAGENT_DEPTH`
  - `ORGOPS_RLM_MAX_SUBAGENTS_PER_EVENT`
- OpsCLI controls:
  - `ORGOPS_OPSCLI_MODEL`
  - `ORGOPS_OPSCLI_TOOL_LOOP_MAX_STEPS`
  - `ORGOPS_OPSCLI_COMMAND_TIMEOUT_MS`
  - `ORGOPS_OPSCLI_MAX_CONTEXT_CHARS`
  - `ORGOPS_OPSCLI_MAX_SUMMARY_CHARS`
  - `ORGOPS_OPSCLI_SUMMARY_CHUNK_MESSAGES`
  - `ORGOPS_OPSCLI_MIN_RECENT_MESSAGES`
  - `ORGOPS_OPSCLI_MAX_SYSTEM_DOC_CHARS`
  - `ORGOPS_OPSCLI_PROGRESS`
  - `ORGOPS_OPSCLI_SPINNER`
  - `ORGOPS_OPSCLI_LOG_PATH`
  - `ORGOPS_OPSCLI_DOUBLE_SIGINT_MS`
  - `ORGOPS_EXTRACTED_ROOT` (auto-managed by OpsCLI)

## Administrator Source Library UI

The administrator navigation exposes **Source Library** (the retired Catalogs link is not shown) only to a live administrator who is authenticated and has completed any required password change. Source Library remains a separate top-level workspace, not a Skills child. It is a closed-by-default master/detail view: no Source or release is auto-selected, and the +Add Source drawer is closed until invoked. Source and release selections are URL-addressable with `source`, `release`, and `tab` query keys; valid values restore on load/back/forward while invalid or unauthorized values clear prior detail/activity, remove typed keys, and render one fixed bounded unavailable/not-found state without enumerating hidden resources. Detail requests are generation-owned and abortable so stale history responses cannot overwrite the current selection. The detail workspace has exactly five readable tabs: Overview, Compatibility, Contents, Security, and Activity.

The Source view is metadata-only and always displays the read-only `catalog/index.json` path, display name, repository identity/ref, source enabled state, and independent **External package permission**. The permission is off by default and uses the exact accessible copy “Allow packages from other Sources”: it means this Source index may reference content in another configured trusted Source; credentials remain Source-scoped and never shared. It appears in Source Security and the add drawer, never Skills. Read credentials are represented only as absent/configured masked state; credential fields are cleared synchronously before any request and are never rendered after submission. Creating a Source consumes the authority response's immediate sync receipt, keeps a failed newly-created Source selected for retry, and preserves last-good snapshots/releases. Contextual errors are keyed by target and code, so repeated identical failures are deduplicated while distinct failures remain visible.

Release detail is immutable and displays both source IDs, catalog/package commits, package path/digest, manifest/dependencies/attribution/portable metadata, API event-shape and runner-script previews, wrapped commands, external sources, warnings, file modes/sizes/digests, review identity/digest/time/revision, installation state, and API execution state. Review/install are separate from API execution. API execution has separate digest-bearing confirmations for APPROVE, ACTIVATE, and DEACTIVATE with exact state preconditions. Organization grants explicitly apply to current and future users; human grants show revisions and revocation independently of review/install conditions.

Rollout administration uses an explicit finite target list (1–256 unique IDs, preserving order) and plan digest. Confirmation is acknowledgement-gated and includes the exact digest, operation/preload, ordered IDs, and blockers; any blocker disables confirmation. Successful mutations advance the validated local projection (or require an explicit reload), and malformed success payloads fail as protocol errors without rendering. Target cards expose the returned finite-state projection, including `QUEUED`, `STAGING`, `WAITING_FOR_IDLE` (rendered “Waiting for agent to become idle”), `SUCCEEDED`, `FAILED`, `SKIPPED`, and `SUPERSEDED`; cancel/retry controls are shown only when returned eligibility allows them. Conflict or sync failure preserves last-good data, blocks writes, and requires an explicit successful reload. A successful HTTP/domain response containing a terminal non-success sync receipt (`FAILED` or `ABANDONED`, with any future terminal state treated likewise) is also a UI sync failure: the receipt is retained, failure code is surfaced with a `SYNC_FAILED` fallback, retry remains available, and a successful retry clears the matching target error, unblocks writes, and refreshes last-good snapshot data.

At a 390px viewport tables stack or wrap as cards; digests and paths break safely and no source, release, API, grant, or rollout view introduces horizontal overflow. Interactive controls use labels/fieldset legends, keyboard focus, `aria-busy`, live status, alert errors, and focus restoration after dialogs and mutations.

### User package Library compatibility routes

The user workspace no longer exposes a Library navigation item, route, screen, controller, or management controls. `/library` (including query and channel deep links) is normalized to the ordinary conversation workspace without redirecting to administrator Skills or Source Library; conversation deep links, authentication, password changes, logout, and browser back/forward behavior remain conversation behavior.

The privacy-safe `/api/library/*` compatibility adapters remain available for server-authorized authenticated humans, including package list/detail, manageable-agent projection, template options/instance creation, secret binding, assignment, and rollout operations. Their fixed DTOs contain only the bounded granted/installed projections and redacted operation state; source provenance, review internals, credentials, files, and commands remain administrative data. Routes set `Cache-Control: no-store` before authentication, reject caller-selected identity and malformed/query-bearing requests with fixed errors, and preserve the existing `NO_GRANTS`, `NOT_INSTALLED`, and `NO_COMPATIBLE_RELEASES` distinctions. These backend adapters are retained for compatibility and are not a user-ui management surface.

### Final source-library acceptance coverage

The repository includes an independently executable deterministic acceptance scenario at
`scenarios/catalog-source-library/catalog-source-library.test.ts`, invoked by
`npm run scenario:test:catalog-source-library`. It composes two isolated `createApp`
instances with local Git repositories, source-scoped encrypted read credentials,
format-v1 skill/native CLASSIC/native RLM/wrapped manifests, and no network or live
credentials. The scenario exercises sync, exact review/install/grant, stopped template
creation, required-secret start gating, and isolation/redaction assertions. The API
security integration matrix covers named human, agent, runner, invalid-header, and
anonymous principals across source, release, consumption, rollout, and runner route
families. The runner acceptance test uses `AgentRuntimeGeneration` with real isolated
filesystem generations and verifies restart, foreign binding, and byte tamper rejection.

### Unified agent skill management

Agent skill mutations use the canonical `PATCH /api/agents/:agentId/skills` command boundary. A command is either a local desired JSON mutation or a normalized catalog assignment mutation; strict bodies are UTF-8, bounded to 16 KiB, and responses are never cacheable. The management transaction authenticates a live human, checks manageability and expected revisions before persistence, updates local desired/effective STABLE state without creating local deployment rows, and writes normalized catalog desired state separately from deployment-effective state. A batch validates all commands first, increments the agent revision once, writes assignment audits transactionally, and enqueues at most one complete catalog generation for the exact final set (including an empty final set); local-only batches enqueue none. Migration 043 adds the bounded `removal_requested` tombstone marker and index. Migration 044 adds the foreign-keyed `agent_provision_operations` receipt table, and migration 045 rebuilds it around the actor-scoped composite primary key `(actor_human_id,operation_id)` while preserving receipts, checks, foreign keys, and the digest index. Migrations 043–045 preserve existing agents, assignments, and provision receipts on upgrade and are included in fresh-database migration order; repeated migration runs are idempotent. Legacy catalog assignment endpoints remain compatibility adapters and do not expose runner authority. Skill history is bounded and filtered by the same actor authorization and discriminated local/catalog identity. Local mutations append a typed `audit.skill.changed` event with actor, agent, operation, revision, and path-free local refs; catalog history consumes the existing typed catalog assignment audit. Legacy catalog assignment routes and generic agent skill-array PATCHes are compatibility adapters into the canonical transaction-scoped management seam, preserving their response and revision contracts.

`removal_requested=1` is an internal catalog-assignment tombstone. Inventory, Library manageable-agent projections, rollout/current-assignment reads, collision checks, start gates, catalog-derived compatibility checks, and reassignment candidates treat it as absent; only the exact removal deployment runner path may consume it as an anchor. Resurrection is available only through canonical `ASSIGN` with `expectedAssignmentRevision: 0`; this token means absent-or-tombstone and clears the marker only after the live release/grant/install/collision checks. A tombstone's internal revision is never disclosed or accepted from the client, and active non-tombstone assignments still reject revision zero. All consumers select and validate the marker so corruption cannot silently become absence.

Each catalog assignment command appends an exact strict `audit.catalog.assignment.changed` snapshot containing the canonical operation, deployment ID, desired generation, command-time effective generation, deployment state/failure, and assignment revision. History begins with that immutable snapshot and may advance state, failure, and—only for that exact deployment reaching `ACTIVE`—effective generation from the exact deployment row. It never consults the assignment's current active generation for an older command. History operations exclude `LOCAL_BATCH`; states and failure codes use closed enums. Local batch compatibility updates emit one audit per changed ref: `ADD` for absent-to-present, `REMOVE` for present-to-absent, and `SET_PRELOAD` only for retained preload changes, while canonical `ENABLE` and `DISABLE` retain their operation names.

The admin Agents drawer exposes an existing-agent Skills tab backed by the same strict inventory and picker used during creation. It sends current agent and assignment revisions to the canonical PATCH boundary and uses the canonical preflight and bounded history routes. Local changes report desired and effective `STABLE` immediately for future turns; the runner's captured active-turn snapshot is unchanged. Catalog changes keep desired and effective projections distinct: internal `STAGED`/`WAITING_FOR_IDLE` deployment progress is presented as public `DEPLOYING`, and failures or supersession retain the prior effective generation. Tombstoned removals disappear from inventory while their history remains available. UI reloads on revision conflicts and does not optimistically claim catalog activation.
