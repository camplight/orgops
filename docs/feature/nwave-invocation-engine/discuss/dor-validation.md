# Definition of Ready Validation: nWave Invocation Engine Track

Extracted from the original DISCUSS-wave DoR validation
(`docs/feature/nwave-ticket-execution-engine/discuss/dor-validation.md`), which already
validated this story against the 9-item hard gate. This is a subset extraction, not a
re-validation.

## Summary Matrix (US-04)

| Story | 1. Problem | 2. Persona | 3. Examples | 4. UAT (3-7) | 5. AC from UAT | 6. Right-sized | 7. Tech notes | 8. Dependencies | 9. Outcome KPIs | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| US-04 Trigger nWave run | PASS | PASS | PASS | PASS (4) | PASS | **CONDITIONAL** | PASS | **TRACKED, not resolved** (SPIKE) | PASS | **READY WITH TRACKED DEPENDENCY** |

**Track DoR Status: READY WITH TRACKED DEPENDENCY (1/1 story meets all 9 items; carries an
explicitly tracked, non-blocking dependency on the invocation-mechanism question).**

## Evidence Notes (carried from original validation)

- **Item 6 (right-sized) — CONDITIONAL.** US-04 depends on the invocation mechanism's
  eventual DESIGN-wave selection, and effort could not be estimated with confidence until
  that mechanism was known (a coarse-grained mechanism could push dependent work well past a
  1-3 day estimate; a fine-grained one could keep it within range). This was not treated as a
  DoR failure at the time — it was exactly the kind of unknown the (now-skipped) SPIKE existed
  to resolve. **Status update**: the SPIKE was explicitly skipped per user directive; DESIGN
  should still re-estimate US-04's effort once a concrete mechanism is selected, using the
  "accepted working assumption" framing in this track's `wave-decisions.md` rather than
  waiting on further validation work that will not happen.
- **Item 7 (technical notes)**: US-04's Technical Notes explicitly name the
  invocation-mechanism unknown and its downstream implications, citing
  `apps/agent-runner/src/wrapper-harness/command.ts` as the harness contract any candidate
  mechanism must satisfy or extend, rather than glossing over the gap.
- **Item 8 (dependencies) — TRACKED, not resolved.** US-04 carries a dependency on the
  invocation-mechanism decision, named in Technical Notes, named in the umbrella
  `story-map.md`'s walking-skeleton rationale, and formally logged in the umbrella
  `wave-decisions.md` Decision 1. Per DoR item 8's own pass criterion (dependencies may be
  pending as long as they are named and tracked, not that all dependencies must already be
  resolved), this was and remains a PASS — now updated to reflect that the SPIKE will not run;
  the dependency converts from "pending SPIKE" to "pending first real DESIGN/DELIVER
  implementation attempt," per this track's `wave-decisions.md`.

## Peer Review Remediation Relevant to This Track

The original peer review (`nw-product-owner-reviewer`, 2026-07-21, approved, zero critical
issues) did not raise any track-specific issue against US-04 beyond what is already reflected
in the CONDITIONAL/TRACKED status above.
