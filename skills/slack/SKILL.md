---
name: slack
description: "Slack skill: per-agent Slack skill + Socket Mode listener server. If you start the Socket Mode listener server, make sure to read the whole skill first. Use for yourself."
---
# Slack skill

This skill lets OrgOps agents act as **Slack apps** using **per-agent tokens** stored in OrgOps **secrets**.

It provides:

- Slack Web API helpers (open DM, history, search, list channels, user info)
- Slack file helpers (files.info + download to local path)
- A **Socket Mode** listener (one process per agent) that converts Slack events into OrgOps `channel.event.created` events.
- Typed event-shape validators (`event-shapes.ts`) consumed by runner/API validation.

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
   - `files:read` (required for file download helpers)
5. Install the app to the workspace to obtain the `xoxb-...` bot token
6. Subscribe to events (Event Subscriptions):
   - `message.channels`, `message.groups`, `message.im`, `message.mpim`
   - `app_mention`

## Scripts

All scripts accept `--agent <agentName>` and use:

- `SLACK_BOT_TOKEN__<agentName>`
- (listener only) `SLACK_APP_TOKEN__<agentName>`

Agent operating rule:

- Prefer `events_*` tools for outbound Slack messaging through bridge channels.
- Use CLI scripts only for capabilities not covered by events (history/search/channels/users/files/DM open).
- For Slack-triggered work, after posting back via events tools, return `[NO_REPLY]` to avoid duplicate OrgOps chat replies.

## Outbound via Events API (bridged channel)

For agent-to-Slack delivery through a bridged OrgOps channel, emit standard `message.created`.

Preferred tool call from agents:

```json
{
  "tool": "events_channel_send",
  "args": {
    "channelId": "<orgops-bridge-channel-id>",
    "text": "hello from OrgOps"
  }
}
```

Reply in a Slack thread (tool call example):

```json
{
  "tool": "events_emit",
  "args": {
    "type": "message.created",
    "channelId": "<orgops-bridge-channel-id>",
    "payload": {
      "text": "Thanks — here are examples.",
      "threadTs": "1710000000.000100"
    }
  }
}
```

Validation notes:

- `type` is `message.created`
- `payload.text` is required and must be non-empty
- optional `payload.threadTs` can be used to target a Slack thread (use `events_emit` for this)
- listener forwards only agent-authored outbound messages (`source` like `agent:<name>`)

The exact typed validators live in `skills/slack/event-shapes.ts` and are dynamically loaded by enabled skills.

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

### Find user (username/display name -> user id)

Requires bot scope: `users:read`

```bash
bun run skills/slack/assets/find-user.ts -- --agent worker1 --username outbounder
```

You can also search by display name:

```bash
bun run skills/slack/assets/find-user.ts -- --agent worker1 --display-name "Outbounder"
```

### File info

Requires bot scope: `files:read`

```bash
bun run skills/slack/assets/file-info.ts -- --agent worker1 --file F0123456789
```

### Fetch file bytes to a local path (no base64)

Requires bot scope: `files:read`

Downloads the file using `files.info` + `url_private_download` and writes it to a local directory.

```bash
bun run skills/slack/assets/fetch-file.ts -- --agent worker1 --file F0123456789
```

By default files are written to:

- `/tmp/orgops-slack-files`

Override output directory:

```bash
bun run skills/slack/assets/fetch-file.ts -- --agent worker1 --file F0123456789 --out-dir ./tmp/slack-files
```

Optionally emit an OrgOps event so other agents can consume the stable path:

```bash
bun run skills/slack/assets/fetch-file.ts -- \
  --agent worker1 \
  --file F0123456789 \
  --orgops-channel-id slack:T123:C456
```

Emitted event:

- `type`: `slack.file.fetched`
- `payload`:
  - `fileId`: string
  - `path`: string (local filesystem path)
  - `mime`: string | null
  - `size`: number
  - `name`: string | null
  - `title`: string | null
  - `url_private_download`: string | null

## Socket Mode listener (event-driven)

Run one listener process per agent:

```bash
bun run skills/slack/assets/socket-listen.ts -- --agent worker1
```

Optional routing granularity:

- `--route-mode channel` (default): one OrgOps channel per Slack team+channel
- `--route-mode thread`: one OrgOps channel per Slack thread
- `--route-mode person`: one OrgOps channel per sender in a Slack channel

This emits OrgOps `channel.event.created` events via the Events API.

When emitting, the listener auto-ensures an OrgOps channel exists and subscribes
the target agent, so incoming Slack events are routable to the runner without manual setup.
Channel metadata includes Slack routing info (`provider/teamId/channelId`, and optional thread/person).

Notes:

- v1 keeps lifecycle management simple: you run this as an explicit sidecar process.
- v2 can integrate with OrgOps process/websocket infra for supervision.
- Listener behavior:
  - Slack inbound -> OrgOps `channel.event.created` (`source: channel:slack:<agent>`)
  - OrgOps outbound `message.created` (agent source in slack bridge channels) -> Slack API `chat.postMessage`
