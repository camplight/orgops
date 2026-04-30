---
name: secrets
description: Manage package secrets (write, list keys, delete). Secrets are stored encrypted; agents can set values and list or delete keys but cannot read secret values. Use for API keys and tokens (e.g. OPENAI_API_KEY). Values are injected as env when running skills and LLM.
---
# Package secrets

Manage OrgOps package secrets. Agents can **write** key-value pairs, **list** secret keys (not values), and **delete** keys. Secret values are never returned to the agent; they are only injected as environment variables when the runner executes skills or calls the LLM.

## Secure secret collection in chat

When you need a user to provide a secret, **do not ask them to paste the secret value in plain chat text**.

Instead, return a single HTML component that the UI can render as a secure input form:

```html
<orgops-secret-input package="llm" key="OPENAI_API_KEY" label="Set OpenAI API key" submit-label="Save secret" description="This value is sent directly to the secrets API and is not posted as a chat message."></orgops-secret-input>
```

Rules:

- Return only the component as the full message body (no surrounding markdown/code fences/text).
- Use `package` and `key` when known; users can still edit values in the form before submit.
- Never echo back secret values.
- If this component is available, prefer it over requesting plain-text secrets.

## Usage

All commands require `ORGOPS_RUNNER_TOKEN` and use `ORGOPS_API_URL` (default `http://localhost:8787`).

### Set a secret

```bash
node --import tsx {baseDir}/assets/set.ts -- <package> <key> <value>
```

Example: store OpenAI key for the `llm` package:

```bash
ORGOPS_RUNNER_TOKEN=... node --import tsx {baseDir}/assets/set.ts -- llm OPENAI_API_KEY sk-...
```

### List secret keys

Returns key names only (and package), never values.

```bash
node --import tsx {baseDir}/assets/list-keys.ts -- [package]
```

Examples:

```bash
node --import tsx {baseDir}/assets/list-keys.ts --           # all packages
node --import tsx {baseDir}/assets/list-keys.ts -- llm       # only keys for package "llm"
```

### Delete a secret

```bash
node --import tsx {baseDir}/assets/delete.ts -- <package> <key>
```

Example:

```bash
node --import tsx {baseDir}/assets/delete.ts -- llm OPENAI_API_KEY
```

## Package names

Use a logical package name that matches how the secret is used, e.g. `llm` for `OPENAI_API_KEY`. The runner injects all package secrets as env when running skills and the LLM; the key name is the env var name.
