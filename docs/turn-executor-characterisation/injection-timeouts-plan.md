# Area 6: mid-turn injection and timeouts

Mutation testing was skipped for this area at the user's request. The suite was strengthened by reviewing every branch of `reconcileLateInjectedMessages`, `pullInjectedEventMessages`, `roleForEvent` and the `withTimeout` wrapper against the code (see "Branch review").

## Profile

- Target: `apps/agent-runner/src/turn-executor.ts` (`withTimeout`, `resolveAgentLlmCallTimeoutMs`, `reconcileLateInjectedMessages`, the timeout and `pullMessages` wiring in `executeTurn`, lines 795-860) and `channel-injection.ts`, called as `createTurnExecutor(input)(agent, events)`.
- Test files: `characterisation/mid-turn-injection.test.ts` (42 tests), `characterisation/llm-timeout.test.ts` (15 tests). New helper module `injection-support.ts`. `setUpTurn` in `attempt-loop-support.ts` gained two optional options (`pendingEvents`, `llmCallTimeoutMs`), backwards compatible.
- Boundaries: MSW for the OrgOps API and the provider; no `vi.mock`. "Events that become pending during the call" are modelled by a provider responder that adds to a pending list the fake `/api/events` serves. Timeouts use real `llmCallTimeoutMs` of 30 to 80 ms. A call that never answers is a never-resolving responder promise (no timer, nothing to leak; handlers are reset after each test).
- Reading the provider body: system retry messages are folded into the first message (after the base prompt). User-role injected events are separate `user` messages after the first message.

## Story

As an operator, I want a message that arrives while the agent is thinking to be taken into account before the agent answers, and a stuck model call to fail the turn visibly instead of hanging, so that replies are never based on a stale view of the channel.

## Rules and examples

Known events
- Pending list holding only the trigger event: no retry. All events of a merged batch are seen.
- One pending listing per attempt, `agentName=alice&status=PENDING&channelId=chan-1&limit=50`; channel id url-encoded.

Ignored pending events (each its own test, none triggers a retry): agent turn, agent control, wrapper, noop, audit, telemetry and tool types; message targeted at another agent; scheduled trigger without target; own event; event without channel. A scheduled trigger naming this agent is injected.
- Ignored events are marked seen (same id later turning acceptable is still not injected).
- Non-array listing is treated as empty. A failing listing (500) fails the turn: no model event, no completed event.

Late events
- New event: second request carries the event record then the notice `New channel events arrived while you were responding on attempt N/3.` and the re-evaluate line. First response discarded even when valid.
- Not a parse failure: discarded unparsable response adds no "not valid JSON" message.
- Provider usage telemetry is still emitted for the discarded attempt.
- Roles: human message (or missing source) goes as `user` message; `agent:`/`system:` sources (case-insensitive) and non-message types go to the folded system part.
- Record contents: eventId, channelId, parentEventId when present, type, source, payload with strings cut at 280 characters.
- Order: by `createdAt` ascending; missing `createdAt` counts as 0. Several events share one notice.

Seen and not injected twice
- An event that stays pending is not injected again. Two waves accumulate in order with one notice each. A parse failure message and a later wave keep their order.

Last attempt
- Events during attempt 3: fallback, three requests, no emit. Late injections consume attempts (three in a row end in the fallback with two notices). Two late injections then a clean third attempt emit normally.

Tool loop (current reality)
- [quirk] Events becoming pending between two requests of one attempt are not in the second request (`pullMessages` ignored). They are found after the final response and cause a retry (third request).

Timeouts
- Never-answering call rejects `LLM generate (attempt N) timed out after Xms`, one request, no retry, no model or completed event; attempt number is the real one; the limit covers the whole tool loop of an attempt; each attempt has its own limit; a timely answer is unaffected.
- Source: agent limit first (floored), else the executor's limit. [quirk] agent limit 0, negative, NaN or infinite falls back to the executor's limit, while the exported `resolveAgentLlmCallTimeoutMs` (unused by `executeTurn`) falls back to env or the 10 800 000 ms default. Both rules pinned.

## Keogh probes
Other contexts: events arriving on attempt 2 after a parse failure (covered); other channel's events (the listing is channel-scoped by the API, the fake does not filter, so not testable here). Other outcomes: listing failure (covered), non-array body (covered).

## Not now
- Fallback content and parenting (area 7); only the fact of a fallback and its completed flag are asserted.
- Retry message texts of area 5 (only a `contains` for ordering in one test).
- Prompt-event record formatting beyond what the injected record shows (`prompt-event-compact.ts` own suite).
- Event routing rules (`shouldHandleEventForAgent`) beyond the representative rejections.

## Assumptions
- Same-channel scoping is done by the API query; the executor does not re-check `channelId` of fetched events.
- Timing margins (30 ms limit vs instant answers, 80 ms limit vs 50 ms answers) are wide enough not to flake; three repeated runs were green.

## Branch review (instead of mutation testing)
- `reconcileLateInjectedMessages`: null result, empty messages (all ignored/seen) -> false, tested; fresh events -> pushes messages then notice, attempt and max in text, tested; returns true so the loop continues, tested.
- `pullInjectedEventMessages`: query composition and encoding, non-array, seen filter, `shouldInclude` filter, sort with missing createdAt, mark all fetched as seen (including filtered), `fresh.length === 0` null, role mapping (non-message type, no source, case-insensitive prefixes, `system:`), record shape. All tested. Not tested: sort stability for equal `createdAt` (unspecified).
- `withTimeout`: rejection message with label and ms, timer cleared on resolve (no late failure: timely tests), rejection passthrough of provider errors (area 5 tests), timeout rejection not treated as retryable (tested).
- Limit selection: positive finite, floor, 0, negative, NaN, Infinity, undefined (all tested).

## Final numbers
- 57 new tests, 296 tests in the characterisation directory, about 1.1 s for the two new files, slowest test 125 ms. Lint green. Production files untouched.
- Later suite: none. Dead or equivalent: none found.
