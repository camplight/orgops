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
