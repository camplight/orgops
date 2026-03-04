---
name: events
description: Use all event-related API endpoints (event types, create/list events, ack, fail) via the runner token.
metadata: {"openclaw":{"requires":{"env":["ORGOPS_RUNNER_TOKEN"]}}}
---
# Events

Use this skill to work with the full events API surface in OrgOps over HTTP. It supports:

- listing event type definitions
- creating events
- listing/filtering events
- acknowledging delivered events
- marking events as failed (with optional error)

All calls should use:

- `ORGOPS_API_URL` (default `http://localhost:8787`)
- `ORGOPS_RUNNER_TOKEN` sent as `x-orgops-runner-token`

## API surface

- `GET /api/event-types`
- `POST /api/events`
- `GET /api/events`
- `POST /api/events/:id/ack`
- `POST /api/events/:id/fail`

## Usage

### Create an event

```bash
curl -s -X POST \
  -H "content-type: application/json" \
  -H "x-orgops-runner-token: $ORGOPS_RUNNER_TOKEN" \
  -d '{"type":"message.created","source":"human:admin","channelId":"ops-room","payload":{"text":"hello"}}' \
  "${ORGOPS_API_URL:-http://localhost:8787}/api/events"
```

### List event types

```bash
curl -s \
  -H "x-orgops-runner-token: $ORGOPS_RUNNER_TOKEN" \
  "${ORGOPS_API_URL:-http://localhost:8787}/api/event-types"
```

### List events (with filters)

Supported query params: `channelId`, `agentName`, `after`, `limit`.

```bash
curl -s \
  -H "x-orgops-runner-token: $ORGOPS_RUNNER_TOKEN" \
  "${ORGOPS_API_URL:-http://localhost:8787}/api/events?limit=100"
```

### Ack an event

```bash
curl -s -X POST \
  -H "x-orgops-runner-token: $ORGOPS_RUNNER_TOKEN" \
  "${ORGOPS_API_URL:-http://localhost:8787}/api/events/<eventId>/ack"
```

### Fail an event

Optional JSON body:

```json
{"error":"reason for failure"}
```

```bash
curl -s -X POST \
  -H "content-type: application/json" \
  -H "x-orgops-runner-token: $ORGOPS_RUNNER_TOKEN" \
  -d '{"error":"transient downstream failure"}' \
  "${ORGOPS_API_URL:-http://localhost:8787}/api/events/<eventId>/fail"
```
