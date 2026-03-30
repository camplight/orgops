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
- Python 3.11+ for browser automation skills (Playwright/Lightpanda)

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

## Bundle builds

- Windows bundle script: `scripts/bundle-windows.ps1`
- Linux/macOS bundle script: `scripts/bundle-unix.sh`
- Windows installer script: `scripts/install-windows-bundle.ps1`
- Linux VM installer script: `scripts/install-linux-bundle.sh`
- Linux latest-release installer helper: `scripts/install-linux-latest.sh`
- GitHub Actions workflows:
  - `.github/workflows/windows-bundle.yml`
  - `.github/workflows/unix-bundle.yml`
  - `.github/workflows/publish-linux-latest-bundle.yml` (publishes Linux + Windows assets to `bundles-latest`)

### Quick Linux VM install (paste into shell)

```bash
curl -fsSL https://raw.githubusercontent.com/<org>/<repo>/<branch>/scripts/install-linux-bundle.sh | bash -s -- "<linux-bundle-url>"
```

### Quick Linux VM install from stable latest release URL

```bash
curl -fsSL https://raw.githubusercontent.com/<org>/<repo>/<branch>/scripts/install-linux-latest.sh | bash -s -- "<org>/<repo>" /opt/orgops
```

For systemd setup:

```bash
curl -fsSL https://raw.githubusercontent.com/<org>/<repo>/<branch>/scripts/install-linux-latest.sh | sudo ORGOPS_SYSTEMD_SERVICE=1 bash -s -- "<org>/<repo>" /opt/orgops
```

For offline or transferred Unix bundle installs on a bare host:

1. Extract `orgops-<platform>-<arch>-bundle.tar.gz`
2. Run `./install-orgops.sh /opt/orgops` from the extracted bundle root (runs prereqs + idempotent install, does not start)
3. Start manually with `/opt/orgops/start-orgops.sh`

### Quick Windows VM install (paste into PowerShell)

```powershell
iwr -useb https://raw.githubusercontent.com/<org>/<repo>/<branch>/scripts/install-windows-bundle.ps1 | iex; Install-OrgOpsBundle -BundleSource "<windows-bundle-url>" -InstallDir "C:\orgops"
```

For offline or transferred zip installs on a bare Windows host:

1. Extract `orgops-windows-bundle.zip`
2. Run `install-orgops.cmd` from the extracted bundle root (runs prereqs + idempotent install to `C:\orgops`, does not start)
   - Optional custom install directory: `install-orgops.cmd D:\orgops`
3. Start manually with `C:\orgops\start-orgops.cmd` (or your custom dir)

Installer behavior (Windows + Unix):

- Idempotent update: replaces code/runtime files while preserving `.orgops-data`, `files`, and `.env`
- Safe for repeated upgrades in-place
- DB migrations run automatically on next API start

## Environment variables

- `ORGOPS_ADMIN_USER` / `ORGOPS_ADMIN_PASS` (defaults to `admin`)
- `ORGOPS_RUNNER_TOKEN` (shared token for agent-runner -> API, default: `dev-runner-token`)
- `ORGOPS_MASTER_KEY` (32-byte base64, required for secrets encryption)
- `ORGOPS_API_URL` (agent-runner API base URL)
- `ORGOPS_EVENT_MAX_FAILURES` (default: 25)
- `OPENAI_API_KEY` (for OpenAI models)
- `ORGOPS_GIT_BASH_PATH` (optional Windows path to `bash.exe`; defaults to `C:\Program Files\Git\bin\bash.exe`)
- `ORGOPS_SHELL_PATH` / `ORGOPS_SHELL_ARGS` (optional shell override for all `shell_*` tools)

## Runner behavior notes

- Pending events are coalesced per `(agent, channel)` before model handling, so a burst of same-channel events is processed in one handling sequence.
- The runner executes model turns step-by-step and polls for new pending channel events between turns; newly arrived same-channel events are injected into the in-flight conversation.
- `shell_run` enforces a timeout (default 45s, configurable per call via `timeoutMs`, bounds 1s..45s) and force-kills timed-out commands. Use `shell_start` for long-running jobs.

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
