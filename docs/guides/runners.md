# Multi-host runners

An agent runs on the host of the runner it is assigned to. To give agents access to
another machine (a build server, a laptop with a logged-in browser, a GPU box), install
a runner there and assign agents to it.

## How runners identify themselves

- On startup a runner registers with `POST /api/runners/register` and stores its stable
  ID in `.agent-runner-id` (override the path with `ORGOPS_RUNNER_ID_FILE`).
- It keeps a WebSocket open at `/api/runners/:id/ws` for event wakeups and sends
  heartbeats. A runner counts as online for `ORGOPS_RUNNER_ONLINE_THRESHOLD_MS`
  (default 15 s) after its last heartbeat.
- `ORGOPS_RUNNER_NAME` sets the display name shown in the admin UI.

## Add a runner with an invite (recommended)

1. In the admin UI, open **Runners** and create a runner invite. Only the instance owner
   can do this.
2. On the new host, download `opscli` from the
   [latest release](https://github.com/camplight/orgops/releases) and run:

    ```bash
    opscli install --components runner --runner-invite-url "<invite-url>" --register-service --yes
    opscli status --components runner
    ```

3. The runner appears in **Runners**. Assign agents to it in **Agents**.

The **Runners** screen also offers a ready-made prompt you can paste into
`opscli chat` or another coding agent.

## Add a runner manually

Without an invite, pass the API URL and a runner token explicitly:

```bash
opscli install --components runner \
  --runner-api-url "https://orgops.example.com" \
  --runner-token "<token>" \
  --runner-name "build-server"
```

Or run the runner from a source checkout with these variables in `.env`:

```bash
ORGOPS_API_URL=https://orgops.example.com
ORGOPS_RUNNER_TOKEN=<token>
ORGOPS_MASTER_KEY=<same key as the API>
ORGOPS_RUNNER_NAME=build-server
```

```bash
npm run start:runner:env
```

## Scoped and global tokens

| Token | Access |
| --- | --- |
| Global (`ORGOPS_RUNNER_TOKEN` on the API) | Full runner access to all agents |
| Scoped (minted by redeeming an invite) | One runner ID and, for wrapped agent invites, one agent and approved channels |

Scoped wrapped-agent invites can later be promoted to global or allowed to follow new
channels. See [Wrapped agent invites](../WRAPPED_AGENT_INVITES.md).

## Moving agents between runners

Use **Agents → Move** (or the `agents_move` tool) to reassign an agent. Local moves keep
the workspace path and stop the agent's running processes. Removing a runner unassigns
all agents pinned to it.

!!! warning "Isolation"
    Agents run shell commands as the runner's OS user. Run untrusted or experimental
    agents on dedicated runners, containers or VMs.
