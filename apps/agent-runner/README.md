# OrgOps Agent Runner

Agent supervisor that polls events, calls the LLM, executes tools, and emits audit events.

## Run

```bash
bun run dev
```

## Environment

- `ORGOPS_API_URL` (default: `http://localhost:8787`)
- `ORGOPS_RUNNER_TOKEN` (shared with API)
- `ORGOPS_SKILLS_DIRS` (comma-separated override for skill roots)
- `ORGOPS_LLM_STUB=1` to stub LLM calls
- `OPENAI_API_KEY` for OpenAI models
