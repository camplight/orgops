---
name: user-ui-refactoring-step
description: Runs one small, reviewable refactoring step of apps/user-ui/src/App.tsx from docs/1-refactoring-1-user-ui-refactoring-plan.md - choose the next small move, do it, run the checks and fix problems, stop for the user's review, commit only after approval. Use when asked to continue, do the next, or run a refactoring step on the user UI.
---

# One refactoring step for apps/user-ui

The loop: **choose, do, verify, review, commit.** One pass is one small, behaviour-preserving change that leaves the app working. Never batch two passes into one commit. Never commit before the user approves.

Source of truth: `docs/1-refactoring-1-user-ui-refactoring-plan.md` (sections 2 and 3). The characterisation tests in `apps/user-ui/src/characterisation/` are the safety net and are not part of the change.

## 1. Choose the next small refactoring

- Read the plan's step list. Find the step marked in progress, or the first step not done. Do not skip ahead of a step whose prerequisite is unfinished.
- Look at `git log --oneline` and the current tree to see what the earlier passes already moved. Never redo them.
- Pick the smallest coherent unit inside the current step: one cohesive group of functions, one component, one port. A good unit has one reason to exist, can be named in a commit subject, and diffs to a size a person reads in a few minutes.
- Check what the unit depends on. If it reaches into `window`, `navigator`, `crypto`, timers or React state, it belongs to a later step. Pick another unit and say why you skipped it.
- Say in one or two sentences what you chose and why. Do not ask permission for the choice; the user reviews the result.
- If this is the first pass of a step, mark that step `**(in progress)**` in the plan. When the last unit of a step lands, mark the step done in the same commit as that unit.

## 2. Do it

- Move code verbatim. No renames, no logic edits, no tidying, no new behaviour. Existing `as` assertions travel unchanged. A move is the refactoring; improvements are a separate pass.
- Follow the plan's target layout and dependency rule: `domain` imports nothing but types, `application` imports `domain` and `ports`, `ui` imports `application`.
- File names are `kebab-case.ts`. Factory functions, no classes. Export only what other modules use; keep helpers private to their new module.
- No new comments. Existing comments move with their code; mention any that conflict with the user's no-comments rule in the review.
- Never edit `characterisation/*.test.tsx` or the harness to make a pass work. A refactoring that needs a test change is not a pure refactoring: stop and tell the user.
- A pure move needs no new test. If the change adds behaviour or a seam that no characterisation test exercises, say so in the review rather than writing production code without a test.

## 3. Run the tests and fix issues

Run all of these, in this order:

```
npm run --workspace @orgops/user-ui lint
npx vitest run --project user-ui
npm test
npm run build
```

- `lint` is the only type check. `npm run build` is the user-ui build.
- `npm test` has two known failures that predate this work: `packages/db` "runs migrations and creates tables" and `packages/skills` "merges skills from multiple roots with first-name-wins". Any other failure is yours.
- When something fails, fix the production change, not the tests. If a failure is unclear, `git stash -u` and re-run to see whether it predates your change, then `git stash pop`.
- Re-run the full list after every fix, not just the failing command.
- If you cannot get green without touching the tests, revert the pass (`git restore`, remove new files) and report why.
- The manual smoke run with `ORGOPS_LLM_STUB=1` is the user's. Say that it was not done.

## 4. Stop for review

Do not stage or commit. Leave the change in the working tree and report:

- what moved: new files and exports, what stayed private, what was left in `App.tsx` on purpose and why
- diff size (`git diff --stat`, new files)
- which checks ran and their results, including the known failures
- things worth checking: conflicts with the user's guidelines, imports that might now be unused, coupling introduced, quirks you noticed and did not touch
- the proposed commit message
- the next small step you would take

Then wait. Say plainly that you are waiting for approval.

## 5. Commit after approval

Only when the user says to commit (or approves in clear words):

- `git add` the specific files of this pass, including the plan update. No `git add -A` if unrelated changes are in the tree.
- Conventional commit with the scope: `refactor(user-ui): <what moved and where>`. End the message with the attribution line from the session's system reminder.
- If the user asked for changes, make them, repeat step 3, and ask for review again. Do not commit in between.
- Confirm with `git log --oneline -1` and `git status --short`.
- Then continue with step 1 for the next pass only if the user said to continue.

## Stop and ask the user when

- the next unit would need a characterisation test changed
- the plan and the code disagree about what the next step is
- a check fails in a way you cannot attribute or fix
- the current step is finished and the next one needs a design decision the plan does not make
