# Refactoring plan: `apps/agent-runner/src/turn-executor.ts`

`turn-executor.ts` is 940 lines and has 102 cross-file links (see `docs/refactoring-todo.md`, task 2). Most of that weight is one function: `executeTurn`, which spans lines 447-939 (about 490 lines). It is the code path that every non-wrapped agent turn goes through, and it contains the mid-turn event injection that `AGENTS.md` calls the subtlest behavior in the codebase.

This plan has the same three parts as `docs/1-refactoring-1-user-ui-refactoring-plan.md`:

1. Characterisation tests that pin the current behaviour.
2. Analysis and target architecture.
3. A step plan in which every step leaves a working runner.

It also has a short section on running this work in parallel with the user-ui refactoring.

## 0. What we found before planning

- **`executeTurn` has no test.** `turn-executor.test.ts` (44 lines) covers only `normalizeFallbackMessageText`. `runner.test.ts` (2,919 lines) covers the exported helpers (`reconcileLateInjectedMessages`, the three `resolveAgent*` functions) and the tools, but never calls `createTurnExecutor`. So the attempt loop, prompt assembly, telemetry and mode dispatch are untested today. The todo item "check test coverage first" is answered: for the part that matters, there is none.
- **There is no coverage provider installed** (`@vitest/coverage-v8` is absent), so coverage numbers need a one-off measurement (step 0a).
- **Consumers are few.** `runner.ts` imports `createTurnExecutor` plus four helpers from `./turn-executor` and re-exports them. `runner.test.ts` imports them through `./runner`. Keeping those export names stable keeps both files untouched.
- **There are two real network boundaries, and both can be faked with MSW without touching production code.**
  - `input.api` comes from `createRunnerApi`, which calls the global `fetch` against `apiUrl`.
  - `generate` (`@orgops/llm`) calls the AI SDK, which calls the model provider over HTTP. The `openrouter` provider reads its base URL and key from the `env` option, and the executor fills `env` from `/api/secrets/env`. So a test can point the whole LLM call at an MSW handler just by answering that one endpoint and using a model id like `openrouter:test-model`.
  - `models-dev-db` is not a boundary: it is bundled, gzipped data and never touches the network.
- **`pullMessages` is never used.** The executor passes `pullMessages` to `generate` and `GenerateOptions` declares it, but nothing in `packages/llm/src/index.ts` reads it (no `prepareStep`, and `git log -S` shows none was ever added). `AGENTS.md` says the runner polls for same-channel events between model steps. In the current code only the post-response `reconcileLateInjectedMessages` check does anything. See the quirks list.
- **MSW is already in the lockfile** (`apps/user-ui` uses it, `^2.15.0`) but is not a dependency of `apps/agent-runner`.
- **Baseline coverage of `turn-executor.ts` (step 0a, measured once with a scratch `@vitest/coverage-v8`, not committed):** before the characterisation tests, 15.9% lines, 14.2% branches, 14.0% functions (47 of 296 lines). Lines 448-938, all of `executeTurn`, are uncovered. With the single harness test (`characterisation/classic-turn.test.ts`) it is 74.0% lines and 51.1% branches. Cyclomatic complexity was not measured.
- **Facts the harness proved (step 0a):**
  - `openrouter:test-model` does not resolve in `models-dev-db` (`getModel` throws), so the context window falls back to the table. `openrouter:openai/gpt-4o` does not resolve either. `openai:gpt-4o` (128000) and `anthropic:claude-sonnet-4-5` (200000) do.
  - A provider response without a `usage` field still gives a truthy `usage` object after `generate`, so a classic turn emits a second `telemetry.context.window.updated` event even then. The usage-telemetry tests must not assume that no usage means no second event.
  - `ORGOPS_LLM_STUB=1` in the environment makes `generate` skip the network. The harness never sets it, but a developer's shell might.

## 1. Characterisation tests

### Approach

Call the real `createTurnExecutor(input)(agent, events)` and assert on what leaves the executor. Follow "don't mock what you don't own" ([Hynek](https://hynek.me/articles/what-to-mock-in-5-mins/)): no `vi.mock` of third-party code, no hand-written stubs of HTTP clients. Fake the network with MSW and let every line of our own code run.

| Boundary | How it is handled in tests |
|---|---|
| OrgOps API | The real `createRunnerApi` pointed at a fake origin (`http://orgops.test`), served by MSW. The handlers form the route table (`/api/events`, `/api/channels`, `/api/secrets/env`, memory records). |
| LLM provider | The real `@orgops/llm` `generate` and the real AI SDK. An MSW handler for the OpenAI-compatible `POST /chat/completions` plays the provider. The `/api/secrets/env` handler returns `OPENROUTER_BASE_URL` and `OPENROUTER_API_KEY`, and tests use `openrouter:<model>` ids. No production change is needed. |
| Model metadata (`models-dev-db`) | Real. It is bundled data, not a network call. |
| Skills on disk | Real `SKILL.md` files in a temp directory. |
| Provider errors and slowness | Faked at the wire: `HttpResponse.error()`, a 400 with the AI SDK's invalid-tool-arguments shape, `delay("infinite")` plus a short real `llmCallTimeoutMs`. This is the exception the article itself makes for failures that are hard to produce naturally. |
| `./wrapped-runtime`, `./rlm-process` | The only `vi.mock`s. We own both, each has its own suite (`wrapped-runtime.test.ts`, `rlm.test.ts`), and the RLM runtime runs the model in a child process that MSW (which patches the current process only) cannot see. The tests assert on the call the executor makes to them. |

The executor tests assert on the wire: the requests recorded by the `/api/events` handler (type, source, channel, payload) and the bodies sent to `/chat/completions` (the messages array, the retry messages, the clamped content, the tools). Those requests are the real contract with the API and the provider, and they do not change when code moves between modules.

`@orgops/llm` is our own façade over the AI SDK, so the heuristic would also allow mocking it. We do not, because what the executor does depends on what `generate` does with a response: usage normalisation, `finishReason`, the tool loop, and the fact that `pullMessages` is ignored. A mocked `generate` would hide all of that.

Everything else also runs for real: `prompt-composer`, `context-maintenance`, `channel-injection`, `event-routing`, `tools`, and `@orgops/schemas` validation. These are the modules the refactor moves code between, so mocking them would break the tests on every move.

MSW runs with `onUnhandledRequest: "error"`, so any request the test did not plan for fails it. The server setup mirrors `apps/user-ui/src/characterisation/server.ts` (`setupServer`, reset after each test). The shared root `vitest.config.ts` has no per-project setup file for agent-runner and the plan leaves it alone, so the lifecycle lives in `characterisation/lifecycle.ts` as `useFakeNetwork()`, called once at the top of each suite file, instead of a setup file.

Tests import only `createTurnExecutor`, the exported helpers, and the types from `types.ts`. No `let`, no `beforeEach` (the MSW server lifecycle goes in a setup file, not in the tests). Data comes from factories (`getMockAgent`, `getMockEvent`, `getMockChannelRecord`) and from response builders (`chatCompletion({ text | toolCalls, usage })`, `eventsHandler`, `channelsHandler`). `chatCompletion` is the one place that knows the provider's wire format.

### Behaviours to pin

- **Guards:**
  - No events: nothing is emitted.
  - The last event has no `channelId`: nothing is emitted.
  - The trigger is the last event, not the first.
- **Turn bracket:**
  - `agent.turn.started` is emitted before any other API call (including `getPackageSecretsEnv`).
  - `agent.turn.completed` is emitted last, with `triggerEventId` and `eventCount`.
  - A failing telemetry `emitEvent` is swallowed and the turn continues.
- **Mode dispatch:**
  - `WRAPPED` delegates to `runWrappedAgentTurn`, makes no model call, emits no prompt telemetry, and completes with `runtime: "wrapped"`.
  - `RLM_REPL` runs after prompt and context telemetry, receives the system prompt and composed messages, and completes with an empty payload.
  - A missing `mode` means `CLASSIC`.
- **Prompt composition:**
  - Section order of the system prompt: instructions, runner guidance, workspace, project root, channel context, soul, skills, preloaded skills.
  - Empty soul and empty preloaded-skills sections are omitted.
  - An unknown channel renders `{ id, unresolved: true }`.
  - Skill roots are trimmed and de-duplicated, with the agent's `additionalSkillRoots` after the runner's.
  - Only enabled skills appear in the index. Only always-preloaded ones get full `SKILL.md` text. A missing `SKILL.md` is skipped silently.
  - Skill event-shape load errors are warned about, not thrown.
  - More than one event adds a `system.pending.events.merged` message after the history. One event adds none.
- **Memory modes:**
  - `PER_CHANNEL_CROSS_CHANNEL` reads four memory records in parallel, lists events after the recent-summary watermark, and emits the five system context messages in a fixed order, skipping empty ones.
  - `FULL_CHANNEL_EVENTS` lists the whole channel history and adds no memory messages.
  - `OFF` makes no memory or history calls.
- **Telemetry:**
  - `telemetry.prompt.composed` and `telemetry.context.window.updated` are emitted only when `emitAuditEvents !== false`, with status `DELIVERED` and the right `source`.
  - The first context-window event uses `usageSource: "estimate"`.
  - After each generation whose provider response carries `usage`, a second event uses `usageSource: "provider"`, includes `attempt` and `finishReason`, and falls back to the estimate when no input tokens are reported.
  - Utilisation is capped at 100% and rounded to two decimals.
  - The context window comes from model metadata, then the fallback table (gpt-4o, gpt-4.1, gpt-5, claude, default), and is cached per model id. Provider aliases `claude` and `or` are normalised.
- **Provider limit clamping:** an oversized message in the request body sent to `/chat/completions` is cut at `ORGOPS_MAX_LLM_MESSAGE_CHARS` with a `[truncated N chars]` marker. This covers string content, text parts of array content, and system messages whose content is not a string.
- **Attempt loop:**
  - The happy path emits the model's event with `source: agent:<name>`, with `channelId` defaulting to the turn channel.
  - Fenced JSON is accepted.
  - Each failure kind pushes its own retry message and tries again: invalid JSON, missing `type`, reserved event type, shape validation (capped at 8 issues), participation error on the target channel.
  - Participation is checked once per target channel and cached across attempts.
  - A provider response that makes the AI SDK raise an invalid-tool-arguments error retries without emitting usage telemetry. Any other failure (a 500, `HttpResponse.error()`) propagates, and no `completed` event is emitted.
  - A call that exceeds the timeout (the provider handler never answers) rejects with `LLM generate (attempt N) timed out after Xms`.
  - The timeout comes from the agent first, then from `input.llmCallTimeoutMs`.
  - The step cap comes from `resolveAgentClassicMaxModelSteps`: a provider that keeps requesting tool calls is stopped after that many requests.
  - Each request to `/chat/completions` carries the base messages plus all accumulated retry messages.
  - A tool call returned by the provider is executed by the real runner tool, and its result is sent in the next request.
- **Mid-turn injection:**
  - The trigger events start as seen. Pending events returned by `/api/events` that are already seen, or that `shouldHandleEventForAgent` rejects, never reach the model.
  - Events that become pending *during* the model call (the provider handler adds them to the route table before answering) are found after the response and trigger a retry. That retry does not consume a parse failure, and it carries the "New channel events arrived while you were responding on attempt N/3" message.
  - Events found that way are marked seen and are not injected twice.
  - Events that arrive on the last attempt still lead to the fallback, not to an emit.
  - **Current reality, pinned as is:** in a multi-step tool loop, events that become pending between two provider requests are *not* added to the second request, because `pullMessages` is ignored. A test records this, so the day someone wires `pullMessages`, the test fails on purpose and the change is a visible decision.
- **Fallback:** after 3 failed attempts, the executor emits `message.created` with the normalised text of the last response, parented to the trigger event, and completes with `completedWithFallback: true`.

### Speed budget

The suite should run in about 10 seconds, and each test in under 300ms. Everything is in-process: MSW intercepts `fetch` without opening a port, and the temp directory is used only by the skill tests. Timeout tests use a real `llmCallTimeoutMs` of tens of milliseconds, not fake timers, because the AI SDK and MSW both use real async internals. Split the suites by area so vitest runs them in parallel. Measure in step 0a; if the AI SDK's per-call setup is slower than this, relax the budget before adding workarounds.

### Mutation testing

The user-ui spike found that a whole-file Stryker run is too slow. Do not repeat that.

- **Scope:** mutate `turn-executor.ts` and, as they appear, the new modules from step 1 onward, one function range at a time.
- **Reading the output:** survivors in conditionals, string literals (the retry messages are a contract with the model), arithmetic and `??` fallbacks point to missing tests. Ignore survivors in log labels and `console.warn` calls.
- **Target:** about 80% on the extracted logic modules, not 100%.
- **Fallback:** a hand-picked list of manual mutations, as in the user-ui plan, if the Stryker vitest runner does not fit the repo's vitest version.

### Gaps and risks

- Characterisation tests pass the moment they are written. Mutation testing and manual probes replace RED-first as the check that they would catch a break. This is the same deliberate exception to TDD as in the user-ui plan.
- The fake provider has to speak the OpenAI chat-completions wire format well enough for the AI SDK. If `ai` or `@ai-sdk/openai` changes that format, the tests fail loudly, and `chatCompletion` is the only place to fix.
- The RLM and wrapped runtimes are mocked, so the executor's side of their contract is pinned but not their behaviour. Their own suites cover that.
- Pin quirks as they are and log them separately. Do not fix them mid-refactor. Already spotted:
  - `executeTurn` computes its timeout inline (agent value, else `input.llmCallTimeoutMs`) and never calls the exported `resolveAgentLlmCallTimeoutMs`, which falls back to the env var and a 3-hour default instead. Two rules for one setting.
  - `pullMessages` is passed to `generate` but never used, so mid-step injection does not happen. `AGENTS.md` describes it as working. Decide in a separate ticket: wire it (a `prepareStep` in `@orgops/llm`, a behaviour change) or delete the parameter and fix `AGENTS.md`.
  - `createRunnerTools` and the whole execute context are built before the `RLM_REPL` branch, which does not use `tools`.
  - Tool-argument retries skip usage telemetry, so those attempts are invisible in the context-window events.
  - `pullInjectedEventMessages` marks every fetched event as seen, including ones the agent filters out.
  - `(skill: any)` and `(issue: any)` casts and several `as` assertions exist in the file.

## 2. Analysis and target architecture

`executeTurn` mixes seven concerns in one closure:

- **Pure rules** (lines 86-419): timeout wrapper, env parsing, message clamping, event-type query, JSON extraction, fallback text, draft normalisation, validation formatting, usage telemetry maths, context-window fallback table, per-agent config resolvers.
- **One stateful module cache:** `modelContextWindowCache` (module-level, shared by all executors). Plus one import-time env read: `MAX_LLM_MESSAGE_CHARS`.
- **Skill context** (lines 496-540): root de-duplication, listing, event shapes, index and preloaded text.
- **Memory context** (lines 557-616): three modes, each with different API calls.
- **System prompt assembly** (lines 617-664): string composition plus the merged-trigger message.
- **Telemetry** (lines 452-472, 666-733): four emit helpers, each with its own "best effort" and audit gating.
- **The classic attempt loop** (lines 793-938): `generate` with injection, five kinds of retry, participation cache, emit, fallback.

### Proposed shape

Pragmatic, in the repo's style: factory functions and plain functions, no classes. A `turn/` folder next to `turn-executor.ts`, which stays as the orchestrator and keeps its current export names.

```
src/
  turn-executor.ts            createTurnExecutor + re-exports of the existing public names (~80 lines)
  turn/
    agent-config.ts           resolveAgent{LlmCallTimeoutMs,ClassicMaxModelSteps,MemoryContextMode}
    event-draft.ts            extractJsonObject, normalizeEventDraft, normalizeFallbackMessageText,
                              buildFallbackMessageEvent, formatValidationErrors
    model-limits.ts           clampMessagesForProviderLimit, buildProviderUsageTelemetry,
                              resolveModelContextWindowTokens (+ its cache)
    skill-context.ts          resolveSkillRoots, buildSkillIndex, buildPreloadedSkillsContext
    memory-context.ts         loadMemoryContext({ mode, ... }) -> { eventHistory, systemContextMessages }
    system-prompt.ts          buildSystemPrompt, buildMergedTriggerMessage
    telemetry.ts              createTurnTelemetry({ api, agent, channelId, triggerEvent, eventCount })
    retry-messages.ts         one pure builder per retry reason
    classic-attempts.ts       runClassicAttempts(...) -> outcome
```

- **Attempt-loop shape:** the response review (parse, normalise, validate against shapes) becomes a pure `reviewModelResponse` that returns either a draft or the retry message to send. The participation check stays async and separate. The loop itself only sequences: generate, reconcile, review, check, emit.
- **Dependency rule:** `turn/*` never imports `turn-executor.ts`. `turn-executor.ts` is the only place that knows the order of the phases.
- **Trade-offs:**
  - No port for `generate`. The tests fake the provider at the HTTP level, so no seam is needed, and a port can be added later in its own commit if it earns its place.
  - The `seenEventIds` set and `retryMessages` array stay mutable, because `reconcileLateInjectedMessages` is exported and its contract (and test) is that it mutates both. This deviates from the immutability guideline on purpose. Flag it rather than change it mid-refactor.

## 3. Step plan

Every step ends with the characterisation tests unchanged and green, `npm run lint` and `npm test` green (including the existing `runner.test.ts`), and a commit. Because the backend has no build step, add a manual smoke with `ORGOPS_LLM_STUB=1 npm run dev:all`: send a message to a classic agent and check that it answers.

**0. Safety net** (no changes to `turn-executor.ts`)

- **0a:** baseline and harness.
  - Measure coverage and cyclomatic complexity once, outside the repo (scratch tooling, not committed; installing `@vitest/coverage-v8` would touch `package-lock.json`, which is why it is not committed). Record the numbers at the top of this file.
  - Add `msw` (`^2.15.0`, the version `apps/user-ui` already uses) to `apps/agent-runner` devDependencies, as its own first commit. It is already in the lockfile, so the diff is one line plus the workspace entry.
  - Add the test support: the MSW server and its setup file, the `chatCompletion` response builder, the route-table handlers, and the factories.
  - Prove the harness with one test that runs a full classic turn through MSW, and check which model id resolves in `models-dev-db` and which falls back.
  - Check the timing budget.
- **0b:** the suites above, one area per commit, in this order: guards, turn bracket and mode dispatch; prompt composition and skills; memory modes; telemetry and clamping; attempt loop and retries; mid-turn injection and timeouts; fallback.
- **0c:** Stryker spike on one function range, then a gap-filling pass. Stop when the logic ranges reach about 80%, or when a range costs more than it finds.
  - **Result (stopped by the user as good enough):**
    - Stryker was run on the classic attempt loop (`turn-executor.ts` 804-938, config `stryker/attempt-loop.config.json`): 87.5% (84 killed, 12 survived, about 3 minutes). All 12 survivors are dead or equivalent: the unused `pullMessages` callback (5), `result.usage`, `finishReason` and `text` fallbacks that the AI SDK never triggers (3), and validation fallbacks and `channelId` handling that cannot be reached (4). No test was added.
    - Areas 1 to 3 were run with Stryker earlier (82%, 91%, 96%). Area 4 had a hand-picked mutation pass (about 71%). Areas 5 to 7 were reviewed branch by branch, not mutated.
    - Never run: `stryker/pure-and-reconcile.config.json` (pure functions 86-103, 156-285, and resolvers and `reconcileLateInjectedMessages` 387-445) and the two area 4 Stryker configs.
    - Gotcha: with the default settings the command runner marked most mutants as timeouts, which are counted as killed, giving a false 100%. Use `concurrency: 1` and a generous `timeoutMS` (these configs do), and treat many timeouts as a warning sign.

**1. Move pure functions out verbatim** into `turn/agent-config.ts`, `turn/event-draft.ts` and `turn/model-limits.ts`, one commit each. `turn-executor.ts` re-exports the names that `runner.ts` already imports. `MAX_LLM_MESSAGE_CHARS` stays read at import time.

**2. Prompt assembly:** `skill-context.ts`, `memory-context.ts`, `system-prompt.ts`, one commit each. Keep the four memory reads in one `Promise.all`.

**3. Telemetry:** `createTurnTelemetry` with the four emitters. Keep the emit order and the audit gating exactly as pinned.

**4. Retry messages and response review:** `retry-messages.ts` and `reviewModelResponse`. The message texts move verbatim.

**5. Classic attempt loop:** `runClassicAttempts` returns `emitted | fallback`. `executeTurn` handles the turn-completed event for each case.

**6. `executeTurn` becomes the orchestrator** (about 80 lines): started, wrapped branch, context, prompt, telemetry, tools, RLM branch, classic. Keep the current order of side effects.

**7. Hardening:**

- A guard test that `turn/*` does not import `turn-executor.ts`.
- Update the turn section of `docs/SPEC.md` and the architecture notes in `AGENTS.md` (the mid-turn injection description should point to `turn/classic-attempts.ts`).
- Re-run `/graphify . --update` to measure the coupling drop.
- Triage the logged quirks into separate fix tickets, each with its own test (the timeout rule first, since it is a real inconsistency).
- Replace the `any` casts in a separate commit.

### Pitfalls

- **Order of side effects:** `agent.turn.started` before `getPackageSecretsEnv`; prompt telemetry before context telemetry; `createRunnerTools` before the RLM branch. The tests pin these. Do not tidy them.
- **Shared mutable state:** `seenEventIds` is shared between the (currently unused) `pullMessages` callback and `reconcileLateInjectedMessages`. `retryMessages` is appended to by both the reconciler and the loop. Pass them through; do not copy them.
- **Module-level cache:** `modelContextWindowCache` survives across tests. Use a unique model id per test, or the second test sees the first one's result.
- **Unplanned requests:** with `onUnhandledRequest: "error"` a forgotten handler fails the test, but the runner's own `apiFetch` also logs `console.error` on HTTP failures. Keep the output readable by asserting on the thrown error, not on the log.
- **Import-time env:** `MAX_LLM_MESSAGE_CHARS` is read when the module loads. Tests that change it need `vi.resetModules()` and a dynamic import, and the moved code must keep reading it at import time.
- **Attempt counting:** a late-injection `continue` and a parse failure both consume an attempt. The third attempt's late events go to the fallback, not to a fourth call.
- **Existing comments and casts:** carry them over verbatim when moving code. Clean up in the separate commits above.

## 4. Running in parallel with the user-ui refactoring

The two plans touch different workspaces (`apps/user-ui` and `apps/agent-runner`), so code conflicts are not expected. What can conflict is shared files and the working tree.

- **Use a separate worktree and branch.** The main checkout is on `run-1` with uncommitted user-ui work. From the repo root: `git worktree add ../orgops-turn-executor -b refactor/turn-executor main`, then `npm install` and `cp .env.example .env` there. Do not stack this work on the user-ui branch.
- **Shared files to leave alone while both are running:**
  - `vitest.config.ts` (the new tests are picked up by the existing `node` project).
  - `package-lock.json` and any `package.json`, except the single `msw` devDependency commit in step 0a. Make that commit first and merge or rebase it early so the lockfile does not drift between the branches.
  - `docs/refactoring-todo.md`: tick only the task 2 lines, and only when merging, so both branches do not edit the same file at once.
  - `docs/SPEC.md` and `AGENTS.md`: touched only in step 7, after the user-ui branch has merged or at least after its step 9 edits are known.
- **Scope test runs:** `npx vitest run apps/agent-runner` here, so the large user-ui suite does not slow this work down.
- **Agents:** `.claude/agents` has `characteriser` (works for any target with a plan doc, including this one: give it `apps/agent-runner` and an area) and `user-ui-refactorer` (specific to the user-ui plan). For refactoring steps the generic agents are enough for now. If the flow proves repeatable, a `turn-executor` pair can be added later.

## Defaults chosen (override if needed)

- **Plan file name:** `docs/2-refactoring-2-turn-executor-refactoring-plan.md`, following the numbering of the first plan.
- **Test stack:** vitest plus MSW (`msw/node`), in the style of `apps/user-ui/src/characterisation`. The OrgOps API and the model provider are faked at the HTTP level. Only `./wrapped-runtime` and `./rlm-process` are module-mocked, because we own them and MSW cannot reach the RLM child process. Everything else is real.
- **Folder layout:** a `turn/` folder inside `apps/agent-runner/src`, not a new package.
- **Public names:** unchanged. `runner.ts`, `runner.test.ts` and `turn-executor.test.ts` are not edited by this refactor.
- **Baseline measurements:** one-off and not committed. Installing a coverage provider would be a second lockfile change while the user-ui work is in flight; only `msw` is added.
