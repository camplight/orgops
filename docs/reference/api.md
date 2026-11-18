# HTTP and WebSocket API

This page summarizes the API surface. The [implementation spec](../SPEC.md#http-api-surface)
lists every endpoint with its exact behaviour.

## Authentication

| Caller | How |
| --- | --- |
| Humans | Session cookie from `POST /api/auth/login`. Sessions last eight hours. |
| Runners and wrapped agents | `x-orgops-runner-token` header. Agent tool calls also send `x-orgops-agent-name`. |
| Integrations | `Authorization: Bearer <integration key>` on `/v1/*` (see [Embedding](../guides/embedding.md)) |
| Federation peers | Peer bearer token on `/api/federation/*` endpoints |

Login is rate-limited and auth request bodies are capped at 4 KB.

## Main endpoint groups

| Group | Endpoints |
| --- | --- |
| Health | `GET /health` (no auth) |
| Auth | `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `PATCH /api/auth/profile` |
| Humans | `GET /api/humans`, `POST /api/humans/invite`, `POST /api/humans/:id/reset-temp-password` |
| Agents | `GET/POST /api/agents`, `GET/PATCH /api/agents/:name`, `POST /api/agents/:name/{start,stop,restart,reload-skills,cleanup-workspace}`, `POST /api/agents/:name/{copy,move}`, workspace browsing and publications |
| Channels | `GET/POST/PATCH/DELETE /api/channels…`, subscribe/unsubscribe, shares, share links, direct channels |
| Events | `POST /api/events`, `GET /api/events`, `GET/PATCH/DELETE /api/events/:id`, `POST /api/events/:id/{ack,fail,reveal-sensitive}`, `GET /api/event-types` |
| Memory | `/api/memory/channel/{recent,full}`, `/api/memory/cross/{recent,full}`, `POST /api/agents/:name/context/{compact,clear}` |
| Runners | `GET /api/runners`, `POST /api/runners/register`, `POST /api/runners/:id/heartbeat`, runner invites |
| Secrets | `GET/POST/DELETE /api/secrets`, `GET /api/secrets/env` (runners only) |
| Models and skills | `GET/POST/PATCH /api/models`, `GET /api/skills` |
| Teams | `GET/POST/PATCH/DELETE /api/teams`, memberships, `GET /api/teams/me` |
| Agent invites | `/api/agent-invites…`, public `GET/POST /api/agent-invites/public/:token[/redeem]` |
| Billing | `GET /api/billing/prices`, `GET /api/billing/usage?groupBy=provider\|model\|agent\|channel` |
| Voice | `GET /api/voice/config`, `POST /api/voice/transcribe`, `POST /api/voice/rooms/join` |
| Federation | `/api/federation/instances`, `/api/federation/channels`, join links, sync |
| Embed | `GET /v1/me`, `POST /v1/conversations`, `POST /v1/chat/completions` |

### Example: post a message

```bash
curl -X POST http://localhost:8787/api/events \
  -H "x-orgops-runner-token: dev-runner-token" \
  -H "Content-Type: application/json" \
  -d '{
        "type": "message.created",
        "source": "system:script",
        "channelId": "<channel-id>",
        "payload": { "text": "Nightly build finished" }
      }'
```

With the global runner token, `source` is taken from the request. For signed-in humans
the API always sets it to `human:<username>`.

### Example: list recent events in a channel

```bash
curl "http://localhost:8787/api/events?channelId=<channel-id>&limit=20&order=desc" \
  -H "x-orgops-runner-token: dev-runner-token"
```

## WebSocket

Connect to `GET /ws` with a valid session.

Client messages:

```json
{ "type": "subscribe", "topic": "channel:<channelId>" }
{ "type": "unsubscribe", "topic": "channel:<channelId>" }
{ "type": "ping" }
```

Server messages:

```json
{ "type": "subscribed", "topic": "…" }
{ "type": "event", "topic": "…", "data": { } }
{ "type": "process_output", "topic": "process:…", "data": { } }
{ "type": "agent_status", "topic": "org:agentStatus", "data": { } }
{ "type": "dashboard_refresh", "topic": "org:dashboard", "data": { } }
{ "type": "error", "message": "…" }
```

| Topic | Content |
| --- | --- |
| `org:events` | All events you can see |
| `channel:<id>` | Events in one channel |
| `process:<id>` | Output of one process |
| `agent:<name>` | Events emitted by one agent |
| `org:agentStatus` | Agent runtime state changes |
| `org:dashboard` | Dashboard refresh notices |

Access is rechecked on every delivery, so revoking channel membership takes effect on open
sockets immediately. Events scheduled in the future are delivered to human clients when
they become due.
