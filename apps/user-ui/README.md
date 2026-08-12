# OrgOps User UI

Lightweight non-technical UI for OrgOps users. It connects to the OrgOps API and
keeps the surface intentionally small: channels, messages, active agents, and
recent activity.

## Run locally

Start the API, then run:

```bash
npm run user-ui:dev
```

Open `http://localhost:5190`.

The Vite dev server proxies `/api` and `/ws` to `http://localhost:8787`.
For a different API origin, set:

```bash
VITE_API_BASE_URL=https://example.com/api npm run user-ui:dev
```
