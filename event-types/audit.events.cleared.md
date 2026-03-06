---
type: audit.events.cleared
title: Events Cleared
owner: platform
status: draft
---

# audit.events.cleared

Emitted whenever events are cleared globally, by filter, or for chat messages in a channel.

## Payload

```json
{
  "scope": "all | filtered | channel_messages",
  "deletedCount": 3,
  "filters": {
    "channelId": "abc123",
    "type": "message.created"
  }
}
```
