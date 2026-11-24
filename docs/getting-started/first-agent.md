# Your first agent

This walkthrough assumes OrgOps is running locally with `npm run dev:all` (see
[Installation](installation.md)) and that you are signed in to the admin UI.

## 1. Store a provider API key as a secret

Native agents read provider keys from **OrgOps secrets**, not from the runner's
environment. Open **Secrets → New secret** and create:

| Field | Value |
| --- | --- |
| Key | `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`…) |
| Scope | `public`: available to every agent |
| Value | your API key |

Secrets are encrypted with `ORGOPS_MASTER_KEY`. See [Secrets](../concepts/secrets.md)
for the other scopes.

## 2. Check that a runner is online

Open **Runners**. The runner started by `dev:all` registers itself on startup and keeps a
stable ID in `.agent-runner-id`. You should see it listed as online.

## 3. Create the agent

Open **Agents → New agent** and fill in:

- **Name**: for example `helper`. Names cannot be changed later.
- **Model**: `provider:model`, for example `openai:gpt-4o-mini` or
  `anthropic:claude-3-5-sonnet-latest`.
- **Mode**: `CLASSIC` (the default). See [Agents](../concepts/agents.md#agent-modes) for
  the other modes.
- **Workspace**: the agent's working directory on the runner host. By default it is
  managed under `.orgops-data/workspaces/`.
- **Runner**: pick the runner from step 2.

!!! important "Assign a runner"
    Runners only execute agents assigned to their own runner ID. An agent with no
    runner assigned never starts, even if you press **Start**.

Optionally fill in **SOUL contents**: free-form instructions that shape the agent's personality
and responsibilities. You can also enable [skills](../concepts/skills.md).

Save the agent and press **Start**.

## 4. Talk to it

Open **Chat** (or the user UI at <http://localhost:5190>), choose a channel the agent
participates in or a direct channel with it, and send a message. The runner picks up
the event, calls the model, executes any tools and posts the reply back to the channel.

To watch what happens under the hood, use **Events Explorer** for the raw event stream
and **Processes** for shell commands the agent started.

## Shortcut: seed a `system` agent

On a **fresh database** (no agents yet), the API can create a public `system` agent for
you. Add to `.env`:

```bash
ORGOPS_SYSTEM_AGENT_MODEL=openai          # or anthropic, openrouter, mistral, liquid, or provider:model
OPENAI_API_KEY=sk-...                     # the key matching the provider
```

On startup the API stores the key as a public secret, registers the model and creates
the agent. The seeded agent is **unassigned**, so you still need to pick a runner for it
in **Agents** before it runs.

## Next steps

- Add more agents and let them [coordinate through channels](../concepts/events.md)
- Run agents on other machines with [multi-host runners](../guides/runners.md)
- Embed an agent in your own product with the [integration API](../guides/embedding.md)
