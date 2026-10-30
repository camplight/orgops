---
name: claude-code
description: Run Claude Code (Anthropic's claude CLI) as an OrgOps WRAPPED agent with one Claude Code session per channel. Use when asked to set up, provision, connect or troubleshoot a Claude Code agent, a Claude subscription token (claude setup-token, CLAUDE_CODE_OAUTH_TOKEN), or a Claude Code turn that fails, forgets the conversation or keeps running after a timeout.
---
# Claude Code wrapped agent

Claude Code runs as a WRAPPED agent through the generic `command` harness. The glue is `assets/claude-code.mjs` in this skill: every turn it resumes the channel's Claude Code session (creating it on the first turn), runs `claude -p` with permission prompts bypassed, and prints Claude Code's final answer as the reply.

Use the shipped glue as is. Do not write a per-agent bridge script or copy it into a workspace.

## Prepare the runner

The agent runs on its assigned runner as the runner's OS user. `agents_create` assigns your own runner unless you pass `assignedRunnerId`; pass it when Claude Code must run on another machine.

- Install Claude Code once on that machine, for that user: `npm install -g @anthropic-ai/claude-code`. Check with `shell_run` (`claude --version`). If the runner is a service whose PATH misses the install, set `CLAUDE_CODE_BIN` in `runtime.env` to the absolute path from `command -v claude`.
- Credential, one of:
  - A subscription token: a human runs `claude setup-token` (it opens a browser) and stores the printed token as described below. Prefer this on servers and service-managed runners.
  - The machine's own login: when the runner's user has signed in with `claude`, no secret is needed.

## Create the agent

Example `agents_create` arguments:

```json
{
  "name": "ClaudeCoder",
  "mode": "WRAPPED",
  "wrappedConfig": {
    "kind": "claude-code",
    "harness": "command",
    "session": { "scope": "per-channel" },
    "secrets": { "deniedKeys": ["ANTHROPIC_API_KEY"] },
    "runtime": {
      "command": "exec node \"$ORGOPS_PROJECT_ROOT/skills/claude-code/assets/claude-code.mjs\"",
      "parse": "text"
    }
  },
  "joinCurrentChannel": true
}
```

- Keep `exec`, so a timeout's SIGTERM reaches the glue and stops Claude Code.
- Use `per-channel`. With `per-agent`, two channels can resume the same session at once.
- Leave out `workspacePath` and `modelId`; they default correctly. Claude Code works in the agent workspace; put standing instructions in `CLAUDE.md` there, since WRAPPED agents ignore `soulContents`.
- `deniedKeys` keeps a shared `ANTHROPIC_API_KEY` secret from moving Claude Code to API billing. Every other secret the agent can see (for example `GH_TOKEN`) reaches Claude Code and its commands as environment variables.
- Claude Code runs with permission prompts bypassed and receives `ORGOPS_RUNNER_TOKEN`: treat the agent as having the runner's API access.
- `runtime.args` reaches `claude` through the shell unquoted: use single words only, such as `["--model", "sonnet"]`. Do not pass session, `-p` or output-format flags; the glue owns them.
- If `agents_create` is refused, ask an instance operator: wrapped runtime configuration runs host commands.
- If this skill is installed in an `ORGOPS_SKILL_ROOTS` root, use that path instead of `$ORGOPS_PROJECT_ROOT/skills`.

## Store the token

Ask the human to add it under Secrets in the admin UI: name `CLAUDE_CODE_OAUTH_TOKEN`, scope private, scope id the agent's name. Never ask for the token in chat. Secrets are read every turn, so storing or rotating it needs no restart.

## Verify

1. In a channel with the agent, send "Say hello." Then "What was my previous message?" It answers "Say hello.".
2. Ask the same in another channel: it does not know the first channel's conversation.
3. "Run `id -un` and `pwd`." It runs without prompting, as the runner's user, in the agent workspace.

## Troubleshooting

| Turn failure (`wrapper.turn.failed`) | Fix |
| --- | --- |
| `Could not start Claude Code` | Install `claude` for the runner's user, or set `CLAUDE_CODE_BIN`. |
| `Not logged in` or `Invalid API key` | Store `CLAUDE_CODE_OAUTH_TOKEN`, or sign in on the runner machine. |
| `cannot be used with root/sudo privileges` | `runtime.command` does not run the shipped glue. |
| A timed-out turn keeps running | `exec` is missing from `runtime.command`. |
| The agent forgot earlier turns | Sessions are stored for the runner's user and keyed by agent name and channel. Moving the agent to another runner, changing its workspace or renaming it starts new sessions; a rename also needs the token stored under the new name. |
