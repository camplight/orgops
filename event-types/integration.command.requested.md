---
type: integration.command.requested
---

Provider-agnostic request to perform an outbound integration action.

Routing:

- `channelId` is required and should match the integration context where the action/result should be tracked.

Payload (recommended):

- `provider` (for example `slack`, `discord`, `telegram`, `trello`, `gdrive`)
- `connection` (optional connector identity; when omitted, connector may infer)
- `action` (for example `post_message`, `create_comment`, `share_file`)
- `target` object:
  - `workspaceId` (optional)
  - `spaceId` (required for most providers)
  - `threadId` (optional)
  - `messageId` (optional)
- `payload` object with action-specific arguments
- `idempotencyKey` (optional but recommended)
