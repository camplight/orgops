# ADR-0007: Completion Summary Backed by a Persisted Anchor Row, Pending a DELIVER-Wave Output Contract That Does Not Yet Exist

## Status

Accepted.

## Context

US-06 requires a completion summary with a plain-language description of what changed, a
working link to the produced branch/PR, and an accurate, traceable count of acceptance scenarios
passed. None of this data exists anywhere in the current design: `nwave-invocation-engine`'s own
Extension Points explicitly treat DELIVER-wave stdout as "not parsed or treated as authoritative"
— the wave-exit signal (a binary exit code, per ADR-0002) is the only authoritative output today.

There is, as of this DESIGN pass, **no defined contract** for how nWave's DELIVER wave would
communicate branch/PR references or scenario-outcome data back to `agent-runner`. Inventing that
contract unilaterally in this pass would overstep this track's authority — it is a property of
nWave's own DELIVER-wave methodology and `nwave-invocation-engine`'s wave-chaining mechanism, not
of `progress-trust-ux`. At the same time, US-06 is a Walking Skeleton story — it needs to produce
*something* honest now, not wait indefinitely for that contract to be defined elsewhere.

## Decision

Design the Completion Summary Composer against a **defined port** (`CompletionArtifact`:
`{ branchRef?, prUrl?, scenariosPassed?, scenariosTotal?, failingScenarioNames?, description? }`)
without building an adapter that can populate it from real data yet. Persist every completion in
a new **`nwave_run_completions`** anchor row regardless of whether the artifact data is
available, with an explicit `contract_data_available` boolean. When the port cannot resolve real
data (true for every run today), the Composer posts a **degraded-but-honest** completion message:
it states the run finished (or failed/halted, naming the wave), links to the raw output stream
(US-05) as the verification fallback, and explicitly states that detailed change/scenario data is
not yet available pending the DELIVER-wave output contract — rather than fabricating a plausible-
looking but false summary, or silently omitting the message entirely.

The exact shape of the future contract (see brief.md's "Cross-Cutting Gap: Wave Completion Signal
Vocabulary") is sketched as a recommendation for `nwave-invocation-engine`/nWave to evaluate, not
mandated here.

## Alternatives Considered

### 1. Block US-06 entirely until the DELIVER-wave output contract is defined elsewhere

**Rejected.** US-06 is explicitly a Walking Skeleton story (Release 0) — blocking it on an
unscheduled upstream contract from a different track/methodology layer would mean shipping no
completion summary at all, failing the story outright and leaving submitters with genuine
silence at the moment they most need reassurance (exactly the failure mode US-06 exists to
prevent).

### 2. Infer branch/PR/description by having the Composer inspect the target git repository directly (e.g., `git rev-parse HEAD`, `git log -1`) as a stand-in for a real contract

**Rejected.** This presumes specifics of nWave's own git workflow (branch-naming convention,
whether/how a PR is opened, e.g. via `gh pr create`) that are not confirmed anywhere in this
design or the sibling tracks' — inventing that assumption here risks quietly encoding a
false picture of nWave's actual DELIVER-wave behavior, which is worse than an honest "not yet
available" message. It would also still provide no scenario-pass-count data at all (git state
alone cannot reveal acceptance-scenario outcomes), so it would only partially close the gap while
adding a brittle, unconfirmed assumption.

### 3. Persisted anchor row + honest degraded message + a defined-but-unimplemented port (chosen)

**Accepted.** Ships a real, honest completion summary now (satisfying "never silent" and "no
broken/placeholder link," which are the actual AC requirements this design can control) without
fabricating data it cannot verify or presuming an unconfirmed nWave implementation detail. Gives
`multi-source-ingestion-governance`'s future US-12 a stable row to attach an `approval_status`
column to regardless of when the DELIVER-wave contract closes. When that contract is eventually
defined, only a new adapter is added — the Composer, the anchor row's shape, and every consumer
of it (including the future US-12 UI) are unaffected.

## Consequences

**Positive**

- US-06 ships a real, honest, never-silent completion message in this pass, meeting its Walking
  Skeleton commitment.
- `nwave_run_completions` gives `multi-source-ingestion-governance`'s future US-12 a stable
  attachment point that does not depend on this gap closing first.
- Does not foreclose or presume any specific shape for nWave's eventual DELIVER-wave output
  contract — the recommendation in brief.md's Cross-Cutting Gap is explicitly non-binding.
- The interface (`CompletionArtifact` port) does not change when the real contract lands — only
  a new adapter is added, consistent with this project's ports-and-adapters convention.

**Negative**

- Every completion summary shipped in this release is degraded (no branch/PR link, no scenario
  count) until the DELIVER-wave output contract exists — a real, user-visible limitation of the
  walking skeleton, not a hidden one. Submitters must currently use the raw output stream (US-05)
  to verify what changed, which is a materially weaker experience than US-06's full AC intends.
  This is the direct cost of not inventing an unconfirmed contract unilaterally.
- `contract_data_available = false` on every row until that gap closes means analytics/KPI
  queries built against `nwave_run_completions` (e.g., US-06's "median time-to-verify" KPI) will
  reflect degraded-summary behavior, not the fully-realized experience, until the contract lands.

## Enforcement

No new structural rule beyond existing module-boundary rules. The Completion Summary Composer's
dependency on an unimplemented port is enforced the same way every other port dependency is in
this codebase: the pure composition logic depends only on `ProgressControlPort`'s interface, not
on any concrete adapter, so adding a real `CompletionArtifact`-populating adapter later requires
no change to the Composer itself — verifiable by the same dependency-cruiser rule already
recommended (pure logic modules must not `fetch`/`apiFetch` directly).
