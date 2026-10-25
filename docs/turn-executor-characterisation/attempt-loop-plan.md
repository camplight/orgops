# Area 5: attempt loop and retries

Mutation testing was skipped for this area at the user's request. The suite was strengthened by reviewing it against the code branch by branch instead (see "Branch review").

## Profile

- Target: `apps/agent-runner/src/turn-executor.ts` (attempt loop 804-940, `extractJsonObject`, `normalizeEventDraft`, `formatValidationErrors`, `isRetryableToolArgumentValidationError`, `resolveAgentClassicMaxModelSteps`), called as `createTurnExecutor(input)(agent, events)`.
- Test files: `apps/agent-runner/src/characterisation/attempt-loop.test.ts` (39 tests) and `attempt-loop-model-calls.test.ts` (30 tests). Helper module: `attempt-loop-support.ts` (`setUpTurn`, `retryTail`, `rawRetryTail`, `providerError`). No change to the existing harness.
- Boundaries: MSW for the OrgOps API and the provider (`onUnhandledRequest: "error"`); no `vi.mock`. Skill event shapes come from `getMockSkillRoot` files. Model metadata is real.
- Observable: requests recorded by `/api/events` (type, source, channel, payload) and bodies sent to `/chat/completions`.
- Reading the provider body: the llm package folds all system messages into one `user` message, so retry messages appear as a suffix of `messages[0].content` (first separator `\n\n\n`, later ones `\n\n`). Tool calls and tool results are separate `assistant` and `tool` messages after it.

## Story

As an operator, I want the runner to ask the model again with a precise explanation whenever its answer cannot be dispatched, so that a turn ends in a valid event instead of a lost one, and to fail loudly when the provider itself is broken.

## Rules and examples (one test each)

Happy path
- Event emitted with `source agent:alice`, channel defaulting to the turn channel, then `agent.turn.completed`; one request.
- Model-named channel used (trimmed); blank or non-string channelId falls back to the turn channel.
- Model-supplied `source` ignored; type, parentEventId, idempotencyKey trimmed; deliverAt floored; blank, non-string or non-finite optional fields dropped.
- Missing payload becomes `{}` (`noop`).
- JSON accepted: surrounding whitespace, json fence, bare fence, fence inside prose.

Retry messages (exact texts asserted)
- Not valid JSON: no JSON, empty, whitespace only (`Empty response.`), broken JSON in a fence (parser's own SyntaxError).
- Invalid output: array, `null`, string (`JSON response must be an object.`), missing/blank/non-string type, reserved types (`agent.`, `audit.`, `telemetry.`, `tool.`).
- Validation: unknown type (`Unsupported event type`), core payload issue (`payload.text: Required`), skill shape with 10 issues capped at 8 and with exactly 8, path-less issue as `<root>`, issue source labelled `skill:<name>`.
- Participation: unknown channel, agent not an AGENT participant; no lookup for an event that failed validation.
- Participation cache: a repeatedly named channel is looked up once across attempts; each different channel once.
- Accumulation: first request has no retry text; each next request carries all earlier retry messages in order; attempt numbers in the texts; the third attempt can still succeed; no fourth request, fallback after three failures (observed only to show the cap).

Invalid tool arguments error
- A provider failure whose text contains `AI_InvalidToolArgumentsError`, or both `Invalid arguments for tool` and `Type validation failed`, retries with the tool-arguments message. Each half alone does not retry and propagates.
- No usage telemetry for the failed attempt; the next provider event says attempt 2. Counts against the three-attempt cap.

Other failures
- 400 and 401 reject with the provider's message, one request, no `agent.turn.completed`, no model event.
- Three 500s in a row reject, no completed event.

Tool calls
- Real `events_channels_list` executed; result sent as the `tool` message in the next request; events `tool.started` and `tool.executed` emitted between the two context events; arguments passed through; multi-step loop stays inside one attempt; earlier retry messages stay in the request.

Step cap
- `classicMaxModelSteps` bounds requests per attempt (2 gives 6 requests over three attempts, 1 gives 3, 2.9 acts as 2); exactly the cap is allowed; a capped loop gives an empty answer and the `Empty response.` retry.
- `resolveAgentClassicMaxModelSteps`: undefined, 0, negatives, NaN, Infinity give 100; fractions floored.

## Keogh probes

Other contexts: attempts 1, 2 and 3, one and several retry kinds in one turn, one and several channels, tool call in first and later attempts. Other outcomes: every retry kind, success after retries, cap reached, provider failure, step cap reached.

## Quirks pinned

- `[quirk]` In AI SDK 6 a tool call with malformed arguments (or an unknown tool, or unparseable argument JSON) never raises: the SDK returns the validation error to the model as a `tool` message and continues in the same attempt. The `isRetryableToolArgumentValidationError` branch can only be reached when a provider error text contains the marker strings, which a real provider failure essentially never does. Candidate for a fix ticket (dead branch, or the check should match the SDK 6 error names such as `AI_InvalidToolInputError`).
- `[quirk]` A single 500 or network error is retried by the SDK itself (two retries, exponential backoff) before the executor sees it, so "a 500 propagates" holds only after three consecutive failures. The test uses `retry-after-ms: 1` to keep the backoff short.
- `[quirk]` The retry text for a failed provider call says `Error: AI_APICallError: ...` and the not-valid-JSON text says `Error: Error: ...` (the error is stringified, including its class name).
- The step cap applies per attempt, so a looping provider costs up to `3 x classicMaxModelSteps` requests.
- Retry messages are appended to the single folded first message rather than sent as separate messages.

## Not now

- `llmCallTimeoutMs` handling and the `LLM generate (attempt N) timed out after Xms` rejection: area 6.
- Mid-turn injection (`reconcileLateInjectedMessages`, `pullMessages` ignored in a tool loop): area 6.
- Fallback message content after three failed attempts (normalised text, parent, `completedWithFallback`): area 7. Only observed here to show three attempts are the cap.
- Context-window telemetry maths, clamping, memory modes, prompt composition: areas 1-4.

## Branch review (instead of mutation testing)

Every branch of the loop and its helpers has a test: `extractJsonObject` (empty, plain, fenced, fence without JSON, fence with broken JSON); `normalizeEventDraft` (non-object, missing type, reserved, channelId string/blank/non-string, payload default, parentEventId, idempotencyKey, deliverAt finite/non-finite/non-number); validation failure with and without issues; participation error and cache hit; tool-arguments retry (both marker forms, each half alone); other failure propagation; success path; loop exhaustion. Retry texts are asserted in full, including attempt numbers.

Not covered, by design: the cached-success branch of the participation cache (a passing check always ends the turn on that attempt, so it cannot be seen), and the late-injection retry and timeout (areas 6 and 7).

## Assumptions

- `events_channels_list` is the tool used for tool-call tests: it reads `/api/channels` (already handled by the fake API) and needs no extra handler.
- `HttpResponse.error()` is not tested for propagation: like a 500 it is retried by the SDK with a real two-second backoff and would break the speed budget; the 500 case with `retry-after-ms` stands in for both.

## Result

- 69 tests (39 + 30), all green; lint green; whole characterisation directory 239 tests in about 1.6s, slowest first test per file about 135ms (cold start), others under 20ms.
- Mutation testing: skipped at the user's request.
- Production files unchanged.
