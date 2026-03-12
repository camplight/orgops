---
type: audit.secret.accessed
---

Secrets were accessed for runtime injection without exposing plaintext.

Routing:

- `channelId` is optional; when access is tied to handling a channel event, it should be set.

Payload:

- `scopeType`
- `count` (number of resolved secrets)
