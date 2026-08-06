# Deferred Scenarios: Multi-Source Ingestion & Governance (DELIVER Wave)

Per the human's explicit scope decision at the start of this DELIVER pass ("own-scope only,
defer the rest"): this DELIVER pass implements only what genuinely belongs to
`multi-source-ingestion-governance` and can reach real GREEN without another track's data model
or shared pure function existing. Everything else stays RED, on purpose, with the reason
recorded here so it is not mistaken for an oversight.

**Phase 4 review-remediation update**: the 16 deferred scenarios listed below are now marked
`it.skip(...)` directly in `trello-ingestion.test.ts`, `governance-approval.test.ts`, and
`failure-recovery.test.ts` (each with a one-line `// DEFERRED: ...` comment pointing back to
this file), rather than left as actively-failing tests. `.github/workflows/ci.yml`'s
`build-and-test` job runs repo-wide `npm test` as a blocking CI gate on every push/PR to `main`,
so unskipped failing tests here would have broken CI for unrelated future work. This file
remains the single source of truth for *why* each scenario is deferred and *when* it should be
revisited (see Handoff below); the test files are now in sync with it, not merely narrating it.

## Achievable now (9 of 26 scenarios) — see `roadmap.json`

| Scenario | File | Step |
|---|---|---|
| US-12 #10 guardrail evaluator holds when file-change data unavailable | `guardrail-evaluator.test.ts`(inline) | 01-01 |
| US-12 #11 guardrail evaluator clears covered paths | same | 01-01 |
| US-13 #1 WS: Devon sees a clear failure summary | `failure-recovery.test.ts` | 01-02 |
| US-13 #3 raw stack traces never shown without context (property) | same | 01-02 |
| US-13 #4 repeated failures always escalate (property) | same | 01-02 |
| US-11 #2 board registration + poll-status observation | `trello-ingestion.test.ts` | 02-01 |
| US-11 #7 no-session board config rejected | same | already green (global auth gate) — regression-checked, no new work |
| US-12 #9 guardrail allowlist CRUD | `governance-approval.test.ts` | 02-02 |
| US-12 #7 unauthorized governance sign-off rejected | same | already green (global auth gate) — no new work, `nwave-runs.ts` untouched |

## Deferred (16 of 26 scenarios) — blocked on sibling-track data/functions

**Blocked on `tickets`/`nwave_runs`/`nwave_run_completions` not existing** (owned by
`ticket-classification` / `nwave-invocation-engine` / `progress-trust-ux`, none delivered yet):

- US-11 #1 (WS), #3, #4, #5 (property), #6 — every scenario whose poller path calls
  `createIngestedTicket` → real `POST /api/tickets`, which needs `tickets.ts`'s actual
  insert/unique-constraint logic (`ticket-classification`'s ownership, ADR-0009).
- US-12 #1 (WS), #2, #3, #4, #5, #6 (property), #8 — every `approve`/`request-changes`/
  `governance-signoff`/`cycle-history` scenario that needs a real, queryable `nwave_runs` +
  `nwave_run_completions` row for `run-1043`/`run-1042`/`run-held`/etc. to exist.
- US-13 #5, #7 — `retry`/`escalate`/`close`/`cycle-history` HTTP scenarios, same reason.

**Blocked on the shared `Run Activity Deriver` (`packages/schemas/src/run-activity.ts`), a
`progress-trust-ux` prerequisite scaffold — a subtler case, documented separately below:**

- US-13 #2 (stalled run flagged), #6 (stuck flag auto-clears).

**Already correctly gated, no DELIVER action needed:**

- US-11 #8 — `@requires_external` Trello CLI contract smoke test, `it.skipIf` on a fixture file
  that doesn't exist in this environment by design (CI-only, per the architecture brief's own
  recommendation).

## Architectural Note: Why the Stuck-Run Detector Is Blocked Even Though It's a Pure Function

`stuck-run-detector.ts`'s two direct-call scenarios (US-13 #2/#6) looked achievable at first
pass — `scanRunForStaleness` takes explicit inputs, no DB, no HTTP. But
`docs/product/architecture/brief.md`'s Architecture Enforcement section mandates:

> `stuck-run-detector.ts` must import the shared `Run Activity Deriver`
> (`packages/schemas/src/run-activity.ts`) rather than reimplementing staleness computation
> locally — one shared pure function, two callers... never two competing definitions of "stale."

`run-activity.ts`'s `deriveRunActivity` is itself a prerequisite scaffold owned by
`progress-trust-ux` (its own doc comment says so explicitly) and throws unconditionally. A real
`scanRunForStaleness` that calls it will throw the moment it's invoked; reimplementing the
staleness comparison inline instead would violate ADR-0012's explicit "never a second 'stuck'
definition" invariant — a real architectural decision, not a convenience this pass should
override unilaterally. Per the "own-scope only" decision, this pass leaves both scenarios RED
rather than duplicate another track's shared function or silently violate the enforcement rule.

**Follow-up**: once `progress-trust-ux` delivers `deriveRunActivity` for real, US-13 #2/#6 should
be revisited — likely a small, fast follow-up step (`scanRunForStaleness`'s own shape is already
correct; only the `deriveRunActivity` call site needs to go from throwing scaffold to real
function).

## Handoff

When `ticket-classification`, `nwave-invocation-engine`, and `progress-trust-ux` reach DELIVER,
revisit this file and this track's remaining 16 RED scenarios — no new acceptance-test authoring
should be needed, only real implementations behind already-correct driving ports.
