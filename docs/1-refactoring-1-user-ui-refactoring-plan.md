# Refactoring plan: `apps/user-ui/src/App.tsx`

`App.tsx` is 3,070 lines: the largest file and the most coupled one in the repo (see `docs/refactoring-todo.md`, task 1). This plan covers three parts:

1. Characterisation tests that pin the current behaviour.
2. Analysis and target architecture (hexagonal, DDD).
3. A step plan in which every step leaves a working app.

Starting point: `apps/user-ui` has no test tooling (no DOM environment, no Testing Library). Root `vitest` only runs node tests.

## 1. Characterisation tests

### Approach

Mount the real `<App />` and drive it like a user. Fake only the outside world:

- **HTTP:** a hand-rolled `fetch` stub with a route table. Assert on the requests the app makes (method, URL, body), since that is its real contract.
- **WebSocket:** a fake `WebSocket` class that the test can push events through.
- **Browser:** `history`/`location`, `clipboard`, `window.confirm`, `requestAnimationFrame`, fake timers.

Tests never import `api.ts`, `config.ts` or any internal module, and never mock them. Otherwise moving those modules would force test edits. They import only `App`, the types from `types.ts`, and factory functions (`getMockChannel`, `getMockEvent`, ...). No `let` or `beforeEach`.

### Behaviours to pin

- **Auth:**
  - Session check on load, then the login form and its error.
  - Forced password change: at least 8 characters and a matching confirmation, and the submit button stays disabled until both hold.
  - Sign-out resets the UI.
- **Workspace load:**
  - `?share=` token claim, including the failure path.
  - `?channel=` deep link.
  - Fallback to the first non-archived visible channel.
  - Archived channels auto-expanding.
- **Sidebar:**
  - Visibility rules for private, public, team-shared, DM and lifecycle channels.
  - Grouping into Direct, Channels and Shared.
  - Search, which force-expands groups.
  - Unread badges.
  - Display names such as "you" and `Direct: a, b`.
- **Timeline:**
  - Message vs trace grouping.
  - Hidden `ui.json-render.action` messages.
  - Markdown, json-render and secret-input rendering.
  - Failure classification (first matching rule wins).
  - Trace chips and detail expansion.
  - Attachments.
  - Sensitive-message reveal and hide.
  - "Agent is thinking" and the offline-agent hint.
- **Loading:**
  - Initial load and "Load previous messages".
  - Realtime merge and dedupe.
  - "New messages below", with `scrollHeight` stubbed.
  - Polling every 10s only while the WebSocket is down.
  - WebSocket reconnect backoff.
  - Topic subscribe and unsubscribe as visible channels change.
- **Composer:**
  - Enter vs Shift+Enter.
  - Disabled states for archived, read-only and sending.
  - Attachment upload (ready and error states) and paste-image upload.
  - The "Attached N files" fallback text.
- **Dialogs and management:**
  - Cmd+K opens the conversation dialog and Esc closes it.
  - DM-vs-channel creation rules.
  - Manage channel: save diff, archive, delete with confirm.
  - Add and remove participants and shares.
  - Copy share link.

### Speed budget

The whole characterisation suite should run in under about 10 seconds, and any single test in under about 200ms.

- **Environment:** `happy-dom` rather than `jsdom`. Switch an individual file back to `jsdom` only if a behaviour needs it.
- **Network:** the hand-rolled `fetch` stub, not MSW, to avoid per-request interception overhead. Keep one or two MSW-backed tests only if the stub proves too lenient.
- **Time:** fake timers everywhere, so the 10s polling, the 2s "Link copied" reset and the reconnect backoff cost nothing. No real `waitFor` timeouts; advance the fake clock and flush promises.
- **Input:** `fireEvent` for plain state changes. `user-event` only where realistic typing matters (Enter vs Shift+Enter, IME composition).
- **Isolation:** suites split by area (auth, sidebar, timeline, realtime, composer, dialogs) so vitest runs them in parallel. Each test renders a fresh `App` with its own factory data.
- **Fixtures:** small factory data (for example 3 channels).
- **Measurement:** check timings in the first PR (`vitest --reporter=verbose`) and fix anything over budget immediately.

### Mutation testing

Use **Stryker** with its vitest runner to check that the tests cover the right behaviour.

- **Scope:** mutate only `apps/user-ui/src/**`, excluding `*.test.*` and `styles.css`. Run it per step, not in CI at first.
- **Speed settings:** per-test coverage analysis and incremental mode. Mutate the extracted modules from step 1 separately, because `App.tsx` as a whole would generate thousands of mutants on the first run.
- **Reading the output:**
  - Survivors in conditionals, string literals and arithmetic indicate untested behaviour. Add a test for each real gap.
  - Ignore survivors in class names, `aria-*` strings and style code. They are equivalent mutants or implementation detail, and chasing them would couple the tests to markup.
  - Target roughly 80% on logic modules, not 100%.
- **When to run it:** once after the first suites are green and fast, to find gaps. Then after each extraction step as a regression check on the tests themselves.
- **Caveat:** the Stryker vitest runner must support the repo's vitest version (5.x). This is unverified, so step 0c starts with a spike. Fallback if it does not work: a hand-picked list of manual mutations.

### Gaps and risks

- Characterisation tests pass the moment they are written. Mutation testing replaces RED-first as the check that they would catch a break. This is a deliberate exception to the usual TDD rule, since there is nothing to turn red.
- Happy-dom and jsdom have no layout, so scroll and autosize behaviour is only partly testable. Stub the layout properties and accept partial coverage there.
- Pin quirks as they are and log them separately. Do not fix them mid-refactor. One already spotted: `DIRECT_GROUP` and `AGENT_AGENT_DM` channels pass the visibility rule but match no sidebar group, so they are never listed.

## 2. Analysis and target architecture

`App.tsx` mixes five concerns in a single function:

- **Pure domain rules** (lines 20-594, plus inline `useMemo`s): event interpretation, trace and failure classification, channel visibility and grouping, event ordering, attachment parsing, timeline grouping.
- **Use cases** (about 17 handlers): sign in/out, change password, load workspace, load/older messages, send, upload, start conversation, delete/save channel, participants, shares, share link, reveal sensitive.
- **Infrastructure:** `fetch`, `WebSocket` with reconnect, polling, `history`/`URL`, `clipboard`, `confirm`, `rAF`, `navigator.connection`.
- **State:** about 60 `useState`s and 16 refs. Many refs only mirror state so that WebSocket callbacks avoid stale closures. The unread/last-seen logic is spread across four places.
- **Presentation:** about 900 lines of JSX covering 2 auth screens, a sidebar, a timeline, a composer, a side panel and 3 dialogs. The markdown/json-render/secret-input block is duplicated verbatim for sensitive content.

### Proposed shape

Pragmatic hexagonal: no classes, factory functions as in the rest of the repo.

```
src/
  domain/{identity,conversations,messaging}/   pure TS, no React
  application/                                 use cases: (options) => result, ports injected
  ports/                                       interfaces: gateways, RealtimeFeed, DeepLink, Clipboard, Confirm
  infrastructure/                              http, websocket, browser adapters (api.ts / config.ts move here)
  ui/{auth,sidebar,timeline,composer,dialogs}/ components + hooks (driving adapter)
  App.tsx                                      composition root only
```

- **Bounded contexts:**
  - **Identity:** session, password.
  - **Conversations:** channels, visibility, grouping, participants, shares, archive, deep link, plus an agent/human directory read model.
  - **Messaging:** event stream, timeline, trace, attachments, sensitive content, unread, pagination.
- **State:** the three auth booleans become one `signedOut | loading | mustChangePassword | ready` union. Each context gets a reducer, which removes the ref mirrors.
- **Dependency rule:** `domain` imports nothing, `application` imports `domain` and `ports`, `ui` imports `application`. A guard test enforces it.
- **Trade-off:** no port for every browser API. Keep ports where they give a test seam or hide a real boundary. Scrolling and autosize stay plain UI hooks.

## 3. Step plan

Every step ends with the characterisation tests unchanged and green, `npm run lint` and `npm test` green, the user-ui build green, a quick manual smoke with `ORGOPS_LLM_STUB=1`, and a commit.

**0. Safety net** (no changes to `App.tsx`) — **done**

- **0a:** tooling (`happy-dom`, Testing Library, test setup) and the timing budget. Done.
- **0b:** the suites above, one area per commit. Done: auth, workspace load, sidebar, timeline, loading and realtime, composer, dialogs and management (809 tests, about 3s).
- **0c:** Stryker spike, then a gap-filling pass driven by surviving mutants. Closed without the full pass: Stryker was run per area on line ranges and a few targeted manual probes were made, but a whole-file run (3,166 mutants) was stopped as too slow. Accepted as good enough to start refactoring.

**1. Move pure functions out** into `domain/*`, verbatim, in several small commits: event interpretation, trace and failure rules, channel rules, ordering and attachments. **(done)**

**2. Extract presentational components,** props in and callbacks out, one per commit: auth screens, dialogs, sidebar, activity panel, composer, timeline items. De-duplicate the markdown block here. **(done)**

**3. Introduce gateway ports and HTTP adapters:** `ConversationGateway`, `MessageGateway`, `FileGateway`, `SessionGateway`, plus `DeepLink`, `Clipboard` and `Confirm`. Swap call sites one at a time. **(done)**

**4. Extract realtime:** a `RealtimeFeed` adapter (connect, backoff, topic diff) and a polling-fallback hook. **(done)**

**5. Identity context:** use cases, the session state union and `useSession`. **(done)**

**6. Conversations context:** reducer and use cases (load workspace, select, start, manage, participants, shares, share link). **(done)**

**7. Messaging context:** timeline load and pagination, a single unread tracker, send, upload, sensitive reveal, and the scroll hook. **(done)**

**8. `App.tsx` becomes the composition root** (about 100 lines or fewer), wiring adapters through context.

**9. Hardening:**

- The dependency-direction guard test.
- Update the user-ui section of `docs/SPEC.md` and the architecture notes in `AGENTS.md`.
- Re-run `/graphify . --update` to measure the coupling drop.
- Triage the logged quirks into separate fix tickets, each with its own test.

### Pitfalls

- **Effect ordering:** the reset effect on `activeChannelId` must run before the load effect.
- **Render-time closures:** `loadShell` and `loadMessageNotifications` read values from the render closure. Pin the current behaviour before replacing the closures.
- **Existing `as` assertions:** carry them over verbatim when moving code. Replace them with schema parsing at the gateways in a separate commit (this adds a `zod` dependency to user-ui).

### Defaults chosen (override if needed)

- **Test stack:** `happy-dom` plus a hand-rolled `fetch` stub rather than Playwright or MSW. A small Playwright smoke test could come later.
- **Folder layout:** inside `apps/user-ui/src`, not new packages.
- **Schema parsing:** deferred to its own commit after step 3.
