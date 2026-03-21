# OrgOps Agent Runner

Agent supervisor that polls events, calls the LLM, executes tools, and emits audit events.

## Agent Modes

- `CLASSIC` (default): single-shot structured JSON event generation.
- `RLM_REPL`: recursive REPL loop with persistent per-agent VM context.
  - Runs in a dedicated child Node process per agent.
  - Child process is started with `cwd` set to the agent workspace path.
  - Runner sets a global `prompt` variable each handled event.
  - LLM emits one JS REPL input per step; runner executes and appends input/output to channel audit events.
  - Completion is signaled only by calling `done(result)` inside the REPL.
  - Recursive delegation is available via `spawnSubagent(promptText)`, and subagents also finish with `done(result)`.

## Run

```bash
npm run dev
```

## Environment

- `ORGOPS_API_URL` (default: `http://localhost:8787`)
- `ORGOPS_RUNNER_TOKEN` (shared with API)
- `ORGOPS_SKILLS_DIRS` (comma-separated override for skill roots)
- `ORGOPS_LLM_STUB=1` to stub LLM calls
- `OPENAI_API_KEY` for OpenAI models
- `ORGOPS_RLM_MAX_STEPS` (default: `24`)
- `ORGOPS_RLM_EVAL_TIMEOUT_MS` (default: `10000`)
- `ORGOPS_RLM_MAX_INPUT_CHARS` (default: `16000`)
- `ORGOPS_RLM_MAX_OUTPUT_CHARS` (default: `16000`)
- `ORGOPS_RLM_MAX_SUBAGENT_DEPTH` (default: `3`)
- `ORGOPS_RLM_MAX_SUBAGENTS_PER_EVENT` (default: `12`)
