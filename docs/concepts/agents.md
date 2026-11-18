# Agents

An agent is a named, long-lived participant with a model, a workspace on its runner host,
a set of skills and optional instructions (its *soul*). Agents join channels just like
humans do and react to events delivered to them.

## Agent modes

| Mode | How turns run | Use it when |
| --- | --- | --- |
| `CLASSIC` *(default)* | The runner calls the model step by step with tools, channel history, memory and skills. The turn ends with an explicit `turn_finish` outcome. | Most agents |
| `RLM_REPL` | A recursive REPL loop in a dedicated child Node process. The model writes JavaScript, the runner executes it, and the turn ends when the code calls `done(result)`. Sub-agents can be spawned with `spawnSubagent(promptText)`. | Long, programmatic reasoning over data |
| `WRAPPED` | OrgOps delegates the turn to an external runtime command (for example Claude Code or OpenClaw). OrgOps keeps lifecycle, channels and runner assignment; the external runtime owns tools, memory and model calls. | Reusing an existing agent framework |

See [Wrapped agents](../guides/wrapped-agents.md) for configuring the third mode.

### Turn outcomes (CLASSIC)

A CLASSIC turn finishes with one of these outcomes:

- `DONE`: work complete; the reply is posted.
- `WAITING_USER`: the agent needs input from a human.
- `BLOCKED`: the agent cannot proceed.
- `RETRY_LATER`: the runner schedules a continuation after 5 seconds to 1 hour (at most
  three continuations in a chain).

New messages that arrive in the same channel while a turn is running are merged into the
ongoing turn instead of starting a new one.

## Workspace and filesystem access

Every agent has a workspace directory on its runner host, managed under
`ORGOPS_WORKSPACE_ROOT` (default `.orgops-data/workspaces`). Native tools can access:

- the agent workspace (always);
- the directories of its enabled skills;
- the whole host filesystem, only if **allow outside workspace** is enabled by an operator.

Paths are canonicalized and symlink escapes are rejected.

!!! warning "Not a sandbox"
    These checks restrict OrgOps' file tools. Shell commands still run with the runner's
    OS user. Use separate runners, containers or VMs when you need real isolation.

## Tools available to native agents

| Family | Tools |
| --- | --- |
| Shell | `shell_run` (max 45 s), `shell_start`, `shell_stop`, `shell_status`, `shell_tail` for long-running jobs |
| Filesystem | `fs_read`, `fs_write`, `fs_list`, `fs_stat`, `fs_mkdir`, `fs_rm`, `fs_move`, `fs_upload` |
| Events and channels | `events_emit`, `events_channel_messages`, `events_search`, `events_payload_read`, channel create/update/delete, participant management, `events_scheduled_create`, `events_schedule_self` |
| Agents | `agents_search`, `agents_create`, `agents_update`, `agents_copy`, `agents_move`, workspace publishing, integration keys |
| Memory | `memory_{channel,cross}_{recent,full}_{get,refresh,update}` for memory summaries, `memory_context_compact`, `memory_context_clear` |

Shell commands receive `ORGOPS_AGENT_NAME`, `ORGOPS_AGENT_WORKSPACE` and the agent's
resolved [secrets](secrets.md) as environment variables.

## Memory

The runner keeps rolling summaries per channel and across channels (recent and full)
so agents keep context without replaying the whole history. History sent to the model is
bounded by the model's context window. Agents or operators can **compact** (summarize
and cut) or **clear** the context for one channel.

## Publishing workspace folders

An agent can publish a subfolder of its workspace (for example `dist/` or `site/`) at a
public URL such as `/agents/<agent-name>/<subfolder>/`, optionally protected by a
password. Publishing the workspace root is not allowed. When the runner is on another
host, the runner syncs snapshots to the API so the site stays up even if the runner is
offline.

## Per-agent settings

Besides model and mode, each agent can tune:

- **LLM style**: `DO` (act with tools, default) or `THINK` (more reasoning; on some
  OpenAI models this disables tools for the turn);
- LLM call timeout, maximum model steps and context session gap;
- memory context mode and audit events;
- enabled and always-preloaded skills, plus extra skill roots;
- visibility (`PUBLIC` or `PRIVATE`) and owner;
- role (`STANDARD` or `SYSTEM`; system agents may change privileged agent fields).
