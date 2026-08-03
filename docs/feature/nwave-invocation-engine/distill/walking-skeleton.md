# Walking Skeleton: nWave Invocation Engine

One walking skeleton for this track's single story — within the recommended 2-3 range (a
single-story track does not need three). Answers "can a user accomplish their goal and see the
result?", not "do the layers connect?"

## WS-1 (US-04): Maria confirms the system's understood intent and an nWave implementation run starts, identified by a stable run id

**File**: `apps/agent-runner/src/nwave-invocation/nwave-invocation.test.ts`
**Tags**: `@walking_skeleton @real-io @in-memory @driving_port @US-04`

- **Title test**: describes a user goal ("Maria confirms... and a run starts"), not a technical
  flow ("orchestrator calls port calls adapter").
- **Given/When**: "TICKET-1043 has been classified as development work" / "the system posts its
  plain-language restatement and Maria Santos confirms 'Looks right'" — user context and action
  in business language, not system-state setup phrased technically. Lifted directly from US-04's
  own first UAT scenario (`discuss/user-stories.md`), not re-derived.
- **Then**: "an nWave implementation run starts... identified by a stable run id" — an
  observable outcome a non-technical stakeholder can confirm ("yes, once I say it looks right,
  work should actually start, and I should be able to reference it later").
- **Boundary proof (Dimension 9d)**: if the real `HttpRunRepository`/SQLite/API adapter were
  deleted, this test could not pass — `triggerRunForConfirmedIntent` makes a real HTTP call
  through the real Hono app against a real in-memory database, and spawns a real (trivial) OS
  process via `createRealShellStart()`. Only the Restatement Composer's LLM call is faked (a
  costly, external, non-deterministic dependency, per Strategy B — see distill/wave-decisions.md
  DWD-01).

## Litmus Test Result (per nw-test-design-mandates)

| Check | WS-1 |
|---|---|
| 1. Title = user goal, not technical flow | Pass |
| 2. Given/When = user actions/context | Pass |
| 3. Then = user observations, not internal side effects | Pass |
| 4. Non-technical stakeholder could confirm "yes, that's what users need" | Pass |

## Why Only One Walking Skeleton

This track owns a single story (US-04) with a single primary user journey (confirm → run
starts). The recommended 2-3 walking skeletons per feature applies when a feature spans multiple
distinct user goals (as `multi-source-ingestion-governance`'s three walking skeletons did, one
per story). The remaining 14 scenarios in this track are focused boundary tests covering US-04's
alternative/error paths (correction, start failure, non-zero exit, stale-wave halt, idempotent
redelivery, access control) — each a variation on the same single user journey, not a distinct
user goal warranting its own walking skeleton.
