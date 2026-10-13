# part-2-refactor-app-1-plan

- Session ID: `d8916681-c8d2-4414-8321-172339922286`
- Started: 2026-10-13T09:41:25.630Z
- Last activity: 2026-10-13T09:47:27.057Z
- Human prompts: 3

## Prompt 1

Let's plan how to approach the refactoring of users-ui/src/App.tsx. We want to:
1. Start with characterisation tests first. Those are behavior-driven tests that codify the current behavior and make sure the refactoring won't break anything. Those tests shouldn't be coupled to implementation at all. Otherwise, the refactoring will require changing them
2. After that, let's analyse the current App.tsx and see how we can reorganise it towards Hexagonal architecture and DDD
3. After that, let's make a plan how to do the whole refactoring in small steps where the completion of each step results in a working, refactored app

## Prompt 2

For the tests - we should make sure they run fast. And if they do, probably experiment with mutation testing to make sure they cover the right behavior

## Prompt 3

great, add this to docs/1-refactoring-1-user-ui-refactoring-plan.md
