---
type: channel.command.requested
---

Generic command request to perform an outbound action on an external channel provider.

Routing:

- `channelId` is required and should match the OrgOps channel where command/result tracking happens.

Payload (recommended):

- `channel` object:
  - `provider` (for example `slack`, `discord`, `telegram`, `trello`, `gdrive`)
  - `connection` (optional connector identity; when omitted, connector may infer)
  - `workspaceId` (optional)
  - `spaceId` (required for most providers)
  - `threadId` (optional)
  - `messageId` (optional)
- `command` object:
  - `action` (for example `post_message`, `create_comment`, `share_file`)
  - `payload` object with action-specific arguments
- `idempotencyKey` (optional but recommended)
