# OrgOps OpsCLI

`opscli` is a lightweight autonomous maintenance CLI for OrgOps hosts.

- Uses a local terminal chat loop (stdin/stdout)
- Uses a plain tool-calling agent loop (prompt + tools, no VM/REPL code execution)
- Built-in tools include `shell`, `askPassword`, `extractOrgOps`, `getBundledDocs`, and `exitOpscli`
- Session history is context-capped with rolling summarization
- Bundled release executable prebuilds and embeds `ui` + `site` artifacts, then extracts full OrgOps source/docs/skills

## Run

```bash
npm run --workspace @orgops/opscli start
```

## Build standalone executable

```bash
npm run --workspace @orgops/opscli build:release
```

This creates `dist/opscli-*` for the current platform. Release workflow builds all 3 platforms.
The built binary embeds its build timestamp and prints it on startup.
Builds use Node.js SEA (single executable applications) with embedded assets/docs.

## macOS downloaded binary notes

If you download `opscli-macos` from GitHub Releases, remove quarantine once and make it executable:

```bash
xattr -d com.apple.quarantine ./opscli-macos
chmod +x ./opscli-macos
./opscli-macos
```

If Finder still blocks first launch, use right-click -> Open once.

## Bundled setup helpers via tools

- `extractOrgOps(options?)`: extract bundled OrgOps source tree into `./orgops` (current working directory)
- `getBundledDocs()`: return bundled OrgOps docs that also feed the system prompt

Extraction always targets `./orgops` from the current working directory; custom extract paths are intentionally unsupported.
The `extractOrgOps` result includes PM2 startup commands that use env-aware npm scripts, so `orgops/.env` is loaded for API/runner/UI/site on macOS/Linux/Windows.

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

If no API keys are configured, OpsCLI prompts on startup to choose OpenAI, Claude, or OpenRouter and saves the selected key to local `.env`.

During an active autonomous run, press `Ctrl+C` to interrupt the current run and return to the `You>` prompt without exiting OpsCLI.
Press `Ctrl+C` twice quickly to exit OpsCLI immediately.
