# Skills Ecosystem Gap Report

Date: 2026-03-11  
Repository: `orgops`

## Scope

This report compares OrgOps skills with:

1. **Claude Code skills** (primary request in this pass)
2. **ClawHub/OpenClaw skills** (included to preserve all prior findings)

The goal is to identify implementation gaps between ecosystem expectations and current OrgOps behavior.

## Source references

- Claude Code skills docs: [https://docs.anthropic.com/en/docs/claude-code/skills](https://docs.anthropic.com/en/docs/claude-code/skills)
- OpenClaw skills docs: [https://docs.openclaw.ai/skills](https://docs.openclaw.ai/skills)
- OpenClaw ClawHub docs: [https://docs.openclaw.ai/tools/clawhub](https://docs.openclaw.ai/tools/clawhub)
- ClawHub skill format (registry repo): [https://raw.githubusercontent.com/openclaw/clawhub/main/docs/skill-format.md](https://raw.githubusercontent.com/openclaw/clawhub/main/docs/skill-format.md)

## OrgOps skills: current behavior snapshot

### Format and loading

- Skills are loaded from filesystem roots and parsed from `SKILL.md` frontmatter.
- Required fields are effectively `name` and `description`.
- Loader accepts optional `license` and parses `metadata` (JSON or object), but does not enforce metadata semantics.
- Skill directory basename must equal the declared skill name.
- First discovered skill name wins (root order determines precedence).

Relevant files:

- `packages/skills/src/index.ts`
- `packages/skills/src/index.test.ts`

### Runtime usage

- Agents store enabled skill names in DB (`enabled_skills_json`).
- Runner loads all discovered skills, filters by `agent.enabledSkills`, and injects a short catalog into system prompt:
  - name
  - description
  - location
  - path to `SKILL.md`
- Skills are instructions/assets; runtime tools remain fixed (`shell_*`, `fs_*`, `proc_*`, `events_*`).

Relevant files:

- `apps/agent-runner/src/runner.ts`
- `apps/agent-runner/src/tools/index.ts`
- `apps/api/src/routes/agents.ts`
- `packages/db/src/schema.ts`

### API/UI

- API exposes read-only discovery endpoint: `GET /api/skills`.
- UI can list discovered skills and toggle per-agent enabled skills.
- No install/update/publish/version management in OrgOps.

Relevant files:

- `apps/api/src/routes/skills.ts`
- `apps/ui/src/screens/SkillsScreen.tsx`
- `apps/ui/src/screens/AgentsScreen.tsx`

## OrgOps vs Claude Code skills

## 1) Skill model compatibility

**Match**

- Both use `SKILL.md` as skill entrypoint with YAML frontmatter.
- Both support project-level `.claude/skills` style roots (OrgOps includes `.claude/skills` in `resolveSkillRoots`).
- Both treat skill content as instruction playbooks plus optional supporting files.

**Gap**

- Claude Code supports richer frontmatter behavior:
  - `disable-model-invocation`
  - `user-invocable`
  - `argument-hint`
  - `allowed-tools`
  - `context: fork`
  - `agent`
  - `model`
  - `hooks`
- OrgOps currently parses but does not execute these semantics.

## 2) Invocation behavior

**Claude Code**

- Supports direct slash invocation (`/skill-name`) and automatic model invocation.
- Can hide skills from model context or from user menu via frontmatter.
- Supports argument substitution (`$ARGUMENTS`, `$0`, etc.).

**OrgOps gap**

- No slash-command or explicit user-invocable skill command layer.
- No model-invocation toggle handling from frontmatter.
- No argument interpolation semantics.

## 3) Tool permissions and guardrails

**Claude Code**

- `allowed-tools` can grant scoped tool access while skill is active.
- Skill access can be controlled through permission rules (`Skill(...)` allow/deny).

**OrgOps gap**

- Skills do not alter tool permissions.
- Tool surface is globally defined by runner.
- No per-skill allow/deny policy control.

## 4) Subagent execution patterns

**Claude Code**

- `context: fork` can run skill in isolated subagent context.
- `agent` selects subagent profile.

**OrgOps gap**

- No frontmatter-driven subagent execution mode.
- Runner processes events directly in one agent loop per OrgOps agent.

## 5) Dynamic context injection

**Claude Code**

- Supports pre-execution shell substitution in skill text (e.g. `!` command blocks).

**OrgOps gap**

- No equivalent preprocessor for skill content.
- Equivalent outcomes require manual tool calls by the agent.

## 6) Discovery and precedence

**Match**

- Both support multi-location discovery and precedence.

**Gap**

- Claude Code additionally supports nested directory auto-discovery and live update behavior tied to session context and `--add-dir`.
- OrgOps has static root list + env override, without nested discovery semantics or live skill content hot-loading behavior in runner sessions.

## 7) Operational lifecycle

**Claude Code**

- Skill sharing can happen through project repos, managed settings, and plugins.

**OrgOps gap**

- No dedicated skill packaging/distribution lifecycle.
- No managed organization distribution mechanism for skills beyond file placement.

## OrgOps vs ClawHub/OpenClaw (consolidated prior findings)

## 1) Registry/lifecycle gap

- ClawHub/OpenClaw provides publish/install/update/version/tag/sync workflows.
- OrgOps has none of these registry capabilities; it only discovers local folders.

## 2) Metadata enforcement gap

- OpenClaw uses metadata gates (`requires.env`, `requires.bins`, `requires.config`, `os`, etc.) to determine eligibility.
- OrgOps parses metadata but does not enforce eligibility gates.

## 3) Config model gap

- OpenClaw supports per-skill config (`skills.entries.*`) including `enabled`, env, apiKey mapping, and custom config.
- OrgOps stores only `enabledSkills` per agent.

## 4) Security and moderation gap

- ClawHub has registry moderation/reporting and metadata-validation workflows.
- OrgOps has no skill-level moderation/analysis pipeline.

## 5) Command-dispatch semantics gap

- OpenClaw supports fields such as `command-dispatch` and `command-tool`.
- OrgOps has no skill-defined command dispatch abstraction.

## Priority gap list (implementation impact)

## P0 (highest leverage)

- Implement frontmatter semantics used by both ecosystems:
  - `disable-model-invocation`
  - `user-invocable`
  - `allowed-tools` (at least coarse enforcement in runner)
- Add skill eligibility checks:
  - `requires.env`
  - `requires.bins`
  - `os`
- Extend skill index payload to include eligibility + disabled reasons.

## P1

- Add a first-class skill invocation path:
  - explicit invocation command/event
  - argument passing and interpolation (`$ARGUMENTS` pattern or equivalent)
- Add per-agent/per-skill config object instead of only string arrays.

## P2

- Add optional subagent execution mode tied to skill metadata (Claude `context: fork` equivalent).
- Add dynamic context preprocessor support for controlled command substitution.

## P3

- Add packaging/distribution:
  - local lockfile
  - import/export
  - optional future registry compatibility

## Suggested target state for OrgOps

To maximize compatibility while keeping OrgOps architecture simple:

1. Keep `SKILL.md` as canonical format.
2. Introduce a normalized internal schema (`OrgOpsSkillResolved`) with:
   - parsed frontmatter
   - eligibility status
   - invocation mode
   - effective tool policy
3. Separate concerns:
   - **Discovery** (`packages/skills`)
   - **Policy/evaluation** (new module)
   - **Invocation runtime** (`agent-runner`)
   - **Management UI/API** (install/enable/reason visibility)

This allows incremental compatibility with Claude/OpenClaw semantics without replacing OrgOps event-driven design.
