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
