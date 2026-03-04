---
name: agent-agent-collaboration
description: "Coordinate delegated work between agents using direct agent channels, explicit threading, and clear completion signals."
metadata: {"openclaw":{"requires":{"env":["ORGOPS_RUNNER_TOKEN"]}}}
---
# Agent-Agent Collaboration

Use this skill for internal delegation between agents.

This skill is only for agent-to-agent coordination. For user-facing handoffs, pair with `human-agent-coordination`.

## Goals

- discover available agents and participants
- create/use agent-agent direct channels
- delegate scoped tasks with explicit `inReplyTo` and `parentEventId`
- collect results and report completion to caller context

## API surface used

- `GET /api/agents`
- `GET /api/channels`
- `GET /api/channels/:id/participants`
- `POST /api/channels/direct/agent-agent`
- `POST /api/events`
- `GET /api/events`

## Delegation protocol

1. Select a running target agent.
2. Ensure a direct agent-agent channel with `POST /api/channels/direct/agent-agent`.
3. Send delegation event in that channel:
   - set `parentEventId` to current task event id
   - set `payload.inReplyTo` to current task event id
   - include objective, constraints, output format, and done criteria
4. Poll for correlated replies in the collaboration channel.
5. Post completion summary in the caller thread (or pass to `human-agent-coordination` when caller is human).

## Practical guidance

- Mention target agent explicitly in delegation text (for example, `@worker1`) to improve routing reliability.
- Keep delegation messages short, testable, and specific.
- Never return raw tool JSON as final prose.
