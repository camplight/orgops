---
name: write-bdd-scenarios
description: Discover behaviours for an area of apps/user-ui and write them directly as executable Vitest + Testing Library characterisation tests (no .feature files), following docs/1-refactoring-1-user-ui-refactoring-plan.md. Use when asked to specify, pin, or write scenarios, acceptance criteria, characterisation tests or BDD tests for the user UI.
---

# Write BDD tests (user-ui characterisation framework)

Turn an area of observable `apps/user-ui` behaviour into a Vitest suite that mounts the real `<App />`. There are no `.feature` files: the test is the specification. The framework is defined in `docs/1-refactoring-1-user-ui-refactoring-plan.md` (section 1). Read it first and follow it; this skill does not redefine it.

Two modes:

- **Characterisation (default while the App.tsx refactor is in progress).** Tests describe what the app does today and pass as soon as they are written. Mutation testing, not RED-first, proves they would catch a break. This is the deliberate exception to the TDD rule named in the plan.
- **New behaviour.** Tests describe something the app does not do yet. Write them as `it.skip(` and hand them to TDD one at a time.

Ask the user which mode applies if the request does not say. Production code is out of scope in both modes.

The reasoning behind the rules is in [references/sources.md](references/sources.md).

## 1. Understand before writing

BDD is a conversation first and a file second. Do not jump to tests.

- Read the plan's "Behaviours to pin" list, existing `apps/user-ui/src/characterisation/*.test.tsx` and the code for the area (`apps/user-ui/src/App.tsx` and neighbours), plus `docs/SPEC.md`. Reuse existing helpers and vocabulary and do not duplicate tests.
- State the story: "As a [role], I want [capability], so that [value]." If you cannot name the value, ask the user.
- Run an Example Mapping pass in text and show it to the user before writing the file:
  - **Rules**: one line each.
  - **Examples**: concrete cases per rule with real values ("#general", "Direct: alice, bob", "Load previous messages"). Each example becomes one test.
  - **Questions**: anything you cannot answer from the repo.
- Probe each rule with Liz Keogh's two questions:
  - Context: is there another context where the same event gives a different outcome? (archived, read-only, private vs public vs team-shared, offline agent, WebSocket down)
  - Outcome: is there another outcome that matters? (what is shown, kept or hidden afterwards, which request is sent)
- Ask the user the open questions with `AskUserQuestion`. Do not invent business rules.
- **Quirks.** In characterisation mode, pin code that looks wrong as it is and log it in a "Quirks" list. Do not fix it and do not skip it. Example from the plan: `DIRECT_GROUP` and `AGENT_AGENT_DM` channels pass the visibility rule but match no sidebar group, so they are never listed. Put `[quirk]` at the start of the test name so it is easy to find for the separate fix ticket.
- Out-of-scope behaviours go in a "Not now" list.
- Too many rules or examples means the area is too big. Propose a split. Areas follow the plan: auth, workspace load, sidebar, timeline, loading, composer, dialogs and management. One test file per area.

Wait for the user's approval of the example map, then write the tests.

## 2. Write the tests

File: `apps/user-ui/src/characterisation/<area>.test.tsx`. Follow the plan's approach exactly.

**Stack**

- Vitest with `happy-dom` (switch a single file to `jsdom` only if a behaviour needs it) and Testing Library. `fireEvent` for plain state changes; `user-event` only where realistic typing matters (Enter vs Shift+Enter, IME composition).
- Mount the real `<App />`. Fake only the outside world: a hand-rolled `fetch` stub with a route table, a fake `WebSocket` class the test can push events through, and the browser APIs (`history`/`location`, `clipboard`, `window.confirm`, `requestAnimationFrame`, fake timers). Stub `scrollHeight` and similar layout properties where needed and accept partial coverage there.
- Use the shared harness (fetch stub, fake WebSocket, `renderApp`) from `apps/user-ui/src/characterisation/`. If it does not exist yet, create it first, as its own commit (plan step 0a).

**What tests may import**

- Only `App`, types from `types.ts`, the harness, and factory functions (`getMockChannel`, `getMockEvent`, ...). Never import or mock `api.ts`, `config.ts` or any other internal module, or moving them would force test edits.
- Factories return complete objects with `Partial<T>` overrides. Keep fixtures small (for example 3 channels). No `let`, no `beforeEach`. Each test builds its own data and renders a fresh `App`.

**Naming and layout**

- Group tests in `describe` blocks by rule. Name each test after the behaviour as a plain sentence that states the rule ("shows an error for wrong credentials"), not "test 3" or "validation".
- Context, event, outcome in order, with a blank line before the assertion. No comments.
- One behaviour per test: one action, and assertions that all describe the same outcome.
- Concrete values on both sides of each boundary (7 vs 8 password characters, one channel vs none).
- Extract helpers for domain phrases ("signInAs", "openChannel", "receiveEvent") so a test reads like a sentence. Reuse existing ones.
- Tests are independent. None relies on another having run.
- If one test is necessarily true whenever another is, merge them or drop the weaker one.

**What to assert**

- Two things are observable: what the operator sees (visible text and roles), and the HTTP requests the app sends (method, URL, body), since that is its real contract with the API.
- Never assert internal state, hooks, module calls, storage, class names, `aria-*` strings or layout. The plan treats those as implementation detail.

**Time**

- Fake timers everywhere. Advance the fake clock and flush promises. No real `waitFor` timeouts. Conditions like "realtime connection is down" or "10 seconds pass" are explicit setup or action lines in the test.

**Speed budget**

- Whole suite under about 10 seconds, any single test under about 200ms. After writing a suite, run `npx vitest run apps/user-ui --reporter=verbose` and fix anything over budget immediately.

**Modes**

- Characterisation: tests are active and must be green.
- New behaviour: write every test as `it.skip(`.

**Checks**

- `npm run lint` and `npm test` stay green. Do not edit `App.tsx` while writing characterisation tests (plan step 0).

## 3. Review before showing the user

Fix failures silently:

- Does each test have a business reason to exist, not just a branch to cover?
- Could someone who has not read the code tell from the test name and body whether the behaviour is right?
- Does any pair of tests pass or fail together?
- Is a missing context or outcome from the Keogh questions covered?
- Is any assertion on markup? Remove it.
- Does it import an internal module? Remove it.

## 4. Mutation check and hand-off

In characterisation mode, report:

- the tests written, grouped by rule
- the quirks pinned, for separate fix tickets
- the open questions and "Not now" items
- suite timing against the budget

Then follow plan step 0c: run Stryker (vitest runner, scope `apps/user-ui/src/**`, excluding tests and `styles.css`, per-test coverage, incremental) on the extracted modules, not on all of `App.tsx` at once. Add a test for each surviving mutant that is a real gap in conditionals, string literals or arithmetic. Ignore survivors in class names, `aria-*` strings and style code. Target about 80% on logic modules. Stryker support for the repo's vitest version is unverified; the plan's fallback is a hand-picked list of manual mutations.

In new-behaviour mode, suggest implementing one skipped test at a time with outside-in TDD, starting with the simplest happy path.

## Anti-patterns to refuse

- Tests written from the code structure instead of the operator's goal.
- Test-per-function or test-per-branch tests.
- Assertions on markup, CSS classes, `aria-*` strings, component state or storage.
- Tests that import or mock `api.ts`, `config.ts` or other internals.
- `let`/`beforeEach` shared state; real timers; real network.
- Fixing a quirk inside a characterisation suite.
- Writing tests before the user has seen the example map.
