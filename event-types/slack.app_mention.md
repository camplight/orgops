---
type: slack.app_mention
---

Slack app mention event.

Routing:

- `channelId` is required. Recommended format: `slack:<teamId>:<channelId>`.

Payload (recommended):

- `teamId`
- `channelId`
- `userId`
- `text`
- `ts`
- `threadTs` (optional)
- `raw` (optional)
