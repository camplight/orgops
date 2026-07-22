# Definition of Ready Validation: Ticket Classification Track

Extracted from the original DISCUSS-wave DoR validation
(`docs/feature/nwave-ticket-execution-engine/discuss/dor-validation.md`), which already
validated these stories against the 9-item hard gate: (1) Problem statement clear, domain
language | (2) User/persona with specific characteristics | (3) 3+ domain examples with real
data | (4) UAT in Given/When/Then, 3-7 scenarios | (5) AC derived from UAT | (6) Right-sized
(1-3 days, 3-7 scenarios) | (7) Technical notes: constraints/dependencies | (8) Dependencies
resolved or tracked | (9) Outcome KPIs defined with measurable targets. This is a subset
extraction, not a re-validation.

## Summary Matrix (US-01, US-02, US-03)

| Story | 1. Problem | 2. Persona | 3. Examples | 4. UAT (3-7) | 5. AC from UAT | 6. Right-sized | 7. Tech notes | 8. Dependencies | 9. Outcome KPIs | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| US-01 Submit ticket (native form) | PASS | PASS | PASS | PASS (4) | PASS | PASS | PASS | PASS (none) | PASS | READY |
| US-02 Automatic classification | PASS | PASS | PASS | PASS (5) | PASS | PASS | PASS | PASS (US-01) | PASS | READY |
| US-03 See/correct classification | PASS | PASS | PASS | PASS (4) | PASS | PASS | PASS | PASS (US-02) | PASS | READY |

**Track DoR Status: PASSED (3/3 stories meet all 9 items, no tracked dependencies, no
conditional items).** This is the cleanest of the four tracks with respect to DoR — none of
its stories carry a SPIKE dependency or a confirmed-absent-infrastructure flag.

## Evidence Notes (carried from original validation)

- **Item 1/2 (problem + persona)**: All three stories name a specific persona and situation in
  plain domain language (e.g., US-01: "Maria Santos... has no single place to hand off a
  piece of work and trust it will be picked up..."), never generic "user"/"customer" phrasing.
- **Item 3 (domain examples)**: All three stories use real ticket ids (TICKET-1042 through
  TICKET-1046) and real personas (Maria Santos, Devon Park, Carlos Mendes) — no generic data
  (`user123`, `test@test.com`) anywhere.
- **Item 4 (UAT scenarios)**: US-02 has 5 scenarios (gained a scenario during peer-review
  remediation covering automatic classification timing and failure surfacing); US-01 and
  US-03 have 4 each. All within the 3-7 range, all in Given/When/Then form with
  business-outcome titles.
- **Item 6 (right-sized)**: All three stories are assessed as plausibly 1-3 days each — they
  compose existing OrgOps primitives (channel creation/subscription for US-01; a new but
  self-contained classification decision event for US-02/US-03) rather than requiring net-new
  infrastructure. Unlike US-04/US-09/US-10 in the other tracks, none of this track's stories
  are CONDITIONAL.
- **Item 8 (dependencies)**: Simple story-to-story dependencies only (US-02 depends on US-01;
  US-03 depends on US-02), resolved by release sequencing — both are in Release 0 (walking
  skeleton) per the umbrella `story-map.md`.
- **Item 9 (outcome KPIs)**: Each story uses the Who/Does What/By How Much/Measured By/
  Baseline formula; baselines are honestly stated as 0%/"capability does not exist" rather
  than fabricated.

## Peer Review Remediation Relevant to This Track

The original peer review (`nw-product-owner-reviewer`, 2026-07-21, approved, zero critical
issues) raised one item touching this track directly: missing NFR targets, remediated by
adding the `## Non-Functional Requirements` section to the original `user-stories.md`. The
performance target "classification result posted within 60 seconds" is already reflected as
an AC on US-02 in this track's `user-stories.md`.
