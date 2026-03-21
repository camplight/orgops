# OrgOps

OrgOps is a single-company, single-VPS system where humans and autonomous agents collaborate via an event bus. Agents can run host-wide shell and filesystem operations, manage long-running processes, and stream outputs back to humans/models. The MVP emphasizes verified ingress and mandatory audit logging.

## Repo layout

```
apps/
  api/            Hono HTTP + WebSocket API
  agent-runner/   Agent supervisor and tool executor
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
- Python 3.11+ for browser-use skill

## Quickstart

```bash
npm install

# Dev: API + agent-runner + UI
npm run dev:all
```

Open `http://localhost:5173` for UI, API on `http://localhost:8787`.

## Production

```bash
npm run prod:all
```

This builds the UI and runs the API, runner, and UI preview.

## Environment variables

- `ORGOPS_ADMIN_USER` / `ORGOPS_ADMIN_PASS` (defaults to `admin`)
- `ORGOPS_RUNNER_TOKEN` (shared token for agent-runner -> API, default: `dev-runner-token`)
- `ORGOPS_MASTER_KEY` (32-byte base64, required for secrets encryption)
- `ORGOPS_API_URL` (agent-runner API base URL)
- `ORGOPS_EVENT_MAX_FAILURES` (default: 25)
- `OPENAI_API_KEY` (for OpenAI models)

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
- Browser automation via browser-use

For browser-use install steps, see the upstream repository: https://github.com/browser-use/browser-use
