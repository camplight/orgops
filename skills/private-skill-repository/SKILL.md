---
name: private-skill-repository
description: Synchronize and publish skills in the configured private Git repository.
---

# Private skill repository

Use the repository management helper to inspect, synchronize, edit, validate, and
publish skills. Synchronization makes a checkout available for discovery; it does
**not** enable any skill on an agent. A human or agent configuration must enable a
skill explicitly, and the next `GET /api/skills` or next CLASSIC turn refreshes discovery (WRAPPED turns bypass skill discovery).

## Safe workflow

1. Run `status` before any mutation:

   ```bash
   node --import tsx <skill-path>/assets/manage-repository.ts status
   ```

2. Run `sync` before editing. This clones a missing checkout or fast-forwards a
   clean checkout on the configured default branch.
3. For the default review workflow, create or switch to a branch with
   `begin --branch <branch-name>` before editing.
4. Edit only `$PRIVATE_SKILLS_REPO_PATH/skills`. Do not edit the repository
   parent, `.git`, or unrelated files.
5. Run `validate` before publication. It checks that changed paths stay below
   `skills/` and that affected skill metadata is valid.
6. Publish a review branch by default with `publish --message "<message>"`.
   Use `publish --direct --message "<message>"` only after explicit human
   instruction to publish directly to the default branch.

Use the exact helper path shown in the runner's skill index (`<skill-path>` in
the examples above), rather than guessing another checkout path. The helper
uses the configured repository URL, checkout path, and branch.

## Stop conditions

Stop and report the bounded status/error result instead of improvising Git
recovery when any of these occurs: `BUSY`, a dirty worktree, divergence,
conflicts, repository mismatch, authentication failure, or invalid skill
metadata. Never use destructive recovery such as `reset`, `clean`, `stash`,
force-push, or an ad-hoc rebase to make the operation succeed. Ask a human to
resolve the repository state.

Never print `PRIVATE_SKILLS_GIT_TOKEN`, `PRIVATE_SKILLS_GIT_USERNAME`, or any
other secret. Never put credentials in a remote URL, commit, event, log, or
persisted Git configuration. Host SSH keys or a configured credential helper
may be used as the fallback when no agent-private token is supplied. Commits
also require the host Git author name and email to already be configured.
