# Definition of Ready Validation: Progress & Trust UX Track

Extracted from the original DISCUSS-wave DoR validation
(`docs/feature/nwave-ticket-execution-engine/discuss/dor-validation.md`), which already
validated these stories against the 9-item hard gate. This is a subset extraction, not a
re-validation.

## Summary Matrix (US-05, US-06, US-07, US-08, US-09, US-10)

| Story | 1. Problem | 2. Persona | 3. Examples | 4. UAT (3-7) | 5. AC from UAT | 6. Right-sized | 7. Tech notes | 8. Dependencies | 9. Outcome KPIs | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| US-05 Live activity signal | PASS | PASS | PASS | PASS (4) | PASS | PASS | PASS | PASS (US-04) | PASS | READY |
| US-06 Completion summary | PASS | PASS | PASS | PASS (4) | PASS | PASS | PASS | PASS (US-04) | PASS | READY |
| US-07 Wave-by-wave progress | PASS | PASS | PASS | PASS (4) | PASS | PASS | PASS | PASS (US-05, SPIKE granularity) | PASS | READY |
| US-08 Mid-run clarifying question | PASS | PASS | PASS | PASS (5) | PASS | PASS | PASS | **TRACKED** (SPIKE mid-run injection) | PASS | **READY WITH TRACKED DEPENDENCY** |
| US-09 Pause/halt | PASS | PASS | PASS | PASS (5) | PASS | **CONDITIONAL** | PASS | **TRACKED** (SPIKE checkpoint granularity) | PASS | **READY WITH TRACKED DEPENDENCY** |
| US-10 Notify when input needed | PASS | PASS | PASS | PASS (4) | PASS | **CONDITIONAL** | PASS | **TRACKED** (notification infra confirmed absent — net-new build) | PASS | **READY WITH TRACKED DEPENDENCY** |

**Track DoR Status: PASSED, 3 of 6 stories carrying explicitly tracked, non-blocking
dependencies (US-08, US-09 on the now-skipped SPIKE's underlying question; US-10 on
confirmed-absent notification infrastructure).**

## Evidence Notes (carried from original validation)

- **Item 4 (UAT scenarios)**: US-08 and US-09 have 5 scenarios each (gained a
  concurrency/race-condition scenario during peer-review remediation — concurrent mid-run
  messages for US-08, concurrent pause + note for US-09); US-05, US-06, US-07, US-10 have 4
  each. All within the 3-7 range.
- **Item 6 (right-sized) — CONDITIONAL on US-09 and US-10.**
  - US-09 depends on the invocation mechanism's "safe checkpoint" granularity — a
    coarse-grained mechanism could push US-09's work well past 3 days; a fine-grained one
    could keep it within range. Not treated as a DoR failure originally; re-estimate once
    `nwave-invocation-engine` DESIGN selects a mechanism, per this track's
    `wave-decisions.md`.
  - US-10 was upgraded from an initial "plausibly 1-3 days" estimate after a targeted
    codebase search confirmed zero notification/email infrastructure exists anywhere in
    OrgOps (umbrella `wave-decisions.md` Decision 6). Building out-of-band notification from
    scratch (provider selection, delivery reliability, opt-out/preferences) is plausibly a
    larger, more independent piece of work than a single 1-3 day story — DESIGN should
    re-estimate and consider whether US-10 belongs in this track's Release 1 slot at all or
    should move later, once its true scope is understood.
  - US-05, US-06, US-07 are assessed as plausibly 1-3 days each, composing existing OrgOps
    primitives (`processes`/`process_output`, channels/events) rather than requiring net-new
    infrastructure.
- **Item 7 (technical notes)**: US-07, US-08, US-09 explicitly name the invocation-mechanism
  unknown and its downstream implications (mid-run streaming, checkpoint granularity, mid-run
  message injection) rather than glossing over them.
- **Item 8 (dependencies)**: US-08 and US-09 carry a tracked dependency on the (now-skipped)
  SPIKE's underlying question, named in Technical Notes and in the umbrella
  `wave-decisions.md` Decision 1. US-10 carries a tracked, confirmed-absent dependency on
  notification infrastructure (umbrella Decision 6). Both categories are named, not silently
  assumed.

## Peer Review Remediation Relevant to This Track

The original peer review (`nw-product-owner-reviewer`, 2026-07-21, approved, zero critical
issues) raised two items touching this track directly, both remediated:

1. **Missing concurrency/race-condition scenarios** — added one scenario + AC each to US-08
   (concurrent mid-run messages) and US-09 (concurrent pause + note), bringing both to 5
   scenarios (still within the 3-7 range).
2. **Unconfirmed notification infrastructure (US-10)** — resolved with a targeted codebase
   search (zero matches for `notif`/`sendEmail`/`smtp` across all `.ts` files); upgraded from
   "unconfirmed" to "confirmed absent," and US-10's right-sizing status downgraded from PASS
   to CONDITIONAL to reflect the larger-than-assumed scope this implies.
