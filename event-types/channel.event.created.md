---
type: channel.event.created
---

Generic inbound event created by a channel connector/skill.

Routing:

- `channelId` is required and should map to the channel context in OrgOps.

Payload (recommended):

- `channel` object:
  - `provider` (for example `slack`, `discord`, `telegram`, `trello`, `gdrive`)
  - `connection` (connector identity, usually agent or integration key)
  - `workspaceId` (optional provider workspace/team)
  - `spaceId` (provider channel/chat/board/drive id)
  - `threadId` (optional)
  - `messageId` (optional)
- `event` object:
  - `action` (provider-neutral action label such as `message_created`, `comment_added`, `file_updated`)
- `actor` object (optional external actor identifiers)
- `text` (optional normalized text)
- `data` (provider-specific normalized payload)
- `raw` (optional raw provider payload)
