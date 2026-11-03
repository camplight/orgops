# Proposal: a local, offline static-analysis quality gate, and a fail-loud CI verdict pattern

**Status:** proposal, not yet adopted. Submitted from a private fork of this project,
maintained independently, from a personal account, not on behalf of any employer.

**Provenance note.** This document paraphrases configuration shapes and a CI-workflow
structure from that private fork. Quoting is kept minimal and limited to non-creative,
mechanical facts: public vendor rule IDs, numeric thresholds, file/job structure, and the
literal exit-code and control-flow shape of a shell script. No source file is reproduced in
full, and the fork itself is referred to as "a private fork," never by name. Some evidence
cited below is deliberately partial: where a literal value would identify the fork's owner or
hosting (a project key, an internal CI Action name, a self-hosted runner label, an internal CA
certificate, an internal analysis-server hostname, or one vendor SDK's exact banned-import
list), this document says so explicitly at the point of citation and describes the mechanism
behaviorally instead. That is a deliberate withholding, not an unverified claim.

## Read this first if you have no hosted analysis server and don't want one

That is the hardest and most likely reader of this document, so the objection is answered here,
not at the end: **"a local replica of a hosted gate I do not run is worth nothing to me."**

This proposal is not one gate. It is three separable pieces, and you can accept any one of
them without the other two:

1. **A local, offline linter package** that runs entirely on public npm packages
   (`eslint-plugin-sonarjs`, `typescript-eslint`), with zero network access and no server of
   any kind. It happens to reproduce numbers a hosted SonarQube-family scanner would also
   report, because it uses the same public rule engine that scanner's own documentation
   points to — but nothing about running it requires SonarQube, a license, or any server to
   exist. If you never adopt a hosted scanner, this is just an extra, optional ESLint config.
2. **A scanning-scope policy** — scan what you ship, exclude what verifies it — that applies to
   *any* static-analysis tool you might add, including plain ESLint if you ever widen its
   scope, and arguably to code review itself. It needs no hosted infrastructure to be true.
3. **A two-job CI pattern** that keeps an infrastructure failure in *any* tolerant CI step from
   reading as a passing run. It has nothing to do with SonarQube specifically: it applies to a
   linter, a test runner, a type-checker, or a future hosted scanner, on any CI runner. This
   argument stands on its own even if you reject 1 and 2 outright — see its own section below.

Each of the three is scoped separately below, with what it costs to adopt and what it does not
give you. Nothing here asks you to run a hosted analysis server. Argument 3, in particular, is
about a shape upstream's *own* CI could benefit from today: as verified directly against this
repository's own `main` branch at commit `145f17f`, this repository currently ships exactly two
GitHub Actions workflows (`opscli-smoke.yml`, `release-main.yml`), and neither one invokes the
`lint` or `test` script already defined in the root `package.json`. Whatever CI upstream adds
next — for those scripts or anything else — is exactly the kind of step this pattern protects.

---

## Argument 1: the local, offline complexity gate

### The problem

A contributor cannot see, before opening a PR, what a static-analysis tool would flag in the
code they are about to submit. For a project running a hosted scanner (this fork's own use
case), that means the first feedback a contributor gets is on the open PR, not on their own
machine. For a project running no scanner at all (upstream, today), the same tooling is simply
a free, local complexity/nesting linter nobody has wired up yet.

### What is proposed

A standalone, dev-only package (no runtime dependency, never shipped in a build) using two
public npm packages already maintained outside any single company:

- [`eslint-plugin-sonarjs`](https://www.npmjs.com/package/eslint-plugin-sonarjs) — the same
  rule engine SonarSource itself documents as implementing several `typescript:S*` /
  `javascript:S*` rule IDs.
- [`typescript-eslint`](https://www.npmjs.com/package/typescript-eslint) — for TSX/TS parsing.

**Verified rule mapping**, read directly from this fork's own pinned config
(`tools/sonar-gate/eslint.sonar-complexity.config.mjs`, versions
`eslint@9.39.5` + `eslint-plugin-sonarjs@4.2.0` + `typescript-eslint@8.70.0`):

| Hosted-scanner rule ID | Local ESLint rule | Threshold | Config surface today |
|---|---|---|---|
| `typescript:S3776` (Cognitive Complexity) | `sonarjs/cognitive-complexity` | `15` | hardcoded literal in a flat-config `RULES` object |
| `typescript:S2004` (nesting depth) | `sonarjs/no-nested-functions` | `{ threshold: 4 }` | hardcoded literal, same object |

The same mechanism, not just this pair, generalizes further: this fork's own separate
BLOCKER-severity config (`tools/sonar-gate/eslint.sonar-blockers.config.mjs`) maps
`typescript:S3516` to `sonarjs/no-invariant-returns` and `javascript:S2189` to ESLint core's own
`no-unmodified-loop-condition` — both public rules, zero SonarQube dependency. The pattern is
"look up the vendor-documented public-rule equivalent for each rule ID you care about," not
something special to cognitive complexity.

**This is not a claim on paper — it finds real things in this project's own upstream code
today.** The pinned config above was installed in an isolated scratch directory (no network
access beyond the initial `npm install` of the three packages above) and run directly against
three files extracted byte-for-byte from this repository's own `main` branch at commit
`145f17f` with `git show <that commit>:<path>`, on 2026-09-20. Actual tool output, unedited:

```
apps/admin-ui/src/screens/ChannelsScreen.tsx
  30:17  error  Refactor this function to reduce its Cognitive Complexity from 27 to the 15 allowed  sonarjs/cognitive-complexity

apps/admin-ui/src/screens/HumansScreen.tsx
  24:17  error  Refactor this function to reduce its Cognitive Complexity from 21 to the 15 allowed  sonarjs/cognitive-complexity

apps/admin-ui/src/screens/TeamsScreen.tsx
  21:17  error  Refactor this function to reduce its Cognitive Complexity from 21 to the 15 allowed  sonarjs/cognitive-complexity

✖ 3 problems (3 errors, 0 warnings)
```

That is three real findings, at exact line numbers, in files upstream ships today, produced by
a tool that needed no server, no account, and no token — only `npm install` of two public
packages and one config file. (These same three findings, with the same fix-direction
discussion, are the subject of a separate, findings-only PR against this same tree; this
document cites them only to demonstrate the tooling, not to re-litigate the fix.)

### What is hardcoded today vs. what is proposed as new work

Stated plainly, because it would be easy to read the config above as already generalized and it
is not: **the `RULES` object above is a literal object in source.** There is no config file, no
environment variable, and no CLI flag that changes a threshold or adds a rule ID without
editing and re-shipping the `.mjs` file. Turning this into a genuinely reusable gate — one a
downstream project could tune without forking the tool — is proposed, not-yet-built work:
externalize the rule-ID-to-ESLint-rule map and its thresholds into a project-level config file
(JSON or YAML), read by a small loader at gate-startup, with the current hardcoded object
becoming that config's default.

### Effort

Small to reproduce as-is (copy two files, add two devDependencies); Medium to externalize the
rule map into real config, which is the work actually being proposed here rather than the
copy-paste version. See "What upstream must build," below, for how this combines with the other
two hardcoded surfaces this document flags.

---

## Argument 2: the ship-vs-verify exclusion policy

### The problem, measured

Scanning a repository's verification code (tests, local dev-only tooling) alongside its shipped
code produces findings that are not product defects, and they are not a hypothetical risk: this
fork measured three separate remediation rounds where scanning `tests/**` and `tools/**` raised
its own new findings — **18, then 1, then 12** — while the shipped application code under test
came out clean each round. Confirmed verbatim, in this fork's own `sonar-project.properties`:

> "Scanning them was measured to be actively counterproductive across three remediation
> rounds: each round of verification artifacts was itself analysed as new code and raised its
> own findings — 18, then 1, then 12 — while the application code under test came out clean
> every time."

The findings were real for what the files were (a test harness that spawns a subprocess, a
function with many observation branches) — real in the sense that the rule genuinely matched —
but meaningless as *product* risk, because none of that code ships. The gate was reporting on
its own instrumentation, not on the software being built.

### The policy, generalized

**Scan what you ship. Exclude what verifies it.** Concretely, in this fork's own repository
shape (confirmed verbatim, `sonar-project.properties`, `sonar.exclusions` line):

```
sonar.exclusions=tests/**,tools/**
```

Generalized for any project: identify the directories that are (a) never copied into a build
artifact and (b) exist only to exercise or check the shipped code, and exclude exactly those
from whatever static-analysis scope you configure — nothing under a project's actual build
output (its `apps/`, `packages/`, or equivalent) should ever be exempted, and no rule should be
silenced globally to work around a false positive in verification code; the fix is scope, not a
disabled rule.

### Why this is a policy statement, not just a config line

The reasoning generalizes past any one exclusions setting: a scanner (or a reviewer, or a
linter) evaluates code against rules written for *product* risk — cognitive load for the next
maintainer, security exposure to an attacker, duplication that will drift. Test and
verification-only code is judged by a different, already-existing standard: does it prove the
behavior it claims to prove. Holding both kinds of code to the product-risk rule set produces
noise that trains reviewers to ignore the tool's output altogether — the actual cost measured
here, not a hypothetical one. It also has the useful side effect of keeping a local, offline
gate and any future hosted gate in agreement about scope: if both exclude the same
verification-only directories, a contributor's local run and a maintainer's hosted run should
not diverge on which files were ever in scope.

### Effort

Small — this is a documentation-and-config decision (which directories count as
"verification substrate" for this project's own layout), not new runtime code. It applies
immediately to Argument 1's own local gate, independent of whether any hosted scanner is ever
adopted.

---

## Argument 3: the two-job CI verdict pattern (stands alone)

**This argument does not depend on the other two.** It has nothing to do with SonarQube, or
static analysis, or the specific gate this document otherwise proposes. It is about one shape:
*"a step that is allowed to fail for infrastructure reasons must never let a run read as
green when it failed."* That risk exists for a linter, a test runner, a type-checker, a
release step, or a future hosted scanner alike — anywhere a workflow author marks a job or step
tolerant of its own failure, whether with `continue-on-error: true` or an equivalent escape
hatch.

### The problem

A workflow step that is allowed to fail — a common, reasonable choice when the step's own
infrastructure (a hosted service, a flaky external call, a scanner subscription) might be
unavailable and should not block unrelated work — creates an opening: if nothing downstream
positively confirms that the step actually ran and actually produced a result, its failure is
indistinguishable from its success. The overall CI run reports green either way.

### The pattern, confirmed in this fork's own workflow shape and stated abstractly

Two jobs, not one:

1. **The scan/build job** runs the tolerant step and is itself marked tolerant of its own
   failure (this fork's own workflow sets `continue-on-error: true` on the job, and separately
   uses `runs-on: [self-hosted, <a pool label>]` — the exact pool label is withheld here, only
   the shape matters). Whatever it produces — a report, a log, an artifact of any kind — is
   **uploaded as a build artifact**, with the upload step itself configured to fail if nothing
   was produced (this fork's own step sets `if-no-files-found: error`). The tolerant job's own
   pass/fail conclusion is deliberately allowed to be misleading; nothing downstream trusts it.
2. **A second, verdict job** — which carries **no** tolerance of its own — declares a
   dependency on the first job (`needs:` in this fork's own workflow), **downloads** the
   artifact rather than reading anything from a shared workspace, and only then evaluates
   pass/fail. Two properties make this job load-bearing rather than decorative:
   - If the artifact is missing (because the first job's tolerant step never produced one),
     the download step fails outright — there is no silent, empty-handed continuation.
     `needs:` alone is satisfied even when the upstream job's *tolerated* step failed, so this
     is the only point that actually refuses a run where nothing was produced.
   - The verdict step reads the artifact's contents and computes an explicit pass/fail — in
     this fork's own instance, a nonzero exit terminates the job — so the overall CI run's own
     conclusion is the real verdict, not a page a human has to remember to check separately.

The point in one sentence: **a scanner (or any tool) infrastructure failure must never read as
a green run**, and the only way to guarantee that is to make an intolerant job own the final
verdict, fed by a hard artifact handoff rather than an assumption about shared state.

### Why this is scanner-agnostic and runner-agnostic

Nothing in the shape above names a scanner, a vendor, or a specific CI runner type. It applies
equally to a self-hosted runner pool or hosted GitHub runners, to an ephemeral, one-job-one-
machine pool (the property that forces the artifact-based handoff in this fork's own case,
because there is no shared workspace across jobs) or a persistent one (where a shared workspace
would work, but the artifact handoff still costs nothing and stays portable). Adopting this
pattern requires no dependency on this document's other two arguments.

### Effort

Small — this is a workflow-authoring convention, not new application code. It is directly
applicable to any CI step upstream adds next, including simply wiring the already-defined
`npm run lint` / `npm test` scripts into CI for the first time (confirmed: neither script is
currently invoked by either of this repository's two existing workflows).

---

## The banned-import fitness function (mechanism only)

A related, smaller mechanism worth naming separately because it uses the same
"local, offline, no server" spirit as Argument 1: a repo-wide check, runnable in CI with no
external dependency, that fails the build the moment a forbidden import specifier or a
forbidden environment-variable *reference* appears anywhere in checked-in source (excluding
test files) or in a package manifest's declared dependencies.

**What this fork's own instance does, and what is explicitly not being proposed:** this fork's
script bans exactly one specific vendor SDK's package specifier and a small, fixed list of
legacy provider API-key environment-variable names — both hardcoded as literal arrays in
source, with no config surface. That specific list is an artifact of one fork's own migration
history and is **not** what is proposed here; only the shape is: a small script that (a) walks
a project's own shipped-source directories, (b) skips test files, (c) checks file contents
against a configurable list of banned specifiers/env-var names, (d) checks package manifests
separately for banned dependency declarations, and (e) exits non-zero with a clear reason on
any match. Adopting it means writing your own list for your own concerns (a retired dependency,
a credential shape you no longer want referenced, a deprecated internal API) — not adopting
this fork's list.

---

## Limits: what the local gate cannot see

Stated plainly, because overselling this would cost more credibility than the numbers above
gain:

- **The security/taint rule family is out of reach entirely.** SonarQube's `tssecurity:*`
  rules (data-flow / taint tracking — e.g. detecting a caller-controlled value reaching a
  filesystem or database sink) require a closed-source, subscription-gated analysis engine.
  There is no public npm package that reproduces this family. The local replica's coverage is
  therefore bounded to the `typescript:S*` / `javascript:S*` structural family — complexity,
  nesting, and the handful of BLOCKER-shape rules cited above — and stops there. A maintainer
  who wants taint coverage needs the hosted engine; nothing here substitutes for it.
- **No "new code" baseline.** A hosted gate commonly scores a change against a *new-code
  period* — only lines changed since a baseline count against certain conditions. This fork's
  own hosted-verdict script goes as far as treating an *empty* new-code period as a distinct,
  reported-but-not-failed case, specifically so a docs-only or config-only change is not
  penalized for contributing zero analyzable lines. The local, offline gate proposed here has
  no equivalent concept at all: it is a full-file, point-in-time lint run with no notion of
  "since when." A contributor comparing local numbers to a future hosted gate's PR decoration
  should expect the two to disagree on scope, not just on which rules are covered.
- **No duplication-across-repository detection, no historical trend, no PR decoration UI.**
  These are server-side capabilities by nature (they need a persisted index across commits and
  files); an offline, invocation-scoped ESLint run has no equivalent and this proposal does not
  attempt one.

---

## What upstream would need to build

Per argument, roughly sized:

1. **The local gate (Argument 1).** Add the two public devDependencies and the pinned config
   files (S, near drop-in) — or, for the version actually being proposed, build the small
   config-loader that lets the rule-ID/ESLint-rule/threshold map live in a project config file
   instead of source (M).
2. **The exclusion policy (Argument 2).** Decide upstream's own ship-vs-verify directory split
   and document it once (S) — apply it to Argument 1's local gate's own ignore list immediately,
   and to any future hosted scanner's exclusion setting if one is ever added.
3. **The CI verdict pattern (Argument 3).** Restructure any tolerant CI step into the two-job
   shape described above (S per step it is applied to); this has no dependency on 1 or 2 and
   could be adopted before either.

**Overall sizing: M/L**, because a genuinely reusable version of this proposal — not the
copy-paste version — means externalizing three *separate* hardcoded surfaces into one coherent
project-level config format, not three independent ad hoc ones:

- the rule-ID-to-ESLint-rule map and its thresholds (Argument 1),
- a banned-import/banned-env-var list (the fitness function above), and
- — only if a hosted scanner is ever adopted — a project key and any scanner-specific
  connection settings, which this fork currently also hardcodes in a properties file (the
  literal value is withheld here; only the fact that it is a single hardcoded string today is
  cited).

Designing one config shape that serves all three, rather than bolting on three incompatible
ones over time, is the real work this estimate accounts for.

---

## Scope explicitly excluded from this proposal

- Any specific self-hosted-runner label.
- The name of any specific internal or third-party CI Action used to run a hosted scan.
- Any internal CA-certificate handling.
- The specific banned-import/banned-env-var list — only the mechanism is proposed.
- A hosted scanner's project-key value or any other literal connection detail.

None of the above is needed to adopt any of the three arguments in this document.
