---
type: integration.event.inbound
---

Provider-agnostic inbound event from an external integration.

Routing:

- `channelId` is required and should map to the integration context in OrgOps (for example an integration bridge channel).

Payload (recommended):

- `provider` (for example `slack`, `discord`, `telegram`, `trello`, `gdrive`)
- `connection` (connector identity, usually agent or integration key)
- `action` (provider-neutral action label such as `message_created`, `comment_added`, `file_updated`)
- `target` object:
  - `workspaceId` (optional provider workspace/team)
  - `spaceId` (channel/chat/board/drive/etc)
  - `threadId` (optional)
  - `messageId` (optional)
- `actor` object (optional external actor identifiers)
- `text` (optional normalized text)
- `data` (provider-specific normalized payload)
- `raw` (optional raw provider payload)
