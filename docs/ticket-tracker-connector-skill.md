# Proposal: a generalized ticket-tracker connector skill pattern

**Status:** proposal, not yet adopted. Submitted from a private fork of this project,
maintained independently, from a personal account, not on behalf of any employer.

**Provenance note.** This document and the example skill tree it ships
(`skills/ticket-tracker-example/`) generalize a shape observed in a private fork's own
ticket-tracker connector skill. The example was written from scratch for this proposal against
that shape's description only -- no fork source file is copied, quoted, or stripped down here.
Wherever the fork's own artifact would otherwise need to be named specifically (a tenant
hostname, a project-key literal, individual test file names), this document says so explicitly
at the point of citation and describes the mechanism behaviorally instead. That is a deliberate
withholding, not an unverified claim.

## The problem, in this repo's own terms

This project documents two-part `SKILL.md` + `assets/*` skills. At upstream `main`
(`145f17f6b06df139ff506573f09797900f0dfe79`, confirmed live 2026-09-20 via
`git ls-remote https://github.com/camplight/orgops.git main`), `skills/secrets/SKILL.md` already
establishes a verb-per-section convention for one non-ticket skill -- confirmed by direct read,
re-grepped live: line 30 `### Set a secret (legacy package helper)`, line 42 `### List secret
keys`, line 57 `### Delete a secret`. `skills/secrets/assets/list-keys.ts` confirms the paired
runtime convention: line 2, `const token = process.env.ORGOPS_RUNNER_TOKEN;` -- a credential
resolved from the environment and checked before any network call.

**No ticket-tracker analog exists upstream.** A full recursive listing of upstream's own
`skills/` tree (`git ls-tree -r --name-only upstream-live/main -- skills`, re-run live) returns
exactly: `agent-management/SKILL.md`, `browser-use-lightpanda/{SKILL.md,assets/*}`,
`coordination/SKILL.md`, `gcli/{SKILL.md,assets/ensure.ts}`, `secrets/{SKILL.md,assets/*}`,
`slack/{SKILL.md,assets/*}`, `tavily/{SKILL.md,assets/*}`, `trello-cli/{SKILL.md,assets/*}` --
no `jira`, no other ticket-tracker name, anywhere. A direct attempt to read one,
`git show upstream-live/main:skills/jira/SKILL.md`, fails with `fatal: path 'skills/jira/SKILL.md'
exists on disk, but not in 'upstream-live/main'` (confirmed live, exit 128): that path exists
only in one fork's own working tree.

The convention is real and upstream-present. Its application to an external ticket tracker is
not. That is the gap this proposal fills.

## What is proposed

Not a fix to any existing file -- a new example skill, plus a design note describing the seam it
demonstrates.

**Scope in:** the `SKILL.md` + `_lib.mjs` + verb-per-file (`can`, `check`, `create`, `get-issue`,
`search`, `update`) shape, generalized to "a ticket tracker," with host/project/auth resolution
pulled into named, swappable configuration, and a per-invocation credential lookup consistent
with `skills/secrets`' own env-sourced token convention.

**Scope out:** any specific tracker host, any single hardcoded project scope, a shared-PAT
credential model, and any tracker-specific field mapping. This example is illustrative, not a
finished integration with any named product.

**The seam being demonstrated:** extract the REST calls behind a small adapter interface
(`getIssue`, `search`, `create`, `update`, `canTransition`); move host/project/auth into
skill-declared configuration (environment variables, in this reference implementation); replace
a single shared credential with a per-invocation credential lookup, resolved separately from
configuration, the way `skills/secrets` already resolves its own runner token.

**Deliverable:** this design note, plus a de-identified example skill tree at
`skills/ticket-tracker-example/` -- `SKILL.md` plus `assets/{_lib,can,check,create,get-issue,
search,update}.mjs`, mirroring the two-part convention `skills/secrets` already establishes, but
generalized to a tracker-agnostic shape. That is 7 asset files (`_lib.mjs` plus 6 verb files) and
one `SKILL.md`, 8 files total.

## Passing demonstration

`can.mjs`, this proposal's own permission-check verb, run with a complete but entirely
fabricated (non-secret) configuration, against Node `v25.2.1`:

```
$ TICKET_TRACKER_BASE_URL=https://tracker.example.com/rest/api \
  TICKET_TRACKER_PROJECT_KEY=DEMO \
  TICKET_TRACKER_EMAIL=demo@example.com \
  TICKET_TRACKER_API_TOKEN=dummy-token \
  node skills/ticket-tracker-example/assets/can.mjs view
{"ok":true,"action":"view","description":"read the issue","reason":null}
$ echo $?
0
```

This is a genuine, reproducible, offline pass: real JSON output, exit `0`, and no network call
attempted -- `can.mjs` calls `ready()` first, then checks the requested action against its own
in-process catalogue; it never reaches `request()` at all. `check.mjs` with the same four
environment variables is an equally genuine, simpler alternative
(`{"ok":true,"config":{...},"credential":{...}}`, exit `0`) if a plainer readiness check is
preferred as the opening example. Both were run and captured for real while verifying this
proposal's own example tree; see "Verifying the example tree," below, for the full run.

## Real, dated, reproducible evidence

### The failing demonstration

Command: `node --import tsx skills/secrets/assets/list-keys.ts`, same extraction method, no
arguments (matching the bare invocation shown in `skills/secrets/SKILL.md` line 47). Durable
symbol: `const token = process.env.ORGOPS_RUNNER_TOKEN;` at line 2 of the extracted file.
Verbatim stderr:

```
ORGOPS_RUNNER_TOKEN is required
```

Exit code: `1`. This is a clean, informative failure, not a crash: the script checks its one
required credential before attempting any network call and exits deterministically when it is
absent. It demonstrates exactly the "credential resolved from environment, checked locally before
any HTTP call" convention this proposal's `_lib.mjs`/`ready()` seam carries into the
ticket-tracker example (see below).

### A second, non-competing ticket-adjacent skill, confirmed unmodified

`skills/trello-cli/{SKILL.md,assets/ensure.ts,assets/run.ts}` is present both in one private
fork and upstream, and three separate `diff` runs (one per file) found zero output: the fork's
copy is byte-for-byte identical to upstream's. It is a thin CLI wrapper (`ensure.ts`, `run.ts`),
not the verb-per-file adapter shape this proposal generalizes, so it does not duplicate this
proposal -- if anything it strengthens the motivating problem: two independent, non-interoperable
ticket-tool skills already coexist in one fork, with no shared adapter interface between them.

### The fork-only artifact this proposal generalizes, described without reproducing it

A private fork carries a `SKILL.md` + `_lib.mjs` + six-verb-file skill for one specific,
internally-hosted ticket tracker (confirmed absent upstream by the same `git show` failure
pattern shown above, for every one of its files). Its shared library resolves a base URL, a
single project, and auth from configuration; checks credential presence before any request;
constructs an auth header; exposes a project-key scope guard gated to one literal project-key
prefix; and provides a small search-term tokenizer with a stopword list. Zero third-party
dependencies -- Node builtins plus global `fetch` only, confirmed by reading its imports.

**What is deliberately not reproduced here:** the tracker's hostname, the literal project-key
prefix the scope guard checks against, and the names of its 19-file test directory (12 of the 19
files reference that same project-key literal throughout their fixtures) -- all withheld per this
document's provenance note. Only the mechanism -- config-driven host/project/auth, a
credential-presence guard, a project-scope guard, a search tokenizer -- is carried into the
example this proposal ships; none of the fork's own literal values are.

**Can the shape stand alone upstream?** The verb files depend on nothing but Node builtins and
`fetch` -- no `package.json` addition needed, structurally easy to land. The blocker is content,
not code: the fork's own files bake one hostname and one project-key regex into `_lib.mjs`, which
is precisely what this proposal's seam (config-driven host/project/auth) replaces before the
example ships.

## The example skill tree this proposal adds

`skills/ticket-tracker-example/` (full listing: `SKILL.md`,
`assets/{_lib,can,check,create,get-issue,search,update}.mjs`). Every verb calls a single
`ready()` function first (`assets/_lib.mjs`); if configuration (`TICKET_TRACKER_BASE_URL`,
`TICKET_TRACKER_PROJECT_KEY`, `TICKET_TRACKER_EMAIL`) or the credential
(`TICKET_TRACKER_API_TOKEN`) is missing, the verb prints that JSON verdict and exits 1 without
attempting a network call -- the same convention demonstrated by `list-keys.ts` above. `can.mjs`
checks a requested action against a small, illustrative action catalogue without performing it.
`check.mjs` mirrors `gcli/assets/ensure.ts`'s own "one JSON object, exit 0 iff ready" shape.

### Verifying the example tree

All seven files were run for real, on Node `v25.2.1` (Darwin arm64), through every configuration
state a verb can see -- no configuration, configuration without a credential, and full
configuration -- and, for the four verbs that reach the network, against a throwaway local
HTTP server bound to loopback only, never a live external host, so the request shape and error
handling could be checked without contacting any real tracker. `node --check` confirms all seven
files are syntactically valid. Five of the seven scripts (`_lib.mjs`'s non-network helpers,
`check.mjs`, `can.mjs`) behaved exactly as documented on the first run. Two defects were found in
the other paths and fixed in place before this document was finalized; both are described in
full in Limits, below, because both matter directly to whether this convention can be trusted --
not because they are minor.

## Reproduction recipe

Run from any local clone with `upstream-live/main` fetched at `145f17f` (create it if missing:
`git fetch https://github.com/camplight/orgops.git main:refs/remotes/upstream-live/main`).

```bash
# 1. Confirm the tip live (read-only, no local write required)
git ls-remote https://github.com/camplight/orgops.git main

# 2. Set up an isolated scratch workspace
WORK=/tmp/spec04-probe
mkdir -p "$WORK/upstream-tree/skills/secrets/assets" \
         "$WORK/upstream-tree/skills/gcli/assets" \
         "$WORK/upstream-tree/skills/trello-cli/assets"

# 3. Extract real upstream file contents (never copied from any plan or report)
git show upstream-live/main:skills/secrets/SKILL.md            > "$WORK/upstream-tree/skills/secrets/SKILL.md"
git show upstream-live/main:skills/secrets/assets/list-keys.ts > "$WORK/upstream-tree/skills/secrets/assets/list-keys.ts"
git show upstream-live/main:skills/gcli/SKILL.md               > "$WORK/upstream-tree/skills/gcli/SKILL.md"
git show upstream-live/main:skills/gcli/assets/ensure.ts       > "$WORK/upstream-tree/skills/gcli/assets/ensure.ts"
git show upstream-live/main:skills/trello-cli/SKILL.md         > "$WORK/upstream-tree/skills/trello-cli/SKILL.md"

# 4. Install the one missing runtime dependency the documented commands
#    themselves name (`node --import tsx ...`), pinned, into scratch only --
#    no project file is touched
mkdir -p "$WORK/npm-scratch" "$WORK/npm-cache"
npm install tsx --no-save --prefix "$WORK/npm-scratch" --cache "$WORK/npm-cache"
ln -s "$WORK/npm-scratch/node_modules" "$WORK/upstream-tree/node_modules"

# 5. Run the documented commands verbatim, from inside the extracted tree
cd "$WORK/upstream-tree"
node --import tsx skills/gcli/assets/ensure.ts        # passing demonstration
node --import tsx skills/secrets/assets/list-keys.ts  # failing demonstration

# 6. Try this proposal's own example tree (copy it in from this PR's
#    `skills/ticket-tracker-example/` directory first). No tsx needed --
#    it is plain .mjs, Node builtins and fetch only. Verified output below,
#    real, on Node v25.2.1.
node skills/ticket-tracker-example/assets/check.mjs
# real output: {"ok":false,"reason":"missing configuration: TICKET_TRACKER_BASE_URL, TICKET_TRACKER_PROJECT_KEY, TICKET_TRACKER_EMAIL"}, exit 1

node skills/ticket-tracker-example/assets/can.mjs view
# real output: the same missing-configuration verdict, exit 1 -- can.mjs also checks ready() first

# with configuration set but no credential:
export TICKET_TRACKER_BASE_URL=https://tracker.example.com/rest/api
export TICKET_TRACKER_PROJECT_KEY=DEMO
export TICKET_TRACKER_EMAIL=demo@example.com
node skills/ticket-tracker-example/assets/check.mjs
# real output: {"ok":false,"reason":"missing credential: TICKET_TRACKER_API_TOKEN"}, exit 1

# with everything set, can.mjs performs its offline catalogue check with no network call:
export TICKET_TRACKER_API_TOKEN=dummy-token
node skills/ticket-tracker-example/assets/can.mjs view
# real output: {"ok":true,"action":"view","description":"read the issue","reason":null}, exit 0
node skills/ticket-tracker-example/assets/can.mjs frobnicate
# real output: {"ok":false,"action":"frobnicate","description":null,"reason":"\"frobnicate\" is not in this adapter's action catalogue"}, exit 1

# 7. Exercise a network verb against a throwaway LOCAL server only (never a
#    live external tracker), to see the documented `--` separator resolve
#    correctly after the argument-parsing fix described in Limits:
node skills/ticket-tracker-example/assets/get-issue.mjs -- DEMO-1
# against a local mock bound to the same TICKET_TRACKER_BASE_URL above:
# real output: {"ok":true,"status":200,"body":{...}} on success, or
#              {"ok":false,"status":null,"body":null,"error":"network request failed: ..."} , exit 1,
#              if the host does not resolve -- never a raw stack trace.
```

Pinned versions used for the upstream probe: Node `v25.2.1`; `tsx` resolved by npm to `4.23.15`
(recorded from `node_modules/tsx/package.json` after install -- pin this exact version if
re-running later, since a newer `tsx` could behave differently). The example tree needs no `tsx`
and no dependency install at all; step 6/7 above were run and captured for real, also on Node
`v25.2.1`, on Darwin arm64.

## Limits -- read before trusting a green

- **A real defect was found, and fixed, inside this proposal's own example while verifying it --
  say so plainly, not as a footnote.** `SKILL.md` documents `get-issue.mjs`, `create.mjs`,
  `update.mjs`, and `search.mjs` with a literal `--` separator before their positional arguments
  (e.g. `node {baseDir}/assets/get-issue.mjs -- <issue-key>`). As first written, all four verbs
  read `process.argv.slice(2)` directly, with no awareness of that separator, so following the
  documented invocation exactly shifted every argument by one. Run against a throwaway local
  server exactly as documented, `update.mjs -- DEMO-1 "looks good"` posted the comment body
  `"DEMO-1"` (the intended issue key) to an issue literally named `"--"`, silently dropped the
  real comment text, and still reported `{"ok":true}`, exit `0` -- indistinguishable, from the
  JSON verdict alone, from a correct run. Against a real tracker this means: the wrong issue
  gets the wrong comment, and nothing signals the operator that anything went wrong. This is
  precisely the failure class the "one JSON verdict, checked before any network call" convention
  proposed here exists to prevent, and it happened inside the proposed example itself, not in
  some other script. It was caught only because the documented invocation was actually run
  against a real (local) server rather than assumed correct from a source read. The fix -- a
  `cliArgs()` helper in `_lib.mjs` that strips a leading `--` before the four verbs read their
  arguments -- is included in this PR; the verb-per-file shape, the config/credential seam, and
  every other function signature are unchanged. A related, second defect was found and fixed in
  the same pass: `_lib.mjs`'s `request()` had no error handling around `fetch`/`JSON.parse`, so
  an unreachable host or a non-JSON error response crashed the process with a raw Node stack
  trace instead of the adapter's own `{ok:false, error:"..."}` convention; `request()` now
  catches both failure modes and returns that shape instead of throwing.
- **The upstream convention this proposal generalizes already carries its own masked-failure
  risk, independent of the defects above.** `node --import tsx skills/gcli/assets/ensure.ts`, run
  against the file extracted verbatim from `upstream-live/main`, reports:

  ```
  {
    "ok": true,
    "gcloudVersion": "",
    "account": null,
    "project": null,
    "region": null,
    "zone": null,
    "warning": "gcloud is installed but account/project is not fully configured."
  }
  ```

  Exit code `0`, with `gcloud` confirmed entirely absent (`which gcloud` -> `gcloud not found`).
  `buildReport()` shells out to `gcloud --version | head -n 1` inside a `try`; because `head`, not
  `gcloud`, is the last command in that pipeline, the missing-binary case never throws --
  `gcloudVersion` becomes an empty string and the script reports `ok: true` instead of the
  `ok: false` path defined a few lines above it for exactly this case. This is genuine upstream
  behavior at `145f17f`, reproduced verbatim, not introduced by this document. Combined with the
  defect above, the pattern is consistent: a "one JSON verdict" convention is only as trustworthy
  as each individual script's own error handling -- the shape does not guarantee the content,
  and this document found that true both in existing upstream code and in its own freshly-written
  example.
- **No live reachability was tested for any real ticket tracker.** Every network-touching verb in
  this proposal's example was exercised only against a throwaway local HTTP server bound to
  loopback, never a live external host, and against `skills/secrets/assets/list-keys.ts` and
  `skills/gcli/assets/ensure.ts`'s own documented invocations. This proves the request shape,
  argument handling, and error handling are correct; it does not prove any real tracker's actual
  REST contract (response shape, auth scheme acceptance, status-code conventions) matches what
  `_lib.mjs` assumes. That requires a maintainer with real tracker credentials, which this
  verification pass did not have and by design should not need.
- **The environment gap in the two upstream `.ts` demonstrations (`tsx` absent by default) will
  recur for any reviewer of those two files.** A maintainer trying any `.ts`-based skill asset in
  this repository hits the identical `ERR_MODULE_NOT_FOUND: tsx` failure until they install it
  themselves; this is a pre-existing environment assumption of the whole `skills/` convention,
  not something this proposal adds or fixes. The example tree itself sidesteps this by shipping
  as plain `.mjs`.
- **Test-suite evidence for the fork-only artifact this proposal generalizes was read, not
  executed, in preparing this document.** The 19-file test directory's own claim of running with
  no live network was read from its source, not independently run under a test runner here;
  treat that specific claim as read-verified, not execution-verified.

## What this PR contains

Two new paths, nothing else: this document, and the example skill tree at
`skills/ticket-tracker-example/` (`SKILL.md` plus 7 asset files, 8 files total). No existing file
is modified, no dependency is added, and no CI workflow is touched.
