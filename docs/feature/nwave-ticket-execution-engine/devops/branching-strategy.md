# Branching & Release Strategy — nWave Ticket Execution Engine

## Confirmed Strategy: Trunk-Based Development

Confirmed by observed practice, not chosen speculatively: the repo's git history shows direct
commits to `main`, no long-lived feature branches. This is the existing convention; this feature
does not change it, but its CI implications must now actually be met (see below).

## Trunk-Based Development Requires Robust CI Gates — Which Did Not Fully Exist

Per `nw-cicd-and-deployment`: "Every commit to main triggers full pipeline. Requires robust
automated gates since main always releasable." Before this DEVOPS pass, that requirement was
**not met** — `.github/workflows/` had only the `opscli` release workflow, no test/lint gate (see
`ci-cd-pipeline.md`). Trunk-based development without a commit-stage gate is not actually
trunk-based development in the safety sense the strategy assumes; it is "direct commits to main
with no gate," which is a materially riskier practice than the label implies. **This pass closes
that gap** — `ci-cd-pipeline.md`'s new `ci.yml` is the concrete precondition that makes this
project's existing trunk-based practice actually safe for a feature of this size (8 new tables, 2
new external integrations, a fail-closed governance gate).

## Triggers

- `push: [main]` — every direct commit to `main` runs the full `ci.yml` gate (lint, test,
  migration dry-run, secrets scan, SCA, dependency-cruiser once configured, build, CLI contract
  smoke tests).
- `pull_request: [main]` — if a PR is used for a given change (not mandatory under trunk-based,
  but not precluded either), the same gate runs as a merge-blocking status check.
- `release-main.yml` is unaffected — it remains a separate, `opscli`-specific release action,
  triggered the same way it already is (`push: [main]`), running after/alongside `ci.yml` as an
  independent job, not gated by it (this feature does not change `opscli`'s release process).

## Branch Protection on `main` (recommended, not yet configured — flagged for repo admin action)

Per `nw-cicd-and-deployment`'s Branch Protection Rules pattern, adapted to this project's actual
practice (small team, direct commits accepted, no evidence of a 2-approver review culture today):

- **Require the `ci.yml` status check to pass** before a commit can land on `main` (this is the
  concrete gate; without it, this entire DEVOPS pass' CI work is advisory, not enforced).
- **Do not** mandate 2+ PR approvals — no evidence this small team practices PR review today
  (observed direct-commit history), and mandating it now would be a process change outside this
  feature's scope and this agent's authority (a platform/tooling decision, not a governance
  policy decision this agent can impose).
- Restrict force-pushes to `main` — standard hygiene, no cost to this team's practice.

**This is a recommendation for the repository owner to configure in GitHub branch protection
settings** — it cannot be expressed as a file in this repo; flagged here so it is not lost.

## Feature-Flagging for Incomplete Work (a trunk-based requirement this feature specifically needs)

Trunk-based development requires incomplete work to be safely mergeable without being
user-visible. This feature is large (4 tracks, 8 new tables, new routes, two new background
loops) and will land incrementally across multiple commits/PRs to `main` before Release 0 is
complete. Recommend a single config-level gate, following the existing `ORGOPS_*` env var
convention (no new feature-flag framework/dependency):

- `ORGOPS_NWAVE_TICKET_ENGINE_ENABLED` (default `false` until Release 0 is ready to ship) — when
  unset/false, new routes (`/api/tickets*`, `/api/nwave-runs*`, `/api/trello-ingestion*`,
  `/api/guardrail-allowlist*`) return `404`/are not registered, and the new `agent-runner` modules
  do not start their poll/consume loops. This lets partially-implemented modules merge to `main`
  continuously (satisfying trunk-based development's core requirement) without being reachable in
  production before they are ready — cheaper than maintaining a long-lived branch, and consistent
  with this project's existing single-binary/single-deploy shape (no separate "canary" instance to
  gate via traffic-shifting instead).
- **Elevated to a mandatory precondition, not an optional recommendation, per peer review**: the
  variable is now documented in `.env.example` (committed this pass, default `false`), and the
  gating logic (route registration / module startup checking the flag) **must land in the very
  first DELIVER-wave commit that adds any new route or module** — before that, no other commit
  for this feature should merge to `main`, or trunk-based development's "main always releasable"
  guarantee is violated for the duration this feature is mid-flight. This is a `software-crafter`
  implementation task (application code, outside this agent's remit to write), but it is now a
  named, blocking DEVOPS-wave handoff item, not a soft suggestion.

## Release Workflow

No change to the existing `release-main.yml` semver+date rolling-release mechanism for `opscli`.
This feature does not introduce a second release artifact — `api`/`agent-runner`/`ui` are deployed
via the Recreate process described in `ci-cd-pipeline.md`, not packaged as a release artifact the
way `opscli` is. If this project later needs a versioned release process for the `api`/
`agent-runner`/`ui` trio (e.g., to support the environments in `environments.yaml` beyond a single
host), that is a future DEVOPS decision with its own trade-off analysis — not designed here, not
precluded.
