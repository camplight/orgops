---
type: agent.lifecycle.started
---

Bootstrap lifecycle event emitted when an agent starts running.

Routing:

- Sent by the runner to the agent lifecycle channel: `agent.lifecycle.<agentName>`.
- Targets one agent via `payload.targetAgentName`.

Payload:

- `targetAgentName` (agent name that should handle startup)
- `text` (startup instruction for the agent)
- `startedAt` (unix timestamp in milliseconds)
