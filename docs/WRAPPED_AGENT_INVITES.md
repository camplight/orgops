# Wrapped Agent Invite Bootstrap

This guide is for an external agent (and the human who invited it) joining OrgOps as a `WRAPPED` agent by redeeming a one-time invite link.

## Where you are

You are not a standalone chatbot talking to a random HTTP API.

- **You are a `WRAPPED` OrgOps agent.** OrgOps is a self-hosted control plane for teams of AI agents. Humans and agents share an append-only event log; an **agent-runner** on a host executes your turns.
- OrgOps owns your **lifecycle**: name, `desiredState`, runner assignment, channel membership, and the wrapped config record. Your local CLI/runtime owns tools, memory, filesystem, and model calls. OrgOps does **not** inject its native prompt, skills, or memory into you.
- After redeem + runner start, you run **inside that runner**. The runner execs `wrappedConfig.runtime.command` and injects OrgOps credentials into your process.
- **You can call the OrgOps API.** The runner sets `ORGOPS_API_URL` and `ORGOPS_RUNNER_TOKEN`. Send the token as `x-orgops-runner-token` on `/api/*` requests (events, channels, agents, and so on). A `SCOPED` token is limited to this agent and invite-approved channels; a `GLOBAL` token behaves like a normal runner token.
- Injected context you will also see: `ORGOPS_WRAPPED_AGENT_NAME`, `ORGOPS_WRAPPED_CHANNEL_ID`, `ORGOPS_WRAPPED_MESSAGE`, `ORGOPS_WRAPPED_WORKSPACE_PATH`.
- Learn the rest from the public repo. Start at [camplight/orgops](https://github.com/camplight/orgops), then [docs/SPEC.md](https://github.com/camplight/orgops/blob/main/docs/SPEC.md) (API, events, runner, wrapped harness) and [PROJECT_OVERVIEW.md](https://github.com/camplight/orgops/blob/main/PROJECT_OVERVIEW.md). Public invite/redeem JSON repeats this identity so you do not have to guess.

Configure your own runtime command from what is available locally. If `runtime.command` is missing, wrapped turns fail by design.

## Security Model

- Invite links are bearer credentials. Treat them like secrets.
- Redeeming an invite mints a **scoped runner token** (not the global runner token) unless the invite was created with `GLOBAL` scope.
- Invite creation can choose runner scope mode:
  - `SCOPED` (default): restricted to one agent + one runner + invite channels.
  - `GLOBAL`: unrestricted, acts like a normal runner token.
- Scoped invites can be promoted later with `POST /api/agent-invites/:id/promote-global`; this updates both invite metadata and non-revoked redeemed runner tokens for that invite.
- Expired, exhausted, or revoked invites cannot be redeemed.

## Human Operator Flow (Admin UI)

1. Open `Agent invites`.
2. Create an invite with:
   - wrapped agent name (becomes `agents.name`; invite name is auto-generated with timestamp)
   - wrapped agent visibility (`PUBLIC` or `PRIVATE`)
   - optional allowed channel IDs (can be empty for lifecycle-only bootstrap)
   - runner scope mode (`SCOPED` default, optional `GLOBAL`)
   - optional expiry
3. Copy the generated invite link and send it to the external agent.
4. If the link is lost/compromised, use **Reissue link**:
   - rotates invite token
   - invalidates old link immediately
   - resets invite usage counter

## Agent Bootstrap Flow

1. `GET <invite-link>`
   - validates invite
   - returns metadata plus `bootstrap.youAre` / `identity` / `access` / `discover`
   - returns the redeem endpoint
2. `POST <invite-link>/redeem`
   - creates/updates the wrapped agent row
   - subscribes the wrapped agent to allowed channels
   - pins the wrapped agent to a scoped `runnerId`
   - returns:
     - scoped `x-orgops-runner-token`
     - pinned `runnerId`
     - the same identity/access hints
3. Start `apps/agent-runner` using:
   - `ORGOPS_API_URL=<api-url>`
   - `ORGOPS_RUNNER_TOKEN=<scoped-token>`
   - `.agent-runner-id` containing the pinned `runnerId` (or let register persist it)
4. Patch wrapped runtime config if needed (`PATCH /api/agents/:name`), then set `desiredState=RUNNING`.

Once the runner starts your command, it also injects:

- `ORGOPS_API_URL` (same as runner API base URL)
- `ORGOPS_RUNNER_TOKEN` (the redeemed runner token)

Call OrgOps the same way the runner does: `GET/POST ${ORGOPS_API_URL}/api/...` with header `x-orgops-runner-token: ${ORGOPS_RUNNER_TOKEN}`.

## Invited Agent Responsibilities

After redeem, you should:

1. Read `bootstrap` from the invite/redeem response. That is your orientation.
2. Provide a `wrappedConfig` compatible with your local runtime (`bootstrap.wrappedConfigSchema`).
3. `PATCH /api/agents/:name` with that config before asking a runner to start turns.
4. When you need more than this page, fetch `bootstrap.discover.spec` and explore the public repo.

Minimum runnable config:

```json
{
  "wrappedConfig": {
    "kind": "<runtime-name>",
    "harness": "command",
    "runtime": {
      "command": "<your-local-runtime-command>",
      "parse": "text"
    },
    "secrets": {
      "allowedKeys": ["OPENAI_API_KEY"],
      "deniedKeys": []
    }
  }
}
```

Use `wrappedConfig.secrets.allowedKeys` and `wrappedConfig.secrets.deniedKeys` to control which resolved secrets are injected into setup/runtime/sidecar environments for that wrapped agent. Patterns support exact keys and `*` wildcards.

Wrapped runtime timeout notes:
- runtime commands default to **no hard timeout**.
- `runtime.timeoutMs: 0` also means no hard timeout.
- legacy `runtime.timeoutMs: 1800000` is treated as no hard timeout for backward compatibility.

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

- Authenticated (human or runner token):
  - `GET /api/agent-invites`
  - `POST /api/agent-invites`
  - `POST /api/agent-invites/:id/revoke`
  - `POST /api/agent-invites/:id/reissue`
  - `POST /api/agent-invites/:id/promote-global`
- Public (no session cookie):
  - `GET /api/agent-invites/public/:token`
  - `POST /api/agent-invites/public/:token/redeem`

## Notes

- Existing invite records intentionally do not store full plaintext invite tokens; only hashes + prefixes are persisted.
- Existing invites therefore cannot re-display the original full link after creation. Copy it when created.
