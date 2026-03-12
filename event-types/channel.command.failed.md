---
type: channel.command.failed
---

Channel command execution failed.

Routing:

- `channelId` should match the corresponding `channel.command.requested` event context.

Payload (recommended):

- `channel` object:
  - `provider`
  - `connection`
- `requestEventId` (original `channel.command.requested` event id)
- `command` object:
  - `action`
- `error` (human-readable error details)
- `retryable` (optional boolean)
- `details` (optional structured error payload)
