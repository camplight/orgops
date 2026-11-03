# Proposal: a verifier for the commands `SKILL.md` files document

**Status:** proposal, not yet adopted. Submitted from a private fork of this
project, maintained independently. Nothing in this document depends on any
infrastructure outside this repository.

## The problem, in this repo's own terms

This project documents agent skills as `skills/<name>/SKILL.md` files, each
with fenced example commands a reader (human or agent) is expected to copy
and run. At upstream `main` (`145f17f`) there are eight such files:

```
skills/agent-management/SKILL.md
skills/browser-use-lightpanda/SKILL.md
skills/coordination/SKILL.md
skills/gcli/SKILL.md
skills/secrets/SKILL.md
skills/slack/SKILL.md
skills/tavily/SKILL.md
skills/trello-cli/SKILL.md
```

A real example, verbatim from `skills/secrets/SKILL.md`:

```bash
node --import tsx {baseDir}/assets/set.ts -- <package> <key> <value>
```

Nothing in the repository checks that this command, or any of the roughly
forty other fenced commands across these eight files, still runs. A skill's
underlying script can be renamed, a flag can be dropped, or an example can
simply have been wrong on the day it was written, and `SKILL.md` will still
read as correct until an agent or a human hits the failure at run time. There
is no test, lint rule, or CI step that opens these files and executes what
they document.

This proposal is one script that closes that gap: it reads a `SKILL.md`,
extracts every command a reader would actually run, runs it, and reports a
verdict a maintainer or a CI job can act on.

## What the script does

File: `scripts/verify-skill-commands.mjs`. Invocation:

```bash
node scripts/verify-skill-commands.mjs <path to a SKILL.md>
```

Concretely, verified against the script's own source:

- **Which fences it executes.** It parses every fenced code block (`` ``` ``
  or `~~~`, three or more characters) and executes the ones whose info string
  is `bash`, `sh`, `shell`, or `console` (`EXECUTABLE_INFO_STRINGS`, declared
  at `scripts/verify-skill-commands.mjs:30` in the draft in this PR). A
  `json`-fenced example — the shape used for illustrating a payload, not a
  command — is left alone. Blank lines and `#`-comment lines inside an
  executable fence are skipped; every other non-blank line is treated as one
  command to run.
- **How it handles placeholders.** A command may carry angle-bracket tokens
  matching `<[a-z][a-z0-9_-]*>` (lowercase only — `<PROJECT_ID>`-style
  upper-case placeholders, used in this repo's own `skills/gcli/SKILL.md`,
  are treated as literal text, not placeholders; see Limits below). The
  script recognizes exactly one placeholder it substitutes itself, `<skill>`,
  which it replaces with the directory the `SKILL.md` file lives in. Any
  other placeholder must be defined somewhere in the document's *prose*
  (outside every fenced block) or the command is refused, unexecuted, with
  the undefined token named. If a placeholder is defined in prose but still
  present in the command after substitution — nothing in the script
  auto-fills it — it is likewise refused, unexecuted, rather than handed to
  the shell with the angle brackets intact.
- **What it does with a command it cannot run.** Every command is executed
  verbatim through `/bin/bash -lc`, with the process's own inherited
  environment, a 120-second timeout, and stdout/stderr captured. A non-zero
  exit, a spawn error, or a timeout are all recorded as a failure carrying
  the first line of stderr; nothing throws or aborts the run early, so one
  bad command does not hide the verdict on the rest.
- **What it prints.** One line per failure on stderr,
  `FAIL: <documented command> -- <reason>`, naming the command exactly as
  written in the document. Exactly one JSON object on stdout, always,
  win or lose: `{ document, skill, checked, failed, ok, commands }`, where
  `commands` is the full per-command detail (`documented`, `resolved`,
  `exit`, `ok`, `reason`).
- **What each exit code means.** `0` — every executable command ran and
  exited zero, and at least `COMMANDS_FLOOR` (3) commands were actually
  checked. `1` — at least one command failed, OR zero commands failed but
  fewer than the floor were checked (a document with no executable commands
  at all cannot read as a pass). `2` — usage error: no path given, more than
  one argument given, or the given path does not resolve to a readable file.
  The floor exists specifically so a `SKILL.md` with its command fences
  accidentally deleted, or none ever added, cannot report green by having
  nothing to check.
- **Imports.** `node:child_process`, `node:fs`, `node:path` — Node builtins
  only, confirmed by reading the top of the file; no `package.json`
  dependency is required to run it.

## Seeing it work

Run against this repository's own real, unmodified `skills/trello-cli/SKILL.md`
(chosen because none of its commands need the `<skill>` placeholder, so the
run below needs no fixture):

```
$ node scripts/verify-skill-commands.mjs skills/trello-cli/SKILL.md
FAIL: node --import tsx skills/secrets/assets/set.ts -- trello TRELLO_API_KEY <value> -- the document never defines <value> outside its command fences, so a reader cannot resolve this command
FAIL: node --import tsx skills/secrets/assets/set.ts -- trello TRELLO_TOKEN <value> -- the document never defines <value> outside its command fences, so a reader cannot resolve this command
FAIL: node --import tsx skills/trello-cli/assets/ensure.ts -- exited 1: node:internal/modules/package_json_reader:316
FAIL: node --import tsx skills/trello-cli/assets/run.ts -- --help -- exited 1: node:internal/modules/package_json_reader:316
FAIL: node --import tsx skills/trello-cli/assets/run.ts -- boards -- exited 1: node:internal/modules/package_json_reader:316
FAIL: node --import tsx skills/trello-cli/assets/run.ts -- cards --help -- exited 1: node:internal/modules/package_json_reader:316
{"document":".../skills/trello-cli/SKILL.md","skill":".../skills/trello-cli","checked":6,"failed":6,"ok":false, ...}
$ echo $?
1
```

(As above, `...` elides only the local absolute path prefix; every other
character, including the full stderr lines, is the real output of this
run.)

This is a genuine failure, not a contrived one, and it is exactly the class
of problem this tool exists to surface: the document uses `<value>` as an
illustrative placeholder without ever defining it in prose, so the checker
correctly refuses to guess a value and run the command blind, and the two
`ensure.ts`/`run.ts` invocations fail for an environment reason (a `tsx`
runtime resolution error in the sandbox this was run in) that a reader would
have hit too.

For the passing and usage paths, a minimal three-command fixture,
`demo-skill/SKILL.md`:

````
---
name: demo
description: "Minimal demo skill."
---
`<skill>` below means this skill's own directory.
```bash
command -v echo
```
```bash
echo "hello from <skill>"
```
```bash
pwd
```
````

Run against it:

```
$ node scripts/verify-skill-commands.mjs demo-skill/SKILL.md
{"document":".../demo-skill/SKILL.md","skill":".../demo-skill","checked":3,"failed":0,"ok":true, ...}
$ echo $?
0

$ node scripts/verify-skill-commands.mjs
error: no SKILL.md path was given.
usage: node scripts/verify-skill-commands.mjs <path to a published SKILL.md>
...
$ echo $?
2
```

Both runs above were executed for real against this fixture and this
project's own `scripts/verify-skill-commands.mjs`; only the absolute path
prefix (`...`) is elided for readability.

## Adoption

- **Where it lands.** `scripts/verify-skill-commands.mjs`, alongside this
  project's other repository-level scripts. No new directory, no new
  dependency, no change to any existing file.
- **How a maintainer invokes it.** Directly, per skill:
  `node scripts/verify-skill-commands.mjs skills/<name>/SKILL.md`. It takes
  no other configuration.
- **A minimal CI step**, run once per skill (pseudocode, deliberately generic
  rather than tied to this project's specific workflow syntax):

  ```yaml
  - name: verify skill commands
    run: |
      for f in skills/*/SKILL.md; do
        node scripts/verify-skill-commands.mjs "$f"
      done
  ```

  Each invocation's own exit code is the signal; a CI runner needs nothing
  else from this script.

## Limits — read before trusting a green

- **It only recognizes lowercase placeholders.** `skills/gcli/SKILL.md`'s own
  `<PROJECT_ID>` is not treated as a placeholder by this script at all; it is
  passed straight to the shell as literal text and will fail (or, worse,
  silently succeed against a real project named `PROJECT_ID`, if one ever
  existed). Adopting this script as-is means either lower-casing this
  project's placeholder convention or extending `PLACEHOLDER_RE` first.
- **A false pass is easy to construct.** A command that is syntactically
  valid but semantically wrong — the right binary, the wrong flag, a
  successful no-op — exits 0 and reads as verified. This script proves a
  command *runs*, not that it does what the prose around it claims.
- **It cannot verify anything stateful or destructive.** A command that
  deletes a resource, requires a real credential, or depends on a service
  being up is either going to fail in CI for an unrelated reason or needs to
  be excluded from the executable fence types on purpose (e.g. documented as
  a `console` example showing expected output rather than a `bash` fence
  meant to be run).
- **Why it deliberately is not itself a skill asset.** If this script were
  documented inside a `SKILL.md`, extracting and running that document's own
  fences would try to run the verifier against itself, recursively. Keeping
  it a plain maintainer-invoked script under `scripts/` avoids that loop
  entirely; this is a design decision, not an oversight.

## Alternative considered: a doc test per skill

The obvious alternative is a hand-written test per skill that exercises its
documented commands directly. That scales worse than one shared verifier:
every new skill needs its own bespoke test written and kept in sync by hand,
whereas this script's job is exactly to make a *new* skill's documented
commands checked automatically, with no new check to write, the moment the
skill exists.

## What this PR contains

Exactly two files: this document, and the working script it describes,
`scripts/verify-skill-commands.mjs`. No changes to any existing file, no new
dependency, no CI wiring — the CI step above is a suggestion for a
maintainer to adopt on their own terms, not something this PR installs.
