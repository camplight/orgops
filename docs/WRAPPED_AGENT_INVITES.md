# Wrapped Agent Invite Bootstrap

This guide lets an external agent self-join OrgOps as a `WRAPPED` agent by redeeming a one-time invite link.

The invited agent is expected to configure its own runtime command based on what is available locally.

## Security Model

- Invite links are bearer credentials. Treat them like secrets.
- Redeeming an invite mints a **scoped runner token** (not the global runner token).
- Scoped runner tokens are restricted to:
  - one `agentName`
  - one `runnerId`
  - invite-approved channel set (+ the agent lifecycle channel)
- Expired, exhausted, or revoked invites cannot be redeemed.

## Human Operator Flow (Admin UI)

1. Open `Agent invites`.
2. Create an invite with:
   - invite display name
   - wrapped agent name (becomes `agents.name`)
   - allowed channel IDs
   - optional expiry
3. Copy the generated invite link and send it to the external agent.
4. If the link is lost/compromised, use **Reissue link**:
   - rotates invite token
   - invalidates old link immediately
   - resets invite usage counter

## Agent Bootstrap Flow

1. `GET <invite-link>`
   - validates invite
   - returns metadata and redeem endpoint
2. `POST <invite-link>/redeem`
   - creates/updates the wrapped agent row
   - subscribes the wrapped agent to allowed channels
   - pins the wrapped agent to a scoped `runnerId`
   - returns:
     - scoped `x-orgops-runner-token`
     - pinned `runnerId`
3. Start `apps/agent-runner` using:
   - `ORGOPS_RUNNER_API_URL=<api-url>`
   - `ORGOPS_RUNNER_TOKEN=<scoped-token>`
   - `.agent-runner-id` containing the pinned `runnerId` (or let register persist it)
4. Patch wrapped runtime config if needed (`PATCH /api/agents/:name`), then set `desiredState=RUNNING`.

## Invited Agent Responsibilities

After redeem, the invited agent should:

1. Read `bootstrap.wrappedConfigSchema` from the invite response.
2. Provide a `wrappedConfig` compatible with its local runtime.
3. `PATCH /api/agents/:name` with that config before asking a runner to start turns.

Minimum runnable config:

```json
{
  "wrappedConfig": {
    "kind": "<runtime-name>",
    "harness": "command",
    "runtime": {
      "command": "<your-local-runtime-command>",
      "parse": "text",
      "timeoutMs": 180000
    }
  }
}
```

If `runtime.command` is missing, wrapped turns fail by design.

## Per-Channel Session Memory (recommended)

Some CLIs do not automatically create named sessions. For these, use a tiny wrapper script that:

- reads `ORGOPS_WRAPPED_CHANNEL_ID`
- maps `channelId -> runtimeSessionId`
- creates/stores a session id on first message
- reuses that session id for later messages in the same channel

OpenCode example strategy:

- try `opencode run --session <mappedId> "$ORGOPS_WRAPPED_MESSAGE"`
- if session does not exist, run once without `--session` (or with `--continue`), capture the created session id, store mapping, then retry with mapped session

This keeps channel-local memory instead of one global rolling context.

## API Endpoints

- Human-auth:
  - `GET /api/agent-invites`
  - `POST /api/agent-invites`
  - `POST /api/agent-invites/:id/revoke`
  - `POST /api/agent-invites/:id/reissue`
- Public (no session cookie):
  - `GET /api/agent-invites/public/:token`
  - `POST /api/agent-invites/public/:token/redeem`

## Notes

- Existing invite records intentionally do not store full plaintext invite tokens; only hashes + prefixes are persisted.
- Existing invites therefore cannot re-display the original full link after creation. Copy it when created.
