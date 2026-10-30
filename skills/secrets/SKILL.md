---
name: secrets
description: Manage secrets (write, list keys, delete). Secrets are stored encrypted; agents can set values and list or delete keys but cannot read secret values. Chat collection stores a private secret for the current agent. Values are injected as env when running skills and LLM.
---
# Scoped secrets

Manage OrgOps scoped secrets. Agents can **write** key-value pairs, **list** secret keys (not values), and **delete** keys. Secret values are never returned to the agent; they are only injected as environment variables when the runner executes skills or calls the LLM.

## Secure secret collection in chat

When you need a user to provide a secret, **do not ask them to paste the secret value in plain chat text**.

Return a single HTML component. Omit `package`. The UI stores the value as a **private secret for you**, the agent that posted the form. Other agents do not receive it.

```html
<orgops-secret-input key="ATLE_OPENAI_API_KEY" label="Set OpenAI API key for ATLE" submit-label="Save secret" description="Stored only for this agent. The value is sent to the secrets API and is not posted in chat."></orgops-secret-input>
```

Rules:

- Return only the component as the full message body (no surrounding markdown/code fences/text).
- Set `key` to the name you were asked to store.
- Do not set `package`. New package secrets are rejected. The form stores a private secret for this agent.
- Never echo back secret values.
- If this component is available, prefer it over requesting plain-text secrets.

## Usage

All commands require `ORGOPS_RUNNER_TOKEN` and use `ORGOPS_API_URL` (default `http://localhost:8787`).

### Set a secret

By default this stores a private secret for `ORGOPS_AGENT_NAME`. Other agents do not receive it. A legacy `<package> <key> <value>` call does the same: the package name is ignored and the key is stored for this agent.

```bash
node --import tsx {baseDir}/assets/set.ts -- <key> <value>
node --import tsx {baseDir}/assets/set.ts -- --public <key> <value>
node --import tsx {baseDir}/assets/set.ts -- --team <teamId> <key> <value>
```

`--public` stores a secret every agent receives. `--team` stores it for agents in that team on a channel the team belongs to.

Example:

```bash
node --import tsx {baseDir}/assets/set.ts -- OPENAI_API_KEY sk-...
```

### List secret keys

Returns key names only, never values. Default is this agent's private keys.

```bash
node --import tsx {baseDir}/assets/list-keys.ts
node --import tsx {baseDir}/assets/list-keys.ts -- --public
node --import tsx {baseDir}/assets/list-keys.ts -- --team <teamId>
```

### Delete a secret

Default deletes this agent's private secret. A legacy `<package> <key>` call deletes that key for this agent.

```bash
node --import tsx {baseDir}/assets/delete.ts -- <key>
node --import tsx {baseDir}/assets/delete.ts -- --public <key>
node --import tsx {baseDir}/assets/delete.ts -- --team <teamId> <key>
```

## Runtime scopes

Runtime env injection resolves matching keys in this order:

1. `private` (agent-specific; `scopeId=<agentName>`)
2. `human` (the agent's owner, when owner-secret delegation is enabled)
3. `team` (`scopeId=<teamId>` from the active channel context)
4. `public`
5. `package` (legacy rows already stored; new writes are rejected)

A private, human, team, or public secret with the same name overrides a legacy package row. Operators rotate by saving the key in one of those scopes, or by deleting the package row.

For provider credentials (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`), runtime execution uses the resolved scoped secret and does not fall back to host process env.

## Sending sensitive info back to humans

When a response must include sensitive content (passwords, tokens, private keys, reset links), send it as a `message.created` event with `payload.sensitive` instead of plain chat text.

Example payload pattern:

```json
{
  "type": "message.created",
  "channelId": "<channel-id>",
  "source": "agent:<name>",
  "payload": {
    "text": "Sensitive content available. Reveal with password.",
    "sensitive": {
      "plaintext": "TOKEN=...",
      "hint": "Temporary credential for staging"
    }
  }
}
```

Rules:

- Keep `payload.text` as a safe preview only (no secrets).
- Put secret content in `payload.sensitive.plaintext`; API encrypts it before storage.
- Never repeat revealed secret text in later messages unless explicitly requested.
