# Production deployment

## Before you start

- Generate a real `ORGOPS_MASTER_KEY`: `openssl rand -base64 32`.
- Change `ORGOPS_ADMIN_PASS` and `ORGOPS_RUNNER_TOKEN` from their defaults.
- Serve everything over HTTPS. `ORGOPS_COOKIE_SECURE=auto` (default) marks cookies
  `Secure` on HTTPS requests.
- Read [Deployment security](deployment-security.md).

## Same origin for UI and API

Production UI builds call the API through relative `/api` and `/ws` paths. Serve the
UIs and the API from **one public origin**, or reverse-proxy these paths to the API, so
that session cookies and WebSockets work.

If you must host a UI elsewhere, set `VITE_API_BASE_URL` and `VITE_WS_BASE_URL` at build
time, or inject at runtime:

```html
<script>
  window.__ORGOPS_UI_CONFIG__ = {            // admin UI
    apiBaseUrl: "https://orgops.example.com/api",
    wsBaseUrl: "wss://orgops.example.com/ws"
  };
  // the user UI reads window.__ORGOPS_USER_UI_CONFIG__
</script>
```

## From source

```bash
npm ci
npm run prod:all
```

This builds both UIs and runs the API, the runner and the admin UI preview. Backend apps
run TypeScript directly through `tsx`; there is no separate backend build step.

## Single-image container

The root `Dockerfile` builds one image with the API, runner, admin UI and user UI.
`ORGOPS_COMPONENTS` selects what runs (default `api,runner,user-ui`).

```bash
docker build -t orgops:local .
```

::: code-group
```bash [API + runner + user UI]
docker run --rm -p 8787:8787 \
  -e ORGOPS_COMPONENTS=api,runner,user-ui \
  -e ORGOPS_MASTER_KEY='<32-byte-base64>' \
  -v orgops-data:/app/.orgops-data \
  -v orgops-files:/app/files \
  orgops:local
```
```bash [API only]
docker run --rm -p 8787:8787 \
  -e ORGOPS_COMPONENTS=api \
  -e ORGOPS_MASTER_KEY='<32-byte-base64>' \
  -v orgops-data:/app/.orgops-data \
  -v orgops-files:/app/files \
  orgops:local
```
```bash [Runner only]
docker run --rm \
  -e ORGOPS_COMPONENTS=runner \
  -e ORGOPS_API_URL='https://orgops.example.com' \
  -e ORGOPS_RUNNER_TOKEN='<runner-token>' \
  -e ORGOPS_MASTER_KEY='<32-byte-base64>' \
  -v orgops-data:/app/.orgops-data \
  -v orgops-files:/app/files \
  orgops:local
```
:::

Inside the container, HAProxy listens on port `8787` and routes:

| Path | Backend |
| --- | --- |
| `/api`, `/ws`, `/health`, `/agents`, `/agent` | API |
| `/admin` | Admin UI (when enabled) |
| `/` | User UI, then admin UI, then API as fallback |

Persist `/app/.orgops-data` and `/app/files` with volumes. Internal ports can be changed
with `ORGOPS_PROXY_PORT`, `ORGOPS_INTERNAL_API_PORT`, `ORGOPS_INTERNAL_ADMIN_UI_PORT`
and `ORGOPS_INTERNAL_USER_UI_PORT`.

## Host install with OpsCLI

On a VM or a personal machine, [OpsCLI](opscli.md) installs OrgOps, writes a generated
`.env` with random keys and registers per-user OS services that start at login.

## Google Workspace sign-in

Optional. Set `ORGOPS_GOOGLE_CLIENT_ID`, `ORGOPS_GOOGLE_CLIENT_SECRET` and
`ORGOPS_GOOGLE_REDIRECT_URI` (for example
`https://orgops.example.com/api/auth/google/callback`). The instance owner then enables it
and sets the allowed domain and default team. New Google users are created as `MEMBER`s.
Local password sign-in keeps working for recovery.

## Request limits

Production body limits: 1 MiB for regular API calls, 21 MiB for uploads, 16 MiB for
agent transfers. Adjust with `ORGOPS_API_MAX_BODY_BYTES`,
`ORGOPS_UPLOAD_MAX_BODY_BYTES` and `ORGOPS_TRANSFER_MAX_BODY_BYTES`, and enforce matching
limits at your reverse proxy.

## Backups

Back up `.orgops-data/` (SQLite database, workspaces, spilled event payloads), `files/`
and `.env`. `opscli upgrade` makes a safety backup of these automatically.
