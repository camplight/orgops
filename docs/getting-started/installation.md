# Installation

There are three ways to run OrgOps. For trying it out or contributing, run it
**from source**. For a server, use the **container image** or **OpsCLI**.

| Option | Best for |
| --- | --- |
| [From source](#from-source) | Local development, evaluation, contributing |
| [Docker](../guides/deployment.md#single-image-container) | Servers, one image with all components |
| [OpsCLI](../guides/opscli.md) | Personal hosts and runner machines, with OS auto-start services |

## Requirements

- **Node.js 22+** and npm (the repository uses npm workspaces, not pnpm)
- **SQLite**
- **Python 3.11+**: only for the browser automation skill (Playwright + Lightpanda)
- Optional: an API key for at least one LLM provider (OpenAI, Anthropic, OpenRouter,
  Mistral, Liquid or an OpenAI-compatible gateway)

## From source

```bash
git clone https://github.com/camplight/orgops.git
cd orgops
npm install
cp .env.example .env
```

!!! warning "Do not overwrite an existing `.env`"
    Nearly every script loads `.env`. If you already have one, keep it and only add
    the keys you are missing. Use `.env.example` as a reference.

The example `.env` contains a development `ORGOPS_MASTER_KEY`. Generate your own for any
instance that stores real secrets:

```bash
openssl rand -base64 32
```

Start the API, the agent runner and both UIs:

```bash
npm run dev:all
```

| Service | URL |
| --- | --- |
| Admin UI | <http://localhost:5173> |
| User UI | <http://localhost:5190> |
| API | <http://localhost:8787> (health check: `/health`) |

Sign in with `admin` / `admin`. These values come from `ORGOPS_ADMIN_USER` and
`ORGOPS_ADMIN_PASS`, and the admin account is created only when the database has no
humans yet.

!!! tip "Working without API keys"
    Set `ORGOPS_LLM_STUB=1` in `.env` to stub all LLM calls. This is useful for UI work
    and tests.

### Useful scripts

| Command | What it does |
| --- | --- |
| `npm run dev:all` | API on `:8787`, admin UI, user UI and a runner that waits for the API |
| `npm run dev:all:clean` | Same, but wipes runtime state first |
| `npm run dev` | API only |
| `npm run prod:all` | Builds both UIs, then runs API, admin UI preview and runner |
| `npm run livekit` | Local LiveKit server for voice rooms (`brew install livekit` first) |
| `npm test` | Runs the Vitest suite |
| `npm run lint` | Type-checks every workspace (`tsc --noEmit`) |

Runtime data lives in `.orgops-data/` (database and agent workspaces) and uploaded
files in `files/`. Both are gitignored.

## Next steps

- [Create your first agent](first-agent.md)
- [Understand the architecture](../concepts/architecture.md)
- [Deploy to production](../guides/deployment.md)
