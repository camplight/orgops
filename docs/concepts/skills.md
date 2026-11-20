# Skills

A skill is a folder with instructions and optional runnable assets that teaches native
agents how to do something specific. OrgOps uses the `SKILL.md` format (compatible with
OpenCode / OpenClaw style skills).

## Anatomy of a skill

```text
skills/
  my-skill/
    SKILL.md            # required: frontmatter + instructions
    assets/             # optional: scripts the agent runs with shell tools
      run.ts
    event-shapes.ts     # optional: custom event types for this skill
```

`SKILL.md` starts with YAML frontmatter:

```markdown
---
name: my-skill
description: One sentence saying what the skill does and when the agent should use it.
---

# My skill

Step-by-step instructions for the agent. Reference bundled scripts with
`{baseDir}`, for example:

    node --import tsx {baseDir}/assets/run.ts -- --flag value
```

`{baseDir}` is a convention, not a template variable: the runner does not substitute it.
The agent sees the path to each enabled `SKILL.md` in its prompt and resolves `{baseDir}`
to that skill's folder.

The `description` matters most: agents see it in their prompt and decide from it whether
to open the full instructions.

## Enabling skills

In **Agents**, each agent has:

- **Enabled skills**: listed in the prompt; the agent loads them on demand.
- **Always preloaded skills**: the full `SKILL.md` is included in every turn.

After editing skill files, use the agent's **reload skills** action
(`POST /api/agents/:name/reload-skills`).

## Skill roots

Skills are discovered from, in order:

1. the repository `skills/` folder;
2. extra roots from `ORGOPS_SKILL_ROOTS` (comma-separated);
3. per-agent additional skill roots, set by an operator.

Enabled skill directories are added to the agent's allowed filesystem roots so it can
run their assets.

## Built-in skills

| Skill | What it does |
| --- | --- |
| `agent-management` | Create, list and configure agents from other agents, including wrapped agents |
| `browser-use-lightpanda` | Browser automation with Playwright connected to a local Lightpanda CDP endpoint |
| `claude-code` | Run Claude Code as a `WRAPPED` agent with one session per channel |
| `coordination` | Etiquette for multi-agent channels: when to respond, how to delegate |
| `gcli` | Google Cloud CLI (`gcloud`) operations |
| `json-render` | Interactive UI blocks in chat: forms, choices, charts, secure secret inputs |
| `secrets` | Set, list and delete secrets without ever reading their values |
| `slack` | Per-agent Slack integration with a Socket Mode listener |
| `speak` | Reply with a spoken voice message (OpenAI text-to-speech) |
| `tavily` | Web search, extraction and crawling with the Tavily CLI |
| `trello-cli` | Trello board, list and card operations |

Browse them on GitHub in
[`skills/`](https://github.com/camplight/orgops/tree/main/skills).
