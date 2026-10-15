# Area 1: guards, turn bracket and mode dispatch

## Profile

- Target: `apps/agent-runner/src/turn-executor.ts`, called as `createTurnExecutor(input)(agent, events)`.
- Test file: `apps/agent-runner/src/characterisation/guards-bracket-dispatch.test.ts`.
- Boundaries: MSW for the OrgOps API and the provider (`onUnhandledRequest: "error"`); `vi.mock` only of `../wrapped-runtime` and `../rlm-process`.
- Observable: requests recorded by the `/api/events` handler, ordered call log, calls made to the two mocked runtimes.
- Harness extension (backwards compatible, `orgops-api.ts`): `createFakeOrgops` gains `callLog()` (ordered `POST /api/events <type>`, `GET /api/secrets/env`, `GET /api/channels`, `GET /api/events`, memory GETs) and the option `rejectEvent(event)` (answers 500 for matching POSTs; rejected events are in `callLog` but not in `emitted()`).

## Story

As the runner, I want every turn to be guarded, bracketed by started/completed telemetry and routed by agent mode, so that operators see each turn begin and end and the right runtime handles it.

## Rules and examples (one test each)

Guards
- No events: nothing at all is called.
- Last event has no `channelId` (undefined, empty string): nothing is called.
- Earlier event has a channel, last does not: nothing is called.
- Trigger is the last event: events on chan-1 then chan-2 produce `started` on chan-2 with `triggerEventId: evt-2`, `eventCount: 2`, and the reply goes to chan-2.
- First event without channel, last with: the turn runs.

Turn bracket
- `agent.turn.started` is the first API call, before `/api/secrets/env`.
- `started` shape: `source: agent:alice`, turn channel, `triggerEventId`, `eventCount`.
- `completed` is last, exactly one of each, `eventCount: 3` for three events.
- A rejected `started` is swallowed: the turn continues and finishes.
- A rejected `completed` is swallowed: the executor resolves.

Mode dispatch
- WRAPPED: `runWrappedAgentTurn` is called once with `{ projectRoot, api: four functions }`, the agent and the events; only `started` and `completed` (`runtime: "wrapped"`) are emitted, no other API call, no provider call; runs between `started` and `completed`; the RLM runtime is not called.
- RLM_REPL: runs after prompt and context telemetry (only the estimate event); receives agent, trigger, channelId, `systemPrompt` equal to the telemetry system prompt, `baseMessages` equal to the telemetry messages; completes with `{ triggerEventId, eventCount }` only; no model call; if the RLM runtime rejects, no `completed` is emitted.
- Missing mode and explicit CLASSIC: a provider call, a `message.created`, neither runtime called.

## Keogh probes

Other contexts: multi-event batches in each mode (done for RLM, bracket). Other outcomes: runtime failure (RLM covered; WRAPPED failure is not pinned, see assumptions).

## Quirks observed

- `agent.turn.completed` is skipped when the RLM runtime throws, and the error propagates (no `agent.turn.failed`). Pinned in the RLM failure test. Not tagged `[quirk]` in the name; candidate for a fix ticket.
- `createRunnerTools` and the execute context are built before the RLM branch, which does not use `tools` (already in the plan list).

## Not now

Prompt composition, memory modes, telemetry payloads and context window maths, clamping, attempt loop, injection, fallback (areas 2 to 7).

## Assumptions

- A missing `channelId` includes the empty string (falsy check).
- WRAPPED runtime failure behaviour is not pinned: `runWrappedAgentTurn` is mocked and the plan only lists the happy path.
- Console warnings and errors from swallowed telemetry failures are silenced with `vi.spyOn(console, ...)` and not asserted (log labels are not behaviour).

## Result

- 20 tests in this file (21 with `classic-turn.test.ts`), each under 45ms, about 0.7s for the characterisation directory. Lint green.
- Stryker config `apps/agent-runner/stryker/guards-bracket-dispatch.config.json`, mutating `turn-executor.ts` lines 448-492 and 779-791: 39 mutants, 32 killed, 7 survived, 82.05%. One round was enough.
- Survivors:
  - Dead or equivalent: 448 `if (false) return` (empty `events` still hits the channel guard because `triggerEvent?.channelId` is undefined); 450 `triggerEvent?.` to `triggerEvent.` (only differs for an empty array, which line 448 stops); 475 and 779 `?? "CLASSIC"` to `?? ""` (empty string equals neither WRAPPED nor RLM_REPL, so the same path runs).
  - Logging: 455 empty catch block, 456 `console.warn` removed, 460 label string.
  - Later suite: none.
- `.gitignore` gained entries for `apps/agent-runner/.stryker-tmp/` and `apps/agent-runner/reports/`.
