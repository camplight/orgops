# part-2-refactoring-2-characterization-tests

- Session ID: `7b0ba934-2680-4a30-940b-71efd8b8d982`
- Started: 2026-10-13T09:48:28.048Z
- Last activity: 2026-10-13T10:30:03.310Z
- Human prompts: 12

## Prompt 1

adapt the write-bdd-scenarios skill to use the proposed framework in @docs/1-refactoring-1-user-ui-refactoring-plan.md

## Prompt 2

let's skip writing the gherkin scenarios themselves and go straight to executable tests

## Prompt 3

okay, what's the plan for writing characterization tests you're going to follow

## Prompt 4

great start with the first step

## Prompt 5

okay, mark that step as done in the todo

## Prompt 6

start on the auth suite

## Prompt 7

1. don't stub anything. we don't want to couple the tests with the implementation
2. no

Go on, write the tests

## Prompt 8

1. don't stub anything. we don't want to couple the tests with the implementation
2. no

Go on, write the tests

## Prompt 9

1. don't stub anything. we don't want to couple the tests with the implementation
2. no

Go on, write the tests using the write-bdd skill

## Prompt 10

great, now run mutation testing only on top of those tests to confirm they actually test the app

## Prompt 11

okay, now create an agent that encodes that whole flow - from characterization test plan, through writing the tests, through mutation testing, fixing mutants. The agent should ping me in case of issues, but should complete the whole flow on its own.

## Prompt 12

@"user-ui-characteriser (agent)" write the workspace tests in the plan
