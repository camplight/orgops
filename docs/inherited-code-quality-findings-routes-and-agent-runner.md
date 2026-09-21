# Findings: inherited code-quality debt in the route and agent-runner handler cluster

**Status:** findings report, not yet adopted. Submitted from a private fork of this project,
maintained independently. No code change is proposed by this document; it is evidence, not a
patch.

## The problem, in this repo's own terms

`apps/api/src/routes/` and `apps/agent-runner/src/` together ship the HTTP route handlers and
the agent-runner's own turn/tool-execution handlers. At upstream `main`
(`255b33418a3094d8c61dc6e38a014e9134f4fae1`, confirmed live 2026-09-21 — see "Upstream tip
used" below), twenty-one functions across eleven of these files each branch far enough, and nest
deeply enough, that a widely-used complexity metric flags them well past a common
maintainability threshold — in the most extreme case, more than sixteen times over it.

Nothing in this repository's own tooling flags that shape today. There is no static-analysis
step in either of the two GitHub Actions workflows this repository runs
(`opscli-smoke.yml`, `release-main.yml`), and the `lint` script already defined in the root
`package.json` is not invoked by either workflow. A route handler, an agent-runner tool handler,
or an authorization gate can accumulate branches indefinitely, independently across eleven
files, with nothing measuring how large "large" has become.

## What is proposed

Not a fix — a measurement, offered as twenty-one findings a maintainer can act on however they
choose. This document reports, for each of the twenty-one functions below:

- the exact line where the function begins, anchored to its own name or route signature (not
  just a line number, which drifts as the file changes around it),
- its measured cognitive complexity, against a published threshold,
- the exact tool, exact pinned versions, and exact command used to measure it, so a reader can
  reproduce every number independently without asking the reporter to be trusted on faith.

No refactor is proposed or included. The twenty-one numbers below are real findings against real
files this project ships today; what to do about them — extract helpers, split the handler,
leave as-is — is left entirely to whoever upstream triages this.

**Scope note.** Ten of the eleven files in scope were always part of this cluster, including
`collab.ts` and its `PATCH /api/channels/:id` handler. The one file added beyond the original
cluster is `apps/api/src/routes/access.ts`, which contributes two functions:
`listVisibleChannelIds` and `canViewChannel`. Every complexity finding the same probe runs
measured, across all eleven files in scope, is reported below as an ordinary finding — none is
held back or disclosed without being claimed.

## Method

The measurement uses one public rule from [`eslint-plugin-sonarjs`](https://www.npmjs.com/package/eslint-plugin-sonarjs),
`sonarjs/cognitive-complexity`, configured at threshold `15` — the same threshold a
SonarQube-family hosted scanner documents for its own `typescript:S3776` ("Cognitive
Complexity") rule, which this rule reproduces. (A companion, related proposal in this same
submission series proposes this same rule/threshold pairing as a standalone local lint config;
this document does not depend on that proposal being adopted — the rule and threshold are
public and independently installable either way.) The rule was run directly against file
contents extracted byte-for-byte from `upstream-live/main` with `git show`, in an isolated
scratch project with no other files present, so nothing about this repository's own (unrelated)
source tree could influence the result.

**Classification:** all twenty-one findings below are **STILL PRESENT UPSTREAM** — the exact same
function, at the exact same line, still has the exact same shape in upstream's tree today.

## Upstream tip used

```
$ git fetch https://github.com/camplight/orgops.git main:refs/remotes/upstream-live/main

$ git rev-parse upstream-live/main
255b33418a3094d8c61dc6e38a014e9134f4fae1

$ git ls-remote https://github.com/camplight/orgops.git main
255b33418a3094d8c61dc6e38a014e9134f4fae1	refs/heads/main

$ git log -1 --format='%H %cI %s' upstream-live/main
255b33418a3094d8c61dc6e38a014e9134f4fae1 2026-09-21T14:50:22+03:00 feat(opscli): add standalone service and shortcut commands (#31)
```

The local ref and a live, direct `git ls-remote` of the public GitHub repository agree. Every
line number and every complexity number in this document is current as of this commit,
measured on 2026-09-21 — not carried over from an earlier measurement.

## Reproduction: the tooling is confirmed clean before it is pointed at a real finding

Before the twenty-one findings below, confirm the check itself is sound — every step here
succeeds with zero errors, on purpose, so a reader can trust that a later failure is a real
finding and not a broken probe:

```bash
# 0. Create the local ref this recipe uses to name the upstream tip (a stranger's clone
#    has no such ref until this runs)
git fetch https://github.com/camplight/orgops.git main:refs/remotes/upstream-live/main

# 1. Confirm the upstream tip two independent ways (both must agree)
git rev-parse upstream-live/main
git ls-remote https://github.com/camplight/orgops.git main

# 2. Install the three pinned, public dependencies in a throwaway directory
mkdir -p /path/to/a/scratch/dir/project && cd /path/to/a/scratch/dir/project
cat > package.json <<'EOF'
{
  "name": "spec03c-probe",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "devDependencies": {
    "eslint": "9.39.5",
    "eslint-plugin-sonarjs": "4.2.0",
    "typescript-eslint": "8.70.0"
  }
}
EOF
npm install --no-audit --no-fund
```

Both of these steps exit clean: the tip check succeeds, and the pinned install completes with
no error. The check itself is proven sound before it is used to look for a problem — not after.

### A trap worth knowing before running the real check

ESLint 9's flat-config engine reports `File ignored because outside of base path.` — a
severity-1 informational message, not an error — whenever a linted file's absolute path sits
outside the directory tree containing `eslint.config.mjs`. Linting the extracted upstream files
by an absolute path elsewhere on disk silently produces **zero real findings**, each replaced by
that one informational message — a false-negative trap, not a clean bill of health. The fix is
to copy the extracted files into the probe project's own directory before linting, which the
recipe below does. Anyone reproducing this should watch for the same trap: **a 0-message pass
from this exact rule set against a nontrivial upstream file is a sandbox/base-path problem, not
proof the code is clean** (see "Limits" below).

Only the next steps, run against the ten real files that are this document's whole subject,
produce a finding. There is no unrelated, passing file in this cluster held back as a softer
opener: every one of the ten files in this document's scope currently fails the check, and this
document says so plainly rather than manufacturing a gentler opener.

```bash
# 3. Recreate the rule mapping as a standalone flat config
cat > eslint.config.mjs <<'EOF'
import sonarjs from "eslint-plugin-sonarjs";
import tseslint from "typescript-eslint";

const RULES = {
  "sonarjs/cognitive-complexity": ["error", 15],
  "sonarjs/no-nested-functions": ["error", { threshold: 4 }]
};

export default [
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true }
      }
    },
    plugins: { sonarjs },
    rules: RULES
  }
];
EOF

# 4. Extract the ten upstream files byte-for-byte (never a locally modified copy),
#    flattening each path into a single filename so every file lands inside the
#    probe project's own directory tree (avoids the base-path trap above)
mkdir -p src
for f in \
  apps/api/src/routes/runtime.ts \
  apps/agent-runner/src/wrapper-harness/command.ts \
  apps/api/src/routes/runners.ts \
  apps/api/src/routes/embed.ts \
  apps/api/src/routes/collab.ts \
  apps/api/src/routes/agent-invites.ts \
  apps/agent-runner/src/wrapped-runtime.ts \
  apps/api/src/routes/agents.ts \
  apps/api/src/routes/events.ts \
  apps/agent-runner/src/tools/events.ts \
; do
  flat=$(echo "$f" | tr '/' '_')
  git show "upstream-live/main:$f" > "src/$flat"
done

# 5. Run the check
./node_modules/.bin/eslint --config eslint.config.mjs src/*.ts
```

### Pinned versions actually resolved

| Package | Pin used | Resolved/installed |
|---|---|---|
| `eslint` | `9.39.5` | `9.39.5` |
| `eslint-plugin-sonarjs` | `4.2.0` | `4.2.0` |
| `typescript-eslint` | `8.70.0` | `8.70.0` |
| `typescript` | not pinned for this tool anywhere in this fork (no lockfile exists for it) | `6.0.3`, resolved by npm as a peer dependency of `typescript-eslint@8.70.0` |

Stated plainly rather than silently picked: the `typescript` version above is whatever npm's own
peer-dependency resolution chose at install time on 2026-09-21, not a number pinned by any
config this document cites. A different install, on a different day, could resolve a different
`typescript` version within that same peer range.

## Findings — verbatim probe output, run on 2026-09-21

```
$ ./node_modules/.bin/eslint --config eslint.config.mjs src/*.ts

/path/to/a/scratch/dir/project/src/apps_agent-runner_src_tools_events.ts
  538:23  error  Refactor this function to reduce its Cognitive Complexity from 250 to the 15 allowed  sonarjs/cognitive-complexity

/path/to/a/scratch/dir/project/src/apps_agent-runner_src_wrapped-runtime.ts
  150:16  error  Refactor this function to reduce its Cognitive Complexity from 22 to the 15 allowed  sonarjs/cognitive-complexity

/path/to/a/scratch/dir/project/src/apps_agent-runner_src_wrapper-harness_command.ts
  469:16  error  Refactor this function to reduce its Cognitive Complexity from 17 to the 15 allowed  sonarjs/cognitive-complexity
  554:10  error  Refactor this function to reduce its Cognitive Complexity from 25 to the 15 allowed  sonarjs/cognitive-complexity
  620:47  error  Refactor this function to reduce its Cognitive Complexity from 25 to the 15 allowed  sonarjs/cognitive-complexity
  733:51  error  Refactor this function to reduce its Cognitive Complexity from 18 to the 15 allowed  sonarjs/cognitive-complexity

/path/to/a/scratch/dir/project/src/apps_api_src_routes_agent-invites.ts
  231:44  error  Refactor this function to reduce its Cognitive Complexity from 21 to the 15 allowed  sonarjs/cognitive-complexity

/path/to/a/scratch/dir/project/src/apps_api_src_routes_agents.ts
  338:37  error  Refactor this function to reduce its Cognitive Complexity from 34 to the 15 allowed  sonarjs/cognitive-complexity
  515:44  error  Refactor this function to reduce its Cognitive Complexity from 64 to the 15 allowed  sonarjs/cognitive-complexity

/path/to/a/scratch/dir/project/src/apps_api_src_routes_collab.ts
  485:39  error  Refactor this function to reduce its Cognitive Complexity from 20 to the 15 allowed  sonarjs/cognitive-complexity
  680:44  error  Refactor this function to reduce its Cognitive Complexity from 22 to the 15 allowed  sonarjs/cognitive-complexity

/path/to/a/scratch/dir/project/src/apps_api_src_routes_embed.ts
   78:10  error  Refactor this function to reduce its Cognitive Complexity from 18 to the 15 allowed  sonarjs/cognitive-complexity
  120:10  error  Refactor this function to reduce its Cognitive Complexity from 59 to the 15 allowed  sonarjs/cognitive-complexity
  377:46  error  Refactor this function to reduce its Cognitive Complexity from 20 to the 15 allowed  sonarjs/cognitive-complexity

/path/to/a/scratch/dir/project/src/apps_api_src_routes_events.ts
  225:12  error  Refactor this function to reduce its Cognitive Complexity from 113 to the 15 allowed  sonarjs/cognitive-complexity
  658:37  error  Refactor this function to reduce its Cognitive Complexity from 16 to the 15 allowed   sonarjs/cognitive-complexity
  813:42  error  Refactor this function to reduce its Cognitive Complexity from 16 to the 15 allowed   sonarjs/cognitive-complexity

/path/to/a/scratch/dir/project/src/apps_api_src_routes_runners.ts
  186:66  error  Refactor this function to reduce its Cognitive Complexity from 18 to the 15 allowed  sonarjs/cognitive-complexity

/path/to/a/scratch/dir/project/src/apps_api_src_routes_runtime.ts
  206:46  error  Refactor this function to reduce its Cognitive Complexity from 17 to the 15 allowed  sonarjs/cognitive-complexity

✖ 19 problems (19 errors, 0 warnings)
```

(Only the throwaway scratch-directory path prefix is elided/generalized above; every other
character — file names, line:column pairs, and the exact wording ESLint reports — is the real,
unedited output of this run. `eslint --version` for this run: `v9.39.5`.
`eslint-plugin-sonarjs` version read from its own installed `package.json`: `4.2.0`. Tool
versions used for this run: `eslint 9.39.5`, `eslint-plugin-sonarjs 4.2.0`, `typescript-eslint
8.70.0`, `typescript 6.0.3` (peer-resolved).)

This run reports nineteen findings across the ten files. All nineteen are this document's
claims: the fourteen handler-function items in the table below, `collab.ts:680` (the
`PATCH /api/channels/:id` handler, item 16), and four further items named in the "Addendum"
subsection below — `command.ts:554` and `command.ts:620` (items 17–18), and `events.ts:658` and
`events.ts:813` (items 19–20).

Two more findings, `listVisibleChannelIds` and `canViewChannel` in `apps/api/src/routes/access.ts`
(items 15 and 21), required a second probe run because `access.ts` was not among the ten files
extracted above — see "Additional probe run" immediately below.

### Additional probe run — `access.ts`, run on 2026-09-21

```bash
# Extract the one additional upstream file this run needs
git show upstream-live/main:apps/api/src/routes/access.ts > src/apps_api_src_routes_access.ts

# Run the same check against it
./node_modules/.bin/eslint --config eslint.config.mjs src/apps_api_src_routes_access.ts
```

```
$ ./node_modules/.bin/eslint --config eslint.config.mjs src/apps_api_src_routes_access.ts

/path/to/a/scratch/dir/project/src/apps_api_src_routes_access.ts
  172:12  error  Refactor this function to reduce its Cognitive Complexity from 20 to the 15 allowed  sonarjs/cognitive-complexity
  241:12  error  Refactor this function to reduce its Cognitive Complexity from 34 to the 15 allowed  sonarjs/cognitive-complexity

✖ 2 problems (2 errors, 0 warnings)
```

Same pinned versions as the main run (`eslint 9.39.5`, `eslint-plugin-sonarjs 4.2.0`,
`typescript-eslint 8.70.0`, `typescript 6.0.3` peer-resolved). No zero-finding trap fired: the
file was copied into the probe project's own directory before linting.

Both lines this run produced are claimed as findings in this document: `241:12`
(`listVisibleChannelIds`, complexity 34) is item 15 below, and `172:12` (`canViewChannel`,
complexity 20) is item 21 below. `canViewChannel`'s name is confirmed by direct source read in
the "Addendum" subsection immediately below.

### Addendum — naming four further findings

The same probe runs above also measured four further lines that were not yet anchored to a
function name at the time this document was first drafted: `command.ts:554`, `command.ts:620`,
`events.ts:658`, and `events.ts:813`. Each was named by reading the extracted upstream file
directly, the same anchoring standard used for every other finding in this document.

```bash
# Re-extract the two files fresh from upstream (same tip as above)
git show upstream-live/main:apps/agent-runner/src/wrapper-harness/command.ts > src/command-names.ts
git show upstream-live/main:apps/api/src/routes/events.ts > src/events-names.ts

# Read each finding line with surrounding context, and confirm the nearest
# preceding function/property declaration
sed -n '500,560p' src/command-names.ts
grep -n "^function \|^async function \|^export function \|^export async function " \
  src/command-names.ts | awk -F: '$1<=554'
sed -n '610,635p' src/command-names.ts
sed -n '640,665p' src/events-names.ts
sed -n '795,820p' src/events-names.ts
```

Verbatim declaration lines, read directly from the freshly extracted upstream files:

```
command.ts:554:  function firstCompleteJsonObjects(output: string): string[] {
command.ts:620:    ensureReady: async ({ ctx, agent, config }) => {
events.ts:658:    app.post("/api/events", async (c) => {
events.ts:813:    app.patch("/api/events/:id", async (c) => {
```

Identity notes:
- `firstCompleteJsonObjects` (line 554) is an ordinary named function declaration.
- `ensureReady` (line 620) is not anonymous: it is a named property (`ensureReady:`) of the
  exported `commandWrapperHarness` object literal, which opens at line 617. Reported below as
  "`ensureReady` (property of `commandWrapperHarness`)" rather than inventing a standalone
  function name.
- The two `events.ts` items are route handlers passed as the callback argument to
  `app.post(...)` / `app.patch(...)` — named by method and path, the same convention this
  document already uses for every other route-handler item (for example item 1,
  "`DELETE /api/processes/:id` handler").

### Findings table

| # | File (upstream path) | Function / route | Line at tip `255b334` | Measured Cognitive Complexity | Threshold | Rule | Classification |
|---|---|---|---|---|---|---|---|
| 1 | `apps/api/src/routes/runtime.ts` | `DELETE /api/processes/:id` handler | 206 | **17** | 15 | `sonarjs/cognitive-complexity` (`typescript:S3776`) | STILL PRESENT UPSTREAM |
| 2 | `apps/agent-runner/src/wrapper-harness/command.ts` | `runTurn` | 733 | **18** | 15 | `sonarjs/cognitive-complexity` (`typescript:S3776`) | STILL PRESENT UPSTREAM |
| 3 | `apps/api/src/routes/runners.ts` | `POST /api/runners/register` handler | 186 | **18** | 15 | `sonarjs/cognitive-complexity` (`typescript:S3776`) | STILL PRESENT UPSTREAM |
| 4 | `apps/api/src/routes/embed.ts` | `normalizeAttachment` | 78 | **18** | 15 | `sonarjs/cognitive-complexity` (`typescript:S3776`) | STILL PRESENT UPSTREAM |
| 5 | `apps/api/src/routes/embed.ts` | `POST /v1/chat/completions` handler | 377 | **20** | 15 | `sonarjs/cognitive-complexity` (`typescript:S3776`) | STILL PRESENT UPSTREAM |
| 6 | `apps/api/src/routes/embed.ts` | `extractUserInput` | 120 | **59** | 15 | `sonarjs/cognitive-complexity` (`typescript:S3776`) | STILL PRESENT UPSTREAM |
| 7 | `apps/api/src/routes/collab.ts` | `POST /api/channels` handler | 485 | **20** | 15 | `sonarjs/cognitive-complexity` (`typescript:S3776`) | STILL PRESENT UPSTREAM |
| 8 | `apps/api/src/routes/agent-invites.ts` | `POST /api/agent-invites` handler | 231 | **21** | 15 | `sonarjs/cognitive-complexity` (`typescript:S3776`) | STILL PRESENT UPSTREAM |
| 9 | `apps/agent-runner/src/wrapped-runtime.ts` | `hydrateAttachmentPaths` | 150 | **22** | 15 | `sonarjs/cognitive-complexity` (`typescript:S3776`) | STILL PRESENT UPSTREAM |
| 10 | `apps/api/src/routes/agents.ts` | `POST /api/agents` handler | 338 | **34** | 15 | `sonarjs/cognitive-complexity` (`typescript:S3776`) | STILL PRESENT UPSTREAM |
| 11 | `apps/api/src/routes/agents.ts` | `PATCH /api/agents/:name` handler | 515 | **64** | 15 | `sonarjs/cognitive-complexity` (`typescript:S3776`) | STILL PRESENT UPSTREAM |
| 12 | `apps/api/src/routes/events.ts` | `selectEventRows` | 225 | **113** | 15 | `sonarjs/cognitive-complexity` (`typescript:S3776`) | STILL PRESENT UPSTREAM |
| 13 | `apps/agent-runner/src/tools/events.ts` | `execute` | 538 | **250** | 15 | `sonarjs/cognitive-complexity` (`typescript:S3776`) | STILL PRESENT UPSTREAM |
| 14 | `apps/agent-runner/src/wrapper-harness/command.ts` | `ensureSourceCheckout` | 469 | **17** | 15 | `sonarjs/cognitive-complexity` (`typescript:S3776`) | STILL PRESENT UPSTREAM |
| 15 | `apps/api/src/routes/access.ts` | `listVisibleChannelIds` | 241 | **34** | 15 | `sonarjs/cognitive-complexity` (`typescript:S3776`) | STILL PRESENT UPSTREAM |
| 16 | `apps/api/src/routes/collab.ts` | `PATCH /api/channels/:id` handler | 680 | **22** | 15 | `sonarjs/cognitive-complexity` (`typescript:S3776`) | STILL PRESENT UPSTREAM |
| 17 | `apps/agent-runner/src/wrapper-harness/command.ts` | `firstCompleteJsonObjects` | 554 | **25** | 15 | `sonarjs/cognitive-complexity` (`typescript:S3776`) | STILL PRESENT UPSTREAM |
| 18 | `apps/agent-runner/src/wrapper-harness/command.ts` | `ensureReady` (property of `commandWrapperHarness`) | 620 | **25** | 15 | `sonarjs/cognitive-complexity` (`typescript:S3776`) | STILL PRESENT UPSTREAM |
| 19 | `apps/api/src/routes/events.ts` | `POST /api/events` handler | 658 | **16** | 15 | `sonarjs/cognitive-complexity` (`typescript:S3776`) | STILL PRESENT UPSTREAM |
| 20 | `apps/api/src/routes/events.ts` | `PATCH /api/events/:id` handler | 813 | **16** | 15 | `sonarjs/cognitive-complexity` (`typescript:S3776`) | STILL PRESENT UPSTREAM |
| 21 | `apps/api/src/routes/access.ts` | `canViewChannel` | 172 | **20** | 15 | `sonarjs/cognitive-complexity` (`typescript:S3776`) | STILL PRESENT UPSTREAM |

Twenty-one findings, across eleven distinct files (`command.ts`, `embed.ts`, `collab.ts`,
`agents.ts`, `events.ts`, and `access.ts` each contribute more than one item).

Function-name confirmation (a durable anchor — line numbers drift as a file changes, function
names do not) — the source line at each cited location, read directly from the extracted
upstream file:

```
runtime.ts:206:        app.delete("/api/processes/:id", async (c) => {
command.ts:733:        runTurn: async (input: WrapperHarnessTurnInput) => {
runners.ts:186:        app.post("/api/runners/register", requireRunnerAuth, async (c) => {
embed.ts:78:           function normalizeAttachment(input: unknown): RequestedAttachment | null {
embed.ts:377:          app.post("/v1/chat/completions", async (c) => {
embed.ts:120:          function extractUserInput(messages: unknown): {
collab.ts:485:         app.post("/api/channels", async (c) => {
agent-invites.ts:231:  app.post("/api/agent-invites", async (c) => {
wrapped-runtime.ts:150: async function hydrateAttachmentPaths(
agents.ts:338:         app.post("/api/agents", async (c) => {
agents.ts:515:         app.patch("/api/agents/:name", async (c) => {
events.ts:225:         function selectEventRows(
tools/events.ts:538:   export async function execute(
command.ts:469:        async function ensureSourceCheckout(
access.ts:241:         function listVisibleChannelIds(user: RequestUser | undefined): string[] {
collab.ts:680:         app.patch("/api/channels/:id", async (c) => {
command.ts:554:        function firstCompleteJsonObjects(output: string): string[] {
command.ts:620:        ensureReady: async ({ ctx, agent, config }) => {
events.ts:658:         app.post("/api/events", async (c) => {
events.ts:813:         app.patch("/api/events/:id", async (c) => {
access.ts:172:         function canViewChannel(user: RequestUser | undefined, channelId: string): boolean {
```

## Non-reproducing claims / additional output

None of the twenty-one items above failed to reproduce. All twenty-one matched the exact line
and function this document cites, at the exact complexity number reported. Every finding either
probe run measured, across the eleven files in scope, is reported above as an ordinary claim;
nothing is held back or disclosed without being claimed.

## Limits — read before trusting this report as complete

- **A zero-finding result from this exact rule set is not, by itself, a clean bill of health.**
  ESLint 9's flat-config engine silently reports zero real findings — replaced by an
  informational "outside of base path" message — when a linted file's absolute path sits outside
  the project directory containing `eslint.config.mjs`. This document's own first attempt hit
  exactly this trap before the recipe above was corrected to copy files into the project tree.
  Anyone reproducing this check, here or elsewhere, should confirm the config actually matched
  the intended files before trusting a clean run.
- **ESLint reports a token, not always a name.** The line:column ESLint prints for
  `sonarjs/cognitive-complexity` is the function's opening keyword/identifier token, which is not,
  in every case, a separately nameable symbol distinct from "the function starting at this line"
  — this document cites the exact reported location plus a manual read of the surrounding source,
  not an independently derived function name, for that reason.
- **Only the complexity family is measured here.** `sonarjs/no-nested-functions` was included in
  the same rule config but produced no additional claim in this document beyond what
  `sonarjs/cognitive-complexity` already reports. The security/taint rule family
  (`tssecurity:*`-equivalent findings) needs a closed-source, subscription-gated analysis engine
  with no public npm equivalent; it was not checked here, and this document makes no claim about
  it one way or the other for these eleven files. Only the `sonarjs/cognitive-complexity` family
  is claimed; this document makes no nesting-depth claim beyond that.
- **A measurement, not a verdict on severity.** A high cognitive-complexity number says a
  function is hard to hold in one's head while reading it; it does not, by itself, say the
  function is wrong, buggy, or urgent to fix. This document reports the number and leaves the
  judgment call to whoever triages it.
- **`typescript` itself is not pinned for this check** (see the pinned-versions table above) —
  flagged rather than silently resolved, because a different peer-dependency resolution could, in
  principle, parse the same file slightly differently.
- **This document's scope is exactly what the two probe runs above measured.** It reports
  twenty-one findings across eleven files: the route- and agent-runner-handler cluster plus the
  two functions gating channel visibility and mutation. It makes no claim about any file, rule,
  or function outside that scope.

## What this PR contains

Exactly one new file: this document. No source file is changed, no dependency is added to this
repository, and no CI workflow is touched. The reproduction recipe above runs entirely outside
this repository, in a throwaway directory, against file contents extracted from upstream — it
leaves no trace in the tree this PR touches.
