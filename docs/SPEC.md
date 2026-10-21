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
.orgops-data/     Runtime DB/workspaces
```

## Core Data Model

### Agents

Stored in `agents`:

- identity/config: `id`, `name`, `icon`, `description`, `model_id`
- prompting/runtime config: `soul_contents`
- workspace/safety: `workspace_path`, `allow_outside_workspace`
- per-agent runtime tuning: `llm_call_timeout_ms`, `classic_max_model_steps`, `context_session_gap_ms`, `emit_audit_events`, `memory_context_mode`
- mode/state: `mode` (`CLASSIC` | `RLM_REPL` | `WRAPPED`), `desired_state`, `runtime_state`, `last_heartbeat_at`
- host assignment: `assigned_runner_id` (nullable; when set, only matching runner executes the agent)
- skills: `enabled_skills_json`, `always_preloaded_skills_json`
- optional extra skill roots: `additional_skill_roots_json`
- secret delegation toggle: `allow_owner_human_secrets` (when enabled and owner exists, user-scoped secrets are injected for native turns)
- wrapped runtime config: `wrapped_config_json` (JSON object; used only by `WRAPPED` mode)

On API startup, when `agents` is empty, OrgOps seeds one public agent named `system` if `ORGOPS_SYSTEM_AGENT_MODEL` is set. The value is a provider (`openai`, `anthropic`/`claude`, `openrouter`/`or`) or `provider:model`. A bare provider uses `openai:gpt-5.2`, `anthropic:claude-3-5-sonnet-latest`, or `openrouter:openai/gpt-4o-mini`. Seeding also stores the matching provider API key (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENROUTER_API_KEY`) as a public secret and inserts an enabled `models` row. The agent is skipped when the model is unset, the provider is unsupported, the API key is empty, `ORGOPS_MASTER_KEY` cannot encrypt the secret, or any agent row already exists. The seeded agent is unassigned; a runner executes it after `assigned_runner_id` is set.

`WRAPPED` agents are orgops-owned lifecycle records whose turns are delegated to an external runtime. They do not use orgops memory summaries, prompt composition, skills, model calls, or `allow_outside_workspace` for turn handling. The wrapped runtime owns its own session/memory/tool state and filesystem policy. `soul_contents` may still be stored on the agent row for humans, opscli, and native management agents; the wrapper runner does not automatically inject it. The creator of the wrapped agent should translate it into the selected harness configuration/setup/runtime behavior when that harness needs a soul or prompt seed.

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
- `runtime.timeoutMs`: optional turn timeout override in milliseconds. Default is `1800000` (30 minutes). Set `0` to disable hard timeout for intentionally long-lived runtimes.
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

### Federation

Federation is modeled around hoisted channels. A shared channel has one canonical
home OrgOps instance; other instances may keep local projection channels for UI
and runner compatibility. `federation_instances` stores known peer instances,
their base URL, an optional outbound bearer token for calls to that peer, and a
hashed inbound bearer token for calls from that peer. `federation_channels`
links a local channel to either a `LOCAL_HOME` role or a `REMOTE_PROJECTION`
role with `home_instance_id`, `remote_channel_id`, and a pull `sync_cursor`.
Projection rows are caches/convenience records; the home instance is the source
of truth for ordering and policy.

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
- `workspace_publications` — explicitly published agent workspace subfolders exposed at configurable public paths such as `/agents/<name>/<subfolder>/`
- `workspace_publication_blobs` and `workspace_publication_revisions` — content-addressed snapshot storage and atomic manifests for runner-synced publications
- `secrets`
- `models`
- `llm_model_prices`: provider/model price snapshots with source URL and effective time; OpenAI/Anthropic seed from curated docs, OpenRouter can refresh from its models API
- `llm_usage`: append-only LLM call ledger storing channel/agent/provider/model dimensions, token counts, cost in USD micros, and the exact applied price snapshot

### Agent Invites / Runner Tokens

- `agent_invites`: wrapped-agent bootstrap invites (hashed token, optional scoped channel set, invite-time agent visibility, creator metadata for human/agent callers, optional wrapped config, expiry, usage count)
- `runner_tokens`: hashed runner credentials, including invite-scoped tokens bound to a single `agent_name` and `runner_id`

## Event Contract

Envelope fields used by API/runner:

- required: `type`, `payload`, `source`
- contextual: `channelId`, `parentEventId`
- scheduling: `deliverAt`
- dedupe: `idempotencyKey`

`message.created` accepts optional `payload.targetAgentNames` (1–30 nonempty agent names).
The runner handles the message only for listed agents; an existing singular
`targetAgentName` also restricts delivery when supplied. Unlisted subscribers
retain channel history access but do not start a turn for this message. Messages
without either field keep ordinary channel routing. Scheduled triggers continue
to require their singular target.

`message.created` accepts optional `payload.sensitive` metadata for protected content:

- sender-safe preview remains in `payload.text`
- secret text may be sent as `payload.sensitive.plaintext` (or pre-encrypted `ciphertextB64`)
- API encrypts plaintext into `payload.sensitive.ciphertextB64` using `ORGOPS_MASTER_KEY` before persistence
- reveal requires `POST /api/events/:id/reveal-sensitive` with the caller's current password

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
- Human invites can optionally land the new account in an existing channel (`channelId`)
  or create a new private-by-default group channel (`channelName`) with initial
  `agentParticipants[]`; the invited human is subscribed to the landing channel.

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
- extra allowed roots: enabled skill directories (from repo skill root, configured extra roots, and per-agent additional roots)

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
- password verification for sensitive reveals: `POST /api/events/:id/reveal-sensitive`
- `GET /api/humans`
- `POST /api/humans/invite`
  - accepts `username`, optional `tempPassword`
  - optional existing-channel landing: `channelId` subscribes the new human to
    a channel the inviter can manage
  - optional new-channel landing: `channelName`, optional `channelDescription`,
    optional `channelVisibility`, and `agentParticipants[]` create a group
    channel owned by the inviter, subscribe the inviter, listed agents, and the
    invited human
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

### Billing

- `GET /api/billing/prices` returns known model price snapshots
- `POST /api/billing/prices/refresh/openrouter` fetches OpenRouter's live model/pricing catalog and snapshots rates as `openrouter:<slug>` model IDs
- `POST /api/billing/usage` is runner-authenticated and records provider token usage for native runner calls
- `GET /api/billing/usage?groupBy=provider|model|agent|channel&since=<ms>&until=<ms>` returns visible aggregate usage/cost totals; the admin UI exposes predefined periods and custom start/end filters
- Pricing is best-effort but reproducible: every usage row stores the exact price snapshot used, so historical totals do not change when provider prices change later.

### Agents

- `GET /api/agents`
- `POST /api/agents`
- `GET /api/agents/:name`
- `PATCH /api/agents/:name`
  - private agents accept optional `ownerHumanId`; callers may create/transfer private ownership to another human if the target human exists
  - changing an agent's `name` via patch is currently rejected (rename unsupported)
- supports `assignedRunnerId` on create/update/read
- supports `wrappedConfig` JSON object/string on create/update/read
- supports `GET /api/agents?assignedRunnerId=<runnerId>` filtering
- supports `GET /api/agents?assignedRunnerId=<runnerId>&includeUnassigned=1`
- `POST /api/agents/:name/:action` where action is one of:
  - `start`, `stop`, `restart`, `reload-skills`, `cleanup-workspace`
- agent management utilities:
  - `GET /api/agents/:name/transfer` exports an agent bundle: configuration, workspace files, enabled skill files, private secrets, and memory
  - `POST /api/agents/:name/copy` clones the agent. Enabled and always-preloaded skills are copied. Workspace files are copied. Private secrets are copied only when the destination does not already have the same name as a public or package secret. Skill directories are written under the new workspace only when that skill name is not already in the repo skill catalog. Channel and cross-channel memory summaries are copied. Channel memory is attached to the same channel id, or to a destination channel with the same name. Processes are not copied.  Optional `federationInstanceId` copies the bundle onto that peer instead of creating a local agent
  - `POST /api/agents/:name/move` reassigns `assignedRunnerId` on this instance, keeps the workspace path, and stops running or starting processes. Optional `federationInstanceId` sends the same bundle, including memory, to that peer, stops local processes, and then deletes the local agent. `name` sets the destination agent name
  - peers accept `GET|POST /api/federation/agents/transfer` with the peer bearer token
  - humans call these routes from the admin UI; agents call `agents_copy` and `agents_move`
- debug endpoint:
  - `GET /api/agents/:name/debug/system-prompt`
- workspace browser endpoints:
  - `GET /api/agents/:name/workspace`
  - `GET /api/agents/:name/workspace/file`
  - `GET /api/agents/:name/workspace/download`
- workspace publication management:
  - `GET /api/agents/:name/publications`
  - `POST /api/agents/:name/publications`
    - accepts `publicPath`, `sourcePath`, optional `slug`, `title`, `enabled`, `authType` (`PUBLIC` or `PASSWORD`), and optional `password`
    - `sourcePath` must name a workspace subfolder; publishing the workspace root is rejected
    - serving mode is selected automatically: `DIRECT_LOCAL` when the assigned runner hostname matches the API host, otherwise `SNAPSHOT`
  - `PATCH /api/workspace-publications/:id`
  - `DELETE /api/workspace-publications/:id`
- public workspace publications:
  - `GET <publication.publicPath>...` (for example `/agents/system/dist/`)
  - legacy `GET /agents/:name/:slug/...` remains accepted for publication rows
  - password-protected publications use HTTP Basic auth in this version

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
- `POST /api/events/:id/reveal-sensitive` (human auth + password check; decrypts `message.created.payload.sensitive`)
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
  - scope types: `public`, `team`, `private`, `human` (`package` remains supported as legacy compatibility scope)
  - env resolution precedence: `private > human > team > public > package(legacy)`
- skills:
  - `GET /api/skills`
  - the API resolves the skill root from `ORGOPS_PROJECT_ROOT` when set, otherwise from the API module location; `createApp({ projectRoot })` provides an explicit embedding/test override

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

### Federation

- `GET /api/federation/instances`
- `POST /api/federation/instances`
  - returns a one-time `inboundToken` to configure as the peer's outbound token
- `PATCH /api/federation/instances/:id`
- `DELETE /api/federation/instances/:id`
  - removes a peer record and its federation subscribers/projection links
- `GET /api/federation/channels`
- `POST /api/federation/channels`
  - `role=LOCAL_HOME` marks a local channel as canonical for federation
  - `role=REMOTE_PROJECTION` creates or links a local projection to a home instance/channel
- `DELETE /api/federation/channels/:localChannelId`
  - removes the federation link; `?deleteLocalChannel=1` also deletes a `REMOTE_PROJECTION` local channel
- simplified join flow:
  - `POST /api/federation/channels/:channelId/join-link` creates a one-time-ish join URL for a `LOCAL_HOME` channel
  - `POST /api/federation/join` accepts a pasted join URL plus the peer's public base URL, then creates the peer record, projection channel, and webhook subscription
  - `DELETE /api/federation/join-links` clears pending join URLs, with optional `?channelId=<id>`
- federation bearer-token endpoints:
  - `GET /api/federation/channels/:channelId/events?after=<cursor>` exposes canonical home-channel events to peers
  - `POST /api/federation/channels/:channelId/events` accepts a peer-authenticated write into the canonical home channel
  - `POST /api/federation/channels/:channelId/subscribers` registers a remote projection webhook subscriber
  - `POST /api/federation/projections/:localChannelId/events` accepts pushed canonical events into a projection channel
- projection sync:
  - `POST /api/federation/channels/:localChannelId/sync` pulls canonical home events into a local projection channel, using idempotency keys shaped as `federation:<homeInstanceId>:<remoteEventId>`

When a user or local agent posts to a `REMOTE_PROJECTION` channel through
`POST /api/events`, the API validates the event locally, forwards the write to
the home instance, then stores the canonical event as a local projection event.
Projection events create ordinary local receipts so local runners can keep their
existing polling behavior. The home instance remains authoritative for channel
ordering. The API also runs a lightweight projection sync loop every
`ORGOPS_FEDERATION_SYNC_INTERVAL_MS` milliseconds (default `15000`; set `0` to
disable) and the UI exposes a manual sync button for retry/diagnostics. For
realtime delivery, remote projections register a webhook subscription with the
home channel. When the home API inserts a canonical event, it pushes the event
to subscribed projection instances; successful acks update `lastAckAt`, while
failures update `lastError` and rely on the pull sync loop for repair.

Chained federation is deliberately not enabled in this version. A local channel
has one federation role (`LOCAL_HOME` or `REMOTE_PROJECTION`) so a channel cannot
simultaneously be a canonical home and a projection of another home. This avoids
multi-hop loops, ambiguous ordering, and hard-to-explain access policy. If
multi-hop federation becomes necessary, model it explicitly as a DAG with an
origin instance/event ID, hop limits, and per-link policy rather than making every
projection silently re-host downstream.

Operator UX: on the home instance, mark a channel `LOCAL_HOME` and copy its join
URL from the Federation screen. On the peer instance, paste that URL into
"Join From URL" and provide the peer's public base URL. The peer stores the home
token for outbound writes/sync and registers its own inbound token with the home
so realtime webhook push works without manually configuring reverse credentials.

## Agent Runner Behavior

Runner loop:

1. Poll agents from API.
2. Register runner identity at API on startup and persist stable runner ID locally.
3. Select only agents assigned to this runner ID.
4. For each `desired_state=RUNNING` agent:
   - ensure workspace exists
   - heartbeat runtime state to API
   - emit one-time lifecycle bootstrap event (`agent.lifecycle.started`) for native modes, or run wrapped lifecycle setup for `WRAPPED`
   - if the API marks the agent `runtime_state=STARTING`, clear the runner bootstrap marker and re-run startup/setup; wrapped runtimes are stopped first so refreshed secret env is injected into new sidecars/setup
5. Pull pending events with per-agent receipt semantics.
6. Filter control/audit/self-authored/agent-authored events.
7. Group remaining pending events by channel and process each channel as a single handling batch.
8. Execute by agent mode:
   - `CLASSIC`: call LLM, enforce JSON event output with retries, validate and emit.
   - `RLM_REPL`: run recursive REPL loop in child process with explicit `done(result)`.
   - `WRAPPED`: skip orgops memory/prompt/skills/model calls and run the configured external runtime recipe.
9. For native modes, build context from runner guidance + bounded channel history + skills + `soul_contents`, plus a synthetic merged-trigger message when a batch contains multiple events.
10. For native modes, run model generation in step mode (single-step/attempt calls) and poll pending events for the same `(agent, channel)` between attempts; newly arrived events are merged into subsequent attempt context.
11. On handler failure, call `/api/events/:id/fail` for each event in the failed channel batch.

Wrapped lifecycle:

1. When a `WRAPPED` agent first reaches `desired_state=RUNNING`, the runner resolves its `wrappedConfig` and selects a wrapper harness.
2. The selected harness owns setup. For the built-in `command` harness, `source.type="github"` clones the repo into the agent workspace if missing.
3. For the built-in `command` harness, `setup.checkCommand` exits `0` to skip setup; otherwise `setup.command` runs when provided.
4. Wrapper lifecycle emits `wrapper.lifecycle.started`, `wrapper.setup.started`, `wrapper.setup.skipped`, `wrapper.setup.completed`, or `wrapper.setup.failed`.
5. On each turn, the runner builds normalized `message` and `sessionId`, then calls the selected harness `runTurn`.
6. Harness output is normalized into `message.created` from `agent:<name>`.
7. Wrapper turn events (`wrapper.turn.started/completed/failed`) are bookkeeping and never wake agents. `wrapper.turn.failed` includes runtime diagnostics such as `exitCode`, `signal`, `timedOut`, and `terminationReason` when available.

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
  - `events_channel_participants`, `events_channel_participant_add`, `events_channel_participant_remove` (participant add/remove supports `AGENT` and `HUMAN`; legacy `agentName` alias still maps to `AGENT`)
  - `events_channels_list`, `events_event_types`, `events_scheduled_create`, `events_schedule_self`
- agent management helpers:
  - `agents_search`, `agents_create`
  - `agents_publish_workspace`, `agents_unpublish_workspace`, `agents_list_publications`

### Workspace Publications

Agents can publish explicit subfolders from their workspace to unauthenticated web URLs. Publications are configured from the admin UI or by agent tools. The human-facing mount is `publicPath`, defaulting in the UI to `/agents/<agent-name>/<subfolder>/`, and operators may set another non-reserved absolute path such as `/sites/report/`. The internal `slug` remains unique per agent for management compatibility.

Two serving modes are supported:

- `DIRECT_LOCAL` serves from the live workspace filesystem. It is selected automatically when the assigned runner hostname matches the API host.
- `SNAPSHOT` is selected when the assigned runner is elsewhere or unknown. The assigned runner scans enabled publication folders on a short interval, hashes files, uploads missing content-addressed blobs to the API, then commits an atomic revision manifest. The API serves public traffic from the latest complete revision, so internet requests do not depend on live runner availability.

Runner sync endpoints are runner-authenticated:

- `GET /api/workspace-publications/sync?runnerId=<id>` returns enabled snapshot publications for agents assigned to the runner.
- `POST /api/workspace-publications/:id/blobs/missing` returns hashes the API does not already store.
- `PUT /api/workspace-publications/:id/blobs/:sha256` uploads one blob and verifies the SHA-256.
- `POST /api/workspace-publications/:id/revisions` commits the manifest as the active revision.
- `POST /api/workspace-publications/:id/sync-error` records sync diagnostics.

Snapshot sync skips common secret/control paths such as dotfiles, `.env*`, VCS directories, and `node_modules`, enforces per-file size limits, and rejects symlink escapes. Passwords are stored with the same scrypt hashing helper used for human passwords; plaintext publication passwords are never stored. Publishing the root workspace folder is rejected; create a subfolder such as `dist`, `public`, or `site` and publish that.

Audit events are emitted around tool/process operations and RLM execution.

## OpsCLI Behavior

`apps/opscli` is a standalone host bootstrap/maintenance CLI with deterministic commands and an optional chat loop.

- deterministic commands:
  - `install` (prereq checks + clone/pull repo + `npm ci` + component-scoped build/config)
  - `upgrade` (safety backup + component-scoped stop/update + optional restart)
  - `doctor` (host prerequisite check)
  - `start` / `stop` / `status` for selected components (`api`, `runner`, `user-ui`, `admin-ui`)
  - `admin open` / `admin stop` / `admin status` convenience wrappers for `admin-ui`
  - `service register` to register/start OS-specific auto-start per component (`api`, `runner`, `user-ui`, `admin-ui`) without install/upgrade
  - `service unregister` to remove OS-specific auto-start per component without install/upgrade
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
  - `/api`, `/agents`, `/agent`, `/ws`, `/health` -> API backend
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
- `ORGOPS_SYSTEM_AGENT_MODEL` (optional provider or `provider:model`; seeds the default `system` agent when `agents` is empty)
- `ORGOPS_MASTER_KEY`
- `ORGOPS_COOKIE_SECURE`
- `ORGOPS_EVENT_MAX_FAILURES`
- `ORGOPS_EVENT_SHAPES_CACHE_TTL_MS`
- `ORGOPS_FEDERATION_SYNC_INTERVAL_MS`
- `ORGOPS_RUNNER_ONLINE_THRESHOLD_MS`
- `ORGOPS_PROJECT_ROOT`
- `ORGOPS_SKILL_ROOTS` (optional comma-separated additional skill roots; repo `skills/` remains first)
- `ORGOPS_LLM_STUB`
- `ORGOPS_LLM_CALL_TIMEOUT_MS`
- `ORGOPS_HISTORY_MAX_EVENTS`, `ORGOPS_HISTORY_MAX_CHARS`
- `ORGOPS_CHANNEL_RECENT_MEMORY_INTERVAL_MS`
- `ORGOPS_CHANNEL_FULL_MEMORY_INTERVAL_MS`
- `ORGOPS_CROSS_RECENT_MEMORY_INTERVAL_MS`
- `ORGOPS_CROSS_FULL_MEMORY_INTERVAL_MS`
- `ORGOPS_AGENT_INTENT_TIMEOUT_MS`
- `ORGOPS_AGENT_INTENT_MAX_TIMEOUTS`
- `ORGOPS_WORKSPACE_PUBLICATION_SYNC_INTERVAL_MS`
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`
  - for native/wrapped runtime execution with injected env, provider keys are loaded from resolved secrets and do not fall back to host process env
  - when the default `system` agent is seeded, the matching key is copied into a public secret so the runner can inject it
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

### Google Workspace identity

Migration 037 adds `human_identities` (stable Google subject → human mapping) and
`google_auth_settings` (one instance's domain, enabled flag and default team).
Client ID, secret and the exact public callback URI are server environment values:
`ORGOPS_GOOGLE_CLIENT_ID`, `ORGOPS_GOOGLE_CLIENT_SECRET`, `ORGOPS_GOOGLE_REDIRECT_URI`.
Secrets are not stored in settings or returned over HTTP. Sign-in defaults off.

Public endpoints, registered before the normal API auth middleware:

- `GET /api/auth/google/config`: effective enabled flag and allowed Workspace domain.
- `GET /api/auth/google/start`: authorization-code flow with PKCE S256, nonce,
  five-minute single-use state and browser-bound HttpOnly SameSite=Lax cookie.
  `returnTo` accepts only `/` or `/admin/`.
- `GET /api/auth/google/callback`: exchanges the code and verifies the ID token
  using Google's library (signature, issuer, audience and expiry), then verifies
  nonce, verified email and exact hosted-domain/email-domain match. Failure redirects
  with a fixed error code, never provider error details or tokens.
- `GET/PUT /api/auth/google/settings`: authenticated instance owner only (first
  seeded human), excluding runners. PUT JSON accepts `enabled`, `allowedDomain`,
  `teamName`. Enabling requires server credentials and a valid callback URI.
  Saving invalidates pending flows and all Google sessions; local sessions remain.

A first valid login atomically creates a human and adds it to the configured team,
creating the team if absent. Repeat logins map Google's subject, not email, to the
same human. Email collisions with existing local accounts are rejected; no implicit
account linking. Google-created humans cannot use local password login (including
passwords reset by the existing admin API) or edit the local password/profile.
The existing resource permissions apply; no new administrator role is assigned.

Google sessions rotate on login and expire after eight hours; restart clears them
as with local sessions. Password sign-in remains available to local accounts for
recovery. No Directory API, directory synchronization, invitation emails, Google
refresh tokens or automatic Workspace suspension handling are included. WebSocket connections recheck sessions before processing messages or delivering
events, including deferred events. Expired/revoked connections close on their
next activity; idle sockets are not proactively disconnected.

Google onboarding stores team memberships as `HUMAN` plus the human username,
matching `/api/teams/me` and team-based access checks. Migration 038 repairs the
original lowercase/UUID memberships only when tied to a stored Google identity;
already-correct memberships are preserved and duplicate inserts are ignored.

### Generated file attachments

Native runner agents can call `fs_upload` with a workspace file path (maximum
20 MiB). The tool checks allowed roots and resolved symlink targets, uploads
bytes through the authenticated file API, and returns `attachment` metadata and
a download URL. It does not publish a message: include the returned object in
`message.created.payload.attachments` via `events_emit` to share it. Wrapped
external runtimes do not automatically receive native runner tools.
