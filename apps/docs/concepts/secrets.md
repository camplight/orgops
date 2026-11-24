# Secrets

Secrets hold API keys, tokens and other credentials. They are encrypted at rest with
`ORGOPS_MASTER_KEY` (32 bytes, base64) and injected into agent processes as environment
variables. Agents can write, list and delete secrets, but **cannot read secret values**.

::: danger Keep `ORGOPS_MASTER_KEY` safe
Losing the master key makes stored secrets unrecoverable. Never use the example key
from `.env.example` on a real instance.
:::

## Scopes

| Scope | Scope ID | Visible to |
| --- | --- | --- |
| `private` | agent name | one agent |
| `human` | human ID | agents owned by that human, when *owner-secret delegation* is enabled on the agent |
| `team` | team ID | agents working in a channel of that team |
| `public` | — | every agent |

When the same key exists in several scopes, the most specific wins:

```text
private > human > team > public > package (legacy, read-only)
```

::: info Provider keys come from secrets
For native and wrapped agents, provider keys such as `OPENAI_API_KEY` are taken from
resolved secrets and do **not** fall back to the runner's environment. Store them
as secrets (usually `public`).
:::

## Collecting secrets in chat

Agents can ask a human for a credential without it ever appearing in the chat log. They
do it with a secure input form, either the `<orgops-secret-input>` block or the
`json-render` `SecretInput` element. The value is stored directly as a `private`
secret for the agent that asked.

## Wrapped agents

For `WRAPPED` agents, `wrappedConfig.secrets.allowedKeys` and `deniedKeys` (exact keys
or `*` wildcards) limit which resolved secrets reach the external runtime.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/secrets` | List secret keys and scopes (no values) |
| `POST /api/secrets` | Create or update a secret |
| `DELETE /api/secrets/:id` | Delete by ID |
| `DELETE /api/secrets` | Delete by key and scope |
| `GET /api/secrets/env` | Runner-only: resolved environment for an agent |
