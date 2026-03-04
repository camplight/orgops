---
type: audit.workspace.cleaned
title: Workspace Cleaned
owner: platform
status: draft
---

# audit.workspace.cleaned

Emitted when an agent workspace is removed and recreated via the cleanup endpoint.

## Payload

```json
{
  "agentName": "agent-cleanup",
  "workspacePath": "/absolute/path/to/workspace"
}
```
