# Area 7: fallback

Mutation testing was skipped for this area at the user's request. The suite was strengthened by reviewing every branch of `normalizeFallbackMessageText`, `extractJsonObject` (as used by it), `buildFallbackMessageEvent` and the tail of `executeTurn` against the code (see "Branch review").

## Profile

- Target: `apps/agent-runner/src/turn-executor.ts` (`normalizeFallbackMessageText`, `buildFallbackMessageEvent`, `lastResponseText` and the code after the attempt loop), called as `createTurnExecutor(input)(agent, events)`.
- Test file: `characterisation/fallback.test.ts` (60 tests). `modelEvents` in `injection-support.ts` became generic (`<T extends { type: string }>`) so callers keep the payload type; backwards compatible.
- Boundaries: MSW for the OrgOps API and the provider; no `vi.mock`. The three attempts fail by plain text or unusable JSON answers from the fake provider, by the tool-argument provider error (400), or by late events (pending list that grows during the third call).
- The existing `normalizeFallbackMessageText` unit tests in `src/turn-executor.test.ts` are untouched.

## Story

As an operator, I want a turn that could not produce a valid event after three tries to still answer in the channel with the model's best text, never raw event JSON, and to say so in the turn record, so that the conversation does not go silent.

## Rules and examples

Text from JSON the model sent (the last response is always unusable as an event, so the fallback is reached)
- JSON without `type`, pretty-printed JSON, fenced with `json`, no tag, upper-case tag, `payload.text` trimmed, outer whitespace, reserved type, unknown type, extra fields: the trimmed `payload.text`.

JSON without usable `payload.text` gives the friendly error `I hit a response-format issue and could not produce a clean chat message. Please try again.`
- Payload without text, no payload, `{}`, blank/empty text, numeric/null/array text, payload array/string/null, `text` only at top level, fenced JSON without text. The raw JSON is never leaked.

Responses that are not event JSON
- Plain text (trimmed, multi-line kept), broken JSON, JSON array/number/string/null/true, fenced non-JSON, fenced array: the trimmed raw response, fences included.
- Prose before a fenced event: the fenced `payload.text` is used.
- Very long text (250 000 chars, plain or in `payload.text`) is not clamped.

Empty last response: `Unable to produce structured event output.` for empty, spaces, newlines/tabs, and for a provider answer without content.

Which response is used
- The last attempt's response, not an earlier one.
- Tool-argument error on the last attempt: the response of the attempt before ([quirk]); on the last two attempts: the first attempt's ([quirk]); on all three: empty text.
- Late events during the third attempt: the discarded third response is used ([quirk]), including a valid event without `payload.text` (friendly error, own channel ignored). Three late discards: the third response.

The emitted message: `message.created`, `source agent:<name>`, turn `channelId`, `parentEventId` of the last event of a merged batch, only `payload.text`; fields in the model JSON (`channelId`, `parentEventId`, `idempotencyKey`) are ignored.

Completion: `agent.turn.completed` with exactly `triggerEventId` (last event), `eventCount`, `completedWithFallback: true`. Order: started, message, completed, each once. The message is emitted only after the third provider call (zero model events at each answer). No fourth call. The turn resolves.

Failing emit: `message.created` is not best-effort. A 500 rejects the turn (`API /api/events failed: 500`), one attempt to emit, no `agent.turn.completed`.

## Keogh probes
Other contexts: merged batches (last event wins for parent, channel and trigger id); a different agent name. Other outcomes: every attempt failing with the tool-argument error; empty content; fallback text from late-injection discards.

## Quirks pinned
- [quirk] After a tool-argument error on the last attempt, `lastResponseText` still holds an earlier attempt's response, which is sent to the channel (two variants).
- [quirk] A response discarded because late events arrived is still the fallback text.
- [quirk] A valid, well-typed event discarded for late events reaches the channel only as its `payload.text` or the friendly error; its own channel and parent are ignored.
- (Not tagged) A JSON array, number, string, `null` or `true` response is sent verbatim, and a fenced non-JSON response is sent with its fences.
- (Not tagged) The fallback text is not clamped; a failing fallback emit fails the turn with no completed event, unlike `agent.turn.started` and `agent.turn.completed`, which are best-effort.

## Not now
- Retry message texts (area 5), injection and timeouts (area 6), clamping of LLM input messages (area 4).
- Exact `normalizeFallbackMessageText` unit cases already in `src/turn-executor.test.ts`.

## Assumptions
- Unusable last responses use missing `type` or an unknown or reserved type; validation behaviour for real shapes belongs to area 5.
- The AI SDK retries 500s itself; the failing-emit test is unaffected because `emitEvent` uses plain `fetch`, and exactly one POST of `message.created` is observed.

## Branch review (instead of mutation testing)
- `normalizeFallbackMessageText`: empty/blank (3 inputs plus no-content), JSON object with string payload text (trimmed), payload non-object (array, string, null), text non-string, text blank, no payload, not an object (array, number, string, null, true), parse failure (broken JSON, fenced non-JSON), plain text trim. All tested.
- `extractJsonObject` as seen from the fallback: direct parse, fence with and without tag, case-insensitive tag, prose before fence, fence containing invalid JSON. All tested. Not tested: empty fence body.
- `buildFallbackMessageEvent`: type, source, channelId, payload, `parentEventId` present. The `parentEventId` absent branch is unreachable through `executeTurn` (trigger event always has an id).
- Tail of `executeTurn`: emit before completed, `completedWithFallback` flag, emit failure propagation, one emit, three calls maximum, `lastResponseText` updates (every successful response) and non-updates (tool-argument error).

## Final numbers
- 60 new tests, 356 tests in the characterisation directory, about 1 s for the new file, slowest test about 140 ms. Lint green. Production files untouched.
- Later suite: none. Dead or equivalent: the absent-`parentEventId` branch.

## Step 0b summary: every quirk pinned, by area

Triage list for fix tickets.

Area 1 (guards, turn bracket, mode dispatch)
- `agent.turn.completed` is skipped when the RLM runtime throws, and the error propagates (no `agent.turn.failed`). Not tagged in the test name.

Area 3 (memory modes)
- A whitespace-only memory summary is truthy and yields a title-only context message.
- Mode `OFF`: the trigger event is not part of the messages; the model gets only a lone system message, delivered by the AI SDK with role `user`.

Area 2 (prompt composition)
- Skill roots are de-duplicated by trimmed string only (`/x` and `/x/` stay two roots).
- The merged trigger message reaches the provider folded into the single system message ahead of the history, while telemetry shows it after the history.

Area 4 (telemetry and clamping)
- No `[quirk]` tags in `telemetry-clamping-plan.md`.

Area 5 (attempt loop)
- A tool call with malformed arguments never raises in AI SDK 6; the error goes to the model as a tool message, so the tool-argument retry branch is reachable only through provider error text.
- A single 500 or network error is retried twice by the SDK before the executor sees it.
- Retry texts embed class names (`Error: AI_APICallError: ...`, `Error: Error: ...`).

Area 6 (injection and timeouts)
- Events that become pending between two requests of one attempt are not injected into the second request (`pullMessages` ignored); they cause a retry after the final response.
- Agent `llmCallTimeoutMs` of 0, negative, NaN or infinite falls back to the executor's limit, while the exported `resolveAgentLlmCallTimeoutMs` (unused by `executeTurn`) falls back to env or 10 800 000 ms.

Area 7 (fallback)
- After a tool-argument error on the last attempt, an earlier attempt's response is sent as the fallback (two variants).
- A response discarded for late events is still the fallback text.
- A discarded valid event reaches the channel only as `payload.text` or the friendly error.
