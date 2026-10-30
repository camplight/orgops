# Deployment security and penetration-test follow-up

The API fixes belong in OrgOps. Product authentication/UI policies and deployment
configuration belong to the application or host that serves them. Nest consumes
reviewed engine changes through its pinned submodule; do not patch the vendored
checkout. No PR in this series changes a running host automatically.

## Host routing and headers

The report tested nginx on `orgops.exe.xyz`. Verify the actual host configuration
before changing it, keep its TLS/HSTS settings, and run `nginx -t` before reload.
These fragments belong inside the appropriate existing server block; they are
not a replacement TLS configuration:

```nginx
server_tokens off;

# Use the actual local API upstream. Exact matching prevents SPA fallback.
location = /health {
    proxy_pass http://127.0.0.1:8787;
}

# Supply real metadata files/routes if wanted; otherwise return honest 404s.
location = /robots.txt { return 404; }
location = /security.txt { return 404; }
location = /.well-known/security.txt { return 404; }
location = /sitemap.xml { return 404; }
```

For the SPA, configure `X-Content-Type-Options: nosniff`,
`Referrer-Policy: no-referrer`, `X-Frame-Options: SAMEORIGIN`, and an appropriate
Permissions-Policy. Keep existing policies if the product deliberately needs
cross-origin embedding or media capture. Nginx `add_header` inheritance is
location-dependent: inspect the effective headers on success and error responses,
and retain existing HSTS when adding new headers. Avoid duplicate conflicting
policies from application and proxy.

Start a frontend CSP in report-only mode, inventory scripts/styles, images,
WebSocket endpoints and embedded publications, then enforce the tested policy.
Do not blindly copy the API's `default-src 'none'` onto the UI or demos. A useful
starting inventory is `default-src 'self'; object-src 'none'; base-uri 'self';
frame-ancestors 'self'`, with the precise script/style/media/connect sources added
from the deployed application. Verify password/Google login, avatars, chat files,
WebSockets, public demo scripts and any intended iframe usage before enforcement.

Enforce matching upload/body limits and timeouts at the edge. Keep API/runner
ports private where possible. Restrict federation egress at the network boundary
as defense in depth, and approve private/HTTP peers only by exact operator-owned
`ORGOPS_FEDERATION_TRUSTED_ORIGINS` entries.

## Upgrade and compatibility checks

- Back up the engine database and runtime files. Nest also needs its separate
  product database and its preserved runner IDs/workspaces/provider logins.
- Operator controls use the existing bootstrap-owner policy, not a new role
  migration: the first human by `(created_at, id)` or the global runner. Ordinary
  members no longer manage accounts, runner credentials, federation or global
  event deletion. A future explicit-role migration is separate work.
- Existing custom workspaces are not moved or deleted. Members get generated
  workspaces for new agents, cannot browse legacy paths outside the managed root,
  and unsafe cleanup is refused. Review existing agents and custom workspaces as
  an operator. Clients must use the returned workspace path.
- Native agents still run shell commands under their runner's OS identity.
  API permissions are not an OS sandbox. Use separately trusted runners,
  containers or VMs where host isolation is required; this series does not claim
  to eliminate native shell access.
- Scope existing peers explicitly before resuming federation. Remote transfers
  arrive stopped/unassigned without secrets. Review portable skill scripts and
  workspace contents; provision credentials locally after transfer.
- Password sessions expire after eight hours. Password/identity changes rotate
  the cookie and revoke sibling sessions. Clients must adopt Set-Cookie.
- Share links are bearer capabilities. Avoid logging their query strings,
  preserve no-referrer behavior, rotate exposed links and use the product's
  authenticated publication gate where appropriate. This series does not remove
  the intentional share-link feature. Publicly readable client-side API names
  are not an authorization boundary.

## Verification record and remaining findings

The security series adds exploit-path regressions and runs existing API tests,
actual WebSocket clients, federation redirect/size tests, and production UI builds.
Each PR includes a screenshot of actual isolated validation results.

Untouched upstream main `e5dedf5` reproduces four local full-suite failures:
filesystem ordering in skills, shell exit timing, and two upload tests affected by
macOS `/var` versus `/private/var` aliases. The standalone CLI also reproduces one
live-service timeout (18/19 pass), and root lint stops at its existing
`source.ts` string-or-Buffer type error. These are disclosed rather than hidden
with test exclusions. No new failure was observed in the security stack.

The original Vite/follow-redirects advisories are patched, as are the additional
Undici findings. A fresh audit still flags Zod
[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
The published fix requires Zod 4.6.6 or later, while this code uses Zod 3. A major
schema-library migration needs its own compatibility work. Request limits reduce
input exposure but do not establish that this advisory is fully remediated.

The host's frontend headers/CSP, nginx version disclosure and route mappings
remain deployment tasks until installed and verified on that host. These PRs
have not been merged, deployed, or independently penetration-tested in production.
