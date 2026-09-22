# OrgOps Implementation Spec (Current)

## Goal

OrgOps is a Node.js multi-host system where humans and agents collaborate through an event bus persisted in SQLite. Agents can execute shell/filesystem/process tools, emit typed events, and stream process output to API/WebSocket clients.

This document describes the current implementation in this repository.

## Stack

- Runtime: Node.js (monorepo, npm workspaces)
- API: Hono + `@hono/node-ws`
- DB: SQLite + Drizzle ORM
- Realtime: WebSocket topic pub/sub via in-process event bus
- UI: React apps for admin and lightweight user workflows
- LLM wrapper: `@orgops/llm` (`generate()` abstraction)
- Schemas/validation: Zod-based event shapes in `@orgops/schemas`

## Monorepo Layout

```text
apps/
  api/            Hono HTTP + WS server
  agent-runner/   Agent polling loop + tool/runtime execution
  opscli/         Host bootstrap/maintenance CLI (deterministic commands + optional chat)
  admin-ui/       React + Tailwind admin UI
  user-ui/        Lightweight user UI
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
- mode/state: `mode` (`CLASSIC` | `RLM_REPL` | `WRAPPED`), `desired_state`, `runtime_state`, `last_heartbeat_at`
- host assignment: `assigned_runner_id` (nullable; when set, only matching runner executes the agent)
- skills: `enabled_skills_json`, `always_preloaded_skills_json`
- wrapped runtime config: `wrapped_config_json` (JSON object; used only by `WRAPPED` mode)

`WRAPPED` agents are orgops-owned lifecycle records whose turns are delegated to an external runtime. They do not use orgops memory summaries, prompt composition, skills, model calls, or `allow_outside_workspace` for turn handling. The wrapped runtime owns its own session/memory/tool state and filesystem policy. The normal `soul_path` / `soul_contents` fields may still be stored on the agent row for humans, opscli, and native management agents; the wrapper runner does not automatically inject them. The creator of the wrapped agent should translate those native fields into the selected harness configuration/setup/runtime behavior when that harness needs a soul file or prompt seed.

Example wrapped config:

```json
{
  "kind": "openclaw",
  "harness": "command",
  "source": {
    "type": "github",
    "repo": "openclaw/openclaw",
    "ref": "main",
    "updateOnStart": false
  },
  "setup": {
    "checkCommand": "test -d node_modules",
    "command": "npm install && npx openclaw setup && npx openclaw models set openai/gpt-4o-mini",
    "timeoutMs": 600000
  },
  "sidecars": [
    {
      "name": "gateway",
      "command": "npx openclaw gateway --force",
      "restart": true,
      "restartDelayMs": 2000,
      "timeoutMs": 0
    }
  ],
  "runtime": {
    "command": "npx openclaw agent --agent main --session-id \"$ORGOPS_WRAPPED_SESSION_ID\" --message \"$ORGOPS_WRAPPED_MESSAGE\" --json",
    "parse": "json-payloads",
    "timeoutMs": 600000
  },
  "secrets": {
    "allowedKeys": ["OPENAI_*", "TAVILY_API_KEY"],
    "deniedKeys": ["TAVILY_*"]
  },
  "session": {
    "scope": "per-channel"
  }
}
```

Supported recipe fields:

- `kind`: human/discovery label such as `openclaw`, `codex`, or `custom`.
- `harness`: implementation boundary used by the runner. Default is `command`; `cli` is accepted as an alias for `command`.
- `source`: optional checkout source. `type: "github"` with `repo` clones into the agent workspace under `wrapped-sources/`; `path` can point to an existing local source checkout.
- `setup.checkCommand`: optional command; exit code `0` skips setup.
- `setup.command`: optional idempotent setup/install command.
- `sidecars`: optional long-running commands started before turns, such as the OpenClaw Gateway.
- `runtime.command`: required command for handling a turn.
- `runtime.parse`: `json-payloads` extracts OpenClaw-style `payloads[].text`; `text` returns stdout; omitted tries JSON payloads and falls back to text.
- `secrets.allowedKeys`: optional env-key allowlist (exact keys or `*` wildcard patterns) applied to wrapped secret injection.
- `secrets.deniedKeys`: optional env-key denylist (exact keys or `*` wildcard patterns) applied after allowlist.
- `session.scope`: `per-channel` (default) or `per-agent`.

OpenClaw is an optional wrapped runtime and is not installed as an OrgOps dependency. A recipe must install it in the agent workspace during `setup` or provide an OpenClaw source checkout. OpenClaw recipes should configure the target agent's default model during setup rather than relying on OpenClaw package defaults. Runtime `--model` overrides are subject to the target agent's model allowlist and may be rejected unless setup has added that model first.

**Breaking-change migration:** existing OpenClaw wrapped agents that relied on OrgOps' root installation must update their stored `wrappedConfig` before upgrading. Add an explicit setup in the same directory used by the sidecar and runtime commands:

```json
{
  "setup": {
    "checkCommand": "test -x node_modules/.bin/openclaw",
    "command": "npm install --no-save openclaw@<version>",
    "cwd": ".orgops-data/workspaces/<agent-name>/wrapper",
    "timeoutMs": 600000
  }
}
```

Replace `<version>` with the OpenClaw version the agent should run. Agents whose recipes already install OpenClaw locally or use an OpenClaw source checkout do not require migration.

Commands run with the agent workspace/source directory as cwd unless overridden and receive environment variables:

- `ORGOPS_PROJECT_ROOT`
- `ORGOPS_WRAPPED_AGENT_NAME`
- `ORGOPS_WRAPPED_KIND`
- `ORGOPS_WRAPPED_WORKSPACE_PATH`
- `ORGOPS_WRAPPED_CHANNEL_ID` (turn commands)
- `ORGOPS_WRAPPED_SESSION_ID` (turn commands)
- `ORGOPS_WRAPPED_MESSAGE` (turn commands)
- `ORGOPS_WRAPPED_TRIGGER_EVENT_ID` (turn commands)
- `ORGOPS_WRAPPED_SOURCE_DIR` (when a source checkout is configured)

Resolved runtime secrets are injected into setup and turn command environments using precedence `private > team > public > package(legacy)`.

Wrapper harness implementation:

- Runner orchestration lives in `apps/agent-runner/src/wrapped-runtime.ts`.
- Harness contracts live in `apps/agent-runner/src/wrapper-harness/types.ts`.
- Built-in harness registration lives in `apps/agent-runner/src/wrapper-harness/registry.ts`.
- The default command recipe implementation lives in `apps/agent-runner/src/wrapper-harness/command.ts`.

Harnesses implement:

- `canHandle(config)`: decide whether a normalized `wrappedConfig` belongs to this harness.
- `ensureReady({ ctx, agent, config })`: detect/install/setup/start lifecycle prerequisites.
- `runTurn({ ctx, agent, config, events, triggerEvent, channelId, message, sessionId })`: send a turn to the external runtime and return normalized output.

Future SDK, HTTP, WebSocket, daemon, or MCP runtimes should add harness modules rather than expanding `wrapped-runtime.ts`. The command harness remains the portable fallback for repo-generated wrappers and simple CLI agents.

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
- `channel_subscriptions`: channel participants/subscribers (`AGENT`, `HUMAN`, `TEAM`)
- `channel_viewers`: read-only channel shares (`AGENT`, `HUMAN`)
- `channel_share_links`: tokenized invite links that let an authenticated human self-claim read-only access
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

### Agent Invites / Runner Tokens

- `agent_invites`: wrapped-agent bootstrap invites (hashed token, optional scoped channel set, invite-time agent visibility, creator metadata for human/agent callers, optional wrapped config, expiry, usage count)
- `runner_tokens`: hashed runner credentials, including invite-scoped tokens bound to a single `agent_name` and `runner_id`

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

### Channel Visibility Rules

- `PUBLIC` channels are visible to all authenticated humans.
- `PRIVATE` channels are visible to:
  - the owner (`channels.owner_human_id`)
  - explicitly subscribed humans (`channel_subscriptions` with `subscriber_type=HUMAN`)
  - humans who belong to a subscribed team (`channel_subscriptions` with `subscriber_type=TEAM` + `team_memberships`)
  - explicitly shared human viewers (`channel_viewers` with `viewer_type=HUMAN`)
- `channel_viewers` grants read-only visibility. Shared viewers can read channel metadata/messages but cannot post events or mutate channel participants/settings.
- `channel_share_links` are claim tokens. Visiting a link and calling the claim endpoint adds the authenticated human to `channel_viewers`.

### Runner Auth

- Trusted runner token header: `x-orgops-runner-token`
- Runner-only endpoint for secret env injection: `GET /api/secrets/env`
- Runner secret env requests must include `x-orgops-agent-name`; optional `x-orgops-channel-id` enables team-scope resolution for that channel context.
- Invite redemption can mint runner tokens in either mode:
  - `SCOPED` (default): restricted to one agent and one runner ID, and by default restricted to invite-approved channels.
  - `GLOBAL`: behaves like a normal unrestricted runner token (full runner access).
- `POST /api/agent-invites` accepts authenticated humans and runner-authenticated agents.
- Scoped invites can later be promoted to global mode with `POST /api/agent-invites/:id/promote-global`; this updates the invite and any non-revoked redeemed runner tokens from that invite.

### Tool Filesystem Access

Runner tools resolve paths through an allowlist:

- default: agent workspace root only
- if `allowOutsideWorkspace=true`: full host root allowed
- extra allowed roots: enabled skill directories

This applies to native OrgOps tools only. `WRAPPED` agents do not use OrgOps tool filesystem access; their external runtime enforces its own filesystem policy.

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

For non-runner websocket clients, `event` messages with future `deliverAt` are deferred and delivered when due (`deliverAt <= now`) to match non-runner `GET /api/events` visibility while preserving realtime pacing for scheduled events. Runner-authenticated websocket clients still receive future scheduled events immediately.

Published topics include:

- `org:events`
- `channel:<channelId>`
- `process:<processId>`
- `org:agentStatus`
- `org:dashboard`
- `agent:<name>`-style source topics for agent-sourced events

## HTTP API Surface

### Infra

- `GET /health` (unauthenticated API liveness endpoint)

### Auth / Humans

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `PATCH /api/auth/profile`
- `GET /api/humans`
- `POST /api/humans/invite`
- `POST /api/humans/:id/reset-temp-password`
- wrapped-agent invites:
  - `GET /api/agent-invites`
  - `POST /api/agent-invites`
  - `POST /api/agent-invites/:id/revoke`
  - `POST /api/agent-invites/:id/reissue` (rotates token; old link invalid)
  - `POST /api/agent-invites/:id/promote-global` (switches scoped invite/tokens to global mode)
  - `GET /api/agent-invites/public/:token` (public)
  - `POST /api/agent-invites/public/:token/redeem` (public)
  - `channelIds` is optional on create (invite may grant lifecycle-only bootstrap access)
  - create payload supports `visibility` (`PUBLIC`/`PRIVATE`) applied to the wrapped agent at redeem time
  - create payload supports `runnerScopeMode` (`SCOPED` default, or `GLOBAL`)
  - invite list/create responses include creator metadata (`createdByType`, `createdById`)
  - invite links are resolved from request origin (`x-forwarded-*` or request URL), not hardcoded localhost
  - public invite/redeem responses include bootstrap hints (`wrappedConfigSchema`, patch endpoint, and session-memory guidance)

### Embed / v1 (integration API keys)

- `GET /v1/me` (Bearer integration key)
- `POST /v1/conversations`
- `GET /v1/conversations/:id`
- `POST /v1/chat/completions` (`conversation` required; waits for the agent reply)
  - accepts text-only user messages and mixed content arrays (for example `text` + `image_url`)
  - supports optional top-level `attachments` array (`[{ fileId, ... }]`)
  - attachment references are normalized from `messages[].content` or `attachments`, then persisted on the emitted `message.created` payload as `payload.attachments[]` with file metadata
- Admin key management: `GET/POST /api/integration-keys`, `POST /api/integration-keys/:id/revoke`
- Integrator prompt: copy from admin UI → API keys

### Models

- `GET /api/models`
- `POST /api/models`
- `PATCH /api/models/:id`

### Agents

- `GET /api/agents`
- `POST /api/agents`
- `GET /api/agents/:name`
- `PATCH /api/agents/:name`
  - changing an agent's `name` via patch is currently rejected (rename unsupported)
- supports `assignedRunnerId` on create/update/read
- supports `wrappedConfig` JSON object/string on create/update/read
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
  - `GET /api/teams/me` (returns current authenticated human's teams)
  - membership: list/add/remove endpoints
- channels:
  - CRUD/list/clear: `GET/POST/PATCH/DELETE /api/channels...`
  - `GET /api/channels` includes `participants[]`, `shares[]`, plus per-request booleans `canPost` and `canManage`
  - `PATCH /api/channels/:id` supports `name`, `description`, `metadata`, and `visibility` (`PUBLIC`/`PRIVATE`)
  - participant management via subscribe/unsubscribe endpoints (`AGENT`, `HUMAN`, `TEAM`)
  - read-only share management:
    - `GET /api/channels/:id/shares`
    - `POST /api/channels/:id/share` (`viewerType`: `AGENT`/`HUMAN`)
    - `POST /api/channels/:id/unshare`
  - tokenized share-link flow:
    - `POST /api/channels/:id/share-link` (creates a claim token)
    - `POST /api/channel-share-links/:token/claim` (authenticated human claims viewer access)
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
  - query supports filters (`channelId`, `type`, `source`, `status`, `after`, `before`, `limit`, `order`)
  - `scheduled=1` returns future pending scheduled events
  - `scheduled=1&includeConsumed=1` returns scheduled history (both future and consumed)
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
  - scope types: `public`, `team`, `private` (`package` remains supported as legacy compatibility scope)
  - env resolution precedence: `private > team > public > package(legacy)`
- skills:
  - `GET /api/skills`

### Runners

- `GET /api/runners`
- `GET /api/runners/setup-config` (authenticated human users)
- `POST /api/runners/invites` (authenticated human users; creates scoped runner bootstrap invite)
- `GET /api/runners/invites/:token` (public invite bootstrap payload for opscli)
- `POST /api/runners/register` (runner auth; register/re-register)
- `PATCH /api/runners/:id` (authenticated human users; rename runner display name)
- `POST /api/runners/:id/heartbeat` (runner auth)
- `DELETE /api/runners/:id` (also unassigns pinned agents from deleted runner)
- scoped runner tokens must register/heartbeat only the runner ID bound into their scope

## Agent Runner Behavior

Runner loop:

1. Poll agents from API.
2. Register runner identity at API on startup and persist stable runner ID locally.
3. Select only agents assigned to this runner ID.
4. For each `desired_state=RUNNING` agent:
   - ensure workspace exists
   - heartbeat runtime state to API
   - emit one-time lifecycle bootstrap event (`agent.lifecycle.started`) for native modes, or run wrapped lifecycle setup for `WRAPPED`
5. Pull pending events with per-agent receipt semantics.
6. Filter control/audit/self-authored/agent-authored events.
7. Group remaining pending events by channel and process each channel as a single handling batch.
8. Execute by agent mode:
   - `CLASSIC`: call LLM, enforce JSON event output with retries, validate and emit.
   - `RLM_REPL`: run recursive REPL loop in child process with explicit `done(result)`.
   - `WRAPPED`: skip orgops memory/prompt/skills/model calls and run the configured external runtime recipe.
9. For native modes, build context from system prompt + bounded channel history + skills + soul, plus a synthetic merged-trigger message when a batch contains multiple events.
10. For native modes, run model generation in step mode (single-step/attempt calls) and poll pending events for the same `(agent, channel)` between attempts; newly arrived events are merged into subsequent attempt context.
11. On handler failure, call `/api/events/:id/fail` for each event in the failed channel batch.

Wrapped lifecycle:

1. When a `WRAPPED` agent first reaches `desired_state=RUNNING`, the runner resolves its `wrappedConfig` and selects a wrapper harness.
2. The selected harness owns setup. For the built-in `command` harness, `source.type="github"` clones the repo into the agent workspace if missing.
3. For the built-in `command` harness, `setup.checkCommand` exits `0` to skip setup; otherwise `setup.command` runs when provided.
4. Wrapper lifecycle emits `wrapper.lifecycle.started`, `wrapper.setup.started`, `wrapper.setup.skipped`, `wrapper.setup.completed`, or `wrapper.setup.failed`.
5. On each turn, the runner builds normalized `message` and `sessionId`, then calls the selected harness `runTurn`.
6. Harness output is normalized into `message.created` from `agent:<name>`.
7. Wrapper turn events (`wrapper.turn.started/completed/failed`) are bookkeeping and never wake agents.

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
  - `events_channel_messages`, `events_search`
  - `events_channel_create`, `events_channel_update`, `events_channel_delete`
  - `events_channel_participants`, `events_channel_participant_add`, `events_channel_participant_remove`
  - `events_channels_list`, `events_event_types`, `events_scheduled_create`, `events_schedule_self`
- agent management helpers:
  - `agents_search`, `agents_create`

Audit events are emitted around tool/process operations and RLM execution.

## OpsCLI Behavior

`apps/opscli` is a standalone host bootstrap/maintenance CLI with deterministic commands and an optional chat loop.

- deterministic commands:
  - `install` (prereq checks + clone/pull repo + `npm ci` + component-scoped build/config)
  - `upgrade` (safety backup + component-scoped stop/update + optional restart)
  - `doctor` (host prerequisite check)
  - `start` / `stop` / `status` for selected components (`api`, `runner`, `user-ui`, `admin-ui`)
  - `admin open` / `admin stop` / `admin status` convenience wrappers for `admin-ui`
  - `service register` to register/start OS-specific auto-start for user stack without install/upgrade
  - `service unregister` to remove OS-specific auto-start for user stack without install/upgrade
  - `shortcut create` to create a cross-OS desktop shortcut for `user-ui` or `admin-ui` without install/upgrade
  - install/upgrade support runner bootstrap via:
    - explicit `--runner-api-url` + `--runner-token` (+ optional `--runner-name`)
    - invite bootstrap URL from `GET /api/runners/invites/:token`
- optional `chat` command:
  - plain tool-calling loop (`shell`, `askPassword`, `getBundledDocs`, `exitOpscli`)
  - rolling summarization + context-capped history
  - prompts for provider API keys only in chat mode
- release build embeds docs/build metadata for chat context (not a full source snapshot)
- auto-start registration is OS-specific:
  - macOS LaunchAgent
  - Linux systemd user service
  - Windows Scheduled Task

Security note: wrapped `source`, `setup.command`, and `runtime.command` are host code execution. Native orgops agents and opscli should treat GitHub-derived wrapper recipes as privileged changes and should prefer explicit user approval or trusted repo allowlists before enabling them on shared hosts.

## Delivery and Failure Semantics

- at-least-once delivery model
- per-agent delivery tracking through `event_receipts`
- idempotency supported with `idempotencyKey`
- scheduled delivery via `deliverAt`
- failure escalation via `/api/events/:id/fail` until dead-letter (`event.deadlettered`) at configured threshold

## Container Runtime (Single Image)

- Root `Dockerfile` builds a single reusable image containing `api`, `agent-runner`, `admin-ui`, and `user-ui`.
- `docker/entrypoint.sh` supports runtime component selection through `ORGOPS_COMPONENTS` (CSV of `api`, `runner`, `admin-ui`, `user-ui`).
- When any HTTP-serving component is enabled, HAProxy runs in-container as the public listener (default port `8787`) and routes:
  - `/api`, `/ws`, `/health` -> API backend
  - `/admin` -> admin UI preview backend
  - `/` -> user UI preview backend (fallback order: user UI -> admin UI -> API)
- Runner startup waits for local API readiness only when both `api` and `runner` are enabled in the same container.
- Runtime state persists through `/app/.orgops-data` and `/app/files` volumes.

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
  - for native/wrapped runtime execution with injected env, provider keys are loaded from resolved secrets and do not fall back to host process env
- `OPENROUTER_BASE_URL`, `OPENROUTER_HTTP_REFERER`, `OPENROUTER_APP_TITLE`
- `ORGOPS_GIT_BASH_PATH`
- `ORGOPS_SHELL_PATH`, `ORGOPS_SHELL_ARGS`
- `ORGOPS_SHELL_TIMEOUT_KILL_GRACE_MS`
- Admin UI build/runtime config:
  - `VITE_API_BASE_URL`
  - `VITE_WS_BASE_URL`
  - `VITE_UI_BASE_PATH`
  - optional runtime override: `window.__ORGOPS_UI_CONFIG__ = { apiBaseUrl, wsBaseUrl }`
- User UI build/runtime config:
  - `VITE_API_BASE_URL`
  - `VITE_WS_BASE_URL`
  - `VITE_UI_BASE_PATH`
  - optional runtime override: `window.__ORGOPS_USER_UI_CONFIG__ = { apiBaseUrl, wsBaseUrl }`
- Container entrypoint controls:
  - `ORGOPS_COMPONENTS`
  - `ORGOPS_PROXY_PORT`
  - `ORGOPS_INTERNAL_API_PORT`
  - `ORGOPS_INTERNAL_ADMIN_UI_PORT`
  - `ORGOPS_INTERNAL_USER_UI_PORT`
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
  - `ORGOPS_OPSCLI_TOOL_LOOP_MAX_STEPS`
  - `ORGOPS_OPSCLI_COMMAND_TIMEOUT_MS`
  - `ORGOPS_OPSCLI_MAX_CONTEXT_CHARS`
  - `ORGOPS_OPSCLI_MAX_SUMMARY_CHARS`
  - `ORGOPS_OPSCLI_SUMMARY_CHUNK_MESSAGES`
  - `ORGOPS_OPSCLI_MIN_RECENT_MESSAGES`
  - `ORGOPS_OPSCLI_MAX_SYSTEM_DOC_CHARS`
  - `ORGOPS_OPSCLI_PROGRESS`
  - `ORGOPS_OPSCLI_SPINNER`
  - `ORGOPS_OPSCLI_LOG_PATH`
  - `ORGOPS_OPSCLI_DOUBLE_SIGINT_MS`
