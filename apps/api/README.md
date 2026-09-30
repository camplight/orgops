# OrgOps API

Hono-based HTTP + WebSocket server with SQLite single-writer access.

## Run

```bash
npm run dev --workspace @orgops/api
```

## Key endpoints

- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/events`
- `GET /api/events`
- `GET /ws`

## Environment

- `PORT` (default: 8787)
- `ORGOPS_ADMIN_USER` / `ORGOPS_ADMIN_PASS`
- `ORGOPS_RUNNER_TOKEN`
- `ORGOPS_MASTER_KEY`
- `ORGOPS_PROJECT_ROOT` (optional monorepo root override)
- `ORGOPS_COOKIE_SECURE` (`auto|always|never`, default: `auto`)
- `ORGOPS_EVENT_MAX_FAILURES` (default: `25`)
- `ORGOPS_EVENT_SHAPES_CACHE_TTL_MS` (default: `3000`)
- `ORGOPS_RUNNER_ONLINE_THRESHOLD_MS` (default: `15000`)
- `ORGOPS_SKILL_ROOTS` (optional platform-delimited absolute external skill roots)
- `PRIVATE_SKILLS_REPO_URL`, `PRIVATE_SKILLS_REPO_PATH`, and `PRIVATE_SKILLS_REPO_BRANCH` describe the separate private checkout managed by the built-in skill

## Private skill discovery

In v1, configure matching `ORGOPS_SKILL_ROOTS` values on the API and agent
runner. The API checkout and private checkout remain separate; the API does not
clone or synchronize repositories. After an operator runs the management
skill's `sync`, the next `GET /api/skills` refresh discovers the checkout and
returns exactly `{ skills, conflicts, diagnostics }`. Duplicate names across
roots are excluded from `skills` and reported in `conflicts`; missing or
unreadable roots appear as bounded `diagnostics`.

The built-in `private-skill-repository` skill must be explicitly enabled. Its
runner access is limited to `$PRIVATE_SKILLS_REPO_PATH/skills`, not the
repository parent or `.git`. Git can use the agent-private
`PRIVATE_SKILLS_GIT_TOKEN` and optional `PRIVATE_SKILLS_GIT_USERNAME`, or host
SSH/credential-helper fallback. Credentials are never included in responses or
logs. Host Git author name/email must be configured before commits. On split
hosts, operators own synchronization and matching configuration.
