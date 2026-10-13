# Sources and rationale

Material behind the `write-bdd-scenarios` skill. Each entry says what was taken from the source and where it shows up in the skill. Pages marked "fetched" were read directly while building the skill. Pages marked "not read" were only seen in search results, so check them before quoting them.

## Behaviour-driven development

### Dan North, "Introducing BDD" (fetched)
https://dannorth.net/blog/introducing-bdd/

- Think in behaviours, not tests. One behaviour is one sentence. Taken into: scenario rule 1 and titles stating the rule.
- Name behaviours as sentences. "Should" invites you to challenge the premise. Taken into: test names in plain words.
- Pick the next behaviour by asking "what is the next most important thing the system doesn't do?" Taken into: ordering scenarios by value, walking skeleton first.
- A story's acceptance criteria are its behaviour, written as Given / When / Then. Taken into: step 1 and step 2.
- Story form "As a / I want / So that" forces a value clause. Taken into: step 1.
- Share one vocabulary between business and developers. Taken into: scenario rule 10.

### Martin Fowler, "GivenWhenThen" (fetched)
https://martinfowler.com/bliki/GivenWhenThen.html

- Given is the state before, When is the behaviour, Then is the expected change. Then should only query state. Taken into: scenario rule 6 and 7.
- Same shape as Arrange, Act, Assert. Taken into: test body layout in step 4.

### Liz Keogh (partly fetched)
- Conversational patterns (fetched): https://lizkeogh.com/2011/09/22/conversational-patterns-in-bdd/ . Context questioning and outcome questioning. Taken into: step 1 probing questions and the review checklist.
- "Given, When, Then - the only way?" (search result only, not read): https://lizkeogh.com/2008/01/28/given-when-then-the-only-way/ . Concrete examples matter more than the template. Taken into: the principle that the conversation comes before the file.
- "Real conversations in BDD", Oredev 2015 (search result only, not read): https://vimeo.com/144723689 . Examples as the way to have the conversation.

### Gojko Adzic, "Specification by Example" (search results only, not read)
https://www.infoq.com/articles/specification-by-example-book

- Derive scope from goals, illustrate with examples, refine the specification, automate validation, validate frequently, evolve into living documentation. Taken into: the overall flow, and the reason scenarios must stay readable by non-programmers.

### Matt Wynne, Example Mapping (fetched)
https://cucumber.io/docs/bdd/example-mapping/

- Story, rules, examples, questions. Taken into: step 1. Red questions go to the user, they are not guessed.

## Gherkin

The skill no longer writes `.feature` files; tests are written directly. The "scenario rule N" references below map to the test-writing rules in step 2 of the skill (one behaviour per test, declarative naming, concrete values, atomic phases, observable outcomes only). The Gherkin-specific points (Rule, Background, Scenario Outline, step count) no longer apply.

### Cucumber, "Better Gherkin" (fetched)
https://cucumber.io/docs/bdd/better-gherkin/

- Describe intended behaviour, not implementation. The rewrite test: would the wording change if the implementation changed? Taken into: scenario rule 3.
- Declarative scenarios stay valid when the UI or mechanism changes. Imperative ones can be right in some contexts. Taken into: rules 3 and 4, where the project's UI contract limits how abstract steps can get.
- Named personas beat "User A". Not adopted: this app has a single user, so the skill uses concrete values instead.

### Cucumber, Gherkin reference (fetched)
https://cucumber.io/docs/gherkin/reference/

- Rule groups scenarios by business rule. Background is short, at most about 4 lines. Examples recommended at 3-5 steps. Scenario Outline rows are runs of one template. Taken into: step 2 structure.

### Cucumber, anti-patterns (fetched)
https://cucumber.io/docs/guides/anti-patterns/

- Feature-coupled steps and conjunction steps. Taken into: scenario rule 8. In this repo steps are not bound to step definitions, so only the conjunction rule applies.

### Community guides (search results only, not read)
- https://automationpanda.com/2017/01/26/bdd-101-the-gherkin-language/
- https://github.com/andredesousa/gherkin-best-practices
- https://selleo.com/blog/how-to-start-writing-gherkin-test-scenarios . Warns against ultra-declarative steps too vague to automate. Taken into: scenario rule 4.

Treat numeric limits from these as opinion.

## Outside-in TDD

### Steve Freeman and Nat Pryce, "Growing Object-Oriented Software, Guided by Tests" (table of contents fetched, text not read)
https://growing-object-oriented-software.com/toc.html

- Chapter 4, "First, Test a Walking Skeleton": the thinnest end-to-end slice first. Taken into: step 2 ordering and step 5 hand-off.
- Chapter 5, "Start Each Feature with an Acceptance Test" and "Separate Tests That Measure Progress from Those That Catch Regressions": a failing acceptance test drives the feature, and finished ones become regression tests. Taken into: why tests are written skipped and unskipped one at a time in `red-green-step`.
- Chapter 5, "Write the Test That You'd Want to Read" and Chapter 21, "Test Readability": tests as specification. Taken into: step 4 helper extraction.
- Chapter 5, "Develop from the Inputs to the Outputs": acceptance tests go through the system's outer surface. Taken into: step 4, mount `<App />`, drive only labels, roles and text.

## Characterisation tests and mutation testing

Not fetched; from general knowledge, check before quoting.

- Michael Feathers, "Working Effectively with Legacy Code": characterisation tests pin what code does today, not what it should do, so it can be changed safely. Taken into: the default mode, and logging quirks instead of fixing them.
- Stryker (vitest runner): mutation testing as the check that a test passing on first write would still catch a break. Taken into: step 5 and the 80% target. Compatibility with the repo's vitest version is unverified, as the plan says.

## How the sources map onto this repo

- The framework itself (happy-dom, hand-rolled fetch stub, fake WebSocket, fake timers, factories, no `let`/`beforeEach`, suites per area, speed budget) comes from `docs/1-refactoring-1-user-ui-refactoring-plan.md`, not from the sources above.
- The tests mount the whole app, so they are outside-in tests at the UI boundary. Inner unit-level tests, when needed, come from the TDD workflow in `~/.claude/docs/workflow.md`, and are not written by this skill.
- Characterisation tests pass on first write by design, so the one-at-a-time RED-GREEN cycle applies only to the new-behaviour mode, where tests are written as `it.skip`.
