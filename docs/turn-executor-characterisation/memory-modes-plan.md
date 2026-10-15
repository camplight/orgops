# Area 3: memory modes

## Profile

- Target: `apps/agent-runner/src/turn-executor.ts` (lines 557-616 and `resolveAgentMemoryContextMode`), called as `createTurnExecutor(input)(agent, events)`.
- Test file: `apps/agent-runner/src/characterisation/memory-modes.test.ts`.
- Boundaries: MSW for the OrgOps API and the provider (`onUnhandledRequest: "error"`); `vi.mock` only of `../wrapped-runtime` and `../rlm-process`.
- Observable: `telemetry.prompt.composed` payload (`memoryContextMode`, `systemContextMessages`, `messages`), the bodies sent to `/chat/completions`, and the requests the fake API saw (memory endpoints with query, `/api/events` listings with the `after` cursor).
- Harness extension (backwards compatible, `orgops-api.ts`): `memoryRecords` per endpoint (`channelRecent`, `channelFull`, `crossRecent`, `crossFull`; default `{ record: null }`), `channelHistory` may be a function of the query, `holdMemoryResponses` (each memory response waits until all four requests arrived, or 150ms), and `memoryQueries()` and `memoryRequestsArrivedBeforeFirstResponse()` on the fake.

## Story

As an operator, I want each agent's memory mode to decide which memory records and channel history the model sees, so that I can trade context for cost per agent and read the result back in telemetry.

## Rules and examples (one test each)

Mode resolution
- No mode: default per-channel and cross-channel (four memory calls, telemetry says so).
- Unrecognised value (`SOMETHING_ELSE`, `null`, empty string): same default.
- Each configured mode is reported in `telemetry.prompt.composed.memoryContextMode`.

Per-channel and cross-channel reads
- Four GETs with `agentName`, plus `channelId` for the two channel records.
- All four requests are in flight before any is answered.
- The four memory reads come before the channel events listing.

Watermark
- `lastProcessedAt` of the channel recent record becomes `after=<n>` in the listing (`channelId, order=asc, limit=500, after`).
- No record, zero, negative or non-numeric watermark: `after=0`.
- Other records' watermarks are ignored.

System context messages
- Five messages in fixed order: channel recent, delta, channel full, cross recent, cross full, with their exact titles.
- Nothing present: none. Empty summary text: skipped. Each record alone: just its message.
- Summary trimmed; longer than 16000 characters truncated with `...[truncated N chars]`; exactly 16000 kept.
- The provider receives them inside its single system message.

Channel delta message
- Compact indented JSON with `id, createdAt (floored), type, source, channelId, payload ({} when missing)`.
- Latest event not authored by the agent (the trigger) is left out; the agent's own later events stay; when all are own, all are listed; trigger only: no delta message.
- Newest 120 events only.

Meaningful event filter
- Dropped: `audit.`, `telemetry.`, `tool.`, `agent.turn.`, `memory.` prefixes and `event.deadlettered`.
- Kept near misses: `audit`, `tool`, `toolbox.opened`, `agent.control.pause`, `wrapper.started`, `event.deadlettered.later`, `message.created`.
- Applies to the delta, the per-channel history and the full-channel history.

Full channel events
- Lists the whole channel from `after=0`, no memory calls, no context messages (even if records exist), history messages in time order.

Off
- No memory calls, no history listing; no context or history messages.

## Keogh probes

Other contexts: each record alone, all records, none; trigger only, own-only history, 122 events. Other outcomes: empty and whitespace summaries, oversize summaries, bogus modes.

## Quirks pinned

- `[quirk]` A whitespace-only summary is truthy, so it yields a title-only context message (for example `Cross-Channel Full Memory\n`).
- `[quirk]` Mode `OFF`: the trigger event is not part of the messages at all. The model gets only the system text, and the provider (AI SDK) delivers that lone system message with role `user`. Candidate fix ticket.
- Earlier quirk still applies: the provider folds system messages into one, so tests read the context messages from telemetry.

## Not now

- History size and character budgets and truncation message (prompt composition / later suite).
- Event listing pagination (`channel-events.ts`, 500 per page) and late-injection polling: mid-turn injection area.
- Memory refresh and summarisation (`context-maintenance.ts` refresh functions): outside the executor.

## Assumptions

- The fake API ignores the `after` cursor unless a test supplies `channelHistory` as a function; the cursor is asserted through the recorded request instead.
- The trigger event is part of the API's channel history, as in the real API.

## Result

- 46 tests in `memory-modes.test.ts`; whole characterisation project under 1s, each test a few ms.
- Mutation (`apps/agent-runner/stryker/memory-modes.config.json`, 135 mutants over `turn-executor.ts` 406-416 and 557-616, `context-maintenance.ts` 17-36, 56-61, 557-575, `prompt-composer.ts` 319-331): 96.30% (130 killed, 5 survived), one round.
- Survivors, all dead or equivalent:
  - `prompt-composer.ts:324,325` optional chaining on an in-bounds array read (`event?.source`, `event?.id`).
  - `prompt-composer.ts:329` `if (!latestUserLikeEventId) return events` to `if (false)`: the filter on an undefined id returns the same list.
  - `turn-executor.ts:409` `configured === "PER_CHANNEL_CROSS_CHANNEL"` to `false`: falls through to the same default.
  - `turn-executor.ts:572` `> 0` to `>= 0`: `after=0` either way.
