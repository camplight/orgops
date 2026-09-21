# Findings: inherited code-quality debt in the user-facing SPA root component

**Status:** findings report, not yet adopted. Submitted from a private fork of this project,
maintained independently. No code change is proposed by this document; it is evidence, not a
patch.

## The problem, in this repo's own terms

`apps/user-ui/src/App.tsx` is the user-facing single-page app's root component and its
supporting helpers, all in one file. At upstream `main`
(`145f17f6b06df139ff506573f09797900f0dfe79`, confirmed live 2026-09-20 — see "Upstream tip
used" below) the file is 2,789 lines long and contains a root component and several helper
functions that have grown large branching bodies: a root component that assembles and wires
together most of the app's runtime behavior in one function body, plus helper functions for
rendering trace/event detail, loading data on mount, and handling realtime events, several of
which branch extensively inline. The file also contains several closures nested inside JSX
event handlers and array-filter callbacks, four levels deep or more.

Nothing in this repository's own tooling flags that shape today. There is no static-analysis
step in either of the two GitHub Actions workflows this repository runs
(`opscli-smoke.yml`, `release-main.yml`), and the `lint` script already defined in the root
`package.json` is not invoked by either workflow. A root component built this way can keep
absorbing new responsibilities indefinitely, with nothing measuring how large it has become.

## What is proposed

Not a fix — a measurement, offered as findings a maintainer can act on however they choose.
This document reports, for `apps/user-ui/src/App.tsx`:

- every function in the file whose cognitive complexity exceeds a published threshold, with
  the exact line where it begins,
- every closure-nesting depth violation in the file against the same published threshold
  family,
- the exact tool, exact pinned versions, and exact command used to measure all of the above, so
  a reader can reproduce every number independently without asking the reporter to be trusted
  on faith.

No refactor is proposed or included. The numbers below are real findings against a real file
this project ships today; what to do about them — extract helpers, split the component, leave
as-is — is left entirely to whoever upstream triages this.

## Method

The measurement uses two public rules from
[`eslint-plugin-sonarjs`](https://www.npmjs.com/package/eslint-plugin-sonarjs):
`sonarjs/cognitive-complexity`, configured at threshold `15` — the same threshold a
SonarQube-family hosted scanner documents for its own `typescript:S3776` ("Cognitive
Complexity") rule, which this rule reproduces — and `sonarjs/no-nested-functions`, configured
at threshold `4`, mirroring that same scanner's `typescript:S2004` ("functions should not be
nested too deeply") rule. (A companion, related proposal in this same submission series
proposes this same rule/threshold pairing as a standalone local lint config; this document does
not depend on that proposal being adopted — the rules and thresholds are public and
independently installable either way.) Both rules were run directly against file contents
extracted byte-for-byte from `upstream-live/main` with `git show`, in an isolated scratch
directory with no other files present, so nothing about this repository's own (unrelated)
source tree could influence the result.

**Classification:** every finding below is **STILL PRESENT UPSTREAM** — the exact same
function or closure, at the exact same line, has the exact same shape in upstream's tree today.

## Upstream tip used

```
$ git rev-parse upstream-live/main
145f17f6b06df139ff506573f09797900f0dfe79

$ git ls-remote https://github.com/camplight/orgops.git main
145f17f6b06df139ff506573f09797900f0dfe79	refs/heads/main

$ git log -1 --format='%H %cI %s' upstream-live/main
145f17f6b06df139ff506573f09797900f0dfe79 2026-09-19T16:21:59+03:00 feat(opscli): add component installs and runner invites (#26)
```

The local ref and a live, direct `git ls-remote` of the public GitHub repository agree. Every
line number and every complexity number in this document is current as of this commit,
measured on 2026-09-20 — not carried over from an earlier measurement. Same tip used for a
companion, sibling submission in this same series covering the admin-UI screens.

## Reproduction: the tooling is confirmed clean before it is pointed at a real finding

Before the findings below, confirm the check itself is sound — every step here succeeds with
zero errors, on purpose, so a reader can trust that a later failure is a real finding and not a
broken probe:

```bash
# 0. Create the local ref this recipe uses, if it doesn't already exist
git fetch https://github.com/camplight/orgops.git main:refs/remotes/upstream-live/main

# 1. Confirm the upstream tip two independent ways (both must agree)
git rev-parse upstream-live/main
git ls-remote https://github.com/camplight/orgops.git main

# 2. Install the three pinned, public dependencies in a throwaway directory
mkdir -p /path/to/a/scratch/dir && cd /path/to/a/scratch/dir
cat > package.json <<'EOF'
{
  "name": "spec03b-probe",
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

Both of these steps exit clean: the two tip checks agree, and the pinned install completes
with no error. The check itself is proven sound before it is used to look for a problem — not
after.

Only the next step, run against the one real file that is this document's whole subject,
produces a finding. This document does not manufacture a softer opener by pointing the
tool at an unrelated file first: `App.tsx` fails the check under the same config used above,
and this document says so plainly.

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
      parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } }
    },
    plugins: { sonarjs },
    rules: RULES
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module" },
    plugins: { sonarjs },
    rules: RULES
  }
];
EOF

# 4. Extract the upstream file byte-for-byte (never a locally modified copy)
mkdir -p files
git show upstream-live/main:apps/user-ui/src/App.tsx > files/App.tsx

wc -l files/App.tsx
# 2789 files/App.tsx

# 5. Run the check
./node_modules/.bin/eslint --no-config-lookup --config eslint.config.mjs files/App.tsx
```

Both rules are relevant to this document: `App.tsx`, unlike the admin-UI screens covered by a
companion submission in this series, has findings under both `sonarjs/cognitive-complexity`
and `sonarjs/no-nested-functions`.

### Pinned versions actually installed

| Package | Pin used | Resolved/installed |
|---|---|---|
| `eslint` | `9.39.5` | `9.39.5` |
| `eslint-plugin-sonarjs` | `4.2.0` | `4.2.0` |
| `typescript-eslint` | `8.70.0` | `8.70.0` |
| `typescript` | not pinned for this tool anywhere in this fork (no lockfile exists for it) | `6.0.3`, resolved by npm as a peer dependency of `typescript-eslint@8.70.0` (`peerDependencies.typescript: ">=4.8.4 <6.1.0"`) |

Stated plainly rather than silently picked: the `typescript` version above is whatever npm's
own peer-dependency resolution chose at install time on 2026-09-20, not a number pinned by any
config this document cites. A different install, on a different day, could resolve a different
`typescript` version within that same peer range.

## Findings — verbatim probe output, run on 2026-09-20

```
$ ./node_modules/.bin/eslint --no-config-lookup --config eslint.config.mjs files/App.tsx

/path/to/a/scratch/dir/files/App.tsx
   177:10  error  Refactor this function to reduce its Cognitive Complexity from 53 to the 15 allowed   sonarjs/cognitive-complexity
   216:10  error  Refactor this function to reduce its Cognitive Complexity from 22 to the 15 allowed   sonarjs/cognitive-complexity
   241:10  error  Refactor this function to reduce its Cognitive Complexity from 30 to the 15 allowed   sonarjs/cognitive-complexity
   484:10  error  Refactor this function to reduce its Cognitive Complexity from 18 to the 15 allowed   sonarjs/cognitive-complexity
   511:25  error  Refactor this function to reduce its Cognitive Complexity from 101 to the 15 allowed  sonarjs/cognitive-complexity
   784:18  error  Refactor this function to reduce its Cognitive Complexity from 20 to the 15 allowed   sonarjs/cognitive-complexity
   837:70  error  Refactor this code to not nest functions more than 4 levels deep                      sonarjs/no-nested-functions
   912:18  error  Refactor this function to reduce its Cognitive Complexity from 18 to the 15 allowed   sonarjs/cognitive-complexity
  1109:12  error  Refactor this function to reduce its Cognitive Complexity from 19 to the 15 allowed   sonarjs/cognitive-complexity
  2236:65  error  Refactor this code to not nest functions more than 4 levels deep                      sonarjs/no-nested-functions
  2303:47  error  Refactor this code to not nest functions more than 4 levels deep                      sonarjs/no-nested-functions

✖ 11 problems (11 errors, 0 warnings)
```

(Only the throwaway scratch-directory path prefix is elided/generalized above; every other
character — file name, line:column pairs, and the exact wording ESLint reports — is the real,
unedited output of this run. `eslint --version` for this run: `v9.39.5`.
`eslint-plugin-sonarjs` version read from its own installed `package.json`: `4.2.0`.)

### Symbol identification (read directly from the surrounding source)

```
177: function traceTitle(event: EventRow) {
216: function traceDetail(event: EventRow) {
241: function traceChipCode(event: EventRow) {
484: function parseMessageAttachments(payload: unknown): MessageAttachment[] {
511: export default function App() {
784:   async function loadShell() {
912:   async function loadMessages(
1109:   function handleIncomingRealtimeEvent(event: EventRow) {
```

The three `sonarjs/no-nested-functions` findings (lines 837, 2236, 2303) are anonymous
arrow-function closures nested inside JSX event handlers/filter callbacks; none of the three
has a stable named symbol beyond its line:column, which is why they are cited by exact location
rather than by name in the table below.

### Findings table — cognitive complexity (`sonarjs/cognitive-complexity`, threshold 15)

| # | File (upstream path) | Function | Line at tip `145f17f` | Measured Cognitive Complexity | Classification |
|---|---|---|---|---|---|
| 1 | `apps/user-ui/src/App.tsx` | `traceTitle` | 177 | **53** | STILL PRESENT UPSTREAM |
| 2 | `apps/user-ui/src/App.tsx` | `traceDetail` | 216 | **22** | STILL PRESENT UPSTREAM |
| 3 | `apps/user-ui/src/App.tsx` | `traceChipCode` | 241 | **30** | STILL PRESENT UPSTREAM |
| 4 | `apps/user-ui/src/App.tsx` | `parseMessageAttachments` | 484 | **18** | STILL PRESENT UPSTREAM |
| 5 | `apps/user-ui/src/App.tsx` | `export default function App()` | 511 | **101** | STILL PRESENT UPSTREAM |
| 6 | `apps/user-ui/src/App.tsx` | `loadShell` | 784 | **20** | STILL PRESENT UPSTREAM |
| 7 | `apps/user-ui/src/App.tsx` | `loadMessages` | 912 | **18** | STILL PRESENT UPSTREAM |
| 8 | `apps/user-ui/src/App.tsx` | `handleIncomingRealtimeEvent` | 1109 | **19** | STILL PRESENT UPSTREAM |

### Findings table — nested-function depth (`sonarjs/no-nested-functions`, threshold 4)

| # | File (upstream path) | Line:column at tip `145f17f` | Symbol | Classification |
|---|---|---|---|---|
| 9 | `apps/user-ui/src/App.tsx` | 837:70 | anonymous closure, no stable name | STILL PRESENT UPSTREAM |
| 10 | `apps/user-ui/src/App.tsx` | 2236:65 | anonymous closure, no stable name | STILL PRESENT UPSTREAM |
| 11 | `apps/user-ui/src/App.tsx` | 2303:47 | anonymous closure, no stable name | STILL PRESENT UPSTREAM |

File size for context (`wc -l`): 2,789 lines.

## Non-reproducing claims

None: every number above is exactly what the reproduction recipe in this document produces when
run against the cited upstream tip.

## Limits — read before trusting this report as complete

- **This measures one file.** Every finding above is in `apps/user-ui/src/App.tsx`. No claim is
  made about any other file in `apps/user-ui/` or elsewhere in this repository.
- **A public offline rule, not the hosted engine.** `sonarjs/cognitive-complexity` and
  `sonarjs/no-nested-functions` are published, installable approximations of a SonarQube-family
  hosted scanner's `typescript:S3776` and `typescript:S2004` rules, run here with a public,
  offline ESLint plugin. This document does not run, and had no access to, the hosted scanner
  itself; a hosted scan could, in principle, report different numbers for the same code.
- **A measurement, not a verdict on severity.** A high cognitive-complexity number, or a deep
  closure-nesting finding, says a function is hard to hold in one's head while reading it; it
  does not, by itself, say the function is wrong, buggy, or urgent to fix. This document reports
  the numbers and leaves the judgment call — whether to extract helpers, split the component,
  or leave it as-is — to whoever triages it upstream.
- **The three nesting findings have no stable symbol name.** Lines 837, 2236, and 2303 are
  anonymous arrow-function closures inside JSX; they are cited by exact line:column only, which
  is more prone to drift on unrelated edits than a named-function citation. A reader who wants
  to re-locate them after further upstream changes should search for closures nested inside
  event handlers or array-filter callbacks near those lines rather than trusting the line number
  alone.
- **`typescript` itself is not pinned for this check** (see the pinned-versions table above) —
  flagged rather than silently resolved, because a different peer-dependency resolution could,
  in principle, parse the same file slightly differently.
- **No attempt was made to map each finding to a specific historical change.** This document
  measures the file's current state only; it makes no claim about which prior edits, by whom,
  introduced or grew any individual finding.
- **The taint/security rule family needs a closed-source engine.** No `tssecurity:*`-equivalent
  check was run or is claimed here; this document's scope is limited to the two rules named
  above.

## What this PR contains

Exactly one new file: this document. No source file is changed, no dependency is added to this
repository, and no CI workflow is touched. The reproduction recipe above runs entirely outside
this repository, in a throwaway directory, against file contents extracted from upstream — it
leaves no trace in the tree this PR touches.
