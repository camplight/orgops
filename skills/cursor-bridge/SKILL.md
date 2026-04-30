---
name: cursor-bridge
description: "Thin CLI bridge to Cursor via official @cursor/sdk (prompt -> streamed stdout)"
---

# cursor-bridge

CLI-first v1: prompt in → streamed response to stdout → exit.

## Auth

Requires env var `CURSOR_API_KEY` (OrgOps secret package `cursor`, key `CURSOR_API_KEY`).

## Run

From repo root (`/Users/outbounder/projects/camplight/orgops`):

```bash
node --import tsx skills/cursor-bridge/assets/bridge.ts --prompt "Say hello from Cursor"
```

Optional flags:

```bash
node --import tsx skills/cursor-bridge/assets/bridge.ts \
  --prompt "Summarize what this repository does" \
  --model composer-2 \
  --cwd .
```

Exit codes:
- 0 success
- 3 missing `CURSOR_API_KEY`
- 4 cannot import `@cursor/sdk`
- 6 Cursor request failed / run failed
- 7 run cancelled
