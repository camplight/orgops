---
type: message.created
---

Human or agent message created.

Routing:

- `channelId` is required. Direct messages are regular channels with two participants.

Payload:

- `text`
- `inReplyTo` (optional; event id this message replies to)
- `eventType` (optional; source event type the message responds to)
