# Findings: inherited code-quality debt in the admin-UI screens

**Status:** findings report, not yet adopted. Submitted from a private fork of this project,
maintained independently. No code change is proposed by this document; it is evidence, not a
patch.

## The problem, in this repo's own terms

`apps/admin-ui/` ships three screen components under `apps/admin-ui/src/screens/`:
`ChannelsScreen.tsx`, `HumansScreen.tsx`, and `TeamsScreen.tsx`. At upstream `main`
(`145f17f6b06df139ff506573f09797900f0dfe79`, confirmed live 2026-09-20 — see "Upstream tip
used" below), each of these three files contains one large function that handles a screen's
user-driven events: a single function, in each file, that branches on which action the user
took and does the corresponding side-effecting work inline.

Nothing in this repository's own tooling flags that shape today. There is no static-analysis
step in either of the two GitHub Actions workflows this repository runs
(`opscli-smoke.yml`, `release-main.yml`), and the `lint` script already defined in the root
`package.json` is not invoked by either workflow. A large event-handling function can grow
new branches indefinitely, in three different screens independently, with nothing measuring
how large "large" has become.

## What is proposed

Not a fix — a measurement, offered as three findings a maintainer can act on however they
choose. This document reports, for each of the three files above:

- the exact line where the oversized function begins,
- its measured cognitive complexity, against a published threshold,
- the exact tool, exact pinned versions, and exact command used to measure it, so a reader can
  reproduce every number independently without asking the reporter to be trusted on faith.

No refactor is proposed or included. The three numbers below are real findings against real
files this project ships today; what to do about them — extract helpers, split the component,
leave as-is — is left entirely to whoever upstream triages this.

## Method

The measurement uses one public rule from [`eslint-plugin-sonarjs`](https://www.npmjs.com/package/eslint-plugin-sonarjs),
`sonarjs/cognitive-complexity`, configured at threshold `15` — the same threshold a
SonarQube-family hosted scanner documents for its own `typescript:S3776` ("Cognitive
Complexity") rule, which this rule reproduces. (A companion, related proposal in this same
submission series proposes this same rule/threshold pairing as a standalone local lint config;
this document does not depend on that proposal being adopted — the rule and threshold are
public and independently installable either way.) The rule was run directly against file
contents extracted byte-for-byte from `upstream-live/main` with `git show`, in an isolated
scratch directory with no other files present, so nothing about this repository's own
(unrelated) source tree could influence the result.

**Classification:** all three findings below are **STILL PRESENT UPSTREAM** — the exact same
function, at the exact same line, still has the exact same shape in upstream's tree today.

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
measured on 2026-09-20 — not carried over from an earlier measurement.

## Reproduction: the tooling is confirmed clean before it is pointed at a real finding

Before the three findings below, confirm the check itself is sound — every step here succeeds
with zero errors, on purpose, so a reader can trust that a later failure is a real finding and
not a broken probe:

```bash
# 0. Create the local ref this recipe uses to name the upstream tip (a stranger's clone
#    has no such ref until this runs)
git fetch https://github.com/camplight/orgops.git main:refs/remotes/upstream-live/main

# 1. Confirm the upstream tip two independent ways (both must agree)
git rev-parse upstream-live/main
git ls-remote https://github.com/camplight/orgops.git main

# 2. Install the three pinned, public dependencies in a throwaway directory
mkdir -p /path/to/a/scratch/dir && cd /path/to/a/scratch/dir
cat > package.json <<'EOF'
{
  "name": "spec03a-probe",
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

Only the next step, run against the three real files that are this document's whole subject,
produces a finding. There is no fourth, unrelated admin-UI file being held back as a "passing"
example to open with: all three files in this document's scope currently fail the check, and
this document says so plainly rather than manufacturing a softer opener.

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

# 4. Extract the three upstream files byte-for-byte (never a locally modified copy)
mkdir -p files
git show upstream-live/main:apps/admin-ui/src/screens/ChannelsScreen.tsx > files/ChannelsScreen.tsx
git show upstream-live/main:apps/admin-ui/src/screens/HumansScreen.tsx  > files/HumansScreen.tsx
git show upstream-live/main:apps/admin-ui/src/screens/TeamsScreen.tsx   > files/TeamsScreen.tsx

# 5. Run the check
./node_modules/.bin/eslint --no-config-lookup --config eslint.config.mjs \
  files/ChannelsScreen.tsx files/HumansScreen.tsx files/TeamsScreen.tsx
```

Only `sonarjs/cognitive-complexity` (threshold `15`) is relevant to this document; the
`sonarjs/no-nested-functions` rule is included in the config above because it is the fork's
own paired rule for this same tool, but it produced no finding in these three files and is not
part of this document's claims.

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
$ ./node_modules/.bin/eslint --no-config-lookup --config eslint.config.mjs files/ChannelsScreen.tsx files/HumansScreen.tsx files/TeamsScreen.tsx

/path/to/a/scratch/dir/files/ChannelsScreen.tsx
  30:17  error  Refactor this function to reduce its Cognitive Complexity from 27 to the 15 allowed  sonarjs/cognitive-complexity

/path/to/a/scratch/dir/files/HumansScreen.tsx
  24:17  error  Refactor this function to reduce its Cognitive Complexity from 21 to the 15 allowed  sonarjs/cognitive-complexity

/path/to/a/scratch/dir/files/TeamsScreen.tsx
  21:17  error  Refactor this function to reduce its Cognitive Complexity from 21 to the 15 allowed  sonarjs/cognitive-complexity

✖ 3 problems (3 errors, 0 warnings)
```

(Only the throwaway scratch-directory path prefix is elided/generalized above; every other
character — file names, line:column pairs, and the exact wording ESLint reports — is the real,
unedited output of this run. `eslint --version` for this run: `v9.39.5`.
`eslint-plugin-sonarjs` version read from its own installed `package.json`: `4.2.0`.)

### Findings table

| # | File (upstream path) | Line at tip `145f17f` | Measured Cognitive Complexity | Threshold | Rule | Classification |
|---|---|---|---|---|---|---|
| 1 | `apps/admin-ui/src/screens/ChannelsScreen.tsx` | 30 | **27** | 15 | `sonarjs/cognitive-complexity` (`typescript:S3776`) | STILL PRESENT UPSTREAM |
| 2 | `apps/admin-ui/src/screens/HumansScreen.tsx` | 24 | **21** | 15 | `sonarjs/cognitive-complexity` (`typescript:S3776`) | STILL PRESENT UPSTREAM |
| 3 | `apps/admin-ui/src/screens/TeamsScreen.tsx` | 21 | **21** | 15 | `sonarjs/cognitive-complexity` (`typescript:S3776`) | STILL PRESENT UPSTREAM |

File sizes for context (`wc -l`, same three files): `ChannelsScreen.tsx` 714 lines,
`HumansScreen.tsx` 314 lines, `TeamsScreen.tsx` 642 lines.

Symbol identity for all three: reading the surrounding source at the reported line in each
file confirms a single large event-handling function/component body begins there, consistent
with the shape this document describes above ("one large event-handling function each").

## Non-reproducing claims

None. All three findings above reproduced exactly against the current upstream tip — same
files, same lines, same complexity values, same classification.

## Limits — read before trusting this report as complete

- **ESLint reports a token, not always a name.** The line:column ESLint prints for
  `sonarjs/cognitive-complexity` is the function's opening keyword/identifier token, which is
  not, in every case, a separately nameable symbol distinct from "the function starting at this
  line" — this document cites the exact reported location plus a manual read of the
  surrounding source, not an independently derived function name, for that reason.
- **Only the complexity family is measured here.** `sonarjs/no-nested-functions` was run in
  the same pass and found nothing in these three files; this document makes no nesting-depth
  claim. The security/taint rule family (`tssecurity:*`-equivalent findings) needs a
  closed-source, subscription-gated analysis engine with no public npm equivalent; it was not
  checked here and this document makes no claim about it one way or the other for these three
  files.
- **A measurement, not a verdict on severity.** A high cognitive-complexity number says a
  function is hard to hold in one's head while reading it; it does not, by itself, say the
  function is wrong, buggy, or urgent to fix. This document reports the number and leaves the
  judgment call to whoever triages it.
- **`typescript` itself is not pinned for this check** (see the pinned-versions table above) —
  flagged rather than silently resolved, because a different peer-dependency resolution could,
  in principle, parse the same file slightly differently.

## What this PR contains

Exactly one new file: this document. No source file is changed, no dependency is added to this
repository, and no CI workflow is touched. The reproduction recipe above runs entirely outside
this repository, in a throwaway directory, against file contents extracted from upstream — it
leaves no trace in the tree this PR touches.
