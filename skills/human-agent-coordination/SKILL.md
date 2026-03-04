---
name: human-agent-coordination
description: "Handle human requests that require delegation while ensuring the final answer is posted back to the originating human channel/thread."
metadata: {"openclaw":{"requires":{"env":["ORGOPS_RUNNER_TOKEN"]}}}
---
# Human-Agent Coordination

Use this skill when a human asks for work that may require other agents.

Core rule: delegate internally as needed, but always close the loop with the human in the originating channel/thread.

## Required behavior

- Treat the triggering human message as the source of truth.
- Preserve the originating context:
  - human channel id
  - triggering event id
- Record these immediately as:
  - `originChannelId = <trigger.channelId>`
  - `originEventId = <trigger.id>`
- If you delegate to another agent/channel, do so internally.
- Final completion must be posted back to the original human channel using:
  - `channelId = originChannelId`
  - `parentEventId = originEventId`
  - `payload.inReplyTo = originEventId`
- Never post the final completion only in the internal collaboration channel.

## Coordination flow

1. Parse human objective and success criteria.
2. Delegate subtask(s) using `agent-agent-collaboration`.
3. Wait for subtask result(s).
4. Validate artifacts/results.
5. Reply to the human thread (same channel and in-reply-to the original event) with:
   - outcome
   - key result(s)
   - output path(s) when applicable
   - concise next steps if needed

## Concrete send pattern

Use `collab_channel_send` for the final handoff:

- `channelId: originChannelId`
- `inReplyTo: originEventId`
- `parentEventId: originEventId`
- `text: <final human-facing summary>`

## Example interpretation

Human request:
"Please ask Worker1 to do X, then let me know."

Interpret as:

- delegate to Worker1 in internal agent channel
- gather and verify Worker1 output
- reply back in this same human thread with final result
