---
name: slack
description: "Slack skill: per-agent Slack skill + Socket Mode listener server. Run the server on lifecycle start."
---
# Slack skill

This skill lets OrgOps agents act as **Slack apps** using **per-agent tokens** stored in OrgOps **secrets**.

It provides:

- A **Socket Mode** listener (one process per agent) that converts Slack events into OrgOps `channel.event.created` events.
- Outbound Slack delivery by consuming OrgOps events in bridged channels.
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

- Use `events_*` tools only. Do not use Slack CLI helpers for runtime interaction.
- For Slack-triggered work, after posting back via events tools, return `[NO_REPLY]` to avoid duplicate OrgOps chat replies.

## Outbound via Events API (bridged channel only)

For agent-to-Slack delivery through a bridged OrgOps channel, emit:

- `message.created` for common text replies
- `channel.command.requested` for explicit Slack Web API commands

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

Explicit command example (`channel.command.requested`):

```json
{
  "tool": "events_emit",
  "args": {
    "type": "channel.command.requested",
    "channelId": "<orgops-bridge-channel-id>",
    "payload": {
      "channel": {
        "provider": "slack",
        "connection": "worker1",
        "workspaceId": "T123",
        "spaceId": "C456"
      },
      "command": {
        "action": "chat.postMessage",
        "payload": {
          "text": "hello via command envelope"
        }
      }
    }
  }
}
```

Validation notes:

- `message.created`: requires non-empty `payload.text`; optional `payload.threadTs`
- `channel.command.requested`: requires `payload.channel` + `payload.command.action` and optional `payload.command.payload`
- listener processes agent-authored outbound events only (`source` like `agent:<name>`)

The exact typed validators live in `skills/slack/event-shapes.ts` and are dynamically loaded by enabled skills.

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
  - OrgOps outbound `message.created` and `channel.command.requested` (agent source in slack bridge channels) -> Slack Web API
