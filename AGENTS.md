# What this is

OrgOps is a self-hosted control plane for running teams of AI agents across multiple machines. Humans and agents collaborate through an append-only, typed event log persisted in SQLite; agents execute shell/filesystem/process tools on a specific assigned host and stream results back.

`docs/SPEC.md` describes the current implementation in detail and is kept in sync with the code — read it before making architectural changes, and update it when you change the API surface, event contract, or runtime behavior. `PROJECT_OVERVIEW.md` covers motivation and trade-offs.

## Commands

This repo uses **npm workspaces** with a committed `package-lock.json`. Use `npm`, not `pnpm`, here.

```bash
npm install
cp .env.example .env          # required: nearly every script runs via --env-file=.env or dotenv -e .env

npm run dev:all               # API :8787 + UI :5173 + runner (runner waits for API readiness)
npm run dev:all:clean         # same, but wipes runtime state first
npm run dev                   # API only
npm run prod:all              # builds UI, then API + UI preview + runner

npm test                      # vitest run (whole repo)
npm run lint                  # tsc --noEmit across every workspace (there is no eslint)
npm run build                 # UI only — backend apps have no build step
```

Single test file / single test:

```bash
npx vitest run apps/agent-runner/src/turn-executor.test.ts
npx vitest run apps/api/src/app.test.ts -t "creates an agent"
```

`apps/opscli` uses the Node test runner, not vitest, and is **not** covered by root `npm test`:

```bash
npm run --workspace @orgops/opscli test
npm run --workspace @orgops/opscli start
```

Scenario e2e checks run against already-running services:

```bash
npm run scenario:test:countdown
```

Set `ORGOPS_LLM_STUB=1` to work without provider API keys. Default login is `ORGOPS_ADMIN_USER`/`ORGOPS_ADMIN_PASS` (`admin`/`admin`); the admin row is only seeded when no humans exist.

Backend apps run TypeScript directly via `tsx` (`node --import tsx`). There is no compile step and no emitted `dist/` — `lint` is the only type check.

## Architecture

### Four runtime components

- **`apps/api`** — Hono HTTP + WebSocket server. Sole owner of the SQLite DB. Runs migrations at startup.
- **`apps/agent-runner`** — host-local supervisor. Polls the API once per second, runs agent turns, executes tools, supervises processes.
- **`apps/ui`** — React + Tailwind + Vite operator surface. Dev-proxies `/api` and `/ws` to :8787; production uses same-origin paths, so UI and API must sit behind one origin.
- **`apps/opscli`** — standalone bootstrap/break-glass CLI agent. Ships as a self-contained binary from `.github/workflows/release-main.yml` with a repo source snapshot and the docs bundled into its system prompt.

`apps/site` is a separate Astro marketing site, unrelated to the runtime.

### Event flow

Everything is an event. `insertEvent()` in `apps/api/src/app.ts` is the single write path: it assigns a strictly-monotonic `created_at`, writes the `events` row, creates a `PENDING` row in `event_receipts` for **every agent subscribed to the channel**, then publishes to WebSocket topics (`org:events`, `channel:<id>`, and `agent:<name>` for agent-sourced events).

Runners consume via per-agent receipts (at-least-once). `deliverAt` schedules future delivery; `idempotencyKey` dedupes; repeated `/api/events/:id/fail` escalates to dead-letter (`event.deadlettered`) at `ORGOPS_EVENT_MAX_FAILURES`.

**Event validation is dynamic.** The registry is composed at request time from `packages/schemas/src/event-shapes.ts` plus any `skills/*/event-shapes.ts` belonging to installed skills, cached for `ORGOPS_EVENT_SHAPES_CACHE_TTL_MS`. Adding a new event type means adding a shape there — `POST /api/events` rejects unknown/invalid payloads.

**Not every event wakes an agent.** `apps/agent-runner/src/event-routing.ts` filters out whole prefixes as bookkeeping: `agent.control.`, `agent.turn.`, `wrapper.`, `audit.`, `telemetry.`, `tool.`, plus `noop`, self-authored events, channel-less events, and events whose `payload.targetAgentName` names someone else. When adding an event type, decide deliberately which side of that filter it belongs on.

### Turn execution

Pending events are grouped by channel and processed as **one batch per `(agent, channel)`** — a burst becomes a single turn, not N turns. `channel-loop.ts` serializes work per key and marks the pair busy so polling skips it. During a CLASSIC turn, `turn-executor.ts` runs the model step-by-step and polls for newly arrived same-channel events *between* steps, merging them into the next attempt (`reconcileLateInjectedMessages`, `selectRecentDeltaEventsForPrompt`). This mid-turn injection is the subtlest behavior in the codebase.

`prompt-composer.ts` builds context from system prompt + bounded channel history + enabled skill markdown + soul file + memory summaries, with char/token budgeting.

### Agent modes (`agents.mode`) — the main branch in the runner

- `CLASSIC` — LLM tool-calling loop; model output is coerced into valid events, with a fallback `message.created` if it doesn't produce one.
- `RLM_REPL` — recursive REPL: the model emits one JS snippet per step into a child-process VM, terminating with `done(result)`. See `rlm.ts` / `rlm-process.ts`.
- `WRAPPED` — an OrgOps-owned lifecycle record whose turns are delegated to an **external** runtime (OpenClaw, Cursor, any CLI) described by `wrapped_config_json`. Wrapped agents deliberately bypass OrgOps memory, prompt composition, skills, model calls, and filesystem allowlisting — the external runtime owns all of that. `soul_path`/`soul_contents` are *not* auto-injected; whoever creates the agent must translate them into the harness config.

To support a new external runtime (SDK, HTTP, daemon, MCP), add a harness module under `apps/agent-runner/src/wrapper-harness/` implementing `canHandle`/`ensureReady`/`runTurn` and register it in `registry.ts` — do not grow `wrapped-runtime.ts`. Note that `source`, `setup.command`, and `runtime.command` in a wrapped config are arbitrary host code execution; treat GitHub-derived recipes as privileged.

### Multi-host assignment

Deliberately dumb, no scheduler. Each runner registers at `/api/runners/register` and persists a stable ID in `.agent-runner-id`. A runner only picks up agents whose `assigned_runner_id` matches its own. This guarantees "same agent, same host" so host-local tools, files, and credentials stay valid.

### Runner tooling

Tools are defined per family in `apps/agent-runner/src/tools/` and dispatched **by name prefix** (`shell_`, `fs_`, `events_`, `agents_`, `memory_`) in `tools/index.ts`, which also rejects duplicate tool names at construction. Filesystem access is allowlisted to the agent workspace root plus enabled skill directories, widened to the whole host only when `allow_outside_workspace` is set (`tools/path-access.ts`). `shell_run` is timeout-bounded (1s–45s) and force-kills; long-running work must use `shell_start`/`shell_tail`.

### Database

Hand-written, numbered SQL migrations in `packages/db/migrations/` (`NNN_name.sql`), applied in filename order by the custom `migrate()` in `packages/db/src/index.ts` and tracked in the `migrations` table. **drizzle-kit generation is not used** — when changing the schema, add a migration file *and* update `packages/db/src/schema.ts` by hand so they stay in agreement.

### API structure

`apps/api/src/app.ts` is the composition root: it opens the DB, migrates, seeds admin, defines shared helpers (`insertEvent`, `jsonResponse`, `requireAuth`, `requireRunnerAuth`, password hashing), then calls `registerXRoutes(app, deps)` for each route module. Route modules receive everything through that deps object rather than importing the DB — preserve that when adding routes.

Auth has two paths: human session cookie (`orgops_session`, in-memory `sessions` map, so sessions die on restart) and the `x-orgops-runner-token` header, which satisfies `requireAuth` as the pseudo-user `runner`. `routes/access.ts` layers public/private visibility on channels and agents; the `runner` user bypasses all of it.

### Skills

`skills/<name>/SKILL.md` with YAML frontmatter, optional runnable `assets/`, and optional `event-shapes.ts` that extends the event registry. Enabling a skill on an agent both injects its markdown into the prompt and adds its directory to the agent's filesystem allowlist.

## Conventions

- Functional style throughout — factory functions returning objects of closures (`createApp`, `createRunnerTools`, `createAccessControl`, `createTurnExecutor`), no classes.
- Tests are colocated `*.test.ts`. `apps/api/src/app.test.ts` and `apps/agent-runner/src/runner.test.ts` are large and serve as the de facto behavioral spec — check them before changing event or turn semantics.
- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, with a scope), as in existing history.
- `CHANGELOG.md` is intentionally not maintained by hand; release notes are generated per release tag by CI.
- Runtime state lives in gitignored `.orgops-data/` (SQLite, workspaces, souls) and `files/` (uploads).
