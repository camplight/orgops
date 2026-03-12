---
type: channel.command.succeeded
---

Channel command execution succeeded.

Routing:

- `channelId` should match the corresponding `channel.command.requested` event context.

Payload (recommended):

- `channel` object:
  - `provider`
  - `connection`
- `requestEventId` (original `channel.command.requested` event id)
- `command` object:
  - `action`
- `target` object with resolved provider identifiers:
  - `spaceId`
  - `threadId` (optional)
  - `messageId` (optional)
- `result` (optional provider response summary)
