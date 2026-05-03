# OrgOps

OrgOps is a Node.js multi-host agent system where humans and autonomous agents collaborate via an event bus. Agents can run host shell/filesystem/process operations, manage long-running jobs, and stream outputs back to humans/models. The current deployment model emphasizes deterministic host assignment and a local autonomous bootstrap/maintenance CLI (`opscli`).

## Repo layout

```
apps/
  api/            Hono HTTP + WebSocket API
  agent-runner/   Agent supervisor and tool executor
  opscli/         Host bootstrap + maintenance CLI agent
  ui/             React + Tailwind UI
packages/
  crypto/         Envelope encryption helpers
  db/             SQLite schema + migrations
  event-bus/      Pub/sub helpers
  llm/            Vercel AI SDK wrapper
  schemas/        Zod schemas + typed event shapes
  skills/         Skill catalog parser
skills/           Built-in skills (+ optional event-shapes.ts per skill)
files/            Runtime file storage (gitignored)
.orgops-data/      Runtime DB + workspaces (gitignored)
```

## Requirements

- Node 22+
- SQLite
- Python 3.11+ for browser automation skills (Playwright/Lightpanda)

## Quickstart

```bash
npm install

# Dev: API + agent-runner + UI
npm run dev:all
```

Open `http://localhost:5173` for UI, API on `http://localhost:8787`.

## Deployment approach

OrgOps is split into three runtime components plus one bootstrap/maintenance CLI:

- `api`: central API/event system
- `ui`: human control surface
- `agent-runner`: host-local execution runtime
- `opscli`: host bootstrap + maintenance RLM REPL agent

Multi-host execution is kept intentionally simple:

- each runner registers at API and gets/persists a stable runner ID in `.agent-runner-id`
- each agent can be assigned to one `assignedRunnerId`
- runners only pick up agents assigned to their own runner ID

This guarantees "same agent, same host" behavior without a complex scheduler.

## Production

```bash
npm run prod:all
```

This builds the UI and runs the API, runner, and UI preview.

If you deploy the UI separately, it uses same-origin `/api` and `/ws` paths in production
builds. Put the UI and API behind the same public origin (or reverse proxy these paths to
the API service) so browser auth cookies and WebSocket traffic work correctly.

## OpsCLI

`apps/opscli` is the autonomous bootstrap and maintenance CLI for OrgOps hosts.

```bash
npm run --workspace @orgops/opscli start
```

It scaffolds `.orgops-data` locally and runs a persistent JS runtime session (VM context) for an RLM loop.
The REPL exposes:

- `shell(command)` for host command execution
- `print(...args)` for stdout output
- `input(question)` for interactive stdin requests
- `exit(code)` for agent-driven process termination

OpsCLI keeps a rolling session summary and capped recent history to stay within model context limits.

## Release automation

Pushes to `main` produce versioned rolling GitHub releases through
`.github/workflows/release-main.yml`.

Release tags follow SemVer + date:

- `0.0.1-YYYY-MM-DD` for the first release
- `0.0.N-YYYY-MM-DD` for subsequent releases (patch increments on each release)

The workflow builds self-contained `opscli` binaries for Linux/macOS/Windows.
Each release includes:

- platform binaries (`opscli-linux`, `opscli-macos`, `opscli-windows`)
- a release changelog artifact (`CHANGELOG-<release-tag>.md`)
- release notes generated from commits since the previous release tag

Each binary bundles:

- OrgOps source snapshot for `api`, `agent-runner`, `ui`, and shared packages
- OrgOps docs (README + SPEC + runner README) injected into OpsCLI system prompt

On host launch, `opscli` can prompt for missing provider keys (`OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, or `OPENROUTER_API_KEY`), persist the selected key to a local `.env`,
and then use REPL helpers (`extractOrgOps`, `setupOrgOps`) to unpack and prepare selected
components. By default, extraction is done to `./orgops`, and OpsCLI stores the extracted
path in `.env` via `ORGOPS_EXTRACTED_ROOT` for reuse in later sessions.

On macOS, downloaded binaries may be quarantined by Gatekeeper. After download:

```bash
xattr -d com.apple.quarantine ./opscli-macos
chmod +x ./opscli-macos
./opscli-macos
```

## Environment variables

- `PORT` (API server port, default: `8787`)
- `ORGOPS_ADMIN_USER` / `ORGOPS_ADMIN_PASS` (defaults to `admin`)
- `ORGOPS_RUNNER_TOKEN` (shared token for agent-runner -> API, default: `dev-runner-token`)
- `ORGOPS_MASTER_KEY` (32-byte base64, required for secrets encryption)
- `ORGOPS_COOKIE_SECURE` (`auto|always|never`, default: `auto`; `auto` enables `Secure` cookies on HTTPS requests)
- `ORGOPS_PROJECT_ROOT` (optional monorepo root override)
- `ORGOPS_API_URL` (agent-runner API base URL)
- `ORGOPS_RUNNER_ID_FILE` (optional path for persisted runner identity; default: `.agent-runner-id`)
- `ORGOPS_RUNNER_NAME` (optional runner display name used on registration)
- `ORGOPS_EVENT_MAX_FAILURES` (default: 25)
- `ORGOPS_EVENT_SHAPES_CACHE_TTL_MS` (API event-shapes cache TTL, default: `3000`)
- `ORGOPS_RUNNER_ONLINE_THRESHOLD_MS` (runner online threshold, default: `15000`)
- `OPENAI_API_KEY` (for OpenAI models)
- `ANTHROPIC_API_KEY` (for Anthropic models)
- `OPENROUTER_API_KEY` (for OpenRouter models)
- `OPENROUTER_BASE_URL` (optional; defaults to `https://openrouter.ai/api/v1`)
- `OPENROUTER_HTTP_REFERER` / `OPENROUTER_APP_TITLE` (optional OpenRouter request headers)
- `ORGOPS_LLM_STUB` (`1` to stub `@orgops/llm` calls)
- `ORGOPS_LLM_CALL_TIMEOUT_MS` (runner default LLM call timeout; default: `10800000`)
- `ORGOPS_HISTORY_MAX_EVENTS` / `ORGOPS_HISTORY_MAX_CHARS` (runner prompt history bounds)
- `ORGOPS_CHANNEL_RECENT_MEMORY_INTERVAL_MS` / `ORGOPS_CHANNEL_FULL_MEMORY_INTERVAL_MS`
- `ORGOPS_CROSS_RECENT_MEMORY_INTERVAL_MS` / `ORGOPS_CROSS_FULL_MEMORY_INTERVAL_MS`
- `ORGOPS_AGENT_INTENT_TIMEOUT_MS` / `ORGOPS_AGENT_INTENT_MAX_TIMEOUTS`
- `ORGOPS_GIT_BASH_PATH` (optional Windows path to `bash.exe`; defaults to `C:\Program Files\Git\bin\bash.exe`)
- `ORGOPS_SHELL_PATH` / `ORGOPS_SHELL_ARGS` (optional shell override for all `shell_*` tools)
- `ORGOPS_SHELL_TIMEOUT_KILL_GRACE_MS` (optional post-timeout kill grace for `shell_run`)
- RLM controls:
  - `ORGOPS_RLM_MAX_STEPS`
  - `ORGOPS_RLM_MAX_OUTPUT_CHARS`
  - `ORGOPS_RLM_MAX_INPUT_CHARS`
  - `ORGOPS_RLM_PROMPT_PREVIEW_MAX_CHARS`
  - `ORGOPS_RLM_EVAL_TIMEOUT_MS`
  - `ORGOPS_RLM_MAX_SUBAGENT_DEPTH`
  - `ORGOPS_RLM_MAX_SUBAGENTS_PER_EVENT`
- OpsCLI:
  - `ORGOPS_OPSCLI_MODEL`
  - `ORGOPS_OPSCLI_MAX_STEPS`
  - `ORGOPS_OPSCLI_COMMAND_TIMEOUT_MS`
  - `ORGOPS_OPSCLI_EVAL_TIMEOUT_MS`
  - `ORGOPS_OPSCLI_EVAL_CALLBACK_TIMEOUT_MS`
  - `ORGOPS_OPSCLI_MAX_CONTEXT_CHARS`
  - `ORGOPS_OPSCLI_MAX_SUMMARY_CHARS`
  - `ORGOPS_OPSCLI_SUMMARY_CHUNK_MESSAGES`
  - `ORGOPS_OPSCLI_MIN_RECENT_MESSAGES`
  - `ORGOPS_OPSCLI_MAX_SYSTEM_DOC_CHARS`
  - `ORGOPS_OPSCLI_DEBUG`
  - `ORGOPS_OPSCLI_SPINNER` / `ORGOPS_OPSCLI_PROGRESS`
  - `ORGOPS_OPSCLI_LOG_PATH`
  - `ORGOPS_OPSCLI_DOUBLE_SIGINT_MS`
  - `ORGOPS_EXTRACTED_ROOT` (auto-managed extracted path)
- UI (`apps/ui`):
  - `VITE_API_BASE_URL` (optional; default: `/api`)
  - `VITE_WS_BASE_URL` (optional; default: `/ws`, or derived from `VITE_API_BASE_URL` when absolute)
  - runtime override via `window.__ORGOPS_UI_CONFIG__ = { apiBaseUrl, wsBaseUrl }`
  - in dev, Vite proxies `/api` and `/ws` to `http://localhost:8787` when using relative paths

## Runner behavior notes

- Pending events are coalesced per `(agent, channel)` before model handling, so a burst of same-channel events is processed in one handling sequence.
- The runner executes model turns step-by-step and polls for new pending channel events between model attempts/turns; newly arrived same-channel events can be merged into the next attempt context.
- `shell_run` enforces a timeout (default 45s, configurable per call via `timeoutMs`, bounds 1s..45s) and force-kills timed-out commands. Use `shell_start` for long-running jobs.
- Runner registration/heartbeats are handled via `/api/runners/register` and `/api/runners/:id/heartbeat`.

## Tests

```bash
npm test
```

Scenario e2e checks against running services:

```bash
npm run scenario:test:countdown
```

## Skills

Skills live under `skills/` using `SKILL.md` (OpenCode/OpenClaw-style) frontmatter.
Each skill is a folder with docs plus optional runnable assets.

Built-in skills:

- OrgOps API events
- Agent collaboration via events
- Local memory init
- Browser automation via Playwright + Lightpanda (`skills/browser-use-lightpanda`)

For Playwright install steps, see the upstream docs: https://playwright.dev/docs/intro

## License

This project is licensed under the Apache License 2.0.
See `LICENSE` for the full text.
