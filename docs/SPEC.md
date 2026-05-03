# OrgOps Implementation Spec (Current)

## Goal

OrgOps is a Node.js multi-host system where humans and agents collaborate through an event bus persisted in SQLite. Agents can execute shell/filesystem/process tools, emit typed events, and stream process output to API/WebSocket clients.

This document describes the current implementation in this repository.

## Stack

- Runtime: Node.js (monorepo, npm workspaces)
- API: Hono + `@hono/node-ws`
- DB: SQLite + Drizzle ORM
- Realtime: WebSocket topic pub/sub via in-process event bus
- UI: React + Tailwind
- LLM wrapper: `@orgops/llm` (`generate()` abstraction)
- Schemas/validation: Zod-based event shapes in `@orgops/schemas`

## Monorepo Layout

```text
apps/
  api/            Hono HTTP + WS server
  agent-runner/   Agent polling loop + tool/runtime execution
  opscli/         Host bootstrap/maintenance CLI (RLM REPL loop)
  ui/             React UI
packages/
  crypto/         Secret encryption/decryption helpers
  db/             Drizzle schema + SQLite migrations
  event-bus/      In-process pub/sub
  llm/            Provider/model wrapper
  schemas/        Event schema registry + validators
  skills/         Skill discovery and loading
skills/           Built-in skills (SKILL.md, optional event-shapes.ts)
files/            Uploaded file storage
.orgops-data/     Runtime DB/workspaces/soul files
```

## Core Data Model

### Agents

Stored in `agents`:

- identity/config: `id`, `name`, `icon`, `description`, `model_id`
- prompting/runtime config: `system_instructions`, `soul_path`, `soul_contents`
- workspace/safety: `workspace_path`, `allow_outside_workspace`
- per-agent runtime tuning: `llm_call_timeout_ms`, `classic_max_model_steps`, `context_session_gap_ms`, `emit_audit_events`, `memory_context_mode`
- mode/state: `mode` (`CLASSIC` | `RLM_REPL`), `desired_state`, `runtime_state`, `last_heartbeat_at`
- host assignment: `assigned_runner_id` (nullable; when set, only matching runner executes the agent)
- skills: `enabled_skills_json`, `always_preloaded_skills_json`

### Runner Nodes

Stored in `runner_nodes`:

- identity: `id`, `display_name`
- host metadata: `hostname`, `platform`, `arch`, `version`, `metadata_json`
- lifecycle: `created_at`, `updated_at`, `last_seen_at`

Runner IDs are stable across restarts by persisting local `.agent-runner-id`.

### Collaboration

- `humans`: login users, password hash, `must_change_password`, inviter metadata
- `teams`, `team_memberships`
- `channels`: includes `kind`, optional `metadata_json`, optional `direct_participant_key`
- `channel_subscriptions`: channel participants/subscribers
- `conversations`, `threads`

### Events and Delivery

- `events`: append-only event log (`type`, `payload_json`, `source`, `channel_id`, `deliver_at`, `status`, failure counters, idempotency key)
- `event_receipts`: per-agent delivery state (`PENDING`/`DELIVERED`) used by runner polling

### Memory Summaries

- `channel_memory_recent`, `channel_memory_full`
- `cross_channel_memory_recent`, `cross_channel_memory_full`

### Processes / Files / Secrets / Models

- `processes` (includes `execution_mode` and process state fields), `process_output`
- `files`
- `secrets`
- `models`

## Event Contract

Envelope fields used by API/runner:

- required: `type`, `payload`, `source`
- contextual: `channelId`, `parentEventId`
- scheduling: `deliverAt`
- dedupe: `idempotencyKey`

Validation is dynamic and composed from:

- core definitions: `packages/schemas/src/event-shapes.ts`
- optional skill definitions: `skills/*/event-shapes.ts`

`POST /api/events` validates payloads against this composed registry.

## Auth and Access

### Human Auth

- Session-cookie login: `POST /api/auth/login`
- Profile/password update: `PATCH /api/auth/profile`
- Logout/me endpoints supported
- Invited humans must rotate temporary password before accessing most API routes

### Runner Auth

- Trusted runner token header: `x-orgops-runner-token`
- Runner-only endpoint for secret env injection: `GET /api/secrets/env`

### Tool Filesystem Access

Runner tools resolve paths through an allowlist:

- default: agent workspace root only
- if `allowOutsideWorkspace=true`: full host root allowed
- extra allowed roots: enabled skill directories

## Realtime (WebSocket)

Endpoint: `GET /ws`

Client messages:

```json
{ "type": "subscribe", "topic": "channel:..." }
{ "type": "unsubscribe", "topic": "channel:..." }
{ "type": "ping" }
```

Server messages:

```json
{ "type": "subscribed", "topic": "..." }
{ "type": "event", "topic": "...", "data": { "...": "..." } }
{ "type": "process_output", "topic": "process:...", "data": { "...": "..." } }
{ "type": "agent_status", "topic": "org:agentStatus", "data": { "...": "..." } }
{ "type": "dashboard_refresh", "topic": "org:dashboard", "data": { "...": "..." } }
{ "type": "error", "message": "..." }
```

Published topics include:

- `org:events`
- `channel:<channelId>`
- `process:<processId>`
- `org:agentStatus`
- `org:dashboard`
- `agent:<name>`-style source topics for agent-sourced events

## HTTP API Surface

### Auth / Humans

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `PATCH /api/auth/profile`
- `GET /api/humans`
- `POST /api/humans/invite`

### Models

- `GET /api/models`
- `POST /api/models`
- `PATCH /api/models/:id`

### Agents

- `GET /api/agents`
- `POST /api/agents`
- `GET /api/agents/:name`
- `PATCH /api/agents/:name`
- supports `assignedRunnerId` on create/update/read
- supports `GET /api/agents?assignedRunnerId=<runnerId>` filtering
- supports `GET /api/agents?assignedRunnerId=<runnerId>&includeUnassigned=1`
- `POST /api/agents/:name/:action` where action is one of:
  - `start`, `stop`, `restart`, `reload-skills`, `cleanup-workspace`
- debug endpoint:
  - `GET /api/agents/:name/debug/system-prompt`
- workspace browser endpoints:
  - `GET /api/agents/:name/workspace`
  - `GET /api/agents/:name/workspace/file`
  - `GET /api/agents/:name/workspace/download`

### Teams / Channels / Conversations

- teams:
  - `GET /api/teams`, `POST /api/teams`, `PATCH /api/teams/:id`, `DELETE /api/teams/:id`
  - `POST /api/teams/:id/delete` (compat)
  - membership: list/add/remove endpoints
- channels:
  - CRUD/list/clear: `GET/POST/PATCH/DELETE /api/channels...`
  - participant management via subscribe/unsubscribe endpoints
  - direct channel creation:
    - `POST /api/channels/direct`
    - `POST /api/channels/direct/human-agent`
    - `POST /api/channels/direct/agent-agent`
- conversations/threads:
  - `GET /api/conversations`, `POST /api/conversations`
  - `GET /api/conversations/:id/threads`, `POST /api/conversations/:id/threads`

### Events

- `POST /api/events`
- `GET /api/events`
- `GET /api/events/:id`
- `PATCH /api/events/:id` (future scheduled `PENDING` events only)
- `POST /api/events/:id/ack`
- `POST /api/events/:id/fail`
- `DELETE /api/events` (filtered or all clear)
- `DELETE /api/events/:id` (future scheduled `PENDING` events only)
- `DELETE /api/channels/:channelId/messages`
- `GET /api/event-types`

### Memory

- channel memory:
  - `GET /api/memory/channel/recent`
  - `PUT /api/memory/channel/recent`
  - `GET /api/memory/channel/full`
  - `PUT /api/memory/channel/full`
- cross-channel memory:
  - `GET /api/memory/cross/recent`
  - `PUT /api/memory/cross/recent`
  - `GET /api/memory/cross/full`
  - `PUT /api/memory/cross/full`
- maintenance:
  - `DELETE /api/memory`

### Runtime/Processes/Files

- files: upload/get/meta
- processes:
  - list/create/delete single/delete bulk
  - append output, mark exit, read output stream tail

### Secrets / Skills

- secrets:
  - `GET /api/secrets`
  - `GET /api/secrets/keys`
  - `POST /api/secrets`
  - `DELETE /api/secrets/:id`
  - `DELETE /api/secrets` (by key/scope tuple)
  - `GET /api/secrets/env` (runner auth only)
- skills:
  - `GET /api/skills`

### Runners

- `GET /api/runners`
- `GET /api/runners/setup-config` (authenticated human users)
- `POST /api/runners/register` (runner auth; register/re-register)
- `POST /api/runners/:id/heartbeat` (runner auth)
- `DELETE /api/runners/:id` (also unassigns pinned agents from deleted runner)

## Agent Runner Behavior

Runner loop:

1. Poll agents from API.
2. Register runner identity at API on startup and persist stable runner ID locally.
3. Select only agents assigned to this runner ID.
4. For each `desired_state=RUNNING` agent:
   - ensure workspace exists
   - heartbeat runtime state to API
   - emit one-time lifecycle bootstrap event (`agent.lifecycle.started`)
5. Pull pending events with per-agent receipt semantics.
6. Filter control/audit/self-authored/agent-authored events.
7. Group remaining pending events by channel and process each channel as a single handling batch.
8. Build context from system prompt + bounded channel history + skills + soul, plus a synthetic merged-trigger message when a batch contains multiple events.
9. Run model generation in step mode (single-step/attempt calls) and poll pending events for the same `(agent, channel)` between attempts; newly arrived events are merged into subsequent attempt context.
10. Execute one of two modes:
   - `CLASSIC`: call LLM, enforce JSON event output with retries, validate and emit.
   - `RLM_REPL`: run recursive REPL loop in child process with explicit `done(result)`.
11. On handler failure, call `/api/events/:id/fail` for each event in the failed channel batch.

Shutdown behavior:

- stops RLM children
- terminates tracked long-running processes

## Runner Tooling

Current tool families exposed to models:

- `shell_run` (timeout enforced; default 45s; accepts `timeoutMs`; force-kills on timeout)
- `fs_read`, `fs_write`, `fs_list`, `fs_stat`, `fs_mkdir`, `fs_rm`, `fs_move`
- `shell_start`, `shell_stop`, `shell_status`, `shell_tail`
- event/navigation helpers:
  - `events_emit`
  - `events_channel_messages`, `events_search`, `events_agents_search`
  - `events_channel_create`, `events_channel_update`, `events_channel_delete`
  - `events_channel_participants`, `events_channel_participant_add`, `events_channel_participant_remove`
  - `events_channels_list`, `events_event_types`, `events_scheduled_create`, `events_schedule_self`

Audit events are emitted around tool/process operations and RLM execution.

## OpsCLI Behavior

`apps/opscli` is a lightweight standalone RLM runtime for bootstrap/maintenance.

- persistent Node VM runtime session
- LLM emits one JS snippet per step
- built-in REPL methods:
  - `shell(command)`
  - `print(...args)`
  - `input(question)`
  - `finish()`
  - `clear()`
  - `exit(code)`
- supports empty initial goal and interactive goal gathering via `input(...)`
- maintains rolling summarization and context-capped recent messages

## Delivery and Failure Semantics

- at-least-once delivery model
- per-agent delivery tracking through `event_receipts`
- idempotency supported with `idempotencyKey`
- scheduled delivery via `deliverAt`
- failure escalation via `/api/events/:id/fail` until dead-letter (`event.deadlettered`) at configured threshold

## Environment Variables (Implemented)

- `PORT`
- `ORGOPS_API_URL`
- `ORGOPS_RUNNER_TOKEN`
- `ORGOPS_RUNNER_ID_FILE`
- `ORGOPS_RUNNER_NAME`
- `ORGOPS_ADMIN_USER`, `ORGOPS_ADMIN_PASS`
- `ORGOPS_MASTER_KEY`
- `ORGOPS_COOKIE_SECURE`
- `ORGOPS_EVENT_MAX_FAILURES`
- `ORGOPS_EVENT_SHAPES_CACHE_TTL_MS`
- `ORGOPS_RUNNER_ONLINE_THRESHOLD_MS`
- `ORGOPS_PROJECT_ROOT`
- `ORGOPS_LLM_STUB`
- `ORGOPS_LLM_CALL_TIMEOUT_MS`
- `ORGOPS_HISTORY_MAX_EVENTS`, `ORGOPS_HISTORY_MAX_CHARS`
- `ORGOPS_CHANNEL_RECENT_MEMORY_INTERVAL_MS`
- `ORGOPS_CHANNEL_FULL_MEMORY_INTERVAL_MS`
- `ORGOPS_CROSS_RECENT_MEMORY_INTERVAL_MS`
- `ORGOPS_CROSS_FULL_MEMORY_INTERVAL_MS`
- `ORGOPS_AGENT_INTENT_TIMEOUT_MS`
- `ORGOPS_AGENT_INTENT_MAX_TIMEOUTS`
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`
- `OPENROUTER_BASE_URL`, `OPENROUTER_HTTP_REFERER`, `OPENROUTER_APP_TITLE`
- `ORGOPS_GIT_BASH_PATH`
- `ORGOPS_SHELL_PATH`, `ORGOPS_SHELL_ARGS`
- `ORGOPS_SHELL_TIMEOUT_KILL_GRACE_MS`
- UI build/runtime config:
  - `VITE_API_BASE_URL`
  - `VITE_WS_BASE_URL`
  - optional runtime override: `window.__ORGOPS_UI_CONFIG__ = { apiBaseUrl, wsBaseUrl }`
- RLM controls:
  - `ORGOPS_RLM_MAX_STEPS`
  - `ORGOPS_RLM_MAX_OUTPUT_CHARS`
  - `ORGOPS_RLM_MAX_INPUT_CHARS`
  - `ORGOPS_RLM_PROMPT_PREVIEW_MAX_CHARS`
  - `ORGOPS_RLM_EVAL_TIMEOUT_MS`
  - `ORGOPS_RLM_MAX_SUBAGENT_DEPTH`
  - `ORGOPS_RLM_MAX_SUBAGENTS_PER_EVENT`
- OpsCLI controls:
  - `ORGOPS_OPSCLI_MODEL`
  - `ORGOPS_OPSCLI_MAX_STEPS`
  - `ORGOPS_OPSCLI_COMMAND_TIMEOUT_MS`
  - `ORGOPS_OPSCLI_EVAL_TIMEOUT_MS`
  - `ORGOPS_OPSCLI_EVAL_CALLBACK_TIMEOUT_MS`
  - `ORGOPS_OPSCLI_MAX_CONTEXT_CHARS`
  - `ORGOPS_OPSCLI_MAX_SUMMARY_CHARS`
  - `ORGOPS_OPSCLI_SUMMARY_CHUNK_MESSAGES`
  - `ORGOPS_OPSCLI_MIN_RECENT_MESSAGES`
  - `ORGOPS_OPSCLI_MAX_SYSTEM_DOC_CHARS`
  - `ORGOPS_OPSCLI_DEBUG`
  - `ORGOPS_OPSCLI_PROGRESS`
  - `ORGOPS_OPSCLI_SPINNER`
  - `ORGOPS_OPSCLI_LOG_PATH`
  - `ORGOPS_OPSCLI_DOUBLE_SIGINT_MS`
  - `ORGOPS_EXTRACTED_ROOT` (auto-managed by OpsCLI)
