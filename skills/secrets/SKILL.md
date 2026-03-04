---
name: secrets
description: Manage package secrets (write, list keys, delete). Secrets are stored encrypted; agents can set values and list or delete keys but cannot read secret values. Use for API keys and tokens (e.g. OPENAI_API_KEY). Values are injected as env when running skills and LLM.
metadata: {"openclaw":{"requires":{"env":["ORGOPS_RUNNER_TOKEN"]}}}
---
# Package secrets

Manage OrgOps package secrets. Agents can **write** key-value pairs, **list** secret keys (not values), and **delete** keys. Secret values are never returned to the agent; they are only injected as environment variables when the runner executes skills or calls the LLM.

## Usage

All commands require `ORGOPS_RUNNER_TOKEN` and use `ORGOPS_API_URL` (default `http://localhost:8787`).

### Set a secret

```bash
bun run {baseDir}/assets/set.ts -- <package> <key> <value>
```

Example: store OpenAI key for the `llm` package:

```bash
ORGOPS_RUNNER_TOKEN=... bun run {baseDir}/assets/set.ts -- llm OPENAI_API_KEY sk-...
```

### List secret keys

Returns key names only (and package), never values.

```bash
bun run {baseDir}/assets/list-keys.ts -- [package]
```

Examples:

```bash
bun run {baseDir}/assets/list-keys.ts --           # all packages
bun run {baseDir}/assets/list-keys.ts -- llm       # only keys for package "llm"
```

### Delete a secret

```bash
bun run {baseDir}/assets/delete.ts -- <package> <key>
```

Example:

```bash
bun run {baseDir}/assets/delete.ts -- llm OPENAI_API_KEY
```

## Package names

Use a logical package name that matches how the secret is used, e.g. `llm` for `OPENAI_API_KEY`. The runner injects all package secrets as env when running skills and the LLM; the key name is the env var name.
