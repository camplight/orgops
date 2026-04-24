# OrgOps OpsCLI

`opscli` is a lightweight autonomous maintenance CLI for OrgOps hosts.

- Uses a local terminal chat loop (stdin/stdout)
- Uses a persistent Node REPL session for an RLM-style loop
- LLM emits one JS snippet per step; runtime evaluates it in REPL context
- REPL helpers include `shell(command)`, `print(...args)`, `input(question)`, and `exit(code)`
- Session history is context-capped with rolling summarization
- Bundled release executable can extract/setup `api`, `agent-runner`, and `ui`

## Run

```bash
npm run --workspace @orgops/opscli start
```

## Build standalone executable

```bash
npm run --workspace @orgops/opscli build:release
```

This creates `dist/opscli-*` for the current platform. Release workflow builds all 3 platforms.

## macOS downloaded binary notes

If you download `opscli-macos` from GitHub Releases, remove quarantine once and make it executable:

```bash
xattr -d com.apple.quarantine ./opscli-macos
chmod +x ./opscli-macos
./opscli-macos
```

If Finder still blocks first launch, use right-click -> Open once.

## Bundled setup helpers in REPL

- `extractOrgOps(options?)`: extract bundled OrgOps source tree
- `setupOrgOps(options?)`: extract + install deps + configure `.env` + prep components
- `getBundledDocs()`: return bundled OrgOps docs that also feed the system prompt

By default, extraction is done to `./orgops` from the current working directory.
OpsCLI persists the extracted root in local `.env` as `ORGOPS_EXTRACTED_ROOT` and reuses it in later sessions.

## Environment

- `OPENAI_API_KEY` (prompted on startup if missing; saved to local `.env`)
- `ORGOPS_OPSCLI_MODEL` (default: `openai:gpt-5.3-codex`)
- `ORGOPS_OPSCLI_MAX_STEPS` (default: `20`)
- `ORGOPS_OPSCLI_COMMAND_TIMEOUT_MS` (default: `120000`)
- `ORGOPS_OPSCLI_EVAL_TIMEOUT_MS` (default: `30000`)
- `ORGOPS_OPSCLI_MAX_CONTEXT_CHARS` (default: `100000`)
- `ORGOPS_OPSCLI_MAX_SUMMARY_CHARS` (default: `14000`)
- `ORGOPS_OPSCLI_SUMMARY_CHUNK_MESSAGES` (default: `8`)
- `ORGOPS_OPSCLI_MIN_RECENT_MESSAGES` (default: `12`)
- `ORGOPS_OPSCLI_MAX_SYSTEM_DOC_CHARS` (default: `40000`)
- `ORGOPS_EXTRACTED_ROOT` (auto-managed by OpsCLI; persisted extracted OrgOps path)
