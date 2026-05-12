---
name: agent-management
description: Create, list, and configure OrgOps agents from native agents. Use when the user asks an agent to create agents, list agents, set up WRAPPED agents, OpenClaw wrappers, sidecars, or Cursor coding harnesses.
---

# Agent Management

Use the native runner tools for agent operations:

- `agents_search`: list or filter existing agents.
- `agents_create`: create `CLASSIC`, `RLM_REPL`, or `WRAPPED` agents.
- `events_channel_participant_add` or `events_channel_join`: add an agent to a channel when it should receive channel events.

## List Agents

Call `agents_search` first when you need to inspect existing agents, avoid duplicate names, or find runner assignments.

Example:

```json
{
  "nameContains": "coordinator",
  "limit": 20
}
```

## Create Native Agents

For a normal OrgOps-managed LLM agent, use `mode: "CLASSIC"` or omit `mode`. Pick a concrete `modelId`, set a workspace, and enable any required skills.

Example:

```json
{
  "name": "ResearchAgent",
  "mode": "CLASSIC",
  "modelId": "openai:gpt-4o-mini",
  "workspacePath": ".orgops-data/workspaces/ResearchAgent",
  "enabledSkills": ["tavily"],
  "alwaysPreloadedSkills": ["tavily"],
  "joinCurrentChannel": true
}
```

## Create Wrapped Agents

For a wrapped agent, set:

- `mode: "WRAPPED"`
- `modelId: "wrapped:none"` if you provide it explicitly
- `memoryContextMode: "OFF"` or omit it; OrgOps forces wrapped agents to memory OFF
- `enabledSkills: []` and `alwaysPreloadedSkills: []`
- a `wrappedConfig` object with `kind`, `harness`, optional `setup`, optional `sidecars`, and `runtime`

Wrapped agents do not use OrgOps model calls, prompts, memory, skills, or `allowOutsideWorkspace` for turns. The external runtime owns its session, tools, memory, prompt behavior, and filesystem policy through its own settings.

## OpenClaw With Gateway Sidecar

Use OpenClaw when the wrapped runtime is an OpenClaw agent. The OpenClaw sidecar should be the OpenClaw Gateway; OrgOps starts it before turns and the runtime command sends each turn through that gateway.

Example `agents_create` arguments:

```json
{
  "name": "OrgOpsCoordinator",
  "mode": "WRAPPED",
  "workspacePath": ".orgops-data/workspaces/OrgOpsCoordinator",
  "wrappedConfig": {
    "kind": "openclaw",
    "harness": "command",
    "session": { "scope": "per-channel" },
    "setup": {
      "command": "npm install",
      "cwd": ".orgops-data/workspaces/OrgOpsCoordinator/wrapper",
      "timeoutMs": 120000
    },
    "sidecars": [
      {
        "name": "gateway",
        "command": "npx openclaw gateway --force",
        "cwd": ".orgops-data/workspaces/OrgOpsCoordinator/wrapper",
        "restart": true,
        "restartDelayMs": 2000,
        "timeoutMs": 0
      }
    ],
    "runtime": {
      "command": "npx openclaw agent --agent coordinator --session-id \"$ORGOPS_WRAPPED_SESSION_ID\" --message \"$ORGOPS_WRAPPED_MESSAGE\" --json",
      "cwd": ".orgops-data/workspaces/OrgOpsCoordinator/wrapper",
      "parse": "json-payloads",
      "timeoutMs": 600000
    }
  },
  "joinCurrentChannel": true
}
```

OpenClaw setup notes:

- Store wrapper source in the agent workspace or configure `source` if it comes from a repo.
- Put secrets in OrgOps package secrets, not in `wrappedConfig`; setup, sidecars, and runtime receive package secrets as env.
- Use `ORGOPS_WRAPPED_SESSION_ID` to keep OpenClaw state stable per channel or per agent.
- Configure OpenClaw's gateway, agents, model allowlist, channel bridges, sandbox, and filesystem policy in OpenClaw itself.
- Keep the gateway sidecar idempotent and restartable.

## Cursor Coding Harness

Use Cursor wrapped mode when the agent should delegate coding work to Cursor tooling rather than the OrgOps LLM loop. Treat it as a high-power coding harness: give it an isolated workspace, a narrow prompt/message bridge, and a long turn timeout.

Example `agents_create` arguments:

```json
{
  "name": "CursorCoder",
  "mode": "WRAPPED",
  "workspacePath": ".orgops-data/workspaces/CursorCoder",
  "wrappedConfig": {
    "kind": "cursor",
    "harness": "command",
    "session": { "scope": "per-agent" },
    "runtime": {
      "command": "cursor-agent -p \"$ORGOPS_WRAPPED_MESSAGE\" --output-format text",
      "cwd": ".",
      "parse": "text",
      "timeoutMs": 1800000
    }
  }
}
```

Cursor setup notes:

- Configure `CURSOR_API_KEY` as an OrgOps secret in package `cursor`.
- Configure Cursor's filesystem and permission policy in the Cursor harness settings; OrgOps `allowOutsideWorkspace` does not apply to wrapped agents.
- Prefer `session.scope: "per-agent"` for coding continuity across channels; use `per-channel` when channel isolation matters.
- Ask before creating or modifying repositories outside the configured workspace.
