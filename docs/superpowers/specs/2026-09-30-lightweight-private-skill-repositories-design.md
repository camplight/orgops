# Lightweight private skill repositories

**Status:** proposed implementation design
**Date:** 2026-09-30
**Scope:** multi-root filesystem skill discovery and one agent-operated private skill repository

## 1. Purpose

OrgOps installations need to consume and maintain private skills without adding a package catalog, release lifecycle, grants, agent templates, or deployment coordinator.

The implementation keeps built-in skills in the tracked OrgOps repository and loads private skills from a separate checkout. A built-in management skill performs Git operations against one configured private repository. Existing skill selection remains the authority for which agents may use the management workflow; existing agent-private secrets provide optional HTTPS credentials.

## 2. Decisions

- The tracked `<ORGOPS_PROJECT_ROOT>/skills` directory remains the built-in skill root.
- `ORGOPS_SKILL_ROOTS` adds zero or more external skill roots using Node's platform path delimiter (`:` on POSIX and `;` on Windows).
- External roots must be absolute paths. Empty entries and exact duplicate paths are ignored. Missing or unreadable roots produce bounded discovery diagnostics without hiding valid roots.
- API and runner processes use the same root resolver. A single-machine installation is the v1 deployment boundary; operators of split-host installations must configure and synchronize each host independently.
- Skills from all roots appear in the existing Skills UI and agent selectors. No new administration screen or persisted source model is added.
- Changes on disk are discovered on the next `GET /api/skills` request and next agent turn. API event-shape validation retains its existing short cache TTL. There is no approval, installation, restart, watcher, or version-pinning lifecycle.
- A skill name must be unique across every root. Every occurrence of a conflicting name is unavailable; root precedence never silently selects one.
- One built-in `private-skill-repository` skill manages one configured repository per installation. Additional roots may be maintained manually.
- An agent may operate the repository when the management skill is enabled and the agent has suitable Git authentication. An HTTPS token is an agent-private OrgOps secret; normal host Git/SSH authentication is also supported.
- The helper may publish only changes below the managed repository's `skills/` directory.

## 3. Non-goals

- Catalogs, Sources, package manifests, immutable releases, installation, grants, review, rollout, or agent templates.
- Synchronizing several runner hosts or guaranteeing that different OrgOps installations observe the same commit.
- Automatic polling or background Git synchronization.
- Per-skill semantic versions, rollback, dependency resolution, or update approval.
- A repository registry or UI for repository configuration.
- Storing Git credentials outside the existing OrgOps secrets system.
- Automatic conflict resolution, stash, rebase, hard reset, clean, or force push.
- Sandboxing arbitrary skill code. Existing skill and shell trust boundaries remain unchanged.

## 4. Configuration

The installation configures:

```env
# Additional directories whose immediate children are skills.
ORGOPS_SKILL_ROOTS=/srv/private-skills/skills

# The one repository managed by the built-in management skill.
PRIVATE_SKILLS_REPO_URL=https://github.com/example/private-skills.git
PRIVATE_SKILLS_REPO_PATH=/srv/private-skills
PRIVATE_SKILLS_REPO_BRANCH=main
```

Multiple additional roots use the operating system path delimiter:

```env
# POSIX
ORGOPS_SKILL_ROOTS=/srv/team-skills/skills:/srv/client-skills/skills

# Windows
ORGOPS_SKILL_ROOTS=C:\team-skills\skills;D:\client-skills\skills
```

`PRIVATE_SKILLS_REPO_PATH/skills`, after lexical resolution, must equal one configured external root. This prevents the management skill from targeting an unrelated checkout.

For HTTPS authentication, an authorized agent receives this existing private secret:

```text
PRIVATE_SKILLS_GIT_TOKEN
```

An optional private `PRIVATE_SKILLS_GIT_USERNAME` secret may override the provider-appropriate default username. The token is supplied through a temporary askpass/credential-helper environment and is never inserted into the remote URL, process arguments, persisted Git configuration, events, or command output.

When the token is absent, Git uses the host's existing SSH agent, deploy key, or credential helper.

## 5. Multi-root discovery

### 5.1 Interface

`@orgops/skills` gains a root-set abstraction and one discovery operation:

```ts
type SkillRoot = {
  path: string;
  kind: "BUILT_IN" | "EXTERNAL";
};

type SkillConflict = {
  name: string;
  paths: string[];
};

type SkillDiscovery = {
  skills: SkillMeta[];
  conflicts: SkillConflict[];
  diagnostics: Array<{
    path: string;
    code: "MISSING" | "UNREADABLE";
  }>;
};

resolveSkillRoots(projectRoot: string, configuredRoots?: string): SkillRoot[];
discoverSkills(roots: SkillRoot[]): SkillDiscovery;
```

`SkillMeta` retains its canonical filesystem path and gains root kind/path metadata for display and policy decisions. Discovery order is deterministic: built-in root first, then normalized external paths in configuration order; returned skills, conflicts, and diagnostics are sorted. Order never resolves name conflicts.

Discovery reads only immediate child directories containing a valid `SKILL.md`, matching existing behavior. Symlink children are not treated as skill directories. Invalid skill documents remain absent rather than crashing global discovery.

### 5.2 Duplicate names

Discovery first groups all valid skills by declared name. A name with more than one canonical directory is omitted from `skills` and included once in `conflicts` with bounded paths. Consequently:

- the UI cannot enable an ambiguous skill;
- the runner cannot preload or execute one;
- event-shape discovery cannot choose one by accident.

### 5.3 API and UI

`GET /api/skills` returns the complete discovery projection rather than a bare array:

```json
{
  "skills": [],
  "conflicts": [],
  "diagnostics": []
}
```

The existing admin Skills screen displays merged skills and their origin path. It renders compact warnings for conflicts and unavailable roots. Existing agent create/edit selectors receive only `skills`, so unavailable entries cannot be selected.

No database state or new route family is introduced.

### 5.4 Runtime

At the start of each CLASSIC turn, the runner performs discovery and selects enabled skills from the unambiguous `skills` collection. Selected external skills participate in:

- the prompt skill index;
- always-preloaded `SKILL.md` content;
- dynamic event-shape loading;
- filesystem and shell working-directory allowlists.

The API uses the same discovery operation for its skill listing and dynamic event validation. API and runner configuration must therefore agree in the supported single-machine deployment.

A turn's prompt is composed from the files observed at turn start. This feature does not add filesystem snapshots: later tool reads retain the existing local-skill behavior if files change during a live turn.

Runner guidance lists all configured roots rather than claiming there is one skill root.

## 6. Repository-management skill

The tracked bootstrap skill is:

```text
skills/private-skill-repository/
├── SKILL.md
└── assets/
    └── manage-repository.ts
```

`SKILL.md` explains when to synchronize, inspect, edit, validate, and publish. The helper performs deterministic Git mechanics so the model does not repeatedly reconstruct sensitive commands.

### 6.1 Capability boundary

When and only when the canonical built-in `private-skill-repository` skill is enabled, the runner adds `<PRIVATE_SKILLS_REPO_PATH>/skills` as an extra allowed filesystem root for that turn. It does not grant the repository parent or `.git` directory through filesystem tools.

The management helper validates the configured repository path/root relationship itself and performs Git operations through argument-array child processes without a shell. The optional private token supplies repository authentication. Thus practical access requires:

1. the management skill enabled for the agent; and
2. a usable agent-private token or host Git authentication.

This is deliberately not a new OrgOps role or permission table.

### 6.2 Commands

The helper exposes a narrow CLI:

```text
status
sync
begin --branch <branch>
validate
publish --message <message> [--direct]
```

- `status` reports bounded branch, remote, cleanliness, ahead/behind, and conflict state without file contents or credentials.
- `sync` clones an absent checkout or fetches and fast-forwards an existing clean checkout to the configured branch.
- `begin` requires a clean synchronized checkout and creates or switches to a non-default publication branch.
- `validate` verifies that changed paths are below `skills/` and that every affected skill directory has a valid, basename-matching `SKILL.md`.
- `publish` validates, commits changed paths below `skills/`, and pushes either the current review branch or the configured branch when `--direct` was explicitly requested.

Direct publishing still obeys remote branch protection. The helper never creates or merges pull requests; a pushed review branch is the integration handoff.

### 6.3 Concurrency and refusal rules

Mutating commands acquire an atomic filesystem lock adjacent to the checkout. If another operation owns the lock, the helper exits with a bounded busy error. It does not delete an unknown stale lock automatically; recovery is a human operation documented by the skill.

The helper refuses mutation when:

- configuration is missing or malformed;
- the checkout or remote does not match configured identity;
- the worktree is dirty before `sync` or `begin`;
- local and remote history diverge;
- Git reports unmerged paths;
- a changed path escapes `skills/`;
- affected skill metadata is invalid;
- direct publication was not explicitly selected;
- authentication fails.

It never runs automatic stash, rebase, reset, clean, conflict resolution, or force push.

### 6.4 Output and secret handling

Helper output is bounded structured JSON intended for the agent to summarize. It includes stable error codes and safe Git metadata but excludes environment values, credential-helper paths, remote URLs containing userinfo, and file contents.

Temporary authentication material is created with owner-only permissions and removed in `finally` on success, failure, timeout, and signals where Node cleanup can run. Git is invoked with credential prompting disabled except for the temporary askpass flow.

## 7. Data flows

### Pull and consume

1. An authorized agent invokes `sync` through the management skill.
2. The helper locks, authenticates, clones or fast-forwards, unlocks, and returns safe status.
3. The next `GET /api/skills` discovers the new filesystem state and updates the existing Skills screen.
4. The next agent turn discovers the same roots. If a newly available skill was enabled on that agent, the runner loads it.

Synchronization does not automatically enable a skill on any agent.

### Create or update and publish

1. The agent runs `sync`, then `begin --branch ...` unless direct publication was explicitly requested.
2. Using the narrowly granted external `skills/` root, the agent creates or edits skill files.
3. The agent runs `validate` and corrects reported structural errors.
4. The agent runs `publish --message ...` or explicit `publish --direct --message ...`.
5. The helper commits only changed paths below `skills/` and pushes.

## 8. Error behavior

Discovery failures are non-fatal to healthy roots. The UI shows bounded path/code diagnostics; invalid or conflicting skills are unavailable.

Management failures do not modify OrgOps database state. The helper returns non-zero with one of a bounded set including:

```text
CONFIG_INVALID
ROOT_MISMATCH
BUSY
REPOSITORY_MISMATCH
DIRTY_WORKTREE
DIVERGED
CONFLICTED
INVALID_SKILL
PATH_OUTSIDE_SKILLS
AUTH_FAILED
GIT_FAILED
```

Raw tokens, credential helper content, and unrestricted Git stderr are never returned.

## 9. Testing

### Skill package

- platform-delimited root parsing, absolute-path validation, missing roots, and deterministic ordering;
- merged discovery, root provenance, duplicate conflict exclusion, malformed documents, and symlink children;
- compatibility behavior for the built-in root when no environment variable is set.

### API and UI

- `/api/skills` returns built-in and external skills plus bounded diagnostics;
- duplicate skills are not selectable;
- Skills screen shows external origin and conflict/missing-root warnings;
- agent create/edit flows still submit enabled skill names.

### Runner

- external enabled skills appear in prompt/preload/event shapes and tool roots;
- updates are observed on the next CLASSIC turn;
- enabling the canonical management skill grants only the configured external `skills/` root;
- similarly named external skills cannot impersonate the built-in management skill;
- absent/mismatched management configuration grants no extra path.

### Helper

Tests use temporary local bare Git repositories and cover clone, fast-forward sync, branch publication, explicit direct publication, locking, dirty/diverged/conflicted refusal, repository mismatch, path restriction, skill validation, bounded output, authentication cleanup, and token redaction.

### Release gate

Run root tests, lint, and build. No migration, route-matrix, catalog, or browser redesign gate is required.

## 10. Documentation

Update `.env.example`, API/runner READMEs, the root README deployment example, and `docs/SPEC.md` with:

- multi-root configuration;
- single-machine boundary;
- repository-management skill configuration and secret setup;
- immediate next-`GET /api/skills`/next-CLASSIC-turn refresh semantics (WRAPPED turns bypass skill discovery) and the existing event-shape cache TTL;
- duplicate-name behavior;
- manual responsibility for split-host synchronization.
