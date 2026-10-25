# Area 4: telemetry and clamping

## Profile

- Target: `apps/agent-runner/src/turn-executor.ts` (clamping 104-154, context window and usage maths 288-385, telemetry emitters 666-733), called as `createTurnExecutor(input)(agent, events)`.
- Test files: `apps/agent-runner/src/characterisation/telemetry-clamping.test.ts` (46 tests) and `message-clamping.test.ts` (16 tests).
- Boundaries: MSW for the OrgOps API and the provider (`onUnhandledRequest: "error"`); `vi.mock` only of `../wrapped-runtime` and `../rlm-process`. Model metadata (`models-dev-db`) is real.
- Observable: `telemetry.prompt.composed` and `telemetry.context.window.updated` requests recorded by the fake API, and the bodies sent to `/chat/completions`.
- `message-clamping.test.ts` changes `ORGOPS_MAX_LLM_MESSAGE_CHARS` with `vi.stubEnv`, `vi.resetModules()` and a dynamic import of `./factories` (the limit is read at import time).
- The module-level `modelContextWindowCache` survives across tests, so each test uses a model id no other test uses.
- No harness change needed.

## Story

As an operator, I want every turn to report how full the model's context is and to keep any single message inside the provider's limits, so that I can watch context use and a huge message cannot break a call.

## Rules and examples (one test each)

Telemetry events
- Order: turn started, prompt, context (estimate), context (provider), model event, turn completed.
- Prompt event: `source system:runner:prompt`, `DELIVERED`, turn channel, agent, model, trigger id.
- Context events: `source system:runner:context`, `DELIVERED`, turn channel, agent, model, memory mode, trigger id.
- `emitAuditEvents` true or undefined: emitted. False: no telemetry, the turn still completes.
- A failing prompt emit, and failing context emits, are swallowed.

Estimated usage
- First context event is `usageSource: "estimate"`.
- Used tokens: a quarter of each message's characters, rounded up per message.
- Remaining tokens, message count, system chars, system-context chars, history chars.
- Utilisation rounded to two decimals; capped at 100 with 0 tokens left.
- Prompt telemetry carries each message's role.

Provider usage
- Second event: `usageSource "provider"`, reported tokens, attempt, `finishReason`.
- Character split repeated from the estimate.
- No usage in the response: estimate again, with attempt and finish reason, no `inputTokens`.
- One provider event per attempt; emitted before the model event; none when audit events are off.
- Capped at 100 / rounded to two decimals; fractional counts rounded down; negative counts clamped to 0.

Context window
- Metadata: `openai:gpt-4o` 128000, `openai:gpt-5` 400000, `openai:gpt-4.1` 1047576, `anthropic:claude-sonnet-4-5` 200000; openrouter ids with `or:` and `openrouter:` aliases; `claude:` alias; provider lowercased and trimmed; model names with colons keep them.
- Fallback table for ids missing from the metadata: gpt-4o(-mini) 128000, gpt-4.1(-mini) 1000000, gpt-5 1000000, claude 200000, other 128000; case-insensitive.
- Malformed ids (no colon, empty model name, empty provider) use the fallback table.
- Same model id twice gives the same window.

Message clamping (`/chat/completions` body)
- Default limit 200000: exactly at the limit untouched; one over cut with a one-character marker; large message marker counts the omitted characters.
- `ORGOPS_MAX_LLM_MESSAGE_CHARS`: applied; fractional rounded down; `abc`, empty, `0`, `-5`, `Infinity` fall back to the default.
- String history message at and one over the limit; each message clamped on its own; retry messages clamped.
- Text part of an array message cut while its image part is kept; within the limit left whole.

## Keogh probes

Other contexts: audit on/off/undefined, one and several attempts, no usage. Other outcomes: failing emits, invalid env values, boundary lengths, unknown and malformed model ids.

## Quirks pinned

- An event from another agent in the channel history is sent as a `system` message (prompt telemetry roles `system, user, system`). Candidate for a fix ticket if unintended.
- The fallback table says gpt-5 is 1,000,000 while the metadata says 400,000; the fallback only applies when metadata has no entry.
- The provider usage event with no usage still exists (the AI SDK returns a usage object anyway) and reuses the estimate.

## Not reachable through the real pipeline (recorded, not tested)

- System messages whose content is not a string (`clampMessagesForProviderLimit`, line 144): the executor always builds the system message as a string, so that branch is dead from `createTurnExecutor`.
- Array parts that are not objects or have no string `text` (`clampMessageContent`): the prompt composer only produces `{ type: "text", text }` and image parts.

## Not now

- Retry and fallback message texts, tool-argument retries that skip usage telemetry: attempt loop area.
- Truncation of memory summaries and history budgets: memory modes and prompt composition (done).
- `turn.started` and `turn.completed` bracket: guards area (done).

## Assumptions

- Pinned the AI SDK behaviour as seen: `finishReason "stop"` for a plain completion.
- `anthropic` models in `models-dev-db` all have a 200000 window, so the `claude` alias cannot be told apart from the fallback table by window size.

## Result

- 62 tests (46 + 16); whole characterisation project about 1s, each test under 50ms.
- Mutation: Stryker could not be installed in this session (the install into `/tmp/claude-501/stryker-tools` was refused by the permission classifier, and the existing tools directory was missing its packages). Configs are ready: `apps/agent-runner/stryker/telemetry-clamping.config.json` (turn-executor 288-385, 666-733) and `telemetry-clamping-messages.config.json` (104-154). Run them from `apps/agent-runner` once the tools exist.
- Stand-in: a scripted manual mutation pass of 77 hand-picked mutants (the same operators Stryker would use on these lines; `turn-executor.ts` restored after each run and after the pass, `git status` clean). First round: 53 killed, 24 survived. Two real gaps closed (colons in model names, role in prompt telemetry); the fractional and negative token tests were added too but their mutants proved equivalent. After round two: 55 killed, 22 survived (71%), all classified below. This is not a Stryker score.
- Survivors, all dead or equivalent:
  - `clampMessageContent`: `continue` to `break` (the image is the last part), `continue` to always (an image gets an empty `text` that does not reach the wire), `!part || typeof part !== "object"` removed and `typeof part.text === "string"` removed (parts are always well formed).
  - `clampMessagesForProviderLimit`: `role === "system"` to `false` (a string system message is clamped the same by the other branch; non-string unreachable).
  - `normalizeModelMetadataProvider`: `claude` returning `claude` (see assumptions: same window from the fallback).
  - `modelContextWindowCache`: lookup and store removed (same result, only a metadata lookup is saved).
  - `!rawProvider || !modelName` variants (three): malformed ids fail the metadata lookup and reach the same fallback.
  - `contextWindow > 0` to `>= 0`, `Math.floor(contextWindow)`, `typeof contextWindow === "number"`: bundled metadata has only positive integer windows.
  - `readUsageTokenCount`: `if (!usage)` removed, `Math.max(0, ...)` and `Math.floor` removed, `typeof value === "number"` removed, alternative key names (`promptTokens`, `prompt_tokens` and so on): the AI SDK hands the executor a normalised usage object, so negative, fractional and snake-case values never arrive in that shape. The two behaviour tests stay as pins of the observable result.
  - `contextWindowTokens > 0 ? ... : 0` guards (two): the window is always positive.
  - `Math.max(0, totalPromptChars - systemChars - systemContextChars)`: the difference is never negative.
- Later suite: none.
- Open items: run Stryker for these two configs when the tools are available, and compare with the stand-in pass.
