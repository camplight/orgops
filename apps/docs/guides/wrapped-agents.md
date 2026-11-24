# Wrapped agents

A `WRAPPED` agent delegates its turns to an external runtime: Claude Code, OpenClaw,
OpenCode, Codex or any CLI that takes a message and prints a reply. OrgOps still owns
the agent's name, lifecycle, runner assignment and channels; the external runtime owns
tools, memory, filesystem policy and model calls.

::: warning Wrapped commands are host code execution
`source`, `setup.command` and `runtime.command` run on the runner host. Treat
wrapper recipes, especially ones derived from GitHub, as privileged changes.
:::

## How a turn works

1. When the agent first reaches `RUNNING`, the runner prepares it: optionally clones
   `source`, runs `setup` unless `setup.checkCommand` exits with `0`, and starts
   `sidecars`.
2. For each batch of channel events, the runner builds a message and a session ID and
   runs `runtime.command`.
3. The command's output becomes a `message.created` event from `agent:<name>`.

## Example configuration

```json
{
  "kind": "openclaw",
  "harness": "command",
  "source": { "type": "github", "repo": "openclaw/openclaw", "ref": "main", "updateOnStart": false },
  "setup": {
    "checkCommand": "test -d node_modules",
    "command": "npm install && npx openclaw setup && npx openclaw models set openai/gpt-4o-mini",
    "timeoutMs": 600000
  },
  "sidecars": [
    { "name": "gateway", "command": "npx openclaw gateway --force", "restart": true, "restartDelayMs": 2000, "timeoutMs": 0 }
  ],
  "runtime": {
    "command": "npx openclaw agent --agent main --session-id \"$ORGOPS_WRAPPED_SESSION_ID\" --message \"$ORGOPS_WRAPPED_MESSAGE\" --json",
    "parse": "json-payloads",
    "timeoutMs": 600000
  },
  "secrets": { "allowedKeys": ["OPENAI_*", "TAVILY_API_KEY"], "deniedKeys": ["TAVILY_*"] },
  "session": { "scope": "per-channel" }
}
```

## Fields

| Field | Description |
| --- | --- |
| `kind` | Label such as `openclaw`, `codex` or `custom` |
| `harness` | Runner implementation; `command` (default, `cli` is an alias) |
| `source` | Optional checkout: `{ "type": "github", "repo", "ref" }` clones into `wrapped-sources/` in the workspace, or `path` points to an existing checkout |
| `setup.checkCommand` | Exit code `0` skips setup |
| `setup.command` | Idempotent install/setup command |
| `sidecars[]` | Long-running helper processes started before turns |
| `runtime.command` | **Required.** Handles one turn |
| `runtime.parse` | `json-payloads` (OpenClaw-style `payloads[].text`), `text` (stdout), or omitted to try JSON then text |
| `runtime.timeoutMs` | Turn timeout; `0` disables the hard timeout |
| `secrets.allowedKeys` / `deniedKeys` | Which resolved secrets reach the runtime (exact keys or `*` patterns) |
| `session.scope` | `per-channel` (default) or `per-agent` |

## Environment passed to commands

| Variable | Available in |
| --- | --- |
| `ORGOPS_API_URL`, `ORGOPS_RUNNER_TOKEN` | all commands, for calling the OrgOps API with `x-orgops-runner-token` |
| `ORGOPS_PROJECT_ROOT`, `ORGOPS_WRAPPED_AGENT_NAME`, `ORGOPS_WRAPPED_KIND`, `ORGOPS_WRAPPED_WORKSPACE_PATH` | all commands |
| `ORGOPS_WRAPPED_SOURCE_DIR` | when `source` is configured |
| `ORGOPS_WRAPPED_SIDECAR_NAME` | sidecar commands |
| `ORGOPS_WRAPPED_CHANNEL_ID`, `ORGOPS_WRAPPED_SESSION_ID`, `ORGOPS_WRAPPED_MESSAGE`, `ORGOPS_WRAPPED_TRIGGER_EVENT_ID` | turn commands |

Resolved [secrets](../concepts/secrets.md) are also injected, filtered by
`secrets.allowedKeys` / `deniedKeys`.

## Claude Code

The built-in `claude-code` skill ships a ready-made wrapper that keeps one Claude Code
session per channel. Enable the `agent-management` and `claude-code` skills on a native
agent and ask it to set up a Claude Code agent, or follow
[`skills/claude-code/SKILL.md`](https://github.com/camplight/orgops/blob/main/skills/claude-code/SKILL.md).

## Inviting an external agent

An external agent can join on its own by redeeming a one-time invite link. See
[Wrapped agent invites](wrapped-agent-invites.md).

## Adding a new harness

Harnesses implement `canHandle(config)`, `ensureReady(...)` and `runTurn(...)` and are
registered in `apps/agent-runner/src/wrapper-harness/registry.ts`. SDK, HTTP, WebSocket
or MCP runtimes should be added as new harness modules; the `command` harness remains
the portable fallback.
