# Track: Progress & Trust UX

## Scope

Owns everything the ticket submitter sees and can do while an implementation run is active:
live activity signal, completion summary, curated wave-by-wave progress, mid-run clarifying
questions, pause/halt controls, and notification when a run needs submitter input.

## Stories Owned

- US-05: Ticket Submitter Sees a Live "It's Working" Signal While Implementation Runs
- US-06: Ticket Submitter Receives a Completion Summary With Links to Produced Work
- US-07: Ticket Submitter Sees Wave-by-Wave Progress Instead of Raw Output Only
- US-08: Ticket Submitter Can Ask a Clarifying Question Mid-Run and Get a Response
- US-09: Ticket Submitter Can Pause or Halt a Running Implementation
- US-10: Ticket Submitter Is Notified When Implementation Needs Their Input to Continue

## Delivery Sequence Position

**Split across Walking Skeleton and Release 1**, per the umbrella `story-map.md`:

- **Walking Skeleton (Release 0)**: US-05 (raw process output stream, Activity 5 "Monitor")
  and US-06 (completion message with links, Activity 7 "Conclude" — without the approve/
  reject UI, which belongs to `multi-source-ingestion-governance`'s US-12).
- **Release 1 ("Build Trust")**: US-07, US-08, US-09, US-10 — targets opportunity scores #3,
  #4, #5 (the three highest-ranked underserved outcomes in the umbrella
  `jtbd-opportunity-scores.md`), sequenced after the walking skeleton because these stories
  build on US-05's raw signal and US-04's run contract.

## Source of Shared Context

This track's JTBD grounding, full journey (all 6 steps, including Steps 4-6 "Monitor",
"Intervene", "Conclude"), shared-artifacts registry (`wave_status`, `last_activity_at`,
`produced_artifacts_links`), complete story map, prioritization, and outcome KPIs remain in
the umbrella feature: `docs/feature/nwave-ticket-execution-engine/discuss/`. This track's own
artifacts here are a scoped extraction, not a re-derivation.
