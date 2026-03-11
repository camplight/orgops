---
type: integration.command.failed
---

Integration command execution failed.

Routing:

- `channelId` should match the corresponding `integration.command.requested` event context.

Payload (recommended):

- `provider`
- `connection`
- `requestEventId` (original `integration.command.requested` event id)
- `action`
- `error` (human-readable error details)
- `retryable` (optional boolean)
- `details` (optional structured error payload)
