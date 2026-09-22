# OrgOps OpsCLI

`opscli` is a deterministic installer/launcher CLI for OrgOps hosts with an optional agentic chat mode.

- Deterministic commands: `install`, `upgrade`, `doctor`, `start`, `stop`, `status`, `admin open`, `admin stop`, `admin status`, `service register`, `service unregister`, `shortcut create`
- Agentic mode: `chat` command only
- `service register`/`service unregister` and `shortcut create` are available as standalone deterministic commands (without install/upgrade)

## Run

`opscli` command surface:

- `opscli install [--dir <path>] [--repo <url>] [--ref <git-ref>] [--components <csv>] [--runner-api-url <url>] [--runner-token <token>] [--runner-name <name>] [--runner-invite-url <url>] [--register-service] [--create-shortcut]`
- `opscli upgrade [--dir <path>] [--repo <url>] [--ref <git-ref>] [--components <csv>] [--runner-api-url <url>] [--runner-token <token>] [--runner-name <name>] [--runner-invite-url <url>] [--no-restart]`
- `opscli doctor`
- `opscli start [--dir <path>] [--components <csv>] [--no-open]`
- `opscli stop [--dir <path>] [--components <csv>]`
- `opscli status [--dir <path>] [--components <csv>]`
- `opscli service register [--dir <path>] [--components <csv>]`
- `opscli service unregister [--dir <path>] [--components <csv>]`
- `opscli shortcut create [--target user-ui|admin-ui] [--url <url>]`
- `opscli admin open [--dir <path>]`
- `opscli admin stop [--dir <path>]`
- `opscli admin status [--dir <path>]`
- `opscli chat [--goal "..."]`

`--components` accepts a comma-separated subset of:

- `api`
- `runner`
- `user-ui`
- `admin-ui`

During `install`, OpsCLI checks required host tools (`node`, `npm`, `git`), clones/updates OrgOps from git, runs `npm ci`, and builds UI assets.
When `runner` is installed/upgraded, OpsCLI can bootstrap config from either:

- `--runner-invite-url <url>` (recommended secure flow from Admin UI runner invite)
- explicit `--runner-api-url` + `--runner-token` (+ optional `--runner-name`)

During `upgrade`, OpsCLI creates a safety backup of `.orgops-data`/`files`/`.env` (if present), updates selected components, and optionally restarts only components that were running before upgrade.

`service register` / `service unregister` operate per component and can target any subset of `api`, `runner`, `user-ui`, `admin-ui`. Without `--components`, OpsCLI defaults to saved service components, then installed components, then the default component set.

## Build standalone executable

```bash
npm run --workspace @orgops/opscli build:release
```

This creates `dist/opscli-*` for the current platform. Release workflow builds all 3 platforms.
The built binary embeds docs + build metadata used by `chat`.

For CI smoke tests that include `install` without mutating host services or relying on internet access, set:

- `ORGOPS_OPSCLI_INSTALL_SMOKE_MOCK=1`
- `ORGOPS_OPSCLI_NO_BROWSER=1`

In this mode, `install` creates deterministic marker files in `--dir` instead of cloning/building/registering services.
The same env var is also honored during `upgrade` (because upgrade reuses install internally), which enables deterministic cross-OS upgrade smoke checks in CI.
`ORGOPS_OPSCLI_NO_BROWSER` skips launching URLs while preserving command behavior, which keeps CI smoke checks headless-friendly.

## Chat mode

```bash
opscli chat
```

`chat` mode is the only command that requires model credentials.

## Environment

- `OPENAI_API_KEY` (used when model provider is `openai`; prompted on startup if missing; saved to local `.env`)
- `ANTHROPIC_API_KEY` (used when model provider is `anthropic`; prompted on startup if missing; saved to local `.env`)
- `OPENROUTER_API_KEY` (used when model provider is `openrouter`; prompted on startup if missing; saved to local `.env`)
- `OPENROUTER_BASE_URL` (optional; default: `https://openrouter.ai/api/v1`)
- `OPENROUTER_HTTP_REFERER` (optional OpenRouter attribution/referrer header value)
- `OPENROUTER_APP_TITLE` (optional OpenRouter `X-Title` header value)
- `ORGOPS_OPSCLI_MODEL` (default: `openai:gpt-5.2`; supports `openai:<model>`, `anthropic:<model>`/`claude:<model>`, and `openrouter:<model>`/`or:<model>`)
- `ORGOPS_OPSCLI_COMMAND_TIMEOUT_MS` (default: `120000`)
- `ORGOPS_OPSCLI_MAX_CONTEXT_CHARS` (default: `100000`)
- `ORGOPS_OPSCLI_MAX_SUMMARY_CHARS` (default: `14000`)
- `ORGOPS_OPSCLI_SUMMARY_CHUNK_MESSAGES` (default: `8`)
- `ORGOPS_OPSCLI_MIN_RECENT_MESSAGES` (default: `12`)
- `ORGOPS_OPSCLI_MAX_SYSTEM_DOC_CHARS` (default: `40000`)
- `ORGOPS_OPSCLI_SPINNER` (default: enabled; set to `0`, `false`, `off`, or `no` to disable thinking/execution spinner)
- `ORGOPS_OPSCLI_PROGRESS` (default: enabled; set to `0`, `false`, `off`, or `no` to disable live step/repl progress events)
- `ORGOPS_OPSCLI_LOG_PATH` (default: `.opscli-output.log` in current working directory; reset on each new session start)
- `ORGOPS_OPSCLI_DOUBLE_SIGINT_MS` (default: `1200`; window for "double Ctrl+C to exit")

If no API keys are configured, `opscli chat` prompts to choose OpenAI, Claude, or OpenRouter and saves the selected key to local `.env`.

During an active autonomous run, press `Ctrl+C` to interrupt the current run and return to the `You>` prompt without exiting OpsCLI.
Press `Ctrl+C` twice quickly to exit OpsCLI immediately.
