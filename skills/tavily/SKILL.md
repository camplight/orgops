# tavily
---
name: tavily
description: "Install and use Tavily CLI (tvly) for web search/extract/crawl. Uses secret/env TAVILY_API_KEY."
---

# Tavily skill

This skill provides a **portable** way to ensure the Tavily CLI (`tvly`) is installed on the current runner host and to run common Tavily commands.

## Secrets / auth

- Store the API key in OrgOps secrets under package `tavily` with key `TAVILY_API_KEY`.
- The runner injects secrets as environment variables for tool execution.

Recommended:

```bash
node --import tsx skills/secrets/assets/set.ts -- tavily TAVILY_API_KEY <value>
```

The scripts in this skill will:
- Prefer `TAVILY_API_KEY` from environment.
- Optionally accept `--api-key` to pass explicitly (useful for local testing).

## Install / ensure tvly

Use the installer recommended by Tavily docs:

```bash
curl -fsSL https://cli.tavily.com/install.sh | bash
```

Notes:
- On macOS, `tvly` is typically installed under:
  - `~/Library/Python/<pyver>/bin/tvly`
- The scripts in this skill automatically add common user-level Python bin dirs to `PATH` for the subprocess.

## Scripts

### Ensure installed

```bash
node --import tsx skills/tavily/assets/ensure.ts
```

### Search

```bash
node --import tsx skills/tavily/assets/search.ts -- --query "Cursor agent headless CLI" --max-results 5 --depth advanced --json
```

### Extract

```bash
node --import tsx skills/tavily/assets/extract.ts -- --url "https://example.com" --json
```

### Crawl

```bash
node --import tsx skills/tavily/assets/crawl.ts -- --url "https://example.com" --max-depth 2 --json
```

## Output conventions

- By default, scripts print human-readable output.
- With `--json`, scripts print JSON to stdout (best for piping into other tools/agents).
