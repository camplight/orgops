# Area 2: prompt composition and skills

## Profile

- Target: `apps/agent-runner/src/turn-executor.ts`, called as `createTurnExecutor(input)(agent, events)`.
- Test file: `apps/agent-runner/src/characterisation/prompt-composition.test.ts`.
- Boundaries: MSW for the OrgOps API and the provider (`onUnhandledRequest: "error"`); `vi.mock` only of `../wrapped-runtime` and `../rlm-process`. Skills are real `SKILL.md` and `event-shapes.js` files in temp directories under the OS temp dir.
- Observable: the `systemPrompt` and `messages` of the `telemetry.prompt.composed` payload, the bodies sent to `/chat/completions`, emitted events, and the `console.warn` call for skill event-shape errors.
- Harness extension (backwards compatible, `factories.ts`): `getMockSkillRoot(skills)` writes a temp skill root (name, description, body, optional missing `SKILL.md`, optional event-shapes file); `getMockExecutor` accepts `skillRoots`.

## Story

As an operator, I want each turn's system prompt to be composed in a fixed, predictable order from the agent's instructions, runner guidance, workspace, channel, soul and skills, so that the model sees the same context every time and I can read it back in telemetry.

## Rules and examples (one test each)

System prompt section order
- Instructions, guidance, workspace, project root, channel context, soul, skills index, preloaded skills appear in that order.
- Starts with the instructions then the guidance; workspace, project root and channel sections are joined by blank lines (workspace and project root text end in a newline).
- The provider's system message and the telemetry system message equal the composed prompt.

Channel context
- Known channel: indented JSON of the record. Unknown channel: `{ id, unresolved: true }`. Channel comes from the last event.

Soul
- Present: `Your soul:` section. Empty string or undefined: no section and nothing in its place.

Skills index
- No skills: prompt ends with an empty `Your skills:` heading.
- Enabled skill: `name | description | <root>/<name>/SKILL.md`, one per line.
- On disk but not enabled, unknown enabled name, no enabled list: not indexed.
- A directory without `SKILL.md` is skipped, even if enabled and preloaded; the turn completes.

Always-preloaded
- Enabled and preloaded: `# name` plus the full `SKILL.md` text; several joined by a blank line.
- Enabled only: index only. Preloaded only (not enabled): nothing.

Skill roots
- Runner roots listed in guidance; `(none configured)` when empty; trimmed, blanks dropped, de-duplicated.
- Agent `additionalSkillRoots` come after the runner's, trimmed, de-duplicated also against the runner's, and are searched for skills.
- Same skill name in both roots: the runner's wins.

Skill event shapes
- An enabled skill's shapes are accepted for the model's reply, and are not listed in the core event types of the guidance.
- Load error and no-usable-export error: `console.warn("skill event shape load errors", [{ skill, error }])`, turn still completes. Not enabled skill: not loaded. No errors: no warning.

Merged trigger message
- One event: no merged message (telemetry messages are just the system message).
- Several events: last telemetry message is system `system.pending.events.merged` with `mergedCount`, `newestEventId`, and per event `eventId, type, source, channelId, payload (undefined becomes {}), createdAt`, after the history, as indented JSON.

## Keogh probes

Other contexts: both roots with the same skill name, blank and duplicate roots, no skills, several skills. Other outcomes: broken event-shapes file, empty exports, skill without `SKILL.md`.

## Quirks pinned

- `[quirk]` Skill roots are de-duplicated by trimmed string only: `/x` and `/x/` stay two roots in the guidance.
- `[quirk]` The merged trigger message reaches the provider folded into the single system message (after the system prompt, joined by a blank line), ahead of the history, because the AI SDK collapses system messages. Telemetry shows it after the history. The two views disagree.

## Not now

Memory-context messages and watermarks (area 3), telemetry payload fields beyond the prompt (area 4), clamping (area 4), retry and validation messages (area 5).

## Assumptions

- Observed the prompt through the telemetry payload; one test also checks the provider body.
- `memoryContextMode: "OFF"` or `FULL_CHANNEL_EVENTS` is used only to control history; the default mode is covered in area 3.
- Host info, timestamp and the full guidance bullet list are not asserted (environment dependent, not area-specific).
- The "missing SKILL.md is skipped silently" rule can only be observed as a directory without `SKILL.md` (never listed). The read-time catch is unreachable (see dead items).

## Result

- 41 tests in this file, each under about 50ms (first test 46ms); the characterisation directory (62 tests) runs in about 0.7s. Lint green.
- Stryker config `apps/agent-runner/stryker/prompt-composition.config.json`, mutating `turn-executor.ts` lines 495-540 and 617-664: 76 mutants. Round 1: 66 killed, 10 survived, 86.84%. Round 2 (two real gaps closed: core-only event types, exact absence of the empty soul section): 69 killed, 7 survived, 90.79%.
- Survivors:
  - Dead or equivalent: 495 `typeof ... === "string"` to `true` (only differs for a non-string truthy soul, which the type forbids); 514, 515 `?? []` to a non-empty array (no skill has that name); 533 removing `.filter(Boolean)` and 536 `if (!contents)` (a listed skill always has a non-empty `SKILL.md`, so the read cannot fail or be empty); 647 `?.` (events has more than one element there).
  - Later suite: 635 dropping `systemContextMessages` and `apiFetch` from the `buildModelMessages` options (memory messages: area 3; attachment fetching is outside the plan).
  - Logging: none.
