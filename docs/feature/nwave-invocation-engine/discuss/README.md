# Track: nWave Invocation Engine

## Scope

Owns triggering an nWave implementation run for a confirmed development-work ticket — the
critical-path mechanism that every other track's execution-monitoring, intervention, and
review capability depends on.

## Stories Owned

- US-04: nWave Implementation Run Is Triggered for a Classified Development Ticket

## Delivery Sequence Position

**Walking Skeleton (Release 0)** — per the umbrella `story-map.md`, US-04 is Activity 4
("Trigger nWave run") of the walking skeleton, explicitly called out there as "conditionally
blocked": the rest of the skeleton can be built and demoed with a stubbed/manual trigger
standing in for the real mechanism until headless nWave invocation is proven in a real
implementation. This track has no blocking upstream dependency (see `wave-decisions.md`) and
is itself the upstream dependency for two other tracks (`progress-trust-ux` in full,
`multi-source-ingestion-governance`'s US-13 indirectly). **It is the critical-path track** —
delays or surprises here propagate to every downstream track.

## Source of Shared Context

This track's JTBD grounding, full journey (all 6 steps, including Step 3 "Implementation
Triggered"), shared-artifacts registry (`run_id`, `wave_status`), complete story map,
prioritization, and outcome KPIs remain in the umbrella feature:
`docs/feature/nwave-ticket-execution-engine/discuss/`. This track's own artifacts here are a
scoped extraction, not a re-derivation.

## Central Open Risk

This track inherits Decision 1 from the umbrella `wave-decisions.md` **in full** — see this
track's own `wave-decisions.md`. Headless nWave invocation feasibility is an **accepted
working assumption**, not an empirically validated fact (the planned validation SPIKE was
explicitly skipped per user directive: "go straight to the track split. I'm confident that the
nwave integration can run headlessly"). Treat this as the first thing to revisit if DESIGN or
DELIVER encounters friction implementing US-04.
