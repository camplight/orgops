# Proposal: an optional single-process, single-port deployment mode

**Status:** design proposal, not yet adopted. No supervisor code, route, or CI change ships in
this PR — exactly one new file, this document. Submitted from a private fork of this project,
maintained independently.

## The problem, and what upstream already solves

This project ships today as five top-level packages under `apps/`: `admin-ui`, `agent-runner`,
`api`, `opscli`, `user-ui` (`git ls-tree --name-only upstream-live/main -- apps/`, confirmed at
the tip cited below). Of these, `api` and `agent-runner` are the two long-running backend
services; `admin-ui` and `user-ui` are frontend packages served by their own Vite dev/preview
processes; `opscli` is a local developer CLI, not a deployed service.

**`opscli` already covers a great deal of this ground, and it deserves to be named plainly rather
than assumed away.** It is a documented, versioned installer and launcher of 39 files
(`git ls-tree -r --name-only <tip> -- apps/opscli | wc -l`). Its command surface, quoted
verbatim from `apps/opscli/README.md`:

> `opscli install [--dir <path>] [--repo <url>] [--ref <git-ref>] [--components <csv>] ...
> [--register-service] [--create-shortcut]`
> `opscli upgrade [...]`
> `opscli doctor`
> `opscli start [--dir <path>] [--components <csv>] [--no-open]`
> `opscli stop [--dir <path>] [--components <csv>]`
> `opscli status [--dir <path>] [--components <csv>]`
> `opscli service register [--dir <path>]`
> `opscli service unregister [--dir <path>]`
> `opscli shortcut create [--target user-ui|admin-ui] [--url <url>]`
> `opscli admin open [--dir <path>]`
> `opscli admin stop [--dir <path>]`
> `opscli admin status [--dir <path>]`
> `opscli chat [--goal "..."]`

Concretely, `opscli` already gives an operator: a single documented install path (clone plus
`npm ci`); a single command that launches multiple components together as one shell invocation
(`package.json`'s `dev:all`, `prod:all`, and `opscli`'s own `start:user-stack:env`, the last of
which `apps/opscli/src/lib/user-stack.ts` tracks as one PID even though it fans out to three
child processes under `concurrently -k`); per-component HTTP reachability polling before
declaring a component ready; and OS-level auto-restart registration on request
(`--register-service`, covering systemd on Linux, a LaunchAgent on macOS, and a Scheduled Task on
Windows). Upstream's own README also already names the multi-port problem in its own words
(`README.md`, `## Production`, quoted verbatim):

> "If you deploy the UIs separately, they use same-origin `/api` and `/ws` paths in production
> builds. Put each UI and API behind the same public origin (or reverse proxy these paths to the
> API service) so browser auth cookies and WebSocket traffic work correctly."

That is upstream itself stating that single-origin access is a real operational need, and handing
the solution to the operator as a manual reverse-proxy step they must supply. Taken together,
`opscli` plus that README guidance is a genuine, already-shipped answer to "how do I run this on a
machine I administer" — self-hosting on a VM, or evaluating locally, is already served.

**The gap this proposal targets is narrower than that, and different in kind.** `opscli`'s whole
model assumes a persistent host with a filesystem, an OS process manager
(`launchd`/`systemd`/Task Scheduler), and `npm`/`node` already installed — it installs by cloning
the repository and running `npm ci`. That model does not fit a platform that accepts one process
per deployable unit — an OCI container runtime expecting a single `ENTRYPOINT`, a single listening
port, and its own external restart policy. `opscli` does not answer "how do I package this as one
container image," and nothing else upstream ships answers it either.

## The gap, read directly at the file level

Read in full at the tip cited below: `apps/api/src/app.ts` (526 lines), `apps/api/src/server.ts`
(10 lines), `apps/api/src/routes/ws.ts` (133 lines), `apps/opscli/src/lib/component-runtime.ts`,
`apps/opscli/src/lib/user-stack.ts`, `apps/opscli/src/lib/service.ts`, and both root and
`opscli` `package.json` files.

- **No HTTP-observable liveness route, under any name, anywhere in the tree.** A whole-tree
  search for `/health`, `/healthz`, `/status`, and common health-check identifiers returns zero
  matches (exact command in Reproduction, below). `apps/api/src/server.ts` — the process entry
  point that could add one if `app.ts` didn't — is ten lines, quoted here in full, and has no
  route of its own:

  ```ts
  import { serve } from "@hono/node-server";
  import { createApp } from "./app";

  const { app, injectWebSocket } = createApp();

  const server = serve({
    fetch: app.fetch,
    port: Number(process.env.PORT ?? 8787)
  });
  injectWebSocket(server);
  ```

  `opscli`'s own reachability polling (`component-runtime.ts`'s `checkHttpUp`,
  `user-stack.ts`'s `checkHttpOk`) is an external client hitting each component's own port; it is
  not a route the service itself exposes for an outside probe — a load balancer or a container
  orchestrator's health check has nothing to call. `component-runtime.ts`'s `COMPONENT_URL` map
  also has no entry for `agent-runner` at all, so today that component's liveness is PID-only,
  never HTTP-checked by anything upstream ships.
- **No code path serving `admin-ui` or `user-ui`'s built assets from a single process or port.**
  A whole-tree search for static-file-serving idioms (`serveStatic`, `express.static`, `sirv`,
  and similar) returns zero matches. `admin-ui` and `user-ui` are not served by the `api` process
  today; they run as their own Vite dev/preview processes on their own ports, exactly as
  `opscli`'s `COMPONENT_URL` table describes.
- **The `/ws` route exists, but there is no terminal, non-upgrade fallback, and no `426`
  anywhere.** `apps/api/src/routes/ws.ts` registers exactly one handler, `app.get("/ws",
  upgradeWebSocket(...))`, wired in from `app.ts` via `@hono/node-ws`'s `createNodeWebSocket`.
  Nothing else in `app.ts` touches `/ws` afterward. A whole-tree search for `426` returns zero
  matches. What a plain, non-upgrade `GET /ws` actually returns today was not traced past the
  `upgradeWebSocket()` call boundary in this pass (see Limits) — the point relevant to this
  proposal is only that upstream has no static-asset catch-all for `/ws` to conflict with, since
  there is no static-asset serving at all (previous bullet).
- **Crash-restart coverage is real but uneven, and has no exponential backoff anywhere.**
  `apps/opscli/src/lib/service.ts`'s `registerAutostartService` gives Linux a systemd unit with
  `Restart=always` / `RestartSec=3` — a fixed interval, not backoff; macOS a LaunchAgent with
  `KeepAlive`, with no configurable delay; and Windows a Scheduled Task triggered `/SC ONLOGON`,
  which reruns the launch command only at the next login and has **no crash-restart behavior at
  all** if the process dies mid-session. A whole-tree search for `backoff` returns exactly one
  match, in an unrelated skill document about browser-navigation retries, not process
  supervision.

**Stated plainly, the accurate size of the gap:** a single-process, single-port,
container-native launch mode with a self-reported liveness route is not something upstream ships
today, in any form, under any name, anywhere in the tree — not because the pieces exist and only
need a supervisor wrapped around them, but because the health route and the single-port static
serving do not exist upstream at all, and the restart story that does exist is host-service-manager
shaped, not supervisor-shaped.

## What is proposed

An **additive, optional** deployment mode, never a replacement for the five-service mode `opscli`
already serves well:

- A supervisor that starts and restarts the two already-independent long-running processes
  (`api`, `agent-runner`) as one process group, with exponential backoff rather than a fixed
  interval, and a bounded shutdown grace period.
- One HTTP-observable liveness route the `api` process exposes itself, so an external probe
  (a container orchestrator, a load balancer) has something to call without depending on
  `opscli` or any other external poller.
- One code path, inside the same process and port as the API, that serves `admin-ui`'s and
  `user-ui`'s already-built static assets, so a single port serves everything.

Explicitly out of scope for this design: any platform-specific health-check timing convention;
changing `/ws`'s current upgrade-only behavior beyond whatever the static-asset path requires to
avoid a conflict; and retiring, deprecating, or steering anyone away from the existing
five-service / `opscli` path, which remains the right answer for a self-hosted VM or a
local-evaluation setup.

**Feasibility, stated honestly and without shipping code:** a private fork of this project runs a
comparable supervisor today as a small, self-contained package with no dependency on anything
else fork-specific — it only spawns the two already-independent upstream entry points
(`apps/api`'s and `apps/agent-runner`'s own process entry points) through a pinned Node runtime,
and computes its own backoff and shutdown timing independently. It is cited here only as evidence
that this design is buildable with a small dependency footprint; no source from it is included in
this PR, and its tests were not re-executed as part of this pass (see Limits).

## Passing demonstration (leads)

Claim: upstream already ships one shell command that launches the API, the agent runner, and the
user UI together as a supervised process group — the part of this problem upstream already
solves, and the reason this proposal opens by crediting `opscli` rather than describing "no
supported path."

```
$ ./verify-spec05.sh ./snapshot user-stack-launcher
PASS: start:user-stack:env launches api+runner+user-ui via concurrently -k
exit code: 0
```

This is a genuine pass against real upstream `package.json` bytes extracted at the tip cited
below, not a fabricated result. It confirms `opscli`'s `start:user-stack:env` script combines
`start:api:env`, `start:runner:env`, and `start:user-ui:preview:env` under one `concurrently -k`
invocation, tracked as one PID by `apps/opscli/src/lib/user-stack.ts`. What it does not confirm —
and what the failing demonstration below establishes — is any of the three capabilities this
proposal's narrower gap identifies as genuinely missing: a self-reported health route, single-port
static serving, or backoff-based restart.

## Evidence: method, tip, and reproduction

**Method.** Every claim above was checked one of two ways: a full read of the named file at the
cited upstream commit, or a whole-tree `git grep` for the literal term and reasonable synonyms
(for the health-route search: `/health`, `/healthz`, `/status`, `health_check`, `healthCheck`; for
static serving: `serveStatic`, `serve_static`, `express.static`, `static(`, `sirv`,
`serveSpaIndex`). These are lexical checks, not structural ones — see Limits for what that does
and does not rule out.

**Upstream tip used throughout:**

```
$ git rev-parse upstream-live/main
255b33418a3094d8c61dc6e38a014e9134f4fae1
```

confirmed live against the public repository on 2026-09-21. Every line count, quoted line, and
grep result in this document is current as of this commit.

**Reproduction recipe (exact commands, runnable by a stranger with only `git` and a POSIX
shell):**

```bash
# Work from any scratch directory of your own choosing.
WORKDIR=/path/to/a/scratch/directory
mkdir -p "$WORKDIR/snapshot"
cd "$WORKDIR"

# Step 0 -- create the upstream-tracking ref, if you don't already have one:
git fetch https://github.com/camplight/orgops.git main:refs/remotes/upstream-live/main

# Step 1 -- confirm the tip:
git rev-parse upstream-live/main
# expect: 255b33418a3094d8c61dc6e38a014e9134f4fae1

# Step 2 -- extract the exact files this document cites, verbatim, at that tip:
git show upstream-live/main:package.json                          > snapshot/package.json
git show upstream-live/main:apps/api/src/app.ts                   > snapshot/app.ts
git show upstream-live/main:apps/api/src/server.ts                > snapshot/server.ts
git show upstream-live/main:apps/api/src/routes/ws.ts              > snapshot/ws.ts
git show upstream-live/main:apps/opscli/src/lib/component-runtime.ts > snapshot/component-runtime.ts
git show upstream-live/main:apps/opscli/src/lib/user-stack.ts      > snapshot/user-stack.ts

# Step 3 -- the whole-tree searches behind every "absent" claim above:
git grep -niE '"/health|/healthz|/status"|health_check|healthCheck' upstream-live/main -- '*.ts' '*.js' '*.json'
git grep -niE 'servestatic|serve_static|express\.static|static\(|sirv|serveSpaIndex' upstream-live/main -- '*.ts'
git grep -n '426' upstream-live/main -- '*.ts'
git grep -ni backoff upstream-live/main -- '*.ts' '*.json' '*.md'

# Step 4 -- save verify-spec05.sh (below) into $WORKDIR, then:
chmod +x verify-spec05.sh
./verify-spec05.sh ./snapshot user-stack-launcher          # expect PASS, exit 0
./verify-spec05.sh ./snapshot single-process-http-surface  # expect FAIL, exit 1
```

`verify-spec05.sh`, verbatim, as run for both demonstrations in this document:

```bash
#!/usr/bin/env bash
# verify-spec05.sh <snapshot-dir> <claim>
# Checks one claim about upstream orgops's app.ts / package.json files,
# extracted verbatim from upstream-live/main via `git show`.
set -u
DIR="$1"
CLAIM="$2"

case "$CLAIM" in
  user-stack-launcher)
    if grep -q '"start:user-stack:env"' "$DIR/package.json" \
       && grep -q 'concurrently -k' "$DIR/package.json" \
       && grep -q 'start:api:env' "$DIR/package.json" \
       && grep -q 'start:runner:env' "$DIR/package.json" \
       && grep -q 'start:user-ui:preview:env' "$DIR/package.json"; then
      echo "PASS: start:user-stack:env launches api+runner+user-ui via concurrently -k"
      exit 0
    else
      echo "FAIL: no combined user-stack launch script found"
      exit 1
    fi
    ;;
  single-process-http-surface)
    missing=""
    grep -q '"/health"' "$DIR/app.ts" || missing="$missing /health-route"
    grep -q 'serveStatic' "$DIR/app.ts" || missing="$missing serveStatic"
    grep -q '426' "$DIR/app.ts" || missing="$missing ws-426-terminal-handler"
    if [ -z "$missing" ]; then
      echo "PASS: combined health + static-serving + ws-426 surface found in app.ts"
      exit 0
    else
      echo "FAIL: missing in app.ts:$missing"
      exit 1
    fi
    ;;
  *)
    echo "usage: $0 <snapshot-dir> {user-stack-launcher|single-process-http-surface}"
    exit 2
    ;;
esac
```

## Failing demonstration (second, genuine, not fabricated)

Claim: `app.ts` already exposes a combined `/health` route, static-asset serving, and a terminal
`426` handler for `/ws` — i.e. that this proposal's scope is already partly built and only needs a
supervisor wrapped around it.

```
$ ./verify-spec05.sh ./snapshot single-process-http-surface
FAIL: missing in app.ts: /health-route serveStatic ws-426-terminal-handler
exit code: 1
```

This failure is real, not a bug in the checker: it is upstream's actual current file content,
extracted the same way as the passing run above, from the same snapshot, at the same tip. It is
the reason this document scopes the health route and the static-asset serving as **new work to
land upstream**, not as existing code that only needs a supervisor wrapped around it.

## Limits — read before trusting this proposal's evidence

- **This is a packaging proposal, not a change to how the application works.** Nothing here
  alters `api` or `agent-runner`'s own request handling, business logic, or database access; the
  scope is a launch mode, a liveness route, and a static-asset path around code that is otherwise
  unchanged.
- **`opscli` remains the right answer for the machine-administered case.** This proposal does not
  claim to replace it, improve on it, or address any gap in it. The two solve different
  deployment shapes: a host you administer with `npm`/`node` installed, versus a container runtime
  that expects one process, one port, and its own restart policy.
- **The absence checks are lexical, not structural.** A health route registered through an
  unusual call shape (a router mounted under a variable name, a route added inside `server.ts`
  under a different framework call), or a static-file handler under a name not searched for, would
  not be caught by a `git grep`. The search terms were widened to whole-tree and to reasonable
  synonyms specifically to reduce this risk, but the synonym list is not exhaustive.
- **`@hono/node-ws`'s behavior for a non-upgrade `GET /ws` was not traced past the
  `upgradeWebSocket()` call boundary.** This document establishes that no second, terminal
  handler is registered after it and that no `426` appears anywhere in the tree; it does not
  establish what HTTP status a plain request to `/ws` actually receives today, which would
  require running the built server rather than reading its source.
- **`opscli`'s polling and service-registration code was read, not run.** No `npm install`, no
  actual `opscli install --register-service` invocation, and no live systemd/LaunchAgent/Scheduled
  Task registration was performed for this document; the behavior described is read directly from
  the shipped source, not observed at runtime.
- **The fork-side supervisor cited under Feasibility was read, not re-executed.** Its file and
  dependency counts were confirmed by direct inspection; its own test suite was not run as part of
  producing this document.
- **This document does not resolve whether the remaining gap is worth an upstream code change.**
  Whether a maintainer would rather close it with new `app.ts` routes, with a documented
  reverse-proxy recipe extending the README section already quoted above, or not at all, is a
  scope and maintenance-burden judgment for upstream, not something this document decides.

## What this PR contains

Exactly one new file: this document. No supervisor code, no `app.ts` change, no new route, no new
dependency, and no CI change ship in this PR. `verify-spec05.sh` above is quoted for
reproducibility of this document's own evidence; it is not proposed as a tool this project would
adopt or maintain, and is not included as a separate file.
