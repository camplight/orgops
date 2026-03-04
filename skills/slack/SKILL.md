---
name: slack
description: Slack skill: per-agent Slack app participation (send/reply/DM/history/search) + Socket Mode listener that emits orgops events.
metadata: {"openclaw":{"requires":{"env":["ORGOPS_RUNNER_TOKEN"]}}}
---
# Slack skill

This skill lets OrgOps agents act as **Slack apps** using **per-agent tokens** stored in OrgOps **secrets**.

It provides:

- Slack Web API helpers (post message, reply in thread, open DM, history, search, list channels, user info)
- A **Socket Mode** listener (one process per agent) that converts Slack events into OrgOps events:
  - `slack.message.created`
  - `slack.app_mention`

## Secrets

Store secrets under the `slack` package using the `secrets` skill.

Per-agent keys (recommended):

- `SLACK_BOT_TOKEN__<AGENT_NAME>` (xoxb-...)
- `SLACK_APP_TOKEN__<AGENT_NAME>` (xapp-...; required for Socket Mode)

Example:

```bash
bun run skills/secrets/assets/set.ts -- slack SLACK_BOT_TOKEN__worker1 xoxb-...
bun run skills/secrets/assets/set.ts -- slack SLACK_APP_TOKEN__worker1 xapp-...
```

## Slack app setup (minimum)

1. Create a Slack App
2. Enable **Socket Mode**
3. Create an **App-Level Token** with scope: `connections:write` (this is the `xapp-...` token)
4. Add **Bot Token Scopes** (typical v1 set):
   - `chat:write`
   - `channels:read`, `groups:read`, `im:read`, `mpim:read`
   - `channels:history`, `groups:history`, `im:history`, `mpim:history`
   - `im:write`
   - `users:read`
   - `search:read`
5. Install the app to the workspace to obtain the `xoxb-...` bot token
6. Subscribe to events (Event Subscriptions):
   - `message.channels`, `message.groups`, `message.im`, `message.mpim`
   - `app_mention`

## Scripts

All scripts accept `--agent <agentName>` and use:

- `SLACK_BOT_TOKEN__<agentName>`
- (listener only) `SLACK_APP_TOKEN__<agentName>`

### Post a message

```bash
bun run skills/slack/assets/post-message.ts -- --agent worker1 --channel C123 --text "hello"
```

### Reply in a thread

```bash
bun run skills/slack/assets/reply.ts -- --agent worker1 --channel C123 --thread-ts 1710000000.000100 --text "reply"
```

### Open a DM

```bash
bun run skills/slack/assets/open-dm.ts -- --agent worker1 --user U123
```

### Fetch history

```bash
bun run skills/slack/assets/history.ts -- --agent worker1 --channel C123 --limit 20
```

### Search messages

```bash
bun run skills/slack/assets/search.ts -- --agent worker1 --query "from:@alice error" --count 20
```

### List channels

```bash
bun run skills/slack/assets/list-channels.ts -- --agent worker1 --types public_channel,private_channel
```

### User info

```bash
bun run skills/slack/assets/user-info.ts -- --agent worker1 --user U123
```

## Socket Mode listener (event-driven)

Run one listener process per agent:

```bash
bun run skills/slack/assets/socket-listen.ts -- --agent worker1
```

This will emit OrgOps events via the Events API:

- `slack.message.created`
- `slack.app_mention`

Notes:

- v1 keeps lifecycle management simple: you run this as an explicit sidecar process.
- v2 can integrate with OrgOps process/websocket infra for supervision.
