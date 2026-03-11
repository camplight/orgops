---
type: integration.command.succeeded
---

Integration command execution succeeded.

Routing:

- `channelId` should match the corresponding `integration.command.requested` event context.

Payload (recommended):

- `provider`
- `connection`
- `requestEventId` (original `integration.command.requested` event id)
- `action`
- `target` object with resolved provider identifiers:
  - `spaceId`
  - `threadId` (optional)
  - `messageId` (optional)
- `result` (optional provider response summary)
