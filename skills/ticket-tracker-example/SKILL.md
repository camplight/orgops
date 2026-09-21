---
name: ticket-tracker-example
description: "Example connector skill for an external ticket tracker: check readiness, check a permission, search, read, create, and comment/transition an issue. A generalized, de-identified reference implementation -- not wired to any specific tracker product."
---

# Ticket tracker example

This skill demonstrates the `SKILL.md` + `assets/*` two-part convention
(already used upstream by `skills/secrets` and `skills/gcli`) applied to an
external ticket-tracking system. It is a reference shape, not a finished
integration: every network call needs a real base URL, project key, email,
and API token supplied by the adopter (see Configuration below); none of
those four values is ever hardcoded here.

## Configuration

Three environment variables, all required, checked together before anything
else runs:

| Variable | Meaning |
|---|---|
| `TICKET_TRACKER_BASE_URL` | The tracker's REST API base, e.g. `https://tracker.example.com/rest/api` |
| `TICKET_TRACKER_PROJECT_KEY` | The single project this adapter is scoped to |
| `TICKET_TRACKER_EMAIL` | The account email used for Basic auth |

Plus one credential, resolved separately and never read as part of skill
config, consistent with `skills/secrets`' own env-sourced token convention:

| Variable | Meaning |
|---|---|
| `TICKET_TRACKER_API_TOKEN` | The API token paired with `TICKET_TRACKER_EMAIL` |

## Check readiness

```bash
node {baseDir}/assets/check.mjs
```

Emits one JSON object, exit 0 iff every configuration value and the
credential are present. Never attempts a network call.

## Check a permission

```bash
node {baseDir}/assets/can.mjs <action>
```

`<action>` is one of `view`, `comment`, `transition`, `create`, `assign`.
Reports whether the action is in this adapter's action catalogue, without
performing it.

## Search issues

```bash
node {baseDir}/assets/search.mjs -- <search term>
```

## Read an issue

```bash
node {baseDir}/assets/get-issue.mjs -- <issue-key>
```

## Create an issue

```bash
node {baseDir}/assets/create.mjs -- <summary>
```

## Comment on an issue

```bash
node {baseDir}/assets/update.mjs -- <issue-key> <comment>
```

## Design notes

- **Adapter seam.** Every verb calls `ready()` in `assets/_lib.mjs` first;
  if config or credential is missing, the verb prints that verdict and exits
  1 without attempting any network call. The network is the last thing
  attempted, never the first.
- **Swappable by construction.** Host, project, and auth all come from named
  environment variables (config), and the credential is resolved separately
  from config (a per-invocation lookup, not a single value baked into the
  adapter). Porting this example to a different tracker means rewriting
  `request()`'s path/body shapes in `_lib.mjs` and the individual verbs --
  the config/credential seam itself does not change.
- **Zero third-party dependencies.** Node builtins plus global `fetch` only.
  No `package.json` addition is required to run any verb.
- **Verified locally, not against a real tracker.** Every verb was run
  directly on Node `v25.2.1` through all three configuration states, and the
  four network-reaching verbs were also run against a throwaway local HTTP
  server (loopback only, never a live host) to check request shape and
  error handling. Two defects surfaced this way and were fixed before this
  skill shipped: a documented `--` argument separator that the verbs
  originally failed to strip (silently corrupting arguments while still
  exiting 0), and unhandled `fetch`/`JSON.parse` failures that crashed
  instead of returning `{ok:false}`. No verb was run against a live
  external tracker. See the design document's Limits section for the full
  account of both defects and what remains untested.
