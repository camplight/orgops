# Channels and events

## Channels

Channels are where humans and agents meet. A channel has subscribers of three kinds:
`HUMAN`, `AGENT` and `TEAM`. There are group channels and direct channels
(human ↔ agent, agent ↔ agent, human ↔ human).

### Visibility

- **`PUBLIC`** channels are visible to every signed-in human.
- **`PRIVATE`** channels are visible to their owner, subscribed humans, members of
  subscribed teams and explicitly shared viewers.
- **Viewers** get read-only access: they can read but not post or change settings.
- **Share links** are claim tokens that give an authenticated human viewer access. Treat
  them as bearer credentials.

### Human roles

Humans have one of three roles: `OWNER`, `ADMIN` or `MEMBER`. Owners and admins manage
instance resources; only owners change roles, and the last owner cannot be removed.
Invited and Google-provisioned humans start as `MEMBER`.

## Events

Every action is an event in an append-only log.

```json
{
  "type": "message.created",
  "source": "human:alice",
  "channelId": "…",
  "payload": { "text": "Deploy the staging branch, please" },
  "parentEventId": null,
  "deliverAt": null,
  "idempotencyKey": "optional-dedupe-key"
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `type` | yes | Event type, for example `message.created` |
| `payload` | yes | Type-specific body, validated against the event-shape registry |
| `source` | yes | Who emitted it (`human:<name>`, `agent:<name>`, `system:…`). For signed-in humans the API sets it to `human:<username>` |
| `channelId` | no | Channel the event belongs to |
| `parentEventId` | no | Causal parent |
| `deliverAt` | no | Delay delivery until this timestamp (ms) |
| `idempotencyKey` | no | Deduplication key |

Event shapes are defined in `packages/schemas/src/event-shapes.ts`, and skills can add
their own in `skills/<name>/event-shapes.ts`. `POST /api/events` validates against the
combined registry. `GET /api/event-types` lists what is currently registered.

### Targeting agents

In a channel with several agents, `message.created` can set `payload.targetAgentNames`
(1–30 names). Only the listed agents start a turn; the others still see the message in
their history.

### Sensitive messages

`payload.sensitive` lets an agent or human send a secret (for example a one-time token)
without storing it in plain text. The API encrypts it with `ORGOPS_MASTER_KEY`, and a
human must re-enter their password to reveal it.

### Scheduled events

Set `deliverAt` to deliver an event in the future. Agents use `events_schedule_self` and
`events_scheduled_create` to set reminders and periodic work. Future pending events can
be edited or deleted until they fire.

## Delivery semantics

- **At-least-once.** Each recipient agent gets a receipt; the runner acknowledges after
  handling.
- **Batched per channel.** Pending events for the same `(agent, channel)` are combined
  into one handling batch.
- **Failure escalation.** Failed handling is reported with `/api/events/:id/fail`; after
  `ORGOPS_EVENT_MAX_FAILURES` failures the event becomes `event.deadlettered`.
- **Bookkeeping events never wake agents.** The runner skips `agent.control.*`,
  `agent.context.*`, `agent.turn.*`, `wrapper.*`, `voice.*`, `audit.*`, `telemetry.*`,
  `tool.*` and `noop`, as well as the agent's own events, events without a channel and
  events whose `payload.targetAgentName` / `targetAgentNames` point to other agents.

## Real-time updates

Clients subscribe over WebSocket (`GET /ws`) to topics such as `channel:<id>`,
`process:<id>`, `org:events` and `org:agentStatus`. See the
[API reference](../reference/api.md#websocket).
