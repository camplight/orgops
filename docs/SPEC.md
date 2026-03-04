# OrgOps MVP SPEC (builder-ready)

## Goal

Build **OrgOps**: a single-company, single-VPS system where **humans and autonomous agents** collaborate via an **event bus**. Agents can run **host-wide shell and filesystem operations** (root), manage **long-running processes**, and stream outputs back to humans/models. The MVP prioritizes **verified ingress + mandatory audit logging** over sandboxing.

## Non-goals (MVP)

- Multi-company / multi-tenant
- Sandbox/guardrails for shell/fs (explicitly not desired in MVP)
- Horizontal scaling / multi-node
- Perfect “exactly once” delivery (use at-least-once + idempotency)

## Tech stack

- Runtime: **Bun**
- API framework: **Hono** (HTTP JSON)
- Realtime: **WebSocket** (single `/ws` endpoint + topic pub/sub)
- DB: **SQLite** (WAL enabled)
- UI: **React + Tailwind**
- LLM abstraction: **Vercel AI SDK** (library only; no gateway dependency)
- Repo: **Monorepo** with shared packages

## Repository layout (monorepo)

```
orgops/
  apps/
    api/                  # Hono HTTP + WS server, single-writer DB access
    ui/                   # React + Tailwind SPA
    agent-runner/         # One daemon supervises all agents, executes tools, LLM loop
    webhook-ingest/       # Verified webhook endpoints (or merge into api for MVP)
  packages/
    db/                   # schema, migrations, query helpers
    schemas/              # Zod schemas for API payloads + events
    event-bus/            # topic routing helpers, pub/sub interface
    llm/                  # AI SDK provider wrapper + model registry resolver
    crypto/               # secrets encryption helpers
    skills/               # skill indexing + metadata parsing
  event-types/            # event type docs
  files/                  # runtime files (gitignored)
  .orgops-data/           # runtime data (gitignored)
    orgops.sqlite
    workspaces/
```

**MVP simplification:** you may merge `webhook-ingest` into `apps/api` as `/api/webhooks/*`.

## Core concepts

### Agent

- Unique `name` (globally unique within org)
- Has:
  - `soul.md` path (role)
  - `systemInstructions` (string)
  - `skills` (references to skill directories)
  - `modelId` (from Model Registry)
  - `workspacePath` (created if missing)
  - memberships: can be in multiple teams

### Skill (NOT a tool)

A skill is a folder with docs + optional runnable assets.

```
skills/<skillName>/
  SKILL.md
  assets/...
```

`SKILL.md` format (OpenCode/OpenClaw-style YAML frontmatter):

```
---
name: example-skill
description: Example skill docs.
metadata: {"openclaw":{"requires":{"env":["ORGOPS_RUNNER_TOKEN"]}}}
---

# Example Skill
...full docs...
```

Each skill should expose one interface style: either HTTP API usage or CLI usage. Do not include both in one skill.

Agents receive a **short skill catalog** in prompt (name/description/location/path). If they need details, they use fs tools to read `SKILL.md`. If an executable is missing, they attempt install via shell and proceed.

### Tools (primitive runtime capabilities)

Only these are “tools” the runtime exposes to the agent reasoning loop:

- `shell_run` (bounded command)
- `proc_start|proc_stop|proc_status|proc_tail` (long-running process mgmt; can be backed by PTY)
- `fs_read|fs_write|fs_list|fs_stat|fs_mkdir|fs_rm|fs_move` (host-wide for MVP)

Optional convenience: `orgops.request` (HTTP call helper), but agent can also `curl`.

> browser-use is a skill (docs + scripts), executed via shell.

### Event

Append-only record of “something happened” (ingress, message, task, process output, etc.)

Mandatory fields:

- `id`
- `type`
- `payload` (JSON)
- `source` (e.g., `human:<username>`, `agent:<name>`, `webhook:<name>`, `system`)
- routing:
  - `channelId` (required for `message.created`; direct messages are channels)
  - `teamId?`
- threading:
  - `parentEventId?`
- delivery:
  - `deliverAt?` (for scheduled delivery)
  - `status` (`PENDING|DELIVERED|ACKED|FAILED|DEAD`)
- `idempotencyKey?` (for webhook/retry safety)

## Database (SQLite)

### SQLite settings (on boot)

- `PRAGMA journal_mode=WAL;`
- `PRAGMA synchronous=NORMAL;` (or `FULL` if you prefer durability)
- `PRAGMA busy_timeout=5000;` (plus app-level retry)
- All writes go through **API process** (single-writer discipline).

### Tables (minimum)

#### `agents`

- `id` TEXT PK (uuid)
- `name` TEXT UNIQUE NOT NULL
- `icon` TEXT NULL
- `description` TEXT NULL
- `model_id` TEXT NOT NULL
- `system_instructions` TEXT NOT NULL DEFAULT ''
- `soul_path` TEXT NOT NULL
- `workspace_path` TEXT NOT NULL
- `desired_state` TEXT NOT NULL DEFAULT 'RUNNING' -- RUNNING|STOPPED
- `runtime_state` TEXT NOT NULL DEFAULT 'STOPPED' -- STARTING|RUNNING|STOPPED|CRASHED
- `last_heartbeat_at` INTEGER NULL
- `created_at` INTEGER NOT NULL
- `updated_at` INTEGER NOT NULL

#### `teams`

- `id` TEXT PK
- `name` TEXT UNIQUE NOT NULL
- `description` TEXT NULL
- `created_at` INTEGER NOT NULL

#### `team_memberships`

- `team_id` TEXT NOT NULL
- `member_type` TEXT NOT NULL -- HUMAN|AGENT
- `member_id` TEXT NOT NULL -- humanId or agentId
- PK (`team_id`, `member_type`, `member_id`)

#### `channels`

- `id` TEXT PK
- `name` TEXT UNIQUE NOT NULL
- `description` TEXT NULL
- `created_at` INTEGER NOT NULL

#### `channel_subscriptions`

- `channel_id` TEXT NOT NULL
- `subscriber_type` TEXT NOT NULL -- HUMAN|AGENT|TEAM
- `subscriber_id` TEXT NOT NULL
- PK (`channel_id`, `subscriber_type`, `subscriber_id`)

#### `conversations`

- `id` TEXT PK
- `kind` TEXT NOT NULL -- HUMAN_AGENT | HUMAN_CHANNEL
- `human_id` TEXT NOT NULL
- `agent_name` TEXT NULL
- `channel_id` TEXT NULL
- `title` TEXT NULL
- `created_at` INTEGER NOT NULL

#### `threads`

- `id` TEXT PK
- `conversation_id` TEXT NOT NULL
- `title` TEXT NULL
- `created_at` INTEGER NOT NULL

#### `events`

- `id` TEXT PK
- `type` TEXT NOT NULL
- `payload_json` TEXT NOT NULL
- `source` TEXT NOT NULL
- `channel_id` TEXT NULL
- `team_id` TEXT NULL
- `parent_event_id` TEXT NULL
- `deliver_at` INTEGER NULL
- `status` TEXT NOT NULL DEFAULT 'PENDING'
- `fail_count` INTEGER NOT NULL DEFAULT 0
- `last_error` TEXT NULL
- `idempotency_key` TEXT NULL
- `created_at` INTEGER NOT NULL

Indexes:

- `idx_events_deliver_at` on (`status`, `deliver_at`)
- `idx_events_channel` on (`channel_id`, `created_at`)
- unique optional: `uidx_events_idempotency` on (`idempotency_key`) where not null

#### `processes`

- `id` TEXT PK
- `agent_name` TEXT NOT NULL
- `channel_id` TEXT NULL
- `cmd` TEXT NOT NULL
- `cwd` TEXT NOT NULL
- `pid` INTEGER NULL
- `state` TEXT NOT NULL -- STARTING|RUNNING|EXITED|FAILED
- `exit_code` INTEGER NULL
- `started_at` INTEGER NOT NULL
- `ended_at` INTEGER NULL

#### `process_output`

- `id` TEXT PK
- `process_id` TEXT NOT NULL
- `seq` INTEGER NOT NULL
- `stream` TEXT NOT NULL -- STDOUT|STDERR
- `text` TEXT NOT NULL
- `ts` INTEGER NOT NULL
  Index: (`process_id`, `seq`) UNIQUE

#### `files`

- `id` TEXT PK
- `storage_path` TEXT NOT NULL
- `original_name` TEXT NOT NULL
- `mime` TEXT NOT NULL
- `size` INTEGER NOT NULL
- `sha256` TEXT NOT NULL
- `created_by_human_id` TEXT NULL
- `created_by_agent_name` TEXT NULL
- `created_at` INTEGER NOT NULL

#### `secrets`

- `id` TEXT PK
- `name` TEXT NOT NULL
- `scope_type` TEXT NOT NULL -- ORG|TEAM|AGENT
- `scope_id` TEXT NULL -- teamId or agentName; null for ORG
- `ciphertext_b64` TEXT NOT NULL
- `created_at` INTEGER NOT NULL
  Unique: (`name`, `scope_type`, `scope_id`)

#### `models`

- `id` TEXT PK -- e.g. openai:gpt-4o-mini
- `provider` TEXT NOT NULL -- openai|anthropic|google|mistral|...
- `model_name` TEXT NOT NULL -- provider native id
- `enabled` INTEGER NOT NULL -- 0/1
- `defaults_json` TEXT NOT NULL
- `created_at` INTEGER NOT NULL

## Secrets encryption (MVP)

- Env var: `ORGOPS_MASTER_KEY` (32 bytes base64)
- Use envelope encryption:
  - AES-256-GCM with random nonce per secret
  - store `{nonce,ciphertext,tag}` as base64 JSON
- Decrypt only in API / agent-runner memory when injecting env.
- **Audit:** every secret read/injection emits `audit.secret.accessed` (no plaintext).

## Event delivery semantics

- **At-least-once** delivery to agents/subscribers.
- Idempotency:
  - ingress/webhooks must use `idempotencyKey` derived from provider event id.
- Scheduling:
  - events with `deliverAt` remain `PENDING` until time <= now.
- Dead-letter:
  - after N failures (config, e.g. 25) set `status=DEAD`, increment `fail_count`, record `last_error`, and emit `event.deadlettered`.

Config:

- `ORGOPS_EVENT_MAX_FAILURES` (default 25)

## Realtime (WebSocket)

### Endpoint

- `GET /ws` (authenticated)

### Messages (client → server)

```
{ "type": "subscribe", "topic": "conversation:CONV_ID" }
{ "type": "unsubscribe", "topic": "conversation:CONV_ID" }
{ "type": "subscribe", "topic": "channel:CHANNEL_ID" }
{ "type": "subscribe", "topic": "process:PROCESS_ID" }
{ "type": "ping" }
```

### Messages (server → client)

```
{ "type": "subscribed", "topic": "conversation:..." }
{ "type": "event", "topic": "conversation:...", "data": { ...event } }
{ "type": "process_output", "topic": "process:...", "data": { "seq":1,"stream":"STDOUT","text":"..." } }
{ "type": "agent_status", "topic": "org:agentStatus", "data": { "agentName":"...", "runtimeState":"RUNNING" } }
{ "type": "error", "message": "..." }
```

### Topic routing rules

- `channel:<id>` receives all events with `channelId`
- `process:<id>` receives `process_output` chunks
- `org:agentStatus` receives agent state updates

**Publishing rule:** API publishes to WS topics only when it successfully commits DB writes.

## HTTP API (Hono)

### Auth (MVP)

- Username/password (single admin user) OR local “invite code” flow
- Session cookie stored server-side (or signed cookie)
- Protect all endpoints except `/api/auth/*` and public file serving (if any)

### Core endpoints

#### Auth

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

#### Models

- `GET /api/models`
- `POST /api/models` (admin)
- `PATCH /api/models/:id` (enable/disable, defaults)

#### Agents

- `GET /api/agents`
- `POST /api/agents`
- `GET /api/agents/:name`
- `PATCH /api/agents/:name`
- `POST /api/agents/:name/start|stop|restart`
- `POST /api/agents/:name/reload-skills`

#### Teams / memberships

- `GET /api/teams`
- `POST /api/teams`
- `POST /api/teams/:id/members` (add human/agent)
- `DELETE /api/teams/:id/members/:memberType/:memberId`

#### Channels

- `GET /api/channels`
- `POST /api/channels`
- `PATCH /api/channels/:id`
- `POST /api/channels/:id/subscribe`
- `POST /api/channels/:id/unsubscribe`

#### Conversations / threads

- `GET /api/conversations`
- `POST /api/conversations`
- `GET /api/conversations/:id/threads`
- `POST /api/conversations/:id/threads`

#### Events

- `POST /api/events` (emit event; supports `deliverAt` and idempotency)
- `GET /api/events` (filters: channelId, agentName, after, limit)
- `POST /api/events/:id/ack` (optional)
- `POST /api/events/:id/fail` (increment failure count)
- `GET /api/event-types` (list schema directory summary, MVP can be static)

#### Files

- `POST /api/files` (multipart upload; store to `files/`)
- `GET /api/files/:id` (serve file; auth required)
- `GET /api/files/:id/meta`

#### Secrets

- `GET /api/secrets` (names only + scope, no values)
- `POST /api/secrets` (set value)
- `DELETE /api/secrets/:id`

#### Webhooks (verified)

- `POST /api/webhooks/github`
- `POST /api/webhooks/generic/:source`
- `POST /api/webhooks/:name`

Each verifies signature + replay protection, then emits events.

Replay protection (MVP):

- GitHub uses `X-GitHub-Delivery`
- Generic accepts `x-orgops-idempotency` or `payload.id`

## Agent Runner (one daemon supervises all agents)

### Responsibilities

- Keep **all enabled agents** running (desiredState RUNNING)
- Maintain per-agent:
  - workspace existence
  - channel context isolation `(agentName, channelId)`
- Execute tool calls:
  - host shell/fs/proc (root)
  - record everything in audit events
- LLM interaction (Vercel AI SDK):
  - resolve agent modelId via API Model Registry
  - call provider with messages
  - optionally stream tokens later (MVP can be non-streaming)

### Control plane

Runner periodically pulls desired state from API:

- `GET /api/agents` (or a dedicated `GET /api/control/desired-state`)

Runner processes control events:

- `agent.control.start|stop|restart|reload-skills`

### Event consumption loop

Each agent has a heartbeat loop (in runner, not separate processes unless you want):

1. Fetch events:
   - `GET /api/events?agentName=<name>&after=<cursor>&limit=...`
   - include events addressed directly, plus team/channel events the agent is subscribed to (API can resolve this server-side to simplify).
2. For each new event:
   - require `channelId` (fail event if missing)
   - build prompt context:
     - agent system instructions
     - soul.md content
     - short skill index
     - full channel event history (messages + tool/audit/process events)
3. Ask LLM to produce an action plan and/or tool calls.
4. Execute tool calls (shell/fs/proc) and capture outputs.
5. Emit resulting events back via `POST /api/events`:
   - `message.created` (agent response)
   - `task.created`
   - `process.started/output/exited`
   - `audit.shell.command`, `audit.fs.write`, etc.

### LLM call wrapper (AI SDK)

`packages/llm` exposes:

- `generate(agentModelId, messages, options)` returning:
  - text
  - optional tool-call JSON if you implement tool calling

**MVP tool calling approach (simple):**

- Use a strict JSON output protocol in the system prompt:
  - model must output either:
    - `{ "kind":"message", "text":"..." }`
    - `{ "kind":"tool", "tool":"shell_run", "args":{...} }`
    - `{ "kind":"multi", "steps":[...] }`
    This works across providers reliably.

### Process management

- `proc_start` spawns child process (PTY preferred)
- stream output into:
  - `process_output` table
  - WS topic `process:<id>`
  - optionally also emit `process.output` events (append-only in `events`)

**Audit is mandatory**: every command emits:

- `audit.shell.command` with:
  - agentName, channelId, cmd, cwd, envKeys, startTs, exitCode
- `audit.process.started/exited`

## Event type directory (schemas + docs)

On disk:

```
event-types/
  message.created.md
  task.created.md
  process.started.md
  process.output.md
  process.exited.md
  agent.control.start.md
  ...
```

Each file describes:

- purpose
- routing expectations
- payload shape (human-readable)
- examples

Agents can read these via fs tools.

## UI (React + Tailwind)

### Screens

1. **Login**
2. **Dashboard**
   - agent statuses (RUNNING/CRASHED)
   - recent events
3. **Agents**
   - list/create/edit
   - view soul.md + system instructions
   - set model
   - assign skills
   - start/stop/restart
4. **Channels**
   - create/manage
   - subscribe agents/humans/teams
   - channel event feed + thread view
5. **Chat**
   - left: conversations (multi-convo per agent/channel)
   - main: threaded messages
   - right: session info + attached files + recent tool/audit actions
6. **Events Explorer**
   - filters (type/source/dest/channel/session)
   - raw payload viewer
7. **Processes**
   - list running processes (by agent/session)
   - live log tail (WS)
8. **Skills**
   - list installed skills (from `skills/`, `.opencode/skills`, `.claude/skills`, `.agents/skills`)
   - view `SKILL.md`, show assets tree
9. **Secrets**
   - manage secrets (name/scope/value)
   - show last accessed times (from audit)
10. **Teams**
   - create/manage
   - add/remove memberships

### UI Realtime

- Connect to `/ws`
- Subscribe to:
  - active conversation topic
  - active channel topic
  - relevant process topics when viewing logs
  - `org:agentStatus`

## Deployment (single VPS)

### Runtime layout

- `.orgops-data/orgops.sqlite`
- `.orgops-data/workspaces/<agentName>/...`
- `skills/...`
- `files/...`

### Services

- `bun run apps/api`
- `bun run apps/agent-runner`
- `bun run apps/ui` (or build static and serve via API/nginx)

### Nginx (single domain)

- `/` → UI
- `/api/*` → API
- `/ws` → API upgrade to WebSocket

### Backups

- nightly:
  - copy SQLite file safely (use SQLite backup command or stop-writes momentarily)
  - archive `skills`, `.orgops-data/workspaces` if desired
- keep last N backups

## MVP “Day 1” built-in content (skills, not tools)

Ship these skill folders in `skills/`:

- `orgops/` — docs + curl examples for OrgOps API (events, channels, agents)
- `local-memory/` — patterns for `.md` memory files in workspace
- `browser-use/` — docs + runnable script placeholder

(They can start as docs-only; runnable assets can be added iteratively.)

## Mandatory audit events (minimum list)

- `audit.shell.command`
- `audit.process.started`
- `audit.process.output` (or store in process_output + emit summary)
- `audit.process.exited`
- `audit.fs.read`
- `audit.fs.write`
- `audit.secret.accessed`
- `audit.webhook.verified` / `audit.webhook.rejected`

## Implementation order (MVP plan)

1. DB schema + migrations + API skeleton (Hono)
2. Auth + WS pub/sub + event write/read + publish-on-commit
3. UI: login + conversations + live event feed
4. agent-runner: fetch events → LLM → emit message events (no tools yet)
5. Add shell/fs tools + audit logging
6. Add proc manager + live logs via WS
7. Webhook verification endpoints
8. Skills index in prompt + skills UI

## Acceptance criteria

- Human can chat with an agent in multiple conversations; messages are stored and streamed live.
- Agents can run shell commands and start long processes; output streams to UI and is persisted.
- All actions are auditable as events.
- Verified webhooks ingest into events; unverified are rejected and audited.
- System runs on one VPS under one domain with bun + sqlite.

## Development commands

- `bun run dev:all` starts API, agent-runner, and UI in dev mode
- `bun run prod:all` builds UI and starts API, agent-runner, and UI preview
