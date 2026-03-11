---
name: slack
description: "Slack skill: per-agent Slack app participation (send/reply/DM/history/search) + Socket Mode listener using normal OrgOps message events."
metadata: {"openclaw":{"requires":{"env":["ORGOPS_RUNNER_TOKEN"]}}}
---
# Slack skill

This skill lets OrgOps agents act as **Slack apps** using **per-agent tokens** stored in OrgOps **secrets**.

It provides:

- Slack Web API helpers (post message, reply in thread, open DM, history, search, list channels, user info)
- Slack file helpers (files.info + download to local path)
- A **Socket Mode** listener (one process per agent) that converts Slack events into OrgOps `message.created` events.
- A reverse bridge that forwards OrgOps `message.created` events in Slack integration channels back to Slack with `chat.postMessage`.

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

### Post a message

```bash
bun run skills/slack/assets/post-message.ts -- --agent worker1 --channel C123 --text "hello"
```

### Reply in a thread

```bash
bun run skills/slack/assets/reply.ts -- --agent worker1 --channel C123 --thread-ts 1710000000.000100 --text "reply"
```

### Reply from OrgOps Slack events (recommended)

For inbound `slack.message.created` / `slack.app_mention` events, use this helper so
you can reply directly back to Slack from event fields:

```bash
bun run skills/slack/assets/respond-to-event.ts -- --agent worker1 --orgops-channel-id slack:T123:C456 --event-ts 1710000000.000100 --text "Working on it"
```

Notes:

- `--orgops-channel-id` format is `slack:<teamId>:<channelId>`.
- Use `--thread-ts` when present (or `--event-ts` to reply in thread anchored to the incoming event timestamp).
- If neither `--thread-ts` nor `--event-ts` is provided, this posts a normal channel/DM message.
- When responding to Slack-triggered events, prefer Slack post/reply via this script and return `[NO_REPLY]` so you do not also emit a duplicate OrgOps chat reply.

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

This emits OrgOps `message.created` events via the Events API.

When emitting, the listener auto-ensures an OrgOps integration channel exists and subscribes
the target agent, so incoming Slack events are routable to the runner without manual setup.
Channel metadata includes Slack routing info (`provider/teamId/channelId`, and optional thread/person).

Notes:

- v1 keeps lifecycle management simple: you run this as an explicit sidecar process.
- v2 can integrate with OrgOps process/websocket infra for supervision.
- Listener now acts as a bidirectional bridge:
  - Slack inbound -> OrgOps `message.created` (`source: integration:slack:<agent>`, payload includes `integration.origin=slack`)
  - OrgOps outbound in Slack integration channels -> Slack `chat.postMessage`

Bridge safety:

- Only `message.created` is bridged to Slack.
- Messages that already originated from Slack (`integration.origin=slack` or `source=integration:slack:*`) are skipped to avoid loops.
- Non-message integration-channel events are ignored by the outbound bridge.
