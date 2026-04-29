---
name: trello-cli
description: "Use Trello CLI in orgops agents for Trello board/list/card operations with non-interactive command patterns."
---

# Trello CLI skill

Use this skill as a lightweight wrapper around the local Trello CLI.

## Scope

- Use Trello CLI commands for Trello board/list/card operations.
- Prefer non-interactive commands and structured output when available.
- Start with read operations, then run mutations only when requested.

## Secrets / auth

Store Trello API credentials under the `trello` package using the `secrets` skill:

- `TRELLO_API_KEY`
- `TRELLO_TOKEN`

Example:

```bash
node --import tsx skills/secrets/assets/set.ts -- trello TRELLO_API_KEY <value>
node --import tsx skills/secrets/assets/set.ts -- trello TRELLO_TOKEN <value>
```

The runner injects secrets as environment variables, and this skill's scripts use those env vars automatically.

## Ensure runtime

Run this first:

```bash
node --import tsx skills/trello-cli/assets/ensure.ts
```

What it checks:

- `npx` is available
- Trello CLI can be executed (`@trello-cli/cli`)
- auth env visibility (`TRELLO_API_KEY` and `TRELLO_TOKEN`)

## Run Trello CLI commands

Use the wrapper script:

```bash
node --import tsx skills/trello-cli/assets/run.ts -- --help
```

Examples:

```bash
node --import tsx skills/trello-cli/assets/run.ts -- boards
node --import tsx skills/trello-cli/assets/run.ts -- cards --help
```

If your command supports JSON output, pass its JSON flag so downstream agents can parse results deterministically.

## Execution rules

- Always run `skills/trello-cli/assets/ensure.ts` before real work.
- Prefer explicit IDs (board/list/card IDs) over fuzzy names when possible.
- Keep commands non-interactive for reproducible agent behavior.
- Never print raw credentials in logs or responses.

## Failure handling

- If Trello CLI cannot be executed, return the exact error and stop.
- If credentials are missing, ask for `TRELLO_API_KEY` and `TRELLO_TOKEN` setup.
- If Trello API returns permission errors, report required access and stop.
