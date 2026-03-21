# Events Scenario Tests

JSON-driven end-to-end scenario checks for OrgOps collaboration flows against a running `dev:all` stack.

## Run

From repo root:

```bash
npm run scenario:test:countdown
```

Or directly:

```bash
npm run --workspace @orgops/events-scenario-tests run -- --scenario coordinator-worker-countdown
```

## Notes

- Requires API and runner running (for example via `npm run dev:all`).
- Uses `ORGOPS_API_URL` and `ORGOPS_RUNNER_TOKEN` (defaults match dev defaults).
- Scenario setup can clear events and trigger workspace cleanup per agent.
- Assertions are tolerant to variation:
  - ordered `mustExistSequence` checks with aliases
  - `mustExist` checks anywhere in timeline
  - `atLeastOne` alternatives
  - `mustNotExist` regressions
