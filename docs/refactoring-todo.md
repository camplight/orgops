# Refactoring Todo: Maintainability Hotspots

Source: graphify knowledge graph (`graphify-out/graph.json`, 2,206 nodes) plus line counts. Files are ranked by size and cross-file coupling.

Caveats:

- This is a proxy for complexity. It does not measure cyclomatic complexity, test coverage or churn.
- Edge counts come from AST extraction. The `.sql` migrations are not included.
- Some edges are INFERRED and unverified, for example 15 on `createApp()`.

## Priority hotspots

| # | File | LOC | Symbols | Edges | Cross-file links |
|---|------|-----|---------|-------|------------------|
| 1 | `apps/user-ui/src/App.tsx` | 3070 | 94 | 464 | 66 |
| 2 | `apps/agent-runner/src/turn-executor.ts` | 940 | 31 | 210 | 102 |
| 3 | `apps/api/src/app.ts` | 544 | 20 | 166 | 112 |
| 4 | `apps/admin-ui/src/screens/AgentsScreen.tsx` | 1793 | 11 | 59 | 29 |
| 5 | `apps/admin-ui/src/screens/ChatScreen.tsx` | 1456 | 41 | 187 | 31 |
| 6 | `apps/admin-ui/src/App.tsx` | 1385 | 13 | 109 | 71 |
| 7 | `apps/api/src/routes/events.ts` | 1302 | 13 | 81 | 49 |
| 8 | `apps/agent-runner/src/tools/events.ts` | 1195 | 35 | 113 | 11 |
| 9 | `apps/api/src/routes/agents.ts` | 1159 | 23 | 80 | 26 |
| 10 | `apps/api/src/routes/collab.ts` | 1135 | 18 | 77 | 27 |
| 11 | `apps/agent-runner/src/rlm.ts` | 1018 | 38 | 157 | 33 |
| 12 | `apps/opscli/src/index.ts` | 919 | 10 | 111 | 79 |
| 13 | `apps/agent-runner/src/wrapper-harness/command.ts` | 860 | 29 | 127 | 35 |

## Tasks

### 1. Split `apps/user-ui/src/App.tsx`

- [ ] It is the largest file, with the most edges in the graph. It holds the whole user shell: routing, state, data loading and channel/conversation logic.
- [ ] Low runtime risk compared with the runner, so it is a good place to start.
- [ ] Extract routing, data loading and conversation logic into separate modules or hooks.

Progress against `docs/1-refactoring-1-user-ui-refactoring-plan.md`:

- [x] 0a. Test tooling (`happy-dom`, Testing Library, setup), the characterisation harness and the timing budget.
- [x] 0b. Characterisation suites, one area per commit (auth, workspace load, sidebar, timeline, loading and realtime, composer, dialogs and management).
- [x] 0c. Stryker spike and gap-filling pass. Closed without a whole-file run, as too slow. Accepted as good enough.
- [ ] 1. Move pure functions out into `domain/*`.
- [ ] 2. Extract presentational components.
- [ ] 3. Introduce gateway ports and HTTP adapters.
- [ ] 4. Extract realtime.
- [ ] 5. Identity context.
- [ ] 6. Conversations context.
- [ ] 7. Messaging context.
- [ ] 8. `App.tsx` becomes the composition root.
- [ ] 9. Hardening.

### 2. Review `apps/agent-runner/src/turn-executor.ts`

- [ ] It is the densest file for its size (210 edges, 102 cross-file links).
- [ ] It contains the mid-turn event injection, which `AGENTS.md` calls the subtlest behavior in the codebase (`reconcileLateInjectedMessages`, `selectRecentDeltaEventsForPrompt`).
- [ ] Measure real cyclomatic complexity before changing it.
- [ ] Check test coverage first. `runner.test.ts` is the de facto behavioral spec.

### 3. Verify and slim `apps/api/src/app.ts`

- [ ] It has the highest cross-file coupling. Some of that is by design, since it is the composition root.
- [ ] `insertEvent()` lives here and is the single write path for every event.
- [ ] Verify the 15 INFERRED edges on `createApp()` (for example with `eventRowToApi()` and `getDefaultSoulPath()`).
- [ ] Keep the rule that route modules receive dependencies through the deps object.

### 4. Break up large admin-UI components

- [ ] `AgentsScreen.tsx` has 1,793 lines but only 11 symbols, which points to a few very large components.
- [ ] `ChatScreen.tsx` has 187 edges.
- [ ] `admin-ui/src/App.tsx` has 71 cross-file links.

### 5. Split large API route modules

- [ ] `routes/events.ts`, `routes/agents.ts` and `routes/collab.ts` are each over 1,100 lines.

### 6. Runner internals

- [ ] `rlm.ts` has 157 edges.
- [ ] `tools/events.ts` has 1,195 lines.
- [ ] `wrapper-harness/command.ts` runs arbitrary host code, which raises the cost of getting it wrong.

## Other findings

- **Big files with few symbols.** `AgentsScreen.tsx`, `admin-ui/App.tsx` and `opscli/src/index.ts` (919 lines, 10 symbols) suggest very large functions or components.
- **High fan-in type modules.** `apps/admin-ui/src/types.ts` has 103 cross-file links. `agent-runner/src/types.ts` is only 37 lines but has 81. Changes to either ripple widely.
- **Duplicated UI plumbing.** `admin-ui` and `user-ui` each have their own `App()`, `apiFetch`, `getApiHeaders` and `config.ts`. A fix in one may need repeating in the other.
- **Weak community cohesion.** The report flags "UI Button Primitives" (0.12) and "Wrapper Harness Runtime" (0.08) as weakly interconnected.

## Notes

- Follow the repo's TDD and testing conventions: add or confirm behavioral tests before each refactor. Commit before refactoring, and commit refactors separately from feature work.
- Re-run `/graphify . --update` after refactors to see whether coupling drops.
