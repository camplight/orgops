# Definition of Ready Validation: Multi-Source Ingestion & Governance Track

Extracted from the original DISCUSS-wave DoR validation
(`docs/feature/nwave-ticket-execution-engine/discuss/dor-validation.md`), which already
validated these stories against the 9-item hard gate. This is a subset extraction, not a
re-validation.

## Summary Matrix (US-11, US-12, US-13)

| Story | 1. Problem | 2. Persona | 3. Examples | 4. UAT (3-7) | 5. AC from UAT | 6. Right-sized | 7. Tech notes | 8. Dependencies | 9. Outcome KPIs | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| US-11 Trello ingestion | PASS | PASS | PASS | PASS (5) | PASS | PASS | PASS | PASS (`trello-cli` skill exists) | PASS | READY |
| US-12 Approve/request changes | PASS | PASS | PASS | PASS (4) | PASS | PASS | PASS | PASS (US-06; `guardrail_config` tracked in DESIGN) | PASS | READY |
| US-13 Failure/stuck recovery | PASS | PASS | PASS | PASS (4) | PASS | PASS | PASS | PASS (US-05, US-07) | PASS | READY |

**Track DoR Status: PASSED (3/3 stories meet all 9 items, no CONDITIONAL right-sizing flags).**
Unlike `nwave-invocation-engine` and parts of `progress-trust-ux`, none of this track's
stories carry a SPIKE-related tracked dependency — its main open item is organizational
(guardrail policy ownership for US-12, see this track's `wave-decisions.md`), not technical.

## Evidence Notes (carried from original validation)

- **Item 4 (UAT scenarios)**: US-11 has 5 scenarios (gained a concurrency/race-condition
  scenario during peer-review remediation — two near-simultaneous Trello syncs of the same
  card); US-12 and US-13 have 4 each. All within the 3-7 range.
- **Item 6 (right-sized)**: All three stories are assessed as plausibly 1-3 days each. US-11
  is explicitly the lowest-effort of the three — it composes the existing `trello-cli` skill
  rather than requiring new integration capability. US-12's effort assumes `guardrail_config`
  as a data concept is straightforward to model once its ownership question (Decision 5) is
  answered; if that policy question remains unresolved when DESIGN reaches this track,
  US-12's estimate should be revisited.
- **Item 8 (dependencies)**: US-11 depends on `trello-cli` (already exists, PASS). US-12
  depends on US-06 (from `progress-trust-ux`) and tracks `guardrail_config` as a DESIGN-wave
  concern (not silently assumed — see umbrella `wave-decisions.md` Decision 5). US-13 depends
  on US-05 and US-07 (also from `progress-trust-ux`).
- **Item 9 (outcome KPIs)**: US-11's >= 50% Trello-adoption target and US-12's "100% decided
  within 3 business days" target are both explicitly analyst-estimated priors pending
  post-release validation (see this track's `wave-decisions.md`, Decision 2).

## Peer Review Remediation Relevant to This Track

The original peer review (`nw-product-owner-reviewer`, 2026-07-21, approved, zero critical
issues) raised one item touching this track directly: missing concurrency/race-condition
scenario for US-11 (two near-simultaneous Trello sync events), remediated by adding one
scenario + AC, bringing US-11 to 5 scenarios (still within the 3-7 range). The
`guardrail_config` ownership question (relevant to US-12) was already explicitly tracked in
the umbrella `wave-decisions.md` prior to review (Decision 5) and required no further
remediation beyond confirming it remains visible for DESIGN.
