#!/usr/bin/env node
// Verify that a reader of a published SKILL.md can run every command it
// documents.
//
// Maintainer-invoked repository script. It is deliberately NOT a skill
// asset and deliberately NOT documented in any SKILL.md: documenting it would
// make the check extract and run itself recursively.
//
// Node builtins only, no npm dependency, so it runs even where node_modules
// is absent.
//
//   node scripts/verify-skill-commands.mjs <path to SKILL.md>
//
// The single input is the SKILL.md path AS PUBLISHED in the reader's skill
// index line: a required argument, no default and no repo-relative fallback.
// Always one JSON report object on stdout; the verdict lives in the exit
// status -- 0 pass, 1 failed-or-vacuous, 2 usage.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const USAGE_EXIT = 2;
const FAILURE_EXIT = 1;

// Only these info strings are executable. `json` fences are prose -- they
// carry placeholders such as <the issue summary> that no reader ever runs.
// Info-string selection is what makes a new skill's commands checked
// automatically, with no new check to write.
const EXECUTABLE_INFO_STRINGS = new Set(["bash", "sh", "shell", "console"]);

const FENCE_RE = /^(`{3,}|~{3,})\s*([A-Za-z0-9_+-]*)$/;

// The placeholder shape a documented command is allowed to carry.
const PLACEHOLDER_RE = /<[a-z][a-z0-9_-]*>/g;

// The one placeholder this verifier substitutes: the skill's own directory.
const SKILL_PLACEHOLDER = "<skill>";

// The number of commands documented when this check was built. The floor is
// a MINIMUM, never an equality, so it never needs editing to stay true as
// later skills document more commands -- it only stops a vacuous pass.
const COMMANDS_FLOOR = 3;

const COMMAND_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// The document's fenced blocks
// ---------------------------------------------------------------------------

function fenceBlocks(document) {
  const blocks = [];
  let openMarker = null;
  let openInfo = null;
  let body = [];
  for (const line of document.split("\n")) {
    const match = FENCE_RE.exec(line.trim());
    if (openMarker === null) {
      if (match) {
        openMarker = match[1][0].repeat(3);
        openInfo = match[2].toLowerCase();
        body = [];
      }
      continue;
    }
    if (match?.[1][0].repeat(3) === openMarker && !match[2]) {
      blocks.push({ info: openInfo, body });
      openMarker = null;
      openInfo = null;
      body = [];
      continue;
    }
    body.push(line);
  }
  if (openMarker !== null) {
    throw new Error(
      "the document has an unterminated fenced block; its documented-command " +
        "surface cannot be read and this check cannot be decided."
    );
  }
  return blocks;
}

/** Every command a reader would run, in document order. */
function documentedCommands(document) {
  const commands = [];
  for (const { info, body } of fenceBlocks(document)) {
    if (!EXECUTABLE_INFO_STRINGS.has(info)) continue;
    for (const line of body) {
      const stripped = line.trim();
      if (!stripped || stripped.startsWith("#")) continue;
      commands.push(stripped);
    }
  }
  return commands;
}

/**
 * The document's prose: every line outside EVERY fenced block.
 *
 * The fence lines themselves are excluded, so a definition can never be
 * smuggled in as an info string.
 */
function outsideFenceLines(document) {
  const kept = [];
  let openMarker = null;
  for (const line of document.split("\n")) {
    const match = FENCE_RE.exec(line.trim());
    if (openMarker === null) {
      if (match) {
        openMarker = match[1][0].repeat(3);
        continue;
      }
      kept.push(line);
      continue;
    }
    if (match?.[1][0].repeat(3) === openMarker && !match[2]) {
      openMarker = null;
    }
  }
  return kept;
}

function occurrences(haystack, needle) {
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

/**
 * How many times the document DEFINES `placeholder` in its PROSE.
 *
 * A placeholder used only inside command fences is never explained; a reader
 * who meets it is stuck, so the check must not attest a green.
 */
function definitionCount(document, placeholder) {
  return outsideFenceLines(document).reduce(
    (total, line) => total + occurrences(line, placeholder),
    0
  );
}

/** The placeholder tokens a command carries, de-duplicated, in order. */
function placeholdersIn(command) {
  const seen = [];
  for (const token of command.match(PLACEHOLDER_RE) ?? []) {
    if (!seen.includes(token)) seen.push(token);
  }
  return seen;
}

// ---------------------------------------------------------------------------
// One command
// ---------------------------------------------------------------------------

function checkCommand(documented, document, skillDir) {
  const resolved = documented.split(SKILL_PLACEHOLDER).join(skillDir);

  // A placeholder the DOCUMENT itself never defines outside the command
  // fences. Reported by name, and NOT executed.
  const undefinedTokens = placeholdersIn(documented).filter(
    (token) => definitionCount(document, token) === 0
  );
  if (undefinedTokens.length > 0) {
    return {
      documented,
      resolved,
      exit: null,
      ok: false,
      reason:
        `the document never defines ${undefinedTokens.join(", ")} outside its ` +
        `command fences, so a reader cannot resolve this command`,
    };
  }

  // The prose explains it, yet nothing substitutes it. Still refused rather
  // than handed to bash with the angle brackets intact.
  const unresolved = placeholdersIn(resolved);
  if (unresolved.length > 0) {
    return {
      documented,
      resolved,
      exit: null,
      ok: false,
      reason:
        `this command still carries the unresolved placeholder ` +
        `${unresolved.join(", ")} after substitution, so it is not something a ` +
        `reader can run`,
    };
  }

  // Executed VERBATIM through /bin/bash -lc with the INHERITED env. Never
  // parsed or tokenised -- quoting is bash's problem exactly as it is for the
  // reader, and the verifier fetches no secret of its own.
  const completed = spawnSync("/bin/bash", ["-lc", resolved], {
    env: process.env,
    cwd: process.cwd(),
    encoding: "utf-8",
    timeout: COMMAND_TIMEOUT_MS,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (completed.error) {
    return {
      documented,
      resolved,
      exit: completed.status ?? null,
      ok: false,
      reason: `could not be run: ${completed.error.message}`,
    };
  }
  if (completed.status !== 0) {
    const stderr = (completed.stderr ?? "").trim().split("\n")[0] ?? "";
    return {
      documented,
      resolved,
      exit: completed.status,
      ok: false,
      reason:
        `exited ${completed.status}` + (stderr ? `: ${stderr}` : ""),
    };
  }
  return { documented, resolved, exit: 0, ok: true, reason: null };
}

// ---------------------------------------------------------------------------
// Report and verdict
// ---------------------------------------------------------------------------

function emit(report, exitCode) {
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exit(exitCode);
}

function usage(message) {
  process.stderr.write(
    `${message}\nusage: node scripts/verify-skill-commands.mjs <path to a ` +
      `published SKILL.md>\n` +
      `The argument is required: there is no default and no repo-relative ` +
      `fallback, because the check must speak about the document the reader's ` +
      `skill index line actually names.\n`
  );
  emit(
    {
      document: null,
      skill: null,
      checked: 0,
      failed: 0,
      ok: false,
      commands: [],
    },
    USAGE_EXIT
  );
}

function main(argv) {
  if (argv.length < 1) {
    usage("error: no SKILL.md path was given.");
  }
  if (argv.length > 1) {
    usage(`error: expected one SKILL.md path, got ${argv.length} arguments.`);
  }

  // Made ABSOLUTE before dirname, so a relative argument is an identity on
  // the same file rather than a cwd-dependent claim. That is resolution, not
  // a fallback.
  const requested = path.resolve(process.cwd(), argv[0]);
  let documentPath;
  try {
    documentPath = fs.realpathSync(requested);
  } catch (error) {
    usage(`error: ${requested} cannot be read as a SKILL.md (${error.message}).`);
    return;
  }
  if (!fs.statSync(documentPath).isFile()) {
    usage(`error: ${documentPath} is not a file, so it is not a SKILL.md.`);
    return;
  }

  // <skill> := dirname of the resolved document path -- an identity on the
  // one `path` field the skill listing publishes, never a hardcoded copy of
  // any other component's path-templating logic.
  const skillDir = path.dirname(documentPath);
  const document = fs.readFileSync(documentPath, "utf-8");

  const commands = documentedCommands(document).map((documented) =>
    checkCommand(documented, document, skillDir)
  );

  const failures = commands.filter((entry) => !entry.ok);
  // Every failure is ALSO one human-readable stderr line naming the
  // documented command VERBATIM.
  for (const entry of failures) {
    process.stderr.write(`FAIL: ${entry.documented} -- ${entry.reason}\n`);
  }

  const checked = commands.length;
  // The check cannot pass vacuously. A document with nothing to run has zero
  // failures, and that must never read as a green.
  const ok = failures.length === 0 && checked >= COMMANDS_FLOOR;
  if (failures.length === 0 && !ok) {
    process.stderr.write(
      `FAIL: only ${checked} documented command(s) were checked, below the ` +
        `floor of ${COMMANDS_FLOOR}; a pass here would be a green this check ` +
        `never earned.\n`
    );
  }

  emit(
    {
      document: documentPath,
      skill: skillDir,
      checked,
      failed: failures.length,
      ok,
      commands,
    },
    ok ? 0 : FAILURE_EXIT
  );
}

main(process.argv.slice(2));
