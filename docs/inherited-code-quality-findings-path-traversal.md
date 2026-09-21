# Findings: inherited unguarded filesystem/database sink pair (path-traversal shape)

**Status:** findings report, not yet adopted. Submitted from a private fork of this project,
maintained independently. No code change is proposed by this document; it is evidence, not a
patch.

**Provenance note, stated plainly rather than folded into the prose below:** this finding was
originally drafted as its own standalone proposal (a closed, self-deriving database-path guard)
and was later cut as a standalone document during this contributor's own planning. It survives
only here, as two findings inside a findings-only report, because the intent behind this whole
submission series is to report every static-analysis finding this fork actually fixed — and
this was one of them. **This is flagged explicitly so a maintainer, or the contributor's own
later judgment, can still decide this pair does not belong folded in at the finding level and
drop it.** Nothing below depends on the standalone framing; it is reported here purely as two
items in a two-item list.

## The problem, in this repo's own terms

Two functions this repository ships today each take a path-shaped value that can be influenced
from outside the process, and pass it, unmodified, straight to a filesystem or database
constructor call, with no check that the value stays inside any permitted directory:

- `packages/db/src/index.ts`, function `openDb` — its `path` parameter reaches
  `mkdirSync(dirname(path), ...)` and then `new Database(path)` with no containment.
- `apps/agent-runner/src/runner.ts`, function `ensureWorkspace` — `agent.workspacePath`, which
  this function receives as part of an `Agent` record, reaches `mkdirSync(workspacePath, ...)`
  with the same absence of containment.

Nothing in this repository's own tooling flags either shape today. There is no static-analysis
step in either of the two GitHub Actions workflows this repository runs (`opscli-smoke.yml`,
`release-main.yml`), so a value that reaches one of these two sinks from an HTTP request or a
remote API response has nothing standing between it and the filesystem.

## What is proposed

Not a fix — two findings, offered as evidence a maintainer can act on however they choose, plus
the fix direction this contributor's own fork took for each, offered as one possible resolution
and nothing upstream is obliged to copy. No code is included to paste in: the fork's own guard
files that implement its fix do not exist upstream in any form (confirmed below), so there is
nothing here to "reuse," only the shape of a fix, described in prose.

## Method and confidence — stated up front, before the evidence itself

This report's two items belong to SonarQube's taint/sink rule family (`tssecurity:*`), which
needs a closed-source, subscription-only analysis engine that runs only on a hosted analysis
server this fork has no local or offline access to. There is no way to invoke that engine from a
disposable clone or a scratch directory — unlike the cognitive-complexity family used by the
other findings reports in this same submission series, which was verified by installing this
fork's own pinned `eslint` + `eslint-plugin-sonarjs` configuration in a throwaway directory and
running it directly against upstream file bytes (a real, executable measurement with a pass/fail
result).

**Substitute method used here:** read the exact function this fork's own fix commit describes as
vulnerable, quoting the commit message and the pre-fix code verbatim; then read the exact
function upstream ships today at the same path; then compare the two function bodies
statement-by-statement.

**What this can, and cannot, establish:**

- It **can** show that the specific code shape this fork's own remediation targeted — an
  externally-influenced value reaching a filesystem or database sink with no path containment —
  is present, byte-for-byte or line-shifted-only, in upstream's current tree.
- It **cannot** show that SonarQube's taint engine would flag either function today, that no
  other upstream code neutralizes the value before it reaches these functions, or that every
  caller of either function was traced (only the specific reachability paths cited below were
  traced by hand, not the full call graph).

**Confidence: Moderate**, for both items — a verbatim, line-matched, function-level code read
against a live-fetched upstream tip, but not equivalent to an engine-confirmed finding. This is
lower than the confidence this contributor would assign to the complexity-family findings in the
companion submissions in this same series, which rest on a real tool run rather than a manual
read, and the difference is stated here rather than smoothed over.

## Upstream tip used

```
$ git rev-parse upstream-live/main
145f17f6b06df139ff506573f09797900f0dfe79

$ git ls-remote https://github.com/camplight/orgops.git main
145f17f6b06df139ff506573f09797900f0dfe79	refs/heads/main
```

The local ref and a live, direct `git ls-remote` of the public GitHub repository agree. Every
line number and every quoted line of code in this document is current as of this commit,
verified on 2026-09-20.

## Reproduction

Every command below genuinely exits clean on its own; only the manual comparison that follows
them produces a finding. Leading with the passing steps, in order:

```bash
# 1. Confirm the upstream tip two independent ways (both must agree) — exits 0, no diff,
#    and prints the same value for any reader who has fetched the same public ref
git rev-parse upstream-live/main
git ls-remote https://github.com/camplight/orgops.git main

# 2. Extract upstream's current bytes at all four paths this report cites — the two sink
#    functions plus the two reachability call sites — all four exit 0
git show upstream-live/main:packages/db/src/index.ts | sed -n '24,31p'
git show upstream-live/main:apps/agent-runner/src/runner.ts | sed -n '168,174p'
git show upstream-live/main:apps/api/src/app.ts | sed -n '86,95p'
git show upstream-live/main:apps/api/src/routes/events.ts | sed -n '486,494p'

# 3. Confirm this fork's own guard files have no upstream counterpart — each of these three
#    is EXPECTED to fail, and does: `fatal: path '<path>' exists on disk, but not in
#    'upstream-live/main'`. A non-zero exit here is the correct, confirming result, not an
#    error in the reproduction.
git show upstream-live/main:packages/db/src/data-root.ts
git show upstream-live/main:packages/db/src/database-selections.ts
git show upstream-live/main:apps/agent-runner/src/workspace-location.ts
```

Steps 1 and 2 above are genuine passing steps: they exit zero and produce the raw material the
comparison and reachability evidence below are built from, with nothing hidden or summarized.
Step 3 is a different kind of pass — confirming an expected absence — and is labeled as such
rather than presented as a code-quality check with a result.

The pre-fix side of each comparison below comes from this fork's own private history, not from
a command a reader can re-run: the two fix commits live only in a private repository, so their
identifiers are withheld rather than cited (see the disclosure note in each item below) and no
`git show <hash>` step for them appears in this recipe.

There is no automated pass/fail check to run here, unlike the sibling complexity-findings
reports in this series: the rule family this report covers has no public, offline equivalent.
Once the raw material above is in hand, the comparison itself is a manual read, reported next.
**Stated plainly:** neither of this report's two items is a clean result — the vulnerable shape
is present, unmodified, at both cited upstream locations. Nothing in this document's scope
passes as guarded.

(If `upstream-live/main` is missing in a fresh checkout, create it first:
`git fetch https://github.com/camplight/orgops.git main:refs/remotes/upstream-live/main`.)

## Item 1 — `openDb` (`packages/db/src/index.ts`)

**This fork's own commit message for the `openDb` fix**, reworded only to drop two author email
addresses that appeared in the raw commit metadata — one embeds this contributor's employer's
mail domain, the other is tied to a specific personal-account git identity; both are **redacted
here, described only as redacted, and not reproduced in any form**. The commit's own identifier
is withheld for the same reason: it names a commit that exists only in a private repository an
upstream reader cannot open, so citing it would point at nothing a reader could follow. Nothing
else in the quoted text below is altered:

> fix(sonar): enforce the data-root and spawn guards at the sinks
>
> The prior remediation validated at the boundaries — an environment variable read in the
> entrypoint, the database path in the migrate CLI. Those guards do refuse hostile input, but
> SonarQube's taint engine flags the sinks, not the boundaries, so three original findings
> survived:
>
>   tssecurity:S8706  packages/db/src/index.ts:29   (new Database)
>   tssecurity:S6350  apps/container-entrypoint/src/index.ts:35 and :51  (spawn argv)
>
> Each is now guarded where the value is used:
>
> - openDb enforces the permitted data root at the sink itself. This reverses a documented
>   earlier decision not to guard there, and the reversal is recorded with its reason.
>   ":memory:" stays the single explicit carve-out, written at the sink so the sanitizer
>   itself remains total.
>
> Whether the taint findings actually clear can only be observed by the hosted scan —
> tssecurity is closed-source and cannot be run locally.

**The pre-fix vulnerable shape**, read directly from this fork's own pre-fix diff for
`packages/db/src/index.ts` (commit identifier withheld, per the note above — removed side):

```ts
export function openDb(path = DEFAULT_DB_PATH): OrgOpsDb {
  if (path !== ":memory:") {
    // Ensure parent directory exists for file-based SQLite paths.
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  configureDb(db);
  return db;
}
```

**Upstream's function today**, read directly
(`git show upstream-live/main:packages/db/src/index.ts`, lines 24–31, function `openDb`):

```ts
export function openDb(path = DEFAULT_DB_PATH): OrgOpsDb {
  if (path !== ":memory:") {
    // Ensure parent directory exists for file-based SQLite paths.
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  configureDb(db);
  return db;
}
```

**Verdict: byte-for-byte identical.** `path` reaches `mkdirSync(dirname(path), ...)` at line 27
and then `new Database(path)` at line 29 with zero containment — no absolute-path check, no
traversal check, no allowlisted root — in both the pre-fix fork code and upstream's current
tree, at function `openDb`, tip `145f17f6b06df139ff506573f09797900f0dfe79`.

**Reachability, read directly, not assumed, both at the same upstream tip:**

- `apps/api/src/app.ts`, lines 88–94: the `dbPath` derivation returns `config.dbPath`
  **unchanged** whenever it is `":memory:"` or starts with `"/"`, then passes it straight to
  `openDb(dbPath)` at line 94. A caller-supplied absolute path reaches the sink with no
  rewriting.
- `apps/api/src/routes/events.ts`, lines 488–493, function `createEventExportSqlite`, reachable
  from the `GET /api/events/export.sqlite` route (registered at line 743): `const tmpDir =
  mkdtempSync(join(tmpdir(), "orgops-events-export-")); const dbPath = join(tmpDir,
  "orgops-events.sqlite"); const exportDb = openDb(dbPath);`. This path is built from
  `os.tmpdir()`, which reads an environment variable — a value this fork's own remediation
  history, for a different, sibling finding in its own tooling, independently treats as
  taint-relevant. That specific engine behavior is itself something only the hosted scanner can
  confirm, not this report.

**This fork's fix direction** (prose only — see "What this PR contains" below for why no code
is included): derive the permitted data root from the module's own file location rather than
from any argument or environment variable, and enforce containment at the sink itself rather
than only at a caller-side boundary, keeping `":memory:"` as the one explicit carve-out written
at the sink.

## Item 2 — `ensureWorkspace` (`apps/agent-runner/src/runner.ts`)

**This fork's own commit message for the `ensureWorkspace` fix**, with the same redaction
applied to one author email address (a personal-account handle) for the same reason —
**redacted, described only as redacted, not reproduced**. The commit's own identifier and this
fork's internal pull-request number are withheld for the same reason given for item 1: both
name things that exist only inside a private repository an upstream reader cannot open:

> fix(runner): derive every filesystem path an API response influences [fork pull-request number withheld]
>
> Three values, all closing the same class of defect: a path derived from a remote API response
> reaching a filesystem sink.
>
> [...] ensureWorkspace DERIVES the workspace location instead of receiving it.
> agent.workspacePath arrived from a remote API response and, when absolute, went straight to
> mkdirSync -- a hostile response could create directories anywhere the process can write. The
> directory is now a literal root plus a label rebuilt character by character from an allowlist,
> plus an identity digest, so nothing derived from the response reaches mkdirSync.

**The pre-fix vulnerable shape**, read directly from this fork's own pre-fix diff for
`apps/agent-runner/src/runner.ts` (commit identifier withheld, per the note above — removed
side):

```ts
async function ensureWorkspace(agent: Agent) {
  const workspacePath = agent.workspacePath.startsWith("/")
    ? agent.workspacePath
    : resolve(PROJECT_ROOT, agent.workspacePath);
  mkdirSync(workspacePath, { recursive: true });
  agent.workspacePath = workspacePath;
}
```

**Upstream's function today**, read directly
(`git show upstream-live/main:apps/agent-runner/src/runner.ts`, lines 168–174, function
`ensureWorkspace`):

```ts
async function ensureWorkspace(agent: Agent) {
  const workspacePath = agent.workspacePath.startsWith("/")
    ? agent.workspacePath
    : resolve(PROJECT_ROOT, agent.workspacePath);
  mkdirSync(workspacePath, { recursive: true });
  agent.workspacePath = workspacePath;
}
```

**Verdict: byte-for-byte identical.** `agent.workspacePath` — sourced from an `Agent` record
this function receives as a parameter, i.e. ultimately from a remote API response per this
fork's own commit description — reaches `mkdirSync(workspacePath, { recursive: true })` with the
only conditional being an absolute-path check that, when true, uses the value **unchanged**
rather than rejecting or rewriting it. No allowlist, no root confinement, no traversal check, in
both the pre-fix fork code and upstream's current tree, at function `ensureWorkspace`, tip
`145f17f6b06df139ff506573f09797900f0dfe79`.

**Not confirmed by this report, stated honestly:** this exact function is not one of the
rule-and-file pairs this fork's own CI gate currently tracks as required-absent — that gate
tracks a downstream sink inside a supervisor process (`apps/container-entrypoint`) that does not
exist upstream at all (see "Fork-only guard files" below). This report treats `ensureWorkspace`
as the same root cause, independently reachable, present in a file upstream ships — which is
what a direct code read can support — not as a claim that this exact rule-and-file pair appears
on the fork's own tracked list.

**This fork's fix direction** (prose only): derive the workspace directory constructively — a
literal root plus a label rebuilt character-by-character from an allowlist plus an identity
digest — instead of accepting a server-supplied path verbatim.

## Fork-only guard files (context, not part of either verdict)

Confirmed absent upstream by `git show upstream-live/main:<path>` failing for each, at the same
tip, with `fatal: path '<path>' exists on disk, but not in 'upstream-live/main'`:

- `packages/db/src/data-root.ts`
- `packages/db/src/database-selections.ts`
- `apps/agent-runner/src/workspace-location.ts`

These are this fork's own remediation machinery. Their absence upstream is why this report's fix
direction is prose-only — described above as an approach, not shipped as a reusable diff.

## Non-reproducing claims

None. Both items above reproduced exactly against the current upstream tip — same files, same
functions, same line ranges, same verdict — subject to the confidence ceiling stated in
"Method and confidence" above.

## Limits — read before trusting this report as complete

- **This is a code read, not an engine run.** The `tssecurity:*` rule family needs a
  closed-source, subscription-only taint engine that only runs on a hosted analysis server this
  fork has no offline access to. Nothing in this report substitutes for that engine's own
  verdict; a hosted-engine run is materially stronger evidence than a manual code read, and this
  report's confidence is capped below what the complexity-family findings in the companion
  submissions in this series can claim, for exactly that reason.
- **Reachability was traced for two specific call sites per item, not exhaustively.** This
  report traced `app.ts`'s `dbPath` derivation and `events.ts`'s export route for item 1, and the
  constructor-parameter path for item 2, but did not walk every caller of `openDb` or
  `ensureWorkspace` in upstream's current tree. It cannot rule out some other caller reaching
  either sink through a path not examined here.
- **This report cannot rule out an upstream-side containment layer it did not search for.**
  Whether upstream has some other validation mechanism upstream of these two functions — a
  request-validation layer that rejects absolute or traversal paths before either call site is
  reached — was not searched for beyond the specific call sites cited above. Its absence is
  asserted only for those two call sites, not for the codebase at large.
- **A measurement of shape, not a claim about exploitability today.** This report shows that a
  specific unguarded pattern is present and reachable by the paths traced; it does not claim an
  end-to-end exploit was demonstrated, or that upstream's current deployment configuration makes
  either path practically reachable by a hostile actor. That judgment is left to whoever triages
  this.

## What this PR contains

Exactly one new file: this document. No source file is changed, no dependency is added to this
repository, no CI workflow is touched, and no fix code is included — the fix direction for each
item is described in prose only, because the fork's own guard files that implement it do not
exist upstream in any reusable form (see "Fork-only guard files" above). The reproduction recipe
above runs entirely outside this repository, in a throwaway clone, against commit history and
file contents this fork or upstream already has — it leaves no trace in the tree this PR
touches.
