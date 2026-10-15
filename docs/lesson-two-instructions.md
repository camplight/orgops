1. Run OrgOps locally
2. Showcase the Web Search agent and how it works - both from admin and chat
3. Install graphify and create a graph of the codebase
4. Ask "/graphify what constitues an agent?"
5. Ask "/graphify what are the most complex components in the codebase in terms of maintainability"
    1. Save the analysis in a file
6. Start a new session and start exploring how to refactor users-ui/src/App.tsx
7. Save the plan and then write the characterization tests in a separate session
    1. Adapt the write-bdd-scenarios skill from the previous session to the new context - different framework, not writing gherkin upfront
    2. Start with auth and follow the plan
    3. Small step of written tests, then mutation tests, then move on
    4. Create an agent that encodes this flow
    5. Implement all of the tests using the agent. Adjust mutation strictness if things go too slow
    6. Go through the tests while they're being implemented and verify if they're good or not
8. Once the mutation tests are done, kick off the refactoring
9. go through step 1
10. Go through step 2
11. On step 3 notice that the agent wasn't able to test stuff properly because it mocked what it doesn't own - so now we have to test in integration
    1. Rewrite the tests so it uses msw to mock the api calls themselves
