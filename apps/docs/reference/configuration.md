# Configuration

OrgOps is configured through environment variables, usually in a `.env` file at the
repository root. [`.env.example`](https://github.com/camplight/orgops/blob/main/.env.example)
lists them with comments.

## Core

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8787` | API port |
| `ORGOPS_ADMIN_USER` / `ORGOPS_ADMIN_PASS` | `admin` / `admin` | Initial admin, created only when there are no humans |
| `ORGOPS_MASTER_KEY` | — | **Required.** 32-byte base64 key for secret encryption |
| `ORGOPS_RUNNER_TOKEN` | `dev-runner-token` | Global runner token shared by API and runners |
| `ORGOPS_COOKIE_SECURE` | `auto` | `auto`, `always` or `never` |
| `ORGOPS_SYSTEM_AGENT_MODEL` | — | Seeds a public `system` agent on an empty database (`openai`, `anthropic`, `openrouter`, `mistral`, `liquid` or `provider:model`) |
| `ORGOPS_PROJECT_ROOT` | auto | Monorepo root override |
| `ORGOPS_WORKSPACE_ROOT` | `.orgops-data/workspaces` | Root for managed agent workspaces |
| `ORGOPS_SKILL_ROOTS` | — | Extra comma-separated skill roots |
| `ORGOPS_EVENT_MAX_FAILURES` | `25` | Failures before an event is dead-lettered |
| `ORGOPS_EVENT_SHAPES_CACHE_TTL_MS` | `3000` | Event-shape registry cache TTL |
| `ORGOPS_RUNNER_ONLINE_THRESHOLD_MS` | `15000` | How long a runner counts as online after a heartbeat |
| `ORGOPS_API_MAX_BODY_BYTES` | `1048576` | Body limit for API calls |
| `ORGOPS_UPLOAD_MAX_BODY_BYTES` | `22020096` | Body limit for uploads |
| `ORGOPS_TRANSFER_MAX_BODY_BYTES` | `16777216` | Body limit for agent transfers |

## Runner

| Variable | Default | Description |
| --- | --- | --- |
| `ORGOPS_API_URL` | `http://localhost:8787` | API base URL |
| `ORGOPS_RUNNER_ID_FILE` | `.agent-runner-id` | Where the stable runner ID is stored |
| `ORGOPS_RUNNER_NAME` | — | Display name on registration |
| `ORGOPS_LLM_STUB` | — | `1` stubs all LLM calls |
| `ORGOPS_LLM_CALL_TIMEOUT_MS` | `10800000` | Default LLM call timeout |
| `ORGOPS_HISTORY_MAX_EVENTS` / `ORGOPS_HISTORY_MAX_CHARS` | `250` / `120000` | Upper bounds for prompt history |
| `ORGOPS_CHANNEL_RECENT_MEMORY_INTERVAL_MS` | `10000` | Channel memory refresh (recent) |
| `ORGOPS_CHANNEL_FULL_MEMORY_INTERVAL_MS` | `60000` | Channel memory refresh (full) |
| `ORGOPS_CROSS_RECENT_MEMORY_INTERVAL_MS` | `15000` | Cross-channel memory refresh (recent) |
| `ORGOPS_CROSS_FULL_MEMORY_INTERVAL_MS` | `120000` | Cross-channel memory refresh (full) |
| `ORGOPS_AGENT_INTENT_TIMEOUT_MS` / `ORGOPS_AGENT_INTENT_MAX_TIMEOUTS` | `45000` / `3` | Intent watchdog |
| `ORGOPS_SHELL_PATH` / `ORGOPS_SHELL_ARGS` | — | Shell override for `shell_*` tools |
| `ORGOPS_GIT_BASH_PATH` | `C:\Program Files\Git\bin\bash.exe` | Windows `bash.exe` path |
| `ORGOPS_SHELL_TIMEOUT_KILL_GRACE_MS` | `5000` | Grace period before force-killing a timed-out `shell_run` |
| `ORGOPS_WORKSPACE_PUBLICATION_SYNC_INTERVAL_MS` | `2000` | Snapshot sync interval for workspace publications |

### RLM mode

| Variable | Default |
| --- | --- |
| `ORGOPS_RLM_MAX_STEPS` | `24` |
| `ORGOPS_RLM_EVAL_TIMEOUT_MS` | `10000` |
| `ORGOPS_RLM_MAX_INPUT_CHARS` | `16000` |
| `ORGOPS_RLM_MAX_OUTPUT_CHARS` | `16000` |
| `ORGOPS_RLM_PROMPT_PREVIEW_MAX_CHARS` | `4000` |
| `ORGOPS_RLM_MAX_SUBAGENT_DEPTH` | `3` |
| `ORGOPS_RLM_MAX_SUBAGENTS_PER_EVENT` | `12` |

## LLM providers

For native and wrapped agents, provider keys are read from
[secrets](../concepts/secrets.md), not from the runner environment. Environment values are
used for seeding the `system` agent, voice features and `opscli chat`.

| Variable | Description |
| --- | --- |
| `OPENAI_API_KEY` | OpenAI |
| `ANTHROPIC_API_KEY` | Anthropic |
| `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, `OPENROUTER_HTTP_REFERER`, `OPENROUTER_APP_TITLE` | OpenRouter |
| `MISTRAL_API_KEY` | Mistral |
| `LIQUID_API_KEY`, `LIQUID_BASE_URL` | Liquid (store as OrgOps secrets) |
| `OPENAI_COMPATIBLE_API_KEY`, `OPENAI_COMPATIBLE_BASE_URL` | Local OpenAI-compatible gateways |
| `GOOGLE_API_KEY` / `GEMINI_API_KEY` | Gemini Live realtime voice |

## Voice

| Variable | Default | Description |
| --- | --- | --- |
| `ORGOPS_TRANSCRIPTION_MODEL` | auto | `provider:model` or `off`; defaults to Mistral or OpenAI depending on available keys |
| `ORGOPS_VOICE_BROKER` | `direct-openai-calls` | or `livekit` |
| `ORGOPS_REALTIME_VOICE` | `marin` | OpenAI realtime voice |
| `ORGOPS_REALTIME_VAD_THRESHOLD` | `0.55` | Server VAD threshold |
| `ORGOPS_REALTIME_VAD_PREFIX_MS` / `ORGOPS_REALTIME_VAD_SILENCE_MS` | `300` / `1100` | Server VAD timing |
| `ORGOPS_REALTIME_RESPONSE_STAGGER_MS` | `700` | Reply stagger in multi-agent rooms |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_TOKEN_TTL_SECONDS` | — | LiveKit rooms |
| `ORGOPS_TTS_MODEL` / `ORGOPS_TTS_VOICE` | `gpt-4o-mini-tts` / per agent | `speak` skill; without `ORGOPS_TTS_VOICE` the voice is picked from the agent name |

## Federation and identity

| Variable | Default | Description |
| --- | --- | --- |
| `ORGOPS_FEDERATION_SYNC_INTERVAL_MS` | `15000` | Projection pull-sync interval (`0` disables) |
| `ORGOPS_FEDERATION_TRUSTED_ORIGINS` | — | Exact private/HTTP peer origins allowed by the operator |
| `ORGOPS_GOOGLE_CLIENT_ID`, `ORGOPS_GOOGLE_CLIENT_SECRET`, `ORGOPS_GOOGLE_REDIRECT_URI` | — | Google Workspace sign-in |

## UIs

| Variable | Default | Description |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `/api` | API base, relative or absolute |
| `VITE_WS_BASE_URL` | `/ws` | WebSocket base (derived from the API URL when it is absolute) |
| `VITE_UI_BASE_PATH` | — | Base path the UI is served from |

Runtime overrides without rebuilding: `window.__ORGOPS_UI_CONFIG__` (admin UI) and
`window.__ORGOPS_USER_UI_CONFIG__` (user UI), both `{ apiBaseUrl, wsBaseUrl }`.

## Container

| Variable | Description |
| --- | --- |
| `ORGOPS_COMPONENTS` | Comma-separated `api`, `runner`, `admin-ui`, `user-ui` |
| `ORGOPS_PROXY_PORT` | Public HAProxy port (default `8787`) |
| `ORGOPS_INTERNAL_API_PORT`, `ORGOPS_INTERNAL_ADMIN_UI_PORT`, `ORGOPS_INTERNAL_USER_UI_PORT` | Internal ports |

## OpsCLI

| Variable | Default | Description |
| --- | --- | --- |
| `ORGOPS_OPSCLI_MODEL` | `openai:gpt-5.2` | Chat model (`openai:`, `anthropic:`/`claude:`, `openrouter:`/`or:`, `mistral:`, `liquid:`) |
| `ORGOPS_OPSCLI_COMMAND_TIMEOUT_MS` | `120000` | Shell command timeout |
| `ORGOPS_OPSCLI_MAX_CONTEXT_CHARS` | `100000` | Context cap |
| `ORGOPS_OPSCLI_MAX_SUMMARY_CHARS` | `14000` | Rolling summary cap |
| `ORGOPS_OPSCLI_SUMMARY_CHUNK_MESSAGES` | `8` | Messages per summary chunk |
| `ORGOPS_OPSCLI_MIN_RECENT_MESSAGES` | `12` | Recent messages kept verbatim |
| `ORGOPS_OPSCLI_MAX_SYSTEM_DOC_CHARS` | `40000` | Bundled docs size in the prompt |
| `ORGOPS_OPSCLI_SPINNER` / `ORGOPS_OPSCLI_PROGRESS` | enabled | Set to `0` to disable |
| `ORGOPS_OPSCLI_LOG_PATH` | `.opscli-output.log` | Session log |
| `ORGOPS_OPSCLI_DOUBLE_SIGINT_MS` | `1200` | Double `Ctrl+C` window |
| `ORGOPS_OPSCLI_USE_SYSTEM_TOOLCHAIN` | `0` | Use host Node instead of a private toolchain |
| `ORGOPS_OPSCLI_TOOLCHAIN_DIR` | `~/.orgops/toolchains` | Toolchain location |
| `ORGOPS_OPSCLI_NODE_VERSION` | `22.20.0` | Managed Node version |
| `ORGOPS_OPSCLI_SERVICE_DRY_RUN` | `0` | Write service files without registering them |
| `ORGOPS_OPSCLI_SKIP_GIT_INSTALL` | `0` | Do not auto-install git |
