---
name: browser-use-lightpanda
description: Automate websites with Playwright connected to local Lightpanda CDP only. Use when users ask for browser automation, navigation workflows, scraping, or form filling and execution must stay local with no browser fallbacks.
---
# Playwright with Lightpanda

Use this skill when a task needs browser automation through local Lightpanda.

This skill is Playwright + Lightpanda-only:

- Allowed runtime: Local Lightpanda CDP endpoint only
- Allowed client library: Playwright Python
- Not allowed: browser-use orchestration
- Not allowed: Cloud Lightpanda endpoint
- Do not run `playwright install chromium`

## Why this skill

- Faster startup and lower memory footprint are useful for parallel agent workloads.
- Keeps browser automation setup consistent across OrgOps agents.
- Eliminates browser fallback ambiguity.

## Fixed local endpoint and stack

This skill does not use secrets for endpoint discovery.

- Fixed endpoint: `ws://127.0.0.1:9222`
- Client package: `playwright` (Python)
- If a different endpoint is required, edit this skill explicitly.

## Local-only setup (no cloud)

Use this when you want OrgOps browser tasks to stay fully local:

1. Install Playwright Python package in a local venv.
2. Run local Lightpanda CDP server.
3. Confirm local endpoint `ws://127.0.0.1:9222` is reachable.

## Installation and readiness checks

### 1) Lightpanda check and install

Check if Lightpanda is installed:

```bash
command -v lightpanda
```

If missing, install with the bundled helper:

```bash
bash skills/browser-use-lightpanda/assets/install-lightpanda.sh
```

Start local Lightpanda CDP server:

```bash
~/.local/bin/lightpanda serve --host 127.0.0.1 --port 9222
```

If `lightpanda` is already in PATH:

```bash
lightpanda serve --host 127.0.0.1 --port 9222
```

Set local endpoint secret:

```bash
node --import tsx skills/secrets/assets/set.ts -- browser-use LIGHTPANDA_WS_ENDPOINT__worker1 ws://127.0.0.1:9222
```

### 2) Playwright package check and install

Bootstrap Python env with Playwright package:

```bash
bash skills/browser-use-lightpanda/assets/ensure-playwright-python.sh
```

This script:

- checks `python3`
- installs `uv` if missing
- creates `.venv-playwright` if missing
- installs/updates `playwright`

Smoke-check local CDP endpoint:

```bash
curl -fsS http://127.0.0.1:9222/json/version
```

If this fails, do not proceed; report the endpoint connectivity error.

Run Playwright CDP smoke script:

```bash
source .venv-playwright/bin/activate
python skills/browser-use-lightpanda/assets/playwright-lightpanda-smoke.py
```

Expected output includes:

- `ok: connected to ws://127.0.0.1:9222`
- page title for `https://example.com`

## Agent operating rules

- Clarify the objective before browsing: target URL, expected output, and stop condition.
- Prefer deterministic flows: direct URL navigation, explicit selectors, bounded retries.
- Capture concise evidence (key extracted fields, final page state, errors) in the response.
- Never expose sensitive values in messages, logs, or event payloads.
- If blocked by auth walls, anti-bot controls, or CAPTCHAs, report blocker and request user action.
- Do not introduce browser-use or non-Lightpanda fallbacks.
- Reject non-local Lightpanda endpoints for this skill.

## Execution workflow

Copy this checklist and track progress:

```text
Browser Task Progress
- [ ] Confirm task objective and target URLs
- [ ] Verify Lightpanda install and local server availability
- [ ] Verify Playwright package and Lightpanda endpoint health
- [ ] Use fixed endpoint `ws://127.0.0.1:9222`
- [ ] Run Playwright script with bounded timeout and retries
- [ ] Validate output against requested schema
- [ ] Return result with evidence and any blockers
```

### Step 1: Prepare task input

Collect:

- URL(s)
- Goal phrased as an action
- Required output shape (markdown/json/table)
- Timeout budget

### Step 2: Resolve endpoint

- Use endpoint `ws://127.0.0.1:9222`.
- If `curl -fsS http://127.0.0.1:9222/json/version` fails, stop and report endpoint unavailable.

### Step 3: Run automation

Use Playwright `connect_over_cdp` with:

- Bounded total timeout
- Limited retry count
- Deterministic extraction instructions
- Explicit `browser.close()` on completion

### Step 4: Validate and return

Before final reply:

- Verify required fields are present and non-empty.
- Include source URLs used.
- Include concise failure reason if incomplete.

## Output format

Use this structure unless the user requested another format:

```markdown
## Browser task result
- Goal: <one line>
- Runtime: <lightpanda-local>
- URLs visited: <list>
- Status: <success|partial|failed>

## Extracted data
<structured payload>

## Notes
- Evidence: <key observations>
- Blockers: <if any>
```

## Failure handling

- Transient navigation failure: retry with short backoff up to 2 times.
- Selector not found: re-snapshot once, then fail with context.
- Local endpoint unavailable: verify local Lightpanda process is running and `/json/version` is reachable.
- Stalled Python run: terminate the process, log stderr/stdout tail, then rerun smoke script before continuing.
